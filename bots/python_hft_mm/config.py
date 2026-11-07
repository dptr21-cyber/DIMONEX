"""
@license
SPDX-License-Identifier: Apache-2.0

bots/python_hft_mm/config.py
Configuration loader and strict Decimal-based precision engine.
Enforces zero-float math for 8-decimal base tokens and 6-decimal quote assets (USDT).
"""

from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP
import os
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class BotConfig:
    """Immutable, strongly typed configuration container."""
    exchange: str
    symbol: str
    base_asset: str
    quote_asset: str
    
    ws_url: str
    rest_url: str
    api_key: str
    api_secret: str

    # Asset Precisions
    base_decimals: int
    quote_decimals: int
    tick_size: Decimal
    lot_size: Decimal

    # Pricing & Micro-Spread Controls
    target_spread_pct: Decimal      # e.g., Decimal('0.08') = 0.08%
    min_spread_pct: Decimal         # Minimum allowed spread to prevent toxic fills
    max_spread_pct: Decimal         # Maximum spread before defense triggers
    micro_order_size: Decimal       # Micro-lot size placed under normal conditions
    max_ladder_levels: int          # Max ladder levels per side (2-3)

    # Inventory Limits & Lean Controls
    max_base_inventory: Decimal     # Max total token exposure
    max_quote_inventory: Decimal    # Max USDT exposure
    inventory_skew_factor: Decimal  # Leaning sensitivity (-1.0 to 1.0)
    max_drawdown_pct: Decimal       # Emergency circuit breaker threshold

    # Anti-Manipulation / Flash Defense
    volatility_threshold_bps: Decimal   # Basis points for abnormal price jump detection
    pump_dump_multiplier: Decimal       # Volume spike factor (e.g. 2.5x of rolling baseline)
    defense_perimeter_multiplier: Decimal # Multiplier to widen quotes during market spikes
    ws_timeout_seconds: float           # Max allowed silence before pausing operations

    def round_price(self, price: Decimal, round_up: bool = False) -> Decimal:
        """Quantizes price to the exchange's exact tick size without floating point drift."""
        if price <= Decimal("0"):
            return Decimal("0")
        rounding = ROUND_HALF_UP if round_up else ROUND_DOWN
        return (price / self.tick_size).quantize(Decimal("1"), rounding=rounding) * self.tick_size

    def round_qty(self, qty: Decimal) -> Decimal:
        """Quantizes order volume to the exact lot size precision."""
        if qty <= Decimal("0"):
            return Decimal("0")
        return (qty / self.lot_size).quantize(Decimal("1"), rounding=ROUND_DOWN) * self.lot_size

    def to_base_units(self, qty: Decimal) -> int:
        """Converts human token amount to atomic integer units (10^base_decimals)."""
        scale = Decimal(10 ** self.base_decimals)
        return int((qty * scale).quantize(Decimal("1"), rounding=ROUND_DOWN))

    def to_quote_units(self, price: Decimal) -> int:
        """Converts human quote price to atomic integer units (10^quote_decimals)."""
        scale = Decimal(10 ** self.quote_decimals)
        return int((price * scale).quantize(Decimal("1"), rounding=ROUND_DOWN))


def load_config_from_env() -> BotConfig:
    """Loads configuration from environment variables with production defaults."""
    return BotConfig(
        exchange=os.getenv("EXCHANGE", "DIMONEX"),
        symbol=os.getenv("SYMBOL", "BTC-USDT"),
        base_asset=os.getenv("BASE_ASSET", "BTC"),
        quote_asset=os.getenv("QUOTE_ASSET", "USDT"),
        ws_url=os.getenv("WS_URL", "ws://localhost:3000/ws/market"),
        rest_url=os.getenv("REST_URL", "http://localhost:3000/api"),
        api_key=os.getenv("API_KEY", ""),
        api_secret=os.getenv("API_SECRET", ""),
        
        base_decimals=int(os.getenv("BASE_DECIMALS", "8")),
        quote_decimals=int(os.getenv("QUOTE_DECIMALS", "6")),
        tick_size=Decimal(os.getenv("TICK_SIZE", "0.01")),
        lot_size=Decimal(os.getenv("LOT_SIZE", "0.0001")),

        target_spread_pct=Decimal(os.getenv("TARGET_SPREAD_PCT", "0.08")),
        min_spread_pct=Decimal(os.getenv("MIN_SPREAD_PCT", "0.02")),
        max_spread_pct=Decimal(os.getenv("MAX_SPREAD_PCT", "0.40")),
        micro_order_size=Decimal(os.getenv("MICRO_ORDER_SIZE", "0.001")),
        max_ladder_levels=int(os.getenv("MAX_LADDER_LEVELS", "3")),

        max_base_inventory=Decimal(os.getenv("MAX_BASE_INVENTORY", "5.0")),
        max_quote_inventory=Decimal(os.getenv("MAX_QUOTE_INVENTORY", "50000.0")),
        inventory_skew_factor=Decimal(os.getenv("INVENTORY_SKEW_FACTOR", "0.25")),
        max_drawdown_pct=Decimal(os.getenv("MAX_DRAWDOWN_PCT", "3.0")),

        volatility_threshold_bps=Decimal(os.getenv("VOLATILITY_THRESHOLD_BPS", "120")),
        pump_dump_multiplier=Decimal(os.getenv("PUMP_DUMP_MULTIPLIER", "2.5")),
        defense_perimeter_multiplier=Decimal(os.getenv("DEFENSE_PERIMETER_MULTIPLIER", "3.0")),
        ws_timeout_seconds=float(os.getenv("WS_TIMEOUT_SECONDS", "4.0")),
    )
