/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VolumeExecutionV2Panel.tsx
 * DIMONEX Volume Execution & Liquidity Management Engine V2 Workspace.
 * - Legitimate algorithmic order execution (TWAP, VWAP, ICEBERG, PASSIVE_LIMIT, AGGRESSIVE_LIMIT)
 * - Clear LIVE vs SIMULATION mode separation
 * - Real Ledger Available/Locked inventory, full BigInt metrics, Risk Controls, & Execution Audit Log
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Terminal,
  OctagonAlert,
} from 'lucide-react';
import {
  TradingPairItem,
  UserBalance,
  UserProfile,
  VolumeExecutionV2BotItem,
  VolumeExecutionV2Mode,
  VolumeExecutionV2Strategy,
} from '../../types/index.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { PanelHeader } from '../ui/PanelHeader.js';
import { formatDateTime, formatQuotePrice, safeBigInt } from '../../lib/formatters.js';

interface Props {
  user: UserProfile | null;
  pairs: TradingPairItem[];
  balances: UserBalance[];
  selectedPairId: string;
  onSelectPairId: (pairId: string) => void;
  onRefreshBalances?: () => void;
  onRefreshOrders?: () => void;
  onOpenAuthModal?: () => void;
}

function formatUnitsDecimal(unitsStr: string | undefined, decimals: number, maxFrac = 8): string {
  try {
    const val = BigInt(unitsStr || '0');
    if (val === 0n) return '0';
    const isNeg = val < 0n;
    const abs = isNeg ? -val : val;
    const scale = 10n ** BigInt(decimals);
    const whole = abs / scale;
    const rem = abs % scale;
    if (rem === 0n) return `${isNeg ? '-' : ''}${whole.toString()}`;
    const frac = rem.toString().padStart(decimals, '0').slice(0, maxFrac).replace(/0+$/, '');
    return frac ? `${isNeg ? '-' : ''}${whole.toString()}.${frac}` : `${isNeg ? '-' : ''}${whole.toString()}`;
  } catch {
    return '0';
  }
}

