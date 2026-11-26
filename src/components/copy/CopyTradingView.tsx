/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/copy/CopyTradingView.tsx
 * DIMONEX Institutional Copy Trading Terminal — Real Ledger & OrderBook Engine
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users,
  ShieldAlert,
  TrendingUp,
  Pause,
  Play,
  Square,
  Award,
  Send,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Modal } from '../ui/Modal.js';
import { PageHeader } from '../ui/PanelHeader.js';
import { SegmentedTabs } from '../ui/Tabs.js';
import { SearchInput, FilterBar } from '../ui/Controls.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { EmptyState } from '../ui/StateViews.js';
import { useToast } from '../ui/Toast.js';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { UserProfile, UserBalance } from '../../types/index.js';

interface Props {
  user: UserProfile | null;
  balances: UserBalance[];
  onOpenAuthModal: () => void;
  displayCurrency: 'USDT' | 'IDR';
}

export interface LeadTrader {
  id: string;
  userId: string;
  name: string;
  handle: string;
  avatarInitial: string;
  badge: 'ELITE' | 'MASTER' | 'PRO';
  strategySummary: string;
  primaryPair: string;
  asset: string;
  supportedPairs: string[];
  status: 'PENDING' | 'APPROVED' | 'PAUSED' | 'REJECTED';
  profitShareBps: number;
  profitSharePct: number;
  minCopyUsdt: number;
  minCopyIdr: number;
  maxFollowers: number;
  riskScore: number;
  roi30d: number;
  roi90d: number;
  winRate: number;
  maxDrawdown: number;
  aumUsdt: number;
  aumIdr: number;
  aum: string;
  followers: number;
  activeDays: number;
  totalTrades: number;
  recentPairs: string[];
}

interface MasterRecentTrade {
  id: string;
  pairId: string;
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  quoteVolume: string;
  createdAt: number;
}

interface CopyPosition {
  symbol: string;
  qtyUnits: string;
  qtyDisplay: string;
  avgEntryPriceDisplay: string;
  currentValueDisplay: string;
  pnlUnits: string;
  pnlPct: number;
}

interface MirroredOrderItem {
  id: string;
  pairId: string;
  side: 'BUY' | 'SELL';
  status: 'FILLED' | 'SKIPPED' | 'FAILED';
  priceDisplay: string;
  qtyDisplay: string;
  note?: string;
  createdAt: number;
}

interface CopyPortfolio {
  id: string;
  masterId: string;
  traderName: string;
  handle: string;
  badge: 'ELITE' | 'MASTER' | 'PRO';
  primaryPair: string;
  profitSharePct: number;
  status: 'ACTIVE' | 'PAUSED' | 'STOPPED';
  allocationCurrency: 'USDT' | 'IDR';
  allocatedUnits: string;
  allocatedDisplay: string;
  currentValueUnits: string;
  currentValueDisplay: string;
  availableSleeveUnits: string;
  availableSleeveDisplay: string;
  netPnlUnits: string;
  netPnlNum: number;
  pnlPct: number;
  profitSharePaidUnits: string;
  stopLossPct: number;
  takeProfitPct: number;
  maxPerTradePct: number;
  mirroredTradesCount: number;
  stopReason?: string;
  startedAt: number;
  stoppedAt?: number;
  positions: CopyPosition[];
  mirroredOrders: MirroredOrderItem[];
}

