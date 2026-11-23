/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/listing/ListingPortalPage.tsx
 * DIMONEX Centralized Cryptocurrency Spot Exchange — Master Listing Portal.
 */

import React, { useState, useEffect } from 'react';
import {
  Rocket,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Layers,
  ArrowRight,
  AlertCircle,
  Users,
  Copy,
  Check,
  Cpu,
  Lock,
  Info,
} from 'lucide-react';
import { UserProfile, TradingPairItem } from '../../types/index.js';
import { ListingManagementView } from '../admin/listing/ListingManagementView.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Modal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { SearchInput } from '../ui/Controls.js';
import { safeFetchJson } from '../../lib/safeFetch.js';

const RECENT_LISTING_APPS_KEY = 'dimonex_recent_listing_apps';

interface RecentListingApp {
  applicationId: string;
  tokenSymbol: string;
  tokenName: string;
  createdAt: number;
}

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
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'EXPLORE' | 'APPLY' | 'TRACK' | 'ADMIN_CONSOLE'>(
    'EXPLORE'
  );

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
    withdrawalOpenedAtDate: '',
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
  const [recentApplications, setRecentApplications] = useState<RecentListingApp[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_LISTING_APPS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
    } catch {
      return [];
    }
  });

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
      const fallback = tradingPairs.map(p => ({
        id: p.id,
        symbol: p.baseCurrency,
        name:
          p.baseCurrency === 'BTC'
            ? 'Bitcoin'
            : p.baseCurrency === 'ETH'
            ? 'Ethereum'
            : p.baseCurrency,
        assetType: 'TOKEN',
        network: 'MAINNET',
        status: 'ACTIVE',
        hasActiveMarket: true,
        marketSymbol: p.id,
      }));
      setPublicAssets(fallback);
    } finally {
      setIsLoadingAssets(false);
    }
  };

  const validateAddress = (net: string, addr: string): boolean => {
    if (!addr) return false;
    const n = net.toUpperCase();
    if (
      n.includes('ETHEREUM') ||
      n.includes('ERC20') ||
      n.includes('BSC') ||
      n.includes('POLYGON') ||
      n.includes('ARBITRUM')
    ) {
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
        depositOpenedAt:
          formData.depositScheduleType === 'SCHEDULED' && formData.depositOpenedAtDate
            ? new Date(formData.depositOpenedAtDate).getTime()
            : undefined,
        withdrawalOpenedAt:
          formData.withdrawalScheduleType === 'SCHEDULED' && formData.withdrawalOpenedAtDate
            ? new Date(formData.withdrawalOpenedAtDate).getTime()
            : undefined,
        depositEnabled: true,
        withdrawalEnabled: true,
      };

      const result = await safeFetchJson<{ success?: boolean; data?: any; error?: string }>(
        '/api/listing/apply',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!result.ok || !result.data?.data) {
        throw new Error(result.error || result.data?.error || 'Gagal mengajukan listing');
      }

      const created = result.data.data;
      setSubmittedResult(created);
      if (created.applicationId) {
        setRecentApplications(prev => {
          const next: RecentListingApp[] = [
            {
              applicationId: created.applicationId,
              tokenSymbol: created.tokenSymbol || formData.tokenSymbol.toUpperCase(),
              tokenName: formData.tokenName.trim() || created.tokenSymbol,
              createdAt: created.createdAt || Date.now(),
            },
            ...prev.filter(item => item.applicationId !== created.applicationId),
          ].slice(0, 6);
          try {
            localStorage.setItem(RECENT_LISTING_APPS_KEY, JSON.stringify(next));
          } catch {
            // ignore storage quota errors
          }
          return next;
        });
      }
      showToast(
        'success',
        'Pengajuan Terkirim',
        'Pengajuan token listing berhasil dikirim ke Komite Listing DIMONEX!'
      );
      loadPublicAssets();
    } catch (err: any) {
      showToast('error', 'Gagal Mengajukan', err.message);
    } finally {
      setIsSubmittingApp(false);
    }
  };

  const handleTrackApplication = async (queryToTrack?: string) => {
    const q = (queryToTrack !== undefined ? queryToTrack : trackingQuery).trim();
    if (queryToTrack !== undefined) {
      setTrackingQuery(q);
    }
    if (!q) {
      setTrackingError('Masukkan Application ID, Simbol Token, atau Pair untuk melacak.');
      return;
    }

    setIsTracking(true);
    setTrackingError(null);
    setTrackingResult(null);

    try {
      const result = await safeFetchJson<{ success?: boolean; data?: any; error?: string }>(
        `/api/listing/track?q=${encodeURIComponent(q)}`
      );
      if (!result.ok || !result.data?.data) {
        throw new Error(
          result.error || result.data?.error || 'Pengajuan listing tidak ditemukan.'
        );
      }
      setTrackingResult(result.data.data);
    } catch (err: any) {
      setTrackingError(err.message || 'Gagal memuat status pengajuan listing.');
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

  const isAdmin =
    user &&
    (user.role === 'admin' || user.role === 'superadmin' || user.role === 'compliance');

  const filteredAssets = publicAssets.filter(a => {
    const q = exploreSearch.toLowerCase();
    return (
      a.symbol.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.network.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#090D12] text-[#E4EBEF] overflow-y-auto">
      {/* Top Banner / Hero Section */}
      <div className="border-b border-[#202B34] bg-[#111820] px-4 lg:px-8 pt-7 pb-0">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-[5px] bg-[#17212B] border border-[#2B3944] text-[#8DA5B1] text-[11px] font-mono font-medium mb-3">
                <Rocket className="w-3.5 h-3.5" />
                <span>DIMONEX INITIAL LISTING & TOKEN PORTAL</span>
              </div>
              <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-[#E4EBEF]">
                Pusat Listing Aset Kripto & Pasar Spot (USDT / IDR)
              </h1>
              <p className="text-xs lg:text-sm text-[#A1AFB8] mt-1.5 max-w-2xl leading-relaxed">
                Platform listing resmi DIMONEX dengan dukungan kuotasi Global Tether (USDT) dan Rupiah (IDR), tata kelola persetujuan berjenjang Maker-Checker, dan audit trail kriptografis SHA-256.
              </p>
            </div>

            {/* Architecture Specs */}
            <div className="flex flex-wrap md:flex-col gap-2 shrink-0">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-[7px] bg-[#141C24] border border-[#202B34] text-xs">
                <ShieldCheck className="w-4 h-4 text-[#16A879]" />
                <span className="text-[#71818B]">Quote Currency:</span>
                <span className="font-semibold text-[#E4EBEF] font-mono">USDT & IDR</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-[7px] bg-[#141C24] border border-[#202B34] text-xs">
                <Users className="w-4 h-4 text-[#6D9FE8]" />
                <span className="text-[#71818B]">Governance:</span>
                <span className="font-semibold text-[#E4EBEF]">Maker-Checker</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-[7px] bg-[#141C24] border border-[#202B34] text-xs">
                <Cpu className="w-4 h-4 text-[#8DA5B1]" />
                <span className="text-[#71818B]">Execution:</span>
                <span className="font-semibold text-[#A5BAC4] font-mono">Zero-Float Engine</span>
              </div>
            </div>
          </div>

          {/* Navigation Sub-Tabs */}
          <div className="flex items-center gap-2 mt-7 pb-px overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('EXPLORE')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-[7px] transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'EXPLORE'
                  ? 'bg-[#090D12] text-[#E4EBEF] border-t-2 border-t-[#8DA5B1] border-x border-[#202B34]'
                  : 'text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#141C24]'
              }`}
            >
              <Layers className="w-4 h-4 text-[#8DA5B1]" />
              <span>Daftar Aset Terdaftar</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[4px] bg-[#17212B] text-[#A1AFB8]">
                {publicAssets.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('APPLY')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-[7px] transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'APPLY'
                  ? 'bg-[#090D12] text-[#E4EBEF] border-t-2 border-t-[#8DA5B1] border-x border-[#202B34]'
                  : 'text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#141C24]'
              }`}
            >
              <Rocket className="w-4 h-4 text-[#8DA5B1]" />
              <span>Ajukan Listing Token</span>
              <StatusBadge tone="brand">Portal</StatusBadge>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('TRACK')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-[7px] transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'TRACK'
                  ? 'bg-[#090D12] text-[#E4EBEF] border-t-2 border-t-[#8DA5B1] border-x border-[#202B34]'
                  : 'text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#141C24]'
              }`}
            >
              <Clock className="w-4 h-4 text-[#8DA5B1]" />
              <span>Lacak Status Pengajuan</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ADMIN_CONSOLE')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-[7px] transition-colors whitespace-nowrap ml-auto cursor-pointer ${
                activeTab === 'ADMIN_CONSOLE'
                  ? 'bg-[#090D12] text-[#E4EBEF] border-t-2 border-t-[#8DA5B1] border-x border-[#202B34]'
                  : 'text-[#8DA5B1] hover:text-[#E4EBEF] hover:bg-[#141C24]'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Admin & Maker-Checker Console</span>
              {isAdmin && <StatusBadge tone="success">{user?.role?.toUpperCase()}</StatusBadge>}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8">
        {/* TAB 1: EXPLORE LISTED ASSETS */}
        {activeTab === 'EXPLORE' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
              <SearchInput
                value={exploreSearch}
                onChange={setExploreSearch}
                placeholder="Cari simbol, nama, atau jaringan..."
                className="w-full sm:w-80"
              />

              <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={loadPublicAssets}
                  isLoading={isLoadingAssets}
                >
                  Refresh Data
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Rocket className="w-3.5 h-3.5" />}
                  onClick={() => setActiveTab('APPLY')}
                >
                  Ajukan Token Baru
                </Button>
              </div>
            </div>

            <div className="rounded-[10px] border border-[#202B34] bg-[#141C24] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#202B34] bg-[#111820] text-[#71818B] text-[11px] uppercase tracking-wider">
                      <th className="py-3 px-4 font-medium">Aset / Koin</th>
                      <th className="py-3 px-4 font-medium">Jaringan</th>
                      <th className="py-3 px-4 font-medium">Tipe</th>
                      <th className="py-3 px-4 font-medium">Desimal</th>
                      <th className="py-3 px-4 font-medium">Status Listing</th>
                      <th className="py-3 px-4 font-medium">Deposit & WD</th>
                      <th className="py-3 px-4 font-medium">Pasar Spot</th>
                      <th className="py-3 px-4 font-medium text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202B34]">
                    {filteredAssets.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-[#71818B]">
                          Tidak ada aset yang cocok dengan filter pencarian.
                        </td>
                      </tr>
                    ) : (
                      filteredAssets.map(asset => {
                        const isIdr = asset.symbol === 'IDR';
                        const activeMarketsForBase = tradingPairs.filter(
                          p => p.baseCurrency === asset.symbol
                        );
                        const preferredPair =
                          activeMarketsForBase.find(p => p.id === asset.marketSymbol) ||
                          activeMarketsForBase[0];
                        const pairId = preferredPair?.id || asset.marketSymbol || `${asset.symbol}-IDR`;
                        const marketLabels: string[] =
                          Array.isArray(asset.activeMarketSymbols) &&
                          asset.activeMarketSymbols.length > 0
                            ? asset.activeMarketSymbols
                            : activeMarketsForBase.length > 0
                            ? activeMarketsForBase.map(p => p.id)
                            : [];
                        const isPairExisting =
                          activeMarketsForBase.length > 0 || marketLabels.length > 0;

                        return (
                          <tr key={asset.id} className="hover:bg-[#17212B] transition-colors">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <AssetIcon symbol={asset.symbol} size="md" />
                                <div>
                                  <div className="font-semibold text-[#E4EBEF] flex items-center gap-1.5 font-mono">
                                    <span>{asset.symbol}</span>
                                    {(isIdr || asset.symbol === 'USDT') && (
                                      <StatusBadge tone="buy">
                                        {isIdr ? 'BASE QUOTE' : 'QUOTE'}
                                      </StatusBadge>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-[#71818B]">{asset.name}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-[#A1AFB8]">
                              <span className="px-2 py-0.5 rounded-[5px] bg-[#17212B] border border-[#2B3944] text-[10px]">
                                {asset.network}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-[#A1AFB8]">
                              {asset.assetType}
                            </td>
                            <td className="py-3 px-4 font-mono tabular-nums text-[#A1AFB8]">
                              {asset.decimals}
                            </td>
                            <td className="py-3 px-4">
                              <StatusBadge
                                tone={asset.status === 'ACTIVE' ? 'success' : 'warning'}
                                dot
                              >
                                {asset.status}
                              </StatusBadge>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5">
                                  <StatusBadge
                                    tone={asset.depositEnabled !== false ? 'buy' : 'neutral'}
                                  >
                                    DEP: {asset.depositEnabled !== false ? 'BUKA' : 'TUTUP'}
                                  </StatusBadge>
                                  {asset.depositOpenedAt && (
                                    <span className="text-[9px] text-[#71818B] font-mono">
                                      {new Date(asset.depositOpenedAt).toLocaleDateString('id-ID', {
                                        month: 'numeric',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <StatusBadge
                                    tone={asset.withdrawalEnabled !== false ? 'buy' : 'neutral'}
                                  >
                                    WD: {asset.withdrawalEnabled !== false ? 'BUKA' : 'TUTUP'}
                                  </StatusBadge>
                                  {asset.withdrawalOpenedAt && (
                                    <span className="text-[9px] text-[#71818B] font-mono">
                                      {new Date(asset.withdrawalOpenedAt).toLocaleDateString(
                                        'id-ID',
                                        {
                                          month: 'numeric',
                                          day: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        }
                                      )}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {isIdr ? (
                                <span className="text-[11px] text-[#71818B] italic">
                                  Quote Currency
                                </span>
                              ) : isPairExisting || asset.hasActiveMarket ? (
                                <div className="flex flex-wrap items-center gap-1">
                                  {(marketLabels.length > 0 ? marketLabels : [pairId]).map(mSym => (
                                    <span
                                      key={mSym}
                                      className="font-mono text-[11px] text-[#E4EBEF] font-semibold px-1.5 py-0.5 rounded-[5px] bg-[#17212B] border border-[#2B3944]"
                                    >
                                      {mSym}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[10px] text-[#A1AFB8] px-2 py-0.5 rounded-[5px] bg-[#17212B]">
                                  Dalam Proses Listing ({pairId})
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              {!isIdr && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => {
                                    onSelectPair(pairId);
                                    onSelectView('TRADE');
                                  }}
                                >
                                  <span>Trading Spot</span>
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

        {/* TAB 2: APPLY FOR LISTING */}
        {activeTab === 'APPLY' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#2B3944] flex items-start gap-4">
              <div className="p-2.5 rounded-[7px] bg-[#1D2832] border border-[#40515D] text-[#8DA5B1] shrink-0 mt-0.5">
                <Info className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-[#E4EBEF]">
                  Ketentuan Pengajuan Token Baru DIMONEX
                </h4>
                <p className="text-xs text-[#A1AFB8] mt-1 leading-relaxed">
                  Semua token yang didaftarkan wajib memenuhi standar audit smart contract, kepatuhan AML/CFT Bappebti, dan likuiditas awal. Pengajuan akan ditinjau oleh tim Maker & Checker Listing Committee secara independen sebelum aktivasi pasar spot.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleSubmitApplication}
              className="space-y-6 p-6 rounded-[10px] bg-[#141C24] border border-[#202B34]"
            >
              {/* Step 1 */}
              <div>
                <h3 className="text-sm font-semibold text-[#E4EBEF] mb-3 flex items-center gap-2 border-b border-[#202B34] pb-2">
                  <span className="w-5 h-5 rounded-full bg-[#8DA5B1] text-[#090D12] font-mono font-bold flex items-center justify-center text-xs">
                    1
                  </span>
                  <span>Identitas Token & Kontrak Pintar</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Nama Lengkap Token *"
                    placeholder="e.g. Tether USD, Polkadot, Celestia"
                    value={formData.tokenName}
                    onChange={e => setFormData({ ...formData, tokenName: e.target.value })}
                    error={formErrors.tokenName}
                  />

                  <Input
                    label="Simbol Ticker *"
                    placeholder="e.g. TIA, DOT, NEAR"
                    value={formData.tokenSymbol}
                    onChange={e =>
                      setFormData({ ...formData, tokenSymbol: e.target.value.toUpperCase() })
                    }
                    error={formErrors.tokenSymbol}
                  />

                  <div>
                    <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1.5">
                      Jaringan Blockchain *
                    </label>
                    <select
                      value={formData.network}
                      onChange={e => setFormData({ ...formData, network: e.target.value })}
                      className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                    >
                      <option value="ETHEREUM">Ethereum (ERC-20)</option>
                      <option value="BSC">BNB Smart Chain (BEP-20)</option>
                      <option value="POLYGON">Polygon (ERC-20)</option>
                      <option value="ARBITRUM">Arbitrum One</option>
                      <option value="SOLANA">Solana (SPL)</option>
                      <option value="TRON">Tron (TRC-20)</option>
                    </select>
                  </div>

                  <Input
                    label="Presisi Desimal (0-18) *"
                    type="number"
                    min={0}
                    max={18}
                    value={formData.decimals}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        decimals: parseInt(e.target.value, 10) || 18,
                      })
                    }
                  />

                  <div className="md:col-span-2">
                    <Input
                      label="Alamat Smart Contract / Mint Address *"
                      placeholder="0x... atau Solana Base58 atau Tron Base58"
                      value={formData.contractAddress}
                      onChange={e =>
                        setFormData({ ...formData, contractAddress: e.target.value.trim() })
                      }
                      error={formErrors.contractAddress}
                    />
                    <p className="text-[10px] text-[#71818B] mt-1">
                      Wajib format valid sesuai jaringan yang dipilih. Sistem memverifikasi format sebelum memproses permohonan.
                    </p>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div>
                <h3 className="text-sm font-semibold text-[#E4EBEF] mb-3 flex items-center gap-2 border-b border-[#202B34] pb-2">
                  <span className="w-5 h-5 rounded-full bg-[#8DA5B1] text-[#090D12] font-mono font-bold flex items-center justify-center text-xs">
                    2
                  </span>
                  <span>Verifikasi Proyek & Kontak Resmi</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Website Resmi"
                    placeholder="https://yourproject.io"
                    value={formData.projectWebsite}
                    onChange={e => setFormData({ ...formData, projectWebsite: e.target.value })}
                  />

                  <Input
                    label="Link Whitepaper / Dokumen Audit"
                    placeholder="https://yourproject.io/whitepaper.pdf"
                    value={formData.whitepaperUrl}
                    onChange={e => setFormData({ ...formData, whitepaperUrl: e.target.value })}
                  />

                  <Input
                    label="Email Resmi Proyek *"
                    type="email"
                    placeholder="listing@yourproject.io"
                    value={formData.contactEmail}
                    onChange={e => setFormData({ ...formData, contactEmail: e.target.value })}
                    error={formErrors.contactEmail}
                  />

                  <Input
                    label="Handle Telegram Official"
                    placeholder="@ProjectFounder"
                    value={formData.telegramHandle}
                    onChange={e => setFormData({ ...formData, telegramHandle: e.target.value })}
                  />
                </div>
              </div>

              {/* Step 3 */}
              <div>
                <h3 className="text-sm font-semibold text-[#E4EBEF] mb-3 flex items-center gap-2 border-b border-[#202B34] pb-2">
                  <span className="w-5 h-5 rounded-full bg-[#8DA5B1] text-[#090D12] font-mono font-bold flex items-center justify-center text-xs">
                    3
                  </span>
                  <span>Parameter Pasar & Kuotasi ({formData.quoteCurrency})</span>
                </h3>

                <div className="mb-4 p-4 rounded-[10px] bg-[#111820] border border-[#202B34]">
                  <label className="block text-xs font-semibold text-[#E4EBEF] mb-2.5">
                    Pilih Mata Uang Kuotasi (Quote Currency) *
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          quoteCurrency: 'USDT',
                          expectedInitialPriceIdr: '1.00',
                          initialLiquidityCommitmentIdr: '25000',
                        })
                      }
                      className={`p-3 rounded-[7px] border text-left transition-colors cursor-pointer ${
                        formData.quoteCurrency === 'USDT'
                          ? 'bg-[#12392F]/50 border-[#16A879] text-[#E4EBEF]'
                          : 'bg-[#141C24] border-[#2B3944] text-[#A1AFB8] hover:border-[#40515D]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold font-mono text-sm text-[#16A879]">
                          USDT (Tether USD)
                        </span>
                        <StatusBadge tone="buy">Global Standard</StatusBadge>
                      </div>
                      <p className="text-[11px] text-[#71818B] mt-1">
                        Pasar berpasangan USDT seperti {formData.tokenSymbol || 'TOKEN'}/USDT.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          quoteCurrency: 'IDR',
                          expectedInitialPriceIdr: '1000',
                          initialLiquidityCommitmentIdr: '50000000',
                        })
                      }
                      className={`p-3 rounded-[7px] border text-left transition-colors cursor-pointer ${
                        formData.quoteCurrency === 'IDR'
                          ? 'bg-[#1D2832] border-[#8DA5B1] text-[#E4EBEF]'
                          : 'bg-[#141C24] border-[#2B3944] text-[#A1AFB8] hover:border-[#40515D]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold font-mono text-sm text-[#C1D0D6]">
                          IDR (Indonesian Rupiah)
                        </span>
                        <StatusBadge tone="brand">Fiat Lokal</StatusBadge>
                      </div>
                      <p className="text-[11px] text-[#71818B] mt-1">
                        Pasar kuotasi Rupiah lokal seperti {formData.tokenSymbol || 'TOKEN'}/IDR.
                      </p>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Input
                      label={`Estimasi Target Harga Awal per Token (${formData.quoteCurrency}) *`}
                      type="text"
                      placeholder={formData.quoteCurrency === 'USDT' ? '1.50' : '1000'}
                      value={formData.expectedInitialPriceIdr}
                      onChange={e =>
                        setFormData({ ...formData, expectedInitialPriceIdr: e.target.value })
                      }
                    />
                    <span className="text-[10px] text-[#71818B] mt-1 block">
                      Target harga pembukaan di pasar {formData.tokenSymbol || 'TOKEN'}/
                      {formData.quoteCurrency}
                    </span>
                  </div>

                  <div>
                    <Input
                      label={`Komitmen Likuiditas Awal (${formData.quoteCurrency}) *`}
                      type="text"
                      placeholder={formData.quoteCurrency === 'USDT' ? '25000' : '50000000'}
                      value={formData.initialLiquidityCommitmentIdr}
                      onChange={e =>
                        setFormData({ ...formData, initialLiquidityCommitmentIdr: e.target.value })
                      }
                    />
                    <span className="text-[10px] text-[#71818B] mt-1 block">
                      Alokasi dana quote yang disediakan ke designated Market Maker.
                    </span>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1.5">
                      Deskripsi Singkat & Kegunaan Token
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Jelaskan use-case token, ekosistem, dan rencana distribusi kepada komunitas..."
                      value={formData.description}
                      onChange={e => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] placeholder-[#53616A] focus:outline-none focus:border-[#8DA5B1]"
                    />
                  </div>
                </div>
              </div>

              {/* Step 4 */}
              <div>
                <h3 className="text-sm font-semibold text-[#E4EBEF] mb-3 flex items-center gap-2 border-b border-[#202B34] pb-2">
                  <span className="w-5 h-5 rounded-full bg-[#8DA5B1] text-[#090D12] font-mono font-bold flex items-center justify-center text-xs">
                    4
                  </span>
                  <span>Akun Trader Pemilik Project & Saluran Deposit / Withdrawal</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Input
                      label="Akun ID / Email Trader Pemilik Project (DIMONEX)"
                      placeholder="e.g. project@dimonex.id atau usr-user1-0000-0000-000000000001"
                      value={formData.projectOwnerAccountId}
                      onChange={e =>
                        setFormData({ ...formData, projectOwnerAccountId: e.target.value.trim() })
                      }
                    />
                    <p className="text-[10px] text-[#71818B] mt-1">
                      Akun ini akan ditetapkan sebagai akun trader resmi pemilik project untuk menerima saldo initial token saat listing disetujui.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1.5">
                      Jadwal Pembukaan Deposit Token
                    </label>
                    <select
                      value={formData.depositScheduleType}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          depositScheduleType: e.target.value as 'IMMEDIATE' | 'SCHEDULED',
                        })
                      }
                      className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                    >
                      <option value="IMMEDIATE">Buka Segera Saat Listing Aktif (Rekomendasi)</option>
                      <option value="SCHEDULED">Jadwal Khusus Pembukaan Deposit</option>
                    </select>

                    {formData.depositScheduleType === 'SCHEDULED' && (
                      <div className="mt-2">
                        <Input
                          label="Pilih Tanggal & Jam Buka Deposit"
                          type="datetime-local"
                          value={formData.depositOpenedAtDate}
                          onChange={e =>
                            setFormData({ ...formData, depositOpenedAtDate: e.target.value })
                          }
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1.5">
                      Jadwal Pembukaan Penarikan (Withdrawal)
                    </label>
                    <select
                      value={formData.withdrawalScheduleType}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          withdrawalScheduleType: e.target.value as 'IMMEDIATE' | 'SCHEDULED',
                        })
                      }
                      className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                    >
                      <option value="IMMEDIATE">Buka Segera Saat Listing Aktif</option>
                      <option value="SCHEDULED">Jadwal Khusus Pembukaan Withdrawal</option>
                    </select>

                    {formData.withdrawalScheduleType === 'SCHEDULED' && (
                      <div className="mt-2">
                        <Input
                          label="Pilih Tanggal & Jam Buka Withdrawal"
                          type="datetime-local"
                          value={formData.withdrawalOpenedAtDate}
                          onChange={e =>
                            setFormData({ ...formData, withdrawalOpenedAtDate: e.target.value })
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-[#202B34]">
                <Button type="button" variant="secondary" onClick={() => setActiveTab('EXPLORE')}>
                  Batal
                </Button>
                <Button type="submit" variant="primary" isLoading={isSubmittingApp}>
                  Kirim Pengajuan Listing
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 3: TRACK APPLICATION STATUS */}
        {activeTab === 'TRACK' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="p-6 rounded-[10px] bg-[#141C24] border border-[#202B34]">
              <h3 className="text-base font-semibold text-[#E4EBEF] mb-1">
                Lacak Status Pengajuan Listing
              </h3>
              <p className="text-xs text-[#A1AFB8] mb-4">
                Masukkan Kode Permohonan (Application ID) atau Simbol Token yang Anda daftarkan.
              </p>

              <div className="flex gap-2">
                <SearchInput
                  value={trackingQuery}
                  onChange={setTrackingQuery}
                  onKeyDown={e => e.key === 'Enter' && handleTrackApplication()}
                  placeholder="Contoh: REQ-..., SOL, ETH, BTC-IDR, atau email kontak"
                  className="flex-1"
                />
                <Button
                  variant="primary"
                  onClick={() => handleTrackApplication()}
                  isLoading={isTracking}
                >
                  Lacak
                </Button>
              </div>

              {recentApplications.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#202B34] flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-[#71818B]">Pengajuan Terakhir Anda:</span>
                  {recentApplications.map(app => (
                    <button
                      key={app.applicationId}
                      type="button"
                      onClick={() => handleTrackApplication(app.applicationId)}
                      className="px-2.5 py-1 rounded-[6px] bg-[#111820] hover:bg-[#17212B] border border-[#2B3944] text-[11px] font-mono text-[#C1D0D6] hover:text-[#E4EBEF] transition-colors cursor-pointer"
                    >
                      {app.tokenSymbol} · {app.applicationId}
                    </button>
                  ))}
                </div>
              )}

              {trackingError && (
                <div className="mt-3 p-3 rounded-[7px] bg-[#401F27]/50 border border-[#EA5B65]/40 text-xs text-[#EA5B65] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{trackingError}</span>
                </div>
              )}
            </div>

            {trackingResult && (
              <div className="p-6 rounded-[10px] bg-[#141C24] border border-[#202B34] space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#202B34] pb-4">
                  <div>
                    <span className="text-[10px] font-mono text-[#71818B] uppercase tracking-wider block">
                      {trackingResult.source === 'EXCHANGE_REGISTRY'
                        ? 'Aset Terdaftar di DIMONEX'
                        : 'Token Proposal'}
                    </span>
                    <h2 className="text-lg font-semibold text-[#E4EBEF] flex items-center gap-2 mt-0.5">
                      <span>{trackingResult.tokenName}</span>
                      <StatusBadge tone="brand">{trackingResult.tokenSymbol}</StatusBadge>
                    </h2>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[11px] font-mono text-[#A1AFB8]">
                        ID: {trackingResult.applicationId || trackingResult.id}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(trackingResult.applicationId || trackingResult.id)
                        }
                        className="p-1 rounded-[5px] bg-[#17212B] hover:bg-[#222F3A] text-[#A1AFB8] hover:text-[#E4EBEF] border border-[#2B3944] transition-colors cursor-pointer"
                        title="Salin Application ID"
                      >
                        {copiedId ? (
                          <Check className="w-3 h-3 text-[#16A879]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="sm:text-right">
                    <span className="text-[10px] text-[#71818B] block">Target Pasar</span>
                    <span className="font-mono text-xs font-semibold text-[#E4EBEF]">
                      {trackingResult.pair}
                    </span>
                  </div>
                </div>

                {(trackingResult.status === 'REJECTED' ||
                  trackingResult.status === 'CANCELLED' ||
                  trackingResult.status === 'RETIRED') && (
                  <div className="p-3.5 rounded-[7px] bg-[#401F27]/50 border border-[#EA5B65]/40 text-xs text-[#EA5B65] flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">
                        {trackingResult.status === 'REJECTED'
                          ? 'Pengajuan Ditolak oleh Komite Review'
                          : trackingResult.status === 'CANCELLED'
                          ? 'Pengajuan Dibatalkan'
                          : 'Aset Telah Dinonaktifkan / Delisted'}
                      </p>
                      {trackingResult.approvalReason && (
                        <p className="text-[#E4EBEF]/90 mt-0.5">{trackingResult.approvalReason}</p>
                      )}
                    </div>
                  </div>
                )}

                {trackingResult.status === 'SUSPENDED' && (
                  <div className="p-3.5 rounded-[7px] bg-[#3A2D14]/60 border border-[#E6B34B]/40 text-xs text-[#E6B34B] flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Pasar Sedang Disuspend Sementara</p>
                      <p className="text-[#E4EBEF]/90 mt-0.5">
                        Perdagangan untuk aset ini sementara dihentikan oleh tim operasional DIMONEX.
                      </p>
                    </div>
                  </div>
                )}

                {/* 4-Stage Progress */}
                <div>
                  <h4 className="text-xs font-semibold text-[#A1AFB8] mb-3">
                    Progres Verifikasi Maker-Checker & Engine Readiness
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    {[
                      {
                        stage: 1,
                        title: 'Penerimaan & Dokumen',
                        desc: 'Format kontrak & identitas',
                      },
                      {
                        stage: 2,
                        title: 'Maker Review',
                        desc: 'Parameter tick & lot size',
                      },
                      {
                        stage: 3,
                        title: 'Checker Approval',
                        desc: 'Audit independen Bappebti',
                      },
                      {
                        stage: 4,
                        title: 'Aktivasi Spot',
                        desc: 'Pasar live & order book',
                      },
                    ].map(step => {
                      const isRejectedOrCancelled = trackingResult.stage === 0;
                      const done = !isRejectedOrCancelled && trackingResult.stage >= step.stage;
                      const current =
                        !isRejectedOrCancelled && trackingResult.stage === step.stage - 1;
                      return (
                        <div
                          key={step.stage}
                          className={`p-3 rounded-[7px] border ${
                            done
                              ? 'bg-[#111820] border-[#16A879]/50 text-[#E4EBEF]'
                              : current
                              ? 'bg-[#17212B] border-[#8DA5B1]/60 text-[#E4EBEF]'
                              : 'bg-[#090D12] border-[#202B34] text-[#71818B]'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-mono font-semibold">
                              TAHAP {step.stage}
                            </span>
                            {done && <CheckCircle2 className="w-3.5 h-3.5 text-[#16A879]" />}
                          </div>
                          <p className="text-xs font-semibold">{step.title}</p>
                          <p className="text-[10px] text-[#71818B] mt-0.5">{step.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Details */}
                <div className="p-4 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#A1AFB8]">Status Terkini:</span>
                    <StatusBadge
                      tone={
                        trackingResult.status === 'ACTIVE'
                          ? 'buy'
                          : trackingResult.status === 'REJECTED' ||
                            trackingResult.status === 'CANCELLED' ||
                            trackingResult.status === 'RETIRED'
                          ? 'sell'
                          : trackingResult.status === 'SUSPENDED' ||
                            trackingResult.status === 'SCHEDULED'
                          ? 'warning'
                          : 'brand'
                      }
                    >
                      {trackingResult.stageName} ({trackingResult.status})
                    </StatusBadge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#A1AFB8]">Jaringan Token:</span>
                    <span className="font-mono text-[#E4EBEF]">{trackingResult.network}</span>
                  </div>
                  {trackingResult.scheduledAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#A1AFB8]">Jadwal Peluncuran Spot:</span>
                      <span className="font-mono text-[#E6B34B]">
                        {new Date(trackingResult.scheduledAt).toLocaleString('id-ID')}
                      </span>
                    </div>
                  )}
                  {trackingResult.createdAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#A1AFB8]">Waktu Pengajuan / Terdaftar:</span>
                      <span className="font-mono text-[#C1D0D6]">
                        {new Date(trackingResult.createdAt).toLocaleString('id-ID')}
                      </span>
                    </div>
                  )}
                  {trackingResult.updatedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#A1AFB8]">Pembaruan Terakhir:</span>
                      <span className="font-mono text-[#C1D0D6]">
                        {new Date(trackingResult.updatedAt).toLocaleString('id-ID')}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-[#202B34]">
                    <span className="text-[#A1AFB8]">Saluran Deposit:</span>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={trackingResult.depositStatus === 'OPEN' ? 'buy' : 'neutral'}>
                        {trackingResult.depositStatus === 'OPEN' ? 'DIBUKA' : 'DITUTUP'}
                      </StatusBadge>
                      {trackingResult.depositOpenedAt && (
                        <span className="text-[10px] text-[#71818B] font-mono">
                          (Buka: {new Date(trackingResult.depositOpenedAt).toLocaleString('id-ID')})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[#A1AFB8]">Saluran Penarikan (WD):</span>
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        tone={trackingResult.withdrawalStatus === 'OPEN' ? 'buy' : 'neutral'}
                      >
                        {trackingResult.withdrawalStatus === 'OPEN' ? 'DIBUKA' : 'DITUTUP'}
                      </StatusBadge>
                      {trackingResult.withdrawalOpenedAt && (
                        <span className="text-[10px] text-[#71818B] font-mono">
                          (Buka:{' '}
                          {new Date(trackingResult.withdrawalOpenedAt).toLocaleString('id-ID')})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[#202B34]">
                    <span className="text-[#A1AFB8]">Designated Market Maker:</span>
                    <span className="font-mono text-[#E4EBEF] text-[11px]">
                      {trackingResult.marketMakerEmail || 'mm@dimonex.id'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[#A1AFB8]">Akun Trader Project Owner:</span>
                    <span className="font-mono text-[#E4EBEF] text-[11px]">
                      {trackingResult.projectOwnerEmail ||
                        trackingResult.projectOwnerAccountId ||
                        'Belum Terdaftar'}
                    </span>
                  </div>

                  {trackingResult.approvalReason && (
                    <div className="flex items-start justify-between gap-4 pt-2 border-t border-[#202B34]">
                      <span className="text-[#A1AFB8]">Catatan Review:</span>
                      <span
                        className={`text-right font-medium ${
                          trackingResult.status === 'REJECTED' ? 'text-[#EA5B65]' : 'text-[#35B887]'
                        }`}
                      >
                        {trackingResult.approvalReason}
                      </span>
                    </div>
                  )}
                </div>

                {trackingResult.marketActive && (
                  <div className="pt-1 flex justify-end">
                    <Button
                      variant="profit"
                      onClick={() => {
                        onSelectPair(trackingResult.pair.replace('/', '-'));
                        onSelectView('TRADE');
                      }}
                    >
                      <span>Buka Terminal Trading Spot</span>
                      <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: ADMIN & MAKER-CHECKER CONSOLE */}
        {activeTab === 'ADMIN_CONSOLE' && (
          <div className="space-y-6">
            <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34] flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-[7px] bg-[#162436] border border-[#6D9FE8]/30 flex items-center justify-center text-[#6D9FE8]">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#E4EBEF] flex items-center gap-2">
                    <span>Pengujian Tata Kelola Maker-Checker DIMONEX</span>
                    <StatusBadge tone="info">Live Multi-Role</StatusBadge>
                  </div>
                  <p className="text-[11px] text-[#A1AFB8]">
                    Role aktif:{' '}
                    <strong className="text-[#E4EBEF] font-mono">
                      {user ? `${user.email} (${user.role.toUpperCase()})` : 'Belum Login'}
                    </strong>
                    . Pilih profil demo untuk menguji validasi self-approval dan otorisasi.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onQuickLogin('admin@dimonex.id', 'AdminDimonex2026!')}
                >
                  Masuk sebagai Maker Admin
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onQuickLogin('compliance@dimonex.id', 'ComplianceAdmin2026!')}
                >
                  Masuk sebagai Checker Admin
                </Button>
              </div>
            </div>

            <ListingManagementView
              currentUser={
                user || { id: 'admin-preview', role: 'admin', email: 'admin@dimonex.id' }
              }
              onRefreshMarkets={loadPublicAssets}
            />
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      <Modal
        isOpen={!!submittedResult}
        onClose={() => setSubmittedResult(null)}
        title="Pengajuan Listing Berhasil Dikirim"
        maxWidth="max-w-md"
      >
        <div className="py-2 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-[#12392F] border border-[#16A879]/40 flex items-center justify-center mx-auto text-[#16A879]">
            <CheckCircle2 className="w-6 h-6" />
          </div>

          <div>
            <h3 className="text-base font-semibold text-[#E4EBEF]">
              Proposal {submittedResult?.tokenSymbol} Berhasil Terdaftar
            </h3>
            <p className="text-xs text-[#A1AFB8] mt-1 max-w-sm mx-auto">
              {submittedResult?.trackingMessage}
            </p>
          </div>

          <div className="p-3.5 rounded-[7px] bg-[#111820] border border-[#202B34] text-left">
            <span className="text-[10px] text-[#71818B] block uppercase font-mono font-semibold tracking-wider mb-1">
              Nomor Pelacakan Pengajuan (Application ID)
            </span>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold text-[#C1D0D6] select-all">
                {submittedResult?.applicationId}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(submittedResult?.applicationId || '')}
                className="p-1.5 rounded-[6px] bg-[#17212B] hover:bg-[#222F3A] text-[#A1AFB8] hover:text-[#E4EBEF] border border-[#2B3944] transition-colors cursor-pointer"
                title="Salin ID"
              >
                {copiedId ? (
                  <Check className="w-4 h-4 text-[#16A879]" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div className="pt-2 flex justify-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSubmittedResult(null);
                setActiveTab('EXPLORE');
              }}
            >
              Lihat Daftar Aset
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const id = submittedResult?.applicationId;
                setSubmittedResult(null);
                setTrackingQuery(id);
                setActiveTab('TRACK');
                handleTrackApplication(id);
              }}
            >
              Lacak Status Sekarang
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
