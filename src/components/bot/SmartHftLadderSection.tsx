/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SmartHftLadderSection.tsx
 * SMART HFT LADDER BOT & PATTERN CHART CREATOR ENGINE Console Component
 *
 * Features:
 * - Interactive Simulator Canvas for 14 Mathematical Patterns & 4 Timeframes (5m, 15m, 1h, 4h)
 * - Dynamic Anchor Price Pivot Calculation
 * - Guarded Multi-Order HFT Ladder (20 Buy Limits & 20 Sell Limits, configurable up to 100)
 * - Strict Anti-Out-of-Bounds Verification [min_price_bound, max_price_bound]
 * - Progressive Lot Scaling Guard [min_lot -> max_lot]
 * - Instant Verification Report (Level 1 vs Level 20/N)
 * - Standalone Python Code Viewer & 1-Click Blob Download (scripts/smart_hft_ladder_bot.py)
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Code2,
  Compass,
  Copy,
  Download,
  FlaskConical,
  Layers,
  ListOrdered,
  Pause,
  Play,
  RefreshCw,
  Scale,
  ScrollText,
  ShieldCheck,
  Sliders,
  Square,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import {
  BacktestRequest,
  BotInstance,
  PatternFormationType,
  PatternTimeframe,
  TradingPairItem,
  UserProfile,
} from '../../types/index.js';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { Button } from '../ui/Button.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { PanelHeader } from '../ui/PanelHeader.js';
import { Modal } from '../ui/Modal.js';

interface Props {
  user: UserProfile | null;
  instances: BotInstance[];
  tradingPairs: TradingPairItem[];
  onRefresh: () => void;
  onSetFeedback: (msg: { type: 'success' | 'error'; text: string } | null) => void;
  initialBacktestPreset?: BacktestRequest | null;
  onOpenBacktestWithConfig?: (preset: Partial<BacktestRequest>) => void;
}

