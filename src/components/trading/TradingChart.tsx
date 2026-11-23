/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TradingChart.tsx
 * Professional Dual-Engine & Multi-Chart Trading Terminal for DIMONEX Obsidian Iridium.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { LayoutGrid } from 'lucide-react';
import { TradingPairItem, TradeItem, OrderItem, UserProfile } from '../../types/index.js';
import { formatQuotePrice, formatPairVolume } from '../../lib/formatters.js';
import {
  ChartMode,
  ChartSeriesType,
  MultiChartLayoutCount,
  MultiChartPaneConfig,
  Timeframe,
} from './chartTypes.js';
import { DimonexChart, CHART_TYPE_LABELS } from './DimonexChart.js';
import { TradingViewChart } from './TradingViewChart.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { MarketCountdownOverlay } from './MarketCountdownOverlay.js';

interface TradingChartProps {
  pair: TradingPairItem;
  recentTrades: TradeItem[];
  onRefreshMarkets?: () => void;
  canvasMinHeightClass?: string;
  allPairs?: TradingPairItem[];
  openOrders?: OrderItem[];
  user?: UserProfile | null;
}

export const ALL_SUPPORTED_TIMEFRAMES: Timeframe[] = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '12h',
  '1D',
  '1W',
  '1M',
];

const QUICK_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1D', '1W'];
const MORE_TIMEFRAMES: Timeframe[] = ['3m', '30m', '2h', '6h', '12h', '1M'];

