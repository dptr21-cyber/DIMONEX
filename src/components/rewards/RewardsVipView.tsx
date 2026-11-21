/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/rewards/RewardsVipView.tsx
 * DIMONEX Institutional VIP Fee Schedule, Real Trader Task Center & Referral Program.
 *
 * 100% backed by authoritative backend APIs (/api/rewards/schedule, /api/rewards/summary,
 * /api/rewards/tasks/:taskId/claim, /api/rewards/referral/apply, /api/rewards/referral/claim).
 * Zero mock figures, zero hardcoded user progress, real double-entry USDT ledger payouts.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Copy,
  RefreshCw,
  ArrowUpRight,
  CheckCircle2,
  AlertCircle,
  Lock,
  Users,
  Gift,
  Award,
} from 'lucide-react';
import { Button } from '../ui/Button.js';
import { PageHeader, PanelHeader } from '../ui/PanelHeader.js';
import { SegmentedTabs } from '../ui/Tabs.js';
import { useToast } from '../ui/Toast.js';
import { UserProfile, UserBalance } from '../../types/index.js';
import { safeFetchJson } from '../../lib/safeFetch.js';

interface Props {
  user: UserProfile | null;
  balances: UserBalance[];
  onOpenAuthModal: () => void;
  onRefreshBalances?: () => void;
  onNavigate?: (view: any) => void;
  displayCurrency: 'USDT' | 'IDR';
}

