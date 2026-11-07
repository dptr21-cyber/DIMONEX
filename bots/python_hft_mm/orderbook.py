"""
@license
SPDX-License-Identifier: Apache-2.0

bots/python_hft_mm/orderbook.py
Local synchronized high-performance Order Book (L2/L3 Depth).
Maintains live Top-5 Bid/Ask scanning, mid-price calculation, liquidity metrics,
and continuous Last Traded Price (LTP) tracking.
"""

from decimal import Decimal
import time
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass


@dataclass
class OrderBookSnapshot:
    """Read-only snapshot of the top levels of the order book."""
    timestamp: float
    last_traded_price: Optional[Decimal]
    best_bid: Optional[Decimal]
    best_ask: Optional[Decimal]
    mid_price: Optional[Decimal]
    spread_abs: Optional[Decimal]
    spread_pct: Optional[Decimal]
    top_5_bids: List[Tuple[Decimal, Decimal]]  # [(price, quantity)]
    top_5_asks: List[Tuple[Decimal, Decimal]]
    total_bid_liquidity_top5: Decimal
    total_ask_liquidity_top5: Decimal
    book_imbalance: Decimal  # (bids - asks) / (bids + asks) [-1.0, 1.0]


class LocalOrderBook:
    """
    High-frequency local memory order book maintaining sorted bids and asks.
    Supports incremental delta updates, full snapshot resets, and depth analysis.
    """

    def __init__(self, symbol: str, quote_decimals: int = 6, base_decimals: int = 8):
        self.symbol = symbol
        self.quote_decimals = quote_decimals
        self.base_decimals = base_decimals

        # Hash map storage for O(1) level updates: price -> quantity
        self._bids: Dict[Decimal, Decimal] = {}
        self._asks: Dict[Decimal, Decimal] = {}

        self.last_update_time: float = 0.0
        self.last_traded_price: Optional[Decimal] = None
        self.last_traded_time: float = 0.0
        self.last_traded_qty: Optional[Decimal] = None

    def update_snapshot(self, bids: List[Tuple[str, str]], asks: List[Tuple[str, str]], timestamp: Optional[float] = None) -> None:
        """Full reset from L2 snapshot (e.g. on reconnect)."""
        self._bids.clear()
        self._asks.clear()

        for price_str, qty_str in bids:
            price = Decimal(str(price_str))
            qty = Decimal(str(qty_str))
            if qty > Decimal("0"):
                self._bids[price] = qty

        for price_str, qty_str in asks:
            price = Decimal(str(price_str))
            qty = Decimal(str(qty_str))
            if qty > Decimal("0"):
                self._asks[price] = qty

        self.last_update_time = timestamp or time.time()

    def apply_delta(self, side: str, price_str: str, qty_str: str, timestamp: Optional[float] = None) -> None:
        """Incremental delta update from WebSocket stream."""
        price = Decimal(str(price_str))
        qty = Decimal(str(qty_str))
        target_map = self._bids if side.upper() == "BUY" or side.upper() == "BID" else self._asks

        if qty <= Decimal("0"):
            target_map.pop(price, None)
        else:
            target_map[price] = qty

        self.last_update_time = timestamp or time.time()

    def record_trade(self, price_str: str, qty_str: str, timestamp: Optional[float] = None) -> None:
        """Updates absolute Last Traded Price (LTP)."""
        self.last_traded_price = Decimal(str(price_str))
        self.last_traded_qty = Decimal(str(qty_str))
        self.last_traded_time = timestamp or time.time()

    def is_stale(self, max_silence_seconds: float = 4.0) -> bool:
        """Checks if WebSocket order book data has stopped updating."""
        if self.last_update_time == 0.0:
            return True
        return (time.time() - self.last_update_time) > max_silence_seconds

    def get_snapshot(self) -> OrderBookSnapshot:
        """
        Scans top-5 levels on both sides, computes liquidity, micro-spread,
        and market imbalance.
        """
        # Sorted bids: descending (highest price first)
        sorted_bids = sorted(self._bids.items(), key=lambda x: x[0], reverse=True)[:5]
        # Sorted asks: ascending (lowest price first)
        sorted_asks = sorted(self._asks.items(), key=lambda x: x[0], reverse=False)[:5]

        best_bid = sorted_bids[0][0] if sorted_bids else None
        best_ask = sorted_asks[0][0] if sorted_asks else None

        mid_price = None
        spread_abs = None
        spread_pct = None

        if best_bid is not None and best_ask is not None:
            mid_price = (best_bid + best_ask) / Decimal("2")
            spread_abs = best_ask - best_bid
            if mid_price > Decimal("0"):
                spread_pct = (spread_abs / mid_price) * Decimal("100")

        total_bid_liq = sum((qty for _, qty in sorted_bids), Decimal("0"))
        total_ask_liq = sum((qty for _, qty in sorted_asks), Decimal("0"))

        tot_liq = total_bid_liq + total_ask_liq
        imbalance = Decimal("0")
        if tot_liq > Decimal("0"):
            imbalance = (total_bid_liq - total_ask_liq) / tot_liq

        return OrderBookSnapshot(
            timestamp=self.last_update_time,
            last_traded_price=self.last_traded_price,
            best_bid=best_bid,
            best_ask=best_ask,
            mid_price=mid_price,
            spread_abs=spread_abs,
            spread_pct=spread_pct,
            top_5_bids=sorted_bids,
            top_5_asks=sorted_asks,
            total_bid_liquidity_top5=total_bid_liq,
            total_ask_liquidity_top5=total_ask_liq,
            book_imbalance=imbalance
        )
