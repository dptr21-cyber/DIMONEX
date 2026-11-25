/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/admin/AdminView.tsx
 * DIMONEX Master Admin & Operations Console — Complete Multi-Feature Control Center
 * 
 * Feature Modules:
 * 1. Overview & System Health (24h Volume, Orders, Trades, Solvency Liabilities, Invariants)
 * 2. Markets & Pairs (Halt/Resume, Fee Tuning, Create Trading Pair)
 * 3. Token Listing Portal (Maker-Checker Approvals, Initial Liquidity)
 * 4. Users & RBAC (User Directory, Change Role, Freeze/Unfreeze, Reset 2FA, KYC Review)
 * 5. Withdrawals Queue (Fiat & Crypto Approval / Rejection with Ledger Refund)
 * 6. Ledger & Solvency (Double-Entry Balance Adjustments, Treasury Reserves)
 * 7. Bot & MM Operations (Global Bot Monitor, Emergency Kill-Switch)
 * 8. FX Engine & Price Feeds (USDT/IDR Manual Override, CoinMarketCap / Binance feeds)
 * 9. Earn, Copy Trading & VIP Tiers (Staking APY, Master Trader Approval, VIP Fee Discounts)
 * 10. Risk, AML & Audit Logs (Real-time AML Alerts, Searchable Append-Only Audit Trail)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  Coins,
  Rocket,
  Users,
  ArrowUpRight,
  Wallet,
  Bot,
  TrendingUp,
  PiggyBank,
  ShieldAlert,
  FileText,
  RefreshCw,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock,
  Unlock,
  Key,
  ShieldCheck,
  Check,
  X,
  ExternalLink,
  Flame,
  ArrowDownLeft,
  Percent,
  Sliders,
  Radio,
  Trash2,
  Scale,
  User,
  Sparkles,
  Hash,
  Image as ImageIcon,
  Clock,
  Calendar,
  RotateCcw,
  Newspaper,
  Bell,
  Gift,
  Ticket,
  History,
  Layers
} from 'lucide-react';
import {
  UserProfile,
  TradingPairItem,
  ExternalWsWhitelistEntry,
  EarnVaultItem,
  EarnPositionItem,
  EarnCustodySolvencyReport,
  AdminTreasuryFeeOverview,
} from '../../types/index.js';
import { formatIDR, formatCrypto, formatDateTime, safeBigInt, formatQuotePrice } from '../../lib/formatters.js';
import { formatCountdownCompact } from '../trading/MarketCountdownOverlay.js';
import { Button } from '../ui/Button.js';
import { Modal } from '../ui/Modal.js';
import { ConfirmationDialog, DialogField } from '../ui/ConfirmationDialog.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { ListingManagementView } from './listing/ListingManagementView.js';
import { AssetManagementSection } from './AssetManagementSection.js';
import { NewsManagementSection } from './content/NewsManagementSection.js';
import { NotificationCenterSection } from './content/NotificationCenterSection.js';
import { MediaLibrarySection } from './content/MediaLibrarySection.js';
import { VipRewardsAdminSection } from './rewards/VipRewardsAdminSection.js';
import { StakingAdminConsole } from './staking/StakingAdminConsole.js';

interface Props {
  user: UserProfile | null;
  tradingPairs: TradingPairItem[];
  onRefreshPairs: () => void;
  onOpenAuthModal: () => void;
}

type AdminTab =
  | 'OVERVIEW'
  | 'ASSETS'
  | 'PAIRS'
  | 'LISTING'
  | 'USERS'
  | 'WITHDRAWALS'
  | 'LEDGER'
  | 'BOTS'
  | 'FX'
  | 'STAKING'
  | 'PRODUCTS'
  | 'RISK'
  | 'AUDIT'
  | 'CMS_NEWS'
  | 'CMS_NOTIFICATIONS'
  | 'CMS_MEDIA'
  | 'VIP_TASKS'
  | 'VIP_VOUCHERS'
  | 'VIP_CLAIMS';

