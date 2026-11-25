/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/admin/staking/StakingAdminConsole.tsx
 * Dedicated Institutional Staking & Earn Vaults Admin Console.
 * Provides full lifecycle management for vaults, APY rates, caps, staker positions,
 * early lockup waivers, global yield payout ledger, and 1:1 custody solvency reconciliation.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Coins,
  Database,
  Edit3,
  History,
  Layers,
  LockOpen,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { Button } from '../../ui/Button.js';
import { Modal } from '../../ui/Modal.js';
import { StatusBadge } from '../../ui/StatusBadge.js';
import { SegmentedTabs } from '../../ui/Tabs.js';
import { AssetIcon } from '../../ui/AssetIcon.js';
import {
  AdminTreasuryFeeOverview,
  EarnCustodySolvencyReport,
  EarnPayoutItem,
  EarnPayoutType,
  EarnPositionItem,
  EarnVaultItem,
  EarnVaultStatus,
  EarnVaultType,
} from '../../../types/index.js';

interface Props {
  onNotify?: (type: 'success' | 'error', text: string) => void;
  onAuditRefresh?: () => void;
}

interface AdminEarnAsset {
  symbol: string;
  name: string;
  decimals: number;
  network: string;
  logoUrl?: string;
}

interface AdminEarnPayout extends EarnPayoutItem {
  userEmail: string;
  vaultName: string;
}

type ConsoleSubTab = 'VAULTS' | 'POSITIONS' | 'PAYOUTS' | 'SOLVENCY';

function unitsToTokenString(unitsStr: string, decimals: number): string {
  try {
    const raw = BigInt(unitsStr || '0');
    if (raw === 0n) return '0';
    const d = Math.max(0, decimals || 0);
    if (d === 0) return raw.toString();
    const s = raw.toString().padStart(d + 1, '0');
    const intPart = s.slice(0, -d) || '0';
    const fracPart = s.slice(-d).replace(/0+$/, '');
    return fracPart ? `${intPart}.${fracPart}` : intPart;
  } catch {
    return '0';
  }
}

