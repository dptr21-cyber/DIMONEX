/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HftBacktestSection.tsx
 * Deterministic Historical Ledger Backtesting Workbench for Smart HFT Ladder Configurations.
 * Simulates historical execution strictly read-only against immutable TRADE_SETTLEMENT
 * JournalTransactions, LedgerEntries, historical trades, and OHLCV candles prior to deployment.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import {
  Play,
  Database,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Activity,
  RefreshCw,
  Sliders,
  Layers,
  History,
  ArrowRight,
  GitCompare,
  AlertTriangle,
  Copy,
} from 'lucide-react';
import { safeFetchJson } from '../../lib/safeFetch.js';
import {
  BacktestDataSourceMode,
  BacktestDatasetPairInfo,
  BacktestRequest,
  BacktestResult,
  BotInstance,
  EquityCurvePoint,
  PatternFormationType,
  PatternTimeframe,
  TradingPairItem,
} from '../../types/index.js';
import { Button } from '../ui/Button.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { PanelHeader } from '../ui/PanelHeader.js';
import { SegmentedTabs } from '../ui/Tabs.js';

interface Props {
  tradingPairs: TradingPairItem[];
  instances: BotInstance[];
  initialPreset?: Partial<BacktestRequest> | null;
  onApplyPresetToDeploy?: (preset: BacktestRequest) => void;
  onSetFeedback: (msg: { type: 'success' | 'error'; text: string } | null) => void;
}

const PATTERN_GROUPS: { group: string; items: { value: PatternFormationType; label: string }[] }[] = [
  {
    group: 'Reversal Patterns',
    items: [
      { value: 'HEAD_AND_SHOULDERS', label: 'Head & Shoulders' },
      { value: 'INVERSE_HEAD_AND_SHOULDERS', label: 'Inverse Head & Shoulders' },
      { value: 'DOUBLE_TOP', label: 'Double Top (M)' },
      { value: 'TRIPLE_TOP', label: 'Triple Top' },
      { value: 'DOUBLE_BOTTOM', label: 'Double Bottom (W)' },
      { value: 'TRIPLE_BOTTOM', label: 'Triple Bottom' },
    ],
  },
  {
    group: 'Continuation Patterns',
    items: [
      { value: 'BULLISH_FLAG', label: 'Bullish Flag' },
      { value: 'BEARISH_FLAG', label: 'Bearish Flag' },
      { value: 'PENNANT', label: 'Pennant' },
      { value: 'CUP_AND_HANDLE', label: 'Cup & Handle' },
      { value: 'RECTANGLE', label: 'Rectangle Channel' },
    ],
  },
  {
    group: 'Bilateral / Neutral Patterns',
    items: [
      { value: 'ASCENDING_TRIANGLE', label: 'Ascending Triangle' },
      { value: 'DESCENDING_TRIANGLE', label: 'Descending Triangle' },
      { value: 'SYMMETRICAL_TRIANGLE', label: 'Symmetrical Triangle' },
    ],
  },
];

function formatQuoteVal(val: number, quoteCurrency: string): string {
  if (!Number.isFinite(val)) return '0';
  if (quoteCurrency === 'IDR') {
    return new Intl.NumberFormat('id-ID', {
      maximumFractionDigits: Math.abs(val) < 1000 ? 2 : 0,
    }).format(val);
  }
  const abs = Math.abs(val);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(val);
}

function formatBaseVal(val: number): string {
  if (!Number.isFinite(val)) return '0';
  const abs = Math.abs(val);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(val);
}

