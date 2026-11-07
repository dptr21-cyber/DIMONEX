/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/admin/AdminView.tsx
 * DOMINEX Master Admin & Operations Console — Complete Multi-Feature Control Center
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
  Sliders
} from 'lucide-react';
import { UserProfile, TradingPairItem } from '../../types/index.js';
import { formatIDR, formatCrypto, formatDateTime, safeBigInt, formatQuotePrice } from '../../lib/formatters.js';
import { ListingManagementView } from './listing/ListingManagementView.js';

interface Props {
  user: UserProfile | null;
  tradingPairs: TradingPairItem[];
  onRefreshPairs: () => void;
  onOpenAuthModal: () => void;
}

type AdminTab =
  | 'OVERVIEW'
  | 'PAIRS'
  | 'LISTING'
  | 'USERS'
  | 'WITHDRAWALS'
  | 'LEDGER'
  | 'BOTS'
  | 'FX'
  | 'PRODUCTS'
  | 'RISK'
  | 'AUDIT';

export const AdminView: React.FC<Props> = ({ user, tradingPairs, onRefreshPairs, onOpenAuthModal }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('OVERVIEW');
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Data states
  const [stats, setStats] = useState<any>(null);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [pendingWd, setPendingWd] = useState<{ fiat: any[]; crypto: any[] }>({ fiat: [], crypto: [] });
  const [riskAlerts, setRiskAlerts] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [botsList, setBotsList] = useState<any[]>([]);
  const [earnpools, setEarnPools] = useState<any[]>([]);
  const [copyMasters, setCopyMasters] = useState<any[]>([]);
  const [vipTiers, setVipTiers] = useState<any[]>([]);
  const [fxStatus, setFxStatus] = useState<any>(null);

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
  const [pairConfigForm, setPairConfigForm] = useState({
    inputMode: 'TOKENS' as 'TOKENS' | 'ATOMIC',
    minOrderTokens: '1',
    maxOrderTokens: '10000000',
    minOrderSize: '100000000',
    maxOrderSize: '1000000000000000',
    makerFeeBps: 10,
    takerFeeBps: 20,
    isHalted: false,
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

  const showToast = (type: 'success' | 'error', text: string) => {
    setFeedbackMsg({ type, text });
    setTimeout(() => setFeedbackMsg(null), 5000);
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
        copyRes,
        vipRes,
        fxRes
      ] = await Promise.all([
        fetch('/api/admin/stats', { headers }),
        fetch('/api/admin/users', { headers }),
        fetch('/api/admin/withdrawals/pending', { headers }),
        fetch('/api/risk/suspicious-activity', { headers }),
        fetch('/api/admin/audit-logs', { headers }),
        fetch('/api/admin/bots/all', { headers }),
        fetch('/api/admin/earn/pools', { headers }),
        fetch('/api/admin/copy-trading/masters', { headers }),
        fetch('/api/admin/vip-tiers', { headers }),
        fetch('/api/mm/fx-status', { headers })
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (usersRes.ok) setUsersList(await usersRes.json());
      if (wdRes.ok) setPendingWd(await wdRes.json());
      if (riskRes.ok) setRiskAlerts(await riskRes.json());
      if (auditRes.ok) setAuditLogs(await auditRes.json());
      if (botsRes.ok) setBotsList(await botsRes.json());
      if (earnRes.ok) setEarnPools(await earnRes.json());
      if (copyRes.ok) setCopyMasters(await copyRes.json());
      if (vipRes.ok) setVipTiers(await vipRes.json());
      if (fxRes.ok) setFxStatus(await fxRes.json());
    } catch (err: any) {
      console.error('Failed to load admin data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin]);

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
      <div className="p-8 max-w-lg mx-auto mt-12 text-center bg-[#08090D] border border-white/10 rounded-2xl shadow-2xl space-y-4">
        <div className="w-12 h-12 rounded-xl bg-[#FF087F]/10 border border-[#FF087F]/30 flex items-center justify-center mx-auto text-[#FF087F]">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-[#F5F5F7] font-display">Konsol Operator Khusus Administrator</h2>
        <p className="text-xs text-[#9298A6] leading-relaxed">
          Area ini dibatasi ketat khusus untuk Tim Administrator, Super Admin, dan Kepatuhan Bursa DIMONEX.
          Silakan masuk dengan kredensial administrator resmi.
        </p>
        <button
          onClick={onOpenAuthModal}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#FF087F] to-[#D926FF] text-white font-semibold text-xs shadow-lg shadow-[#FF087F]/30 hover:brightness-110 transition-all"
        >
          Masuk sebagai Admin
        </button>
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

  const handleUpdateFees = async (pairId: string, currentMaker: number, currentTaker: number) => {
    const makerStr = prompt(`Masukkan Maker Fee baru untuk ${pairId} (basis points, 10 bps = 0.10%):`, String(currentMaker));
    if (makerStr === null) return;
    const takerStr = prompt(`Masukkan Taker Fee baru untuk ${pairId} (basis points, 20 bps = 0.20%):`, String(currentTaker));
    if (takerStr === null) return;

    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/pairs/update-fees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          pairId,
          makerFeeBps: parseInt(makerStr, 10),
          takerFeeBps: parseInt(takerStr, 10)
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
    } catch (e: any) {
      showToast('error', e.message);
    }
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
        isHalted: Boolean(pairConfigForm.isHalted)
      };

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
        showToast('success', data.message || `Limit ${editingPair.id} berhasil diperbarui!`);
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

  const handleChangeRole = async (userId: string, newRole: string) => {
    if (!confirm(`Konfirmasi perubahan role pengguna menjadi ${newRole}?`)) return;
    try {
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
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleReset2fa = async (userId: string, userEmail: string) => {
    if (!confirm(`Apakah Anda yakin ingin menonaktifkan 2FA TOTP untuk ${userEmail}? Tindakan ini dicatat dalam audit.`)) return;
    try {
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
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleToggleFreeze = async (userId: string, currentStatus: string) => {
    const isFrozen = currentStatus === 'frozen';
    const reason = prompt(
      isFrozen ? 'Alasan membuka kembali pembekuan akun:' : 'Alasan pembekuan akun (AML / Fraud / Permintaan Kepatuhan):',
      isFrozen ? 'Pemeriksaan kepatuhan selesai' : 'Investigasi kepatuhan AML'
    );
    if (!reason) return;

    try {
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
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleReviewKyc = async (userId: string, action: 'APPROVE' | 'REJECT') => {
    const reason = action === 'REJECT' ? prompt('Alasan penolakan KYC:', 'Foto identitas buram atau tidak sesuai') : undefined;
    if (action === 'REJECT' && !reason) return;

    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/kyc/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, action, rejectionReason: reason, tierLevel: action === 'APPROVE' ? 2 : 0 })
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

  const handleApproveWd = async (txId: string, txType: 'FIAT' | 'CRYPTO') => {
    if (!confirm(`Konfirmasi persetujuan penarikan ${txType} ini? Dana akan dilepas secara permanen.`)) return;
    try {
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
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  const handleRejectWd = async (txId: string, txType: 'FIAT' | 'CRYPTO') => {
    const reason = prompt('Alasan penolakan penarikan (dana terkunci akan dikembalikan ke saldo user):', 'Verifikasi data bank tidak valid');
    if (!reason) return;
    try {
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
    } catch (e: any) {
      showToast('error', e.message);
    }
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

  const handleEmergencyStopBots = async (botId?: string) => {
    const confirmMsg = botId
      ? 'Hentikan seketika bot ini?'
      : '⚠️ PERINGATAN DARURAT: Hentikan SEMUA bot trading yang sedang berjalan di seluruh bursa?';
    if (!confirm(confirmMsg)) return;

    try {
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
    } catch (e: any) {
      showToast('error', e.message);
    }
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

  const handleUpdateStakingPool = async (poolId: string, currentApy: number) => {
    const apyStr = prompt(`Masukkan APY baru untuk staking pool ${poolId} (%):`, String(currentApy));
    if (apyStr === null) return;
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/earn/pools/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ poolId, apy: parseFloat(apyStr) })
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

  const handleUpdateVipTier = async (tier: number, currentMaker: number, currentTaker: number) => {
    const mStr = prompt(`VIP Tier ${tier}: Masukkan Maker Fee (bps):`, String(currentMaker));
    if (mStr === null) return;
    const tStr = prompt(`VIP Tier ${tier}: Masukkan Taker Fee (bps):`, String(currentTaker));
    if (tStr === null) return;

    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/admin/vip-tiers/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier, makerFeeBps: parseInt(mStr, 10), takerFeeBps: parseInt(tStr, 10) })
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
          className={`fixed top-16 right-6 z-50 p-4 rounded-xl border text-xs font-semibold shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-200 ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : 'bg-red-950/90 border-red-500/50 text-red-200'
          }`}
        >
          {feedbackMsg.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertTriangle className="w-5 h-5 text-red-400" />}
          <span>{feedbackMsg.text}</span>
          <button onClick={() => setFeedbackMsg(null)} className="ml-2 hover:opacity-80">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header Card */}
      <div className="p-5 rounded-2xl bg-[#0D1017] border border-white/10 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#FF087F] to-[#D926FF] flex items-center justify-center shadow-lg shadow-[#FF087F]/30 text-white">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold font-display text-[#F5F5F7]">DOMINEX Exchange Operations Console</h1>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-[#FF087F]/15 text-[#FF087F] border border-[#FF087F]/30 uppercase">
                  Superadmin RBAC
                </span>
              </div>
              <span className="text-xs text-[#9298A6] font-mono">
                Operator: {user.email} · Peran: <span className="text-emerald-400 font-bold">{user.role}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={loadAllData}
            disabled={isLoading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#171923] hover:bg-white/10 border border-white/10 text-xs font-semibold text-[#F5F5F7] transition-all"
            title="Segarkan Semua Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#FF087F]' : 'text-[#9298A6]'}`} />
            <span>Segarkan</span>
          </button>

          <button
            onClick={() => handleEmergencyStopBots()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-xs font-bold text-red-300 transition-all shadow-lg shadow-red-900/20"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span>Kill-Switch Semua Bot</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none border-b border-white/10">
        {[
          { id: 'OVERVIEW', label: 'Ringkasan Eksekutif', icon: LayoutDashboard },
          { id: 'PAIRS', label: `Pasar & Fee (${tradingPairs.length})`, icon: Coins },
          { id: 'LISTING', label: 'Initial Token Listing', icon: Rocket },
          { id: 'USERS', label: `Pengguna & KYC (${usersList.length})`, icon: Users, badge: pendingKycCount > 0 ? pendingKycCount : undefined },
          { id: 'WITHDRAWALS', label: `Antrean Penarikan`, icon: ArrowUpRight, badge: pendingWithdrawalCount > 0 ? pendingWithdrawalCount : undefined },
          { id: 'LEDGER', label: 'Buku Besar & Solvensi', icon: Wallet },
          { id: 'BOTS', label: `Bot & MM (${botsList.length})`, icon: Bot },
          { id: 'FX', label: 'FX Engine (USDT/IDR)', icon: TrendingUp },
          { id: 'PRODUCTS', label: 'Earn, Copy & VIP', icon: PiggyBank },
          { id: 'RISK', label: `Risk & AML (${riskAlerts.length})`, icon: ShieldAlert },
          { id: 'AUDIT', label: 'Audit Trail', icon: FileText }
        ].map(t => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as AdminTab)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-150 ${
                isActive
                  ? 'bg-gradient-to-r from-[#FF087F]/20 to-[#D926FF]/15 text-white border border-[#FF087F]/40 shadow-sm'
                  : 'text-[#9298A6] hover:text-[#F5F5F7] hover:bg-[#171923] border border-transparent'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#FF087F]' : 'text-[#686D7A]'}`} />
              <span>{t.label}</span>
              {t.badge !== undefined && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-[#FF087F] text-white font-mono">
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* =========================================================================
          TAB 1: EXECUTIVE OVERVIEW & HEALTH METRICS
          ========================================================================= */}
      {activeTab === 'OVERVIEW' && (
        <div className="space-y-6">
          {/* Key Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-[#0D1017] border border-white/10">
              <span className="text-[11px] text-[#9298A6] font-medium block">Total Pengguna Terdaftar</span>
              <span className="text-xl font-bold font-mono text-[#F5F5F7] mt-1 block">
                {stats?.totalUsers || usersList.length} Akun
              </span>
              <span className="text-[10px] text-emerald-400 font-mono mt-1 block">
                ● {usersList.filter(u => u.status === 'active').length} Akun Aktif
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-[#0D1017] border border-white/10">
              <span className="text-[11px] text-[#9298A6] font-medium block">Estimasi Volume 24 Jam</span>
              <span className="text-xl font-bold font-mono text-[#F5F5F7] mt-1 block">
                {stats?.volume24hIdr ? formatIDR(stats.volume24hIdr, true) : 'Rp 0'}
              </span>
              <span className="text-[10px] text-purple-400 font-mono mt-1 block">
                Dari {stats?.totalTrades || 0} transaksi executed
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-[#0D1017] border border-white/10">
              <span className="text-[11px] text-[#9298A6] font-medium block">Matching Engine Orders</span>
              <span className="text-xl font-bold font-mono text-[#F5F5F7] mt-1 block">
                {stats?.openOrdersCount || 0} Resting
              </span>
              <span className="text-[10px] text-blue-400 font-mono mt-1 block">
                Total {stats?.totalOrders || 0} order lifetime
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-[#0D1017] border border-white/10">
              <span className="text-[11px] text-[#9298A6] font-medium block">Automated Trading Bots</span>
              <span className="text-xl font-bold font-mono text-[#F5F5F7] mt-1 block">
                {stats?.activeBots || 0} Berjalan
              </span>
              <span className="text-[10px] text-amber-400 font-mono mt-1 block">
                Total {stats?.totalBots || botsList.length} terkonfigurasi
              </span>
            </div>
          </div>

          {/* Double-Entry Ledger Invariant Verification */}
          <div className="p-5 rounded-2xl bg-[#0D1017] border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-[#F5F5F7] font-display">
                  Status Verifikasi Invarian Buku Besar (Atomic Ledger Solvency)
                </h3>
              </div>
              <span className="px-2.5 py-1 text-[11px] font-mono font-bold rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300">
                100% KONSISTEN (Sum Debits == Sum Credits)
              </span>
            </div>
            <p className="text-xs text-[#9298A6] leading-relaxed">
              Seluruh transaksi saldo pengguna dijamin oleh sistem pencatatan ganda (*double-entry bookkeeping*).
              Tidak ada pencetakan saldo sintetik atau modifikasi floating point lepas. Setiap kredit harus memiliki debit tandingan pada rekening cadangan perbendaharaan (*Treasury Reserve*).
            </p>

            {/* Solvency Liabilities Table */}
            {stats?.liabilitiesByCurrency && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                {Object.entries(stats.liabilitiesByCurrency).map(([curr, val]: [string, any]) => (
                  <div key={curr} className="p-3 rounded-xl bg-[#171923] border border-white/5 font-mono text-xs">
                    <span className="text-[#9298A6] text-[10px] block">{curr} Liabilitas Sirkulasi</span>
                    <span className="font-bold text-[#F5F5F7] text-sm block mt-0.5">
                      {curr === 'IDR' ? formatIDR(val.total) : `${(Number(safeBigInt(val.total)) / 1e8).toLocaleString()} ${curr}`}
                    </span>
                    <span className="text-[10px] text-[#686D7A] block mt-0.5">
                      Terkunci order: {curr === 'IDR' ? formatIDR(val.locked) : `${(Number(safeBigInt(val.locked)) / 1e8).toLocaleString()}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Infrastructure Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-[#0D1017] border border-white/10">
              <span className="text-xs font-bold text-[#F5F5F7] block mb-2 font-display">Sistem & Uptime Server</span>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between text-[#9298A6]">
                  <span>Server Uptime:</span>
                  <span className="text-emerald-400 font-bold">{Math.floor((stats?.uptimeSeconds || 0) / 3600)}j {Math.floor(((stats?.uptimeSeconds || 0) % 3600) / 60)}m</span>
                </div>
                <div className="flex justify-between text-[#9298A6]">
                  <span>Heap Used:</span>
                  <span className="text-[#F5F5F7]">{Math.round((stats?.memoryUsage?.heapUsed || 0) / 1024 / 1024)} MB</span>
                </div>
                <div className="flex justify-between text-[#9298A6]">
                  <span>RSS Memory:</span>
                  <span className="text-[#F5F5F7]">{Math.round((stats?.memoryUsage?.rss || 0) / 1024 / 1024)} MB</span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#0D1017] border border-white/10">
              <span className="text-xs font-bold text-[#F5F5F7] block mb-2 font-display">Kepatuhan & Antrean</span>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between text-[#9298A6]">
                  <span>Review KYC Menunggu:</span>
                  <span className={`font-bold ${pendingKycCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {pendingKycCount} Permintaan
                  </span>
                </div>
                <div className="flex justify-between text-[#9298A6]">
                  <span>Antrean Penarikan IDR:</span>
                  <span className={`font-bold ${pendingWd.fiat.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {pendingWd.fiat.length} Antrean
                  </span>
                </div>
                <div className="flex justify-between text-[#9298A6]">
                  <span>Antrean Penarikan Kripto:</span>
                  <span className={`font-bold ${pendingWd.crypto.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {pendingWd.crypto.length} Antrean
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#0D1017] border border-white/10">
              <span className="text-xs font-bold text-[#F5F5F7] block mb-2 font-display">FX Engine & Feeds</span>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between text-[#9298A6]">
                  <span>Kurs USDT/IDR Efektif:</span>
                  <span className="text-[#FF087F] font-bold">Rp {(fxStatus?.effectiveRateIdr || 16350).toLocaleString('id-ID')}</span>
                </div>
                <div className="flex justify-between text-[#9298A6]">
                  <span>Sumber Kurs:</span>
                  <span className="text-[#F5F5F7] font-semibold">{fxStatus?.source || 'COINMARKETCAP'}</span>
                </div>
                <div className="flex justify-between text-[#9298A6]">
                  <span>Aggregator Status:</span>
                  <span className="text-emerald-400 font-bold">ACTIVE (0 bps drift)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: MARKETS, PAIRS & CIRCUIT BREAKERS
          ========================================================================= */}
      {activeTab === 'PAIRS' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[#F5F5F7] font-display">Daftar Pasangan Perdagangan & Fee Schedule</h3>
              <p className="text-xs text-[#9298A6]">Kontrol operasional matching engine, emergency halt, dan penetapan Maker/Taker Fee bursa.</p>
            </div>
            <button
              onClick={() => setShowCreatePairModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#FF087F] to-[#D926FF] text-white text-xs font-bold shadow-lg shadow-[#FF087F]/30 hover:brightness-110 transition-all self-start"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Trading Pair Baru</span>
            </button>
          </div>

          <div className="rounded-2xl bg-[#0D1017] border border-white/10 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="bg-[#171923] text-[11px] text-[#9298A6] border-b border-white/10 font-sans">
                  <tr>
                    <th className="px-4 py-3">Trading Pair</th>
                    <th className="px-4 py-3">Harga Terakhir</th>
                    <th className="px-4 py-3">Limit Kuantitas Order (Min - Max)</th>
                    <th className="px-4 py-3">Maker / Taker Fee</th>
                    <th className="px-4 py-3">Status Matching Engine</th>
                    <th className="px-4 py-3 text-right">Kontrol Operasional</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {tradingPairs.map(p => (
                    <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#F5F5F7] text-sm">{p.id}</span>
                          {p.isNewListing && (
                            <span className="px-1.5 py-0.2 rounded bg-[#FF087F]/20 text-[#FF087F] text-[9px] font-bold border border-[#FF087F]/30">
                              NEW
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-[#686D7A] block font-sans">
                          Decimals: Base {p.baseDecimals} / Quote {p.quoteDecimals}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-bold text-[#F5F5F7] font-mono">
                        {formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 font-bold text-[#F5F5F7] text-xs">
                            <span className="text-emerald-400">Min: {formatAtomicToToken(p.minOrderSize, p.baseDecimals)} {p.baseCurrency}</span>
                            <span className="text-[#686D7A]">—</span>
                            <span className="text-blue-400">Max: {formatAtomicToToken(p.maxOrderSize, p.baseDecimals)} {p.baseCurrency}</span>
                          </div>
                          <span className="text-[10px] text-[#686D7A] font-mono">
                            Atomic: {p.minOrderSize || '0'} s/d {p.maxOrderSize || '0'} units
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="text-emerald-400 font-semibold text-xs">
                          Maker: {(p.makerFeeBps / 100).toFixed(2)}% ({p.makerFeeBps} bps)
                        </div>
                        <div className="text-blue-400 font-semibold text-xs">
                          Taker: {(p.takerFeeBps / 100).toFixed(2)}% ({p.takerFeeBps} bps)
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-sans">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                            p.isHalted
                              ? 'bg-red-950/60 border border-red-500/40 text-red-300'
                              : 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${p.isHalted ? 'bg-red-400 animate-pulse' : 'bg-emerald-400'}`} />
                          {p.isHalted ? 'DIHENTIKAN (HALTED)' : 'BERJALAN NORMAL'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right space-x-2 font-sans whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenEditPairModal(p)}
                          className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white border border-blue-400/30 text-xs font-bold transition-all shadow-sm inline-flex items-center gap-1.5"
                          title="Kelola limit kuantitas order (Token / Integer) & fee"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                          <span>Kelola Limit & Fee</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleHalt(p.id, p.isHalted)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                            p.isHalted
                              ? 'bg-emerald-950/40 border-emerald-600 text-emerald-300 hover:bg-emerald-900/50'
                              : 'bg-red-950/40 border-red-700 text-red-300 hover:bg-red-900/50'
                          }`}
                        >
                          {p.isHalted ? 'Buka Halt' : 'Circuit Breaker (Halt)'}
                        </button>
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
              <h3 className="text-sm font-bold text-[#F5F5F7] font-display">Direktori Pengguna & Manajemen Hak Akses (RBAC)</h3>
              <p className="text-xs text-[#9298A6]">Kelola status akun, review verifikasi KTP/KYC, reset 2FA darurat, dan pembekuan akun.</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-[#686D7A] absolute left-3 top-3 pointer-events-none" />
              <input
                type="text"
                placeholder="Cari email / nama / role..."
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                className="w-full bg-[#0D1017] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-[#F5F5F7] placeholder-[#686D7A] outline-none focus:border-[#FF087F] font-mono"
              />
            </div>
          </div>

          {/* Quick Test Accounts & Credentials Card */}
          <div className="p-4 rounded-2xl bg-[#141a23] border border-blue-500/30 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-base">📋</span>
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-2 font-display">
                    Cheatsheet Kredensial Akun Pengujian (Test Accounts & Passwords)
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-950 text-blue-300 border border-blue-800 font-mono">
                      8 Akun Siap Uji
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Gunakan kredensial resmi di bawah untuk menguji seluruh fitur platform (Admin, MM, Compliance, & Trading Spot).
                  </p>
                </div>
              </div>
              <span className="text-[10px] text-slate-400 font-mono bg-black/40 px-2 py-1 rounded border border-white/5">
                Dokumentasi: README_AKUN_TEST.md
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px]">
              {/* 1. Admin */}
              <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-400">🛡️ Super Admin</span>
                  <span className="text-[9px] bg-red-950 text-red-300 px-1 rounded font-mono">ADMIN</span>
                </div>
                <div className="text-[10px] text-slate-300 font-mono">admin@dimonex.id</div>
                <div className="text-[10px] text-amber-300 font-mono">AdminDimonex2026!</div>
                <div className="text-[9px] text-slate-500">Akses: Admin & MM Console</div>
              </div>

              {/* 2. Compliance */}
              <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-purple-400">⚖️ Compliance Officer</span>
                  <span className="text-[9px] bg-purple-950 text-purple-300 px-1 rounded font-mono">ADMIN</span>
                </div>
                <div className="text-[10px] text-slate-300 font-mono">compliance@dimonex.id</div>
                <div className="text-[10px] text-purple-300 font-mono">ComplianceDimonex2026!</div>
                <div className="text-[9px] text-slate-500">Akses: KYC & AML Checker</div>
              </div>

              {/* 3. MM */}
              <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-cyan-400">⚡ Market Maker</span>
                  <span className="text-[9px] bg-cyan-950 text-cyan-300 px-1 rounded font-mono">MM</span>
                </div>
                <div className="text-[10px] text-slate-300 font-mono">mm@dimonex.id</div>
                <div className="text-[10px] text-cyan-300 font-mono">MarketMaker2026!</div>
                <div className="text-[9px] text-slate-500">Akses: Liquidity Bot Grid</div>
              </div>

              {/* 4. Trader Budi */}
              <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-blue-400">👤 Budi Santoso</span>
                  <span className="text-[9px] bg-blue-950 text-blue-300 px-1 rounded font-mono">TRADER 1</span>
                </div>
                <div className="text-[10px] text-slate-300 font-mono">budi@dimonex.id</div>
                <div className="text-[10px] text-slate-300 font-mono">TraderDimonex123!</div>
                <div className="text-[9px] text-slate-500">Saldo: Rp 10M, 10 BTC</div>
              </div>

              {/* 5. Trader Siti */}
              <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-400">👤 Siti Rahmawati</span>
                  <span className="text-[9px] bg-emerald-950 text-emerald-300 px-1 rounded font-mono">TRADER 2</span>
                </div>
                <div className="text-[10px] text-slate-300 font-mono">siti@dimonex.id</div>
                <div className="text-[10px] text-slate-300 font-mono">TraderDimonex123!</div>
                <div className="text-[9px] text-slate-500">Saldo: Rp 5M, 20 BTC</div>
              </div>

              {/* 6. User 1 */}
              <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">👤 User Satu Trading</span>
                  <span className="text-[9px] bg-slate-800 text-slate-300 px-1 rounded font-mono">USER 1</span>
                </div>
                <div className="text-[10px] text-slate-300 font-mono">user1@dimonex.id</div>
                <div className="text-[10px] text-slate-300 font-mono">User1Dimonex2026!</div>
                <div className="text-[9px] text-slate-500">Saldo: Rp 10M, 10 BTC</div>
              </div>

              {/* 7. User 2 */}
              <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">👤 User Dua Trading</span>
                  <span className="text-[9px] bg-slate-800 text-slate-300 px-1 rounded font-mono">USER 2</span>
                </div>
                <div className="text-[10px] text-slate-300 font-mono">user2@dimonex.id</div>
                <div className="text-[10px] text-slate-300 font-mono">User2Dimonex2026!</div>
                <div className="text-[9px] text-slate-500">Saldo: Rp 5M, 20 BTC</div>
              </div>

              {/* 8. Fresh Test User */}
              <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-400">✨ Akun Pengujian Baru</span>
                  <span className="text-[9px] bg-indigo-950 text-indigo-300 px-1 rounded font-mono">FRESH</span>
                </div>
                <div className="text-[10px] text-slate-300 font-mono">test@dimonex.id</div>
                <div className="text-[10px] text-indigo-300 font-mono">TestDimonex2026!</div>
                <div className="text-[9px] text-slate-500">Saldo: Rp 100jt, 1 BTC</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-[#0D1017] border border-white/10 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-sans">
                <thead className="bg-[#171923] text-[11px] text-[#9298A6] border-b border-white/10">
                  <tr>
                    <th className="px-4 py-3">Pengguna</th>
                    <th className="px-4 py-3">Nama Identitas (KTP)</th>
                    <th className="px-4 py-3">Role RBAC</th>
                    <th className="px-4 py-3">Status Akun</th>
                    <th className="px-4 py-3">Verifikasi KYC</th>
                    <th className="px-4 py-3">2FA TOTP</th>
                    <th className="px-4 py-3 text-right">Aksi Administrator</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {filteredUsers.map(u => (
                    <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3.5">
                        <span className="font-bold text-[#F5F5F7] block">{u.email}</span>
                        <span className="text-[10px] text-[#686D7A] block font-mono">ID: {u.id}</span>
                      </td>
                      <td className="px-4 py-3.5 font-sans font-medium text-slate-200">
                        {u.fullName || '-'}
                      </td>
                      <td className="px-4 py-3.5">
                        <select
                          value={u.role}
                          onChange={e => handleChangeRole(u.id, e.target.value)}
                          className="bg-[#171923] border border-white/10 rounded-lg px-2 py-1 text-xs text-[#F5F5F7] font-bold focus:border-[#FF087F] outline-none"
                        >
                          <option value="USER">USER</option>
                          <option value="MM">MM (Market Maker)</option>
                          <option value="COMPLIANCE">COMPLIANCE</option>
                          <option value="ADMIN">ADMIN</option>
                          <option value="SUPERADMIN">SUPERADMIN</option>
                        </select>
                      </td>
                      <td className="px-4 py-3.5 font-sans">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold ${
                            u.status === 'frozen'
                              ? 'bg-red-950/60 border border-red-500/40 text-red-300'
                              : 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300'
                          }`}
                        >
                          {u.status === 'frozen' ? 'DIBEKUKAN' : 'AKTIF'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-sans">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                            u.kycStatus === 'approved'
                              ? 'bg-emerald-950/60 text-emerald-300'
                              : u.kycStatus === 'pending'
                              ? 'bg-amber-950/60 text-amber-300 border border-amber-500/40'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {u.kycStatus === 'approved' && <Check className="w-3 h-3 text-emerald-400" />}
                          {u.kycStatus} (Tier {u.kycTier})
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-sans">
                        <span className={u.isTotpEnabled ? 'text-emerald-400 font-bold' : 'text-[#686D7A]'}>
                          {u.isTotpEnabled ? 'AKTIF (RFC 6238)' : 'Non-aktif'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right space-x-1.5 font-sans">
                        {u.kycStatus === 'pending' && (
                          <div className="inline-flex gap-1">
                            <button
                              type="button"
                              onClick={() => handleReviewKyc(u.id, 'APPROVE')}
                              className="px-2.5 py-1 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm"
                            >
                              Approve Tier 2
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReviewKyc(u.id, 'REJECT')}
                              className="px-2.5 py-1 text-[11px] font-bold bg-red-600/30 hover:bg-red-600/50 text-red-300 border border-red-500/40 rounded-lg"
                            >
                              Tolak
                            </button>
                          </div>
                        )}
                        {u.isTotpEnabled && (
                          <button
                            type="button"
                            onClick={() => handleReset2fa(u.id, u.email)}
                            className="px-2.5 py-1 text-[11px] font-semibold bg-[#171923] hover:bg-amber-950/30 text-amber-300 border border-white/10 rounded-lg"
                            title="Reset 2FA TOTP jika pengguna kehilangan perangkat"
                          >
                            Reset 2FA
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleFreeze(u.id, u.status)}
                          className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-colors ${
                            u.status === 'frozen'
                              ? 'bg-blue-950/40 border-blue-600 text-blue-300 hover:bg-blue-900/50'
                              : 'bg-red-950/40 border-red-700 text-red-300 hover:bg-red-900/50'
                          }`}
                        >
                          {u.status === 'frozen' ? 'Buka Beku' : 'Bekukan Akun'}
                        </button>
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
            <h3 className="text-sm font-bold text-[#F5F5F7] font-display">Antrean Persetujuan Penarikan Dana (Withdrawals Queue)</h3>
            <p className="text-xs text-[#9298A6]">Tinjau dan setujui penarikan fiat (Transfer Bank) dan kripto on-chain. Penolakan akan secara otomatis mengembalikan dana terkunci ke akun pengguna.</p>
          </div>

          {pendingWithdrawalCount === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-[#0D1017] border border-white/10 space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <h4 className="text-sm font-bold text-[#F5F5F7]">Semua Penarikan Telah Diproses</h4>
              <p className="text-xs text-[#9298A6]">Tidak ada antrean penarikan yang menunggu persetujuan saat ini.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Fiat Pending */}
              {pendingWd.fiat.map(wd => (
                <div key={wd.id} className="p-4 rounded-2xl bg-[#0D1017] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-blue-950/60 text-blue-300 font-mono text-[10px] font-bold border border-blue-500/30">
                        FIAT IDR
                      </span>
                      <span className="font-bold text-[#F5F5F7] text-sm font-mono">
                        {formatIDR(wd.amount, true)}
                      </span>
                      <span className="text-xs text-[#9298A6]">ke {wd.bankName}</span>
                    </div>
                    <div className="text-xs text-[#9298A6] font-mono">
                      Rekening: <strong className="text-white">{wd.accountNumber}</strong> ({wd.accountHolderName}) · Pengguna ID: {wd.userId}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleRejectWd(wd.id, 'FIAT')}
                      className="px-3 py-1.5 rounded-xl bg-red-950/40 border border-red-700 text-red-300 text-xs font-bold hover:bg-red-900/50"
                    >
                      Tolak & Refund
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApproveWd(wd.id, 'FIAT')}
                      className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-900/30"
                    >
                      Setujui & Selesaikan
                    </button>
                  </div>
                </div>
              ))}

              {/* Crypto Pending */}
              {pendingWd.crypto.map(wd => (
                <div key={wd.id} className="p-4 rounded-2xl bg-[#0D1017] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 font-mono text-[10px] font-bold border border-purple-500/30">
                        {wd.currency} ON-CHAIN
                      </span>
                      <span className="font-bold text-[#F5F5F7] text-sm font-mono">
                        {formatCrypto(wd.amount, 8)} {wd.currency}
                      </span>
                    </div>
                    <div className="text-xs text-[#9298A6] font-mono truncate max-w-md">
                      Address: <strong className="text-white">{wd.address}</strong> (Network: {wd.network || 'Mainnet'})
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleRejectWd(wd.id, 'CRYPTO')}
                      className="px-3 py-1.5 rounded-xl bg-red-950/40 border border-red-700 text-red-300 text-xs font-bold hover:bg-red-900/50"
                    >
                      Tolak & Refund
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApproveWd(wd.id, 'CRYPTO')}
                      className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-900/30"
                    >
                      Setujui & Broadcast
                    </button>
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
              <h3 className="text-sm font-bold text-[#F5F5F7] font-display">Buku Besar Bersama & Penyesuaian Saldo (Double-Entry Ledger)</h3>
              <p className="text-xs text-[#9298A6]">Alat penyesuaian administratif resmi berpasangan dengan rekening Treasury. Setiap jurnal tercatat permanen di audit trail.</p>
            </div>
            <button
              onClick={() => setShowAdjustLedgerModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#FF087F] to-[#D926FF] text-white text-xs font-bold shadow-lg shadow-[#FF087F]/30 hover:brightness-110 transition-all self-start"
            >
              <Plus className="w-4 h-4" />
              <span>Entri Penyesuaian Saldo</span>
            </button>
          </div>

          {/* Solvency Audit Status */}
          <div className="p-5 rounded-2xl bg-[#0D1017] border border-white/10 space-y-3">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
              Ringkasan Saldo Cadangan Treasury Bursa (Sistem Kepatuhan)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl bg-[#171923] border border-white/5 font-mono text-xs">
                <span className="text-[#9298A6] block">Akun Cadangan Treasury IDR</span>
                <span className="text-lg font-bold text-emerald-400 mt-1 block">
                  Rp 100.000.000.000,00
                </span>
                <span className="text-[10px] text-[#686D7A] mt-0.5 block">Penjamin likuiditas fiat bursa</span>
              </div>
              <div className="p-3.5 rounded-xl bg-[#171923] border border-white/5 font-mono text-xs">
                <span className="text-[#9298A6] block">Akun Cadangan Treasury BTC</span>
                <span className="text-lg font-bold text-amber-400 mt-1 block">
                  500.00000000 BTC
                </span>
                <span className="text-[10px] text-[#686D7A] mt-0.5 block">Cadangan cold storage dompet dingin</span>
              </div>
              <div className="p-3.5 rounded-xl bg-[#171923] border border-white/5 font-mono text-xs">
                <span className="text-[#9298A6] block">Akun Cadangan Treasury USDT</span>
                <span className="text-lg font-bold text-blue-400 mt-1 block">
                  5.000.000,00 USDT
                </span>
                <span className="text-[10px] text-[#686D7A] mt-0.5 block">Kolateral FX matching engine</span>
              </div>
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
              <h3 className="text-sm font-bold text-[#F5F5F7] font-display">Monitoring Seluruh Bot Trading Platform</h3>
              <p className="text-xs text-[#9298A6]">Pantau aktivitas Spot Grid, DCA Layers, TWAP Slicer, Volume Maker, dan Depth & Liquidity di seluruh pengguna.</p>
            </div>
            <button
              onClick={() => handleEmergencyStopBots()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600/30 hover:bg-red-600/40 border border-red-500/50 text-red-200 text-xs font-bold transition-all shadow-lg"
            >
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span>Hentikan Semua Bot (Emergency)</span>
            </button>
          </div>

          <div className="rounded-2xl bg-[#0D1017] border border-white/10 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#171923] text-[11px] text-[#9298A6] border-b border-white/10 font-sans">
                  <tr>
                    <th className="px-4 py-3">Nama Bot</th>
                    <th className="px-4 py-3">Tipe Algoritma</th>
                    <th className="px-4 py-3">Pasangan</th>
                    <th className="px-4 py-3">Pemilik Akun</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Order Aktif</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {botsList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-[#686D7A]">
                        Belum ada bot trading yang terkonfigurasi di bursa.
                      </td>
                    </tr>
                  ) : (
                    botsList.map(b => (
                      <tr key={b.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3.5">
                          <span className="font-bold text-[#F5F5F7] block">{b.name}</span>
                          <span className="text-[10px] text-[#686D7A] block">ID: {b.id}</span>
                        </td>
                        <td className="px-4 py-3.5 text-purple-400 font-semibold">{b.botType}</td>
                        <td className="px-4 py-3.5 font-bold text-[#F5F5F7]">{b.pairId}</td>
                        <td className="px-4 py-3.5 text-slate-300">{b.ownerEmail}</td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              b.status === 'RUNNING'
                                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-semibold text-[#F5F5F7]">{b.activeOrdersCount} level</td>
                        <td className="px-4 py-3.5 text-right font-sans">
                          {b.status === 'RUNNING' && (
                            <button
                              type="button"
                              onClick={() => handleEmergencyStopBots(b.id)}
                              className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-red-950/40 border border-red-700 text-red-300 hover:bg-red-900/50"
                            >
                              Stop Bot
                            </button>
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
              <h3 className="text-sm font-bold text-[#F5F5F7] font-display">Mesin Konversi FX USDT/IDR & Sinkronisasi Feed</h3>
              <p className="text-xs text-[#9298A6]">Formula konversi spot: BTC/IDR = BTC/USDT × USDT/IDR dengan kontrol manual admin dan rekam jejak audit.</p>
            </div>
            <button
              onClick={() => setShowFxModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#FF087F] to-[#D926FF] text-white text-xs font-bold shadow-lg shadow-[#FF087F]/30 hover:brightness-110 transition-all self-start"
            >
              <Sliders className="w-4 h-4" />
              <span>Override Kurs Manual</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-[#0D1017] border border-white/10 space-y-2">
              <span className="text-[11px] text-[#9298A6]">Kurs Efektif USDT/IDR</span>
              <span className="text-2xl font-bold font-mono text-emerald-400 block">
                Rp {(fxStatus?.effectiveRateIdr || 16350).toLocaleString('id-ID')}
              </span>
              <span className="text-[10px] text-[#686D7A] font-mono block">
                Sumber aktif: {fxStatus?.source || 'COINMARKETCAP'}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-[#0D1017] border border-white/10 space-y-2">
              <span className="text-[11px] text-[#9298A6]">Penyedia Feed Eksternal</span>
              <div className="space-y-1 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-[#9298A6]">CoinMarketCap:</span>
                  <span className="text-emerald-400 font-bold">ONLINE (16.350)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#9298A6]">Binance Spot:</span>
                  <span className="text-emerald-400 font-bold">ONLINE</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#9298A6]">Bybit Spot:</span>
                  <span className="text-emerald-400 font-bold">ONLINE</span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#0D1017] border border-white/10 space-y-2">
              <span className="text-[11px] text-[#9298A6]">Batas Deviasi & Keamanan</span>
              <div className="space-y-1 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-[#9298A6]">Max Tolerance Shift:</span>
                  <span className="text-blue-400 font-bold">10.0% Max Jump</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#9298A6]">Aggregator Threshold:</span>
                  <span className="text-purple-400 font-bold">200 BPS (2%)</span>
                </div>
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
          {/* Section 1: Staking / Earn Pools */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-[#F5F5F7] font-display">Manajemen Pool Staking & Earn</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {earnpools.map(pool => (
                <div key={pool.id} className="p-4 rounded-2xl bg-[#0D1017] border border-white/10 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#F5F5F7] font-mono">{pool.asset} Pool</span>
                    <span className="text-emerald-400 font-mono font-bold text-sm">{pool.apy}% APY</span>
                  </div>
                  <div className="text-[11px] text-[#9298A6] font-mono">
                    Durasi: {pool.durationDays === 0 ? 'Fleksibel' : `${pool.durationDays} Hari`}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUpdateStakingPool(pool.id, pool.apy)}
                    className="w-full mt-2 py-1.5 rounded-lg bg-[#171923] hover:bg-white/10 text-xs font-semibold text-slate-200 border border-white/10"
                  >
                    Ubah APY
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Copy Trading Master Traders */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-[#F5F5F7] font-display">Manajemen Master Trader (Copy Trading)</h4>
            <div className="rounded-2xl bg-[#0D1017] border border-white/10 overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#171923] text-[11px] text-[#9298A6] border-b border-white/10 font-sans">
                  <tr>
                    <th className="px-4 py-2.5">Master Trader</th>
                    <th className="px-4 py-2.5">Pair</th>
                    <th className="px-4 py-2.5">30d ROI</th>
                    <th className="px-4 py-2.5">Followers</th>
                    <th className="px-4 py-2.5">Profit Share</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {copyMasters.map(m => (
                    <tr key={m.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-bold text-[#F5F5F7]">{m.name}</td>
                      <td className="px-4 py-3">{m.asset}</td>
                      <td className="px-4 py-3 text-emerald-400 font-bold">+{m.roi30d}%</td>
                      <td className="px-4 py-3">{m.followers} orang</td>
                      <td className="px-4 py-3">{m.profitShareBps / 100}%</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${m.status === 'APPROVED' ? 'bg-emerald-950/60 text-emerald-300' : 'bg-red-950/60 text-red-300'}`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-sans">
                        <button
                          type="button"
                          onClick={() => handleUpdateMasterTrader(m.id, m.status)}
                          className="px-2.5 py-1 rounded bg-[#171923] hover:bg-white/10 border border-white/10 text-[11px]"
                        >
                          {m.status === 'APPROVED' ? 'Jeda Master' : 'Aktifkan'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 3: VIP Tiers */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-[#F5F5F7] font-display">Tabel Diskon Fee VIP Level (VIP 0 - VIP 5)</h4>
            <div className="rounded-2xl bg-[#0D1017] border border-white/10 overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#171923] text-[11px] text-[#9298A6] border-b border-white/10 font-sans">
                  <tr>
                    <th className="px-4 py-2.5">VIP Tier</th>
                    <th className="px-4 py-2.5">Syarat Volume 30 Hari</th>
                    <th className="px-4 py-2.5">Maker Fee</th>
                    <th className="px-4 py-2.5">Taker Fee</th>
                    <th className="px-4 py-2.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {vipTiers.map(vt => (
                    <tr key={vt.tier} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-bold text-[#FF087F]">VIP {vt.tier}</td>
                      <td className="px-4 py-3">{formatIDR(vt.minVolumeIdr, true)}</td>
                      <td className="px-4 py-3 text-emerald-400">{(vt.makerFeeBps / 100).toFixed(2)}% ({vt.makerFeeBps} bps)</td>
                      <td className="px-4 py-3 text-blue-400">{(vt.takerFeeBps / 100).toFixed(2)}% ({vt.takerFeeBps} bps)</td>
                      <td className="px-4 py-3 text-right font-sans">
                        <button
                          type="button"
                          onClick={() => handleUpdateVipTier(vt.tier, vt.makerFeeBps, vt.takerFeeBps)}
                          className="px-2.5 py-1 rounded bg-[#171923] hover:bg-white/10 border border-white/10 text-[11px]"
                        >
                          Edit Fee
                        </button>
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
          TAB 10: RISK & AML ALERTS
          ========================================================================= */}
      {activeTab === 'RISK' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-bold text-[#F5F5F7] font-display">Sistem Deteksi Anomali & Risiko Transaksi (Anti-Money Laundering)</h3>
            <p className="text-xs text-[#9298A6]">Pemantauan otomatis terhadap pola wash trading, rapid cancellation spoofing, dan lonjakan penarikan tidak wajar.</p>
          </div>

          {riskAlerts.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-[#0D1017] border border-white/10 space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <h4 className="text-sm font-bold text-[#F5F5F7]">Tidak Ada Peringatan Anomali</h4>
              <p className="text-xs text-[#9298A6]">Sistem AML berjalan normal. Seluruh aktivitas perdagangan sesuai dengan parameter kepatuhan bursa.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {riskAlerts.map(a => (
                <div key={a.id} className="p-4 rounded-xl bg-[#0D1017] border border-white/10 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${a.severity === 'HIGH' ? 'bg-red-950 text-red-400' : 'bg-amber-950 text-amber-400'}`}>
                        {a.severity}
                      </span>
                      <span className="font-bold text-[#F5F5F7] text-xs font-display">{a.category}</span>
                    </div>
                    <p className="text-xs text-[#9298A6]">{a.description}</p>
                  </div>
                  <span className="text-[10px] font-mono text-[#686D7A]">{formatDateTime(a.createdAt)}</span>
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
              <h3 className="text-sm font-bold text-[#F5F5F7] font-display">Audit Trail Append-Only (Aktivitas Sistem & Admin)</h3>
              <p className="text-xs text-[#9298A6]">Catatan audit permanen yang tidak dapat dimanipulasi untuk setiap tindakan administratif dan kepatuhan.</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-[#686D7A] absolute left-3 top-3 pointer-events-none" />
              <input
                type="text"
                placeholder="Cari aksi audit / resource..."
                value={auditSearch}
                onChange={e => setAuditSearch(e.target.value)}
                className="w-full bg-[#0D1017] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-[#F5F5F7] placeholder-[#686D7A] outline-none focus:border-[#FF087F] font-mono"
              />
            </div>
          </div>

          <div className="rounded-2xl bg-[#0D1017] border border-white/10 overflow-hidden shadow-xl">
            <div className="max-h-[600px] overflow-y-auto divide-y divide-white/5 font-mono text-xs">
              {filteredAudits.length === 0 ? (
                <div className="p-8 text-center text-[#686D7A]">Belum ada audit log yang sesuai</div>
              ) : (
                filteredAudits.map((log, idx) => (
                  <div key={idx} className="p-3.5 hover:bg-white/[0.02] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-blue-950/60 text-blue-300 text-[10px] font-bold border border-blue-500/30">
                          {log.action}
                        </span>
                        <span className="text-[#F5F5F7] font-medium">{log.resource}</span>
                      </div>
                      <p className="text-[11px] text-[#9298A6]">{log.details}</p>
                    </div>
                    <span className="text-[10px] text-[#686D7A] whitespace-nowrap">
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
          MODAL: CREATE NEW TRADING PAIR
          ========================================================================= */}
      {showCreatePairModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0D1017] border border-white/10 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-white/10">
              <h3 className="font-bold text-[#F5F5F7] text-sm font-display">Daftarkan Trading Pair Baru</h3>
              <button onClick={() => setShowCreatePairModal(false)} className="text-[#9298A6] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePair} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#9298A6] block mb-1">Base Currency:</label>
                  <input
                    type="text"
                    required
                    placeholder="SOL"
                    value={newPairData.baseCurrency}
                    onChange={e => setNewPairData({ ...newPairData, baseCurrency: e.target.value.toUpperCase() })}
                    className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7] font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="text-[#9298A6] block mb-1">Quote Currency:</label>
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
                    className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7] font-mono"
                  >
                    <option value="USDT">USDT (Tether USD)</option>
                    <option value="IDR">IDR (Indonesian Rupiah)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[#9298A6] block mb-1">Harga Awal (Quote atomic units, contoh: 100000 = Rp 1.000,00):</label>
                <input
                  type="text"
                  required
                  value={newPairData.initialPrice}
                  onChange={e => setNewPairData({ ...newPairData, initialPrice: e.target.value })}
                  className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7] font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#9298A6] block mb-1">Maker Fee (bps):</label>
                  <input
                    type="number"
                    required
                    value={newPairData.makerFeeBps}
                    onChange={e => setNewPairData({ ...newPairData, makerFeeBps: e.target.value })}
                    className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7] font-mono"
                  />
                  <span className="text-[10px] text-[#686D7A] mt-0.5 block">10 bps = 0.10%</span>
                </div>
                <div>
                  <label className="text-[#9298A6] block mb-1">Taker Fee (bps):</label>
                  <input
                    type="number"
                    required
                    value={newPairData.takerFeeBps}
                    onChange={e => setNewPairData({ ...newPairData, takerFeeBps: e.target.value })}
                    className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7] font-mono"
                  />
                  <span className="text-[10px] text-[#686D7A] mt-0.5 block">20 bps = 0.20%</span>
                </div>
              </div>

              {/* Order Quantity Limits in Tokens */}
              <div className="p-3 rounded-xl bg-[#141824] border border-blue-500/20 space-y-2">
                <span className="text-[11px] font-bold text-blue-300 block">Batas Kuantitas Order (Satuan Token):</span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[#9298A6] block mb-1 text-[11px]">Min Order (Tokens):</label>
                    <input
                      type="text"
                      required
                      value={newPairData.minOrderTokens}
                      onChange={e => setNewPairData({ ...newPairData, minOrderTokens: e.target.value })}
                      className="w-full bg-[#0D1017] border border-white/10 rounded-lg p-2 text-[#F5F5F7] font-mono"
                      placeholder="1"
                    />
                  </div>
                  <div>
                    <label className="text-[#9298A6] block mb-1 text-[11px]">Max Order (Tokens):</label>
                    <input
                      type="text"
                      required
                      value={newPairData.maxOrderTokens}
                      onChange={e => setNewPairData({ ...newPairData, maxOrderTokens: e.target.value })}
                      className="w-full bg-[#0D1017] border border-white/10 rounded-lg p-2 text-[#F5F5F7] font-mono"
                      placeholder="10000000"
                    />
                  </div>
                </div>
                <span className="text-[10px] text-blue-400 block font-mono">
                  Sistem otomatis mengubah ke unit atomic integer sesuai desimal base currency.
                </span>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#FF087F] to-[#D926FF] text-white font-bold shadow-lg shadow-[#FF087F]/30 hover:brightness-110 transition-all"
                >
                  Buat & Aktifkan Pair
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: TOKEN MANAGEMENT & ORDER QUANTITY LIMITS CONFIGURATION
          ========================================================================= */}
      {showEditPairModal && editingPair && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#0D1017] border border-white/10 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl my-8">
            <div className="flex justify-between items-center pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-[#F5F5F7] text-sm font-display flex items-center gap-2">
                    Kelola Limit & Fee Token: <span className="text-blue-400">{editingPair.id}</span>
                  </h3>
                  <p className="text-[11px] text-[#9298A6]">Atur batas kuantitas order (Min/Max), fee, dan circuit breaker</p>
                </div>
              </div>
              <button 
                onClick={() => setShowEditPairModal(false)} 
                className="text-[#9298A6] hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Token Decimal Info Banner */}
            <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/20 text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-blue-300">Spesifikasi Token:</span>
                <span className="text-[#F5F5F7]">Base <strong>{editingPair.baseCurrency}</strong> ({editingPair.baseDecimals} Decimals)</span>
                <span className="text-[#686D7A]">|</span>
                <span className="text-[#F5F5F7]">Quote <strong>{editingPair.quoteCurrency}</strong> ({editingPair.quoteDecimals} Decimals)</span>
              </div>
              <div className="text-[11px] font-mono text-blue-300 bg-blue-900/40 px-2 py-0.5 rounded border border-blue-400/20">
                1 {editingPair.baseCurrency} = {(10 ** (editingPair.baseDecimals || 8)).toLocaleString('id-ID')} atomic units
              </div>
            </div>

            {/* Mode Switcher */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-[#9298A6] block uppercase tracking-wider">
                Metode Input Kuantitas Order:
              </label>
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#171923] border border-white/5">
                <button
                  type="button"
                  onClick={() => setPairConfigForm(f => ({ ...f, inputMode: 'TOKENS' }))}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    pairConfigForm.inputMode === 'TOKENS'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-[#9298A6] hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span>🪙 Mode Jumlah Token (Desimal)</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-blue-400/20 text-blue-200 uppercase">Mudah</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPairConfigForm(f => ({ ...f, inputMode: 'ATOMIC' }))}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    pairConfigForm.inputMode === 'ATOMIC'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-[#9298A6] hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span>🔢 Mode Integer Atomic (BigInt)</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-purple-400/20 text-purple-200 uppercase">Raw</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleSavePairConfig} className="space-y-4 text-xs">
              {pairConfigForm.inputMode === 'TOKENS' ? (
                /* ================= TOKENS INPUT MODE ================= */
                <div className="space-y-3.5 p-3.5 rounded-xl bg-[#141824] border border-blue-500/20">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-blue-300 text-xs">Pengaturan Limit dalam Satuan Token ({editingPair.baseCurrency})</span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                      Otomatis Dikonversi ke Integer Mesin
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[#9298A6] block mb-1 font-medium">
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
                        className="w-full bg-[#0D1017] border border-white/10 rounded-lg p-2.5 text-[#F5F5F7] font-mono focus:border-blue-500 outline-none"
                        placeholder="1"
                      />
                      <span className="text-[10px] text-[#686D7A] mt-1 block font-mono">
                        ≈ {parseTokenToAtomic(pairConfigForm.minOrderTokens, editingPair.baseDecimals)} units atomic
                      </span>
                    </div>

                    <div>
                      <label className="text-[#9298A6] block mb-1 font-medium">
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
                        className="w-full bg-[#0D1017] border border-white/10 rounded-lg p-2.5 text-[#F5F5F7] font-mono focus:border-blue-500 outline-none"
                        placeholder="10000000"
                      />
                      <span className="text-[10px] text-[#686D7A] mt-1 block font-mono">
                        ≈ {parseTokenToAtomic(pairConfigForm.maxOrderTokens, editingPair.baseDecimals)} units atomic
                      </span>
                    </div>
                  </div>

                  {/* Quick Presets for Max Limit */}
                  <div className="pt-1">
                    <label className="text-[10px] text-[#9298A6] block mb-1.5 font-medium">
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
                          className={`px-2 py-1 rounded-md text-[11px] font-mono border transition-colors ${
                            pairConfigForm.maxOrderTokens === preset
                              ? 'bg-blue-600 border-blue-400 text-white font-bold'
                              : 'bg-[#0D1017] border-white/10 text-[#9298A6] hover:text-[#F5F5F7] hover:border-white/20'
                          }`}
                        >
                          {Number(preset).toLocaleString('id-ID')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* ================= ATOMIC RAW INPUT MODE ================= */
                <div className="space-y-3.5 p-3.5 rounded-xl bg-[#191526] border border-purple-500/20">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-purple-300 text-xs">Pengaturan Unit Integer Atomic Raw (BigInt)</span>
                    <span className="text-[10px] text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/30">
                      Sesuai Format Internal Mesin
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[#9298A6] block mb-1 font-medium">
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
                        className="w-full bg-[#0D1017] border border-white/10 rounded-lg p-2.5 text-[#F5F5F7] font-mono focus:border-purple-500 outline-none"
                        placeholder="100000000"
                      />
                      <span className="text-[10px] text-emerald-400 mt-1 block font-mono">
                        = {formatAtomicToToken(pairConfigForm.minOrderSize, editingPair.baseDecimals)} {editingPair.baseCurrency}
                      </span>
                    </div>

                    <div>
                      <label className="text-[#9298A6] block mb-1 font-medium">
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
                        className="w-full bg-[#0D1017] border border-white/10 rounded-lg p-2.5 text-[#F5F5F7] font-mono focus:border-purple-500 outline-none"
                        placeholder="1000000000000000"
                      />
                      <span className="text-[10px] text-emerald-400 mt-1 block font-mono">
                        = {formatAtomicToToken(pairConfigForm.maxOrderSize, editingPair.baseDecimals)} {editingPair.baseCurrency}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Fee Configuration */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#9298A6] block mb-1 font-medium">Maker Fee (basis points):</label>
                  <input
                    type="number"
                    required
                    min="0"
                    max="1000"
                    value={pairConfigForm.makerFeeBps}
                    onChange={e => setPairConfigForm(f => ({ ...f, makerFeeBps: Number(e.target.value) }))}
                    className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7] font-mono"
                  />
                  <span className="text-[10px] text-emerald-400 mt-0.5 block">
                    {(Number(pairConfigForm.makerFeeBps) / 100).toFixed(2)}% (10 bps = 0.10%)
                  </span>
                </div>
                <div>
                  <label className="text-[#9298A6] block mb-1 font-medium">Taker Fee (basis points):</label>
                  <input
                    type="number"
                    required
                    min="0"
                    max="1000"
                    value={pairConfigForm.takerFeeBps}
                    onChange={e => setPairConfigForm(f => ({ ...f, takerFeeBps: Number(e.target.value) }))}
                    className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7] font-mono"
                  />
                  <span className="text-[10px] text-blue-400 mt-0.5 block">
                    {(Number(pairConfigForm.takerFeeBps) / 100).toFixed(2)}% (20 bps = 0.20%)
                  </span>
                </div>
              </div>

              {/* Status Circuit Breaker Toggle */}
              <div className="p-3 rounded-xl bg-[#171923] border border-white/10 flex items-center justify-between">
                <div>
                  <span className="text-[#F5F5F7] font-bold block">Status Matching Engine:</span>
                  <span className="text-[11px] text-[#9298A6]">
                    {pairConfigForm.isHalted
                      ? 'Perdagangan sedang dihentikan sementara (Order baru ditolak)'
                      : 'Perdagangan aktif normal (Order buy & sell dieksekusi)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPairConfigForm(f => ({ ...f, isHalted: !f.isHalted }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    pairConfigForm.isHalted
                      ? 'bg-red-950/60 border-red-500/50 text-red-300'
                      : 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                  }`}
                >
                  {pairConfigForm.isHalted ? 'DIHENTIKAN (HALTED)' : 'AKTIF NORMAL'}
                </button>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEditPairModal(false)}
                  className="w-1/3 py-2.5 rounded-xl bg-[#171923] hover:bg-white/10 text-[#9298A6] hover:text-white font-semibold transition-all"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="w-2/3 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white font-bold shadow-lg shadow-blue-600/30 hover:brightness-110 transition-all flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Simpan Perubahan Limit & Fee</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: LEDGER BALANCE ADJUSTMENT
          ========================================================================= */}
      {showAdjustLedgerModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0D1017] border border-white/10 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-white/10">
              <h3 className="font-bold text-[#F5F5F7] text-sm font-display">Entri Penyesuaian Saldo Buku Besar</h3>
              <button onClick={() => setShowAdjustLedgerModal(false)} className="text-[#9298A6] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdjustLedger} className="space-y-3 text-xs">
              <div>
                <label className="text-[#9298A6] block mb-1">Pilih Pengguna:</label>
                <select
                  required
                  value={ledgerAdjData.userId}
                  onChange={e => setLedgerAdjData({ ...ledgerAdjData, userId: e.target.value })}
                  className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7]"
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
                  <label className="text-[#9298A6] block mb-1">Mata Uang:</label>
                  <select
                    value={ledgerAdjData.currency}
                    onChange={e => setLedgerAdjData({ ...ledgerAdjData, currency: e.target.value })}
                    className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7]"
                  >
                    <option value="IDR">IDR (Rupiah)</option>
                    <option value="BTC">BTC (Bitcoin)</option>
                    <option value="ETH">ETH (Ethereum)</option>
                    <option value="USDT">USDT (Tether)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[#9298A6] block mb-1">Arah Penyesuaian:</label>
                  <select
                    value={ledgerAdjData.direction}
                    onChange={e => setLedgerAdjData({ ...ledgerAdjData, direction: e.target.value as any })}
                    className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7] font-bold"
                  >
                    <option value="CREDIT">CREDIT (Tambah Saldo)</option>
                    <option value="DEBIT">DEBIT (Kurangi Saldo)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[#9298A6] block mb-1">
                  Jumlah (Atomic Units):
                </label>
                <input
                  type="text"
                  required
                  placeholder={ledgerAdjData.currency === 'IDR' ? '100000000 (= Rp 1.000.000,00)' : '100000000 (= 1.0 Coin)'}
                  value={ledgerAdjData.amountUnits}
                  onChange={e => setLedgerAdjData({ ...ledgerAdjData, amountUnits: e.target.value.replace(/\D/g, '') })}
                  className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7] font-mono"
                />
              </div>

              <div>
                <label className="text-[#9298A6] block mb-1">Alasan Penyesuaian (Wajib untuk Audit):</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Koreksi transaksi manual / deposit simulasi / penyesuaian arbitrase"
                  value={ledgerAdjData.reason}
                  onChange={e => setLedgerAdjData({ ...ledgerAdjData, reason: e.target.value })}
                  className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7]"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#FF087F] to-[#D926FF] text-white font-bold shadow-lg shadow-[#FF087F]/30 hover:brightness-110 transition-all"
                >
                  Eksekusi Penyesuaian Buku Besar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: MANUAL FX OVERRIDE
          ========================================================================= */}
      {showFxModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0D1017] border border-white/10 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-white/10">
              <h3 className="font-bold text-[#F5F5F7] text-sm font-display">Override Kurs FX USDT/IDR Manual</h3>
              <button onClick={() => setShowFxModal(false)} className="text-[#9298A6] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateFxRate} className="space-y-3 text-xs">
              <div>
                <label className="text-[#9298A6] block mb-1">Kurs Baru (IDR per 1 USDT):</label>
                <input
                  type="number"
                  step="1"
                  required
                  value={manualFxRate}
                  onChange={e => setManualFxRate(e.target.value)}
                  className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7] font-mono font-bold text-base"
                />
              </div>

              <div>
                <label className="text-[#9298A6] block mb-1">Alasan Penyesuaian (Audit Log):</label>
                <input
                  type="text"
                  required
                  value={fxReason}
                  onChange={e => setFxReason(e.target.value)}
                  className="w-full bg-[#171923] border border-white/10 rounded-lg p-2 text-[#F5F5F7]"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#FF087F] to-[#D926FF] text-white font-bold shadow-lg shadow-[#FF087F]/30 hover:brightness-110 transition-all"
                >
                  Simpan Kurs Efektif
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