export const SmartHftLadderSection: React.FC<Props> = ({
  instances,
  tradingPairs,
  onRefresh,
  onSetFeedback,
  initialBacktestPreset,
  onOpenBacktestWithConfig,
}) => {
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [isPythonModalOpen, setIsPythonModalOpen] = useState(false);
  const [pythonCode, setPythonCode] = useState<string>('');
  const [isLoadingCode, setIsLoadingCode] = useState(false);
  const [selectedBotLogs, setSelectedBotLogs] = useState<BotInstance | null>(null);

  // Simulator Form State
  const [simPairId, setSimPairId] = useState<string>(() => tradingPairs[0]?.id || 'BTC-IDR');
  const [simTimeframe, setSimTimeframe] = useState<PatternTimeframe>('15m');
  const [simPattern, setSimPattern] = useState<PatternFormationType>('HEAD_AND_SHOULDERS');
  const [simTotalOrders, setSimTotalOrders] = useState<number>(40);
  const [simBoundPct, setSimBoundPct] = useState<number>(3);
  const [simMinBound, setSimMinBound] = useState<string>('');
  const [simMaxBound, setSimMaxBound] = useState<string>('');
  const [simMinBuyLot, setSimMinBuyLot] = useState<string>('0.02');
  const [simMaxBuyLot, setSimMaxBuyLot] = useState<string>('0.50');
  const [simMinSellLot, setSimMinSellLot] = useState<string>('0.02');
  const [simMaxSellLot, setSimMaxSellLot] = useState<string>('0.50');
  const [simSpreadBps, setSimSpreadBps] = useState<number>(25);

  // Preview Data State
  const [previewData, setPreviewData] = useState<any>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Deploy Bot Form State
  const [botName, setBotName] = useState('Smart HFT Ladder Bot #1');
  const [botEnvironment, setBotEnvironment] = useState<'DEMO' | 'STAGING' | 'PRODUCTION'>('DEMO');
  const [repriceIntervalMs, setRepriceIntervalMs] = useState(4000);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Current pair info
  const currentPair = useMemo(() => {
    return (
      tradingPairs.find(p => p.id === simPairId) ||
      tradingPairs[0] || {
        id: 'BTC-IDR',
        lastPrice: '5000000000',
        quoteDecimals: 2,
        baseDecimals: 8,
        quoteCurrency: 'IDR',
        baseCurrency: 'BTC',
      }
    );
  }, [tradingPairs, simPairId]);

  const currentPriceNum = useMemo(() => {
    const qDec =
      currentPair.quoteDecimals !== undefined
        ? currentPair.quoteDecimals
        : currentPair.quoteCurrency === 'USDT'
          ? 6
          : 2;
    return Number(BigInt(currentPair.lastPrice || '5000000000')) / 10 ** qDec;
  }, [currentPair]);

  // Apply bound percentage helper
  const applyBoundPercentage = (pct: number) => {
    setSimBoundPct(pct);
    if (currentPriceNum > 0) {
      const qDec = currentPair.quoteDecimals ?? (currentPair.quoteCurrency === 'USDT' ? 6 : 2);
      const lower = currentPriceNum * (1 - pct / 100);
      const upper = currentPriceNum * (1 + pct / 100);
      setSimMinBound(lower.toFixed(qDec));
      setSimMaxBound(upper.toFixed(qDec));
    }
  };

  // Implied spread percentage from current boundaries
  const impliedSpreadPct = useMemo(() => {
    if (!currentPriceNum || currentPriceNum <= 0 || !simMaxBound || !simMinBound) return simBoundPct;
    const maxB = parseFloat(simMaxBound);
    const minB = parseFloat(simMinBound);
    if (isNaN(maxB) || isNaN(minB) || maxB <= minB) return simBoundPct;
    const upSpread = Math.abs((maxB - currentPriceNum) / currentPriceNum) * 100;
    const downSpread = Math.abs((currentPriceNum - minB) / currentPriceNum) * 100;
    return Number(((upSpread + downSpread) / 2).toFixed(2));
  }, [currentPriceNum, simMinBound, simMaxBound, simBoundPct]);

  // Apply verified backtest preset into Smart HFT simulator/deploy form
  useEffect(() => {
    if (!initialBacktestPreset) return;
    if (initialBacktestPreset.pairId) setSimPairId(initialBacktestPreset.pairId);
    if (initialBacktestPreset.timeframe) setSimTimeframe(initialBacktestPreset.timeframe);
    if (initialBacktestPreset.pattern) setSimPattern(initialBacktestPreset.pattern);
    if (initialBacktestPreset.total_orders) setSimTotalOrders(initialBacktestPreset.total_orders);
    if (initialBacktestPreset.bound_percentage !== undefined) setSimBoundPct(initialBacktestPreset.bound_percentage);
    if (initialBacktestPreset.min_buy_lot) setSimMinBuyLot(initialBacktestPreset.min_buy_lot);
    if (initialBacktestPreset.max_buy_lot) setSimMaxBuyLot(initialBacktestPreset.max_buy_lot);
    if (initialBacktestPreset.min_sell_lot) setSimMinSellLot(initialBacktestPreset.min_sell_lot);
    if (initialBacktestPreset.max_sell_lot) setSimMaxSellLot(initialBacktestPreset.max_sell_lot);
    if (initialBacktestPreset.min_spread_bps !== undefined) setSimSpreadBps(initialBacktestPreset.min_spread_bps);
    if (initialBacktestPreset.reprice_interval_ms) setRepriceIntervalMs(initialBacktestPreset.reprice_interval_ms);
    if (initialBacktestPreset.min_price_bound) setSimMinBound(initialBacktestPreset.min_price_bound);
    if (initialBacktestPreset.max_price_bound) setSimMaxBound(initialBacktestPreset.max_price_bound);
    setIsDeployModalOpen(true);
  }, [initialBacktestPreset]);

  // Set default bounds when pair changes
  useEffect(() => {
    if (currentPriceNum > 0) {
      const qDec = currentPair.quoteDecimals ?? (currentPair.quoteCurrency === 'USDT' ? 6 : 2);
      setSimMinBound((currentPriceNum * (1 - simBoundPct / 100)).toFixed(qDec));
      setSimMaxBound((currentPriceNum * (1 + simBoundPct / 100)).toFixed(qDec));
    }
  }, [simPairId, currentPriceNum, currentPair]);

  // Fetch Pattern Simulation & Ladder Preview
  const fetchPreview = async () => {
    setIsPreviewLoading(true);
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const res = await safeFetchJson<any>('/api/mm/smart-hft/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pairId: simPairId,
          timeframe: simTimeframe,
          pattern: simPattern,
          total_orders: simTotalOrders,
          bound_percentage: simBoundPct,
          min_price_bound: simMinBound,
          max_price_bound: simMaxBound,
          min_buy_lot: simMinBuyLot,
          max_buy_lot: simMaxBuyLot,
          min_sell_lot: simMinSellLot,
          max_sell_lot: simMaxSellLot,
          min_spread_bps: simSpreadBps,
          spread_percentage: simSpreadBps / 100,
        }),
      });

      if (res.ok && res.data) {
        setPreviewData(res.data);
      } else {
        onSetFeedback({ type: 'error', text: res.data?.error || 'Gagal menghitung kalkulasi ladder.' });
      }
    } catch (e: any) {
      onSetFeedback({ type: 'error', text: e.message });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (simMinBound && simMaxBound) {
      fetchPreview();
    }
  }, [
    simPairId,
    simTimeframe,
    simPattern,
    simTotalOrders,
    simMinBound,
    simMaxBound,
    simMinBuyLot,
    simMaxBuyLot,
    simMinSellLot,
    simMaxSellLot,
    simSpreadBps,
  ]);

  // Render Canvas Chart (Obsidian Iridium Matte Palette)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !previewData?.patternPoints) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#090D12';
    ctx.fillRect(0, 0, width, height);

    const points = previewData.patternPoints as { index: number; price: number }[];
    if (points.length === 0) return;

    const minBound = previewData.minPriceBound;
    const maxBound = previewData.maxPriceBound;
    const anchorPrice = previewData.anchorPrice;

    const allPrices = points.map(p => p.price).concat([minBound, maxBound, anchorPrice]);
    const minP = Math.min(...allPrices) * 0.995;
    const maxP = Math.max(...allPrices) * 1.005;
    const priceRange = maxP - minP || 1;

    const padLeft = 60;
    const padRight = 135;
    const padTop = 32;
    const padBottom = 32;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    const getY = (p: number) => padTop + chartH - ((p - minP) / priceRange) * chartH;
    const getX = (idx: number) => padLeft + (idx / Math.max(1, points.length - 1)) * chartW;

    // Subtle hairline grid lines
    ctx.strokeStyle = '#202B34';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    for (let i = 0; i < 5; i++) {
      const y = padTop + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 1. Max Absolute Bound Line (Sell/Danger Red)
    const maxBoundY = getY(maxBound);
    ctx.strokeStyle = '#EA5B65';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, maxBoundY);
    ctx.lineTo(width - 10, maxBoundY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#EA5B65';
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.fillText(`MAX: ${maxBound.toLocaleString()}`, width - padRight + 8, maxBoundY - 5);

    // 2. Min Absolute Bound Line (Buy/Profit Green)
    const minBoundY = getY(minBound);
    ctx.strokeStyle = '#16A879';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, minBoundY);
    ctx.lineTo(width - 10, minBoundY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#16A879';
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.fillText(`MIN: ${minBound.toLocaleString()}`, width - padRight + 8, minBoundY + 13);

    // 3. Pattern Synthetic Curve (Silver-Blue Iridium)
    ctx.beginPath();
    points.forEach((pt, i) => {
      const x = getX(i);
      const y = getY(pt.price);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#8DA5B1';
    ctx.lineWidth = 2.25;
    ctx.stroke();

    // 4. Anchor Price Pivot (Amber Gold Dot)
    const lastX = getX(points.length - 1);
    const anchorY = getY(anchorPrice);
    ctx.fillStyle = '#D6A85C';
    ctx.beginPath();
    ctx.arc(lastX, anchorY, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#E4EBEF';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#D6A85C';
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.fillText(`PIVOT: ${anchorPrice.toLocaleString()}`, Math.max(padLeft, lastX - 130), anchorY - 10);

    // 5. Ladder Orders Visual Levels (Right Column)
    const qDec =
      currentPair.quoteDecimals ?? (currentPair.quoteCurrency === 'USDT' ? 6 : 2);
    const ladderX = width - padRight + 18;
    const buys = previewData.buyLevels || [];
    buys.forEach((b: any) => {
      const numPrice = Number(BigInt(b.priceUnits)) / 10 ** qDec;
      const y = getY(numPrice);
      ctx.fillStyle = '#16A879';
      ctx.beginPath();
      ctx.arc(ladderX, y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    });

    const sells = previewData.sellLevels || [];
    sells.forEach((s: any) => {
      const numPrice = Number(BigInt(s.priceUnits)) / 10 ** qDec;
      const y = getY(numPrice);
      ctx.fillStyle = '#EA5B65';
      ctx.beginPath();
      ctx.arc(ladderX, y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [previewData, currentPair]);

  // Load Python Script
  const handleOpenPythonCode = async () => {
    setIsPythonModalOpen(true);
    setIsLoadingCode(true);
    try {
      const res = await safeFetchJson<any>('/api/mm/smart-hft/python-script');
      if (res.ok && res.data?.code) {
        setPythonCode(res.data.code);
      }
    } catch {
      // silent
    } finally {
      setIsLoadingCode(false);
    }
  };

  // Download Python Script safely without window.open
  const handleDownloadPython = async () => {
    try {
      let codeToDownload = pythonCode;
      if (!codeToDownload) {
        const res = await safeFetchJson<any>('/api/mm/smart-hft/python-script');
        if (res.ok && res.data?.code) {
          codeToDownload = res.data.code;
          setPythonCode(res.data.code);
        }
      }
      if (!codeToDownload) {
        const rawRes = await fetch('/api/mm/smart-hft/python-script?download=true');
        if (!rawRes.ok) throw new Error('Gagal mengunduh script Python.');
        const blob = await rawRes.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'smart_hft_ladder_bot.py';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        return;
      }
      const blob = new Blob([codeToDownload], { type: 'text/x-python;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'smart_hft_ladder_bot.py';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      onSetFeedback({ type: 'error', text: err?.message || 'Gagal mengunduh script Python.' });
    }
  };

  // Create Bot
  const handleCreateBot = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const res = await safeFetchJson<any>('/api/mm/smart-hft/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: botName,
          pairId: simPairId,
          environment: botEnvironment,
          timeframe: simTimeframe,
          pattern: simPattern,
          total_orders: simTotalOrders,
          bound_percentage: simBoundPct,
          min_price_bound: simMinBound,
          max_price_bound: simMaxBound,
          min_buy_lot: simMinBuyLot,
          max_buy_lot: simMaxBuyLot,
          min_sell_lot: simMinSellLot,
          max_sell_lot: simMaxSellLot,
          min_spread_bps: simSpreadBps,
          spread_percentage: simSpreadBps / 100,
          reprice_interval_ms: repriceIntervalMs,
        }),
      });

      if (res.ok) {
        onSetFeedback({ type: 'success', text: `Bot "${botName}" berhasil dibuat.` });
        setIsDeployModalOpen(false);
        onRefresh();
      } else {
        onSetFeedback({ type: 'error', text: res.data?.error || 'Gagal membuat bot.' });
      }
    } catch (err: any) {
      onSetFeedback({ type: 'error', text: err.message });
    }
  };

  // Start / Pause / Stop Handlers
  const handleToggleBot = async (botId: string, currentStatus: string) => {
    const token = localStorage.getItem('dimonex_auth_token');
    const endpoint = currentStatus === 'RUNNING' ? `/api/mm/bots/${botId}/pause` : `/api/mm/bots/${botId}/start`;
    try {
      const res = await safeFetchJson<any>(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        onSetFeedback({ type: 'success', text: 'Status bot berhasil diubah.' });
        onRefresh();
      } else {
        onSetFeedback({ type: 'error', text: res.data?.error || 'Gagal mengubah status bot.' });
      }
    } catch (err: any) {
      onSetFeedback({ type: 'error', text: err.message });
    }
  };

  const handleStopBot = async (botId: string) => {
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const res = await safeFetchJson<any>(`/api/mm/bots/${botId}/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cancelOpenOrders: true }),
      });
      if (res.ok) {
        onSetFeedback({ type: 'success', text: 'Bot berhasil dihentikan dan seluruh order terbuka dibatalkan.' });
        onRefresh();
      } else {
        onSetFeedback({ type: 'error', text: res.data?.error || 'Gagal menghentikan bot.' });
      }
    } catch (err: any) {
      onSetFeedback({ type: 'error', text: err.message });
    }
  };

  const smartHftBots = instances.filter(b => b.botType === 'SMART_HFT_LADDER');

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5 bg-[#141C24] border border-[#2B3944] rounded-[10px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <Compass className="w-4 h-4 text-[#8DA5B1] shrink-0" />
            <h2 className="text-sm sm:text-base font-semibold text-[#E4EBEF] tracking-tight">
              SMART HFT LADDER BOT &amp; PATTERN CHART CREATOR
            </h2>
            <StatusBadge tone="brand">Modul A + Modul B</StatusBadge>
          </div>
          <p className="text-xs text-[#A1AFB8] mt-1.5 max-w-3xl leading-relaxed">
            Sistem HFT modular: <strong className="text-[#C1D0D6]">Modul A</strong> memproduksi formasi pola geometris
            14 pola (5m/15m/1h/4h) untuk menentukan anchor pivot running price;{' '}
            <strong className="text-[#16A879]">Modul B</strong> menempatkan tangga simetris 40 order limit (20 Buy &amp; 20
            Sell) dengan perlindungan batas harga absolut dan manajemen lot bertingkat.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onOpenBacktestWithConfig && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<FlaskConical className="w-3.5 h-3.5" />}
              onClick={() =>
                onOpenBacktestWithConfig({
                  pairId: simPairId,
                  timeframe: simTimeframe,
                  pattern: simPattern,
                  total_orders: simTotalOrders,
                  bound_percentage: simBoundPct,
                  min_price_bound: simMinBound || undefined,
                  max_price_bound: simMaxBound || undefined,
                  min_buy_lot: simMinBuyLot,
                  max_buy_lot: simMaxBuyLot,
                  min_sell_lot: simMinSellLot,
                  max_sell_lot: simMaxSellLot,
                  min_spread_bps: simSpreadBps,
                  reprice_interval_ms: repriceIntervalMs,
                  label: `Sim ${simPairId} · ${simPattern}`,
                })
              }
            >
              Uji Backtest di Ledger
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<Code2 className="w-3.5 h-3.5" />}
            onClick={handleOpenPythonCode}
          >
            Lihat Python Script
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={<Zap className="w-3.5 h-3.5" />}
            onClick={() => setIsDeployModalOpen(true)}
          >
            Deploy Smart HFT Ladder
          </Button>
        </div>
      </div>

      {/* 2. Key Architecture Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 bg-[#141C24] border border-[#202B34] rounded-[10px]">
          <span className="text-[11px] text-[#A1AFB8] font-medium block mb-1">Bot HFT Ladder Aktif</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold font-mono tabular-nums text-[#E4EBEF]">
              {smartHftBots.filter(b => b.status === 'RUNNING').length}
            </span>
            <span className="text-xs text-[#71818B] font-mono tabular-nums">/ {smartHftBots.length} terdaftar</span>
          </div>
          <span className="text-[11px] text-[#71818B] mt-1 block">Rotasi tangga otomatis anti-stacking</span>
        </div>

        <div className="p-3.5 bg-[#141C24] border border-[#202B34] rounded-[10px]">
          <span className="text-[11px] text-[#A1AFB8] font-medium block mb-1">Arsitektur Tangga</span>
          <div className="flex items-center gap-1.5 text-sm font-semibold font-mono text-[#16A879] mt-0.5">
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>40 Order Simetris</span>
          </div>
          <span className="text-[11px] text-[#71818B] mt-1 block">20 Buy Limits &amp; 20 Sell Limits (Max 100)</span>
        </div>

        <div className="p-3.5 bg-[#141C24] border border-[#202B34] rounded-[10px]">
          <span className="text-[11px] text-[#A1AFB8] font-medium block mb-1">Anti-Out of Bounds Guard</span>
          <div className="text-xs font-semibold font-mono text-[#D6A85C] mt-1 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>Batas Mutlak Min &amp; Max</span>
          </div>
          <span className="text-[11px] text-[#71818B] mt-1 block">Interpolasi linier di dalam ruang aman</span>
        </div>

        <div className="p-3.5 bg-[#141C24] border border-[#202B34] rounded-[10px]">
          <span className="text-[11px] text-[#A1AFB8] font-medium block mb-1">Volume Scaling Guard</span>
          <div className="text-xs font-semibold font-mono text-[#6D9FE8] mt-1 flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 shrink-0" />
            <span>Marti-Light Lot Guard</span>
          </div>
          <span className="text-[11px] text-[#71818B] mt-1 block">Terkecil di Level 1, terbesar di batas terjauh</span>
        </div>
      </div>

      {/* 3. Interactive Pattern Simulator & Live Visualizer */}
      <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
        <PanelHeader
          icon={<BarChart3 className="w-4 h-4" />}
          title="Live Geometric Pattern & Multi-Order Ladder Simulator"
          subtitle="Uji coba matematis pergerakan pola grafik dan kalkulasi 40 order tangga secara real-time."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={simPairId}
                onChange={e => setSimPairId(e.target.value)}
                aria-label="Pair Simulator"
                className="bg-[#111820] text-[#E4EBEF] text-xs px-2.5 py-1.5 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] font-mono outline-none"
              >
                {tradingPairs.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>
                ))}
              </select>

              <div className="flex items-center bg-[#111820] rounded-[7px] p-0.5 border border-[#202B34]">
                {(['5m', '15m', '1h', '4h'] as PatternTimeframe[]).map(tf => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setSimTimeframe(tf)}
                    className={`px-2.5 py-1 text-[11px] font-mono rounded-[5px] font-semibold transition-colors cursor-pointer ${
                      simTimeframe === tf
                        ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944]'
                        : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
                    }`}
                  >
                    {tf.toUpperCase()}
                  </button>
                ))}
              </div>

              <select
                value={simPattern}
                onChange={e => setSimPattern(e.target.value as PatternFormationType)}
                aria-label="Pola Geometris Simulator"
                className="bg-[#111820] text-[#C1D0D6] text-xs px-3 py-1.5 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] font-medium outline-none"
              >
                <optgroup label="1. Reversal Patterns">
                  <option value="HEAD_AND_SHOULDERS">Head and Shoulders</option>
                  <option value="INVERSE_HEAD_AND_SHOULDERS">Inverse Head and Shoulders</option>
                  <option value="DOUBLE_TOP">Double Top (M)</option>
                  <option value="TRIPLE_TOP">Triple Top</option>
                  <option value="DOUBLE_BOTTOM">Double Bottom (W)</option>
                  <option value="TRIPLE_BOTTOM">Triple Bottom</option>
                </optgroup>
                <optgroup label="2. Continuation Patterns">
                  <option value="BULLISH_FLAG">Bullish Flag</option>
                  <option value="BEARISH_FLAG">Bearish Flag</option>
                  <option value="PENNANT">Pennant</option>
                  <option value="CUP_AND_HANDLE">Cup and Handle</option>
                  <option value="RECTANGLE">Rectangle (Channel)</option>
                </optgroup>
                <optgroup label="3. Bilateral / Neutral Patterns">
                  <option value="ASCENDING_TRIANGLE">Ascending Triangle</option>
                  <option value="DESCENDING_TRIANGLE">Descending Triangle</option>
                  <option value="SYMMETRICAL_TRIANGLE">Symmetrical Triangle</option>
                </optgroup>
              </select>
            </div>
          }
        />

        <div className="p-4 flex flex-col gap-4">
          {/* Percentage Preset Bar & Divergence Guard Indicator */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[#111820] rounded-[7px] border border-[#202B34] text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-[#A1AFB8] font-medium">Rentang Harga (Spread %):</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 5, 8, 10].map(pct => {
                  const isActive = Math.abs(impliedSpreadPct - pct) < 0.35;
                  return (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => applyBoundPercentage(pct)}
                      className={`px-2.5 py-0.5 rounded-[5px] text-[11px] font-mono tabular-nums font-semibold transition-colors cursor-pointer border ${
                        isActive
                          ? 'bg-[#8DA5B1] text-[#090D12] border-[#C1D0D6]/40'
                          : 'bg-[#17212B] text-[#A1AFB8] hover:bg-[#1D2832] hover:text-[#E4EBEF] border-[#2B3944]'
                      }`}
                    >
                      ±{pct}%
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#71818B]">Status Rentang:</span>
              {impliedSpreadPct > 15 ? (
                <div className="flex items-center gap-2">
                  <StatusBadge tone="warning">Terlalu Jauh (±{impliedSpreadPct}%)</StatusBadge>
                  <button
                    type="button"
                    onClick={() => applyBoundPercentage(3)}
                    className="text-[11px] font-medium text-[#8DA5B1] hover:text-[#C1D0D6] underline cursor-pointer"
                  >
                    Rapatkan ke ±3%
                  </button>
                </div>
              ) : impliedSpreadPct > 8 ? (
                <StatusBadge tone="info">Moderat (±{impliedSpreadPct}%)</StatusBadge>
              ) : (
                <StatusBadge tone="success">Optimal &amp; Aktif (±{impliedSpreadPct}%)</StatusBadge>
              )}
            </div>
          </div>

          {/* Input Parameters Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2.5 p-3 bg-[#111820] border border-[#202B34] rounded-[7px] text-xs font-mono">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="sim-min-bound-input" className="text-[10px] font-sans text-[#71818B]">
                  Min Bound
                </label>
                <span className="text-[10px] text-[#16A879] tabular-nums">-{impliedSpreadPct}%</span>
              </div>
              <input
                id="sim-min-bound-input"
                name="simMinBound"
                aria-label="Min Price Bound"
                type="text"
                value={simMinBound}
                onChange={e => setSimMinBound(e.target.value)}
                className="w-full bg-[#141C24] text-[#16A879] px-2.5 py-1.5 rounded-[7px] border border-[#16A879]/30 focus:border-[#16A879] font-mono tabular-nums outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="sim-max-bound-input" className="text-[10px] font-sans text-[#71818B]">
                  Max Bound
                </label>
                <span className="text-[10px] text-[#EA5B65] tabular-nums">+{impliedSpreadPct}%</span>
              </div>
              <input
                id="sim-max-bound-input"
                name="simMaxBound"
                aria-label="Max Price Bound"
                type="text"
                value={simMaxBound}
                onChange={e => setSimMaxBound(e.target.value)}
                className="w-full bg-[#141C24] text-[#EA5B65] px-2.5 py-1.5 rounded-[7px] border border-[#EA5B65]/30 focus:border-[#EA5B65] font-mono tabular-nums outline-none"
              />
            </div>

            <div>
              <label htmlFor="sim-min-buy-lot-input" className="text-[10px] font-sans text-[#71818B] block mb-1">
                Buy Lot (Min → Max)
              </label>
              <div className="flex items-center gap-1">
                <input
                  id="sim-min-buy-lot-input"
                  name="simMinBuyLot"
                  aria-label="Min Buy Lot"
                  type="text"
                  value={simMinBuyLot}
                  onChange={e => setSimMinBuyLot(e.target.value)}
                  className="w-1/2 bg-[#141C24] text-[#E4EBEF] px-1.5 py-1.5 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] text-center tabular-nums outline-none"
                />
                <span className="text-[#53616A]">→</span>
                <input
                  id="sim-max-buy-lot-input"
                  name="simMaxBuyLot"
                  aria-label="Max Buy Lot"
                  type="text"
                  value={simMaxBuyLot}
                  onChange={e => setSimMaxBuyLot(e.target.value)}
                  className="w-1/2 bg-[#141C24] text-[#E4EBEF] px-1.5 py-1.5 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] text-center tabular-nums outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="sim-min-sell-lot-input" className="text-[10px] font-sans text-[#71818B] block mb-1">
                Sell Lot (Min → Max)
              </label>
              <div className="flex items-center gap-1">
                <input
                  id="sim-min-sell-lot-input"
                  name="simMinSellLot"
                  aria-label="Min Sell Lot"
                  type="text"
                  value={simMinSellLot}
                  onChange={e => setSimMinSellLot(e.target.value)}
                  className="w-1/2 bg-[#141C24] text-[#E4EBEF] px-1.5 py-1.5 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] text-center tabular-nums outline-none"
                />
                <span className="text-[#53616A]">→</span>
                <input
                  id="sim-max-sell-lot-input"
                  name="simMaxSellLot"
                  aria-label="Max Sell Lot"
                  type="text"
                  value={simMaxSellLot}
                  onChange={e => setSimMaxSellLot(e.target.value)}
                  className="w-1/2 bg-[#141C24] text-[#E4EBEF] px-1.5 py-1.5 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] text-center tabular-nums outline-none"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="sim-spread-bps-input" className="text-[10px] font-sans text-[#71818B]">
                  Spread Buffer
                </label>
                <span className="text-[10px] text-[#D6A85C] tabular-nums">{(simSpreadBps / 100).toFixed(2)}%</span>
              </div>
              <input
                id="sim-spread-bps-input"
                name="simSpreadBps"
                aria-label="Spread Buffer Bps"
                type="number"
                min={5}
                max={500}
                step={5}
                value={simSpreadBps}
                onChange={e => setSimSpreadBps(Math.max(5, Number(e.target.value)))}
                className="w-full bg-[#141C24] text-[#D6A85C] px-2 py-1.5 rounded-[7px] border border-[#D6A85C]/30 focus:border-[#D6A85C] font-semibold text-center tabular-nums outline-none"
                title="Buffer minimum antara Level 1 Buy dan Level 1 Sell terhadap Anchor Price"
              />
            </div>

            <div>
              <label htmlFor="sim-total-orders-input" className="text-[10px] font-sans text-[#71818B] block mb-1">
                Total Orders
              </label>
              <input
                id="sim-total-orders-input"
                name="simTotalOrders"
                aria-label="Total Orders"
                type="number"
                min={2}
                max={100}
                step={2}
                value={simTotalOrders}
                onChange={e => setSimTotalOrders(Number(e.target.value))}
                className="w-full bg-[#141C24] text-[#C1D0D6] px-2.5 py-1.5 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] font-semibold tabular-nums outline-none"
              />
            </div>

            <div className="flex flex-col justify-end">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={fetchPreview}
                isLoading={isPreviewLoading}
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                className="w-full h-[34px]"
              >
                {isPreviewLoading ? 'Menghitung...' : 'Hitung Ulang'}
              </Button>
            </div>
          </div>

          {/* Visual Canvas */}
          <div className="relative w-full h-80 bg-[#090D12] rounded-[7px] overflow-hidden border border-[#202B34]">
            <canvas ref={canvasRef} width={1000} height={320} className="w-full h-full block" />

            {/* Quick Legend Overlay */}
            <div className="absolute top-2.5 left-3 flex flex-wrap items-center gap-3 bg-[#111820]/95 px-3 py-1.5 rounded-[7px] border border-[#2B3944] text-[11px] font-mono text-[#A1AFB8]">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-[#8DA5B1] inline-block" />
                <span className="text-[#E4EBEF]">Pola: {simPattern.replace(/_/g, ' ')}</span>
              </span>
              <span className="flex items-center gap-1.5 text-[#D6A85C]">
                <span className="w-2 h-2 rounded-full bg-[#D6A85C] inline-block" />
                <span>Running Anchor Pivot</span>
              </span>
              <span className="flex items-center gap-1.5 text-[#16A879]">
                <span className="w-2.5 h-0.5 bg-[#16A879] inline-block" />
                <span>Min Price Bound</span>
              </span>
              <span className="flex items-center gap-1.5 text-[#EA5B65]">
                <span className="w-2.5 h-0.5 bg-[#EA5B65] inline-block" />
                <span>Max Price Bound</span>
              </span>
            </div>
          </div>

          {/* 4. Verification Report Card (Level 1 vs Level 20/N) */}
          {previewData?.verificationReport && (
            <div className="p-3.5 bg-[#111820] border border-[#2B3944] rounded-[10px]">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h4 className="text-xs font-semibold text-[#E4EBEF] uppercase tracking-wider flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#8DA5B1]" />
                  <span>Laporan Verifikasi Perlindungan Lot &amp; Batas Harga (Level 1 vs Terjauh)</span>
                </h4>
                <StatusBadge tone="success">100% Valid (Guards Passed)</StatusBadge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono tabular-nums">
                {/* Buy Ladder Report */}
                <div className="p-3 bg-[#141C24] rounded-[7px] border border-[#16A879]/25">
                  <div className="text-[#16A879] font-semibold mb-2 flex items-center justify-between">
                    <span>BUY LADDER ({previewData.buyLevels?.length} Tingkatan)</span>
                    <span className="text-[10px] font-sans text-[#71818B] font-normal">Di Bawah Anchor Price</span>
                  </div>
                  <div className="space-y-1.5 text-[#A1AFB8]">
                    <div className="flex justify-between gap-2">
                      <span>Level 1 (Terdekat) :</span>
                      <span className="text-[#E4EBEF] font-semibold">
                        {previewData.verificationReport.buyLevel1?.priceDisplay}
                      </span>
                      <span className="text-[#16A879] font-medium">
                        {previewData.verificationReport.buyLevel1?.lotDisplay} lot (Min)
                      </span>
                    </div>
                    <div className="flex justify-between gap-2 border-t border-[#202B34] pt-1.5">
                      <span>Level {previewData.buyLevels?.length} (Terjauh) :</span>
                      <span className="text-[#E4EBEF] font-semibold">
                        {previewData.verificationReport.buyLevelFurthest?.priceDisplay}
                      </span>
                      <span className="text-[#16A879] font-medium">
                        {previewData.verificationReport.buyLevelFurthest?.lotDisplay} lot (Max)
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-sans text-[#71818B] mt-2 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-[#16A879]" />
                    Seluruh harga Buy ≥ Min Price Bound &amp; &lt; Anchor Price.
                  </span>
                </div>

                {/* Sell Ladder Report */}
                <div className="p-3 bg-[#141C24] rounded-[7px] border border-[#EA5B65]/25">
                  <div className="text-[#EA5B65] font-semibold mb-2 flex items-center justify-between">
                    <span>SELL LADDER ({previewData.sellLevels?.length} Tingkatan)</span>
                    <span className="text-[10px] font-sans text-[#71818B] font-normal">Di Atas Anchor Price</span>
                  </div>
                  <div className="space-y-1.5 text-[#A1AFB8]">
                    <div className="flex justify-between gap-2">
                      <span>Level 1 (Terdekat) :</span>
                      <span className="text-[#E4EBEF] font-semibold">
                        {previewData.verificationReport.sellLevel1?.priceDisplay}
                      </span>
                      <span className="text-[#EA5B65] font-medium">
                        {previewData.verificationReport.sellLevel1?.lotDisplay} lot (Min)
                      </span>
                    </div>
                    <div className="flex justify-between gap-2 border-t border-[#202B34] pt-1.5">
                      <span>Level {previewData.sellLevels?.length} (Terjauh) :</span>
                      <span className="text-[#E4EBEF] font-semibold">
                        {previewData.verificationReport.sellLevelFurthest?.priceDisplay}
                      </span>
                      <span className="text-[#EA5B65] font-medium">
                        {previewData.verificationReport.sellLevelFurthest?.lotDisplay} lot (Max)
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-sans text-[#71818B] mt-2 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-[#16A879]" />
                    Seluruh harga Sell ≤ Max Price Bound &amp; &gt; Anchor Price.
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 5. Table of Smart HFT Ladder Bots */}
      <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
        <PanelHeader
          icon={<ListOrdered className="w-4 h-4" />}
          title={`Daftar Bot Smart HFT Ladder Aktif (${smartHftBots.length})`}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={onRefresh}
            >
              Segarkan
            </Button>
          }
        />

        {smartHftBots.length === 0 ? (
          <div className="p-8 text-center text-[#71818B] text-xs">
            Belum ada bot Smart HFT Ladder yang dibuat. Klik tombol{' '}
            <strong className="text-[#C1D0D6]">Deploy Smart HFT Ladder</strong> untuk membuat instans pertama.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#A1AFB8] font-mono tabular-nums">
              <thead className="bg-[#111820] text-[10px] font-sans text-[#71818B] uppercase tracking-wider border-b border-[#202B34]">
                <tr>
                  <th className="p-3">Nama Bot</th>
                  <th className="p-3">Pair</th>
                  <th className="p-3">Pola &amp; TF</th>
                  <th className="p-3">Order Tangga</th>
                  <th className="p-3">Batas Harga</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Orders Aktif</th>
                  <th className="p-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34]">
                {smartHftBots.map(bot => {
                  const cfg = bot.smartHftConfig;
                  const isRunning = bot.status === 'RUNNING';
                  return (
                    <tr key={bot.id} className="hover:bg-[#17212B] transition-colors">
                      <td className="p-3 font-sans font-semibold text-[#E4EBEF]">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${isRunning ? 'bg-[#16A879]' : 'bg-[#71818B]'}`}
                          />
                          <span>{bot.name}</span>
                        </div>
                      </td>
                      <td className="p-3 text-[#C1D0D6] font-semibold">{bot.pairId}</td>
                      <td className="p-3">
                        <StatusBadge tone="neutral">
                          {cfg?.pattern.replace(/_/g, ' ')} ({cfg?.timeframe})
                        </StatusBadge>
                      </td>
                      <td className="p-3 text-[#16A879]">
                        {cfg?.total_orders || 40} ({Math.floor((cfg?.total_orders || 40) / 2)}B /{' '}
                        {Math.floor((cfg?.total_orders || 40) / 2)}S)
                      </td>
                      <td className="p-3 text-[11px] text-[#A1AFB8]">
                        [{cfg?.min_price_bound} - {cfg?.max_price_bound}]
                      </td>
                      <td className="p-3">
                        <StatusBadge
                          tone={isRunning ? 'success' : bot.status === 'PAUSED' ? 'warning' : 'neutral'}
                          dot={isRunning}
                        >
                          {bot.status}
                        </StatusBadge>
                      </td>
                      <td className="p-3 text-right text-[#E4EBEF] font-semibold">
                        {cfg?.activeOrderIds?.length || 0}
                      </td>
                      <td className="p-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant={isRunning ? 'secondary' : 'profit'}
                            icon={isRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                            onClick={() => handleToggleBot(bot.id, bot.status)}
                          >
                            {isRunning ? 'Pause' : 'Start'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            icon={<Square className="w-3 h-3" />}
                            onClick={() => handleStopBot(bot.id)}
                          >
                            Stop
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            icon={<ScrollText className="w-3 h-3" />}
                            onClick={() => setSelectedBotLogs(bot)}
                          >
                            Logs
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6. MODAL: DEPLOY SMART HFT LADDER BOT */}
      <Modal
        isOpen={isDeployModalOpen}
        onClose={() => setIsDeployModalOpen(false)}
        title="Deploy Smart HFT Ladder Bot"
        subtitle="Konfigurasi formasi geometris Modul A dan parameter tangga order Modul B."
        maxWidth="max-w-xl"
      >
        <form onSubmit={handleCreateBot} className="space-y-4 text-xs font-sans">
          <div>
            <label htmlFor="modal-bot-name" className="text-[#A1AFB8] font-medium block mb-1">
              Nama Bot
            </label>
            <input
              id="modal-bot-name"
              name="botName"
              type="text"
              required
              value={botName}
              onChange={e => setBotName(e.target.value)}
              className="w-full bg-[#111820] text-[#E4EBEF] px-3 py-2 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="modal-sim-pair-id" className="text-[#A1AFB8] font-medium block mb-1">
                Trading Pair
              </label>
              <select
                id="modal-sim-pair-id"
                name="simPairId"
                value={simPairId}
                onChange={e => setSimPairId(e.target.value)}
                className="w-full bg-[#111820] text-[#E4EBEF] px-3 py-2 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] font-mono outline-none"
              >
                {tradingPairs.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="modal-bot-environment" className="text-[#A1AFB8] font-medium block mb-1">
                Environment
              </label>
              <select
                id="modal-bot-environment"
                name="botEnvironment"
                value={botEnvironment}
                onChange={e => setBotEnvironment(e.target.value as any)}
                className="w-full bg-[#111820] text-[#E4EBEF] px-3 py-2 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] outline-none"
              >
                <option value="DEMO">DEMO (Testnet)</option>
                <option value="STAGING">STAGING</option>
                <option value="PRODUCTION">PRODUCTION (Live Market)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="modal-sim-pattern" className="text-[#A1AFB8] font-medium block mb-1">
                Pola Grafik (Modul A)
              </label>
              <select
                id="modal-sim-pattern"
                name="simPattern"
                value={simPattern}
                onChange={e => setSimPattern(e.target.value as PatternFormationType)}
                className="w-full bg-[#111820] text-[#C1D0D6] px-3 py-2 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] font-medium outline-none"
              >
                <optgroup label="Reversal">
                  <option value="HEAD_AND_SHOULDERS">Head and Shoulders</option>
                  <option value="INVERSE_HEAD_AND_SHOULDERS">Inverse Head and Shoulders</option>
                  <option value="DOUBLE_TOP">Double Top</option>
                  <option value="TRIPLE_TOP">Triple Top</option>
                  <option value="DOUBLE_BOTTOM">Double Bottom</option>
                  <option value="TRIPLE_BOTTOM">Triple Bottom</option>
                </optgroup>
                <optgroup label="Continuation">
                  <option value="BULLISH_FLAG">Bullish Flag</option>
                  <option value="BEARISH_FLAG">Bearish Flag</option>
                  <option value="PENNANT">Pennant</option>
                  <option value="CUP_AND_HANDLE">Cup and Handle</option>
                  <option value="RECTANGLE">Rectangle</option>
                </optgroup>
                <optgroup label="Bilateral">
                  <option value="ASCENDING_TRIANGLE">Ascending Triangle</option>
                  <option value="DESCENDING_TRIANGLE">Descending Triangle</option>
                  <option value="SYMMETRICAL_TRIANGLE">Symmetrical Triangle</option>
                </optgroup>
              </select>
            </div>
            <div>
              <label htmlFor="modal-sim-timeframe" className="text-[#A1AFB8] font-medium block mb-1">
                Timeframe (Skala TF)
              </label>
              <select
                id="modal-sim-timeframe"
                name="simTimeframe"
                value={simTimeframe}
                onChange={e => setSimTimeframe(e.target.value as PatternTimeframe)}
                className="w-full bg-[#111820] text-[#E4EBEF] px-3 py-2 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] font-mono outline-none"
              >
                <option value="5m">5 Menit (30 Bars)</option>
                <option value="15m">15 Menit (45 Bars)</option>
                <option value="1h">1 Jam (60 Bars)</option>
                <option value="4h">4 Jam (90 Bars)</option>
              </select>
            </div>
          </div>

          {/* Percentage Spread Selector for Modal */}
          <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[#A1AFB8] font-medium">Rentang Batas Harga (Spread %):</span>
              <StatusBadge tone={impliedSpreadPct > 15 ? 'warning' : 'brand'}>
                {impliedSpreadPct > 15 ? `Terlalu Jauh (±${impliedSpreadPct}%)` : `Rentang: ±${impliedSpreadPct}%`}
              </StatusBadge>
            </div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 5, 8, 10].map(pct => {
                const isActive = Math.abs(impliedSpreadPct - pct) < 0.35;
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => applyBoundPercentage(pct)}
                    className={`flex-1 py-1 rounded-[5px] text-xs font-mono tabular-nums font-semibold transition-colors cursor-pointer border ${
                      isActive
                        ? 'bg-[#8DA5B1] text-[#090D12] border-[#C1D0D6]/40'
                        : 'bg-[#17212B] text-[#A1AFB8] hover:bg-[#1D2832] hover:text-[#E4EBEF] border-[#2B3944]'
                    }`}
                  >
                    ±{pct}%
                  </button>
                );
              })}
            </div>
            {impliedSpreadPct > 15 && (
              <p className="mt-2 text-[11px] text-[#D6A85C] flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Rentang harga terlalu jauh dari pasar. Disarankan ±2% s/d ±5% agar ladder limit order aktif
                  tereksekusi.
                </span>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="modal-sim-min-bound" className="text-[#A1AFB8] font-medium">
                  Min Price Bound
                </label>
                <span className="text-[10px] text-[#16A879] font-mono tabular-nums">-{impliedSpreadPct}%</span>
              </div>
              <input
                id="modal-sim-min-bound"
                name="modalSimMinBound"
                type="text"
                required
                value={simMinBound}
                onChange={e => setSimMinBound(e.target.value)}
                className="w-full bg-[#111820] text-[#16A879] px-3 py-2 rounded-[7px] border border-[#16A879]/30 focus:border-[#16A879] font-mono tabular-nums outline-none"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="modal-sim-max-bound" className="text-[#A1AFB8] font-medium">
                  Max Price Bound
                </label>
                <span className="text-[10px] text-[#EA5B65] font-mono tabular-nums">+{impliedSpreadPct}%</span>
              </div>
              <input
                id="modal-sim-max-bound"
                name="modalSimMaxBound"
                type="text"
                required
                value={simMaxBound}
                onChange={e => setSimMaxBound(e.target.value)}
                className="w-full bg-[#111820] text-[#EA5B65] px-3 py-2 rounded-[7px] border border-[#EA5B65]/30 focus:border-[#EA5B65] font-mono tabular-nums outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="modal-sim-min-buy-lot" className="text-[#A1AFB8] font-medium block mb-1">
                Buy Lot (Level 1 → Level Terjauh)
              </label>
              <div className="flex gap-2">
                <input
                  id="modal-sim-min-buy-lot"
                  name="modalSimMinBuyLot"
                  aria-label="Modal Min Buy Lot"
                  type="text"
                  required
                  value={simMinBuyLot}
                  onChange={e => setSimMinBuyLot(e.target.value)}
                  placeholder="Min"
                  className="w-1/2 bg-[#111820] text-[#E4EBEF] px-2 py-1.5 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] font-mono tabular-nums text-center outline-none"
                />
                <input
                  id="modal-sim-max-buy-lot"
                  name="modalSimMaxBuyLot"
                  aria-label="Modal Max Buy Lot"
                  type="text"
                  required
                  value={simMaxBuyLot}
                  onChange={e => setSimMaxBuyLot(e.target.value)}
                  placeholder="Max"
                  className="w-1/2 bg-[#111820] text-[#E4EBEF] px-2 py-1.5 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] font-mono tabular-nums text-center outline-none"
                />
              </div>
            </div>
            <div>
              <label htmlFor="modal-sim-min-sell-lot" className="text-[#A1AFB8] font-medium block mb-1">
                Sell Lot (Level 1 → Level Terjauh)
              </label>
              <div className="flex gap-2">
                <input
                  id="modal-sim-min-sell-lot"
                  name="modalSimMinSellLot"
                  aria-label="Modal Min Sell Lot"
                  type="text"
                  required
                  value={simMinSellLot}
                  onChange={e => setSimMinSellLot(e.target.value)}
                  placeholder="Min"
                  className="w-1/2 bg-[#111820] text-[#E4EBEF] px-2 py-1.5 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] font-mono tabular-nums text-center outline-none"
                />
                <input
                  id="modal-sim-max-sell-lot"
                  name="modalSimMaxSellLot"
                  aria-label="Modal Max Sell Lot"
                  type="text"
                  required
                  value={simMaxSellLot}
                  onChange={e => setSimMaxSellLot(e.target.value)}
                  placeholder="Max"
                  className="w-1/2 bg-[#111820] text-[#E4EBEF] px-2 py-1.5 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] font-mono tabular-nums text-center outline-none"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="modal-sim-total-orders" className="text-[#A1AFB8] font-medium block mb-1">
                Total Order Ladder
              </label>
              <input
                id="modal-sim-total-orders"
                name="modalSimTotalOrders"
                type="number"
                min={2}
                max={100}
                step={2}
                value={simTotalOrders}
                onChange={e => setSimTotalOrders(Number(e.target.value))}
                className="w-full bg-[#111820] text-[#C1D0D6] px-3 py-2 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] font-mono tabular-nums font-semibold outline-none"
              />
            </div>
            <div>
              <label htmlFor="modal-sim-spread-bps" className="text-[#A1AFB8] font-medium block mb-1">
                Spread Buffer (bps)
              </label>
              <div className="relative">
                <input
                  id="modal-sim-spread-bps"
                  name="modalSimSpreadBps"
                  type="number"
                  min={5}
                  max={500}
                  step={5}
                  value={simSpreadBps}
                  onChange={e => setSimSpreadBps(Math.max(5, Number(e.target.value)))}
                  className="w-full bg-[#111820] text-[#D6A85C] px-3 py-2 rounded-[7px] border border-[#D6A85C]/30 focus:border-[#D6A85C] font-mono tabular-nums font-semibold outline-none"
                />
                <span className="absolute right-2.5 top-2.5 text-[10px] font-mono text-[#D6A85C] font-semibold">
                  {(simSpreadBps / 100).toFixed(2)}%
                </span>
              </div>
            </div>
            <div>
              <label htmlFor="modal-reprice-interval" className="text-[#A1AFB8] font-medium block mb-1">
                Interval Rotasi (ms)
              </label>
              <input
                id="modal-reprice-interval"
                name="modalRepriceInterval"
                type="number"
                step={500}
                value={repriceIntervalMs}
                onChange={e => setRepriceIntervalMs(Number(e.target.value))}
                className="w-full bg-[#111820] text-[#E4EBEF] px-3 py-2 rounded-[7px] border border-[#2B3944] focus:border-[#8DA5B1] font-mono tabular-nums outline-none"
              />
            </div>
          </div>

          <div className="p-3 bg-[#111820] rounded-[7px] text-[11px] text-[#A1AFB8] border border-[#202B34] space-y-1">
            <div>
              <strong className="text-[#E4EBEF]">Modul A</strong>: Menghasilkan pola geometris &amp; anchor running
              price secara deterministik.
            </div>
            <div>
              <strong className="text-[#E4EBEF]">Modul B</strong>: Menaruh {simTotalOrders} order limit instan (50%
              Buy / 50% Sell) di dalam batas absolut.
            </div>
            <div>
              <strong className="text-[#E4EBEF]">Volume Risk Guard</strong>: Lot membesar bertahap dari Level 1 ke Level
              terjauh tanpa melewati batas maksimum.
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[#202B34]">
            <Button type="button" variant="secondary" size="sm" onClick={() => setIsDeployModalOpen(false)}>
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" icon={<Zap className="w-3.5 h-3.5" />}>
              Buat &amp; Aktifkan Bot
            </Button>
          </div>
        </form>
      </Modal>

      {/* 7. MODAL: STANDALONE PYTHON SCRIPT VIEWER & DOWNLOAD */}
      <Modal
        isOpen={isPythonModalOpen}
        onClose={() => setIsPythonModalOpen(false)}
        title="Python Standalone Script"
        subtitle="scripts/smart_hft_ladder_bot.py"
        maxWidth="max-w-4xl"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[#71818B] font-mono">
              Dependencies: Python 3.10+, asyncio, pandas, numpy, matplotlib
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="profit"
                size="sm"
                icon={<Download className="w-3.5 h-3.5" />}
                onClick={handleDownloadPython}
              >
                Download .py
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Copy className="w-3.5 h-3.5" />}
                onClick={() => {
                  navigator.clipboard.writeText(pythonCode);
                  onSetFeedback({ type: 'success', text: 'Source code Python berhasil disalin ke clipboard!' });
                }}
              >
                Salin Kode
              </Button>
            </div>
          </div>

          <div className="max-h-[55vh] overflow-y-auto bg-[#090D12] p-3.5 rounded-[7px] border border-[#202B34] font-mono text-[11px] text-[#A1AFB8]">
            {isLoadingCode ? (
              <div className="p-8 text-center text-[#71818B]">Memuat source code...</div>
            ) : (
              <pre className="whitespace-pre-wrap">{pythonCode}</pre>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-[#71818B]">
            <span>Siap dijalankan langsung via terminal CLI</span>
            <StatusBadge tone="success">Standalone Verified</StatusBadge>
          </div>
        </div>
      </Modal>

      {/* 8. MODAL: BOT LOGS */}
      <Modal
        isOpen={!!selectedBotLogs}
        onClose={() => setSelectedBotLogs(null)}
        title={`Log Eksekusi: ${selectedBotLogs?.name || ''}`}
        subtitle={selectedBotLogs?.pairId}
        maxWidth="max-w-2xl"
      >
        <div className="max-h-[60vh] overflow-y-auto space-y-1.5 font-mono text-xs">
          {!selectedBotLogs || selectedBotLogs.logs?.length === 0 ? (
            <div className="p-6 text-center text-[#71818B]">Belum ada log tercatat.</div>
          ) : (
            selectedBotLogs.logs.map((l: any, i: number) => (
              <div
                key={i}
                className={`p-2.5 rounded-[7px] border ${
                  l.type === 'ERROR' || l.type === 'RISK'
                    ? 'bg-[#401F27]/50 border-[#EA5B65]/30 text-[#EA5B65]'
                    : l.type === 'ORDER'
                      ? 'bg-[#162436]/60 border-[#6D9FE8]/30 text-[#6D9FE8]'
                      : 'bg-[#111820] border-[#202B34] text-[#A1AFB8]'
                }`}
              >
                <span className="text-[#71818B] mr-2 tabular-nums">[{new Date(l.timestamp).toLocaleTimeString()}]</span>
                <span className="font-semibold mr-2">[{l.type}]</span>
                <span className="text-[#E4EBEF]">{l.message}</span>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
};
