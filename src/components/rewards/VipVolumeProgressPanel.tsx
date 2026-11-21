/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/rewards/VipVolumeProgressPanel.tsx
 * Recharts-powered VIP Tier Progress Bar & Current Volume vs. Next VIP Tier Requirements Chart.
 * Renders 100% real 30-day rolling Spot & Perpetual Futures volume against authoritative VIP thresholds.
 */

import React, { useMemo, useState } from 'react';
import { BarChart3, ArrowUpRight, Lock } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ReferenceLine
} from 'recharts';
import { Button } from '../ui/Button.js';

export interface VipTierChartConfig {
  level: number;
  code: string;
  name: string;
  minVolume30dUsdt: number;
  makerFeeBps: number;
  takerFeeBps: number;
  makerFeePct: string;
  takerFeePct: string;
  referralRebatePct: number;
  dailyWithdrawalLimitBtc: number;
  perks: string[];
}

interface Props {
  currentTier: VipTierChartConfig;
  nextTier: VipTierChartConfig | null;
  schedule: VipTierChartConfig[];
  spotVolume30dUsdt: number;
  futuresVolume30dUsdt: number;
  volume30dUsdt: number;
  remainingVolumeUsdt: number;
  progressPct: number;
  tradesCount30d: number;
  displayCurrency: 'USDT' | 'IDR';
  usdtIdrRate: number;
  isAuthenticated: boolean;
  onStartTrading?: () => void;
  onOpenAuthModal?: () => void;
}

function formatMoney(usdtVal: number, currency: 'USDT' | 'IDR', rate: number, decimals = 2): string {
  if (currency === 'IDR') {
    return `Rp ${Math.round(usdtVal * rate).toLocaleString('id-ID')}`;
  }
  return `$${usdtVal.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}`;
}

