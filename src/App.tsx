/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/App.tsx
 * DIMONEX Premium Cryptocurrency Exchange — Master Application
 * Black & Crimson-Pink Design System (#08090D, #15171F, #292C38, #EB3458, #00C087)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Navbar } from './components/layout/Navbar.js';
import { Sidebar } from './components/layout/Sidebar.js';
import { MobileBottomNav } from './components/layout/MobileBottomNav.js';
import { ToastProvider, useToast } from './components/ui/Toast.js';
import { TradingChart } from './components/trading/TradingChart.js';
import { OrderBookView } from './components/trading/OrderBookView.js';
import { D3DepthChart } from './components/trading/D3DepthChart.js';
import { RecentTradesView } from './components/trading/RecentTradesView.js';
import { OrderPlacementForm } from './components/trading/OrderPlacementForm.js';
import { UserOrdersTable } from './components/trading/UserOrdersTable.js';
import { FuturesTerminal } from './components/trading/FuturesTerminal.js';
import { MarketsView } from './components/markets/MarketsView.js';
import { WalletView } from './components/wallet/WalletView.js';
import { OrdersView } from './components/orders/OrdersView.js';
import { EarnView } from './components/earn/EarnView.js';
import { OverviewView } from './components/overview/OverviewView.js';
import { KycView } from './components/kyc/KycView.js';
import { SecurityView } from './components/security/SecurityView.js';
import { AdminView } from './components/admin/AdminView.js';
import { BotConsoleView } from './components/bot/BotConsoleView.js';
import { MMConsoleView } from './components/bot/MMConsoleView.js';
import { TradingBotsView } from './components/bot/TradingBotsView.js';
import { CopyTradingView } from './components/copy/CopyTradingView.js';
import { ConvertView } from './components/convert/ConvertView.js';
import { RewardsVipView } from './components/rewards/RewardsVipView.js';
import { AuthModal } from './components/auth/AuthModal.js';
import { ListingPortalPage } from './components/listing/ListingPortalPage.js';
import { MobileHomeView } from './components/mobile/MobileHomeView.js';
import { TradingPairItem, TradeItem, OrderItem, UserProfile, UserBalance, AppLanguage } from './types/index.js';
import { formatIDR, formatCrypto, formatQuotePrice, formatPairVolume } from './lib/formatters.js';
import { safeFetchJson } from './lib/safeFetch.js';
import { isWebSocketSupported, reportWebSocketSuccess, reportWebSocketFailure } from './utils/wsHelper.js';
import { TrendingUp, Zap, Wallet, BarChart3, Clock, AlertTriangle, ShieldCheck, ChevronDown, Search, Sparkles } from 'lucide-react';

export type ActiveViewType =
  | 'OVERVIEW'
  | 'MARKETS'
  | 'TRADE'
  | 'FUTURES'
  | 'COPY'
  | 'BOT'
  | 'CONVERT'
  | 'EARN'
  | 'WALLET'
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'TRANSACTIONS'
  | 'ORDERS'
  | 'REWARDS'
  | 'LISTING'
  | 'SETTINGS'
  | 'SECURITY'
  | 'KYC'
  | 'ADMIN'
  | 'MOBILE_HOME';

function AppContent() {
  const [currentView, setCurrentViewState] = useState<ActiveViewType>(() => {
    const saved = localStorage.getItem('dimonex_view');
    if (saved) return saved as ActiveViewType;
    return 'TRADE';
  });

  const [botConsoleMode, setBotConsoleMode] = useState<'STRATEGIES' | 'AUTOMATED' | 'MM_CONSOLE'>('STRATEGIES');
  const [lang, setLangState] = useState<AppLanguage>(() => {
    return (localStorage.getItem('dimonex_lang') as AppLanguage) || 'EN';
  });
  const [displayCurrency, setDisplayCurrency] = useState<'USDT' | 'IDR'>('IDR');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);

  // Market tab mode on trading terminal
  const [marketTab, setMarketTab] = useState<'BOOK' | 'DEPTH' | 'TRADES'>('BOOK');

  // Trading data state
  const [pairs, setPairs] = useState<TradingPairItem[]>([]);
  const [selectedPairId, setSelectedPairIdState] = useState<string>(() => {
    return localStorage.getItem('dimonex_pair') || 'BTC-IDR';
  });
  const [selectedPriceForOrder, setSelectedPriceForOrder] = useState<string | null>(null);
  const [isPairDropdownOpen, setIsPairDropdownOpen] = useState(false);
  const [pairSearch, setPairSearch] = useState('');
  const [pairFilterTab, setPairFilterTab] = useState<'ALL' | 'NEW' | 'IDR'>('ALL');

  // Depth & Trades
  const [depth, setDepth] = useState<{ bids: [string, string, string][]; asks: [string, string, string][]; spread: string }>({
    bids: [],
    asks: [],
    spread: '0'
  });
  const [recentTrades, setRecentTrades] = useState<TradeItem[]>([]);

  // User private state
  const [balances, setBalances] = useState<UserBalance[]>([]);
  const [openOrders, setOpenOrders] = useState<OrderItem[]>([]);
  const [orderHistory, setOrderHistory] = useState<OrderItem[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);

  // View navigation helper
  const handleSelectView = (view: ActiveViewType) => {
    setCurrentViewState(view);
    localStorage.setItem('dimonex_view', view);
  };

  const handleSelectPair = (pairId: string) => {
    setSelectedPairIdState(pairId);
    localStorage.setItem('dimonex_pair', pairId);
  };

  const handleToggleLang = () => {
    setLangState(prev => {
      const next = prev === 'ID' ? 'EN' : 'ID';
      localStorage.setItem('dimonex_lang', next);
      return next;
    });
  };

  const handleToggleCurrency = () => {
    setDisplayCurrency(prev => (prev === 'IDR' ? 'USDT' : 'IDR'));
  };

  // Instant demo account login
  const quickLogin = async (email: string, pass: string) => {
    try {
      const res = await safeFetchJson<any>('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass })
      });
      if (res.ok && res.data?.token) {
        const data = res.data;
        localStorage.setItem('dimonex_auth_token', data.token);
        setUser({
          ...data.user,
          kycStatus: 'approved',
          kycTier: 2,
          fullName: data.user.email.includes('admin')
            ? 'Super Admin DIMONEX'
            : data.user.email.includes('mm')
            ? 'Market Maker Operator'
            : data.user.email.includes('user1')
            ? 'Trader One'
            : 'Trader Two'
        });
        refreshBalances();
        refreshUserOrders();
      }
    } catch (e) {
      console.error('Quick login error:', e);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('dimonex_auth_token');
    setUser(null);
    setBalances([]);
    setOpenOrders([]);
    setOrderHistory([]);
  };

  // Fetch initial system data
  const fetchInitialData = useCallback(async () => {
    try {
      const res = await safeFetchJson<TradingPairItem[]>('/api/trading/pairs');
      if (res.ok && Array.isArray(res.data)) {
        setPairs(res.data);
      }
    } catch (e) {}

    const token = localStorage.getItem('dimonex_auth_token');
    if (token) {
      try {
        const res = await safeFetchJson<any>('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok && res.data?.user) {
          const data = res.data;
          setUser({
            ...data.user,
            kycStatus: data.kyc?.status || 'approved',
            kycTier: data.kyc?.tierLevel || 2,
            fullName: data.kyc?.fullName || (data.user.email.includes('admin') ? 'Super Admin' : 'Active Trader')
          });
          refreshBalances();
          refreshUserOrders();
        } else if (res.status === 401) {
          localStorage.removeItem('dimonex_auth_token');
          setUser(null);
        }
      } catch (e) {}
    }
  }, []);

  const refreshBalances = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    try {
      const res = await safeFetchJson<UserBalance[]>('/api/wallet/balances', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok && Array.isArray(res.data)) {
        setBalances(res.data);
      }
    } catch (e) {}
  }, []);

  const refreshUserOrders = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    setIsLoadingOrders(true);
    try {
      const [openRes, histRes] = await Promise.all([
        safeFetchJson<OrderItem[]>('/api/trading/orders/open', { headers: { 'Authorization': `Bearer ${token}` } }),
        safeFetchJson<OrderItem[]>('/api/trading/orders/history', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      if (openRes.ok && Array.isArray(openRes.data)) setOpenOrders(openRes.data);
      if (histRes.ok && Array.isArray(histRes.data)) setOrderHistory(histRes.data);
    } catch (e) {
      console.warn('Failed to refresh orders:', e);
    } finally {
      setIsLoadingOrders(false);
    }
  }, []);

  const fetchPairMarketData = useCallback(async () => {
    if (!selectedPairId) return;
    try {
      const [dRes, tRes, pairsRes] = await Promise.all([
        safeFetchJson<{ bids: [string, string, string][]; asks: [string, string, string][]; spread: string }>(`/api/trading/depth/${selectedPairId}`),
        safeFetchJson<TradeItem[]>(`/api/trading/trades/${selectedPairId}`),
        safeFetchJson<TradingPairItem[]>('/api/trading/pairs')
      ]);
      if (dRes.ok && dRes.data && Array.isArray(dRes.data.bids) && Array.isArray(dRes.data.asks)) {
        setDepth(dRes.data);
      }
      if (tRes.ok && Array.isArray(tRes.data)) {
        setRecentTrades(tRes.data);
      }
      if (pairsRes.ok && Array.isArray(pairsRes.data)) {
        setPairs(pairsRes.data);
      }
    } catch (e) {}
  }, [selectedPairId]);

  // Initial load
  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  useEffect(() => {
    fetchPairMarketData();
  }, [fetchPairMarketData]);

  // Polling fallback
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPairMarketData();
      if (localStorage.getItem('dimonex_auth_token')) {
        refreshUserOrders();
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [fetchPairMarketData, refreshUserOrders]);

  // WebSocket Live Sync
  useEffect(() => {
    let socket: WebSocket | null = null;
    let isDisposed = false;

    const connectWs = () => {
      if (isDisposed || !isWebSocketSupported()) return;
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
          reportWebSocketSuccess();
          if (!socket || socket.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ action: 'subscribe', channel: `depth:${selectedPairId}` }));
          socket.send(JSON.stringify({ action: 'subscribe', channel: `trades:${selectedPairId}` }));
          socket.send(JSON.stringify({ action: 'subscribe', channel: 'ticker' }));
        };

        socket.onerror = () => {
          reportWebSocketFailure();
        };

        socket.onclose = () => {
          // Handled silently
        };

        socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.channel === `depth:${selectedPairId}` && msg.data) {
              setDepth(msg.data);
            } else if (msg.channel === `trades:${selectedPairId}` && msg.data) {
              setRecentTrades(prev => [msg.data, ...prev.slice(0, 49)]);
            } else if (msg.type === 'ticker' && msg.pair) {
              setPairs(prev => prev.map(p => p.id === msg.pair.id ? { ...p, ...msg.pair } : p));
            } else if (msg.type === 'snapshot' && msg.channel === 'ticker' && Array.isArray(msg.data)) {
              setPairs(prev => {
                const map = new Map(prev.map(p => [p.id, p]));
                for (const item of msg.data) {
                  map.set(item.id, { ...map.get(item.id), ...item });
                }
                return Array.from(map.values());
              });
            }
          } catch {}
        };
      } catch (err) {
        reportWebSocketFailure();
      }
    };

    connectWs();
    return () => {
      isDisposed = true;
      if (socket) socket.close();
    };
  }, [selectedPairId]);

  const { showToast } = useToast();

  const handleCancelOrder = async (orderId: string, orderPairId?: string) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      showToast('warning', 'Login Diperlukan', 'Silakan login terlebih dahulu untuk membatalkan order');
      return;
    }
    const targetPairId = orderPairId || selectedPairId;
    try {
      // Optimistically remove from state so the UI responds immediately
      setOpenOrders(prev => prev.filter(o => o.id !== orderId));

      let res = await safeFetchJson<any>(`/api/trading/order/${orderId}?pairId=${encodeURIComponent(targetPairId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      // If DELETE returned error, attempt fallback POST /api/trading/order/cancel
      if (!res.ok) {
        res = await safeFetchJson<any>('/api/trading/order/cancel', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ orderId, pairId: targetPairId })
        });
      }

      if (res.ok) {
        showToast('success', 'Order Dibatalkan', 'Order berhasil dibatalkan dan saldo telah dikembalikan ke dompet.');
        refreshUserOrders();
        refreshBalances();
        fetchPairMarketData();
      } else {
        // Revert by re-fetching if cancel failed
        refreshUserOrders();
        showToast('error', 'Gagal Membatalkan Order', res.error || 'Terjadi kesalahan saat membatalkan order');
      }
    } catch (e: any) {
      console.error('Cancel order error:', e);
      refreshUserOrders();
      showToast('error', 'Gagal Membatalkan Order', e.message || 'Koneksi gagal');
    }
  };

  const selectedPair = useMemo(() => {
    return pairs.find(p => p.id === selectedPairId) || {
      id: 'BTC-IDR',
      symbol: 'BTC/IDR',
      baseCurrency: 'BTC',
      quoteCurrency: 'IDR',
      baseDecimals: 8,
      quoteDecimals: 2,
      minOrderSize: '1000',
      maxOrderSize: '1000000000',
      makerFeeBps: 10,
      takerFeeBps: 20,
      isActive: true,
      isHalted: false,
      lastPrice: '145000000000',
      high24h: '148000000000',
      low24h: '143500000000',
      volume24h: '2450000000',
      quoteVolume24h: '3552500000000',
      priceChangePercent24h: '2.85',
      priceChange24h: '+2.85'
    };
  }, [pairs, selectedPairId]);

  const pairSymbol = selectedPair.symbol || `${selectedPair.baseCurrency}/${selectedPair.quoteCurrency}`;
  const changeNum = parseFloat(selectedPair.priceChangePercent24h || selectedPair.priceChange24h?.replace('+', '') || '0');
  const isUp = changeNum >= 0;

  return (
    <div className="min-h-screen bg-[#08090D] text-[#F5F5F7] flex flex-col font-sans selection:bg-[#EB3458]/30 selection:text-white">
      {/* Top Navigation Bar */}
      <Navbar
        currentView={currentView}
        onSelectView={handleSelectView}
        user={user}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onLogout={handleLogout}
        lang={lang}
        onToggleLang={handleToggleLang}
        pairs={pairs}
        selectedPairId={selectedPairId}
        onSelectPair={handleSelectPair}
        onQuickLogin={quickLogin}
        displayCurrency={displayCurrency}
        onToggleCurrency={handleToggleCurrency}
      />

      {/* Main Workspace: Left Sidebar + Center Viewport */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Desktop Sidebar */}
        <Sidebar
          currentView={currentView}
          onSelectView={handleSelectView}
          isAdmin={Boolean(user && (user.role?.toUpperCase() === 'ADMIN' || user.role?.toUpperCase() === 'SUPERADMIN'))}
        />

        {/* Center Viewport */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* VIEW: OVERVIEW */}
          {currentView === 'OVERVIEW' && (
            <OverviewView
              pairs={pairs}
              balances={balances}
              user={user}
              onNavigate={(v, pId) => {
                if (pId) handleSelectPair(pId);
                handleSelectView(v as ActiveViewType);
              }}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />
          )}

          {/* VIEW: MARKETS */}
          {currentView === 'MARKETS' && (
            <MarketsView
              pairs={pairs}
              selectedPairId={selectedPairId}
              onSelectPair={handleSelectPair}
              onNavigateTrade={(pId, mode) => {
                handleSelectPair(pId);
                handleSelectView(mode === 'FUTURES' ? 'FUTURES' : 'TRADE');
              }}
              displayCurrency={displayCurrency}
            />
          )}

          {/* VIEW: SPOT TRADING TERMINAL */}
          {currentView === 'TRADE' && (
            <div className="flex-1 flex flex-col p-3 lg:p-4 space-y-3 bg-[#08090D] overflow-y-auto">
              {/* Pair Header & 24h Ticker Strip */}
              <div className="flex flex-wrap items-center justify-between gap-4 p-3 rounded-xl bg-[#15171F] border border-[#292C38] shadow-lg">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Interactive Pair Selector Dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setIsPairDropdownOpen(prev => !prev)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#0E1016] border border-[#292C38] hover:border-[#EB3458]/60 transition-all text-left group"
                    >
                      <span className="text-base font-extrabold text-[#F5F5F7] font-mono group-hover:text-[#EB3458] transition-colors">
                        {pairSymbol}
                      </span>
                      <ChevronDown className={`w-3.5 h-3.5 text-[#969BA8] transition-transform ${isPairDropdownOpen ? 'rotate-180 text-[#EB3458]' : ''}`} />
                      <span className="text-[10px] text-[#686D7A] font-mono uppercase bg-[#1C1F29] px-1.5 py-0.5 rounded border border-[#292C38]">
                        SPOT
                      </span>
                      {(selectedPair.isNewListing || selectedPair.baseCurrency === 'SOL') && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#EB3458]/20 text-[#EB3458] font-bold border border-[#EB3458]/30">
                          BARU
                        </span>
                      )}
                    </button>

                    {/* Popover Dropdown Menu */}
                    {isPairDropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setIsPairDropdownOpen(false)}
                        />
                        <div className="absolute left-0 top-full mt-2 w-72 sm:w-80 rounded-xl bg-[#0E1016] border border-[#292C38] shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 duration-150">
                          {/* Search Bar */}
                          <div className="relative mb-2.5">
                            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#686D7A]" />
                            <input
                              autoFocus
                              placeholder="Cari koin atau pasar..."
                              value={pairSearch}
                              onChange={e => setPairSearch(e.target.value)}
                              className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#15171F] border border-[#292C38] rounded-lg text-[#F5F5F7] placeholder-[#686D7A] outline-none focus:border-[#EB3458]"
                            />
                          </div>

                          {/* Filter Tabs */}
                          <div className="flex items-center gap-1 mb-2 pb-2 border-b border-[#292C38]/60">
                            {[
                              { id: 'ALL', label: 'Semua' },
                              { id: 'IDR', label: 'Spot IDR' },
                              { id: 'NEW', label: '🔥 Baru Listing' },
                            ].map(tab => (
                              <button
                                key={tab.id}
                                onClick={() => setPairFilterTab(tab.id as any)}
                                className={`px-2 py-1 text-[11px] rounded transition-colors ${
                                  pairFilterTab === tab.id
                                    ? 'bg-[#1C1F29] text-[#EB3458] font-bold border border-[#292C38]'
                                    : 'text-[#969BA8] hover:text-[#F5F5F7]'
                                }`}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>

                          {/* Pair Items List */}
                          <div className="max-h-64 overflow-y-auto space-y-1 scrollbar-thin">
                            {pairs
                              .filter(p => {
                                const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;
                                const match = sym.toLowerCase().includes(pairSearch.toLowerCase()) ||
                                              p.baseCurrency.toLowerCase().includes(pairSearch.toLowerCase());
                                if (!match) return false;
                                if (pairFilterTab === 'NEW') return p.isNewListing || p.baseCurrency === 'SOL';
                                if (pairFilterTab === 'IDR') return p.quoteCurrency === 'IDR';
                                return true;
                              })
                              .map(p => {
                                const sym = `${p.baseCurrency}/${p.quoteCurrency}`;
                                const isCurrent = p.id === selectedPairId;
                                const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');
                                const isPositive = chg >= 0;

                                return (
                                  <button
                                    key={p.id}
                                    onClick={() => {
                                      handleSelectPair(p.id);
                                      setIsPairDropdownOpen(false);
                                    }}
                                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors ${
                                      isCurrent
                                        ? 'bg-[#1C1F29] border border-[#EB3458]/40 text-[#F5F5F7]'
                                        : 'hover:bg-[#15171F] text-[#969BA8]'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-[#F5F5F7] font-mono">{sym}</span>
                                      {(p.isNewListing || p.baseCurrency === 'SOL') && (
                                        <span className="text-[8px] px-1 py-0.2 rounded bg-[#EB3458]/20 text-[#EB3458] font-bold">
                                          BARU
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-right font-mono">
                                      <div className="font-semibold text-[#F5F5F7]">
                                        {formatIDR(p.lastPrice)}
                                      </div>
                                      <div className={`text-[10px] font-bold ${isPositive ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                                        {isPositive ? '+' : ''}{chg.toFixed(2)}%
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="h-5 w-px bg-[#292C38] hidden sm:block" />

                  {/* Price and 24h Change */}
                  <div className="flex items-baseline gap-2 font-mono">
                    <span className="text-lg lg:text-xl font-extrabold text-[#F5F5F7]">
                      {formatQuotePrice(selectedPair.lastPrice, selectedPair.quoteCurrency, selectedPair.quoteDecimals, true)}
                    </span>
                    <span className={`text-xs font-bold ${isUp ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                      {selectedPair.priceChange24h?.endsWith('%') ? selectedPair.priceChange24h : `${selectedPair.priceChange24h || '0.00'}%`}
                    </span>
                  </div>
                </div>

                {/* 24h High, Low, Volume */}
                <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-[#686D7A] block">24h Tertinggi</span>
                    <span className="text-[#F5F5F7] font-semibold">{formatQuotePrice(selectedPair.high24h, selectedPair.quoteCurrency, selectedPair.quoteDecimals, true)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#686D7A] block">24h Terendah</span>
                    <span className="text-[#F5F5F7] font-semibold">{formatQuotePrice(selectedPair.low24h, selectedPair.quoteCurrency, selectedPair.quoteDecimals, true)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#686D7A] block">24h Vol ({selectedPair.baseCurrency})</span>
                    <span className="text-[#F5F5F7] font-semibold">{formatCrypto(selectedPair.volume24h, selectedPair.baseDecimals)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#686D7A] block">24h Vol ({selectedPair.quoteCurrency})</span>
                    <span className="text-[#F5F5F7] font-semibold">{formatPairVolume(selectedPair.quoteVolume24h || '0', selectedPair.quoteCurrency, selectedPair.quoteDecimals)}</span>
                  </div>
                  <div className="hidden sm:block">
                    <span className="text-[10px] text-[#686D7A] block">Maker / Taker</span>
                    <span className="text-[#EB3458] font-semibold">0.10% / 0.20%</span>
                  </div>
                </div>
              </div>

              {/* Grid: Left Chart + Bottom Orders, Right OrderBook + Form */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
                {/* Left 8 Cols: Candlestick Chart & User Orders Table */}
                <div className="lg:col-span-8 space-y-3">
                  <div className="rounded-xl bg-[#15171F] border border-[#292C38] overflow-hidden shadow-xl p-1">
                    <TradingChart pair={selectedPair} recentTrades={recentTrades} />
                  </div>

                  <div className="rounded-xl bg-[#15171F] border border-[#292C38] overflow-hidden shadow-xl">
                    <UserOrdersTable
                      openOrders={openOrders}
                      orderHistory={orderHistory}
                      onCancelOrder={handleCancelOrder}
                      isLoading={isLoadingOrders}
                      currentUserEmail={user?.email}
                      userRole={user?.role}
                    />
                  </div>
                </div>

                {/* Right 4 Cols: Order Placement & Order Book / Trades */}
                <div className="lg:col-span-4 space-y-3">
                  <OrderPlacementForm
                    pair={selectedPair}
                    user={user}
                    balances={balances}
                    selectedPriceUnits={selectedPriceForOrder}
                    onOrderPlaced={() => {
                      refreshBalances();
                      refreshUserOrders();
                      fetchPairMarketData();
                    }}
                    onOpenAuthModal={() => setIsAuthModalOpen(true)}
                  />

                  {/* Market Depth & Trades Hub */}
                  <div className="rounded-xl bg-[#15171F] border border-[#292C38] overflow-hidden shadow-xl">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-[#292C38] bg-[#0E1016]">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setMarketTab('BOOK')}
                          className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${
                            marketTab === 'BOOK'
                              ? 'bg-[#1C1F29] text-[#F5F5F7] border border-[#292C38]'
                              : 'text-[#686D7A] hover:text-[#969BA8]'
                          }`}
                        >
                          Order Book
                        </button>
                        <button
                          onClick={() => setMarketTab('DEPTH')}
                          className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors flex items-center gap-1.5 ${
                            marketTab === 'DEPTH'
                              ? 'bg-[#1C1F29] text-[#00C087] border border-[#292C38]'
                              : 'text-[#686D7A] hover:text-[#00C087]'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00C087]" />
                          Depth (D3)
                        </button>
                        <button
                          onClick={() => setMarketTab('TRADES')}
                          className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${
                            marketTab === 'TRADES'
                              ? 'bg-[#1C1F29] text-[#F5F5F7] border border-[#292C38]'
                              : 'text-[#686D7A] hover:text-[#969BA8]'
                          }`}
                        >
                          Trades ({recentTrades.length})
                        </button>
                      </div>
                    </div>

                    <div className="p-1">
                      {marketTab === 'BOOK' ? (
                        <OrderBookView
                          pair={selectedPair}
                          depth={depth}
                          onSelectPrice={p => setSelectedPriceForOrder(p)}
                        />
                      ) : marketTab === 'DEPTH' ? (
                        <D3DepthChart
                          pair={selectedPair}
                          depth={depth}
                          onSelectPrice={p => setSelectedPriceForOrder(p)}
                          height={440}
                        />
                      ) : (
                        <RecentTradesView
                          pair={selectedPair}
                          trades={recentTrades}
                          currentUserId={user?.id}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: FUTURES PERPETUAL TERMINAL */}
          {currentView === 'FUTURES' && (
            <FuturesTerminal
              pair={selectedPair}
              pairs={pairs}
              onSelectPair={handleSelectPair}
              user={user}
              displayCurrency={displayCurrency}
            />
          )}

          {/* VIEW: WALLET / PORTFOLIO */}
          {currentView === 'WALLET' && (
            <WalletView
              balances={balances}
              pairs={pairs}
              user={user}
              onRefreshBalances={refreshBalances}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              onOpenKycView={() => handleSelectView('KYC')}
              onNavigateTrade={pId => {
                handleSelectPair(pId);
                handleSelectView('TRADE');
              }}
            />
          )}

          {/* VIEW: DEPOSIT SHORTCUT */}
          {currentView === 'DEPOSIT' && (
            <WalletView
              balances={balances}
              pairs={pairs}
              user={user}
              onRefreshBalances={refreshBalances}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              onOpenKycView={() => handleSelectView('KYC')}
              initialAction="DEPOSIT"
            />
          )}

          {/* VIEW: WITHDRAW SHORTCUT */}
          {currentView === 'WITHDRAW' && (
            <WalletView
              balances={balances}
              pairs={pairs}
              user={user}
              onRefreshBalances={refreshBalances}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              onOpenKycView={() => handleSelectView('KYC')}
              initialAction="WITHDRAW"
            />
          )}

          {/* VIEW: ORDERS & HISTORY */}
          {(currentView === 'ORDERS' || currentView === 'TRANSACTIONS') && (
            <OrdersView
              openOrders={openOrders}
              orderHistory={orderHistory}
              recentTrades={recentTrades}
              onCancelOrder={handleCancelOrder}
            />
          )}

          {/* VIEW: COPY TRADING */}
          {currentView === 'COPY' && (
            <CopyTradingView
              user={user}
              balances={balances}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              displayCurrency={displayCurrency}
            />
          )}

          {/* VIEW: INSTANT CONVERT */}
          {currentView === 'CONVERT' && (
            <ConvertView
              user={user}
              balances={balances}
              pairs={pairs}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              onRefreshBalances={refreshBalances}
              displayCurrency={displayCurrency}
            />
          )}

          {/* VIEW: REWARDS & VIP CENTER */}
          {currentView === 'REWARDS' && (
            <RewardsVipView
              user={user}
              balances={balances}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              displayCurrency={displayCurrency}
            />
          )}

          {/* VIEW: EARN VAULTS */}
          {currentView === 'EARN' && <EarnView />}

          {/* VIEW: BOT ENGINE */}
          {currentView === 'BOT' && (
            <div className="flex-1 flex flex-col p-4 bg-[#08090D] overflow-y-auto">
              <div className="flex flex-wrap items-center gap-2 mb-4 obsidian-glass p-1 rounded-xl border border-white/10 w-fit">
                <button
                  onClick={() => setBotConsoleMode('STRATEGIES')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                    botConsoleMode === 'STRATEGIES'
                      ? 'bg-[#FF087F] text-white shadow-sm'
                      : 'text-[#9298A6] hover:text-[#F5F5F7]'
                  }`}
                >
                  ⚡ Bot Trading Strategies
                </button>
                <button
                  onClick={() => setBotConsoleMode('AUTOMATED')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                    botConsoleMode === 'AUTOMATED'
                      ? 'bg-[#FF087F] text-white shadow-sm'
                      : 'text-[#9298A6] hover:text-[#F5F5F7]'
                  }`}
                >
                  🤖 Automated Quantitative Bots
                </button>
                <button
                  onClick={() => setBotConsoleMode('MM_CONSOLE')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                    botConsoleMode === 'MM_CONSOLE'
                      ? 'bg-[#FF087F] text-white shadow-sm'
                      : 'text-[#9298A6] hover:text-[#F5F5F7]'
                  }`}
                >
                  🏦 Market Maker Operator
                </button>
              </div>

              {botConsoleMode === 'STRATEGIES' && (
                <BotConsoleView
                  user={user}
                  tradingPairs={pairs}
                  balances={balances}
                  onRefreshBalances={refreshBalances}
                  onRefreshOrders={refreshUserOrders}
                  onOpenAuthModal={() => setIsAuthModalOpen(true)}
                  onOpenSecurityView={() => handleSelectView('SECURITY')}
                />
              )}

              {botConsoleMode === 'AUTOMATED' && (
                <TradingBotsView
                  user={user}
                  balances={balances}
                  pairs={pairs}
                  onOpenAuthModal={() => setIsAuthModalOpen(true)}
                  displayCurrency={displayCurrency}
                  onRefreshBalances={refreshBalances}
                  onRefreshOrders={refreshUserOrders}
                />
              )}

              {botConsoleMode === 'MM_CONSOLE' && (
                <MMConsoleView
                  user={user}
                  tradingPairs={pairs}
                  onOpenAuthModal={() => setIsAuthModalOpen(true)}
                  onOpenSecurityView={() => handleSelectView('SECURITY')}
                />
              )}
            </div>
          )}

          {/* VIEW: SETTINGS & SECURITY */}
          {currentView === 'SETTINGS' && (
            <SecurityView
              user={user}
              onUserUpdated={fetchInitialData}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />
          )}

          {currentView === 'SECURITY' && (
            <SecurityView
              user={user}
              onUserUpdated={fetchInitialData}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />
          )}

          {currentView === 'KYC' && (
            <KycView
              user={user}
              onKycUpdated={fetchInitialData}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />
          )}

          {/* VIEW: TOKEN INITIAL LISTING PORTAL */}
          {currentView === 'LISTING' && (
            <ListingPortalPage
              user={user}
              tradingPairs={pairs}
              onSelectPair={handleSelectPair}
              onSelectView={handleSelectView}
              onQuickLogin={quickLogin}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />
          )}

          {currentView === 'ADMIN' && (
            <AdminView
              user={user}
              tradingPairs={pairs}
              onRefreshPairs={fetchInitialData}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />
          )}

          {/* VIEW: MOBILE HOME */}
          {currentView === 'MOBILE_HOME' && (
            <MobileHomeView
              pairs={pairs}
              balances={balances}
              onSelectPair={handleSelectPair}
              onNavigate={v => handleSelectView(v as ActiveViewType)}
            />
          )}
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar (Hidden on desktop) */}
      <MobileBottomNav
        currentView={currentView}
        onSelectView={v => handleSelectView(v as ActiveViewType)}
      />

      {/* Accessible Footer */}
      <footer className="hidden md:flex border-t border-white/10 bg-[#08090D] py-3 px-6 text-xs text-[#9298A6] items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-[#F5F5F7]">DOMINEX</span>
          <span>·</span>
          <span>Trade Beyond Limits</span>
          <span>·</span>
          <span>Double-Entry Atomic Ledger</span>
          <span>·</span>
          <span>FIFO In-Memory Matching Engine</span>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-mono">
          <span>Engine Latency: &lt; 1.2ms</span>
          <span>·</span>
          <span className="text-[#16C784]">
            {isWebSocketSupported() ? 'WebSocket 100% Operational' : 'REST Real-time Sync Active'}
          </span>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={(_token, authedUser) => {
          setUser(authedUser);
          fetchInitialData();
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