export const VolumeExecutionV2Panel: React.FC<Props> = ({
  user,
  pairs,
  balances,
  selectedPairId,
  onSelectPairId,
  onRefreshBalances,
  onRefreshOrders,
  onOpenAuthModal,
}) => {
  const selectedPair = useMemo(
    () =>
      pairs.find(p => p.id === selectedPairId) ||
      pairs[0] || {
        id: 'BTC-IDR',
        baseCurrency: 'BTC',
        quoteCurrency: 'IDR',
        baseDecimals: 8,
        quoteDecimals: 2,
        minOrderSize: '1000',
        lastPrice: '145000000000',
      },
    [pairs, selectedPairId]
  );

  const baseDec = selectedPair.baseDecimals ?? 8;
  const quoteDec = selectedPair.quoteDecimals ?? (selectedPair.quoteCurrency === 'USDT' ? 6 : 2);

  // Configuration form state (decimal string inputs — converted server-side strictly to BigInt)
  const [botName, setBotName] = useState('');
  const [strategy, setStrategy] = useState<VolumeExecutionV2Strategy>('TWAP');
  const [mode, setMode] = useState<VolumeExecutionV2Mode>('SIMULATION');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [targetQuantity, setTargetQuantity] = useState('0.05');
  const [sliceMinQuantity, setSliceMinQuantity] = useState('0.005');
  const [sliceMaxQuantity, setSliceMaxQuantity] = useState('0.015');
  const [icebergDisplayQuantity, setIcebergDisplayQuantity] = useState('0.01');
  const [durationSeconds, setDurationSeconds] = useState('120');
  const [intervalSeconds, setIntervalSeconds] = useState('4');
  const [orderTimeoutSeconds, setOrderTimeoutSeconds] = useState('15');
  const [maxPartialFillRetries, setMaxPartialFillRetries] = useState('3');
  const [passiveOffsetTicks, setPassiveOffsetTicks] = useState('1');

  // Risk Guardrails
  const [maxOrderNotionalQuote, setMaxOrderNotionalQuote] = useState('50000000');
  const [maxCumulativeExposureQuote, setMaxCumulativeExposureQuote] = useState('250000000');
  const [maxSlippageBps, setMaxSlippageBps] = useState('100');
  const [maxParticipationRateBps, setMaxParticipationRateBps] = useState('2500');
  const [priceCollarMin, setPriceCollarMin] = useState('1200000000');
  const [priceCollarMax, setPriceCollarMax] = useState('1700000000');
  const [maxOrdersPerMinute, setMaxOrdersPerMinute] = useState('20');
  const [dailyExecutionLimitBase, setDailyExecutionLimitBase] = useState('1');

  // Engine runtime state
  const [bots, setBots] = useState<VolumeExecutionV2BotItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [expandedLogBotId, setExpandedLogBotId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Sync sensible pair defaults when selected pair changes (without wiping user edits on every ticker tick)
  const lastSeededPairIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastSeededPairIdRef.current === selectedPair.id) return;
    lastSeededPairIdRef.current = selectedPair.id;

    const rawLast = safeBigInt(selectedPair.lastPrice || '0');
    if (rawLast > 0n) {
      const minCollar = (rawLast * 85n) / 100n;
      const maxCollar = (rawLast * 115n) / 100n;
      setPriceCollarMin(formatUnitsDecimal(minCollar.toString(), quoteDec, quoteDec));
      setPriceCollarMax(formatUnitsDecimal(maxCollar.toString(), quoteDec, quoteDec));
    }

    if (selectedPair.quoteCurrency === 'USDT') {
      const refNotional = rawLast > 0n ? '5000' : '1000';
      setMaxOrderNotionalQuote(refNotional);
      setMaxCumulativeExposureQuote(String(Number(refNotional) * 5));
    } else {
      setMaxOrderNotionalQuote('100000000');
      setMaxCumulativeExposureQuote('500000000');
    }

    if (selectedPair.baseCurrency === 'USDT') {
      setTargetQuantity('500');
      setSliceMinQuantity('50');
      setSliceMaxQuantity('150');
      setIcebergDisplayQuantity('100');
      setDailyExecutionLimitBase('5000');
    } else if (selectedPair.baseCurrency === 'ETH' || selectedPair.baseCurrency === 'SOL') {
      setTargetQuantity('1');
      setSliceMinQuantity('0.1');
      setSliceMaxQuantity('0.25');
      setIcebergDisplayQuantity('0.2');
      setDailyExecutionLimitBase('10');
    } else {
      setTargetQuantity('0.05');
      setSliceMinQuantity('0.005');
      setSliceMaxQuantity('0.015');
      setIcebergDisplayQuantity('0.01');
      setDailyExecutionLimitBase('1');
    }
  }, [selectedPair.id, selectedPair.lastPrice, selectedPair.baseCurrency, selectedPair.quoteCurrency, quoteDec]);

  const loadBots = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!user || !token) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/bot/volume-v2/list', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setBots(data);
        }
      }
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadBots();
    const timer = setInterval(loadBots, 2500);
    return () => clearInterval(timer);
  }, [loadBots]);

  const baseBalance = balances.find(b => b.currency === selectedPair.baseCurrency);
  const quoteBalance = balances.find(b => b.currency === selectedPair.quoteCurrency);

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('dimonex_auth_token');
    if (!user || !token) {
      onOpenAuthModal?.();
      setFeedback({ type: 'err', msg: 'Silakan login terlebih dahulu untuk menjalankan Volume Execution V2.' });
      return;
    }
    setFeedback(null);
    setIsDeploying(true);
    try {
      const res = await fetch('/api/bot/volume-v2/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: botName || undefined,
          idempotencyKey: `ui-vx2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          config: {
            pairId: selectedPair.id,
            side,
            strategy,
            mode,
            targetQuantity,
            sliceMinQuantity,
            sliceMaxQuantity,
            icebergDisplayQuantity,
            durationSeconds: Number(durationSeconds),
            intervalSeconds: Number(intervalSeconds),
            maxOrderNotionalQuote,
            maxCumulativeExposureQuote,
            maxSlippageBps: Number(maxSlippageBps),
            maxParticipationRateBps: Number(maxParticipationRateBps),
            priceCollarMin,
            priceCollarMax,
            maxOrdersPerMinute: Number(maxOrdersPerMinute),
            dailyExecutionLimitBase,
            maxPartialFillRetries: Number(maxPartialFillRetries),
            orderTimeoutSeconds: Number(orderTimeoutSeconds),
            passiveOffsetTicks: Number(passiveOffsetTicks),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal meluncurkan Volume Execution V2');
      }
      setFeedback({ type: 'ok', msg: data.message });
      await loadBots();
      onRefreshBalances?.();
      onRefreshOrders?.();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err?.message || 'Error deployment V2' });
    } finally {
      setIsDeploying(false);
    }
  };

  const handleBotAction = async (botId: string, action: 'pause' | 'resume' | 'stop' | 'reconcile') => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      onOpenAuthModal?.();
      return;
    }
    try {
      const url =
        action === 'reconcile'
          ? `/api/bot/volume-v2/${botId}/reconcile`
          : `/api/bot/volume-v2/${action}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: action === 'reconcile' ? undefined : JSON.stringify({ botId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Action ${action} gagal`);
      setFeedback({ type: 'ok', msg: data.message || `Status bot diperbarui (${action}).` });
      await loadBots();
      onRefreshBalances?.();
      onRefreshOrders?.();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err?.message || `Action ${action} gagal` });
    }
  };

  const handleEmergencyStopAll = async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      onOpenAuthModal?.();
      return;
    }
    try {
      const res = await fetch('/api/bot/volume-v2/emergency-stop-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Emergency stop gagal');
      setFeedback({ type: 'ok', msg: data.message });
      await loadBots();
      onRefreshBalances?.();
      onRefreshOrders?.();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err?.message || 'Emergency stop gagal' });
    }
  };

  const runningCount = bots.filter(b => b.status === 'RUNNING').length;

  return (
    <div className="space-y-5">
      {/* Compliance & Execution Mode Banner */}
      <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#16A879]" />
            <h3 className="text-sm font-semibold text-[#E4EBEF]">
              Volume Execution &amp; Liquidity Management Engine V2
            </h3>
            <StatusBadge tone="brand">ZERO-FLOAT BIGINT</StatusBadge>
            <StatusBadge tone="buy">NO WASH / NO SELF-TRADE</StatusBadge>
          </div>
          <p className="text-xs text-[#71818B] leading-relaxed">
            Algoritma eksekusi terotorisasi (TWAP, VWAP, Iceberg, Passive/Aggressive Limit). Menghitung volume
            eksklusif dari trade fills aktual dan melarang keras injeksi saldo atau transaksi lawan sintetis.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {runningCount > 0 && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleEmergencyStopAll}
              icon={<OctagonAlert className="w-3.5 h-3.5" />}
            >
              Emergency Stop All ({runningCount})
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={loadBots}
            isLoading={isLoading}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Sync V2
          </Button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-[8px] border text-xs flex items-center justify-between gap-2 ${
            feedback.type === 'ok'
              ? 'bg-[#12392F]/50 border-[#16A879]/40 text-[#35B887]'
              : 'bg-[#401F27]/60 border-[#EA5B65]/40 text-[#EA5B65]'
          }`}
        >
          <span className="flex items-center gap-2">
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            {feedback.msg}
          </span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[11px] opacity-80 hover:opacity-100 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: V2 Strategy & Risk Controls Form */}
        <form
          onSubmit={handleDeploy}
          className="lg:col-span-5 bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden"
        >
          <PanelHeader
            title="Konfigurasi Eksekusi V2"
            subtitle="Pre-trade balance, collar, slippage & STP enforcement"
            actions={
              <StatusBadge tone={mode === 'SIMULATION' ? 'warning' : 'success'}>
                {mode}
              </StatusBadge>
            }
          />

          <div className="p-4 space-y-4 text-xs">
            {/* Execution Mode Banner: LIVE vs SIMULATION */}
            <div className="space-y-1.5">
              <span className="text-[#A1AFB8] font-medium block">Execution Mode</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('SIMULATION')}
                  className={`py-2 px-3 rounded-[7px] border font-semibold transition-colors cursor-pointer ${
                    mode === 'SIMULATION'
                      ? 'bg-[#2C2415] border-[#D6A85C] text-[#D6A85C]'
                      : 'bg-[#111820] border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF]'
                  }`}
                >
                  SIMULATION (Dry-Run)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('LIVE')}
                  className={`py-2 px-3 rounded-[7px] border font-semibold transition-colors cursor-pointer ${
                    mode === 'LIVE'
                      ? 'bg-[#12392F] border-[#16A879] text-[#35B887]'
                      : 'bg-[#111820] border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF]'
                  }`}
                >
                  LIVE EXECUTION
                </button>
              </div>
              {mode === 'SIMULATION' ? (
                <p className="text-[11px] text-[#D6A85C] bg-[#2C2415]/40 border border-[#D6A85C]/30 rounded-[6px] px-2.5 py-1.5">
                  Mode SIMULASI membaca depth Order Book &amp; Kline riil tanpa memutasi saldo ledger atau order book.
                </p>
              ) : (
                <p className="text-[11px] text-[#35B887] bg-[#12392F]/30 border border-[#16A879]/30 rounded-[6px] px-2.5 py-1.5">
                  Mode LIVE mengirimkan order terotorisasi riil dari saldo tersedia akun Anda ke Matching Engine.
                </p>
              )}
            </div>

            {/* Pair & Inventory Display */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[#A1AFB8] font-medium block mb-1">Market Pair</label>
                <select
                  value={selectedPair.id}
                  onChange={e => onSelectPairId(e.target.value)}
                  className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] px-2.5 py-2 text-xs font-mono text-[#E4EBEF]"
                >
                  {pairs.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[#A1AFB8] font-medium block mb-1">Direction Side</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSide('BUY')}
                    className={`py-2 rounded-[7px] border font-semibold cursor-pointer ${
                      side === 'BUY'
                        ? 'bg-[#12392F] border-[#16A879] text-[#16A879]'
                        : 'bg-[#111820] border-[#2B3944] text-[#71818B]'
                    }`}
                  >
                    BUY
                  </button>
                  <button
                    type="button"
                    onClick={() => setSide('SELL')}
                    className={`py-2 rounded-[7px] border font-semibold cursor-pointer ${
                      side === 'SELL'
                        ? 'bg-[#401F27] border-[#EA5B65] text-[#EA5B65]'
                        : 'bg-[#111820] border-[#2B3944] text-[#71818B]'
                    }`}
                  >
                    SELL
                  </button>
                </div>
              </div>
            </div>

            {/* Available Inventory Readout */}
            <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] grid grid-cols-2 gap-2 font-mono tabular-nums text-[11px]">
              <div>
                <span className="text-[#71818B] font-sans block">Avail {selectedPair.baseCurrency}</span>
                <span className="text-[#E4EBEF] font-semibold">
                  {formatUnitsDecimal(baseBalance?.balanceAvailable, baseDec, 6)} {selectedPair.baseCurrency}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[#71818B] font-sans block">Avail {selectedPair.quoteCurrency}</span>
                <span className="text-[#E4EBEF] font-semibold">
                  {formatUnitsDecimal(quoteBalance?.balanceAvailable, quoteDec, 2)} {selectedPair.quoteCurrency}
                </span>
              </div>
            </div>

            {/* Strategy Selector */}
            <div>
              <label className="text-[#A1AFB8] font-medium block mb-1">Execution Algorithm</label>
              <select
                value={strategy}
                onChange={e => setStrategy(e.target.value as VolumeExecutionV2Strategy)}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] px-2.5 py-2 text-xs font-mono text-[#E4EBEF]"
              >
                <option value="TWAP">TWAP — Time-Weighted Average Price Slicing</option>
                <option value="VWAP">VWAP — Market-Volume Weighted Profile</option>
                <option value="ICEBERG">ICEBERG — Hidden Reserve Display Slicing</option>
                <option value="PASSIVE_LIMIT">PASSIVE_LIMIT — Non-Crossing Maker Liquidity</option>
                <option value="AGGRESSIVE_LIMIT">AGGRESSIVE_LIMIT — IOC Slippage-Guarded Execution</option>
              </select>
            </div>

            <Input
              label="Nama Label Bot (Opsional)"
              type="text"
              value={botName}
              onChange={e => setBotName(e.target.value)}
              placeholder={`${strategy} ${side} ${selectedPair.baseCurrency} V2`}
            />

            {/* Quantities & Scheduling */}
            <div className="grid grid-cols-3 gap-2">
              <Input
                label={`Target Qty (${selectedPair.baseCurrency})`}
                type="text"
                value={targetQuantity}
                onChange={e => setTargetQuantity(e.target.value)}
              />
              <Input
                label="Slice Min"
                type="text"
                value={sliceMinQuantity}
                onChange={e => setSliceMinQuantity(e.target.value)}
              />
              <Input
                label="Slice Max"
                type="text"
                value={sliceMaxQuantity}
                onChange={e => setSliceMaxQuantity(e.target.value)}
              />
            </div>

            {strategy === 'ICEBERG' && (
              <Input
                label={`Iceberg Display Qty (${selectedPair.baseCurrency})`}
                type="text"
                value={icebergDisplayQuantity}
                onChange={e => setIcebergDisplayQuantity(e.target.value)}
              />
            )}

            {strategy === 'PASSIVE_LIMIT' && (
              <Input
                label="Passive Offset (Ticks behind touch)"
                type="number"
                value={passiveOffsetTicks}
                onChange={e => setPassiveOffsetTicks(e.target.value)}
              />
            )}

            <div className="grid grid-cols-3 gap-2">
              <Input
                label="Duration (s)"
                type="number"
                value={durationSeconds}
                onChange={e => setDurationSeconds(e.target.value)}
              />
              <Input
                label="Interval (s)"
                type="number"
                value={intervalSeconds}
                onChange={e => setIntervalSeconds(e.target.value)}
              />
              <Input
                label="Order Timeout (s)"
                type="number"
                value={orderTimeoutSeconds}
                onChange={e => setOrderTimeoutSeconds(e.target.value)}
              />
            </div>

            {/* Risk Management Controls */}
            <div className="p-3 rounded-[8px] bg-[#111820] border border-[#202B34] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#E4EBEF]">Risk &amp; Exposure Controls</span>
                <span className="text-[10px] font-mono text-[#71818B]">Auto-Cancel on Breach</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label={`Collar Min (${selectedPair.quoteCurrency})`}
                  type="text"
                  value={priceCollarMin}
                  onChange={e => setPriceCollarMin(e.target.value)}
                />
                <Input
                  label={`Collar Max (${selectedPair.quoteCurrency})`}
                  type="text"
                  value={priceCollarMax}
                  onChange={e => setPriceCollarMax(e.target.value)}
                />
                <Input
                  label={`Max Order Notional (${selectedPair.quoteCurrency})`}
                  type="text"
                  value={maxOrderNotionalQuote}
                  onChange={e => setMaxOrderNotionalQuote(e.target.value)}
                />
                <Input
                  label={`Max Cumulative Exposure`}
                  type="text"
                  value={maxCumulativeExposureQuote}
                  onChange={e => setMaxCumulativeExposureQuote(e.target.value)}
                />
                <Input
                  label="Max Slippage (bps)"
                  type="number"
                  value={maxSlippageBps}
                  onChange={e => setMaxSlippageBps(e.target.value)}
                />
                <Input
                  label="Max Participation (bps)"
                  type="number"
                  value={maxParticipationRateBps}
                  onChange={e => setMaxParticipationRateBps(e.target.value)}
                />
                <Input
                  label="Max Orders / Min"
                  type="number"
                  value={maxOrdersPerMinute}
                  onChange={e => setMaxOrdersPerMinute(e.target.value)}
                />
                <Input
                  label={`Daily Limit (${selectedPair.baseCurrency})`}
                  type="text"
                  value={dailyExecutionLimitBase}
                  onChange={e => setDailyExecutionLimitBase(e.target.value)}
                />
              </div>
              <Input
                label="Partial-Fill Retry Limit"
                type="number"
                value={maxPartialFillRetries}
                onChange={e => setMaxPartialFillRetries(e.target.value)}
              />
            </div>

            <Button
              type="submit"
              variant={mode === 'SIMULATION' ? 'secondary' : 'primary'}
              size="lg"
              isLoading={isDeploying}
              icon={<Play className="w-4 h-4" />}
              className="w-full"
            >
              {mode === 'SIMULATION'
                ? 'Jalankan Simulasi V2 (Dry-Run)'
                : 'Luncurkan Engine V2 (Live Execution)'}
            </Button>
          </div>
        </form>

        {/* Right: Active & Historical V2 Engine Monitors */}
        <div className="lg:col-span-7 space-y-4">
          {bots.length === 0 ? (
            <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-10 text-center space-y-2">
              <Activity className="w-9 h-9 text-[#536B77] mx-auto" />
              <p className="text-sm font-semibold text-[#E4EBEF]">Belum Ada Tugas Volume Execution V2</p>
              <p className="text-xs text-[#71818B] max-w-md mx-auto">
                Jalankan dalam mode SIMULATION terlebih dahulu untuk meninjau slice &amp; estimasi depth, atau gunakan
                LIVE untuk eksekusi riil dengan risk guardrail penuh.
              </p>
            </div>
          ) : (
            bots.map(bot => {
              const bPair = pairs.find(p => p.id === bot.pairId) || selectedPair;
              const bBaseDec = bPair.baseDecimals ?? 8;
              const bQuoteDec = bPair.quoteDecimals ?? (bPair.quoteCurrency === 'USDT' ? 6 : 2);
              const fillPct = (bot.stats.fillPercentageBps / 100).toFixed(2);
              const isRunning = bot.status === 'RUNNING';
              const isPaused = bot.status === 'PAUSED';
              const showLogs = expandedLogBotId === bot.id;

              return (
                <div
                  key={bot.id}
                  className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 space-y-3.5"
                >
                  {/* Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold text-sm text-[#E4EBEF] truncate">{bot.name}</h4>
                        <StatusBadge tone={bot.mode === 'SIMULATION' ? 'warning' : 'buy'}>
                          {bot.mode}
                        </StatusBadge>
                        <StatusBadge
                          tone={
                            bot.status === 'RUNNING'
                              ? 'success'
                              : bot.status === 'RISK_HALTED' || bot.status === 'FAILED'
                              ? 'danger'
                              : bot.status === 'COMPLETED'
                              ? 'info'
                              : 'neutral'
                          }
                        >
                          {bot.status}
                        </StatusBadge>
                      </div>
                      <p className="text-[11px] font-mono tabular-nums text-[#71818B] mt-0.5">
                        {bot.pairId} · {bot.strategy} {bot.config.side} · Slice #{bot.checkpoint.sliceIndex} ·{' '}
                        {formatDateTime(bot.createdAt)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {isRunning && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleBotAction(bot.id, 'pause')}
                          icon={<Pause className="w-3 h-3" />}
                        >
                          Pause
                        </Button>
                      )}
                      {isPaused && (
                        <Button
                          type="button"
                          variant="profit"
                          size="sm"
                          onClick={() => handleBotAction(bot.id, 'resume')}
                          icon={<Play className="w-3 h-3" />}
                        >
                          Resume
                        </Button>
                      )}
                      {(isRunning || isPaused) && (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => handleBotAction(bot.id, 'stop')}
                          icon={<Square className="w-3 h-3 fill-current" />}
                        >
                          Stop
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleBotAction(bot.id, 'reconcile')}
                        title="Rekonsiliasi state dengan ledger & trades"
                      >
                        Reconcile
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setExpandedLogBotId(showLogs ? null : bot.id)}
                        icon={<Terminal className="w-3 h-3" />}
                      >
                        {showLogs ? 'Hide Log' : `Logs (${bot.logs.length})`}
                      </Button>
                    </div>
                  </div>

                  {bot.lastRiskReason && (
                    <div className="p-2.5 rounded-[7px] bg-[#401F27]/50 border border-[#EA5B65]/40 text-xs text-[#EA5B65]">
                      Risk Halt: {bot.lastRiskReason}
                    </div>
                  )}

                  {/* Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono tabular-nums text-[#A1AFB8]">
                      <span>Fill Progress</span>
                      <span className="text-[#E4EBEF] font-semibold">
                        {formatUnitsDecimal(bot.stats.executedQuantityUnits, bBaseDec, 6)} /{' '}
                        {formatUnitsDecimal(bot.stats.targetQuantityUnits, bBaseDec, 6)} {bPair.baseCurrency} (
                        {fillPct}%)
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#090D12] border border-[#202B34] overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          bot.mode === 'SIMULATION' ? 'bg-[#D6A85C]' : 'bg-[#16A879]'
                        }`}
                        style={{ width: `${Math.min(100, Number(fillPct))}%` }}
                      />
                    </div>
                  </div>

                  {/* Key Execution Telemetry */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono tabular-nums">
                    <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] font-sans text-[#71818B] block">Executed Qty</span>
                      <span className="text-[#35B887] font-semibold">
                        {formatUnitsDecimal(bot.stats.executedQuantityUnits, bBaseDec, 6)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] font-sans text-[#71818B] block">Remaining Qty</span>
                      <span className="text-[#E4EBEF] font-semibold">
                        {formatUnitsDecimal(bot.stats.remainingQuantityUnits, bBaseDec, 6)}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] font-sans text-[#71818B] block">Avg Exec Price</span>
                      <span className="text-[#E4EBEF] font-semibold">
                        {bot.stats.averageExecutionPriceUnits === '0'
                          ? '-'
                          : formatQuotePrice(
                              bot.stats.averageExecutionPriceUnits,
                              bPair.quoteCurrency,
                              bQuoteDec,
                              true
                            )}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] font-sans text-[#71818B] block">Total Fees</span>
                      <span className="text-[#D6A85C] font-semibold">
                        {formatUnitsDecimal(bot.stats.totalFeesQuoteUnits, bQuoteDec, 4)} {bPair.quoteCurrency}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] font-sans text-[#71818B] block">Slippage</span>
                      <span
                        className={`font-semibold ${
                          bot.stats.slippageBps > 0 ? 'text-[#EA5B65]' : 'text-[#16A879]'
                        }`}
                      >
                        {bot.stats.slippageBps} bps
                      </span>
                    </div>
                    <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] font-sans text-[#71818B] block">Duration</span>
                      <span className="text-[#E4EBEF] font-semibold">
                        {Math.round(bot.stats.executionDurationMs / 1000)}s / {bot.config.durationSeconds}s
                      </span>
                    </div>
                    <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] font-sans text-[#71818B] block">Rejected Count</span>
                      <span
                        className={`font-semibold ${
                          bot.stats.rejectedOrderCount > 0 ? 'text-[#EA5B65]' : 'text-[#E4EBEF]'
                        }`}
                      >
                        {bot.stats.rejectedOrderCount}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] font-sans text-[#71818B] block">Notional Filled</span>
                      <span className="text-[#E4EBEF] font-semibold">
                        {formatUnitsDecimal(bot.stats.totalQuoteNotionalUnits, bQuoteDec, 2)} {bPair.quoteCurrency}
                      </span>
                    </div>
                  </div>

                  {/* Order Status Breakdown */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums pt-1 border-t border-[#202B34] text-[#A1AFB8]">
                    <span>Submitted: {bot.stats.orderBreakdown.submitted}</span>
                    <span className="text-[#40515D]">·</span>
                    <span>Accepted: {bot.stats.orderBreakdown.accepted}</span>
                    <span className="text-[#40515D]">·</span>
                    <span>Partial: {bot.stats.orderBreakdown.partiallyFilled}</span>
                    <span className="text-[#40515D]">·</span>
                    <span className="text-[#35B887]">Filled: {bot.stats.orderBreakdown.filled}</span>
                    <span className="text-[#40515D]">·</span>
                    <span>Cancelled: {bot.stats.orderBreakdown.cancelled}</span>
                    <span className="text-[#40515D]">·</span>
                    <span>Expired: {bot.stats.orderBreakdown.expired}</span>
                    <span className="text-[#40515D]">·</span>
                    <span className="text-[#EA5B65]">Rejected: {bot.stats.orderBreakdown.rejected}</span>
                  </div>

                  {showLogs && (
                    <div className="p-3 rounded-[7px] bg-[#090D12] border border-[#202B34] max-h-48 overflow-y-auto font-mono text-[11px] space-y-1">
                      {bot.logs.map((log, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="text-[#53616A] shrink-0 tabular-nums">
                            [{new Date(log.timestamp).toLocaleTimeString()}]
                          </span>
                          <span
                            className={`shrink-0 font-semibold ${
                              log.type === 'FILL'
                                ? 'text-[#16A879]'
                                : log.type === 'RISK' || log.type === 'ERROR'
                                ? 'text-[#EA5B65]'
                                : log.type === 'SIMULATION'
                                ? 'text-[#D6A85C]'
                                : 'text-[#6D9FE8]'
                            }`}
                          >
                            {log.type}
                          </span>
                          <span className="text-[#E4EBEF] break-all">{log.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
