/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/trading/OrderBookView.tsx
 * High-performance Market Maker Order Book Depth Visualizer featuring:
 * 1. Visual Heatmap Overlay: Multi-tier thermal gradients, liquidity wall detection,
 *    and instant Key Support / Resistance zone highlights.
 * 2. Price-Level Aggregation: Strict deduplication and volume summing across identical
 *    price levels to prevent visual clutter, with dynamic step grouping.
 * 3. Market Maker tactical quick-action banner to target key support and resistance walls.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { TradingPairItem } from '../../types/index.js';
import { formatCrypto, safeBigInt, formatQuotePrice } from '../../lib/formatters.js';
import { D3DepthChart } from './D3DepthChart.js';
import { AreaChart as AreaChartIcon, Layers, Flame, Shield, TrendingDown, TrendingUp, SlidersHorizontal } from 'lucide-react';

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

export type OrderBookViewMode = 'SPLIT' | 'DEPTH_D3' | 'HYBRID' | 'BIDS' | 'ASKS';

export interface AggregatedLevel {
  price: string;
  qty: string;
  cumQty: string;
  orderCount: number;
  densityPercent: number; // 0 - 100 relative to max single-level volume
  isWall: boolean;
  isTopWall: boolean;
  side: 'BID' | 'ASK';
}

