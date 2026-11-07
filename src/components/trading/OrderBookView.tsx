/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/trading/OrderBookView.tsx
 * High-density Order Book depth visualizer with:
 * - Full sell orders (asks) scrollability up to 100 depth levels
 * - View mode switcher (Split / Bids Only / Asks Only)
 * - Precision aggregation and Black & Crimson Pink styling
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { TradingPairItem } from '../../types/index.js';
import { formatIDR, formatCrypto, safeBigInt, formatQuotePrice } from '../../lib/formatters.js';
import { D3DepthChart } from './D3DepthChart.js';
import { AreaChart as AreaChartIcon, Columns, Layers } from 'lucide-react';

interface UserOrderSummary {
  count: number;
  totalQty: string;
  isBot: boolean;
}

interface Props {
  pair: TradingPairItem;
  depth: {
    bids: [string, string, string][]; // [price, qty, cumulativeQty]
    asks: [string, string, string][];
    spread: string;
  };
  myOpenOrderPrices?: Set<string>;
  myOrdersByPrice?: Map<string, UserOrderSummary>;
  userRole?: string;
  onSelectPrice: (priceUnits: string) => void;
}

export type PrecisionOption = '0.01' | '0.1' | '1.0' | '10' | '100' | '1000';
export type OrderBookViewMode = 'SPLIT' | 'DEPTH_D3' | 'HYBRID' | 'BIDS' | 'ASKS';

