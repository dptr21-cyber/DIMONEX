/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/earn/EarnView.tsx
 * DIMONEX Institutional Earn & Staking Vaults — Live Ledger-Backed Implementation
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import {
  ArrowDownLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Coins,
  History,
  Lock,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Unlock,
} from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Modal } from '../ui/Modal.js';
import { PageHeader } from '../ui/PanelHeader.js';
import { SegmentedTabs } from '../ui/Tabs.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { useToast } from '../ui/Toast.js';
import {
  EarnPayoutItem,
  EarnPositionItem,
  EarnSummaryResponse,
  EarnVaultItem,
  UserBalance,
  UserProfile,
} from '../../types/index.js';
import { ClaimBurstFeedback, StakingDashboard } from './StakingDashboard.js';

interface Props {
  user?: UserProfile | null;
  balances?: UserBalance[];
  onOpenAuthModal?: () => void;
  onRefreshBalances?: () => void;
  displayCurrency?: 'IDR' | 'USD' | 'USDT';
}

function formatUnitsClient(unitsStr: string, decimals: number): string {
  try {
    const raw = BigInt(unitsStr || '0');
    if (raw === 0n) return '0';
    const str = raw.toString().padStart(decimals + 1, '0');
    if (decimals === 0) return str;
    const intPart = str.slice(0, -decimals) || '0';
    const fracPart = str.slice(-decimals).replace(/0+$/, '');
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fracPart ? `${intFormatted}.${fracPart}` : intFormatted;
  } catch {
    return '0';
  }
}

function formatUnitsInput(unitsStr: string, decimals: number): string {
  try {
    const raw = BigInt(unitsStr || '0');
    if (raw === 0n) return '0';
    const str = raw.toString().padStart(decimals + 1, '0');
    if (decimals === 0) return str;
    const intPart = str.slice(0, -decimals) || '0';
    const fracPart = str.slice(-decimals).replace(/0+$/, '');
    return fracPart ? `${intPart}.${fracPart}` : intPart;
  } catch {
    return '0';
  }
}

