"""
@license
SPDX-License-Identifier: Apache-2.0

bots/python_hft_mm/risk_manager.py
Pillar C: Robust Risk & Inventory Management Engine.
1. Tracks total allocated token & USDT balances against hard inventory ceilings.
2. Calculates normalized inventory skew for mean-reversion pricing.
3. Enforces WebSocket staleness tripwire (halts orders if feed goes silent).
4. Monitors real-time drawdown against high-water mark.
5. Pre-trade risk validation for order size, inventory bounds, and rate-limit safety.
"""

from decimal import Decimal
import time
from typing import Tuple, Optional
from dataclasses import dataclass
from config import BotConfig
from orderbook import LocalOrderBook


@dataclass
class RiskStatus:
    is_safe_to_trade: bool
    base_balance: Decimal
    quote_balance: Decimal
    total_equity_quote: Decimal
    base_inventory_pct: Decimal
    inventory_skew: Decimal         # Normalized skew [-1.0, 1.0]
    drawdown_pct: Decimal
    ws_is_stale: bool
    rejection_reason: Optional[str] = None


class RiskManager:
    """
    Pillar C: Enforces capital preservation, position sizing, and feed health tripwires.
    """

    def __init__(self, config: BotConfig):
        self.config = config

        # Real-time balances
        self.base_balance: Decimal = Decimal("0")
        self.quote_balance: Decimal = Decimal("0")
        self.locked_base: Decimal = Decimal("0")
        self.locked_quote: Decimal = Decimal("0")

        # High-water mark tracking
        self.peak_equity_quote: Decimal = Decimal("0")
        self.current_drawdown_pct: Decimal = Decimal("0")

        # Emergency tripwires
        self.circuit_broken: bool = False
        self.circuit_breaker_reason: Optional[str] = None

    def update_balances(self, base_free: Decimal, base_locked: Decimal, quote_free: Decimal, quote_locked: Decimal) -> None:
        """Updates internal balances from REST or WebSocket account updates."""
        self.base_balance = base_free
        self.locked_base = base_locked
        self.quote_balance = quote_free
        self.locked_quote = quote_locked

    def evaluate_risk(self, orderbook: LocalOrderBook) -> RiskStatus:
        """
        Runs comprehensive safety checks across data freshness, portfolio drawdown,
        and inventory allocation ceilings.
        """
        # 1. Check WebSocket Staleness Tripwire
        if orderbook.is_stale(self.config.ws_timeout_seconds):
            return RiskStatus(
                is_safe_to_trade=False,
                base_balance=self.base_balance,
                quote_balance=self.quote_balance,
                total_equity_quote=Decimal("0"),
                base_inventory_pct=Decimal("0"),
                inventory_skew=Decimal("0"),
                drawdown_pct=self.current_drawdown_pct,
                ws_is_stale=True,
                rejection_reason=f"TRIPWIRE: Market feed stale (silent > {self.config.ws_timeout_seconds}s)"
            )

        # 2. Estimate Mark Price for Equity Valuation
        mark_price = orderbook.last_traded_price
        if mark_price is None or mark_price <= Decimal("0"):
            snap = orderbook.get_snapshot()
            mark_price = snap.mid_price

        if mark_price is None or mark_price <= Decimal("0"):
            return RiskStatus(
                is_safe_to_trade=False,
                base_balance=self.base_balance,
                quote_balance=self.quote_balance,
                total_equity_quote=Decimal("0"),
                base_inventory_pct=Decimal("0"),
                inventory_skew=Decimal("0"),
                drawdown_pct=self.current_drawdown_pct,
                ws_is_stale=False,
                rejection_reason="Waiting for initial order book quotes or last trade price"
            )

        # 3. Compute Portfolio Equity & Drawdown
        total_base = self.base_balance + self.locked_base
        total_quote = self.quote_balance + self.locked_quote
        base_value_quote = total_base * mark_price
        total_equity = total_quote + base_value_quote

        if total_equity > self.peak_equity_quote:
            self.peak_equity_quote = total_equity

        if self.peak_equity_quote > Decimal("0"):
            self.current_drawdown_pct = ((self.peak_equity_quote - total_equity) / self.peak_equity_quote) * Decimal("100")
        else:
            self.current_drawdown_pct = Decimal("0")

        # Drawdown Circuit Breaker
        if self.current_drawdown_pct >= self.config.max_drawdown_pct:
            self.circuit_broken = True
            self.circuit_breaker_reason = f"CIRCUIT BREAKER: Max drawdown breached ({self.current_drawdown_pct:.2f}% >= {self.config.max_drawdown_pct}%)"
            return RiskStatus(
                is_safe_to_trade=False,
                base_balance=self.base_balance,
                quote_balance=self.quote_balance,
                total_equity_quote=total_equity,
                base_inventory_pct=Decimal("0"),
                inventory_skew=Decimal("0"),
                drawdown_pct=self.current_drawdown_pct,
                ws_is_stale=False,
                rejection_reason=self.circuit_breaker_reason
            )

        # 4. Inventory Skew Calculation
        # Normalized inventory ratio: base exposure relative to max limits
        # Skew > 0 means long excess base (lean prices down to sell).
        # Skew < 0 means short base (lean prices up to buy).
        inventory_skew = Decimal("0")
        if self.config.max_base_inventory > Decimal("0"):
            half_base = self.config.max_base_inventory / Decimal("2")
            # Deviation from midpoint: [-1.0, 1.0]
            inventory_skew = (total_base - half_base) / half_base
            inventory_skew = max(Decimal("-1.0"), min(Decimal("1.0"), inventory_skew))

        base_inv_pct = (base_value_quote / total_equity * Decimal("100")) if total_equity > Decimal("0") else Decimal("0")

        return RiskStatus(
            is_safe_to_trade=not self.circuit_broken,
            base_balance=self.base_balance,
            quote_balance=self.quote_balance,
            total_equity_quote=total_equity,
            base_inventory_pct=base_inv_pct,
            inventory_skew=inventory_skew,
            drawdown_pct=self.current_drawdown_pct,
            ws_is_stale=False,
            rejection_reason=self.circuit_breaker_reason if self.circuit_broken else None
        )

    def validate_order(self, side: str, price: Decimal, quantity: Decimal) -> Tuple[bool, Optional[str]]:
        """
        Pre-trade gatekeeper: verifies individual order against capital and inventory ceilings.
        """
        if self.circuit_broken:
            return False, f"Trade rejected: {self.circuit_breaker_reason}"

        if side.upper() == "BUY":
            cost = price * quantity
            # Check quote capital
            if cost > self.quote_balance:
                return False, f"Insufficient free quote capital (Required: {cost:.6f}, Free: {self.quote_balance:.6f})"

            # Check max base inventory limit
            total_after_fill = self.base_balance + self.locked_base + quantity
            if total_after_fill > self.config.max_base_inventory:
                return False, f"Order exceeds max base inventory ceiling ({total_after_fill} > {self.config.max_base_inventory})"

        elif side.upper() == "SELL":
            # Check base asset balance
            if quantity > self.base_balance:
                return False, f"Insufficient free base tokens (Required: {quantity:.8f}, Free: {self.base_balance:.8f})"

            # Check max quote inventory limit
            proceeds = price * quantity
            quote_after_fill = self.quote_balance + self.locked_quote + proceeds
            if quote_after_fill > self.config.max_quote_inventory:
                return False, f"Order exceeds max quote inventory ceiling ({quote_after_fill} > {self.config.max_quote_inventory})"

        return True, None