function formatShortTs(ts: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('id-ID', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const HftBacktestSection: React.FC<Props> = ({
  tradingPairs,
  instances,
  initialPreset,
  onApplyPresetToDeploy,
  onSetFeedback,
}) => {
  // Configuration Form State
  const [pairId, setPairId] = useState<string>(() => tradingPairs[0]?.id || 'BTC-IDR');
  const [dataSourceMode, setDataSourceMode] = useState<BacktestDataSourceMode>('LEDGER_SETTLED_TRADES');
  const [timeWindowPreset, setTimeWindowPreset] = useState<'ALL' | '24H' | '7D' | '30D'>('ALL');
  const [timeframe, setTimeframe] = useState<PatternTimeframe>('15m');
  const [klineTimeframe, setKlineTimeframe] = useState<string>('15m');
  const [pattern, setPattern] = useState<PatternFormationType>('HEAD_AND_SHOULDERS');
  const [totalOrders, setTotalOrders] = useState<number>(40);
  const [boundPct, setBoundPct] = useState<number>(3);
  const [minBound, setMinBound] = useState<string>('');
  const [maxBound, setMaxBound] = useState<string>('');
  const [minSpreadBps, setMinSpreadBps] = useState<number>(25);
  const [minBuyLot, setMinBuyLot] = useState<string>('0.02');
  const [maxBuyLot, setMaxBuyLot] = useState<string>('0.50');
  const [minSellLot, setMinSellLot] = useState<string>('0.02');
  const [maxSellLot, setMaxSellLot] = useState<string>('0.50');
  const [repriceIntervalMs, setRepriceIntervalMs] = useState<number>(4000);
  const [initialBaseBalance, setInitialBaseBalance] = useState<string>('1');
  const [initialQuoteBalance, setInitialQuoteBalance] = useState<string>('150000000');
  const [makerFeeBps, setMakerFeeBps] = useState<number>(-2);
  const [slippageBps, setSlippageBps] = useState<number>(0);
  const [runLabel, setRunLabel] = useState<string>('');

  // Datasets & Execution State
  const [datasetsPairs, setDatasetsPairs] = useState<BacktestDatasetPairInfo[]>([]);
  const [globalLedgerSummary, setGlobalLedgerSummary] = useState<{
    totalTrades: number;
    totalSettlementJournals: number;
    totalLedgerEntries: number;
    totalJournalTransactions: number;
  } | null>(null);
  const [isLoadingDatasets, setIsLoadingDatasets] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [runError, setRunError] = useState<string | null>(null);

  // Results & History
  const [activeResult, setActiveResult] = useState<BacktestResult | null>(null);
  const [history, setHistory] = useState<BacktestResult[]>([]);
  const [compareRunId, setCompareRunId] = useState<string>('');
  const [fillFilter, setFillFilter] = useState<'ALL' | 'BUY' | 'SELL' | 'LEDGER_VERIFIED'>('ALL');
  const [hoverPoint, setHoverPoint] = useState<EquityCurvePoint | null>(null);

  // Chart Refs
  const equitySvgRef = useRef<SVGSVGElement | null>(null);
  const priceOverlaySvgRef = useRef<SVGSVGElement | null>(null);
  const rungBarSvgRef = useRef<SVGSVGElement | null>(null);

  const smartHftBots = useMemo(() => instances.filter(b => b.botType === 'SMART_HFT_LADDER'), [instances]);

  const selectedDatasetInfo = useMemo(() => {
    return datasetsPairs.find(p => p.pairId === pairId) || null;
  }, [datasetsPairs, pairId]);

  // Apply incoming preset from SmartHftLadderSection if provided
  useEffect(() => {
    if (!initialPreset) return;
    if (initialPreset.pairId) setPairId(initialPreset.pairId);
    if (initialPreset.timeframe) setTimeframe(initialPreset.timeframe);
    if (initialPreset.pattern) setPattern(initialPreset.pattern);
    if (initialPreset.total_orders) setTotalOrders(initialPreset.total_orders);
    if (initialPreset.bound_percentage !== undefined) setBoundPct(initialPreset.bound_percentage);
    if (initialPreset.min_price_bound !== undefined) setMinBound(initialPreset.min_price_bound);
    if (initialPreset.max_price_bound !== undefined) setMaxBound(initialPreset.max_price_bound);
    if (initialPreset.min_spread_bps !== undefined) setMinSpreadBps(initialPreset.min_spread_bps);
    if (initialPreset.min_buy_lot) setMinBuyLot(initialPreset.min_buy_lot);
    if (initialPreset.max_buy_lot) setMaxBuyLot(initialPreset.max_buy_lot);
    if (initialPreset.min_sell_lot) setMinSellLot(initialPreset.min_sell_lot);
    if (initialPreset.max_sell_lot) setMaxSellLot(initialPreset.max_sell_lot);
    if (initialPreset.reprice_interval_ms) setRepriceIntervalMs(initialPreset.reprice_interval_ms);
    if (initialPreset.label) setRunLabel(initialPreset.label);
  }, [initialPreset]);

  const fetchDatasetsAndHistory = useCallback(async (targetPairId: string) => {
    setIsLoadingDatasets(true);
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const [dsRes, histRes] = await Promise.all([
        safeFetchJson<any>(`/api/mm/smart-hft/backtest/datasets?pairId=${encodeURIComponent(targetPairId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        safeFetchJson<any>('/api/mm/smart-hft/backtest/history', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (dsRes.ok && dsRes.data?.success) {
        setDatasetsPairs(dsRes.data.pairs || []);
        setGlobalLedgerSummary(dsRes.data.globalLedgerSummary || null);
        const sel: BacktestDatasetPairInfo | null = dsRes.data.selected;
        if (sel) {
          setInitialBaseBalance(sel.suggestedInitialBase);
          setInitialQuoteBalance(sel.suggestedInitialQuote);
          if (sel.journalVerifiedTrades === 0 && sel.totalTrades > 0 && dataSourceMode === 'LEDGER_SETTLED_TRADES') {
            setDataSourceMode('ALL_HISTORICAL_TRADES');
          } else if (sel.totalTrades === 0 && sel.klineCandles15m > 0) {
            setDataSourceMode('KLINE_OHLCV_REPLAY');
          }
        }
      }

      if (histRes.ok && histRes.data?.success && Array.isArray(histRes.data.history)) {
        setHistory(histRes.data.history);
        if (!activeResult && histRes.data.history.length > 0) {
          setActiveResult(histRes.data.history[0]);
        }
      }
    } catch {
      // ignore transient network errors on initial load
    } finally {
      setIsLoadingDatasets(false);
    }
  }, []);

  useEffect(() => {
    fetchDatasetsAndHistory(pairId);
  }, [pairId, fetchDatasetsAndHistory]);

  const handleLoadBotPreset = (botId: string) => {
    const bot = smartHftBots.find(b => b.id === botId);
    if (!bot || !bot.smartHftConfig) return;
    const cfg = bot.smartHftConfig;
    setPairId(bot.pairId);
    setTimeframe(cfg.timeframe);
    setPattern(cfg.pattern);
    setTotalOrders(Number(cfg.total_orders ?? 40));
    if (cfg.bound_percentage !== undefined) setBoundPct(Number(cfg.bound_percentage));
    setMinBound(cfg.min_price_bound !== undefined && cfg.min_price_bound !== null ? String(cfg.min_price_bound) : '');
    setMaxBound(cfg.max_price_bound !== undefined && cfg.max_price_bound !== null ? String(cfg.max_price_bound) : '');
    setMinBuyLot(String(cfg.min_buy_lot ?? '0.02'));
    setMaxBuyLot(String(cfg.max_buy_lot ?? '0.50'));
    setMinSellLot(String(cfg.min_sell_lot ?? '0.02'));
    setMaxSellLot(String(cfg.max_sell_lot ?? '0.50'));
    setMinSpreadBps(Number(cfg.min_spread_bps ?? 25));
    setRepriceIntervalMs(Number(cfg.reprice_interval_ms ?? 4000));
    setRunLabel(`Audit ${bot.name}`);
    onSetFeedback({ type: 'success', text: `Parameter dari bot "${bot.name}" dimuat ke Backtesting Workbench.` });
  };

  const buildCurrentRequest = (): BacktestRequest => {
    const now = Date.now();
    let startTime: number | undefined;
    if (timeWindowPreset === '24H') startTime = now - 24 * 3600 * 1000;
    else if (timeWindowPreset === '7D') startTime = now - 7 * 24 * 3600 * 1000;
    else if (timeWindowPreset === '30D') startTime = now - 30 * 24 * 3600 * 1000;

    return {
      pairId,
      dataSourceMode,
      startTime,
      initialBaseBalance,
      initialQuoteBalance,
      makerFeeBps,
      takerFeeBps: 10,
      slippageBps,
      timeframe,
      pattern,
      total_orders: totalOrders,
      bound_percentage: minBound.trim() && maxBound.trim() ? undefined : boundPct,
      min_price_bound: minBound.trim() || undefined,
      max_price_bound: maxBound.trim() || undefined,
      min_buy_lot: minBuyLot,
      max_buy_lot: maxBuyLot,
      min_sell_lot: minSellLot,
      max_sell_lot: maxSellLot,
      min_spread_bps: minSpreadBps,
      spread_percentage: minSpreadBps / 100,
      reprice_interval_ms: repriceIntervalMs,
      klineTimeframe: dataSourceMode === 'KLINE_OHLCV_REPLAY' ? klineTimeframe : undefined,
      label: runLabel.trim() || `${pairId} · ${pattern} · ${totalOrders}x`,
    };
  };

  const handleRunBacktest = async () => {
    setIsRunning(true);
    setRunError(null);
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const payload = buildCurrentRequest();
      const res = await safeFetchJson<any>('/api/mm/smart-hft/backtest/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok && res.data?.success && res.data.result) {
        const result: BacktestResult = res.data.result;
        setActiveResult(result);
        setHistory(prev => [result, ...prev.filter(h => h.runId !== result.runId)].slice(0, 25));
        onSetFeedback({
          type: 'success',
          text: `Backtest selesai (${result.executionTimeMs}ms) · ${result.summary.totalFills} fills tersimulasi pada ${result.ledgerAudit.replayedEventsCount} event ledger.`,
        });
      } else {
        const errMsg = res.data?.error || 'Backtest gagal dijalankan.';
        setRunError(errMsg);
        onSetFeedback({ type: 'error', text: errMsg });
      }
    } catch (err: any) {
      setRunError(err.message);
      onSetFeedback({ type: 'error', text: err.message });
    } finally {
      setIsRunning(false);
    }
  };

  const handleApplyToDeploy = () => {
    if (!onApplyPresetToDeploy) return;
    const req = buildCurrentRequest();
    onApplyPresetToDeploy(req);
  };

  // Comparison Run lookup
  const compareResult = useMemo(() => {
    if (!compareRunId) return null;
    return history.find(h => h.runId === compareRunId) || null;
  }, [compareRunId, history]);

  // Filtered audit fills
  const filteredFills = useMemo(() => {
    if (!activeResult) return [];
    const list = [...activeResult.fills].reverse();
    if (fillFilter === 'BUY') return list.filter(f => f.side === 'BUY');
    if (fillFilter === 'SELL') return list.filter(f => f.side === 'SELL');
    if (fillFilter === 'LEDGER_VERIFIED') return list.filter(f => f.ledgerVerified);
    return list;
  }, [activeResult, fillFilter]);

  // =========================================================================
  // D3 CHART 1: EQUITY CURVE + DRAWDOWN % SYNCHRONIZED SVG (Obsidian Iridium)
  // =========================================================================
  useEffect(() => {
    const svgEl = equitySvgRef.current;
    if (!svgEl || !activeResult || activeResult.equityCurve.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 760;
    const margin = { top: 16, right: 56, bottom: 26, left: 68 };
    const innerW = width - margin.left - margin.right;
    const eqH = 148;
    const ddTop = 172;
    const ddH = 62;

    const points = activeResult.equityCurve;
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleLinear()
      .domain([0, Math.max(1, points.length - 1)])
      .range([0, innerW]);

    const eqVals = points.map(p => p.equityQuote);
    const minEq = Math.min(activeResult.summary.initialEquityQuote, ...eqVals);
    const maxEq = Math.max(activeResult.summary.initialEquityQuote, ...eqVals);
    const eqPad = Math.max((maxEq - minEq) * 0.15, activeResult.summary.initialEquityQuote * 0.002);

    const yEq = d3
      .scaleLinear()
      .domain([minEq - eqPad, maxEq + eqPad])
      .range([eqH, 0]);

    const maxDd = Math.max(1, d3.max(points, p => p.drawdownPct) || 1);
    const yDd = d3
      .scaleLinear()
      .domain([0, maxDd * 1.15])
      .range([0, ddH]);

    // Grid lines
    g.append('g')
      .selectAll('line')
      .data(yEq.ticks(4))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', d => yEq(d))
      .attr('y2', d => yEq(d))
      .attr('stroke', '#202B34')
      .attr('stroke-dasharray', '2,3');

    // Baseline Initial Equity line
    const baseEqY = yEq(activeResult.summary.initialEquityQuote);
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', baseEqY)
      .attr('y2', baseEqY)
      .attr('stroke', '#71818B')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');

    const isPositive = activeResult.summary.netPnlQuote >= 0;
    const eqColor = isPositive ? '#16A879' : '#EA5B65';

    const defs = svg.append('defs');
    const eqGrad = defs
      .append('linearGradient')
      .attr('id', 'bt-eq-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    eqGrad.append('stop').attr('offset', '0%').attr('stop-color', eqColor).attr('stop-opacity', 0.24);
    eqGrad.append('stop').attr('offset', '100%').attr('stop-color', eqColor).attr('stop-opacity', 0.02);

    const eqArea = d3
      .area<EquityCurvePoint>()
      .x((_, i) => xScale(i))
      .y0(eqH)
      .y1(d => yEq(d.equityQuote))
      .curve(d3.curveMonotoneX);

    const eqLine = d3
      .line<EquityCurvePoint>()
      .x((_, i) => xScale(i))
      .y(d => yEq(d.equityQuote))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(points).attr('fill', 'url(#bt-eq-grad)').attr('d', eqArea);
    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', eqColor)
      .attr('stroke-width', 2)
      .attr('d', eqLine);

    // Drawdown section separator + area
    g.append('line').attr('x1', 0).attr('x2', innerW).attr('y1', ddTop).attr('y2', ddTop).attr('stroke', '#2B3944');

    const ddArea = d3
      .area<EquityCurvePoint>()
      .x((_, i) => xScale(i))
      .y0(ddTop)
      .y1(d => ddTop + yDd(d.drawdownPct))
      .curve(d3.curveStepAfter);

    g.append('path')
      .datum(points)
      .attr('fill', 'rgba(234, 91, 101, 0.22)')
      .attr('stroke', '#EA5B65')
      .attr('stroke-width', 1.2)
      .attr('d', ddArea);

    // Y Axis Equity (Left)
    const yAxisEq = d3.axisLeft(yEq).ticks(4).tickFormat(d => {
      const n = Number(d);
      if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
      if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return n.toFixed(0);
    });
    g.append('g')
      .call(yAxisEq)
      .selectAll('text')
      .attr('fill', '#71818B')
      .attr('font-size', '10px')
      .attr('font-family', '"IBM Plex Mono", monospace');

    // Y Axis Drawdown (Right)
    const yAxisDd = d3.axisRight(yDd).ticks(2).tickFormat(d => `-${Number(d).toFixed(1)}%`);
    g.append('g')
      .attr('transform', `translate(${innerW},${ddTop})`)
      .call(yAxisDd)
      .selectAll('text')
      .attr('fill', '#EA5B65')
      .attr('font-size', '9px')
      .attr('font-family', '"IBM Plex Mono", monospace');

    g.selectAll('.domain, .tick line').attr('stroke', '#2B3944');

    // Labels
    g.append('text')
      .attr('x', 4)
      .attr('y', 11)
      .attr('fill', '#71818B')
      .attr('font-size', '9px')
      .attr('font-family', '"IBM Plex Mono", monospace')
      .text(`EQUITY (${activeResult.quoteCurrency})`);

    g.append('text')
      .attr('x', 4)
      .attr('y', ddTop + 12)
      .attr('fill', '#EA5B65')
      .attr('font-size', '9px')
      .attr('font-family', '"IBM Plex Mono", monospace')
      .text('DRAWDOWN (%)');

    // Hover focus crosshair
    const focusLine = g
      .append('line')
      .attr('y1', 0)
      .attr('y2', ddTop + ddH)
      .attr('stroke', '#8DA5B1')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .style('opacity', 0);

    const focusDot = g
      .append('circle')
      .attr('r', 4)
      .attr('fill', '#C1D0D6')
      .attr('stroke', '#090D12')
      .attr('stroke-width', 1.5)
      .style('opacity', 0);

    g.append('rect')
      .attr('width', innerW)
      .attr('height', ddTop + ddH)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', event => {
        const [mx] = d3.pointer(event);
        const idx = Math.max(0, Math.min(points.length - 1, Math.round(xScale.invert(mx))));
        const pt = points[idx];
        if (!pt) return;
        const cx = xScale(idx);
        focusLine.attr('x1', cx).attr('x2', cx).style('opacity', 1);
        focusDot.attr('cx', cx).attr('cy', yEq(pt.equityQuote)).style('opacity', 1);
        setHoverPoint(pt);
      })
      .on('mouseleave', () => {
        focusLine.style('opacity', 0);
        focusDot.style('opacity', 0);
        setHoverPoint(null);
      });
  }, [activeResult]);

  // =========================================================================
  // D3 CHART 2: PRICE TRAJECTORY + BOUNDS + SIMULATED FILL MARKERS
  // =========================================================================
  useEffect(() => {
    const svgEl = priceOverlaySvgRef.current;
    if (!svgEl || !activeResult || activeResult.equityCurve.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 760;
    const height = 230;
    const margin = { top: 14, right: 20, bottom: 24, left: 68 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const points = activeResult.equityCurve;
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const tsStart = activeResult.ledgerAudit.timeRangeStart;
    const tsEnd = Math.max(tsStart + 1, activeResult.ledgerAudit.timeRangeEnd);

    const xScale = d3.scaleLinear().domain([tsStart, tsEnd]).range([0, innerW]);

    const allPrices = points.flatMap(p => [p.marketPrice, p.minBound, p.maxBound]).filter(v => v > 0);
    const minP = d3.min(allPrices) || 0;
    const maxP = d3.max(allPrices) || 1;
    const padP = Math.max((maxP - minP) * 0.08, maxP * 0.002);

    const yScale = d3.scaleLinear().domain([Math.max(0, minP - padP), maxP + padP]).range([innerH, 0]);

    // Safe Guard Bound Envelope (Min - Max)
    const boundArea = d3
      .area<EquityCurvePoint>()
      .x(d => xScale(d.timestamp))
      .y0(d => yScale(d.minBound))
      .y1(d => yScale(d.maxBound));

    g.append('path').datum(points).attr('fill', 'rgba(141, 165, 177, 0.08)').attr('d', boundArea);

    const maxBoundLine = d3.line<EquityCurvePoint>().x(d => xScale(d.timestamp)).y(d => yScale(d.maxBound));
    const minBoundLine = d3.line<EquityCurvePoint>().x(d => xScale(d.timestamp)).y(d => yScale(d.minBound));
    const anchorLine = d3.line<EquityCurvePoint>().x(d => xScale(d.timestamp)).y(d => yScale(d.anchorPrice));
    const marketLine = d3.line<EquityCurvePoint>().x(d => xScale(d.timestamp)).y(d => yScale(d.marketPrice));

    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', '#EA5B65')
      .attr('stroke-opacity', 0.45)
      .attr('stroke-dasharray', '3,3')
      .attr('d', maxBoundLine);
    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', '#16A879')
      .attr('stroke-opacity', 0.45)
      .attr('stroke-dasharray', '3,3')
      .attr('d', minBoundLine);
    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', '#D6A85C')
      .attr('stroke-width', 1.2)
      .attr('stroke-opacity', 0.85)
      .attr('d', anchorLine);
    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', '#8DA5B1')
      .attr('stroke-width', 1.8)
      .attr('d', marketLine);

    // Plot simulated BUY and SELL fill markers
    const fills = activeResult.fills;
    g.selectAll('path.fill-marker')
      .data(fills)
      .join('path')
      .attr('class', 'fill-marker')
      .attr('transform', d => `translate(${xScale(d.timestamp)},${yScale(d.fillPrice)})`)
      .attr('d', d => {
        const size = 4.5;
        return d.side === 'BUY'
          ? `M0,${-size} L${size},${size} L${-size},${size} Z`
          : `M0,${size} L${size},${-size} L${-size},${-size} Z`;
      })
      .attr('fill', d => (d.side === 'BUY' ? '#16A879' : '#EA5B65'))
      .attr('stroke', '#090D12')
      .attr('stroke-width', 0.8);

    const yAxis = d3.axisLeft(yScale).ticks(4).tickFormat(d => {
      const n = Number(d);
      if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return n.toFixed(2);
    });
    g.append('g')
      .call(yAxis)
      .selectAll('text')
      .attr('fill', '#71818B')
      .attr('font-size', '10px')
      .attr('font-family', '"IBM Plex Mono", monospace');

    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d => {
      return new Date(Number(d)).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    });
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', '#71818B')
      .attr('font-size', '9px')
      .attr('font-family', '"IBM Plex Mono", monospace');

    g.selectAll('.domain, .tick line').attr('stroke', '#2B3944');
  }, [activeResult]);

  // =========================================================================
  // D3 CHART 3: LADDER RUNG HIT DISTRIBUTION (BUY L1..LN vs SELL L1..LN)
  // =========================================================================
  useEffect(() => {
    const svgEl = rungBarSvgRef.current;
    if (!svgEl || !activeResult) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const stats = activeResult.rungHitDistribution;
    if (stats.length === 0) return;

    const width = 420;
    const height = 220;
    const margin = { top: 14, right: 16, bottom: 28, left: 36 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const levels = Array.from(new Set(stats.map(s => s.level)))
      .sort((a, b) => a - b)
      .slice(0, 20);
    const xScale = d3.scaleBand<number>().domain(levels).range([0, innerW]).padding(0.22);
    const maxHits = Math.max(1, d3.max(stats, s => s.hits) || 1);
    const yScale = d3.scaleLinear().domain([0, maxHits]).range([innerH, 0]);

    const halfW = Math.max(2, xScale.bandwidth() / 2);

    levels.forEach(lvl => {
      const buy = stats.find(s => s.level === lvl && s.side === 'BUY');
      const sell = stats.find(s => s.level === lvl && s.side === 'SELL');
      const xPos = xScale(lvl) || 0;

      if (buy && buy.hits > 0) {
        g.append('rect')
          .attr('x', xPos)
          .attr('y', yScale(buy.hits))
          .attr('width', halfW)
          .attr('height', innerH - yScale(buy.hits))
          .attr('fill', '#16A879')
          .attr('rx', 1);
      }

      if (sell && sell.hits > 0) {
        g.append('rect')
          .attr('x', xPos + halfW)
          .attr('y', yScale(sell.hits))
          .attr('width', halfW)
          .attr('height', innerH - yScale(sell.hits))
          .attr('fill', '#EA5B65')
          .attr('rx', 1);
      }
    });

    g.append('g')
      .call(d3.axisLeft(yScale).ticks(4).tickFormat(d3.format('d')))
      .selectAll('text')
      .attr('fill', '#71818B')
      .attr('font-size', '9px')
      .attr('font-family', '"IBM Plex Mono", monospace');

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(xScale).tickFormat(d => `L${d}`))
      .selectAll('text')
      .attr('fill', '#71818B')
      .attr('font-size', '8px')
      .attr('font-family', '"IBM Plex Mono", monospace');

    g.selectAll('.domain, .tick line').attr('stroke', '#2B3944');
  }, [activeResult]);

  return (
    <div className="flex flex-col gap-5">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5 bg-[#141C24] border border-[#202B34] rounded-[10px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <Database className="w-4 h-4 text-[#8DA5B1] shrink-0" />
            <h2 className="text-sm sm:text-base font-semibold text-[#E4EBEF] tracking-tight">
              Immutable Ledger HFT Backtesting Engine
            </h2>
            <StatusBadge tone="success">READ-ONLY · DETERMINISTIC</StatusBadge>
          </div>
          <p className="text-xs text-[#A1AFB8] mt-1.5 max-w-3xl leading-relaxed">
            Simulasikan konfigurasi Smart HFT Ladder terhadap catatan{' '}
            <span className="font-mono text-[#E4EBEF]">TRADE_SETTLEMENT</span> journal, ledger entries, dan histori
            trade riil sebelum deploy ke live matching engine.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fetchDatasetsAndHistory(pairId)}
            disabled={isLoadingDatasets}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${isLoadingDatasets ? 'animate-spin' : ''}`} />}
          >
            Sync Ledger
          </Button>

          {activeResult && onApplyPresetToDeploy && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleApplyToDeploy}
              icon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Terapkan ke Smart HFT Bot
            </Button>
          )}

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleRunBacktest}
            isLoading={isRunning}
            icon={<Play className="w-3.5 h-3.5 fill-current" />}
          >
            {isRunning ? 'Menjalankan Simulasi...' : 'Jalankan Backtest'}
          </Button>
        </div>
      </div>

      {/* Main Two-Column Workbench: Configurator (Left) + Results (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: Configuration Panel */}
        <div className="xl:col-span-4 bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
          <PanelHeader
            icon={<Sliders className="w-4 h-4" />}
            title="Parameter Uji Backtest"
            actions={
              smartHftBots.length > 0 ? (
                <select
                  value=""
                  onChange={e => e.target.value && handleLoadBotPreset(e.target.value)}
                  aria-label="Impor preset dari bot aktif"
                  className="bg-[#111820] text-[11px] text-[#C1D0D6] border border-[#2B3944] rounded-[7px] px-2 py-1 max-w-[165px] outline-none"
                >
                  <option value="">Impor dari Bot ({smartHftBots.length})...</option>
                  {smartHftBots.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.pairId})
                    </option>
                  ))}
                </select>
              ) : undefined
            }
          />

          <div className="p-4 flex flex-col gap-4">
            {/* Dataset Availability Banner for Selected Pair */}
            {selectedDatasetInfo && (
              <div className="p-3 bg-[#111820] border border-[#202B34] rounded-[7px] text-[11px] flex flex-col gap-1">
                <div className="flex items-center justify-between text-[#E4EBEF] font-medium">
                  <span>Ketersediaan Data ({selectedDatasetInfo.pairId})</span>
                  <span className="font-mono tabular-nums text-[#8DA5B1]">
                    {selectedDatasetInfo.journalVerifiedTrades} Journal
                  </span>
                </div>
                <div className="text-[#71818B] font-mono tabular-nums flex flex-wrap gap-x-2">
                  <span>{selectedDatasetInfo.totalTrades} Trades</span>
                  <span>·</span>
                  <span>{selectedDatasetInfo.klineCandles15m} Candles (15m)</span>
                </div>
                {dataSourceMode === 'LEDGER_SETTLED_TRADES' && selectedDatasetInfo.journalVerifiedTrades === 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-[#202B34] flex items-center justify-between text-[#D6A85C]">
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      Belum ada settlement journal di pair ini.
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setDataSourceMode(
                          selectedDatasetInfo.totalTrades > 0 ? 'ALL_HISTORICAL_TRADES' : 'KLINE_OHLCV_REPLAY'
                        )
                      }
                      className="underline font-semibold text-[#8DA5B1] hover:text-[#C1D0D6] shrink-0 cursor-pointer"
                    >
                      Alihkan Mode
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Pair & Data Source Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Trading Pair</label>
                <select
                  value={pairId}
                  onChange={e => setPairId(e.target.value)}
                  className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-2 text-xs text-[#E4EBEF] font-mono outline-none"
                >
                  {tradingPairs.map(p => {
                    const ds = datasetsPairs.find(d => d.pairId === p.id);
                    return (
                      <option key={p.id} value={p.id}>
                        {p.id} {ds ? `(${ds.totalTrades}t / ${ds.journalVerifiedTrades}j)` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Rentang Waktu Histori</label>
                <div className="grid grid-cols-4 gap-1 bg-[#111820] p-0.5 rounded-[7px] border border-[#202B34]">
                  {(['ALL', '24H', '7D', '30D'] as const).map(w => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setTimeWindowPreset(w)}
                      className={`py-1.5 text-[11px] font-mono rounded-[5px] transition-colors cursor-pointer ${
                        timeWindowPreset === w
                          ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border border-[#2B3944]'
                          : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Sumber Data Ledger</label>
              <select
                value={dataSourceMode}
                onChange={e => setDataSourceMode(e.target.value as BacktestDataSourceMode)}
                className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-2 text-xs text-[#E4EBEF] outline-none"
              >
                <option value="LEDGER_SETTLED_TRADES">
                  1. Immutable TRADE_SETTLEMENT Ledger Journals (Audit Strict)
                </option>
                <option value="ALL_HISTORICAL_TRADES">2. All Persisted Historical Trades (Full Tick Replay)</option>
                <option value="KLINE_OHLCV_REPLAY">3. Historical OHLCV Candle Intra-Bar Replay (4 Ticks/Bar)</option>
              </select>
            </div>

            {dataSourceMode === 'KLINE_OHLCV_REPLAY' && (
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Interval Candle Sumber</label>
                <div className="grid grid-cols-4 gap-1">
                  {['5m', '15m', '1h', '4h'].map(tf => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setKlineTimeframe(tf)}
                      className={`py-1 text-xs font-mono rounded-[5px] border transition-colors cursor-pointer ${
                        klineTimeframe === tf
                          ? 'bg-[#1D2832] border-[#8DA5B1] text-[#E4EBEF] font-semibold'
                          : 'bg-[#111820] border-[#2B3944] text-[#71818B] hover:text-[#E4EBEF]'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Pattern & Timeframe */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#202B34]">
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Formasi Pola (Modul A)</label>
                <select
                  value={pattern}
                  onChange={e => setPattern(e.target.value as PatternFormationType)}
                  className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-2 text-xs text-[#C1D0D6] font-medium outline-none"
                >
                  {PATTERN_GROUPS.map(grp => (
                    <optgroup key={grp.group} label={grp.group}>
                      {grp.items.map(it => (
                        <option key={it.value} value={it.value}>
                          {it.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Anchor Timeframe</label>
                <div className="grid grid-cols-4 gap-1 bg-[#111820] p-0.5 rounded-[7px] border border-[#202B34]">
                  {(['5m', '15m', '1h', '4h'] as PatternTimeframe[]).map(tf => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setTimeframe(tf)}
                      className={`py-1.5 text-[11px] font-mono rounded-[5px] transition-colors cursor-pointer ${
                        timeframe === tf
                          ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border border-[#2B3944]'
                          : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
                      }`}
                    >
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Ladder Geometry (Modul B) */}
            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Total Orders</label>
                <input
                  type="number"
                  min={2}
                  max={100}
                  step={2}
                  value={totalOrders}
                  onChange={e => setTotalOrders(Math.max(2, Math.min(100, Number(e.target.value) || 40)))}
                  className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF] outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Bound ± (%)</label>
                <input
                  type="number"
                  min={0.5}
                  max={50}
                  step={0.5}
                  value={boundPct}
                  onChange={e => setBoundPct(Math.max(0.5, Number(e.target.value) || 3))}
                  className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF] outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Spread (bps)</label>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={minSpreadBps}
                  onChange={e => setMinSpreadBps(Math.max(1, Number(e.target.value) || 25))}
                  className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF] outline-none"
                />
              </div>
            </div>

            {/* Optional Hard Custom Min/Max Bounds */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Min Price Bound (Opsional)</label>
                <input
                  type="text"
                  placeholder="Auto ± Bound %"
                  value={minBound}
                  onChange={e => setMinBound(e.target.value)}
                  className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF] placeholder:text-[#53616A] outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Max Price Bound (Opsional)</label>
                <input
                  type="text"
                  placeholder="Auto ± Bound %"
                  value={maxBound}
                  onChange={e => setMaxBound(e.target.value)}
                  className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF] placeholder:text-[#53616A] outline-none"
                />
              </div>
            </div>

            {/* Progressive Lot Scaling */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Buy Lot (L1 → LN)</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={minBuyLot}
                    onChange={e => setMinBuyLot(e.target.value)}
                    className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#16A879] rounded-[7px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#16A879] outline-none"
                  />
                  <span className="text-[#53616A] text-xs">→</span>
                  <input
                    type="text"
                    value={maxBuyLot}
                    onChange={e => setMaxBuyLot(e.target.value)}
                    className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#16A879] rounded-[7px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#16A879] outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Sell Lot (L1 → LN)</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={minSellLot}
                    onChange={e => setMinSellLot(e.target.value)}
                    className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#EA5B65] rounded-[7px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#EA5B65] outline-none"
                  />
                  <span className="text-[#53616A] text-xs">→</span>
                  <input
                    type="text"
                    value={maxSellLot}
                    onChange={e => setMaxSellLot(e.target.value)}
                    className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#EA5B65] rounded-[7px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#EA5B65] outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Virtual Wallet Capital & Microstructure Friction */}
            <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-[#202B34]">
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">
                  Modal Awal {selectedDatasetInfo?.baseCurrency || 'Base'}
                </label>
                <input
                  type="text"
                  value={initialBaseBalance}
                  onChange={e => setInitialBaseBalance(e.target.value)}
                  className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF] outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">
                  Modal Awal {selectedDatasetInfo?.quoteCurrency || 'Quote'}
                </label>
                <input
                  type="text"
                  value={initialQuoteBalance}
                  onChange={e => setInitialQuoteBalance(e.target.value)}
                  className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF] outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Maker Fee (bps)</label>
                <input
                  type="number"
                  step={0.5}
                  value={makerFeeBps}
                  onChange={e => setMakerFeeBps(Number(e.target.value) || 0)}
                  title="Negatif = Maker Rebate"
                  className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF] outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Slippage (bps)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={slippageBps}
                  onChange={e => setSlippageBps(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF] outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Reprice (ms)</label>
                <input
                  type="number"
                  min={500}
                  step={500}
                  value={repriceIntervalMs}
                  onChange={e => setRepriceIntervalMs(Math.max(500, Number(e.target.value) || 4000))}
                  className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Label Skenario (Opsional)</label>
              <input
                type="text"
                placeholder="Misal: H&S Ketat Rebate -2bps"
                value={runLabel}
                onChange={e => setRunLabel(e.target.value)}
                className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-1.5 text-xs text-[#E4EBEF] placeholder:text-[#53616A] outline-none"
              />
            </div>

            {runError && (
              <div className="p-2.5 bg-[#401F27]/50 border border-[#EA5B65]/40 rounded-[7px] text-xs text-[#EA5B65] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{runError}</span>
              </div>
            )}

            {globalLedgerSummary && (
              <div className="pt-2 border-t border-[#202B34] text-[11px] text-[#71818B] font-mono tabular-nums flex flex-wrap gap-x-2 gap-y-0.5">
                <span>Global DB: {globalLedgerSummary.totalTrades} trades</span>
                <span>·</span>
                <span>{globalLedgerSummary.totalSettlementJournals} settlement journals</span>
                <span>·</span>
                <span>{globalLedgerSummary.totalLedgerEntries} entries</span>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Results & Analytics */}
        <div className="xl:col-span-8 flex flex-col gap-4">
          {!activeResult ? (
            <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-10 flex flex-col items-center justify-center text-center min-h-[420px]">
              <BarChart3 className="w-10 h-10 text-[#8DA5B1]/50 mb-3" />
              <h3 className="text-sm font-semibold text-[#E4EBEF] mb-1">Siap Mensimulasikan Ledger Historis</h3>
              <p className="text-xs text-[#A1AFB8] max-w-md mb-4">
                Pilih pair, mode sumber data ledger, dan konfigurasi tangga di panel kiri lalu klik{' '}
                <strong className="text-[#C1D0D6]">Jalankan Backtest</strong> untuk mengevaluasi kurva ekuitas,
                drawdown, distribusi rung, dan audit bukti journal.
              </p>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleRunBacktest}
                isLoading={isRunning}
                icon={<Play className="w-3.5 h-3.5 fill-current" />}
              >
                {isRunning ? 'Mensimulasikan...' : `Jalankan Backtest (${pairId})`}
              </Button>
            </div>
          ) : (
            <>
              {/* Immutable Audit Verification Strip */}
              <div className="px-4 py-2.5 bg-[#141C24] border border-[#202B34] rounded-[10px] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[#A1AFB8]">
                  <ShieldCheck className="w-4 h-4 text-[#16A879] shrink-0" />
                  <span className="text-[#16A879] font-semibold">NON-MUTATING VERIFIED</span>
                  <span className="text-[#53616A]">·</span>
                  <span>{activeResult.ledgerAudit.replayedEventsCount} events replayed</span>
                  <span className="text-[#53616A]">·</span>
                  <span>{activeResult.ledgerAudit.journalVerifiedTradesCount} TRADE_SETTLEMENT verified</span>
                  <span className="text-[#53616A]">·</span>
                  <span>{activeResult.executionTimeMs}ms</span>
                </div>
                <div className="flex items-center gap-1.5 text-[#71818B]">
                  <span>SHA256:</span>
                  <span className="text-[#C1D0D6]">{activeResult.ledgerAudit.datasetIntegrityHash.slice(0, 16)}…</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(activeResult.ledgerAudit.datasetIntegrityHash);
                      onSetFeedback({ type: 'success', text: 'SHA-256 dataset integrity hash disalin.' });
                    }}
                    title="Salin hash integritas penuh"
                    className="p-1 text-[#A1AFB8] hover:text-[#E4EBEF] transition-colors cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* 6-KPI Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3.5 bg-[#141C24] border border-[#202B34] rounded-[10px]">
                  <div className="flex items-center justify-between text-[11px] text-[#A1AFB8] mb-1">
                    <span>Net PnL &amp; Return</span>
                    {activeResult.summary.netPnlQuote >= 0 ? (
                      <TrendingUp className="w-3.5 h-3.5 text-[#16A879]" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5 text-[#EA5B65]" />
                    )}
                  </div>
                  <div
                    className={`text-base sm:text-lg font-semibold font-mono tabular-nums ${
                      activeResult.summary.netPnlQuote >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'
                    }`}
                  >
                    {activeResult.summary.netPnlQuote >= 0 ? '+' : ''}
                    {formatQuoteVal(activeResult.summary.netPnlQuote, activeResult.quoteCurrency)}{' '}
                    {activeResult.quoteCurrency}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#71818B] mt-0.5">
                    ROI: {activeResult.summary.netReturnPct >= 0 ? '+' : ''}
                    {activeResult.summary.netReturnPct.toFixed(2)}% · Akhir:{' '}
                    {formatQuoteVal(activeResult.summary.finalEquityQuote, activeResult.quoteCurrency)}
                  </div>
                </div>

                <div className="p-3.5 bg-[#141C24] border border-[#202B34] rounded-[10px]">
                  <div className="text-[11px] text-[#A1AFB8] mb-1">Realized vs Unrealized</div>
                  <div className="text-base sm:text-lg font-semibold font-mono tabular-nums text-[#E4EBEF]">
                    {activeResult.summary.realizedPnlQuote >= 0 ? '+' : ''}
                    {formatQuoteVal(activeResult.summary.realizedPnlQuote, activeResult.quoteCurrency)}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#71818B] mt-0.5">
                    Unrealized: {activeResult.summary.unrealizedPnlQuote >= 0 ? '+' : ''}
                    {formatQuoteVal(activeResult.summary.unrealizedPnlQuote, activeResult.quoteCurrency)}
                  </div>
                </div>

                <div className="p-3.5 bg-[#141C24] border border-[#202B34] rounded-[10px]">
                  <div className="text-[11px] text-[#A1AFB8] mb-1">Max Drawdown</div>
                  <div className="text-base sm:text-lg font-semibold font-mono tabular-nums text-[#EA5B65]">
                    -{activeResult.summary.maxDrawdownPct.toFixed(2)}%
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#71818B] mt-0.5">
                    Peak Drop: {formatQuoteVal(activeResult.summary.maxDrawdownQuote, activeResult.quoteCurrency)}{' '}
                    {activeResult.quoteCurrency}
                  </div>
                </div>

                <div className="p-3.5 bg-[#141C24] border border-[#202B34] rounded-[10px]">
                  <div className="text-[11px] text-[#A1AFB8] mb-1">Sharpe &amp; Profit Factor</div>
                  <div className="text-base sm:text-lg font-semibold font-mono tabular-nums text-[#C1D0D6]">
                    SR {activeResult.summary.sharpeRatio.toFixed(2)}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#71818B] mt-0.5">
                    PF: {activeResult.summary.profitFactor.toFixed(2)} · Win Rate:{' '}
                    {activeResult.summary.winRatePct.toFixed(1)}%
                  </div>
                </div>

                <div className="p-3.5 bg-[#141C24] border border-[#202B34] rounded-[10px]">
                  <div className="text-[11px] text-[#A1AFB8] mb-1">Execution &amp; Fill Rate</div>
                  <div className="text-base sm:text-lg font-semibold font-mono tabular-nums text-[#E4EBEF]">
                    {activeResult.summary.totalFills} Fills ({activeResult.summary.fillRatePct.toFixed(2)}%)
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#71818B] mt-0.5">
                    {activeResult.summary.totalBuyFills} Buy · {activeResult.summary.totalSellFills} Sell ·{' '}
                    {activeResult.summary.outOfBoundsSkippedTicks} OOB Guard
                  </div>
                </div>

                <div className="p-3.5 bg-[#141C24] border border-[#202B34] rounded-[10px]">
                  <div className="text-[11px] text-[#A1AFB8] mb-1">Fee / Rebate &amp; Turnover</div>
                  <div
                    className={`text-base sm:text-lg font-semibold font-mono tabular-nums ${
                      activeResult.summary.totalFeesPaidQuote <= 0 ? 'text-[#16A879]' : 'text-[#D6A85C]'
                    }`}
                  >
                    {activeResult.summary.totalFeesPaidQuote <= 0 ? 'Rebate ' : ''}
                    {formatQuoteVal(Math.abs(activeResult.summary.totalFeesPaidQuote), activeResult.quoteCurrency)}{' '}
                    {activeResult.quoteCurrency}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#71818B] mt-0.5">
                    Vol: {formatQuoteVal(activeResult.summary.totalTurnoverQuote, activeResult.quoteCurrency)} ·{' '}
                    {activeResult.summary.totalRepriceCycles} Cycles
                  </div>
                </div>
              </div>

              {/* D3 Chart 1: Equity Curve & Drawdown */}
              <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
                <PanelHeader
                  icon={<Activity className="w-4 h-4 text-[#16A879]" />}
                  title="Kurva Ekuitas & Drawdown (%)"
                  actions={
                    hoverPoint ? (
                      <div className="text-[11px] font-mono tabular-nums text-[#C1D0D6] flex flex-wrap gap-x-2">
                        <span>{formatShortTs(hoverPoint.timestamp)}</span>
                        <span>·</span>
                        <span>Eq: {formatQuoteVal(hoverPoint.equityQuote, activeResult.quoteCurrency)}</span>
                        <span>·</span>
                        <span className="text-[#EA5B65]">DD: -{hoverPoint.drawdownPct.toFixed(2)}%</span>
                        <span>·</span>
                        <span>
                          Inv: {formatBaseVal(hoverPoint.inventoryBase)} {activeResult.baseCurrency}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-[#71818B] font-mono">
                        Arahkan kursor ke grafik untuk inspeksi titik ekuitas
                      </span>
                    )
                  }
                />
                <div className="p-3 bg-[#090D12]/50">
                  <svg ref={equitySvgRef} viewBox="0 0 760 270" className="w-full h-auto block" />
                </div>
              </div>

              {/* D3 Chart 2 + Chart 3 Row */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
                  <PanelHeader
                    title="Trajektori Harga, Bounds & Simulated Fills"
                    actions={
                      <div className="text-[10px] font-mono text-[#71818B] flex items-center gap-2.5">
                        <span className="text-[#8DA5B1]">— Market</span>
                        <span className="text-[#D6A85C]">— Anchor</span>
                        <span className="text-[#16A879]">▲ Buy</span>
                        <span className="text-[#EA5B65]">▼ Sell</span>
                      </div>
                    }
                  />
                  <div className="p-3 bg-[#090D12]/50">
                    <svg ref={priceOverlaySvgRef} viewBox="0 0 760 230" className="w-full h-auto block" />
                  </div>
                </div>

                <div className="lg:col-span-5 bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
                  <PanelHeader
                    icon={<Layers className="w-3.5 h-3.5" />}
                    title="Distribusi Hit Tangga (L1–LN)"
                    actions={
                      <span className="text-[10px] font-mono text-[#71818B]">
                        <span className="text-[#16A879]">Buy</span> / <span className="text-[#EA5B65]">Sell</span>
                      </span>
                    }
                  />
                  <div className="p-3 bg-[#090D12]/50">
                    {activeResult.rungHitDistribution.length === 0 ? (
                      <div className="h-[180px] flex items-center justify-center text-xs text-[#71818B]">
                        Belum ada fill tangga pada rentang harga ini.
                      </div>
                    ) : (
                      <svg ref={rungBarSvgRef} viewBox="0 0 420 220" className="w-full h-auto block" />
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom Row: Run History Comparison + Simulated Fill Audit Ledger Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Run History & Side-by-Side Comparison */}
        <div className="lg:col-span-5 bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
          <PanelHeader
            icon={<History className="w-4 h-4" />}
            title={`Riwayat Skenario (${history.length})`}
            actions={
              history.length >= 2 && activeResult ? (
                <div className="flex items-center gap-1.5">
                  <GitCompare className="w-3.5 h-3.5 text-[#71818B]" />
                  <select
                    value={compareRunId}
                    onChange={e => setCompareRunId(e.target.value)}
                    aria-label="Bandingkan riwayat backtest"
                    className="bg-[#111820] border border-[#2B3944] rounded-[7px] px-2 py-1 text-[11px] text-[#E4EBEF] max-w-[160px] outline-none"
                  >
                    <option value="">Bandingkan dengan...</option>
                    {history
                      .filter(h => h.runId !== activeResult.runId)
                      .map(h => (
                        <option key={h.runId} value={h.runId}>
                          {h.label || h.pairId} ({h.summary.netReturnPct >= 0 ? '+' : ''}
                          {h.summary.netReturnPct.toFixed(2)}%)
                        </option>
                      ))}
                  </select>
                </div>
              ) : undefined
            }
          />

          <div className="p-4 flex flex-col gap-3">
            {compareResult && activeResult && (
              <div className="p-3 bg-[#111820] border border-[#2B3944] rounded-[7px] text-[11px] font-mono tabular-nums">
                <div className="text-[#C1D0D6] font-semibold mb-1.5">
                  Delta: Aktif ({activeResult.label || activeResult.config.pattern}) vs (
                  {compareResult.label || compareResult.config.pattern})
                </div>
                <div className="grid grid-cols-2 gap-y-1 text-[#A1AFB8]">
                  <span>ROI Δ:</span>
                  <span
                    className={
                      activeResult.summary.netReturnPct - compareResult.summary.netReturnPct >= 0
                        ? 'text-[#16A879] text-right'
                        : 'text-[#EA5B65] text-right'
                    }
                  >
                    {activeResult.summary.netReturnPct - compareResult.summary.netReturnPct >= 0 ? '+' : ''}
                    {(activeResult.summary.netReturnPct - compareResult.summary.netReturnPct).toFixed(2)}%
                  </span>
                  <span>Drawdown Δ:</span>
                  <span
                    className={
                      activeResult.summary.maxDrawdownPct <= compareResult.summary.maxDrawdownPct
                        ? 'text-[#16A879] text-right'
                        : 'text-[#EA5B65] text-right'
                    }
                  >
                    {activeResult.summary.maxDrawdownPct - compareResult.summary.maxDrawdownPct >= 0 ? '+' : ''}
                    {(activeResult.summary.maxDrawdownPct - compareResult.summary.maxDrawdownPct).toFixed(2)}%
                  </span>
                  <span>Sharpe Δ:</span>
                  <span className="text-right text-[#C1D0D6]">
                    {activeResult.summary.sharpeRatio - compareResult.summary.sharpeRatio >= 0 ? '+' : ''}
                    {(activeResult.summary.sharpeRatio - compareResult.summary.sharpeRatio).toFixed(2)}
                  </span>
                  <span>Fills Δ:</span>
                  <span className="text-right text-[#E4EBEF]">
                    {activeResult.summary.totalFills - compareResult.summary.totalFills >= 0 ? '+' : ''}
                    {activeResult.summary.totalFills - compareResult.summary.totalFills}
                  </span>
                </div>
              </div>
            )}

            {history.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#71818B]">
                Belum ada riwayat backtest pada sesi server ini.
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-[#202B34] max-h-[300px] overflow-y-auto">
                {history.map(item => {
                  const isSelected = activeResult?.runId === item.runId;
                  return (
                    <button
                      key={item.runId}
                      type="button"
                      onClick={() => setActiveResult(item)}
                      className={`w-full text-left py-2.5 px-2.5 rounded-[7px] transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                        isSelected ? 'bg-[#1D2832] border border-[#2B3944]' : 'hover:bg-[#17212B] border border-transparent'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#E4EBEF] truncate">
                          {item.label || `${item.pairId} · ${item.config.pattern}`}
                        </div>
                        <div className="text-[10px] font-mono text-[#71818B] mt-0.5 truncate">
                          {item.dataSourceMode} · {item.summary.totalFills} fills · DD -
                          {item.summary.maxDrawdownPct.toFixed(2)}%
                        </div>
                      </div>
                      <div className="text-right shrink-0 font-mono tabular-nums">
                        <div
                          className={`text-xs font-semibold ${
                            item.summary.netReturnPct >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'
                          }`}
                        >
                          {item.summary.netReturnPct >= 0 ? '+' : ''}
                          {item.summary.netReturnPct.toFixed(2)}%
                        </div>
                        <div className="text-[10px] text-[#71818B]">{formatShortTs(item.createdAt)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Simulated Fills Audit Log */}
        <div className="lg:col-span-7 bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
          <PanelHeader
            title={`Audit Log Simulated Fills ${activeResult ? `(${filteredFills.length})` : ''}`}
            actions={
              <SegmentedTabs
                size="sm"
                activeTab={fillFilter}
                onChange={setFillFilter}
                tabs={[
                  { id: 'ALL', label: 'ALL' },
                  { id: 'BUY', label: 'BUY' },
                  { id: 'SELL', label: 'SELL' },
                  { id: 'LEDGER_VERIFIED', label: 'LEDGER' },
                ]}
              />
            }
          />

          <div className="p-4">
            {!activeResult || filteredFills.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#71818B]">
                {activeResult
                  ? 'Tidak ada event fill yang cocok dengan filter ini.'
                  : 'Jalankan backtest untuk melihat rincian simulated fills dan bukti Journal ID.'}
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                <table className="w-full text-left text-[11px] font-mono tabular-nums border-collapse">
                  <thead className="sticky top-0 bg-[#141C24] text-[#71818B] border-b border-[#202B34] font-sans uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-2 pr-2">Waktu</th>
                      <th className="py-2 px-2">Side / Rung</th>
                      <th className="py-2 px-2 text-right">Harga Fill</th>
                      <th className="py-2 px-2 text-right">Qty ({activeResult.baseCurrency})</th>
                      <th className="py-2 px-2 text-right">Realized PnL</th>
                      <th className="py-2 pl-2">Source / Journal Proof</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202B34]">
                    {filteredFills.slice(0, 80).map(fill => (
                      <tr key={`${fill.index}-${fill.sourceTradeId}`} className="hover:bg-[#17212B] transition-colors">
                        <td className="py-2 pr-2 text-[#71818B] whitespace-nowrap">
                          {formatShortTs(fill.timestamp)}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          <span
                            className={
                              fill.side === 'BUY' ? 'text-[#16A879] font-semibold' : 'text-[#EA5B65] font-semibold'
                            }
                          >
                            {fill.side} L{fill.ladderLevel}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right text-[#E4EBEF] whitespace-nowrap">
                          {formatQuoteVal(fill.fillPrice, activeResult.quoteCurrency)}
                        </td>
                        <td className="py-2 px-2 text-right text-[#A1AFB8] whitespace-nowrap">
                          {formatBaseVal(fill.quantity)}
                        </td>
                        <td
                          className={`py-2 px-2 text-right whitespace-nowrap ${
                            fill.realizedPnl > 0
                              ? 'text-[#16A879]'
                              : fill.realizedPnl < 0
                                ? 'text-[#EA5B65]'
                                : 'text-[#71818B]'
                          }`}
                        >
                          {fill.realizedPnl === 0
                            ? '—'
                            : `${fill.realizedPnl > 0 ? '+' : ''}${formatQuoteVal(
                                fill.realizedPnl,
                                activeResult.quoteCurrency
                              )}`}
                        </td>
                        <td className="py-2 pl-2 text-[#A1AFB8] whitespace-nowrap">
                          {fill.ledgerVerified && fill.journalId ? (
                            <span className="text-[#8DA5B1]" title={`Journal ID: ${fill.journalId}`}>
                              J:{fill.journalId.slice(0, 10)}…
                            </span>
                          ) : (
                            <span className="text-[#71818B]" title={`Source: ${fill.sourceTradeId}`}>
                              T:{fill.sourceTradeId.slice(0, 10)}…
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