function formatUsd(val: number): string {
  return `$${(val || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatIdr(val: number): string {
  return `Rp ${Math.round(val || 0).toLocaleString('id-ID')}`;
}

export const StakingAdminConsole: React.FC<Props> = ({ onNotify, onAuditRefresh }) => {
  const [subTab, setSubTab] = useState<ConsoleSubTab>('VAULTS');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Core data from backend
  const [vaults, setVaults] = useState<EarnVaultItem[]>([]);
  const [positions, setPositions] = useState<Array<EarnPositionItem & { userEmail?: string }>>([]);
  const [payouts, setPayouts] = useState<AdminEarnPayout[]>([]);
  const [solvency, setSolvency] = useState<EarnCustodySolvencyReport | null>(null);
  const [earnAssets, setEarnAssets] = useState<AdminEarnAsset[]>([]);
  const [treasuryFees, setTreasuryFees] = useState<AdminTreasuryFeeOverview | null>(null);

  // Filters
  const [vaultSearch, setVaultSearch] = useState('');
  const [vaultStatusFilter, setVaultStatusFilter] = useState<'ALL' | EarnVaultStatus>('ALL');
  const [positionSearch, setPositionSearch] = useState('');
  const [positionStatusFilter, setPositionStatusFilter] = useState<'ALL' | 'ACTIVE' | 'MATURED' | 'REDEEMED'>('ALL');
  const [payoutSearch, setPayoutSearch] = useState('');
  const [payoutTypeFilter, setPayoutTypeFilter] = useState<'ALL' | EarnPayoutType>('ALL');

  // Create Vault Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    asset: 'USDT',
    name: '',
    type: 'FLEXIBLE' as EarnVaultType,
    durationDays: '0',
    apyPct: '8.5',
    minStakeTokens: '10',
    maxStakeTokens: '100000',
    totalCapTokens: '1000000',
    earlyRedeemAllowed: true,
    earlyRedeemPenaltyPct: '1.5',
    autoCompoundSupported: true,
    isFeatured: false,
    custodyNote: 'Segregated Institutional Earn Custody',
  });

  // Edit Vault Modal
  const [editingVault, setEditingVault] = useState<EarnVaultItem | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    apyPct: '',
    status: 'ACTIVE' as EarnVaultStatus,
    minStakeTokens: '',
    maxStakeTokens: '',
    totalCapTokens: '',
    earlyRedeemAllowed: true,
    earlyRedeemPenaltyPct: '0',
    autoCompoundSupported: true,
    isFeatured: false,
    custodyNote: '',
  });

  // Unlock Position Modal
  const [unlockTarget, setUnlockTarget] = useState<(EarnPositionItem & { userEmail?: string }) | null>(null);
  const [unlockReason, setUnlockReason] = useState('Operational compliance unlock');

  // Epoch Simulation Confirmation Modal
  const [showEpochModal, setShowEpochModal] = useState(false);

  const notify = useCallback(
    (type: 'success' | 'error', text: string) => {
      if (onNotify) onNotify(type, text);
    },
    [onNotify]
  );

  const loadConsoleData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setLoadError(null);
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      setLoadError('Sesi administrator tidak ditemukan. Silakan masuk ulang.');
      setIsLoading(false);
      return;
    }

    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [poolsRes, posRes, payRes, solvRes, assetsRes, feesRes] = await Promise.all([
        fetch('/api/admin/earn/pools', { headers }),
        fetch('/api/admin/earn/positions?limit=150', { headers }),
        fetch('/api/admin/earn/payouts?limit=150', { headers }),
        fetch('/api/admin/earn/solvency', { headers }),
        fetch('/api/admin/earn/assets', { headers }),
        fetch('/api/admin/treasury-fees', { headers }),
      ]);

      if (!poolsRes.ok) {
        const err = await poolsRes.json().catch(() => ({}));
        throw new Error(err.error || 'Gagal memuat daftar staking vault');
      }

      const poolsData = await poolsRes.json();
      setVaults(Array.isArray(poolsData) ? poolsData : []);

      if (posRes.ok) {
        const posData = await posRes.json();
        setPositions(posData.positions || []);
      }
      if (payRes.ok) {
        const payData = await payRes.json();
        setPayouts(payData.payouts || []);
      }
      if (solvRes.ok) {
        setSolvency(await solvRes.json());
      }
      if (feesRes.ok) {
        setTreasuryFees(await feesRes.json());
      }
      if (assetsRes.ok) {
        const assetsData = await assetsRes.json();
        const list: AdminEarnAsset[] = assetsData.assets || [];
        setEarnAssets(list);
        if (list.length > 0 && !list.some(a => a.symbol === createForm.asset)) {
          setCreateForm(f => ({ ...f, asset: list[0].symbol }));
        }
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Gagal sinkronisasi konsol admin staking');
    } finally {
      setIsLoading(false);
    }
  }, [createForm.asset]);

  const handleSweepFeesToTreasury = async () => {
    setActionBusy(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/treasury-fees/sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyapu fee ke treasury');
      notify('success', data.message || 'Fee berhasil disweep ke Treasury Reserve.');
      if (data.overview) setTreasuryFees(data.overview);
      await loadConsoleData(true);
      onAuditRefresh?.();
    } catch (err: any) {
      notify('error', err.message || 'Gagal melakukan sweep fee');
    } finally {
      setActionBusy(false);
    }
  };

  useEffect(() => {
    loadConsoleData(false);
    const interval = setInterval(() => loadConsoleData(true), 15_000);
    return () => clearInterval(interval);
  }, [loadConsoleData]);

  // Derived KPI metrics strictly from live backend snapshots
  const kpi = useMemo(() => {
    const totalTvlUsd = vaults.reduce((acc, v) => acc + (v.totalStakedUsd || 0), 0);
    const totalTvlIdr = vaults.reduce((acc, v) => acc + (v.totalStakedIdr || 0), 0);
    const activeVaults = vaults.filter(v => v.status === 'ACTIVE').length;
    const pausedVaults = vaults.filter(v => v.status === 'PAUSED').length;
    const activePositions = positions.filter(p => p.status === 'ACTIVE').length;
    const maturedPositions = positions.filter(p => p.status === 'MATURED').length;
    const uniqueStakers = new Set(
      positions.filter(p => p.status !== 'REDEEMED').map(p => p.userId)
    ).size;
    return {
      totalTvlUsd,
      totalTvlIdr,
      activeVaults,
      pausedVaults,
      totalVaults: vaults.length,
      activePositions,
      maturedPositions,
      uniqueStakers,
    };
  }, [vaults, positions]);

  const filteredVaults = useMemo(() => {
    const q = vaultSearch.trim().toLowerCase();
    return vaults.filter(v => {
      if (vaultStatusFilter !== 'ALL' && v.status !== vaultStatusFilter) return false;
      if (!q) return true;
      return (
        v.id.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        v.asset.toLowerCase().includes(q) ||
        v.type.toLowerCase().includes(q)
      );
    });
  }, [vaults, vaultSearch, vaultStatusFilter]);

  const filteredPositions = useMemo(() => {
    const q = positionSearch.trim().toLowerCase();
    return positions.filter(p => {
      if (positionStatusFilter !== 'ALL' && p.status !== positionStatusFilter) return false;
      if (!q) return true;
      return (
        p.id.toLowerCase().includes(q) ||
        (p.userEmail || '').toLowerCase().includes(q) ||
        p.asset.toLowerCase().includes(q) ||
        p.vaultName.toLowerCase().includes(q)
      );
    });
  }, [positions, positionSearch, positionStatusFilter]);

  const filteredPayouts = useMemo(() => {
    const q = payoutSearch.trim().toLowerCase();
    return payouts.filter(row => {
      if (payoutTypeFilter !== 'ALL' && row.payoutType !== payoutTypeFilter) return false;
      if (!q) return true;
      return (
        row.asset.toLowerCase().includes(q) ||
        row.userEmail.toLowerCase().includes(q) ||
        row.vaultName.toLowerCase().includes(q) ||
        row.journalId.toLowerCase().includes(q) ||
        row.positionId.toLowerCase().includes(q)
      );
    });
  }, [payouts, payoutSearch, payoutTypeFilter]);

  // Handlers
  const handleRunYieldSettlement = async (forceCycle: boolean) => {
    setActionBusy(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/earn/settle-yield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ forceCycle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menjalankan distribusi yield');
      notify('success', data.message || 'Distribusi yield selesai dijalankan');
      setShowEpochModal(false);
      await loadConsoleData(true);
      onAuditRefresh?.();
    } catch (err: any) {
      notify('error', err.message || 'Gagal menjalankan distribusi yield');
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleVaultStatus = async (vault: EarnVaultItem) => {
    const nextStatus: EarnVaultStatus = vault.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setActionBusy(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/earn/pools/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ vaultId: vault.id, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengubah status vault');
      notify('success', data.message || `Status vault ${vault.name} diubah ke ${nextStatus}`);
      await loadConsoleData(true);
      onAuditRefresh?.();
    } catch (err: any) {
      notify('error', err.message || 'Gagal mengubah status vault');
    } finally {
      setActionBusy(false);
    }
  };

  const openEditVaultModal = (v: EarnVaultItem) => {
    setEditingVault(v);
    setEditForm({
      name: v.name,
      apyPct: String(v.apyPct),
      status: v.status,
      minStakeTokens: unitsToTokenString(v.minStakeUnits, v.decimals),
      maxStakeTokens: unitsToTokenString(v.maxStakeUnits, v.decimals),
      totalCapTokens: unitsToTokenString(v.totalCapUnits, v.decimals),
      earlyRedeemAllowed: v.earlyRedeemAllowed,
      earlyRedeemPenaltyPct: String(v.earlyRedeemPenaltyBps / 100),
      autoCompoundSupported: v.autoCompoundSupported,
      isFeatured: v.isFeatured,
      custodyNote: v.custodyNote || 'Segregated Institutional Earn Custody',
    });
  };

  const handleSaveEditVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVault) return;
    setActionBusy(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/earn/pools/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          vaultId: editingVault.id,
          name: editForm.name.trim(),
          apyPct: Number(editForm.apyPct),
          status: editForm.status,
          minStakeTokens: editForm.minStakeTokens.trim(),
          maxStakeTokens: editForm.maxStakeTokens.trim(),
          totalCapTokens: editForm.totalCapTokens.trim(),
          earlyRedeemAllowed: editForm.earlyRedeemAllowed,
          earlyRedeemPenaltyPct: Number(editForm.earlyRedeemPenaltyPct),
          autoCompoundSupported: editForm.autoCompoundSupported,
          isFeatured: editForm.isFeatured,
          custodyNote: editForm.custodyNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan konfigurasi vault');
      notify('success', data.message || `Vault ${editingVault.name} berhasil diperbarui.`);
      setEditingVault(null);
      await loadConsoleData(true);
      onAuditRefresh?.();
    } catch (err: any) {
      notify('error', err.message || 'Gagal memperbarui vault');
    } finally {
      setActionBusy(false);
    }
  };

  const handleCreateVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const dur = createForm.type === 'FLEXIBLE' ? 0 : Math.max(1, parseInt(createForm.durationDays, 10) || 30);
      const res = await fetch('/api/admin/earn/pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          asset: createForm.asset,
          name: createForm.name.trim() || `${createForm.asset} ${dur > 0 ? `${dur}D Locked` : 'Flexible'} Vault`,
          type: createForm.type,
          durationDays: dur,
          apyPct: Number(createForm.apyPct),
          minStakeTokens: createForm.minStakeTokens.trim(),
          maxStakeTokens: createForm.maxStakeTokens.trim(),
          totalCapTokens: createForm.totalCapTokens.trim(),
          earlyRedeemAllowed: createForm.earlyRedeemAllowed,
          earlyRedeemPenaltyPct: dur === 0 ? 0 : Number(createForm.earlyRedeemPenaltyPct),
          autoCompoundSupported: createForm.autoCompoundSupported,
          isFeatured: createForm.isFeatured,
          custodyNote: createForm.custodyNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat staking vault');
      notify('success', data.message || 'Staking vault baru berhasil dibuat');
      setShowCreateModal(false);
      setCreateForm(prev => ({ ...prev, name: '' }));
      await loadConsoleData(true);
      onAuditRefresh?.();
    } catch (err: any) {
      notify('error', err.message || 'Gagal membuat staking vault');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmUnlockPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockTarget) return;
    setActionBusy(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch(`/api/admin/earn/positions/${unlockTarget.id}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: unlockReason.trim() || 'Operational compliance unlock' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuka lockup posisi');
      notify('success', data.message || `Lockup posisi ${unlockTarget.id} dibuka tanpa penalti.`);
      setUnlockTarget(null);
      await loadConsoleData(true);
      onAuditRefresh?.();
    } catch (err: any) {
      notify('error', err.message || 'Gagal membuka lockup posisi');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Global Operations Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#202B34]">
        <div>
          <h3 className="text-base font-semibold text-[#E4EBEF] tracking-tight flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#8DA5B1]" />
            <span>Staking & Earn Vaults Admin Console</span>
          </h3>
          <p className="text-xs text-[#71818B] mt-0.5">
            Kelola parameter APY%, kapasitas pool, posisi staker aktif, ledger distribusi imbal hasil, dan rekonsiliasi 1:1 Custody Ledger.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={actionBusy}
            onClick={() => loadConsoleData(false)}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={actionBusy}
            onClick={() => handleRunYieldSettlement(false)}
            icon={<Coins className="w-3.5 h-3.5" />}
          >
            Run UTC Yield Settlement
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={actionBusy}
            onClick={() => setShowEpochModal(true)}
            icon={<Zap className="w-3.5 h-3.5 text-[#D6A85C]" />}
          >
            Simulate Yield Epoch (+1d)
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={actionBusy}
            onClick={() => setShowCreateModal(true)}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            Create Staking Vault
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {loadError && (
        <div className="p-3.5 rounded-[10px] bg-[#401F27]/70 border border-[#EA5B65]/40 text-xs text-[#F16D76] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{loadError}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => loadConsoleData(false)}>
            Coba Lagi
          </Button>
        </div>
      )}

      {/* Top KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-[#71818B] uppercase tracking-wider">
            <span>Total Staked TVL</span>
            <TrendingUp className="w-3.5 h-3.5 text-[#35B887]" />
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#E4EBEF]">
            {formatUsd(kpi.totalTvlUsd)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#71818B]">
            {formatIdr(kpi.totalTvlIdr)} · {kpi.uniqueStakers} Staker Unik
          </div>
        </div>

        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-[#71818B] uppercase tracking-wider">
            <span>Status Staking Vaults</span>
            <Layers className="w-3.5 h-3.5 text-[#8DA5B1]" />
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#E4EBEF]">
            {kpi.activeVaults} Aktif
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#71818B]">
            {kpi.pausedVaults} Paused · {kpi.totalVaults} Total Vault
          </div>
        </div>

        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-[#71818B] uppercase tracking-wider">
            <span>Posisi Staker Terbuka</span>
            <Users className="w-3.5 h-3.5 text-[#6D9FE8]" />
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#E4EBEF]">
            {kpi.activePositions + kpi.maturedPositions} Posisi
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#71818B]">
            {kpi.activePositions} Active · {kpi.maturedPositions} Matured
          </div>
        </div>

        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-[#71818B] uppercase tracking-wider">
            <span>Solvensi Custody Ledger</span>
            {solvency?.isFullySolvent !== false ? (
              <ShieldCheck className="w-3.5 h-3.5 text-[#35B887]" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 text-[#EA5B65]" />
            )}
          </div>
          <div
            className={`text-xl font-bold font-mono tabular-nums ${
              solvency?.isFullySolvent !== false ? 'text-[#35B887]' : 'text-[#EA5B65]'
            }`}
          >
            {solvency ? (solvency.isFullySolvent ? '100% SEIMBANG' : 'SELISIH TERDETEKSI') : 'MEMERIKSA...'}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#71818B]">
            {solvency ? `${solvency.assets.length} Aset Diaudit` : 'Double-Entry Ledger'}
          </div>
        </div>
      </div>

      {/* Treasury Fee Funding Provenance Strip */}
      <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1 font-mono tabular-nums text-xs">
          <div>
            <span className="text-[11px] font-sans text-[#71818B] block">Total Fee Exchange (All-Time)</span>
            <span className="text-sm font-bold text-[#E4EBEF] mt-0.5 block">
              {formatIdr(treasuryFees?.summary?.totalExchangeFeesIdr ?? 0)}
            </span>
            <span className="text-[10px] text-[#8DA5B1]">
              User: {formatIdr(treasuryFees?.summary?.userDirectFeesIdr ?? 0)}
            </span>
          </div>
          <div>
            <span className="text-[11px] font-sans text-[#71818B] block">Total Claimed Yield Paid</span>
            <span className="text-sm font-bold text-[#D6A85C] mt-0.5 block">
              {formatIdr(treasuryFees?.summary?.stakingClaimedAllTimeIdr ?? 0)}
            </span>
            <span className="text-[10px] text-[#35B887]">
              Fee Pool: {formatIdr(treasuryFees?.summary?.stakingFeePoolFundedIdr ?? 0)}
            </span>
          </div>
          <div>
            <span className="text-[11px] font-sans text-[#71818B] block">Sisa Fee Pool Net &amp; Coverage</span>
            <span
              className={`text-sm font-bold mt-0.5 block ${
                (treasuryFees?.summary?.netTreasuryFeePoolIdr ?? 0) >= 0 ? 'text-[#35B887]' : 'text-[#EA5B65]'
              }`}
            >
              {formatIdr(treasuryFees?.summary?.netTreasuryFeePoolIdr ?? 0)}
            </span>
            <span className="text-[10px] text-[#8DA5B1]">
              Rasio Coverage: {(treasuryFees?.summary?.feeCoverageRatioPct ?? 0).toFixed(1)}%
            </span>
          </div>
          <div>
            <span className="text-[11px] font-sans text-[#71818B] block">Live Fee Collector (SYS_FEES)</span>
            <span className="text-sm font-bold text-[#6D9FE8] mt-0.5 block">
              {formatIdr(treasuryFees?.summary?.feeCollectorLiveIdr ?? 0)}
            </span>
            <span className="text-[10px] text-[#71818B]">
              Pending Klaim: {formatIdr(treasuryFees?.summary?.stakingPendingClaimableIdr ?? 0)}
            </span>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={actionBusy || (treasuryFees?.summary?.feeCollectorLiveIdr ?? 0) <= 0}
          onClick={handleSweepFeesToTreasury}
          className="self-start lg:self-auto whitespace-nowrap"
        >
          Sweep Fee → Treasury
        </Button>
      </div>

      {/* Sub-Tabs Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs<ConsoleSubTab>
          activeTab={subTab}
          onChange={setSubTab}
          tabs={[
            { id: 'VAULTS', label: 'Vaults & APY Manager', badge: vaults.length, icon: <Layers className="w-3.5 h-3.5" /> },
            { id: 'POSITIONS', label: 'Staker Positions', badge: positions.length, icon: <Users className="w-3.5 h-3.5" /> },
            { id: 'PAYOUTS', label: 'Yield Payout Ledger', badge: payouts.length, icon: <History className="w-3.5 h-3.5" /> },
            { id: 'SOLVENCY', label: 'Custody Solvency Audit', icon: <Database className="w-3.5 h-3.5" /> },
          ]}
        />
      </div>

      {/* =====================================================================
          SUB-TAB 1: VAULTS & APY MANAGER
          ===================================================================== */}
      {subTab === 'VAULTS' && (
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
          <div className="p-4 border-b border-[#202B34] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-[#71818B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={vaultSearch}
                onChange={e => setVaultSearch(e.target.value)}
                placeholder="Cari Vault ID, nama, atau simbol aset..."
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] pl-8 pr-3 py-1.5 text-xs text-[#E4EBEF] placeholder:text-[#71818B] outline-none focus:border-[#8DA5B1]"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {(['ALL', 'ACTIVE', 'PAUSED', 'CLOSED'] as const).map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setVaultStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-[5px] text-[11px] font-mono font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    vaultStatusFilter === st
                      ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#40515D]'
                      : 'bg-[#111820] text-[#71818B] border border-[#202B34] hover:text-[#E4EBEF]'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#202B34] bg-[#111820] text-[11px] font-mono uppercase tracking-wider text-[#71818B]">
                  <th className="py-2.5 px-4">Vault &amp; Aset</th>
                  <th className="py-2.5 px-3">Skema &amp; Lockup</th>
                  <th className="py-2.5 px-3 text-right">APY%</th>
                  <th className="py-2.5 px-3 text-right">Live TVL</th>
                  <th className="py-2.5 px-3 text-right">Utilisasi Cap</th>
                  <th className="py-2.5 px-3 text-center">Early Exit</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-4 text-right">Kontrol</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34]">
                {filteredVaults.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-xs text-[#71818B]">
                      {isLoading ? 'Memuat vault staking...' : 'Tidak ada staking vault yang cocok dengan filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredVaults.map(v => {
                    const utilPct = Math.min(100, (v.utilizationBps || 0) / 100);
                    return (
                      <tr key={v.id} className="hover:bg-[#17212B]/60 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <AssetIcon symbol={v.asset} size="sm" logoUrl={v.assetLogoUrl} />
                            <div className="min-w-0">
                              <div className="font-semibold text-[#E4EBEF] flex items-center gap-1.5">
                                <span className="truncate max-w-[190px]">{v.name}</span>
                                {v.isFeatured && (
                                  <span className="text-[10px] font-mono text-[#D6A85C]">Featured</span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono text-[#71818B]">
                                {v.asset} · {v.id}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-[#A1AFB8]">
                          <div className="text-[#E4EBEF]">{v.type}</div>
                          <div className="text-[#71818B]">
                            {v.durationDays === 0 ? 'Flexible (0d)' : `${v.durationDays} Hari Lock`}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#35B887]">
                          {v.apyPct.toFixed(2)}%
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          <div className="text-[#E4EBEF] font-medium">
                            {v.totalStakedDisplay} {v.asset}
                          </div>
                          <div className="text-[11px] text-[#71818B]">
                            {formatUsd(v.totalStakedUsd)} · {v.activeStakersCount} staker
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          <div className="text-[#E4EBEF]">{utilPct.toFixed(1)}%</div>
                          <div className="w-24 ml-auto h-1.5 bg-[#111820] rounded-full overflow-hidden mt-1 border border-[#202B34]">
                            <div
                              className="h-full bg-[#35B887]"
                              style={{ width: `${Math.max(2, Math.min(100, utilPct))}%` }}
                            />
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-[11px] text-[#A1AFB8]">
                          {v.durationDays === 0 ? (
                            <span className="text-[#35B887]">Instant 0%</span>
                          ) : v.earlyRedeemAllowed ? (
                            <span>Penalti {(v.earlyRedeemPenaltyBps / 100).toFixed(1)}%</span>
                          ) : (
                            <span className="text-[#D6A85C]">Locked</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <StatusBadge
                            tone={v.status === 'ACTIVE' ? 'success' : v.status === 'PAUSED' ? 'warning' : 'danger'}
                          >
                            {v.status}
                          </StatusBadge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {v.status !== 'CLOSED' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={actionBusy}
                                onClick={() => handleToggleVaultStatus(v)}
                                icon={
                                  v.status === 'ACTIVE' ? (
                                    <PauseCircle className="w-3.5 h-3.5 text-[#D6A85C]" />
                                  ) : (
                                    <PlayCircle className="w-3.5 h-3.5 text-[#35B887]" />
                                  )
                                }
                              >
                                {v.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                              </Button>
                            )}
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => openEditVaultModal(v)}
                              icon={<Edit3 className="w-3.5 h-3.5" />}
                            >
                              Edit Vault
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
      )}

      {/* =====================================================================
          SUB-TAB 2: STAKER POSITIONS & COMPLIANCE LOCKUP UNLOCK
          ===================================================================== */}
      {subTab === 'POSITIONS' && (
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
          <div className="p-4 border-b border-[#202B34] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-[#71818B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={positionSearch}
                onChange={e => setPositionSearch(e.target.value)}
                placeholder="Cari email user, position ID, atau aset..."
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] pl-8 pr-3 py-1.5 text-xs text-[#E4EBEF] placeholder:text-[#71818B] outline-none focus:border-[#8DA5B1]"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {(['ALL', 'ACTIVE', 'MATURED', 'REDEEMED'] as const).map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setPositionStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-[5px] text-[11px] font-mono font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    positionStatusFilter === st
                      ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#40515D]'
                      : 'bg-[#111820] text-[#71818B] border border-[#202B34] hover:text-[#E4EBEF]'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#202B34] bg-[#111820] text-[11px] font-mono uppercase tracking-wider text-[#71818B]">
                  <th className="py-2.5 px-4">User &amp; Position</th>
                  <th className="py-2.5 px-3">Vault</th>
                  <th className="py-2.5 px-3 text-right">Principal</th>
                  <th className="py-2.5 px-3 text-right">APY%</th>
                  <th className="py-2.5 px-3 text-right">Claimable Yield</th>
                  <th className="py-2.5 px-3 text-center">Compound</th>
                  <th className="py-2.5 px-3">Maturity</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34]">
                {filteredPositions.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-xs text-[#71818B]">
                      {isLoading ? 'Memuat posisi staker...' : 'Belum ada posisi staking yang sesuai filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredPositions.map(pos => {
                    const canAdminUnlock = pos.status === 'ACTIVE' && pos.durationDays > 0;
                    return (
                      <tr key={pos.id} className="hover:bg-[#17212B]/60 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-medium text-[#E4EBEF] truncate max-w-[200px]">
                            {pos.userEmail || pos.userId}
                          </div>
                          <div className="text-[11px] font-mono text-[#71818B]">{pos.id}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-[#E4EBEF] font-medium">{pos.vaultName}</div>
                          <div className="text-[11px] font-mono text-[#71818B]">
                            {pos.asset} · {pos.durationDays === 0 ? 'Flexible' : `${pos.durationDays}d`}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          <div className="text-[#E4EBEF] font-semibold">
                            {pos.principalDisplay} {pos.asset}
                          </div>
                          <div className="text-[11px] text-[#71818B]">{formatUsd(pos.principalUsd)}</div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#35B887] font-semibold">
                          {pos.apyPct.toFixed(2)}%
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#E4EBEF]">
                          {pos.accruedYieldDisplay} {pos.asset}
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-[11px]">
                          <span className={pos.autoCompound ? 'text-[#35B887]' : 'text-[#71818B]'}>
                            {pos.autoCompound ? 'AUTO' : 'MANUAL'}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-[#A1AFB8]">
                          {pos.maturesAt ? new Date(pos.maturesAt).toLocaleDateString('id-ID') : 'Flexible'}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <StatusBadge
                            tone={
                              pos.status === 'ACTIVE'
                                ? 'info'
                                : pos.status === 'MATURED'
                                  ? 'success'
                                  : 'neutral'
                            }
                          >
                            {pos.status}
                          </StatusBadge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {canAdminUnlock ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setUnlockTarget(pos);
                                setUnlockReason('Operational compliance unlock');
                              }}
                              icon={<LockOpen className="w-3.5 h-3.5 text-[#D6A85C]" />}
                            >
                              Unlock Lockup
                            </Button>
                          ) : (
                            <span className="text-[11px] font-mono text-[#71818B]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 3: GLOBAL YIELD PAYOUT LEDGER
          ===================================================================== */}
      {subTab === 'PAYOUTS' && (
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
          <div className="p-4 border-b border-[#202B34] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-[#71818B] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={payoutSearch}
                onChange={e => setPayoutSearch(e.target.value)}
                placeholder="Cari email user, aset, journal ID..."
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] pl-8 pr-3 py-1.5 text-xs text-[#E4EBEF] placeholder:text-[#71818B] outline-none focus:border-[#8DA5B1]"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {(['ALL', 'DAILY_SETTLEMENT', 'AUTO_COMPOUND', 'MANUAL_CLAIM', 'REDEMPTION_SETTLEMENT'] as const).map(
                tp => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => setPayoutTypeFilter(tp)}
                    className={`px-2.5 py-1 rounded-[5px] text-[11px] font-mono font-medium whitespace-nowrap transition-colors cursor-pointer ${
                      payoutTypeFilter === tp
                        ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#40515D]'
                        : 'bg-[#111820] text-[#71818B] border border-[#202B34] hover:text-[#E4EBEF]'
                    }`}
                  >
                    {tp === 'ALL' ? 'ALL' : tp.replace('_', ' ')}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#202B34] bg-[#111820] text-[11px] font-mono uppercase tracking-wider text-[#71818B]">
                  <th className="py-2.5 px-4">Waktu UTC/WIB</th>
                  <th className="py-2.5 px-3">User</th>
                  <th className="py-2.5 px-3">Vault &amp; Aset</th>
                  <th className="py-2.5 px-3">Tipe Pembayaran</th>
                  <th className="py-2.5 px-3">Sumber Dana</th>
                  <th className="py-2.5 px-3 text-right">Nominal Yield</th>
                  <th className="py-2.5 px-3 text-right">APY%</th>
                  <th className="py-2.5 px-4 text-right">Ledger Journal ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34]">
                {filteredPayouts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-xs text-[#71818B]">
                      {isLoading ? 'Memuat riwayat distribusi yield...' : 'Belum ada catatan distribusi yield.'}
                    </td>
                  </tr>
                ) : (
                  filteredPayouts.map(row => (
                    <tr key={row.id} className="hover:bg-[#17212B]/60 transition-colors">
                      <td className="py-3 px-4 font-mono text-[11px] text-[#A1AFB8] whitespace-nowrap">
                        {new Date(row.createdAt).toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-3 text-[#E4EBEF] truncate max-w-[180px]">{row.userEmail}</td>
                      <td className="py-3 px-3">
                        <div className="text-[#E4EBEF] font-medium">{row.vaultName}</div>
                        <div className="text-[11px] font-mono text-[#71818B]">{row.asset}</div>
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadge
                          tone={
                            row.payoutType === 'AUTO_COMPOUND' || row.payoutType === 'MANUAL_CLAIM'
                              ? 'success'
                              : row.payoutType === 'REDEMPTION_SETTLEMENT'
                                ? 'brand'
                                : 'info'
                          }
                        >
                          {row.payoutType}
                        </StatusBadge>
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadge
                          tone={
                            row.fundingSource === 'EXCHANGE_FEE_POOL'
                              ? 'success'
                              : row.fundingSource === 'HYBRID_FEE_AND_TREASURY'
                                ? 'warning'
                                : row.fundingSource === 'ACCRUAL_LEDGER'
                                  ? 'neutral'
                                  : 'info'
                          }
                        >
                          {row.fundingSource === 'EXCHANGE_FEE_POOL'
                            ? 'FEE POOL'
                            : row.fundingSource === 'HYBRID_FEE_AND_TREASURY'
                              ? 'HYBRID'
                              : row.fundingSource === 'ACCRUAL_LEDGER'
                                ? 'ACCRUAL'
                                : 'TREASURY'}
                        </StatusBadge>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-[#35B887]">
                        +{row.amountDisplay} {row.asset}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#A1AFB8]">
                        {row.apyPct.toFixed(2)}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[11px] text-[#71818B]">
                        {row.journalId}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 4: CUSTODY SOLVENCY AUDIT
          ===================================================================== */}
      {subTab === 'SOLVENCY' && (
        <div className="space-y-4">
          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-[8px] flex items-center justify-center border ${
                  solvency?.isFullySolvent !== false
                    ? 'bg-[#12392F] border-[#35B887]/30 text-[#35B887]'
                    : 'bg-[#401F27] border-[#EA5B65]/40 text-[#EA5B65]'
                }`}
              >
                {solvency?.isFullySolvent !== false ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <ShieldAlert className="w-4 h-4" />
                )}
              </div>
              <div>
                <div className="text-sm font-semibold text-[#E4EBEF]">
                  Verifikasi Rekonsiliasi Custody Ledger ({solvency?.isFullySolvent !== false ? '100% SEIMBANG' : 'SELISIH'})
                </div>
                <div className="text-xs text-[#71818B]">
                  Membandingkan saldo riil akun SYS_EARN_CUSTODY di Double-Entry Ledger terhadap akumulasi seluruh principal posisi staker aktif.
                </div>
              </div>
            </div>
            <div className="text-[11px] font-mono text-[#71818B] whitespace-nowrap">
              {solvency ? `Diperiksa: ${new Date(solvency.checkedAt).toLocaleString('id-ID')}` : 'Menghitung...'}
            </div>
          </div>

          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#202B34] bg-[#111820] text-[11px] font-mono uppercase tracking-wider text-[#71818B]">
                    <th className="py-2.5 px-4">Aset</th>
                    <th className="py-2.5 px-3 text-right">Custody Ledger Balance</th>
                    <th className="py-2.5 px-3 text-right">Total Principal Aktif</th>
                    <th className="py-2.5 px-3 text-right">Delta Rekonsiliasi</th>
                    <th className="py-2.5 px-3 text-right">Accrued Yield Liability</th>
                    <th className="py-2.5 px-4 text-center">Status Audit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34]">
                  {!solvency || solvency.assets.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-xs text-[#71818B]">
                        Belum ada data aset custody staking.
                      </td>
                    </tr>
                  ) : (
                    solvency.assets.map(row => (
                      <tr key={row.asset} className="hover:bg-[#17212B]/60 transition-colors">
                        <td className="py-3 px-4 font-semibold text-[#E4EBEF] font-mono">{row.asset}</td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#E4EBEF]">
                          {row.custodyLedgerDisplay} {row.asset}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#A1AFB8]">
                          {row.activePrincipalDisplay} {row.asset}
                        </td>
                        <td
                          className={`py-3 px-3 text-right font-mono tabular-nums font-semibold ${
                            row.deltaUnits === '0' ? 'text-[#35B887]' : 'text-[#EA5B65]'
                          }`}
                        >
                          {row.deltaUnits} units
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[#D6A85C]">
                          {row.accruedLiabilityDisplay} {row.asset}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <StatusBadge tone={row.isBalanced ? 'success' : 'danger'}>
                            {row.isBalanced ? 'BALANCED' : 'MISMATCH'}
                          </StatusBadge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: CREATE STAKING VAULT (Backed strictly by db.assets)
          ===================================================================== */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Buat Staking / Earn Vault Baru"
        subtitle="Pilih aset aktif bursa dan tetapkan skema APY, kapasitas, serta aturan penebusan."
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleCreateVault} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Aset Aktif Bursa:</label>
              <select
                value={createForm.asset}
                onChange={e => setCreateForm(f => ({ ...f, asset: e.target.value }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              >
                {(earnAssets.length > 0
                  ? earnAssets
                  : [{ symbol: 'USDT', name: 'Tether USD', decimals: 6, network: 'ERC20' }]
                ).map(a => (
                  <option key={a.symbol} value={a.symbol}>
                    {a.symbol} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">Tipe Vault:</label>
              <select
                value={createForm.type}
                onChange={e => {
                  const nextType = e.target.value as EarnVaultType;
                  setCreateForm(f => ({
                    ...f,
                    type: nextType,
                    durationDays: nextType === 'FLEXIBLE' ? '0' : f.durationDays === '0' ? '30' : f.durationDays,
                  }));
                }}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              >
                <option value="FLEXIBLE">FLEXIBLE (0d)</option>
                <option value="FIXED">FIXED (Locked Term)</option>
                <option value="STAKING">STAKING (On-Chain)</option>
                <option value="LAUNCHPOOL">LAUNCHPOOL</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[#A1AFB8] block mb-1">Nama Vault:</label>
            <input
              type="text"
              required
              placeholder="Contoh: Institutional USDT 30D Prime Vault"
              value={createForm.name}
              onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Durasi Lock-up (Hari, 0 = Flexible):</label>
              <input
                type="number"
                min={0}
                max={3650}
                disabled={createForm.type === 'FLEXIBLE'}
                value={createForm.type === 'FLEXIBLE' ? '0' : createForm.durationDays}
                onChange={e => setCreateForm(f => ({ ...f, durationDays: e.target.value }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1] disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">APY (% Tahunan):</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="500"
                required
                value={createForm.apyPct}
                onChange={e => setCreateForm(f => ({ ...f, apyPct: e.target.value }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Min Stake (Token):</label>
              <input
                type="text"
                required
                value={createForm.minStakeTokens}
                onChange={e => setCreateForm(f => ({ ...f, minStakeTokens: e.target.value }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              />
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">Max / Tx (Token):</label>
              <input
                type="text"
                required
                value={createForm.maxStakeTokens}
                onChange={e => setCreateForm(f => ({ ...f, maxStakeTokens: e.target.value }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              />
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">Total Pool Cap:</label>
              <input
                type="text"
                required
                value={createForm.totalCapTokens}
                onChange={e => setCreateForm(f => ({ ...f, totalCapTokens: e.target.value }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              />
            </div>
          </div>

          <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-2.5">
            <div className="grid grid-cols-2 gap-3 items-center">
              <label className="flex items-center gap-2 text-[#E4EBEF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={createForm.earlyRedeemAllowed}
                  onChange={e => setCreateForm(f => ({ ...f, earlyRedeemAllowed: e.target.checked }))}
                />
                <span>Izinkan Early Redeem</span>
              </label>
              <div>
                <label className="text-[#71818B] text-[11px] block mb-1">Penalti Early Exit (%):</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="25"
                  disabled={!createForm.earlyRedeemAllowed || createForm.type === 'FLEXIBLE'}
                  value={createForm.type === 'FLEXIBLE' ? '0' : createForm.earlyRedeemPenaltyPct}
                  onChange={e => setCreateForm(f => ({ ...f, earlyRedeemPenaltyPct: e.target.value }))}
                  className="w-full bg-[#141C24] border border-[#2B3944] rounded-[6px] p-1.5 text-[#E4EBEF] font-mono outline-none disabled:opacity-50"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-5 pt-1">
              <label className="flex items-center gap-2 text-[#E4EBEF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={createForm.autoCompoundSupported}
                  onChange={e => setCreateForm(f => ({ ...f, autoCompoundSupported: e.target.checked }))}
                />
                <span>Support Auto-Compound</span>
              </label>
              <label className="flex items-center gap-2 text-[#E4EBEF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={createForm.isFeatured}
                  onChange={e => setCreateForm(f => ({ ...f, isFeatured: e.target.checked }))}
                />
                <span>Tandai Featured</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowCreateModal(false)}>
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={actionBusy}>
              Terbitkan Vault
            </Button>
          </div>
        </form>
      </Modal>

      {/* =====================================================================
          MODAL: EDIT STAKING VAULT
          ===================================================================== */}
      <Modal
        isOpen={Boolean(editingVault)}
        onClose={() => setEditingVault(null)}
        title={editingVault ? `Edit Vault: ${editingVault.name}` : 'Edit Vault'}
        subtitle={editingVault ? `${editingVault.asset} · ID ${editingVault.id}` : undefined}
        maxWidth="max-w-lg"
      >
        {editingVault && (
          <form onSubmit={handleSaveEditVault} className="space-y-3.5 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[#A1AFB8] block mb-1">Nama Vault:</label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
                />
              </div>
              <div>
                <label className="text-[#A1AFB8] block mb-1">Status Operasional:</label>
                <select
                  value={editForm.status}
                  onChange={e => setEditForm(f => ({ ...f, status: e.target.value as EarnVaultStatus }))}
                  className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="PAUSED">PAUSED</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[#A1AFB8] block mb-1">APY (% Tahunan):</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="500"
                  required
                  value={editForm.apyPct}
                  onChange={e => setEditForm(f => ({ ...f, apyPct: e.target.value }))}
                  className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
                />
              </div>
              <div>
                <label className="text-[#A1AFB8] block mb-1">Penalti Early Exit (%):</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="25"
                  disabled={!editForm.earlyRedeemAllowed || editingVault.durationDays === 0}
                  value={editForm.earlyRedeemPenaltyPct}
                  onChange={e => setEditForm(f => ({ ...f, earlyRedeemPenaltyPct: e.target.value }))}
                  className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1] disabled:opacity-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="text-[#A1AFB8] block mb-1">Min Stake:</label>
                <input
                  type="text"
                  required
                  value={editForm.minStakeTokens}
                  onChange={e => setEditForm(f => ({ ...f, minStakeTokens: e.target.value }))}
                  className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
                />
              </div>
              <div>
                <label className="text-[#A1AFB8] block mb-1">Max / Tx:</label>
                <input
                  type="text"
                  required
                  value={editForm.maxStakeTokens}
                  onChange={e => setEditForm(f => ({ ...f, maxStakeTokens: e.target.value }))}
                  className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
                />
              </div>
              <div>
                <label className="text-[#A1AFB8] block mb-1">Total Pool Cap:</label>
                <input
                  type="text"
                  required
                  value={editForm.totalCapTokens}
                  onChange={e => setEditForm(f => ({ ...f, totalCapTokens: e.target.value }))}
                  className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
                />
              </div>
            </div>

            <div>
              <label className="text-[#A1AFB8] block mb-1">Catatan Custody:</label>
              <input
                type="text"
                value={editForm.custodyNote}
                onChange={e => setEditForm(f => ({ ...f, custodyNote: e.target.value }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-5 pt-1">
              <label className="flex items-center gap-2 text-[#E4EBEF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.earlyRedeemAllowed}
                  onChange={e => setEditForm(f => ({ ...f, earlyRedeemAllowed: e.target.checked }))}
                />
                <span>Early Redeem Diizinkan</span>
              </label>
              <label className="flex items-center gap-2 text-[#E4EBEF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.autoCompoundSupported}
                  onChange={e => setEditForm(f => ({ ...f, autoCompoundSupported: e.target.checked }))}
                />
                <span>Auto-Compound</span>
              </label>
              <label className="flex items-center gap-2 text-[#E4EBEF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.isFeatured}
                  onChange={e => setEditForm(f => ({ ...f, isFeatured: e.target.checked }))}
                />
                <span>Featured</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditingVault(null)}>
                Batal
              </Button>
              <Button type="submit" variant="primary" size="sm" isLoading={actionBusy}>
                Simpan Perubahan
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* =====================================================================
          MODAL: COMPLIANCE UNLOCK FIXED LOCKUP POSITION
          ===================================================================== */}
      <Modal
        isOpen={Boolean(unlockTarget)}
        onClose={() => setUnlockTarget(null)}
        title="Buka Lockup Posisi Staking (Waive Penalty)"
        subtitle={unlockTarget ? `${unlockTarget.id} · ${unlockTarget.userEmail || unlockTarget.userId}` : undefined}
        maxWidth="max-w-md"
      >
        {unlockTarget && (
          <form onSubmit={handleConfirmUnlockPosition} className="space-y-4 text-xs">
            <div className="p-3 rounded-[8px] bg-[#111820] border border-[#202B34] space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span className="text-[#71818B]">Vault:</span>
                <span className="text-[#E4EBEF]">{unlockTarget.vaultName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#71818B]">Principal:</span>
                <span className="text-[#E4EBEF] font-semibold">
                  {unlockTarget.principalDisplay} {unlockTarget.asset}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#71818B]">Jadwal Maturity:</span>
                <span className="text-[#D6A85C]">
                  {unlockTarget.maturesAt ? new Date(unlockTarget.maturesAt).toLocaleString('id-ID') : '-'}
                </span>
              </div>
            </div>
            <p className="text-[#A1AFB8] leading-relaxed">
              Tindakan ini mengubah status posisi menjadi <strong className="text-[#E4EBEF]">MATURED</strong> sehingga pengguna dapat melakukan redeem penuh (0% penalti). Aksi tercatat di Audit Trail.
            </p>
            <div>
              <label className="text-[#A1AFB8] block mb-1">Alasan Kepatuhan / Operasional:</label>
              <input
                type="text"
                required
                value={unlockReason}
                onChange={e => setUnlockReason(e.target.value)}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setUnlockTarget(null)}>
                Batal
              </Button>
              <Button type="submit" variant="primary" size="sm" isLoading={actionBusy}>
                Konfirmasi Unlock 0% Penalti
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* =====================================================================
          MODAL: CONFIRM SIMULATE YIELD EPOCH (+1 DAY)
          ===================================================================== */}
      <Modal
        isOpen={showEpochModal}
        onClose={() => setShowEpochModal(false)}
        title="Simulasi Siklus Yield (+1 Hari UTC)"
        subtitle="Menjalankan 1 siklus distribusi imbal hasil paksa pada posisi aktif melalui Treasury Ledger."
        maxWidth="max-w-md"
      >
        <div className="space-y-4 text-xs">
          <p className="text-[#A1AFB8] leading-relaxed">
            Operasi ini menghitung dan mendistribusikan imbal hasil 1 hari penuh (APY / 365 menggunakan integer BigInt) ke posisi aktif secara riil di Double-Entry Ledger.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowEpochModal(false)}>
              Batal
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              isLoading={actionBusy}
              onClick={() => handleRunYieldSettlement(true)}
            >
              Jalankan Siklus Yield (+1d)
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
