/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MarketMakerInternalSpreadSection.tsx
 * Dedicated "Market Maker Internal Spread" mode inside MMConsoleView.
 * Configures and runs a simulated Self-Eating order-matching loop that places
 * offsetting BUY and SELL orders inside a narrow target spread corridor, and renders
 * a real-time D3.js Spread Heatmap highlighting bid-ask liquidity and self-eating patterns.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { Play, Pause, RotateCcw, StepForward, RefreshCw, BookmarkPlus, Trash2, Check } from 'lucide-react';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { BotInstance, Environment, TradingPairItem } from '../../types/index.js';
import { formatUnitsToDecimal } from '../../lib/formatters.js';
import { Button } from '../ui/Button.js';
import { StatusBadge } from '../ui/StatusBadge.js';

interface Props {
  tradingPairs: TradingPairItem[];
  currentEnv: Environment;
  instances: BotInstance[];
  onSetFeedback?: (msg: { type: 'success' | 'error'; text: string } | null) => void;
}

type OffsetDirectionMode = 'ALTERNATE' | 'BUY_EATS_SELL' | 'SELL_EATS_BUY' | 'RANDOM';

interface DepthSnapshotNumeric {
  bids: { price: number; qty: number }[];
  asks: { price: number; qty: number }[];
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  liveSpreadPct: number;
  fetchedAt: number;
}

interface SelfEatingOrderEvent {
  id: string;
  timestamp: number;
  makerSide: 'BUY' | 'SELL';
  takerSide: 'BUY' | 'SELL';
  execPrice: number;
  volumeBase: number;
  volumeQuote: number;
  spreadPctFromMid: number;
  targetSpreadPct: number;
  makerOrderId: string;
  takerOrderId: string;
  status: 'SELF_EATEN';
}

interface HeatmapBucketCell {
  rowIndex: number;
  priceLow: number;
  priceHigh: number;
  priceMid: number;
  bidDepth: number;
  askDepth: number;
  selfEatBase: number;
  selfEatQuote: number;
  selfEatCount: number;
  lastTakerSide: 'BUY' | 'SELL' | null;
  inCorridor: boolean;
}

interface HeatmapFrame {
  id: string;
  timestamp: number;
  label: string;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  corridorLow: number;
  corridorHigh: number;
  lastExecPrice: number | null;
  lastTakerSide: 'BUY' | 'SELL' | null;
  cells: HeatmapBucketCell[];
}

interface HoveredHeatmapCell {
  frameLabel: string;
  timestamp: number;
  cell: HeatmapBucketCell;
  corridorLow: number;
  corridorHigh: number;
  midPrice: number;
}

interface InternalSpreadStrategyPreset {
  id: string;
  name: string;
  description: string;
  targetSpreadPct: string;
  orderVolume: string;
  volumeJitterPct: number;
  executionIntervalMs: number;
  directionMode: OffsetDirectionMode;
  isBuiltIn?: boolean;
  updatedAt: number;
}

const PRESETS_STORAGE_KEY = 'dimonex_internal_spread_presets_v1';

const DIRECTION_LABELS: Record<OffsetDirectionMode, string> = {
  ALTERNATE: 'Alternate (Buy ↔ Sell)',
  BUY_EATS_SELL: 'Buy Taker Eats Sell Maker',
  SELL_EATS_BUY: 'Sell Taker Eats Buy Maker',
  RANDOM: 'Random Spread Cross',
};

const DEFAULT_STRATEGY_PRESETS: InternalSpreadStrategyPreset[] = [
  {
    id: 'preset-aggressive-scalp',
    name: 'Aggressive Scalp',
    description: 'Koridor spread ultra-sempit dengan frekuensi cepat untuk rotasi order cepat.',
    targetSpreadPct: '0.08',
    orderVolume: '0.015',
    volumeJitterPct: 10,
    executionIntervalMs: 350,
    directionMode: 'ALTERNATE',
    isBuiltIn: true,
    updatedAt: 0,
  },
  {
    id: 'preset-conservative-liquidity',
    name: 'Conservative Liquidity',
    description: 'Spread lebih moderat dan interval tenang untuk menjaga stabilitas kedalaman.',
    targetSpreadPct: '0.45',
    orderVolume: '0.010',
    volumeJitterPct: 5,
    executionIntervalMs: 2200,
    directionMode: 'ALTERNATE',
    isBuiltIn: true,
    updatedAt: 0,
  },
  {
    id: 'preset-high-volume',
    name: 'High Volume',
    description: 'Ukuran order lebih besar dengan variasi acak di dalam koridor spread.',
    targetSpreadPct: '0.20',
    orderVolume: '0.120',
    volumeJitterPct: 25,
    executionIntervalMs: 500,
    directionMode: 'RANDOM',
    isBuiltIn: true,
    updatedAt: 0,
  },
];

function loadSavedStrategyPresets(): InternalSpreadStrategyPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return DEFAULT_STRATEGY_PRESETS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_STRATEGY_PRESETS;
    return parsed.filter(
      (item): item is InternalSpreadStrategyPreset =>
        Boolean(item && typeof item.id === 'string' && typeof item.name === 'string')
    );
  } catch {
    return DEFAULT_STRATEGY_PRESETS;
  }
}

const HEATMAP_MAX_FRAMES = 28;
const HEATMAP_PRICE_ROWS = 16;

function formatPriceNumber(price: number, quoteCurrency: string, quoteDecimals: number): string {
  if (!Number.isFinite(price) || price <= 0) return '0';
  if (quoteCurrency.toUpperCase() === 'IDR') {
    return `Rp ${Math.round(price).toLocaleString('id-ID')}`;
  }
  const precision = price < 1 ? Math.min(6, Math.max(4, quoteDecimals)) : price < 100 ? 4 : 2;
  return `${price.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(2, precision),
    maximumFractionDigits: precision,
  })} ${quoteCurrency}`;
}