export const OrderBookView: React.FC<Props> = ({
  pair,
  depth,
  myOpenOrderPrices,
  myOrdersByPrice,
  userRole,
  onSelectPrice,
}) => {
  // Precision state
  const [precision, setPrecisionState] = useState<PrecisionOption>(() => {
    const saved = localStorage.getItem('dimonex_orderbook_precision');
    if (saved && ['0.01', '0.1', '1.0', '10', '100', '1000'].includes(saved)) {
      return saved as PrecisionOption;
    }
    return '0.01';
  });

  // View Mode: SPLIT, DEPTH_D3 (D3 visual curve), HYBRID (D3 curve + ladder), BIDS, ASKS
  const [viewMode, setViewModeState] = useState<OrderBookViewMode>(() => {
    const saved = localStorage.getItem('dimonex_orderbook_view');
    if (saved && ['SPLIT', 'DEPTH_D3', 'HYBRID', 'BIDS', 'ASKS'].includes(saved)) {
      return saved as OrderBookViewMode;
    }
    return 'SPLIT';
  });

  const asksContainerRef = useRef<HTMLDivElement>(null);

  const setPrecision = (p: PrecisionOption) => {
    setPrecisionState(p);
    localStorage.setItem('dimonex_orderbook_precision', p);
  };

  const setViewMode = (mode: OrderBookViewMode) => {
    setViewModeState(mode);
    localStorage.setItem('dimonex_orderbook_view', mode);
  };

  const precisionOptions: { label: string; value: PrecisionOption }[] = [
    { label: '0.01', value: '0.01' },
    { label: '0.1', value: '0.1' },
    { label: '1.0', value: '1.0' },
    { label: '10', value: '10' },
    { label: '100', value: '100' },
  ];

  const stepUnits = useMemo(() => {
    switch (precision) {
      case '0.1': return 10n;
      case '1.0': return 100n;
      case '10': return 1000n;
      case '100': return 10000n;
      case '1000': return 100000n;
      default: return 1n;
    }
  }, [precision]);

  const aggregateSide = (entries: [string, string, string][], isAsk: boolean): [string, string, string][] => {
    if (stepUnits === 1n || entries.length === 0) return entries;
    const bucketMap = new Map<string, bigint>();

    for (const [pStr, qStr] of entries) {
      try {
        const rawP = safeBigInt(pStr);
        const q = safeBigInt(qStr);
        const bucketP = isAsk ? ((rawP + stepUnits - 1n) / stepUnits) * stepUnits : (rawP / stepUnits) * stepUnits;
        const bucketKey = bucketP.toString();
        bucketMap.set(bucketKey, (bucketMap.get(bucketKey) || 0n) + q);
      } catch {
        bucketMap.set(pStr, (bucketMap.get(pStr) || 0n) + safeBigInt(qStr));
      }
    }

    const sortedBuckets = Array.from(bucketMap.entries()).sort((a, b) => {
      const pA = safeBigInt(a[0]);
      const pB = safeBigInt(b[0]);
      return isAsk ? (pA < pB ? -1 : 1) : (pA > pB ? -1 : 1);
    });

    let runningCum = 0n;
    return sortedBuckets.map(([p, q]) => {
      runningCum += q;
      return [p, q.toString(), runningCum.toString()];
    });
  };

  const aggregatedAsks = useMemo(() => aggregateSide(depth.asks, true), [depth.asks, stepUnits]);
  const aggregatedBids = useMemo(() => aggregateSide(depth.bids, false), [depth.bids, stepUnits]);

  // When in SPLIT mode, show up to 50 asks and 50 bids.
  // When in single mode (ASKS or BIDS), show all depth up to 100.
  const displayAsks = useMemo(() => {
    const limit = viewMode === 'ASKS' ? 100 : 50;
    // Reversing so that the highest price is at the top, and lowest ask is at the bottom nearest to the spread
    return aggregatedAsks.slice(0, limit).reverse();
  }, [aggregatedAsks, viewMode]);

  const displayBids = useMemo(() => {
    const limit = viewMode === 'BIDS' ? 100 : 50;
    return aggregatedBids.slice(0, limit);
  }, [aggregatedBids, viewMode]);

  // Initial scroll position for asks container in SPLIT mode: scroll to bottom so the lowest ask is visible right next to the spread
  useEffect(() => {
    if (viewMode === 'SPLIT' && asksContainerRef.current) {
      asksContainerRef.current.scrollTop = asksContainerRef.current.scrollHeight;
    }
  }, [pair.id, viewMode]);

  const maxVolume = useMemo(() => {
    let max = 0n;
    for (const [, , cumQty] of displayAsks) {
      const c = safeBigInt(cumQty);
      if (c > max) max = c;
    }
    for (const [, , cumQty] of displayBids) {
      const c = safeBigInt(cumQty);
      if (c > max) max = c;
    }
    return max > 0n ? max : 1n;
  }, [displayAsks, displayBids]);

  const spreadFormatted = useMemo(() => {
    try {
      return formatQuotePrice(depth.spread, pair.quoteCurrency, pair.quoteDecimals);
    } catch {
      return depth.spread;
    }
  }, [depth.spread, pair.quoteCurrency, pair.quoteDecimals]);

  const getBucketUserOrderSummary = (bucketPrice: string, isAsk: boolean): UserOrderSummary | null => {
    if (!myOrdersByPrice || myOrdersByPrice.size === 0) return null;
    if (stepUnits === 1n) {
      return myOrdersByPrice.get(bucketPrice) || null;
    }
    try {
      const bP = safeBigInt(bucketPrice);
      const minP = isAsk ? bP - stepUnits + 1n : bP;
      const maxP = isAsk ? bP : bP + stepUnits - 1n;

      let count = 0;
      let totalQty = 0n;
      let isBot = false;

      for (const [pStr, summary] of myOrdersByPrice.entries()) {
        try {
          const p = safeBigInt(pStr);
          if (p >= minP && p <= maxP) {
            count += summary.count;
            totalQty += safeBigInt(summary.totalQty);
            if (summary.isBot) isBot = true;
          }
        } catch {}
      }
      return count > 0 ? { count, totalQty: totalQty.toString(), isBot } : null;
    } catch {
      return null;
    }
  };

  // Render individual Ask (Sell) row
  const renderAskRow = ([price, qty, cumQty]: [string, string, string], idx: number) => {
    const depthPercent = maxVolume > 0n ? Math.min(100, Number((safeBigInt(cumQty) * 100n) / maxVolume)) : 0;
    const userOrderSummary = getBucketUserOrderSummary(price, true);
    const isMyOrder = Boolean(userOrderSummary);

    return (
      <button
        key={`ask-${price}-${idx}`}
        type="button"
        onClick={() => onSelectPrice(price)}
        className={`relative grid grid-cols-3 px-3.5 py-0.5 text-xs font-mono tabular-nums text-right hover:bg-[#EB3458]/15 transition-colors w-full group ${
          isMyOrder ? 'bg-[#EB3458]/10 border-l-2 border-[#EB3458]' : ''
        }`}
      >
        {/* Depth Background Bar */}
        <div
          className="absolute right-0 top-0 bottom-0 bg-[#EB3458]/15 pointer-events-none transition-all duration-150"
          style={{ width: `${depthPercent}%` }}
        />
        <div className="flex items-center gap-1.5 text-left relative z-10">
          <span className="font-semibold text-[#EB3458]">
            {formatQuotePrice(price, pair.quoteCurrency, pair.quoteDecimals)}
          </span>
          {isMyOrder && (
            <span className="text-[9px] px-1 py-0.2 rounded bg-[#EB3458] text-white font-sans font-bold">
              You
            </span>
          )}
        </div>
        <span className="relative z-10 text-[#F5F5F7]">
          {formatCrypto(qty, pair.baseDecimals)}
        </span>
        <span className="text-[#686D7A] relative z-10 text-right">
          {formatCrypto(cumQty, pair.baseDecimals)}
        </span>
      </button>
    );
  };

  // Render individual Bid (Buy) row
  const renderBidRow = ([price, qty, cumQty]: [string, string, string], idx: number) => {
    const depthPercent = maxVolume > 0n ? Math.min(100, Number((safeBigInt(cumQty) * 100n) / maxVolume)) : 0;
    const userOrderSummary = getBucketUserOrderSummary(price, false);
    const isMyOrder = Boolean(userOrderSummary);

    return (
      <button
        key={`bid-${price}-${idx}`}
        type="button"
        onClick={() => onSelectPrice(price)}
        className={`relative grid grid-cols-3 px-3.5 py-0.5 text-xs font-mono tabular-nums text-right hover:bg-[#00C087]/15 transition-colors w-full group ${
          isMyOrder ? 'bg-[#00C087]/10 border-l-2 border-[#00C087]' : ''
        }`}
      >
        <div
          className="absolute right-0 top-0 bottom-0 bg-[#00C087]/15 pointer-events-none transition-all duration-150"
          style={{ width: `${depthPercent}%` }}
        />
        <div className="flex items-center gap-1.5 text-left relative z-10">
          <span className="font-semibold text-[#00C087]">
            {formatQuotePrice(price, pair.quoteCurrency, pair.quoteDecimals)}
          </span>
          {isMyOrder && (
            <span className="text-[9px] px-1 py-0.2 rounded bg-[#00C087] text-white font-sans font-bold">
              You
            </span>
          )}
        </div>
        <span className="relative z-10 text-[#F5F5F7]">
          {formatCrypto(qty, pair.baseDecimals)}
        </span>
        <span className="text-[#686D7A] relative z-10 text-right">
          {formatCrypto(cumQty, pair.baseDecimals)}
        </span>
      </button>
    );
  };

  // Spread bar element
  const renderSpreadBar = () => (
    <div className="flex items-center justify-between px-3.5 py-2 bg-[#0E1016] border-y border-[#292C38] text-xs font-mono shrink-0">
      <div className="flex items-center gap-2">
        <span className="font-bold text-sm text-[#F5F5F7]">
          {formatQuotePrice(pair.lastPrice, pair.quoteCurrency, pair.quoteDecimals)}
        </span>
        <span className={`text-[11px] font-bold ${(pair.priceChange24h || '').startsWith('+') || parseFloat(pair.priceChangePercent24h || pair.priceChange24h?.replace('+', '') || '0') >= 0 ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
          {pair.priceChange24h?.endsWith('%') ? pair.priceChange24h : `${pair.priceChange24h || '0.00'}%`}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-[#686D7A]">
        <span>Spread: <strong className="text-[#969BA8]">{spreadFormatted}</strong></span>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col bg-[#15171F] border border-[#292C38] rounded-xl overflow-hidden h-full shadow-xl">
      {/* Top Header with Mode Switcher & Precision */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#292C38] bg-[#0E1016]">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-[#F5F5F7]">Order Book</h3>

          {/* View Mode Switcher (Split / Bids / Asks / D3 Depth / Hybrid) */}
          <div className="flex items-center bg-[#15171F] p-0.5 rounded border border-[#292C38] gap-0.5">
            {/* Split Mode */}
            <button
              type="button"
              title="Tampilan Penuh (Bids & Asks)"
              onClick={() => setViewMode('SPLIT')}
              className={`p-1.5 rounded transition-all ${
                viewMode === 'SPLIT'
                  ? 'bg-[#292C38] text-white shadow-xs'
                  : 'text-[#686D7A] hover:text-[#F5F5F7] hover:bg-[#1E222D]'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="5" rx="1" fill="#EB3458" />
                <rect x="2" y="9" width="12" height="5" rx="1" fill="#00C087" />
              </svg>
            </button>

            {/* D3 Visual Depth Curve Mode */}
            <button
              type="button"
              title="Visualisasi Kedalaman Likuiditas Pasar (D3.js Depth Curve)"
              onClick={() => setViewMode('DEPTH_D3')}
              className={`p-1.5 rounded transition-all flex items-center gap-1 ${
                viewMode === 'DEPTH_D3'
                  ? 'bg-[#292C38] text-[#00C087] shadow-xs'
                  : 'text-[#686D7A] hover:text-[#00C087] hover:bg-[#1E222D]'
              }`}
            >
              <AreaChartIcon className="w-3.5 h-3.5" />
            </button>

            {/* Hybrid Mode (D3 Curve + Ladder) */}
            <button
              type="button"
              title="Tampilan Hybrid (D3 Curve + Tabel Order Book)"
              onClick={() => setViewMode('HYBRID')}
              className={`p-1.5 rounded transition-all ${
                viewMode === 'HYBRID'
                  ? 'bg-[#292C38] text-[#5B9DFF] shadow-xs'
                  : 'text-[#686D7A] hover:text-[#5B9DFF] hover:bg-[#1E222D]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
            </button>

            {/* Bids Only */}
            <button
              type="button"
              title="Hanya Order Beli (Bids Only)"
              onClick={() => setViewMode('BIDS')}
              className={`p-1.5 rounded transition-all ${
                viewMode === 'BIDS'
                  ? 'bg-[#292C38] text-[#00C087] shadow-xs'
                  : 'text-[#686D7A] hover:text-[#00C087] hover:bg-[#1E222D]'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="3" rx="0.5" fill="#00C087" />
                <rect x="2" y="6.5" width="12" height="3" rx="0.5" fill="#00C087" />
                <rect x="2" y="11" width="12" height="3" rx="0.5" fill="#00C087" />
              </svg>
            </button>

            {/* Asks Only */}
            <button
              type="button"
              title="Hanya Order Jual (Asks Only)"
              onClick={() => setViewMode('ASKS')}
              className={`p-1.5 rounded transition-all ${
                viewMode === 'ASKS'
                  ? 'bg-[#292C38] text-[#EB3458] shadow-xs'
                  : 'text-[#686D7A] hover:text-[#EB3458] hover:bg-[#1E222D]'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="3" rx="0.5" fill="#EB3458" />
                <rect x="2" y="6.5" width="12" height="3" rx="0.5" fill="#EB3458" />
                <rect x="2" y="11" width="12" height="3" rx="0.5" fill="#EB3458" />
              </svg>
            </button>
          </div>
        </div>

        {/* Precision Selector (hidden if full D3 depth chart is active) */}
        {viewMode !== 'DEPTH_D3' && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[#686D7A] font-sans">Precision:</span>
            <div className="flex items-center bg-[#15171F] p-0.5 rounded border border-[#292C38] text-[10px] font-mono">
              {precisionOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPrecision(opt.value)}
                  className={`px-1.5 py-0.5 rounded font-semibold transition-colors ${
                    precision === opt.value
                      ? 'bg-[#EB3458] text-white'
                      : 'text-[#686D7A] hover:text-[#F5F5F7]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* VIEW MODE: FULL D3 DEPTH CHART */}
      {viewMode === 'DEPTH_D3' && (
        <div className="flex-1 p-2">
          <D3DepthChart
            pair={pair}
            depth={depth}
            myOpenOrderPrices={myOpenOrderPrices}
            onSelectPrice={onSelectPrice}
            height={420}
          />
        </div>
      )}

      {/* VIEW MODE: HYBRID (D3 Curve on Top + Condensed Split Ladder Below) */}
      {viewMode === 'HYBRID' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="p-2 border-b border-[#292C38]">
            <D3DepthChart
              pair={pair}
              depth={depth}
              myOpenOrderPrices={myOpenOrderPrices}
              onSelectPrice={onSelectPrice}
              height={170}
              compact
            />
          </div>

          <div className="grid grid-cols-3 px-3.5 py-1 text-[10px] text-[#686D7A] font-medium border-b border-[#292C38]/60 bg-[#0E1016]/50">
            <span className="text-left">Price ({pair.quoteCurrency})</span>
            <span className="text-right">Size ({pair.baseCurrency})</span>
            <span className="text-right">Total</span>
          </div>

          {/* Asks (Sell Orders) */}
          <div
            ref={asksContainerRef}
            className="flex-1 overflow-y-auto max-h-[140px] py-1 space-y-px scroll-smooth"
            style={{ overscrollBehavior: 'contain' }}
          >
            {displayAsks.slice(-15).map((row, idx) => renderAskRow(row, idx))}
          </div>

          {/* Spread Indicator */}
          {renderSpreadBar()}

          {/* Bids (Buy Orders) */}
          <div
            className="flex-1 overflow-y-auto max-h-[140px] py-1 space-y-px scroll-smooth"
            style={{ overscrollBehavior: 'contain' }}
          >
            {displayBids.slice(0, 15).map((row, idx) => renderBidRow(row, idx))}
          </div>
        </div>
      )}

      {/* Table Column Titles (When in Split, Asks, or Bids modes) */}
      {viewMode !== 'DEPTH_D3' && viewMode !== 'HYBRID' && (
        <div className="grid grid-cols-3 px-3.5 py-1.5 text-[11px] text-[#686D7A] font-medium border-b border-[#292C38]/60 bg-[#0E1016]/50">
          <span className="text-left">Price ({pair.quoteCurrency})</span>
          <span className="text-right">Size ({pair.baseCurrency})</span>
          <span className="text-right">Total</span>
        </div>
      )}

      {/* VIEW MODE: SPLIT (Both Asks & Bids) */}
      {viewMode === 'SPLIT' && (
        <>
          {/* Asks (Sell Orders - Crimson Pink) with full scrollability to the top */}
          <div
            ref={asksContainerRef}
            className="flex-1 overflow-y-auto max-h-[220px] py-1 space-y-px scroll-smooth"
            style={{ overscrollBehavior: 'contain' }}
          >
            {displayAsks.length === 0 && (
              <div className="py-6 text-center text-[11px] text-[#686D7A] font-mono">
                Buku ask kosong (Belum ada order jual)
              </div>
            )}
            {displayAsks.map((row, idx) => renderAskRow(row, idx))}
          </div>

          {/* Middle Spread Indicator */}
          {renderSpreadBar()}

          {/* Bids (Buy Orders - Green) */}
          <div
            className="flex-1 overflow-y-auto max-h-[220px] py-1 space-y-px scroll-smooth"
            style={{ overscrollBehavior: 'contain' }}
          >
            {displayBids.length === 0 && (
              <div className="py-6 text-center text-[11px] text-[#686D7A] font-mono">
                Buku bid kosong (Belum ada order beli)
              </div>
            )}
            {displayBids.map((row, idx) => renderBidRow(row, idx))}
          </div>
        </>
      )}

      {/* VIEW MODE: ASKS ONLY (Sell Side Full Height) */}
      {viewMode === 'ASKS' && (
        <div className="flex flex-col flex-1">
          <div
            ref={asksContainerRef}
            className="flex-1 overflow-y-auto max-h-[440px] py-1 space-y-px scroll-smooth"
            style={{ overscrollBehavior: 'contain' }}
          >
            {displayAsks.length === 0 && (
              <div className="py-12 text-center text-[11px] text-[#686D7A] font-mono">
                Buku order jual (Asks) kosong
              </div>
            )}
            {displayAsks.map((row, idx) => renderAskRow(row, idx))}
          </div>
          {renderSpreadBar()}
        </div>
      )}

      {/* VIEW MODE: BIDS ONLY (Buy Side Full Height) */}
      {viewMode === 'BIDS' && (
        <div className="flex flex-col flex-1">
          {renderSpreadBar()}
          <div
            className="flex-1 overflow-y-auto max-h-[440px] py-1 space-y-px scroll-smooth"
            style={{ overscrollBehavior: 'contain' }}
          >
            {displayBids.length === 0 && (
              <div className="py-12 text-center text-[11px] text-[#686D7A] font-mono">
                Buku order beli (Bids) kosong
              </div>
            )}
            {displayBids.map((row, idx) => renderBidRow(row, idx))}
          </div>
        </div>
      )}

      {/* Footer Info Strip */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#0A0C10] border-t border-[#292C38] text-[10px] text-[#686D7A] font-mono">
        <span>
          {viewMode === 'DEPTH_D3' && `Visualisasi Kedalaman D3.js (${displayAsks.length} Asks, ${displayBids.length} Bids)`}
          {viewMode === 'HYBRID' && `Hybrid D3 & Ladder (${displayAsks.length} Asks · ${displayBids.length} Bids)`}
          {viewMode === 'SPLIT' && `${displayAsks.length} Asks · ${displayBids.length} Bids`}
          {viewMode === 'ASKS' && `Menampilkan ${displayAsks.length} Order Jual (Asks)`}
          {viewMode === 'BIDS' && `Menampilkan ${displayBids.length} Order Beli (Bids)`}
        </span>
        <span className="text-[#969BA8]">Real-time L2 Depth</span>
      </div>
    </div>
  );
};
