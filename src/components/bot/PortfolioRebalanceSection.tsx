/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PortfolioRebalanceSection.tsx
 * DIMONEX Market Maker Automated Portfolio Rebalancing Console.
 * Allows setting target base/quote asset ratio, deviation threshold, and triggers real internal limit orders.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { TradingPairItem, PortfolioRebalanceConfig, RebalanceEvent } from '../../types/index.js';

interface PortfolioRebalanceSectionProps {
  tradingPairs: TradingPairItem[];
  onSetFeedback: (msg: { type: 'success' | 'error'; text: string } | null) => void;
}

export const PortfolioRebalanceSection: React.FC<PortfolioRebalanceSectionProps> = ({
  tradingPairs,
  onSetFeedback
}) => {
  const [selectedPairId, setSelectedPairId] = useState<string>('BTC-IDR');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Status & Config State
  const [config, setConfig] = useState<PortfolioRebalanceConfig | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [history, setHistory] = useState<RebalanceEvent[]>([]);

  // Form State
  const [targetRatio, setTargetRatio] = useState<number>(50);
  const [threshold, setThreshold] = useState<number>(5);
  const [maxOrderSizeQuote, setMaxOrderSizeQuote] = useState<string>('100000000');
  const [orderType, setOrderType] = useState<'LIMIT_PASSIVE' | 'LIMIT_AGGRESSIVE'>('LIMIT_PASSIVE');
  const [slippagePct, setSlippagePct] = useState<number>(0.25);
  const [checkIntervalSec, setCheckIntervalSec] = useState<number>(15);
  const [isEnabled, setIsEnabled] = useState<boolean>(false);

  // Active Pair Object
  const currentPair = useMemo(() => {
    return tradingPairs.find(p => p.id === selectedPairId) || tradingPairs[0] || {
      id: 'BTC-IDR',
      baseCurrency: 'BTC',
      quoteCurrency: 'IDR',
      lastPrice: '145000000000',
      baseDecimals: 8,
      quoteDecimals: 2
    };
  }, [tradingPairs, selectedPairId]);

  const loadData = async (pairId: string) => {
    setIsLoading(true);
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const res = await safeFetchJson<any>(`/api/mm/rebalance/status?pairId=${pairId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok && res.data) {
        setStatus(res.data.status);
        if (res.data.config) {
          const cfg: PortfolioRebalanceConfig = res.data.config;
          setConfig(cfg);
          setTargetRatio(cfg.targetBaseRatioPct);
          setThreshold(cfg.deviationThresholdPct);
          setMaxOrderSizeQuote(cfg.maxOrderSizeQuote);
          setOrderType(cfg.rebalanceOrderType);
          setSlippagePct(cfg.slippageTolerancePct);
          setCheckIntervalSec(cfg.checkIntervalSec);
          setIsEnabled(cfg.enabled);
          setHistory(cfg.rebalanceHistory || []);
        }
      } else {
        onSetFeedback({ type: 'error', text: res.data?.error || 'Gagal memuat status rebalancing.' });
      }
    } catch (err: any) {
      onSetFeedback({ type: 'error', text: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(selectedPairId);
    const interval = setInterval(() => {
      loadData(selectedPairId);
    }, 10000);
    return () => clearInterval(interval);
  }, [selectedPairId]);

  const handleSaveConfig = async () => {
    setIsSaving(true);
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const res = await safeFetchJson<any>('/api/mm/rebalance/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          pairId: selectedPairId,
          targetBaseRatioPct: targetRatio,
          deviationThresholdPct: threshold,
          maxOrderSizeQuote,
          rebalanceOrderType: orderType,
          slippageTolerancePct: slippagePct,
          checkIntervalSec,
          enabled: isEnabled
        })
      });

      if (res.ok && res.data) {
        onSetFeedback({ type: 'success', text: 'Konfigurasi penyeimbangan ulang portofolio berhasil disimpan!' });
        setConfig(res.data.config);
        setStatus(res.data.status);
      } else {
        onSetFeedback({ type: 'error', text: res.data?.error || 'Gagal menyimpan konfigurasi.' });
      }
    } catch (err: any) {
      onSetFeedback({ type: 'error', text: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleExecuteNow = async () => {
    setIsExecuting(true);
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const res = await safeFetchJson<any>('/api/mm/rebalance/execute-now', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ pairId: selectedPairId })
      });

      if (res.ok && res.data) {
        const evt: RebalanceEvent = res.data.rebalanceEvent;
        if (evt.status === 'EXECUTED') {
          onSetFeedback({ type: 'success', text: evt.reason });
        } else if (evt.status === 'SKIPPED') {
          onSetFeedback({ type: 'success', text: `[Info] ${evt.reason}` });
        } else {
          onSetFeedback({ type: 'error', text: evt.reason });
        }
        setStatus(res.data.status);
        loadData(selectedPairId);
      } else {
        onSetFeedback({ type: 'error', text: res.data?.error || 'Gagal mengeksekusi rebalance.' });
      }
    } catch (err: any) {
      onSetFeedback({ type: 'error', text: err.message });
    } finally {
      setIsExecuting(false);
    }
  };

  const actualBasePct = status ? status.actualBaseRatioPct : 50;
  const actualQuotePct = 100 - actualBasePct;
  const deviation = status ? status.deviationPct : 0;
  const isDeviationExceeded = status ? status.isDeviationExceeded : false;

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0b0f19] p-5 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-lg">⚖️</span>
            <div>
              <h2 className="text-lg font-black tracking-wide text-white flex items-center gap-2">
                Automated Portfolio Rebalancing
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                  isEnabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-slate-700/50 text-slate-400'
                }`}>
                  {isEnabled ? '● Active Loop' : '○ Standby'}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Menjaga rasio aset dasar terhadap kuotasi secara otomatis via limit order internal matching engine.
              </p>
            </div>
          </div>
        </div>

        {/* Pair Selector */}
        <div className="flex items-center gap-3">
          <label htmlFor="pair-select" className="text-xs text-slate-400 font-medium">Trading Pair:</label>
          <select
            id="pair-select"
            aria-label="Pilih Trading Pair"
            value={selectedPairId}
            onChange={(e) => setSelectedPairId(e.target.value)}
            className="bg-[#131b2e] text-cyan-300 font-bold px-3 py-1.5 rounded-xl border border-cyan-500/30 text-xs focus:outline-none focus:border-cyan-400"
          >
            {tradingPairs.map(p => (
              <option key={p.id} value={p.id}>{p.id} ({p.baseCurrency}/{p.quoteCurrency})</option>
            ))}
          </select>

          <button
            onClick={() => loadData(selectedPairId)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
            title="Refresh Status"
          >
            🔄
          </button>
        </div>
      </div>

      {/* Allocation Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Total Value */}
        <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800/80">
          <span className="text-[11px] text-slate-400 uppercase tracking-wider font-mono">Total Nilai Portofolio</span>
          <div className="text-lg font-bold text-white mt-1">
            {status ? status.totalPortfolioValueQuoteDisplay : 'Rp 0'}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Ref Price: <span className="text-cyan-400">{status ? status.referencePriceDisplay : '-'}</span>
          </div>
        </div>

        {/* Base Asset Balances */}
        <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800/80">
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider font-mono">Saldo {currentPair.baseCurrency}</span>
            <span className="text-[10px] font-bold text-cyan-400 font-mono">{actualBasePct.toFixed(1)}%</span>
          </div>
          <div className="text-lg font-bold text-cyan-300 mt-1">
            {status ? status.baseBalanceDisplay : '0.00'} <span className="text-xs text-slate-400">{currentPair.baseCurrency}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Nilai: <span className="text-slate-300">{status ? status.baseValueQuoteDisplay : 'Rp 0'}</span>
          </div>
        </div>

        {/* Quote Asset Balances */}
        <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800/80">
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-slate-400 uppercase tracking-wider font-mono">Saldo {currentPair.quoteCurrency}</span>
            <span className="text-[10px] font-bold text-amber-400 font-mono">{actualQuotePct.toFixed(1)}%</span>
          </div>
          <div className="text-lg font-bold text-amber-300 mt-1">
            {status ? status.quoteBalanceDisplay : 'Rp 0'}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Tersedia untuk pembobotan liquid
          </div>
        </div>

        {/* Deviation Status */}
        <div className={`p-4 rounded-xl border ${
          isDeviationExceeded
            ? 'bg-amber-950/20 border-amber-500/40 text-amber-300'
            : 'bg-[#0b0f19] border-slate-800/80 text-emerald-400'
        }`}>
          <div className="flex justify-between items-center">
            <span className="text-[11px] uppercase tracking-wider font-mono">Status Deviasi</span>
            <span className="text-[10px] font-bold font-mono">
              Ambang: ±{threshold}%
            </span>
          </div>
          <div className="text-lg font-bold mt-1 flex items-center gap-1.5">
            {deviation > 0 ? `+${deviation.toFixed(2)}%` : `${deviation.toFixed(2)}%`}
            <span className="text-xs font-normal">
              {deviation > 0 ? `(Kelebihan ${currentPair.baseCurrency})` : deviation < 0 ? `(Kekurangan ${currentPair.baseCurrency})` : '(Seimbang)'}
            </span>
          </div>
          <div className="text-[10px] mt-0.5">
            {isDeviationExceeded ? '⚠️ Melebihi batas ambang rebalance' : '✓ Alokasi stabil dalam batas aman'}
          </div>
        </div>
      </div>

      {/* Visual Allocation Ratio Bar */}
      <div className="bg-[#0b0f19] p-5 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex justify-between text-xs font-semibold">
          <span className="text-cyan-400">
            {currentPair.baseCurrency}: {actualBasePct.toFixed(1)}% (Target: {targetRatio}%)
          </span>
          <span className="text-amber-400">
            {currentPair.quoteCurrency}: {actualQuotePct.toFixed(1)}% (Target: {100 - targetRatio}%)
          </span>
        </div>

        {/* Visual Bar */}
        <div className="relative w-full h-6 bg-slate-900 rounded-full overflow-hidden border border-slate-700/80 flex shadow-inner">
          <div
            className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-all duration-500 flex items-center justify-start pl-2 text-[10px] font-black text-slate-900"
            style={{ width: `${actualBasePct}%` }}
          >
            {actualBasePct > 12 && `${actualBasePct.toFixed(0)}% ${currentPair.baseCurrency}`}
          </div>
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-500 flex items-center justify-end pr-2 text-[10px] font-black text-slate-900"
            style={{ width: `${actualQuotePct}%` }}
          >
            {actualQuotePct > 12 && `${actualQuotePct.toFixed(0)}% ${currentPair.quoteCurrency}`}
          </div>

          {/* Target Ratio Marker Line */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-white shadow-lg pointer-events-none transform -translate-x-1/2 z-10"
            style={{ left: `${targetRatio}%` }}
            title={`Target Ratio: ${targetRatio}% Base`}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45"></div>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45"></div>
          </div>
        </div>

        <div className="flex justify-between text-[11px] text-slate-500">
          <span>0% {currentPair.baseCurrency}</span>
          <span className="text-white font-mono text-[10px] bg-slate-800 px-2 py-0.5 rounded">
            Garis Putih: Target Alokasi ({targetRatio}%)
          </span>
          <span>100% {currentPair.baseCurrency}</span>
        </div>
      </div>

      {/* Control Panel: Config Form & Instant Rebalance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Configuration Form */}
        <div className="lg:col-span-2 bg-[#0b0f19] p-5 rounded-2xl border border-slate-800 space-y-5">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            ⚙️ Parameter Penyeimbangan Portofolio
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Target Ratio Slider */}
            <div className="sm:col-span-2 bg-[#0f172a] p-3.5 rounded-xl border border-slate-800">
              <div className="flex justify-between items-center mb-2">
                <label htmlFor="target-ratio-slider" className="text-xs text-slate-300 font-semibold">
                  Rasio Target {currentPair.baseCurrency} / {currentPair.quoteCurrency}
                </label>
                <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-950/60 px-2.5 py-0.5 rounded border border-cyan-500/30">
                  {targetRatio}% Base : {100 - targetRatio}% Quote
                </span>
              </div>
              <input
                id="target-ratio-slider"
                name="targetRatioSlider"
                aria-label="Target Ratio Slider"
                type="range"
                min={10}
                max={90}
                step={5}
                value={targetRatio}
                onChange={e => setTargetRatio(Number(e.target.value))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-1.5">
                <span>10% (Agresif Quote)</span>
                <span>50% (Netral 50/50)</span>
                <span>90% (Agresif Base)</span>
              </div>
            </div>

            {/* Deviation Threshold */}
            <div>
              <label htmlFor="threshold-input" className="text-xs text-slate-300 block mb-1">
                Ambang Deviasi Pemicu (±%)
              </label>
              <div className="relative">
                <input
                  id="threshold-input"
                  name="thresholdInput"
                  aria-label="Ambang Deviasi Pemicu"
                  type="number"
                  min={1}
                  max={25}
                  step={0.5}
                  value={threshold}
                  onChange={e => setThreshold(Number(e.target.value))}
                  className="w-full bg-[#131b2e] text-cyan-300 font-mono px-3 py-2 rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-cyan-400"
                />
                <span className="absolute right-3 top-2 text-xs text-slate-500">%</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">
                Order terpicu jika selisih rasio melebihi ±{threshold}%.
              </span>
            </div>

            {/* Max Order Size Quote */}
            <div>
              <label htmlFor="max-order-quote" className="text-xs text-slate-300 block mb-1">
                Batas Nilai Order Maksimal (IDR)
              </label>
              <input
                id="max-order-quote"
                name="maxOrderSizeQuote"
                aria-label="Batas Nilai Order Maksimal IDR"
                type="text"
                value={maxOrderSizeQuote}
                onChange={e => setMaxOrderSizeQuote(e.target.value)}
                placeholder="100000000"
                className="w-full bg-[#131b2e] text-slate-200 font-mono px-3 py-2 rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-cyan-400"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Membatasi eksposur per eksekusi penyeimbangan.
              </span>
            </div>

            {/* Order Execution Type */}
            <div>
              <label htmlFor="order-type-select" className="text-xs text-slate-300 block mb-1">Tipe Order Rebalance</label>
              <select
                id="order-type-select"
                aria-label="Tipe Order Rebalance"
                value={orderType}
                onChange={e => setOrderType(e.target.value as any)}
                className="w-full bg-[#131b2e] text-slate-200 px-3 py-2 rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-cyan-400"
              >
                <option value="LIMIT_PASSIVE">LIMIT PASSIVE (Maker fee 0.10%, antre liquidity)</option>
                <option value="LIMIT_AGGRESSIVE">LIMIT AGGRESSIVE (Taker fee 0.20%, eksekusi instan)</option>
              </select>
            </div>

            {/* Check Interval */}
            <div>
              <label htmlFor="interval-input" className="text-xs text-slate-300 block mb-1">Interval Cek Otomatis (detik)</label>
              <input
                id="interval-input"
                name="checkIntervalInput"
                aria-label="Interval Cek Otomatis Detik"
                type="number"
                min={5}
                max={300}
                step={5}
                value={checkIntervalSec}
                onChange={e => setCheckIntervalSec(Number(e.target.value))}
                className="w-full bg-[#131b2e] text-slate-200 font-mono px-3 py-2 rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          {/* Toggle and Save Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-slate-800">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={e => setIsEnabled(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-0 cursor-pointer"
              />
              <span className="text-xs font-semibold text-slate-300">
                Aktifkan Loop Rebalance Otomatis di Background
              </span>
            </label>

            <button
              onClick={handleSaveConfig}
              disabled={isSaving}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs transition shadow-lg shadow-cyan-900/30 disabled:opacity-50"
            >
              {isSaving ? 'Menyimpan...' : '💾 Simpan Konfigurasi'}
            </button>
          </div>
        </div>

        {/* Right 1 Col: Suggested Action Card & Manual Trigger */}
        <div className="bg-[#0b0f19] p-5 rounded-2xl border border-slate-800 space-y-4 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
              ⚡ Tindakan Penyeimbangan
            </h3>

            {status && status.suggestedAction !== 'NONE' ? (
              <div className={`p-4 rounded-xl border ${
                status.suggestedAction === 'SELL_BASE'
                  ? 'bg-amber-950/20 border-amber-500/30 text-amber-300'
                  : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
              } space-y-2`}>
                <div className="text-xs font-bold uppercase tracking-wider flex items-center justify-between">
                  <span>Rekomendasi:</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-black/40">
                    {status.suggestedAction === 'SELL_BASE' ? 'JUAL BASE' : 'BELI BASE'}
                  </span>
                </div>
                <div className="text-sm font-bold text-white">
                  {status.suggestedAction === 'SELL_BASE' ? 'Kelebihan Bobot Aset' : 'Kekurangan Bobot Aset'}
                </div>
                <p className="text-[11px] leading-relaxed text-slate-300">
                  Untuk mengembalikan ke target {targetRatio}%, sistem perlu menempatkan order{' '}
                  <span className="font-bold text-white">
                    {status.suggestedAction === 'SELL_BASE' ? 'SELL' : 'BUY'} {status.suggestedOrderQtyDisplay} {currentPair.baseCurrency}
                  </span>{' '}
                  senilai <span className="font-bold text-white">{status.baseValueQuoteDisplay}</span>.
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-slate-800 bg-[#0f172a] text-slate-400 text-xs space-y-2">
                <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                  ✓ Portofolio Seimbang
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Alokasi saat ini ({actualBasePct.toFixed(1)}%) mendekati target ({targetRatio}%). Deviasi {deviation.toFixed(2)}% tidak melampaui ambang batas ±{threshold}%.
                </p>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-800 space-y-2">
            <button
              onClick={handleExecuteNow}
              disabled={isExecuting}
              className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl text-xs transition shadow-lg shadow-amber-900/30 disabled:opacity-50"
            >
              {isExecuting ? 'Mengeksekusi...' : '🚀 Rebalance Sekarang (Eksekusi Instan)'}
            </button>
            <p className="text-[10px] text-slate-500 text-center">
              Memeriksa buku pesanan dan mengirim order limit langsung ke matching engine.
            </p>
          </div>
        </div>
      </div>

      {/* Rebalance Audit & Execution History Table */}
      <div className="bg-[#0b0f19] p-5 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            📜 Riwayat Audit Penyeimbangan Portofolio
          </h3>
          <span className="text-[11px] text-slate-400 font-mono">
            {history.length} Event Tercatat
          </span>
        </div>

        {history.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Belum ada eksekusi rebalance yang dicatat untuk trading pair ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase">
                  <th className="pb-2">Waktu</th>
                  <th className="pb-2">Tindakan</th>
                  <th className="pb-2">Jumlah Base</th>
                  <th className="pb-2">Harga</th>
                  <th className="pb-2">Deviasi</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {history.map((evt) => (
                  <tr key={evt.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-2.5 text-slate-400">
                      {new Date(evt.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        evt.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {evt.side}
                      </span>
                    </td>
                    <td className="py-2.5 text-white font-semibold">{evt.baseAmount || evt.quantity}</td>
                    <td className="py-2.5 text-slate-300">{evt.price}</td>
                    <td className="py-2.5 text-slate-400">
                      {evt.deviationPct > 0 ? `+${evt.deviationPct}%` : `${evt.deviationPct}%`}
                    </td>
                    <td className="py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        evt.status === 'EXECUTED'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : evt.status === 'SKIPPED'
                          ? 'bg-slate-700/50 text-slate-300'
                          : 'bg-red-500/20 text-red-300 border border-red-500/30'
                      }`}>
                        {evt.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-slate-400 text-[11px] max-w-xs truncate" title={evt.reason}>
                      {evt.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