function formatCompactAxis(usdtVal: number, currency: 'USDT' | 'IDR', rate: number): string {
  const val = currency === 'IDR' ? usdtVal * rate : usdtVal;
  const prefix = currency === 'IDR' ? 'Rp ' : '$';
  if (val >= 1_000_000_000_000) return `${prefix}${(val / 1_000_000_000_000).toFixed(1)}T`;
  if (val >= 1_000_000_000) return `${prefix}${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `${prefix}${(val / 1_000_000).toFixed(val % 1_000_000 === 0 ? 0 : 1)}M`;
  if (val >= 1_000) return `${prefix}${(val / 1_000).toFixed(val % 1_000 === 0 ? 0 : 1)}K`;
  return `${prefix}${Math.round(val)}`;
}

interface ProgressTooltipProps {
  active?: boolean;
  payload?: any[];
  displayCurrency: 'USDT' | 'IDR';
  usdtIdrRate: number;
  nextTierName: string;
  targetUsdt: number;
  progressPct: number;
}

const ProgressBarTooltip: React.FC<ProgressTooltipProps> = ({
  active,
  payload,
  displayCurrency,
  usdtIdrRate,
  nextTierName,
  targetUsdt,
  progressPct
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-[8px] bg-[#0E141B] border border-[#2B3944] px-3.5 py-2.5 text-xs shadow-lg space-y-1.5 min-w-[220px]">
      <div className="flex items-center justify-between gap-4 font-sans">
        <span className="font-semibold text-[#E4EBEF]">Progress to {nextTierName}</span>
        <span className="font-mono tabular-nums font-semibold text-[#16A879]">
          {progressPct.toFixed(1)}%
        </span>
      </div>
      <div className="space-y-1 pt-1 border-t border-[#202B34] font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="font-sans text-[#A1AFB8]">Spot 30D</span>
          <span className="text-[#5B9BD5]">{formatMoney(row.rawSpot, displayCurrency, usdtIdrRate)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="font-sans text-[#A1AFB8]">Futures 30D</span>
          <span className="text-[#16A879]">{formatMoney(row.rawFutures, displayCurrency, usdtIdrRate)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="font-sans text-[#A1AFB8]">Remaining Gap</span>
          <span className="text-[#D6A85C]">{formatMoney(row.rawRemaining, displayCurrency, usdtIdrRate)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 pt-1 border-t border-[#202B34]">
          <span className="font-sans text-[#71818B]">Tier Requirement</span>
          <span className="text-[#E4EBEF] font-semibold">
            {formatMoney(targetUsdt, displayCurrency, usdtIdrRate, 0)}
          </span>
        </div>
      </div>
    </div>
  );
};

interface ComparisonTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  displayCurrency: 'USDT' | 'IDR';
  usdtIdrRate: number;
}

const ComparisonChartTooltip: React.FC<ComparisonTooltipProps> = ({
  active,
  payload,
  label,
  displayCurrency,
  usdtIdrRate
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  const valUsdt = Number(item?.value ?? 0);
  const meta = item?.payload?.note as string | undefined;
  const sub = item?.payload?.subNote as string | undefined;

  return (
    <div className="rounded-[8px] bg-[#0E141B] border border-[#2B3944] px-3 py-2 text-xs shadow-lg max-w-[260px]">
      <div className="font-sans font-semibold text-[#E4EBEF]">{label || item?.payload?.name}</div>
      <div className="font-mono tabular-nums font-semibold text-[#16A879] mt-0.5">
        {formatMoney(valUsdt, displayCurrency, usdtIdrRate)}
        {displayCurrency === 'USDT' ? ' USDT' : ''}
      </div>
      {meta && <div className="text-[11px] font-sans text-[#A1AFB8] mt-1">{meta}</div>}
      {sub && <div className="text-[11px] font-mono tabular-nums text-[#71818B] mt-0.5">{sub}</div>}
    </div>
  );
};

export const VipVolumeProgressPanel: React.FC<Props> = ({
  currentTier,
  nextTier,
  schedule,
  spotVolume30dUsdt,
  futuresVolume30dUsdt,
  volume30dUsdt,
  remainingVolumeUsdt,
  progressPct,
  tradesCount30d,
  displayCurrency,
  usdtIdrRate,
  isAuthenticated,
  onStartTrading,
  onOpenAuthModal
}) => {
  const [chartMode, setChartMode] = useState<'NEXT_TIER' | 'LADDER'>('NEXT_TIER');

  const targetUsdt = nextTier ? nextTier.minVolume30dUsdt : Math.max(volume30dUsdt, currentTier.minVolume30dUsdt, 1);
  const nextTierName = nextTier ? nextTier.name : currentTier.name;

  // Recharts Dataset 1: Stacked Visual Progress Bar (Spot + Futures + Remaining Gap)
  const stackedProgressData = useMemo(() => {
    const safeTarget = Math.max(1, targetUsdt);
    const cappedTotal = Math.min(volume30dUsdt, safeTarget);
    const spotShare =
      volume30dUsdt > 0 ? (spotVolume30dUsdt / volume30dUsdt) * cappedTotal : 0;
    const futuresShare =
      volume30dUsdt > 0 ? Math.max(0, cappedTotal - spotShare) : 0;
    const remainingShare = nextTier ? Math.max(0, safeTarget - cappedTotal) : 0;

    return [
      {
        label: nextTier ? `${currentTier.code} → ${nextTier.code}` : currentTier.code,
        spotBar: Number(spotShare.toFixed(2)),
        futuresBar: Number(futuresShare.toFixed(2)),
        remainingBar: Number(remainingShare.toFixed(2)),
        rawSpot: spotVolume30dUsdt,
        rawFutures: futuresVolume30dUsdt,
        rawRemaining: remainingVolumeUsdt
      }
    ];
  }, [currentTier.code, nextTier, targetUsdt, volume30dUsdt, spotVolume30dUsdt, futuresVolume30dUsdt, remainingVolumeUsdt]);

  // Recharts Dataset 2A: Current Trading Volume vs. Next VIP Tier Requirement
  const nextTierComparisonData = useMemo(() => {
    const rows = [
      {
        name: 'Spot 30D',
        value: Number(spotVolume30dUsdt.toFixed(2)),
        fill: '#5B9BD5',
        note: 'Verified 30-day rolling Spot order book volume',
        subNote: `${tradesCount30d} total fills in last 30 days`
      },
      {
        name: 'Futures 30D',
        value: Number(futuresVolume30dUsdt.toFixed(2)),
        fill: '#35B887',
        note: 'Verified 30-day rolling Perpetual Futures notional',
        subNote: '100% counted toward VIP tiering'
      },
      {
        name: 'Your 30D Total',
        value: Number(volume30dUsdt.toFixed(2)),
        fill: '#16A879',
        note: `Active Tier: ${currentTier.name} (${currentTier.code})`,
        subNote: `Maker ${currentTier.makerFeePct} · Taker ${currentTier.takerFeePct}`
      },
      {
        name: nextTier ? `${nextTier.name} Req.` : `${currentTier.name} Min`,
        value: nextTier ? nextTier.minVolume30dUsdt : currentTier.minVolume30dUsdt,
        fill: '#D6A85C',
        note: nextTier
          ? `Unlocks Maker ${nextTier.makerFeePct} / Taker ${nextTier.takerFeePct} & ${nextTier.referralRebatePct}% referral rebate`
          : 'Top Institutional tier fee schedule unlocked',
        subNote: nextTier
          ? `Remaining gap: ${formatMoney(remainingVolumeUsdt, displayCurrency, usdtIdrRate)}`
          : 'Requirement satisfied'
      }
    ];
    return rows;
  }, [
    spotVolume30dUsdt,
    futuresVolume30dUsdt,
    volume30dUsdt,
    tradesCount30d,
    currentTier,
    nextTier,
    remainingVolumeUsdt,
    displayCurrency,
    usdtIdrRate
  ]);

  // Recharts Dataset 2B: Current Volume Benchmarked Against Upcoming VIP Tier Ladder
  const tierLadderData = useMemo(() => {
    const upcomingTiers = schedule
      .filter(t => t.level > 0 && t.level >= Math.max(1, currentTier.level))
      .slice(0, 4);

    return [
      {
        name: 'Your 30D',
        value: Number(volume30dUsdt.toFixed(2)),
        fill: '#16A879',
        note: `${currentTier.name} (${currentTier.code}) active volume`,
        subNote: `Maker ${currentTier.makerFeePct} · Taker ${currentTier.takerFeePct}`
      },
      ...upcomingTiers.map(t => ({
        name: t.name,
        value: t.minVolume30dUsdt,
        fill: t.level === nextTier?.level ? '#D6A85C' : '#334452',
        note: `Maker ${t.makerFeePct} / Taker ${t.takerFeePct} · ${t.referralRebatePct}% Rebate`,
        subNote: `24h Withdrawal Limit: ${t.dailyWithdrawalLimitBtc.toLocaleString('en-US')} BTC`
      }))
    ];
  }, [schedule, currentTier, nextTier, volume30dUsdt]);

  const activeChartData = chartMode === 'NEXT_TIER' ? nextTierComparisonData : tierLadderData;

  return (
    <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
      {/* Header Row */}
      <div className="px-5 py-4 border-b border-[#202B34] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <BarChart3 className="w-4 h-4 text-[#8DA5B1] mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-[#E4EBEF]">
              VIP Volume Progress &amp; Next-Tier Analytics
            </h3>
            <p className="text-xs text-[#71818B] mt-0.5">
              {isAuthenticated
                ? `Live 30-day Spot & Perpetual Futures volume measured against ${nextTier ? `${nextTier.name} requirements` : 'Institutional tier status'}.`
                : 'Sign in to compare your live 30-day trading volume against institutional VIP fee tiers.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-[7px] bg-[#111820] border border-[#202B34] self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setChartMode('NEXT_TIER')}
            className={`px-3 py-1.5 rounded-[5px] text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
              chartMode === 'NEXT_TIER'
                ? 'bg-[#1D2832] text-[#E4EBEF]'
                : 'text-[#71818B] hover:text-[#E4EBEF]'
            }`}
          >
            Next Tier Breakdown
          </button>
          <button
            type="button"
            onClick={() => setChartMode('LADDER')}
            className={`px-3 py-1.5 rounded-[5px] text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
              chartMode === 'LADDER'
                ? 'bg-[#1D2832] text-[#E4EBEF]'
                : 'text-[#71818B] hover:text-[#E4EBEF]'
            }`}
          >
            VIP Tier Ladder
          </button>
        </div>
      </div>

      {/* Section 1: Recharts Stacked Visual Progress Bar */}
      <div className="px-5 py-4 space-y-2.5 border-b border-[#202B34]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-[#A1AFB8]">
            <span className="font-semibold text-[#E4EBEF]">{currentTier.name}</span>
            <span aria-hidden="true">→</span>
            <span className="font-semibold text-[#D6A85C]">
              {nextTier ? nextTier.name : 'Institutional Max Tier'}
            </span>
          </div>
          <div className="font-mono tabular-nums text-[#E4EBEF] font-semibold">
            {formatMoney(volume30dUsdt, displayCurrency, usdtIdrRate)}
            <span className="text-[#71818B] font-normal">
              {' / '}
              {formatMoney(targetUsdt, displayCurrency, usdtIdrRate, 0)}
            </span>
            <span className="ml-2 text-[#16A879]">({progressPct.toFixed(1)}%)</span>
          </div>
        </div>

        {/* Recharts Horizontal Stacked Progress Bar */}
        <div className="h-11 w-full rounded-[7px] bg-[#111820] border border-[#202B34] px-2 py-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={stackedProgressData}
              layout="vertical"
              margin={{ top: 4, right: 6, left: 6, bottom: 4 }}
              barCategoryGap={0}
            >
              <XAxis type="number" domain={[0, targetUsdt]} hide />
              <YAxis type="category" dataKey="label" hide />
              <Tooltip
                cursor={false}
                content={
                  <ProgressBarTooltip
                    displayCurrency={displayCurrency}
                    usdtIdrRate={usdtIdrRate}
                    nextTierName={nextTierName}
                    targetUsdt={targetUsdt}
                    progressPct={progressPct}
                  />
                }
              />
              <Bar
                dataKey="spotBar"
                stackId="vipProgress"
                fill="#5B9BD5"
                barSize={18}
                radius={futuresVolume30dUsdt > 0 || remainingVolumeUsdt > 0 ? [4, 0, 0, 4] : [4, 4, 4, 4]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="futuresBar"
                stackId="vipProgress"
                fill="#16A879"
                barSize={18}
                radius={
                  spotVolume30dUsdt === 0 && remainingVolumeUsdt === 0
                    ? [4, 4, 4, 4]
                    : spotVolume30dUsdt === 0
                    ? [4, 0, 0, 4]
                    : remainingVolumeUsdt === 0
                    ? [0, 4, 4, 0]
                    : [0, 0, 0, 0]
                }
                isAnimationActive={false}
              />
              <Bar
                dataKey="remainingBar"
                stackId="vipProgress"
                fill="#1E2934"
                barSize={18}
                radius={volume30dUsdt === 0 ? [4, 4, 4, 4] : [0, 4, 4, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Clean Unboxed Legend & Gap Summary */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-[#71818B]">
          <div className="flex flex-wrap items-center gap-4 font-sans">
            <span className="inline-flex items-center gap-1.5 text-[#A1AFB8]">
              <span className="w-2.5 h-2.5 rounded-[2px] bg-[#5B9BD5] inline-block" />
              Spot 30D: <strong className="font-mono text-[#E4EBEF] font-medium">{formatMoney(spotVolume30dUsdt, displayCurrency, usdtIdrRate)}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 text-[#A1AFB8]">
              <span className="w-2.5 h-2.5 rounded-[2px] bg-[#16A879] inline-block" />
              Futures 30D: <strong className="font-mono text-[#E4EBEF] font-medium">{formatMoney(futuresVolume30dUsdt, displayCurrency, usdtIdrRate)}</strong>
            </span>
            {nextTier && (
              <span className="inline-flex items-center gap-1.5 text-[#A1AFB8]">
                <span className="w-2.5 h-2.5 rounded-[2px] bg-[#1E2934] border border-[#2B3944] inline-block" />
                Remaining: <strong className="font-mono text-[#D6A85C] font-medium">{formatMoney(remainingVolumeUsdt, displayCurrency, usdtIdrRate)}</strong>
              </span>
            )}
          </div>
          {nextTier && (
            <span className="font-sans text-[#A1AFB8]">
              Next Fee Rate:{' '}
              <span className="font-mono text-[#16A879]">{nextTier.makerFeePct}</span>
              {' / '}
              <span className="font-mono text-[#E4EBEF]">{nextTier.takerFeePct}</span>
            </span>
          )}
        </div>
      </div>

      {/* Section 2: Recharts Trading Volume vs. VIP Tier Requirements Chart */}
      <div className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold text-[#E4EBEF]">
              {chartMode === 'NEXT_TIER'
                ? `Current 30D Trading Volume vs. ${nextTier ? `${nextTier.name} Requirement` : 'Institutional Minimum'}`
                : 'Current 30D Volume Benchmarked Across Upcoming VIP Tiers'}
            </h4>
            <p className="text-[11px] text-[#71818B] mt-0.5">
              {chartMode === 'NEXT_TIER'
                ? 'Hover any bar to inspect exact Spot/Futures composition and next-tier maker/taker fee reductions.'
                : 'Dashed green reference line marks your current 30-day rolling volume against upcoming tier thresholds.'}
            </p>
          </div>

          {!isAuthenticated && onOpenAuthModal ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<Lock className="w-3.5 h-3.5" />}
              onClick={onOpenAuthModal}
            >
              Sign In for Live Volume
            </Button>
          ) : isAuthenticated && volume30dUsdt === 0 && onStartTrading ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onStartTrading}
            >
              Start Trading
              <ArrowUpRight className="w-3.5 h-3.5 ml-1 inline" />
            </Button>
          ) : null}
        </div>

        <div className="h-64 w-full rounded-[8px] bg-[#111820] border border-[#202B34] p-3">
          <ResponsiveContainer width="100%" height="100%">
            {chartMode === 'NEXT_TIER' ? (
              <BarChart
                data={activeChartData}
                layout="vertical"
                margin={{ top: 8, right: 24, left: 14, bottom: 8 }}
              >
                <CartesianGrid stroke="#202B34" strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={v => formatCompactAxis(Number(v), displayCurrency, usdtIdrRate)}
                  tick={{ fill: '#71818B', fontSize: 11 }}
                  axisLine={{ stroke: '#202B34' }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={98}
                  tick={{ fill: '#A1AFB8', fontSize: 11 }}
                  axisLine={{ stroke: '#202B34' }}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#1D2832', opacity: 0.45 }}
                  content={
                    <ComparisonChartTooltip
                      displayCurrency={displayCurrency}
                      usdtIdrRate={usdtIdrRate}
                    />
                  }
                />
                {nextTier && (
                  <ReferenceLine
                    x={nextTier.minVolume30dUsdt}
                    stroke="#D6A85C"
                    strokeDasharray="4 4"
                  />
                )}
                <Bar dataKey="value" radius={[0, 5, 5, 0]} maxBarSize={28}>
                  {activeChartData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <BarChart
                data={activeChartData}
                margin={{ top: 12, right: 18, left: 6, bottom: 6 }}
              >
                <CartesianGrid stroke="#202B34" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#A1AFB8', fontSize: 11 }}
                  axisLine={{ stroke: '#202B34' }}
                  tickLine={false}
                />
                <YAxis
                  width={60}
                  tickFormatter={v => formatCompactAxis(Number(v), displayCurrency, usdtIdrRate)}
                  tick={{ fill: '#71818B', fontSize: 11 }}
                  axisLine={{ stroke: '#202B34' }}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#1D2832', opacity: 0.45 }}
                  content={
                    <ComparisonChartTooltip
                      displayCurrency={displayCurrency}
                      usdtIdrRate={usdtIdrRate}
                    />
                  }
                />
                {volume30dUsdt > 0 && (
                  <ReferenceLine
                    y={volume30dUsdt}
                    stroke="#16A879"
                    strokeDasharray="4 4"
                  />
                )}
                <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={48}>
                  {activeChartData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
