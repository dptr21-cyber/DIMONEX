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
 * - Standalone Python Code Viewer & 1-Click Download (scripts/smart_hft_ladder_bot.py)
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BotInstance, SmartHftLadderConfig, PatternFormationType, PatternTimeframe, TradingPairItem, UserProfile } from '../../types/index.js';
import { safeFetchJson } from '../../lib/safeFetch.js';

interface Props {
  user: UserProfile | null;
  instances: BotInstance[];
  tradingPairs: TradingPairItem[];
  onRefresh: () => void;
  onSetFeedback: (msg: { type: 'success' | 'error'; text: string } | null) => void;
}

export const SmartHftLadderSection: React.FC<Props> = ({
  user,
  instances,
  tradingPairs,
  onRefresh,
  onSetFeedback
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
  const [simMinBound, setSimMinBound] = useState<string>('');
  const [simMaxBound, setSimMaxBound] = useState<string>('');
  const [simMinBuyLot, setSimMinBuyLot] = useState<string>('0.02');
  const [simMaxBuyLot, setSimMaxBuyLot] = useState<string>('0.50');
  const [simMinSellLot, setSimMinSellLot] = useState<string>('0.02');
  const [simMaxSellLot, setSimMaxSellLot] = useState<string>('0.50');

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
    return tradingPairs.find(p => p.id === simPairId) || tradingPairs[0] || {
      id: 'BTC-IDR',
      lastPrice: '5000000000',
      quoteDecimals: 2,
      baseDecimals: 8,
      quoteCurrency: 'IDR',
      baseCurrency: 'BTC'
    };
  }, [tradingPairs, simPairId]);

  const currentPriceNum = useMemo(() => {
    const qDec = currentPair.quoteDecimals !== undefined ? currentPair.quoteDecimals : (currentPair.quoteCurrency === 'USDT' ? 6 : 2);
    return Number(BigInt(currentPair.lastPrice || '5000000000')) / (10 ** qDec);
  }, [currentPair]);

  // Set default bounds when pair changes
  useEffect(() => {
    if (currentPriceNum > 0) {
      const qDec = currentPair.quoteDecimals !== undefined ? currentPair.quoteDecimals : 2;
      setSimMinBound((currentPriceNum * 0.92).toFixed(qDec));
      setSimMaxBound((currentPriceNum * 1.08).toFixed(qDec));
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
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          pairId: simPairId,
          timeframe: simTimeframe,
          pattern: simPattern,
          total_orders: simTotalOrders,
          min_price_bound: simMinBound,
          max_price_bound: simMaxBound,
          min_buy_lot: simMinBuyLot,
          max_buy_lot: simMaxBuyLot,
          min_sell_lot: simMinSellLot,
          max_sell_lot: simMaxSellLot
        })
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
  }, [simPairId, simTimeframe, simPattern, simTotalOrders, simMinBound, simMaxBound, simMinBuyLot, simMaxBuyLot, simMinSellLot, simMaxSellLot]);

  // Render Canvas Chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !previewData?.patternPoints) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, width, height);

    const points = previewData.patternPoints as { index: number; price: number }[];
    if (points.length === 0) return;

    const minBound = previewData.minPriceBound;
    const maxBound = previewData.maxPriceBound;
    const anchorPrice = previewData.anchorPrice;

    // Determine scale bounds
    const allPrices = points.map(p => p.price).concat([minBound, maxBound, anchorPrice]);
    const minP = Math.min(...allPrices) * 0.995;
    const maxP = Math.max(...allPrices) * 1.005;
    const priceRange = maxP - minP || 1;

    const padLeft = 60;
    const padRight = 100;
    const padTop = 30;
    const padBottom = 35;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    const getY = (p: number) => padTop + chartH - ((p - minP) / priceRange) * chartH;
    const getX = (idx: number) => padLeft + (idx / Math.max(1, points.length - 1)) * chartW;

    // Grid lines
    ctx.strokeStyle = '#1e293b';
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

    // 1. Max Absolute Bound Line (Red)
    const maxBoundY = getY(maxBound);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, maxBoundY);
    ctx.lineTo(width - 10, maxBoundY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`Max Bound: ${maxBound.toLocaleString()}`, width - padRight + 5, maxBoundY - 4);

    // 2. Min Absolute Bound Line (Green)
    const minBoundY = getY(minBound);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, minBoundY);
    ctx.lineTo(width - 10, minBoundY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`Min Bound: ${minBound.toLocaleString()}`, width - padRight + 5, minBoundY + 12);

    // 3. Pattern Synthetic Curve (Cyan gradient fill)
    ctx.beginPath();
    points.forEach((pt, i) => {
      const x = getX(i);
      const y = getY(pt.price);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 4. Anchor Price Pivot (Gold Dot)
    const lastX = getX(points.length - 1);
    const anchorY = getY(anchorPrice);
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(lastX, anchorY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(`Anchor Pivot: ${anchorPrice.toLocaleString()}`, lastX - 110, anchorY - 10);

    // 5. Ladder Orders Visual Levels (Right Column)
    const ladderX = width - padRight + 15;
    // Buy Levels (Green)
    const buys = previewData.buyLevels || [];
    buys.forEach((b: any, idx: number) => {
      const numPrice = Number(BigInt(b.priceUnits)) / (10 ** (currentPair.quoteDecimals || 2));
      const y = getY(numPrice);
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(ladderX, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Sell Levels (Red)
    const sells = previewData.sellLevels || [];
    sells.forEach((s: any, idx: number) => {
      const numPrice = Number(BigInt(s.priceUnits)) / (10 ** (currentPair.quoteDecimals || 2));
      const y = getY(numPrice);
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(ladderX, y, 3, 0, Math.PI * 2);
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
    } catch {}
    finally {
      setIsLoadingCode(false);
    }
  };

  // Download Python Script
  const handleDownloadPython = () => {
    window.open('/api/mm/smart-hft/python-script?download=true', '_blank');
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
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: botName,
          pairId: simPairId,
          environment: botEnvironment,
          timeframe: simTimeframe,
          pattern: simPattern,
          total_orders: simTotalOrders,
          min_price_bound: simMinBound,
          max_price_bound: simMaxBound,
          min_buy_lot: simMinBuyLot,
          max_buy_lot: simMaxBuyLot,
          min_sell_lot: simMinSellLot,
          max_sell_lot: simMaxSellLot,
          reprice_interval_ms: repriceIntervalMs
        })
      });

      if (res.ok) {
        onSetFeedback({ type: 'success', text: `Bot "${botName}" berhasil dibuat!` });
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
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        onSetFeedback({ type: 'success', text: `Status bot berhasil diubah.` });
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
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ cancelOpenOrders: true })
      });
      if (res.ok) {
        onSetFeedback({ type: 'success', text: `Bot berhasil dihentikan dan seluruh order terbuka dibatalkan.` });
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
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-gradient-to-r from-[#0c182a] via-[#101b33] to-[#0c1424] border border-cyan-500/30 rounded-2xl shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📐</span>
            <h2 className="text-base font-bold text-white tracking-wide">
              SMART HFT LADDER BOT & PATTERN CHART CREATOR
            </h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              Modul A + Modul B
            </span>
          </div>
          <p className="text-xs text-slate-300 mt-1 max-w-3xl">
            Sistem HFT modular: <strong className="text-cyan-300">Modul A</strong> memproduksi formasi pola geometris 14 pola (5m/15m/1h/4h) untuk menentukan anchor pivot running price; <strong className="text-emerald-300">Modul B</strong> menempatkan tangga simetris 40 order limit (20 Buy & 20 Sell) dengan perlindungan batas harga absolut dan manajemen lot bertingkat.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenPythonCode}
            className="px-3.5 py-2 bg-[#1e293b] hover:bg-[#334155] text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-2 transition-all shadow-md"
          >
            <span>🐍</span>
            <span>Lihat Python Script</span>
          </button>
          <button
            onClick={() => setIsDeployModalOpen(true)}
            className="px-4 py-2 bg-gradient-to-r from-cyan-600 via-sky-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold rounded-xl shadow-lg border border-cyan-400/40 flex items-center gap-2 transition-all"
          >
            <span>⚡</span>
            <span>+ Deploy Smart HFT Ladder</span>
          </button>
        </div>
      </div>

      {/* 2. Key Architecture Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 bg-[#0d1424] border border-cyan-500/20 rounded-xl">
          <span className="text-[11px] text-cyan-300 font-semibold block mb-1">Bot HFT Ladder Aktif</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-cyan-400">
              {smartHftBots.filter(b => b.status === 'RUNNING').length}
            </span>
            <span className="text-xs text-slate-500 font-mono">/ {smartHftBots.length} terdaftar</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">Rotasi tangga otomatis anti-stacking</span>
        </div>

        <div className="p-3.5 bg-[#0d1424] border border-cyan-500/20 rounded-xl">
          <span className="text-[11px] text-cyan-300 font-semibold block mb-1">Arsitektur Tangga</span>
          <div className="text-sm font-bold font-mono text-emerald-400 mt-0.5">
            40 Order Simetris
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">20 Buy Limits & 20 Sell Limits (Max 100)</span>
        </div>

        <div className="p-3.5 bg-[#0d1424] border border-cyan-500/20 rounded-xl">
          <span className="text-[11px] text-cyan-300 font-semibold block mb-1">Anti-Out of Bounds Guard</span>
          <div className="text-xs font-bold font-mono text-amber-400 mt-1 flex items-center gap-1.5">
            <span>🛡️</span>
            <span>Batas Mutlak Min & Max</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">Interpolasi linier di dalam ruang aman</span>
        </div>

        <div className="p-3.5 bg-[#0d1424] border border-cyan-500/20 rounded-xl">
          <span className="text-[11px] text-cyan-300 font-semibold block mb-1">Volume Scaling Guard</span>
          <div className="text-xs font-bold font-mono text-purple-400 mt-1 flex items-center gap-1.5">
            <span>⚖️</span>
            <span>Marti-Light Lot Guard</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">Terkecil di Level 1, terbesar di batas terjauh</span>
        </div>
      </div>

      {/* 3. Interactive Pattern Simulator & Live Visualizer */}
      <div className="p-4 bg-[#0a0f1d] border border-slate-800 rounded-2xl flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="text-cyan-400">📊</span> Live Geometric Pattern & Multi-Order Ladder Simulator
            </h3>
            <p className="text-xs text-slate-400">
              Uji coba matematis pergerakan pola grafik dan kalkulasi 40 order tangga secara real-time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Pair Selector */}
            <select
              value={simPairId}
              onChange={e => setSimPairId(e.target.value)}
              className="bg-[#1e293b] text-white text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 font-mono"
            >
              {tradingPairs.map(p => (
                <option key={p.id} value={p.id}>{p.id}</option>
              ))}
            </select>

            {/* Timeframe Selector */}
            <div className="flex items-center bg-[#1e293b] rounded-lg p-0.5 border border-slate-700">
              {(['5m', '15m', '1h', '4h'] as PatternTimeframe[]).map(tf => (
                <button
                  key={tf}
                  onClick={() => setSimTimeframe(tf)}
                  className={`px-2.5 py-1 text-xs font-mono rounded-md font-semibold transition-all ${
                    simTimeframe === tf ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Pattern Selector (14 Formations) */}
            <select
              value={simPattern}
              onChange={e => setSimPattern(e.target.value as PatternFormationType)}
              className="bg-[#1e293b] text-cyan-300 text-xs px-3 py-1.5 rounded-lg border border-cyan-500/40 font-semibold"
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
        </div>

        {/* Input Parameters Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 p-3 bg-[#0f172a] rounded-xl text-xs font-mono">
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Min Price Bound</label>
            <input
              type="text"
              value={simMinBound}
              onChange={e => setSimMinBound(e.target.value)}
              className="w-full bg-[#1e293b] text-emerald-400 px-2 py-1 rounded border border-emerald-500/30"
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Max Price Bound</label>
            <input
              type="text"
              value={simMaxBound}
              onChange={e => setSimMaxBound(e.target.value)}
              className="w-full bg-[#1e293b] text-red-400 px-2 py-1 rounded border border-red-500/30"
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Buy Lot (Min → Max)</label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={simMinBuyLot}
                onChange={e => setSimMinBuyLot(e.target.value)}
                className="w-1/2 bg-[#1e293b] text-slate-200 px-1.5 py-1 rounded border border-slate-700 text-center"
              />
              <span className="text-slate-500">→</span>
              <input
                type="text"
                value={simMaxBuyLot}
                onChange={e => setSimMaxBuyLot(e.target.value)}
                className="w-1/2 bg-[#1e293b] text-slate-200 px-1.5 py-1 rounded border border-slate-700 text-center"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Sell Lot (Min → Max)</label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={simMinSellLot}
                onChange={e => setSimMinSellLot(e.target.value)}
                className="w-1/2 bg-[#1e293b] text-slate-200 px-1.5 py-1 rounded border border-slate-700 text-center"
              />
              <span className="text-slate-500">→</span>
              <input
                type="text"
                value={simMaxSellLot}
                onChange={e => setSimMaxSellLot(e.target.value)}
                className="w-1/2 bg-[#1e293b] text-slate-200 px-1.5 py-1 rounded border border-slate-700 text-center"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Total Orders</label>
            <input
              type="number"
              min={2}
              max={100}
              step={2}
              value={simTotalOrders}
              onChange={e => setSimTotalOrders(Number(e.target.value))}
              className="w-full bg-[#1e293b] text-cyan-400 px-2 py-1 rounded border border-cyan-500/30 font-bold"
            />
          </div>
          <div className="flex flex-col justify-end">
            <button
              onClick={fetchPreview}
              disabled={isPreviewLoading}
              className="w-full py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded text-xs transition-colors"
            >
              {isPreviewLoading ? 'Menghitung...' : '🔄 Hitung Ulang'}
            </button>
          </div>
        </div>

        {/* Visual Canvas */}
        <div className="relative w-full h-80 bg-[#070b14] rounded-xl overflow-hidden border border-slate-800">
          <canvas
            ref={canvasRef}
            width={1000}
            height={320}
            className="w-full h-full block"
          />

          {/* Quick Legend Overlay */}
          <div className="absolute top-2 left-3 flex flex-wrap items-center gap-3 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 text-[11px] font-mono text-slate-300">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 bg-[#38bdf8] inline-block"></span>
              <span>Pola: {simPattern.replace(/_/g, ' ')}</span>
            </span>
            <span className="flex items-center gap-1.5 text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>
              <span>Running Anchor Pivot</span>
            </span>
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2.5 h-0.5 bg-emerald-400 border-dashed inline-block"></span>
              <span>Min Price Bound</span>
            </span>
            <span className="flex items-center gap-1.5 text-red-400">
              <span className="w-2.5 h-0.5 bg-red-400 border-dashed inline-block"></span>
              <span>Max Price Bound</span>
            </span>
          </div>
        </div>

        {/* 4. Verification Report Card (Level 1 vs Level 20/N) */}
        {previewData?.verificationReport && (
          <div className="p-3.5 bg-[#091122] border border-cyan-500/20 rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span>🛡️</span> Laporan Verifikasi Perlindungan Lot & Batas Harga (Level 1 vs Terjauh)
              </h4>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[11px] font-bold">
                ✓ 100% Valid (Guards Passed)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
              {/* Buy Ladder Report */}
              <div className="p-2.5 bg-[#0e172a] rounded-lg border border-emerald-500/20">
                <div className="text-emerald-400 font-bold mb-1.5 flex items-center justify-between">
                  <span>BUY LADDER ({previewData.buyLevels?.length} Tingkatan)</span>
                  <span className="text-[10px] text-slate-400 font-normal">Di Bawah Anchor Price</span>
                </div>
                <div className="space-y-1 text-slate-300">
                  <div className="flex justify-between">
                    <span>Level 1 (Terdekat) :</span>
                    <span className="text-white font-bold">{previewData.verificationReport.buyLevel1?.priceDisplay}</span>
                    <span className="text-emerald-400 font-semibold">{previewData.verificationReport.buyLevel1?.lotDisplay} lot (Min)</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-1">
                    <span>Level {previewData.buyLevels?.length} (Terjauh)  :</span>
                    <span className="text-white font-bold">{previewData.verificationReport.buyLevelFurthest?.priceDisplay}</span>
                    <span className="text-emerald-400 font-semibold">{previewData.verificationReport.buyLevelFurthest?.lotDisplay} lot (Max)</span>
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 mt-2 block">
                  ✓ Sesuai batas: Seluruh harga Buy ≥ Min Price Bound & &lt; Anchor Price.
                </span>
              </div>

              {/* Sell Ladder Report */}
              <div className="p-2.5 bg-[#0e172a] rounded-lg border border-red-500/20">
                <div className="text-red-400 font-bold mb-1.5 flex items-center justify-between">
                  <span>SELL LADDER ({previewData.sellLevels?.length} Tingkatan)</span>
                  <span className="text-[10px] text-slate-400 font-normal">Di Atas Anchor Price</span>
                </div>
                <div className="space-y-1 text-slate-300">
                  <div className="flex justify-between">
                    <span>Level 1 (Terdekat) :</span>
                    <span className="text-white font-bold">{previewData.verificationReport.sellLevel1?.priceDisplay}</span>
                    <span className="text-red-400 font-semibold">{previewData.verificationReport.sellLevel1?.lotDisplay} lot (Min)</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-1">
                    <span>Level {previewData.sellLevels?.length} (Terjauh)  :</span>
                    <span className="text-white font-bold">{previewData.verificationReport.sellLevelFurthest?.priceDisplay}</span>
                    <span className="text-red-400 font-semibold">{previewData.verificationReport.sellLevelFurthest?.lotDisplay} lot (Max)</span>
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 mt-2 block">
                  ✓ Sesuai batas: Seluruh harga Sell ≤ Max Price Bound & &gt; Anchor Price.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. Table of Smart HFT Ladder Bots */}
      <div className="bg-[#0b101e] border border-slate-800 rounded-2xl overflow-hidden">
        <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <span>📋</span> Daftar Bot Smart HFT Ladder Aktif ({smartHftBots.length})
          </h3>
          <button
            onClick={onRefresh}
            className="text-xs text-slate-400 hover:text-white transition-colors flex items-center gap-1"
          >
            <span>🔄</span> Segarkan
          </button>
        </div>

        {smartHftBots.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            Belum ada bot Smart HFT Ladder yang dibuat. Klik tombol <strong className="text-cyan-400">+ Deploy Smart HFT Ladder</strong> untuk membuat instans pertama.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300 font-mono">
              <thead className="bg-[#0f172a] text-[11px] text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="p-3">Nama Bot</th>
                  <th className="p-3">Pair</th>
                  <th className="p-3">Pola & TF</th>
                  <th className="p-3">Order Tangga</th>
                  <th className="p-3">Batas Harga</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Orders Aktif</th>
                  <th className="p-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {smartHftBots.map(bot => {
                  const cfg = bot.smartHftConfig;
                  const isRunning = bot.status === 'RUNNING';
                  return (
                    <tr key={bot.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="p-3 font-bold text-white flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                        <span>{bot.name}</span>
                      </td>
                      <td className="p-3 text-cyan-300 font-bold">{bot.pairId}</td>
                      <td className="p-3">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px]">
                          {cfg?.pattern.replace(/_/g, ' ')} ({cfg?.timeframe})
                        </span>
                      </td>
                      <td className="p-3 text-emerald-400">
                        {cfg?.order_count || 40} ({Math.floor((cfg?.order_count || 40) / 2)} Buy / {Math.floor((cfg?.order_count || 40) / 2)} Sell)
                      </td>
                      <td className="p-3 text-[11px]">
                        [{cfg?.min_price_bound} - {cfg?.max_price_bound}]
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isRunning ? 'bg-emerald-500/20 text-emerald-400' :
                          bot.status === 'PAUSED' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-slate-700 text-slate-300'
                        }`}>
                          {bot.status}
                        </span>
                      </td>
                      <td className="p-3 text-white font-bold">
                        {cfg?.activeOrderIds?.length || 0}
                      </td>
                      <td className="p-3 text-right space-x-1.5">
                        <button
                          onClick={() => handleToggleBot(bot.id, bot.status)}
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                            isRunning ? 'bg-amber-600/30 text-amber-300 hover:bg-amber-600/50' : 'bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50'
                          }`}
                        >
                          {isRunning ? 'Pause' : 'Start'}
                        </button>
                        <button
                          onClick={() => handleStopBot(bot.id)}
                          className="px-2.5 py-1 rounded text-[11px] font-semibold bg-red-600/30 text-red-300 hover:bg-red-600/50 transition-all"
                        >
                          Stop & Cancel
                        </button>
                        <button
                          onClick={() => setSelectedBotLogs(bot)}
                          className="px-2 py-1 rounded text-[11px] bg-slate-800 text-slate-300 hover:bg-slate-700"
                        >
                          Logs
                        </button>
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
      {isDeployModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-xl bg-[#0b101e] border border-cyan-500/30 rounded-2xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>⚡</span> Deploy Smart HFT Ladder Bot
              </h3>
              <button
                onClick={() => setIsDeployModalOpen(false)}
                className="text-slate-400 hover:text-white text-base"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateBot} className="mt-4 space-y-4 text-xs font-sans">
              <div>
                <label className="text-slate-300 block mb-1">Nama Bot</label>
                <input
                  type="text"
                  required
                  value={botName}
                  onChange={e => setBotName(e.target.value)}
                  className="w-full bg-[#1e293b] text-white px-3 py-2 rounded-lg border border-slate-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1">Trading Pair</label>
                  <select
                    value={simPairId}
                    onChange={e => setSimPairId(e.target.value)}
                    className="w-full bg-[#1e293b] text-white px-3 py-2 rounded-lg border border-slate-700 font-mono"
                  >
                    {tradingPairs.map(p => (
                      <option key={p.id} value={p.id}>{p.id}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-300 block mb-1">Environment</label>
                  <select
                    value={botEnvironment}
                    onChange={e => setBotEnvironment(e.target.value as any)}
                    className="w-full bg-[#1e293b] text-white px-3 py-2 rounded-lg border border-slate-700"
                  >
                    <option value="DEMO">DEMO (Testnet)</option>
                    <option value="STAGING">STAGING</option>
                    <option value="PRODUCTION">PRODUCTION (Live Market)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1">Pola Grafik (Modul A)</label>
                  <select
                    value={simPattern}
                    onChange={e => setSimPattern(e.target.value as PatternFormationType)}
                    className="w-full bg-[#1e293b] text-cyan-300 px-3 py-2 rounded-lg border border-cyan-500/40 font-semibold"
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
                  <label className="text-slate-300 block mb-1">Timeframe (Skala TF)</label>
                  <select
                    value={simTimeframe}
                    onChange={e => setSimTimeframe(e.target.value as PatternTimeframe)}
                    className="w-full bg-[#1e293b] text-white px-3 py-2 rounded-lg border border-slate-700 font-mono"
                  >
                    <option value="5m">5 Menit (60 Bars)</option>
                    <option value="15m">15 Menit (100 Bars)</option>
                    <option value="1h">1 Jam (150 Bars)</option>
                    <option value="4h">4 Jam (240 Bars)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1">Min Price Bound (Absolut Bawah)</label>
                  <input
                    type="text"
                    required
                    value={simMinBound}
                    onChange={e => setSimMinBound(e.target.value)}
                    className="w-full bg-[#1e293b] text-emerald-400 px-3 py-2 rounded-lg border border-emerald-500/30 font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-300 block mb-1">Max Price Bound (Absolut Atas)</label>
                  <input
                    type="text"
                    required
                    value={simMaxBound}
                    onChange={e => setSimMaxBound(e.target.value)}
                    className="w-full bg-[#1e293b] text-red-400 px-3 py-2 rounded-lg border border-red-500/30 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1">Buy Lot (Level 1 → Level Terjauh)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={simMinBuyLot}
                      onChange={e => setSimMinBuyLot(e.target.value)}
                      placeholder="Min"
                      className="w-1/2 bg-[#1e293b] text-white px-2 py-1.5 rounded border border-slate-700 font-mono text-center"
                    />
                    <input
                      type="text"
                      required
                      value={simMaxBuyLot}
                      onChange={e => setSimMaxBuyLot(e.target.value)}
                      placeholder="Max"
                      className="w-1/2 bg-[#1e293b] text-white px-2 py-1.5 rounded border border-slate-700 font-mono text-center"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-slate-300 block mb-1">Sell Lot (Level 1 → Level Terjauh)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={simMinSellLot}
                      onChange={e => setSimMinSellLot(e.target.value)}
                      placeholder="Min"
                      className="w-1/2 bg-[#1e293b] text-white px-2 py-1.5 rounded border border-slate-700 font-mono text-center"
                    />
                    <input
                      type="text"
                      required
                      value={simMaxSellLot}
                      onChange={e => setSimMaxSellLot(e.target.value)}
                      placeholder="Max"
                      className="w-1/2 bg-[#1e293b] text-white px-2 py-1.5 rounded border border-slate-700 font-mono text-center"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 block mb-1">Total Order Ladder (Max 100)</label>
                  <input
                    type="number"
                    min={2}
                    max={100}
                    step={2}
                    value={simTotalOrders}
                    onChange={e => setSimTotalOrders(Number(e.target.value))}
                    className="w-full bg-[#1e293b] text-cyan-400 px-3 py-2 rounded-lg border border-cyan-500/30 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="text-slate-300 block mb-1">Interval Rotasi Tangga (ms)</label>
                  <input
                    type="number"
                    step={500}
                    value={repriceIntervalMs}
                    onChange={e => setRepriceIntervalMs(Number(e.target.value))}
                    className="w-full bg-[#1e293b] text-white px-3 py-2 rounded-lg border border-slate-700 font-mono"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-900 rounded-lg text-[11px] text-slate-400 border border-slate-800 space-y-1">
                <div>✓ <strong>Modul A</strong>: Menghasilkan pola geometris & anchor running price secara deterministik.</div>
                <div>✓ <strong>Modul B</strong>: Menaruh {simTotalOrders} order limit instan (50% Buy / 50% Sell) di dalam batas absolut.</div>
                <div>✓ <strong>Volume Risk Guard</strong>: Lot membesar bertahap dari Level 1 ke Level 20 tanpa pernah melewati batas maksimum.</div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDeployModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-lg shadow-lg"
                >
                  🚀 Buat & Aktifkan Bot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. MODAL: STANDALONE PYTHON SCRIPT VIEWER & DOWNLOAD */}
      {isPythonModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-4xl bg-[#080d19] border border-cyan-500/40 rounded-2xl p-5 shadow-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xl">🐍</span>
                <h3 className="text-sm font-bold text-white">
                  Python Standalone Script: <span className="text-cyan-400 font-mono">scripts/smart_hft_ladder_bot.py</span>
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadPython}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <span>⬇️</span> Download .py
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(pythonCode);
                    onSetFeedback({ type: 'success', text: 'Source code Python berhasil disalin ke clipboard!' });
                  }}
                  className="px-3 py-1 bg-[#1e293b] hover:bg-[#334155] text-slate-200 text-xs font-semibold rounded-lg border border-slate-700"
                >
                  Salin Kode
                </button>
                <button
                  onClick={() => setIsPythonModalOpen(false)}
                  className="text-slate-400 hover:text-white text-lg ml-2"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto mt-4 bg-[#050811] p-3.5 rounded-xl border border-slate-800 font-mono text-[11px] text-slate-300">
              {isLoadingCode ? (
                <div className="p-8 text-center text-slate-500">Memuat source code...</div>
              ) : (
                <pre className="whitespace-pre-wrap">{pythonCode}</pre>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <span>Dependencies: Python 3.10+, asyncio, pandas, numpy, matplotlib.</span>
              <span className="text-emerald-400 font-semibold">✓ Siap dijalankan langsung via terminal CLI</span>
            </div>
          </div>
        </div>
      )}

      {/* 8. MODAL: BOT LOGS */}
      {selectedBotLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-2xl bg-[#0b101e] border border-slate-800 rounded-2xl p-5 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>📜</span> Log Eksekusi: <span className="text-cyan-400">{selectedBotLogs.name}</span>
              </h3>
              <button
                onClick={() => setSelectedBotLogs(null)}
                className="text-slate-400 hover:text-white text-base"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto mt-4 space-y-1.5 font-mono text-xs">
              {selectedBotLogs.logs?.length === 0 ? (
                <div className="p-6 text-center text-slate-500">Belum ada log tercatat.</div>
              ) : (
                selectedBotLogs.logs.map((l: any, i: number) => (
                  <div
                    key={i}
                    className={`p-2 rounded border ${
                      l.type === 'ERROR' || l.type === 'RISK' ? 'bg-red-500/10 border-red-500/20 text-red-300' :
                      l.type === 'ORDER' ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300' :
                      'bg-slate-800/40 border-slate-700/30 text-slate-300'
                    }`}
                  >
                    <span className="text-slate-500 mr-2">[{new Date(l.timestamp).toLocaleTimeString()}]</span>
                    <span className="font-bold mr-2">[{l.type}]</span>
                    <span>{l.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
