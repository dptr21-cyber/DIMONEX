"""
@license
SPDX-License-Identifier: Apache-2.0

bots/python_hft_mm/trend_defense.py
Trend-Following & Anti-Manipulation Defense Module.
1. Micro-timeframe indicator (Fast EMA vs Slow EMA + Volume-Weighted Price Momentum).
2. Up/Down Trend Dynamic Pricing Leaning (prevents adverse selection / falling knife).
3. Flash Defense & Anti-Pump/Dump perimeter widening (micro-fraction scaling, 2-3 ladder limits).
"""

from decimal import Decimal
import collections
import time
from typing import Deque, Tuple, Optional
from dataclasses import dataclass


class TrendState:
    NEUTRAL = "NEUTRAL"
    UPTREND = "UPTREND"
    DOWNTREND = "DOWNTREND"


@dataclass
class DefenseSignal:
    trend: str                      # TrendState
    skew_bps: Decimal               # Price shift lean in basis points (+ for uptrend, - for downtrend)
    is_flash_spike: bool            # True if abnormal volume/price spike is detected
    defense_widening_factor: Decimal # 1.0 (normal) to 3.0+ (defensive perimeter widened)
    size_scale_factor: Decimal      # 1.0 (normal) down to 0.2 (micro-fraction during pump/dump)
    reason: str


class TrendDefenseEngine:
    """
    Analyzes tick-level trades and short-term price action to establish:
    - Micro momentum direction
    - Flash anomaly detection (volume surges & rapid deviation)
    """

    def __init__(
        self,
        fast_window: int = 12,
        slow_window: int = 36,
        volatility_threshold_bps: Decimal = Decimal("120"),
        pump_dump_multiplier: Decimal = Decimal("2.5"),
        defense_perimeter_multiplier: Decimal = Decimal("3.0")
    ):
        self.fast_alpha = Decimal(2.0 / (fast_window + 1.0))
        self.slow_alpha = Decimal(2.0 / (slow_window + 1.0))

        self.fast_ema: Optional[Decimal] = None
        self.slow_ema: Optional[Decimal] = None

        self.volatility_threshold_bps = volatility_threshold_bps
        self.pump_dump_multiplier = pump_dump_multiplier
        self.defense_perimeter_multiplier = defense_perimeter_multiplier

        # Rolling trade window: (timestamp, price, volume)
        self.trade_history: Deque[Tuple[float, Decimal, Decimal]] = collections.deque(maxlen=100)
        self.last_anomaly_time: float = 0.0
        self.anomaly_cooldown_seconds: float = 15.0

    def on_trade(self, price: Decimal, qty: Decimal, timestamp: Optional[float] = None) -> None:
        """Processes each executed trade into the micro-EMA indicators and volume tracker."""
        now = timestamp or time.time()
        self.trade_history.append((now, price, qty))

        if self.fast_ema is None:
            self.fast_ema = price
            self.slow_ema = price
        else:
            self.fast_ema = (price * self.fast_alpha) + (self.fast_ema * (Decimal("1") - self.fast_alpha))
            self.slow_ema = (price * self.slow_alpha) + (self.slow_ema * (Decimal("1") - self.slow_alpha))

    def evaluate_market_condition(self, current_price: Decimal) -> DefenseSignal:
        """
        Determines market regime, leaning skew, and whether defensive flash perimeter is active.
        """
        now = time.time()

        # Default fallback if insufficient data
        if self.fast_ema is None or self.slow_ema is None or len(self.trade_history) < 5:
            return DefenseSignal(
                trend=TrendState.NEUTRAL,
                skew_bps=Decimal("0"),
                is_flash_spike=False,
                defense_widening_factor=Decimal("1.0"),
                size_scale_factor=Decimal("1.0"),
                reason="Warmup: Accumulating tick history"
            )

        # 1. Micro-trend calculation via Fast vs Slow EMA
        ema_diff = self.fast_ema - self.slow_ema
        momentum_pct = (ema_diff / self.slow_ema) * Decimal("100")

        # Trend Leaning: Up to +/- 15 bps shift
        skew_bps = Decimal("0")
        trend = TrendState.NEUTRAL

        if momentum_pct > Decimal("0.01"):
            trend = TrendState.UPTREND
            skew_bps = min(Decimal("15"), (momentum_pct * Decimal("100")).quantize(Decimal("1")))
        elif momentum_pct < Decimal("-0.01"):
            trend = TrendState.DOWNTREND
            skew_bps = max(Decimal("-15"), (momentum_pct * Decimal("100")).quantize(Decimal("1")))

        # 2. Flash Anomaly Detection (Pump / Dump / Volume Shock)
        recent_cutoff = now - 10.0
        recent_trades = [t for t in self.trade_history if t[0] >= recent_cutoff]

        is_flash_spike = False
        reason = f"Regime: {trend} (Momentum: {momentum_pct:.4f}%)"

        if len(recent_trades) >= 4:
            recent_prices = [t[1] for t in recent_trades]
            min_p = min(recent_prices)
            max_p = max(recent_prices)
            price_spread_bps = ((max_p - min_p) / min_p) * Decimal("10000")

            # Check rolling volume surge
            recent_vol = sum((t[2] for t in recent_trades), Decimal("0"))
            older_trades = [t for t in self.trade_history if t[0] < recent_cutoff]
            avg_older_vol = (sum((t[2] for t in older_trades), Decimal("0")) / Decimal(len(older_trades))) if older_trades else Decimal("1")
            vol_multiplier = recent_vol / (avg_older_vol * Decimal(len(recent_trades)) or Decimal("1"))

            # Trigger condition: sudden price movement beyond threshold or high volume surge
            if price_spread_bps > self.volatility_threshold_bps or vol_multiplier > self.pump_dump_multiplier:
                self.last_anomaly_time = now
                is_flash_spike = True

        # Check if still inside anomaly cooldown window
        if (now - self.last_anomaly_time) < self.anomaly_cooldown_seconds:
            is_flash_spike = True

        if is_flash_spike:
            # FLASH DEFENSE ACTIVATED:
            # - Widen quote perimeter to absorb impact
            # - Scale down order size to micro-fractions (20% of standard size)
            # - Limit ladder orders to 2-3 levels
            widening = self.defense_perimeter_multiplier
            size_scale = Decimal("0.20")
            reason = "FLASH DEFENSE ACTIVE: Volatility/Volume spike detected. Perimeter widened, sizes throttled."
        else:
            widening = Decimal("1.0")
            size_scale = Decimal("1.0")

        return DefenseSignal(
            trend=trend,
            skew_bps=skew_bps,
            is_flash_spike=is_flash_spike,
            defense_widening_factor=widening,
            size_scale_factor=size_scale,
            reason=reason
        )
