/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/admin/listing/ListingManagementView.tsx
 * Admin Console for Initial Token Listing in DIMONEX.
 * Features:
 * - Listing Overview & KPI counts (Draft, Pending Review, Approved, Scheduled, Active, Suspended, Rejected)
 * - 6-Step Create Listing Wizard with Address Format Validation
 * - Maker-Checker Approval Queue with Strict Self-Approval Prevention
 * - Market Operations: Idempotent Activation, Emergency Halt, Resume, Reconciliation
 * - Cryptographic Hash Chain Audit Trail Integrity Verifier
 */

import React, { useState, useEffect } from 'react';
import {
  Layers,
  PlusCircle,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Play,
  Pause,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldAlert,
  ChevronRight,
  Info,
  Lock,
  ArrowRight,
  Check,
  FileText,
  Activity,
  Calendar,
  Key,
  ExternalLink,
  Coins,
  Sliders,
  Sparkles,
  ArrowUpDown,
  Edit
} from 'lucide-react';
import { Button } from '../../ui/Button.js';
import { Input } from '../../ui/Input.js';
import { Modal } from '../../ui/Modal.js';
import { useToast } from '../../ui/Toast.js';

interface Props {
  currentUser: any;
  onRefreshMarkets?: () => void;
  tradingPairs?: any[];
}