function formatCurrencyValue(currency: 'USDT' | 'IDR', num: number, signed = false): string {
  const prefix = signed ? (num > 0 ? '+' : num < 0 ? '-' : '') : num < 0 ? '-' : '';
  const absVal = Math.abs(num);
  if (currency === 'IDR') {
    return `${prefix}Rp ${Math.round(absVal).toLocaleString('id-ID')}`;
  }
  return `${prefix}$${absVal.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getSpotAvailableNumber(balances: UserBalance[], currency: 'USDT' | 'IDR'): number {
  const b = balances.find(item => item.currency === currency);
  if (!b) return 0;
  if (b.displayAvailable !== undefined && b.displayAvailable !== '') {
    const parsed = parseFloat(String(b.displayAvailable));
    if (Number.isFinite(parsed)) return parsed;
  }
  if (b.available !== undefined) {
    const parsed = parseFloat(String(b.available));
    if (Number.isFinite(parsed)) return parsed;
  }
  const divisor = currency === 'IDR' ? 100 : 1_000_000;
  const raw = parseFloat(String(b.balanceAvailable || '0'));
  return Number.isFinite(raw) ? raw / divisor : 0;
}

export const CopyTradingView: React.FC<Props> = ({
  user,
  balances,
  onOpenAuthModal,
  displayCurrency,
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'LEADERBOARD' | 'MY_COPIES'>('LEADERBOARD');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'roi30d' | 'winRate' | 'followers' | 'aum'>('roi30d');

  // Live backend state
  const [traders, setTraders] = useState<LeadTrader[]>([]);
  const [myCopies, setMyCopies] = useState<CopyPortfolio[]>([]);
  const [myMaster, setMyMaster] = useState<LeadTrader | null>(null);
  const [loadingMasters, setLoadingMasters] = useState<boolean>(true);
  const [loadingMyCopies, setLoadingMyCopies] = useState<boolean>(false);
  const [copyStatusFilter, setCopyStatusFilter] = useState<'ALL' | 'ACTIVE' | 'STOPPED'>('ALL');

  // Detail modal
  const [detailTrader, setDetailTrader] = useState<LeadTrader | null>(null);
  const [detailTrades, setDetailTrades] = useState<MasterRecentTrade[]>([]);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  // Follow modal
  const [selectedTrader, setSelectedTrader] = useState<LeadTrader | null>(null);
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
  const [allocationCurrency, setAllocationCurrency] = useState<'USDT' | 'IDR'>(displayCurrency);
  const [copyAmount, setCopyAmount] = useState(displayCurrency === 'IDR' ? '1000000' : '100');
  const [stopLossPct, setStopLossPct] = useState('15');
  const [takeProfitPct, setTakeProfitPct] = useState('50');
  const [maxPerTradePct, setMaxPerTradePct] = useState('25');
  const [isSubmittingFollow, setIsSubmittingFollow] = useState(false);

  // Stop confirmation modal
  const [stopTarget, setStopTarget] = useState<CopyPortfolio | null>(null);
  const [busyRelId, setBusyRelId] = useState<string | null>(null);

  // Apply Master modal
  const [isApplyMasterOpen, setIsApplyMasterOpen] = useState(false);
  const [masterName, setMasterName] = useState('');
  const [masterHandle, setMasterHandle] = useState('');
  const [masterStrategy, setMasterStrategy] = useState('');
  const [masterPair, setMasterPair] = useState('BTC-IDR');
  const [masterProfitShare, setMasterProfitShare] = useState('10');
  const [masterMinCopyUsdt, setMasterMinCopyUsdt] = useState('25');
  const [isSubmittingMaster, setIsSubmittingMaster] = useState(false);

  // Master Signal execution modal
  const [isSignalOpen, setIsSignalOpen] = useState(false);
  const [signalPair, setSignalPair] = useState('BTC-IDR');
  const [signalSide, setSignalSide] = useState<'BUY' | 'SELL'>('BUY');
  const [signalQty, setSignalQty] = useState('0.001');
  const [signalOrderType, setSignalOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [signalPrice, setSignalPrice] = useState('');
  const [isSubmittingSignal, setIsSubmittingSignal] = useState(false);

  const fetchMasters = useCallback(async (signal?: AbortSignal) => {
    const res = await safeFetchJson<{ success: boolean; masters: LeadTrader[] }>(
      '/api/copy-trading/masters',
      { signal },
      { retries: 1 }
    );
    if (res.aborted) return;
    if (res.ok && res.data?.masters) {
      setTraders(res.data.masters);
    }
    setLoadingMasters(false);
  }, []);

  const fetchMyCopies = useCallback(
    async (signal?: AbortSignal) => {
      if (!user) {
        setMyCopies([]);
        setMyMaster(null);
        return;
      }
      const token = localStorage.getItem('dimonex_auth_token');
      if (!token) return;
      setLoadingMyCopies(true);
      const res = await safeFetchJson<{
        success: boolean;
        copies: CopyPortfolio[];
        myMaster: LeadTrader | null;
      }>(
        '/api/copy-trading/my-copies',
        {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        },
        { retries: 1 }
      );
      if (res.aborted) return;
      if (res.ok && res.data) {
        setMyCopies(res.data.copies || []);
        setMyMaster(res.data.myMaster || null);
      }
      setLoadingMyCopies(false);
    },
    [user]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchMasters(controller.signal);
    if (user) {
      fetchMyCopies(controller.signal);
    } else {
      setMyCopies([]);
      setMyMaster(null);
    }

    const timer = setInterval(() => {
      if (document.hidden) return;
      fetchMasters();
      if (user) fetchMyCopies();
    }, 15000);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [fetchMasters, fetchMyCopies, user]);

  const availableUsdt = useMemo(() => getSpotAvailableNumber(balances, 'USDT'), [balances]);
  const availableIdr = useMemo(() => getSpotAvailableNumber(balances, 'IDR'), [balances]);

  const activeCopiesCount = useMemo(
    () => myCopies.filter(c => c.status !== 'STOPPED').length,
    [myCopies]
  );

  const filteredTraders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return traders
      .filter(
        t =>
          !q ||
          t.name.toLowerCase().includes(q) ||
          t.handle.toLowerCase().includes(q) ||
          t.primaryPair.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        if (sortBy === 'aum') return (b.aumUsdt || 0) - (a.aumUsdt || 0);
        return (b[sortBy] || 0) - (a[sortBy] || 0);
      });
  }, [traders, search, sortBy]);

  const filteredCopies = useMemo(() => {
    if (copyStatusFilter === 'ACTIVE') return myCopies.filter(c => c.status !== 'STOPPED');
    if (copyStatusFilter === 'STOPPED') return myCopies.filter(c => c.status === 'STOPPED');
    return myCopies;
  }, [myCopies, copyStatusFilter]);

  const handleOpenDetail = async (trader: LeadTrader) => {
    setDetailTrader(trader);
    setDetailTrades([]);
    setLoadingDetail(true);
    const res = await safeFetchJson<{
      success: boolean;
      master: LeadTrader;
      recentTrades: MasterRecentTrade[];
    }>(`/api/copy-trading/masters/${encodeURIComponent(trader.id)}`);
    setLoadingDetail(false);
    if (res.ok && res.data) {
      setDetailTrader(res.data.master);
      setDetailTrades(res.data.recentTrades || []);
    }
  };

  const handleOpenCopy = (trader: LeadTrader) => {
    if (!user) {
      onOpenAuthModal();
      return;
    }
    setSelectedTrader(trader);
    const defaultCurr = displayCurrency === 'IDR' ? 'IDR' : 'USDT';
    setAllocationCurrency(defaultCurr);
    setCopyAmount(
      defaultCurr === 'IDR'
        ? String(Math.max(trader.minCopyIdr || 200000, 500000))
        : String(Math.max(trader.minCopyUsdt || 25, 50))
    );
    setStopLossPct('15');
    setTakeProfitPct('50');
    setMaxPerTradePct('25');
    setIsCopyModalOpen(true);
  };

  const handleSwitchAllocCurrency = (curr: 'USDT' | 'IDR') => {
    setAllocationCurrency(curr);
    if (selectedTrader) {
      setCopyAmount(
        curr === 'IDR'
          ? String(Math.max(selectedTrader.minCopyIdr || 200000, 500000))
          : String(Math.max(selectedTrader.minCopyUsdt || 25, 50))
      );
    }
  };

  const handleConfirmCopy = async () => {
    if (!selectedTrader) return;
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      onOpenAuthModal();
      return;
    }
    const amountNum = parseFloat(copyAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      showToast('error', 'Nominal Tidak Valid', 'Masukkan nominal modal copy trading yang valid.');
      return;
    }

    setIsSubmittingFollow(true);
    const res = await safeFetchJson<{ success: boolean; message?: string }>(
      '/api/copy-trading/follow',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          masterId: selectedTrader.id,
          allocationCurrency,
          amount: copyAmount.trim(),
          stopLossPct: parseFloat(stopLossPct) || 15,
          takeProfitPct: parseFloat(takeProfitPct) || 50,
          maxPerTradePct: parseFloat(maxPerTradePct) || 25,
        }),
      }
    );
    setIsSubmittingFollow(false);

    if (!res.ok) {
      showToast('error', 'Gagal Memulai Copy Trading', res.error || 'Terjadi kesalahan sistem.');
      return;
    }

    setIsCopyModalOpen(false);
    showToast(
      'success',
      'Copy Trading Aktif',
      res.data?.message || `Mulai menyalin ${selectedTrader.name} dengan modal ${copyAmount} ${allocationCurrency}.`
    );
    await Promise.all([fetchMasters(), fetchMyCopies()]);
    setActiveTab('MY_COPIES');
  };

  const handleTogglePause = async (copy: CopyPortfolio) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const endpoint = copy.status === 'ACTIVE' ? '/api/copy-trading/pause' : '/api/copy-trading/resume';
    setBusyRelId(copy.id);
    const res = await safeFetchJson<{ success: boolean; message?: string }>(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ relationshipId: copy.id }),
    });
    setBusyRelId(null);

    if (!res.ok) {
      showToast('error', 'Gagal Mengubah Status', res.error || 'Tidak dapat mengubah status copy.');
      return;
    }
    showToast('info', 'Status Diperbarui', res.data?.message || 'Status kontrak diperbarui.');
    await fetchMyCopies();
  };

  const handleConfirmStop = async () => {
    if (!stopTarget) return;
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    setBusyRelId(stopTarget.id);
    const res = await safeFetchJson<{ success: boolean; message?: string }>(
      '/api/copy-trading/stop',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ relationshipId: stopTarget.id }),
      }
    );
    setBusyRelId(null);

    if (!res.ok) {
      showToast('error', 'Gagal Menghentikan Copy', res.error || 'Gagal melikuidasi sleeve copy.');
      return;
    }

    const name = stopTarget.traderName;
    setStopTarget(null);
    showToast(
      'success',
      'Copy Trading Dihentikan',
      res.data?.message || `Dana sleeve dari ${name} berhasil diselesaikan ke Spot Wallet.`
    );
    await Promise.all([fetchMasters(), fetchMyCopies()]);
  };

  const handleApplyMaster = async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      onOpenAuthModal();
      return;
    }
    setIsSubmittingMaster(true);
    const res = await safeFetchJson<{ success: boolean; message?: string }>(
      '/api/copy-trading/apply-master',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: masterName.trim(),
          handle: masterHandle.trim(),
          strategySummary: masterStrategy.trim(),
          primaryPair: masterPair,
          profitSharePct: parseFloat(masterProfitShare) || 10,
          minCopyUsdt: parseFloat(masterMinCopyUsdt) || 25,
        }),
      }
    );
    setIsSubmittingMaster(false);

    if (!res.ok) {
      showToast('error', 'Pengajuan Gagal', res.error || 'Periksa kembali kelengkapan data.');
      return;
    }

    setIsApplyMasterOpen(false);
    showToast(
      'success',
      'Pengajuan Master Terkirim',
      res.data?.message || 'Menunggu verifikasi Admin.'
    );
    await fetchMyCopies();
  };

  const handleExecuteMasterSignal = async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    setIsSubmittingSignal(true);
    const res = await safeFetchJson<{ success: boolean; message?: string }>(
      '/api/copy-trading/master/signal',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pairId: signalPair,
          side: signalSide,
          quantity: signalQty.trim(),
          orderType: signalOrderType,
          price: signalOrderType === 'LIMIT' ? signalPrice.trim() : undefined,
        }),
      }
    );
    setIsSubmittingSignal(false);

    if (!res.ok) {
      showToast('error', 'Eksekusi Sinyal Gagal', res.error || 'Pastikan saldo & orderbook mencukupi.');
      return;
    }

    setIsSignalOpen(false);
    showToast('success', 'Sinyal Master Tereksekusi', res.data?.message || 'Order berhasil disalin.');
    await Promise.all([fetchMasters(), fetchMyCopies()]);
  };

  const selectedAllocAvail = allocationCurrency === 'IDR' ? availableIdr : availableUsdt;

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto space-y-6">
      <div className="max-w-7xl w-full mx-auto space-y-6">
        <PageHeader
          title="Institutional Copy Trading"
          subtitle="Replikasi otomatis setiap eksekusi Spot Master Trader terverifikasi dengan isolasi modal ledger, perlindungan Stop-Loss, dan High-Water Mark."
          badge={
            <StatusBadge tone="brand" dot>
              DIMONEX Copy Engine
            </StatusBadge>
          }
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              {user && myMaster ? (
                myMaster.status === 'APPROVED' ? (
                  <Button
                    variant="profit"
                    size="sm"
                    icon={<Send className="w-3.5 h-3.5" />}
                    onClick={() => {
                      setSignalPair(myMaster.primaryPair || 'BTC-IDR');
                      setIsSignalOpen(true);
                    }}
                  >
                    Eksekusi Sinyal Master
                  </Button>
                ) : (
                  <StatusBadge tone={myMaster.status === 'PENDING' ? 'warning' : 'danger'} dot>
                    Status Master: {myMaster.status}
                  </StatusBadge>
                )
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Award className="w-3.5 h-3.5" />}
                  onClick={() => {
                    if (!user) {
                      onOpenAuthModal();
                      return;
                    }
                    setMasterName(user.fullName || user.email.split('@')[0]);
                    setMasterHandle(`@${(user.email.split('@')[0] || 'trader').replace(/[^a-zA-Z0-9_]/g, '')}`);
                    setIsApplyMasterOpen(true);
                  }}
                >
                  Jadi Master Trader
                </Button>
              )}

              <SegmentedTabs
                activeTab={activeTab}
                onChange={setActiveTab}
                tabs={[
                  { id: 'LEADERBOARD', label: 'Leaderboard Master', badge: traders.length },
                  { id: 'MY_COPIES', label: 'Portofolio Copy Saya', badge: activeCopiesCount },
                ]}
              />
            </div>
          }
        />

        {activeTab === 'LEADERBOARD' && (
          <div className="space-y-4">
            <FilterBar>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Cari nama master trader, handle, atau pair..."
                className="w-full sm:w-80"
              />

              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="text-[11px] text-[#71818B] shrink-0">Urutkan:</span>
                <SegmentedTabs
                  size="sm"
                  activeTab={sortBy}
                  onChange={setSortBy}
                  tabs={[
                    { id: 'roi30d', label: 'ROI 30H' },
                    { id: 'winRate', label: 'Win Rate' },
                    { id: 'followers', label: 'Pengikut' },
                    { id: 'aum', label: 'AUM' },
                  ]}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchMasters()}
                  title="Segarkan Data Master"
                  icon={<RefreshCw className={`w-3.5 h-3.5 ${loadingMasters ? 'animate-spin' : ''}`} />}
                />
              </div>
            </FilterBar>

            {loadingMasters && traders.length === 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(idx => (
                  <div
                    key={idx}
                    className="h-72 rounded-[10px] bg-[#141C24] border border-[#202B34] animate-pulse"
                  />
                ))}
              </div>
            ) : filteredTraders.length === 0 ? (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34]">
                <EmptyState
                  icon={<Users className="w-6 h-6" />}
                  title="Belum Ada Master Trader Cocok"
                  description="Tidak ditemukan Master Trader aktif untuk kata kunci pencarian tersebut."
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredTraders.map(trader => {
                  const isFull = trader.followers >= trader.maxFollowers;
                  const isOwnMaster = Boolean(user && trader.userId === user.id);
                  const alreadyCopied = myCopies.some(
                    c => c.masterId === trader.id && c.status !== 'STOPPED'
                  );

                  return (
                    <div
                      key={trader.id}
                      className="rounded-[10px] bg-[#141C24] border border-[#202B34] hover:border-[#40515D] p-5 flex flex-col justify-between transition-colors"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-[7px] bg-[#1D2832] border border-[#2B3944] flex items-center justify-center font-mono font-semibold text-[#C1D0D6] text-xs shrink-0">
                              {trader.avatarInitial}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-sm text-[#E4EBEF] truncate">
                                  {trader.name}
                                </span>
                                <StatusBadge tone="brand">{trader.badge}</StatusBadge>
                              </div>
                              <span className="text-[11px] text-[#71818B] font-mono">
                                {trader.handle} · {trader.activeDays} hari
                              </span>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="text-[10px] text-[#71818B] block">Skor Risiko</span>
                            <span
                              className={`text-xs font-mono tabular-nums font-semibold ${
                                trader.riskScore <= 3
                                  ? 'text-[#16A879]'
                                  : trader.riskScore <= 6
                                  ? 'text-[#D6A85C]'
                                  : 'text-[#EA5B65]'
                              }`}
                            >
                              {trader.riskScore}/10
                            </span>
                          </div>
                        </div>

                        <p className="text-[11px] text-[#A1AFB8] line-clamp-2 mb-3 leading-relaxed">
                          {trader.strategySummary}
                        </p>

                        <div className="grid grid-cols-2 gap-2.5 p-3 rounded-[7px] bg-[#111820] border border-[#202B34] mb-4">
                          <div>
                            <span className="text-[10px] text-[#71818B] block">ROI 30 Hari</span>
                            <span
                              className={`text-base font-mono tabular-nums font-semibold ${
                                trader.roi30d >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'
                              }`}
                            >
                              {trader.roi30d >= 0 ? '+' : ''}
                              {trader.roi30d.toFixed(2)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-[#71818B] block">ROI 90 Hari</span>
                            <span
                              className={`text-sm font-mono tabular-nums font-semibold ${
                                trader.roi90d >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'
                              }`}
                            >
                              {trader.roi90d >= 0 ? '+' : ''}
                              {trader.roi90d.toFixed(2)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-[#71818B] block">Win Rate ({trader.totalTrades} trade)</span>
                            <span className="text-xs font-mono tabular-nums font-semibold text-[#E4EBEF]">
                              {trader.winRate.toFixed(1)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-[#71818B] block">Max Drawdown</span>
                            <span className="text-xs font-mono tabular-nums font-semibold text-[#EA5B65]">
                              -{trader.maxDrawdown.toFixed(2)}%
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-[#A1AFB8] mb-3 pb-2.5 border-b border-[#202B34]">
                          <span>
                            AUM:{' '}
                            <strong className="text-[#E4EBEF] font-mono tabular-nums">
                              {displayCurrency === 'IDR'
                                ? `Rp ${Math.round(trader.aumIdr || 0).toLocaleString('id-ID')}`
                                : trader.aum}
                            </strong>
                          </span>
                          <span>
                            Pengikut:{' '}
                            <strong className="text-[#E4EBEF] font-mono tabular-nums">
                              {trader.followers}/{trader.maxFollowers}
                            </strong>
                          </span>
                          <span>
                            Share:{' '}
                            <strong className="text-[#E4EBEF] font-mono tabular-nums">
                              {trader.profitSharePct}%
                            </strong>
                          </span>
                        </div>

                        <div className="flex items-center flex-wrap gap-1.5 mb-4">
                          <span className="text-[10px] text-[#71818B]">Pair:</span>
                          {trader.recentPairs.map(p => (
                            <span
                              key={p}
                              className="px-1.5 py-0.5 text-[10px] font-mono rounded-[5px] bg-[#17212B] text-[#A1AFB8] border border-[#202B34]"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          icon={<Eye className="w-3.5 h-3.5" />}
                          onClick={() => handleOpenDetail(trader)}
                        >
                          Detail
                        </Button>
                        <Button
                          variant={isFull || isOwnMaster || alreadyCopied ? 'secondary' : 'primary'}
                          size="sm"
                          className="flex-1"
                          disabled={isFull || isOwnMaster}
                          onClick={() => {
                            if (alreadyCopied) {
                              setActiveTab('MY_COPIES');
                            } else {
                              handleOpenCopy(trader);
                            }
                          }}
                        >
                          {isOwnMaster
                            ? 'Akun Master Anda'
                            : alreadyCopied
                            ? 'Kelola di Copy Saya'
                            : isFull
                            ? 'Kuota Penuh'
                            : 'Salin Trader'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'MY_COPIES' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <SegmentedTabs
                size="sm"
                activeTab={copyStatusFilter}
                onChange={setCopyStatusFilter}
                tabs={[
                  { id: 'ALL', label: 'Semua Kontrak', badge: myCopies.length },
                  { id: 'ACTIVE', label: 'Aktif / Dijeda', badge: activeCopiesCount },
                  {
                    id: 'STOPPED',
                    label: 'Selesai',
                    badge: myCopies.filter(c => c.status === 'STOPPED').length,
                  },
                ]}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchMyCopies()}
                icon={<RefreshCw className={`w-3.5 h-3.5 ${loadingMyCopies ? 'animate-spin' : ''}`} />}
              >
                Segarkan Portofolio
              </Button>
            </div>

            {!user ? (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34]">
                <EmptyState
                  icon={<Users className="w-6 h-6" />}
                  title="Masuk untuk Melihat Portofolio Copy Trading"
                  description="Kontrak copy trading Anda tersimpan aman di buku besar double-entry DIMONEX."
                  action={
                    <Button variant="primary" size="sm" onClick={onOpenAuthModal}>
                      Masuk / Daftar
                    </Button>
                  }
                />
              </div>
            ) : filteredCopies.length === 0 ? (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34]">
                <EmptyState
                  icon={<Users className="w-6 h-6" />}
                  title="Belum Ada Portofolio Copy Trading"
                  description="Pilih Master Trader terverifikasi di tab Leaderboard untuk mengalokasikan modal Spot Anda."
                  action={
                    <Button variant="primary" size="sm" onClick={() => setActiveTab('LEADERBOARD')}>
                      Jelajahi Leaderboard
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="space-y-4">
                {filteredCopies.map(copy => {
                  const isStopped = copy.status === 'STOPPED';
                  const isPaused = copy.status === 'PAUSED';
                  const isPositive = copy.netPnlNum >= 0;
                  const allocNum = parseFloat(copy.allocatedDisplay || '0');
                  const currValNum = parseFloat(copy.currentValueDisplay || '0');
                  const profitShareNum =
                    parseFloat(copy.profitSharePaidUnits || '0') /
                    (copy.allocationCurrency === 'IDR' ? 100 : 1_000_000);

                  return (
                    <div
                      key={copy.id}
                      className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 space-y-4"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#202B34]">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-base font-semibold text-[#E4EBEF]">
                              {copy.traderName}
                            </span>
                            <span className="text-xs font-mono text-[#71818B]">{copy.handle}</span>
                            <StatusBadge tone="brand">{copy.badge}</StatusBadge>
                            <StatusBadge
                              tone={
                                copy.status === 'ACTIVE'
                                  ? 'buy'
                                  : copy.status === 'PAUSED'
                                  ? 'warning'
                                  : 'neutral'
                              }
                              dot
                            >
                              {copy.status}
                            </StatusBadge>
                          </div>
                          <span className="text-[11px] text-[#71818B]">
                            Dimulai {new Date(copy.startedAt).toLocaleString('id-ID')} ·{' '}
                            {copy.mirroredTradesCount} order tereksekusi
                            {copy.stopReason ? ` · ${copy.stopReason}` : ''}
                          </span>
                        </div>

                        <div className="flex items-center gap-2.5 flex-wrap">
                          <div className="text-right mr-1">
                            <span className="text-[10px] text-[#71818B] block">Net PnL Sleeve</span>
                            <span
                              className={`text-sm font-mono tabular-nums font-semibold ${
                                isPositive ? 'text-[#16A879]' : 'text-[#EA5B65]'
                              }`}
                            >
                              {formatCurrencyValue(copy.allocationCurrency, copy.netPnlNum, true)} (
                              {copy.pnlPct >= 0 ? '+' : ''}
                              {copy.pnlPct.toFixed(2)}%)
                            </span>
                          </div>

                          {!isStopped && (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                isLoading={busyRelId === copy.id}
                                icon={
                                  isPaused ? (
                                    <Play className="w-3.5 h-3.5" />
                                  ) : (
                                    <Pause className="w-3.5 h-3.5" />
                                  )
                                }
                                onClick={() => handleTogglePause(copy)}
                              >
                                {isPaused ? 'Lanjutkan' : 'Jeda'}
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                isLoading={busyRelId === copy.id}
                                icon={<Square className="w-3.5 h-3.5" />}
                                onClick={() => setStopTarget(copy)}
                              >
                                Hentikan & Tarik
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
                          <span className="text-[10px] text-[#71818B] block">Modal Awal Sleeve</span>
                          <span className="font-mono tabular-nums font-semibold text-[#E4EBEF]">
                            {formatCurrencyValue(copy.allocationCurrency, allocNum)}
                          </span>
                        </div>
                        <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
                          <span className="text-[10px] text-[#71818B] block">
                            Valuasi Saat Ini ({copy.allocationCurrency})
                          </span>
                          <span className="font-mono tabular-nums font-semibold text-[#E4EBEF]">
                            {formatCurrencyValue(copy.allocationCurrency, currValNum)}
                          </span>
                        </div>
                        <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
                          <span className="text-[10px] text-[#71818B] block">
                            Kas Tersedia di Sleeve
                          </span>
                          <span className="font-mono tabular-nums font-semibold text-[#E4EBEF]">
                            {formatCurrencyValue(
                              copy.allocationCurrency,
                              parseFloat(copy.availableSleeveDisplay || '0')
                            )}
                          </span>
                        </div>
                        <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
                          <span className="text-[10px] text-[#71818B] block">
                            Guard SL / TP / Share
                          </span>
                          <span className="font-mono tabular-nums font-semibold text-[#A1AFB8]">
                            -{copy.stopLossPct}% / +{copy.takeProfitPct}% · {copy.profitSharePct}%
                            {profitShareNum > 0
                              ? ` (${formatCurrencyValue(copy.allocationCurrency, profitShareNum)})`
                              : ''}
                          </span>
                        </div>
                      </div>

                      {copy.positions.length > 0 && (
                        <div>
                          <span className="text-xs font-medium text-[#A1AFB8] block mb-2">
                            Posisi Aset Spot Terbuka di Sleeve
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {copy.positions.map(pos => (
                              <div
                                key={pos.symbol}
                                className="flex items-center justify-between p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] text-xs font-mono tabular-nums"
                              >
                                <div>
                                  <div className="text-[#E4EBEF] font-semibold">{pos.qtyDisplay}</div>
                                  <div className="text-[10px] text-[#71818B]">
                                    Avg Beli: {pos.avgEntryPriceDisplay}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-[#E4EBEF]">{pos.currentValueDisplay}</div>
                                  <div
                                    className={`text-[10px] font-semibold ${
                                      pos.pnlPct >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'
                                    }`}
                                  >
                                    {pos.pnlPct >= 0 ? '+' : ''}
                                    {pos.pnlPct}%
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <span className="text-xs font-medium text-[#A1AFB8] block mb-2">
                          Riwayat Mirror Eksekusi Riil ({copy.mirroredOrders.length})
                        </span>
                        {copy.mirroredOrders.length === 0 ? (
                          <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] text-xs text-[#71818B]">
                            Menunggu eksekusi transaksi riil berikutnya dari Master Trader {copy.traderName}.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {copy.mirroredOrders.slice(0, 8).map(ord => (
                              <div
                                key={ord.id}
                                className="flex items-center justify-between p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] text-xs font-mono tabular-nums"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <StatusBadge tone={ord.side === 'BUY' ? 'buy' : 'sell'}>
                                    {ord.side}
                                  </StatusBadge>
                                  <div className="min-w-0">
                                    <div className="text-[#E4EBEF] font-semibold truncate">
                                      {ord.pairId.replace('-', '/')} · {ord.qtyDisplay}
                                    </div>
                                    <div className="text-[10px] text-[#71818B] truncate">
                                      {ord.priceDisplay} ·{' '}
                                      {new Date(ord.createdAt).toLocaleTimeString('id-ID')}
                                    </div>
                                  </div>
                                </div>
                                <StatusBadge
                                  tone={
                                    ord.status === 'FILLED'
                                      ? 'success'
                                      : ord.status === 'SKIPPED'
                                      ? 'warning'
                                      : 'danger'
                                  }
                                >
                                  {ord.status}
                                </StatusBadge>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Master Trader Detail Modal */}
      <Modal
        isOpen={Boolean(detailTrader)}
        onClose={() => setDetailTrader(null)}
        title={detailTrader ? detailTrader.name : 'Detail Master Trader'}
        subtitle={
          detailTrader
            ? `${detailTrader.handle} · Pair Utama ${detailTrader.primaryPair.replace('-', '/')} · Profit Share ${detailTrader.profitSharePct}%`
            : undefined
        }
        maxWidth="max-w-2xl"
      >
        {detailTrader && (
          <div className="space-y-4">
            <p className="text-xs text-[#A1AFB8] leading-relaxed p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
              {detailTrader.strategySummary}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono tabular-nums">
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                <span className="text-[10px] text-[#71818B] font-sans block">ROI 30 Hari</span>
                <span className="font-semibold text-[#16A879]">
                  {detailTrader.roi30d >= 0 ? '+' : ''}
                  {detailTrader.roi30d.toFixed(2)}%
                </span>
              </div>
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                <span className="text-[10px] text-[#71818B] font-sans block">Win Rate</span>
                <span className="font-semibold text-[#E4EBEF]">
                  {detailTrader.winRate.toFixed(1)}%
                </span>
              </div>
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                <span className="text-[10px] text-[#71818B] font-sans block">Min. Modal</span>
                <span className="font-semibold text-[#E4EBEF]">
                  {detailTrader.minCopyUsdt} USDT / Rp{' '}
                  {detailTrader.minCopyIdr.toLocaleString('id-ID')}
                </span>
              </div>
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                <span className="text-[10px] text-[#71818B] font-sans block">Total Trade Riil</span>
                <span className="font-semibold text-[#E4EBEF]">
                  {detailTrader.totalTrades} Order
                </span>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[#E4EBEF] mb-2 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-[#16A879]" />
                15 Eksekusi Trade Terakhir di OrderBook
              </h4>
              {loadingDetail ? (
                <div className="h-24 rounded-[7px] bg-[#111820] border border-[#202B34] animate-pulse" />
              ) : detailTrades.length === 0 ? (
                <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] text-xs text-[#71818B]">
                  Belum ada riwayat matched trade tercatat di OrderBook untuk Master ini.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded-[7px] border border-[#202B34] bg-[#111820]">
                  <table className="w-full text-left text-xs font-mono tabular-nums">
                    <thead className="bg-[#17212B] text-[10px] text-[#A1AFB8] border-b border-[#202B34] font-sans sticky top-0">
                      <tr>
                        <th className="px-3 py-2">Pair</th>
                        <th className="px-3 py-2">Arah</th>
                        <th className="px-3 py-2">Harga</th>
                        <th className="px-3 py-2">Jumlah</th>
                        <th className="px-3 py-2 text-right">Waktu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#202B34]">
                      {detailTrades.map(t => (
                        <tr key={t.id}>
                          <td className="px-3 py-2 text-[#E4EBEF] font-semibold">
                            {t.pairId.replace('-', '/')}
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge tone={t.side === 'BUY' ? 'buy' : 'sell'}>
                              {t.side}
                            </StatusBadge>
                          </td>
                          <td className="px-3 py-2 text-[#E4EBEF]">{t.price}</td>
                          <td className="px-3 py-2 text-[#A1AFB8]">{t.quantity}</td>
                          <td className="px-3 py-2 text-right text-[#71818B]">
                            {new Date(t.createdAt).toLocaleTimeString('id-ID')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setDetailTrader(null)}>
                Tutup
              </Button>
              {(!user || detailTrader.userId !== user.id) && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    const target = detailTrader;
                    setDetailTrader(null);
                    handleOpenCopy(target);
                  }}
                >
                  Salin Trader Ini
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Copy Configuration Modal */}
      <Modal
        isOpen={isCopyModalOpen && Boolean(selectedTrader)}
        onClose={() => setIsCopyModalOpen(false)}
        title={selectedTrader ? `Salin ${selectedTrader.name}` : 'Konfigurasi Copy'}
        subtitle={
          selectedTrader
            ? `${selectedTrader.handle} · Bagi hasil (High-Water Mark): ${selectedTrader.profitSharePct}%`
            : undefined
        }
        maxWidth="max-w-md"
      >
        {selectedTrader && (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1.5">
                Mata Uang Modal Sleeve
              </label>
              <SegmentedTabs
                size="sm"
                activeTab={allocationCurrency}
                onChange={handleSwitchAllocCurrency}
                tabs={[
                  { id: 'USDT', label: 'USDT' },
                  { id: 'IDR', label: 'IDR (Rupiah)' },
                ]}
              />
            </div>

            <Input
              label={`Jumlah Alokasi Modal (${allocationCurrency})`}
              value={copyAmount}
              onChange={e => setCopyAmount(e.target.value)}
              suffixText={allocationCurrency}
              actionText={`Saldo Spot: ${
                allocationCurrency === 'IDR'
                  ? `Rp ${Math.round(selectedAllocAvail).toLocaleString('id-ID')}`
                  : `${selectedAllocAvail.toFixed(2)} USDT`
              }`}
              onActionClick={() =>
                setCopyAmount(
                  allocationCurrency === 'IDR'
                    ? String(Math.floor(selectedAllocAvail))
                    : String(Math.floor(selectedAllocAvail * 100) / 100)
                )
              }
            />

            <div className="grid grid-cols-3 gap-2.5">
              <Input
                label="Stop Loss (%)"
                value={stopLossPct}
                onChange={e => setStopLossPct(e.target.value)}
                suffixText="%"
              />
              <Input
                label="Take Profit (%)"
                value={takeProfitPct}
                onChange={e => setTakeProfitPct(e.target.value)}
                suffixText="%"
              />
              <Input
                label="Max / Order (%)"
                value={maxPerTradePct}
                onChange={e => setMaxPerTradePct(e.target.value)}
                suffixText="%"
              />
            </div>

            <div className="p-3 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-2 text-xs">
              <div className="flex justify-between text-[#A1AFB8]">
                <span>Custody Ledger</span>
                <span className="text-[#E4EBEF] font-medium">Terisolasi di Sleeve Copy Trading</span>
              </div>
              <div className="flex justify-between text-[#A1AFB8]">
                <span>Sizing Mirror</span>
                <span className="text-[#E4EBEF] font-mono tabular-nums">
                  Proporsional (maks {maxPerTradePct}% per order)
                </span>
              </div>
              <div className="flex justify-between text-[#A1AFB8]">
                <span>High-Water Mark Fee</span>
                <span className="text-[#E4EBEF] font-mono tabular-nums">
                  {selectedTrader.profitSharePct}% dari profit bersih saat berhenti
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-[7px] bg-[#2C2415]/60 border border-[#D6A85C]/30 text-[11px] text-[#D6A85C]">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Modal akan didebit atomik dari Spot Wallet ke rekening kustodi Copy Trading dan otomatis mengeksekusi trade proporsional saat Master bertransaksi.
              </span>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button
                variant="outline"
                size="md"
                className="flex-1"
                onClick={() => setIsCopyModalOpen(false)}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                size="md"
                className="flex-1"
                isLoading={isSubmittingFollow}
                onClick={handleConfirmCopy}
              >
                Konfirmasi & Salin
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Stop Confirmation Modal */}
      <Modal
        isOpen={Boolean(stopTarget)}
        onClose={() => setStopTarget(null)}
        title="Hentikan & Likuidasi Copy Trading"
        subtitle={stopTarget ? `${stopTarget.traderName} (${stopTarget.handle})` : undefined}
        maxWidth="max-w-md"
      >
        {stopTarget && (
          <div className="space-y-4">
            <p className="text-xs text-[#A1AFB8] leading-relaxed">
              Menghentikan kontrak ini akan langsung melikuidasi seluruh posisi aset pada harga pasar terkini, memotong bagi hasil ({stopTarget.profitSharePct}%) bila terdapat profit bersih di atas High-Water Mark, dan mengembalikan sisa modal ke Spot Wallet ({stopTarget.allocationCurrency}).
            </p>
            <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1.5 text-xs font-mono tabular-nums">
              <div className="flex justify-between">
                <span className="text-[#71818B] font-sans">Modal Awal:</span>
                <span className="text-[#E4EBEF]">
                  {formatCurrencyValue(
                    stopTarget.allocationCurrency,
                    parseFloat(stopTarget.allocatedDisplay || '0')
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#71818B] font-sans">Estimasi Valuasi Saat Ini:</span>
                <span className="text-[#E4EBEF] font-semibold">
                  {formatCurrencyValue(
                    stopTarget.allocationCurrency,
                    parseFloat(stopTarget.currentValueDisplay || '0')
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Button variant="outline" size="md" className="flex-1" onClick={() => setStopTarget(null)}>
                Batal
              </Button>
              <Button
                variant="danger"
                size="md"
                className="flex-1"
                isLoading={busyRelId === stopTarget.id}
                onClick={handleConfirmStop}
              >
                Ya, Hentikan & Tarik
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Apply as Master Trader Modal */}
      <Modal
        isOpen={isApplyMasterOpen}
        onClose={() => setIsApplyMasterOpen(false)}
        title="Ajukan Diri Sebagai Master Trader"
        subtitle="Pengajuan akan ditinjau oleh Admin sebelum tampil di Leaderboard Copy Trading."
        maxWidth="max-w-md"
      >
        <div className="space-y-3.5">
          <Input
            label="Nama Strategi / Desk"
            value={masterName}
            onChange={e => setMasterName(e.target.value)}
            placeholder="Contoh: Nusantara Macro Alpha"
          />
          <Input
            label="Handle Publik"
            value={masterHandle}
            onChange={e => setMasterHandle(e.target.value)}
            placeholder="@nusantara_macro"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">
                Pair Utama
              </label>
              <select
                value={masterPair}
                onChange={e => setMasterPair(e.target.value)}
                className="w-full h-9 px-3 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
              >
                <option value="BTC-IDR">BTC-IDR</option>
                <option value="ETH-IDR">ETH-IDR</option>
                <option value="SOL-IDR">SOL-IDR</option>
                <option value="USDT-IDR">USDT-IDR</option>
                <option value="BTC-USDT">BTC-USDT</option>
              </select>
            </div>
            <Input
              label="Profit Share (%)"
              value={masterProfitShare}
              onChange={e => setMasterProfitShare(e.target.value)}
              suffixText="%"
            />
          </div>
          <Input
            label="Minimum Copy (USDT)"
            value={masterMinCopyUsdt}
            onChange={e => setMasterMinCopyUsdt(e.target.value)}
            suffixText="USDT"
          />
          <div>
            <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">
              Ringkasan Strategi
            </label>
            <textarea
              rows={3}
              value={masterStrategy}
              onChange={e => setMasterStrategy(e.target.value)}
              placeholder="Jelaskan pendekatan manajemen risiko, timeframe, dan pasangan spot utama..."
              className="w-full p-2.5 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Button
              variant="outline"
              size="md"
              className="flex-1"
              onClick={() => setIsApplyMasterOpen(false)}
            >
              Batal
            </Button>
            <Button
              variant="primary"
              size="md"
              className="flex-1"
              isLoading={isSubmittingMaster}
              onClick={handleApplyMaster}
            >
              Kirim Pengajuan
            </Button>
          </div>
        </div>
      </Modal>

      {/* Master Signal Execution Modal (For Approved Master Traders) */}
      <Modal
        isOpen={isSignalOpen}
        onClose={() => setIsSignalOpen(false)}
        title="Eksekusi Sinyal Spot Master"
        subtitle="Order dieksekusi langsung di OrderBook Spot dari saldo Master Anda dan otomatis direplikasi ke seluruh pengikut aktif."
        maxWidth="max-w-md"
      >
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Pair Spot</label>
              <select
                value={signalPair}
                onChange={e => setSignalPair(e.target.value)}
                className="w-full h-9 px-3 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
              >
                {(myMaster?.supportedPairs || ['BTC-IDR', 'ETH-IDR', 'SOL-IDR', 'USDT-IDR']).map(
                  p => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  )
                )}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Arah Order</label>
              <SegmentedTabs
                size="sm"
                activeTab={signalSide}
                onChange={setSignalSide}
                tabs={[
                  { id: 'BUY', label: 'BUY' },
                  { id: 'SELL', label: 'SELL' },
                ]}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Kuantitas Base Aset"
              value={signalQty}
              onChange={e => setSignalQty(e.target.value)}
            />
            <div>
              <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Tipe Order</label>
              <SegmentedTabs
                size="sm"
                activeTab={signalOrderType}
                onChange={setSignalOrderType}
                tabs={[
                  { id: 'MARKET', label: 'MARKET' },
                  { id: 'LIMIT', label: 'LIMIT' },
                ]}
              />
            </div>
          </div>

          {signalOrderType === 'LIMIT' && (
            <Input
              label="Harga Limit"
              value={signalPrice}
              onChange={e => setSignalPrice(e.target.value)}
              placeholder="Contoh: 1500000000"
            />
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button
              variant="outline"
              size="md"
              className="flex-1"
              onClick={() => setIsSignalOpen(false)}
            >
              Batal
            </Button>
            <Button
              variant={signalSide === 'BUY' ? 'profit' : 'danger'}
              size="md"
              className="flex-1"
              isLoading={isSubmittingSignal}
              onClick={handleExecuteMasterSignal}
            >
              Eksekusi {signalSide} & Mirror
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