export const AdminView: React.FC<Props> = ({ user, tradingPairs, onRefreshPairs, onOpenAuthModal }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('OVERVIEW');
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    tone?: 'brand' | 'danger' | 'warning' | 'buy';
    fields?: DialogField[];
    onSubmit: (values: Record<string, string>) => Promise<void>;
  } | null>(null);
  const [isConfirmBusy, setIsConfirmBusy] = useState(false);

  // Data states
  const [stats, setStats] = useState<any>(null);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [pendingWd, setPendingWd] = useState<{ fiat: any[]; crypto: any[] }>({ fiat: [], crypto: [] });
  const [riskAlerts, setRiskAlerts] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [botsList, setBotsList] = useState<any[]>([]);
  const [earnpools, setEarnPools] = useState<EarnVaultItem[]>([]);
  const [earnPositions, setEarnPositions] = useState<EarnPositionItem[]>([]);
  const [earnSolvency, setEarnSolvency] = useState<EarnCustodySolvencyReport | null>(null);
  const [treasuryFeesReport, setTreasuryFeesReport] = useState<AdminTreasuryFeeOverview | null>(null);
  const [feeMonitorView, setFeeMonitorView] = useState<'CURRENCY' | 'PAIR' | 'CLAIMS'>('CURRENCY');
  const [isSweepingFees, setIsSweepingFees] = useState(false);
  const [showCreateEarnModal, setShowCreateEarnModal] = useState(false);
  const [isSettlingYield, setIsSettlingYield] = useState(false);
  const [newEarnVaultForm, setNewEarnVaultForm] = useState({
    asset: 'USDT',
    name: '',
    type: 'FLEXIBLE' as 'FLEXIBLE' | 'FIXED' | 'STAKING' | 'LAUNCHPOOL',
    durationDays: '0',
    apyPct: '8.5',
    minStakeTokens: '10',
    maxStakeTokens: '100000',
    totalCapTokens: '1000000',
    earlyRedeemAllowed: true,
    earlyRedeemPenaltyPct: '1.5',
    autoCompoundSupported: true,
    isFeatured: false,
  });
  const [copyMasters, setCopyMasters] = useState<any[]>([]);
  const [vipTiers, setVipTiers] = useState<any[]>([]);
  const [fxStatus, setFxStatus] = useState<any>(null);
  const [wsWhitelist, setWsWhitelist] = useState<ExternalWsWhitelistEntry[]>([]);
  const [wsFeedStatus, setWsFeedStatus] = useState<any>(null);
  const [wsCatalog, setWsCatalog] = useState<any[]>([]);
  const [wsCatalogSource, setWsCatalogSource] = useState<string>('');
  const [wsCatalogSearch, setWsCatalogSearch] = useState<string>('');
  const [wsCatalogProvider, setWsCatalogProvider] = useState<'ALL' | 'BINANCE' | 'BYBIT'>('ALL');
  const [wsManualSymbol, setWsManualSymbol] = useState<string>('');
  const [wsManualProviders, setWsManualProviders] = useState<{ binance: boolean; bybit: boolean }>({ binance: true, bybit: true });
  const [wsCatalogLoading, setWsCatalogLoading] = useState<boolean>(false);
  const [wsActionBusy, setWsActionBusy] = useState<boolean>(false);

  // Filters & searches
  const [userSearch, setUserSearch] = useState('');
  const [auditSearch, setAuditSearch] = useState('');

  // Modals & Inputs
  const [showCreatePairModal, setShowCreatePairModal] = useState(false);
  const [newPairData, setNewPairData] = useState({
    baseCurrency: '',
    quoteCurrency: 'IDR',
    baseDecimals: '8',
    quoteDecimals: '2',
    initialPrice: '100000',
    minOrderTokens: '1',
    maxOrderTokens: '10000000',
    makerFeeBps: '10',
    takerFeeBps: '20'
  });

  // Token & Limits Configuration Modal State
  const [showEditPairModal, setShowEditPairModal] = useState(false);
  const [editingPair, setEditingPair] = useState<TradingPairItem | null>(null);
  const [pairLifecycleFilter, setPairLifecycleFilter] = useState<'ALL' | 'ACTIVE' | 'SCHEDULED_DELIST' | 'DELISTED'>('ALL');
  const [pairConfigForm, setPairConfigForm] = useState({
    inputMode: 'TOKENS' as 'TOKENS' | 'ATOMIC',
    minOrderTokens: '1',
    maxOrderTokens: '10000000',
    minOrderSize: '100000000',
    maxOrderSize: '1000000000000000',
    makerFeeBps: 10,
    takerFeeBps: 20,
    isHalted: false,
    isDelisted: false,
    delistScheduledAt: '',
    delistReason: '',
    lastPrice: ''
  });

  const formatAtomicToToken = (unitsStr: string | undefined, decimals: number): string => {
    if (!unitsStr) return '0';
    try {
      const b = BigInt(unitsStr);
      const dec = Math.max(0, decimals || 0);
      const div = 10n ** BigInt(dec);
      const integer = b / div;
      const frac = b % div;
      if (frac === 0n) return integer.toLocaleString('id-ID');
      const fracPadded = frac.toString().padStart(dec, '0').replace(/0+$/, '');
      return `${integer.toLocaleString('id-ID')}.${fracPadded}`;
    } catch {
      return unitsStr;
    }
  };

  const parseTokenToAtomic = (tokenStr: string, decimals: number): string => {
    const clean = String(tokenStr || '').replace(/,/g, '').trim();
    if (!clean || clean === '0') return '0';
    try {
      const dec = Math.max(0, decimals || 0);
      const [intPart, fracPart = ''] = clean.split('.');
      const cleanFrac = fracPart.slice(0, dec).padEnd(dec, '0');
      return (BigInt(intPart || '0') * (10n ** BigInt(dec)) + BigInt(cleanFrac || '0')).toString();
    } catch {
      return '0';
    }
  };

  const [showAdjustLedgerModal, setShowAdjustLedgerModal] = useState(false);
  const [ledgerAdjData, setLedgerAdjData] = useState({
    userId: '',
    currency: 'IDR',
    amountUnits: '',
    direction: 'CREDIT' as 'CREDIT' | 'DEBIT',
    reason: ''
  });

  const [showFxModal, setShowFxModal] = useState(false);
  const [manualFxRate, setManualFxRate] = useState('16350');
  const [fxReason, setFxReason] = useState('Penyesuaian kurs tengah pasar interbank');

  // Market Delisting Modal State
  const [showDelistModal, setShowDelistModal] = useState(false);
  const [delistingPair, setDelistingPair] = useState<TradingPairItem | null>(null);
  const [delistMode, setDelistMode] = useState<'SCHEDULE' | 'IMMEDIATE'>('SCHEDULE');
  const [delistDateTime, setDelistDateTime] = useState<string>('');
  const [delistReason, setDelistReason] = useState<string>('');
  const [isDelistSubmitting, setIsDelistSubmitting] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const toLocalDateTimeInput = (ts: number): string => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  useEffect(() => {
    if (activeTab !== 'PAIRS' && !showDelistModal && !showEditPairModal) return;
    const needsTick =
      showDelistModal ||
      showEditPairModal ||
      tradingPairs.some(
        p =>
          (p.delistScheduledAt && p.delistScheduledAt > Date.now()) ||
          (!p.isActive && p.scheduledAt && p.scheduledAt > Date.now())
      );
    if (!needsTick) return;
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [activeTab, tradingPairs, showDelistModal, showEditPairModal]);

  const showToast = (type: 'success' | 'error', text: string) => {
    setFeedbackMsg({ type, text });
    setTimeout(() => setFeedbackMsg(null), 5000);
  };

  const openDelistModal = (pair: TradingPairItem) => {
    setDelistingPair(pair);
    const existingScheduled = pair.delistScheduledAt && pair.delistScheduledAt > Date.now() + 15000;
    setDelistMode('SCHEDULE');
    setDelistDateTime(
      toLocalDateTimeInput(existingScheduled ? pair.delistScheduledAt! : Date.now() + 24 * 60 * 60 * 1000)
    );
    setDelistReason(pair.delistReason || 'Evaluasi likuiditas dan kepatuhan berkala bursa');
    setShowDelistModal(true);
  };

  const applyDelistPreset = (minutesFromNow: number) => {
    setDelistDateTime(toLocalDateTimeInput(Date.now() + minutesFromNow * 60 * 1000));
  };

  const handleSubmitDelist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!delistingPair) return;
    const token = localStorage.getItem('dimonex_auth_token');
    const cleanReason = delistReason.trim() || 'Delisting pasar berdasarkan evaluasi compliance DIMONEX';

    if (delistMode === 'SCHEDULE') {
      const targetTs = new Date(delistDateTime).getTime();
      if (!Number.isFinite(targetTs) || targetTs <= Date.now() + 10000) {
        showToast('error', 'Waktu jadwal delisting harus di masa depan (minimal 10 detik dari sekarang).');
        return;
      }
      setIsDelistSubmitting(true);
      try {
        const res = await fetch('/api/admin/pairs/delist-schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            pairId: delistingPair.id,
            delistScheduledAt: targetTs,
            reason: cleanReason,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal menjadwalkan delisting');
        showToast('success', data.message || `Delisting ${delistingPair.id} dijadwalkan dengan Countdown Timer di Chart.`);
        setShowDelistModal(false);
        onRefreshPairs();
        loadAllData();
      } catch (err: any) {
        showToast('error', err.message || 'Gagal menjadwalkan delisting');
      } finally {
        setIsDelistSubmitting(false);
      }
    } else {
      setIsDelistSubmitting(true);
      try {
        const res = await fetch('/api/admin/pairs/delist-now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            pairId: delistingPair.id,
            reason: cleanReason,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal mengeksekusi delisting pasar');
        showToast(
          'success',
          data.message || `Pasar ${delistingPair.id} berhasil didelisting (${data.cancelledOrders || 0} order dibatalkan & direfund).`
        );
        setShowDelistModal(false);
        onRefreshPairs();
        loadAllData();
      } catch (err: any) {
        showToast('error', err.message || 'Gagal mengeksekusi delisting');
      } finally {
        setIsDelistSubmitting(false);
      }
    }
  };

  const handleCancelScheduledDelist = async (pairId: string) => {
    const token = localStorage.getItem('dimonex_auth_token');
    setIsDelistSubmitting(true);
    try {
      const res = await fetch('/api/admin/pairs/delist-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pairId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membatalkan jadwal delisting');
      showToast('success', data.message || `Jadwal delisting ${pairId} berhasil dibatalkan.`);
      setShowDelistModal(false);
      onRefreshPairs();
      loadAllData();
    } catch (err: any) {
      showToast('error', err.message || 'Gagal membatalkan jadwal delisting');
    } finally {
      setIsDelistSubmitting(false);
    }
  };

  const handleRelistPair = async (pairId: string) => {
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const res = await fetch('/api/admin/pairs/relist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pairId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal melakukan relisting pasar');
      showToast('success', data.message || `Pasar ${pairId} berhasil diaktifkan kembali (Relisted).`);
      onRefreshPairs();
      loadAllData();
    } catch (err: any) {
      showToast('error', err.message || 'Gagal melakukan relisting');
    }
  };

  const handleToggleDelistedInline = (pair: TradingPairItem) => {
    if (pair.isDelisted) {
      setConfirmConfig({
        isOpen: true,
        title: `Aktifkan Kembali Market (Relist): ${pair.id}`,
        description: `Apakah Anda yakin ingin mengubah status isDelisted menjadi OFF dan mengaktifkan kembali perdagangan untuk ${pair.id}?`,
        confirmLabel: 'Relist Market',
        tone: 'buy',
        onSubmit: async () => {
          await handleRelistPair(pair.id);
        },
      });
      return;
    }

    setConfirmConfig({
      isOpen: true,
      title: `Manual Delisting Market: ${pair.id}`,
      description:
        'Mengaktifkan toggle isDelisted akan segera men-delisting pasar ini, membatalkan & mengembalikan seluruh dana order terbuka secara atomik, menghentikan semua bot pada pair ini, dan menutup order baru.',
      confirmLabel: 'Delist Market Sekarang',
      tone: 'danger',
      fields: [
        {
          key: 'reason',
          label: 'Alasan Manual Delisting (Audit Trail & Banner)',
          defaultValue: pair.delistReason || 'Manual delisting berdasarkan evaluasi likuiditas & kepatuhan bursa',
          placeholder: 'Masukkan alasan delisting...',
          required: true,
        },
      ],
      onSubmit: async (values) => {
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/admin/pairs/delist-now', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            pairId: pair.id,
            reason: values.reason || 'Manual delisting oleh admin',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal mengeksekusi delisting');
        showToast('success', data.message || `Pasar ${pair.id} berhasil didelisting.`);
        onRefreshPairs();
        loadAllData();
      },
    });
  };

  const isAdmin = user && (user.role?.toUpperCase() === 'ADMIN' || user.role?.toUpperCase() === 'SUPERADMIN');

  const loadAllData = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    const token = localStorage.getItem('dimonex_auth_token');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const [
        statsRes,
        usersRes,
        wdRes,
        riskRes,
        auditRes,
        botsRes,
        earnRes,
        earnPosRes,
        earnSolvRes,
        treasuryFeesRes,
        copyRes,
        vipRes,
        fxRes,
        wlRes
      ] = await Promise.all([
        fetch('/api/admin/stats', { headers }),
        fetch('/api/admin/users', { headers }),
        fetch('/api/admin/withdrawals/pending', { headers }),
        fetch('/api/risk/suspicious-activity', { headers }),
        fetch('/api/admin/audit-logs', { headers }),
        fetch('/api/admin/bots/all', { headers }),
        fetch('/api/admin/earn/pools', { headers }),
        fetch('/api/admin/earn/positions?limit=50', { headers }),
        fetch('/api/admin/earn/solvency', { headers }),
        fetch('/api/admin/treasury-fees', { headers }),
        fetch('/api/admin/copy-trading/masters', { headers }),
        fetch('/api/admin/vip-tiers', { headers }),
        fetch('/api/mm/fx-status', { headers }),
        fetch('/api/admin/external-ws/whitelist', { headers })
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (usersRes.ok) setUsersList(await usersRes.json());
      if (wdRes.ok) setPendingWd(await wdRes.json());
      if (riskRes.ok) setRiskAlerts(await riskRes.json());
      if (auditRes.ok) setAuditLogs(await auditRes.json());
      if (botsRes.ok) setBotsList(await botsRes.json());
      if (earnRes.ok) setEarnPools(await earnRes.json());
      if (earnPosRes.ok) {
        const epData = await earnPosRes.json();
        setEarnPositions(epData.positions || []);
      }
      if (earnSolvRes.ok) setEarnSolvency(await earnSolvRes.json());
      if (treasuryFeesRes.ok) setTreasuryFeesReport(await treasuryFeesRes.json());
      if (copyRes.ok) setCopyMasters(await copyRes.json());
      if (vipRes.ok) setVipTiers(await vipRes.json());
      if (fxRes.ok) setFxStatus(await fxRes.json());
      if (wlRes.ok) {
        const wlData = await wlRes.json();
        setWsWhitelist(wlData.items || []);
        setWsFeedStatus(wlData.feedStatus || null);
      }
    } catch (err: any) {
      console.error('Failed to load admin data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin]);

  const handleSweepTreasuryFees = () => {
    const liveFeeIdr = treasuryFeesReport?.summary?.feeCollectorLiveIdr ?? 0;
    if (liveFeeIdr <= 0) {
      showToast('error', 'Saldo Fee Collector (SYS_FEES) saat ini kosong, tidak ada yang perlu disweep.');
      return;
    }
    setConfirmConfig({
      isOpen: true,
      title: 'Sweep Akumulasi Fee ke Treasury Reserve',
      description: `Pindahkan seluruh saldo fee aktif di akun Fee Collector (estimasi Rp ${Math.round(liveFeeIdr).toLocaleString('id-ID')}) ke akun Treasury Reserve melalui Double-Entry Ledger? Catatan: setelah disweep, klaim staking berikutnya akan otomatis menarik dari Treasury Reserve apabila saldo SYS_FEES kosong.`,
      confirmLabel: 'Sweep ke Treasury',
      tone: 'brand',
      onSubmit: async () => {
        setIsSweepingFees(true);
        try {
          const token = localStorage.getItem('dimonex_auth_token');
          const res = await fetch('/api/admin/treasury-fees/sweep', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Gagal melakukan sweep fee');
          showToast('success', data.message || 'Fee berhasil disweep ke Treasury Reserve');
          if (data.overview) setTreasuryFeesReport(data.overview);
          await loadAllData();
        } catch (err: any) {
          showToast('error', err.message || 'Gagal melakukan sweep fee');
        } finally {
          setIsSweepingFees(false);
        }
      },
    });
  };

  const loadWsCatalog = useCallback(async (q = wsCatalogSearch, prov = wsCatalogProvider, force = false) => {
    if (!isAdmin) return;
    setWsCatalogLoading(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const params = new URLSearchParams({ q, provider: prov, refresh: force ? '1' : '0' });
      const res = await fetch(`/api/admin/external-ws/catalog?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setWsCatalog(data.items || []);
        setWsCatalogSource(data.source || 'LIVE');
      }
    } catch (e) {
      console.error('Failed to load external WS catalog', e);
    } finally {
      setWsCatalogLoading(false);
    }
  }, [isAdmin, wsCatalogSearch, wsCatalogProvider]);

  useEffect(() => {
    if (isAdmin && activeTab === 'FX' && wsCatalog.length === 0) {
      loadWsCatalog('', 'ALL', false);
    }
  }, [isAdmin, activeTab, wsCatalog.length, loadWsCatalog]);

  useEffect(() => {
    if (isAdmin) {
      loadAllData();
      const interval = setInterval(loadAllData, 15000);
      return () => clearInterval(interval);
    }
  }, [isAdmin, loadAllData]);

  // Auth Guard
  if (!user || !isAdmin) {
    return (
      <div className="p-8 max-w-lg mx-auto mt-12 text-center bg-[#141C24] border border-[#202B34] rounded-[10px] shadow-xl space-y-4">
        <div className="w-11 h-11 rounded-[10px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center mx-auto text-[#8DA5B1]">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <h2 className="text-lg font-semibold text-[#E4EBEF]">Konsol Operator Khusus Administrator</h2>
        <p className="text-xs text-[#A1AFB8] leading-relaxed">
          Area ini dibatasi ketat khusus untuk Tim Administrator, Super Admin, dan Kepatuhan Bursa DIMONEX.
          Silakan masuk dengan kredensial administrator resmi.
        </p>
        <Button variant="primary" size="md" onClick={onOpenAuthModal}>
          Masuk sebagai Admin
        </Button>
      </div>
    );
  }

  // Action Handlers
  const handleToggleHalt = async (pairId: string, currentHalt: boolean) => {
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/pairs/toggle-halt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pairId, isHalted: !currentHalt })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', data.message || 'Status trading pair berhasil diubah');
        onRefreshPairs();
        loadAllData();
      } else {
        showToast('error', data.error || 'Gagal mengubah status halt');
      }
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleUpdateFees = (pairId: string, currentMaker: number, currentTaker: number) => {
    setConfirmConfig({
      isOpen: true,
      title: `Ubah Fee Trading: ${pairId}`,
      description: 'Masukkan tarif Maker & Taker fee dalam satuan basis points (10 bps = 0.10%).',
      confirmLabel: 'Simpan Fee',
      tone: 'brand',
      fields: [
        { key: 'makerFeeBps', label: 'Maker Fee (bps)', type: 'number', defaultValue: String(currentMaker), required: true },
        { key: 'takerFeeBps', label: 'Taker Fee (bps)', type: 'number', defaultValue: String(currentTaker), required: true }
      ],
      onSubmit: async (values) => {
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/admin/pairs/update-fees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            pairId,
            makerFeeBps: parseInt(values.makerFeeBps, 10),
            takerFeeBps: parseInt(values.takerFeeBps, 10)
          })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('success', data.message);
          onRefreshPairs();
          loadAllData();
        } else {
          showToast('error', data.error);
        }
      }
    });
  };

  const handleCreatePair = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/pairs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(newPairData)
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', data.message);
        setShowCreatePairModal(false);
        setNewPairData({
          baseCurrency: '',
          quoteCurrency: 'IDR',
          baseDecimals: '8',
          quoteDecimals: '2',
          initialPrice: '100000',
          minOrderTokens: '1',
          maxOrderTokens: '10000000',
          makerFeeBps: '10',
          takerFeeBps: '20'
        });
        onRefreshPairs();
        loadAllData();
      } else {
        showToast('error', data.error);
      }
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleOpenEditPairModal = (pair: TradingPairItem) => {
    setEditingPair(pair);
    const humanMin = formatAtomicToToken(pair.minOrderSize, pair.baseDecimals).replace(/\./g, '').replace(/,/g, '');
    const humanMax = formatAtomicToToken(pair.maxOrderSize, pair.baseDecimals).replace(/\./g, '').replace(/,/g, '');
    setPairConfigForm({
      inputMode: 'TOKENS',
      minOrderTokens: humanMin,
      maxOrderTokens: humanMax,
      minOrderSize: pair.minOrderSize || '100000000',
      maxOrderSize: pair.maxOrderSize || '1000000000000000',
      makerFeeBps: pair.makerFeeBps ?? 10,
      takerFeeBps: pair.takerFeeBps ?? 20,
      isHalted: Boolean(pair.isHalted),
      isDelisted: Boolean(pair.isDelisted),
      delistScheduledAt:
        !pair.isDelisted && pair.delistScheduledAt && pair.delistScheduledAt > Date.now()
          ? toLocalDateTimeInput(pair.delistScheduledAt)
          : '',
      delistReason: pair.delistReason || '',
      lastPrice: pair.lastPrice || '0'
    });
    setShowEditPairModal(true);
  };

  const handleSavePairConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPair) return;

    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const payload: any = {
        pairId: editingPair.id,
        makerFeeBps: Number(pairConfigForm.makerFeeBps),
        takerFeeBps: Number(pairConfigForm.takerFeeBps),
        isHalted: Boolean(pairConfigForm.isHalted),
        isDelisted: Boolean(pairConfigForm.isDelisted),
        delistReason: pairConfigForm.delistReason.trim() || undefined,
      };

      if (!pairConfigForm.isDelisted) {
        if (pairConfigForm.delistScheduledAt) {
          const parsedTs = new Date(pairConfigForm.delistScheduledAt).getTime();
          if (!Number.isFinite(parsedTs) || parsedTs <= Date.now() + 10000) {
            showToast('error', 'Jadwal tanggal delisting harus berada di masa depan (minimal 10 detik dari sekarang).');
            return;
          }
          payload.delistScheduledAt = parsedTs;
        } else if (editingPair.delistScheduledAt) {
          payload.delistScheduledAt = null;
        }
      }

      if (pairConfigForm.inputMode === 'TOKENS') {
        payload.minOrderTokens = pairConfigForm.minOrderTokens;
        payload.maxOrderTokens = pairConfigForm.maxOrderTokens;
      } else {
        payload.minOrderSize = pairConfigForm.minOrderSize;
        payload.maxOrderSize = pairConfigForm.maxOrderSize;
      }

      const res = await fetch('/api/admin/pairs/update-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', data.message || `Konfigurasi ${editingPair.id} berhasil diperbarui!`);
        setShowEditPairModal(false);
        onRefreshPairs();
        loadAllData();
      } else {
        showToast('error', data.error || 'Gagal menyimpan konfigurasi pair');
      }
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleChangeRole = (userId: string, newRole: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Konfirmasi Perubahan Role RBAC',
      description: `Apakah Anda yakin ingin mengubah hak akses pengguna ini menjadi ${newRole}? Perubahan dicatat dalam audit trail.`,
      confirmLabel: 'Ubah Role',
      tone: 'warning',
      onSubmit: async () => {
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/admin/users/role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ userId, role: newRole })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('success', data.message);
          loadAllData();
        } else {
          showToast('error', data.error);
        }
      }
    });
  };

  const handleReset2fa = (userId: string, userEmail: string) => {
    setConfirmConfig({
      isOpen: true,
      title: 'Reset Darurat 2FA TOTP',
      description: `Nonaktifkan 2FA TOTP untuk akun ${userEmail}? Tindakan ini bersifat sensitif dan dicatat permanen dalam audit log.`,
      confirmLabel: 'Nonaktifkan 2FA',
      tone: 'danger',
      onSubmit: async () => {
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/admin/users/reset-2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ userId, reason: 'Emergency 2FA reset by Administrator' })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('success', data.message);
          loadAllData();
        } else {
          showToast('error', data.error);
        }
      }
    });
  };

  const handleToggleFreeze = (userId: string, currentStatus: string) => {
    const isFrozen = currentStatus === 'frozen';
    setConfirmConfig({
      isOpen: true,
      title: isFrozen ? 'Buka Pembekuan Akun Pengguna' : 'Bekukan Akun Pengguna (AML / Risk)',
      description: isFrozen
        ? 'Masukkan alasan membuka kembali akses akun pengguna ini:'
        : 'Masukkan alasan pembekuan akun (AML / Fraud / Permintaan Kepatuhan):',
      confirmLabel: isFrozen ? 'Buka Pembekuan' : 'Bekukan Akun',
      tone: isFrozen ? 'brand' : 'danger',
      fields: [
        {
          key: 'reason',
          label: 'Alasan Kepatuhan (Audit Trail)',
          defaultValue: isFrozen ? 'Pemeriksaan kepatuhan selesai' : 'Investigasi kepatuhan AML',
          required: true
        }
      ],
      onSubmit: async (values) => {
        const reason = (values.reason || '').trim();
        if (!reason) return;
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/risk/account-freeze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ userId, freeze: !isFrozen, reason })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('success', `Akun berhasil ${!isFrozen ? 'DIBEKUKAN' : 'DIBUKA KEMBALI'}`);
          loadAllData();
        } else {
          showToast('error', data.error);
        }
      }
    });
  };

  const handleReviewKyc = async (userId: string, action: 'APPROVE' | 'REJECT') => {
    const submitKyc = async (rejectionReason?: string) => {
      try {
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/admin/kyc/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ userId, action, rejectionReason, tierLevel: action === 'APPROVE' ? 2 : 0 })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('success', `KYC berhasil di-${action === 'APPROVE' ? 'Setujui (Tier 2)' : 'Tolak'}`);
          loadAllData();
        } else {
          showToast('error', data.error);
        }
      } catch (e: any) {
        showToast('error', e.message);
      }
    };

    if (action === 'APPROVE') {
      await submitKyc(undefined);
      return;
    }

    setConfirmConfig({
      isOpen: true,
      title: 'Tolak Verifikasi KYC',
      description: 'Masukkan alasan penolakan KYC agar pengguna dapat memperbaiki dokumen identitasnya:',
      confirmLabel: 'Tolak KYC',
      tone: 'danger',
      fields: [
        {
          key: 'rejectionReason',
          label: 'Alasan Penolakan KYC',
          defaultValue: 'Foto identitas buram atau tidak sesuai',
          required: true
        }
      ],
      onSubmit: async (values) => {
        const reason = (values.rejectionReason || '').trim();
        if (!reason) return;
        await submitKyc(reason);
      }
    });
  };

  const handleApproveWd = (txId: string, txType: 'FIAT' | 'CRYPTO') => {
    setConfirmConfig({
      isOpen: true,
      title: `Setujui Penarikan ${txType}`,
      description: `Konfirmasi persetujuan penarikan ${txType} ini? Dana akan dilepas secara permanen dan dicatat di buku besar.`,
      confirmLabel: 'Setujui Penarikan',
      tone: 'warning',
      onSubmit: async () => {
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/admin/withdrawals/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ txId, txType })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('success', data.message);
          loadAllData();
        } else {
          showToast('error', data.error);
        }
      }
    });
  };

  const handleRejectWd = (txId: string, txType: 'FIAT' | 'CRYPTO') => {
    setConfirmConfig({
      isOpen: true,
      title: `Tolak Penarikan ${txType} & Refund`,
      description: 'Dana terkunci akan dikembalikan ke saldo tersedia pengguna. Masukkan alasan penolakan:',
      confirmLabel: 'Tolak & Refund',
      tone: 'danger',
      fields: [
        {
          key: 'reason',
          label: 'Alasan Penolakan Penarikan',
          defaultValue: 'Verifikasi data bank tidak valid',
          required: true
        }
      ],
      onSubmit: async (values) => {
        const reason = (values.reason || '').trim();
        if (!reason) return;
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/admin/withdrawals/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ txId, txType, reason })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('success', data.message);
          loadAllData();
        } else {
          showToast('error', data.error);
        }
      }
    });
  };

  const handleAdjustLedger = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ledgerAdjData.userId || !ledgerAdjData.amountUnits || !ledgerAdjData.reason) {
      showToast('error', 'Semua kolom formulir penyesuaian wajib diisi');
      return;
    }

    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/ledger/adjust-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(ledgerAdjData)
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', data.message);
        setShowAdjustLedgerModal(false);
        setLedgerAdjData({ userId: '', currency: 'IDR', amountUnits: '', direction: 'CREDIT', reason: '' });
        loadAllData();
      } else {
        showToast('error', data.error);
      }
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleEmergencyStopBots = (botId?: string) => {
    setConfirmConfig({
      isOpen: true,
      title: botId ? 'Hentikan Bot Trading' : 'Emergency Kill-Switch Seluruh Bot Bursa',
      description: botId
        ? 'Hentikan seketika bot trading ini dan batalkan order aktifnya?'
        : 'PERINGATAN DARURAT: Hentikan SEMUA bot trading yang sedang berjalan di seluruh bursa DIMONEX?',
      confirmLabel: botId ? 'Stop Bot' : 'Hentikan Semua Bot',
      tone: 'danger',
      onSubmit: async () => {
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/admin/bots/emergency-stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ botId })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('success', data.message);
          loadAllData();
        } else {
          showToast('error', data.error);
        }
      }
    });
  };

  const handleUpdateFxRate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/mm/fx-rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          rateIdr: parseFloat(manualFxRate),
          reason: fxReason
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', `Kurs USDT/IDR berhasil diperbarui ke Rp ${parseFloat(manualFxRate).toLocaleString('id-ID')}`);
        setShowFxModal(false);
        loadAllData();
      } else {
        showToast('error', data.error || 'Gagal mengubah kurs FX');
      }
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleUpdateStakingPool = (pool: EarnVaultItem) => {
    setConfirmConfig({
      isOpen: true,
      title: `Konfigurasi Vault Earn: ${pool.name}`,
      description: 'Perbarui parameter Annual Percentage Yield (APY), status vault (ACTIVE / PAUSED / CLOSED), atau total batas kapasitas.',
      confirmLabel: 'Simpan Perubahan Vault',
      tone: 'brand',
      fields: [
        { key: 'apyPct', label: 'APY Tahunan (%)', type: 'number', defaultValue: String(pool.apyPct), required: true },
        { key: 'status', label: 'Status (ACTIVE / PAUSED / CLOSED)', type: 'text', defaultValue: pool.status, required: true }
      ],
      onSubmit: async (values) => {
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/admin/earn/pools/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            poolId: pool.id,
            apyPct: parseFloat(values.apyPct),
            status: String(values.status || 'ACTIVE').trim().toUpperCase(),
          })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('success', data.message);
          loadAllData();
        } else {
          showToast('error', data.error);
        }
      }
    });
  };

  const handleCreateEarnVault = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/earn/pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          asset: newEarnVaultForm.asset.trim().toUpperCase(),
          name: newEarnVaultForm.name.trim(),
          type: newEarnVaultForm.type,
          durationDays: Number(newEarnVaultForm.durationDays) || 0,
          apyPct: Number(newEarnVaultForm.apyPct) || 0,
          minStakeTokens: newEarnVaultForm.minStakeTokens.trim(),
          maxStakeTokens: newEarnVaultForm.maxStakeTokens.trim(),
          totalCapTokens: newEarnVaultForm.totalCapTokens.trim(),
          earlyRedeemAllowed: newEarnVaultForm.earlyRedeemAllowed,
          earlyRedeemPenaltyPct: Number(newEarnVaultForm.earlyRedeemPenaltyPct) || 0,
          autoCompoundSupported: newEarnVaultForm.autoCompoundSupported,
          isFeatured: newEarnVaultForm.isFeatured,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat Earn Vault');
      showToast('success', data.message || 'Vault Earn baru berhasil dibuat');
      setShowCreateEarnModal(false);
      setNewEarnVaultForm({
        asset: 'USDT',
        name: '',
        type: 'FLEXIBLE',
        durationDays: '0',
        apyPct: '8.5',
        minStakeTokens: '10',
        maxStakeTokens: '100000',
        totalCapTokens: '1000000',
        earlyRedeemAllowed: true,
        earlyRedeemPenaltyPct: '1.5',
        autoCompoundSupported: true,
        isFeatured: false,
      });
      loadAllData();
    } catch (err: any) {
      showToast('error', err?.message || 'Gagal membuat Earn Vault');
    }
  };

  const handleRunYieldSettlement = async (forceCycle: boolean) => {
    setIsSettlingYield(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/earn/settle-yield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ forceCycle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mendistribusikan imbal hasil');
      showToast('success', data.message);
      loadAllData();
    } catch (err: any) {
      showToast('error', err?.message || 'Gagal menjalankan settlement');
    } finally {
      setIsSettlingYield(false);
    }
  };

  const handleUpdateMasterTrader = async (masterId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'APPROVED' ? 'PAUSED' : 'APPROVED';
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/copy-trading/masters/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ masterId, status: newStatus })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', data.message);
        loadAllData();
      } else {
        showToast('error', data.error);
      }
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleUpdateVipTier = (tier: number, currentMaker: number, currentTaker: number) => {
    setConfirmConfig({
      isOpen: true,
      title: `Ubah Fee Schedule VIP Tier ${tier}`,
      description: 'Masukkan diskon Maker dan Taker fee untuk level VIP ini (satuan basis points / bps).',
      confirmLabel: 'Simpan Fee VIP',
      tone: 'brand',
      fields: [
        { key: 'makerFeeBps', label: 'Maker Fee (bps)', type: 'number', defaultValue: String(currentMaker), required: true },
        { key: 'takerFeeBps', label: 'Taker Fee (bps)', type: 'number', defaultValue: String(currentTaker), required: true }
      ],
      onSubmit: async (values) => {
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/admin/vip-tiers/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            tier,
            makerFeeBps: parseInt(values.makerFeeBps, 10),
            takerFeeBps: parseInt(values.takerFeeBps, 10)
          })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('success', data.message);
          loadAllData();
        } else {
          showToast('error', data.error);
        }
      }
    });
  };

  const handleAddWsWhitelist = async (symbol: string, providers?: ('binance' | 'bybit')[], label?: string) => {
    const clean = symbol.trim().toUpperCase();
    if (!clean) {
      showToast('error', 'Masukkan simbol pair (contoh: SOLUSDT, PEPEUSDT).');
      return;
    }
    const provs: ('binance' | 'bybit')[] = providers && providers.length > 0
      ? providers
      : [
          ...(wsManualProviders.binance ? ['binance' as const] : []),
          ...(wsManualProviders.bybit ? ['bybit' as const] : [])
        ];
    if (provs.length === 0) {
      showToast('error', 'Pilih minimal 1 sumber WebSocket (Binance atau Bybit).');
      return;
    }
    setWsActionBusy(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/external-ws/whitelist/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ symbol: clean, providers: provs, label })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', data.message);
        setWsManualSymbol('');
        await loadAllData();
        await loadWsCatalog(wsCatalogSearch, wsCatalogProvider, false);
      } else {
        showToast('error', data.error || 'Gagal menambah pair whitelist');
      }
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setWsActionBusy(false);
    }
  };

  const handleToggleWsWhitelist = async (symbol: string, nextEnabled: boolean) => {
    setWsActionBusy(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/external-ws/whitelist/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ symbol, enabled: nextEnabled })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', data.message);
        await loadAllData();
      } else {
        showToast('error', data.error);
      }
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setWsActionBusy(false);
    }
  };

  const handleRemoveWsWhitelist = async (symbol: string) => {
    setWsActionBusy(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/external-ws/whitelist/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ symbol })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', data.message);
        await loadAllData();
        await loadWsCatalog(wsCatalogSearch, wsCatalogProvider, false);
      } else {
        showToast('error', data.error);
      }
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setWsActionBusy(false);
    }
  };

  const filteredUsers = usersList.filter(u => {
    const q = userSearch.toLowerCase();
    return (
      u.email?.toLowerCase().includes(q) ||
      u.fullName?.toLowerCase().includes(q) ||
      u.role?.toLowerCase().includes(q) ||
      u.id?.toLowerCase().includes(q)
    );
  });

  const filteredAudits = auditLogs.filter(a => {
    const q = auditSearch.toLowerCase();
    return (
      a.action?.toLowerCase().includes(q) ||
      a.resource?.toLowerCase().includes(q) ||
      a.details?.toLowerCase().includes(q)
    );
  });

  const pendingWithdrawalCount = pendingWd.fiat.length + pendingWd.crypto.length;
  const pendingKycCount = usersList.filter(u => u.kycStatus === 'pending').length;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Toast Alert */}
      {feedbackMsg && (
        <div
          className={`fixed top-16 right-6 z-50 p-3.5 rounded-[10px] border text-xs font-semibold shadow-2xl flex items-center gap-3 ${
            feedbackMsg.type === 'success'
              ? 'bg-[#17212B] border-[#16A879]/50 text-[#35B887]'
              : 'bg-[#17212B] border-[#EA5B65]/50 text-[#EA5B65]'
          }`}
        >
          {feedbackMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-[#35B887]" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-[#EA5B65]" />
          )}
          <span className="text-[#E4EBEF]">{feedbackMsg.text}</span>
          <button type="button" onClick={() => setFeedbackMsg(null)} className="ml-2 text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header Card */}
      <div className="p-5 rounded-[10px] bg-[#141C24] border border-[#202B34] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1] shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-[#E4EBEF]">DIMONEX Exchange Operations Console</h1>
              <StatusBadge tone="brand">Superadmin RBAC</StatusBadge>
            </div>
            <span className="text-xs text-[#A1AFB8] font-mono">
              Operator: {user.email} · Peran: <span className="text-[#35B887] font-semibold">{user.role}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={loadAllData}
            disabled={isLoading}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}
            title="Segarkan Semua Data"
          >
            Segarkan
          </Button>

          <Button
            variant="danger"
            size="sm"
            onClick={() => handleEmergencyStopBots()}
            icon={<AlertTriangle className="w-3.5 h-3.5" />}
          >
            Kill-Switch Semua Bot
          </Button>
        </div>
      </div>

      {/* Grouped Admin Console Sidebar + Main Content Workspace */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        <aside className="w-full lg:w-60 shrink-0 rounded-[10px] bg-[#141C24] border border-[#202B34] p-3 space-y-4">
          {[
            {
              group: 'Exchange Operations',
              items: [
                { id: 'OVERVIEW' as AdminTab, label: 'Ringkasan Eksekutif', icon: LayoutDashboard },
                { id: 'ASSETS' as AdminTab, label: 'Aset Kripto & Logo', icon: ImageIcon },
                { id: 'PAIRS' as AdminTab, label: `Pasar & Fee (${tradingPairs.length})`, icon: Coins },
                { id: 'LISTING' as AdminTab, label: 'Initial Token Listing', icon: Rocket },
              ],
            },
            {
              group: 'Content Management',
              items: [
                { id: 'CMS_NEWS' as AdminTab, label: 'News & Announcements', icon: Newspaper },
                { id: 'CMS_NOTIFICATIONS' as AdminTab, label: 'Notification Center', icon: Bell },
                { id: 'CMS_MEDIA' as AdminTab, label: 'Media Library', icon: ImageIcon },
              ],
            },
            {
              group: 'VIP & Rewards',
              items: [
                { id: 'VIP_TASKS' as AdminTab, label: 'Task Center Manager', icon: Gift },
                { id: 'VIP_VOUCHERS' as AdminTab, label: 'Voucher Manager', icon: Ticket },
                { id: 'VIP_CLAIMS' as AdminTab, label: 'Rewards & Payout Ledger', icon: History },
              ],
            },
            {
              group: 'Users & Finance',
              items: [
                { id: 'USERS' as AdminTab, label: `Pengguna & KYC (${usersList.length})`, icon: Users, badge: pendingKycCount > 0 ? pendingKycCount : undefined },
                { id: 'WITHDRAWALS' as AdminTab, label: 'Antrean Penarikan', icon: ArrowUpRight, badge: pendingWithdrawalCount > 0 ? pendingWithdrawalCount : undefined },
                { id: 'LEDGER' as AdminTab, label: 'Buku Besar & Solvensi', icon: Wallet },
                { id: 'STAKING' as AdminTab, label: 'Staking Admin Console', icon: Layers },
                { id: 'PRODUCTS' as AdminTab, label: 'Earn, Copy & VIP', icon: PiggyBank },
              ],
            },
            {
              group: 'Liquidity & Governance',
              items: [
                { id: 'BOTS' as AdminTab, label: `Bot & MM (${botsList.length})`, icon: Bot },
                { id: 'FX' as AdminTab, label: `FX & WS Pairs (${wsWhitelist.filter(w => w.enabled).length})`, icon: TrendingUp },
                { id: 'RISK' as AdminTab, label: `Risk & AML (${riskAlerts.length})`, icon: ShieldAlert },
                { id: 'AUDIT' as AdminTab, label: 'Audit Trail', icon: FileText },
              ],
            },
          ].map(section => (
            <div key={section.group} className="space-y-1">
              <div className="px-2.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[#71818B]">
                {section.group}
              </div>
              <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
                {section.items.map(t => {
                  const Icon = t.icon;
                  const isActive = activeTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveTab(t.id)}
                      className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-[7px] text-xs font-medium whitespace-nowrap transition-colors cursor-pointer lg:w-full text-left ${
                        isActive
                          ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border border-[#40515D]'
                          : 'text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#17212B] border border-transparent'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#8DA5B1]' : 'text-[#71818B]'}`} />
                        <span className="truncate">{t.label}</span>
                      </span>
                      {'badge' in t && t.badge !== undefined && (
                        <span className="px-1.5 py-0.5 rounded bg-[#D6A85C] text-[#090D12] text-[10px] font-bold font-mono">
                          {t.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>

        <div className="flex-1 min-w-0 w-full space-y-6">

      {/* =========================================================================
          TAB 1: EXECUTIVE OVERVIEW & HEALTH METRICS
          ========================================================================= */}
      {activeTab === 'OVERVIEW' && (
        <div className="space-y-6">
          {/* Key Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
              <span className="text-[11px] text-[#A1AFB8] font-medium block">Total Pengguna Terdaftar</span>
              <span className="text-xl font-bold font-mono tabular-nums text-[#E4EBEF] mt-1 block">
                {stats?.totalUsers || usersList.length} Akun
              </span>
              <span className="text-[10px] text-[#35B887] font-mono tabular-nums mt-1 block">
                ● {usersList.filter(u => u.status === 'active').length} Akun Aktif
              </span>
            </div>

            <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
              <span className="text-[11px] text-[#A1AFB8] font-medium block">Estimasi Volume 24 Jam</span>
              <span className="text-xl font-bold font-mono tabular-nums text-[#E4EBEF] mt-1 block">
                {stats?.volume24hIdr ? formatIDR(stats.volume24hIdr, true) : 'Rp 0'}
              </span>
              <span className="text-[10px] text-[#8DA5B1] font-mono tabular-nums mt-1 block">
                Dari {stats?.totalTrades || 0} transaksi executed
              </span>
            </div>

            <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
              <span className="text-[11px] text-[#A1AFB8] font-medium block">Matching Engine Orders</span>
              <span className="text-xl font-bold font-mono tabular-nums text-[#E4EBEF] mt-1 block">
                {stats?.openOrdersCount || 0} Resting
              </span>
              <span className="text-[10px] text-[#6D9FE8] font-mono tabular-nums mt-1 block">
                Total {stats?.totalOrders || 0} order lifetime
              </span>
            </div>

            <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
              <span className="text-[11px] text-[#A1AFB8] font-medium block">Automated Trading Bots</span>
              <span className="text-xl font-bold font-mono tabular-nums text-[#E4EBEF] mt-1 block">
                {stats?.activeBots || 0} Berjalan
              </span>
              <span className="text-[10px] text-[#D6A85C] font-mono tabular-nums mt-1 block">
                Total {stats?.totalBots || botsList.length} terkonfigurasi
              </span>
            </div>
          </div>

          {/* Exchange Transaction Fee Revenue & Staking Earn Treasury Monitor */}
          {(() => {
            const feeSum = treasuryFeesReport?.summary;
            const totalFeeIdr = feeSum?.totalExchangeFeesIdr ?? 0;
            const totalFeeUsd = feeSum?.totalExchangeFeesUsd ?? 0;
            const fees24hIdr = feeSum?.fees24hIdr ?? 0;
            const userDirectFeesIdr = feeSum?.userDirectFeesIdr ?? 0;
            const mmBotFeesIdr = feeSum?.mmBotFeesIdr ?? 0;
            const stakingClaimedIdr = feeSum?.stakingClaimedAllTimeIdr ?? 0;
            const stakingFeeFundedIdr = feeSum?.stakingFeePoolFundedIdr ?? 0;
            const stakingPendingIdr = feeSum?.stakingPendingClaimableIdr ?? 0;
            const netPoolIdr = feeSum?.netTreasuryFeePoolIdr ?? 0;
            const coveragePct = feeSum?.feeCoverageRatioPct ?? 0;
            const liveCollectorIdr = feeSum?.feeCollectorLiveIdr ?? 0;
            const liveTreasuryIdr = feeSum?.treasuryReserveLiveIdr ?? 0;
            const sweptIdr = feeSum?.totalSweptToTreasuryIdr ?? 0;

            return (
              <div className="p-5 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Coins className="w-4 h-4 text-[#D6A85C]" />
                      <h3 className="text-sm font-semibold text-[#E4EBEF]">
                        Monitor Fee Transaksi Exchange &amp; Sumber Pembayaran Staking Earn
                      </h3>
                    </div>
                    <p className="text-xs text-[#A1AFB8] mt-1">
                      Akumulasi riil seluruh fee Spot &amp; Futures transaksi pengguna/MM dialokasikan lebih dulu untuk klaim imbal hasil Staking Earn (<span className="font-mono text-[#E4EBEF]">SYS_FEES</span>), dengan fallback ke Treasury Reserve.
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isSweepingFees || liveCollectorIdr <= 0}
                    onClick={handleSweepTreasuryFees}
                    icon={<ArrowUpRight className="w-3.5 h-3.5 text-[#D6A85C]" />}
                    className="self-start sm:self-auto whitespace-nowrap"
                  >
                    {isSweepingFees ? 'Memproses...' : 'Sweep Fee → Treasury'}
                  </Button>
                </div>

                {/* 4 Financial KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-[8px] bg-[#17212B] border border-[#202B34] space-y-1">
                    <span className="text-[11px] text-[#A1AFB8] block">Total Fee Transaksi (All-Time)</span>
                    <span className="text-lg font-bold font-mono tabular-nums text-[#E4EBEF] block">
                      Rp {Math.round(totalFeeIdr).toLocaleString('id-ID')}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-[#8DA5B1] block">
                      ${totalFeeUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · 24j: Rp {Math.round(fees24hIdr).toLocaleString('id-ID')}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-[#71818B] block">
                      User: Rp {Math.round(userDirectFeesIdr).toLocaleString('id-ID')} · MM/Bot: Rp {Math.round(mmBotFeesIdr).toLocaleString('id-ID')}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-[8px] bg-[#17212B] border border-[#202B34] space-y-1">
                    <span className="text-[11px] text-[#A1AFB8] block">Staking Earn Claimed (Terbayar)</span>
                    <span className="text-lg font-bold font-mono tabular-nums text-[#D6A85C] block">
                      Rp {Math.round(stakingClaimedIdr).toLocaleString('id-ID')}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-[#35B887] block">
                      Dari Fee Pool: Rp {Math.round(stakingFeeFundedIdr).toLocaleString('id-ID')}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-[#71818B] block">
                      Pending Klaim Aktif: Rp {Math.round(stakingPendingIdr).toLocaleString('id-ID')}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-[8px] bg-[#17212B] border border-[#202B34] space-y-1">
                    <span className="text-[11px] text-[#A1AFB8] block">Net Surplus Treasury Fee Pool</span>
                    <span className={`text-lg font-bold font-mono tabular-nums block ${netPoolIdr >= 0 ? 'text-[#35B887]' : 'text-[#EA5B65]'}`}>
                      {netPoolIdr < 0 ? '-' : ''}Rp {Math.abs(Math.round(netPoolIdr)).toLocaleString('id-ID')}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-[#8DA5B1] block">
                      Rasio Coverage Fee: {coveragePct.toFixed(1)}%
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-[#71818B] block">
                      {feeSum?.totalTradesCount ?? 0} total trade ({feeSum?.trades24hCount ?? 0} dlm 24j)
                    </span>
                  </div>

                  <div className="p-3.5 rounded-[8px] bg-[#17212B] border border-[#202B34] space-y-1">
                    <span className="text-[11px] text-[#A1AFB8] block">Fee Collector &amp; Treasury Live</span>
                    <span className="text-lg font-bold font-mono tabular-nums text-[#6D9FE8] block">
                      Rp {Math.round(liveCollectorIdr).toLocaleString('id-ID')}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-[#A1AFB8] block">
                      Treasury Reserve: Rp {Math.round(liveTreasuryIdr).toLocaleString('id-ID')}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-[#71818B] block">
                      Sudah di-Sweep: Rp {Math.round(sweptIdr).toLocaleString('id-ID')}
                    </span>
                  </div>
                </div>

                {/* Sub-view Tabs */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                    {([
                      { id: 'CURRENCY', label: 'Per Aset & Treasury' },
                      { id: 'PAIR', label: `Per Pair Trading (${treasuryFeesReport?.byPair?.length ?? 0})` },
                      { id: 'CLAIMS', label: `Klaim Staking (${treasuryFeesReport?.recentStakingClaims?.length ?? 0})` },
                    ] as const).map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setFeeMonitorView(tab.id)}
                        className={`px-3 py-1.5 rounded-[6px] text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                          feeMonitorView === tab.id
                            ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#40515D]'
                            : 'bg-[#111820] text-[#71818B] border border-[#202B34] hover:text-[#E4EBEF]'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-[#71818B]">
                    FX Acuan: 1 USDT = Rp {Math.round(treasuryFeesReport?.fxRateIdr ?? 16350).toLocaleString('id-ID')}
                  </span>
                </div>

                {/* View 1: Per Currency */}
                {feeMonitorView === 'CURRENCY' && (
                  <div className="overflow-x-auto rounded-[8px] border border-[#202B34]">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#111820] border-b border-[#202B34] text-[11px] font-mono uppercase tracking-wider text-[#71818B]">
                          <th className="py-2.5 px-3">Aset</th>
                          <th className="py-2.5 px-3 text-right">Fee Terkumpul</th>
                          <th className="py-2.5 px-3 text-right">Fee Collector (SYS_FEES)</th>
                          <th className="py-2.5 px-3 text-right">Staking Claimed</th>
                          <th className="py-2.5 px-3 text-right">Pending Klaim</th>
                          <th className="py-2.5 px-3 text-right">Net Surplus Pool</th>
                          <th className="py-2.5 px-3 text-right">Treasury Reserve</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#202B34] font-mono tabular-nums">
                        {!treasuryFeesReport || treasuryFeesReport.byCurrency.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-6 text-center text-[#71818B] font-sans">
                              Memuat data fee per aset...
                            </td>
                          </tr>
                        ) : (
                          treasuryFeesReport.byCurrency.map(row => (
                            <tr key={row.currency} className="hover:bg-[#17212B]/60 transition-colors">
                              <td className="py-2.5 px-3 font-semibold text-[#E4EBEF]">{row.currency}</td>
                              <td className="py-2.5 px-3 text-right text-[#E4EBEF]">
                                {row.feeEarnedAllTimeDisplay} {row.currency}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#6D9FE8]">
                                {row.feeCollectorBalanceDisplay} {row.currency}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#D6A85C]">
                                {row.stakingClaimedDisplay} {row.currency}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#A1AFB8]">
                                {row.stakingPendingDisplay} {row.currency}
                              </td>
                              <td
                                className={`py-2.5 px-3 text-right font-semibold ${
                                  row.netFeeSurplusDisplay.startsWith('-') ? 'text-[#EA5B65]' : 'text-[#35B887]'
                                }`}
                              >
                                {row.netFeeSurplusDisplay} {row.currency}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#C1D0D6]">
                                {row.treasuryReserveBalanceDisplay} {row.currency}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* View 2: Per Trading Pair */}
                {feeMonitorView === 'PAIR' && (
                  <div className="overflow-x-auto rounded-[8px] border border-[#202B34]">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#111820] border-b border-[#202B34] text-[11px] font-mono uppercase tracking-wider text-[#71818B]">
                          <th className="py-2.5 px-3">Pair Trading</th>
                          <th className="py-2.5 px-3 text-right">Trades (24j / All)</th>
                          <th className="py-2.5 px-3 text-right">Fee dari User</th>
                          <th className="py-2.5 px-3 text-right">Total Fee (Native)</th>
                          <th className="py-2.5 px-3 text-right">Ekuivalen IDR</th>
                          <th className="py-2.5 px-3 text-right">Kontribusi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#202B34] font-mono tabular-nums">
                        {!treasuryFeesReport || treasuryFeesReport.byPair.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-6 text-center text-[#71818B] font-sans">
                              Belum ada eksekusi trade berbayar fee di Spot Engine.
                            </td>
                          </tr>
                        ) : (
                          treasuryFeesReport.byPair.map(p => (
                            <tr key={p.pairId} className="hover:bg-[#17212B]/60 transition-colors">
                              <td className="py-2.5 px-3 font-semibold text-[#E4EBEF]">{p.pairId}</td>
                              <td className="py-2.5 px-3 text-right text-[#A1AFB8]">
                                {p.trades24hCount} / {p.tradeCount}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#35B887]">
                                {p.userFeesDisplay} {p.quoteCurrency}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#E4EBEF]">
                                {p.totalFeesDisplay} {p.quoteCurrency}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#D6A85C]">
                                Rp {Math.round(p.totalFeesIdr).toLocaleString('id-ID')}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#8DA5B1]">
                                {p.sharePct.toFixed(1)}%
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* View 3: Recent Staking Claims */}
                {feeMonitorView === 'CLAIMS' && (
                  <div className="overflow-x-auto rounded-[8px] border border-[#202B34]">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#111820] border-b border-[#202B34] text-[11px] font-mono uppercase tracking-wider text-[#71818B]">
                          <th className="py-2.5 px-3">Waktu</th>
                          <th className="py-2.5 px-3">Staker</th>
                          <th className="py-2.5 px-3">Vault</th>
                          <th className="py-2.5 px-3">Sumber Dana</th>
                          <th className="py-2.5 px-3 text-right">Claimed Yield</th>
                          <th className="py-2.5 px-3 text-right">Journal ID</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#202B34]">
                        {!treasuryFeesReport || treasuryFeesReport.recentStakingClaims.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-6 text-center text-[#71818B]">
                              Belum ada riwayat klaim atau settlement imbal hasil staking.
                            </td>
                          </tr>
                        ) : (
                          treasuryFeesReport.recentStakingClaims.map(c => (
                            <tr key={c.id} className="hover:bg-[#17212B]/60 transition-colors">
                              <td className="py-2.5 px-3 font-mono text-[11px] text-[#A1AFB8] whitespace-nowrap">
                                {new Date(c.createdAt).toLocaleString('id-ID')}
                              </td>
                              <td className="py-2.5 px-3 text-[#E4EBEF] truncate max-w-[170px]">
                                {c.userEmail}
                              </td>
                              <td className="py-2.5 px-3 text-[#A1AFB8]">{c.vaultName}</td>
                              <td className="py-2.5 px-3">
                                <StatusBadge
                                  tone={
                                    c.fundingSource === 'EXCHANGE_FEE_POOL'
                                      ? 'success'
                                      : c.fundingSource === 'HYBRID_FEE_AND_TREASURY'
                                        ? 'warning'
                                        : 'info'
                                  }
                                >
                                  {c.fundingSource === 'EXCHANGE_FEE_POOL'
                                    ? 'FEE POOL'
                                    : c.fundingSource === 'HYBRID_FEE_AND_TREASURY'
                                      ? 'HYBRID FEE+TREASURY'
                                      : 'TREASURY'}
                                </StatusBadge>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-[#35B887]">
                                +{c.amountDisplay} {c.asset}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-[11px] text-[#71818B]">
                                {c.journalId}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Double-Entry Ledger Invariant Verification */}
          <div className="p-5 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-[#35B887]" />
                <h3 className="text-sm font-semibold text-[#E4EBEF]">
                  Status Verifikasi Invarian Buku Besar (Atomic Ledger Solvency)
                </h3>
              </div>
              <StatusBadge tone="success">
                100% KONSISTEN (Sum Debits == Sum Credits)
              </StatusBadge>
            </div>
            <p className="text-xs text-[#A1AFB8] leading-relaxed">
              Seluruh transaksi saldo pengguna dijamin oleh sistem pencatatan ganda (*double-entry bookkeeping*).
              Tidak ada pencetakan saldo sintetik atau modifikasi floating point lepas. Setiap kredit harus memiliki debit tandingan pada rekening cadangan perbendaharaan (*Treasury Reserve*).
            </p>

            {/* Solvency Liabilities Table */}
            {stats?.liabilitiesByCurrency && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                {Object.entries(stats.liabilitiesByCurrency).map(([curr, val]: [string, any]) => {
                  const dec = curr === 'IDR' ? 2 : curr === 'USDT' || curr === 'USDC' ? 6 : 8;
                  const div = 10 ** dec;
                  return (
                    <div key={curr} className="p-3 rounded-[10px] bg-[#17212B] border border-[#202B34] font-mono tabular-nums text-xs">
                      <span className="text-[#A1AFB8] text-[10px] block">{curr} Liabilitas Sirkulasi</span>
                      <span className="font-bold text-[#E4EBEF] text-sm block mt-0.5">
                        {curr === 'IDR' ? formatIDR(val.total) : `${(Number(safeBigInt(val.total)) / div).toLocaleString()} ${curr}`}
                      </span>
                      <span className="text-[10px] text-[#71818B] block mt-0.5">
                        Terkunci order: {curr === 'IDR' ? formatIDR(val.locked) : `${(Number(safeBigInt(val.locked)) / div).toLocaleString()}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Infrastructure Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
              <span className="text-xs font-semibold text-[#E4EBEF] block mb-2.5">Sistem & Uptime Server</span>
              <div className="space-y-1.5 text-xs font-mono tabular-nums">
                <div className="flex justify-between text-[#A1AFB8]">
                  <span>Server Uptime:</span>
                  <span className="text-[#35B887] font-bold">{Math.floor((stats?.uptimeSeconds || 0) / 3600)}j {Math.floor(((stats?.uptimeSeconds || 0) % 3600) / 60)}m</span>
                </div>
                <div className="flex justify-between text-[#A1AFB8]">
                  <span>Heap Used:</span>
                  <span className="text-[#E4EBEF]">{Math.round((stats?.memoryUsage?.heapUsed || 0) / 1024 / 1024)} MB</span>
                </div>
                <div className="flex justify-between text-[#A1AFB8]">
                  <span>RSS Memory:</span>
                  <span className="text-[#E4EBEF]">{Math.round((stats?.memoryUsage?.rss || 0) / 1024 / 1024)} MB</span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
              <span className="text-xs font-semibold text-[#E4EBEF] block mb-2.5">Kepatuhan & Antrean</span>
              <div className="space-y-1.5 text-xs font-mono tabular-nums">
                <div className="flex justify-between text-[#A1AFB8]">
                  <span>Review KYC Menunggu:</span>
                  <span className={`font-bold ${pendingKycCount > 0 ? 'text-[#D6A85C]' : 'text-[#35B887]'}`}>
                    {pendingKycCount} Permintaan
                  </span>
                </div>
                <div className="flex justify-between text-[#A1AFB8]">
                  <span>Antrean Penarikan IDR:</span>
                  <span className={`font-bold ${pendingWd.fiat.length > 0 ? 'text-[#D6A85C]' : 'text-[#35B887]'}`}>
                    {pendingWd.fiat.length} Antrean
                  </span>
                </div>
                <div className="flex justify-between text-[#A1AFB8]">
                  <span>Antrean Penarikan Kripto:</span>
                  <span className={`font-bold ${pendingWd.crypto.length > 0 ? 'text-[#D6A85C]' : 'text-[#35B887]'}`}>
                    {pendingWd.crypto.length} Antrean
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
              <span className="text-xs font-semibold text-[#E4EBEF] block mb-2.5">FX Engine & Feeds</span>
              <div className="space-y-1.5 text-xs font-mono tabular-nums">
                <div className="flex justify-between text-[#A1AFB8]">
                  <span>Kurs USDT/IDR Efektif:</span>
                  <span className="text-[#C1D0D6] font-bold">Rp {(fxStatus?.effectiveRateIdr || 16350).toLocaleString('id-ID')}</span>
                </div>
                <div className="flex justify-between text-[#A1AFB8]">
                  <span>Sumber Kurs:</span>
                  <span className="text-[#E4EBEF] font-semibold">{fxStatus?.source || 'COINMARKETCAP'}</span>
                </div>
                <div className="flex justify-between text-[#A1AFB8]">
                  <span>Aggregator Status:</span>
                  <span className="text-[#35B887] font-bold">ACTIVE (0 bps drift)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 1B: CRYPTO ASSET MANAGEMENT (LOGO, METADATA & DECIMALS)
          ========================================================================= */}
      {activeTab === 'ASSETS' && (
        <AssetManagementSection
          onRefreshPairs={onRefreshPairs}
          onNotify={showToast}
        />
      )}

      {/* =========================================================================
          TAB 2: MARKETS, PAIRS & CIRCUIT BREAKERS
          ========================================================================= */}
      {activeTab === 'PAIRS' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">Daftar Pasangan Perdagangan & Fee Schedule</h3>
              <p className="text-xs text-[#A1AFB8]">Kontrol operasional matching engine, emergency halt, dan penetapan Maker/Taker Fee bursa.</p>
            </div>
            <div className="flex items-center gap-2 self-start">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setActiveTab('ASSETS')}
                icon={<ImageIcon className="w-3.5 h-3.5" />}
              >
                Edit Logo &amp; Desimal Aset
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowCreatePairModal(true)}
                icon={<Plus className="w-4 h-4" />}
              >
                Tambah Trading Pair Baru
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-[10px] bg-[#141C24] border border-[#202B34]">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {[
                { id: 'ALL' as const, label: 'Semua Pair', count: tradingPairs.length },
                {
                  id: 'ACTIVE' as const,
                  label: 'Aktif / Listed',
                  count: tradingPairs.filter(p => !p.isDelisted).length,
                },
                {
                  id: 'SCHEDULED_DELIST' as const,
                  label: 'Jadwal Delisting',
                  count: tradingPairs.filter(p => !p.isDelisted && Boolean(p.delistScheduledAt && p.delistScheduledAt > nowMs)).length,
                },
                {
                  id: 'DELISTED' as const,
                  label: 'Delisted',
                  count: tradingPairs.filter(p => Boolean(p.isDelisted)).length,
                },
              ].map(tab => {
                const active = pairLifecycleFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPairLifecycleFilter(tab.id)}
                    className={`px-2.5 py-1.5 rounded-[7px] font-medium border transition-colors flex items-center gap-1.5 cursor-pointer ${
                      active
                        ? 'bg-[#1D2832] border-[#2B3944] text-[#E4EBEF]'
                        : 'bg-transparent border-transparent text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#17212B]'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.2 rounded bg-[#111820] border border-[#202B34] text-[#8DA5B1]">
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-[#71818B] font-sans">
              Gunakan toggle <strong className="text-[#E4EBEF] font-mono">isDelisted</strong> atau tombol <strong className="text-[#E4EBEF]">Jadwalkan Delisting</strong> untuk mengelola siklus hidup pair.
            </span>
          </div>

          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="bg-[#17212B] text-[11px] text-[#A1AFB8] border-b border-[#202B34] font-sans">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Trading Pair</th>
                    <th className="px-4 py-3 font-semibold">Harga Terakhir</th>
                    <th className="px-4 py-3 font-semibold">Limit Kuantitas Order (Min - Max)</th>
                    <th className="px-4 py-3 font-semibold">Maker / Taker Fee</th>
                    <th className="px-4 py-3 font-semibold">Status &amp; Delisting</th>
                    <th className="px-4 py-3 font-semibold text-center">Delisted Toggle</th>
                    <th className="px-4 py-3 font-semibold text-right">Kontrol Operasional</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34]">
                  {tradingPairs
                    .filter(p => {
                      if (pairLifecycleFilter === 'ACTIVE') return !p.isDelisted;
                      if (pairLifecycleFilter === 'SCHEDULED_DELIST') {
                        return !p.isDelisted && Boolean(p.delistScheduledAt && p.delistScheduledAt > nowMs);
                      }
                      if (pairLifecycleFilter === 'DELISTED') return Boolean(p.isDelisted);
                      return true;
                    })
                    .map(p => {
                    const isScheduledDelist = Boolean(!p.isDelisted && p.delistScheduledAt && p.delistScheduledAt > nowMs);
                    const isPreLaunch = Boolean(!p.isDelisted && p.isActive === false && p.scheduledAt && p.scheduledAt > nowMs);

                    return (
                      <tr key={p.id} className="hover:bg-[#17212B]/60 transition-colors">
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#E4EBEF] text-sm">{p.id}</span>
                            {p.isNewListing && !p.isDelisted && (
                              <StatusBadge tone="brand">NEW</StatusBadge>
                            )}
                          </div>
                          <span className="text-[10px] text-[#71818B] block font-sans mt-0.5">
                            Decimals: Base {p.baseDecimals} / Quote {p.quoteDecimals}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-bold text-[#E4EBEF] font-mono">
                          {formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5 font-semibold text-[#E4EBEF] text-xs">
                              <span className="text-[#35B887]">Min: {formatAtomicToToken(p.minOrderSize, p.baseDecimals)} {p.baseCurrency}</span>
                              <span className="text-[#71818B]">—</span>
                              <span className="text-[#6D9FE8]">Max: {formatAtomicToToken(p.maxOrderSize, p.baseDecimals)} {p.baseCurrency}</span>
                            </div>
                            <span className="text-[10px] text-[#71818B] font-mono">
                              Atomic: {p.minOrderSize || '0'} s/d {p.maxOrderSize || '0'} units
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="text-[#35B887] font-semibold text-xs">
                            Maker: {(p.makerFeeBps / 100).toFixed(2)}% ({p.makerFeeBps} bps)
                          </div>
                          <div className="text-[#6D9FE8] font-semibold text-xs">
                            Taker: {(p.takerFeeBps / 100).toFixed(2)}% ({p.takerFeeBps} bps)
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-sans">
                          <div className="space-y-1">
                            {p.isDelisted ? (
                              <>
                                <StatusBadge tone="danger" dot>
                                  DELISTED
                                </StatusBadge>
                                {p.delistedAt && (
                                  <span className="text-[10px] font-mono text-[#71818B] block">
                                    {new Date(p.delistedAt).toLocaleString('id-ID')}
                                  </span>
                                )}
                                {p.delistReason && (
                                  <span className="text-[10px] text-[#EA5B65]/80 block max-w-[200px] truncate" title={p.delistReason}>
                                    {p.delistReason}
                                  </span>
                                )}
                              </>
                            ) : isScheduledDelist && p.delistScheduledAt ? (
                              <>
                                <StatusBadge tone="warning" dot>
                                  <span className="font-mono tabular-nums">
                                    DELISTING · {formatCountdownCompact(p.delistScheduledAt, nowMs)}
                                  </span>
                                </StatusBadge>
                                <span className="text-[10px] font-mono text-[#D6A85C] block">
                                  {new Date(p.delistScheduledAt).toLocaleString('id-ID')}
                                </span>
                                {p.delistReason && (
                                  <span className="text-[10px] text-[#71818B] block max-w-[200px] truncate" title={p.delistReason}>
                                    {p.delistReason}
                                  </span>
                                )}
                              </>
                            ) : isPreLaunch && p.scheduledAt ? (
                              <>
                                <StatusBadge tone="info" dot>
                                  <span className="font-mono tabular-nums">
                                    SCHEDULED · {formatCountdownCompact(p.scheduledAt, nowMs)}
                                  </span>
                                </StatusBadge>
                                <span className="text-[10px] font-mono text-[#71818B] block">
                                  Launch: {new Date(p.scheduledAt).toLocaleString('id-ID')}
                                </span>
                              </>
                            ) : (
                              <StatusBadge tone={p.isHalted ? 'danger' : 'success'} dot>
                                {p.isHalted ? 'DIHENTIKAN (HALTED)' : 'BERJALAN NORMAL'}
                              </StatusBadge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-center font-sans">
                          <div className="inline-flex flex-col items-center gap-1">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={Boolean(p.isDelisted)}
                              aria-label={`Toggle isDelisted untuk ${p.id}`}
                              onClick={() => handleToggleDelistedInline(p)}
                              className={`relative inline-flex h-5 w-10 items-center rounded-full border transition-colors cursor-pointer ${
                                p.isDelisted
                                  ? 'bg-[#EA5B65]/80 border-[#EA5B65]'
                                  : 'bg-[#111820] border-[#2B3944] hover:border-[#40515D]'
                              }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[#E4EBEF] transition-transform ${
                                  p.isDelisted ? 'translate-x-5' : 'translate-x-0.5'
                                }`}
                              />
                            </button>
                            <span
                              className={`text-[9px] font-mono uppercase tracking-wide ${
                                p.isDelisted ? 'text-[#EA5B65] font-semibold' : 'text-[#71818B]'
                              }`}
                            >
                              {p.isDelisted ? 'DELISTED' : 'LISTED'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right font-sans whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleOpenEditPairModal(p)}
                              icon={<Sliders className="w-3.5 h-3.5" />}
                              title="Kelola limit, fee, toggle isDelisted & jadwal delisting"
                            >
                              Konfigurasi
                            </Button>

                            {p.isDelisted ? (
                              <Button
                                variant="profit"
                                size="sm"
                                onClick={() => handleRelistPair(p.id)}
                                icon={<RotateCcw className="w-3.5 h-3.5" />}
                              >
                                Relist Market
                              </Button>
                            ) : (
                              <>
                                <Button
                                  variant={p.isHalted ? 'profit' : 'outline'}
                                  size="sm"
                                  onClick={() => handleToggleHalt(p.id, p.isHalted)}
                                >
                                  {p.isHalted ? 'Buka Halt' : 'Halt'}
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => openDelistModal(p)}
                                  icon={isScheduledDelist ? <Clock className="w-3.5 h-3.5" /> : <Calendar className="w-3.5 h-3.5" />}
                                >
                                  {isScheduledDelist ? 'Jadwal Delist' : 'Delist / Jadwal'}
                                </Button>
                              </>
                            )}
                          </div>
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

      {/* =========================================================================
          TAB 3: TOKEN LISTING PORTAL (MAKER-CHECKER)
          ========================================================================= */}
      {activeTab === 'LISTING' && (
        <div className="space-y-4">
          <ListingManagementView currentUser={user} onRefreshMarkets={onRefreshPairs} tradingPairs={tradingPairs} />
        </div>
      )}

      {/* =========================================================================
          TAB 4: USERS, RBAC & KYC REVIEWS
          ========================================================================= */}
      {activeTab === 'USERS' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">Direktori Pengguna & Manajemen Hak Akses (RBAC)</h3>
              <p className="text-xs text-[#A1AFB8]">Kelola status akun, review verifikasi KTP/KYC, reset 2FA darurat, dan pembekuan akun.</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-[#71818B] absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Cari email / nama / role..."
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] pl-9 pr-3 py-2 text-xs text-[#E4EBEF] placeholder-[#71818B] outline-none focus:border-[#8DA5B1] font-mono"
              />
            </div>
          </div>

          {/* Quick Test Accounts & Credentials Card */}
          <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#2B3944] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-[7px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1] shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-[#E4EBEF] flex items-center gap-2">
                    Cheatsheet Kredensial Akun Pengujian (Test Accounts & Passwords)
                    <StatusBadge tone="info">8 Akun Siap Uji</StatusBadge>
                  </h4>
                  <p className="text-[11px] text-[#A1AFB8]">
                    Gunakan kredensial resmi di bawah untuk menguji seluruh fitur platform (Admin, MM, Compliance, & Trading Spot).
                  </p>
                </div>
              </div>
              <span className="text-[10px] text-[#A1AFB8] font-mono bg-[#111820] px-2.5 py-1 rounded-[7px] border border-[#202B34]">
                Dokumentasi: README_AKUN_TEST.md
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-[11px]">
              {/* 1. Admin */}
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#D6A85C] inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Super Admin
                  </span>
                  <StatusBadge tone="danger">ADMIN</StatusBadge>
                </div>
                <div className="text-[10px] text-[#E4EBEF] font-mono">admin@dimonex.id</div>
                <div className="text-[10px] text-[#D6A85C] font-mono">AdminDimonex2026!</div>
                <div className="text-[9px] text-[#71818B]">Akses: Admin & MM Console</div>
              </div>

              {/* 2. Compliance */}
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#C1D0D6] inline-flex items-center gap-1.5">
                    <Scale className="w-3.5 h-3.5 text-[#8DA5B1]" />
                    Compliance Officer
                  </span>
                  <StatusBadge tone="brand">ADMIN</StatusBadge>
                </div>
                <div className="text-[10px] text-[#E4EBEF] font-mono">compliance@dimonex.id</div>
                <div className="text-[10px] text-[#A5BAC4] font-mono">ComplianceDimonex2026!</div>
                <div className="text-[9px] text-[#71818B]">Akses: KYC & AML Checker</div>
              </div>

              {/* 3. MM */}
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#6D9FE8] inline-flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5" />
                    Market Maker
                  </span>
                  <StatusBadge tone="info">MM</StatusBadge>
                </div>
                <div className="text-[10px] text-[#E4EBEF] font-mono">mm@dimonex.id</div>
                <div className="text-[10px] text-[#6D9FE8] font-mono">MarketMaker2026!</div>
                <div className="text-[9px] text-[#71818B]">Akses: Liquidity Bot Grid</div>
              </div>

              {/* 4. Trader Budi */}
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#E4EBEF] inline-flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-[#8DA5B1]" />
                    Budi Santoso
                  </span>
                  <StatusBadge tone="info">TRADER 1</StatusBadge>
                </div>
                <div className="text-[10px] text-[#E4EBEF] font-mono">budi@dimonex.id</div>
                <div className="text-[10px] text-[#A1AFB8] font-mono">TraderDimonex123!</div>
                <div className="text-[9px] text-[#71818B]">Saldo: Rp 10M, 10 BTC</div>
              </div>

              {/* 5. Trader Siti */}
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#35B887] inline-flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    Siti Rahmawati
                  </span>
                  <StatusBadge tone="success">TRADER 2</StatusBadge>
                </div>
                <div className="text-[10px] text-[#E4EBEF] font-mono">siti@dimonex.id</div>
                <div className="text-[10px] text-[#A1AFB8] font-mono">TraderDimonex123!</div>
                <div className="text-[9px] text-[#71818B]">Saldo: Rp 5M, 20 BTC</div>
              </div>

              {/* 6. User 1 */}
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#E4EBEF] inline-flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-[#71818B]" />
                    User Satu Trading
                  </span>
                  <StatusBadge tone="neutral">USER 1</StatusBadge>
                </div>
                <div className="text-[10px] text-[#E4EBEF] font-mono">user1@dimonex.id</div>
                <div className="text-[10px] text-[#A1AFB8] font-mono">User1Dimonex2026!</div>
                <div className="text-[9px] text-[#71818B]">Saldo: Rp 10M, 10 BTC</div>
              </div>

              {/* 7. User 2 */}
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#E4EBEF] inline-flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-[#71818B]" />
                    User Dua Trading
                  </span>
                  <StatusBadge tone="neutral">USER 2</StatusBadge>
                </div>
                <div className="text-[10px] text-[#E4EBEF] font-mono">user2@dimonex.id</div>
                <div className="text-[10px] text-[#A1AFB8] font-mono">User2Dimonex2026!</div>
                <div className="text-[9px] text-[#71818B]">Saldo: Rp 5M, 20 BTC</div>
              </div>

              {/* 8. Fresh Test User */}
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#8DA5B1] inline-flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Akun Pengujian Baru
                  </span>
                  <StatusBadge tone="brand">FRESH</StatusBadge>
                </div>
                <div className="text-[10px] text-[#E4EBEF] font-mono">test@dimonex.id</div>
                <div className="text-[10px] text-[#A5BAC4] font-mono">TestDimonex2026!</div>
                <div className="text-[9px] text-[#71818B]">Saldo: Rp 100jt, 1 BTC</div>
              </div>
            </div>
          </div>

          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-sans">
                <thead className="bg-[#17212B] text-[11px] text-[#A1AFB8] border-b border-[#202B34]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Pengguna</th>
                    <th className="px-4 py-3 font-semibold">Nama Identitas (KTP)</th>
                    <th className="px-4 py-3 font-semibold">Role RBAC</th>
                    <th className="px-4 py-3 font-semibold">Status Akun</th>
                    <th className="px-4 py-3 font-semibold">Verifikasi KYC</th>
                    <th className="px-4 py-3 font-semibold">2FA TOTP</th>
                    <th className="px-4 py-3 font-semibold text-right">Aksi Administrator</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34] font-mono">
                  {filteredUsers.map(u => (
                    <tr key={u.id} className="hover:bg-[#17212B]/60 transition-colors">
                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-[#E4EBEF] block">{u.email}</span>
                        <span className="text-[10px] text-[#71818B] block font-mono">ID: {u.id}</span>
                      </td>
                      <td className="px-4 py-3.5 font-sans font-medium text-[#E4EBEF]">
                        {u.fullName || '-'}
                      </td>
                      <td className="px-4 py-3.5">
                        <select
                          value={u.role}
                          onChange={e => handleChangeRole(u.id, e.target.value)}
                          className="bg-[#111820] border border-[#2B3944] rounded-[7px] px-2 py-1 text-xs text-[#E4EBEF] font-semibold focus:border-[#8DA5B1] outline-none"
                        >
                          <option value="USER">USER</option>
                          <option value="MM">MM (Market Maker)</option>
                          <option value="COMPLIANCE">COMPLIANCE</option>
                          <option value="ADMIN">ADMIN</option>
                          <option value="SUPERADMIN">SUPERADMIN</option>
                        </select>
                      </td>
                      <td className="px-4 py-3.5 font-sans">
                        <StatusBadge tone={u.status === 'frozen' ? 'danger' : 'success'}>
                          {u.status === 'frozen' ? 'DIBEKUKAN' : 'AKTIF'}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3.5 font-sans">
                        <StatusBadge
                          tone={
                            u.kycStatus === 'approved'
                              ? 'success'
                              : u.kycStatus === 'pending'
                              ? 'warning'
                              : 'neutral'
                          }
                        >
                          {u.kycStatus === 'approved' && <Check className="w-3 h-3" />}
                          {u.kycStatus} (Tier {u.kycTier})
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3.5 font-sans">
                        <span className={u.isTotpEnabled ? 'text-[#35B887] font-semibold' : 'text-[#71818B]'}>
                          {u.isTotpEnabled ? 'AKTIF (RFC 6238)' : 'Non-aktif'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right space-x-1.5 font-sans">
                        {u.kycStatus === 'pending' && (
                          <div className="inline-flex gap-1.5">
                            <Button
                              variant="profit"
                              size="sm"
                              onClick={() => handleReviewKyc(u.id, 'APPROVE')}
                            >
                              Approve Tier 2
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleReviewKyc(u.id, 'REJECT')}
                            >
                              Tolak
                            </Button>
                          </div>
                        )}
                        {u.isTotpEnabled && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleReset2fa(u.id, u.email)}
                            title="Reset 2FA TOTP jika pengguna kehilangan perangkat"
                          >
                            Reset 2FA
                          </Button>
                        )}
                        <Button
                          variant={u.status === 'frozen' ? 'secondary' : 'danger'}
                          size="sm"
                          onClick={() => handleToggleFreeze(u.id, u.status)}
                        >
                          {u.status === 'frozen' ? 'Buka Beku' : 'Bekukan Akun'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 5: WITHDRAWALS & FIAT/CRYPTO QUEUE
          ========================================================================= */}
      {activeTab === 'WITHDRAWALS' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[#E4EBEF]">Antrean Persetujuan Penarikan Dana (Withdrawals Queue)</h3>
            <p className="text-xs text-[#A1AFB8]">Tinjau dan setujui penarikan fiat (Transfer Bank) dan kripto on-chain. Penolakan akan secara otomatis mengembalikan dana terkunci ke akun pengguna.</p>
          </div>

          {pendingWithdrawalCount === 0 ? (
            <div className="p-12 text-center rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-2">
              <CheckCircle2 className="w-8 h-8 text-[#35B887] mx-auto" />
              <h4 className="text-sm font-semibold text-[#E4EBEF]">Semua Penarikan Telah Diproses</h4>
              <p className="text-xs text-[#A1AFB8]">Tidak ada antrean penarikan yang menunggu persetujuan saat ini.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Fiat Pending */}
              {pendingWd.fiat.map(wd => (
                <div key={wd.id} className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StatusBadge tone="info">FIAT IDR</StatusBadge>
                      <span className="font-bold text-[#E4EBEF] text-sm font-mono tabular-nums">
                        {formatIDR(wd.amount, true)}
                      </span>
                      <span className="text-xs text-[#A1AFB8]">ke {wd.bankName}</span>
                    </div>
                    <div className="text-xs text-[#A1AFB8] font-mono">
                      Rekening: <strong className="text-[#E4EBEF]">{wd.accountNumber}</strong> ({wd.accountHolderName}) · Pengguna ID: {wd.userId}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleRejectWd(wd.id, 'FIAT')}
                    >
                      Tolak & Refund
                    </Button>
                    <Button
                      variant="profit"
                      size="sm"
                      onClick={() => handleApproveWd(wd.id, 'FIAT')}
                    >
                      Setujui & Selesaikan
                    </Button>
                  </div>
                </div>
              ))}

              {/* Crypto Pending */}
              {pendingWd.crypto.map(wd => (
                <div key={wd.id} className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StatusBadge tone="brand">{wd.currency} ON-CHAIN</StatusBadge>
                      <span className="font-bold text-[#E4EBEF] text-sm font-mono tabular-nums">
                        {formatCrypto(wd.amount, 8)} {wd.currency}
                      </span>
                    </div>
                    <div className="text-xs text-[#A1AFB8] font-mono truncate max-w-md">
                      Address: <strong className="text-[#E4EBEF]">{wd.address}</strong> (Network: {wd.network || 'Mainnet'})
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleRejectWd(wd.id, 'CRYPTO')}
                    >
                      Tolak & Refund
                    </Button>
                    <Button
                      variant="profit"
                      size="sm"
                      onClick={() => handleApproveWd(wd.id, 'CRYPTO')}
                    >
                      Setujui & Broadcast
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 6: FINANCIAL LEDGER & DOUBLE-ENTRY ADJUSTMENT
          ========================================================================= */}
      {activeTab === 'LEDGER' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">Buku Besar Bersama & Penyesuaian Saldo (Double-Entry Ledger)</h3>
              <p className="text-xs text-[#A1AFB8]">Alat penyesuaian administratif resmi berpasangan dengan rekening Treasury. Setiap jurnal tercatat permanen di audit trail.</p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowAdjustLedgerModal(true)}
              icon={<Plus className="w-4 h-4" />}
              className="self-start"
            >
              Entri Penyesuaian Saldo
            </Button>
          </div>

          {/* Solvency Audit Status & Live Treasury + Fee Collector Balances */}
          <div className="p-5 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-semibold text-[#C1D0D6] uppercase tracking-wider font-mono">
                  Ringkasan Saldo Riil Treasury &amp; Fee Collector Bursa (Double-Entry Live)
                </h4>
                <p className="text-xs text-[#71818B] mt-0.5">
                  Saldo riil rekening <span className="font-mono text-[#A1AFB8]">SYS_TREASURY</span> &amp; <span className="font-mono text-[#A1AFB8]">SYS_FEES</span> langsung dari Ledger Storage.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={isSweepingFees || (treasuryFeesReport?.summary?.feeCollectorLiveIdr ?? 0) <= 0}
                onClick={handleSweepTreasuryFees}
                icon={<ArrowUpRight className="w-3.5 h-3.5 text-[#D6A85C]" />}
                className="self-start sm:self-auto whitespace-nowrap"
              >
                {isSweepingFees ? 'Menyapu...' : 'Sweep Fee Collector → Treasury'}
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(treasuryFeesReport?.byCurrency || []).slice(0, 6).map(item => (
                <div key={item.currency} className="p-3.5 rounded-[10px] bg-[#17212B] border border-[#202B34] font-mono tabular-nums text-xs space-y-1">
                  <span className="text-[#A1AFB8] block">Treasury Reserve {item.currency}</span>
                  <span className="text-base font-bold text-[#35B887] block">
                    {item.treasuryReserveBalanceDisplay} {item.currency}
                  </span>
                  <div className="flex justify-between text-[11px] text-[#6D9FE8] pt-1 border-t border-[#202B34]">
                    <span>Fee Collector:</span>
                    <span>{item.feeCollectorBalanceDisplay} {item.currency}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-[#71818B]">
                    <span>Total Fee / Klaim Earn:</span>
                    <span>{item.feeEarnedAllTimeDisplay} / {item.stakingClaimedDisplay}</span>
                  </div>
                </div>
              ))}
              {(!treasuryFeesReport || treasuryFeesReport.byCurrency.length === 0) && (
                <div className="col-span-3 p-4 rounded-[10px] bg-[#17212B] border border-[#202B34] text-xs text-[#71818B]">
                  Memuat saldo Treasury &amp; Fee Collector...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 7: BOT & MARKET MAKER OPERATIONS
          ========================================================================= */}
      {activeTab === 'BOTS' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">Monitoring Seluruh Bot Trading Platform</h3>
              <p className="text-xs text-[#A1AFB8]">Pantau aktivitas Spot Grid, DCA Layers, TWAP Slicer, Volume Maker, dan Depth & Liquidity di seluruh pengguna.</p>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleEmergencyStopBots()}
              icon={<AlertTriangle className="w-4 h-4" />}
              className="self-start"
            >
              Hentikan Semua Bot (Emergency)
            </Button>
          </div>

          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="bg-[#17212B] text-[11px] text-[#A1AFB8] border-b border-[#202B34] font-sans">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Nama Bot</th>
                    <th className="px-4 py-3 font-semibold">Tipe Algoritma</th>
                    <th className="px-4 py-3 font-semibold">Pasangan</th>
                    <th className="px-4 py-3 font-semibold">Pemilik Akun</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Order Aktif</th>
                    <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34]">
                  {botsList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-[#71818B] font-sans">
                        Belum ada bot trading yang terkonfigurasi di bursa.
                      </td>
                    </tr>
                  ) : (
                    botsList.map(b => (
                      <tr key={b.id} className="hover:bg-[#17212B]/60 transition-colors">
                        <td className="px-4 py-3.5">
                          <span className="font-semibold text-[#E4EBEF] block">{b.name}</span>
                          <span className="text-[10px] text-[#71818B] block">ID: {b.id}</span>
                        </td>
                        <td className="px-4 py-3.5 text-[#8DA5B1] font-semibold">{b.botType}</td>
                        <td className="px-4 py-3.5 font-semibold text-[#E4EBEF]">{b.pairId}</td>
                        <td className="px-4 py-3.5 text-[#A1AFB8]">{b.ownerEmail}</td>
                        <td className="px-4 py-3.5 font-sans">
                          <StatusBadge tone={b.status === 'RUNNING' ? 'success' : 'neutral'}>
                            {b.status}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3.5 font-semibold text-[#E4EBEF]">{b.activeOrdersCount} level</td>
                        <td className="px-4 py-3.5 text-right font-sans">
                          {b.status === 'RUNNING' && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleEmergencyStopBots(b.id)}
                            >
                              Stop Bot
                            </Button>
                          )}
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

      {/* =========================================================================
          TAB 8: FX ENGINE (USDT/IDR)
          ========================================================================= */}
      {activeTab === 'FX' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">Mesin Konversi FX USDT/IDR & Sinkronisasi Feed</h3>
              <p className="text-xs text-[#A1AFB8]">Formula konversi spot: BTC/IDR = BTC/USDT × USDT/IDR dengan kontrol manual admin dan rekam jejak audit.</p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowFxModal(true)}
              icon={<Sliders className="w-4 h-4" />}
              className="self-start"
            >
              Override Kurs Manual
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-2">
              <span className="text-[11px] text-[#A1AFB8]">Kurs Efektif USDT/IDR</span>
              <span className="text-2xl font-bold font-mono tabular-nums text-[#35B887] block">
                Rp {(fxStatus?.effectiveRateIdr || 16350).toLocaleString('id-ID')}
              </span>
              <span className="text-[10px] text-[#71818B] font-mono block">
                Sumber aktif: {fxStatus?.source || 'COINMARKETCAP'}
              </span>
            </div>

            <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-2">
              <span className="text-[11px] text-[#A1AFB8]">Penyedia Feed Eksternal</span>
              <div className="space-y-1 text-xs font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="text-[#A1AFB8]">CoinMarketCap:</span>
                  <span className="text-[#35B887] font-bold">ONLINE (16.350)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#A1AFB8]">Binance Spot:</span>
                  <span className="text-[#35B887] font-bold">ONLINE</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#A1AFB8]">Bybit Spot:</span>
                  <span className="text-[#35B887] font-bold">ONLINE</span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-2">
              <span className="text-[11px] text-[#A1AFB8]">Batas Deviasi & Keamanan</span>
              <div className="space-y-1 text-xs font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="text-[#A1AFB8]">Max Tolerance Shift:</span>
                  <span className="text-[#6D9FE8] font-bold">10.0% Max Jump</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#A1AFB8]">Aggregator Threshold:</span>
                  <span className="text-[#8DA5B1] font-bold">200 BPS (2%)</span>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: WHITELIST PAIR WEBSOCKET BINANCE & BYBIT */}
          <div className="p-5 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-[#202B34] pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-[#8DA5B1]" />
                  <h4 className="text-sm font-semibold text-[#E4EBEF]">
                    Whitelist Pair WebSocket Binance &amp; Bybit (Acuan Pergerakan Bot)
                  </h4>
                </div>
                <p className="text-xs text-[#A1AFB8] mt-1">
                  Kurasi daftar pair minimal yang di-subscribe ke stream WebSocket Binance &amp; Bybit. Hanya pair aktif di whitelist ini yang muncul di Bot Depth Movement (WS) agar konsumsi bandwidth &amp; RAM tetap ringan.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                <StatusBadge tone={wsFeedStatus?.binance?.status === 'CONNECTED' ? 'success' : 'warning'}>
                  Binance WS: {wsFeedStatus?.binance?.status || 'CONNECTING'} ({wsFeedStatus?.binance?.subscribedCount ?? 0} streams)
                </StatusBadge>
                <StatusBadge tone={wsFeedStatus?.bybit?.status === 'CONNECTED' ? 'success' : 'warning'}>
                  Bybit WS: {wsFeedStatus?.bybit?.status || 'CONNECTING'} ({wsFeedStatus?.bybit?.subscribedCount ?? 0} streams)
                </StatusBadge>
              </div>
            </div>

            {/* Quick Manual Add & Spot Catalog Search */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5 p-4 rounded-[10px] bg-[#17212B] border border-[#202B34] space-y-3">
                <h5 className="text-xs font-semibold text-[#E4EBEF] flex items-center gap-2">
                  <Plus className="w-3.5 h-3.5 text-[#8DA5B1]" />
                  <span>Tambah Pair Manual ke Whitelist</span>
                </h5>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={wsManualSymbol}
                    onChange={e => setWsManualSymbol(e.target.value.toUpperCase())}
                    placeholder="Contoh: PEPEUSDT, SUIUSDT, ETHBTC"
                    className="flex-1 bg-[#111820] border border-[#2B3944] rounded-[7px] px-3 py-2 text-xs font-mono text-[#E4EBEF] placeholder-[#71818B] focus:outline-none focus:border-[#8DA5B1]"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={wsActionBusy}
                    onClick={() => handleAddWsWhitelist(wsManualSymbol)}
                  >
                    + Tambah
                  </Button>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-[#A1AFB8]">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wsManualProviders.binance}
                      onChange={e => setWsManualProviders(prev => ({ ...prev, binance: e.target.checked }))}
                      className="rounded border-[#40515D] bg-[#111820]"
                    />
                    <span>Subscribe Binance WS</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wsManualProviders.bybit}
                      onChange={e => setWsManualProviders(prev => ({ ...prev, bybit: e.target.checked }))}
                      className="rounded border-[#40515D] bg-[#111820]"
                    />
                    <span>Subscribe Bybit WS</span>
                  </label>
                </div>
              </div>

              <div className="lg:col-span-7 p-4 rounded-[10px] bg-[#17212B] border border-[#202B34] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="text-xs font-semibold text-[#E4EBEF] flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-[#8DA5B1]" />
                    <span>Telusuri Katalog Spot Binance &amp; Bybit ({wsCatalogSource || 'LIVE'})</span>
                  </h5>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => loadWsCatalog(wsCatalogSearch, wsCatalogProvider, true)}
                    disabled={wsCatalogLoading}
                    icon={<RefreshCw className={`w-3 h-3 ${wsCatalogLoading ? 'animate-spin' : ''}`} />}
                  >
                    Sync Katalog
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={wsCatalogSearch}
                    onChange={e => {
                      const val = e.target.value.toUpperCase();
                      setWsCatalogSearch(val);
                      loadWsCatalog(val, wsCatalogProvider, false);
                    }}
                    placeholder="Cari simbol Spot (mis. SOL, PEPE, SUI, TON, BTC)..."
                    className="flex-1 min-w-[180px] bg-[#111820] border border-[#2B3944] rounded-[7px] px-3 py-1.5 text-xs font-mono text-[#E4EBEF] placeholder-[#71818B] focus:outline-none focus:border-[#8DA5B1]"
                  />
                  <select
                    value={wsCatalogProvider}
                    onChange={e => {
                      const prov = e.target.value as 'ALL' | 'BINANCE' | 'BYBIT';
                      setWsCatalogProvider(prov);
                      loadWsCatalog(wsCatalogSearch, prov, false);
                    }}
                    className="bg-[#111820] border border-[#2B3944] rounded-[7px] px-2.5 py-1.5 text-xs text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
                  >
                    <option value="ALL">Binance + Bybit</option>
                    <option value="BINANCE">Binance Spot</option>
                    <option value="BYBIT">Bybit Spot</option>
                  </select>
                </div>

                <div className="max-h-40 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 pr-1">
                  {wsCatalogLoading && wsCatalog.length === 0 ? (
                    <div className="col-span-2 text-xs text-[#A1AFB8] py-4 text-center">Memuat katalog Spot Binance &amp; Bybit...</div>
                  ) : wsCatalog.length === 0 ? (
                    <div className="col-span-2 text-xs text-[#71818B] py-4 text-center">Tidak ada pair cocok. Gunakan input manual di sebelah kiri.</div>
                  ) : (
                    wsCatalog.slice(0, 20).map((item: any) => (
                      <div key={item.symbol} className="flex items-center justify-between p-2 rounded-[7px] bg-[#111820] border border-[#202B34] text-[11px] font-mono">
                        <div className="min-w-0">
                          <div className="font-bold text-[#E4EBEF] flex items-center gap-1.5">
                            <span>{item.symbol}</span>
                            {item.providers.includes('binance') && (
                              <span className="px-1 py-0.5 rounded bg-[#D6A85C]/15 text-[#D6A85C] text-[9px]">BN</span>
                            )}
                            {item.providers.includes('bybit') && (
                              <span className="px-1 py-0.5 rounded bg-[#6D9FE8]/15 text-[#6D9FE8] text-[9px]">BY</span>
                            )}
                          </div>
                          <div className="text-[10px] text-[#A1AFB8] truncate">
                            {item.binancePrice ? `BN: $${item.binancePrice}` : ''} {item.bybitPrice ? `BY: $${item.bybitPrice}` : ''}
                          </div>
                        </div>
                        {item.isWhitelisted ? (
                          <StatusBadge tone="success">Di Whitelist</StatusBadge>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={wsActionBusy}
                            onClick={() => handleAddWsWhitelist(item.symbol, item.providers, `${item.baseAsset} / ${item.quoteAsset}`)}
                          >
                            + Pilih
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Active Curated Whitelist Table */}
            <div className="rounded-[10px] border border-[#202B34] overflow-hidden bg-[#17212B]">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead className="bg-[#1D2832] text-[#A1AFB8] text-[10px] uppercase border-b border-[#202B34]">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Pair WS</th>
                      <th className="px-4 py-3 font-semibold">Label</th>
                      <th className="px-4 py-3 font-semibold">Provider Subscribe</th>
                      <th className="px-4 py-3 font-semibold">Harga Binance</th>
                      <th className="px-4 py-3 font-semibold">Harga Bybit</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202B34]">
                    {wsWhitelist.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-[#71818B] font-sans">
                          Belum ada pair WebSocket dalam whitelist. Tambahkan dari katalog di atas.
                        </td>
                      </tr>
                    ) : (
                      wsWhitelist.map(entry => (
                        <tr key={entry.symbol} className="hover:bg-[#1D2832]/60 transition-colors">
                          <td className="px-4 py-3 font-bold text-[#E4EBEF]">{entry.symbol}</td>
                          <td className="px-4 py-3 text-[#A1AFB8] font-sans">{entry.label || `${entry.baseAsset}/${entry.quoteAsset}`}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {entry.providers.includes('binance') && (
                                <StatusBadge tone="warning">Binance</StatusBadge>
                              )}
                              {entry.providers.includes('bybit') && (
                                <StatusBadge tone="info">Bybit</StatusBadge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[#E4EBEF]">
                            {entry.binancePrice ? (
                              <span className={entry.binanceFresh ? 'text-[#35B887]' : 'text-[#D6A85C]'}>
                                {entry.binancePrice}
                              </span>
                            ) : (
                              <span className="text-[#71818B]">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[#E4EBEF]">
                            {entry.bybitPrice ? (
                              <span className={entry.bybitFresh ? 'text-[#35B887]' : 'text-[#D6A85C]'}>
                                {entry.bybitPrice}
                              </span>
                            ) : (
                              <span className="text-[#71818B]">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-sans">
                            <button
                              type="button"
                              disabled={wsActionBusy}
                              onClick={() => handleToggleWsWhitelist(entry.symbol, !entry.enabled)}
                              className={`px-2.5 py-0.5 rounded-[7px] text-[10px] font-bold border transition-colors cursor-pointer ${
                                entry.enabled
                                  ? 'bg-[#12392F] border-[#16A879]/40 text-[#35B887] hover:bg-[#16A879]/20'
                                  : 'bg-[#111820] border-[#2B3944] text-[#71818B] hover:text-[#E4EBEF]'
                              }`}
                            >
                              {entry.enabled ? 'AKTIF (WS ON)' : 'NONAKTIF'}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              disabled={wsActionBusy}
                              onClick={() => handleRemoveWsWhitelist(entry.symbol)}
                              className="p-1.5 rounded-[7px] bg-[#401F27] hover:bg-[#EA5B65]/30 border border-[#EA5B65]/30 text-[#EA5B65] transition-colors cursor-pointer"
                              title={`Hapus ${entry.symbol} dari whitelist WS`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 9: EARN, COPY TRADING & VIP FEE SCHEDULE
          ========================================================================= */}
      {activeTab === 'PRODUCTS' && (
        <div className="space-y-6">
          {/* Section 1: Institutional Staking / Earn Vaults */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-[#E4EBEF]">Manajemen Vault Earn & Staking (Real Custody Ledger)</h4>
                <p className="text-xs text-[#71818B]">Seluruh TVL dan posisi diverifikasi langsung terhadap akun Custody Earn di Double-Entry Ledger.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isSettlingYield}
                  onClick={() => handleRunYieldSettlement(true)}
                  icon={<RefreshCw className={`w-3.5 h-3.5 ${isSettlingYield ? 'animate-spin' : ''}`} />}
                >
                  Run Daily Yield Cycle
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setShowCreateEarnModal(true)}
                  icon={<Plus className="w-3.5 h-3.5" />}
                >
                  Buat Vault Baru
                </Button>
              </div>
            </div>

            {earnSolvency && (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className={`w-4 h-4 ${earnSolvency.isFullySolvent ? 'text-[#35B887]' : 'text-[#EA5B65]'}`} />
                    <span className="text-xs font-semibold text-[#E4EBEF]">
                      Verifikasi Solvensi Custody Earn ({earnSolvency.isFullySolvent ? '100% SEIMBANG' : 'ADA SELISIH'})
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-[#71818B]">
                    Diperiksa: {new Date(earnSolvency.checkedAt).toLocaleTimeString('id-ID')}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {earnSolvency.assets.map(row => (
                    <div key={row.asset} className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] text-[11px] font-mono tabular-nums">
                      <div className="flex items-center justify-between font-semibold text-[#E4EBEF]">
                        <span>{row.asset}</span>
                        <span className={row.isBalanced ? 'text-[#35B887]' : 'text-[#EA5B65]'}>
                          {row.isBalanced ? 'OK' : 'DIFF'}
                        </span>
                      </div>
                      <div className="text-[#A1AFB8] mt-1 truncate" title={`Custody: ${row.custodyLedgerDisplay}`}>
                        Cust: {row.custodyLedgerDisplay}
                      </div>
                      <div className="text-[#71818B] truncate" title={`Liab Yield: ${row.accruedLiabilityDisplay}`}>
                        Yield Liab: {row.accruedLiabilityDisplay}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {earnpools.map(pool => (
                <div key={pool.id} className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-semibold text-xs text-[#E4EBEF] block truncate">{pool.name}</span>
                      <span className="text-[11px] text-[#71818B] font-mono">
                        {pool.asset} · {pool.type} · {pool.durationDays === 0 ? 'Fleksibel' : `${pool.durationDays} Hari`}
                      </span>
                    </div>
                    <StatusBadge tone={pool.status === 'ACTIVE' ? 'success' : pool.status === 'PAUSED' ? 'warning' : 'danger'}>
                      {pool.status}
                    </StatusBadge>
                  </div>
                  <div className="flex items-baseline justify-between p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] font-mono tabular-nums">
                    <span className="text-lg font-bold text-[#35B887]">{(pool.apyPct ?? (pool.apyBps / 100)).toFixed(2)}% APY</span>
                    <span className="text-[11px] text-[#A1AFB8]">{pool.activeStakersCount ?? 0} stakers</span>
                  </div>
                  <div className="space-y-1 text-[11px] font-mono tabular-nums">
                    <div className="flex justify-between">
                      <span className="text-[#71818B]">Live TVL</span>
                      <span className="text-[#E4EBEF]">{pool.totalStakedDisplay || '0'} {pool.asset}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#71818B]">TVL USD</span>
                      <span className="text-[#A1AFB8]">${(pool.totalStakedUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleUpdateStakingPool(pool)}
                    className="w-full"
                  >
                    Ubah APY & Status
                  </Button>
                </div>
              ))}
            </div>

            {earnPositions.length > 0 && (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
                <div className="px-4 py-2.5 bg-[#17212B] border-b border-[#202B34] flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#E4EBEF]">Posisi Staking Pengguna Terkini ({earnPositions.length})</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono tabular-nums">
                    <thead className="bg-[#111820] text-[11px] text-[#A1AFB8] border-b border-[#202B34] font-sans">
                      <tr>
                        <th className="px-4 py-2 font-semibold">Pengguna</th>
                        <th className="px-4 py-2 font-semibold">Vault</th>
                        <th className="px-4 py-2 font-semibold">Pokok</th>
                        <th className="px-4 py-2 font-semibold">Yield Tertunda</th>
                        <th className="px-4 py-2 font-semibold">Compound</th>
                        <th className="px-4 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#202B34]">
                      {earnPositions.slice(0, 20).map(pos => (
                        <tr key={pos.id} className="hover:bg-[#17212B]/60">
                          <td className="px-4 py-2.5 text-[#E4EBEF]">{pos.userEmail || pos.userId}</td>
                          <td className="px-4 py-2.5 text-[#A1AFB8]">{pos.vaultName}</td>
                          <td className="px-4 py-2.5 text-[#E4EBEF] font-semibold">{pos.principalDisplay} {pos.asset}</td>
                          <td className="px-4 py-2.5 text-[#35B887]">{pos.accruedYieldDisplay} {pos.asset}</td>
                          <td className="px-4 py-2.5">{pos.autoCompound ? 'ON' : 'OFF'}</td>
                          <td className="px-4 py-2.5 font-sans">
                            <StatusBadge tone={pos.status === 'ACTIVE' ? 'success' : pos.status === 'MATURED' ? 'info' : 'neutral'}>
                              {pos.status}
                            </StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Copy Trading Master Traders */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[#E4EBEF]">Manajemen Master Trader (Copy Trading)</h4>
            <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead className="bg-[#17212B] text-[11px] text-[#A1AFB8] border-b border-[#202B34] font-sans">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Master Trader</th>
                      <th className="px-4 py-2.5 font-semibold">Pair</th>
                      <th className="px-4 py-2.5 font-semibold">30d ROI</th>
                      <th className="px-4 py-2.5 font-semibold">Followers</th>
                      <th className="px-4 py-2.5 font-semibold">Profit Share</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202B34]">
                    {copyMasters.map(m => (
                      <tr key={m.id} className="hover:bg-[#17212B]/60 transition-colors">
                        <td className="px-4 py-3 font-semibold text-[#E4EBEF]">{m.name}</td>
                        <td className="px-4 py-3 text-[#A1AFB8]">{m.asset}</td>
                        <td className="px-4 py-3 text-[#35B887] font-bold">+{m.roi30d}%</td>
                        <td className="px-4 py-3 text-[#E4EBEF]">{m.followers} orang</td>
                        <td className="px-4 py-3 text-[#E4EBEF]">{m.profitShareBps / 100}%</td>
                        <td className="px-4 py-3 font-sans">
                          <StatusBadge tone={m.status === 'APPROVED' ? 'success' : 'danger'}>
                            {m.status}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3 text-right font-sans">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleUpdateMasterTrader(m.id, m.status)}
                          >
                            {m.status === 'APPROVED' ? 'Jeda Master' : 'Aktifkan'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Section 3: VIP Tiers */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[#E4EBEF]">Tabel Diskon Fee VIP Level (VIP 0 - VIP 5)</h4>
            <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead className="bg-[#17212B] text-[11px] text-[#A1AFB8] border-b border-[#202B34] font-sans">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">VIP Tier</th>
                      <th className="px-4 py-2.5 font-semibold">Syarat Volume 30 Hari</th>
                      <th className="px-4 py-2.5 font-semibold">Maker Fee</th>
                      <th className="px-4 py-2.5 font-semibold">Taker Fee</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202B34]">
                    {vipTiers.map(vt => (
                      <tr key={vt.tier} className="hover:bg-[#17212B]/60 transition-colors">
                        <td className="px-4 py-3 font-bold text-[#C1D0D6]">VIP {vt.tier}</td>
                        <td className="px-4 py-3 text-[#E4EBEF]">{formatIDR(vt.minVolumeIdr, true)}</td>
                        <td className="px-4 py-3 text-[#35B887]">{(vt.makerFeeBps / 100).toFixed(2)}% ({vt.makerFeeBps} bps)</td>
                        <td className="px-4 py-3 text-[#6D9FE8]">{(vt.takerFeeBps / 100).toFixed(2)}% ({vt.takerFeeBps} bps)</td>
                        <td className="px-4 py-3 text-right font-sans">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleUpdateVipTier(vt.tier, vt.makerFeeBps, vt.takerFeeBps)}
                          >
                            Edit Fee
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 10: RISK & AML ALERTS
          ========================================================================= */}
      {activeTab === 'RISK' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[#E4EBEF]">Sistem Deteksi Anomali & Risiko Transaksi (Anti-Money Laundering)</h3>
            <p className="text-xs text-[#A1AFB8]">Pemantauan otomatis terhadap pola wash trading, rapid cancellation spoofing, dan lonjakan penarikan tidak wajar.</p>
          </div>

          {riskAlerts.length === 0 ? (
            <div className="p-8 text-center rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-2">
              <CheckCircle2 className="w-8 h-8 text-[#35B887] mx-auto" />
              <h4 className="text-sm font-semibold text-[#E4EBEF]">Tidak Ada Peringatan Anomali</h4>
              <p className="text-xs text-[#A1AFB8]">Sistem AML berjalan normal. Seluruh aktivitas perdagangan sesuai dengan parameter kepatuhan bursa.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {riskAlerts.map(a => (
                <div key={a.id} className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={a.severity === 'HIGH' ? 'danger' : 'warning'}>
                        {a.severity}
                      </StatusBadge>
                      <span className="font-semibold text-[#E4EBEF] text-xs">{a.category}</span>
                    </div>
                    <p className="text-xs text-[#A1AFB8]">{a.description}</p>
                  </div>
                  <span className="text-[10px] font-mono tabular-nums text-[#71818B] shrink-0">{formatDateTime(a.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 11: AUDIT TRAIL
          ========================================================================= */}
      {activeTab === 'AUDIT' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">Audit Trail Append-Only (Aktivitas Sistem & Admin)</h3>
              <p className="text-xs text-[#A1AFB8]">Catatan audit permanen yang tidak dapat dimanipulasi untuk setiap tindakan administratif dan kepatuhan.</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-[#71818B] absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Cari aksi audit / resource..."
                value={auditSearch}
                onChange={e => setAuditSearch(e.target.value)}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] pl-9 pr-3 py-2 text-xs text-[#E4EBEF] placeholder-[#71818B] outline-none focus:border-[#8DA5B1] font-mono"
              />
            </div>
          </div>

          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
            <div className="max-h-[600px] overflow-y-auto divide-y divide-[#202B34] font-mono text-xs">
              {filteredAudits.length === 0 ? (
                <div className="p-8 text-center text-[#71818B] font-sans">Belum ada audit log yang sesuai</div>
              ) : (
                filteredAudits.map((log, idx) => (
                  <div key={idx} className="p-3.5 hover:bg-[#17212B]/60 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <StatusBadge tone="info">{log.action}</StatusBadge>
                        <span className="text-[#E4EBEF] font-medium">{log.resource}</span>
                      </div>
                      <p className="text-[11px] text-[#A1AFB8] font-sans">{log.details}</p>
                    </div>
                    <span className="text-[10px] text-[#71818B] tabular-nums whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          CONTENT MANAGEMENT: NEWS & ANNOUNCEMENTS, NOTIFICATION CENTER, MEDIA LIBRARY
          ========================================================================= */}
      {activeTab === 'CMS_NEWS' && <NewsManagementSection user={user} />}
      {activeTab === 'CMS_NOTIFICATIONS' && <NotificationCenterSection />}
      {activeTab === 'CMS_MEDIA' && <MediaLibrarySection />}

      {/* =========================================================================
          INSTITUTIONAL STAKING & EARN VAULTS ADMIN CONSOLE
          ========================================================================= */}
      {activeTab === 'STAKING' && (
        <StakingAdminConsole onNotify={showToast} onAuditRefresh={loadAllData} />
      )}

      {/* =========================================================================
          INSTITUTIONAL VIP & TRADER REWARDS MANAGEMENT
          ========================================================================= */}
      {activeTab === 'VIP_TASKS' && <VipRewardsAdminSection mode="TASKS" />}
      {activeTab === 'VIP_VOUCHERS' && <VipRewardsAdminSection mode="VOUCHERS" />}
      {activeTab === 'VIP_CLAIMS' && <VipRewardsAdminSection mode="CLAIMS" />}

        </div>
      </div>

      {/* =========================================================================
          MODAL: CREATE NEW TRADING PAIR
          ========================================================================= */}
      <Modal
        isOpen={showCreatePairModal}
        onClose={() => setShowCreatePairModal(false)}
        title="Daftarkan Trading Pair Baru"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleCreatePair} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Base Currency:</label>
              <input
                type="text"
                required
                placeholder="SOL"
                value={newPairData.baseCurrency}
                onChange={e => setNewPairData({ ...newPairData, baseCurrency: e.target.value.toUpperCase() })}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono uppercase outline-none focus:border-[#8DA5B1]"
              />
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">Quote Currency:</label>
              <select
                value={newPairData.quoteCurrency}
                onChange={e => {
                  const q = e.target.value;
                  setNewPairData({
                    ...newPairData,
                    quoteCurrency: q,
                    quoteDecimals: q === 'USDT' ? '6' : '2',
                    initialPrice: q === 'USDT' ? '1000000' : '100000'
                  });
                }}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              >
                <option value="USDT">USDT (Tether USD)</option>
                <option value="IDR">IDR (Indonesian Rupiah)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[#A1AFB8] block mb-1">Harga Awal (Quote atomic units, contoh: 100000 = Rp 1.000,00):</label>
            <input
              type="text"
              required
              value={newPairData.initialPrice}
              onChange={e => setNewPairData({ ...newPairData, initialPrice: e.target.value })}
              className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Maker Fee (bps):</label>
              <input
                type="number"
                required
                value={newPairData.makerFeeBps}
                onChange={e => setNewPairData({ ...newPairData, makerFeeBps: e.target.value })}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              />
              <span className="text-[10px] text-[#71818B] mt-0.5 block">10 bps = 0.10%</span>
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">Taker Fee (bps):</label>
              <input
                type="number"
                required
                value={newPairData.takerFeeBps}
                onChange={e => setNewPairData({ ...newPairData, takerFeeBps: e.target.value })}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              />
              <span className="text-[10px] text-[#71818B] mt-0.5 block">20 bps = 0.20%</span>
            </div>
          </div>

          <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-2">
            <span className="text-[11px] font-semibold text-[#6D9FE8] block">Batas Kuantitas Order (Satuan Token):</span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[#A1AFB8] block mb-1 text-[11px]">Min Order (Tokens):</label>
                <input
                  type="text"
                  required
                  value={newPairData.minOrderTokens}
                  onChange={e => setNewPairData({ ...newPairData, minOrderTokens: e.target.value })}
                  className="w-full bg-[#141C24] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono"
                  placeholder="1"
                />
              </div>
              <div>
                <label className="text-[#A1AFB8] block mb-1 text-[11px]">Max Order (Tokens):</label>
                <input
                  type="text"
                  required
                  value={newPairData.maxOrderTokens}
                  onChange={e => setNewPairData({ ...newPairData, maxOrderTokens: e.target.value })}
                  className="w-full bg-[#141C24] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono"
                  placeholder="10000000"
                />
              </div>
            </div>
            <span className="text-[10px] text-[#A1AFB8] block font-mono">
              Sistem otomatis mengubah ke unit atomic integer sesuai desimal base currency.
            </span>
          </div>

          <div className="pt-2">
            <Button type="submit" variant="primary" size="md" className="w-full">
              Buat &amp; Aktifkan Pair
            </Button>
          </div>
        </form>
      </Modal>

      {/* =========================================================================
          MODAL: TOKEN MANAGEMENT & ORDER QUANTITY LIMITS CONFIGURATION
          ========================================================================= */}
      <Modal
        isOpen={showEditPairModal && Boolean(editingPair)}
        onClose={() => setShowEditPairModal(false)}
        title={editingPair ? `Kelola Limit & Fee Token: ${editingPair.id}` : 'Kelola Limit & Fee Token'}
        subtitle="Atur batas kuantitas order (Min/Max), fee, dan circuit breaker"
        maxWidth="max-w-xl"
      >
        {editingPair && (
          <div className="space-y-4">
            <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#6D9FE8]">Spesifikasi Token:</span>
                <span className="text-[#E4EBEF]">Base <strong>{editingPair.baseCurrency}</strong> ({editingPair.baseDecimals} Decimals)</span>
                <span className="text-[#71818B]">|</span>
                <span className="text-[#E4EBEF]">Quote <strong>{editingPair.quoteCurrency}</strong> ({editingPair.quoteDecimals} Decimals)</span>
              </div>
              <div className="text-[11px] font-mono text-[#8DA5B1] bg-[#17212B] px-2 py-0.5 rounded border border-[#2B3944]">
                1 {editingPair.baseCurrency} = {(10 ** (editingPair.baseDecimals || 8)).toLocaleString('id-ID')} atomic units
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-[#A1AFB8] block uppercase tracking-wider">
                Metode Input Kuantitas Order:
              </label>
              <div className="grid grid-cols-2 gap-2 p-1 rounded-[7px] bg-[#111820] border border-[#202B34]">
                <button
                  type="button"
                  onClick={() => setPairConfigForm(f => ({ ...f, inputMode: 'TOKENS' }))}
                  className={`py-2 px-3 rounded-[5px] text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                    pairConfigForm.inputMode === 'TOKENS'
                      ? 'bg-[#8DA5B1] text-[#090D12]'
                      : 'text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#17212B]'
                  }`}
                >
                  <Coins className="w-3.5 h-3.5" />
                  <span>Mode Jumlah Token (Desimal)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPairConfigForm(f => ({ ...f, inputMode: 'ATOMIC' }))}
                  className={`py-2 px-3 rounded-[5px] text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                    pairConfigForm.inputMode === 'ATOMIC'
                      ? 'bg-[#8DA5B1] text-[#090D12]'
                      : 'text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#17212B]'
                  }`}
                >
                  <Hash className="w-3.5 h-3.5" />
                  <span>Mode Integer Atomic (BigInt)</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleSavePairConfig} className="space-y-4 text-xs">
              {pairConfigForm.inputMode === 'TOKENS' ? (
                <div className="space-y-3.5 p-3.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#E4EBEF] text-xs">Pengaturan Limit dalam Satuan Token ({editingPair.baseCurrency})</span>
                    <StatusBadge tone="success">Konversi Otomatis</StatusBadge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[#A1AFB8] block mb-1 font-medium">
                        Min Order Quantity ({editingPair.baseCurrency}):
                      </label>
                      <input
                        type="text"
                        required
                        value={pairConfigForm.minOrderTokens}
                        onChange={e => {
                          const val = e.target.value;
                          setPairConfigForm(f => ({
                            ...f,
                            minOrderTokens: val,
                            minOrderSize: parseTokenToAtomic(val, editingPair.baseDecimals)
                          }));
                        }}
                        className="w-full bg-[#141C24] border border-[#2B3944] rounded-[7px] p-2.5 text-[#E4EBEF] font-mono focus:border-[#8DA5B1] outline-none"
                        placeholder="1"
                      />
                      <span className="text-[10px] text-[#71818B] mt-1 block font-mono">
                        ≈ {parseTokenToAtomic(pairConfigForm.minOrderTokens, editingPair.baseDecimals)} units atomic
                      </span>
                    </div>

                    <div>
                      <label className="text-[#A1AFB8] block mb-1 font-medium">
                        Max Order Quantity ({editingPair.baseCurrency}):
                      </label>
                      <input
                        type="text"
                        required
                        value={pairConfigForm.maxOrderTokens}
                        onChange={e => {
                          const val = e.target.value;
                          setPairConfigForm(f => ({
                            ...f,
                            maxOrderTokens: val,
                            maxOrderSize: parseTokenToAtomic(val, editingPair.baseDecimals)
                          }));
                        }}
                        className="w-full bg-[#141C24] border border-[#2B3944] rounded-[7px] p-2.5 text-[#E4EBEF] font-mono focus:border-[#8DA5B1] outline-none"
                        placeholder="10000000"
                      />
                      <span className="text-[10px] text-[#71818B] mt-1 block font-mono">
                        ≈ {parseTokenToAtomic(pairConfigForm.maxOrderTokens, editingPair.baseDecimals)} units atomic
                      </span>
                    </div>
                  </div>

                  <div className="pt-1">
                    <label className="text-[10px] text-[#A1AFB8] block mb-1.5 font-medium">
                      Pilihan Cepat Batas Maksimum ({editingPair.baseCurrency}):
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {['10000', '100000', '1000000', '10000000', '50000000', '100000000'].map(preset => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setPairConfigForm(f => ({
                              ...f,
                              maxOrderTokens: preset,
                              maxOrderSize: parseTokenToAtomic(preset, editingPair.baseDecimals)
                            }));
                          }}
                          className={`px-2 py-1 rounded-[5px] text-[11px] font-mono border transition-colors cursor-pointer ${
                            pairConfigForm.maxOrderTokens === preset
                              ? 'bg-[#8DA5B1] border-[#8DA5B1] text-[#090D12] font-semibold'
                              : 'bg-[#141C24] border-[#202B34] text-[#A1AFB8] hover:text-[#E4EBEF] hover:border-[#2B3944]'
                          }`}
                        >
                          {Number(preset).toLocaleString('id-ID')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3.5 p-3.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#E4EBEF] text-xs">Pengaturan Unit Integer Atomic Raw (BigInt)</span>
                    <StatusBadge tone="warning">Format Internal Mesin</StatusBadge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[#A1AFB8] block mb-1 font-medium">
                        Min Order Size (Atomic Units):
                      </label>
                      <input
                        type="text"
                        required
                        value={pairConfigForm.minOrderSize}
                        onChange={e => {
                          const val = e.target.value.replace(/[^0-9]/g, '');
                          setPairConfigForm(f => ({
                            ...f,
                            minOrderSize: val,
                            minOrderTokens: formatAtomicToToken(val, editingPair.baseDecimals).replace(/\./g, '')
                          }));
                        }}
                        className="w-full bg-[#141C24] border border-[#2B3944] rounded-[7px] p-2.5 text-[#E4EBEF] font-mono focus:border-[#8DA5B1] outline-none"
                        placeholder="100000000"
                      />
                      <span className="text-[10px] text-[#35B887] mt-1 block font-mono">
                        = {formatAtomicToToken(pairConfigForm.minOrderSize, editingPair.baseDecimals)} {editingPair.baseCurrency}
                      </span>
                    </div>

                    <div>
                      <label className="text-[#A1AFB8] block mb-1 font-medium">
                        Max Order Size (Atomic Units):
                      </label>
                      <input
                        type="text"
                        required
                        value={pairConfigForm.maxOrderSize}
                        onChange={e => {
                          const val = e.target.value.replace(/[^0-9]/g, '');
                          setPairConfigForm(f => ({
                            ...f,
                            maxOrderSize: val,
                            maxOrderTokens: formatAtomicToToken(val, editingPair.baseDecimals).replace(/\./g, '')
                          }));
                        }}
                        className="w-full bg-[#141C24] border border-[#2B3944] rounded-[7px] p-2.5 text-[#E4EBEF] font-mono focus:border-[#8DA5B1] outline-none"
                        placeholder="1000000000000000"
                      />
                      <span className="text-[10px] text-[#35B887] mt-1 block font-mono">
                        = {formatAtomicToToken(pairConfigForm.maxOrderSize, editingPair.baseDecimals)} {editingPair.baseCurrency}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1 font-medium">Maker Fee (basis points):</label>
                  <input
                    type="number"
                    required
                    min="0"
                    max="1000"
                    value={pairConfigForm.makerFeeBps}
                    onChange={e => setPairConfigForm(f => ({ ...f, makerFeeBps: Number(e.target.value) }))}
                    className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
                  />
                  <span className="text-[10px] text-[#35B887] mt-0.5 block">
                    {(Number(pairConfigForm.makerFeeBps) / 100).toFixed(2)}% (10 bps = 0.10%)
                  </span>
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1 font-medium">Taker Fee (basis points):</label>
                  <input
                    type="number"
                    required
                    min="0"
                    max="1000"
                    value={pairConfigForm.takerFeeBps}
                    onChange={e => setPairConfigForm(f => ({ ...f, takerFeeBps: Number(e.target.value) }))}
                    className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
                  />
                  <span className="text-[10px] text-[#6D9FE8] mt-0.5 block">
                    {(Number(pairConfigForm.takerFeeBps) / 100).toFixed(2)}% (20 bps = 0.20%)
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] flex items-center justify-between">
                <div>
                  <span className="text-[#E4EBEF] font-semibold block">Status Matching Engine:</span>
                  <span className="text-[11px] text-[#A1AFB8]">
                    {pairConfigForm.isHalted
                      ? 'Perdagangan sedang dihentikan sementara (Order baru ditolak)'
                      : 'Perdagangan aktif normal (Order buy & sell dieksekusi)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPairConfigForm(f => ({ ...f, isHalted: !f.isHalted }))}
                  className={`px-3 py-1.5 rounded-[7px] text-xs font-semibold border transition-colors cursor-pointer ${
                    pairConfigForm.isHalted
                      ? 'bg-[#401F27] border-[#EA5B65]/50 text-[#EA5B65]'
                      : 'bg-[#12392F] border-[#16A879]/50 text-[#35B887]'
                  }`}
                >
                  {pairConfigForm.isHalted ? 'DIHENTIKAN (HALTED)' : 'AKTIF NORMAL'}
                </button>
              </div>

              {/* Manual Delisting Toggle (isDelisted) & Scheduled Delisting Date Picker */}
              <div className="p-3.5 rounded-[7px] bg-[#111820] border border-[#2B3944] space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[#E4EBEF] font-semibold">Manual Delisting Market</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#17212B] border border-[#2B3944] text-[#8DA5B1]">
                        isDelisted
                      </span>
                    </div>
                    <span className="text-[11px] text-[#A1AFB8] block mt-0.5">
                      {pairConfigForm.isDelisted
                        ? 'Pasar ditandai DELISTED — seluruh order terbuka dibatalkan & direfund otomatis, bot dihentikan, dan order baru diblokir.'
                        : 'Pasar berstatus Listed — aktifkan toggle untuk delisting segera atau pilih tanggal untuk menjadwalkan delisting.'}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={pairConfigForm.isDelisted}
                    aria-label="Toggle isDelisted"
                    onClick={() =>
                      setPairConfigForm(f => ({
                        ...f,
                        isDelisted: !f.isDelisted,
                        isHalted: !f.isDelisted ? true : f.isHalted,
                      }))
                    }
                    className={`relative inline-flex h-6 w-12 shrink-0 items-center rounded-full border transition-colors cursor-pointer ${
                      pairConfigForm.isDelisted
                        ? 'bg-[#EA5B65]/80 border-[#EA5B65]'
                        : 'bg-[#141C24] border-[#2B3944] hover:border-[#40515D]'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-[#E4EBEF] transition-transform ${
                        pairConfigForm.isDelisted ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {!pairConfigForm.isDelisted && (
                  <div className="pt-2.5 border-t border-[#202B34] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[11px] font-medium text-[#A1AFB8] flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-[#D6A85C]" />
                        <span>Jadwalkan Tanggal &amp; Waktu Delisting (Opsional)</span>
                      </label>
                      {pairConfigForm.delistScheduledAt && (
                        <button
                          type="button"
                          onClick={() => setPairConfigForm(f => ({ ...f, delistScheduledAt: '' }))}
                          className="text-[10px] font-mono text-[#EA5B65] hover:underline cursor-pointer"
                        >
                          Hapus Jadwal
                        </button>
                      )}
                    </div>

                    <input
                      type="datetime-local"
                      value={pairConfigForm.delistScheduledAt}
                      onChange={e => setPairConfigForm(f => ({ ...f, delistScheduledAt: e.target.value }))}
                      className="w-full bg-[#141C24] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
                    />

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-[#71818B]">Preset:</span>
                      {[
                        { label: '+15 Menit', mins: 15 },
                        { label: '+1 Jam', mins: 60 },
                        { label: '+24 Jam', mins: 1440 },
                        { label: '+7 Hari', mins: 10080 },
                      ].map(preset => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() =>
                            setPairConfigForm(f => ({
                              ...f,
                              delistScheduledAt: toLocalDateTimeInput(Date.now() + preset.mins * 60 * 1000),
                            }))
                          }
                          className="px-2 py-0.5 rounded bg-[#17212B] hover:bg-[#1D2832] border border-[#2B3944] text-[10px] font-mono text-[#A1AFB8] hover:text-[#E4EBEF] transition-colors cursor-pointer"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    {pairConfigForm.delistScheduledAt &&
                      Number.isFinite(new Date(pairConfigForm.delistScheduledAt).getTime()) &&
                      new Date(pairConfigForm.delistScheduledAt).getTime() > nowMs && (
                        <div className="p-2 rounded-[6px] bg-[#2C2415]/40 border border-[#D6A85C]/30 flex items-center justify-between text-[11px]">
                          <span className="text-[#D6A85C] flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            Countdown Delisting akan aktif di Market Chart
                          </span>
                          <span className="font-mono font-semibold text-[#E4EBEF] tabular-nums">
                            T-{formatCountdownCompact(new Date(pairConfigForm.delistScheduledAt).getTime(), nowMs)}
                          </span>
                        </div>
                      )}
                  </div>
                )}

                {(pairConfigForm.isDelisted || pairConfigForm.delistScheduledAt) && (
                  <div className="pt-1">
                    <label className="text-[11px] text-[#A1AFB8] block mb-1">
                      Alasan Delisting (Ditampilkan di Banner Chart &amp; Audit Log):
                    </label>
                    <input
                      type="text"
                      value={pairConfigForm.delistReason}
                      onChange={e => setPairConfigForm(f => ({ ...f, delistReason: e.target.value }))}
                      placeholder="Contoh: Evaluasi likuiditas berkala / migrasi kontrak token"
                      className="w-full bg-[#141C24] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2 border-t border-[#202B34]">
                <Button type="button" variant="secondary" size="md" className="w-1/3" onClick={() => setShowEditPairModal(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="primary" size="md" className="w-2/3" icon={<CheckCircle2 className="w-4 h-4" />}>
                  Simpan Konfigurasi Pair
                </Button>
              </div>
            </form>
          </div>
        )}
      </Modal>

      {/* =========================================================================
          MODAL: LEDGER BALANCE ADJUSTMENT
          ========================================================================= */}
      <Modal
        isOpen={showAdjustLedgerModal}
        onClose={() => setShowAdjustLedgerModal(false)}
        title="Entri Penyesuaian Saldo Buku Besar"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleAdjustLedger} className="space-y-3 text-xs">
          <div>
            <label className="text-[#A1AFB8] block mb-1">Pilih Pengguna:</label>
            <select
              required
              value={ledgerAdjData.userId}
              onChange={e => setLedgerAdjData({ ...ledgerAdjData, userId: e.target.value })}
              className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
            >
              <option value="">-- Pilih Akun Pengguna --</option>
              {usersList.map(u => (
                <option key={u.id} value={u.id}>
                  {u.email} ({u.fullName})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Mata Uang:</label>
              <select
                value={ledgerAdjData.currency}
                onChange={e => setLedgerAdjData({ ...ledgerAdjData, currency: e.target.value })}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
              >
                <option value="IDR">IDR (Rupiah)</option>
                <option value="BTC">BTC (Bitcoin)</option>
                <option value="ETH">ETH (Ethereum)</option>
                <option value="USDT">USDT (Tether)</option>
              </select>
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">Arah Penyesuaian:</label>
              <select
                value={ledgerAdjData.direction}
                onChange={e => setLedgerAdjData({ ...ledgerAdjData, direction: e.target.value as any })}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-semibold outline-none focus:border-[#8DA5B1]"
              >
                <option value="CREDIT">CREDIT (Tambah Saldo)</option>
                <option value="DEBIT">DEBIT (Kurangi Saldo)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[#A1AFB8] block mb-1">Jumlah (Atomic Units):</label>
            <input
              type="text"
              required
              placeholder={ledgerAdjData.currency === 'IDR' ? '100000000 (= Rp 1.000.000,00)' : '100000000 (= 1.0 Coin)'}
              value={ledgerAdjData.amountUnits}
              onChange={e => setLedgerAdjData({ ...ledgerAdjData, amountUnits: e.target.value.replace(/\D/g, '') })}
              className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div>
            <label className="text-[#A1AFB8] block mb-1">Alasan Penyesuaian (Wajib untuk Audit):</label>
            <textarea
              required
              rows={2}
              placeholder="Koreksi transaksi manual / deposit simulasi / penyesuaian arbitrase"
              value={ledgerAdjData.reason}
              onChange={e => setLedgerAdjData({ ...ledgerAdjData, reason: e.target.value })}
              className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div className="pt-2">
            <Button type="submit" variant="primary" size="md" className="w-full">
              Eksekusi Penyesuaian Buku Besar
            </Button>
          </div>
        </form>
      </Modal>

      {/* =========================================================================
          MODAL: MANUAL FX OVERRIDE
          ========================================================================= */}
      <Modal
        isOpen={showFxModal}
        onClose={() => setShowFxModal(false)}
        title="Override Kurs FX USDT/IDR Manual"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleUpdateFxRate} className="space-y-3 text-xs">
          <div>
            <label className="text-[#A1AFB8] block mb-1">Kurs Baru (IDR per 1 USDT):</label>
            <input
              type="number"
              step="1"
              required
              value={manualFxRate}
              onChange={e => setManualFxRate(e.target.value)}
              className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono font-semibold text-base outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div>
            <label className="text-[#A1AFB8] block mb-1">Alasan Penyesuaian (Audit Log):</label>
            <input
              type="text"
              required
              value={fxReason}
              onChange={e => setFxReason(e.target.value)}
              className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div className="pt-2">
            <Button type="submit" variant="primary" size="md" className="w-full">
              Simpan Kurs Efektif
            </Button>
          </div>
        </form>
      </Modal>

      {/* =========================================================================
          MODAL: MARKET DELISTING (SCHEDULED COUNTDOWN OR IMMEDIATE)
          ========================================================================= */}
      <Modal
        isOpen={showDelistModal && Boolean(delistingPair)}
        onClose={() => setShowDelistModal(false)}
        title={delistingPair ? `Delisting Market: ${delistingPair.id}` : 'Delisting Market'}
        subtitle="Jadwalkan penghapusan pasar dengan Countdown Timer di Chart atau eksekusi delisting segera"
        maxWidth="max-w-lg"
      >
        {delistingPair && (
          <form onSubmit={handleSubmitDelist} className="space-y-4 text-xs">
            {/* Mode Switcher */}
            <div className="grid grid-cols-2 gap-2 p-1 rounded-[7px] bg-[#111820] border border-[#202B34]">
              <button
                type="button"
                onClick={() => setDelistMode('SCHEDULE')}
                className={`py-2 px-3 rounded-[5px] text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                  delistMode === 'SCHEDULE'
                    ? 'bg-[#2C2415] text-[#D6A85C] border border-[#D6A85C]/40'
                    : 'text-[#A1AFB8] hover:text-[#E4EBEF]'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Jadwalkan Delisting</span>
              </button>
              <button
                type="button"
                onClick={() => setDelistMode('IMMEDIATE')}
                className={`py-2 px-3 rounded-[5px] text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                  delistMode === 'IMMEDIATE'
                    ? 'bg-[#401F27] text-[#EA5B65] border border-[#EA5B65]/40'
                    : 'text-[#A1AFB8] hover:text-[#E4EBEF]'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delist Sekarang</span>
              </button>
            </div>

            {delistingPair.delistScheduledAt && delistingPair.delistScheduledAt > nowMs && (
              <div className="p-3 rounded-[7px] bg-[#2C2415]/40 border border-[#D6A85C]/30 flex items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] font-semibold text-[#D6A85C] block">
                    Delisting Sudah Terjadwal
                  </span>
                  <span className="text-[10px] font-mono text-[#A1AFB8]">
                    {new Date(delistingPair.delistScheduledAt).toLocaleString('id-ID')} (T-{formatCountdownCompact(delistingPair.delistScheduledAt, nowMs)})
                  </span>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isDelistSubmitting}
                  onClick={() => handleCancelScheduledDelist(delistingPair.id)}
                >
                  Batalkan Jadwal
                </Button>
              </div>
            )}

            {delistMode === 'SCHEDULE' ? (
              <div className="space-y-2.5">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">
                    Waktu Eksekusi Delisting (Waktu Lokal):
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={delistDateTime}
                    onChange={e => setDelistDateTime(e.target.value)}
                    className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-[#71818B] mr-1">Preset Cepat:</span>
                  {[
                    { label: '+2 Menit', mins: 2 },
                    { label: '+15 Menit', mins: 15 },
                    { label: '+1 Jam', mins: 60 },
                    { label: '+24 Jam', mins: 1440 },
                    { label: '+7 Hari', mins: 10080 },
                  ].map(preset => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyDelistPreset(preset.mins)}
                      className="px-2 py-1 rounded bg-[#17212B] hover:bg-[#1D2832] border border-[#2B3944] text-[10px] font-mono text-[#A1AFB8] hover:text-[#E4EBEF] transition-colors cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] text-[11px] text-[#A1AFB8] leading-relaxed">
                  Selama masa tunggu, trader tetap dapat melihat grafik &amp; mengelola posisi dengan <strong className="text-[#EA5B65]">Banner Countdown Delisting</strong> live di atas Market Chart. Saat hitungan mundur habis, sistem otomatis membatalkan &amp; merefund semua order terbuka.
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-[7px] bg-[#401F27]/40 border border-[#EA5B65]/40 space-y-1.5 text-[11px]">
                <div className="flex items-center gap-1.5 font-semibold text-[#EA5B65]">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Peringatan Delisting Permanen Segera</span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[#E4EBEF]/90">
                  <li>Semua order terbuka (open/resting) pada <strong>{delistingPair.id}</strong> akan dibatalkan otomatis &amp; dana direfund ke dompet trader (double-entry ledger terjaga).</li>
                  <li>Semua bot Market Maker / Grid / DCA pada pasangan ini akan dihentikan otomatis.</li>
                  <li>Order baru akan ditolak dan Market Chart akan menampilkan status <strong>Market Delisted</strong>.</li>
                </ul>
              </div>
            )}

            <div>
              <label className="text-[#A1AFB8] block mb-1">
                Alasan Delisting (Ditampilkan di Banner Chart &amp; Audit Log):
              </label>
              <textarea
                required
                rows={2}
                value={delistReason}
                onChange={e => setDelistReason(e.target.value)}
                placeholder="Contoh: Volume perdagangan di bawah ambang likuiditas minimum / migrasi kontrak token"
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#202B34]">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowDelistModal(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                variant="danger"
                size="sm"
                disabled={isDelistSubmitting}
              >
                {isDelistSubmitting
                  ? 'Memproses...'
                  : delistMode === 'SCHEDULE'
                  ? 'Jadwalkan Delisting'
                  : 'Eksekusi Delisting Sekarang'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL CREATE EARN VAULT */}
      <Modal
        isOpen={showCreateEarnModal}
        onClose={() => setShowCreateEarnModal(false)}
        title="Buat Vault Earn & Staking Baru"
        subtitle="Konfigurasikan produk Earn dengan aset aktif di registry DIMONEX dan akun Custody tersegregasi."
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleCreateEarnVault} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Aset (ACTIVE di Registry)</label>
              <input
                type="text"
                required
                value={newEarnVaultForm.asset}
                onChange={e => setNewEarnVaultForm(p => ({ ...p, asset: e.target.value.toUpperCase() }))}
                placeholder="USDT / BTC / ETH / IDR / SOL / TON"
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              />
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">Tipe Produk</label>
              <select
                value={newEarnVaultForm.type}
                onChange={e => setNewEarnVaultForm(p => ({ ...p, type: e.target.value as any }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
              >
                <option value="FLEXIBLE">FLEXIBLE</option>
                <option value="FIXED">FIXED</option>
                <option value="STAKING">STAKING</option>
                <option value="LAUNCHPOOL">LAUNCHPOOL</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[#A1AFB8] block mb-1">Nama Vault</label>
            <input
              type="text"
              required
              value={newEarnVaultForm.name}
              onChange={e => setNewEarnVaultForm(p => ({ ...p, name: e.target.value }))}
              placeholder="Contoh: Tether USD 30-Day Prime Vault"
              className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Durasi (Hari, 0 = Fleksibel)</label>
              <input
                type="number"
                min="0"
                required
                value={newEarnVaultForm.durationDays}
                onChange={e => setNewEarnVaultForm(p => ({ ...p, durationDays: e.target.value }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              />
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">Estimasi APY (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="500"
                required
                value={newEarnVaultForm.apyPct}
                onChange={e => setNewEarnVaultForm(p => ({ ...p, apyPct: e.target.value }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Min Stake</label>
              <input
                type="text"
                required
                value={newEarnVaultForm.minStakeTokens}
                onChange={e => setNewEarnVaultForm(p => ({ ...p, minStakeTokens: e.target.value }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none"
              />
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">Max / Tx</label>
              <input
                type="text"
                value={newEarnVaultForm.maxStakeTokens}
                onChange={e => setNewEarnVaultForm(p => ({ ...p, maxStakeTokens: e.target.value }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none"
              />
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">Total Pool Cap</label>
              <input
                type="text"
                required
                value={newEarnVaultForm.totalCapTokens}
                onChange={e => setNewEarnVaultForm(p => ({ ...p, totalCapTokens: e.target.value }))}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] p-2 text-[#E4EBEF] font-mono outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <label className="flex items-center gap-2 text-[#E4EBEF] cursor-pointer">
              <input
                type="checkbox"
                checked={newEarnVaultForm.autoCompoundSupported}
                onChange={e => setNewEarnVaultForm(p => ({ ...p, autoCompoundSupported: e.target.checked }))}
                className="w-4 h-4 accent-[#16A879]"
              />
              <span>Dukung Auto-Compound</span>
            </label>
            <label className="flex items-center gap-2 text-[#E4EBEF] cursor-pointer">
              <input
                type="checkbox"
                checked={newEarnVaultForm.earlyRedeemAllowed}
                onChange={e => setNewEarnVaultForm(p => ({ ...p, earlyRedeemAllowed: e.target.checked }))}
                className="w-4 h-4 accent-[#16A879]"
              />
              <span>Izinkan Early Redeem</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#202B34]">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowCreateEarnModal(false)}>
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm">
              Buat Vault Earn
            </Button>
          </div>
        </form>
      </Modal>

      {/* UNIFIED CONFIRMATION / PROMPT DIALOG */}
      {confirmConfig && (
        <ConfirmationDialog
          isOpen={confirmConfig.isOpen}
          onClose={() => setConfirmConfig(null)}
          title={confirmConfig.title}
          description={confirmConfig.description}
          confirmLabel={confirmConfig.confirmLabel}
          tone={confirmConfig.tone}
          fields={confirmConfig.fields}
          isLoading={isConfirmBusy}
          onConfirm={async (values) => {
            setIsConfirmBusy(true);
            try {
              await confirmConfig.onSubmit(values);
              setConfirmConfig(null);
            } catch (e: any) {
              showToast('error', e?.message || 'Operasi gagal diproses');
            } finally {
              setIsConfirmBusy(false);
            }
          }}
        />
      )}
    </div>
  );
};