export const TradingChart: React.FC<TradingChartProps> = ({
  pair,
  recentTrades,
  onRefreshMarkets,
  canvasMinHeightClass = 'min-h-[420px]',
  allPairs = [],
  openOrders = [],
  user = null,
}) => {
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
    if (saved && ALL_SUPPORTED_TIMEFRAMES.includes(saved as Timeframe)) {
      return saved as Timeframe;
    }
    return '15m';
  });

  const setTimeframe = (tf: Timeframe) => {
    setTimeframeState(tf);
    localStorage.setItem('dimonex_chart_timeframe', tf);
  };

  const [showMoreTf, setShowMoreTf] = useState(false);

  const [layoutCount, setLayoutCountState] = useState<MultiChartLayoutCount>(() => {
    const raw = localStorage.getItem('dimonex_chart_layout_count');
    return raw === '2' ? 2 : raw === '4' ? 4 : 1;
  });

  const setLayoutCount = (count: MultiChartLayoutCount) => {
    setLayoutCountState(count);
    localStorage.setItem('dimonex_chart_layout_count', String(count));
  };

  const availablePairs = useMemo(() => {
    if (allPairs.length > 0) return allPairs;
    return [pair];
  }, [allPairs, pair]);

  const [paneConfigs, setPaneConfigs] = useState<MultiChartPaneConfig[]>(() => {
    try {
      const raw = localStorage.getItem('dimonex_chart_panes_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 4) return parsed;
      }
    } catch {}
    return [
      { id: 'pane-0', pairId: pair.id, timeframe: '15m', chartType: 'CANDLESTICK' },
      { id: 'pane-1', pairId: availablePairs[1]?.id || pair.id, timeframe: '1h', chartType: 'CANDLESTICK' },
      { id: 'pane-2', pairId: availablePairs[2]?.id || pair.id, timeframe: '4h', chartType: 'AREA' },
      { id: 'pane-3', pairId: availablePairs[3]?.id || pair.id, timeframe: '1D', chartType: 'HEIKIN_ASHI' },
    ];
  });

  useEffect(() => {
    setPaneConfigs(prev => {
      const next = prev.map((p, idx) => (idx === 0 ? { ...p, pairId: pair.id, timeframe } : p));
      try {
        localStorage.setItem('dimonex_chart_panes_v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [pair.id, timeframe]);

  const updatePaneConfig = (paneIdx: number, patch: Partial<MultiChartPaneConfig>) => {
    setPaneConfigs(prev => {
      const next = prev.map((p, idx) => (idx === paneIdx ? { ...p, ...patch } : p));
      try {
        localStorage.setItem('dimonex_chart_panes_v1', JSON.stringify(next));
      } catch {}
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
      } catch {}
    };

    fetchRefPrice();
    const interval = setInterval(fetchRefPrice, 15000);
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
            <AssetIcon symbol={pair.baseCurrency} logoUrl={pair.baseLogoUrl || undefined} size="xs" />
            <span className="font-semibold text-sm tracking-tight text-[#E4EBEF]">
              {pair.baseCurrency}/{pair.quoteCurrency}
            </span>
            <StatusBadge tone={pair.quoteCurrency === 'USDT' ? 'buy' : 'info'}>
              {pair.quoteCurrency}
            </StatusBadge>
            <StatusBadge tone="neutral">SPOT</StatusBadge>
            {pair.isDelisted ? (
              <StatusBadge tone="danger" dot>DELISTED</StatusBadge>
            ) : pair.delistScheduledAt && pair.delistScheduledAt > Date.now() ? (
              <StatusBadge tone="danger" dot>DELISTING</StatusBadge>
            ) : !pair.isActive && pair.scheduledAt && pair.scheduledAt > Date.now() ? (
              <StatusBadge tone="warning" dot>SCHEDULED</StatusBadge>
            ) : pair.isHalted ? (
              <StatusBadge tone="danger">HALTED</StatusBadge>
            ) : null}
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

        {/* Right: Engine Selector, 13 Timeframes, Multi-Chart Layout, & Benchmark */}
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

          {/* All 13 Verified Timeframes Selector */}
          <div className="flex items-center bg-[#090D12] p-0.5 rounded-[7px] border border-[#202B34] relative font-mono tabular-nums">
            {QUICK_TIMEFRAMES.map(tf => (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  setTimeframe(tf);
                  setShowMoreTf(false);
                }}
                className={`px-2 py-1 text-xs font-medium rounded-[5px] transition-colors cursor-pointer ${
                  timeframe === tf
                    ? 'bg-[#8DA5B1] text-[#090D12] font-semibold'
                    : 'text-[#71818B] hover:text-[#E4EBEF]'
                }`}
              >
                {tf}
              </button>
            ))}

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMoreTf(v => !v)}
                className={`px-2 py-1 text-xs font-medium rounded-[5px] transition-colors flex items-center gap-1 cursor-pointer ${
                  MORE_TIMEFRAMES.includes(timeframe)
                    ? 'bg-[#8DA5B1] text-[#090D12] font-semibold'
                    : 'text-[#71818B] hover:text-[#E4EBEF]'
                }`}
              >
                <span>{MORE_TIMEFRAMES.includes(timeframe) ? timeframe : 'More ▾'}</span>
              </button>

              {showMoreTf && (
                <div className="absolute right-0 top-full mt-1 flex flex-col bg-[#17212B] border border-[#2B3944] rounded-[7px] shadow-xl p-1 z-50 min-w-[78px]">
                  {MORE_TIMEFRAMES.map(extTf => (
                    <button
                      key={extTf}
                      type="button"
                      onClick={() => {
                        setTimeframe(extTf);
                        setShowMoreTf(false);
                      }}
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
              )}
            </div>
          </div>

          {/* Multi-Chart Layout Selector (1 | 2 | 4) */}
          {chartMode === 'DIMONEX' && (
            <div className="flex items-center bg-[#090D12] p-0.5 rounded-[7px] border border-[#202B34] font-mono">
              <span className="px-1.5 text-[#71818B]" title="Multi-Chart Layout">
                <LayoutGrid className="w-3.5 h-3.5" />
              </span>
              {([1, 2, 4] as MultiChartLayoutCount[]).map(cnt => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setLayoutCount(cnt)}
                  title={`${cnt} Chart Pane${cnt > 1 ? 's' : ''}`}
                  className={`px-2 py-1 text-xs font-medium rounded-[5px] transition-colors cursor-pointer ${
                    layoutCount === cnt
                      ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border border-[#2B3944]'
                      : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
                  }`}
                >
                  {cnt}
                </button>
              ))}
            </div>
          )}

          {/* External Ref Toggle */}
          {chartMode === 'DIMONEX' && (
            <button
              type="button"
              onClick={() => setShowRefBenchmark(!showRefBenchmark)}
              title="Toggle External Reference Benchmark"
              className={`px-2.5 py-1 text-xs font-medium rounded-[7px] border transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                showRefBenchmark
                  ? 'bg-[#162436] text-[#6D9FE8] border-[#6D9FE8]/40'
                  : 'bg-[#17212B] text-[#71818B] border-[#2B3944] hover:text-[#E4EBEF]'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${showRefBenchmark ? 'bg-[#6D9FE8]' : 'bg-[#71818B]'}`} />
              <span>Ext Ref</span>
            </button>
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

      {/* Scheduled Delisting Non-Blocking Warning Banner */}
      <MarketCountdownOverlay
        pair={pair}
        mode="BANNER"
        onCountdownComplete={onRefreshMarkets}
      />

      {/* Main Active Engine Canvas */}
      <div className={`relative flex-1 w-full transition-[min-height] duration-150 ${canvasMinHeightClass}`}>
        {chartMode === 'TRADINGVIEW' ? (
          <TradingViewChart
            pair={pair}
            recentTrades={recentTrades}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            onFallbackToPro={() => setChartMode('DIMONEX')}
          />
        ) : layoutCount === 1 ? (
          <DimonexChart
            pair={pair}
            recentTrades={recentTrades}
            timeframe={timeframe}
            setTimeframe={setTimeframe}
            showRefBenchmark={showRefBenchmark}
            setShowRefBenchmark={setShowRefBenchmark}
            refPriceData={refPriceData}
            openOrders={openOrders}
            user={user}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 p-1.5 bg-[#090D12] w-full h-full">
            {paneConfigs.slice(0, layoutCount).map((paneCfg, idx) => {
              const panePair = availablePairs.find(p => p.id === paneCfg.pairId) || pair;
              return (
                <div
                  key={paneCfg.id}
                  className="flex flex-col border border-[#202B34] rounded-[8px] overflow-hidden bg-[#090D12] min-h-[320px]"
                >
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1 bg-[#141C24] border-b border-[#202B34] text-[11px] font-mono">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#71818B]">#{idx + 1}</span>
                      <select
                        value={panePair.id}
                        onChange={e => updatePaneConfig(idx, { pairId: e.target.value })}
                        className="bg-[#090D12] border border-[#2B3944] rounded-[4px] px-1.5 py-0.5 text-[#E4EBEF] text-[11px]"
                      >
                        {availablePairs.map(ap => (
                          <option key={ap.id} value={ap.id}>
                            {ap.id}
                          </option>
                        ))}
                      </select>
                      <select
                        value={paneCfg.timeframe}
                        onChange={e => updatePaneConfig(idx, { timeframe: e.target.value as Timeframe })}
                        className="bg-[#090D12] border border-[#2B3944] rounded-[4px] px-1.5 py-0.5 text-[#E4EBEF] text-[11px]"
                      >
                        {ALL_SUPPORTED_TIMEFRAMES.map(tf => (
                          <option key={tf} value={tf}>
                            {tf}
                          </option>
                        ))}
                      </select>
                    </div>
                    <select
                      value={paneCfg.chartType}
                      onChange={e => updatePaneConfig(idx, { chartType: e.target.value as ChartSeriesType })}
                      className="bg-[#090D12] border border-[#2B3944] rounded-[4px] px-1.5 py-0.5 text-[#A1AFB8] text-[11px]"
                    >
                      {CHART_TYPE_LABELS.map(ct => (
                        <option key={ct.id} value={ct.id}>
                          {ct.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-h-[280px]">
                    <DimonexChart
                      pair={panePair}
                      recentTrades={recentTrades}
                      timeframe={paneCfg.timeframe}
                      setTimeframe={tf => updatePaneConfig(idx, { timeframe: tf })}
                      chartType={paneCfg.chartType}
                      onChartTypeChange={ct => updatePaneConfig(idx, { chartType: ct })}
                      showRefBenchmark={idx === 0 ? showRefBenchmark : false}
                      setShowRefBenchmark={idx === 0 ? setShowRefBenchmark : undefined}
                      refPriceData={idx === 0 ? refPriceData : null}
                      openOrders={openOrders}
                      user={user}
                      compact
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Scheduled Initial Listing Countdown or Post-Delisting Overlay */}
        <MarketCountdownOverlay
          pair={pair}
          mode="OVERLAY"
          onCountdownComplete={onRefreshMarkets}
        />
      </div>
    </div>
  );
};
