#!/usr/bin/env python3
"""
================================================================================
SMART HFT LADDER BOT & PATTERN CHART CREATOR ENGINE
Production-Grade Modular Asynchronous High-Frequency Trading & Market Simulator
================================================================================
Language: Python 3.10+ (asyncio, OOP, Pandas / NumPy, Matplotlib)

Architecture:
  - Modul A: Advanced Pattern Chart Creator Engine
      * Generates geometric/mathematical synthetic market price action (OHLC)
      * 4 Time Frames (5m, 15m, 1h, 4h) with scaled candle bar counts & Gaussian noise
      * 14 Mathematical Chart Formations (Reversal, Continuation, Bilateral)
      * Outputs running anchor price (current_price) as the HFT pivot point
  - Modul B: Guarded Multi-Order HFT Ladder Engine
      * Asynchronous execution placing 40 ladder limit orders (20 Buy / 20 Sell, max 100)
      * Absolute Anti-Out-of-Bounds price guards (min_price_bound, max_price_bound)
      * Linear interpolation across bounded safe price space
      * Volume Scaling Guard (min_lot to max_lot marti-light distribution)
  - Integration & Visualizer:
      * Matplotlib visualization (pattern curve, contrast bound lines, anchor pivot, order levels)
      * Verification console report of Level 1 (closest) and Level 20 (furthest) ladders
================================================================================
"""

import sys
import math
import random
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional, Any
from dataclasses import dataclass, field

# Graceful optional imports for Pandas and Matplotlib
try:
    import numpy as np
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

try:
    import matplotlib
    import matplotlib.pyplot as plt
    import matplotlib.ticker as ticker
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False


# ==============================================================================
# DATA MODELS & ENUMS
# ==============================================================================

class TimeFrame:
    TF_5M = "5m"
    TF_15M = "15m"
    TF_1H = "1h"
    TF_4H = "4h"

    CONFIG = {
        "5m":  {"bars": 60,  "noise_std": 0.0020, "minutes": 5},
        "15m": {"bars": 100, "noise_std": 0.0035, "minutes": 15},
        "1h":  {"bars": 150, "noise_std": 0.0065, "minutes": 60},
        "4h":  {"bars": 240, "noise_std": 0.0120, "minutes": 240},
    }


class PatternType:
    # 1. Reversal Patterns
    HEAD_AND_SHOULDERS = "HEAD_AND_SHOULDERS"
    INVERSE_HEAD_AND_SHOULDERS = "INVERSE_HEAD_AND_SHOULDERS"
    DOUBLE_TOP = "DOUBLE_TOP"
    TRIPLE_TOP = "TRIPLE_TOP"
    DOUBLE_BOTTOM = "DOUBLE_BOTTOM"
    TRIPLE_BOTTOM = "TRIPLE_BOTTOM"

    # 2. Continuation Patterns
    BULLISH_FLAG = "BULLISH_FLAG"
    BEARISH_FLAG = "BEARISH_FLAG"
    PENNANT = "PENNANT"
    CUP_AND_HANDLE = "CUP_AND_HANDLE"
    RECTANGLE = "RECTANGLE"

    # 3. Bilateral / Neutral Patterns
    ASCENDING_TRIANGLE = "ASCENDING_TRIANGLE"
    DESCENDING_TRIANGLE = "DESCENDING_TRIANGLE"
    SYMMETRICAL_TRIANGLE = "SYMMETRICAL_TRIANGLE"


@dataclass
class CandleBar:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class LadderOrder:
    level: int
    side: str  # "BUY" or "SELL"
    price: float
    lot_size: float
    order_id: str
    status: str = "PENDING"
    placed_at: Optional[datetime] = None


# ==============================================================================
# MODUL A: ADVANCED CHART & PATTERN CREATOR ENGINE
# ==============================================================================

