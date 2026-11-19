/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/bot/PriceThresholdSection.tsx
 * Market Maker Console panel for defining price threshold triggers that fire
 * Web Audio sound notifications and/or automated bot ladder adjustments.
 */

import React, { useMemo, useState } from 'react';
import {
  BellRing,
  Play,
  Plus,
  RefreshCw,
  Sliders,
  Trash2,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import {
  BotInstance,
  Environment,
  PriceThresholdAction,
  PriceThresholdCondition,
  PriceThresholdEvent,
  PriceThresholdSoundTone,
  PriceThresholdTrigger,
  TradingPairItem,
} from '../../types/index.js';
import {
  formatDateTime,
  formatQuotePrice,
  formatUnitsToDecimal,
  safeBigInt,
} from '../../lib/formatters.js';
import { playThresholdSound } from '../../lib/thresholdAudio.js';
import { Button } from '../ui/Button.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { useToast } from '../ui/Toast.js';

interface Props {
  environment: Environment;
  tradingPairs: TradingPairItem[];
  instances: BotInstance[];
  triggers: PriceThresholdTrigger[];
  events: PriceThresholdEvent[];
  soundMuted: boolean;
  onToggleMute: () => void;
  onRefresh: () => void;
}

const LADDER_BOT_TYPES = new Set([
  'SMART_HFT_LADDER',
  'DEPTH_LIQUIDITY',
  'MOVEMENT_DEPTH_LIQUIDITY',
  'QUANT_HFT_MM',
  'ADVANCED_MM',
]);

const CONDITION_LABELS: Record<PriceThresholdCondition, string> = {
  ABOVE_OR_EQUAL: 'Harga >= Threshold',
  BELOW_OR_EQUAL: 'Harga <= Threshold',
  CROSS_EITHER: 'Menembus Dua Arah',
};

const ACTION_LABELS: Record<PriceThresholdAction, string> = {
  NONE: 'Notifikasi Suara Saja',
  LADDER_RECENTER: 'Recenter Ladder ke Harga Live',
  LADDER_WIDEN_SPREAD: 'Lebarkan Spread & Bounds',
  LADDER_SHIFT_UP: 'Geser Ladder Naik (+Step %)',
  LADDER_SHIFT_DOWN: 'Geser Ladder Turun (-Step %)',
  PAUSE_BOT: 'Pause Bot Target Otomatis',
};

const SOUND_LABELS: Record<PriceThresholdSoundTone, string> = {
  CHIME: 'Chime Institusional',
  PING: 'Single Ping',
  ALERT_DOUBLE: 'Double Alert',
  SIREN: 'Urgent Siren',
  NONE: 'Senyap (Tanpa Suara)',
};

export const PriceThresholdSection: React.FC<Props> = ({
  environment,
  tradingPairs,
  instances,
  triggers,
  events,
  soundMuted,
  onToggleMute,
  onRefresh,
}) => {
  const { showToast } = useToast();

  const activePairs = useMemo(
    () => tradingPairs.filter((p) => p.isActive),
    [tradingPairs]
  );

  const [pairId, setPairId] = useState<string>(
    () => activePairs[0]?.id || tradingPairs[0]?.id || 'BTC-IDR'
  );
  const selectedPair = useMemo(
    () => tradingPairs.find((p) => p.id === pairId) || activePairs[0] || tradingPairs[0],
    [tradingPairs, activePairs, pairId]
  );

  const quoteDecimals = selectedPair?.quoteDecimals ?? (selectedPair?.quoteCurrency === 'USDT' ? 6 : 2);
  const livePriceDecimal = useMemo(() => {
    if (!selectedPair?.lastPrice) return '0';
    return formatUnitsToDecimal(selectedPair.lastPrice, quoteDecimals, true);
  }, [selectedPair?.lastPrice, quoteDecimals]);

  const [name, setName] = useState<string>('');
  const [condition, setCondition] = useState<PriceThresholdCondition>('ABOVE_OR_EQUAL');
  const [thresholdPrice, setThresholdPrice] = useState<string>('');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [soundTone, setSoundTone] = useState<PriceThresholdSoundTone>('CHIME');
  const [action, setAction] = useState<PriceThresholdAction>('LADDER_RECENTER');
  const [targetBotId, setTargetBotId] = useState<string>('');
  const [adjustStepPct, setAdjustStepPct] = useState<string>('1.5');
  const [cooldownSec, setCooldownSec] = useState<string>('30');
  const [autoResetAfterCooldown, setAutoResetAfterCooldown] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const pairBots = useMemo(
    () =>
      instances.filter(
        (b) => b.pairId === pairId && LADDER_BOT_TYPES.has(b.botType)
      ),
    [instances, pairId]
  );

  const getAuthHeaders = () => {
    const token = localStorage.getItem('dimonex_auth_token');
    return {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    };
  };

  const applyOffsetPreset = (pctOffset: number) => {
    const liveNum = parseFloat(livePriceDecimal);
    if (!Number.isFinite(liveNum) || liveNum <= 0) return;
    const adjusted = liveNum * (1 + pctOffset / 100);
    setThresholdPrice(adjusted.toFixed(quoteDecimals).replace(/\.?0+$/, ''));
    setCondition(pctOffset >= 0 ? 'ABOVE_OR_EQUAL' : 'BELOW_OR_EQUAL');
  };

  const handleCreateTrigger = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetPriceStr = (thresholdPrice || livePriceDecimal).trim();
    if (!targetPriceStr || parseFloat(targetPriceStr) <= 0) {
      showToast('error', 'Masukkan harga threshold yang valid.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/mm/thresholds', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: name.trim() || `${pairId} ${CONDITION_LABELS[condition]}`,
          pairId,
          environment,
          condition,
          thresholdPrice: targetPriceStr,
          soundEnabled,
          soundTone: soundEnabled ? soundTone : 'NONE',
          action,
          targetBotId: targetBotId || undefined,
          adjustStepPct: parseFloat(adjustStepPct) || 1.5,
          cooldownSec: parseInt(cooldownSec, 10) || 30,
          autoResetAfterCooldown,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', data.error || 'Gagal menyimpan threshold.');
        return;
      }
      showToast('success', data.message || 'Aturan threshold berhasil dibuat.');
      setName('');
      onRefresh();
    } catch (err: any) {
      showToast('error', err?.message || 'Koneksi gagal.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleTrigger = async (t: PriceThresholdTrigger, patch: Record<string, any>) => {
    try {
      const res = await fetch(`/api/mm/thresholds/${t.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', data.error || 'Gagal memperbarui threshold.');
        return;
      }
      showToast('success', data.message || 'Threshold diperbarui.');
      onRefresh();
    } catch (err: any) {
      showToast('error', err?.message || 'Koneksi gagal.');
    }
  };

  const handleDeleteTrigger = async (id: string) => {
    try {
      const res = await fetch(`/api/mm/thresholds/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast('error', data.error || 'Gagal menghapus threshold.');
        return;
      }
      showToast('success', 'Aturan threshold dihapus.');
      onRefresh();
    } catch (err: any) {
      showToast('error', err?.message || 'Koneksi gagal.');
    }
  };

  const handleTestTrigger = async (t: PriceThresholdTrigger) => {
    try {
      if (t.soundEnabled && !soundMuted) {
        playThresholdSound(t.soundTone);
      }
      const res = await fetch(`/api/mm/thresholds/${t.id}/test`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ executeBotAdjustment: t.action !== 'NONE' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', data.error || 'Gagal menguji threshold.');
        return;
      }
      showToast('info', data.message || 'Uji coba threshold berhasil dijalankan.');
      onRefresh();
    } catch (err: any) {
      showToast('error', err?.message || 'Koneksi gagal.');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header Banner */}
      <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[7px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1]">
            <BellRing className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#E4EBEF]">
              Price Threshold Alerts &amp; Automated Ladder Adjustment
            </h2>
            <p className="text-xs text-[#A1AFB8]">
              Pantau level harga riil pasar ({environment}) untuk memicu notifikasi suara Web Audio dan penyesuaian ladder bot otomatis.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={soundMuted ? 'danger' : 'secondary'}
            size="sm"
            onClick={onToggleMute}
            icon={soundMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          >
            {soundMuted ? 'Suara Dimatikan (Mute)' : 'Audio Alert Aktif'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => playThresholdSound(soundTone === 'NONE' ? 'CHIME' : soundTone)}
            icon={<Play className="w-3.5 h-3.5" />}
          >
            Tes Nada
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Create New Price Threshold Form */}
      <form
        onSubmit={handleCreateTrigger}
        className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#202B34]">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#8DA5B1]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#E4EBEF]">
              Tambah Aturan Threshold Baru
            </h3>
          </div>
          {selectedPair && (
            <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
              <span className="text-[#71818B]">Harga Live {selectedPair.id}:</span>
              <span className="text-[#35B887] font-semibold">
                {formatQuotePrice(selectedPair.lastPrice, selectedPair.quoteCurrency, quoteDecimals, true)}
              </span>
              <span className="text-[11px] text-[#71818B]">
                ({quoteDecimals} dec quote)
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-[#A1AFB8] font-medium mb-1">Nama Aturan</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Contoh: Breakout ${pairId}`}
              className="w-full h-9 px-3 bg-[#17212B] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div>
            <label className="block text-[#A1AFB8] font-medium mb-1">Trading Pair</label>
            <select
              value={pairId}
              onChange={(e) => {
                setPairId(e.target.value);
                setThresholdPrice('');
                setTargetBotId('');
              }}
              className="w-full h-9 px-3 bg-[#17212B] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono focus:outline-none focus:border-[#8DA5B1]"
            >
              {tradingPairs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} ({p.quoteCurrency}, {p.quoteDecimals ?? (p.quoteCurrency === 'USDT' ? 6 : 2)}d)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[#A1AFB8] font-medium mb-1">Kondisi Pelanggaran</label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as PriceThresholdCondition)}
              className="w-full h-9 px-3 bg-[#17212B] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
            >
              <option value="ABOVE_OR_EQUAL">Harga &gt;= Threshold (Breakout Atas)</option>
              <option value="BELOW_OR_EQUAL">Harga &lt;= Threshold (Breakdown Bawah)</option>
              <option value="CROSS_EITHER">Menembus Dua Arah (Cross Either)</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[#A1AFB8] font-medium">
                Target Harga ({selectedPair?.quoteCurrency || 'IDR'})
              </label>
              <div className="flex items-center gap-1">
                {[-2, -1, 1, 2].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => applyOffsetPreset(pct)}
                    className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-[#111820] border border-[#202B34] text-[#A1AFB8] hover:text-[#E4EBEF] hover:border-[#8DA5B1] cursor-pointer"
                  >
                    {pct > 0 ? `+${pct}%` : `${pct}%`}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={thresholdPrice}
              onChange={(e) => setThresholdPrice(e.target.value)}
              placeholder={livePriceDecimal}
              className="w-full h-9 px-3 bg-[#17212B] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div>
            <label className="block text-[#A1AFB8] font-medium mb-1">Notifikasi Suara</label>
            <div className="flex items-center gap-2">
              <select
                value={soundEnabled ? soundTone : 'NONE'}
                onChange={(e) => {
                  const v = e.target.value as PriceThresholdSoundTone;
                  if (v === 'NONE') {
                    setSoundEnabled(false);
                    setSoundTone('NONE');
                  } else {
                    setSoundEnabled(true);
                    setSoundTone(v);
                  }
                }}
                className="w-full h-9 px-3 bg-[#17212B] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
              >
                <option value="CHIME">Chime Institusional</option>
                <option value="PING">Single Ping</option>
                <option value="ALERT_DOUBLE">Double Alert</option>
                <option value="SIREN">Urgent Siren</option>
                <option value="NONE">Senyap (Tanpa Suara)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[#A1AFB8] font-medium mb-1">Aksi Penyesuaian Ladder Otomatis</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as PriceThresholdAction)}
              className="w-full h-9 px-3 bg-[#17212B] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
            >
              <option value="LADDER_RECENTER">Recenter Ladder ke Harga Live</option>
              <option value="LADDER_WIDEN_SPREAD">Lebarkan Spread &amp; Bounds</option>
              <option value="LADDER_SHIFT_UP">Geser Ladder Naik (+Step %)</option>
              <option value="LADDER_SHIFT_DOWN">Geser Ladder Turun (-Step %)</option>
              <option value="PAUSE_BOT">Pause Bot Target</option>
              <option value="NONE">Notifikasi Suara Saja</option>
            </select>
          </div>

          <div>
            <label className="block text-[#A1AFB8] font-medium mb-1">Target Bot Ladder / MM</label>
            <select
              value={targetBotId}
              onChange={(e) => setTargetBotId(e.target.value)}
              disabled={action === 'NONE'}
              className="w-full h-9 px-3 bg-[#17212B] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] disabled:opacity-50 focus:outline-none focus:border-[#8DA5B1]"
            >
              <option value="">Semua Bot Ladder Aktif pada {pairId}</option>
              {pairBots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.botType} · {b.status})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[#A1AFB8] font-medium mb-1">Step (%)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="25"
                value={adjustStepPct}
                onChange={(e) => setAdjustStepPct(e.target.value)}
                className="w-full h-9 px-2.5 bg-[#17212B] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:outline-none focus:border-[#8DA5B1]"
              />
            </div>
            <div>
              <label className="block text-[#A1AFB8] font-medium mb-1">Cooldown (s)</label>
              <input
                type="number"
                min="5"
                max="86400"
                value={cooldownSec}
                onChange={(e) => setCooldownSec(e.target.value)}
                className="w-full h-9 px-2.5 bg-[#17212B] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:outline-none focus:border-[#8DA5B1]"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#202B34]">
          <label className="flex items-center gap-2 text-xs text-[#A1AFB8] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoResetAfterCooldown}
              onChange={(e) => setAutoResetAfterCooldown(e.target.checked)}
              className="rounded border-[#2B3944] bg-[#17212B]"
            />
            <span>Otomatis aktif kembali (Re-arm) setelah masa cooldown berakhir</span>
          </label>

          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={submitting}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            Aktifkan Aturan Threshold
          </Button>
        </div>
      </form>

      {/* Active Rules Table */}
      <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#202B34] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#E4EBEF]">
            Daftar Aturan Threshold Harga ({triggers.length})
          </h3>
          <span className="text-[11px] font-mono text-[#71818B]">
            Engine Evaluator: 1000ms Real-Time Tick
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#111820] text-[#71818B] uppercase font-mono text-[11px] border-b border-[#202B34]">
              <tr>
                <th className="py-2.5 px-4">Aturan / Pair</th>
                <th className="py-2.5 px-4">Kondisi &amp; Threshold</th>
                <th className="py-2.5 px-4">Audio Alert</th>
                <th className="py-2.5 px-4">Aksi Ladder Otomatis</th>
                <th className="py-2.5 px-4">Status / Hits</th>
                <th className="py-2.5 px-4 text-right">Kontrol</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202B34] text-[#A1AFB8] font-mono tabular-nums">
              {triggers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#71818B] font-sans">
                    Belum ada aturan threshold harga pada environment {environment}. Tambahkan aturan di atas untuk memulai pemantauan otomatis.
                  </td>
                </tr>
              ) : (
                triggers.map((t) => {
                  const targetBot = t.targetBotId
                    ? instances.find((b) => b.id === t.targetBotId)
                    : null;
                  return (
                    <tr key={t.id} className="hover:bg-[#17212B] transition-colors">
                      <td className="py-3 px-4 font-sans">
                        <strong className="text-[#E4EBEF] block">{t.name}</strong>
                        <span className="text-[11px] font-mono text-[#8DA5B1]">{t.pairId}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="block text-[11px] text-[#71818B] font-sans">
                          {CONDITION_LABELS[t.condition]}
                        </span>
                        <span className="text-[#E4EBEF] font-semibold">
                          {formatQuotePrice(t.thresholdPriceUnits, t.quoteCurrency, t.quoteDecimals, true)}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-sans">
                        <span className="text-[#E4EBEF] text-xs block">
                          {t.soundEnabled ? SOUND_LABELS[t.soundTone] : 'Senyap'}
                        </span>
                        <span className="text-[11px] text-[#71818B] font-mono">
                          Cooldown: {t.cooldownSec}s
                        </span>
                      </td>
                      <td className="py-3 px-4 font-sans">
                        <span className="text-[#E4EBEF] text-xs block">
                          {ACTION_LABELS[t.action]}
                        </span>
                        <span className="text-[11px] text-[#8DA5B1]">
                          {targetBot ? targetBot.name : `Semua Ladder (${t.pairId})`} · Step {t.adjustStepPct}%
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge
                          tone={
                            !t.enabled
                              ? 'neutral'
                              : t.status === 'ARMED'
                              ? 'success'
                              : t.status === 'COOLDOWN'
                              ? 'warning'
                              : 'info'
                          }
                        >
                          {t.enabled ? t.status : 'DISABLED'}
                        </StatusBadge>
                        <span className="block text-[11px] text-[#71818B] mt-1">
                          Dipicu: {t.triggerCount}x
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-sans">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => handleTestTrigger(t)}
                            icon={<Zap className="w-3 h-3" />}
                          >
                            Test
                          </Button>
                          {t.status !== 'ARMED' || !t.enabled ? (
                            <Button
                              type="button"
                              variant="profit"
                              size="sm"
                              onClick={() => handleToggleTrigger(t, { rearm: true, enabled: true })}
                            >
                              Re-Arm
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleToggleTrigger(t, { enabled: false })}
                            >
                              Pause
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => handleDeleteTrigger(t.id)}
                            icon={<Trash2 className="w-3 h-3" />}
                          >
                            Hapus
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Breach & Automated Adjustment Log */}
      <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#202B34] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#E4EBEF]">
            Riwayat Pelanggaran Threshold &amp; Eksekusi Ladder ({events.length})
          </h3>
        </div>
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#111820] text-[#71818B] uppercase font-mono text-[11px] border-b border-[#202B34] sticky top-0">
              <tr>
                <th className="py-2 px-4">Waktu</th>
                <th className="py-2 px-4">Aturan / Pair</th>
                <th className="py-2 px-4">Harga Terjadi</th>
                <th className="py-2 px-4">Hasil Penyesuaian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202B34] text-[#A1AFB8] font-mono tabular-nums">
              {events.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-[#71818B] font-sans">
                    Belum ada pelanggaran threshold tercatat.
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <tr key={ev.id} className="hover:bg-[#17212B]">
                    <td className="py-2.5 px-4 text-[11px] whitespace-nowrap">
                      {formatDateTime(ev.timestamp)}
                      {ev.isTest && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[#17212B] border border-[#2B3944] text-[#D6A85C]">
                          TEST
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-sans">
                      <span className="text-[#E4EBEF] font-medium block">{ev.triggerName}</span>
                      <span className="text-[11px] font-mono text-[#8DA5B1]">{ev.pairId}</span>
                    </td>
                    <td className="py-2.5 px-4 text-[#E4EBEF]">
                      {formatQuotePrice(ev.breachedPriceUnits, ev.quoteCurrency, ev.quoteDecimals, true)}
                      <span className="block text-[10px] text-[#71818B]">
                        Target: {formatQuotePrice(safeBigInt(ev.thresholdPriceUnits), ev.quoteCurrency, ev.quoteDecimals, true)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-sans text-xs text-[#E4EBEF]">
                      {ev.adjustmentSummary}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