export const OrderBookView: React.FC<Props> = ({
  pair,
  depth,
  myOpenOrderPrices,
  myOrdersByPrice,
  userRole,
  onSelectPrice,
}) => {
  // Heatmap Overlay Toggle (Persisted in localStorage, default: true)
  const [showHeatmap, setShowHeatmapState] = useState<boolean>(() => {
    const saved = localStorage.getItem('dimonex_orderbook_heatmap');
    return saved !== null ? saved === 'true' : true;
  });

  const toggleHeatmap = () => {
    setShowHeatmapState(prev => {
      const next = !prev;
      localStorage.setItem('dimonex_orderbook_heatmap', String(next));
      return next;
    });
  };

  // View Mode: SPLIT, DEPTH_D3, HYBRID, BIDS, ASKS
  const [viewMode, setViewModeState] = useState<OrderBookViewMode>(() => {
    const saved = localStorage.getItem('dimonex_orderbook_view');
    if (saved && ['SPLIT', 'DEPTH_D3', 'HYBRID', 'BIDS', 'ASKS'].includes(saved)) {
      return saved as OrderBookViewMode;
    }
    return 'SPLIT';
  });

  const setViewMode = (mode: OrderBookViewMode) => {
    setViewModeState(mode);
    localStorage.setItem('dimonex_orderbook_view', mode);
  };

  const isQuoteIDR = (pair.quoteCurrency || 'IDR').toUpperCase() === 'IDR';
  const quoteDecimals = pair.quoteDecimals !== undefined && pair.quoteDecimals !== null ? pair.quoteDecimals : (isQuoteIDR ? 2 : 6);

  // Dynamic aggregation options tailored to pair quote currency & price scale
  const aggregationOptions = useMemo(() => {
    if (isQuoteIDR) {
      return [
        { label: 'Exact', value: 'exact' },
        { label: '10', value: '10' },
        { label: '100', value: '100' },
        { label: '1K', value: '1000' },
        { label: '10K', value: '10000' },
      ];
    }
    return [
      { label: 'Exact', value: 'exact' },
      { label: '0.01', value: '0.01' },
      { label: '0.1', value: '0.1' },
      { label: '1.0', value: '1.0' },
      { label: '10', value: '10' },
    ];
  }, [isQuoteIDR]);

  // Aggregation precision state
  const [precision, setPrecisionState] = useState<string>(() => {
    const saved = localStorage.getItem('dimonex_orderbook_precision');
    if (saved) return saved;
    return 'exact';
  });

  const setPrecision = (p: string) => {
    setPrecisionState(p);
    localStorage.setItem('dimonex_orderbook_precision', p);
  };

  // Calculate step units in raw BigInt based on selected aggregation precision
  const stepUnits = useMemo<bigint>(() => {
    if (precision === 'exact') return 1n;

    if (isQuoteIDR) {
      // In IDR, raw price is scaled by 10^quoteDecimals (usually 100 for 2 decimals)
      const scale = 10n ** BigInt(Math.max(0, quoteDecimals));
      switch (precision) {
        case '10': return 10n * scale;
        case '100': return 100n * scale;
        case '1000': return 1000n * scale;
        case '10000': return 10000n * scale;
        default: return 1n;
      }
    } else {
      // Crypto / USDT quotes
      const scale = 10n ** BigInt(Math.max(0, quoteDecimals));
      switch (precision) {
        case '0.01': return (scale / 100n) > 0n ? scale / 100n : 10000n;
        case '0.1': return (scale / 10n) > 0n ? scale / 10n : 100000n;
        case '1.0': return scale > 0n ? scale : 1000000n;
        case '10': return (scale * 10n);
        default: return 1n;
      }
    }
  }, [precision, isQuoteIDR, quoteDecimals]);

  const asksContainerRef = useRef<HTMLDivElement>(null);

  /**
   * Price-Level Aggregation Function:
   * Consolidates all orders at the identical price (or bucketed price tick) into
   * a single distinct row with summed volume and order count, preventing visual clutter.
   */
  const aggregateSide = (
    entries: [string, string, string][],
    isAsk: boolean
  ): { price: string; qty: string; cumQty: string; orderCount: number; side: 'BID' | 'ASK' }[] => {
    if (!entries || entries.length === 0) return [];

    const bucketMap = new Map<string, { qty: bigint; count: number }>();

    for (const [pStr, qStr] of entries) {
      try {
        const rawP = safeBigInt(pStr);
        const q = safeBigInt(qStr);
        if (q <= 0n) continue;

        let bucketP: bigint;
        if (stepUnits <= 1n) {
          // Exact price level deduplication
          bucketP = rawP;
        } else {
          // Price-level aggregation bucket
          bucketP = isAsk
            ? ((rawP + stepUnits - 1n) / stepUnits) * stepUnits
            : (rawP / stepUnits) * stepUnits;
        }

        const bucketKey = bucketP.toString();
        const existing = bucketMap.get(bucketKey);
        if (existing) {
          existing.qty += q;
          existing.count += 1;
        } else {
          bucketMap.set(bucketKey, { qty: q, count: 1 });
        }
      } catch {
        const existing = bucketMap.get(pStr);
        const q = safeBigInt(qStr);
        if (existing) {
          existing.qty += q;
          existing.count += 1;
        } else {
          bucketMap.set(pStr, { qty: q, count: 1 });
        }
      }
    }

    // Sort order:
    // Asks: ASCENDING (lowest ask closest to mid spread)
    // Bids: DESCENDING (highest bid closest to mid spread)
    const sortedBuckets = Array.from(bucketMap.entries()).sort((a, b) => {
      const pA = safeBigInt(a[0]);
      const pB = safeBigInt(b[0]);
      return isAsk ? (pA < pB ? -1 : pA > pB ? 1 : 0) : (pA > pB ? -1 : pA < pB ? 1 : 0);
    });

    let runningCum = 0n;
    return sortedBuckets.map(([p, data]) => {
      runningCum += data.qty;
      return {
        price: p,
        qty: data.qty.toString(),
        cumQty: runningCum.toString(),
        orderCount: data.count,
        side: isAsk ? 'ASK' : 'BID',
      };
    });
  };

  const aggregatedAsks = useMemo(() => aggregateSide(depth.asks, true), [depth.asks, stepUnits]);
  const aggregatedBids = useMemo(() => aggregateSide(depth.bids, false), [depth.bids, stepUnits]);

  // Determine visible limits based on view mode
  const rawDisplayAsks = useMemo(() => {
    const limit = viewMode === 'ASKS' ? 100 : 50;
    // Asks reversed so highest price is at top, lowest ask is nearest to spread
    return aggregatedAsks.slice(0, limit).reverse();
  }, [aggregatedAsks, viewMode]);

  const rawDisplayBids = useMemo(() => {
    const limit = viewMode === 'BIDS' ? 100 : 50;
    return aggregatedBids.slice(0, limit);
  }, [aggregatedBids, viewMode]);

  // Calculate maximum single-level volume for Heatmap Density and cumulative maxVolume for depth bars
  const { maxVolume, maxSingleLevelVolume, topResistanceWall, topSupportWall } = useMemo(() => {
    let maxCum = 0n;
    let maxSingle = 0n;

    let topAsk: { price: string; qty: bigint } | null = null;
    let topBid: { price: string; qty: bigint } | null = null;

    for (const a of rawDisplayAsks) {
      const q = safeBigInt(a.qty);
      const c = safeBigInt(a.cumQty);
      if (c > maxCum) maxCum = c;
      if (q > maxSingle) maxSingle = q;
      if (!topAsk || q > topAsk.qty) {
        topAsk = { price: a.price, qty: q };
      }
    }

    for (const b of rawDisplayBids) {
      const q = safeBigInt(b.qty);
      const c = safeBigInt(b.cumQty);
      if (c > maxCum) maxCum = c;
      if (q > maxSingle) maxSingle = q;
      if (!topBid || q > topBid.qty) {
        topBid = { price: b.price, qty: q };
      }
    }

    return {
      maxVolume: maxCum > 0n ? maxCum : 1n,
      maxSingleLevelVolume: maxSingle > 0n ? maxSingle : 1n,
      topResistanceWall: topAsk && topAsk.qty > 0n ? topAsk : null,
      topSupportWall: topBid && topBid.qty > 0n ? topBid : null,
    };
  }, [rawDisplayAsks, rawDisplayBids]);

  // Enrich display rows with Heatmap metrics (density percentage, wall flags)
  const displayAsks = useMemo<AggregatedLevel[]>(() => {
    return rawDisplayAsks.map(row => {
      const q = safeBigInt(row.qty);
      const density = maxSingleLevelVolume > 0n
        ? Math.min(100, Math.round(Number((q * 100n) / maxSingleLevelVolume)))
        : 0;
      const isTop = topResistanceWall !== null && row.price === topResistanceWall.price;
      const isWall = density >= 70 || isTop;

      return {
        ...row,
        densityPercent: density,
        isWall,
        isTopWall: isTop,
      };
    });
  }, [rawDisplayAsks, maxSingleLevelVolume, topResistanceWall]);

  const displayBids = useMemo<AggregatedLevel[]>(() => {
    return rawDisplayBids.map(row => {
      const q = safeBigInt(row.qty);
      const density = maxSingleLevelVolume > 0n
        ? Math.min(100, Math.round(Number((q * 100n) / maxSingleLevelVolume)))
        : 0;
      const isTop = topSupportWall !== null && row.price === topSupportWall.price;
      const isWall = density >= 70 || isTop;

      return {
        ...row,
        densityPercent: density,
        isWall,
        isTopWall: isTop,
      };
    });
  }, [rawDisplayBids, maxSingleLevelVolume, topSupportWall]);

  // Initial scroll position for asks container in SPLIT mode
  useEffect(() => {
    if (viewMode === 'SPLIT' && asksContainerRef.current) {
      asksContainerRef.current.scrollTop = asksContainerRef.current.scrollHeight;
    }
  }, [pair.id, viewMode]);

  const spreadFormatted = useMemo(() => {
    try {
      return formatQuotePrice(depth.spread, pair.quoteCurrency, pair.quoteDecimals);
    } catch {
      return depth.spread;
    }
  }, [depth.spread, pair.quoteCurrency, pair.quoteDecimals]);

  const getBucketUserOrderSummary = (bucketPrice: string, isAsk: boolean): UserOrderSummary | null => {
    if (!myOrdersByPrice || myOrdersByPrice.size === 0) return null;
    if (stepUnits <= 1n) {
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

  /**
   * Render Individual Ask (Sell) Row with Visual Heatmap Overlay & Price Aggregation details
   */
  const renderAskRow = (row: AggregatedLevel, idx: number) => {
    const { price, qty, cumQty, orderCount, densityPercent, isWall, isTopWall } = row;
    const depthPercent = maxVolume > 0n ? Math.min(100, Number((safeBigInt(cumQty) * 100n) / maxVolume)) : 0;
    const userOrderSummary = getBucketUserOrderSummary(price, true);
    const isMyOrder = Boolean(userOrderSummary);

    return (
      <button
        key={`ask-${price}-${idx}`}
        type="button"
        onClick={() => onSelectPrice(price)}
        className={`relative grid grid-cols-3 px-3.5 py-0.5 text-xs font-mono tabular-nums text-right hover:bg-[#EB3458]/15 transition-all w-full group ${
          isMyOrder ? 'bg-[#EB3458]/10 border-l-2 border-[#EB3458]' : ''
        } ${
          showHeatmap && isTopWall
            ? 'border-r-2 border-amber-400 bg-amber-500/[0.04]'
            : showHeatmap && isWall
            ? 'border-r border-[#EB3458]/70'
            : ''
        }`}
      >
        {/* Layer 1: Cumulative Depth Bar */}
        <div
          className="absolute right-0 top-0 bottom-0 bg-[#EB3458]/10 pointer-events-none transition-all duration-150"
          style={{ width: `${depthPercent}%` }}
        />

        {/* Layer 2: Visual Liquidity Density Heatmap Overlay */}
        {showHeatmap && (
          <div
            className={`absolute right-0 top-0 bottom-0 pointer-events-none transition-all duration-200 ${
              isTopWall
                ? 'bg-gradient-to-l from-amber-400/40 via-[#EB3458]/35 to-transparent shadow-[inset_0_0_8px_rgba(251,191,36,0.3)]'
                : densityPercent >= 70
                ? 'bg-gradient-to-l from-[#EB3458]/35 via-[#EB3458]/20 to-transparent'
                : densityPercent >= 40
                ? 'bg-gradient-to-l from-[#EB3458]/20 via-[#EB3458]/10 to-transparent'
                : 'bg-gradient-to-l from-[#EB3458]/8 to-transparent'
            }`}
            style={{ width: `${densityPercent}%` }}
          />
        )}

        {/* Col 1: Price + Support/Resistance Tags */}
        <div className="flex items-center gap-1.5 text-left relative z-10 overflow-hidden">
          <span className="font-semibold text-[#EB3458] truncate">
            {formatQuotePrice(price, pair.quoteCurrency, pair.quoteDecimals)}
          </span>

          {/* User's own orders */}
          {isMyOrder && (
            <span className="text-[9px] px-1 py-0.2 rounded bg-[#EB3458] text-white font-sans font-bold shrink-0">
              You
            </span>
          )}

          {/* Heatmap: Key Resistance Wall Indicator */}
          {showHeatmap && isTopWall && (
            <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-sans font-bold flex items-center gap-0.5 tracking-tight shrink-0 shadow-xs">
              <Flame className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
              <span>WALL</span>
            </span>
          )}
          {showHeatmap && isWall && !isTopWall && (
            <span className="text-[8px] px-0.8 py-0.1 rounded bg-[#EB3458]/25 text-[#EB3458] border border-[#EB3458]/40 font-sans font-semibold shrink-0">
              RESIST
            </span>
          )}
        </div>

        {/* Col 2: Size + Aggregated Order Count + Heatmap Density */}
        <div className="relative z-10 text-[#F5F5F7] flex items-center justify-end gap-1">
          <span>{formatCrypto(qty, pair.baseDecimals)}</span>
          
          {/* Price-Level Aggregation badge if multiple orders exist at this level */}
          {orderCount > 1 && (
            <span
              className="text-[9px] text-[#969BA8] bg-[#1E222D] px-1 py-0.2 rounded border border-[#292C38] font-sans font-medium"
              title={`${orderCount} orders aggregated at this price level`}
            >
              {orderCount}x
            </span>
          )}

          {/* Heatmap Density percentage badge on hover or high density */}
          {showHeatmap && densityPercent >= 50 && (
            <span
              className={`text-[9px] font-mono font-medium ${
                isTopWall ? 'text-amber-400' : 'text-[#EB3458]'
              }`}
              title={`Liquidity Density: ${densityPercent}% of max visible level`}
            >
              {densityPercent}%
            </span>
          )}
        </div>

        {/* Col 3: Cumulative Total */}
        <span className="text-[#686D7A] relative z-10 text-right">
          {formatCrypto(cumQty, pair.baseDecimals)}
        </span>
      </button>
    );
  };

  /**
   * Render Individual Bid (Buy) Row with Visual Heatmap Overlay & Price Aggregation details
   */
  const renderBidRow = (row: AggregatedLevel, idx: number) => {
    const { price, qty, cumQty, orderCount, densityPercent, isWall, isTopWall } = row;
    const depthPercent = maxVolume > 0n ? Math.min(100, Number((safeBigInt(cumQty) * 100n) / maxVolume)) : 0;
    const userOrderSummary = getBucketUserOrderSummary(price, false);
    const isMyOrder = Boolean(userOrderSummary);

    return (
      <button
        key={`bid-${price}-${idx}`}
        type="button"
        onClick={() => onSelectPrice(price)}
        className={`relative grid grid-cols-3 px-3.5 py-0.5 text-xs font-mono tabular-nums text-right hover:bg-[#00C087]/15 transition-all w-full group ${
          isMyOrder ? 'bg-[#00C087]/10 border-l-2 border-[#00C087]' : ''
        } ${
          showHeatmap && isTopWall
            ? 'border-r-2 border-amber-400 bg-amber-500/[0.04]'
            : showHeatmap && isWall
            ? 'border-r border-[#00C087]/70'
            : ''
        }`}
      >
        {/* Layer 1: Cumulative Depth Bar */}
        <div
          className="absolute right-0 top-0 bottom-0 bg-[#00C087]/10 pointer-events-none transition-all duration-150"
          style={{ width: `${depthPercent}%` }}
        />

        {/* Layer 2: Visual Liquidity Density Heatmap Overlay */}
        {showHeatmap && (
          <div
            className={`absolute right-0 top-0 bottom-0 pointer-events-none transition-all duration-200 ${
              isTopWall
                ? 'bg-gradient-to-l from-amber-400/40 via-[#00C087]/35 to-transparent shadow-[inset_0_0_8px_rgba(251,191,36,0.3)]'
                : densityPercent >= 70
                ? 'bg-gradient-to-l from-[#00C087]/35 via-[#00C087]/20 to-transparent'
                : densityPercent >= 40
                ? 'bg-gradient-to-l from-[#00C087]/20 via-[#00C087]/10 to-transparent'
                : 'bg-gradient-to-l from-[#00C087]/8 to-transparent'
            }`}
            style={{ width: `${densityPercent}%` }}
          />
        )}

        {/* Col 1: Price + Support/Resistance Tags */}
        <div className="flex items-center gap-1.5 text-left relative z-10 overflow-hidden">
          <span className="font-semibold text-[#00C087] truncate">
            {formatQuotePrice(price, pair.quoteCurrency, pair.quoteDecimals)}
          </span>

          {/* User's own orders */}
          {isMyOrder && (
            <span className="text-[9px] px-1 py-0.2 rounded bg-[#00C087] text-white font-sans font-bold shrink-0">
              You
            </span>
          )}

          {/* Heatmap: Key Support Wall Indicator */}
          {showHeatmap && isTopWall && (
            <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-sans font-bold flex items-center gap-0.5 tracking-tight shrink-0 shadow-xs">
              <Flame className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
              <span>WALL</span>
            </span>
          )}
          {showHeatmap && isWall && !isTopWall && (
            <span className="text-[8px] px-0.8 py-0.1 rounded bg-[#00C087]/25 text-[#00C087] border border-[#00C087]/40 font-sans font-semibold shrink-0">
              SUPPORT
            </span>
          )}
        </div>

        {/* Col 2: Size + Aggregated Order Count + Heatmap Density */}
        <div className="relative z-10 text-[#F5F5F7] flex items-center justify-end gap-1">
          <span>{formatCrypto(qty, pair.baseDecimals)}</span>

          {/* Price-Level Aggregation badge if multiple orders exist at this level */}
          {orderCount > 1 && (
            <span
              className="text-[9px] text-[#969BA8] bg-[#1E222D] px-1 py-0.2 rounded border border-[#292C38] font-sans font-medium"
              title={`${orderCount} orders aggregated at this price level`}
            >
              {orderCount}x
            </span>
          )}

          {/* Heatmap Density percentage badge on hover or high density */}
          {showHeatmap && densityPercent >= 50 && (
            <span
              className={`text-[9px] font-mono font-medium ${
                isTopWall ? 'text-amber-400' : 'text-[#00C087]'
              }`}
              title={`Liquidity Density: ${densityPercent}% of max visible level`}
            >
              {densityPercent}%
            </span>
          )}
        </div>

        {/* Col 3: Cumulative Total */}
        <span className="text-[#686D7A] relative z-10 text-right">
          {formatCrypto(cumQty, pair.baseDecimals)}
        </span>
      </button>
    );
  };

  // Spread bar element with mid price and 24h change
  const renderSpreadBar = () => (
    <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#0E1016] border-y border-[#292C38] text-xs font-mono shrink-0">
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
      {/* Top Header with Mode Switcher, Heatmap Toggle, and Price Aggregation Precision */}
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

        {/* Right Controls: Heatmap Overlay Toggle & Price Aggregation Grouping */}
        <div className="flex items-center gap-2">
          {/* Visual Heatmap Overlay Toggle */}
          <button
            type="button"
            onClick={toggleHeatmap}
            title={showHeatmap ? 'Nonaktifkan Heatmap Likuiditas' : 'Aktifkan Heatmap Likuiditas & Area Support/Resistance'}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-sans font-medium transition-all border ${
              showHeatmap
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-xs'
                : 'bg-[#15171F] text-[#686D7A] border-[#292C38] hover:text-[#F5F5F7] hover:border-[#3E4252]'
            }`}
          >
            <Flame className={`w-3.5 h-3.5 ${showHeatmap ? 'text-amber-400 fill-amber-400' : 'text-[#686D7A]'}`} />
            <span>Heatmap</span>
          </button>

          {/* Price-Level Aggregation Step Selector */}
          {viewMode !== 'DEPTH_D3' && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-[#686D7A] font-sans hidden sm:inline">Agg:</span>
              <div className="flex items-center bg-[#15171F] p-0.5 rounded border border-[#292C38] text-[10px] font-mono">
                {aggregationOptions.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPrecision(opt.value)}
                    title={`Agregasi harga: ${opt.label}`}
                    className={`px-1.5 py-0.5 rounded font-semibold transition-colors ${
                      precision === opt.value
                        ? 'bg-[#EB3458] text-white shadow-xs'
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
      </div>

      {/* Market Maker Tactical Summary Strip: Key Resistance Wall & Key Support Wall */}
      {showHeatmap && (topResistanceWall || topSupportWall) && viewMode !== 'DEPTH_D3' && (
        <div className="grid grid-cols-2 px-3 py-1 bg-[#0A0C10] border-b border-[#292C38]/80 text-[10px] font-mono">
          {/* Key Resistance Wall */}
          <div className="flex items-center gap-1.5 overflow-hidden">
            <span className="text-[#686D7A] font-sans shrink-0 flex items-center gap-0.5">
              <TrendingDown className="w-3 h-3 text-[#EB3458]" />
              <span>Resist:</span>
            </span>
            {topResistanceWall ? (
              <button
                type="button"
                onClick={() => onSelectPrice(topResistanceWall.price)}
                className="flex items-center gap-1 text-[#EB3458] hover:underline font-semibold truncate"
                title={`Klik untuk mengisi harga Resistance Wall: ${formatQuotePrice(topResistanceWall.price, pair.quoteCurrency, pair.quoteDecimals)}`}
              >
                <span>{formatQuotePrice(topResistanceWall.price, pair.quoteCurrency, pair.quoteDecimals)}</span>
                <span className="text-[#969BA8] font-normal">({formatCrypto(topResistanceWall.qty.toString(), pair.baseDecimals)})</span>
              </button>
            ) : (
              <span className="text-[#686D7A]">-</span>
            )}
          </div>

          {/* Key Support Wall */}
          <div className="flex items-center justify-end gap-1.5 overflow-hidden">
            <span className="text-[#686D7A] font-sans shrink-0 flex items-center gap-0.5">
              <TrendingUp className="w-3 h-3 text-[#00C087]" />
              <span>Support:</span>
            </span>
            {topSupportWall ? (
              <button
                type="button"
                onClick={() => onSelectPrice(topSupportWall.price)}
                className="flex items-center gap-1 text-[#00C087] hover:underline font-semibold truncate"
                title={`Klik untuk mengisi harga Support Wall: ${formatQuotePrice(topSupportWall.price, pair.quoteCurrency, pair.quoteDecimals)}`}
              >
                <span>{formatQuotePrice(topSupportWall.price, pair.quoteCurrency, pair.quoteDecimals)}</span>
                <span className="text-[#969BA8] font-normal">({formatCrypto(topSupportWall.qty.toString(), pair.baseDecimals)})</span>
              </button>
            ) : (
              <span className="text-[#686D7A]">-</span>
            )}
          </div>
        </div>
      )}

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
          <span className="text-right">
            Size ({pair.baseCurrency}) {precision !== 'exact' && <span className="text-[9px] text-amber-400 font-sans font-normal">(Agg)</span>}
          </span>
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
        <div className="flex items-center gap-2">
          <span>
            {viewMode === 'DEPTH_D3' && `Visualisasi Kedalaman D3.js (${displayAsks.length} Asks, ${displayBids.length} Bids)`}
            {viewMode === 'HYBRID' && `Hybrid D3 & Ladder (${displayAsks.length} Asks · ${displayBids.length} Bids)`}
            {viewMode === 'SPLIT' && `${displayAsks.length} Asks · ${displayBids.length} Bids`}
            {viewMode === 'ASKS' && `Menampilkan ${displayAsks.length} Order Jual (Asks)`}
            {viewMode === 'BIDS' && `Menampilkan ${displayBids.length} Order Beli (Bids)`}
          </span>
          {showHeatmap && (
            <span className="text-amber-400 font-sans font-medium flex items-center gap-0.5">
              <Flame className="w-2.5 h-2.5 fill-amber-400" />
              <span>Heatmap Active</span>
            </span>
          )}
        </div>
        <span className="text-[#969BA8]">
          {precision === 'exact' ? 'Exact Level Aggregated' : `Aggregated (${precision})`}
        </span>
      </div>
    </div>
  );
};
