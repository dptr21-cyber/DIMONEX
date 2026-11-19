/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/trading/OrderBookView.tsx
 * High-performance Order Book Depth Visualizer in Obsidian Iridium matte style.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { TradingPairItem } from '../../types/index.js';
import {
  formatCrypto,
  safeBigInt,
  formatQuotePrice,
  parseDecimalToUnits,
} from '../../lib/formatters.js';
import { D3DepthChart } from './D3DepthChart.js';
import {
  AreaChart as AreaChartIcon,
  Layers,
  Flame,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

interface UserOrderSummary {
  count: number;
  totalQty: string;
  isBot: boolean;
}

interface Props {
  pair: TradingPairItem;
  depth: {
    bids: [string, string, string][];
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
  densityPercent: number;
  isWall: boolean;
  isTopWall: boolean;
  side: 'BID' | 'ASK';
}

export const OrderBookView: React.FC<Props> = ({
  pair,
  depth,
  myOpenOrderPrices,
  myOrdersByPrice,
  onSelectPrice,
}) => {
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
  const quoteDecimals =
    pair.quoteDecimals !== undefined && pair.quoteDecimals !== null
      ? pair.quoteDecimals
      : isQuoteIDR
      ? 2
      : 6;

  const refPriceUnits = useMemo(() => {
    const lp = safeBigInt(pair.lastPrice);
    if (lp > 0n) return lp;
    const bestAsk = depth.asks?.[0]?.[0];
    if (bestAsk) return safeBigInt(bestAsk);
    const bestBid = depth.bids?.[0]?.[0];
    if (bestBid) return safeBigInt(bestBid);
    return 0n;
  }, [pair.lastPrice, depth.asks, depth.bids]);

  const aggregationOptions = useMemo(() => {
    const scaleNum = 10 ** Math.max(0, quoteDecimals);
    const refPrice = Number(refPriceUnits) / (scaleNum || 1);

    if (isQuoteIDR) {
      if (refPrice > 0 && refPrice < 10000) {
        return [
          { label: 'Exact', value: 'exact' },
          { label: '1', value: '1' },
          { label: '10', value: '10' },
          { label: '100', value: '100' },
          { label: '1K', value: '1000' },
        ];
      }
      return [
        { label: 'Exact', value: 'exact' },
        { label: '10', value: '10' },
        { label: '100', value: '100' },
        { label: '1K', value: '1000' },
        { label: '10K', value: '10000' },
      ];
    }

    if (refPrice > 0 && refPrice < 0.01) {
      return [
        { label: 'Exact', value: 'exact' },
        { label: '0.00001', value: '0.00001' },
        { label: '0.0001', value: '0.0001' },
        { label: '0.001', value: '0.001' },
        { label: '0.01', value: '0.01' },
      ];
    }
    if (refPrice > 0 && refPrice < 1) {
      return [
        { label: 'Exact', value: 'exact' },
        { label: '0.0001', value: '0.0001' },
        { label: '0.001', value: '0.001' },
        { label: '0.01', value: '0.01' },
        { label: '0.1', value: '0.1' },
      ];
    }
    if (refPrice > 0 && refPrice < 100) {
      return [
        { label: 'Exact', value: 'exact' },
        { label: '0.001', value: '0.001' },
        { label: '0.01', value: '0.01' },
        { label: '0.1', value: '0.1' },
        { label: '1', value: '1' },
      ];
    }
    if (refPrice >= 1000) {
      return [
        { label: 'Exact', value: 'exact' },
        { label: '0.1', value: '0.1' },
        { label: '1', value: '1' },
        { label: '10', value: '10' },
        { label: '100', value: '100' },
      ];
    }
    return [
      { label: 'Exact', value: 'exact' },
      { label: '0.01', value: '0.01' },
      { label: '0.1', value: '0.1' },
      { label: '1', value: '1' },
      { label: '10', value: '10' },
    ];
  }, [isQuoteIDR, quoteDecimals, refPriceUnits]);

  const [precision, setPrecisionState] = useState<string>(() => {
    const saved = localStorage.getItem('dimonex_orderbook_precision');
    if (saved) return saved;
    return 'exact';
  });

  const setPrecision = (p: string) => {
    setPrecisionState(p);
    localStorage.setItem('dimonex_orderbook_precision', p);
  };

  useEffect(() => {
    if (!aggregationOptions.some(opt => opt.value === precision)) {
      setPrecisionState('exact');
      localStorage.setItem('dimonex_orderbook_precision', 'exact');
    }
  }, [pair.id, aggregationOptions, precision]);

  const stepUnits = useMemo<bigint>(() => {
    if (precision === 'exact') return 1n;
    const parsed = parseDecimalToUnits(precision, quoteDecimals);
    return parsed > 0n ? parsed : 1n;
  }, [precision, quoteDecimals]);

  const asksContainerRef = useRef<HTMLDivElement>(null);

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
          bucketP = rawP;
        } else {
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

    const sortedBuckets = Array.from(bucketMap.entries()).sort((a, b) => {
      const pA = safeBigInt(a[0]);
      const pB = safeBigInt(b[0]);
      return isAsk ? (pA < pB ? -1 : pA > pB ? 1 : 0) : pA > pB ? -1 : pA < pB ? 1 : 0;
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

  const rawDisplayAsks = useMemo(() => {
    const limit = viewMode === 'ASKS' ? 100 : 50;
    return aggregatedAsks.slice(0, limit).reverse();
  }, [aggregatedAsks, viewMode]);

  const rawDisplayBids = useMemo(() => {
    const limit = viewMode === 'BIDS' ? 100 : 50;
    return aggregatedBids.slice(0, limit);
  }, [aggregatedBids, viewMode]);

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
      if (!topAsk || q > topAsk.qty) topAsk = { price: a.price, qty: q };
    }

    for (const b of rawDisplayBids) {
      const q = safeBigInt(b.qty);
      const c = safeBigInt(b.cumQty);
      if (c > maxCum) maxCum = c;
      if (q > maxSingle) maxSingle = q;
      if (!topBid || q > topBid.qty) topBid = { price: b.price, qty: q };
    }

    return {
      maxVolume: maxCum > 0n ? maxCum : 1n,
      maxSingleLevelVolume: maxSingle > 0n ? maxSingle : 1n,
      topResistanceWall: topAsk && topAsk.qty > 0n ? topAsk : null,
      topSupportWall: topBid && topBid.qty > 0n ? topBid : null,
    };
  }, [rawDisplayAsks, rawDisplayBids]);

  const displayAsks = useMemo<AggregatedLevel[]>(() => {
    return rawDisplayAsks.map(row => {
      const q = safeBigInt(row.qty);
      const density =
        maxSingleLevelVolume > 0n
          ? Math.min(100, Math.round(Number((q * 100n) / maxSingleLevelVolume)))
          : 0;
      const isTop = topResistanceWall !== null && row.price === topResistanceWall.price;
      const isWall = density >= 70 || isTop;
      return { ...row, densityPercent: density, isWall, isTopWall: isTop };
    });
  }, [rawDisplayAsks, maxSingleLevelVolume, topResistanceWall]);

  const displayBids = useMemo<AggregatedLevel[]>(() => {
    return rawDisplayBids.map(row => {
      const q = safeBigInt(row.qty);
      const density =
        maxSingleLevelVolume > 0n
          ? Math.min(100, Math.round(Number((q * 100n) / maxSingleLevelVolume)))
          : 0;
      const isTop = topSupportWall !== null && row.price === topSupportWall.price;
      const isWall = density >= 70 || isTop;
      return { ...row, densityPercent: density, isWall, isTopWall: isTop };
    });
  }, [rawDisplayBids, maxSingleLevelVolume, topSupportWall]);

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

  const getBucketUserOrderSummary = (
    bucketPrice: string,
    isAsk: boolean
  ): UserOrderSummary | null => {
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

  const renderAskRow = (row: AggregatedLevel, idx: number) => {
    const { price, qty, cumQty, orderCount, densityPercent, isWall, isTopWall } = row;
    const depthPercent =
      maxVolume > 0n ? Math.min(100, Number((safeBigInt(cumQty) * 100n) / maxVolume)) : 0;
    const userOrderSummary = getBucketUserOrderSummary(price, true);
    const isMyOrder = Boolean(userOrderSummary);

    return (
      <button
        key={`ask-${price}-${idx}`}
        type="button"
        onClick={() => onSelectPrice(price)}
        className={`relative grid grid-cols-3 px-3 py-0.5 text-xs font-mono tabular-nums text-right hover:bg-[#EA5B65]/12 transition-colors w-full cursor-pointer ${
          isMyOrder ? 'bg-[#EA5B65]/10 border-l-2 border-[#EA5B65]' : ''
        } ${
          showHeatmap && isTopWall
            ? 'border-r-2 border-[#D6A85C] bg-[#2C2415]/30'
            : showHeatmap && isWall
            ? 'border-r border-[#EA5B65]/60'
            : ''
        }`}
      >
        <div
          className="absolute right-0 top-0 bottom-0 bg-[#EA5B65]/10 pointer-events-none"
          style={{ width: `${depthPercent}%` }}
        />

        {showHeatmap && (
          <div
            className={`absolute right-0 top-0 bottom-0 pointer-events-none ${
              isTopWall
                ? 'bg-gradient-to-l from-[#D6A85C]/30 via-[#EA5B65]/25 to-transparent'
                : densityPercent >= 70
                ? 'bg-gradient-to-l from-[#EA5B65]/25 via-[#EA5B65]/12 to-transparent'
                : densityPercent >= 40
                ? 'bg-gradient-to-l from-[#EA5B65]/15 to-transparent'
                : 'bg-gradient-to-l from-[#EA5B65]/6 to-transparent'
            }`}
            style={{ width: `${densityPercent}%` }}
          />
        )}

        <div className="flex items-center gap-1.5 text-left relative z-10 overflow-hidden">
          <span className="font-semibold text-[#EA5B65] truncate">
            {formatQuotePrice(price, pair.quoteCurrency, pair.quoteDecimals)}
          </span>
          {isMyOrder && (
            <span className="text-[9px] px-1 rounded-[3px] bg-[#EA5B65] text-[#090D12] font-sans font-bold shrink-0">
              You
            </span>
          )}
          {showHeatmap && isTopWall && (
            <span className="text-[9px] px-1 rounded-[3px] bg-[#2C2415] text-[#D6A85C] border border-[#D6A85C]/40 font-sans font-semibold flex items-center gap-0.5 shrink-0">
              <Flame className="w-2.5 h-2.5" />
              <span>WALL</span>
            </span>
          )}
        </div>

        <div className="relative z-10 text-[#E4EBEF] flex items-center justify-end gap-1">
          <span>{formatCrypto(qty, pair.baseDecimals)}</span>
          {orderCount > 1 && (
            <span
              className="text-[9px] text-[#A1AFB8] bg-[#17212B] px-1 rounded border border-[#2B3944] font-sans"
              title={`${orderCount} orders aggregated`}
            >
              {orderCount}x
            </span>
          )}
        </div>

        <span className="text-[#71818B] relative z-10 text-right">
          {formatCrypto(cumQty, pair.baseDecimals)}
        </span>
      </button>
    );
  };

  const renderBidRow = (row: AggregatedLevel, idx: number) => {
    const { price, qty, cumQty, orderCount, densityPercent, isWall, isTopWall } = row;
    const depthPercent =
      maxVolume > 0n ? Math.min(100, Number((safeBigInt(cumQty) * 100n) / maxVolume)) : 0;
    const userOrderSummary = getBucketUserOrderSummary(price, false);
    const isMyOrder = Boolean(userOrderSummary);

    return (
      <button
        key={`bid-${price}-${idx}`}
        type="button"
        onClick={() => onSelectPrice(price)}
        className={`relative grid grid-cols-3 px-3 py-0.5 text-xs font-mono tabular-nums text-right hover:bg-[#16A879]/12 transition-colors w-full cursor-pointer ${
          isMyOrder ? 'bg-[#16A879]/10 border-l-2 border-[#16A879]' : ''
        } ${
          showHeatmap && isTopWall
            ? 'border-r-2 border-[#D6A85C] bg-[#2C2415]/30'
            : showHeatmap && isWall
            ? 'border-r border-[#16A879]/60'
            : ''
        }`}
      >
        <div
          className="absolute right-0 top-0 bottom-0 bg-[#16A879]/10 pointer-events-none"
          style={{ width: `${depthPercent}%` }}
        />

        {showHeatmap && (
          <div
            className={`absolute right-0 top-0 bottom-0 pointer-events-none ${
              isTopWall
                ? 'bg-gradient-to-l from-[#D6A85C]/30 via-[#16A879]/25 to-transparent'
                : densityPercent >= 70
                ? 'bg-gradient-to-l from-[#16A879]/25 via-[#16A879]/12 to-transparent'
                : densityPercent >= 40
                ? 'bg-gradient-to-l from-[#16A879]/15 to-transparent'
                : 'bg-gradient-to-l from-[#16A879]/6 to-transparent'
            }`}
            style={{ width: `${densityPercent}%` }}
          />
        )}

        <div className="flex items-center gap-1.5 text-left relative z-10 overflow-hidden">
          <span className="font-semibold text-[#16A879] truncate">
            {formatQuotePrice(price, pair.quoteCurrency, pair.quoteDecimals)}
          </span>
          {isMyOrder && (
            <span className="text-[9px] px-1 rounded-[3px] bg-[#16A879] text-[#090D12] font-sans font-bold shrink-0">
              You
            </span>
          )}
          {showHeatmap && isTopWall && (
            <span className="text-[9px] px-1 rounded-[3px] bg-[#2C2415] text-[#D6A85C] border border-[#D6A85C]/40 font-sans font-semibold flex items-center gap-0.5 shrink-0">
              <Flame className="w-2.5 h-2.5" />
              <span>WALL</span>
            </span>
          )}
        </div>

        <div className="relative z-10 text-[#E4EBEF] flex items-center justify-end gap-1">
          <span>{formatCrypto(qty, pair.baseDecimals)}</span>
          {orderCount > 1 && (
            <span
              className="text-[9px] text-[#A1AFB8] bg-[#17212B] px-1 rounded border border-[#2B3944] font-sans"
              title={`${orderCount} orders aggregated`}
            >
              {orderCount}x
            </span>
          )}
        </div>

        <span className="text-[#71818B] relative z-10 text-right">
          {formatCrypto(cumQty, pair.baseDecimals)}
        </span>
      </button>
    );
  };

  const renderSpreadBar = () => (
    <div className="flex items-center justify-between px-3 py-1.5 bg-[#111820] border-y border-[#202B34] text-xs font-mono tabular-nums shrink-0">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-sm text-[#E4EBEF]">
          {formatQuotePrice(pair.lastPrice, pair.quoteCurrency, pair.quoteDecimals)}
        </span>
        <span
          className={`text-[11px] font-semibold ${
            (pair.priceChange24h || '').startsWith('+') ||
            parseFloat(pair.priceChangePercent24h || pair.priceChange24h?.replace('+', '') || '0') >= 0
              ? 'text-[#16A879]'
              : 'text-[#EA5B65]'
          }`}
        >
          {pair.priceChange24h?.endsWith('%')
            ? pair.priceChange24h
            : `${pair.priceChange24h || '0.00'}%`}
        </span>
      </div>
      <div className="text-[11px] text-[#71818B]">
        <span>
          Spread: <strong className="text-[#A1AFB8]">{spreadFormatted}</strong>
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col bg-[#141C24] border border-[#202B34] rounded-[8px] overflow-hidden h-full">
      {/* Header Controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#202B34] bg-[#111820]">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-[#E4EBEF]">Order Book</h3>

          <div className="flex items-center bg-[#141C24] p-0.5 rounded-[6px] border border-[#202B34] gap-0.5">
            <button
              type="button"
              title="Bids & Asks"
              onClick={() => setViewMode('SPLIT')}
              className={`p-1 rounded-[4px] cursor-pointer ${
                viewMode === 'SPLIT' ? 'bg-[#1D2832] text-[#E4EBEF]' : 'text-[#71818B] hover:text-[#E4EBEF]'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="5" rx="1" fill="#EA5B65" />
                <rect x="2" y="9" width="12" height="5" rx="1" fill="#16A879" />
              </svg>
            </button>

            <button
              type="button"
              title="D3 Depth Curve"
              onClick={() => setViewMode('DEPTH_D3')}
              className={`p-1 rounded-[4px] cursor-pointer ${
                viewMode === 'DEPTH_D3' ? 'bg-[#1D2832] text-[#16A879]' : 'text-[#71818B] hover:text-[#16A879]'
              }`}
            >
              <AreaChartIcon className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              title="Hybrid View"
              onClick={() => setViewMode('HYBRID')}
              className={`p-1 rounded-[4px] cursor-pointer ${
                viewMode === 'HYBRID' ? 'bg-[#1D2832] text-[#8DA5B1]' : 'text-[#71818B] hover:text-[#8DA5B1]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              title="Bids Only"
              onClick={() => setViewMode('BIDS')}
              className={`p-1 rounded-[4px] cursor-pointer ${
                viewMode === 'BIDS' ? 'bg-[#1D2832]' : 'opacity-60 hover:opacity-100'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="3" rx="0.5" fill="#16A879" />
                <rect x="2" y="6.5" width="12" height="3" rx="0.5" fill="#16A879" />
                <rect x="2" y="11" width="12" height="3" rx="0.5" fill="#16A879" />
              </svg>
            </button>

            <button
              type="button"
              title="Asks Only"
              onClick={() => setViewMode('ASKS')}
              className={`p-1 rounded-[4px] cursor-pointer ${
                viewMode === 'ASKS' ? 'bg-[#1D2832]' : 'opacity-60 hover:opacity-100'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="3" rx="0.5" fill="#EA5B65" />
                <rect x="2" y="6.5" width="12" height="3" rx="0.5" fill="#EA5B65" />
                <rect x="2" y="11" width="12" height="3" rx="0.5" fill="#EA5B65" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleHeatmap}
            className={`flex items-center gap-1 px-2 py-1 rounded-[5px] text-[10px] font-medium border transition-colors cursor-pointer ${
              showHeatmap
                ? 'bg-[#2C2415] text-[#D6A85C] border-[#D6A85C]/40'
                : 'bg-[#141C24] text-[#71818B] border-[#202B34] hover:text-[#E4EBEF]'
            }`}
          >
            <Flame className="w-3 h-3" />
            <span>Heatmap</span>
          </button>

          {viewMode !== 'DEPTH_D3' && (
            <div className="flex items-center bg-[#141C24] p-0.5 rounded-[5px] border border-[#202B34] text-[10px] font-mono">
              {aggregationOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPrecision(opt.value)}
                  className={`px-1.5 py-0.5 rounded-[4px] font-semibold transition-colors cursor-pointer ${
                    precision === opt.value
                      ? 'bg-[#8DA5B1] text-[#090D12]'
                      : 'text-[#71818B] hover:text-[#E4EBEF]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tactical Wall Strip */}
      {showHeatmap && (topResistanceWall || topSupportWall) && viewMode !== 'DEPTH_D3' && (
        <div className="grid grid-cols-2 px-3 py-1 bg-[#090D12] border-b border-[#202B34] text-[10px] font-mono tabular-nums">
          <div className="flex items-center gap-1.5 overflow-hidden">
            <TrendingDown className="w-3 h-3 text-[#EA5B65] shrink-0" />
            {topResistanceWall ? (
              <button
                type="button"
                onClick={() => onSelectPrice(topResistanceWall.price)}
                className="flex items-center gap-1 text-[#EA5B65] hover:underline font-semibold truncate cursor-pointer"
              >
                <span>{formatQuotePrice(topResistanceWall.price, pair.quoteCurrency, pair.quoteDecimals)}</span>
                <span className="text-[#71818B] font-normal">
                  ({formatCrypto(topResistanceWall.qty.toString(), pair.baseDecimals)})
                </span>
              </button>
            ) : (
              <span className="text-[#53616A]">-</span>
            )}
          </div>

          <div className="flex items-center justify-end gap-1.5 overflow-hidden">
            <TrendingUp className="w-3 h-3 text-[#16A879] shrink-0" />
            {topSupportWall ? (
              <button
                type="button"
                onClick={() => onSelectPrice(topSupportWall.price)}
                className="flex items-center gap-1 text-[#16A879] hover:underline font-semibold truncate cursor-pointer"
              >
                <span>{formatQuotePrice(topSupportWall.price, pair.quoteCurrency, pair.quoteDecimals)}</span>
                <span className="text-[#71818B] font-normal">
                  ({formatCrypto(topSupportWall.qty.toString(), pair.baseDecimals)})
                </span>
              </button>
            ) : (
              <span className="text-[#53616A]">-</span>
            )}
          </div>
        </div>
      )}

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

      {viewMode === 'HYBRID' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="p-2 border-b border-[#202B34]">
            <D3DepthChart
              pair={pair}
              depth={depth}
              myOpenOrderPrices={myOpenOrderPrices}
              onSelectPrice={onSelectPrice}
              height={170}
              compact
            />
          </div>
          <div className="grid grid-cols-3 px-3 py-1 text-[10px] text-[#71818B] font-medium border-b border-[#202B34] bg-[#111820]/60">
            <span className="text-left">Price ({pair.quoteCurrency})</span>
            <span className="text-right">Size ({pair.baseCurrency})</span>
            <span className="text-right">Total</span>
          </div>
          <div
            ref={asksContainerRef}
            className="flex-1 overflow-y-auto max-h-[140px] py-1 space-y-px"
            style={{ overscrollBehavior: 'contain' }}
          >
            {displayAsks.slice(-15).map((row, idx) => renderAskRow(row, idx))}
          </div>
          {renderSpreadBar()}
          <div
            className="flex-1 overflow-y-auto max-h-[140px] py-1 space-y-px"
            style={{ overscrollBehavior: 'contain' }}
          >
            {displayBids.slice(0, 15).map((row, idx) => renderBidRow(row, idx))}
          </div>
        </div>
      )}

      {viewMode !== 'DEPTH_D3' && viewMode !== 'HYBRID' && (
        <div className="grid grid-cols-3 px-3 py-1.5 text-[11px] text-[#71818B] font-medium border-b border-[#202B34] bg-[#111820]/60">
          <span className="text-left">Price ({pair.quoteCurrency})</span>
          <span className="text-right">Size ({pair.baseCurrency})</span>
          <span className="text-right">Total</span>
        </div>
      )}

      {viewMode === 'SPLIT' && (
        <>
          <div
            ref={asksContainerRef}
            className="flex-1 overflow-y-auto max-h-[220px] py-1 space-y-px"
            style={{ overscrollBehavior: 'contain' }}
          >
            {displayAsks.length === 0 && (
              <div className="py-6 text-center text-[11px] text-[#71818B] font-mono">
                No open ask orders
              </div>
            )}
            {displayAsks.map((row, idx) => renderAskRow(row, idx))}
          </div>
          {renderSpreadBar()}
          <div
            className="flex-1 overflow-y-auto max-h-[220px] py-1 space-y-px"
            style={{ overscrollBehavior: 'contain' }}
          >
            {displayBids.length === 0 && (
              <div className="py-6 text-center text-[11px] text-[#71818B] font-mono">
                No open bid orders
              </div>
            )}
            {displayBids.map((row, idx) => renderBidRow(row, idx))}
          </div>
        </>
      )}

      {viewMode === 'ASKS' && (
        <div className="flex flex-col flex-1">
          <div
            ref={asksContainerRef}
            className="flex-1 overflow-y-auto max-h-[440px] py-1 space-y-px"
            style={{ overscrollBehavior: 'contain' }}
          >
            {displayAsks.length === 0 && (
              <div className="py-12 text-center text-[11px] text-[#71818B] font-mono">
                No open ask orders
              </div>
            )}
            {displayAsks.map((row, idx) => renderAskRow(row, idx))}
          </div>
          {renderSpreadBar()}
        </div>
      )}

      {viewMode === 'BIDS' && (
        <div className="flex flex-col flex-1">
          {renderSpreadBar()}
          <div
            className="flex-1 overflow-y-auto max-h-[440px] py-1 space-y-px"
            style={{ overscrollBehavior: 'contain' }}
          >
            {displayBids.length === 0 && (
              <div className="py-12 text-center text-[11px] text-[#71818B] font-mono">
                No open bid orders
              </div>
            )}
            {displayBids.map((row, idx) => renderBidRow(row, idx))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-1.5 bg-[#090D12] border-t border-[#202B34] text-[10px] text-[#71818B] font-mono">
        <span>
          {displayAsks.length} Asks · {displayBids.length} Bids
        </span>
        <span className="text-[#A1AFB8]">
          {precision === 'exact' ? 'Exact Precision' : `Grouped (${precision})`}
        </span>
      </div>
    </div>
  );
};