interface VipTierConfig {
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

interface RewardTaskItem {
  id: string;
  title: string;
  description: string;
  category: 'SECURITY' | 'FUNDING' | 'TRADING' | 'COMPLIANCE' | 'VIP';
  rewardCurrency: string;
  rewardAmountUsdt: number;
  rewardDisplay: string;
  actionLabel: string;
  actionView: 'SECURITY' | 'DEPOSIT' | 'TRADE' | 'FUTURES' | 'KYC';
  completed: boolean;
  progressPct: number;
  progressLabel: string;
  claimed: boolean;
  claimedAt: number | null;
  journalId: string | null;
  status: 'CLAIMED' | 'READY' | 'IN_PROGRESS';
}

interface RefereeItem {
  userId: string;
  emailMasked: string;
  joinedAt: number;
  volume30dUsdt: number;
  volumeAllTimeUsdt: number;
  feesGeneratedUsdt: number;
  commissionEarnedUsdt: number;
  isActiveTrader: boolean;
}

interface PayoutHistoryItem {
  id: string;
  type: 'TASK_REWARD' | 'REFERRAL_COMMISSION';
  title: string;
  currency: string;
  amountDisplay: string;
  journalId: string;
  claimedAt: number;
}

interface RewardsSchedulePayload {
  usdtIdrRate: number;
  vipTiers: VipTierConfig[];
  taskCatalog: {
    id: string;
    title: string;
    description: string;
    category: string;
    rewardDisplay: string;
    actionLabel: string;
    actionView: string;
  }[];
  minReferralClaimUsdt: number;
}

interface RewardsSummaryPayload {
  usdtIdrRate: number;
  account: {
    userId: string;
    email: string;
    status: string;
    kycStatus: string;
    kycTier: number;
    isTotpEnabled: boolean;
    portfolioEquityUsdt: number;
    portfolioEquityIdr: number;
  };
  vip: {
    currentTier: VipTierConfig;
    nextTier: VipTierConfig | null;
    progressPct: number;
    remainingVolumeUsdt: number;
    volume30dUsdt: number;
    volume30dIdr: number;
    spotVolume30dUsdt: number;
    futuresVolume30dUsdt: number;
    feesPaid30dUsdt: number;
    tradesCount30d: number;
    schedule: VipTierConfig[];
  };
  tasks: {
    items: RewardTaskItem[];
    readyCount: number;
    claimedCount: number;
    totalClaimedUsdt: number;
  };
  referral: {
    referralCode: string;
    referredBy: { code: string; emailMasked: string; boundAt: number } | null;
    rebateRatePct: number;
    totalReferees: number;
    activeReferees: number;
    totalRefereeVolumeUsdt: number;
    totalCommissionEarnedUsdt: number;
    totalCommissionClaimedUsdt: number;
    claimableCommissionUsdt: number;
    minClaimThresholdUsdt: number;
    referees: RefereeItem[];
  };
  payoutHistory: PayoutHistoryItem[];
}

function formatUsd(val: number, decimals = 2): string {
  return `$${val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function formatIdrShort(val: number): string {
  return `Rp ${Math.round(val).toLocaleString('id-ID')}`;
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const RewardsVipView: React.FC<Props> = ({
  user,
  onOpenAuthModal,
  onRefreshBalances,
  onNavigate,
  displayCurrency,
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'VIP' | 'REWARDS' | 'REFERRAL'>('VIP');
  const [schedule, setSchedule] = useState<RewardsSchedulePayload | null>(null);
  const [summary, setSummary] = useState<RewardsSummaryPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [claimingTaskId, setClaimingTaskId] = useState<string | null>(null);
  const [isClaimingCommission, setIsClaimingCommission] = useState(false);
  const [applyCodeInput, setApplyCodeInput] = useState('');
  const [isApplyingCode, setIsApplyingCode] = useState(false);

  const fetchRewardsData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const schedRes = await safeFetchJson<RewardsSchedulePayload>('/api/rewards/schedule');
      if (schedRes.ok && schedRes.data) {
        setSchedule(schedRes.data);
      } else {
        setErrorMsg(schedRes.error || 'Failed to load institutional fee schedule.');
      }

      const token = localStorage.getItem('dimonex_auth_token');
      if (user && token) {
        const sumRes = await safeFetchJson<RewardsSummaryPayload>('/api/rewards/summary', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (sumRes.ok && sumRes.data) {
          setSummary(sumRes.data);
        } else {
          setSummary(null);
          setErrorMsg(sumRes.error || 'Failed to load account VIP metrics.');
        }
      } else {
        setSummary(null);
      }
    } catch {
      setErrorMsg('Network error loading VIP & Rewards data.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchRewardsData();
  }, [fetchRewardsData]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('success', 'Copied', `${label} copied to clipboard.`);
    } catch {
      showToast('error', 'Copy Failed', 'Clipboard permission was denied.');
    }
  };

  const handleClaimTask = async (task: RewardTaskItem) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!user || !token) {
      onOpenAuthModal();
      return;
    }
    setClaimingTaskId(task.id);
    try {
      const res = await safeFetchJson<{
        success: boolean;
        claim: { amountDisplay: string; journalId: string };
        summary: RewardsSummaryPayload;
      }>(`/api/rewards/tasks/${encodeURIComponent(task.id)}/claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok && res.data?.summary) {
        setSummary(res.data.summary);
        onRefreshBalances?.();
        showToast(
          'success',
          'Reward Credited to Spot Wallet',
          `${res.data.claim.amountDisplay} settled via ledger journal ${res.data.claim.journalId.slice(0, 8)}.`
        );
      } else {
        showToast('error', 'Unable to Claim Reward', res.error || 'Task eligibility not met.');
      }
    } finally {
      setClaimingTaskId(null);
    }
  };

  const handleApplyReferralCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('dimonex_auth_token');
    if (!user || !token) {
      onOpenAuthModal();
      return;
    }
    const clean = applyCodeInput.trim().toUpperCase();
    if (!clean) {
      showToast('warning', 'Referral Code Required', 'Enter a valid partner code (e.g., DMX-XXXXXX).');
      return;
    }
    setIsApplyingCode(true);
    try {
      const res = await safeFetchJson<{
        success: boolean;
        summary: RewardsSummaryPayload;
      }>('/api/rewards/referral/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ referralCode: clean }),
      });

      if (res.ok && res.data?.summary) {
        setSummary(res.data.summary);
        setApplyCodeInput('');
        showToast('success', 'Referral Code Linked', `Your account is now linked to ${clean}.`);
      } else {
        showToast('error', 'Referral Code Rejected', res.error || 'Invalid or ineligible referral code.');
      }
    } finally {
      setIsApplyingCode(false);
    }
  };

  const handleClaimReferralCommission = async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!user || !token) {
      onOpenAuthModal();
      return;
    }
    setIsClaimingCommission(true);
    try {
      const res = await safeFetchJson<{
        success: boolean;
        payout: { amountDisplay: string; journalId: string };
        summary: RewardsSummaryPayload;
      }>('/api/rewards/referral/claim', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok && res.data?.summary) {
        setSummary(res.data.summary);
        onRefreshBalances?.();
        showToast(
          'success',
          'Commission Settled',
          `${res.data.payout.amountDisplay} credited to your USDT Spot Wallet.`
        );
      } else {
        showToast('error', 'Claim Failed', res.error || 'No claimable commission available.');
      }
    } finally {
      setIsClaimingCommission(false);
    }
  };

  const vipTiers = summary?.vip.schedule || schedule?.vipTiers || [];
  const usdtIdrRate = summary?.usdtIdrRate || schedule?.usdtIdrRate || 16450;
  const referralOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://dimonex.id';
  const referralCode = summary?.referral.referralCode || '';
  const referralLink = referralCode ? `${referralOrigin}/?ref=${encodeURIComponent(referralCode)}` : '';

  const formatVolumePref = (usdtVal: number) =>
    displayCurrency === 'IDR' ? formatIdrShort(usdtVal * usdtIdrRate) : formatUsd(usdtVal);

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto space-y-6">
      <div className="max-w-7xl w-full mx-auto space-y-6">
        <PageHeader
          title="Institutional VIP & Trader Rewards"
          subtitle="Real-time 30-day rolling volume tiering, server-verified trading milestones, and double-entry USDT referral rebates."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedTabs
                activeTab={activeTab}
                onChange={setActiveTab}
                tabs={[
                  { id: 'VIP', label: 'VIP Tier Ladder' },
                  {
                    id: 'REWARDS',
                    label:
                      summary && summary.tasks.readyCount > 0
                        ? `Task Center (${summary.tasks.readyCount})`
                        : 'Task Center',
                  },
                  { id: 'REFERRAL', label: 'Referral Program' },
                ]}
              />
              <button
                type="button"
                onClick={fetchRewardsData}
                disabled={isLoading}
                className="h-9 w-9 rounded-[7px] bg-[#141C24] border border-[#202B34] hover:border-[#40515D] text-[#A1AFB8] hover:text-[#E4EBEF] flex items-center justify-center transition-colors cursor-pointer"
                title="Refresh VIP & Rewards metrics"
                aria-label="Refresh VIP & Rewards metrics"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          }
        />

        {errorMsg && (
          <div className="rounded-[9px] bg-[#401F27]/35 border border-[#EA5B65]/40 px-4 py-3 flex items-center justify-between gap-3 text-xs text-[#F0757E]">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={fetchRewardsData}
              className="px-2.5 py-1 rounded-[5px] bg-[#141C24] border border-[#2B3944] text-[#E4EBEF] cursor-pointer whitespace-nowrap shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Guest Sign-In Callout (shown when unauthenticated — never shows fake account stats) */}
        {!user && (
          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-[8px] bg-[#111820] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1] shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#E4EBEF]">
                  Sign in to view your live VIP tier, claimable USDT tasks, and referral code
                </h3>
                <p className="text-xs text-[#71818B] mt-0.5">
                  All volumes, fee tiers, task progress, and referral rebates are computed strictly from your verified account trades and double-entry ledger history.
                </p>
              </div>
            </div>
            <Button variant="primary" size="md" onClick={onOpenAuthModal} className="shrink-0">
              Sign In / Register
            </Button>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 1: VIP TIER LADDER                                            */}
        {/* ================================================================= */}
        {activeTab === 'VIP' && (
          <div className="space-y-6">
            {user && summary ? (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 space-y-5">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                  {/* Current VIP Tier Identity */}
                  <div className="lg:col-span-4 space-y-1.5">
                    <span className="text-xs text-[#71818B] block">Active Membership Tier</span>
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-[8px] bg-[#1D2832] border border-[#40515D] flex items-center justify-center font-mono font-semibold text-[#E4EBEF] text-sm shrink-0">
                        {summary.vip.currentTier.code}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-base text-[#E4EBEF] truncate">
                          {summary.vip.currentTier.name}
                        </h3>
                        <p className="text-xs text-[#71818B] truncate">
                          <span className="text-[#16A879] font-medium">
                            {summary.account.status === 'active' ? 'Active' : summary.account.status}
                          </span>
                          <span aria-hidden="true"> · </span>
                          <span>
                            KYC {summary.account.kycStatus === 'approved' ? `Tier ${summary.account.kycTier}` : summary.account.kycStatus}
                          </span>
                          <span aria-hidden="true"> · </span>
                          <span>{summary.vip.currentTier.referralRebatePct}% Referral Rebate</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Rolling 30D Volume Progress */}
                  <div className="lg:col-span-5 space-y-2">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-[#A1AFB8]">30-Day Rolling Volume (Spot + Futures)</span>
                      <span className="font-mono tabular-nums text-[#E4EBEF] font-semibold">
                        {formatUsd(summary.vip.volume30dUsdt)}
                        {summary.vip.nextTier
                          ? ` / ${formatUsd(summary.vip.nextTier.minVolume30dUsdt, 0)}`
                          : ' · Max Tier'}
                      </span>
                    </div>
                    <div className="w-full bg-[#111820] rounded-[5px] h-2 overflow-hidden border border-[#202B34]">
                      <div
                        className="bg-[#8DA5B1] h-2 rounded-[5px] transition-all duration-300"
                        style={{ width: `${Math.max(0, Math.min(100, summary.vip.progressPct))}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#71818B] font-mono tabular-nums">
                      <span>
                        {summary.vip.nextTier
                          ? `${formatUsd(summary.vip.remainingVolumeUsdt)} remaining to unlock ${summary.vip.nextTier.name}`
                          : 'Institutional tier unlocked — lowest fee schedule active'}
                      </span>
                      <span>{summary.vip.progressPct.toFixed(1)}%</span>
                    </div>
                  </div>

                  {/* Active Maker / Taker Fee Rates */}
                  <div className="lg:col-span-3 flex items-center justify-around gap-4 p-3.5 rounded-[8px] bg-[#111820] border border-[#202B34] font-mono tabular-nums">
                    <div>
                      <span className="text-[11px] text-[#71818B] block font-sans">Spot Maker</span>
                      <span className="text-base font-semibold text-[#16A879]">
                        {summary.vip.currentTier.makerFeePct}
                      </span>
                    </div>
                    <div className="w-px h-8 bg-[#202B34]" />
                    <div>
                      <span className="text-[11px] text-[#71818B] block font-sans">Spot Taker</span>
                      <span className="text-base font-semibold text-[#E4EBEF]">
                        {summary.vip.currentTier.takerFeePct}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Live 30-Day Breakdown Strip */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-[#202B34] font-mono tabular-nums">
                  <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
                    <span className="text-[11px] font-sans text-[#71818B] block">30D Spot Volume</span>
                    <span className="text-sm font-semibold text-[#E4EBEF] mt-0.5 block">
                      {formatVolumePref(summary.vip.spotVolume30dUsdt)}
                    </span>
                    <span className="text-[10px] text-[#71818B] block mt-0.5">
                      {summary.vip.tradesCount30d} fills (30d)
                    </span>
                  </div>
                  <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
                    <span className="text-[11px] font-sans text-[#71818B] block">30D Futures Volume</span>
                    <span className="text-sm font-semibold text-[#E4EBEF] mt-0.5 block">
                      {formatVolumePref(summary.vip.futuresVolume30dUsdt)}
                    </span>
                    <span className="text-[10px] text-[#71818B] block mt-0.5">
                      Perpetual notional
                    </span>
                  </div>
                  <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
                    <span className="text-[11px] font-sans text-[#71818B] block">30D Trading Fees Paid</span>
                    <span className="text-sm font-semibold text-[#E4EBEF] mt-0.5 block">
                      {formatUsd(summary.vip.feesPaid30dUsdt, 4)}
                    </span>
                    <span className="text-[10px] text-[#71818B] block mt-0.5">
                      Authoritative ledger fees
                    </span>
                  </div>
                  <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
                    <span className="text-[11px] font-sans text-[#71818B] block">Verified Portfolio Equity</span>
                    <span className="text-sm font-semibold text-[#E4EBEF] mt-0.5 block">
                      {displayCurrency === 'IDR'
                        ? formatIdrShort(summary.account.portfolioEquityIdr)
                        : formatUsd(summary.account.portfolioEquityUsdt)}
                    </span>
                    <span className="text-[10px] text-[#71818B] block mt-0.5">
                      1 USDT ≈ {formatIdrShort(usdtIdrRate)}
                    </span>
                  </div>
                </div>
              </div>
            ) : user && isLoading ? (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-6 animate-pulse space-y-4">
                <div className="h-5 w-48 bg-[#1D2832] rounded" />
                <div className="h-2.5 w-full bg-[#111820] rounded" />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map(n => (
                    <div key={n} className="h-16 bg-[#111820] rounded-[7px]" />
                  ))}
                </div>
              </div>
            ) : null}

            {/* Authoritative Institutional Fee Schedule Table */}
            <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
              <PanelHeader
                title="Institutional Fee Schedule"
                subtitle="Evaluated live from rolling 30-day Spot & Perpetual Futures volume across all verified DIMONEX markets."
              />

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="bg-[#111820] text-[#71818B] border-b border-[#202B34]">
                      <th className="py-3 px-4 font-medium font-sans">Tier</th>
                      <th className="py-3 px-4 font-medium font-sans">30D Rolling Volume</th>
                      <th className="py-3 px-4 font-medium font-sans text-right">Spot Maker</th>
                      <th className="py-3 px-4 font-medium font-sans text-right">Spot Taker</th>
                      <th className="py-3 px-4 font-medium font-sans text-right">Referral Rebate</th>
                      <th className="py-3 px-4 font-medium font-sans text-right">24h Withdrawal</th>
                      <th className="py-3 px-4 font-medium font-sans">Institutional Privileges</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202B34]">
                    {vipTiers.map(tier => {
                      const isCurrent = Boolean(summary && summary.vip.currentTier.level === tier.level);
                      const volLabel =
                        tier.minVolume30dUsdt === 0
                          ? '< $50,000'
                          : `≥ ${formatUsd(tier.minVolume30dUsdt, 0)}`;

                      return (
                        <tr
                          key={tier.level}
                          className={`transition-colors ${
                            isCurrent ? 'bg-[#1D2832]/75' : 'hover:bg-[#17212B]'
                          }`}
                        >
                          <td className="py-3 px-4 font-sans font-semibold text-[#E4EBEF] whitespace-nowrap">
                            <span>{tier.name}</span>
                            {isCurrent && (
                              <span className="ml-2 text-[11px] font-mono text-[#16A879]">
                                · Current
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-[#E4EBEF] whitespace-nowrap">{volLabel}</td>
                          <td className="py-3 px-4 text-right text-[#16A879] font-semibold whitespace-nowrap">
                            {tier.makerFeePct}
                          </td>
                          <td className="py-3 px-4 text-right text-[#E4EBEF] whitespace-nowrap">
                            {tier.takerFeePct}
                          </td>
                          <td className="py-3 px-4 text-right text-[#A5BAC4] whitespace-nowrap">
                            {tier.referralRebatePct}%
                          </td>
                          <td className="py-3 px-4 text-right text-[#A1AFB8] whitespace-nowrap">
                            {tier.dailyWithdrawalLimitBtc.toLocaleString('en-US')} BTC
                          </td>
                          <td className="py-3 px-4 font-sans text-[#A1AFB8]">
                            {tier.perks.join(' · ')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: REAL TRADER TASK CENTER & PAYOUT LEDGER                    */}
        {/* ================================================================= */}
        {activeTab === 'REWARDS' && (
          <div className="space-y-6">
            {summary && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono tabular-nums">
                <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
                  <span className="text-xs font-sans text-[#71818B] block">Ready to Claim</span>
                  <span className="text-xl font-semibold text-[#16A879] mt-1 block">
                    {summary.tasks.readyCount}{' '}
                    <span className="text-xs font-sans font-normal text-[#71818B]">
                      {summary.tasks.readyCount === 1 ? 'milestone' : 'milestones'}
                    </span>
                  </span>
                </div>
                <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
                  <span className="text-xs font-sans text-[#71818B] block">Completed &amp; Claimed</span>
                  <span className="text-xl font-semibold text-[#E4EBEF] mt-1 block">
                    {summary.tasks.claimedCount} / {summary.tasks.items.length}
                  </span>
                </div>
                <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
                  <span className="text-xs font-sans text-[#71818B] block">Total Rewards Credited</span>
                  <span className="text-xl font-semibold text-[#E4EBEF] mt-1 block">
                    {formatUsd(summary.tasks.totalClaimedUsdt)} USDT
                  </span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(summary?.tasks.items || schedule?.taskCatalog || []).map((rawTask: any) => {
                const task = rawTask as RewardTaskItem;
                const isAuthedTask = Boolean(summary);
                const status = isAuthedTask ? task.status : 'IN_PROGRESS';
                const progressPct = isAuthedTask ? task.progressPct : 0;
                const progressLabel = isAuthedTask ? task.progressLabel : 'Sign in to check live progress';
                const isClaiming = claimingTaskId === task.id;

                return (
                  <div
                    key={task.id}
                    className={`rounded-[10px] bg-[#141C24] border ${
                      status === 'READY'
                        ? 'border-[#16A879]/50'
                        : 'border-[#202B34] hover:border-[#40515D]'
                    } p-5 flex flex-col justify-between space-y-4 transition-colors`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[11px] text-[#71818B] mb-1">
                            <span className="font-mono">{task.category}</span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={
                                status === 'CLAIMED'
                                  ? 'text-[#16A879] font-medium'
                                  : status === 'READY'
                                  ? 'text-[#35B887] font-medium'
                                  : 'text-[#A1AFB8]'
                              }
                            >
                              {status === 'CLAIMED'
                                ? 'Claimed & Settled'
                                : status === 'READY'
                                ? 'Eligible to Claim'
                                : 'In Progress'}
                            </span>
                          </div>
                          <h4 className="font-semibold text-sm text-[#E4EBEF]">{task.title}</h4>
                          <p className="text-xs text-[#A1AFB8] mt-1 leading-relaxed">
                            {task.description}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono tabular-nums text-sm font-semibold text-[#16A879] block whitespace-nowrap">
                            +{task.rewardDisplay}
                          </span>
                          <span className="text-[10px] text-[#71818B] block">Spot USDT</span>
                        </div>
                      </div>

                      {/* Real Progress Bar */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                          <span className="text-[#71818B]">{progressLabel}</span>
                          <span className="text-[#A1AFB8]">{progressPct.toFixed(0)}%</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-[#111820] border border-[#202B34] overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              status === 'CLAIMED' || status === 'READY'
                                ? 'bg-[#16A879]'
                                : 'bg-[#8DA5B1]'
                            }`}
                            style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 flex items-center justify-between gap-3 border-t border-[#202B34]">
                      <span className="text-[11px] font-mono text-[#71818B] truncate">
                        {task.claimed && task.journalId
                          ? `Ledger #${task.journalId.slice(0, 8)}`
                          : 'Verified against live account state'}
                      </span>

                      {status === 'CLAIMED' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#16A879] whitespace-nowrap shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Credited
                        </span>
                      ) : status === 'READY' ? (
                        <Button
                          variant="primary"
                          size="sm"
                          isLoading={isClaiming}
                          onClick={() => handleClaimTask(task)}
                          className="shrink-0"
                        >
                          Claim {task.rewardDisplay}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (!user) {
                              onOpenAuthModal();
                            } else {
                              onNavigate?.(task.actionView);
                            }
                          }}
                          className="shrink-0"
                        >
                          {task.actionLabel}
                          <ArrowUpRight className="w-3.5 h-3.5 ml-1 inline" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Verified Reward Payout Ledger History */}
            {summary && (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
                <PanelHeader
                  title="Reward & Rebate Settlement Ledger"
                  subtitle="Every claimed milestone reward and referral rebate is settled atomically into your USDT Spot Wallet."
                />
                {summary.payoutHistory.length === 0 ? (
                  <div className="py-10 px-4 text-center space-y-1.5">
                    <Gift className="w-6 h-6 text-[#53616A] mx-auto" />
                    <p className="text-sm font-medium text-[#A1AFB8]">No reward settlements yet</p>
                    <p className="text-xs text-[#71818B]">
                      Complete an eligible milestone above and claim your USDT reward to record your first ledger payout.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono tabular-nums">
                      <thead>
                        <tr className="bg-[#111820] text-[#71818B] border-b border-[#202B34]">
                          <th className="py-2.5 px-4 font-sans font-medium">Timestamp</th>
                          <th className="py-2.5 px-4 font-sans font-medium">Type</th>
                          <th className="py-2.5 px-4 font-sans font-medium">Description</th>
                          <th className="py-2.5 px-4 font-sans font-medium text-right">Amount</th>
                          <th className="py-2.5 px-4 font-sans font-medium text-right">Ledger Journal ID</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#202B34]">
                        {summary.payoutHistory.map(row => (
                          <tr key={row.id} className="hover:bg-[#17212B]">
                            <td className="py-2.5 px-4 text-[#A1AFB8] whitespace-nowrap">
                              {formatDateTime(row.claimedAt)}
                            </td>
                            <td className="py-2.5 px-4 font-sans text-[#8DA5B1] whitespace-nowrap">
                              {row.type === 'TASK_REWARD' ? 'Task Reward' : 'Referral Rebate'}
                            </td>
                            <td className="py-2.5 px-4 font-sans text-[#E4EBEF]">{row.title}</td>
                            <td className="py-2.5 px-4 text-right font-semibold text-[#16A879] whitespace-nowrap">
                              {row.amountDisplay}
                            </td>
                            <td className="py-2.5 px-4 text-right text-[#71818B] whitespace-nowrap">
                              {row.journalId.slice(0, 14)}…
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 3: REAL REFERRAL PROGRAM                                      */}
        {/* ================================================================= */}
        {activeTab === 'REFERRAL' && (
          <div className="space-y-6">
            {/* KPI Summary Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono tabular-nums">
              <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
                <span className="text-xs font-sans text-[#71818B] block">Verified Referees</span>
                <span className="text-xl font-semibold text-[#E4EBEF] mt-1 block">
                  {summary ? summary.referral.totalReferees : 0}{' '}
                  <span className="text-xs font-sans font-normal text-[#71818B]">
                    ({summary ? summary.referral.activeReferees : 0} active 30d)
                  </span>
                </span>
              </div>

              <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
                <span className="text-xs font-sans text-[#71818B] block">Commission Rebate Rate</span>
                <span className="text-xl font-semibold text-[#8DA5B1] mt-1 block">
                  {summary ? `${summary.referral.rebateRatePct}%` : '20% – 40%'}
                </span>
                <span className="text-[10px] font-sans text-[#71818B] block mt-0.5">
                  Scales automatically with your VIP tier
                </span>
              </div>

              <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
                <span className="text-xs font-sans text-[#71818B] block">Total Commission Earned</span>
                <span className="text-xl font-semibold text-[#E4EBEF] mt-1 block">
                  {formatUsd(summary ? summary.referral.totalCommissionEarnedUsdt : 0, 4)} USDT
                </span>
                <span className="text-[10px] font-sans text-[#71818B] block mt-0.5">
                  Claimed: {formatUsd(summary ? summary.referral.totalCommissionClaimedUsdt : 0, 4)} USDT
                </span>
              </div>

              <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] flex flex-col justify-between gap-2">
                <div>
                  <span className="text-xs font-sans text-[#71818B] block">Claimable Balance</span>
                  <span className="text-xl font-semibold text-[#16A879] mt-1 block">
                    {formatUsd(summary ? summary.referral.claimableCommissionUsdt : 0, 4)} USDT
                  </span>
                </div>
                {user && summary && (
                  <Button
                    variant="primary"
                    size="sm"
                    isLoading={isClaimingCommission}
                    disabled={
                      summary.referral.claimableCommissionUsdt <
                      summary.referral.minClaimThresholdUsdt
                    }
                    onClick={handleClaimReferralCommission}
                  >
                    Claim to Spot Wallet
                  </Button>
                )}
              </div>
            </div>

            {/* Share Referral Code + Link & Bind Referrer Code */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-8 rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 space-y-4">
                <div>
                  <h3 className="font-semibold text-base text-[#E4EBEF]">
                    Your Institutional Referral Credentials
                  </h3>
                  <p className="text-xs text-[#A1AFB8] mt-0.5">
                    Share your unique code or registration link. Every real Spot and Futures trading fee paid by your referees accrues instant USDT commission at your VIP rebate rate.
                  </p>
                </div>

                {user && summary ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-[7px] bg-[#111820] border border-[#202B34] flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[10px] text-[#71818B] block">Unique Referral Code</span>
                        <span className="font-mono font-semibold text-sm text-[#E4EBEF] block truncate">
                          {referralCode}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Copy className="w-3.5 h-3.5" />}
                        onClick={() => copyToClipboard(referralCode, 'Referral code')}
                      >
                        Copy
                      </Button>
                    </div>

                    <div className="p-3.5 rounded-[7px] bg-[#111820] border border-[#202B34] flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[10px] text-[#71818B] block">Direct Invitation Link</span>
                        <span className="font-mono font-medium text-xs text-[#E4EBEF] block truncate">
                          {referralLink}
                        </span>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Copy className="w-3.5 h-3.5" />}
                        onClick={() => copyToClipboard(referralLink, 'Referral link')}
                      >
                        Copy Link
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-[7px] bg-[#111820] border border-[#202B34] flex items-center justify-between gap-3">
                    <span className="text-xs text-[#A1AFB8]">
                      Sign in to generate and share your unique personal referral code.
                    </span>
                    <Button variant="primary" size="sm" onClick={onOpenAuthModal}>
                      Sign In
                    </Button>
                  </div>
                )}
              </div>

              {/* Bind Partner Referral Code Panel */}
              <div className="lg:col-span-4 rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-[#8DA5B1]" />
                  <h3 className="font-semibold text-sm text-[#E4EBEF]">Referrer Attribution</h3>
                </div>

                {!user ? (
                  <p className="text-xs text-[#71818B]">
                    Have a partner code? Sign in or register via a partner link to link your account.
                  </p>
                ) : summary?.referral.referredBy ? (
                  <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1">
                    <span className="text-[11px] text-[#71818B] block">Linked Partner Code</span>
                    <span className="font-mono text-sm font-semibold text-[#16A879] block">
                      {summary.referral.referredBy.code}
                    </span>
                    <span className="text-[11px] text-[#A1AFB8] block">
                      Referrer: {summary.referral.referredBy.emailMasked}
                    </span>
                    <span className="text-[10px] font-mono text-[#71818B] block">
                      Bound {formatDateTime(summary.referral.referredBy.boundAt)}
                    </span>
                  </div>
                ) : (
                  <form onSubmit={handleApplyReferralCode} className="space-y-2.5">
                    <p className="text-xs text-[#71818B]">
                      Were you invited by a DIMONEX partner? Enter their code below to bind attribution.
                    </p>
                    <input
                      type="text"
                      value={applyCodeInput}
                      onChange={e => setApplyCodeInput(e.target.value.toUpperCase())}
                      placeholder="DMX-XXXXXX"
                      maxLength={16}
                      className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs font-mono text-[#E4EBEF] placeholder-[#53616A] outline-none focus:border-[#8DA5B1]"
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      isLoading={isApplyingCode}
                      className="w-full"
                    >
                      Bind Referral Code
                    </Button>
                  </form>
                )}
              </div>
            </div>

            {/* Real Referred Traders Table */}
            <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
              <PanelHeader
                title="Referred Traders & Real-Time Fee Commissions"
                subtitle="Live trade volume and fee rebates calculated from verified Spot and Futures fills executed by your referees."
              />

              {!user || !summary || summary.referral.referees.length === 0 ? (
                <div className="py-10 px-4 text-center space-y-1.5">
                  <Users className="w-6 h-6 text-[#53616A] mx-auto" />
                  <p className="text-sm font-medium text-[#A1AFB8]">
                    No referred traders linked yet
                  </p>
                  <p className="text-xs text-[#71818B] max-w-md mx-auto">
                    When traders register with your referral link or bind your code, their real trading volume and accrued fee commissions appear here automatically.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono tabular-nums">
                    <thead>
                      <tr className="bg-[#111820] text-[#71818B] border-b border-[#202B34]">
                        <th className="py-2.5 px-4 font-sans font-medium">Referee</th>
                        <th className="py-2.5 px-4 font-sans font-medium">Joined</th>
                        <th className="py-2.5 px-4 font-sans font-medium">Status</th>
                        <th className="py-2.5 px-4 font-sans font-medium text-right">30D Volume</th>
                        <th className="py-2.5 px-4 font-sans font-medium text-right">All-Time Fees</th>
                        <th className="py-2.5 px-4 font-sans font-medium text-right">Your Commission</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#202B34]">
                      {summary.referral.referees.map(ref => (
                        <tr key={ref.userId} className="hover:bg-[#17212B]">
                          <td className="py-2.5 px-4 text-[#E4EBEF] font-medium">
                            {ref.emailMasked}
                          </td>
                          <td className="py-2.5 px-4 text-[#A1AFB8] whitespace-nowrap">
                            {formatDateTime(ref.joinedAt)}
                          </td>
                          <td className="py-2.5 px-4 font-sans whitespace-nowrap">
                            <span className={ref.isActiveTrader ? 'text-[#16A879]' : 'text-[#71818B]'}>
                              {ref.isActiveTrader ? 'Active (30d)' : 'Registered'}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right text-[#E4EBEF] whitespace-nowrap">
                            {formatUsd(ref.volume30dUsdt)}
                          </td>
                          <td className="py-2.5 px-4 text-right text-[#A1AFB8] whitespace-nowrap">
                            {formatUsd(ref.feesGeneratedUsdt, 4)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-semibold text-[#16A879] whitespace-nowrap">
                            +{formatUsd(ref.commissionEarnedUsdt, 4)} USDT
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
