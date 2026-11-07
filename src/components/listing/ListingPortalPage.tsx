/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/listing/ListingPortalPage.tsx
 * DIMONEX Centralized Cryptocurrency Spot Exchange — Master Listing Page / Portal.
 * Features:
 * 1. Explore Listed Tokens & Markets (Direct Spot trade CTA)
 * 2. Public Project Token Listing Application Wizard
 * 3. Application Tracker with 4-Stage Maker-Checker Progress Visualization
 * 4. Internal Admin & Maker-Checker Initial Listing Console (ListingManagementView)
 * 5. Quick Role Switcher (Trader, Maker Admin, Checker Admin) for testing governance
 */

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Rocket,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Search,
  ExternalLink,
  Layers,
  ArrowRight,
  TrendingUp,
  AlertCircle,
  FileCheck2,
  Users,
  Copy,
  Check,
  Cpu,
  Lock,
  ChevronRight,
  Info
} from 'lucide-react';
import { UserProfile, TradingPairItem } from '../../types/index.js';
import { ListingManagementView } from '../admin/listing/ListingManagementView.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Modal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { formatIDR } from '../../lib/formatters.js';

interface Props {
  user: UserProfile | null;
  tradingPairs: TradingPairItem[];
  onSelectPair: (pairId: string) => void;
  onSelectView: (view: any) => void;
  onQuickLogin: (email: string, pass: string) => void;
  onOpenAuthModal: () => void;
}