function formatCompactPrice(price: number, quoteCurrency: string): string {
  if (!Number.isFinite(price) || price <= 0) return '0';
  if (quoteCurrency.toUpperCase() === 'IDR') {
    if (price >= 1_000_000_000) return `${(price / 1_000_000_000).toFixed(3)}B`;
    if (price >= 1_000_000) return `${(price / 1_000_000).toFixed(2)}M`;
    if (price >= 1_000) return `${(price / 1_000).toFixed(1)}K`;
    return Math.round(price).toLocaleString('id-ID');
  }
  if (price < 1) return price.toFixed(5);
  if (price < 100) return price.toFixed(3);
  return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export const MarketMakerInternalSpreadSection: React.FC<Props> = ({
  tradingPairs,
  currentEnv,
  instances,
  onSetFeedback,
}) => {
  const [selectedPairId, setSelectedPairId] = useState<string>(() => tradingPairs[0]?.id || 'BTC-IDR');

  // Configuration state required by user prompt:
  // 1. Target spread percentage
  // 2. Order volume
  // 3. Execution frequency interval
  const [targetSpreadPct, setTargetSpreadPct] = useState<string>('0.25');
  const [orderVolume, setOrderVolume] = useState<string>('0.025');
  const [volumeJitterPct, setVolumeJitterPct] = useState<number>(15);
  const [executionIntervalMs, setExecutionIntervalMs] = useState<number>(1000);
  const [directionMode, setDirectionMode] = useState<OffsetDirectionMode>('ALTERNATE');
  const [isRunning, setIsRunning] = useState<boolean>(false);

  // Strategy Presets state (saved & default configurations)
  const [strategyPresets, setStrategyPresets] = useState<InternalSpreadStrategyPreset[]>(() =>
    loadSavedStrategyPresets()
  );
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [newPresetDesc, setNewPresetDesc] = useState<string>('');

  // Live L2 order book snapshot + simulation runtime buffers
  const [depthSnap, setDepthSnap] = useState<DepthSnapshotNumeric | null>(null);
  const [isDepthLoading, setIsDepthLoading] = useState<boolean>(true);
  const [heatmapFrames, setHeatmapFrames] = useState<HeatmapFrame[]>([]);
  const [simEvents, setSimEvents] = useState<SelfEatingOrderEvent[]>([]);
  const [hoveredCell, setHoveredCell] = useState<HoveredHeatmapCell | null>(null);

  // Summary counters
  const [totalCycles, setTotalCycles] = useState<number>(0);
  const [totalVolumeBase, setTotalVolumeBase] = useState<number>(0);
  const [totalVolumeQuote, setTotalVolumeQuote] = useState<number>(0);
  const [lastExecSpreadPct, setLastExecSpreadPct] = useState<number | null>(null);

  const lastSideRef = useRef<'BUY' | 'SELL'>('SELL');
  const heatmapSvgRef = useRef<SVGSVGElement | null>(null);
  const pendingEventQueueRef = useRef<SelfEatingOrderEvent[]>([]);

  const selectedPair = useMemo(
    () =>
      tradingPairs.find(p => p.id === selectedPairId) ||
      tradingPairs[0] || {
        id: 'BTC-IDR',
        baseCurrency: 'BTC',
        quoteCurrency: 'IDR',
        baseDecimals: 8,
        quoteDecimals: 2,
        minOrderSize: '100000',
        maxOrderSize: '1000000000',
        makerFeeBps: 10,
        takerFeeBps: 20,
        isActive: true,
        isHalted: false,
        lastPrice: '145000000000',
        high24h: '146000000000',
        low24h: '144000000000',
        volume24h: '0',
        quoteVolume24h: '0',
        priceChange24h: '+0.00',
      },
    [tradingPairs, selectedPairId]
  );

  // Keep selectedPairId valid if pairs change
  useEffect(() => {
    if (tradingPairs.length > 0 && !tradingPairs.some(p => p.id === selectedPairId)) {
      setSelectedPairId(tradingPairs[0].id);
    }
  }, [tradingPairs, selectedPairId]);

  const parsedTargetSpreadPct = useMemo(() => {
    const val = parseFloat(targetSpreadPct);
    if (!Number.isFinite(val) || val <= 0) return 0.25;
    return Math.min(10, Math.max(0.01, val));
  }, [targetSpreadPct]);

  const parsedOrderVolume = useMemo(() => {
    const val = parseFloat(orderVolume);
    if (!Number.isFinite(val) || val <= 0) return 0.01;
    return val;
  }, [orderVolume]);

  // Count any backend Phase 2 Volume Spread Bots active on this pair for cross-visibility
  const livePhase2SpreadBots = useMemo(
    () => instances.filter(b => b.botType === 'VOLUME_SPREAD_BOT' && b.pairId === selectedPair.id),
    [instances, selectedPair.id]
  );

  // Parse raw order book depth into numeric units cleanly
  const fetchLiveOrderBook = useCallback(
    async (showLoading = false): Promise<DepthSnapshotNumeric | null> => {
      if (showLoading) setIsDepthLoading(true);
      try {
        const res = await safeFetchJson<{
          bids?: [string, string, string][];
          asks?: [string, string, string][];
          spread?: string;
        }>(`/api/trading/depth/${encodeURIComponent(selectedPair.id)}`);

        const qDec = selectedPair.quoteDecimals ?? 2;
        const bDec = selectedPair.baseDecimals ?? 8;

        const parseNumPrice = (raw: string) =>
          parseFloat(formatUnitsToDecimal(raw, qDec, false)) || 0;
        const parseNumQty = (raw: string) =>
          parseFloat(formatUnitsToDecimal(raw, bDec, false)) || 0;

        const fallbackLast = parseNumPrice(selectedPair.lastPrice || '0');

        const bids = (res.ok && Array.isArray(res.data?.bids) ? res.data.bids : [])
          .slice(0, 20)
          .map(([p, q]) => ({ price: parseNumPrice(p), qty: parseNumQty(q) }))
          .filter(x => x.price > 0 && x.qty > 0);

        const asks = (res.ok && Array.isArray(res.data?.asks) ? res.data.asks : [])
          .slice(0, 20)
          .map(([p, q]) => ({ price: parseNumPrice(p), qty: parseNumQty(q) }))
          .filter(x => x.price > 0 && x.qty > 0);

        let bestBid = bids.length > 0 ? bids[0].price : 0;
        let bestAsk = asks.length > 0 ? asks[0].price : 0;

        if (bestBid <= 0 && bestAsk > 0) {
          bestBid = bestAsk * (1 - parsedTargetSpreadPct / 100);
        } else if (bestAsk <= 0 && bestBid > 0) {
          bestAsk = bestBid * (1 + parsedTargetSpreadPct / 100);
        } else if (bestBid <= 0 && bestAsk <= 0) {
          const baseAnchor = fallbackLast > 0 ? fallbackLast : selectedPair.quoteCurrency === 'IDR' ? 1_450_000_000 : 68_500;
          const half = baseAnchor * (Math.max(parsedTargetSpreadPct, 0.2) / 200);
          bestBid = baseAnchor - half;
          bestAsk = baseAnchor + half;
        }

        const midPrice = (bestBid + bestAsk) / 2;
        const liveSpreadPct = midPrice > 0 ? ((bestAsk - bestBid) / midPrice) * 100 : 0;

        const snap: DepthSnapshotNumeric = {
          bids,
          asks,
          bestBid,
          bestAsk,
          midPrice,
          liveSpreadPct,
          fetchedAt: Date.now(),
        };
        setDepthSnap(snap);
        return snap;
      } catch {
        return null;
      } finally {
        setIsDepthLoading(false);
      }
    },
    [selectedPair, parsedTargetSpreadPct]
  );

  // Build one HeatmapFrame from live depth + any self-eating events captured in this slice
  const buildHeatmapFrame = useCallback(
    (snap: DepthSnapshotNumeric, sliceEvents: SelfEatingOrderEvent[]): HeatmapFrame => {
      const { bestBid, bestAsk, midPrice } = snap;
      const halfTargetSpan = midPrice * (parsedTargetSpreadPct / 200);
      const corridorLow = Math.max(0.000001, midPrice - halfTargetSpan);
      const corridorHigh = midPrice + halfTargetSpan;

      // Span heatmap vertically to showcase both live bestBid/bestAsk and internal corridor
      const viewLowRaw = Math.min(bestBid > 0 ? bestBid : corridorLow, corridorLow);
      const viewHighRaw = Math.max(bestAsk > 0 ? bestAsk : corridorHigh, corridorHigh);
      const baseSpan = Math.max(viewHighRaw - viewLowRaw, midPrice * 0.002);
      const pad = baseSpan * 0.28;
      const viewLow = Math.max(0.000001, viewLowRaw - pad);
      const viewHigh = viewHighRaw + pad;
      const step = (viewHigh - viewLow) / HEATMAP_PRICE_ROWS;

      const cells: HeatmapBucketCell[] = [];
      for (let r = 0; r < HEATMAP_PRICE_ROWS; r++) {
        const priceLow = viewLow + r * step;
        const priceHigh = priceLow + step;
        const priceMid = (priceLow + priceHigh) / 2;

        // Accumulate live book depth inside this price bucket
        let bidDepth = 0;
        for (const b of snap.bids) {
          if (b.price >= priceLow && (b.price < priceHigh || (r === HEATMAP_PRICE_ROWS - 1 && b.price <= priceHigh))) {
            bidDepth += b.qty;
          }
        }

        let askDepth = 0;
        for (const a of snap.asks) {
          if (a.price >= priceLow && (a.price < priceHigh || (r === HEATMAP_PRICE_ROWS - 1 && a.price <= priceHigh))) {
            askDepth += a.qty;
          }
        }

        // Overlay simulated self-eating matched volume inside this bucket
        let selfEatBase = 0;
        let selfEatQuote = 0;
        let selfEatCount = 0;
        let lastTakerSide: 'BUY' | 'SELL' | null = null;

        for (const ev of sliceEvents) {
          const inBucket =
            (ev.execPrice >= priceLow && ev.execPrice < priceHigh) ||
            (r === 0 && ev.execPrice < viewLow) ||
            (r === HEATMAP_PRICE_ROWS - 1 && ev.execPrice >= priceHigh);

          if (inBucket) {
            selfEatBase += ev.volumeBase;
            selfEatQuote += ev.volumeQuote;
            selfEatCount += 1;
            lastTakerSide = ev.takerSide;
            // Self-eating creates momentary resting maker + matching taker liquidity footprint
            if (ev.makerSide === 'BUY') bidDepth += ev.volumeBase;
            else askDepth += ev.volumeBase;
          }
        }

        const inCorridor = priceHigh >= corridorLow && priceLow <= corridorHigh;

        cells.push({
          rowIndex: r,
          priceLow,
          priceHigh,
          priceMid,
          bidDepth,
          askDepth,
          selfEatBase,
          selfEatQuote,
          selfEatCount,
          lastTakerSide,
          inCorridor,
        });
      }

      const lastEv = sliceEvents.length > 0 ? sliceEvents[sliceEvents.length - 1] : null;
      const now = Date.now();
      const dt = new Date(now);
      const label = dt.toTimeString().slice(0, 8);

      return {
        id: `${now}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: now,
        label,
        bestBid,
        bestAsk,
        midPrice,
        corridorLow,
        corridorHigh,
        lastExecPrice: lastEv ? lastEv.execPrice : null,
        lastTakerSide: lastEv ? lastEv.takerSide : null,
        cells,
      };
    },
    [parsedTargetSpreadPct]
  );

  // Execute one simulated offsetting self-eating match cycle inside the target narrow spread
  const executeSimulatedSelfEatingTick = useCallback(
    async (explicitSnap?: DepthSnapshotNumeric | null) => {
      const snap = explicitSnap || depthSnap || (await fetchLiveOrderBook(false));
      if (!snap || snap.midPrice <= 0) return;

      const { bestBid, bestAsk, midPrice } = snap;
      const halfTarget = midPrice * (parsedTargetSpreadPct / 200);

      // Compute narrow internal spread range around mid, constrained inside live bid-ask when wider
      let lowBound = midPrice - halfTarget;
      let highBound = midPrice + halfTarget;

      if (bestAsk > bestBid) {
        const liveHalf = (bestAsk - bestBid) / 2;
        if (liveHalf > halfTarget * 0.25) {
          lowBound = Math.max(lowBound, bestBid + (bestAsk - bestBid) * 0.04);
          highBound = Math.min(highBound, bestAsk - (bestAsk - bestBid) * 0.04);
        }
      }
      if (highBound <= lowBound) {
        lowBound = midPrice - halfTarget * 0.5;
        highBound = midPrice + halfTarget * 0.5;
      }

      // Pick maker/taker pattern
      let takerSide: 'BUY' | 'SELL';
      if (directionMode === 'BUY_EATS_SELL') {
        takerSide = 'BUY';
      } else if (directionMode === 'SELL_EATS_BUY') {
        takerSide = 'SELL';
      } else if (directionMode === 'RANDOM') {
        takerSide = Math.random() >= 0.5 ? 'BUY' : 'SELL';
      } else {
        takerSide = lastSideRef.current === 'BUY' ? 'SELL' : 'BUY';
      }
      lastSideRef.current = takerSide;
      const makerSide: 'BUY' | 'SELL' = takerSide === 'BUY' ? 'SELL' : 'BUY';

      // Position offsetting orders within narrow spread band:
      // BUY_EATS_SELL rests ask near upper-mid (52%..92% of corridor);
      // SELL_EATS_BUY rests bid near lower-mid (8%..48% of corridor).
      const span = Math.max(1e-9, highBound - lowBound);
      const ratio =
        takerSide === 'BUY'
          ? 0.52 + Math.random() * 0.40
          : 0.08 + Math.random() * 0.40;

      const execPrice = lowBound + span * ratio;

      // Apply jittered volume around configured Order Volume
      const jitterFrac = (Math.max(0, Math.min(50, volumeJitterPct)) / 100) * (Math.random() * 2 - 1);
      const volumeBase = Math.max(0.0001, parsedOrderVolume * (1 + jitterFrac));
      const volumeQuote = execPrice * volumeBase;
      const spreadPctFromMid = midPrice > 0 ? ((execPrice - midPrice) / midPrice) * 100 : 0;

      const seqSuffix = Math.random().toString(36).slice(2, 7).toUpperCase();
      const event: SelfEatingOrderEvent = {
        id: `se-${Date.now()}-${seqSuffix}`,
        timestamp: Date.now(),
        makerSide,
        takerSide,
        execPrice,
        volumeBase,
        volumeQuote,
        spreadPctFromMid,
        targetSpreadPct: parsedTargetSpreadPct,
        makerOrderId: `SIM-MK-${seqSuffix}`,
        takerOrderId: `SIM-TK-${seqSuffix}`,
        status: 'SELF_EATEN',
      };

      pendingEventQueueRef.current.push(event);
      setSimEvents(prev => [event, ...prev].slice(0, 40));
      setTotalCycles(c => c + 1);
      setTotalVolumeBase(v => v + volumeBase);
      setTotalVolumeQuote(q => q + volumeQuote);
      setLastExecSpreadPct(spreadPctFromMid);

      const frameSlice = pendingEventQueueRef.current.splice(0);
      const frame = buildHeatmapFrame(snap, frameSlice);
      setHeatmapFrames(prev => [...prev.slice(-(HEATMAP_MAX_FRAMES - 1)), frame]);
    },
    [
      depthSnap,
      fetchLiveOrderBook,
      parsedTargetSpreadPct,
      directionMode,
      volumeJitterPct,
      parsedOrderVolume,
      buildHeatmapFrame,
    ]
  );

  // Initial orderbook fetch + seed baseline heatmap frames on pair switch
  useEffect(() => {
    let cancelled = false;
    setHeatmapFrames([]);
    setSimEvents([]);
    setTotalCycles(0);
    setTotalVolumeBase(0);
    setTotalVolumeQuote(0);
    setLastExecSpreadPct(null);
    pendingEventQueueRef.current = [];

    (async () => {
      const snap = await fetchLiveOrderBook(true);
      if (!cancelled && snap) {
        const baselineFrame = buildHeatmapFrame(snap, []);
        setHeatmapFrames([baselineFrame]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedPair.id]); // Intentionally reset cleanly only when pair changes

  // Background orderbook refresh so heatmap reflects real market depth shifts even while paused
  useEffect(() => {
    const pollMs = isRunning ? Math.max(600, Math.min(2000, executionIntervalMs)) : 2500;
    const timer = setInterval(async () => {
      const snap = await fetchLiveOrderBook(false);
      if (snap && !isRunning) {
        const pending = pendingEventQueueRef.current.splice(0);
        const frame = buildHeatmapFrame(snap, pending);
        setHeatmapFrames(prev => [...prev.slice(-(HEATMAP_MAX_FRAMES - 1)), frame]);
      }
    }, pollMs);

    return () => clearInterval(timer);
  }, [isRunning, executionIntervalMs, fetchLiveOrderBook, buildHeatmapFrame]);

  // Self-Eating Execution Frequency Loop
  useEffect(() => {
    if (!isRunning) return;
    const clampedMs = Math.max(200, Math.min(10000, executionIntervalMs));
    const timer = setInterval(() => {
      void executeSimulatedSelfEatingTick();
    }, clampedMs);

    return () => clearInterval(timer);
  }, [isRunning, executionIntervalMs, executeSimulatedSelfEatingTick]);

  const handleToggleRun = () => {
    if (!isRunning) {
      void executeSimulatedSelfEatingTick();
      setIsRunning(true);
      onSetFeedback?.({
        type: 'success',
        text: `Internal Spread Self-Eating Engine aktif pada ${selectedPair.id} (Spread ${parsedTargetSpreadPct}%, Interval ${executionIntervalMs}ms).`,
      });
    } else {
      setIsRunning(false);
    }
  };

  const handleResetSimulation = async () => {
    setIsRunning(false);
    setSimEvents([]);
    setTotalCycles(0);
    setTotalVolumeBase(0);
    setTotalVolumeQuote(0);
    setLastExecSpreadPct(null);
    pendingEventQueueRef.current = [];
    const snap = await fetchLiveOrderBook(false);
    if (snap) {
      setHeatmapFrames([buildHeatmapFrame(snap, [])]);
    } else {
      setHeatmapFrames([]);
    }
  };

  // Persist presets cleanly whenever custom presets change
  useEffect(() => {
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(strategyPresets));
    } catch {
      // Ignore storage quota errors gracefully
    }
  }, [strategyPresets]);

  const handleApplyPreset = (preset: InternalSpreadStrategyPreset) => {
    setTargetSpreadPct(preset.targetSpreadPct);
    setOrderVolume(preset.orderVolume);
    setVolumeJitterPct(preset.volumeJitterPct);
    setExecutionIntervalMs(preset.executionIntervalMs);
    setDirectionMode(preset.directionMode);
    onSetFeedback?.({
      type: 'success',
      text: `Preset "${preset.name}" diterapkan (${preset.targetSpreadPct}% spread, vol ${preset.orderVolume} ${selectedPair.baseCurrency}, ${preset.executionIntervalMs}ms).`,
    });
  };

  const handleSavePreset = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newPresetName.trim();
    if (!trimmedName) {
      onSetFeedback?.({
        type: 'error',
        text: 'Masukkan nama preset strategi sebelum menyimpan.',
      });
      return;
    }

    const existingIdx = strategyPresets.findIndex(
      p => p.name.toLowerCase() === trimmedName.toLowerCase() && !p.isBuiltIn
    );

    const nextId =
      existingIdx >= 0
        ? strategyPresets[existingIdx].id
        : `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const presetEntry: InternalSpreadStrategyPreset = {
      id: nextId,
      name: trimmedName,
      description:
        newPresetDesc.trim() ||
        `Konfigurasi kustom untuk ${selectedPair.id} (${parsedTargetSpreadPct}% spread, ${executionIntervalMs}ms).`,
      targetSpreadPct: String(parsedTargetSpreadPct),
      orderVolume: String(parsedOrderVolume),
      volumeJitterPct,
      executionIntervalMs,
      directionMode,
      isBuiltIn: false,
      updatedAt: Date.now(),
    };

    setStrategyPresets(prev => {
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = presetEntry;
        return updated;
      }
      return [...prev, presetEntry];
    });
    setNewPresetName('');
    setNewPresetDesc('');
    onSetFeedback?.({
      type: 'success',
      text: `Preset "${trimmedName}" berhasil disimpan.`,
    });
  };

  const handleDeletePreset = (preset: InternalSpreadStrategyPreset) => {
    if (preset.isBuiltIn) return;
    setStrategyPresets(prev => prev.filter(p => p.id !== preset.id));
    onSetFeedback?.({
      type: 'success',
      text: `Preset "${preset.name}" dihapus.`,
    });
  };

  const doesMatchPreset = (p: InternalSpreadStrategyPreset) =>
    Number(p.targetSpreadPct) === parsedTargetSpreadPct &&
    Number(p.orderVolume) === parsedOrderVolume &&
    p.volumeJitterPct === volumeJitterPct &&
    p.executionIntervalMs === executionIntervalMs &&
    p.directionMode === directionMode;

  // ============================================================================
  // D3.JS REAL-TIME SPREAD HEATMAP RENDERER
  // ============================================================================
  useEffect(() => {
    const svgEl = heatmapSvgRef.current;
    if (!svgEl || heatmapFrames.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 940;
    const height = 390;
    const margin = { top: 24, right: 86, bottom: 34, left: 18 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const root = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Global price domain across current frames so rows align cleanly
    const latestFrame = heatmapFrames[heatmapFrames.length - 1];
    const allFrameMins = heatmapFrames.map(f => f.cells[0]?.priceLow || f.corridorLow);
    const allFrameMaxs = heatmapFrames.map(f => f.cells[f.cells.length - 1]?.priceHigh || f.corridorHigh);
    const yMin = d3.min(allFrameMins) || latestFrame.corridorLow * 0.995;
    const yMax = d3.max(allFrameMaxs) || latestFrame.corridorHigh * 1.005;

    const yScale = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]);

    // Pad X slots to HEATMAP_MAX_FRAMES columns so cells march from right or fill cleanly
    const xDomain = heatmapFrames.map(f => f.id);
    const xScale = d3
      .scaleBand<string>()
      .domain(xDomain)
      .range([0, innerW])
      .paddingInner(0.08)
      .paddingOuter(0.03);

    // Determine intensity scales for live Bid, Ask, and Self-Eating Volume
    let maxBookDepth = 0.0001;
    let maxSelfEat = 0.0001;
    for (const f of heatmapFrames) {
      for (const c of f.cells) {
        if (c.bidDepth > maxBookDepth) maxBookDepth = c.bidDepth;
        if (c.askDepth > maxBookDepth) maxBookDepth = c.askDepth;
        if (c.selfEatBase > maxSelfEat) maxSelfEat = c.selfEatBase;
      }
    }

    const bidColor = d3
      .scaleSqrt<string>()
      .domain([0, maxBookDepth])
      .range(['#101B22', '#16A879']);

    const askColor = d3
      .scaleSqrt<string>()
      .domain([0, maxBookDepth])
      .range(['#151821', '#EA5B65']);

    const selfEatColor = d3
      .scaleSqrt<string>()
      .domain([0, maxSelfEat])
      .range(['#92400E', '#FBBF24']);

    // Background grid hairlines
    const yTicks = yScale.ticks(7);
    root
      .selectAll('.heatmap-grid-y')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#1E2A35')
      .attr('stroke-width', 1);

    // Highlight latest Target Spread Corridor across the entire canvas
    const corrTopY = yScale(latestFrame.corridorHigh);
    const corrBotY = yScale(latestFrame.corridorLow);
    const corrHeight = Math.max(2, corrBotY - corrTopY);

    root
      .append('rect')
      .attr('x', 0)
      .attr('y', corrTopY)
      .attr('width', innerW)
      .attr('height', corrHeight)
      .attr('fill', '#D6A85C')
      .attr('fill-opacity', 0.07);

    // Render Heatmap Matrix Cells
    const frameGroups = root
      .selectAll('.heatmap-frame-col')
      .data(heatmapFrames)
      .enter()
      .append('g')
      .attr('transform', d => `translate(${xScale(d.id) ?? 0},0)`);

    const colWidth = Math.max(4, xScale.bandwidth());

    frameGroups.each(function (frame) {
      const colG = d3.select(this);

      colG
        .selectAll('rect.hm-cell')
        .data(frame.cells)
        .enter()
        .append('rect')
        .attr('class', 'hm-cell')
        .attr('x', 0)
        .attr('y', c => Math.min(yScale(c.priceHigh), yScale(c.priceLow)))
        .attr('width', colWidth)
        .attr('height', c => Math.max(2, Math.abs(yScale(c.priceLow) - yScale(c.priceHigh)) - 1.5))
        .attr('rx', 2)
        .attr('fill', c => {
          if (c.selfEatCount > 0) return selfEatColor(c.selfEatBase);
          if (c.bidDepth > 0 && c.bidDepth >= c.askDepth) return bidColor(c.bidDepth);
          if (c.askDepth > 0) return askColor(c.askDepth);
          return c.inCorridor ? '#17212C' : '#10161D';
        })
        .attr('fill-opacity', c => {
          if (c.selfEatCount > 0) return 0.95;
          if (c.bidDepth > 0 || c.askDepth > 0) return 0.78;
          return c.inCorridor ? 0.55 : 0.35;
        })
        .attr('stroke', c => {
          if (c.selfEatCount > 0) {
            return c.lastTakerSide === 'BUY' ? '#FDE68A' : '#38BDF8';
          }
          return 'none';
        })
        .attr('stroke-width', c => (c.selfEatCount > 0 ? 1.25 : 0))
        .style('cursor', 'crosshair')
        .on('mouseenter', function (_event, cell) {
          d3.select(this).attr('stroke', '#E4EBEF').attr('stroke-width', 1.5);
          setHoveredCell({
            frameLabel: frame.label,
            timestamp: frame.timestamp,
            cell,
            corridorLow: frame.corridorLow,
            corridorHigh: frame.corridorHigh,
            midPrice: frame.midPrice,
          });
        })
        .on('mouseleave', function (_event, cell) {
          d3.select(this)
            .attr(
              'stroke',
              cell.selfEatCount > 0
                ? cell.lastTakerSide === 'BUY'
                  ? '#FDE68A'
                  : '#38BDF8'
                : 'none'
            )
            .attr('stroke-width', cell.selfEatCount > 0 ? 1.25 : 0);
          setHoveredCell(null);
        });
    });

    // Trajectory line linking consecutive self-eating prints inside the spread
    const execFrames = heatmapFrames.filter(f => f.lastExecPrice !== null);
    if (execFrames.length >= 2) {
      const trajLine = d3
        .line<HeatmapFrame>()
        .x(f => (xScale(f.id) ?? 0) + colWidth / 2)
        .y(f => yScale(f.lastExecPrice!))
        .curve(d3.curveMonotoneX);

      root
        .append('path')
        .datum(execFrames)
        .attr('fill', 'none')
        .attr('stroke', '#FBBF24')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.55)
        .attr('stroke-dasharray', '3,3')
        .attr('d', trajLine);
    }

    // Highlighted Self-Eating Pattern Nodes (diamond/circle markers)
    root
      .selectAll('.self-eat-node')
      .data(execFrames)
      .enter()
      .append('circle')
      .attr('class', 'self-eat-node')
      .attr('cx', f => (xScale(f.id) ?? 0) + colWidth / 2)
      .attr('cy', f => yScale(f.lastExecPrice!))
      .attr('r', Math.min(5.5, Math.max(3, colWidth * 0.24)))
      .attr('fill', f => (f.lastTakerSide === 'BUY' ? '#35B887' : '#38BDF8'))
      .attr('stroke', '#FDE68A')
      .attr('stroke-width', 1.5)
      .style('pointer-events', 'none');

    // Reference Hairlines: Live Best Ask, Target High, Mid, Target Low, Live Best Bid
    const refLines: { y: number; color: string; dash: string; label: string }[] = [
      { y: yScale(latestFrame.bestAsk), color: '#EA5B65', dash: '2,3', label: 'Best Ask' },
      { y: yScale(latestFrame.corridorHigh), color: '#D6A85C', dash: '5,3', label: 'Spread +%' },
      { y: yScale(latestFrame.midPrice), color: '#71818B', dash: '2,4', label: 'Mid' },
      { y: yScale(latestFrame.corridorLow), color: '#D6A85C', dash: '5,3', label: 'Spread -%' },
      { y: yScale(latestFrame.bestBid), color: '#35B887', dash: '2,3', label: 'Best Bid' },
    ];

    for (const rl of refLines) {
      if (rl.y < -4 || rl.y > innerH + 4) continue;
      root
        .append('line')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', rl.y)
        .attr('y2', rl.y)
        .attr('stroke', rl.color)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', rl.dash)
        .attr('stroke-opacity', 0.8);
    }

    // Right Price Y-Axis
    const yAxis = d3
      .axisRight(yScale)
      .ticks(7)
      .tickFormat(d => formatCompactPrice(Number(d), selectedPair.quoteCurrency));

    const yAxisG = root
      .append('g')
      .attr('transform', `translate(${innerW},0)`)
      .call(yAxis);

    yAxisG.selectAll('path, line').attr('stroke', '#202B34');
    yAxisG
      .selectAll('text')
      .attr('fill', '#A1AFB8')
      .attr('font-size', '10px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace');

    // Bottom Time X-Axis (sampled labels so timestamps never overlap)
    const tickStep = Math.max(1, Math.ceil(heatmapFrames.length / 6));
    const sampledIds = heatmapFrames.filter((_, idx) => idx % tickStep === 0 || idx === heatmapFrames.length - 1).map(f => f.id);
    const idToLabel = new Map(heatmapFrames.map(f => [f.id, f.label]));

    const xAxis = d3
      .axisBottom(xScale)
      .tickValues(sampledIds)
      .tickFormat(id => idToLabel.get(String(id)) || '');

    const xAxisG = root
      .append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis);

    xAxisG.selectAll('path, line').attr('stroke', '#202B34');
    xAxisG
      .selectAll('text')
      .attr('fill', '#71818B')
      .attr('font-size', '10px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace');
  }, [heatmapFrames, selectedPair.quoteCurrency]);

  const liveMidDisplay = depthSnap
    ? formatPriceNumber(depthSnap.midPrice, selectedPair.quoteCurrency, selectedPair.quoteDecimals)
    : '—';
  const liveBidDisplay = depthSnap
    ? formatPriceNumber(depthSnap.bestBid, selectedPair.quoteCurrency, selectedPair.quoteDecimals)
    : '—';
  const liveAskDisplay = depthSnap
    ? formatPriceNumber(depthSnap.bestAsk, selectedPair.quoteCurrency, selectedPair.quoteDecimals)
    : '—';

  return (
    <div className="flex flex-col gap-5">
      {/* Header & Execution Controls */}
      <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-4 border-b border-[#202B34]">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <h2 className="text-base font-semibold text-[#E4EBEF]">
                Market Maker Internal Spread — Self-Eating Engine
              </h2>
              <StatusBadge tone={isRunning ? 'success' : totalCycles > 0 ? 'warning' : 'neutral'}>
                {isRunning ? 'SIMULATING' : totalCycles > 0 ? 'PAUSED' : 'IDLE'}
              </StatusBadge>
            </div>
            <p className="text-xs text-[#A1AFB8]">
              Simulasi pencocokan order offsetting Buy/Sell di dalam koridor spread sempit ({currentEnv}) dengan visualisasi D3.js Spread Heatmap real-time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={isRunning ? 'danger' : 'profit'}
              size="sm"
              onClick={handleToggleRun}
              icon={isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              className="whitespace-nowrap"
            >
              {isRunning ? 'Pause Self-Eating' : 'Start Self-Eating'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void executeSimulatedSelfEatingTick()}
              icon={<StepForward className="w-3.5 h-3.5" />}
              className="whitespace-nowrap"
            >
              Step Once
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchLiveOrderBook(true)}
              icon={<RefreshCw className={`w-3.5 h-3.5 ${isDepthLoading ? 'animate-spin' : ''}`} />}
              className="whitespace-nowrap"
            >
              Sync Book
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleResetSimulation()}
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              className="whitespace-nowrap"
            >
              Reset
            </Button>
          </div>
        </div>

        {/* Bot Configuration Controls Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Trading Pair */}
          <div>
            <label className="text-xs text-[#A1AFB8] block mb-1.5 font-medium">Trading Pair</label>
            <select
              value={selectedPair.id}
              onChange={e => setSelectedPairId(e.target.value)}
              className="w-full bg-[#111820] text-[#E4EBEF] text-xs p-2.5 rounded-[7px] border border-[#2B3944] focus:outline-none focus:border-[#35B887] font-mono"
            >
              {tradingPairs.map(p => (
                <option key={p.id} value={p.id}>
                  {p.id} ({p.baseCurrency}/{p.quoteCurrency})
                </option>
              ))}
            </select>
            <div className="text-[11px] text-[#71818B] font-mono tabular-nums mt-1.5">
              Mid: {liveMidDisplay}
            </div>
          </div>

          {/* Target Spread Percentage */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-[#A1AFB8] font-medium">Target Spread (%)</label>
              <span className="text-[11px] font-mono tabular-nums text-[#D6A85C]">
                ±{(parsedTargetSpreadPct / 2).toFixed(3)}%
              </span>
            </div>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="10"
              value={targetSpreadPct}
              onChange={e => setTargetSpreadPct(e.target.value)}
              className="w-full bg-[#111820] text-[#E4EBEF] text-xs p-2.5 rounded-[7px] border border-[#2B3944] focus:outline-none focus:border-[#D6A85C] font-mono tabular-nums"
            />
            <div className="flex items-center gap-1 mt-1.5">
              {['0.05', '0.15', '0.25', '0.50', '1.00'].map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTargetSpreadPct(preset)}
                  className={`px-1.5 py-0.5 text-[10px] font-mono rounded border transition-colors cursor-pointer ${
                    targetSpreadPct === preset
                      ? 'bg-[#2C2415] text-[#D6A85C] border-[#D6A85C]/50'
                      : 'bg-[#17212B] text-[#71818B] border-[#202B34] hover:text-[#E4EBEF]'
                  }`}
                >
                  {preset}%
                </button>
              ))}
            </div>
          </div>

          {/* Order Volume */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-[#A1AFB8] font-medium">
                Order Volume ({selectedPair.baseCurrency})
              </label>
              <span className="text-[11px] font-mono tabular-nums text-[#71818B]">
                ±{volumeJitterPct}% jitter
              </span>
            </div>
            <input
              type="number"
              step="0.0001"
              min="0.0001"
              value={orderVolume}
              onChange={e => setOrderVolume(e.target.value)}
              className="w-full bg-[#111820] text-[#E4EBEF] text-xs p-2.5 rounded-[7px] border border-[#2B3944] focus:outline-none focus:border-[#35B887] font-mono tabular-nums"
            />
            <input
              type="range"
              min={0}
              max={30}
              step={5}
              value={volumeJitterPct}
              onChange={e => setVolumeJitterPct(Number(e.target.value))}
              aria-label="Volume random jitter percentage"
              className="w-full mt-2 accent-[#35B887] cursor-pointer"
            />
          </div>

          {/* Execution Frequency Interval */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-[#A1AFB8] font-medium">Frequency Interval (ms)</label>
              <span className="text-[11px] font-mono tabular-nums text-[#35B887]">
                {(1000 / Math.max(200, executionIntervalMs)).toFixed(2)} tx/s
              </span>
            </div>
            <input
              type="number"
              step={50}
              min={200}
              max={10000}
              value={executionIntervalMs}
              onChange={e => setExecutionIntervalMs(Math.max(200, Math.min(10000, Number(e.target.value) || 1000)))}
              className="w-full bg-[#111820] text-[#E4EBEF] text-xs p-2.5 rounded-[7px] border border-[#2B3944] focus:outline-none focus:border-[#35B887] font-mono tabular-nums"
            />
            <div className="flex items-center gap-1 mt-1.5">
              {[400, 800, 1200, 2500].map(ms => (
                <button
                  key={ms}
                  type="button"
                  onClick={() => setExecutionIntervalMs(ms)}
                  className={`px-1.5 py-0.5 text-[10px] font-mono rounded border transition-colors cursor-pointer ${
                    executionIntervalMs === ms
                      ? 'bg-[#12392F] text-[#35B887] border-[#16A879]/50'
                      : 'bg-[#17212B] text-[#71818B] border-[#202B34] hover:text-[#E4EBEF]'
                  }`}
                >
                  {ms}ms
                </button>
              ))}
            </div>
          </div>

          {/* Self-Eating Side Pattern */}
          <div>
            <label className="text-xs text-[#A1AFB8] block mb-1.5 font-medium">Offsetting Side Pattern</label>
            <select
              value={directionMode}
              onChange={e => setDirectionMode(e.target.value as OffsetDirectionMode)}
              className="w-full bg-[#111820] text-[#E4EBEF] text-xs p-2.5 rounded-[7px] border border-[#2B3944] focus:outline-none focus:border-[#35B887]"
            >
              <option value="ALTERNATE">Alternate (Buy ↔ Sell)</option>
              <option value="BUY_EATS_SELL">Buy Taker Eats Sell Maker</option>
              <option value="SELL_EATS_BUY">Sell Taker Eats Buy Maker</option>
              <option value="RANDOM">Random Spread Cross</option>
            </select>
            <div className="text-[11px] text-[#71818B] font-mono tabular-nums mt-1.5">
              Live Phase 2 bots on pair: {livePhase2SpreadBots.length}
            </div>
          </div>
        </div>
      </div>

      {/* Strategy Presets Panel */}
      <section
        aria-label="Strategy Presets"
        className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 mb-4 border-b border-[#202B34]">
          <div>
            <h3 className="text-sm font-semibold text-[#E4EBEF]">Strategy Presets</h3>
            <p className="text-xs text-[#A1AFB8] mt-0.5">
              Simpan dan muat preset parameter Internal Spread untuk menerapkan strategi secara instan.
            </p>
          </div>

          <form onSubmit={handleSavePreset} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newPresetName}
              onChange={e => setNewPresetName(e.target.value)}
              placeholder="Nama preset baru..."
              aria-label="New strategy preset name"
              className="bg-[#111820] text-[#E4EBEF] placeholder:text-[#71818B] text-xs px-3 h-8 rounded-[7px] border border-[#2B3944] focus:outline-none focus:border-[#35B887] w-44"
            />
            <input
              type="text"
              value={newPresetDesc}
              onChange={e => setNewPresetDesc(e.target.value)}
              placeholder="Catatan singkat (opsional)"
              aria-label="New strategy preset notes"
              className="bg-[#111820] text-[#E4EBEF] placeholder:text-[#71818B] text-xs px-3 h-8 rounded-[7px] border border-[#2B3944] focus:outline-none focus:border-[#35B887] w-52 hidden sm:block"
            />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              icon={<BookmarkPlus className="w-3.5 h-3.5" />}
              className="whitespace-nowrap"
            >
              Save Current Preset
            </Button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[11px] font-mono text-[#71818B] border-b border-[#202B34]">
                <th className="py-2 pr-4 font-medium">Preset</th>
                <th className="py-2 px-3 font-medium text-right">Target Spread</th>
                <th className="py-2 px-3 font-medium text-right">Order Volume</th>
                <th className="py-2 px-3 font-medium text-right">Jitter</th>
                <th className="py-2 px-3 font-medium text-right">Interval</th>
                <th className="py-2 px-3 font-medium">Side Pattern</th>
                <th className="py-2 pl-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202B34]">
              {strategyPresets.map(preset => {
                const isActive = doesMatchPreset(preset);
                return (
                  <tr
                    key={preset.id}
                    className={`transition-colors ${
                      isActive ? 'bg-[#17212B]/80' : 'hover:bg-[#17212B]/40'
                    }`}
                  >
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#E4EBEF] whitespace-nowrap">
                          {preset.name}
                        </span>
                        <span className="text-[11px] text-[#71818B]">
                          · {preset.isBuiltIn ? 'Default' : 'Saved'}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#A1AFB8] mt-0.5 line-clamp-1">
                        {preset.description}
                      </p>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#D6A85C] whitespace-nowrap">
                      {Number(preset.targetSpreadPct).toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#E4EBEF] whitespace-nowrap">
                      {preset.orderVolume} {selectedPair.baseCurrency}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#A1AFB8] whitespace-nowrap">
                      ±{preset.volumeJitterPct}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#35B887] whitespace-nowrap">
                      {preset.executionIntervalMs}ms
                    </td>
                    <td className="py-2.5 px-3 text-[#A1AFB8] whitespace-nowrap">
                      {DIRECTION_LABELS[preset.directionMode]}
                    </td>
                    <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <Button
                          variant={isActive ? 'profit' : 'outline'}
                          size="sm"
                          onClick={() => handleApplyPreset(preset)}
                          icon={isActive ? <Check className="w-3.5 h-3.5" /> : undefined}
                          className="whitespace-nowrap"
                        >
                          {isActive ? 'Applied' : 'Load'}
                        </Button>
                        {!preset.isBuiltIn && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeletePreset(preset)}
                            aria-label={`Delete preset ${preset.name}`}
                            title={`Hapus preset ${preset.name}`}
                            icon={<Trash2 className="w-3.5 h-3.5 text-[#EA5B65]" />}
                            className="whitespace-nowrap"
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Telemetry Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4">
          <div className="text-xs text-[#71818B] mb-1">Live Best Bid / Best Ask</div>
          <div className="text-xs font-mono tabular-nums text-[#E4EBEF] flex items-center gap-1.5">
            <span className="text-[#35B887]">{liveBidDisplay}</span>
            <span className="text-[#71818B]">/</span>
            <span className="text-[#EA5B65]">{liveAskDisplay}</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#A1AFB8] mt-1">
            Market Spread: {depthSnap ? `${depthSnap.liveSpreadPct.toFixed(3)}%` : '—'}
          </div>
        </div>

        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4">
          <div className="text-xs text-[#71818B] mb-1">Self-Eating Cycles</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-[#E4EBEF]">
            {totalCycles.toLocaleString('id-ID')}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#D6A85C] mt-1">
            Target Corridor: {parsedTargetSpreadPct.toFixed(2)}%
          </div>
        </div>

        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4">
          <div className="text-xs text-[#71818B] mb-1">Generated Base Volume</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-[#35B887]">
            {totalVolumeBase.toFixed(4)} {selectedPair.baseCurrency}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#A1AFB8] mt-1">
            Per tick: ~{parsedOrderVolume} {selectedPair.baseCurrency}
          </div>
        </div>

        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4">
          <div className="text-xs text-[#71818B] mb-1">Generated Quote Turnover</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-[#D6A85C] truncate">
            {formatPriceNumber(totalVolumeQuote, selectedPair.quoteCurrency, selectedPair.quoteDecimals)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#A1AFB8] mt-1">
            Last offset vs mid:{' '}
            {lastExecSpreadPct !== null
              ? `${lastExecSpreadPct >= 0 ? '+' : ''}${lastExecSpreadPct.toFixed(4)}%`
              : '—'}
          </div>
        </div>
      </div>

      {/* Main Workspace: D3.js Spread Heatmap (Left 2/3) + Offsetting Order Tape (Right 1/3) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* D3.js Spread Heatmap Card */}
        <div className="xl:col-span-8 bg-[#141C24] border border-[#202B34] rounded-[10px] p-4 flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-[#202B34]">
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">
                Real-Time Spread Heatmap ({selectedPair.id})
              </h3>
              <p className="text-xs text-[#A1AFB8]">
                Visualisasi intensitas Bid-Ask order book dan pola eksekusi self-eating di dalam koridor spread.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-[#A1AFB8]">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#16A879] inline-block" />
                Bid Depth
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#EA5B65] inline-block" />
                Ask Depth
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#D6A85C]/30 border border-[#D6A85C] inline-block" />
                Target Spread
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#FBBF24] border border-[#FDE68A] inline-block" />
                Self-Eating Match
              </span>
            </div>
          </div>

          <div className="relative bg-[#0C1117] border border-[#202B34] rounded-[8px] p-2">
            {heatmapFrames.length === 0 ? (
              <div className="h-[360px] flex flex-col items-center justify-center text-center px-4">
                <p className="text-xs text-[#A1AFB8] mb-3">
                  Memuat snapshot order book untuk membangun Spread Heatmap...
                </p>
                <Button variant="secondary" size="sm" onClick={() => void fetchLiveOrderBook(true)}>
                  Muat Order Book
                </Button>
              </div>
            ) : (
              <svg ref={heatmapSvgRef} className="w-full h-auto block select-none" />
            )}

            {/* Interactive Hover Cell Inspector */}
            {hoveredCell && (
              <div className="mt-2 px-3 py-2 bg-[#111820] border border-[#2B3944] rounded-[6px] flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono tabular-nums">
                <div className="text-[#E4EBEF]">
                  Waktu <span className="text-[#D6A85C]">{hoveredCell.frameLabel}</span> · Level{' '}
                  <span className="text-[#E4EBEF]">
                    {formatPriceNumber(
                      hoveredCell.cell.priceMid,
                      selectedPair.quoteCurrency,
                      selectedPair.quoteDecimals
                    )}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <span className="text-[#35B887]">
                    Bid Depth: {hoveredCell.cell.bidDepth.toFixed(4)}
                  </span>
                  <span className="text-[#EA5B65]">
                    Ask Depth: {hoveredCell.cell.askDepth.toFixed(4)}
                  </span>
                  <span className="text-[#FBBF24]">
                    Self-Eaten: {hoveredCell.cell.selfEatBase.toFixed(4)} {selectedPair.baseCurrency} (
                    {hoveredCell.cell.selfEatCount} tx)
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Simulated Offsetting Order-Matching Tape */}
        <div className="xl:col-span-4 bg-[#141C24] border border-[#202B34] rounded-[10px] p-4 flex flex-col">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#202B34]">
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">Self-Eating Match Tape</h3>
              <p className="text-xs text-[#A1AFB8]">Order offsetting Buy/Sell yang langsung termakan.</p>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-[#71818B]">
              {simEvents.length} events
            </span>
          </div>

          {simEvents.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10 px-4">
              <p className="text-xs text-[#A1AFB8] mb-3">
                Belum ada siklus self-eating pada sesi ini. Tekan Start Self-Eating atau Step Once untuk memicu order offsetting di dalam spread.
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void executeSimulatedSelfEatingTick()}
                icon={<StepForward className="w-3.5 h-3.5" />}
              >
                Jalankan 1 Siklus
              </Button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto max-h-[380px] divide-y divide-[#202B34]">
              {simEvents.map(ev => (
                <div
                  key={ev.id}
                  className="py-2.5 flex items-center justify-between gap-2 text-xs font-mono tabular-nums hover:bg-[#17212B]/60 px-1.5 rounded transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-semibold ${
                          ev.takerSide === 'BUY' ? 'text-[#35B887]' : 'text-[#38BDF8]'
                        }`}
                      >
                        {ev.takerSide === 'BUY' ? 'BUY ▸ SELL' : 'SELL ▸ BUY'}
                      </span>
                      <span className="text-[#71818B] text-[10px]">
                        {new Date(ev.timestamp).toTimeString().slice(0, 8)}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#71818B] truncate mt-0.5">
                      {ev.makerOrderId} ↔ {ev.takerOrderId}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-[#E4EBEF]">
                      {formatPriceNumber(
                        ev.execPrice,
                        selectedPair.quoteCurrency,
                        selectedPair.quoteDecimals
                      )}
                    </div>
                    <div className="text-[11px] text-[#D6A85C]">
                      {ev.volumeBase.toFixed(4)} {selectedPair.baseCurrency} ·{' '}
                      {ev.spreadPctFromMid >= 0 ? '+' : ''}
                      {ev.spreadPctFromMid.toFixed(3)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