export const ListingManagementView: React.FC<Props> = ({ currentUser, onRefreshMarkets, tradingPairs: initialPairs }) => {
  const { showToast } = useToast();
  const [subTab, setSubTab] = useState<'OVERVIEW' | 'WIZARD' | 'APPROVAL_QUEUE' | 'OPERATIONS' | 'TOKEN_MANAGEMENT'>('OVERVIEW');
  const [listings, setListings] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [tokenPairs, setTokenPairs] = useState<any[]>(initialPairs || []);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Token Management Tab State
  const [tokenSearchQuery, setTokenSearchQuery] = useState('');
  const [tokenStatusFilter, setTokenStatusFilter] = useState<'ALL' | 'ACTIVE' | 'HALTED'>('ALL');
  const [showTokenEditModal, setShowTokenEditModal] = useState(false);
  const [selectedPairForEdit, setSelectedPairForEdit] = useState<any | null>(null);
  const [isSavingTokenConfig, setIsSavingTokenConfig] = useState(false);
  const [tokenEditForm, setTokenEditForm] = useState({
    pairId: '',
    baseCurrency: '',
    quoteCurrency: '',
    baseDecimals: 8,
    quoteDecimals: 2,
    inputMode: 'TOKENS' as 'TOKENS' | 'ATOMIC',
    minOrderTokens: '1',
    maxOrderTokens: '10000000',
    minOrderSize: '100000000',
    maxOrderSize: '1000000000000000',
    tickSize: '100',
    lotSize: '100000000',
    makerFeeBps: 10,
    takerFeeBps: 20,
    isHalted: false
  });

  // Modals & Drawers
  const [selectedListing, setSelectedListing] = useState<any | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // Operations state
  const [auditVerification, setAuditVerification] = useState<any>(null);
  const [reconcileData, setReconcileData] = useState<any>(null);
  const [isActivating, setIsActivating] = useState(false);

  // Wizard state (6 Steps)
  const [wizardStep, setWizardStep] = useState(1);
  const [isCreatingAsset, setIsCreatingAsset] = useState(false);
  const [wizardData, setWizardData] = useState({
    // Step 1: Asset Identity
    isNewAsset: false,
    selectedAssetId: '',
    symbol: '',
    name: '',
    assetType: 'TOKEN' as 'NATIVE' | 'TOKEN',
    decimals: 8,
    // Step 2: Network & Contract & Deposit/Withdraw Schedule
    network: 'ETHEREUM',
    contractAddress: '',
    depositEnabled: true,
    depositOpenMode: 'IMMEDIATE' as 'IMMEDIATE' | 'SCHEDULED',
    depositOpenedAt: '',
    withdrawalEnabled: true,
    withdrawalOpenMode: 'IMMEDIATE' as 'IMMEDIATE' | 'SCHEDULED',
    withdrawalOpenedAt: '',
    // Step 3: Trading Pair Config
    quoteCurrency: 'IDR',
    tickSize: '100', // 100 sen = 1 IDR
    lotSize: '100000000', // 1 unit in base unit (8 dec)
    // Step 4: Fee & MM / Project Owner Accounts
    limitInputMode: 'TOKENS' as 'TOKENS' | 'ATOMIC',
    minTokens: '1',
    maxTokens: '10000000',
    minQuantity: '100000000',
    maxQuantity: '1000000000000000', // 10,000,000 tokens for 8 dec
    minNotional: '5000000', // Rp 50,000.00
    makerFeeBps: 10,
    takerFeeBps: 20,
    scheduledAt: '',
    marketMakerAccountId: 'usr-mm-0000-0000-000000000001',
    projectOwnerAccountId: '',
    initialLiquidityBase: '1000000000',
    initialLiquidityQuoteIdr: '5000000000'
  });

  const [eligibleAccounts, setEligibleAccounts] = useState<any[]>([]);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('dimonex_auth_token');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const headers = getAuthHeaders();
      const [listRes, assetRes, auditRes, accRes, pairsRes] = await Promise.all([
        fetch('/api/admin/listings', { headers }),
        fetch('/api/admin/listings/assets/list', { headers }),
        fetch('/api/admin/listings/audit/verify', { headers }),
        fetch('/api/admin/listings/accounts/eligible', { headers }),
        fetch('/api/trading/pairs')
      ]);

      if (listRes.ok) {
        const json = await listRes.json();
        setListings(json.data || []);
      }
      if (assetRes.ok) {
        const json = await assetRes.json();
        setAssets(json.assets || []);
      }
      if (auditRes.ok) {
        const json = await auditRes.json();
        setAuditVerification(json);
      }
      if (accRes.ok) {
        const accJson = await accRes.json();
        setEligibleAccounts(accJson.accounts || []);
      }
      if (pairsRes.ok) {
        const pJson = await pairsRes.json();
        setTokenPairs(pJson.pairs || pJson.data || pJson || []);
      }
    } catch (e: any) {
      showToast('error', 'Gagal Memuat Data', 'Gagal memuat data listing: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Token Management Handlers
  const handleOpenTokenEdit = (pair: any) => {
    const baseDec = pair.baseDecimals || 8;
    const factor = 10n ** BigInt(baseDec);
    const minUnits = BigInt(pair.minOrderSize || '100000000');
    const maxUnits = BigInt(pair.maxOrderSize || '1000000000000000');

    let minTok = '1';
    let maxTok = '10000000';
    try {
      const minWhole = minUnits / factor;
      const minRemainder = minUnits % factor;
      minTok = minRemainder === 0n ? minWhole.toString() : (Number(minUnits) / Number(factor)).toString();

      const maxWhole = maxUnits / factor;
      const maxRemainder = maxUnits % factor;
      maxTok = maxRemainder === 0n ? maxWhole.toString() : (Number(maxUnits) / Number(factor)).toString();
    } catch {}

    setSelectedPairForEdit(pair);
    setTokenEditForm({
      pairId: pair.id,
      baseCurrency: pair.baseCurrency,
      quoteCurrency: pair.quoteCurrency,
      baseDecimals: baseDec,
      quoteDecimals: pair.quoteDecimals || (pair.quoteCurrency === 'IDR' ? 2 : 6),
      inputMode: 'TOKENS',
      minOrderTokens: minTok,
      maxOrderTokens: maxTok,
      minOrderSize: minUnits.toString(),
      maxOrderSize: maxUnits.toString(),
      tickSize: pair.tickSize || (pair.quoteCurrency === 'USDT' ? '10000' : '100'),
      lotSize: pair.lotSize || pair.minOrderSize || '100000000',
      makerFeeBps: pair.makerFeeBps ?? 10,
      takerFeeBps: pair.takerFeeBps ?? 20,
      isHalted: Boolean(pair.isHalted)
    });
    setShowTokenEditModal(true);
  };

  const handleSaveTokenConfig = async () => {
    if (!tokenEditForm.pairId) return;
    setIsSavingTokenConfig(true);
    try {
      const payload: any = {
        pairId: tokenEditForm.pairId,
        makerFeeBps: Number(tokenEditForm.makerFeeBps),
        takerFeeBps: Number(tokenEditForm.takerFeeBps),
        isHalted: Boolean(tokenEditForm.isHalted)
      };

      if (tokenEditForm.inputMode === 'TOKENS') {
        payload.minOrderTokens = tokenEditForm.minOrderTokens;
        payload.maxOrderTokens = tokenEditForm.maxOrderTokens;
      } else {
        payload.minOrderSize = tokenEditForm.minOrderSize;
        payload.maxOrderSize = tokenEditForm.maxOrderSize;
      }

      const res = await fetch('/api/admin/pairs/update-config', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', data.message || `Limit ${tokenEditForm.pairId} berhasil diperbarui!`);
        setShowTokenEditModal(false);
        loadData();
        if (onRefreshMarkets) onRefreshMarkets();
      } else {
        showToast('error', data.error || 'Gagal memperbarui konfigurasi token');
      }
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setIsSavingTokenConfig(false);
    }
  };

  const applyTokenLimitPreset = (type: 'STANDARD' | 'MEME' | 'HIGH_VALUE') => {
    const baseDec = tokenEditForm.baseDecimals || 8;
    const factor = 10n ** BigInt(baseDec);

    if (type === 'STANDARD') {
      const minTok = '1';
      const maxTok = '10000000';
      setTokenEditForm(prev => ({
        ...prev,
        minOrderTokens: minTok,
        maxOrderTokens: maxTok,
        minOrderSize: (1n * factor).toString(),
        maxOrderSize: (10000000n * factor).toString()
      }));
    } else if (type === 'MEME') {
      const minTok = '100';
      const maxTok = '1000000000';
      setTokenEditForm(prev => ({
        ...prev,
        minOrderTokens: minTok,
        maxOrderTokens: maxTok,
        minOrderSize: (100n * factor).toString(),
        maxOrderSize: (1000000000n * factor).toString()
      }));
    } else if (type === 'HIGH_VALUE') {
      const minTok = '0.0001';
      const maxTok = '100';
      const minUnits = (factor / 10000n).toString();
      const maxUnits = (100n * factor).toString();
      setTokenEditForm(prev => ({
        ...prev,
        minOrderTokens: minTok,
        maxOrderTokens: maxTok,
        minOrderSize: minUnits,
        maxOrderSize: maxUnits
      }));
    }
  };

  // Summary Metrics
  const metrics = {
    total: listings.length,
    draft: listings.filter(l => l.status === 'DRAFT').length,
    pending: listings.filter(l => l.status === 'PENDING_REVIEW').length,
    approved: listings.filter(l => l.status === 'APPROVED').length,
    scheduled: listings.filter(l => l.status === 'SCHEDULED').length,
    active: listings.filter(l => l.status === 'ACTIVE').length,
    suspended: listings.filter(l => l.status === 'SUSPENDED').length,
    rejected: listings.filter(l => l.status === 'REJECTED').length
  };

  // Submit Draft to Review
  const handleSubmitForReview = async (listingId: string) => {
    try {
      const res = await fetch(`/api/admin/listings/${listingId}/submit`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengajukan review');
      showToast('success', 'Listing berhasil diajukan untuk review Maker-Checker');
      loadData();
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  // Checker Approve
  const handleApprove = async () => {
    if (!selectedListing) return;
    if (reviewReason.trim().length < 5) {
      showToast('warning', 'Alasan persetujuan wajib diisi minimal 5 karakter');
      return;
    }
    setIsSubmittingReview(true);
    try {
      const res = await fetch(`/api/admin/listings/${selectedListing.id}/approve`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason: reviewReason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyetujui listing');
      showToast('success', `Listing ${selectedListing.symbol} berhasil disetujui (APPROVED)`);
      setShowApproveModal(false);
      setReviewReason('');
      loadData();
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Checker Reject
  const handleReject = async () => {
    if (!selectedListing) return;
    if (reviewReason.trim().length < 5) {
      showToast('warning', 'Alasan penolakan wajib diisi minimal 5 karakter');
      return;
    }
    setIsSubmittingReview(true);
    try {
      const res = await fetch(`/api/admin/listings/${selectedListing.id}/reject`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason: reviewReason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menolak listing');
      showToast('info', `Listing ${selectedListing.symbol} ditolak (REJECTED)`);
      setShowRejectModal(false);
      setReviewReason('');
      loadData();
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Activate Market
  const handleActivate = async (listingId: string) => {
    setIsActivating(true);
    try {
      const idempotencyKey = `ui-act-${listingId}-${Date.now()}`;
      const res = await fetch(`/api/admin/listings/${listingId}/activate`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'X-Idempotency-Key': idempotencyKey
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengaktifkan market');
      showToast('success', data.message || 'Market berhasil diaktifkan secara idempoten!');
      loadData();
      if (onRefreshMarkets) onRefreshMarkets();
    } catch (e: any) {
      showToast('error', e.message);
    } finally {
      setIsActivating(false);
    }
  };

  // Halt Market
  const handleSuspend = async (listingId: string) => {
    const reason = prompt('Masukkan alasan penghentian trading sementara:', 'Pemeriksaan compliance darurat');
    if (!reason) return;
    try {
      const res = await fetch(`/api/admin/listings/${listingId}/suspend`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menunda market');
      showToast('warning', 'Market berhasil dihentikan sementara (HALTED)');
      loadData();
      if (onRefreshMarkets) onRefreshMarkets();
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  // Resume Market
  const handleResume = async (listingId: string) => {
    const reason = prompt('Masukkan alasan pembukaan kembali trading:', 'Inspeksi selesai, parameter normal');
    if (!reason) return;
    try {
      const res = await fetch(`/api/admin/listings/${listingId}/resume`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal melanjutkan market');
      showToast('success', 'Market kembali aktif diperdagangkan (ACTIVE)');
      loadData();
      if (onRefreshMarkets) onRefreshMarkets();
    } catch (e: any) {
      showToast('error', e.message);
    }
  };

  // Reconcile Engine Readiness
  const handleReconcile = async (listingId: string) => {
    try {
      const res = await fetch(`/api/admin/listings/${listingId}/reconcile`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok) {
        setReconcileData(data.report);
        showToast(
          data.report.isConsistent ? 'success' : 'warning',
          'Sinkronisasi Engine',
          'Status konsistensi: ' + (data.report.isConsistent ? 'KONSISTEN' : 'DIVERGENSI TERDETEKSI')
        );
      }
    } catch (e: any) {
      showToast('error', 'Gagal Verifikasi', e.message);
    }
  };

  // Toggle Deposit Status
  const handleToggleDeposit = async (listingId: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`/api/admin/listings/${listingId}/toggle-deposit`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ enabled: !currentEnabled })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal mengubah status deposit');
      showToast('success', 'Status Deposit Diperbarui', `Deposit sekarang: ${!currentEnabled ? 'DIBUKA' : 'DITUTUP'}`);
      loadData();
    } catch (e: any) {
      showToast('error', 'Gagal Ubah Deposit', e.message);
    }
  };

  // Toggle Withdrawal Status
  const handleToggleWithdraw = async (listingId: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`/api/admin/listings/${listingId}/toggle-withdraw`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ enabled: !currentEnabled })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal mengubah status withdraw');
      showToast('success', 'Status Withdraw Diperbarui', `Withdrawal sekarang: ${!currentEnabled ? 'DIBUKA' : 'DITUTUP'}`);
      loadData();
    } catch (e: any) {
      showToast('error', 'Gagal Ubah Withdraw', e.message);
    }
  };

  // Submit Complete Wizard
  const handleCompleteWizard = async () => {
    try {
      let targetAssetId = wizardData.selectedAssetId;

      const depOpenedAt = wizardData.depositOpenMode === 'SCHEDULED' && wizardData.depositOpenedAt
        ? new Date(wizardData.depositOpenedAt).getTime()
        : (wizardData.depositEnabled ? Date.now() : undefined);

      const wthOpenedAt = wizardData.withdrawalOpenMode === 'SCHEDULED' && wizardData.withdrawalOpenedAt
        ? new Date(wizardData.withdrawalOpenedAt).getTime()
        : (wizardData.withdrawalEnabled ? Date.now() : undefined);

      // 1. If creating brand new asset first
      if (wizardData.isNewAsset) {
        const createAssetRes = await fetch('/api/admin/listings/assets', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            symbol: wizardData.symbol,
            name: wizardData.name,
            assetType: wizardData.assetType,
            decimals: wizardData.decimals,
            network: wizardData.network,
            contractAddress: wizardData.contractAddress || undefined,
            depositEnabled: wizardData.depositEnabled,
            withdrawalEnabled: wizardData.withdrawalEnabled,
            depositOpenedAt: depOpenedAt,
            withdrawalOpenedAt: wthOpenedAt
          })
        });
        const assetJson = await createAssetRes.json();
        if (!createAssetRes.ok) throw new Error(assetJson.error || 'Gagal mendaftarkan aset baru');
        targetAssetId = assetJson.asset.id;
      }

      // 2. Resolve Quote Asset (USDT or IDR)
      const quoteAsset = assets.find(a => a.symbol === wizardData.quoteCurrency) ||
        (wizardData.quoteCurrency === 'USDT'
          ? { id: 'ast-usdt-0000-0000-000000000001' }
          : { id: 'ast-idr-0000-0000-000000000001' });

      // 3. Create Listing Request
      const createListingRes = await fetch('/api/admin/listings', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          assetId: targetAssetId,
          quoteAssetId: quoteAsset.id,
          tickSize: wizardData.tickSize,
          lotSize: wizardData.lotSize,
          minQuantity: wizardData.minQuantity,
          maxQuantity: wizardData.maxQuantity,
          minNotional: wizardData.minNotional,
          makerFeeBps: wizardData.makerFeeBps,
          takerFeeBps: wizardData.takerFeeBps,
          scheduledAt: wizardData.scheduledAt ? new Date(wizardData.scheduledAt).getTime() : undefined,
          depositEnabled: wizardData.depositEnabled,
          withdrawalEnabled: wizardData.withdrawalEnabled,
          depositOpenedAt: depOpenedAt,
          withdrawalOpenedAt: wthOpenedAt,
          marketMakerAccountId: wizardData.marketMakerAccountId || 'usr-mm-0000-0000-000000000001',
          projectOwnerAccountId: wizardData.projectOwnerAccountId || undefined,
          initialLiquidityBase: wizardData.initialLiquidityBase,
          initialLiquidityQuoteIdr: wizardData.initialLiquidityQuoteIdr
        })
      });
      const listingJson = await createListingRes.json();
      if (!createListingRes.ok) throw new Error(listingJson.error || 'Gagal membuat draft listing');

      showToast('success', 'Draft Listing Dibuat', `Draft listing ${wizardData.symbol || 'Token'}/${wizardData.quoteCurrency} berhasil dibuat!`);
      setWizardStep(1);
      setSubTab('OVERVIEW');
      loadData();
    } catch (e: any) {
      showToast('error', 'Gagal Membuat Listing', e.message);
    }
  };

  // Helper status badge
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#686D7A]/20 text-[#969BA8] border border-[#686D7A]/40 font-mono">DRAFT</span>;
      case 'PENDING_REVIEW':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#F5B942]/15 text-[#F5B942] border border-[#F5B942]/40 font-mono flex items-center gap-1 w-fit"><Clock className="w-3 h-3" /> PENDING REVIEW</span>;
      case 'APPROVED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#5B9DFF]/15 text-[#5B9DFF] border border-[#5B9DFF]/40 font-mono flex items-center gap-1 w-fit"><CheckCircle2 className="w-3 h-3" /> APPROVED</span>;
      case 'SCHEDULED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#F5B942]/15 text-[#F5B942] border border-[#F5B942]/40 font-mono flex items-center gap-1 w-fit"><Calendar className="w-3 h-3" /> SCHEDULED</span>;
      case 'ACTIVE':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#00C087]/15 text-[#00C087] border border-[#00C087]/40 font-mono flex items-center gap-1 w-fit"><Check className="w-3 h-3" /> ACTIVE</span>;
      case 'SUSPENDED':
      case 'HALTED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#EB3458]/15 text-[#EB3458] border border-[#EB3458]/40 font-mono flex items-center gap-1 w-fit"><Pause className="w-3 h-3" /> SUSPENDED</span>;
      case 'REJECTED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#EB3458]/15 text-[#EB3458] border border-[#EB3458]/40 font-mono flex items-center gap-1 w-fit"><XCircle className="w-3 h-3" /> REJECTED</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono text-[#969BA8]">{status}</span>;
    }
  };

  const filteredListings = listings.filter(l => {
    if (statusFilter !== 'ALL' && l.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      return l.symbol.includes(q) || l.id.includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* 1. Header & Cryptographic Integrity Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-[#15171F] border border-[#292C38]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-[#F5F5F7]">Initial Token Listing Management</h2>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#EB3458]/15 text-[#EB3458] border border-[#EB3458]/30 font-mono font-bold">
              MAKER-CHECKER ENFORCED
            </span>
          </div>
          <p className="text-xs text-[#969BA8]">
            Kelola lifecycle listing token baru dengan verifikasi multi-admin, integritas zero-float math, dan outbox activation idempoten.
          </p>
        </div>

        {/* Cryptographic Hash Chain Badge */}
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-lg border flex items-center gap-2 ${
            auditVerification?.isValid 
              ? 'bg-[#00C087]/10 border-[#00C087]/30 text-[#00C087]'
              : 'bg-[#EB3458]/10 border-[#EB3458]/30 text-[#EB3458]'
          }`}>
            {auditVerification?.isValid ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
            <div>
              <span className="text-xs font-bold font-mono block">
                {auditVerification?.isValid ? 'Audit Chain Verified' : 'Audit Chain Alert'}
              </span>
              <span className="text-[10px] text-[#969BA8] font-mono">
                {auditVerification?.totalEvents || 0} events · SHA-256 Chained
              </span>
            </div>
          </div>

          <Button
            variant="primary"
            size="sm"
            icon={<PlusCircle className="w-4 h-4" />}
            onClick={() => {
              setWizardStep(1);
              setSubTab('WIZARD');
            }}
          >
            Create Listing
          </Button>
        </div>
      </div>

      {/* 2. Subtabs Navigation */}
      <div className="flex border-b border-[#292C38] gap-6 text-xs font-semibold overflow-x-auto">
        <button
          onClick={() => setSubTab('OVERVIEW')}
          className={`pb-3 transition-colors flex items-center gap-2 whitespace-nowrap ${
            subTab === 'OVERVIEW' ? 'text-[#EB3458] border-b-2 border-[#EB3458]' : 'text-[#969BA8] hover:text-[#F5F5F7]'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Listing Overview</span>
          <span className="px-1.5 py-0.2 rounded bg-[#1C1F29] text-[10px] font-mono">{metrics.total}</span>
        </button>

        <button
          onClick={() => setSubTab('TOKEN_MANAGEMENT')}
          className={`pb-3 transition-colors flex items-center gap-2 whitespace-nowrap ${
            subTab === 'TOKEN_MANAGEMENT' ? 'text-[#EB3458] border-b-2 border-[#EB3458]' : 'text-[#969BA8] hover:text-[#F5F5F7]'
          }`}
        >
          <Coins className="w-4 h-4" />
          <span>Token & Limit Management</span>
          <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-400 font-bold text-[10px] font-mono">
            {tokenPairs.length}
          </span>
        </button>

        <button
          onClick={() => setSubTab('APPROVAL_QUEUE')}
          className={`pb-3 transition-colors flex items-center gap-2 whitespace-nowrap ${
            subTab === 'APPROVAL_QUEUE' ? 'text-[#EB3458] border-b-2 border-[#EB3458]' : 'text-[#969BA8] hover:text-[#F5F5F7]'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Approval Queue (Maker-Checker)</span>
          {metrics.pending > 0 && (
            <span className="px-1.5 py-0.2 rounded bg-[#F5B942] text-black font-bold text-[10px] font-mono">
              {metrics.pending}
            </span>
          )}
        </button>

        <button
          onClick={() => setSubTab('OPERATIONS')}
          className={`pb-3 transition-colors flex items-center gap-2 whitespace-nowrap ${
            subTab === 'OPERATIONS' ? 'text-[#EB3458] border-b-2 border-[#EB3458]' : 'text-[#969BA8] hover:text-[#F5F5F7]'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Market Operations & Engine</span>
        </button>

        <button
          onClick={() => setSubTab('WIZARD')}
          className={`pb-3 transition-colors flex items-center gap-2 whitespace-nowrap ${
            subTab === 'WIZARD' ? 'text-[#EB3458] border-b-2 border-[#EB3458]' : 'text-[#969BA8] hover:text-[#F5F5F7]'
          }`}
        >
          <PlusCircle className="w-4 h-4" />
          <span>Listing Wizard</span>
        </button>
      </div>

      {/* 3. SUBTAB: OVERVIEW */}
      {subTab === 'OVERVIEW' && (
        <div className="space-y-6">
          {/* KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="p-3 rounded-lg bg-[#15171F] border border-[#292C38]">
              <span className="text-[11px] text-[#686D7A] block">Drafts</span>
              <span className="text-lg font-bold text-[#F5F5F7] font-mono">{metrics.draft}</span>
            </div>
            <div className="p-3 rounded-lg bg-[#15171F] border border-[#292C38]">
              <span className="text-[11px] text-[#F5B942] block">Pending Review</span>
              <span className="text-lg font-bold text-[#F5B942] font-mono">{metrics.pending}</span>
            </div>
            <div className="p-3 rounded-lg bg-[#15171F] border border-[#292C38]">
              <span className="text-[11px] text-[#5B9DFF] block">Approved</span>
              <span className="text-lg font-bold text-[#5B9DFF] font-mono">{metrics.approved}</span>
            </div>
            <div className="p-3 rounded-lg bg-[#15171F] border border-[#292C38]">
              <span className="text-[11px] text-[#F5B942] block">Scheduled</span>
              <span className="text-lg font-bold text-[#F5B942] font-mono">{metrics.scheduled}</span>
            </div>
            <div className="p-3 rounded-lg bg-[#15171F] border border-[#292C38]">
              <span className="text-[11px] text-[#00C087] block">Active</span>
              <span className="text-lg font-bold text-[#00C087] font-mono">{metrics.active}</span>
            </div>
            <div className="p-3 rounded-lg bg-[#15171F] border border-[#292C38]">
              <span className="text-[11px] text-[#EB3458] block">Suspended</span>
              <span className="text-lg font-bold text-[#EB3458] font-mono">{metrics.suspended}</span>
            </div>
            <div className="p-3 rounded-lg bg-[#15171F] border border-[#292C38]">
              <span className="text-[11px] text-[#686D7A] block">Rejected</span>
              <span className="text-lg font-bold text-[#686D7A] font-mono">{metrics.rejected}</span>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-lg bg-[#15171F] border border-[#292C38]">
            <div className="flex items-center gap-2 w-full sm:w-72">
              <div className="relative w-full">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#686D7A]" />
                <input
                  type="text"
                  placeholder="Cari pair / ID..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#0E1016] border border-[#292C38] rounded-lg text-[#F5F5F7] placeholder-[#686D7A] outline-none focus:border-[#EB3458]"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
              {['ALL', 'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED'].map(st => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-colors ${
                    statusFilter === st
                      ? 'bg-[#1C1F29] text-white border border-[#292C38]'
                      : 'text-[#686D7A] hover:text-[#969BA8]'
                  }`}
                >
                  {st}
                </button>
              ))}
              <button
                onClick={loadData}
                className="p-1.5 rounded bg-[#0E1016] border border-[#292C38] text-[#969BA8] hover:text-white"
                title="Refresh listings"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Listings Table */}
          <div className="overflow-x-auto rounded-xl border border-[#292C38] bg-[#15171F]">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#0E1016] text-[#686D7A] text-[11px] border-b border-[#292C38]">
                <tr>
                  <th className="py-3 px-4 font-sans">Trading Pair</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Tick Size (sen)</th>
                  <th className="py-3 px-4 text-right">Lot Size</th>
                  <th className="py-3 px-4 text-right">Fee (M/T bps)</th>
                  <th className="py-3 px-4">Maker / Checker</th>
                  <th className="py-3 px-4 text-center">Version</th>
                  <th className="py-3 px-4 text-right font-sans">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292C38]/40">
                {filteredListings.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[#686D7A]">
                      Tidak ada listing request yang sesuai kriteria.
                    </td>
                  </tr>
                ) : (
                  filteredListings.map(item => (
                    <tr key={item.id} className="hover:bg-[#1C1F29]/60 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-sans">
                          <span className="font-bold text-[#F5F5F7] font-mono text-sm block">{item.symbol}</span>
                          <span className="text-[10px] text-[#686D7A] block truncate max-w-[140px]">ID: {item.id.slice(0, 14)}...</span>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className={`text-[9px] px-1.5 py-0.2 rounded font-semibold font-mono ${
                              item.depositStatus === 'OPEN' ? 'bg-[#00C087]/15 text-[#00C087] border border-[#00C087]/30' : 'bg-[#EB3458]/15 text-[#EB3458] border border-[#EB3458]/30'
                            }`}>
                              Dep: {item.depositStatus || 'OPEN'}
                            </span>
                            <span className={`text-[9px] px-1.5 py-0.2 rounded font-semibold font-mono ${
                              item.withdrawalStatus === 'OPEN' ? 'bg-[#00C087]/15 text-[#00C087] border border-[#00C087]/30' : 'bg-[#EB3458]/15 text-[#EB3458] border border-[#EB3458]/30'
                            }`}>
                              Wth: {item.withdrawalStatus || 'OPEN'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {renderStatusBadge(item.status)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-[#F5F5F7]">
                        {item.tickSize} sen
                      </td>
                      <td className="py-3 px-4 text-right text-[#969BA8]">
                        {item.lotSize}
                      </td>
                      <td className="py-3 px-4 text-right text-[#969BA8]">
                        {item.makerFeeBps} / {item.takerFeeBps}
                      </td>
                      <td className="py-3 px-4 text-[11px]">
                        <span className="text-[#969BA8] block truncate max-w-[120px]" title={item.creatorEmail || item.createdBy}>
                          M: {item.creatorEmail || item.createdBy.slice(0, 8)}
                        </span>
                        <span className="text-[#686D7A] block truncate max-w-[120px]" title={item.approval?.reviewerEmail || '-'}>
                          C: {item.approval ? item.approval.reviewerEmail : '-'}
                        </span>
                        <span className="text-[#5B9DFF] block text-[10px] truncate max-w-[120px]" title={item.marketMakerEmail || item.marketMakerAccountId}>
                          MM: {item.marketMakerEmail ? item.marketMakerEmail.split('@')[0] : 'dimonex_mm'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-1.5 py-0.5 rounded bg-[#0E1016] text-[#EB3458] font-bold border border-[#292C38]">
                          v{item.version}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {item.status === 'DRAFT' && (
                            <button
                              onClick={() => handleSubmitForReview(item.id)}
                              className="px-2 py-1 rounded bg-[#EB3458]/15 hover:bg-[#EB3458]/25 text-[#EB3458] text-[11px] font-semibold border border-[#EB3458]/30 transition-colors"
                            >
                              Submit
                            </button>
                          )}

                          {item.status === 'APPROVED' && (
                            <button
                              onClick={() => handleActivate(item.id)}
                              disabled={isActivating}
                              className="px-2 py-1 rounded bg-[#00C087]/15 hover:bg-[#00C087]/25 text-[#00C087] text-[11px] font-semibold border border-[#00C087]/30 transition-colors"
                            >
                              Activate
                            </button>
                          )}

                          {item.status === 'ACTIVE' && (
                            <button
                              onClick={() => handleSuspend(item.id)}
                              className="px-2 py-1 rounded bg-[#EB3458]/15 hover:bg-[#EB3458]/25 text-[#EB3458] text-[11px] font-semibold border border-[#EB3458]/30 transition-colors"
                            >
                              Halt
                            </button>
                          )}

                          {item.status === 'SUSPENDED' && (
                            <button
                              onClick={() => handleResume(item.id)}
                              className="px-2 py-1 rounded bg-[#00C087]/15 hover:bg-[#00C087]/25 text-[#00C087] text-[11px] font-semibold border border-[#00C087]/30 transition-colors"
                            >
                              Resume
                            </button>
                          )}

                          <button
                            onClick={() => {
                              setSelectedListing(item);
                              setShowDetailModal(true);
                            }}
                            className="px-2 py-1 rounded bg-[#0E1016] hover:bg-[#1C1F29] text-[#969BA8] hover:text-white text-[11px] border border-[#292C38] transition-colors"
                          >
                            Detail
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. SUBTAB: APPROVAL QUEUE (MAKER-CHECKER) */}
      {subTab === 'APPROVAL_QUEUE' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-[#15171F] border border-[#292C38]">
            <h3 className="text-sm font-bold text-[#F5F5F7] mb-1">Maker-Checker Approval Workflow</h3>
            <p className="text-xs text-[#969BA8]">
              Setiap listing yang diajukan oleh Maker wajib ditelaah secara independen oleh Checker admin berbeda sebelum trading dapat disiapkan dan diaktifkan.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {listings.filter(l => l.status === 'PENDING_REVIEW').length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-[#15171F] border border-[#292C38] text-[#686D7A]">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-[#00C087]/60" />
                <span className="text-sm font-bold block text-[#F5F5F7]">Antrean Review Kosong</span>
                <span className="text-xs mt-1 block">Semua listing yang diajukan sudah disetujui atau diproses.</span>
              </div>
            ) : (
              listings.filter(l => l.status === 'PENDING_REVIEW').map(item => {
                const isCreator = currentUser && item.createdBy === currentUser.id;

                return (
                  <div key={item.id} className="p-5 rounded-xl bg-[#15171F] border border-[#292C38] space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#292C38]">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold text-[#F5F5F7] font-mono">{item.symbol}</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-[#F5B942]/15 text-[#F5B942] border border-[#F5B942]/30 font-mono">
                            PENDING REVIEW v{item.version}
                          </span>
                        </div>
                        <span className="text-xs text-[#686D7A] font-mono">
                          Diajukan oleh: <strong className="text-[#969BA8]">{item.creatorEmail || item.createdBy}</strong>
                        </span>
                      </div>

                      {/* Maker-Checker Warning if current user is Maker */}
                      {isCreator && (
                        <div className="px-3 py-1.5 rounded-lg bg-[#EB3458]/10 border border-[#EB3458]/30 text-[#EB3458] text-xs flex items-center gap-1.5 font-medium">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>Anda adalah Maker listing ini (Self-approval ditolak).</span>
                        </div>
                      )}
                    </div>

                    {/* Parameters Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                      <div className="p-2.5 rounded bg-[#0E1016] border border-[#292C38]">
                        <span className="text-[#686D7A] block">Tick Size:</span>
                        <span className="text-[#F5F5F7] font-bold">{item.tickSize} sen</span>
                      </div>
                      <div className="p-2.5 rounded bg-[#0E1016] border border-[#292C38]">
                        <span className="text-[#686D7A] block">Lot Size:</span>
                        <span className="text-[#F5F5F7] font-bold">{item.lotSize}</span>
                      </div>
                      <div className="p-2.5 rounded bg-[#0E1016] border border-[#292C38]">
                        <span className="text-[#686D7A] block">Min Order / Notional:</span>
                        <span className="text-[#F5F5F7] font-bold">{item.minQuantity} / {item.minNotional} sen</span>
                      </div>
                      <div className="p-2.5 rounded bg-[#0E1016] border border-[#292C38]">
                        <span className="text-[#686D7A] block">Fee Structure:</span>
                        <span className="text-[#F5F5F7] font-bold">M: {item.makerFeeBps} bps | T: {item.takerFeeBps} bps</span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-end gap-3 pt-2">
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={isCreator}
                        onClick={() => {
                          setSelectedListing(item);
                          setShowRejectModal(true);
                        }}
                      >
                        Reject Listing
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={isCreator}
                        icon={<CheckCircle2 className="w-4 h-4" />}
                        onClick={() => {
                          setSelectedListing(item);
                          setShowApproveModal(true);
                        }}
                      >
                        Approve Listing
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 5. SUBTAB: OPERATIONS & ENGINE SYNC */}
      {subTab === 'OPERATIONS' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-[#15171F] border border-[#292C38] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-[#F5F5F7]">Matching Engine Market Status</h3>
              <p className="text-xs text-[#969BA8]">
                Sinkronisasi status antara database relasional dan memory single-threaded matching engine.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={loadData}
            >
              Sync Engine Status
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {listings.filter(l => l.status === 'ACTIVE' || l.status === 'SUSPENDED').map(item => (
              <div key={item.id} className="p-4 rounded-xl bg-[#15171F] border border-[#292C38] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-base font-bold font-mono text-[#F5F5F7]">{item.symbol}</span>
                  {renderStatusBadge(item.status)}
                </div>

                <div className="text-xs font-mono space-y-1 text-[#969BA8]">
                  <div>Engine Pair ID: <strong className="text-white">{item.symbol}</strong></div>
                  <div>Tick Size: {item.tickSize} sen | Lot: {item.lotSize}</div>
                  <div>Base Decimals: {item.baseAsset?.decimals || 8} | Quote Decimals: {item.quoteAsset?.decimals || 2}</div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#292C38]">
                  <button
                    onClick={() => handleReconcile(item.id)}
                    className="text-xs text-[#5B9DFF] hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> Verifikasi Engine Sync
                  </button>

                  <div className="flex items-center gap-2">
                    {item.status === 'ACTIVE' ? (
                      <button
                        onClick={() => handleSuspend(item.id)}
                        className="px-2.5 py-1 rounded bg-[#EB3458]/15 text-[#EB3458] text-xs font-bold border border-[#EB3458]/30"
                      >
                        Halt Market
                      </button>
                    ) : (
                      <button
                        onClick={() => handleResume(item.id)}
                        className="px-2.5 py-1 rounded bg-[#00C087]/15 text-[#00C087] text-xs font-bold border border-[#00C087]/30"
                      >
                        Resume Market
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. SUBTAB: TOKEN & LIMIT MANAGEMENT */}
      {subTab === 'TOKEN_MANAGEMENT' && (
        <div className="space-y-6">
          {/* Header Explanation Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-blue-900/30 via-slate-900/60 to-purple-900/30 border border-blue-500/30">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-blue-500/20 text-blue-400 shrink-0">
                <Coins className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Manajemen Token & Limit Kuantitas Order</span>
                  <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-mono font-semibold">
                    Zero-Float Precision · Anti-Integer Confusion
                  </span>
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Semua token di DIMONEX beroperasi dengan presisi integer eksak (BigInt). Token dengan 8 desimal (seperti DOGE, SOL, BTC) memiliki faktor 1 Token = 100.000.000 unit atomik.
                  Jika batas maksimum order diset terlalu rendah (misal 5.000.000.000 unit atomik yang hanya bernilai 50 DOGE), bot market maker atau ladder likuiditas akan gagal memasang order dan mengeluarkan galat <em>"Kuantitas order melebihi batas maksimum"</em>.
                  Gunakan konsol ini untuk mengatur batas order secara aman dalam satuan Token Riil (Human) dengan kalkulasi atomik otomatis.
                </p>
              </div>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#686D7A]" />
              <input
                type="text"
                placeholder="Cari pair atau token (misal DOGE, USDT, BTC)..."
                value={tokenSearchQuery}
                onChange={e => setTokenSearchQuery(e.target.value)}
                className="w-full bg-[#15171F] border border-[#292C38] rounded-lg pl-9 pr-3 py-2 text-xs text-[#F5F5F7] placeholder-[#686D7A] outline-none focus:border-[#EB3458]"
              />
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <div className="flex bg-[#15171F] p-1 rounded-lg border border-[#292C38] text-xs">
                {(['ALL', 'ACTIVE', 'HALTED'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setTokenStatusFilter(st)}
                    className={`px-3 py-1 rounded font-medium transition-colors ${
                      tokenStatusFilter === st ? 'bg-[#292C38] text-white font-bold' : 'text-[#969BA8] hover:text-white'
                    }`}
                  >
                    {st === 'ALL' ? 'Semua Status' : st === 'ACTIVE' ? 'Aktif' : 'Halted'}
                  </button>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                onClick={loadData}
              >
                Segarkan
              </Button>
            </div>
          </div>

          {/* Token Pairs Grid */}
          <div className="grid grid-cols-1 gap-4">
            {tokenPairs
              .filter(p => {
                if (tokenSearchQuery) {
                  const q = tokenSearchQuery.toUpperCase();
                  if (!p.id?.toUpperCase().includes(q) && !p.baseCurrency?.toUpperCase().includes(q)) {
                    return false;
                  }
                }
                if (tokenStatusFilter === 'ACTIVE' && p.isHalted) return false;
                if (tokenStatusFilter === 'HALTED' && !p.isHalted) return false;
                return true;
              })
              .map(pair => {
                const dec = pair.baseDecimals || 8;
                const factor = 10n ** BigInt(dec);
                let humanMin = '0';
                let humanMax = '0';
                try {
                  const minUnits = BigInt(pair.minOrderSize || '0');
                  const maxUnits = BigInt(pair.maxOrderSize || '0');
                  humanMin = (Number(minUnits) / Number(factor)).toLocaleString('id-ID', { maximumFractionDigits: dec });
                  humanMax = (Number(maxUnits) / Number(factor)).toLocaleString('id-ID', { maximumFractionDigits: dec });
                } catch {}

                return (
                  <div
                    key={pair.id}
                    className="p-5 rounded-xl bg-[#15171F] border border-[#292C38] hover:border-slate-700 transition-all space-y-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#292C38]/60 pb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1E2230] to-[#0E1016] border border-[#292C38] flex items-center justify-center font-bold text-sm text-[#F5F5F7]">
                          {pair.baseCurrency?.slice(0, 3)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold text-white font-mono">{pair.id}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded bg-[#1C1F29] border border-[#292C38] text-slate-300 font-mono">
                              {dec} Desimal
                            </span>
                            <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                              pair.isHalted
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            }`}>
                              {pair.isHalted ? 'TRADING HALTED' : 'AKTIF BERJALAN'}
                            </span>
                          </div>
                          <span className="text-xs text-[#969BA8]">
                            Base: <strong className="text-white">{pair.baseCurrency}</strong> · Quote: <strong className="text-white">{pair.quoteCurrency}</strong> · 1 {pair.baseCurrency} = {Math.pow(10, dec).toLocaleString('id-ID')} unit atomik
                          </span>
                        </div>
                      </div>

                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Edit className="w-3.5 h-3.5" />}
                        onClick={() => handleOpenTokenEdit(pair)}
                      >
                        Ubah Limit & Parameter
                      </Button>
                    </div>

                    {/* Detailed Limits & Specs */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      {/* Min Order */}
                      <div className="p-3 rounded-lg bg-[#0E1016] border border-[#292C38]">
                        <span className="text-[11px] text-[#969BA8] block mb-1 flex items-center gap-1">
                          <span>Min Order (Batas Bawah)</span>
                        </span>
                        <div className="text-sm font-bold text-white font-mono">
                          {humanMin} <span className="text-xs text-[#EB3458]">{pair.baseCurrency}</span>
                        </div>
                        <span className="text-[10px] text-[#686D7A] font-mono block mt-0.5 truncate" title={`${pair.minOrderSize} unit atomik`}>
                          {pair.minOrderSize} unit
                        </span>
                      </div>

                      {/* Max Order */}
                      <div className="p-3 rounded-lg bg-[#0E1016] border border-[#292C38]">
                        <span className="text-[11px] text-[#969BA8] block mb-1 flex items-center gap-1">
                          <span>Max Order (Batas Atas)</span>
                        </span>
                        <div className="text-sm font-bold text-white font-mono">
                          {humanMax} <span className="text-xs text-[#EB3458]">{pair.baseCurrency}</span>
                        </div>
                        <span className="text-[10px] text-[#686D7A] font-mono block mt-0.5 truncate" title={`${pair.maxOrderSize} unit atomik`}>
                          {pair.maxOrderSize} unit
                        </span>
                      </div>

                      {/* Tick & Lot Size */}
                      <div className="p-3 rounded-lg bg-[#0E1016] border border-[#292C38]">
                        <span className="text-[11px] text-[#969BA8] block mb-1">Tick & Lot Size</span>
                        <div className="text-sm font-bold text-white font-mono">
                          {pair.quoteCurrency === 'USDT'
                            ? `$${(Number(pair.tickSize || 10000) / 1000000).toFixed(4)}`
                            : `Rp ${(Number(pair.tickSize || 100) / 100).toLocaleString('id-ID')}`}
                        </div>
                        <span className="text-[10px] text-[#686D7A] font-mono block mt-0.5">
                          Tick: {pair.tickSize || (pair.quoteCurrency === 'USDT' ? '10000' : '100')} · Lot: {pair.lotSize || pair.minOrderSize}
                        </span>
                      </div>

                      {/* Trading Fees */}
                      <div className="p-3 rounded-lg bg-[#0E1016] border border-[#292C38]">
                        <span className="text-[11px] text-[#969BA8] block mb-1">Biaya Transaksi (Fee)</span>
                        <div className="text-sm font-bold text-white font-mono">
                          {((pair.makerFeeBps ?? 10) / 100).toFixed(2)}% / {((pair.takerFeeBps ?? 20) / 100).toFixed(2)}%
                        </div>
                        <span className="text-[10px] text-[#686D7A] font-mono block mt-0.5">
                          Maker: {pair.makerFeeBps ?? 10} bps · Taker: {pair.takerFeeBps ?? 20} bps
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 6. SUBTAB: CREATE LISTING WIZARD (6 STEPS) */}
      {subTab === 'WIZARD' && (
        <div className="p-6 rounded-xl bg-[#15171F] border border-[#292C38] space-y-6 max-w-3xl mx-auto">
          {/* Wizard Step Progress */}
          <div className="flex items-center justify-between border-b border-[#292C38] pb-4 text-xs font-mono">
            {[
              { num: 1, title: 'Asset Identity' },
              { num: 2, title: 'Network & Contract' },
              { num: 3, title: 'Trading Pair' },
              { num: 4, title: 'Fee & Risk' },
              { num: 5, title: 'Review Summary' },
              { num: 6, title: 'Submit' }
            ].map(step => (
              <div
                key={step.num}
                className={`flex items-center gap-1.5 ${
                  wizardStep === step.num
                    ? 'text-[#EB3458] font-bold'
                    : wizardStep > step.num
                    ? 'text-[#00C087]'
                    : 'text-[#686D7A]'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  wizardStep === step.num
                    ? 'bg-[#EB3458] text-white'
                    : wizardStep > step.num
                    ? 'bg-[#00C087] text-black'
                    : 'bg-[#0E1016] text-[#686D7A] border border-[#292C38]'
                }`}>
                  {step.num}
                </span>
                <span className="hidden md:inline">{step.title}</span>
              </div>
            ))}
          </div>

          {/* STEP 1: Asset Identity */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-[#F5F5F7]">Step 1: Identitas Aset</h3>
              <p className="text-xs text-[#969BA8]">
                Pilih aset yang sudah terdaftar di catalog atau daftarkan aset kripto baru.
              </p>

              <div className="flex gap-4 mb-3">
                <button
                  type="button"
                  onClick={() => setWizardData({ ...wizardData, isNewAsset: false })}
                  className={`flex-1 p-3 rounded-lg border text-left text-xs ${
                    !wizardData.isNewAsset
                      ? 'bg-[#1C1F29] border-[#EB3458] text-white font-bold'
                      : 'bg-[#0E1016] border-[#292C38] text-[#969BA8]'
                  }`}
                >
                  Pilih Aset Terdaftar
                </button>
                <button
                  type="button"
                  onClick={() => setWizardData({ ...wizardData, isNewAsset: true })}
                  className={`flex-1 p-3 rounded-lg border text-left text-xs ${
                    wizardData.isNewAsset
                      ? 'bg-[#1C1F29] border-[#EB3458] text-white font-bold'
                      : 'bg-[#0E1016] border-[#292C38] text-[#969BA8]'
                  }`}
                >
                  Daftarkan Aset Kripto Baru
                </button>
              </div>

              {!wizardData.isNewAsset ? (
                <div>
                  <label className="text-xs text-[#969BA8] block mb-1">Aset Terdaftar:</label>
                  <select
                    value={wizardData.selectedAssetId}
                    onChange={e => {
                      const ast = assets.find(a => a.id === e.target.value);
                      setWizardData({
                        ...wizardData,
                        selectedAssetId: e.target.value,
                        symbol: ast ? ast.symbol : '',
                        name: ast ? ast.name : '',
                        decimals: ast ? ast.decimals : 8,
                        network: ast ? ast.network : 'ETHEREUM',
                        contractAddress: ast?.contractAddress || ''
                      });
                    }}
                    className="w-full bg-[#0E1016] border border-[#292C38] rounded-lg p-2.5 text-xs text-[#F5F5F7] font-mono outline-none"
                  >
                    <option value="">-- Pilih Aset --</option>
                    {assets.filter(a => a.symbol !== 'IDR').map(a => (
                      <option key={a.id} value={a.id}>
                        {a.symbol} - {a.name} ({a.network}, {a.decimals} decimals)
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-[#969BA8] block mb-1">Simbol Token (2-12 Karakter Alfanumerik):</label>
                    <Input
                      placeholder="e.g. SOL, UNI, AVAX"
                      value={wizardData.symbol}
                      onChange={e => setWizardData({ ...wizardData, symbol: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#969BA8] block mb-1">Nama Lengkap Aset:</label>
                    <Input
                      placeholder="e.g. Solana, Uniswap"
                      value={wizardData.name}
                      onChange={e => setWizardData({ ...wizardData, name: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[#969BA8] block mb-1">Tipe Aset:</label>
                      <select
                        value={wizardData.assetType}
                        onChange={e => setWizardData({ ...wizardData, assetType: e.target.value as any })}
                        className="w-full bg-[#0E1016] border border-[#292C38] rounded-lg p-2 text-xs text-[#F5F5F7] outline-none"
                      >
                        <option value="TOKEN">TOKEN (Smart Contract)</option>
                        <option value="NATIVE">NATIVE (L1 Coin)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-[#969BA8] block mb-1">Presisi Desimal (0-18):</label>
                      <Input
                        type="number"
                        value={wizardData.decimals.toString()}
                        onChange={e => setWizardData({ ...wizardData, decimals: parseInt(e.target.value, 10) || 8 })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Network & Contract Validation */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-[#F5F5F7]">Step 2: Jaringan & Validasi Kontrak</h3>
              <p className="text-xs text-[#969BA8]">
                Tentukan blockchain network dan contract address token. Sistem memvalidasi checksum dan format alamat.
              </p>

              <div>
                <label className="text-xs text-[#969BA8] block mb-1">Blockchain Network:</label>
                <select
                  value={wizardData.network}
                  onChange={e => setWizardData({ ...wizardData, network: e.target.value })}
                  className="w-full bg-[#0E1016] border border-[#292C38] rounded-lg p-2.5 text-xs text-[#F5F5F7] outline-none"
                >
                  <option value="ETHEREUM">Ethereum (ERC-20)</option>
                  <option value="SOLANA">Solana (SPL)</option>
                  <option value="BSC">BNB Smart Chain (BEP-20)</option>
                  <option value="TRON">Tron (TRC-20)</option>
                  <option value="POLYGON">Polygon PoS</option>
                  <option value="BITCOIN">Bitcoin (Native UTXO)</option>
                </select>
              </div>

              {wizardData.assetType === 'TOKEN' && (
                <div>
                  <label className="text-xs text-[#969BA8] block mb-1">Smart Contract Address:</label>
                  <Input
                    placeholder={
                      wizardData.network === 'SOLANA' 
                        ? 'e.g. EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
                        : wizardData.network === 'TRON'
                        ? 'e.g. TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
                        : 'e.g. 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'
                    }
                    value={wizardData.contractAddress}
                    onChange={e => setWizardData({ ...wizardData, contractAddress: e.target.value.trim() })}
                  />
                </div>
              )}

              {/* Deposit & Withdrawal Open Configuration */}
              <div className="pt-2 border-t border-[#292C38] space-y-4">
                <h4 className="text-xs font-bold text-[#F5F5F7] uppercase tracking-wider text-[#EB3458]">
                  Konfigurasi Jadwal Deposit & Withdrawal
                </h4>

                {/* Deposit Configuration */}
                <div className="p-3.5 rounded-lg bg-[#0E1016] border border-[#292C38] space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs font-semibold text-[#F5F5F7] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={wizardData.depositEnabled}
                        onChange={e => setWizardData({ ...wizardData, depositEnabled: e.target.checked })}
                        className="accent-[#EB3458] w-4 h-4"
                      />
                      <span>Buka Jalur Deposit (Deposit Enabled)</span>
                    </label>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                      wizardData.depositEnabled ? 'bg-[#00C087]/20 text-[#00C087]' : 'bg-[#EB3458]/20 text-[#EB3458]'
                    }`}>
                      {wizardData.depositEnabled ? 'DEPOSIT AKTIF' : 'DEPOSIT DITUTUP'}
                    </span>
                  </div>

                  {wizardData.depositEnabled && (
                    <div className="pl-6 space-y-2 pt-1 border-t border-[#292C38]/60">
                      <div className="flex gap-3 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer text-[#969BA8]">
                          <input
                            type="radio"
                            name="depMode"
                            checked={wizardData.depositOpenMode === 'IMMEDIATE'}
                            onChange={() => setWizardData({ ...wizardData, depositOpenMode: 'IMMEDIATE' })}
                            className="accent-[#EB3458]"
                          />
                          <span>Buka Sekarang (Immediate saat Listing Aktif)</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-[#969BA8]">
                          <input
                            type="radio"
                            name="depMode"
                            checked={wizardData.depositOpenMode === 'SCHEDULED'}
                            onChange={() => setWizardData({ ...wizardData, depositOpenMode: 'SCHEDULED' })}
                            className="accent-[#EB3458]"
                          />
                          <span>Jadwalkan Waktu Buka Deposit</span>
                        </label>
                      </div>

                      {wizardData.depositOpenMode === 'SCHEDULED' && (
                        <div>
                          <label className="text-[11px] text-[#686D7A] block mb-1">Tanggal & Jam Pembukaan Deposit:</label>
                          <Input
                            type="datetime-local"
                            value={wizardData.depositOpenedAt}
                            onChange={e => setWizardData({ ...wizardData, depositOpenedAt: e.target.value })}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Withdrawal Configuration */}
                <div className="p-3.5 rounded-lg bg-[#0E1016] border border-[#292C38] space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs font-semibold text-[#F5F5F7] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={wizardData.withdrawalEnabled}
                        onChange={e => setWizardData({ ...wizardData, withdrawalEnabled: e.target.checked })}
                        className="accent-[#EB3458] w-4 h-4"
                      />
                      <span>Buka Jalur Penarikan (Withdrawal Enabled)</span>
                    </label>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                      wizardData.withdrawalEnabled ? 'bg-[#00C087]/20 text-[#00C087]' : 'bg-[#EB3458]/20 text-[#EB3458]'
                    }`}>
                      {wizardData.withdrawalEnabled ? 'WITHDRAWAL AKTIF' : 'WITHDRAWAL DITUTUP'}
                    </span>
                  </div>

                  {wizardData.withdrawalEnabled && (
                    <div className="pl-6 space-y-2 pt-1 border-t border-[#292C38]/60">
                      <div className="flex gap-3 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer text-[#969BA8]">
                          <input
                            type="radio"
                            name="wthMode"
                            checked={wizardData.withdrawalOpenMode === 'IMMEDIATE'}
                            onChange={() => setWizardData({ ...wizardData, withdrawalOpenMode: 'IMMEDIATE' })}
                            className="accent-[#EB3458]"
                          />
                          <span>Buka Sekarang (Immediate saat Listing Aktif)</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-[#969BA8]">
                          <input
                            type="radio"
                            name="wthMode"
                            checked={wizardData.withdrawalOpenMode === 'SCHEDULED'}
                            onChange={() => setWizardData({ ...wizardData, withdrawalOpenMode: 'SCHEDULED' })}
                            className="accent-[#EB3458]"
                          />
                          <span>Jadwalkan Waktu Buka Withdrawal</span>
                        </label>
                      </div>

                      {wizardData.withdrawalOpenMode === 'SCHEDULED' && (
                        <div>
                          <label className="text-[11px] text-[#686D7A] block mb-1">Tanggal & Jam Pembukaan Withdrawal:</label>
                          <Input
                            type="datetime-local"
                            value={wizardData.withdrawalOpenedAt}
                            onChange={e => setWizardData({ ...wizardData, withdrawalOpenedAt: e.target.value })}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Trading Pair Configuration */}
          {wizardStep === 3 && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-[#F5F5F7]">Step 3: Konfigurasi Pasangan Perdagangan (Quote Currency)</h3>
              <p className="text-xs text-[#969BA8]">
                Konfigurasi parameter pasar spot dengan mata uang quote USDT (Tether) atau Rupiah (IDR).
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#969BA8] block mb-1">Base Currency:</label>
                  <Input value={wizardData.symbol} disabled />
                </div>
                <div>
                  <label className="text-xs text-[#969BA8] block mb-1">Quote Currency (Pilih Pasar):</label>
                  <select
                    value={wizardData.quoteCurrency}
                    onChange={e => {
                      const q = e.target.value as 'USDT' | 'IDR';
                      setWizardData({
                        ...wizardData,
                        quoteCurrency: q,
                        tickSize: q === 'USDT' ? '10000' : '100',
                        minNotional: q === 'USDT' ? '5000000' : '1000000',
                        initialLiquidityQuoteIdr: q === 'USDT' ? '50000000000' : '5000000000'
                      });
                    }}
                    className="w-full bg-[#0E1016] border border-[#292C38] rounded-lg p-2.5 text-xs text-[#F5F5F7] font-mono outline-none focus:border-[#EB3458]"
                  >
                    <option value="USDT">USDT (Tether USD — Stablecoin Global)</option>
                    <option value="IDR">IDR (Indonesian Rupiah — Fiat Lokal)</option>
                  </select>
                </div>
              </div>

              {/* Tick Size */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[#969BA8]">
                    Tick Size ({wizardData.quoteCurrency === 'USDT' ? 'USDT Units' : 'IDR Sen'}):
                  </label>
                  <span className="text-[11px] font-mono font-bold text-blue-400">
                    Setara: {wizardData.quoteCurrency === 'USDT' 
                      ? `$${(Number(wizardData.tickSize || 0) / 1000000).toFixed(4)} USDT` 
                      : `Rp ${(Number(wizardData.tickSize || 0) / 100).toLocaleString('id-ID')}`}
                  </span>
                </div>
                <Input
                  value={wizardData.tickSize}
                  onChange={e => setWizardData({ ...wizardData, tickSize: e.target.value })}
                  placeholder={wizardData.quoteCurrency === 'USDT' ? '10000' : '100'}
                />
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] text-[#686D7A]">Preset:</span>
                  {wizardData.quoteCurrency === 'USDT' ? (
                    <>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, tickSize: '10000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        $0.01 (10.000)
                      </button>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, tickSize: '50000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        $0.05 (50.000)
                      </button>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, tickSize: '100000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        $0.10 (100.000)
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, tickSize: '100' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        Rp 1 (100 sen)
                      </button>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, tickSize: '1000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        Rp 10 (1.000 sen)
                      </button>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, tickSize: '5000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        Rp 50 (5.000 sen)
                      </button>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, tickSize: '10000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        Rp 100 (10.000 sen)
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Lot Size */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[#969BA8]">Lot Size (Base units integer eksak):</label>
                  <span className="text-[11px] font-mono font-bold text-blue-400">
                    Setara: {(Number(wizardData.lotSize || 0) / Math.pow(10, wizardData.decimals || 8)).toLocaleString('id-ID', { maximumFractionDigits: wizardData.decimals || 8 })} {wizardData.symbol || 'TOKEN'}
                  </span>
                </div>
                <Input
                  value={wizardData.lotSize}
                  onChange={e => setWizardData({ ...wizardData, lotSize: e.target.value })}
                  placeholder="100000000"
                />
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] text-[#686D7A]">Preset:</span>
                  <button type="button" onClick={() => setWizardData({ ...wizardData, lotSize: (10n ** BigInt(wizardData.decimals || 8)).toString() })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                    1 {wizardData.symbol || 'Token'}
                  </button>
                  <button type="button" onClick={() => setWizardData({ ...wizardData, lotSize: ((10n ** BigInt(wizardData.decimals || 8)) / 100n).toString() })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                    0.01 {wizardData.symbol || 'Token'}
                  </button>
                  <button type="button" onClick={() => setWizardData({ ...wizardData, lotSize: ((10n ** BigInt(wizardData.decimals || 8)) / 10000n).toString() })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                    0.0001 {wizardData.symbol || 'Token'}
                  </button>
                </div>
              </div>

              {/* Min Notional */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-[#969BA8]">
                    Min Notional Value ({wizardData.quoteCurrency === 'USDT' ? 'USDT Units' : 'IDR Sen'}):
                  </label>
                  <span className="text-[11px] font-mono font-bold text-blue-400">
                    Setara: {wizardData.quoteCurrency === 'USDT' 
                      ? `$${(Number(wizardData.minNotional || 0) / 1000000).toFixed(2)} USDT` 
                      : `Rp ${(Number(wizardData.minNotional || 0) / 100).toLocaleString('id-ID')}`}
                  </span>
                </div>
                <Input
                  value={wizardData.minNotional}
                  onChange={e => setWizardData({ ...wizardData, minNotional: e.target.value })}
                  placeholder={wizardData.quoteCurrency === 'USDT' ? '5000000' : '1000000'}
                />
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] text-[#686D7A]">Preset:</span>
                  {wizardData.quoteCurrency === 'USDT' ? (
                    <>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, minNotional: '1000000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        $1.00 USDT
                      </button>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, minNotional: '5000000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        $5.00 USDT
                      </button>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, minNotional: '10000000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        $10.00 USDT
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, minNotional: '1000000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        Rp 10.000 (1M sen)
                      </button>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, minNotional: '2500000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        Rp 25.000 (2.5M sen)
                      </button>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, minNotional: '5000000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        Rp 50.000 (5M sen)
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Fee, Market Maker & Project Trader Accounts */}
          {wizardStep === 4 && (
            <div className="space-y-5">
              <h3 className="text-base font-bold text-[#F5F5F7]">Step 4: Fee, Likuiditas & Akun Trader Project</h3>
              <p className="text-xs text-[#969BA8]">
                Tentukan akun ID yang ditugaskan sebagai Market Maker (MM) dan akun Trader milik project owner untuk injeksi likuiditas awal.
              </p>

              {/* Designated MM Account Selection */}
              <div className="p-4 rounded-xl bg-[#0E1016] border border-[#292C38] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-[#F5F5F7] block">
                      Akun Market Maker (MM) Resmi DIMONEX *
                    </label>
                    <span className="text-[11px] text-[#969BA8]">
                      Akun yang akan memasang spread likuiditas awal order book (Bids & Asks).
                    </span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#5B9DFF]/20 text-[#5B9DFF] font-mono font-bold">
                    DESIGNATED MM
                  </span>
                </div>

                <select
                  value={wizardData.marketMakerAccountId}
                  onChange={e => setWizardData({ ...wizardData, marketMakerAccountId: e.target.value })}
                  className="w-full bg-[#15171F] border border-[#292C38] rounded-lg p-2.5 text-xs text-[#F5F5F7] font-mono outline-none focus:border-[#EB3458]"
                >
                  <option value="usr-mm-0000-0000-000000000001">
                    mm@dimonex.id — Market Maker Operator DIMONEX (ID: usr-mm-0000-0000-000000000001)
                  </option>
                  {eligibleAccounts.filter(a => a.id !== 'usr-mm-0000-0000-000000000001').map(a => (
                    <option key={a.id} value={a.id}>
                      {a.email} — {a.fullName} ({a.role})
                    </option>
                  ))}
                </select>
              </div>

              {/* Project Owner / Issuer Trader Account */}
              <div className="p-4 rounded-xl bg-[#0E1016] border border-[#292C38] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-[#F5F5F7] block">
                      Akun Trader Pemilik Project / Token Issuer
                    </label>
                    <span className="text-[11px] text-[#969BA8]">
                      Akun pengembang / founder proyek yang memegang alokasi token listing dan komitmen dana IDR.
                    </span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#00C087]/20 text-[#00C087] font-mono font-bold">
                    PROJECT OWNER
                  </span>
                </div>

                <select
                  value={wizardData.projectOwnerAccountId}
                  onChange={e => setWizardData({ ...wizardData, projectOwnerAccountId: e.target.value })}
                  className="w-full bg-[#15171F] border border-[#292C38] rounded-lg p-2.5 text-xs text-[#F5F5F7] font-mono outline-none focus:border-[#EB3458]"
                >
                  <option value="">-- Pilih Akun Trader Pemilik Project (Opsional) --</option>
                  {eligibleAccounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.email} — {a.fullName} (ID: {a.id.slice(0, 16)}...)
                    </option>
                  ))}
                </select>
              </div>

              {/* Initial Pre-seed Liquidity */}
              <div className="p-4 rounded-xl bg-[#0E1016] border border-[#292C38] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-[#F5F5F7] block">
                      Injeksi Likuiditas Pre-Seed Awal ke Akun MM
                    </label>
                    <span className="text-[11px] text-[#969BA8]">
                      Alokasi token dan modal quote untuk meletakkan order depth awal di order book.
                    </span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono font-bold">
                    PRE-SEED CAPITAL
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Base Token Injection */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-[#969BA8]">
                        Injeksi Token ({wizardData.symbol || 'Base'} Units):
                      </label>
                      <span className="text-[11px] font-mono font-bold text-blue-400">
                        Setara: {(Number(wizardData.initialLiquidityBase || 0) / Math.pow(10, wizardData.decimals || 8)).toLocaleString('id-ID', { maximumFractionDigits: wizardData.decimals || 8 })} {wizardData.symbol || 'Token'}
                      </span>
                    </div>
                    <Input
                      value={wizardData.initialLiquidityBase}
                      onChange={e => setWizardData({ ...wizardData, initialLiquidityBase: e.target.value })}
                      placeholder="1000000000"
                    />
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className="text-[10px] text-[#686D7A]">Preset:</span>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, initialLiquidityBase: (100n * (10n ** BigInt(wizardData.decimals || 8))).toString() })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        100 {wizardData.symbol || 'Token'}
                      </button>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, initialLiquidityBase: (1000n * (10n ** BigInt(wizardData.decimals || 8))).toString() })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        1.000 {wizardData.symbol || 'Token'}
                      </button>
                      <button type="button" onClick={() => setWizardData({ ...wizardData, initialLiquidityBase: (100000n * (10n ** BigInt(wizardData.decimals || 8))).toString() })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                        100.000 {wizardData.symbol || 'Token'}
                      </button>
                    </div>
                  </div>

                  {/* Quote Currency Injection */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-[#969BA8]">
                        Injeksi Modal {wizardData.quoteCurrency} ({wizardData.quoteCurrency === 'USDT' ? 'Units' : 'Sen'}):
                      </label>
                      <span className="text-[11px] font-mono font-bold text-blue-400">
                        Setara: {wizardData.quoteCurrency === 'USDT' 
                          ? `$${(Number(wizardData.initialLiquidityQuoteIdr || 0) / 1000000).toLocaleString('id-ID')} USDT` 
                          : `Rp ${(Number(wizardData.initialLiquidityQuoteIdr || 0) / 100).toLocaleString('id-ID')}`}
                      </span>
                    </div>
                    <Input
                      value={wizardData.initialLiquidityQuoteIdr}
                      onChange={e => setWizardData({ ...wizardData, initialLiquidityQuoteIdr: e.target.value })}
                      placeholder={wizardData.quoteCurrency === 'USDT' ? '50000000000' : '5000000000'}
                    />
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className="text-[10px] text-[#686D7A]">Preset:</span>
                      {wizardData.quoteCurrency === 'USDT' ? (
                        <>
                          <button type="button" onClick={() => setWizardData({ ...wizardData, initialLiquidityQuoteIdr: '5000000000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                            $5,000 USDT
                          </button>
                          <button type="button" onClick={() => setWizardData({ ...wizardData, initialLiquidityQuoteIdr: '25000000000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                            $25,000 USDT
                          </button>
                          <button type="button" onClick={() => setWizardData({ ...wizardData, initialLiquidityQuoteIdr: '50000000000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                            $50,000 USDT
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => setWizardData({ ...wizardData, initialLiquidityQuoteIdr: '1000000000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                            Rp 10 Juta
                          </button>
                          <button type="button" onClick={() => setWizardData({ ...wizardData, initialLiquidityQuoteIdr: '5000000000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                            Rp 50 Juta
                          </button>
                          <button type="button" onClick={() => setWizardData({ ...wizardData, initialLiquidityQuoteIdr: '10000000000' })} className="px-2 py-0.5 rounded text-[10px] bg-[#1E2230] hover:bg-[#2A2E3D] text-[#969BA8] hover:text-white">
                            Rp 100 Juta
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Fee & Limits with Real-Time Token Converter */}
              <div className="pt-2 border-t border-[#292C38] space-y-3">
                <div className="p-3 rounded-lg bg-[#0E1016] border border-blue-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>💡</span> Konverter Kuantitas Order (Bebas Bingung Angka Integer / Nol)
                    </span>
                    <span className="text-[11px] text-[#969BA8] block">
                      Token ini memiliki <strong>{wizardData.decimals} desimal</strong> (1 {wizardData.symbol || 'TOKEN'} = {Math.pow(10, wizardData.decimals).toLocaleString('id-ID')} unit atomik).
                    </span>
                  </div>
                  <div className="flex gap-1.5 bg-[#171923] p-1 rounded border border-[#292C38] self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setWizardData({ ...wizardData, limitInputMode: 'TOKENS' })}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                        wizardData.limitInputMode === 'TOKENS' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      🪙 Jumlah Token
                    </button>
                    <button
                      type="button"
                      onClick={() => setWizardData({ ...wizardData, limitInputMode: 'ATOMIC' })}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                        wizardData.limitInputMode === 'ATOMIC' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      🔢 Integer BigInt
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Min Order */}
                  <div>
                    <label className="text-xs text-[#969BA8] block mb-1">
                      Min Order Quantity {wizardData.limitInputMode === 'TOKENS' ? `(${wizardData.symbol || 'Tokens'})` : '(Satuan Atomik BigInt)'}:
                    </label>
                    {wizardData.limitInputMode === 'TOKENS' ? (
                      <div>
                        <Input
                          type="number"
                          step="any"
                          value={wizardData.minTokens}
                          onChange={e => {
                            const val = e.target.value;
                            const dec = wizardData.decimals || 8;
                            let atomic = '100000000';
                            try {
                              const [intP, fracP = ''] = val.split('.');
                              atomic = (BigInt(intP || '0') * (10n ** BigInt(dec)) + BigInt((fracP.slice(0, dec).padEnd(dec, '0')) || '0')).toString();
                            } catch {}
                            setWizardData({ ...wizardData, minTokens: val, minQuantity: atomic });
                          }}
                          placeholder="Contoh: 1"
                        />
                        <span className="text-[10px] text-emerald-400 mt-1 block font-mono">
                          = {Number(wizardData.minQuantity || 0).toLocaleString('id-ID')} unit atomik
                        </span>
                      </div>
                    ) : (
                      <div>
                        <Input
                          value={wizardData.minQuantity}
                          onChange={e => {
                            const val = e.target.value;
                            const dec = wizardData.decimals || 8;
                            let tok = '1';
                            try {
                              const b = BigInt(val || '0');
                              const div = 10n ** BigInt(dec);
                              tok = (Number(b) / Number(div)).toString();
                            } catch {}
                            setWizardData({ ...wizardData, minQuantity: val, minTokens: tok });
                          }}
                        />
                        <span className="text-[10px] text-emerald-400 mt-1 block font-mono">
                          = {wizardData.minTokens} {wizardData.symbol || 'Tokens'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Max Order */}
                  <div>
                    <label className="text-xs text-[#969BA8] block mb-1">
                      Max Order Quantity {wizardData.limitInputMode === 'TOKENS' ? `(${wizardData.symbol || 'Tokens'})` : '(Satuan Atomik BigInt)'}:
                    </label>
                    {wizardData.limitInputMode === 'TOKENS' ? (
                      <div>
                        <Input
                          type="number"
                          step="any"
                          value={wizardData.maxTokens}
                          onChange={e => {
                            const val = e.target.value;
                            const dec = wizardData.decimals || 8;
                            let atomic = '1000000000000000';
                            try {
                              const [intP, fracP = ''] = val.split('.');
                              atomic = (BigInt(intP || '0') * (10n ** BigInt(dec)) + BigInt((fracP.slice(0, dec).padEnd(dec, '0')) || '0')).toString();
                            } catch {}
                            setWizardData({ ...wizardData, maxTokens: val, maxQuantity: atomic });
                          }}
                          placeholder="Contoh: 10000000"
                        />
                        <span className="text-[10px] text-blue-400 mt-1 block font-mono">
                          = {Number(wizardData.maxQuantity || 0).toLocaleString('id-ID')} unit atomik
                        </span>
                      </div>
                    ) : (
                      <div>
                        <Input
                          value={wizardData.maxQuantity}
                          onChange={e => {
                            const val = e.target.value;
                            const dec = wizardData.decimals || 8;
                            let tok = '10000000';
                            try {
                              const b = BigInt(val || '0');
                              const div = 10n ** BigInt(dec);
                              tok = (Number(b) / Number(div)).toString();
                            } catch {}
                            setWizardData({ ...wizardData, maxQuantity: val, maxTokens: tok });
                          }}
                        />
                        <span className="text-[10px] text-blue-400 mt-1 block font-mono">
                          = {wizardData.maxTokens} {wizardData.symbol || 'Tokens'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[#969BA8] block mb-1">
                    Min Notional ({wizardData.quoteCurrency} Units, {wizardData.quoteCurrency === 'USDT' ? '5000000 = 5 USDT' : '1000000 = Rp 10.000'}):
                  </label>
                  <Input
                    value={wizardData.minNotional}
                    onChange={e => setWizardData({ ...wizardData, minNotional: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#969BA8] block mb-1">Maker Fee (bps, 10 = 0.10%):</label>
                  <Input
                    type="number"
                    value={wizardData.makerFeeBps.toString()}
                    onChange={e => setWizardData({ ...wizardData, makerFeeBps: parseInt(e.target.value, 10) || 10 })}
                  />
                </div>
                <div>
                  <label className="text-xs text-[#969BA8] block mb-1">Taker Fee (bps, 20 = 0.20%):</label>
                  <Input
                    type="number"
                    value={wizardData.takerFeeBps.toString()}
                    onChange={e => setWizardData({ ...wizardData, takerFeeBps: parseInt(e.target.value, 10) || 20 })}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-[#969BA8] block mb-1">Waktu Aktivasi Terjadwal (Opsional):</label>
                <Input
                  type="datetime-local"
                  value={wizardData.scheduledAt}
                  onChange={e => setWizardData({ ...wizardData, scheduledAt: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* STEP 5: Review Summary */}
          {wizardStep === 5 && (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-[#F5F5F7]">Step 5: Ringkasan & Verifikasi Invariant</h3>
              <div className="p-4 rounded-lg bg-[#0E1016] border border-[#292C38] space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-[#686D7A]">Trading Pair:</span>
                  <span className="text-[#F5F5F7] font-bold">{wizardData.symbol}-{wizardData.quoteCurrency}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#686D7A]">Quote Currency:</span>
                  <span className="text-[#00C087] font-bold">{wizardData.quoteCurrency}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#686D7A]">Aset / Jaringan:</span>
                  <span className="text-[#F5F5F7]">{wizardData.name} ({wizardData.network})</span>
                </div>
                {wizardData.contractAddress && (
                  <div className="flex justify-between">
                    <span className="text-[#686D7A]">Kontrak:</span>
                    <span className="text-[#F5F5F7] truncate max-w-xs">{wizardData.contractAddress}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#686D7A]">Jadwal Deposit:</span>
                  <span className={wizardData.depositEnabled ? "text-[#00C087] font-bold" : "text-[#EB3458]"}>
                    {wizardData.depositEnabled 
                      ? (wizardData.depositOpenMode === 'SCHEDULED' && wizardData.depositOpenedAt ? `Terjadwal (${wizardData.depositOpenedAt})` : 'Buka Langsung (Immediate)')
                      : 'Ditutup'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#686D7A]">Jadwal Withdrawal:</span>
                  <span className={wizardData.withdrawalEnabled ? "text-[#00C087] font-bold" : "text-[#EB3458]"}>
                    {wizardData.withdrawalEnabled 
                      ? (wizardData.withdrawalOpenMode === 'SCHEDULED' && wizardData.withdrawalOpenedAt ? `Terjadwal (${wizardData.withdrawalOpenedAt})` : 'Buka Langsung (Immediate)')
                      : 'Ditutup'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#686D7A]">Akun Market Maker (MM):</span>
                  <span className="text-[#5B9DFF] font-bold">
                    {eligibleAccounts.find(a => a.id === wizardData.marketMakerAccountId)?.email || wizardData.marketMakerAccountId}
                  </span>
                </div>
                {wizardData.projectOwnerAccountId && (
                  <div className="flex justify-between">
                    <span className="text-[#686D7A]">Akun Trader Project:</span>
                    <span className="text-[#00C087] font-bold">
                      {eligibleAccounts.find(a => a.id === wizardData.projectOwnerAccountId)?.email || wizardData.projectOwnerAccountId}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#686D7A]">Tick Size:</span>
                  <span className="text-[#00C087] font-bold">{wizardData.tickSize} sen</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#686D7A]">Lot Size:</span>
                  <span className="text-[#F5F5F7]">{wizardData.lotSize} base units</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#686D7A]">Fee Structure:</span>
                  <span className="text-[#F5F5F7]">Maker: {wizardData.makerFeeBps} bps | Taker: {wizardData.takerFeeBps} bps</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#686D7A]">Maker Admin Identity:</span>
                  <span className="text-[#EB3458] font-bold">{currentUser?.email}</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#5B9DFF]/10 border border-[#5B9DFF]/30 text-xs text-[#5B9DFF]">
                <strong>Prinsip Maker-Checker:</strong> Setelah draft dibuat dan diajukan, Checker admin lain harus memverifikasi parameter deposit, withdrawal, dan akun MM sebelum persetujuan final.
              </div>
            </div>
          )}

          {/* STEP 6: Submit */}
          {wizardStep === 6 && (
            <div className="space-y-4 text-center py-4">
              <CheckCircle2 className="w-12 h-12 text-[#00C087] mx-auto mb-2" />
              <h3 className="text-lg font-bold text-[#F5F5F7]">Konfirmasi Pembuatan Listing</h3>
              <p className="text-xs text-[#969BA8] max-w-md mx-auto">
                Sistem akan memvalidasi parameter dan menyimpannya sebagai DRAFT. Semua perubahan akan dicatat dalam audit trail kriptografis.
              </p>
              <div className="pt-4">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleCompleteWizard}
                >
                  Simpan Draft Listing
                </Button>
              </div>
            </div>
          )}

          {/* Wizard Controls */}
          <div className="flex items-center justify-between pt-4 border-t border-[#292C38]">
            <Button
              variant="outline"
              size="sm"
              disabled={wizardStep === 1}
              onClick={() => setWizardStep(wizardStep - 1)}
            >
              Kembali
            </Button>

            {wizardStep < 6 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  if (wizardStep === 1) {
                    if (!wizardData.symbol) {
                      showToast('warning', 'Simbol aset wajib diisi');
                      return;
                    }
                  }
                  setWizardStep(wizardStep + 1);
                }}
              >
                Lanjut
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 7. MODAL: APPROVE CONFIRMATION */}
      {showApproveModal && selectedListing && (
        <Modal
          isOpen={showApproveModal}
          onClose={() => setShowApproveModal(false)}
          title={`Persetujuan Listing: ${selectedListing.symbol}`}
        >
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-[#5B9DFF]/10 border border-[#5B9DFF]/30 text-xs text-[#5B9DFF]">
              Anda bertindak sebagai <strong>Checker</strong> untuk listing versi <strong>v{selectedListing.version}</strong> yang dibuat oleh <strong>{selectedListing.creatorEmail}</strong>.
            </div>

            {/* Checker Parameter Verification Card */}
            <div className="p-3 rounded-lg bg-[#0E1016] border border-[#292C38] text-xs font-mono space-y-1.5">
              <span className="text-[10px] text-[#686D7A] uppercase font-bold block mb-1">Verifikasi Parameter Likuiditas & Akun:</span>
              <div className="flex justify-between">
                <span className="text-[#969BA8]">Akun Market Maker (MM):</span>
                <span className="text-[#5B9DFF] font-bold">{selectedListing.marketMakerEmail || selectedListing.marketMakerAccountId || 'mm@dimonex.id'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#969BA8]">Akun Trader Project:</span>
                <span className="text-[#00C087] font-bold">{selectedListing.projectOwnerEmail || selectedListing.projectOwnerAccountId || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#969BA8]">Jalur Deposit:</span>
                <span className={selectedListing.depositStatus === 'OPEN' ? "text-[#00C087] font-bold" : "text-[#EB3458]"}>
                  {selectedListing.depositStatus || 'OPEN'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#969BA8]">Jalur Withdrawal:</span>
                <span className={selectedListing.withdrawalStatus === 'OPEN' ? "text-[#00C087] font-bold" : "text-[#EB3458]"}>
                  {selectedListing.withdrawalStatus || 'OPEN'}
                </span>
              </div>
            </div>

            <div>
              <label className="text-xs text-[#969BA8] block mb-1">
                Alasan Persetujuan (Mandatori minimal 5 karakter):
              </label>
              <textarea
                value={reviewReason}
                onChange={e => setReviewReason(e.target.value)}
                placeholder="Contoh: Audit kontrak terverifikasi, likuiditas awal siap, dan uji stres matching engine berhasil."
                rows={3}
                className="w-full bg-[#0E1016] border border-[#292C38] rounded-lg p-2.5 text-xs text-[#F5F5F7] outline-none focus:border-[#EB3458]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowApproveModal(false)}>
                Batal
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={isSubmittingReview}
                onClick={handleApprove}
              >
                Konfirmasi Setuju (Approve)
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 8. MODAL: REJECT CONFIRMATION */}
      {showRejectModal && selectedListing && (
        <Modal
          isOpen={showRejectModal}
          onClose={() => setShowRejectModal(false)}
          title={`Penolakan Listing: ${selectedListing.symbol}`}
        >
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-[#EB3458]/10 border border-[#EB3458]/30 text-xs text-[#EB3458]">
              Tindakan ini akan menolak listing dan mencatat alasan penolakan dalam audit trail permanen.
            </div>

            <div>
              <label className="text-xs text-[#969BA8] block mb-1">
                Alasan Penolakan (Mandatori minimal 5 karakter):
              </label>
              <textarea
                value={reviewReason}
                onChange={e => setReviewReason(e.target.value)}
                placeholder="Contoh: Kontrak token belum diaudit oleh auditor independen terpercaya."
                rows={3}
                className="w-full bg-[#0E1016] border border-[#292C38] rounded-lg p-2.5 text-xs text-[#F5F5F7] outline-none focus:border-[#EB3458]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowRejectModal(false)}>
                Batal
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={isSubmittingReview}
                onClick={handleReject}
              >
                Konfirmasi Tolak (Reject)
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* 9. DRAWER / MODAL: DETAIL LISTING & AUDIT TRAIL */}
      {showDetailModal && selectedListing && (
        <Modal
          isOpen={showDetailModal}
          onClose={() => setShowDetailModal(false)}
          title={`Listing Detail & Manajemen Likuiditas: ${selectedListing.symbol}`}
        >
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1 text-xs font-mono">
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[#0E1016] border border-[#292C38]">
              <div>
                <span className="text-[#686D7A] block">Listing ID:</span>
                <span className="text-white truncate block">{selectedListing.id}</span>
              </div>
              <div>
                <span className="text-[#686D7A] block">Status:</span>
                <div>{renderStatusBadge(selectedListing.status)}</div>
              </div>
              <div>
                <span className="text-[#686D7A] block">Maker Admin:</span>
                <span className="text-[#EB3458] font-bold block">{selectedListing.creatorEmail}</span>
              </div>
              <div>
                <span className="text-[#686D7A] block">Checker Admin:</span>
                <span className="text-[#5B9DFF] font-bold block">{selectedListing.approval?.reviewerEmail || '-'}</span>
              </div>
              <div>
                <span className="text-[#686D7A] block">Akun Market Maker (MM):</span>
                <span className="text-[#5B9DFF] font-bold block truncate" title={selectedListing.marketMakerEmail}>
                  {selectedListing.marketMakerEmail || selectedListing.marketMakerAccountId || 'mm@dimonex.id'}
                </span>
              </div>
              <div>
                <span className="text-[#686D7A] block">Akun Trader Project:</span>
                <span className="text-[#00C087] font-bold block truncate" title={selectedListing.projectOwnerEmail}>
                  {selectedListing.projectOwnerEmail || selectedListing.projectOwnerAccountId || '-'}
                </span>
              </div>
            </div>

            {/* Deposit & Withdrawal Status and Toggle Controls */}
            <div className="p-3 rounded-lg bg-[#0E1016] border border-[#292C38] space-y-3">
              <h4 className="text-xs font-bold text-[#F5F5F7] font-sans flex items-center justify-between">
                <span>Status Deposit & Withdrawal Token</span>
                <span className="text-[10px] text-[#686D7A]">Live Control</span>
              </h4>

              <div className="grid grid-cols-2 gap-3">
                {/* Deposit status card */}
                <div className="p-2.5 rounded bg-[#15171F] border border-[#292C38] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[#969BA8]">Jalur Deposit:</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      selectedListing.depositStatus === 'OPEN' ? 'bg-[#00C087]/20 text-[#00C087]' : 'bg-[#EB3458]/20 text-[#EB3458]'
                    }`}>
                      {selectedListing.depositStatus || 'OPEN'}
                    </span>
                  </div>
                  {selectedListing.depositOpenedAt && (
                    <span className="text-[10px] text-[#686D7A] block">
                      Buka: {new Date(selectedListing.depositOpenedAt).toLocaleString()}
                    </span>
                  )}
                  <button
                    onClick={() => {
                      handleToggleDeposit(selectedListing.id, selectedListing.depositStatus === 'OPEN');
                      setShowDetailModal(false);
                    }}
                    className="w-full py-1 text-[11px] rounded bg-[#292C38] hover:bg-[#EB3458]/20 hover:text-[#EB3458] text-[#F5F5F7] font-sans font-semibold transition-colors"
                  >
                    {selectedListing.depositStatus === 'OPEN' ? 'Tutup Jalur Deposit' : 'Buka Jalur Deposit'}
                  </button>
                </div>

                {/* Withdrawal status card */}
                <div className="p-2.5 rounded bg-[#15171F] border border-[#292C38] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[#969BA8]">Jalur Withdrawal:</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      selectedListing.withdrawalStatus === 'OPEN' ? 'bg-[#00C087]/20 text-[#00C087]' : 'bg-[#EB3458]/20 text-[#EB3458]'
                    }`}>
                      {selectedListing.withdrawalStatus || 'OPEN'}
                    </span>
                  </div>
                  {selectedListing.withdrawalOpenedAt && (
                    <span className="text-[10px] text-[#686D7A] block">
                      Buka: {new Date(selectedListing.withdrawalOpenedAt).toLocaleString()}
                    </span>
                  )}
                  <button
                    onClick={() => {
                      handleToggleWithdraw(selectedListing.id, selectedListing.withdrawalStatus === 'OPEN');
                      setShowDetailModal(false);
                    }}
                    className="w-full py-1 text-[11px] rounded bg-[#292C38] hover:bg-[#EB3458]/20 hover:text-[#EB3458] text-[#F5F5F7] font-sans font-semibold transition-colors"
                  >
                    {selectedListing.withdrawalStatus === 'OPEN' ? 'Tutup Jalur Withdrawal' : 'Buka Jalur Withdrawal'}
                  </button>
                </div>
              </div>
            </div>

            {/* Cryptographic Audit Events */}
            <div className="pt-2">
              <h4 className="text-xs font-bold text-[#F5F5F7] font-sans mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-[#EB3458]" />
                Cryptographic Audit Trail (SHA-256 Hash Chain)
              </h4>
              <div className="space-y-2">
                {(!selectedListing.auditEvents || selectedListing.auditEvents.length === 0) ? (
                  <span className="text-[#686D7A] block text-center py-4">Belum ada audit event tersimpan.</span>
                ) : (
                  selectedListing.auditEvents.map((evt: any) => (
                    <div key={evt.id} className="p-2.5 rounded bg-[#0E1016] border border-[#292C38] space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[#EB3458]">{evt.eventType}</span>
                        <span className="text-[#686D7A]">{new Date(evt.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="text-[10px] text-[#969BA8]">{evt.reason}</div>
                      <div className="text-[9px] text-[#686D7A] truncate font-mono">
                        Hash: {evt.currentHash?.slice(0, 16)}... | Prev: {evt.previousHash?.slice(0, 16)}...
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* 8. MODAL: EDIT TOKEN LIMIT & TRADING CONFIG */}
      {showTokenEditModal && selectedPairForEdit && (
        <Modal
          isOpen={showTokenEditModal}
          onClose={() => setShowTokenEditModal(false)}
          title={`Edit Parameter & Limit: ${tokenEditForm.pairId}`}
        >
          <div className="space-y-5 text-xs text-[#F5F5F7]">
            {/* Info Box */}
            <div className="p-3.5 rounded-lg bg-[#0E1016] border border-blue-500/30 space-y-1.5">
              <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                <Info className="w-4 h-4" />
                Spesifikasi Presisi Token {tokenEditForm.baseCurrency}
              </span>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Token ini menggunakan <strong>{tokenEditForm.baseDecimals} desimal</strong> (1 {tokenEditForm.baseCurrency} = {Math.pow(10, tokenEditForm.baseDecimals).toLocaleString('id-ID')} unit terkecil).
                Untuk mencegah bot MM ditolak saat menempatkan order berulang, pastikan kuantitas maksimum cukup besar (misal: 10.000.000 token).
              </p>
            </div>

            {/* Input Mode Switcher */}
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#15171F] border border-[#292C38]">
              <span className="text-xs font-semibold text-white">Mode Pengisian Limit:</span>
              <div className="flex gap-1.5 bg-[#0E1016] p-1 rounded border border-[#292C38]">
                <button
                  type="button"
                  onClick={() => setTokenEditForm(prev => ({ ...prev, inputMode: 'TOKENS' }))}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                    tokenEditForm.inputMode === 'TOKENS' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  🪙 Jumlah Token (Human)
                </button>
                <button
                  type="button"
                  onClick={() => setTokenEditForm(prev => ({ ...prev, inputMode: 'ATOMIC' }))}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                    tokenEditForm.inputMode === 'ATOMIC' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  🔢 Unit Atomik (BigInt)
                </button>
              </div>
            </div>

            {/* 1-Click Presets */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-[#969BA8] block">Preset Cepat Batas Order:</span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => applyTokenLimitPreset('STANDARD')}
                  className="p-2 rounded bg-[#0E1016] border border-[#292C38] hover:border-blue-500 text-left transition-colors"
                >
                  <span className="text-[11px] font-bold text-white block">Standar (1 - 10M)</span>
                  <span className="text-[10px] text-[#686D7A]">Cocok untuk altcoin/token umum</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyTokenLimitPreset('MEME')}
                  className="p-2 rounded bg-[#0E1016] border border-[#292C38] hover:border-blue-500 text-left transition-colors"
                >
                  <span className="text-[11px] font-bold text-white block">Meme (100 - 1B)</span>
                  <span className="text-[10px] text-[#686D7A]">Suplai besar (DOGE, SHIB)</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyTokenLimitPreset('HIGH_VALUE')}
                  className="p-2 rounded bg-[#0E1016] border border-[#292C38] hover:border-blue-500 text-left transition-colors"
                >
                  <span className="text-[11px] font-bold text-white block">High-Value (0.0001 - 100)</span>
                  <span className="text-[10px] text-[#686D7A]">Aset mahal (BTC, ETH)</span>
                </button>
              </div>
            </div>

            {/* Min and Max Order Quantity Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#969BA8] block mb-1">
                  Kuantitas Minimum Order {tokenEditForm.inputMode === 'TOKENS' ? `(${tokenEditForm.baseCurrency})` : '(Unit Atomik)'}:
                </label>
                {tokenEditForm.inputMode === 'TOKENS' ? (
                  <Input
                    type="number"
                    step="any"
                    value={tokenEditForm.minOrderTokens}
                    onChange={e => {
                      const val = e.target.value;
                      const dec = tokenEditForm.baseDecimals || 8;
                      let atomic = '0';
                      try {
                        const [intP, fracP = ''] = val.split('.');
                        atomic = (BigInt(intP || '0') * (10n ** BigInt(dec)) + BigInt((fracP.slice(0, dec).padEnd(dec, '0')) || '0')).toString();
                      } catch {}
                      setTokenEditForm(prev => ({ ...prev, minOrderTokens: val, minOrderSize: atomic }));
                    }}
                    placeholder="1"
                  />
                ) : (
                  <Input
                    value={tokenEditForm.minOrderSize}
                    onChange={e => {
                      const val = e.target.value;
                      const dec = tokenEditForm.baseDecimals || 8;
                      let tok = '0';
                      try {
                        tok = (Number(BigInt(val || '0')) / Number(10n ** BigInt(dec))).toString();
                      } catch {}
                      setTokenEditForm(prev => ({ ...prev, minOrderSize: val, minOrderTokens: tok }));
                    }}
                    placeholder="100000000"
                  />
                )}
                <div className="mt-1 text-[10px] text-blue-400 font-mono">
                  Konversi: {tokenEditForm.inputMode === 'TOKENS' ? `${tokenEditForm.minOrderSize} unit atomik` : `${tokenEditForm.minOrderTokens} ${tokenEditForm.baseCurrency}`}
                </div>
              </div>

              <div>
                <label className="text-xs text-[#969BA8] block mb-1">
                  Kuantitas Maksimum Order {tokenEditForm.inputMode === 'TOKENS' ? `(${tokenEditForm.baseCurrency})` : '(Unit Atomik)'}:
                </label>
                {tokenEditForm.inputMode === 'TOKENS' ? (
                  <Input
                    type="number"
                    step="any"
                    value={tokenEditForm.maxOrderTokens}
                    onChange={e => {
                      const val = e.target.value;
                      const dec = tokenEditForm.baseDecimals || 8;
                      let atomic = '0';
                      try {
                        const [intP, fracP = ''] = val.split('.');
                        atomic = (BigInt(intP || '0') * (10n ** BigInt(dec)) + BigInt((fracP.slice(0, dec).padEnd(dec, '0')) || '0')).toString();
                      } catch {}
                      setTokenEditForm(prev => ({ ...prev, maxOrderTokens: val, maxOrderSize: atomic }));
                    }}
                    placeholder="10000000"
                  />
                ) : (
                  <Input
                    value={tokenEditForm.maxOrderSize}
                    onChange={e => {
                      const val = e.target.value;
                      const dec = tokenEditForm.baseDecimals || 8;
                      let tok = '0';
                      try {
                        tok = (Number(BigInt(val || '0')) / Number(10n ** BigInt(dec))).toString();
                      } catch {}
                      setTokenEditForm(prev => ({ ...prev, maxOrderSize: val, maxOrderTokens: tok }));
                    }}
                    placeholder="1000000000000000"
                  />
                )}
                <div className="mt-1 text-[10px] text-blue-400 font-mono">
                  Konversi: {tokenEditForm.inputMode === 'TOKENS' ? `${tokenEditForm.maxOrderSize} unit atomik` : `${tokenEditForm.maxOrderTokens} ${tokenEditForm.baseCurrency}`}
                </div>
              </div>
            </div>

            {/* Fee Settings */}
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[#292C38]">
              <div>
                <label className="text-xs text-[#969BA8] block mb-1">Maker Fee (bps):</label>
                <Input
                  type="number"
                  value={tokenEditForm.makerFeeBps}
                  onChange={e => setTokenEditForm(prev => ({ ...prev, makerFeeBps: Number(e.target.value) }))}
                  placeholder="10"
                />
                <span className="text-[10px] text-[#686D7A] block mt-0.5">
                  Setara {(Number(tokenEditForm.makerFeeBps || 0) / 100).toFixed(2)}%
                </span>
              </div>

              <div>
                <label className="text-xs text-[#969BA8] block mb-1">Taker Fee (bps):</label>
                <Input
                  type="number"
                  value={tokenEditForm.takerFeeBps}
                  onChange={e => setTokenEditForm(prev => ({ ...prev, takerFeeBps: Number(e.target.value) }))}
                  placeholder="20"
                />
                <span className="text-[10px] text-[#686D7A] block mt-0.5">
                  Setara {(Number(tokenEditForm.takerFeeBps || 0) / 100).toFixed(2)}%
                </span>
              </div>
            </div>

            {/* Trading Status Toggle */}
            <div className="p-3 rounded-lg bg-[#0E1016] border border-[#292C38] flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-white block">Status Operasional Pasar</span>
                <span className="text-[11px] text-[#969BA8]">
                  {tokenEditForm.isHalted ? 'Pasar dihentikan sementara (Order ditolak matching engine)' : 'Pasar aktif dapat menerima order transaksi'}
                </span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold">
                <input
                  type="checkbox"
                  checked={tokenEditForm.isHalted}
                  onChange={e => setTokenEditForm(prev => ({ ...prev, isHalted: e.target.checked }))}
                  className="accent-[#EB3458] w-4 h-4"
                />
                <span className={tokenEditForm.isHalted ? 'text-amber-400' : 'text-emerald-400'}>
                  {tokenEditForm.isHalted ? 'HALTED' : 'ACTIVE'}
                </span>
              </label>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 pt-3 border-t border-[#292C38]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTokenEditModal(false)}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={isSavingTokenConfig}
                onClick={handleSaveTokenConfig}
              >
                {isSavingTokenConfig ? 'Menyimpan...' : 'Simpan Konfigurasi Limit'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
