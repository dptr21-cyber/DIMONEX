"""
@license
SPDX-License-Identifier: Apache-2.0

bots/python_hft_mm/main.py
Main Runtime Orchestrator: High-Frequency Market Maker (Python 3.10+ AsyncIO).
Enforces the strict 3-Pillar Architecture:
  Pillar A: Pricing Engine (dynamic spread tightening, trend leaning, flash defense)
  Pillar B: Order Manager (asynchronous cancel-replace diffing & fill tracking)
  Pillar C: Risk & Inventory Manager (capital preservation, stale feed tripwires, drawdown halts)
"""

from decimal import Decimal
import asyncio
import signal
import sys
import os
import time
import logging
from typing import Optional

# Set up clean terminal logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("HFT-MM")

from config import BotConfig, load_config_from_env
from orderbook import LocalOrderBook
from trend_defense import TrendDefenseEngine
from pricing_engine import PricingEngine
from risk_manager import RiskManager
from order_manager import OrderManager
from client_ws import ExchangeClient


class QuantitativeMarketMakerBot:
    """
    Production-grade High-Frequency Automated Market Maker Bot.
    """

    def __init__(self, config: Optional[BotConfig] = None):
        self.config = config or load_config_from_env()

        # Core State & Engines
        self.orderbook = LocalOrderBook(
            symbol=self.config.symbol,
            quote_decimals=self.config.quote_decimals,
            base_decimals=self.config.base_decimals
        )

        self.trend_engine = TrendDefenseEngine(
            fast_window=12,
            slow_window=36,
            volatility_threshold_bps=self.config.volatility_threshold_bps,
            pump_dump_multiplier=self.config.pump_dump_multiplier,
            defense_perimeter_multiplier=self.config.defense_perimeter_multiplier
        )

        # Pillar C: Risk Manager
        self.risk_manager = RiskManager(self.config)

        # Pillar A: Pricing Engine
        self.pricing_engine = PricingEngine(self.config)

        # Pillar B: Order Manager (initialized after client)
        self.order_manager: Optional[OrderManager] = None
        self.client: Optional[ExchangeClient] = None

        self._running: bool = False
        self._loop_task: Optional[asyncio.Task] = None
        self._ws_task: Optional[asyncio.Task] = None

    async def initialize(self) -> None:
        """Sets up API client, syncs initial balances, and links event handlers."""
        logger.info(f"Initializing Quantitative HFT Market Maker for pair: {self.config.symbol}")
        logger.info(f"Target Spread: {self.config.target_spread_pct}% | Micro-lot: {self.config.micro_order_size} {self.config.base_asset}")
        logger.info(f"Precision: Base={self.config.base_decimals} dec, Quote={self.config.quote_decimals} dec")

        # Initialize API client
        self.client = ExchangeClient(
            config=self.config,
            orderbook=self.orderbook,
            trend_engine=self.trend_engine,
            on_fill_callback=self._handle_order_fill
        )
        await self.client.start()

        # Initialize Order Manager
        self.order_manager = OrderManager(
            config=self.config,
            risk_manager=self.risk_manager,
            api_client=self.client
        )

        # Sync initial account balances
        balances = await self.client.fetch_balances()
        self.risk_manager.update_balances(
            base_free=balances["base_free"],
            base_locked=balances["base_locked"],
            quote_free=balances["quote_free"],
            quote_locked=balances["quote_locked"]
        )
        logger.info(
            f"Initial Balances: {self.config.base_asset}={balances['base_free']:.4f} free, "
            f"{self.config.quote_asset}={balances['quote_free']:.2f} free"
        )

    def _handle_order_fill(self, client_order_id: str, filled_qty: Decimal, fill_price: Decimal, is_fully_filled: bool) -> None:
        """Dispatches order fill updates to both OrderManager and RiskManager."""
        if self.order_manager:
            self.order_manager.on_order_fill(client_order_id, filled_qty, fill_price, is_fully_filled)

    async def run(self) -> None:
        """Main execution loop running the 3 pillars at high frequency."""
        self._running = True

        # Launch WebSocket listener task
        self._ws_task = asyncio.create_task(self.client.run_websocket_loop())

        logger.info("Entering 3-Pillar Quantitative Loop (100ms cycle)...")
        last_metrics_log = 0.0

        try:
            while self._running:
                loop_start = time.time()

                # -------------------------------------------------------------
                # 1. PILLAR C: RISK & INVENTORY EVALUATION
                # -------------------------------------------------------------
                risk_status = self.risk_manager.evaluate_risk(self.orderbook)

                if not risk_status.is_safe_to_trade:
                    # Stale feed, circuit breaker, or insufficient liquidity
                    if self.order_manager and self.order_manager.active_orders:
                        logger.warning(f"Risk Tripwire Triggered: {risk_status.rejection_reason}. Wiping open orders.")
                        await self.order_manager.cancel_all()
                    await asyncio.sleep(0.5)
                    continue

                # -------------------------------------------------------------
                # 2. PILLAR A: ORDER BOOK ANALYSIS, TREND & PRICING ENGINE
                # -------------------------------------------------------------
                snapshot = self.orderbook.get_snapshot()
                if snapshot.best_bid is None or snapshot.best_ask is None:
                    # Waiting for order book depth
                    await asyncio.sleep(0.1)
                    continue

                # Evaluate micro-timeframe momentum and flash anomaly defense
                ltp = snapshot.last_traded_price or snapshot.mid_price
                defense_signal = self.trend_engine.evaluate_market_condition(ltp)

                # Compute tightened quotes with trend leaning and inventory skew
                target_quotes = self.pricing_engine.calculate_quotes(
                    snapshot=snapshot,
                    defense=defense_signal,
                    inventory_skew=risk_status.inventory_skew
                )

                # -------------------------------------------------------------
                # 3. PILLAR B: ORDER LIFECYCLE & EXECUTION MANAGER
                # -------------------------------------------------------------
                if self.order_manager and target_quotes:
                    await self.order_manager.sync_target_orders(target_quotes)

                # Periodic Telemetry Dashboard (every 5 seconds)
                if (loop_start - last_metrics_log) > 5.0:
                    last_metrics_log = loop_start
                    self._log_telemetry(snapshot, defense_signal, risk_status)

                # Precision sleep to maintain ~100ms cycle cadence
                elapsed = time.time() - loop_start
                sleep_time = max(0.01, 0.10 - elapsed)
                await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            logger.info("Bot execution loop cancelled.")
        finally:
            await self.shutdown()

    def _log_telemetry(self, snap, defense, risk) -> None:
        """Prints live algorithmic status."""
        active_count = len(self.order_manager.active_orders) if self.order_manager else 0
        ltp_str = f"{snap.last_traded_price:.4f}" if snap.last_traded_price else "N/A"
        spread_str = f"{snap.spread_pct:.3f}%" if snap.spread_pct else "N/A"
        
        logger.info(
            f"[STATUS] LTP: {ltp_str} | Spread: {spread_str} | "
            f"Trend: {defense.trend} (Skew: {defense.skew_bps} bps) | "
            f"Flash Defense: {'ACTIVE' if defense.is_flash_spike else 'OFF'} | "
            f"Active Orders: {active_count} | Inv Skew: {risk.inventory_skew:.2f} | "
            f"Drawdown: {risk.drawdown_pct:.2f}%"
        )

    async def shutdown(self) -> None:
        """Performs atomic shutdown, canceling all open orders and terminating sockets."""
        logger.warning("Initiating graceful shutdown...")
        self._running = False

        if self.order_manager:
            await self.order_manager.cancel_all()

        if self.client:
            await self.client.close()

        if self._ws_task and not self._ws_task.done():
            self._ws_task.cancel()

        logger.info("Quantitative HFT Market Maker bot terminated cleanly.")


def main():
    """CLI entrypoint with OS signal trap."""
    bot = QuantitativeMarketMakerBot()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def handle_signal(sig, frame):
        logger.warning(f"Received exit signal ({sig}). Shutting down gracefully...")
        loop.create_task(bot.shutdown())
        # Stop loop after brief cancellation grace
        loop.call_later(2.0, loop.stop)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        loop.run_until_complete(bot.initialize())
        loop.run_until_complete(bot.run())
    except KeyboardInterrupt:
        pass
    finally:
        loop.close()


if __name__ == "__main__":
    main()
