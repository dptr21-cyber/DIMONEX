"""
@license
SPDX-License-Identifier: Apache-2.0

bots/python_hft_mm/order_manager.py
Pillar B: High-Performance Asynchronous Order Lifecycle & Execution Manager.
1. Maintains local registry of active orders (bids & asks across ladder levels).
2. Performs intelligent diffing (cancel-replace) to avoid redundant API churn.
3. Tracks partial fills, full executions, and updates inventory allocations.
4. Handles rate limits, timeouts, and network retries gracefully.
5. Provides atomic `cancel_all()` for graceful shutdown and emergency stop.
"""

from decimal import Decimal
import asyncio
import time
import uuid
import logging
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from config import BotConfig
from pricing_engine import TargetOrder
from risk_manager import RiskManager

logger = logging.getLogger("OrderManager")


@dataclass
class ActiveOrder:
    order_id: str
    client_order_id: str
    side: str
    price: Decimal
    quantity: Decimal
    filled_quantity: Decimal
    remaining_quantity: Decimal
    status: str             # "NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED"
    created_at: float
    level: int
    is_defensive: bool


class OrderManager:
    """
    Pillar B: Executes and coordinates the full lifecycle of trading orders.
    Diffs desired quotes against existing active orders to minimize API latency
    and prevent exchange rate-limit penalties.
    """

    def __init__(self, config: BotConfig, risk_manager: RiskManager, api_client: Any):
        self.config = config
        self.risk = risk_manager
        self.client = api_client

        # Active orders keyed by client_order_id
        self.active_orders: Dict[str, ActiveOrder] = {}
        
        # Rate-limiting backoff state
        self.backoff_until: float = 0.0
        self.consecutive_errors: int = 0

    def generate_client_order_id(self, side: str, level: int) -> str:
        """Generates a deterministic yet unique client order id."""
        short_id = uuid.uuid4().hex[:8]
        return f"MM_{side}_{level}_{int(time.time()*1000)}_{short_id}"

    async def sync_target_orders(self, target_quotes: List[TargetOrder]) -> None:
        """
        Reconciles desired target quotes with active open orders on the exchange.
        Cancels out-of-spec orders and places new/replacement orders asynchronously.
        """
        now = time.time()
        if now < self.backoff_until:
            logger.warning("Backoff active due to rate-limiting; skipping sync tick.")
            return

        # Separate targets by side and level: (side, level) -> TargetOrder
        target_map: Dict[Tuple[str, int], TargetOrder] = {
            (q.side, q.level): q for q in target_quotes
        }

        # Map current active orders by (side, level)
        active_map: Dict[Tuple[str, int], ActiveOrder] = {
            (o.side, o.level): o for o in self.active_orders.values()
            if o.status in ("NEW", "PARTIALLY_FILLED")
        }

        cancel_tasks = []
        place_tasks = []

        # 1. Identify orders that must be canceled or replaced
        for key, active in list(active_map.items()):
            target = target_map.get(key)

            if target is None:
                # No longer desired: cancel
                cancel_tasks.append(self._cancel_order(active))
            else:
                # Check price tolerance (if price differs by more than 0.5 tick or qty changed)
                price_delta = abs(active.price - target.price)
                qty_delta = abs(active.remaining_quantity - target.quantity)

                needs_replace = (
                    price_delta >= self.config.tick_size or
                    qty_delta > (self.config.lot_size * Decimal("2")) or
                    active.is_defensive != target.is_defensive
                )

                if needs_replace:
                    cancel_tasks.append(self._cancel_order(active))
                    # Queue replacement once canceled
                    place_tasks.append(self._place_target_order(target))
                else:
                    # Existing order is optimal, keep resting in book
                    pass

        # 2. Identify new levels to place
        for key, target in target_map.items():
            if key not in active_map:
                place_tasks.append(self._place_target_order(target))

        # Execute cancellations first to free up locked capital
        if cancel_tasks:
            await asyncio.gather(*cancel_tasks, return_exceptions=True)

        # Execute placements
        if place_tasks:
            await asyncio.gather(*place_tasks, return_exceptions=True)

    async def _cancel_order(self, order: ActiveOrder) -> bool:
        """Cancels a single active order via the exchange API client."""
        try:
            success = await self.client.cancel_order(
                symbol=self.config.symbol,
                order_id=order.order_id,
                client_order_id=order.client_order_id
            )
            if success:
                order.status = "CANCELED"
                self.active_orders.pop(order.client_order_id, None)
                logger.info(f"Canceled {order.side} L{order.level} @ {order.price}")
                return True
            return False
        except Exception as e:
            logger.error(f"Error canceling order {order.client_order_id}: {e}")
            self._handle_api_error(e)
            return False

    async def _place_target_order(self, target: TargetOrder) -> Optional[ActiveOrder]:
        """Validates risk and places a new limit order on the exchange."""
        # Pre-trade Risk Filter (Pillar C check)
        is_valid, reason = self.risk.validate_order(target.side, target.price, target.quantity)
        if not is_valid:
            logger.debug(f"Order rejected by Risk Manager: {reason}")
            return None

        client_order_id = self.generate_client_order_id(target.side, target.level)
        try:
            resp = await self.client.place_limit_order(
                symbol=self.config.symbol,
                side=target.side,
                price=target.price,
                quantity=target.quantity,
                client_order_id=client_order_id
            )

            if resp and resp.get("order_id"):
                order_id = str(resp["order_id"])
                active = ActiveOrder(
                    order_id=order_id,
                    client_order_id=client_order_id,
                    side=target.side,
                    price=target.price,
                    quantity=target.quantity,
                    filled_quantity=Decimal("0"),
                    remaining_quantity=target.quantity,
                    status="NEW",
                    created_at=time.time(),
                    level=target.level,
                    is_defensive=target.is_defensive
                )
                self.active_orders[client_order_id] = active
                self.consecutive_errors = 0
                logger.info(
                    f"Placed {'[DEFENSE] ' if target.is_defensive else ''}"
                    f"{target.side} L{target.level} @ {target.price} | Qty: {target.quantity}"
                )
                return active
            else:
                logger.warning(f"Failed to place order: {resp}")
                return None

        except Exception as e:
            logger.error(f"Order placement failed: {e}")
            self._handle_api_error(e)
            return None

    def on_order_fill(self, client_order_id: str, filled_qty: Decimal, fill_price: Decimal, is_fully_filled: bool) -> None:
        """Processes partial or full fill notifications from WebSocket trade stream."""
        order = self.active_orders.get(client_order_id)
        if not order:
            return

        order.filled_quantity += filled_qty
        order.remaining_quantity = max(Decimal("0"), order.quantity - order.filled_quantity)

        if is_fully_filled or order.remaining_quantity <= Decimal("0"):
            order.status = "FILLED"
            self.active_orders.pop(client_order_id, None)
            logger.info(f"FILLED {order.side} L{order.level} @ {fill_price} (Qty: {order.quantity})")
        else:
            order.status = "PARTIALLY_FILLED"
            logger.info(f"PARTIAL FILL {order.side} L{order.level}: {filled_qty} @ {fill_price}")

    async def cancel_all(self) -> int:
        """Emergency wipe: cancels all active open orders."""
        if not self.active_orders:
            return 0

        logger.warning(f"EMERGENCY/SHUTDOWN: Canceling all {len(self.active_orders)} active open orders...")
        tasks = [self._cancel_order(order) for order in list(self.active_orders.values())]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        count = sum(1 for r in results if r is True)
        self.active_orders.clear()
        logger.info(f"Successfully cleared {count} orders.")
        return count

    def _handle_api_error(self, exc: Exception) -> None:
        """Applies exponential backoff if exchange throttles or returns error status."""
        self.consecutive_errors += 1
        msg = str(exc).lower()
        if "429" in msg or "rate limit" in msg or "too many requests" in msg:
            backoff_secs = min(30.0, 2.0 ** self.consecutive_errors)
            self.backoff_until = time.time() + backoff_secs
            logger.warning(f"Rate limited by exchange! Backing off for {backoff_secs:.1f}s")
        elif self.consecutive_errors >= 5:
            self.backoff_until = time.time() + 5.0