class AdvancedPatternChartCreator:
    """
    Mathematical Synthetic Market Data & Pattern Generator.
    Produces high-fidelity OHLC market data based on deterministic geometric curves
    layered with timeframe-scaled Gaussian noise.
    """

    def __init__(self, base_price: float = 50000.0, timeframe: str = TimeFrame.TF_15M):
        self.base_price = float(base_price)
        self.timeframe = timeframe if timeframe in TimeFrame.CONFIG else TimeFrame.TF_15M
        tf_settings = TimeFrame.CONFIG[self.timeframe]
        self.bars_count = tf_settings["bars"]
        self.noise_std = tf_settings["noise_std"]
        self.tf_minutes = tf_settings["minutes"]

    def _generate_normalized_pattern_curve(self, pattern: str, n: int) -> List[float]:
        """
        Computes the continuous mathematical trajectory [-1.0 to +1.0] for the requested formation.
        """
        curve = [0.0] * n
        x = [i / (n - 1) for i in range(n)]

        if pattern == PatternType.HEAD_AND_SHOULDERS:
            # Left shoulder peak at 0.25, Head peak at 0.50, Right shoulder peak at 0.75
            for i, xi in enumerate(x):
                ls = 0.55 * math.exp(-((xi - 0.22) ** 2) / (2 * (0.07 ** 2)))
                hd = 1.00 * math.exp(-((xi - 0.50) ** 2) / (2 * (0.08 ** 2)))
                rs = 0.50 * math.exp(-((xi - 0.78) ** 2) / (2 * (0.07 ** 2)))
                neckline = -0.10 * math.sin(math.pi * xi)
                curve[i] = ls + hd + rs + neckline - 0.40

        elif pattern == PatternType.INVERSE_HEAD_AND_SHOULDERS:
            for i, xi in enumerate(x):
                ls = -0.55 * math.exp(-((xi - 0.22) ** 2) / (2 * (0.07 ** 2)))
                hd = -1.00 * math.exp(-((xi - 0.50) ** 2) / (2 * (0.08 ** 2)))
                rs = -0.50 * math.exp(-((xi - 0.78) ** 2) / (2 * (0.07 ** 2)))
                curve[i] = ls + hd + rs + 0.40

        elif pattern == PatternType.DOUBLE_TOP:
            for i, xi in enumerate(x):
                top1 = 0.85 * math.exp(-((xi - 0.30) ** 2) / (2 * (0.10 ** 2)))
                top2 = 0.82 * math.exp(-((xi - 0.70) ** 2) / (2 * (0.10 ** 2)))
                curve[i] = top1 + top2 - 0.35

        elif pattern == PatternType.TRIPLE_TOP:
            for i, xi in enumerate(x):
                p1 = 0.80 * math.exp(-((xi - 0.20) ** 2) / (2 * (0.07 ** 2)))
                p2 = 0.82 * math.exp(-((xi - 0.50) ** 2) / (2 * (0.07 ** 2)))
                p3 = 0.79 * math.exp(-((xi - 0.80) ** 2) / (2 * (0.07 ** 2)))
                curve[i] = p1 + p2 + p3 - 0.40

        elif pattern == PatternType.DOUBLE_BOTTOM:
            for i, xi in enumerate(x):
                bot1 = -0.85 * math.exp(-((xi - 0.30) ** 2) / (2 * (0.10 ** 2)))
                bot2 = -0.82 * math.exp(-((xi - 0.70) ** 2) / (2 * (0.10 ** 2)))
                curve[i] = bot1 + bot2 + 0.35

        elif pattern == PatternType.TRIPLE_BOTTOM:
            for i, xi in enumerate(x):
                b1 = -0.80 * math.exp(-((xi - 0.20) ** 2) / (2 * (0.07 ** 2)))
                b2 = -0.82 * math.exp(-((xi - 0.50) ** 2) / (2 * (0.07 ** 2)))
                b3 = -0.79 * math.exp(-((xi - 0.80) ** 2) / (2 * (0.07 ** 2)))
                curve[i] = b1 + b2 + b3 + 0.40

        elif pattern == PatternType.BULLISH_FLAG:
            # Impulsive upward pole (0.0 -> 0.35), downward sloping channel (0.35 -> 1.0)
            for i, xi in enumerate(x):
                if xi <= 0.35:
                    curve[i] = (xi / 0.35) * 0.90
                else:
                    progress = (xi - 0.35) / 0.65
                    channel_slope = 0.90 - progress * 0.30
                    oscillation = 0.10 * math.sin(progress * 5 * math.pi)
                    curve[i] = channel_slope + oscillation

        elif pattern == PatternType.BEARISH_FLAG:
            # Impulsive downward pole (0.0 -> 0.35), upward sloping channel (0.35 -> 1.0)
            for i, xi in enumerate(x):
                if xi <= 0.35:
                    curve[i] = -(xi / 0.35) * 0.90
                else:
                    progress = (xi - 0.35) / 0.65
                    channel_slope = -0.90 + progress * 0.30
                    oscillation = 0.10 * math.sin(progress * 5 * math.pi)
                    curve[i] = channel_slope + oscillation

        elif pattern == PatternType.PENNANT:
            # Pole followed by symmetrical narrowing pennant
            for i, xi in enumerate(x):
                if xi <= 0.30:
                    curve[i] = (xi / 0.30) * 0.85
                else:
                    progress = (xi - 0.30) / 0.70
                    amplitude = (1.0 - progress) * 0.25
                    oscillation = amplitude * math.sin(progress * 6 * math.pi)
                    curve[i] = 0.85 + oscillation

        elif pattern == PatternType.CUP_AND_HANDLE:
            # Parabolic cup from 0.0 to 0.75, handle consolidation 0.75 to 1.0
            for i, xi in enumerate(x):
                if xi <= 0.75:
                    t = (xi / 0.75) * 2 - 1  # -1 to +1
                    curve[i] = (t ** 2) * 0.75
                else:
                    progress = (xi - 0.75) / 0.25
                    curve[i] = 0.75 - progress * 0.15 + 0.05 * math.sin(progress * 3 * math.pi)

        elif pattern == PatternType.RECTANGLE:
            # Bounded horizontal oscillation between ceiling (+0.5) and floor (-0.5)
            for i, xi in enumerate(x):
                curve[i] = 0.50 * math.sin(xi * 8 * math.pi)

        elif pattern == PatternType.ASCENDING_TRIANGLE:
            # Horizontal ceiling with rising support floor
            for i, xi in enumerate(x):
                upper_bound = 0.60
                lower_bound = -0.60 + xi * 1.05
                cycle = 0.5 * (1 + math.sin(xi * 7 * math.pi))
                curve[i] = lower_bound + cycle * (upper_bound - lower_bound)

        elif pattern == PatternType.DESCENDING_TRIANGLE:
            # Horizontal support floor with declining ceiling
            for i, xi in enumerate(x):
                lower_bound = -0.60
                upper_bound = 0.60 - xi * 1.05
                cycle = 0.5 * (1 + math.sin(xi * 7 * math.pi))
                curve[i] = lower_bound + cycle * (upper_bound - lower_bound)

        elif pattern == PatternType.SYMMETRICAL_TRIANGLE:
            # Converging ceiling and floor toward apex
            for i, xi in enumerate(x):
                upper_bound = 0.70 * (1.0 - 0.85 * xi)
                lower_bound = -0.70 * (1.0 - 0.85 * xi)
                cycle = 0.5 * (1 + math.sin(xi * 8 * math.pi))
                curve[i] = lower_bound + cycle * (upper_bound - lower_bound)

        else:
            # Default sinusoidal baseline
            for i, xi in enumerate(x):
                curve[i] = 0.40 * math.sin(xi * 4 * math.pi)

        return curve

    def generate_ohlc_dataset(
        self,
        pattern: str = PatternType.HEAD_AND_SHOULDERS,
        amplitude_pct: float = 5.0
    ) -> Tuple[Any, float]:
        """
        Synthesizes the complete candle series, applies Gaussian noise deviation,
        and extracts the current running anchor price.
        Returns:
            (DataFrame or List of CandleBar, current_running_price)
        """
        n = self.bars_count
        raw_curve = self._generate_normalized_pattern_curve(pattern, n)

        # Scale curve to price amplitude
        amplitude = self.base_price * (amplitude_pct / 100.0)
        now = datetime.now()
        start_time = now - timedelta(minutes=self.tf_minutes * n)

        bars: List[CandleBar] = []
        prev_close = self.base_price + raw_curve[0] * amplitude

        for i in range(n):
            target_price = self.base_price + raw_curve[i] * amplitude
            # Layered Gaussian noise deviation
            noise = random.gauss(0, self.base_price * self.noise_std)
            nominal_close = target_price + noise

            # Candle bar mechanics
            open_price = prev_close
            close_price = nominal_close
            candle_high = max(open_price, close_price) + abs(random.gauss(0, self.base_price * (self.noise_std * 0.4)))
            candle_low = min(open_price, close_price) - abs(random.gauss(0, self.base_price * (self.noise_std * 0.4)))
            volume = random.uniform(50.0, 500.0) * (1.0 + abs(raw_curve[i]))

            bar_time = start_time + timedelta(minutes=self.tf_minutes * i)
            bar = CandleBar(
                timestamp=bar_time,
                open=round(open_price, 2),
                high=round(candle_high, 2),
                low=round(candle_low, 2),
                close=round(close_price, 2),
                volume=round(volume, 4)
            )
            bars.append(bar)
            prev_close = close_price

        # The final bar's close price acts as the HFT running anchor price
        current_price = bars[-1].close

        if HAS_PANDAS:
            data = {
                "Timestamp": [b.timestamp for b in bars],
                "Open": [b.open for b in bars],
                "High": [b.high for b in bars],
                "Low": [b.low for b in bars],
                "Close": [b.close for b in bars],
                "Volume": [b.volume for b in bars],
            }
            df = pd.DataFrame(data)
            df.set_index("Timestamp", inplace=True)
            return df, current_price

        return bars, current_price


