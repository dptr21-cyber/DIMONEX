/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/App.tsx
 * DIMONEX Institutional Cryptocurrency Exchange — Master Application
 * Obsidian Iridium Design System (#090D12, #141C24, #17212B, #8DA5B1, #16A879, #EA5B65)
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
import { ArticleDetailView } from './components/news/ArticleDetailView.js';
import { NotificationsView } from './components/notifications/NotificationsView.js';
import { AssetIcon } from './components/ui/AssetIcon.js';
import { PercentageChange } from './components/ui/PriceDisplay.js';
import { StatusBadge } from './components/ui/StatusBadge.js';
import { SegmentedTabs } from './components/ui/Tabs.js';
import { TradingPairItem, TradeItem, OrderItem, UserProfile, UserBalance, AppLanguage, SpotLayoutPreset } from './types/index.js';
import { formatCrypto, formatQuotePrice, formatPairVolume } from './lib/formatters.js';
import { safeFetchJson } from './lib/safeFetch.js';
import { loadAssetRegistry, hydrateAssetRegistryFromList } from './lib/assetRegistry.js';
import { isWebSocketSupported, reportWebSocketSuccess, reportWebSocketFailure } from './utils/wsHelper.js';
import { SpotPreferencesModal, SPOT_LAYOUT_LABELS } from './components/trading/SpotPreferencesModal.js';
import { ChevronDown, Search, Zap, Bot, Building2, SlidersHorizontal, Eye, EyeOff } from 'lucide-react';

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
  | 'MOBILE_HOME'
  | 'ARTICLE'
  | 'NOTIFICATIONS';

function AppContent() {
  const initialNewsSlug =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/news/')
      ? decodeURIComponent(window.location.pathname.slice('/news/'.length))
      : '';

  const [activeArticleSlug, setActiveArticleSlug] = useState<string>(initialNewsSlug);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState<number>(0);

  const [currentView, setCurrentViewState] = useState<ActiveViewType>(() => {
    if (initialNewsSlug) return 'ARTICLE';
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

  // Order book sub-view mode (Book vs Depth D3) on trading terminal
  const [orderBookTab, setOrderBookTab] = useState<'BOOK' | 'DEPTH'>('BOOK');

  // Spot Trading Workspace Layout Preferences (persisted per-user in DB + localStorage cache)
  const readLocalSpotPrefs = (userId?: string): { spotLayout: SpotLayoutPreset; hideRecentTradesInChartFocus: boolean } => {
    try {
      const key = `dimonex_spot_prefs_${userId || 'guest'}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.spotLayout && ['CLASSIC', 'PRO_TERMINAL', 'CHART_FOCUS'].includes(parsed.spotLayout)) {
          return {
            spotLayout: parsed.spotLayout as SpotLayoutPreset,
            hideRecentTradesInChartFocus:
              typeof parsed.hideRecentTradesInChartFocus === 'boolean'
                ? parsed.hideRecentTradesInChartFocus
                : true,
          };
        }
      }
    } catch {}
    return { spotLayout: 'CLASSIC', hideRecentTradesInChartFocus: true };
  };

  const writeLocalSpotPrefs = (
    prefs: { spotLayout: SpotLayoutPreset; hideRecentTradesInChartFocus: boolean },
    userId?: string
  ) => {
    try {
      localStorage.setItem(`dimonex_spot_prefs_${userId || 'guest'}`, JSON.stringify(prefs));
    } catch {}
  };

  const [spotLayout, setSpotLayout] = useState<SpotLayoutPreset>(() => readLocalSpotPrefs().spotLayout);
  const [hideRecentTradesInChartFocus, setHideRecentTradesInChartFocus] = useState<boolean>(
    () => readLocalSpotPrefs().hideRecentTradesInChartFocus
  );
  const [isSpotPreferencesOpen, setIsSpotPreferencesOpen] = useState(false);
  const [isSavingSpotPreferences, setIsSavingSpotPreferences] = useState(false);

  // Trading data state
  const [pairs, setPairs] = useState<TradingPairItem[]>([]);
  const [selectedPairId, setSelectedPairIdState] = useState<string>(() => {
    return localStorage.getItem('dimonex_pair') || 'BTC-IDR';
  });
  const [selectedPriceForOrder, setSelectedPriceForOrder] = useState<string | null>(null);
  const [isPairDropdownOpen, setIsPairDropdownOpen] = useState(false);
  const [pairSearch, setPairSearch] = useState('');
  const [pairFilterTab, setPairFilterTab] = useState<'ALL' | 'NEW' | 'IDR' | 'USDT'>('ALL');

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

  const handleSelectView = (view: ActiveViewType) => {
    setCurrentViewState(view);
    if (view !== 'ARTICLE') {
      localStorage.setItem('dimonex_view', view);
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/news/')) {
        window.history.pushState({}, '', '/');
      }
    }
  };

  const handleOpenArticle = (slug: string) => {
    setActiveArticleSlug(slug);
    setCurrentViewState('ARTICLE');
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', `/news/${encodeURIComponent(slug)}`);
    }
  };

  const refreshUnreadNotifications = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      setUnreadNotificationsCount(0);
      return;
    }
    try {
      const res = await safeFetchJson<{ unreadCount: number }>('/api/notifications/unread-count', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && typeof res.data?.unreadCount === 'number') {
        setUnreadNotificationsCount(res.data.unreadCount);
      }
    } catch {}
  }, []);

  const handleSelectPair = (pairId: string) => {
    setSelectedPairIdState(pairId);
    setSelectedPriceForOrder(null);
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
        const restoredLayout: SpotLayoutPreset =
          data.user?.preferences?.spotLayout &&
          ['CLASSIC', 'PRO_TERMINAL', 'CHART_FOCUS'].includes(data.user.preferences.spotLayout)
            ? data.user.preferences.spotLayout
            : 'CLASSIC';
        const restoredHideTrades =
          typeof data.user?.preferences?.hideRecentTradesInChartFocus === 'boolean'
            ? data.user.preferences.hideRecentTradesInChartFocus
            : true;
        setSpotLayout(restoredLayout);
        setHideRecentTradesInChartFocus(restoredHideTrades);
        writeLocalSpotPrefs(
          { spotLayout: restoredLayout, hideRecentTradesInChartFocus: restoredHideTrades },
          data.user.id
        );
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
    setUnreadNotificationsCount(0);
    const guestPrefs = readLocalSpotPrefs();
    setSpotLayout(guestPrefs.spotLayout);
    setHideRecentTradesInChartFocus(guestPrefs.hideRecentTradesInChartFocus);
  };

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

  const refreshUserOrders = useCallback(async (optimisticOrder?: OrderItem) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    if (optimisticOrder) {
      setOpenOrders(prev => {
        if (prev.some(o => o.id === optimisticOrder.id)) return prev;
        const updated = [optimisticOrder, ...prev];
        try { localStorage.setItem('dimonex_open_orders_cache', JSON.stringify(updated.slice(0, 50))); } catch {}
        return updated;
      });
    }

    setIsLoadingOrders(true);
    try {
      const [openRes, histRes] = await Promise.all([
        safeFetchJson<OrderItem[]>('/api/trading/orders/open', { headers: { 'Authorization': `Bearer ${token}` } }),
        safeFetchJson<OrderItem[]>('/api/trading/orders/history', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      if (openRes.ok && Array.isArray(openRes.data)) {
        const serverOrders = openRes.data;
        setOpenOrders(prev => {
          const serverIds = new Set(serverOrders.map(o => o.id));
          const recentOptimistic = prev.filter(o => !serverIds.has(o.id) && (Date.now() - o.createdAt < 60000));
          const merged = [...recentOptimistic, ...serverOrders];
          try { localStorage.setItem('dimonex_open_orders_cache', JSON.stringify(merged.slice(0, 50))); } catch {}
          return merged;
        });
      }
      if (histRes.ok && Array.isArray(histRes.data)) setOrderHistory(histRes.data);
    } catch (e) {
      console.warn('Failed to refresh orders:', e);
    } finally {
      setIsLoadingOrders(false);
    }
  }, []);

  const fetchInitialData = useCallback(async () => {
    loadAssetRegistry();
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
          const serverPrefs = data.preferences || data.user?.preferences;
          const restoredLayout: SpotLayoutPreset =
            serverPrefs?.spotLayout &&
            ['CLASSIC', 'PRO_TERMINAL', 'CHART_FOCUS'].includes(serverPrefs.spotLayout)
              ? serverPrefs.spotLayout
              : 'CLASSIC';
          const restoredHideTrades =
            typeof serverPrefs?.hideRecentTradesInChartFocus === 'boolean'
              ? serverPrefs.hideRecentTradesInChartFocus
              : true;

          setUser({
            ...data.user,
            preferences: {
              spotLayout: restoredLayout,
              hideRecentTradesInChartFocus: restoredHideTrades,
              updatedAt: serverPrefs?.updatedAt,
            },
            kycStatus: data.kyc?.status || 'approved',
            kycTier: data.kyc?.tierLevel || 2,
            fullName: data.kyc?.fullName || (data.user.email.includes('admin') ? 'Super Admin' : 'Active Trader')
          });
          setSpotLayout(restoredLayout);
          setHideRecentTradesInChartFocus(restoredHideTrades);
          writeLocalSpotPrefs(
            { spotLayout: restoredLayout, hideRecentTradesInChartFocus: restoredHideTrades },
            data.user.id
          );
          refreshBalances();
          refreshUserOrders();
          refreshUnreadNotifications();
        } else if (res.status === 401) {
          localStorage.removeItem('dimonex_auth_token');
          setUser(null);
          setUnreadNotificationsCount(0);
          const guestPrefs = readLocalSpotPrefs();
          setSpotLayout(guestPrefs.spotLayout);
          setHideRecentTradesInChartFocus(guestPrefs.hideRecentTradesInChartFocus);
        }
      } catch (e) {}
    }
  }, [refreshBalances, refreshUserOrders, refreshUnreadNotifications]);

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

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  useEffect(() => {
    fetchPairMarketData();
  }, [fetchPairMarketData]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchPairMarketData();
      if (localStorage.getItem('dimonex_auth_token')) {
        refreshUserOrders();
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [fetchPairMarketData, refreshUserOrders]);

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
          if (user?.id) {
            socket.send(
              JSON.stringify({
                action: 'subscribe',
                channel: `notifications:${user.id}`,
                userId: user.id,
              })
            );
          }
        };

        socket.onerror = () => {
          reportWebSocketFailure();
        };

        socket.onclose = () => {};

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
            } else if (msg.type === 'assets_updated' && Array.isArray(msg.data)) {
              hydrateAssetRegistryFromList(msg.data);
              safeFetchJson<TradingPairItem[]>('/api/trading/pairs').then((res) => {
                if (res.ok && Array.isArray(res.data)) setPairs(res.data);
              }).catch(() => {});
            } else if (msg.type === 'user_notification') {
              refreshUnreadNotifications();
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
  }, [selectedPairId, user?.id, refreshUnreadNotifications]);

  const { showToast } = useToast();

  const handleSaveSpotPreferences = async (
    nextLayout: SpotLayoutPreset,
    nextHideRecentTrades: boolean
  ) => {
    setSpotLayout(nextLayout);
    setHideRecentTradesInChartFocus(nextHideRecentTrades);
    writeLocalSpotPrefs(
      { spotLayout: nextLayout, hideRecentTradesInChartFocus: nextHideRecentTrades },
      user?.id
    );

    const token = localStorage.getItem('dimonex_auth_token');
    if (token && user) {
      setIsSavingSpotPreferences(true);
      try {
        const res = await safeFetchJson<{ success?: boolean; preferences?: any; error?: string }>(
          '/api/auth/preferences',
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              spotLayout: nextLayout,
              hideRecentTradesInChartFocus: nextHideRecentTrades,
            }),
          }
        );

        if (res.ok && res.data?.preferences) {
          setUser(prev =>
            prev
              ? {
                  ...prev,
                  preferences: res.data!.preferences,
                }
              : prev
          );
          showToast(
            'success',
            'Layout Settings Saved',
            `Workspace switched to ${SPOT_LAYOUT_LABELS[nextLayout]} and synced to your account.`
          );
        } else {
          showToast(
            'error',
            'Sync Failed',
            res.error || 'Layout applied locally, but failed to sync preferences to server.'
          );
        }
      } catch (err: any) {
        showToast(
          'error',
          'Sync Failed',
          err?.message || 'Layout applied locally, but server sync failed.'
        );
      } finally {
        setIsSavingSpotPreferences(false);
      }
    } else {
      showToast(
        'info',
        'Layout Updated',
        `Workspace switched to ${SPOT_LAYOUT_LABELS[nextLayout]}.`
      );
    }
  };

  const handleCancelOrder = async (orderId: string, orderPairId?: string) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      showToast('warning', 'Login Diperlukan', 'Silakan login terlebih dahulu untuk membatalkan order');
      return;
    }
    const targetPairId = orderPairId || selectedPairId;
    try {
      setOpenOrders(prev => prev.filter(o => o.id !== orderId));

      let res = await safeFetchJson<any>(`/api/trading/order/${orderId}?pairId=${encodeURIComponent(targetPairId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

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

  return (
    <div className="min-h-screen bg-[#090D12] text-[#E4EBEF] flex flex-col font-sans selection:bg-[#8DA5B1]/25 selection:text-white">
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
        unreadNotificationsCount={unreadNotificationsCount}
        onUnreadCountChange={setUnreadNotificationsCount}
        onOpenArticle={handleOpenArticle}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          currentView={currentView}
          onSelectView={handleSelectView}
          isAdmin={Boolean(user && (user.role?.toUpperCase() === 'ADMIN' || user.role?.toUpperCase() === 'SUPERADMIN'))}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto pb-16 md:pb-0">
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
              onOpenArticle={handleOpenArticle}
            />
          )}

          {currentView === 'ARTICLE' && activeArticleSlug && (
            <ArticleDetailView
              slug={activeArticleSlug}
              onBack={() => handleSelectView('OVERVIEW')}
              onOpenArticle={handleOpenArticle}
            />
          )}

          {currentView === 'NOTIFICATIONS' && (
            <NotificationsView
              user={user}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              onOpenArticle={handleOpenArticle}
              onUnreadCountChange={setUnreadNotificationsCount}
            />
          )}

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
            <div className="flex-1 flex flex-col p-3 lg:p-4 space-y-3 bg-[#090D12] overflow-y-auto">
              {/* Pair Header & 24h Ticker Strip */}
              <div className="flex flex-wrap items-center justify-between gap-4 px-3.5 py-2.5 rounded-[10px] bg-[#141C24] border border-[#202B34]">
                <div className="flex flex-wrap items-center gap-3.5">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsPairDropdownOpen(prev => !prev)}
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] hover:border-[#8DA5B1] transition-colors text-left cursor-pointer"
                    >
                      <AssetIcon symbol={selectedPair.baseCurrency} size="xs" />
                      <span className="text-sm sm:text-base font-semibold text-[#E4EBEF] font-mono">
                        {pairSymbol}
                      </span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-[#71818B] transition-transform ${
                          isPairDropdownOpen ? 'rotate-180 text-[#8DA5B1]' : ''
                        }`}
                      />
                      <StatusBadge tone="neutral">SPOT</StatusBadge>
                      {(selectedPair.isNewListing || selectedPair.baseCurrency === 'SOL') && (
                        <StatusBadge tone="brand">NEW</StatusBadge>
                      )}
                    </button>

                    {isPairDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsPairDropdownOpen(false)} />
                        <div className="absolute left-0 top-full mt-2 w-72 sm:w-80 rounded-[10px] bg-[#141C24] border border-[#2B3944] shadow-2xl p-3 z-50">
                          <div className="relative mb-2.5">
                            <label htmlFor="pair-search-input" className="sr-only">Cari koin atau pasar</label>
                            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#71818B]" />
                            <input
                              id="pair-search-input"
                              name="pairSearch"
                              autoFocus
                              placeholder="Cari koin atau pasar..."
                              aria-label="Cari koin atau pasar"
                              value={pairSearch}
                              onChange={e => setPairSearch(e.target.value)}
                              className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] placeholder-[#53616A] outline-none focus:border-[#8DA5B1]"
                            />
                          </div>

                          <div className="flex items-center gap-1 mb-2 pb-2 border-b border-[#202B34]">
                            {[
                              { id: 'ALL', label: 'All' },
                              { id: 'IDR', label: 'IDR' },
                              { id: 'USDT', label: 'USDT' },
                              { id: 'NEW', label: 'New Listing' },
                            ].map(tab => (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => setPairFilterTab(tab.id as any)}
                                className={`px-2 py-1 text-[11px] rounded-[5px] transition-colors cursor-pointer ${
                                  pairFilterTab === tab.id
                                    ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border border-[#2B3944]'
                                    : 'text-[#71818B] hover:text-[#E4EBEF]'
                                }`}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>

                          <div className="max-h-64 overflow-y-auto space-y-1 scrollbar-thin">
                            {pairs
                              .filter(p => {
                                const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;
                                const match =
                                  sym.toLowerCase().includes(pairSearch.toLowerCase()) ||
                                  p.baseCurrency.toLowerCase().includes(pairSearch.toLowerCase());
                                if (!match) return false;
                                if (pairFilterTab === 'NEW') return p.isNewListing || p.baseCurrency === 'SOL';
                                if (pairFilterTab === 'IDR') return p.quoteCurrency === 'IDR';
                                if (pairFilterTab === 'USDT') return p.quoteCurrency === 'USDT';
                                return true;
                              })
                              .map(p => {
                                const sym = `${p.baseCurrency}/${p.quoteCurrency}`;
                                const isCurrent = p.id === selectedPairId;
                                const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');

                                return (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => {
                                      handleSelectPair(p.id);
                                      setIsPairDropdownOpen(false);
                                    }}
                                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-[7px] text-xs transition-colors cursor-pointer ${
                                      isCurrent
                                        ? 'bg-[#1D2832] border border-[#40515D] text-[#E4EBEF]'
                                        : 'hover:bg-[#17212B] text-[#A1AFB8]'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <AssetIcon symbol={p.baseCurrency} logoUrl={p.baseLogoUrl || undefined} size="xs" />
                                      <span className="font-semibold text-[#E4EBEF] font-mono">{sym}</span>
                                      {p.isDelisted ? (
                                        <StatusBadge tone="danger">DELISTED</StatusBadge>
                                      ) : p.delistScheduledAt && p.delistScheduledAt > Date.now() ? (
                                        <StatusBadge tone="danger">DELISTING</StatusBadge>
                                      ) : !p.isActive && p.scheduledAt && p.scheduledAt > Date.now() ? (
                                        <StatusBadge tone="warning">SOON</StatusBadge>
                                      ) : (p.isNewListing || p.baseCurrency === 'SOL') ? (
                                        <StatusBadge tone="brand">NEW</StatusBadge>
                                      ) : null}
                                    </div>
                                    <div className="text-right font-mono tabular-nums">
                                      <div className="font-semibold text-[#E4EBEF]">
                                        {formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}
                                      </div>
                                      <PercentageChange value={chg} size="xs" />
                                    </div>
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="h-5 w-px bg-[#202B34] hidden sm:block" />

                  <div className="flex items-baseline gap-2.5 font-mono tabular-nums">
                    <span className="text-base lg:text-lg font-semibold text-[#E4EBEF]">
                      {formatQuotePrice(selectedPair.lastPrice, selectedPair.quoteCurrency, selectedPair.quoteDecimals, true)}
                    </span>
                    <PercentageChange value={changeNum} size="sm" />
                  </div>
                </div>

                {/* 24h High, Low, Volume */}
                <div className="flex flex-wrap items-center gap-5 text-xs font-mono tabular-nums">
                  <div>
                    <span className="text-[10px] font-sans text-[#71818B] block">24h High</span>
                    <span className="text-[#E4EBEF] font-medium">
                      {formatQuotePrice(selectedPair.high24h, selectedPair.quoteCurrency, selectedPair.quoteDecimals, true)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-sans text-[#71818B] block">24h Low</span>
                    <span className="text-[#E4EBEF] font-medium">
                      {formatQuotePrice(selectedPair.low24h, selectedPair.quoteCurrency, selectedPair.quoteDecimals, true)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-sans text-[#71818B] block">24h Vol ({selectedPair.baseCurrency})</span>
                    <span className="text-[#E4EBEF] font-medium">
                      {formatCrypto(selectedPair.volume24h, selectedPair.baseDecimals)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-sans text-[#71818B] block">24h Vol ({selectedPair.quoteCurrency})</span>
                    <span className="text-[#E4EBEF] font-medium">
                      {formatPairVolume(selectedPair.quoteVolume24h || '0', selectedPair.quoteCurrency, selectedPair.quoteDecimals)}
                    </span>
                  </div>
                  <div className="hidden sm:block">
                    <span className="text-[10px] font-sans text-[#71818B] block">Maker / Taker</span>
                    <span className="text-[#A5BAC4] font-medium">
                      {((selectedPair.makerFeeBps ?? 10) / 100).toFixed(2)}% / {((selectedPair.takerFeeBps ?? 20) / 100).toFixed(2)}%
                    </span>
                  </div>

                  {/* Spot Trading Preferences Trigger */}
                  <button
                    type="button"
                    onClick={() => setIsSpotPreferencesOpen(true)}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-[7px] bg-[#111820] hover:bg-[#17212B] border border-[#2B3944] hover:border-[#8DA5B1] text-xs font-sans font-medium text-[#E4EBEF] transition-colors cursor-pointer"
                    title="Preferences · Layout Settings"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-[#8DA5B1]" />
                    <span>Preferences</span>
                    <span className="px-1.5 py-0.5 rounded-[4px] bg-[#1D2832] border border-[#2B3944] text-[10px] font-mono text-[#A5BAC4]">
                      {SPOT_LAYOUT_LABELS[spotLayout]}
                    </span>
                  </button>
                </div>
              </div>

              {/* Single Stable Terminal Grid — Rearranges Panels Purely via CSS Without Unmounting Chart or Engine Feeds */}
              <div
                className={`grid grid-cols-1 gap-3 items-start ${
                  spotLayout === 'CLASSIC'
                    ? 'lg:grid-cols-12'
                    : spotLayout === 'PRO_TERMINAL'
                    ? 'lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_276px_296px] 2xl:grid-cols-[minmax(0,1fr)_304px_316px]'
                    : 'lg:grid-cols-[minmax(0,1fr)_288px] xl:grid-cols-[minmax(0,1fr)_304px]'
                }`}
              >
                {/* PANEL 1: Candlestick Chart (Never unmounted across presets) */}
                <div
                  key="spot-panel-chart"
                  className={`rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden min-w-0 flex flex-col ${
                    spotLayout === 'CLASSIC'
                      ? 'order-1 lg:col-span-8 lg:col-start-1 lg:row-start-1'
                      : spotLayout === 'PRO_TERMINAL'
                      ? 'order-1 lg:col-start-1 lg:row-start-1 lg:row-span-3 xl:row-span-2 self-stretch'
                      : hideRecentTradesInChartFocus
                      ? 'order-1 lg:col-start-1 lg:row-start-1 lg:row-span-2 self-stretch'
                      : 'order-1 lg:col-start-1 lg:row-start-1 lg:row-span-3 self-stretch'
                  }`}
                >
                  <TradingChart
                    pair={selectedPair}
                    recentTrades={recentTrades}
                    onRefreshMarkets={fetchInitialData}
                    canvasMinHeightClass={
                      spotLayout === 'CHART_FOCUS'
                        ? 'min-h-[460px] lg:min-h-[630px]'
                        : spotLayout === 'PRO_TERMINAL'
                        ? 'min-h-[430px] lg:min-h-[560px]'
                        : 'min-h-[420px] lg:min-h-[455px]'
                    }
                  />
                </div>

                {/* PANEL 2: Order Book & D3 Depth */}
                <div
                  key="spot-panel-orderbook"
                  className={`rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden min-w-0 ${
                    spotLayout === 'CLASSIC'
                      ? 'order-3 lg:order-none lg:col-span-4 lg:col-start-9 lg:row-start-1'
                      : spotLayout === 'PRO_TERMINAL'
                      ? 'order-2 lg:order-none lg:col-start-2 lg:row-start-1'
                      : 'order-2 lg:order-none lg:col-start-2 lg:row-start-1'
                  }`}
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-[#202B34] bg-[#111820] gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setOrderBookTab('BOOK')}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-[6px] transition-colors cursor-pointer ${
                          orderBookTab === 'BOOK'
                            ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944]'
                            : 'text-[#71818B] hover:text-[#E4EBEF]'
                        }`}
                      >
                        Order Book
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrderBookTab('DEPTH')}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-[6px] transition-colors flex items-center gap-1.5 cursor-pointer ${
                          orderBookTab === 'DEPTH'
                            ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944]'
                            : 'text-[#71818B] hover:text-[#E4EBEF]'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#16A879]" />
                        Depth (D3)
                      </button>
                    </div>

                    {spotLayout === 'CHART_FOCUS' && (
                      <button
                        type="button"
                        onClick={() =>
                          handleSaveSpotPreferences('CHART_FOCUS', !hideRecentTradesInChartFocus)
                        }
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-[5px] bg-[#141C24] hover:bg-[#1D2832] border border-[#2B3944] text-[10px] font-mono text-[#A1AFB8] hover:text-[#E4EBEF] transition-colors cursor-pointer"
                        title={
                          hideRecentTradesInChartFocus
                            ? 'Show Recent Trades panel'
                            : 'Hide Recent Trades panel'
                        }
                      >
                        {hideRecentTradesInChartFocus ? (
                          <>
                            <Eye className="w-3 h-3 text-[#8DA5B1]" />
                            <span>Trades ({recentTrades.length})</span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3 h-3 text-[#71818B]" />
                            <span>Hide Trades</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="p-1.5">
                    {orderBookTab === 'BOOK' ? (
                      <OrderBookView
                        pair={selectedPair}
                        depth={depth}
                        compact={spotLayout === 'CHART_FOCUS'}
                        onSelectPrice={p => setSelectedPriceForOrder(p)}
                      />
                    ) : (
                      <D3DepthChart
                        pair={selectedPair}
                        depth={depth}
                        onSelectPrice={p => setSelectedPriceForOrder(p)}
                        height={spotLayout === 'CHART_FOCUS' ? 290 : 400}
                      />
                    )}
                  </div>
                </div>

                {/* PANEL 3: Buy / Sell Order Placement Form */}
                <div
                  key="spot-panel-orderform"
                  className={`min-w-0 ${
                    spotLayout === 'CLASSIC'
                      ? 'order-2 lg:order-none lg:col-span-8 lg:col-start-1 lg:row-start-2'
                      : spotLayout === 'PRO_TERMINAL'
                      ? 'order-3 lg:order-none lg:col-start-2 lg:row-start-3 xl:col-start-3 xl:row-start-1 xl:row-span-2'
                      : 'order-3 lg:order-none lg:col-start-2 lg:row-start-2'
                  }`}
                >
                  <OrderPlacementForm
                    pair={selectedPair}
                    user={user}
                    balances={balances}
                    selectedPriceUnits={selectedPriceForOrder}
                    layoutMode={spotLayout === 'CLASSIC' ? 'HORIZONTAL' : 'STACKED'}
                    onOrderPlaced={(newOrder) => {
                      refreshBalances();
                      refreshUserOrders(newOrder);
                      fetchPairMarketData();
                    }}
                    onOpenAuthModal={() => setIsAuthModalOpen(true)}
                  />
                </div>

                {/* PANEL 4: Recent Market Trades (Preserved live in DOM even when hidden in Chart Focus) */}
                <div
                  key="spot-panel-recenttrades"
                  className={`rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden min-w-0 ${
                    spotLayout === 'CLASSIC'
                      ? 'order-4 lg:order-none lg:col-span-4 lg:col-start-9 lg:row-start-2'
                      : spotLayout === 'PRO_TERMINAL'
                      ? 'order-4 lg:order-none lg:col-start-2 lg:row-start-2'
                      : hideRecentTradesInChartFocus
                      ? 'hidden'
                      : 'order-4 lg:order-none lg:col-start-2 lg:row-start-3'
                  }`}
                >
                  <RecentTradesView
                    pair={selectedPair}
                    trades={recentTrades}
                    currentUserId={user?.id}
                    compact
                  />
                </div>

                {/* PANEL 5: Open Orders & Order History */}
                <div
                  key="spot-panel-userorders"
                  className={`rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden min-w-0 ${
                    spotLayout === 'CLASSIC'
                      ? 'order-5 lg:order-none lg:col-span-12 lg:col-start-1 lg:row-start-3'
                      : spotLayout === 'PRO_TERMINAL'
                      ? 'order-5 lg:order-none lg:col-span-2 lg:col-start-1 lg:row-start-4 xl:col-span-3 xl:row-start-3'
                      : 'order-5 lg:order-none lg:col-span-2 lg:col-start-1 lg:row-start-4'
                  }`}
                >
                  <UserOrdersTable
                    openOrders={openOrders}
                    orderHistory={orderHistory}
                    pairs={pairs}
                    onCancelOrder={handleCancelOrder}
                    isLoading={isLoadingOrders}
                    currentUserEmail={user?.email}
                    userRole={user?.role}
                  />
                </div>
              </div>
            </div>
          )}

          {currentView === 'FUTURES' && (
            <FuturesTerminal
              pair={selectedPair}
              pairs={pairs}
              onSelectPair={handleSelectPair}
              user={user}
              displayCurrency={displayCurrency}
              balances={balances}
              depth={depth}
              recentTrades={recentTrades}
              onRefreshBalances={refreshBalances}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />
          )}

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

          {(currentView === 'ORDERS' || currentView === 'TRANSACTIONS') && (
            <OrdersView
              openOrders={openOrders}
              orderHistory={orderHistory}
              recentTrades={recentTrades}
              pairs={pairs}
              onCancelOrder={handleCancelOrder}
            />
          )}

          {currentView === 'COPY' && (
            <CopyTradingView
              user={user}
              balances={balances}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              displayCurrency={displayCurrency}
            />
          )}

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

          {currentView === 'REWARDS' && (
            <RewardsVipView
              user={user}
              balances={balances}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              displayCurrency={displayCurrency}
            />
          )}

          {currentView === 'EARN' && <EarnView />}

          {currentView === 'BOT' && (
            <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto space-y-4">
              <SegmentedTabs
                activeTab={botConsoleMode}
                onChange={setBotConsoleMode}
                tabs={[
                  {
                    id: 'STRATEGIES',
                    label: 'Bot Trading Strategies',
                    icon: <Zap className="w-3.5 h-3.5" />,
                  },
                  {
                    id: 'AUTOMATED',
                    label: 'Automated Quantitative Bots',
                    icon: <Bot className="w-3.5 h-3.5" />,
                  },
                  {
                    id: 'MM_CONSOLE',
                    label: 'Market Maker Operator',
                    icon: <Building2 className="w-3.5 h-3.5" />,
                  },
                ]}
              />

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

          {(currentView === 'SETTINGS' || currentView === 'SECURITY') && (
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

      <MobileBottomNav
        currentView={currentView}
        onSelectView={v => handleSelectView(v as ActiveViewType)}
      />

      {/* Footer */}
      <footer className="hidden md:flex border-t border-[#202B34] bg-[#090D12] py-2.5 px-6 text-xs text-[#71818B] items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#E4EBEF] tracking-wider">DIMONEX</span>
          <span>·</span>
          <span>Precision in Every Trade</span>
          <span>·</span>
          <span>Double-Entry Atomic Ledger</span>
          <span>·</span>
          <span>FIFO In-Memory Matching Engine</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span>Zero-Float BigInt Architecture</span>
          <span>·</span>
          <span className="text-[#35B887]">
            {isWebSocketSupported() ? 'WebSocket Live Feed' : 'REST Sync Active'}
          </span>
        </div>
      </footer>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={(_token, authedUser) => {
          setUser(authedUser);
          if (authedUser?.preferences?.spotLayout) {
            setSpotLayout(authedUser.preferences.spotLayout);
            setHideRecentTradesInChartFocus(
              authedUser.preferences.hideRecentTradesInChartFocus ?? true
            );
          }
          fetchInitialData();
        }}
      />

      <SpotPreferencesModal
        isOpen={isSpotPreferencesOpen}
        onClose={() => setIsSpotPreferencesOpen(false)}
        activeLayout={spotLayout}
        hideRecentTradesInChartFocus={hideRecentTradesInChartFocus}
        isAuthenticated={Boolean(user)}
        isSaving={isSavingSpotPreferences}
        onApply={handleSaveSpotPreferences}
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