export const ListingPortalPage: React.FC<Props> = ({
  user,
  tradingPairs,
  onSelectPair,
  onSelectView,
  onQuickLogin,
  onOpenAuthModal
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'EXPLORE' | 'APPLY' | 'TRACK' | 'ADMIN_CONSOLE'>('EXPLORE');

  // Explore tab state
  const [publicAssets, setPublicAssets] = useState<any[]>([]);
  const [exploreSearch, setExploreSearch] = useState('');
  const [isLoadingAssets, setIsLoadingAssets] = useState(false);

  // Application form state
  const [formData, setFormData] = useState({
    tokenName: '',
    tokenSymbol: '',
    network: 'ETHEREUM',
    contractAddress: '',
    decimals: 18,
    projectWebsite: '',
    whitepaperUrl: '',
    contactEmail: '',
    telegramHandle: '',
    quoteCurrency: 'USDT' as 'USDT' | 'IDR',
    expectedInitialPriceIdr: '1.00',
    initialLiquidityCommitmentIdr: '25000',
    description: '',
    projectOwnerAccountId: '',
    depositScheduleType: 'IMMEDIATE' as 'IMMEDIATE' | 'SCHEDULED',
    depositOpenedAtDate: '',
    withdrawalScheduleType: 'IMMEDIATE' as 'IMMEDIATE' | 'SCHEDULED',
    withdrawalOpenedAtDate: ''
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmittingApp, setIsSubmittingApp] = useState(false);
  const [submittedResult, setSubmittedResult] = useState<any | null>(null);

  // Tracker state
  const [trackingQuery, setTrackingQuery] = useState('');
  const [trackingResult, setTrackingResult] = useState<any | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  // Load public assets
  useEffect(() => {
    loadPublicAssets();
  }, []);

  const loadPublicAssets = async () => {
    setIsLoadingAssets(true);
    try {
      const res = await fetch('/api/listing/public-list');
      if (res.ok) {
        const json = await res.json();
        if (json.assets) {
          setPublicAssets(json.assets);
        }
      }
    } catch {
      // Fallback: populate from current trading pairs
      const fallback = tradingPairs.map(p => ({
        id: p.id,
        symbol: p.baseCurrency,
        name: p.baseCurrency === 'BTC' ? 'Bitcoin' : p.baseCurrency === 'ETH' ? 'Ethereum' : p.baseCurrency,
        assetType: 'TOKEN',
        network: 'MAINNET',
        status: 'ACTIVE',
        hasActiveMarket: true,
        marketSymbol: p.id
      }));
      setPublicAssets(fallback);
    } finally {
      setIsLoadingAssets(false);
    }
  };

  // Address validation
  const validateAddress = (net: string, addr: string): boolean => {
    if (!addr) return false;
    const n = net.toUpperCase();
    if (n.includes('ETHEREUM') || n.includes('ERC20') || n.includes('BSC') || n.includes('POLYGON') || n.includes('ARBITRUM')) {
      return /^0x[a-fA-F0-9]{40}$/.test(addr);
    }
    if (n.includes('SOLANA') || n.includes('SPL')) {
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
    }
    if (n.includes('TRON') || n.includes('TRC20')) {
      return /^T[a-km-zA-HJ-NP-Z1-9]{33}$/.test(addr);
    }
    return addr.length >= 26;
  };

  // Submit Application
  const handleSubmitApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};

    if (!formData.tokenName.trim()) errors.tokenName = 'Nama token wajib diisi.';
    if (!formData.tokenSymbol.trim()) errors.tokenSymbol = 'Simbol token wajib diisi.';
    else if (!/^[A-Za-z0-9]{2,12}$/.test(formData.tokenSymbol)) {
      errors.tokenSymbol = 'Simbol harus 2-12 karakter alfanumerik.';
    }

    if (!formData.contractAddress.trim()) {
      errors.contractAddress = 'Alamat smart contract wajib diisi.';
    } else if (!validateAddress(formData.network, formData.contractAddress)) {
      errors.contractAddress = `Format alamat smart contract tidak valid untuk jaringan ${formData.network}.`;
    }

    if (!formData.contactEmail.trim() || !formData.contactEmail.includes('@')) {
      errors.contactEmail = 'Email resmi kontak project wajib diisi dengan format valid.';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      showToast('error', 'Form Tidak Lengkap', 'Periksa kembali form pendaftaran listing Anda.');
      return;
    }

    setFormErrors({});
    setIsSubmittingApp(true);

    try {
      const payload = {
        ...formData,
        depositOpenedAt: formData.depositScheduleType === 'SCHEDULED' && formData.depositOpenedAtDate ? new Date(formData.depositOpenedAtDate).getTime() : undefined,
        withdrawalOpenedAt: formData.withdrawalScheduleType === 'SCHEDULED' && formData.withdrawalOpenedAtDate ? new Date(formData.withdrawalOpenedAtDate).getTime() : undefined,
        depositEnabled: true,
        withdrawalEnabled: true
      };

      const res = await fetch('/api/listing/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Gagal mengajukan listing');
      }

      setSubmittedResult(json.data);
      showToast('success', 'Pengajuan Terkirim', 'Pengajuan token listing berhasil dikirim ke Komite Listing DIMONEX!');
      loadPublicAssets();
    } catch (err: any) {
      showToast('error', 'Gagal Mengajukan', err.message);
    } finally {
      setIsSubmittingApp(false);
    }
  };

  // Track Application
  const handleTrackApplication = async (queryToTrack?: string) => {
    const q = (queryToTrack || trackingQuery).trim();
    if (!q) {
      setTrackingError('Masukkan Application ID atau Simbol Token untuk melacak.');
      return;
    }

    setIsTracking(true);
    setTrackingError(null);
    setTrackingResult(null);

    try {
      const res = await fetch(`/api/listing/track/${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Pengajuan listing tidak ditemukan.');
      }
      setTrackingResult(json.data);
    } catch (err: any) {
      setTrackingError(err.message);
    } finally {
      setIsTracking(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(true);
    showToast('info', 'ID Tersalin', 'Application ID disalin ke clipboard!');
    setTimeout(() => setCopiedId(false), 2000);
  };

  const isAdmin = user && (user.role === 'admin' || user.role === 'superadmin' || user.role === 'compliance');

  const filteredAssets = publicAssets.filter(a => {
    const q = exploreSearch.toLowerCase();
    return a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.network.toLowerCase().includes(q);
  });

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#08090D] text-[#F5F5F7] overflow-y-auto">
      {/* Top Banner / Hero Section */}
      <div className="border-b border-[#292C38] bg-gradient-to-b from-[#15171F] via-[#0E1016] to-[#08090D] px-4 lg:px-8 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#EB3458]/10 border border-[#EB3458]/30 text-[#EB3458] text-xs font-semibold mb-3">
                <Rocket className="w-3.5 h-3.5" />
                <span>DIMONEX Initial Listing & Token Portal</span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#EB3458] animate-pulse" />
              </div>
              <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-[#F5F5F7]">
                Pusat Listing Aset Kripto & Pasar Spot (USDT / IDR)
              </h1>
              <p className="text-xs lg:text-sm text-[#969BA8] mt-1.5 max-w-2xl leading-relaxed">
                Platform listing resmi DIMONEX dengan dukungan kuotasi Global Tether (USDT) dan Rupiah (IDR). Dilengkapi mesin verifikasi matematis Zero-Float BigInt, tata kelola persetujuan berjenjang Maker-Checker, dan audit trail kriptografis sha256 anti-tamper.
              </p>
            </div>

            {/* Quick Action Badges */}
            <div className="flex flex-wrap md:flex-col gap-2 shrink-0">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#15171F] border border-[#292C38] text-xs">
                <ShieldCheck className="w-4 h-4 text-[#00C087]" />
                <span className="text-[#969BA8]">Quote Currency:</span>
                <span className="font-bold text-[#F5F5F7] font-mono">USDT & IDR</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#15171F] border border-[#292C38] text-xs">
                <Users className="w-4 h-4 text-[#5B9DFF]" />
                <span className="text-[#969BA8]">Governance:</span>
                <span className="font-bold text-[#F5F5F7]">Maker-Checker</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#15171F] border border-[#292C38] text-xs">
                <Cpu className="w-4 h-4 text-[#EB3458]" />
                <span className="text-[#969BA8]">Execution:</span>
                <span className="font-bold text-[#EB3458]">Zero-Float Engine</span>
              </div>
            </div>
          </div>

          {/* Navigation Sub-Tabs */}
          <div className="flex items-center gap-2 mt-8 border-b border-[#292C38]/80 pb-px overflow-x-auto">
            <button
              onClick={() => setActiveTab('EXPLORE')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors whitespace-nowrap ${
                activeTab === 'EXPLORE'
                  ? 'bg-[#15171F] text-[#EB3458] border-t-2 border-[#EB3458] border-x border-[#292C38]'
                  : 'text-[#969BA8] hover:text-[#F5F5F7] hover:bg-[#15171F]/50'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Daftar Aset Terdaftar</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#292C38] text-[#969BA8]">
                {publicAssets.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('APPLY')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors whitespace-nowrap ${
                activeTab === 'APPLY'
                  ? 'bg-[#15171F] text-[#EB3458] border-t-2 border-[#EB3458] border-x border-[#292C38]'
                  : 'text-[#969BA8] hover:text-[#F5F5F7] hover:bg-[#15171F]/50'
              }`}
            >
              <Rocket className="w-4 h-4" />
              <span>Ajukan Listing Token</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#EB3458]/20 text-[#EB3458] font-bold">
                Project Portal
              </span>
            </button>

            <button
              onClick={() => setActiveTab('TRACK')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors whitespace-nowrap ${
                activeTab === 'TRACK'
                  ? 'bg-[#15171F] text-[#EB3458] border-t-2 border-[#EB3458] border-x border-[#292C38]'
                  : 'text-[#969BA8] hover:text-[#F5F5F7] hover:bg-[#15171F]/50'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>Lacak Status Pengajuan</span>
            </button>

            <button
              onClick={() => setActiveTab('ADMIN_CONSOLE')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors whitespace-nowrap ml-auto ${
                activeTab === 'ADMIN_CONSOLE'
                  ? 'bg-[#15171F] text-[#EB3458] border-t-2 border-[#EB3458] border-x border-[#292C38]'
                  : 'text-[#5B9DFF] hover:text-white hover:bg-[#15171F]/50 border border-transparent'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Admin & Maker-Checker Console</span>
              {isAdmin && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00C087]/20 text-[#00C087] font-bold">
                  {user?.role?.toUpperCase()}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8">
        {/* ========================================================= */}
        {/* TAB 1: EXPLORE LISTED ASSETS */}
        {/* ========================================================= */}
        {activeTab === 'EXPLORE' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Top Bar Filter */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl bg-[#0E1016] border border-[#292C38]">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-[#686D7A] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Cari simbol, nama, atau jaringan..."
                  value={exploreSearch}
                  onChange={e => setExploreSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-lg bg-[#15171F] border border-[#292C38] text-xs text-[#F5F5F7] focus:outline-none focus:border-[#EB3458]"
                />
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadPublicAssets}
                  className="text-xs"
                >
                  Refresh Data
                </Button>
                <Button
                  size="sm"
                  onClick={() => setActiveTab('APPLY')}
                  className="text-xs bg-[#EB3458] hover:bg-[#FF496B] text-white"
                >
                  <Rocket className="w-3.5 h-3.5 mr-1.5" />
                  Ajukan Token Baru
                </Button>
              </div>
            </div>

            {/* Assets Table */}
            <div className="rounded-xl border border-[#292C38] bg-[#0E1016] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#292C38] bg-[#15171F]/70 text-[#969BA8]">
                      <th className="py-3 px-4 font-semibold">Aset / Koin</th>
                      <th className="py-3 px-4 font-semibold">Jaringan</th>
                      <th className="py-3 px-4 font-semibold">Tipe</th>
                      <th className="py-3 px-4 font-semibold">Desimal</th>
                      <th className="py-3 px-4 font-semibold">Status Listing</th>
                      <th className="py-3 px-4 font-semibold">Deposit & WD</th>
                      <th className="py-3 px-4 font-semibold">Pasar Spot</th>
                      <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#292C38]/60">
                    {filteredAssets.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-[#686D7A]">
                          Tidak ada aset yang cocok dengan filter pencarian.
                        </td>
                      </tr>
                    ) : (
                      filteredAssets.map(asset => {
                        const isIdr = asset.symbol === 'IDR';
                        const pairId = `${asset.symbol}-IDR`;
                        const isPairExisting = tradingPairs.some(p => p.id === pairId);

                        return (
                          <tr key={asset.id} className="hover:bg-[#15171F]/50 transition-colors">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-[#1C1F29] border border-[#292C38] flex items-center justify-center font-bold text-xs text-[#EB3458]">
                                  {asset.symbol.substring(0, 3)}
                                </div>
                                <div>
                                  <div className="font-bold text-[#F5F5F7] flex items-center gap-1.5">
                                    <span>{asset.symbol}</span>
                                    {isIdr && (
                                      <span className="text-[9px] px-1 py-0.2 rounded bg-[#00C087]/20 text-[#00C087] font-semibold">
                                        BASE QUOTE
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-[#686D7A]">{asset.name}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-[#969BA8]">
                              <span className="px-2 py-0.5 rounded bg-[#1C1F29] border border-[#292C38] text-[10px]">
                                {asset.network}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-[11px] text-[#969BA8] font-mono">
                                {asset.assetType}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-[#969BA8]">
                              {asset.decimals}
                            </td>
                            <td className="py-3 px-4">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                                asset.status === 'ACTIVE'
                                  ? 'bg-[#00C087]/15 text-[#00C087] border border-[#00C087]/30'
                                  : 'bg-[#F5B942]/15 text-[#F5B942] border border-[#F5B942]/30'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${asset.status === 'ACTIVE' ? 'bg-[#00C087]' : 'bg-[#F5B942]'}`} />
                                {asset.status}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5">
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                                    asset.depositEnabled !== false
                                      ? 'bg-[#00C087]/15 text-[#00C087] border border-[#00C087]/30'
                                      : 'bg-[#686D7A]/15 text-[#686D7A] border border-[#686D7A]/30'
                                  }`}>
                                    DEP: {asset.depositEnabled !== false ? 'BUKA' : 'TUTUP'}
                                  </span>
                                  {asset.depositOpenedAt && (
                                    <span className="text-[9px] text-[#969BA8] font-mono">
                                      {new Date(asset.depositOpenedAt).toLocaleDateString('id-ID', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                                    asset.withdrawalEnabled !== false
                                      ? 'bg-[#00C087]/15 text-[#00C087] border border-[#00C087]/30'
                                      : 'bg-[#686D7A]/15 text-[#686D7A] border border-[#686D7A]/30'
                                  }`}>
                                    WD: {asset.withdrawalEnabled !== false ? 'BUKA' : 'TUTUP'}
                                  </span>
                                  {asset.withdrawalOpenedAt && (
                                    <span className="text-[9px] text-[#969BA8] font-mono">
                                      {new Date(asset.withdrawalOpenedAt).toLocaleDateString('id-ID', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {isIdr ? (
                                <span className="text-[11px] text-[#686D7A] italic">Quote Currency</span>
                              ) : isPairExisting || asset.hasActiveMarket ? (
                                <span className="font-mono text-xs text-[#F5F5F7] font-semibold">
                                  {pairId}
                                </span>
                              ) : (
                                <span className="text-[10px] text-[#969BA8] px-2 py-0.5 rounded bg-[#1C1F29]">
                                  Dalam Proses Listing
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              {!isIdr && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    onSelectPair(pairId);
                                    onSelectView('TRADE');
                                  }}
                                  className="text-[11px] border-[#EB3458]/40 hover:bg-[#EB3458]/10 text-[#EB3458]"
                                >
                                  Trading Spot
                                  <ArrowRight className="w-3 h-3 ml-1" />
                                </Button>
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
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: APPLY FOR LISTING (PROJECT PORTAL) */}
        {/* ========================================================= */}
        {activeTab === 'APPLY' && (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-200">
            {/* Guidance card */}
            <div className="p-4 rounded-xl bg-[#15171F] border border-[#EB3458]/30 flex items-start gap-4">
              <div className="p-2.5 rounded-lg bg-[#EB3458]/15 text-[#EB3458] shrink-0 mt-0.5">
                <Info className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#F5F5F7]">Ketentuan Pengajuan Token Baru DIMONEX</h4>
                <p className="text-xs text-[#969BA8] mt-1 leading-relaxed">
                  Semua token yang didaftarkan wajib memenuhi standar audit smart contract, kepatuhan AML/CFT Bappebti, dan likuiditas awal. Pengajuan akan ditinjau oleh tim Maker & Checker Listing Committee secara independen sebelum aktivasi pasar spot.
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmitApplication} className="space-y-6 p-6 rounded-2xl bg-[#0E1016] border border-[#292C38]">
              {/* Step 1: Asset Identity */}
              <div>
                <h3 className="text-sm font-bold text-[#F5F5F7] mb-3 flex items-center gap-2 border-b border-[#292C38] pb-2">
                  <span className="w-5 h-5 rounded-full bg-[#EB3458] text-white flex items-center justify-center text-xs">1</span>
                  Identitas Token & Kontrak Pintar
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">Nama Lengkap Token *</label>
                    <Input
                      placeholder="e.g. Tether USD, Polkadot, Celestia"
                      value={formData.tokenName}
                      onChange={e => setFormData({ ...formData, tokenName: e.target.value })}
                      error={formErrors.tokenName}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">Simbol Ticker *</label>
                    <Input
                      placeholder="e.g. TIA, DOT, NEAR"
                      value={formData.tokenSymbol}
                      onChange={e => setFormData({ ...formData, tokenSymbol: e.target.value.toUpperCase() })}
                      error={formErrors.tokenSymbol}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">Jaringan Blockchain *</label>
                    <select
                      value={formData.network}
                      onChange={e => setFormData({ ...formData, network: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-[#15171F] border border-[#292C38] text-xs text-[#F5F5F7] focus:outline-none focus:border-[#EB3458]"
                    >
                      <option value="ETHEREUM">Ethereum (ERC-20)</option>
                      <option value="BSC">BNB Smart Chain (BEP-20)</option>
                      <option value="POLYGON">Polygon (ERC-20)</option>
                      <option value="ARBITRUM">Arbitrum One</option>
                      <option value="SOLANA">Solana (SPL)</option>
                      <option value="TRON">Tron (TRC-20)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">Presisi Desimal (0-18) *</label>
                    <Input
                      type="number"
                      min={0}
                      max={18}
                      value={formData.decimals}
                      onChange={e => setFormData({ ...formData, decimals: parseInt(e.target.value, 10) || 18 })}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">Alamat Smart Contract / Mint Address *</label>
                    <Input
                      placeholder="0x... atau Solana Base58 atau Tron Base58"
                      value={formData.contractAddress}
                      onChange={e => setFormData({ ...formData, contractAddress: e.target.value.trim() })}
                      error={formErrors.contractAddress}
                    />
                    <p className="text-[10px] text-[#686D7A] mt-1">
                      Wajib format valid sesuai jaringan yang dipilih. Sistem memverifikasi format sebelum memproses permohonan.
                    </p>
                  </div>
                </div>
              </div>

              {/* Step 2: Project Links & Contacts */}
              <div>
                <h3 className="text-sm font-bold text-[#F5F5F7] mb-3 flex items-center gap-2 border-b border-[#292C38] pb-2">
                  <span className="w-5 h-5 rounded-full bg-[#EB3458] text-white flex items-center justify-center text-xs">2</span>
                  Verifikasi Proyek & Kontak Resmi
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">Website Resmi</label>
                    <Input
                      placeholder="https://yourproject.io"
                      value={formData.projectWebsite}
                      onChange={e => setFormData({ ...formData, projectWebsite: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">Link Whitepaper / Dokumen Audit</label>
                    <Input
                      placeholder="https://yourproject.io/whitepaper.pdf"
                      value={formData.whitepaperUrl}
                      onChange={e => setFormData({ ...formData, whitepaperUrl: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">Email Resmi Proyek *</label>
                    <Input
                      type="email"
                      placeholder="listing@yourproject.io"
                      value={formData.contactEmail}
                      onChange={e => setFormData({ ...formData, contactEmail: e.target.value })}
                      error={formErrors.contactEmail}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">Handle Telegram Official</label>
                    <Input
                      placeholder="@ProjectFounder"
                      value={formData.telegramHandle}
                      onChange={e => setFormData({ ...formData, telegramHandle: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Step 3: Financial & Liquidity Parameters */}
              <div>
                <h3 className="text-sm font-bold text-[#F5F5F7] mb-3 flex items-center gap-2 border-b border-[#292C38] pb-2">
                  <span className="w-5 h-5 rounded-full bg-[#EB3458] text-white flex items-center justify-center text-xs">3</span>
                  Parameter Pasar & Kuotasi ({formData.quoteCurrency})
                </h3>

                {/* Quote Currency Selector */}
                <div className="mb-4 p-3.5 rounded-xl bg-[#15171F] border border-[#292C38]">
                  <label className="block text-xs font-bold text-[#F5F5F7] mb-2">
                    Pilih Mata Uang Kuotasi (Quote Currency) *
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        quoteCurrency: 'USDT',
                        expectedInitialPriceIdr: '1.00',
                        initialLiquidityCommitmentIdr: '25000'
                      })}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        formData.quoteCurrency === 'USDT'
                          ? 'bg-[#00C087]/15 border-[#00C087] text-[#F5F5F7]'
                          : 'bg-[#0E1016] border-[#292C38] text-[#969BA8] hover:border-[#686D7A]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold font-mono text-sm text-[#00C087]">USDT (Tether USD)</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00C087]/20 text-[#00C087] font-bold">
                          Global Standard
                        </span>
                      </div>
                      <p className="text-[11px] text-[#969BA8] mt-1">
                        Pasar berpasangan USDT seperti {formData.tokenSymbol || 'TOKEN'}/USDT (e.g. BTC/USDT, ETH/USDT, SOL/USDT).
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        quoteCurrency: 'IDR',
                        expectedInitialPriceIdr: '1000',
                        initialLiquidityCommitmentIdr: '50000000'
                      })}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        formData.quoteCurrency === 'IDR'
                          ? 'bg-[#EB3458]/15 border-[#EB3458] text-[#F5F5F7]'
                          : 'bg-[#0E1016] border-[#292C38] text-[#969BA8] hover:border-[#686D7A]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold font-mono text-sm text-[#EB3458]">IDR (Indonesian Rupiah)</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EB3458]/20 text-[#EB3458] font-bold">
                          Fiat Lokal
                        </span>
                      </div>
                      <p className="text-[11px] text-[#969BA8] mt-1">
                        Pasar kuotasi Rupiah lokal seperti {formData.tokenSymbol || 'TOKEN'}/IDR untuk trader Indonesia.
                      </p>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">
                      Estimasi Target Harga Awal per Token ({formData.quoteCurrency}) *
                    </label>
                    <Input
                      type="text"
                      placeholder={formData.quoteCurrency === 'USDT' ? "1.50" : "1000"}
                      value={formData.expectedInitialPriceIdr}
                      onChange={e => setFormData({ ...formData, expectedInitialPriceIdr: e.target.value })}
                    />
                    <span className="text-[10px] text-[#686D7A] mt-1 block">
                      Target harga pembukaan di pasar {formData.tokenSymbol || 'TOKEN'}/{formData.quoteCurrency}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">
                      Komitmen Likuiditas Awal ({formData.quoteCurrency}) *
                    </label>
                    <Input
                      type="text"
                      placeholder={formData.quoteCurrency === 'USDT' ? "25000" : "50000000"}
                      value={formData.initialLiquidityCommitmentIdr}
                      onChange={e => setFormData({ ...formData, initialLiquidityCommitmentIdr: e.target.value })}
                    />
                    <span className="text-[10px] text-[#686D7A] mt-1 block">
                      Alokasi dana quote yang disediakan ke designated Market Maker.
                    </span>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">Deskripsi Singkat & Kegunaan Token</label>
                    <textarea
                      rows={3}
                      placeholder="Jelaskan use-case token, ekosistem, dan rencana distribusi kepada komunitas..."
                      value={formData.description}
                      onChange={e => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-[#15171F] border border-[#292C38] text-xs text-[#F5F5F7] focus:outline-none focus:border-[#EB3458]"
                    />
                  </div>
                </div>
              </div>

              {/* Step 4: Project Owner Trader Account & Deposit / Withdraw Schedule */}
              <div>
                <h3 className="text-sm font-bold text-[#F5F5F7] mb-3 flex items-center gap-2 border-b border-[#292C38] pb-2">
                  <span className="w-5 h-5 rounded-full bg-[#EB3458] text-white flex items-center justify-center text-xs">4</span>
                  Akun Trader Pemilik Project & Saluran Deposit / Withdrawal
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">
                      Akun ID / Email Trader Pemilik Project (DIMONEX)
                    </label>
                    <Input
                      placeholder="e.g. project@dimonex.id atau usr-user1-0000-0000-000000000001"
                      value={formData.projectOwnerAccountId}
                      onChange={e => setFormData({ ...formData, projectOwnerAccountId: e.target.value.trim() })}
                    />
                    <p className="text-[10px] text-[#686D7A] mt-1">
                      Akun ini akan ditetapkan sebagai akun trader resmi pemilik project untuk menerima saldo initial token saat listing disetujui.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">
                      Jadwal Pembukaan Deposit Token
                    </label>
                    <select
                      value={formData.depositScheduleType}
                      onChange={e => setFormData({ ...formData, depositScheduleType: e.target.value as 'IMMEDIATE' | 'SCHEDULED' })}
                      className="w-full px-3 py-2 rounded-lg bg-[#15171F] border border-[#292C38] text-xs text-[#F5F5F7] focus:outline-none focus:border-[#EB3458]"
                    >
                      <option value="IMMEDIATE">Buka Segera Saat Listing Aktif (Rekomendasi)</option>
                      <option value="SCHEDULED">Jadwal Khusus Pembukaan Deposit</option>
                    </select>

                    {formData.depositScheduleType === 'SCHEDULED' && (
                      <div className="mt-2">
                        <label className="block text-[10px] text-[#969BA8] mb-1">Pilih Tanggal & Jam Buka Deposit</label>
                        <Input
                          type="datetime-local"
                          value={formData.depositOpenedAtDate}
                          onChange={e => setFormData({ ...formData, depositOpenedAtDate: e.target.value })}
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#969BA8] mb-1">
                      Jadwal Pembukaan Penarikan (Withdrawal)
                    </label>
                    <select
                      value={formData.withdrawalScheduleType}
                      onChange={e => setFormData({ ...formData, withdrawalScheduleType: e.target.value as 'IMMEDIATE' | 'SCHEDULED' })}
                      className="w-full px-3 py-2 rounded-lg bg-[#15171F] border border-[#292C38] text-xs text-[#F5F5F7] focus:outline-none focus:border-[#EB3458]"
                    >
                      <option value="IMMEDIATE">Buka Segera Saat Listing Aktif</option>
                      <option value="SCHEDULED">Jadwal Khusus Pembukaan Withdrawal</option>
                    </select>

                    {formData.withdrawalScheduleType === 'SCHEDULED' && (
                      <div className="mt-2">
                        <label className="block text-[10px] text-[#969BA8] mb-1">Pilih Tanggal & Jam Buka Withdrawal</label>
                        <Input
                          type="datetime-local"
                          value={formData.withdrawalOpenedAtDate}
                          onChange={e => setFormData({ ...formData, withdrawalOpenedAtDate: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-[#292C38]">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setActiveTab('EXPLORE')}
                  className="text-xs"
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingApp}
                  className="bg-[#EB3458] hover:bg-[#FF496B] text-white text-xs px-6"
                >
                  {isSubmittingApp ? 'Memproses Pengajuan...' : 'Kirim Pengajuan Listing'}
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: TRACK APPLICATION STATUS */}
        {/* ========================================================= */}
        {activeTab === 'TRACK' && (
          <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-200">
            {/* Search Input */}
            <div className="p-6 rounded-2xl bg-[#0E1016] border border-[#292C38]">
              <h3 className="text-base font-bold text-[#F5F5F7] mb-1">
                Lacak Status Pengajuan Listing
              </h3>
              <p className="text-xs text-[#969BA8] mb-4">
                Masukkan Kode Permohonan (Application ID) atau Simbol Token yang Anda daftarkan.
              </p>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-[#686D7A] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="e.g. REQ-..., SOL, ETH..."
                    value={trackingQuery}
                    onChange={e => setTrackingQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleTrackApplication()}
                    className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-[#15171F] border border-[#292C38] text-xs text-[#F5F5F7] focus:outline-none focus:border-[#EB3458]"
                  />
                </div>
                <Button
                  onClick={() => handleTrackApplication()}
                  disabled={isTracking}
                  className="bg-[#EB3458] hover:bg-[#FF496B] text-white text-xs px-5"
                >
                  {isTracking ? 'Melacak...' : 'Lacak'}
                </Button>
              </div>

              {trackingError && (
                <div className="mt-3 p-3 rounded-lg bg-[#EB3458]/10 border border-[#EB3458]/30 text-xs text-[#EB3458] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{trackingError}</span>
                </div>
              )}
            </div>

            {/* Tracker Result Card */}
            {trackingResult && (
              <div className="p-6 rounded-2xl bg-[#0E1016] border border-[#292C38] space-y-6">
                <div className="flex items-center justify-between border-b border-[#292C38] pb-4">
                  <div>
                    <span className="text-[10px] text-[#686D7A] uppercase tracking-wider block">Token Proposal</span>
                    <h2 className="text-lg font-bold text-[#F5F5F7] flex items-center gap-2">
                      <span>{trackingResult.tokenName}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-[#EB3458]/15 text-[#EB3458] font-mono">
                        {trackingResult.tokenSymbol}
                      </span>
                    </h2>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-[#686D7A] block">Target Pasar</span>
                    <span className="font-mono text-xs font-bold text-[#F5F5F7]">
                      {trackingResult.pair}
                    </span>
                  </div>
                </div>

                {/* 4-Stage Progress Line */}
                <div>
                  <h4 className="text-xs font-semibold text-[#969BA8] mb-3">
                    Progres Verifikasi Maker-Checker & Engine Readiness
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    {/* Stage 1 */}
                    <div className={`p-3 rounded-xl border ${
                      trackingResult.stage >= 1
                        ? 'bg-[#15171F] border-[#00C087]/50 text-[#F5F5F7]'
                        : 'bg-[#08090D] border-[#292C38] text-[#686D7A]'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold">TAHAP 1</span>
                        {trackingResult.stage >= 1 && <CheckCircle2 className="w-3.5 h-3.5 text-[#00C087]" />}
                      </div>
                      <p className="text-xs font-semibold">Penerimaan & Dokumen</p>
                      <p className="text-[10px] text-[#969BA8] mt-0.5">Format kontrak & identitas</p>
                    </div>

                    {/* Stage 2 */}
                    <div className={`p-3 rounded-xl border ${
                      trackingResult.stage >= 2
                        ? 'bg-[#15171F] border-[#00C087]/50 text-[#F5F5F7]'
                        : trackingResult.stage === 1
                        ? 'bg-[#15171F] border-[#EB3458]/40 text-[#EB3458]'
                        : 'bg-[#08090D] border-[#292C38] text-[#686D7A]'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold">TAHAP 2</span>
                        {trackingResult.stage >= 2 && <CheckCircle2 className="w-3.5 h-3.5 text-[#00C087]" />}
                      </div>
                      <p className="text-xs font-semibold">Maker Review</p>
                      <p className="text-[10px] text-[#969BA8] mt-0.5">Parameter tick & lot size</p>
                    </div>

                    {/* Stage 3 */}
                    <div className={`p-3 rounded-xl border ${
                      trackingResult.stage >= 3
                        ? 'bg-[#15171F] border-[#00C087]/50 text-[#F5F5F7]'
                        : trackingResult.stage === 2
                        ? 'bg-[#15171F] border-[#5B9DFF]/40 text-[#5B9DFF]'
                        : 'bg-[#08090D] border-[#292C38] text-[#686D7A]'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold">TAHAP 3</span>
                        {trackingResult.stage >= 3 && <CheckCircle2 className="w-3.5 h-3.5 text-[#00C087]" />}
                      </div>
                      <p className="text-xs font-semibold">Checker Approval</p>
                      <p className="text-[10px] text-[#969BA8] mt-0.5">Audit independen Bappebti</p>
                    </div>

                    {/* Stage 4 */}
                    <div className={`p-3 rounded-xl border ${
                      trackingResult.stage >= 4
                        ? 'bg-[#15171F] border-[#00C087]/50 text-[#F5F5F7]'
                        : 'bg-[#08090D] border-[#292C38] text-[#686D7A]'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold">TAHAP 4</span>
                        {trackingResult.stage >= 4 && <CheckCircle2 className="w-3.5 h-3.5 text-[#00C087]" />}
                      </div>
                      <p className="text-xs font-semibold">Aktivasi Spot</p>
                      <p className="text-[10px] text-[#969BA8] mt-0.5">Pasar live & order book</p>
                    </div>
                  </div>
                </div>

                {/* Details */}
                <div className="p-4 rounded-xl bg-[#15171F] border border-[#292C38] space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[#969BA8]">Status Terkini:</span>
                    <span className="font-bold text-[#F5F5F7] px-2 py-0.5 rounded bg-[#292C38]">
                      {trackingResult.stageName} ({trackingResult.status})
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#969BA8]">Jaringan Token:</span>
                    <span className="font-mono text-[#F5F5F7]">{trackingResult.network}</span>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-[#292C38]/60">
                    <span className="text-[#969BA8]">Saluran Deposit:</span>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        trackingResult.depositStatus === 'OPEN'
                          ? 'bg-[#00C087]/15 text-[#00C087] border border-[#00C087]/30'
                          : 'bg-[#686D7A]/15 text-[#686D7A] border border-[#686D7A]/30'
                      }`}>
                        {trackingResult.depositStatus === 'OPEN' ? 'DIBUKA' : 'DITUTUP'}
                      </span>
                      {trackingResult.depositOpenedAt && (
                        <span className="text-[10px] text-[#969BA8] font-mono">
                          (Buka: {new Date(trackingResult.depositOpenedAt).toLocaleString('id-ID')})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[#969BA8]">Saluran Penarikan (WD):</span>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        trackingResult.withdrawalStatus === 'OPEN'
                          ? 'bg-[#00C087]/15 text-[#00C087] border border-[#00C087]/30'
                          : 'bg-[#686D7A]/15 text-[#686D7A] border border-[#686D7A]/30'
                      }`}>
                        {trackingResult.withdrawalStatus === 'OPEN' ? 'DIBUKA' : 'DITUTUP'}
                      </span>
                      {trackingResult.withdrawalOpenedAt && (
                        <span className="text-[10px] text-[#969BA8] font-mono">
                          (Buka: {new Date(trackingResult.withdrawalOpenedAt).toLocaleString('id-ID')})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-[#292C38]/60">
                    <span className="text-[#969BA8]">Designated Market Maker:</span>
                    <span className="font-mono text-[#F5F5F7] text-[11px]">
                      {trackingResult.marketMakerEmail || 'mm@dimonex.id'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[#969BA8]">Akun Trader Project Owner:</span>
                    <span className="font-mono text-[#F5F5F7] text-[11px]">
                      {trackingResult.projectOwnerEmail || trackingResult.projectOwnerAccountId || 'Belum Terdaftar'}
                    </span>
                  </div>

                  {trackingResult.approvalReason && (
                    <div className="flex items-start justify-between gap-4 pt-2 border-t border-[#292C38]">
                      <span className="text-[#969BA8]">Catatan Review:</span>
                      <span className="text-[#00C087] text-right font-medium">{trackingResult.approvalReason}</span>
                    </div>
                  )}
                </div>

                {trackingResult.marketActive && (
                  <div className="pt-2 flex justify-end">
                    <Button
                      onClick={() => {
                        onSelectPair(trackingResult.pair.replace('/', '-'));
                        onSelectView('TRADE');
                      }}
                      className="bg-[#00C087] hover:bg-[#00D097] text-black font-bold text-xs"
                    >
                      Buka Terminal Trading Spot
                      <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: ADMIN & MAKER-CHECKER CONSOLE */}
        {/* ========================================================= */}
        {activeTab === 'ADMIN_CONSOLE' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Role Switcher Bar for Seamless Governance Testing */}
            <div className="p-4 rounded-xl bg-[#0E1016] border border-[#292C38] flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#5B9DFF]/15 border border-[#5B9DFF]/30 flex items-center justify-center text-[#5B9DFF]">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#F5F5F7] flex items-center gap-2">
                    <span>Pengujian Tata Kelola Maker-Checker DIMONEX</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#5B9DFF]/20 text-[#5B9DFF]">
                      Live Multi-Role
                    </span>
                  </div>
                  <p className="text-[11px] text-[#969BA8]">
                    Role aktif: <strong className="text-[#F5F5F7]">{user ? `${user.email} (${user.role.toUpperCase()})` : 'Belum Login'}</strong>. Pilih profil demo untuk menguji validasi self-approval dan otorisasi.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onQuickLogin('admin@dimonex.id', 'AdminDimonex2026!')}
                  className="text-xs border-[#EB3458]/50 hover:bg-[#EB3458]/10 text-[#EB3458]"
                >
                  Masuk sebagai Maker Admin
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onQuickLogin('compliance@dimonex.id', 'ComplianceAdmin2026!')}
                  className="text-xs border-[#5B9DFF]/50 hover:bg-[#5B9DFF]/10 text-[#5B9DFF]"
                >
                  Masuk sebagai Checker Admin
                </Button>
              </div>
            </div>

            {/* Embedded Full Feature ListingManagementView */}
            <ListingManagementView
              currentUser={user || { id: 'admin-preview', role: 'admin', email: 'admin@dimonex.id' }}
              onRefreshMarkets={loadPublicAssets}
            />
          </div>
        )}
      </div>

      {/* Confirmation Modal for Submitted Application */}
      <Modal
        isOpen={!!submittedResult}
        onClose={() => setSubmittedResult(null)}
        title="Pengajuan Listing Berhasil Dikirim"
        maxWidth="max-w-md"
      >
        <div className="p-6 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-[#00C087]/15 border border-[#00C087]/30 flex items-center justify-center mx-auto text-[#00C087]">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div>
            <h3 className="text-lg font-bold text-[#F5F5F7]">
              Proposal {submittedResult?.tokenSymbol} Berhasil Terdaftar
            </h3>
            <p className="text-xs text-[#969BA8] mt-1 max-w-sm mx-auto">
              {submittedResult?.trackingMessage}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#15171F] border border-[#292C38] text-left">
            <span className="text-[10px] text-[#686D7A] block uppercase font-bold tracking-wider mb-1">
              Nomor Pelacakan Pengajuan (Application ID)
            </span>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-bold text-[#EB3458] select-all">
                {submittedResult?.applicationId}
              </span>
              <button
                onClick={() => copyToClipboard(submittedResult?.applicationId || '')}
                className="p-1.5 rounded-lg bg-[#1C1F29] hover:bg-[#292C38] text-[#969BA8] hover:text-[#F5F5F7] transition-colors"
                title="Salin ID"
              >
                {copiedId ? <Check className="w-4 h-4 text-[#00C087]" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="pt-2 flex justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSubmittedResult(null);
                setActiveTab('EXPLORE');
              }}
            >
              Lihat Daftar Aset
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const id = submittedResult?.applicationId;
                setSubmittedResult(null);
                setTrackingQuery(id);
                setActiveTab('TRACK');
                handleTrackApplication(id);
              }}
              className="bg-[#EB3458] hover:bg-[#FF496B] text-white"
            >
              Lacak Status Sekarang
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
