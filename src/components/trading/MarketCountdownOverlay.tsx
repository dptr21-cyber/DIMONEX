/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/trading/MarketCountdownOverlay.tsx
 * Live 1-second institutional countdown timer displayed inside the Market Chart area for:
 * 1. Scheduled Initial Listings (pre-launch countdown overlay until automatic market activation)
 * 2. Scheduled Market Delistings (non-blocking top warning strip with live countdown over chart)
 * 3. Delisted Markets (clear post-delisting notice inside chart canvas)
 */

import React, { useEffect, useRef, useState } from 'react';
import { Clock, AlertTriangle, Ban, Calendar, ArrowDownLeft, ArrowUpRight, Rocket } from 'lucide-react';
import { TradingPairItem } from '../../types/index.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { StatusBadge } from '../ui/StatusBadge.js';

export interface CountdownParts {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
}

export function computeCountdownParts(targetTs: number | undefined, nowMs: number): CountdownParts {
  if (!targetTs || !Number.isFinite(targetTs)) {
    return { totalMs: 0, days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
  }
  const diff = Math.max(0, targetTs - nowMs);
  if (diff <= 0) {
    return { totalMs: 0, days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
  }
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return { totalMs: diff, days, hours, minutes, seconds, isExpired: false };
}

export function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

export function formatCountdownCompact(targetTs: number | undefined, nowMs: number): string {
  const c = computeCountdownParts(targetTs, nowMs);
  if (c.isExpired) return '00:00:00';
  if (c.days > 0) {
    return `${c.days}d ${pad2(c.hours)}:${pad2(c.minutes)}:${pad2(c.seconds)}`;
  }
  return `${pad2(c.hours)}:${pad2(c.minutes)}:${pad2(c.seconds)}`;
}

interface Props {
  pair: TradingPairItem;
  mode: 'BANNER' | 'OVERLAY';
  onCountdownComplete?: () => void;
}

export const MarketCountdownOverlay: React.FC<Props> = ({
  pair,
  mode,
  onCountdownComplete
}) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const firedForTargetRef = useRef<number | null>(null);

  const isScheduledListing = Boolean(
    !pair.isDelisted &&
      !pair.isActive &&
      (pair.listingStatus === 'SCHEDULED' || pair.scheduledAt) &&
      pair.scheduledAt &&
      pair.scheduledAt > nowMs
  );

  const isScheduledDelist = Boolean(
    !pair.isDelisted && pair.delistScheduledAt && pair.delistScheduledAt > nowMs
  );

  const activeTarget = isScheduledListing
    ? pair.scheduledAt
    : isScheduledDelist
    ? pair.delistScheduledAt
    : undefined;

  useEffect(() => {
    if (!activeTarget) return;
    const interval = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (current >= activeTarget && firedForTargetRef.current !== activeTarget) {
        firedForTargetRef.current = activeTarget;
        // Wait 1.5s for server scheduler tick to complete, then refresh markets
        setTimeout(() => {
          onCountdownComplete?.();
        }, 1800);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTarget, onCountdownComplete]);

  // 1. BANNER MODE: Non-blocking warning strip anchored above chart for Scheduled Delisting
  if (mode === 'BANNER') {
    if (!isScheduledDelist || !pair.delistScheduledAt) return null;
    const c = computeCountdownParts(pair.delistScheduledAt, nowMs);

    return (
      <div className="px-4 py-2.5 bg-[#401F27]/75 border-b border-[#EA5B65]/40 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-[7px] bg-[#EA5B65]/15 border border-[#EA5B65]/30 text-[#EA5B65] shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-[#E4EBEF]">
                Peringatan Delisting Market {pair.baseCurrency}/{pair.quoteCurrency}
              </span>
              <StatusBadge tone="danger" dot>
                DELISTING TERJADWAL
              </StatusBadge>
            </div>
            <p className="text-[11px] text-[#A1AFB8] mt-0.5 truncate max-w-2xl">
              {pair.delistReason || 'Seluruh order terbuka akan dibatalkan & saldo dikembalikan otomatis saat waktu delisting tiba.'}
              {' · '}
              <span className="font-mono text-[#E4EBEF]">
                {new Date(pair.delistScheduledAt).toLocaleString('id-ID', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })}
              </span>
            </p>
          </div>
        </div>

        {/* Live Monospace Countdown Strip */}
        <div className="flex items-center gap-1.5 font-mono tabular-nums shrink-0">
          <Clock className="w-3.5 h-3.5 text-[#EA5B65] mr-0.5" />
          {[
            { label: 'H', val: pad2(c.days) },
            { label: 'J', val: pad2(c.hours) },
            { label: 'M', val: pad2(c.minutes) },
            { label: 'D', val: pad2(c.seconds) }
          ].map((unit, idx) => (
            <React.Fragment key={unit.label}>
              <div className="px-2 py-1 rounded-[6px] bg-[#090D12] border border-[#EA5B65]/40 text-center min-w-[40px]">
                <span className="text-xs font-bold text-[#F16D76]">{unit.val}</span>
                <span className="text-[9px] text-[#A1AFB8] ml-0.5">{unit.label}</span>
              </div>
              {idx < 3 && <span className="text-[#EA5B65] font-bold text-xs">:</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }

  // 2. OVERLAY MODE: Centered matte mineral card inside Chart canvas for Scheduled Initial Listing or Delisted Market
  if (pair.isDelisted) {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-[#090D12]/90">
        <div className="w-full max-w-lg rounded-[12px] bg-[#141C24] border border-[#EA5B65]/40 p-6 text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <AssetIcon symbol={pair.baseCurrency} logoUrl={pair.baseLogoUrl || undefined} size="xl" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-center gap-2">
              <StatusBadge tone="danger" dot>
                MARKET DELISTED
              </StatusBadge>
            </div>
            <h3 className="text-lg font-semibold text-[#E4EBEF] tracking-tight">
              {pair.baseCurrency}/{pair.quoteCurrency} Telah Di-Delisting
            </h3>
            {pair.baseName && pair.baseName !== pair.baseCurrency && (
              <p className="text-xs text-[#A1AFB8]">{pair.baseName}</p>
            )}
          </div>

          <div className="p-3.5 rounded-[8px] bg-[#111820] border border-[#202B34] text-xs space-y-1.5">
            <div className="flex items-center justify-center gap-1.5 text-[#EA5B65] font-medium">
              <Ban className="w-3.5 h-3.5" />
              <span>Perdagangan spot pada pasangan ini telah ditutup secara permanen.</span>
            </div>
            {pair.delistReason && (
              <p className="text-[#A1AFB8]">Alasan: {pair.delistReason}</p>
            )}
            {pair.delistedAt && (
              <p className="text-[11px] font-mono text-[#71818B]">
                Efektif Delisted: {new Date(pair.delistedAt).toLocaleString('id-ID')}
              </p>
            )}
          </div>

          <p className="text-[11px] text-[#71818B]">
            Seluruh order limit yang tersisa telah dibatalkan secara otomatis dan dana dikembalikan ke saldo dompet pengguna.
          </p>
        </div>
      </div>
    );
  }

  if (!isScheduledListing || !pair.scheduledAt) return null;

  const c = computeCountdownParts(pair.scheduledAt, nowMs);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-4 sm:p-6 bg-[#090D12]/92">
      <div className="w-full max-w-xl rounded-[12px] bg-[#141C24] border border-[#2B3944] p-6 sm:p-7 space-y-6">
        {/* Top Asset Header */}
        <div className="flex flex-col items-center text-center space-y-3">
          <AssetIcon
            symbol={pair.baseCurrency}
            logoUrl={pair.baseLogoUrl || undefined}
            size="xl"
          />

          <div className="space-y-1">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <StatusBadge tone="brand" dot>
                INITIAL LISTING COUNTDOWN
              </StatusBadge>
              <StatusBadge tone="warning">
                SCHEDULED
              </StatusBadge>
            </div>
            <h3 className="text-xl font-semibold text-[#E4EBEF] tracking-tight pt-1">
              {pair.baseCurrency}/{pair.quoteCurrency}
              {pair.baseName && pair.baseName !== pair.baseCurrency && (
                <span className="text-sm font-normal text-[#A1AFB8] ml-2">
                  {pair.baseName}
                </span>
              )}
            </h3>
            <p className="text-xs text-[#A1AFB8]">
              Perdagangan Spot &amp; Grafik Candlestick Live akan dibuka otomatis saat waktu hitung mundur selesai.
            </p>
          </div>
        </div>

        {/* High-Contrast Tabular Monospace Countdown Blocks */}
        <div className="grid grid-cols-4 gap-2.5 sm:gap-3 font-mono tabular-nums">
          {[
            { label: 'HARI', value: pad2(c.days) },
            { label: 'JAM', value: pad2(c.hours) },
            { label: 'MENIT', value: pad2(c.minutes) },
            { label: 'DETIK', value: pad2(c.seconds) }
          ].map(block => (
            <div
              key={block.label}
              className="py-3.5 px-2 rounded-[10px] bg-[#090D12] border border-[#2B3944] text-center"
            >
              <span className="text-2xl sm:text-3xl font-bold text-[#E4EBEF] tracking-tight block leading-none">
                {block.value}
              </span>
              <span className="text-[10px] font-sans font-semibold tracking-wider text-[#8DA5B1] block mt-2">
                {block.label}
              </span>
            </div>
          ))}
        </div>

        {/* Exact Launch Schedule & Readiness Details */}
        <div className="p-3.5 rounded-[9px] bg-[#111820] border border-[#202B34] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#A1AFB8]">
            <Calendar className="w-4 h-4 text-[#8DA5B1] shrink-0" />
            <div>
              <span className="text-[10px] text-[#71818B] block">Jadwal Pembukaan Trading</span>
              <span className="font-mono font-semibold text-[#E4EBEF]">
                {new Date(pair.scheduledAt).toLocaleString('id-ID', {
                  weekday: 'short',
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-[6px] border ${
                pair.depositEnabled !== false
                  ? 'bg-[#12392F] text-[#35B887] border-[#16A879]/30'
                  : 'bg-[#17212B] text-[#71818B] border-[#202B34]'
              }`}
            >
              <ArrowDownLeft className="w-3 h-3" />
              Deposit {pair.depositEnabled !== false ? 'Open' : 'Soon'}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-[6px] border ${
                pair.withdrawalEnabled !== false
                  ? 'bg-[#12392F] text-[#35B887] border-[#16A879]/30'
                  : 'bg-[#17212B] text-[#71818B] border-[#202B34]'
              }`}
            >
              <ArrowUpRight className="w-3 h-3" />
              WD {pair.withdrawalEnabled !== false ? 'Open' : 'Soon'}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-[11px] text-[#71818B]">
          <Rocket className="w-3.5 h-3.5 text-[#8DA5B1]" />
          <span>Matching Engine &amp; Order Book disiapkan otomatis — halaman akan aktif saat countdown 00:00:00.</span>
        </div>
      </div>
    </div>
  );
};