function formatUsdOrIdr(usd: number, idr: number, currency: 'IDR' | 'USD' | 'USDT'): string {
  if (currency === 'IDR') {
    return `Rp ${Math.round(idr || 0).toLocaleString('id-ID')}`;
  }
  return `$${(usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const EarnView: React.FC<Props> = ({
  user = null,
  balances = [],
  onOpenAuthModal,
  onRefreshBalances,
  displayCurrency = 'USD',
}) => {
  const { showToast } = useToast();

  const [mainTab, setMainTab] = useState<'DASHBOARD' | 'VAULTS' | 'POSITIONS' | 'HISTORY'>('DASHBOARD');
  const [vaultFilter, setVaultFilter] = useState<'ALL' | 'FLEXIBLE' | 'FIXED' | 'STAKING' | 'LAUNCHPOOL'>('ALL');
  const [positionFilter, setPositionFilter] = useState<'ACTIVE' | 'REDEEMED' | 'ALL'>('ACTIVE');
  const [searchQuery, setSearchQuery] = useState('');

  const [vaults, setVaults] = useState<EarnVaultItem[]>([]);
  const [platformStats, setPlatformStats] = useState<EarnSummaryResponse['platformStats'] | null>(null);
  const [summary, setSummary] = useState<EarnSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Subscribe Modal State & Animation Stages
  const [selectedVault, setSelectedVault] = useState<EarnVaultItem | null>(null);
  const [stakeAmount, setStakeAmount] = useState('');
  const [autoCompound, setAutoCompound] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stakeStage, setStakeStage] = useState<'FORM' | 'PROCESSING' | 'SUCCESS'>('FORM');
  const [stakeSuccessInfo, setStakeSuccessInfo] = useState<{
    vaultName: string;
    asset: string;
    amount: string;
    apyPct: number;
    autoCompound: boolean;
    positionId?: string;
  } | null>(null);

  // Redeem Modal State & Animation Stages
  const [redeemTarget, setRedeemTarget] = useState<EarnPositionItem | null>(null);
  const [redeemAmount, setRedeemAmount] = useState('');
  const [confirmEarlyRedeem, setConfirmEarlyRedeem] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemStage, setRedeemStage] = useState<'FORM' | 'PROCESSING' | 'SUCCESS'>('FORM');
  const [redeemSuccessInfo, setRedeemSuccessInfo] = useState<{
    vaultName: string;
    asset: string;
    returnedDisplay: string;
    earlyRedemption: boolean;
    penaltyBps: number;
  } | null>(null);

  // Per-row Action Busy State & Visual Feedback Animations
  const [busyPositionId, setBusyPositionId] = useState<string | null>(null);
  const [claimedBurst, setClaimedBurst] = useState<ClaimBurstFeedback | null>(null);
  const [highlightedPositionId, setHighlightedPositionId] = useState<string | null>(null);
  const [claimKpiPulse, setClaimKpiPulse] = useState<number>(0);

  const timersRef = useRef<number[]>([]);
  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
  }, []);

  const fetchEarnData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setLoadError(null);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      if (user && token) {
        const res = await fetch('/api/earn/summary', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data: EarnSummaryResponse = await res.json();
          setSummary(data);
          setVaults(data.vaults || []);
          setPlatformStats(data.platformStats || null);
          return;
        }
      }

      const pubRes = await fetch('/api/earn/vaults');
      if (!pubRes.ok) {
        const errData = await pubRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Gagal memuat katalog Vault Earn');
      }
      const pubData = await pubRes.json();
      setVaults(pubData.vaults || []);
      setPlatformStats(pubData.platformStats || null);
      if (!user) setSummary(null);
    } catch (err: any) {
      setLoadError(err?.message || 'Gagal memuat data Earn & Staking');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchEarnData();
    const timer = setInterval(() => {
      fetchEarnData(true);
    }, 20_000);
    return () => clearInterval(timer);
  }, [fetchEarnData]);

  const getAvailableSpotDisplay = useCallback(
    (asset: string, decimals: number): { units: string; display: string } => {
      const fromSummary = summary?.walletBalances?.[asset];
      if (fromSummary) {
        return { units: fromSummary.availableUnits, display: fromSummary.availableDisplay };
      }
      const fromProp = balances.find(b => b.currency.toUpperCase() === asset.toUpperCase());
      if (fromProp) {
        return {
          units: fromProp.balanceAvailable || '0',
          display: formatUnitsClient(fromProp.balanceAvailable || '0', decimals),
        };
      }
      return { units: '0', display: '0' };
    },
    [summary, balances]
  );

  const filteredVaults = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    return vaults.filter(v => {
      const matchType = vaultFilter === 'ALL' || v.type === vaultFilter;
      const matchSearch =
        !q ||
        v.asset.toUpperCase().includes(q) ||
        v.name.toUpperCase().includes(q) ||
        v.type.includes(q);
      return matchType && matchSearch;
    });
  }, [vaults, vaultFilter, searchQuery]);

  const filteredPositions = useMemo(() => {
    const all = summary?.positions || [];
    if (positionFilter === 'ACTIVE') return all.filter(p => p.status !== 'REDEEMED');
    if (positionFilter === 'REDEEMED') return all.filter(p => p.status === 'REDEEMED');
    return all;
  }, [summary, positionFilter]);

  const openSubscribeModal = (vault: EarnVaultItem) => {
    if (!user) {
      onOpenAuthModal?.();
      showToast('info', 'Masuk Diperlukan', 'Silakan masuk ke akun Anda untuk melakukan stake pada Vault.');
      return;
    }
    setSelectedVault(vault);
    setStakeStage('FORM');
    setStakeSuccessInfo(null);
    setStakeAmount(formatUnitsInput(vault.minStakeUnits, vault.decimals));
    setAutoCompound(vault.autoCompoundSupported);
  };

  const finalizeSubscribeSuccess = useCallback((positionId?: string) => {
    setSelectedVault(null);
    setStakeStage('FORM');
    setStakeSuccessInfo(null);
    setStakeAmount('');
    setMainTab('POSITIONS');
    if (positionId) {
      setHighlightedPositionId(positionId);
      scheduleTimeout(() => {
        setHighlightedPositionId((cur) => (cur === positionId ? null : cur));
      }, 2400);
    }
  }, [scheduleTimeout]);

  const handleSetMaxStake = () => {
    if (!selectedVault) return;
    const avail = getAvailableSpotDisplay(selectedVault.asset, selectedVault.decimals);
    const availBig = BigInt(avail.units || '0');
    const maxTxBig = BigInt(selectedVault.maxStakeUnits || '0');
    const remCapBig = BigInt(selectedVault.remainingCapUnits || '0');

    let best = availBig;
    if (maxTxBig > 0n && maxTxBig < best) best = maxTxBig;
    if (BigInt(selectedVault.totalCapUnits || '0') > 0n && remCapBig < best) best = remCapBig;
    setStakeAmount(formatUnitsInput(best.toString(), selectedVault.decimals));
  };

  const estimatedReturnSummary = useMemo(() => {
    if (!selectedVault) return { daily: '0', term: '0', annualized: '0' };
    const clean = stakeAmount.trim();
    if (!clean || Number(clean) <= 0 || !/^\d+(\.\d+)?$/.test(clean)) {
      return { daily: '0', term: '0', annualized: '0' };
    }
    try {
      const [intPart, frac = ''] = clean.split('.');
      const paddedFrac = frac.slice(0, selectedVault.decimals).padEnd(selectedVault.decimals, '0');
      const amtUnits = BigInt(intPart + paddedFrac);
      const apyBig = BigInt(selectedVault.apyBps);
      const dailyUnits = (amtUnits * apyBig) / 3650000n;
      const annualUnits = (amtUnits * apyBig) / 10000n;
      const termDays = selectedVault.durationDays > 0 ? BigInt(selectedVault.durationDays) : 30n;
      const termUnits = (amtUnits * apyBig * termDays) / 3650000n;
      return {
        daily: formatUnitsClient(dailyUnits.toString(), selectedVault.decimals),
        term: formatUnitsClient(termUnits.toString(), selectedVault.decimals),
        annualized: formatUnitsClient(annualUnits.toString(), selectedVault.decimals),
      };
    } catch {
      return { daily: '0', term: '0', annualized: '0' };
    }
  }, [selectedVault, stakeAmount]);

  const handleSubscribeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVault) return;
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      onOpenAuthModal?.();
      return;
    }
    if (!stakeAmount.trim() || Number(stakeAmount) <= 0) {
      showToast('error', 'Nominal Tidak Valid', 'Masukkan jumlah stake yang valid.');
      return;
    }

    const activeVault = selectedVault;
    const submittedAmount = stakeAmount.trim();
    const effectiveAutoCompound = activeVault.autoCompoundSupported ? autoCompound : false;

    setIsSubmitting(true);
    setStakeStage('PROCESSING');
    try {
      const idempotencyKey = `web-${activeVault.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const [res] = await Promise.all([
        fetch('/api/earn/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            vaultId: activeVault.id,
            amount: submittedAmount,
            autoCompound: effectiveAutoCompound,
            idempotencyKey,
          }),
        }),
        new Promise((resolve) => setTimeout(resolve, 420)),
      ]);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal melakukan stake');
      }
      if (data.summary) {
        setSummary(data.summary);
        setVaults(data.summary.vaults || []);
        setPlatformStats(data.summary.platformStats || null);
      } else {
        await fetchEarnData(true);
      }
      onRefreshBalances?.();
      showToast(
        'success',
        'Stake Berhasil Ditempatkan',
        `${submittedAmount} ${activeVault.asset} dikunci ke ${activeVault.name} (${activeVault.apyPct.toFixed(2)}% APY).`
      );
      const createdPositionId: string | undefined = data.position?.id;
      setStakeSuccessInfo({
        vaultName: activeVault.name,
        asset: activeVault.asset,
        amount: submittedAmount,
        apyPct: activeVault.apyPct,
        autoCompound: effectiveAutoCompound,
        positionId: createdPositionId,
      });
      setStakeStage('SUCCESS');
      scheduleTimeout(() => {
        finalizeSubscribeSuccess(createdPositionId);
      }, 1500);
    } catch (err: any) {
      setStakeStage('FORM');
      showToast('error', 'Gagal Stake Vault', err?.message || 'Terjadi kesalahan saat subscription.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClaimYield = async (pos: EarnPositionItem) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    setBusyPositionId(pos.id);
    try {
      const res = await fetch(`/api/earn/positions/${encodeURIComponent(pos.id)}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal klaim yield');
      if (data.summary) {
        setSummary(data.summary);
        setVaults(data.summary.vaults || []);
        setPlatformStats(data.summary.platformStats || null);
      }
      onRefreshBalances?.();
      const claimedAmt = data.payout?.amountDisplay || pos.accruedYieldDisplay;
      const burstTs = Date.now();
      setClaimedBurst({
        positionId: pos.id,
        vaultId: pos.vaultId,
        asset: pos.asset,
        amountDisplay: claimedAmt,
        timestamp: burstTs,
      });
      setClaimKpiPulse((n) => n + 1);
      scheduleTimeout(() => {
        setClaimedBurst((cur) => (cur?.timestamp === burstTs ? null : cur));
      }, 2200);
      showToast(
        'success',
        'Imbal Hasil Diklaim',
        `+${claimedAmt} ${pos.asset} dikirim ke Dompet Spot.`
      );
    } catch (err: any) {
      showToast('error', 'Klaim Yield Gagal', err?.message || 'Tidak dapat mengklaim imbal hasil.');
    } finally {
      setBusyPositionId(null);
    }
  };

  const handleToggleAutoCompound = async (pos: EarnPositionItem) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    setBusyPositionId(pos.id);
    try {
      const res = await fetch(`/api/earn/positions/${encodeURIComponent(pos.id)}/auto-compound`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ autoCompound: !pos.autoCompound }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengubah auto-compound');
      if (data.summary) {
        setSummary(data.summary);
      }
      showToast(
        'success',
        'Auto-Compound Diperbarui',
        `${pos.vaultName}: Auto-Compound ${!pos.autoCompound ? 'AKTIF' : 'NONAKTIF'}.`
      );
    } catch (err: any) {
      showToast('error', 'Pembaruan Gagal', err?.message || 'Gagal mengubah mode auto-compound.');
    } finally {
      setBusyPositionId(null);
    }
  };

  const openRedeemModal = (pos: EarnPositionItem) => {
    setRedeemTarget(pos);
    setRedeemStage('FORM');
    setRedeemSuccessInfo(null);
    setRedeemAmount(formatUnitsInput(pos.principalUnits, pos.decimals));
    setConfirmEarlyRedeem(false);
  };

  const finalizeRedeemSuccess = useCallback((positionId?: string) => {
    setRedeemTarget(null);
    setRedeemStage('FORM');
    setRedeemSuccessInfo(null);
    if (positionId) {
      setHighlightedPositionId(positionId);
      scheduleTimeout(() => {
        setHighlightedPositionId((cur) => (cur === positionId ? null : cur));
      }, 2000);
    }
  }, [scheduleTimeout]);

  const handleRedeemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!redeemTarget) return;
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    const isEarly = !redeemTarget.isMatured && redeemTarget.durationDays > 0;
    if (isEarly && !confirmEarlyRedeem) {
      showToast('error', 'Konfirmasi Diperlukan', 'Centang persetujuan ketentuan pencairan dini terlebih dahulu.');
      return;
    }

    const activePos = redeemTarget;
    setIsRedeeming(true);
    setRedeemStage('PROCESSING');
    try {
      const bodyPayload: Record<string, any> = {
        confirmEarlyRedeem: isEarly ? confirmEarlyRedeem : true,
      };
      if (activePos.durationDays === 0 && redeemAmount.trim()) {
        bodyPayload.amount = redeemAmount.trim();
      }

      const [res] = await Promise.all([
        fetch(`/api/earn/positions/${encodeURIComponent(activePos.id)}/redeem`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(bodyPayload),
        }),
        new Promise((resolve) => setTimeout(resolve, 420)),
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mencairkan posisi Earn');

      if (data.summary) {
        setSummary(data.summary);
        setVaults(data.summary.vaults || []);
        setPlatformStats(data.summary.platformStats || null);
      } else {
        await fetchEarnData(true);
      }
      onRefreshBalances?.();

      const returnedDisplay = formatUnitsClient(data.returnedPrincipalUnits || '0', activePos.decimals);
      showToast(
        'success',
        data.earlyRedemption ? 'Pencairan Dini Selesai' : 'Redemption Selesai',
        `${returnedDisplay} ${activePos.asset} telah dikembalikan ke Dompet Spot.`
      );
      setRedeemSuccessInfo({
        vaultName: activePos.vaultName,
        asset: activePos.asset,
        returnedDisplay,
        earlyRedemption: Boolean(data.earlyRedemption),
        penaltyBps: activePos.earlyRedeemPenaltyBps,
      });
      setRedeemStage('SUCCESS');
      scheduleTimeout(() => {
        finalizeRedeemSuccess(activePos.id);
      }, 1500);
    } catch (err: any) {
      setRedeemStage('FORM');
      showToast('error', 'Redemption Gagal', err?.message || 'Tidak dapat mencairkan dana dari vault.');
    } finally {
      setIsRedeeming(false);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto">
      <div className="max-w-7xl w-full mx-auto space-y-6">
        <PageHeader
          title="Institutional Earn & Staking Vaults"
          subtitle="Real double-entry custody pools with UTC 00:00 daily yield settlement and verifiable ledger accounting."
          badge={<StatusBadge tone="brand">DIMONEX Custody</StatusBadge>}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 text-xs text-[#A1AFB8] bg-[#141C24] border border-[#202B34] rounded-[7px] px-3 py-1.5 whitespace-nowrap">
                <ShieldCheck className="w-3.5 h-3.5 text-[#16A879] shrink-0" />
                <span>Segregated Custody Ledger</span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fetchEarnData(false)}
                disabled={isLoading}
                icon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}
              >
                Refresh
              </Button>
            </div>
          }
        />

        {/* Platform & User KPI Metrics Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[#71818B] font-mono">
              <span>Platform Live TVL</span>
              <Coins className="w-3.5 h-3.5 text-[#8DA5B1]" />
            </div>
            <div className="mt-1.5 text-xl font-mono tabular-nums font-semibold text-[#E4EBEF]">
              {platformStats
                ? formatUsdOrIdr(platformStats.totalValueLockedUsd, platformStats.totalValueLockedIdr, displayCurrency)
                : '—'}
            </div>
            <div className="mt-1 text-[11px] text-[#71818B] font-mono tabular-nums">
              {platformStats ? `${platformStats.activeVaults} active vaults · ${platformStats.totalStakersCount} active stakers` : 'Loading live custody metrics'}
            </div>
          </div>

          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[#71818B] font-mono">
              <span>My Staked Principal</span>
              <PiggyBank className="w-3.5 h-3.5 text-[#16A879]" />
            </div>
            <div className="mt-1.5 text-xl font-mono tabular-nums font-semibold text-[#E4EBEF]">
              {user && summary
                ? formatUsdOrIdr(summary.portfolio.totalStakedUsd, summary.portfolio.totalStakedIdr, displayCurrency)
                : user
                  ? '—'
                  : 'Sign In'}
            </div>
            <div className="mt-1 text-[11px] text-[#71818B] font-mono tabular-nums">
              {user && summary
                ? `${summary.portfolio.activePositionsCount} active positions`
                : 'Authenticate to view portfolio'}
            </div>
          </div>

          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[#71818B] font-mono">
              <span>Weighted Avg APY</span>
              <TrendingUp className="w-3.5 h-3.5 text-[#16A879]" />
            </div>
            <div className="mt-1.5 text-xl font-mono tabular-nums font-semibold text-[#16A879]">
              {user && summary ? `${summary.portfolio.weightedAvgApyPct.toFixed(2)}%` : '0.00%'}
            </div>
            <div className="mt-1 text-[11px] text-[#71818B] font-mono">
              UTC 00:00 daily accrual cycle
            </div>
          </div>

          <motion.div
            key={`kpi-claim-${claimKpiPulse}`}
            initial={claimKpiPulse > 0 ? { scale: 0.985, borderColor: 'rgba(53, 184, 135, 0.7)' } : false}
            animate={{ scale: 1, borderColor: '#202B34' }}
            transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4"
          >
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[#71818B] font-mono">
              <span>Claimable Settled Yield</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-[#35B887]" />
            </div>
            <div className="mt-1.5 text-xl font-mono tabular-nums font-semibold text-[#35B887]">
              {user && summary
                ? `$${summary.portfolio.totalClaimableUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                : '$0.00'}
            </div>
            <div className="mt-1 text-[11px] text-[#71818B] font-mono tabular-nums">
              Lifetime earned: ${user && summary ? summary.portfolio.totalYieldEarnedUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '0.00'}
            </div>
          </motion.div>
        </div>

        {/* Navigation Tabs & Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="overflow-x-auto pb-1">
            <SegmentedTabs
              activeTab={mainTab}
              onChange={(tab) => setMainTab(tab as 'DASHBOARD' | 'VAULTS' | 'POSITIONS' | 'HISTORY')}
              tabs={[
                { id: 'DASHBOARD', label: 'Staking Dashboard' },
                { id: 'VAULTS', label: `All Vaults (${vaults.length})` },
                { id: 'POSITIONS', label: `My Positions (${summary?.positions.filter(p => p.status !== 'REDEEMED').length || 0})` },
                { id: 'HISTORY', label: `Yield History (${summary?.payouts.length || 0})` },
              ]}
            />
          </div>

          {mainTab === 'VAULTS' && (
            <div className="w-full md:w-64">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search asset or vault..."
                className="h-9 text-xs"
              />
            </div>
          )}
        </div>

        {loadError && (
          <div className="rounded-[10px] bg-[#401F27]/60 border border-[#EA5B65]/40 p-4 flex items-center justify-between gap-3 text-xs text-[#E4EBEF]">
            <span>{loadError}</span>
            <Button variant="secondary" size="sm" onClick={() => fetchEarnData(false)}>
              Retry
            </Button>
          </div>
        )}

        {/* TAB 0: REAL-TIME STAKING DASHBOARD */}
        {mainTab === 'DASHBOARD' && (
          <StakingDashboard
            user={user}
            balances={balances}
            displayCurrency={displayCurrency}
            externalSummary={summary}
            externalVaults={vaults}
            busyPositionId={busyPositionId}
            claimedBurst={claimedBurst}
            onSelectVaultToStake={openSubscribeModal}
            onClaimPosition={handleClaimYield}
            onNavigateTab={setMainTab}
            onOpenAuthModal={onOpenAuthModal}
          />
        )}

        {/* TAB 1: VAULTS CATALOG */}
        {mainTab === 'VAULTS' && (
          <div className="space-y-4">
            <div className="overflow-x-auto pb-1">
              <SegmentedTabs
                activeTab={vaultFilter}
                onChange={(tab) => setVaultFilter(tab as typeof vaultFilter)}
                tabs={[
                  { id: 'ALL', label: 'All Vaults' },
                  { id: 'FLEXIBLE', label: 'Flexible Savings' },
                  { id: 'FIXED', label: 'Fixed Term' },
                  { id: 'STAKING', label: 'PoS Staking' },
                  { id: 'LAUNCHPOOL', label: 'Launchpool' },
                ]}
              />
            </div>

            {isLoading && vaults.length === 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(idx => (
                  <div key={idx} className="h-64 rounded-[10px] bg-[#141C24] border border-[#202B34] animate-pulse p-5" />
                ))}
              </div>
            ) : filteredVaults.length === 0 ? (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-10 text-center space-y-2">
                <p className="text-sm font-semibold text-[#E4EBEF]">No matching vaults found</p>
                <p className="text-xs text-[#71818B]">Adjust your product category filter or asset search query.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredVaults.map(vault => {
                  const spotAvail = getAvailableSpotDisplay(vault.asset, vault.decimals);
                  const capPct = Math.min(100, Math.round(vault.utilizationBps / 100));
                  const isPaused = vault.status !== 'ACTIVE';
                  return (
                    <div
                      key={vault.id}
                      className="rounded-[10px] bg-[#141C24] border border-[#202B34] hover:border-[#40515D] p-5 flex flex-col justify-between transition-colors"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <AssetIcon symbol={vault.asset} logoUrl={vault.assetLogoUrl} size="md" />
                            <div className="min-w-0">
                              <span className="font-semibold text-xs text-[#E4EBEF] block truncate">{vault.name}</span>
                              <span className="text-[11px] text-[#71818B] font-mono">
                                {vault.type} · {vault.durationDays === 0 ? 'Flexible' : `${vault.durationDays} Days`}
                              </span>
                            </div>
                          </div>
                          {isPaused ? (
                            <StatusBadge tone="warning">PAUSED</StatusBadge>
                          ) : vault.isFeatured ? (
                            <StatusBadge tone="brand">FEATURED</StatusBadge>
                          ) : null}
                        </div>

                        <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] my-3 flex items-baseline justify-between">
                          <div>
                            <span className="text-[10px] uppercase tracking-wider text-[#71818B] block">Annual APY</span>
                            <span className="text-2xl font-mono tabular-nums font-semibold text-[#16A879]">
                              {vault.apyPct.toFixed(2)}%
                            </span>
                          </div>
                          <div className="text-right font-mono tabular-nums">
                            <span className="text-[10px] uppercase tracking-wider text-[#71818B] block">Stakers</span>
                            <span className="text-xs font-semibold text-[#E4EBEF]">{vault.activeStakersCount}</span>
                          </div>
                        </div>

                        <div className="space-y-1.5 text-xs mb-3">
                          <div className="flex justify-between">
                            <span className="text-[#71818B]">Min Stake</span>
                            <span className="text-[#E4EBEF] font-mono tabular-nums">
                              {formatUnitsClient(vault.minStakeUnits, vault.decimals)} {vault.asset}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#71818B]">Live Vault TVL</span>
                            <span className="text-[#E4EBEF] font-mono tabular-nums">
                              {vault.totalStakedDisplay} {vault.asset}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#71818B]">TVL Value</span>
                            <span className="text-[#A1AFB8] font-mono tabular-nums">
                              {formatUsdOrIdr(vault.totalStakedUsd, vault.totalStakedIdr, displayCurrency)}
                            </span>
                          </div>
                          {user && (
                            <div className="flex justify-between">
                              <span className="text-[#71818B]">Spot Avail</span>
                              <span className="text-[#35B887] font-mono tabular-nums">
                                {spotAvail.display} {vault.asset}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Capacity bar */}
                        <div className="mb-4 space-y-1">
                          <div className="flex justify-between text-[10px] font-mono text-[#71818B] tabular-nums">
                            <span>Pool Utilization</span>
                            <span>{capPct}% / Cap {formatUnitsClient(vault.totalCapUnits, vault.decimals)} {vault.asset}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-[#111820] overflow-hidden border border-[#202B34]">
                            <div
                              className="h-full bg-[#16A879] transition-all"
                              style={{ width: `${Math.max(capPct, vault.totalStakedUnits !== '0' ? 2 : 0)}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <Button
                        variant={isPaused ? 'secondary' : 'profit'}
                        size="md"
                        className="w-full"
                        disabled={isPaused}
                        onClick={() => openSubscribeModal(vault)}
                      >
                        {isPaused ? 'Pool Paused' : user ? `Stake ${vault.asset}` : `Sign In to Stake`}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: MY POSITIONS */}
        {mainTab === 'POSITIONS' && (
          <div className="space-y-4">
            {!user ? (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-10 text-center space-y-3">
                <Lock className="w-6 h-6 text-[#8DA5B1] mx-auto" />
                <p className="text-sm font-semibold text-[#E4EBEF]">Authentication Required</p>
                <p className="text-xs text-[#A1AFB8] max-w-md mx-auto">
                  Sign in to view your staked principal positions, manage Auto-Compound, claim settled daily yield, or redeem funds.
                </p>
                <Button variant="primary" size="md" onClick={() => onOpenAuthModal?.()}>
                  Sign In
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SegmentedTabs
                    activeTab={positionFilter}
                    onChange={(tab) => setPositionFilter(tab as typeof positionFilter)}
                    tabs={[
                      { id: 'ACTIVE', label: 'Active & Matured' },
                      { id: 'REDEEMED', label: 'Redeemed' },
                      { id: 'ALL', label: 'All Positions' },
                    ]}
                  />
                  <span className="text-xs text-[#71818B] font-mono">
                    Daily yield settles at 00:00 UTC directly from Treasury Reserve
                  </span>
                </div>

                {filteredPositions.length === 0 ? (
                  <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-10 text-center space-y-3">
                    <PiggyBank className="w-6 h-6 text-[#71818B] mx-auto" />
                    <p className="text-sm font-semibold text-[#E4EBEF]">No staking positions in this view</p>
                    <p className="text-xs text-[#A1AFB8]">Allocate idle Spot balances into any active Vault to begin earning UTC daily yield.</p>
                    <Button variant="secondary" size="sm" onClick={() => setMainTab('VAULTS')}>
                      Explore Earn Vaults
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <AnimatePresence initial={false}>
                      {filteredPositions.map(pos => {
                        const isBusy = busyPositionId === pos.id;
                        const isRedeemed = pos.status === 'REDEEMED';
                        const isHighlighted = highlightedPositionId === pos.id;
                        const isClaimBurst = claimedBurst?.positionId === pos.id;

                        return (
                          <motion.div
                            key={pos.id}
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{
                              opacity: 1,
                              y: 0,
                              borderColor:
                                isHighlighted || isClaimBurst
                                  ? 'rgba(22, 168, 121, 0.72)'
                                  : '#202B34',
                              backgroundColor:
                                isHighlighted || isClaimBurst
                                  ? 'rgba(22, 168, 121, 0.06)'
                                  : '#141C24',
                            }}
                            exit={{ opacity: 0, y: -8, scale: 0.985 }}
                            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                            className="relative rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <AssetIcon symbol={pos.asset} size="md" />
                              <div className="space-y-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold text-[#E4EBEF]">{pos.vaultName}</span>
                                  <StatusBadge
                                    tone={
                                      pos.status === 'ACTIVE'
                                        ? 'success'
                                        : pos.status === 'MATURED'
                                          ? 'info'
                                          : 'neutral'
                                    }
                                  >
                                    {pos.status}
                                  </StatusBadge>
                                  <span className="text-xs font-mono text-[#16A879] font-semibold">
                                    {pos.apyPct.toFixed(2)}% APY
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-[#71818B]">
                                  <span>ID: {pos.id}</span>
                                  <span>·</span>
                                  <span className="inline-flex items-center gap-1">
                                    <CalendarClock className="w-3 h-3" />
                                    {pos.durationDays === 0
                                      ? 'Flexible Term'
                                      : pos.maturesAt
                                        ? `Matures ${new Date(pos.maturesAt).toLocaleDateString('id-ID')}`
                                        : `${pos.durationDays} Days`}
                                  </span>
                                  <span>·</span>
                                  <span>Started {new Date(pos.startedAt).toLocaleDateString('id-ID')}</span>
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 lg:gap-6 font-mono tabular-nums text-xs">
                              <div>
                                <span className="text-[10px] uppercase text-[#71818B] block">Staked Principal</span>
                                <span className="font-semibold text-[#E4EBEF]">
                                  {pos.principalDisplay} {pos.asset}
                                </span>
                                <span className="text-[10px] text-[#71818B] block">
                                  {formatUsdOrIdr(pos.principalUsd, pos.principalIdr, displayCurrency)}
                                </span>
                              </div>

                              <div>
                                <span className="text-[10px] uppercase text-[#71818B] block">Est. Daily Yield</span>
                                <span className="text-[#A1AFB8]">
                                  +{pos.dailyEstimatedYieldDisplay} {pos.asset}
                                </span>
                                {!isRedeemed && BigInt(pos.liveAccruingYieldUnits || '0') > 0n && (
                                  <span className="text-[10px] text-[#71818B] block">
                                    Accruing: +{pos.liveAccruingYieldDisplay}
                                  </span>
                                )}
                              </div>

                              <div className="relative">
                                <span className="text-[10px] uppercase text-[#71818B] block">Claimable Yield</span>
                                <span className="font-semibold text-[#16A879]">
                                  {pos.accruedYieldDisplay} {pos.asset}
                                </span>
                                <span className="text-[10px] text-[#71818B] block">
                                  Claimed: {pos.claimedYieldDisplay}
                                </span>
                                <AnimatePresence>
                                  {isClaimBurst && claimedBurst && (
                                    <motion.div
                                      key={claimedBurst.timestamp}
                                      initial={{ opacity: 0, y: 6, scale: 0.92 }}
                                      animate={{ opacity: 1, y: -6, scale: 1 }}
                                      exit={{ opacity: 0, y: -16 }}
                                      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                                      className="mt-0.5 inline-flex items-center gap-1 rounded-[5px] bg-[#12392F] border border-[#16A879]/50 px-1.5 py-0.5 text-[10px] font-semibold text-[#35B887]"
                                    >
                                      <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />
                                      +{claimedBurst.amountDisplay} {claimedBurst.asset} Claimed
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>

                              <div className="flex flex-wrap items-center justify-end gap-2 col-span-2 sm:col-span-1">
                                {!isRedeemed && pos.autoCompoundSupported && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={isBusy}
                                    onClick={() => handleToggleAutoCompound(pos)}
                                    title="Toggle daily auto-compounding into principal"
                                  >
                                    Compound: {pos.autoCompound ? 'ON' : 'OFF'}
                                  </Button>
                                )}
                                {!isRedeemed && (
                                  <Button
                                    variant="profit"
                                    size="sm"
                                    disabled={isBusy || !pos.canClaim}
                                    onClick={() => handleClaimYield(pos)}
                                    icon={
                                      isBusy ? (
                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                      ) : undefined
                                    }
                                  >
                                    {isBusy ? 'Claiming...' : 'Claim'}
                                  </Button>
                                )}
                                {!isRedeemed && pos.canRedeem && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={isBusy}
                                    onClick={() => openRedeemModal(pos)}
                                  >
                                    Redeem
                                  </Button>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 3: YIELD HISTORY */}
        {mainTab === 'HISTORY' && (
          <div className="space-y-4">
            {!user ? (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-10 text-center space-y-3">
                <History className="w-6 h-6 text-[#8DA5B1] mx-auto" />
                <p className="text-sm font-semibold text-[#E4EBEF]">Sign In to View Yield Payout Ledger</p>
                <Button variant="primary" size="md" onClick={() => onOpenAuthModal?.()}>
                  Sign In
                </Button>
              </div>
            ) : !summary || summary.payouts.length === 0 ? (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-10 text-center space-y-2">
                <History className="w-6 h-6 text-[#71818B] mx-auto" />
                <p className="text-sm font-semibold text-[#E4EBEF]">No yield payouts recorded yet</p>
                <p className="text-xs text-[#71818B]">
                  Daily UTC settlements, auto-compounds, and manual yield claims appear here with verifiable ledger journal IDs.
                </p>
              </div>
            ) : (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono tabular-nums">
                    <thead className="bg-[#17212B] text-[11px] text-[#A1AFB8] border-b border-[#202B34] font-sans">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Timestamp (UTC/Local)</th>
                        <th className="px-4 py-3 font-semibold">Asset</th>
                        <th className="px-4 py-3 font-semibold">Event Type</th>
                        <th className="px-4 py-3 font-semibold">Yield Amount</th>
                        <th className="px-4 py-3 font-semibold">APY</th>
                        <th className="px-4 py-3 font-semibold">Ledger Journal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#202B34]">
                      {summary.payouts.map((row: EarnPayoutItem) => (
                        <tr key={row.id} className="hover:bg-[#17212B]/60 transition-colors">
                          <td className="px-4 py-3 text-[#A1AFB8]">
                            {new Date(row.createdAt).toLocaleString('id-ID')}
                          </td>
                          <td className="px-4 py-3 font-semibold text-[#E4EBEF]">{row.asset}</td>
                          <td className="px-4 py-3 font-sans">
                            <StatusBadge
                              tone={
                                row.payoutType === 'AUTO_COMPOUND'
                                  ? 'info'
                                  : row.payoutType === 'MANUAL_CLAIM' || row.payoutType === 'REDEMPTION_SETTLEMENT'
                                    ? 'success'
                                    : 'brand'
                              }
                            >
                              {row.payoutType}
                            </StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-[#16A879] font-semibold">
                            +{row.amountDisplay} {row.asset}
                          </td>
                          <td className="px-4 py-3 text-[#E4EBEF]">{row.apyPct.toFixed(2)}%</td>
                          <td className="px-4 py-3 text-[#71818B] truncate max-w-[180px]" title={row.journalId}>
                            {row.journalId}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Subscribe Vault Modal */}
      <Modal
        isOpen={Boolean(selectedVault)}
        preventClose={stakeStage === 'PROCESSING'}
        onClose={() => {
          if (stakeStage === 'PROCESSING') return;
          if (stakeStage === 'SUCCESS') {
            finalizeSubscribeSuccess(stakeSuccessInfo?.positionId);
            return;
          }
          setSelectedVault(null);
        }}
        title={
          stakeStage === 'SUCCESS'
            ? 'Stake Confirmed on Ledger'
            : selectedVault
              ? `Subscribe: ${selectedVault.name}`
              : 'Subscribe Vault'
        }
        subtitle={
          stakeStage === 'SUCCESS' && stakeSuccessInfo
            ? `${stakeSuccessInfo.amount} ${stakeSuccessInfo.asset} allocated to Earn Custody`
            : selectedVault
              ? `${selectedVault.apyPct.toFixed(2)}% APY · ${selectedVault.durationDays === 0 ? 'Flexible Term' : `${selectedVault.durationDays}-Day Lockup`}`
              : ''
        }
      >
        {selectedVault && (
          <AnimatePresence mode="wait">
            {stakeStage === 'FORM' && (
              <motion.form
                key="stake-form"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                onSubmit={handleSubscribeSubmit}
                className="space-y-4"
              >
                <div className="flex items-center justify-between text-xs p-3 rounded-[8px] bg-[#111820] border border-[#202B34]">
                  <span className="text-[#A1AFB8]">Available Spot Balance</span>
                  <span className="font-mono tabular-nums font-semibold text-[#E4EBEF]">
                    {getAvailableSpotDisplay(selectedVault.asset, selectedVault.decimals).display} {selectedVault.asset}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-[#A1AFB8]">
                      Subscription Amount ({selectedVault.asset})
                    </label>
                    <button
                      type="button"
                      onClick={handleSetMaxStake}
                      className="text-[11px] font-mono font-semibold text-[#16A879] hover:text-[#35B887] cursor-pointer"
                    >
                      MAX AVAILABLE
                    </button>
                  </div>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    placeholder={`Min ${formatUnitsClient(selectedVault.minStakeUnits, selectedVault.decimals)}`}
                    className="font-mono"
                    required
                  />
                  <div className="flex justify-between text-[11px] text-[#71818B] font-mono tabular-nums">
                    <span>Min: {formatUnitsClient(selectedVault.minStakeUnits, selectedVault.decimals)} {selectedVault.asset}</span>
                    {BigInt(selectedVault.maxStakeUnits || '0') > 0n && (
                      <span>Max/Tx: {formatUnitsClient(selectedVault.maxStakeUnits, selectedVault.decimals)} {selectedVault.asset}</span>
                    )}
                  </div>
                </div>

                {selectedVault.autoCompoundSupported && (
                  <label className="flex items-center justify-between p-3 rounded-[8px] bg-[#111820] border border-[#202B34] cursor-pointer">
                    <div>
                      <span className="text-xs font-semibold text-[#E4EBEF] block">Auto-Compound Daily Yield</span>
                      <span className="text-[11px] text-[#71818B]">
                        Automatically reinvest 00:00 UTC daily interest back into staked principal
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={autoCompound}
                      onChange={(e) => setAutoCompound(e.target.checked)}
                      className="w-4 h-4 accent-[#16A879]"
                    />
                  </label>
                )}

                <div className="rounded-[8px] bg-[#111820] border border-[#202B34] p-3 space-y-2 text-xs font-mono tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">Estimated Daily Yield</span>
                    <span className="text-[#16A879] font-semibold">
                      +{estimatedReturnSummary.daily} {selectedVault.asset}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">
                      Est. {selectedVault.durationDays > 0 ? `${selectedVault.durationDays}-Day Term` : '30-Day'} Yield
                    </span>
                    <span className="text-[#E4EBEF]">
                      +{estimatedReturnSummary.term} {selectedVault.asset}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-[#202B34]">
                    <span className="text-[#71818B]">Early Exit Rule</span>
                    <span className="text-[#A1AFB8]">
                      {selectedVault.durationDays === 0
                        ? 'Instant · 0% Fee'
                        : selectedVault.earlyRedeemAllowed
                          ? `Allowed · ${(selectedVault.earlyRedeemPenaltyBps / 100).toFixed(2)}% penalty`
                          : 'Locked until maturity'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button variant="secondary" type="button" onClick={() => setSelectedVault(null)}>
                    Cancel
                  </Button>
                  <Button variant="profit" type="submit" disabled={isSubmitting}>
                    Confirm Stake {selectedVault.asset}
                  </Button>
                </div>
              </motion.form>
            )}

            {stakeStage === 'PROCESSING' && (
              <motion.div
                key="stake-processing"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="py-7 px-3 flex flex-col items-center text-center space-y-4"
              >
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
                    className="absolute inset-0 rounded-full border-2 border-[#202B34] border-t-[#16A879]"
                  />
                  <motion.div
                    animate={{ scale: [0.94, 1.05, 0.94] }}
                    transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
                    className="w-11 h-11 rounded-full bg-[#12392F] border border-[#16A879]/40 flex items-center justify-center"
                  >
                    <Lock className="w-5 h-5 text-[#16A879]" />
                  </motion.div>
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#E4EBEF]">Confirming Ledger Lock</p>
                  <p className="text-xs font-mono tabular-nums text-[#A1AFB8]">
                    Securing {stakeAmount.trim()} {selectedVault.asset} into {selectedVault.name}
                  </p>
                </div>

                <div className="w-full max-w-xs h-1.5 rounded-full bg-[#111820] border border-[#202B34] overflow-hidden">
                  <motion.div
                    initial={{ x: '-100%' }}
                    animate={{ x: '100%' }}
                    transition={{ repeat: Infinity, duration: 1.05, ease: 'easeInOut' }}
                    className="h-full w-1/2 rounded-full bg-[#16A879]"
                  />
                </div>
              </motion.div>
            )}

            {stakeStage === 'SUCCESS' && stakeSuccessInfo && (
              <motion.div
                key="stake-success"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                className="py-5 px-2 flex flex-col items-center text-center space-y-4"
              >
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <motion.div
                    initial={{ scale: 0.75, opacity: 0.55 }}
                    animate={{ scale: 1.65, opacity: 0 }}
                    transition={{ duration: 0.9, ease: 'easeOut' }}
                    className="absolute inset-0 rounded-full border border-[#16A879]"
                  />
                  <motion.div
                    initial={{ scale: 0.5, rotate: -12 }}
                    animate={{ scale: [0.5, 1.1, 1], rotate: 0 }}
                    transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
                    className="w-14 h-14 rounded-full bg-[#12392F] border border-[#16A879]/60 flex items-center justify-center"
                  >
                    <ShieldCheck className="w-7 h-7 text-[#35B887]" />
                  </motion.div>
                </div>

                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.2 }}
                  className="space-y-1"
                >
                  <p className="text-base font-semibold text-[#E4EBEF]">Custody Lock Active</p>
                  <p className="text-sm font-mono tabular-nums font-semibold text-[#35B887]">
                    {stakeSuccessInfo.amount} {stakeSuccessInfo.asset} @ {stakeSuccessInfo.apyPct.toFixed(2)}% APY
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.16, duration: 0.2 }}
                  className="w-full rounded-[8px] bg-[#111820] border border-[#202B34] p-3 space-y-1.5 text-xs font-mono tabular-nums"
                >
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">Vault Pool</span>
                    <span className="text-[#E4EBEF]">{stakeSuccessInfo.vaultName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">Auto-Compound</span>
                    <span className={stakeSuccessInfo.autoCompound ? 'text-[#16A879]' : 'text-[#A1AFB8]'}>
                      {stakeSuccessInfo.autoCompound ? 'ENABLED' : 'MANUAL CLAIM'}
                    </span>
                  </div>
                </motion.div>

                <div className="flex items-center justify-end w-full pt-1">
                  <Button
                    variant="profit"
                    size="sm"
                    onClick={() => finalizeSubscribeSuccess(stakeSuccessInfo.positionId)}
                    icon={<ArrowRight className="w-3.5 h-3.5" />}
                  >
                    View Position
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </Modal>

      {/* Redeem Position Modal */}
      <Modal
        isOpen={Boolean(redeemTarget)}
        preventClose={redeemStage === 'PROCESSING'}
        onClose={() => {
          if (redeemStage === 'PROCESSING') return;
          if (redeemStage === 'SUCCESS') {
            finalizeRedeemSuccess(redeemTarget?.id);
            return;
          }
          setRedeemTarget(null);
        }}
        title={
          redeemStage === 'SUCCESS'
            ? redeemSuccessInfo?.earlyRedemption
              ? 'Early Redemption Settled'
              : 'Custody Released to Spot'
            : redeemTarget
              ? `Redeem: ${redeemTarget.vaultName}`
              : 'Redeem Position'
        }
        subtitle={
          redeemStage === 'SUCCESS' && redeemSuccessInfo
            ? `+${redeemSuccessInfo.returnedDisplay} ${redeemSuccessInfo.asset} credited to Spot Wallet`
            : redeemTarget
              ? `Principal: ${redeemTarget.principalDisplay} ${redeemTarget.asset}`
              : ''
        }
      >
        {redeemTarget && (
          <AnimatePresence mode="wait">
            {redeemStage === 'FORM' && (
              <motion.form
                key="redeem-form"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                onSubmit={handleRedeemSubmit}
                className="space-y-4"
              >
                <div className="rounded-[8px] bg-[#111820] border border-[#202B34] p-3 space-y-2 text-xs font-mono tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">Custody Principal</span>
                    <span className="font-semibold text-[#E4EBEF]">
                      {redeemTarget.principalDisplay} {redeemTarget.asset}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">Settled Accrued Yield</span>
                    <span className="text-[#16A879]">
                      +{redeemTarget.accruedYieldDisplay} {redeemTarget.asset}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">Term Status</span>
                    <span className="text-[#A1AFB8]">
                      {redeemTarget.isMatured ? 'Eligible for 0% Penalty Release' : 'Before Maturity Date'}
                    </span>
                  </div>
                </div>

                {redeemTarget.durationDays === 0 ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[#A1AFB8]">
                        Redeem Amount ({redeemTarget.asset})
                      </label>
                      <button
                        type="button"
                        onClick={() => setRedeemAmount(formatUnitsInput(redeemTarget.principalUnits, redeemTarget.decimals))}
                        className="text-[11px] font-mono font-semibold text-[#16A879] cursor-pointer"
                      >
                        REDEEM FULL
                      </button>
                    </div>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={redeemAmount}
                      onChange={(e) => setRedeemAmount(e.target.value)}
                      className="font-mono"
                      required
                    />
                  </div>
                ) : !redeemTarget.isMatured ? (
                  <div className="rounded-[8px] bg-[#2C2415] border border-[#D6A85C]/40 p-3 space-y-2 text-xs text-[#E4EBEF]">
                    <p className="font-semibold text-[#D6A85C]">Early Term Exit Notice</p>
                    <p className="text-[#A1AFB8] leading-relaxed">
                      Position matures on {redeemTarget.maturesAt ? new Date(redeemTarget.maturesAt).toLocaleString('id-ID') : '-'}.
                      Redeeming early deducts a {(redeemTarget.earlyRedeemPenaltyBps / 100).toFixed(2)}% early exit fee on principal and forfeits unclaimed accrued yield.
                    </p>
                    <label className="flex items-center gap-2 pt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmEarlyRedeem}
                        onChange={(e) => setConfirmEarlyRedeem(e.target.checked)}
                        className="w-4 h-4 accent-[#D6A85C]"
                      />
                      <span className="text-xs font-medium">I accept early redemption terms and fee deduction</span>
                    </label>
                  </div>
                ) : null}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button variant="secondary" type="button" onClick={() => setRedeemTarget(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant={!redeemTarget.isMatured && redeemTarget.durationDays > 0 ? 'danger' : 'profit'}
                    type="submit"
                    disabled={isRedeeming}
                    icon={<ArrowDownLeft className="w-3.5 h-3.5" />}
                  >
                    Confirm Redemption
                  </Button>
                </div>
              </motion.form>
            )}

            {redeemStage === 'PROCESSING' && (
              <motion.div
                key="redeem-processing"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="py-7 px-3 flex flex-col items-center text-center space-y-4"
              >
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <motion.div
                    animate={{ rotate: -360 }}
                    transition={{ repeat: Infinity, duration: 1.15, ease: 'linear' }}
                    className={`absolute inset-0 rounded-full border-2 border-[#202B34] ${
                      !redeemTarget.isMatured && redeemTarget.durationDays > 0
                        ? 'border-t-[#D6A85C]'
                        : 'border-t-[#16A879]'
                    }`}
                  />
                  <motion.div
                    animate={{ y: [0, 3, 0] }}
                    transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
                    className={`w-11 h-11 rounded-full flex items-center justify-center border ${
                      !redeemTarget.isMatured && redeemTarget.durationDays > 0
                        ? 'bg-[#2C2415] border-[#D6A85C]/40'
                        : 'bg-[#12392F] border-[#16A879]/40'
                    }`}
                  >
                    <Unlock
                      className={`w-5 h-5 ${
                        !redeemTarget.isMatured && redeemTarget.durationDays > 0
                          ? 'text-[#D6A85C]'
                          : 'text-[#16A879]'
                      }`}
                    />
                  </motion.div>
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#E4EBEF]">Releasing Earn Custody</p>
                  <p className="text-xs font-mono tabular-nums text-[#A1AFB8]">
                    Returning {redeemTarget.asset} principal back to Spot Wallet
                  </p>
                </div>

                <div className="flex items-center gap-2 text-[11px] font-mono text-[#71818B]">
                  <span>Earn Custody</span>
                  <motion.span
                    animate={{ x: [0, 4, 0] }}
                    transition={{ repeat: Infinity, duration: 0.9, ease: 'easeInOut' }}
                  >
                    <ArrowRight className="w-3.5 h-3.5 text-[#16A879]" />
                  </motion.span>
                  <span className="text-[#E4EBEF]">Spot Wallet</span>
                </div>
              </motion.div>
            )}

            {redeemStage === 'SUCCESS' && redeemSuccessInfo && (
              <motion.div
                key="redeem-success"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                className="py-5 px-2 flex flex-col items-center text-center space-y-4"
              >
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <motion.div
                    initial={{ scale: 0.75, opacity: 0.55 }}
                    animate={{ scale: 1.65, opacity: 0 }}
                    transition={{ duration: 0.9, ease: 'easeOut' }}
                    className={`absolute inset-0 rounded-full border ${
                      redeemSuccessInfo.earlyRedemption ? 'border-[#D6A85C]' : 'border-[#16A879]'
                    }`}
                  />
                  <motion.div
                    initial={{ scale: 0.5 }}
                    animate={{ scale: [0.5, 1.1, 1] }}
                    transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
                    className={`w-14 h-14 rounded-full flex items-center justify-center border ${
                      redeemSuccessInfo.earlyRedemption
                        ? 'bg-[#2C2415] border-[#D6A85C]/60'
                        : 'bg-[#12392F] border-[#16A879]/60'
                    }`}
                  >
                    <ArrowDownLeft
                      className={`w-7 h-7 ${
                        redeemSuccessInfo.earlyRedemption ? 'text-[#D6A85C]' : 'text-[#35B887]'
                      }`}
                    />
                  </motion.div>
                </div>

                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.2 }}
                  className="space-y-1"
                >
                  <p className="text-base font-semibold text-[#E4EBEF]">
                    {redeemSuccessInfo.earlyRedemption ? 'Early Exit Completed' : 'Spot Wallet Credited'}
                  </p>
                  <p
                    className={`text-sm font-mono tabular-nums font-semibold ${
                      redeemSuccessInfo.earlyRedemption ? 'text-[#D6A85C]' : 'text-[#35B887]'
                    }`}
                  >
                    +{redeemSuccessInfo.returnedDisplay} {redeemSuccessInfo.asset}
                  </p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.16, duration: 0.2 }}
                  className="w-full rounded-[8px] bg-[#111820] border border-[#202B34] p-3 space-y-1.5 text-xs font-mono tabular-nums"
                >
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">Source Vault</span>
                    <span className="text-[#E4EBEF]">{redeemSuccessInfo.vaultName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">Settlement Type</span>
                    <span className={redeemSuccessInfo.earlyRedemption ? 'text-[#D6A85C]' : 'text-[#16A879]'}>
                      {redeemSuccessInfo.earlyRedemption
                        ? `EARLY EXIT (${(redeemSuccessInfo.penaltyBps / 100).toFixed(2)}% FEE)`
                        : 'STANDARD RELEASE (0% FEE)'}
                    </span>
                  </div>
                </motion.div>

                <div className="flex items-center justify-end w-full pt-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => finalizeRedeemSuccess(redeemTarget.id)}
                  >
                    Done
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </Modal>
    </div>
    </MotionConfig>
  );
};
