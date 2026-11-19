/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TradingChart.tsx
 * Professional Dual-Engine Trading Chart Terminal for DIMONEX Obsidian Iridium.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { TradingPairItem, TradeItem } from '../../types/index.js';
import { formatQuotePrice, formatPairVolume } from '../../lib/formatters.js';
import { ChartMode, Timeframe } from './chartTypes.js';
import { DimonexChart } from './DimonexChart.js';
import { TradingViewChart } from './TradingViewChart.js';
import { StatusBadge } from '../ui/StatusBadge.js';

interface TradingChartProps {
  pair: TradingPairItem;
  recentTrades: TradeItem[];
}

export const TradingChart: React.FC<TradingChartProps> = ({ pair, recentTrades }) => {
  const [chartMode, setChartModeState] = useState<ChartMode>(() => {
    const saved = localStorage.getItem('dimonex_chart_mode') || localStorage.getItem('dominex_chart_mode');
    return saved === 'TRADINGVIEW' ? 'TRADINGVIEW' : 'DIMONEX';
  });

  const setChartMode = (mode: ChartMode) => {
    setChartModeState(mode);
    localStorage.setItem('dimonex_chart_mode', mode);
  };

  const [timeframe, setTimeframeState] = useState<Timeframe>(() => {
    const saved = localStorage.getItem('dimonex_chart_timeframe') || localStorage.getItem('dominex_chart_timeframe');
    if (saved && ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1D', '1w', '1W', '1M'].includes(saved)) {
      return saved as Timeframe;
    }
    return '15m';
  });

  const setTimeframe = (tf: Timeframe) => {
    setTimeframeState(tf);
    localStorage.setItem('dimonex_chart_timeframe', tf);
  };

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

  useEffect(() => {
    let isMounted = true;
    const fetchRefPrice = async () => {
      try {
        const res = await fetch(`/api/trading/reference-price/${pair.id}`);
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          const data = await res.json();
          if (isMounted) setRefPriceData(data);
        }
      } catch {
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
    <div className="flex flex-col h-full bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
      {/* Chart Top Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-[#111820] border-b border-[#202B34]">
        {/* Left: Pair Info & 24h Ticker Stats */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm tracking-tight text-[#E4EBEF]">
              {pair.baseCurrency}/{pair.quoteCurrency}
            </span>
            <StatusBadge tone={pair.quoteCurrency === 'USDT' ? 'buy' : 'info'}>
              {pair.quoteCurrency}
            </StatusBadge>
            <StatusBadge tone="neutral">SPOT</StatusBadge>
          </div>

          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className={`text-base font-semibold tracking-tight ${isUp ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
              {formatQuotePrice(pair.lastPrice, pair.quoteCurrency, pair.quoteDecimals, true)}
            </span>
            <span
              className={`text-[11px] font-medium px-1.5 py-0.5 rounded-[5px] border ${
                isUp
                  ? 'bg-[#12392F] text-[#16A879] border-[#16A879]/30'
                  : 'bg-[#401F27] text-[#EA5B65] border-[#EA5B65]/30'
              }`}
            >
              {pair.priceChange24h?.endsWith('%') ? pair.priceChange24h : `${pair.priceChange24h || '0.00'}%`}
            </span>
          </div>

          {/* 24h Stats */}
          <div className="hidden lg:flex items-center gap-4 text-xs text-[#71818B] border-l border-[#202B34] pl-4 font-mono tabular-nums">
            <div>
              <span className="text-[10px] font-sans text-[#71818B] block uppercase tracking-wider">24h High</span>
              <span className="text-[#E4EBEF]">{formatQuotePrice(pair.high24h, pair.quoteCurrency, pair.quoteDecimals, true)}</span>
            </div>
            <div>
              <span className="text-[10px] font-sans text-[#71818B] block uppercase tracking-wider">24h Low</span>
              <span className="text-[#E4EBEF]">{formatQuotePrice(pair.low24h, pair.quoteCurrency, pair.quoteDecimals, true)}</span>
            </div>
            <div>
              <span className="text-[10px] font-sans text-[#71818B] block uppercase tracking-wider">24h Vol ({pair.baseCurrency})</span>
              <span className="text-[#E4EBEF]">{baseVolumeStr}</span>
            </div>
            <div>
              <span className="text-[10px] font-sans text-[#71818B] block uppercase tracking-wider">24h Vol ({pair.quoteCurrency})</span>
              <span className="text-[#E4EBEF]">{formatPairVolume(pair.quoteVolume24h || '0', pair.quoteCurrency, pair.quoteDecimals)}</span>
            </div>
          </div>
        </div>

        {/* Right: Engine Selector, Timeframe, & Indicator Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Engine Selector */}
          <div className="flex items-center bg-[#090D12] p-0.5 rounded-[7px] border border-[#202B34]">
            <button
              type="button"
              onClick={() => setChartMode('DIMONEX')}
              className={`px-2.5 py-1 text-xs font-medium rounded-[5px] transition-colors whitespace-nowrap cursor-pointer ${
                chartMode === 'DIMONEX'
                  ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border border-[#2B3944]'
                  : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
              }`}
            >
              DIMONEX Pro
            </button>
            <button
              type="button"
              onClick={() => setChartMode('TRADINGVIEW')}
              className={`px-2.5 py-1 text-xs font-medium rounded-[5px] transition-colors whitespace-nowrap cursor-pointer ${
                chartMode === 'TRADINGVIEW'
                  ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border border-[#2B3944]'
                  : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
              }`}
            >
              TradingView
            </button>
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center bg-[#090D12] p-0.5 rounded-[7px] border border-[#202B34] relative font-mono tabular-nums">
            {(['1m', '5m', '15m', '1h', '4h', '1D', '1W'] as const).map(tf => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf as Timeframe)}
                className={`px-2 py-1 text-xs font-medium rounded-[5px] transition-colors cursor-pointer ${
                  timeframe === tf
                    ? 'bg-[#8DA5B1] text-[#090D12] font-semibold'
                    : 'text-[#71818B] hover:text-[#E4EBEF]'
                }`}
              >
                {tf}
              </button>
            ))}

            <div className="relative group">
              <button
                type="button"
                className={`px-2 py-1 text-xs font-medium rounded-[5px] transition-colors flex items-center gap-1 cursor-pointer ${
                  ['3m', '30m', '2h', '6h', '12h', '1M'].includes(timeframe)
                    ? 'bg-[#8DA5B1] text-[#090D12] font-semibold'
                    : 'text-[#71818B] hover:text-[#E4EBEF]'
                }`}
              >
                <span>{['3m', '30m', '2h', '6h', '12h', '1M'].includes(timeframe) ? timeframe : '▾'}</span>
              </button>

              <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col bg-[#17212B] border border-[#2B3944] rounded-[7px] shadow-lg p-1 z-50 min-w-[72px]">
                {(['3m', '30m', '2h', '6h', '12h', '1M'] as const).map(extTf => (
                  <button
                    key={extTf}
                    type="button"
                    onClick={() => setTimeframe(extTf as Timeframe)}
                    className={`px-3 py-1.5 text-xs font-mono text-left rounded-[5px] transition-colors cursor-pointer ${
                      timeframe === extTf
                        ? 'text-[#090D12] font-semibold bg-[#8DA5B1]'
                        : 'text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#222F3A]'
                    }`}
                  >
                    {extTf}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* DIMONEX Pro Specific Tools */}
          {chartMode === 'DIMONEX' && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowMAs(!showMAs)}
                title="Toggle Moving Averages (MA 7 / MA 25)"
                className={`px-2.5 py-1 text-xs font-medium rounded-[7px] border transition-colors cursor-pointer ${
                  showMAs
                    ? 'bg-[#2C2415] text-[#D6A85C] border-[#D6A85C]/40'
                    : 'bg-[#17212B] text-[#71818B] border-[#2B3944] hover:text-[#E4EBEF]'
                }`}
              >
                MA (7, 25)
              </button>

              <button
                type="button"
                onClick={() => setShowRefBenchmark(!showRefBenchmark)}
                title="Toggle External Reference Benchmark (Binance & Bybit Aggregated)"
                className={`px-2.5 py-1 text-xs font-medium rounded-[7px] border transition-colors flex items-center gap-1.5 cursor-pointer ${
                  showRefBenchmark
                    ? 'bg-[#162436] text-[#6D9FE8] border-[#6D9FE8]/40'
                    : 'bg-[#17212B] text-[#71818B] border-[#2B3944] hover:text-[#E4EBEF]'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${showRefBenchmark ? 'bg-[#6D9FE8]' : 'bg-[#71818B]'}`} />
                <span>Ext Ref</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* External Reference Price Benchmark Live Strip */}
      {showRefBenchmark && refPriceData && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 bg-[#162436]/50 border-b border-[#202B34] text-xs font-mono tabular-nums text-[#A1AFB8]">
          <div className="flex items-center gap-2">
            <StatusBadge tone="info">BENCHMARK {refPriceData.activeProvider?.toUpperCase()}</StatusBadge>
            <span>
              Ref: <strong className="text-[#E4EBEF]">Rp {refPriceData.effectiveIdrPrice?.toLocaleString()}</strong>
            </span>
            <span className="text-[#40515D]">|</span>
            <span className="text-[#71818B] text-[11px]">
              ${refPriceData.effectiveUsdtPrice?.toLocaleString()} USDT × Rp {refPriceData.fxRateUsed?.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            {refPriceData.binancePrice && (
              <span className="text-[#71818B]">
                Binance: <span className="text-[#E4EBEF]">${refPriceData.binancePrice.toLocaleString()}</span>
              </span>
            )}
            {refPriceData.bybitPrice && (
              <span className="text-[#71818B]">
                Bybit: <span className="text-[#E4EBEF]">${refPriceData.bybitPrice.toLocaleString()}</span>
              </span>
            )}
            <StatusBadge tone={refPriceData.status === 'ACTIVE' ? 'buy' : 'warning'}>
              {refPriceData.status}
            </StatusBadge>
          </div>
        </div>
      )}

      {/* Main Active Engine Canvas */}
      <div className="relative flex-1 w-full min-h-[420px]">
        {chartMode === 'DIMONEX' ? (
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
            onFallbackToPro={() => setChartMode('DIMONEX')}
          />
        )}
      </div>
    </div>
  );
};
