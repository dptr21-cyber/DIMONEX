/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * TradingChart.tsx
 * Professional Dual-Engine Trading Chart Terminal for DIMONEX.
 * 
 * Engine Modes:
 * 1. DIMONEX Pro: Powered by Lightweight Charts v5 with dynamic MA7/MA25,
 *    sub-panel volume histogram, and external market benchmark overlay.
 * 2. TradingView Advanced: Powered by official TradingView Widget & DIMONEX Datafeed API
 *    (IBasicDataFeed) grounded in authoritative matched trades.
 * 
 * STRICT COMPLIANCE:
 * - NO fake SVG/CSS candlestick mock renderer.
 * - 100% real trade executions and persistent kline aggregations.
 * - Clean architecture split: DimonexChart, TradingViewChart, dimonexDatafeed, chartTypes.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TradingPairItem, TradeItem } from '../../types/index.js';
import { formatIDR, formatCrypto, formatQuotePrice, formatPairVolume } from '../../lib/formatters.js';
import { ChartMode, Timeframe } from './chartTypes.js';
import { DimonexChart } from './DimonexChart.js';
import { TradingViewChart } from './TradingViewChart.js';

interface TradingChartProps {
  pair: TradingPairItem;
  recentTrades: TradeItem[];
}

export const TradingChart: React.FC<TradingChartProps> = ({ pair, recentTrades }) => {
  // Chart Mode State (persisted to localStorage)
  const [chartMode, setChartModeState] = useState<ChartMode>(() => {
    const saved = localStorage.getItem('dominex_chart_mode');
    return saved === 'TRADINGVIEW' ? 'TRADINGVIEW' : 'DOMINEX';
  });

  const setChartMode = (mode: ChartMode) => {
    setChartModeState(mode);
    localStorage.setItem('dominex_chart_mode', mode);
  };

  // Timeframe State (persisted to localStorage)
  const [timeframe, setTimeframeState] = useState<Timeframe>(() => {
    const saved = localStorage.getItem('dominex_chart_timeframe');
    if (saved && ['1m', '5m', '15m', '1h', '4h', '1d', '1w'].includes(saved)) {
      return saved as Timeframe;
    }
    return '15m';
  });

  const setTimeframe = (tf: Timeframe) => {
    setTimeframeState(tf);
    localStorage.setItem('dominex_chart_timeframe', tf);
  };

  // Indicator Toggles
  const [showMAs, setShowMAsState] = useState<boolean>(() => {
    return localStorage.getItem('dimonex_chart_mas') !== 'false';
  });

  const setShowMAs = (updater: boolean | ((prev: boolean) => boolean)) => {
    setShowMAsState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      localStorage.setItem('dimonex_chart_mas', String(next));
      return next;
    });
  };

  // External Reference Price Benchmark Overlay state
  const [showRefBenchmark, setShowRefBenchmarkState] = useState<boolean>(() => {
    return localStorage.getItem('dimonex_chart_ref_benchmark') === 'true';
  });

  const setShowRefBenchmark = (updater: boolean | ((prev: boolean) => boolean)) => {
    setShowRefBenchmarkState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      localStorage.setItem('dimonex_chart_ref_benchmark', String(next));
      return next;
    });
  };

  const [refPriceData, setRefPriceData] = useState<any>(null);

  // Fetch external reference benchmark
  useEffect(() => {
    let isMounted = true;
    const fetchRefPrice = async () => {
      try {
        const res = await fetch(`/api/trading/reference-price/${pair.id}`);
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          const data = await res.json();
          if (isMounted) setRefPriceData(data);
        }
      } catch (e) {
        // quiet fallback
      }
    };

    fetchRefPrice();
    const interval = setInterval(fetchRefPrice, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [pair.id]);

  const isUp = parseFloat(pair.priceChangePercent24h || pair.priceChange24h?.replace('+', '') || '0') >= 0;

  // Calculate total base 24h volume
  const baseVolumeStr = useMemo(() => {
    try {
      const volUnits = BigInt(pair.volume24h || '0');
      const dec = pair.baseDecimals || 8;
      const divisor = 10n ** BigInt(dec);
      const whole = volUnits / divisor;
      const rem = volUnits % divisor;
      const decPart = rem.toString().padStart(dec, '0').slice(0, 4);
      return `${whole.toLocaleString('id-ID')}.${decPart}`;
    } catch {
      return '0.0000';
    }
  }, [pair.volume24h, pair.baseDecimals]);

  return (
    <div className="flex flex-col h-full bg-[#08090D] border border-white/5 rounded-xl overflow-hidden shadow-2xl">
      {/* Chart Top Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#0D1017] border-b border-white/10">
        {/* Left: Pair Info & 24h Ticker Stats */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-heading font-bold text-sm tracking-wide text-[#F5F5F7]">
              {pair.baseCurrency}/{pair.quoteCurrency}
            </span>
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
              pair.quoteCurrency === 'USDT'
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
            }`}>
              {pair.quoteCurrency}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-[#9298A6] border border-white/10">
              SPOT
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className={`text-base font-mono font-bold tracking-tight ${isUp ? 'text-[#16C784]' : 'text-[#EA3943]'}`}>
              {formatQuotePrice(pair.lastPrice, pair.quoteCurrency, pair.quoteDecimals, true)}
            </span>
            <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${
              isUp ? 'bg-[#16C784]/15 text-[#16C784]' : 'bg-[#EA3943]/15 text-[#EA3943]'
            }`}>
              {pair.priceChange24h?.endsWith('%') ? pair.priceChange24h : `${pair.priceChange24h || '0.00'}%`}
            </span>
          </div>

          {/* 24h Stats */}
          <div className="hidden lg:flex items-center gap-4 text-xs text-[#9298A6] border-l border-white/10 pl-4">
            <div>
              <span className="text-[10px] text-[#9298A6]/70 block uppercase">24h Tertinggi</span>
              <span className="font-mono text-[#F5F5F7]">{formatQuotePrice(pair.high24h, pair.quoteCurrency, pair.quoteDecimals, true)}</span>
            </div>
            <div>
              <span className="text-[10px] text-[#9298A6]/70 block uppercase">24h Terendah</span>
              <span className="font-mono text-[#F5F5F7]">{formatQuotePrice(pair.low24h, pair.quoteCurrency, pair.quoteDecimals, true)}</span>
            </div>
            <div>
              <span className="text-[10px] text-[#9298A6]/70 block uppercase">24h Vol ({pair.baseCurrency})</span>
              <span className="font-mono text-[#F5F5F7]">{baseVolumeStr}</span>
            </div>
            <div>
              <span className="text-[10px] text-[#9298A6]/70 block uppercase">24h Vol ({pair.quoteCurrency})</span>
              <span className="font-mono text-[#F5F5F7]">{formatPairVolume(pair.quoteVolume24h || '0', pair.quoteCurrency, pair.quoteDecimals)}</span>
            </div>
          </div>
        </div>

        {/* Right: Engine Selector, Timeframe, & Indicator Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Engine Selector */}
          <div className="flex items-center bg-[#08090D] p-0.5 rounded-lg border border-white/10">
            <button
              onClick={() => setChartMode('DOMINEX')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
                chartMode === 'DOMINEX'
                  ? 'bg-[#171923] text-[#F5F5F7] font-bold border border-white/10 shadow-sm'
                  : 'text-[#9298A6] hover:text-[#F5F5F7]'
              }`}
            >
              DOMINEX Pro
            </button>
            <button
              onClick={() => setChartMode('TRADINGVIEW')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
                chartMode === 'TRADINGVIEW'
                  ? 'bg-[#171923] text-[#F5F5F7] font-bold border border-white/10 shadow-sm'
                  : 'text-[#9298A6] hover:text-[#F5F5F7]'
              }`}
            >
              TradingView
            </button>
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center bg-[#08090D] p-0.5 rounded-lg border border-white/10">
            {(['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const).map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-1 text-xs font-mono font-bold rounded-md transition-all ${
                  timeframe === tf
                    ? 'bg-[#FF087F] text-white shadow-sm'
                    : 'text-[#9298A6] hover:text-[#F5F5F7]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* DIMONEX Pro Specific Tools */}
          {chartMode === 'DOMINEX' && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowMAs(!showMAs)}
                title="Toggle Moving Averages (MA 7 / MA 25)"
                className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all ${
                  showMAs
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : 'bg-[#171923] text-[#9298A6] border-white/10 hover:text-white'
                }`}
              >
                MA (7, 25)
              </button>

              <button
                onClick={() => setShowRefBenchmark(!showRefBenchmark)}
                title="Toggle External Reference Benchmark (Binance & Bybit Aggregated)"
                className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all flex items-center gap-1.5 ${
                  showRefBenchmark
                    ? 'bg-sky-500/20 text-sky-400 border-sky-500/40 shadow-sm'
                    : 'bg-[#171923] text-[#9298A6] border-white/10 hover:text-white'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${showRefBenchmark ? 'bg-sky-400 animate-pulse' : 'bg-slate-500'}`} />
                <span>Ext Ref</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* External Reference Price Benchmark Live Strip */}
      {showRefBenchmark && refPriceData && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 bg-sky-950/25 border-b border-sky-800/30 text-xs font-mono text-slate-300">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 text-[10px] font-bold">
              BENCHMARK {refPriceData.activeProvider?.toUpperCase()}
            </span>
            <span>
              Ref: <strong className="text-white">Rp {refPriceData.effectiveIdrPrice?.toLocaleString()}</strong>
            </span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-400 text-[11px]">
              ${refPriceData.effectiveUsdtPrice?.toLocaleString()} USDT × Rp {refPriceData.fxRateUsed?.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            {refPriceData.binancePrice && (
              <span className="text-slate-400">Binance: <span className="text-slate-200">${refPriceData.binancePrice.toLocaleString()}</span></span>
            )}
            {refPriceData.bybitPrice && (
              <span className="text-slate-400">Bybit: <span className="text-slate-200">${refPriceData.bybitPrice.toLocaleString()}</span></span>
            )}
            <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
              refPriceData.status === 'ACTIVE' ? 'bg-[#16C784]/20 text-[#16C784]' : 'bg-amber-500/20 text-amber-400'
            }`}>
              {refPriceData.status}
            </span>
          </div>
        </div>
      )}

      {/* Main Active Engine Canvas */}
      <div className="relative flex-1 w-full min-h-[420px]">
        {chartMode === 'DOMINEX' ? (
          <DimonexChart
            pair={pair}
            recentTrades={recentTrades}
            timeframe={timeframe}
            setTimeframe={setTimeframe}
            showMAs={showMAs}
            setShowMAs={setShowMAs}
            showRefBenchmark={showRefBenchmark}
            setShowRefBenchmark={setShowRefBenchmark}
            refPriceData={refPriceData}
          />
        ) : (
          <TradingViewChart
            pair={pair}
            recentTrades={recentTrades}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            onFallbackToPro={() => setChartMode('DOMINEX')}
          />
        )}
      </div>
    </div>
  );
};