# ==============================================================================
# MODUL B: GUARDED MULTI-ORDER HFT LADDER ENGINE
# ==============================================================================

class GuardedMultiOrderHFTLadderEngine:
    """
    High-Frequency Multi-Order Ladder Placement & Risk Management Engine.
    Enforces strict absolute price bounds and progressive lot sizing across symmetrical levels.
    """

    def __init__(
        self,
        min_price_bound: float,
        max_price_bound: float,
        min_buy_lot: float = 0.01,
        max_buy_lot: float = 0.50,
        min_sell_lot: float = 0.01,
        max_sell_lot: float = 0.50,
        total_orders: int = 40,
        tick_size: float = 0.50,
    ):
        self.min_price_bound = float(min_price_bound)
        self.max_price_bound = float(max_price_bound)
        self.min_buy_lot = float(min_buy_lot)
        self.max_buy_lot = float(max_buy_lot)
        self.min_sell_lot = float(min_sell_lot)
        self.max_sell_lot = float(max_sell_lot)
        self.tick_size = float(tick_size)

        # Total orders must be even and capped at 100 max
        orders_clamped = min(100, max(2, int(total_orders)))
        if orders_clamped % 2 != 0:
            orders_clamped += 1
        self.total_orders = orders_clamped
        self.levels_per_side = self.total_orders // 2

        self.active_orders: List[LadderOrder] = []
        self._validate_configuration()

    def _validate_configuration(self):
        """Sanity guard for ladder boundaries."""
        if self.min_price_bound <= 0 or self.max_price_bound <= 0:
            raise ValueError("[Guard] Min and Max price bounds must be positive numbers.")
        if self.min_price_bound >= self.max_price_bound:
            raise ValueError(f"[Guard] min_price_bound ({self.min_price_bound}) must be < max_price_bound ({self.max_price_bound}).")
        if self.min_buy_lot <= 0 or self.max_buy_lot < self.min_buy_lot:
            raise ValueError("[Guard] Invalid buy lot configuration: min_buy_lot <= max_buy_lot required.")
        if self.min_sell_lot <= 0 or self.max_sell_lot < self.min_sell_lot:
            raise ValueError("[Guard] Invalid sell lot configuration: min_sell_lot <= max_sell_lot required.")

    def calculate_ladder(self, current_price: float) -> Tuple[List[LadderOrder], List[LadderOrder]]:
        """
        Computes 20 Buy Limit orders (below current_price) and 20 Sell Limit orders (above current_price).
        Strictly guarantees:
          - No buy order placed <= min_price_bound or >= current_price.
          - No sell order placed >= max_price_bound or <= current_price.
          - Uniform linear price spacing across the safe channel.
          - Monotonically increasing volume scaling from Level 1 to Level N.
        """
        # Anti-Out of Bounds Anchor Validation
        if not (self.min_price_bound < current_price < self.max_price_bound):
            raise ValueError(
                f"[Anti-Out of Bounds Guard] Anchor price ({current_price}) is outside "
                f"the permissible corridor [{self.min_price_bound}, {self.max_price_bound}]!"
            )

        n = self.levels_per_side
        buy_orders: List[LadderOrder] = []
        sell_orders: List[LadderOrder] = []

        # ----------------------------------------------------------------------
        # 1. BUY LADDER CALCULATION (Levels 1 to N: Closest to Furthest)
        # Level 1 is closest to current_price; Level N touches min_price_bound.
        # ----------------------------------------------------------------------
        buy_start_price = current_price - self.tick_size
        buy_end_price = self.min_price_bound

        for level in range(1, n + 1):
            t = (level - 1) / max(1, (n - 1))  # 0.0 at level 1, 1.0 at level n
            # Linear price interpolation
            raw_price = buy_start_price - t * (buy_start_price - buy_end_price)
            # Quantize to tick size
            quantized_price = round(raw_price / self.tick_size) * self.tick_size
            # Strict safety clamping
            safe_price = max(self.min_price_bound, min(buy_start_price, quantized_price))

            # Linear volume scaling (marti-light)
            lot = self.min_buy_lot + t * (self.max_buy_lot - self.min_buy_lot)
            clamped_lot = min(self.max_buy_lot, max(self.min_buy_lot, round(lot, 4)))

            buy_orders.append(
                LadderOrder(
                    level=level,
                    side="BUY",
                    price=round(safe_price, 2),
                    lot_size=clamped_lot,
                    order_id=f"BUY-LVL-{level:02d}-{int(safe_price)}"
                )
            )

        # ----------------------------------------------------------------------
        # 2. SELL LADDER CALCULATION (Levels 1 to N: Closest to Furthest)
        # Level 1 is closest to current_price; Level N touches max_price_bound.
        # ----------------------------------------------------------------------
        sell_start_price = current_price + self.tick_size
        sell_end_price = self.max_price_bound

        for level in range(1, n + 1):
            t = (level - 1) / max(1, (n - 1))  # 0.0 at level 1, 1.0 at level n
            # Linear price interpolation
            raw_price = sell_start_price + t * (sell_end_price - sell_start_price)
            # Quantize to tick size
            quantized_price = round(raw_price / self.tick_size) * self.tick_size
            # Strict safety clamping
            safe_price = min(self.max_price_bound, max(sell_start_price, quantized_price))

            # Linear volume scaling (marti-light)
            lot = self.min_sell_lot + t * (self.max_sell_lot - self.min_sell_lot)
            clamped_lot = min(self.max_sell_lot, max(self.min_sell_lot, round(lot, 4)))

            sell_orders.append(
                LadderOrder(
                    level=level,
                    side="SELL",
                    price=round(safe_price, 2),
                    lot_size=clamped_lot,
                    order_id=f"SELL-LVL-{level:02d}-{int(safe_price)}"
                )
            )

        return buy_orders, sell_orders

    async def deploy_ladder_orders_async(self, current_price: float) -> List[LadderOrder]:
        """
        Asynchronously submits the 40 ladder orders with simulated low-latency execution.
        """
        buy_orders, sell_orders = self.calculate_ladder(current_price)
        all_orders = buy_orders + sell_orders

        # Simulate concurrent HFT batch submission
        async def submit_order(order: LadderOrder):
            await asyncio.sleep(0.001)  # Microsecond latency emulation
            order.status = "ACTIVE"
            order.placed_at = datetime.now()
            return order

        tasks = [submit_order(o) for o in all_orders]
        self.active_orders = await asyncio.gather(*tasks)
        return self.active_orders


