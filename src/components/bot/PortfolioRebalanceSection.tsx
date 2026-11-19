/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PortfolioRebalanceSection.tsx
 * DIMONEX Market Maker Automated Portfolio Rebalancing Console.
 * Allows setting target base/quote asset ratio, deviation threshold, and triggers real internal limit orders.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Scale,
  RefreshCw,
  Sliders,
  Save,
  Zap,
  Play,
  History,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { TradingPairItem, PortfolioRebalanceConfig, RebalanceEvent } from '../../types/index.js';
import { PanelHeader } from '../ui/PanelHeader.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { Button } from '../ui/Button.js';

interface PortfolioRebalanceSectionProps {
  tradingPairs: TradingPairItem[];
  onSetFeedback: (msg: { type: 'success' | 'error'; text: string } | null) => void;
}

export const PortfolioRebalanceSection: React.FC<PortfolioRebalanceSectionProps> = ({
  tradingPairs,
  onSetFeedback,
}) => {
  const [selectedPairId, setSelectedPairId] = useState<string>('BTC-IDR');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const [config, setConfig] = useState<PortfolioRebalanceConfig | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [history, setHistory] = useState<RebalanceEvent[]>([]);

  const [targetRatio, setTargetRatio] = useState<number>(50);
  const [threshold, setThreshold] = useState<number>(5);
  const [maxOrderSizeQuote, setMaxOrderSizeQuote] = useState<string>('100000000');
  const [orderType, setOrderType] = useState<'LIMIT_PASSIVE' | 'LIMIT_AGGRESSIVE'>('LIMIT_PASSIVE');
  const [slippagePct, setSlippagePct] = useState<number>(0.25);
  const [checkIntervalSec, setCheckIntervalSec] = useState<number>(15);
  const [isEnabled, setIsEnabled] = useState<boolean>(false);

  const currentPair = useMemo(() => {
    return (
      tradingPairs.find(p => p.id === selectedPairId) ||
      tradingPairs[0] || {
        id: 'BTC-IDR',
        baseCurrency: 'BTC',
        quoteCurrency: 'IDR',
        lastPrice: '145000000000',
        baseDecimals: 8,
        quoteDecimals: 2,
      }
    );
  }, [tradingPairs, selectedPairId]);

  const loadData = async (pairId: string) => {
    setIsLoading(true);
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const res = await safeFetchJson<any>(`/api/mm/rebalance/status?pairId=${pairId}`, {
        headers: { Authorization: `Bearer ${token}` },
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
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pairId: selectedPairId,
          targetBaseRatioPct: targetRatio,
          deviationThresholdPct: threshold,
          maxOrderSizeQuote,
          rebalanceOrderType: orderType,
          slippageTolerancePct: slippagePct,
          checkIntervalSec,
          enabled: isEnabled,
        }),
      });

      if (res.ok && res.data) {
        onSetFeedback({
          type: 'success',
          text: 'Konfigurasi penyeimbangan ulang portofolio berhasil disimpan.',
        });
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
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pairId: selectedPairId }),
      });

      if (res.ok && res.data) {
        const evt: RebalanceEvent = res.data.rebalanceEvent;
        if (evt.status === 'EXECUTED') {
          onSetFeedback({ type: 'success', text: evt.reason });
        } else if (evt.status === 'SKIPPED') {
          onSetFeedback({ type: 'success', text: evt.reason });
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
    <div className="space-y-5">
      {/* Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#141C24] p-5 rounded-[10px] border border-[#202B34]">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-[7px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1] shrink-0">
            <Scale className="w-4 h-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base font-semibold tracking-tight text-[#E4EBEF]">
                Automated Portfolio Rebalancing
              </h2>
              <StatusBadge tone={isEnabled ? 'success' : 'neutral'} dot={isEnabled}>
                {isEnabled ? 'Active Loop' : 'Standby'}
              </StatusBadge>
              {config && (
                <span className="text-[11px] font-mono tabular-nums text-[#71818B]">
                  Interval {checkIntervalSec}s
                </span>
              )}
            </div>
            <p className="text-xs text-[#A1AFB8] mt-1">
              Menjaga rasio aset dasar terhadap kuotasi secara otomatis via limit order internal matching engine.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <label htmlFor="rebalance-pair-select" className="text-xs text-[#A1AFB8]">
            Pair:
          </label>
          <select
            id="rebalance-pair-select"
            aria-label="Pilih Trading Pair"
            value={selectedPairId}
            onChange={(e) => setSelectedPairId(e.target.value)}
            className="bg-[#111820] text-[#E4EBEF] font-mono text-xs font-medium px-3 py-2 rounded-[7px] border border-[#2B3944] focus:outline-none focus:border-[#8DA5B1]"
          >
            {tradingPairs.map(p => (
              <option key={p.id} value={p.id}>
                {p.id} ({p.baseCurrency}/{p.quoteCurrency})
              </option>
            ))}
          </select>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => loadData(selectedPairId)}
            isLoading={isLoading}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            title="Refresh Status"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Allocation KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#141C24] p-4 rounded-[10px] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B]">Total Nilai Portofolio</span>
          <div className="text-lg font-mono tabular-nums font-semibold text-[#E4EBEF] mt-1">
            {status ? status.totalPortfolioValueQuoteDisplay : '0'}
          </div>
          <div className="text-[11px] text-[#71818B] font-mono tabular-nums mt-1">
            Ref Price: <span className="text-[#8DA5B1]">{status ? status.referencePriceDisplay : '-'}</span>
          </div>
        </div>

        <div className="bg-[#141C24] p-4 rounded-[10px] border border-[#202B34]">
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-[#71818B]">Saldo {currentPair.baseCurrency}</span>
            <span className="text-[11px] font-mono tabular-nums font-semibold text-[#8DA5B1]">
              {actualBasePct.toFixed(1)}%
            </span>
          </div>
          <div className="text-lg font-mono tabular-nums font-semibold text-[#E4EBEF] mt-1">
            {status ? status.baseBalanceDisplay : '0.00'}{' '}
            <span className="text-xs text-[#71818B] font-normal">{currentPair.baseCurrency}</span>
          </div>
          <div className="text-[11px] text-[#71818B] font-mono tabular-nums mt-1">
            Nilai: <span className="text-[#A1AFB8]">{status ? status.baseValueQuoteDisplay : '0'}</span>
          </div>
        </div>

        <div className="bg-[#141C24] p-4 rounded-[10px] border border-[#202B34]">
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-[#71818B]">Saldo {currentPair.quoteCurrency}</span>
            <span className="text-[11px] font-mono tabular-nums font-semibold text-[#D6A85C]">
              {actualQuotePct.toFixed(1)}%
            </span>
          </div>
          <div className="text-lg font-mono tabular-nums font-semibold text-[#E4EBEF] mt-1">
            {status ? status.quoteBalanceDisplay : '0'}
          </div>
          <div className="text-[11px] text-[#71818B] mt-1">Likuiditas quote tersedia</div>
        </div>

        <div
          className={`p-4 rounded-[10px] border ${
            isDeviationExceeded
              ? 'bg-[#2C2415]/40 border-[#D6A85C]/40'
              : 'bg-[#141C24] border-[#202B34]'
          }`}
        >
          <div className="flex justify-between items-center">
            <span className="text-[11px] text-[#71818B]">Status Deviasi</span>
            <span className="text-[11px] font-mono tabular-nums text-[#A1AFB8]">
              Ambang: ±{threshold}%
            </span>
          </div>
          <div
            className={`text-lg font-mono tabular-nums font-semibold mt-1 flex items-center gap-1.5 ${
              isDeviationExceeded ? 'text-[#D6A85C]' : 'text-[#35B887]'
            }`}
          >
            <span>{deviation > 0 ? `+${deviation.toFixed(2)}%` : `${deviation.toFixed(2)}%`}</span>
            <span className="text-xs font-sans font-normal text-[#A1AFB8]">
              {deviation > 0
                ? `(Surplus ${currentPair.baseCurrency})`
                : deviation < 0
                ? `(Defisit ${currentPair.baseCurrency})`
                : '(Seimbang)'}
            </span>
          </div>
          <div className="text-[11px] mt-1 flex items-center gap-1.5 text-[#A1AFB8]">
            {isDeviationExceeded ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-[#D6A85C] shrink-0" />
                <span>Melebihi ambang pemicu rebalance</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-[#35B887] shrink-0" />
                <span>Alokasi dalam batas aman</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Allocation Ratio Meter */}
      <div className="bg-[#141C24] p-5 rounded-[10px] border border-[#202B34] space-y-3">
        <div className="flex justify-between text-xs font-mono tabular-nums">
          <span className="text-[#C1D0D6]">
            {currentPair.baseCurrency}: {actualBasePct.toFixed(1)}% (Target {targetRatio}%)
          </span>
          <span className="text-[#D6A85C]">
            {currentPair.quoteCurrency}: {actualQuotePct.toFixed(1)}% (Target {100 - targetRatio}%)
          </span>
        </div>

        <div className="relative w-full h-5 bg-[#111820] rounded-[7px] overflow-hidden border border-[#2B3944] flex">
          <div
            className="h-full bg-[#8DA5B1] transition-all duration-300 flex items-center justify-start pl-2.5 text-[10px] font-mono font-semibold text-[#090D12]"
            style={{ width: `${actualBasePct}%` }}
          >
            {actualBasePct > 14 && `${actualBasePct.toFixed(0)}% ${currentPair.baseCurrency}`}
          </div>
          <div
            className="h-full bg-[#D6A85C]/80 transition-all duration-300 flex items-center justify-end pr-2.5 text-[10px] font-mono font-semibold text-[#090D12]"
            style={{ width: `${actualQuotePct}%` }}
          >
            {actualQuotePct > 14 && `${actualQuotePct.toFixed(0)}% ${currentPair.quoteCurrency}`}
          </div>

          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[#E4EBEF] pointer-events-none transform -translate-x-1/2 z-10"
            style={{ left: `${targetRatio}%` }}
            title={`Target Ratio: ${targetRatio}% Base`}
          />
        </div>

        <div className="flex justify-between text-[11px] font-mono text-[#71818B]">
          <span>0% {currentPair.baseCurrency}</span>
          <span className="text-[#A1AFB8]">Penanda Putih: Target Alokasi ({targetRatio}%)</span>
          <span>100% {currentPair.baseCurrency}</span>
        </div>
      </div>

      {/* Config Form & Manual Execution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Configuration Panel */}
        <div className="lg:col-span-2 bg-[#141C24] rounded-[10px] border border-[#202B34] overflow-hidden">
          <PanelHeader
            title="Parameter Penyeimbangan Portofolio"
            subtitle="Konfigurasi rasio target dan batas eksposur eksekusi"
            icon={<Sliders className="w-4 h-4" />}
          />

          <div className="p-5 space-y-5">
            <div className="bg-[#111820] p-4 rounded-[7px] border border-[#202B34]">
              <div className="flex justify-between items-center mb-2.5">
                <label htmlFor="target-ratio-slider" className="text-xs font-medium text-[#E4EBEF]">
                  Rasio Target {currentPair.baseCurrency} / {currentPair.quoteCurrency}
                </label>
                <span className="text-xs font-mono tabular-nums font-semibold text-[#C1D0D6]">
                  {targetRatio}% Base · {100 - targetRatio}% Quote
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
                className="w-full h-1.5 bg-[#202B34] rounded-[7px] appearance-none cursor-pointer accent-[#8DA5B1]"
              />
              <div className="flex justify-between text-[11px] text-[#71818B] mt-2 font-mono">
                <span>10% (Quote Weight)</span>
                <span>50% (Balanced)</span>
                <span>90% (Base Weight)</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="threshold-input" className="text-xs text-[#A1AFB8] block mb-1.5">
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
                    className="w-full bg-[#111820] text-[#E4EBEF] font-mono tabular-nums px-3 py-2 rounded-[7px] border border-[#2B3944] text-xs focus:outline-none focus:border-[#8DA5B1]"
                  />
                  <span className="absolute right-3 top-2 text-xs font-mono text-[#71818B]">%</span>
                </div>
                <span className="text-[11px] text-[#71818B] mt-1 block">
                  Order terpicu jika selisih rasio melebihi ±{threshold}%.
                </span>
              </div>

              <div>
                <label htmlFor="max-order-quote" className="text-xs text-[#A1AFB8] block mb-1.5">
                  Batas Nilai Order Maksimal ({currentPair.quoteCurrency})
                </label>
                <input
                  id="max-order-quote"
                  name="maxOrderSizeQuote"
                  aria-label={`Batas Nilai Order Maksimal ${currentPair.quoteCurrency}`}
                  type="text"
                  value={maxOrderSizeQuote}
                  onChange={e => setMaxOrderSizeQuote(e.target.value)}
                  placeholder="100000000"
                  className="w-full bg-[#111820] text-[#E4EBEF] font-mono tabular-nums px-3 py-2 rounded-[7px] border border-[#2B3944] text-xs focus:outline-none focus:border-[#8DA5B1]"
                />
                <span className="text-[11px] text-[#71818B] mt-1 block">
                  Membatasi eksposur per eksekusi penyeimbangan.
                </span>
              </div>

              <div>
                <label htmlFor="order-type-select" className="text-xs text-[#A1AFB8] block mb-1.5">
                  Tipe Order Rebalance
                </label>
                <select
                  id="order-type-select"
                  aria-label="Tipe Order Rebalance"
                  value={orderType}
                  onChange={e => setOrderType(e.target.value as any)}
                  className="w-full bg-[#111820] text-[#E4EBEF] px-3 py-2 rounded-[7px] border border-[#2B3944] text-xs focus:outline-none focus:border-[#8DA5B1]"
                >
                  <option value="LIMIT_PASSIVE">LIMIT PASSIVE (Maker fee 0.10%, antre liquidity)</option>
                  <option value="LIMIT_AGGRESSIVE">LIMIT AGGRESSIVE (Taker fee 0.20%, eksekusi instan)</option>
                </select>
              </div>

              <div>
                <label htmlFor="interval-input" className="text-xs text-[#A1AFB8] block mb-1.5">
                  Interval Cek Otomatis (detik)
                </label>
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
                  className="w-full bg-[#111820] text-[#E4EBEF] font-mono tabular-nums px-3 py-2 rounded-[7px] border border-[#2B3944] text-xs focus:outline-none focus:border-[#8DA5B1]"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4 border-t border-[#202B34]">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={e => setIsEnabled(e.target.checked)}
                  className="w-4 h-4 rounded bg-[#111820] border-[#2B3944] accent-[#8DA5B1] cursor-pointer"
                />
                <span className="text-xs font-medium text-[#E4EBEF]">
                  Aktifkan Loop Rebalance Otomatis di Background
                </span>
              </label>

              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleSaveConfig}
                isLoading={isSaving}
                icon={<Save className="w-3.5 h-3.5" />}
              >
                {isSaving ? 'Menyimpan...' : 'Simpan Konfigurasi'}
              </Button>
            </div>
          </div>
        </div>

        {/* Manual Trigger Card */}
        <div className="bg-[#141C24] rounded-[10px] border border-[#202B34] flex flex-col justify-between overflow-hidden">
          <div>
            <PanelHeader
              title="Tindakan Penyeimbangan"
              subtitle="Evaluasi deviasi & eksekusi instan"
              icon={<Zap className="w-4 h-4" />}
            />

            <div className="p-5">
              {status && status.suggestedAction !== 'NONE' ? (
                <div
                  className={`p-4 rounded-[7px] border space-y-2 ${
                    status.suggestedAction === 'SELL_BASE'
                      ? 'bg-[#2C2415]/40 border-[#D6A85C]/40'
                      : 'bg-[#12392F]/40 border-[#16A879]/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#A1AFB8]">Rekomendasi:</span>
                    <StatusBadge tone={status.suggestedAction === 'SELL_BASE' ? 'warning' : 'buy'}>
                      {status.suggestedAction === 'SELL_BASE' ? 'JUAL BASE' : 'BELI BASE'}
                    </StatusBadge>
                  </div>
                  <div className="text-sm font-semibold text-[#E4EBEF]">
                    {status.suggestedAction === 'SELL_BASE' ? 'Kelebihan Bobot Aset' : 'Kekurangan Bobot Aset'}
                  </div>
                  <p className="text-xs leading-relaxed text-[#A1AFB8]">
                    Untuk mengembalikan ke target {targetRatio}%, sistem menempatkan order{' '}
                    <span className="font-mono font-semibold text-[#E4EBEF]">
                      {status.suggestedAction === 'SELL_BASE' ? 'SELL' : 'BUY'} {status.suggestedOrderQtyDisplay}{' '}
                      {currentPair.baseCurrency}
                    </span>{' '}
                    senilai{' '}
                    <span className="font-mono font-semibold text-[#E4EBEF]">{status.baseValueQuoteDisplay}</span>.
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-[7px] border border-[#202B34] bg-[#111820] space-y-2">
                  <div className="text-[#35B887] text-xs font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Portofolio Seimbang</span>
                  </div>
                  <p className="text-xs text-[#A1AFB8] leading-relaxed">
                    Alokasi saat ini ({actualBasePct.toFixed(1)}%) mendekati target ({targetRatio}%). Deviasi{' '}
                    {deviation.toFixed(2)}% tidak melampaui ambang ±{threshold}%.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="p-5 pt-0 space-y-2.5">
            <Button
              type="button"
              variant="profit"
              size="lg"
              onClick={handleExecuteNow}
              isLoading={isExecuting}
              icon={<Play className="w-3.5 h-3.5" />}
              className="w-full"
            >
              {isExecuting ? 'Mengeksekusi...' : 'Rebalance Sekarang'}
            </Button>
            <p className="text-[11px] text-[#71818B] text-center">
              Memeriksa buku pesanan dan mengirim order limit langsung ke matching engine.
            </p>
          </div>
        </div>
      </div>

      {/* Rebalance Audit & Execution History Table */}
      <div className="bg-[#141C24] rounded-[10px] border border-[#202B34] overflow-hidden">
        <PanelHeader
          title="Riwayat Audit Penyeimbangan Portofolio"
          subtitle={`${history.length} event tercatat`}
          icon={<History className="w-4 h-4" />}
        />

        {history.length === 0 ? (
          <div className="py-10 text-center text-xs text-[#71818B]">
            Belum ada eksekusi rebalance yang dicatat untuk trading pair ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead>
                <tr className="border-b border-[#202B34] bg-[#111820] text-[#71818B] text-[11px]">
                  <th className="py-2.5 px-4 font-medium">Waktu</th>
                  <th className="py-2.5 px-4 font-medium">Tindakan</th>
                  <th className="py-2.5 px-4 font-medium text-right">Jumlah Base</th>
                  <th className="py-2.5 px-4 font-medium text-right">Harga</th>
                  <th className="py-2.5 px-4 font-medium text-right">Deviasi</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34]">
                {history.map((evt) => (
                  <tr key={evt.id} className="hover:bg-[#17212B] transition-colors">
                    <td className="py-2.5 px-4 text-[#A1AFB8]">
                      {new Date(evt.timestamp).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusBadge tone={evt.side === 'BUY' ? 'buy' : 'sell'}>{evt.side}</StatusBadge>
                    </td>
                    <td className="py-2.5 px-4 text-right text-[#E4EBEF] font-semibold">
                      {evt.baseAmount || evt.quantity}
                    </td>
                    <td className="py-2.5 px-4 text-right text-[#A1AFB8]">{evt.price}</td>
                    <td className="py-2.5 px-4 text-right text-[#A1AFB8]">
                      {evt.deviationPct > 0 ? `+${evt.deviationPct}%` : `${evt.deviationPct}%`}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusBadge
                        tone={
                          evt.status === 'EXECUTED'
                            ? 'success'
                            : evt.status === 'SKIPPED'
                            ? 'neutral'
                            : 'danger'
                        }
                      >
                        {evt.status}
                      </StatusBadge>
                    </td>
                    <td className="py-2.5 px-4 text-[#A1AFB8] font-sans text-xs max-w-xs truncate" title={evt.reason}>
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