# ==============================================================================
# MODUL C: TARGET INTEGRATION & MATPLOTLIB VISUALIZATION
# ==============================================================================

class SmartHftSystemController:
    """
    Unified Orchestrator coordinating Modul A (Chart Creator) and Modul B (Ladder Engine),
    producing real-time console verification reports and high-contrast graphical plots.
    """

    def __init__(
        self,
        base_price: float = 50000.0,
        timeframe: str = TimeFrame.TF_15M,
        pattern: str = PatternType.HEAD_AND_SHOULDERS,
        min_price_bound: float = 47500.0,
        max_price_bound: float = 52500.0,
        min_buy_lot: float = 0.05,
        max_buy_lot: float = 0.50,
        min_sell_lot: float = 0.05,
        max_sell_lot: float = 0.50,
        total_orders: int = 40,
    ):
        self.chart_engine = AdvancedPatternChartCreator(base_price=base_price, timeframe=timeframe)
        self.ladder_engine = GuardedMultiOrderHFTLadderEngine(
            min_price_bound=min_price_bound,
            max_price_bound=max_price_bound,
            min_buy_lot=min_buy_lot,
            max_buy_lot=max_buy_lot,
            min_sell_lot=min_sell_lot,
            max_sell_lot=max_sell_lot,
            total_orders=total_orders
        )
        self.pattern = pattern
        self.timeframe = timeframe

    async def execute(self, show_plot: bool = True, save_plot_path: Optional[str] = "smart_hft_ladder_chart.png") -> Dict[str, Any]:
        print("\n" + "=" * 80)
        print(" [SYSTEM START] SMART HFT LADDER BOT & PATTERN CHART CREATOR ENGINE")
        print("=" * 80)
        print(f" • Time Frame: {self.timeframe.upper()} ({TimeFrame.CONFIG[self.timeframe]['bars']} Candle Bars)")
        print(f" • Pattern: {self.pattern.replace('_', ' ')}")
        print(f" • Min Safe Bound: {self.ladder_engine.min_price_bound:,.2f}")
        print(f" • Max Safe Bound: {self.ladder_engine.max_price_bound:,.2f}")
        print(f" • Ladder Target: {self.ladder_engine.total_orders} Orders ({self.ladder_engine.levels_per_side} Buy / {self.ladder_engine.levels_per_side} Sell)")
        print("-" * 80)

        # 1. Execute Modul A
        print("[Modul A] Generating synthetic market dataset & geometric pattern curve...")
        df_or_bars, current_price = self.chart_engine.generate_ohlc_dataset(pattern=self.pattern)
        print(f" ✓ Modul A Complete: Anchor Running Price (Current Pivot) = {current_price:,.2f}")

        # 2. Execute Modul B
        print("\n[Modul B] Calculating and deploying guarded multi-order ladder levels...")
        deployed_orders = await self.ladder_engine.deploy_ladder_orders_async(current_price)
        buy_orders = [o for o in deployed_orders if o.side == "BUY"]
        sell_orders = [o for o in deployed_orders if o.side == "SELL"]
        print(f" ✓ Modul B Complete: {len(deployed_orders)} Orders Active (Anti-Out of Bounds Enforced)")

        # 3. Print Comprehensive Console Verification Report
        self._print_console_verification_report(current_price, buy_orders, sell_orders)

        # 4. Generate High-Contrast Visual Plot
        if HAS_MATPLOTLIB:
            self._render_matplotlib_visualization(df_or_bars, current_price, buy_orders, sell_orders, save_plot_path, show_plot)
        else:
            print("\n[Notice] Matplotlib is not installed. Skipping graphical window display.")

        return {
            "current_price": current_price,
            "total_orders_deployed": len(deployed_orders),
            "buy_orders": buy_orders,
            "sell_orders": sell_orders
        }

    def _print_console_verification_report(
        self,
        anchor_price: float,
        buy_orders: List[LadderOrder],
        sell_orders: List[LadderOrder]
    ):
        """Displays rigorous check on Level 1 and Level 20 bounds."""
        print("\n" + "=" * 80)
        print("          CONSOLE VERIFICATION REPORT: LOT & PRICE BOUND INTEGRITY         ")
        print("=" * 80)
        print(f" Running Anchor Price (Pivot): Rp {anchor_price:,.2f}")
        print(f" Absolute Lower Bound:        Rp {self.ladder_engine.min_price_bound:,.2f}")
        print(f" Absolute Upper Bound:        Rp {self.ladder_engine.max_price_bound:,.2f}")
        print("-" * 80)

        # Buy Ladder Verification
        b_lvl1 = buy_orders[0]
        b_lvl_furthest = buy_orders[-1]
        print(f" [BUY LADDER - {len(buy_orders)} Levels]")
        print(f"  • Level 1  (Closest)  : Price = Rp {b_lvl1.price:,.2f} | Lot = {b_lvl1.lot_size:.4f} (Min Lot Guard)")
        print(f"  • Level {b_lvl_furthest.level:<2} (Furthest) : Price = Rp {b_lvl_furthest.price:,.2f} | Lot = {b_lvl_furthest.lot_size:.4f} (Max Lot Guard)")
        
        # Invariant checks for BUY
        assert b_lvl1.price < anchor_price, "VIOLATION: Buy Level 1 >= Anchor Price!"
        assert b_lvl_furthest.price >= self.ladder_engine.min_price_bound, "VIOLATION: Buy Furthest < Min Price Bound!"
        assert b_lvl_furthest.lot_size <= self.ladder_engine.max_buy_lot, "VIOLATION: Buy Lot exceeded maximum limit!"
        print("  ✓ BUY GUARDS VERIFIED: 100% within safe boundary [Min Bound <= Price < Anchor]")

        print("-" * 80)
        # Sell Ladder Verification
        s_lvl1 = sell_orders[0]
        s_lvl_furthest = sell_orders[-1]
        print(f" [SELL LADDER - {len(sell_orders)} Levels]")
        print(f"  • Level 1  (Closest)  : Price = Rp {s_lvl1.price:,.2f} | Lot = {s_lvl1.lot_size:.4f} (Min Lot Guard)")
        print(f"  • Level {s_lvl_furthest.level:<2} (Furthest) : Price = Rp {s_lvl_furthest.price:,.2f} | Lot = {s_lvl_furthest.lot_size:.4f} (Max Lot Guard)")

        # Invariant checks for SELL
        assert s_lvl1.price > anchor_price, "VIOLATION: Sell Level 1 <= Anchor Price!"
        assert s_lvl_furthest.price <= self.ladder_engine.max_price_bound, "VIOLATION: Sell Furthest > Max Price Bound!"
        assert s_lvl_furthest.lot_size <= self.ladder_engine.max_sell_lot, "VIOLATION: Sell Lot exceeded maximum limit!"
        print("  ✓ SELL GUARDS VERIFIED: 100% within safe boundary [Anchor < Price <= Max Bound]")
        print("=" * 80 + "\n")

    def _render_matplotlib_visualization(
        self,
        dataset: Any,
        current_price: float,
        buy_orders: List[LadderOrder],
        sell_orders: List[LadderOrder],
        save_path: Optional[str],
        show: bool
    ):
        """Generates the multi-panel dark-mode Matplotlib visual chart."""
        if not HAS_MATPLOTLIB:
            return

        # Dark theme styling
        plt.style.use("dark_background")
        fig, ax = plt.subplots(figsize=(14, 8), dpi=120)
        fig.patch.set_facecolor("#08090D")
        ax.set_facecolor("#0F1117")

        # 1. Plot synthetic market curve
        if HAS_PANDAS and isinstance(dataset, pd.DataFrame):
            x_series = list(range(len(dataset)))
            y_close = dataset["Close"].values
            y_high = dataset["High"].values
            y_low = dataset["Low"].values
        else:
            x_series = list(range(len(dataset)))
            y_close = [b.close for b in dataset]
            y_high = [b.high for b in dataset]
            y_low = [b.low for b in dataset]

        ax.plot(x_series, y_close, color="#38BDF8", linewidth=2.0, label=f"Synthetic Pattern: {self.pattern.replace('_', ' ')}")
        ax.fill_between(x_series, y_low, y_high, color="#38BDF8", alpha=0.10)

        # 2. Plot Horizontal Boundary Guards (Contrasting colors)
        ax.axhline(
            y=self.ladder_engine.max_price_bound,
            color="#EF4444",
            linestyle="--",
            linewidth=2.2,
            label=f"Max Absolute Bound (Rp {self.ladder_engine.max_price_bound:,.0f})"
        )
        ax.axhline(
            y=self.ladder_engine.min_price_bound,
            color="#10B981",
            linestyle="--",
            linewidth=2.2,
            label=f"Min Absolute Bound (Rp {self.ladder_engine.min_price_bound:,.0f})"
        )

        # 3. Running Anchor Price Point (Pivot)
        anchor_x = x_series[-1]
        ax.scatter(
            [anchor_x],
            [current_price],
            color="#F59E0B",
            s=160,
            zorder=6,
            edgecolors="#FFFFFF",
            linewidth=1.8,
            label=f"Running Anchor Pivot (Rp {current_price:,.2f})"
        )

        # 4. Ladder Limit Order Levels
        ladder_x = anchor_x + 3
        # Buy Limit Orders (Green dots)
        buy_prices = [o.price for o in buy_orders]
        buy_lots = [o.lot_size for o in buy_orders]
        ax.scatter(
            [ladder_x] * len(buy_prices),
            buy_prices,
            color="#10B981",
            s=[25 + l * 120 for l in buy_lots],
            alpha=0.85,
            marker=">",
            label=f"20x Buy Limits (Rp {buy_orders[0].price:,.0f} -> Rp {buy_orders[-1].price:,.0f})"
        )

        # Sell Limit Orders (Red/Pink dots)
        sell_prices = [o.price for o in sell_orders]
        sell_lots = [o.lot_size for o in sell_orders]
        ax.scatter(
            [ladder_x] * len(sell_prices),
            sell_prices,
            color="#F43F5E",
            s=[25 + l * 120 for l in sell_lots],
            alpha=0.85,
            marker=">",
            label=f"20x Sell Limits (Rp {sell_orders[0].price:,.0f} -> Rp {sell_orders[-1].price:,.0f})"
        )

        # Annotations on Level 1 and Level 20
        ax.annotate(
            f"Buy Lvl 1: {buy_orders[0].lot_size} lot @ Rp {buy_orders[0].price:,.0f}",
            xy=(ladder_x, buy_orders[0].price),
            xytext=(ladder_x + 2, buy_orders[0].price),
            fontsize=8,
            color="#10B981",
            arrowprops=dict(arrowstyle="->", color="#10B981", lw=0.8)
        )
        ax.annotate(
            f"Buy Lvl 20: {buy_orders[-1].lot_size} lot @ Rp {buy_orders[-1].price:,.0f} (Min Guard)",
            xy=(ladder_x, buy_orders[-1].price),
            xytext=(ladder_x + 2, buy_orders[-1].price),
            fontsize=8,
            color="#10B981",
            arrowprops=dict(arrowstyle="->", color="#10B981", lw=0.8)
        )
        ax.annotate(
            f"Sell Lvl 1: {sell_orders[0].lot_size} lot @ Rp {sell_orders[0].price:,.0f}",
            xy=(ladder_x, sell_orders[0].price),
            xytext=(ladder_x + 2, sell_orders[0].price),
            fontsize=8,
            color="#F43F5E",
            arrowprops=dict(arrowstyle="->", color="#F43F5E", lw=0.8)
        )
        ax.annotate(
            f"Sell Lvl 20: {sell_orders[-1].lot_size} lot @ Rp {sell_orders[-1].price:,.0f} (Max Guard)",
            xy=(ladder_x, sell_orders[-1].price),
            xytext=(ladder_x + 2, sell_orders[-1].price),
            fontsize=8,
            color="#F43F5E",
            arrowprops=dict(arrowstyle="->", color="#F43F5E", lw=0.8)
        )

        ax.set_title(
            f"DIMONEX SMART HFT LADDER BOT & PATTERN SIMULATOR [{self.pattern.replace('_', ' ')} - {self.timeframe.upper()}]",
            fontsize=13,
            fontweight="bold",
            color="#F3F4F6",
            pad=15
        )
        ax.set_xlabel("Timeline Bar Index", color="#9CA3AF", fontsize=10)
        ax.set_ylabel("Price (IDR / USDT Quote)", color="#9CA3AF", fontsize=10)
        ax.grid(True, color="#1F2937", linestyle=":", alpha=0.6)
        ax.yaxis.set_major_formatter(ticker.StrMethodFormatter('{x:,.0f}'))
        ax.legend(loc="upper left", framealpha=0.35, facecolor="#111827", edgecolor="#374151", fontsize=8.5)

        plt.tight_layout()

        if save_path:
            try:
                plt.savefig(save_path, facecolor=fig.get_facecolor(), edgecolor="none")
                print(f"[Visualizer] Plot successfully exported to: {save_path}")
            except Exception as e:
                print(f"[Visualizer] Could not save plot: {e}")

        if show:
            try:
                plt.show()
            except Exception:
                pass


# ==============================================================================
# MAIN ENTRYPOINT & DEMO EXECUTION
# ==============================================================================

async def main():
    # Instantiate the unified controller
    controller = SmartHftSystemController(
        base_price=50000.0,
        timeframe=TimeFrame.TF_15M,
        pattern=PatternType.HEAD_AND_SHOULDERS,
        min_price_bound=46500.0,
        max_price_bound=53500.0,
        min_buy_lot=0.02,
        max_buy_lot=0.50,
        min_sell_lot=0.02,
        max_sell_lot=0.50,
        total_orders=40
    )

    # Execute simulation cycle
    await controller.execute(show_plot=False, save_plot_path="smart_hft_ladder_chart.png")


if __name__ == "__main__":
    asyncio.run(main())
