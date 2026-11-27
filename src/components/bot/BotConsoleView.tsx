/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/bot/BotConsoleView.tsx
 * Algorithmic Trading Bot Console for DIMONEX (Obsidian Iridium)
 * Features:
 * - Direct integration with generated HMAC API Keys & User Account
 * - Spot Grid Trading Bot (Arithmetic / Geometric spacing)
 * - Layered Limit Buy / Sell Ladder generator (Spread % steps & volume sizing)
 * - Auto Smart Trade (Target Volume & Price Execution / TWAP Slicer)
 * - Volume Maker Bot (Target Volume Reach, Min/Max Price, Delay Seconds, Amount Random, Buy First/Sell First/Random)
 * - Live execution terminal & Active Bot Order Manager with 1-click cancellation
 */

import React, { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Crown,
  Flame,
  KeyRound,
  Layers,
  ListOrdered,
  Play,
  RefreshCw,
  Settings2,
  Shield,
  Square,
  Target,
  Terminal,
  User,
  X,
  Zap,
} from 'lucide-react';
import { UserProfile, TradingPairItem, UserBalance, OrderItem } from '../../types/index.js';
import { formatIDR, formatCrypto, formatDateTime, safeBigInt, formatQuotePrice } from '../../lib/formatters.js';
import { isWebSocketSupported, reportWebSocketSuccess, reportWebSocketFailure } from '../../utils/wsHelper.js';
import { runSingleFlight } from '../../lib/safeFetch.js';
import { Button } from '../ui/Button.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { PanelHeader } from '../ui/PanelHeader.js';
import { SegmentedTabs } from '../ui/Tabs.js';
import { VolumeExecutionV2Panel } from './VolumeExecutionV2Panel.js';

interface Props {
  user: UserProfile | null;
  tradingPairs: TradingPairItem[];
  balances: UserBalance[];
  onRefreshBalances: () => void;
  onRefreshOrders?: () => void;
  onOpenAuthModal: () => void;
  onOpenSecurityView: () => void;
}

export const BotConsoleView: React.FC<Props> = ({
  user,
  tradingPairs,
  balances,
  onRefreshBalances,
  onRefreshOrders,
  onOpenAuthModal,
  onOpenSecurityView,
}) => {
  const [selectedPairId, setSelectedPairId] = useState('BTC-IDR');
  const [activeStrategy, setActiveStrategy] = useState<'GRID' | 'LAYERS' | 'SMART' | 'VOLUME' | 'VOLUME_V2'>('GRID');

  // API Key integration state
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [selectedApiKeyId, setSelectedApiKeyId] = useState<string>('');
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);

  // Active Bots & Bot Orders list
  const [bots, setBots] = useState<any[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [botOpenOrders, setBotOpenOrders] = useState<OrderItem[]>([]);
  const [activeConsoleTab, setActiveConsoleTab] = useState<'CONFIG' | 'BOT_ORDERS'>('CONFIG');
  const [consoleFilterTab, setConsoleFilterTab] = useState<'ALL' | 'RUNNING' | 'STOPPED'>('ALL');
  const [wsConnected, setWsConnected] = useState(false);

  // Spot Grid Form state
  const [gridLowerPrice, setGridLowerPrice] = useState('1400000000');
  const [gridUpperPrice, setGridUpperPrice] = useState('1500000000');
  const [gridCount, setGridCount] = useState('6');
  const [gridInvestment, setGridInvestment] = useState('25000000');
  const [gridSpacingMode, setGridSpacingMode] = useState<'ARITHMETIC' | 'GEOMETRIC'>('ARITHMETIC');

  // Layered Orders Form state
  const [layerSide, setLayerSide] = useState<'BUY' | 'SELL'>('BUY');
  const [layerStartPrice, setLayerStartPrice] = useState('1440000000');
  const [layerCount, setLayerCount] = useState('5');
  const [layerStepPercent, setLayerStepPercent] = useState('0.8');
  const [layerQty, setLayerQty] = useState('0.05');

  // Smart Trade Form state
  const [smartSide, setSmartSide] = useState<'BUY' | 'SELL'>('BUY');
  const [smartTargetPrice, setSmartTargetPrice] = useState('1435000000');
  const [smartTotalVol, setSmartTotalVol] = useState('0.2');
  const [smartSliceCount, setSmartSliceCount] = useState('4');
  const [smartOrderType, setSmartOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');

  // Volume Bot Form state
  const [volTargetVolume, setVolTargetVolume] = useState('2.5');
  const [volMinPrice, setVolMinPrice] = useState('1420000000');
  const [volMaxPrice, setVolMaxPrice] = useState('1480000000');
  const [volDelaySeconds, setVolDelaySeconds] = useState('3');
  const [volAmountRandom, setVolAmountRandom] = useState(true);
  const [volAmountMin, setVolAmountMin] = useState('0.02');
  const [volAmountMax, setVolAmountMax] = useState('0.08');
  const [volDirectionMode, setVolDirectionMode] = useState<'BUY_FIRST' | 'SELL_FIRST' | 'RANDOM'>('RANDOM');

  const [isLoading, setIsLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedPair =
    tradingPairs.find(p => p.id === selectedPairId) ||
    tradingPairs[0] || {
      id: 'BTC-IDR',
      baseCurrency: 'BTC',
      quoteCurrency: 'IDR',
      baseDecimals: 8,
      quoteDecimals: 2,
      lastPrice: '145000000000',
      minOrderSize: '1000',
    };

  const quoteDecimals =
    selectedPair.quoteDecimals ?? (selectedPair.quoteCurrency === 'USDT' ? 6 : 2);
  const quoteDivisor = 10 ** quoteDecimals;

  const formatInputPrice = (val: number) => {
    if (!Number.isFinite(val) || val <= 0) return '0';
    if (selectedPair.quoteCurrency === 'IDR') return Math.round(val).toString();
    return Number(val.toFixed(quoteDecimals)).toString();
  };

  useEffect(() => {
    if (!user) return;
    let ws: WebSocket | null = null;
    let isDisposed = false;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectWs = () => {
      if (isDisposed || !isWebSocketSupported()) {
        setWsConnected(false);
        return;
      }
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          reportWebSocketSuccess();
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          setWsConnected(true);
          ws.send(
            JSON.stringify({
              action: 'subscribe',
              channel: `bots:${user.id}`,
              userId: user.id,
            })
          );
          ws.send(
            JSON.stringify({
              action: 'subscribe',
              channel: `orders:${user.id}`,
              userId: user.id,
            })
          );
        };

        let wsSyncTimer: NodeJS.Timeout | null = null;
        const scheduleOrderRefresh = () => {
          if (wsSyncTimer) return;
          wsSyncTimer = setTimeout(() => {
            wsSyncTimer = null;
            loadBotOpenOrders();
            onRefreshBalances();
            if (onRefreshOrders) onRefreshOrders();
          }, 500);
        };

        ws.onmessage = event => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'bot_snapshot' && Array.isArray(msg.data)) {
              setBots(msg.data);
            } else if (msg.type === 'bot_updated' && msg.data) {
              const updatedBot = msg.data;
              setBots(prev => {
                const idx = prev.findIndex(b => b.id === updatedBot.id);
                if (idx !== -1) {
                  const next = [...prev];
                  next[idx] = { ...next[idx], ...updatedBot };
                  return next;
                }
                return [updatedBot, ...prev];
              });
              scheduleOrderRefresh();
            } else if (msg.type === 'bot_stopped' && msg.data) {
              const stoppedBot = msg.data;
              setBots(prev => prev.map(b => (b.id === stoppedBot.id ? { ...b, status: 'STOPPED' } : b)));
              scheduleOrderRefresh();
            } else if (msg.type === 'order_update') {
              scheduleOrderRefresh();
            }
          } catch {
            // silent
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          if (wsSyncTimer) {
            clearTimeout(wsSyncTimer);
            wsSyncTimer = null;
          }
          if (!isDisposed && isWebSocketSupported()) {
            reconnectTimeout = setTimeout(connectWs, 5000);
          }
        };

        ws.onerror = () => {
          reportWebSocketFailure();
          setWsConnected(false);
        };
      } catch {
        reportWebSocketFailure();
        setWsConnected(false);
      }
    };

    connectWs();
    loadUserApiKeys();
    loadActiveBots();
    loadBotOpenOrders();

    const pollInterval = isWebSocketSupported() ? 25000 : 5000;
    const fallbackInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      loadActiveBots();
      loadBotOpenOrders();
    }, pollInterval);

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      clearInterval(fallbackInterval);
      if (ws) ws.close();
    };
  }, [user]);

  // Set default prices when pair changes using accurate quoteDecimals
  useEffect(() => {
    if (selectedPair && selectedPair.lastPrice) {
      const qDec =
        selectedPair.quoteDecimals ?? (selectedPair.quoteCurrency === 'USDT' ? 6 : 2);
      const midQuote = Number(safeBigInt(selectedPair.lastPrice)) / 10 ** qDec;
      if (Number.isFinite(midQuote) && midQuote > 0) {
        const fmt = (v: number) =>
          selectedPair.quoteCurrency === 'IDR'
            ? Math.round(v).toString()
            : Number(v.toFixed(qDec)).toString();
        setGridLowerPrice(fmt(midQuote * 0.95));
        setGridUpperPrice(fmt(midQuote * 1.05));
        setLayerStartPrice(fmt(midQuote * 0.99));
        setSmartTargetPrice(fmt(midQuote));
        setVolMinPrice(fmt(midQuote * 0.98));
        setVolMaxPrice(fmt(midQuote * 1.02));
      }

      if (selectedPair.baseCurrency === 'BTC') {
        setVolTargetVolume('2.0');
        setVolAmountMin('0.02');
        setVolAmountMax('0.08');
      } else if (selectedPair.baseCurrency === 'ETH') {
        setVolTargetVolume('20.0');
        setVolAmountMin('0.2');
        setVolAmountMax('0.8');
      } else {
        setVolTargetVolume('5000');
        setVolAmountMin('50');
        setVolAmountMax('200');
      }
    }
  }, [selectedPairId, selectedPair.lastPrice]);

  const loadUserApiKeys = async () => {
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/api-keys/list', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (data && data.length > 0) {
          setApiKeys(data);
          if (!selectedApiKeyId) setSelectedApiKeyId(data[0].keyId);
        }
      }
    } catch {
      // silent
    }
  };

  const handleQuickCreateApiKey = async () => {
    setIsGeneratingKey(true);
    setActionError(null);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/api-keys/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          label: `Algo Bot Key (${user?.role === 'admin' ? 'Admin' : 'Trader'})`,
          permissions: ['read', 'trade'],
          ipWhitelist: '*',
        }),
      });
      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        data = await res.json();
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setActionMessage(`Kunci API Baru berhasil dibuat: ${data.apiKey}. Bot otomatis terhubung!`);
      await loadUserApiKeys();
      setSelectedApiKeyId(data.apiKey);
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsGeneratingKey(false);
    }
  };

  const loadActiveBots = async () => {
    return runSingleFlight('bot-console:list', async () => {
      try {
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/bot/list', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          const data = await res.json();
          setBots(data);
          if (!selectedBotId && data.length > 0) {
            setSelectedBotId(data[0].id);
          }
        }
      } catch {
        // silent
      }
    });
  };

  const loadBotOpenOrders = async () => {
    return runSingleFlight('bot-console:open-orders', async () => {
      try {
        const token = localStorage.getItem('dimonex_auth_token');
        const res = await fetch('/api/bot/open-orders', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          setBotOpenOrders(await res.json());
        }
      } catch {
        // silent
      }
    });
  };

  // Preset price adjustment helper using accurate quoteDecimals
  const applyPercentPreset = (
    percent: number,
    target: 'LOWER' | 'UPPER' | 'LAYER_START' | 'SMART_TARGET' | 'VOL_MIN' | 'VOL_MAX'
  ) => {
    const mid = Number(safeBigInt(selectedPair.lastPrice || '0')) / quoteDivisor;
    if (!Number.isFinite(mid) || mid <= 0) return;
    const newPrice = formatInputPrice(mid * (1 + percent / 100));
    if (target === 'LOWER') setGridLowerPrice(newPrice);
    if (target === 'UPPER') setGridUpperPrice(newPrice);
    if (target === 'LAYER_START') setLayerStartPrice(newPrice);
    if (target === 'SMART_TARGET') setSmartTargetPrice(newPrice);
    if (target === 'VOL_MIN') setVolMinPrice(newPrice);
    if (target === 'VOL_MAX') setVolMaxPrice(newPrice);
  };

  // 1. Deploy Grid Bot
  const handleDeployGrid = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);
    setIsLoading(true);

    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/bot/grid/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          apiKeyId: selectedApiKeyId,
          pairId: selectedPairId,
          lowerPrice: gridLowerPrice,
          upperPrice: gridUpperPrice,
          gridCount,
          totalInvestmentIdr: gridInvestment,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setActionMessage(
        `Bot Spot Grid berhasil diluncurkan! Terpasang ${data.bot.deployedOrderIds.length} limit order aktif di antrean Order Aktif Anda (${user?.email}).`
      );
      loadActiveBots();
      loadBotOpenOrders();
      onRefreshBalances();
      if (onRefreshOrders) onRefreshOrders();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Deploy Layer Orders
  const handleDeployLayers = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);
    setIsLoading(true);

    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/bot/layers/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          apiKeyId: selectedApiKeyId,
          pairId: selectedPairId,
          side: layerSide,
          startPrice: layerStartPrice,
          layerCount,
          priceStepPercent: layerStepPercent,
          quantityPerLayer: layerQty,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setActionMessage(
        `Berhasil mendeploy ${data.bot.deployedOrderIds.length} limit order layer ${layerSide}! Order langsung aktif di antrean Order Aktif akun Anda (${user?.email}).`
      );
      loadActiveBots();
      loadBotOpenOrders();
      onRefreshBalances();
      if (onRefreshOrders) onRefreshOrders();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Deploy Smart Trade
  const handleDeploySmartTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);
    setIsLoading(true);

    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/bot/smart-trade/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          apiKeyId: selectedApiKeyId,
          pairId: selectedPairId,
          side: smartSide,
          targetPrice: smartTargetPrice,
          totalVolume: smartTotalVol,
          sliceCount: smartSliceCount,
          orderType: smartOrderType,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setActionMessage(
        `Smart Trade ${smartSide} berhasil dimulai: Target ${smartTotalVol} ${selectedPair.baseCurrency}. Order terdaftar di Order Aktif Anda.`
      );
      loadActiveBots();
      loadBotOpenOrders();
      onRefreshBalances();
      if (onRefreshOrders) onRefreshOrders();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Deploy Volume Maker Bot
  const handleDeployVolumeBot = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);
    setIsLoading(true);

    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/bot/volume/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          apiKeyId: selectedApiKeyId,
          pairId: selectedPairId,
          targetVolumeReach: volTargetVolume,
          minPrice: volMinPrice,
          maxPrice: volMaxPrice,
          delaySecondAmount: volDelaySeconds,
          amountRandom: volAmountRandom,
          amountMin: volAmountMin,
          amountMax: volAmountMax,
          directionMode: volDirectionMode,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setActionMessage(
        `Bot Volume berhasil diluncurkan! Target: ${volTargetVolume} ${selectedPair.baseCurrency} | Delay: ${volDelaySeconds}s | Mode: ${volDirectionMode}`
      );
      loadActiveBots();
      loadBotOpenOrders();
      onRefreshBalances();
      if (onRefreshOrders) onRefreshOrders();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Stop Bot
  const handleStopBot = async (botId: string) => {
    setIsLoading(true);
    setActionError(null);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/bot/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ botId, cancelOpenOrders: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage(data.message || 'Bot berhasil dihentikan dan order aktif dibatalkan.');
        loadActiveBots();
        loadBotOpenOrders();
        onRefreshBalances();
        if (onRefreshOrders) onRefreshOrders();
      } else {
        setActionError(data.error || 'Gagal menghentikan bot.');
      }
    } catch (e: any) {
      setActionError(e.message || 'Koneksi gagal saat menghentikan bot.');
    } finally {
      setIsLoading(false);
    }
  };

  // Cancel Individual Order
  const handleCancelSingleOrder = async (orderId: string, pairId: string) => {
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/trading/order/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ orderId, pairId }),
      });
      if (res.ok) {
        loadBotOpenOrders();
        onRefreshBalances();
        if (onRefreshOrders) onRefreshOrders();
      }
    } catch {
      // silent
    }
  };

  // Cancel All Bot Orders
  const handleCancelAllBotOrders = async () => {
    setIsLoading(true);
    setActionError(null);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/bot/cancel-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage(data.message || 'Semua order bot aktif berhasil dibatalkan.');
        loadActiveBots();
        loadBotOpenOrders();
        onRefreshBalances();
        if (onRefreshOrders) onRefreshOrders();
      } else {
        setActionError(data.error || 'Gagal membatalkan order bot.');
      }
    } catch (e: any) {
      setActionError(e.message || 'Koneksi gagal saat membatalkan semua order bot.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="p-8 text-center bg-[#141C24] border border-[#202B34] rounded-[10px]">
        <Bot className="w-8 h-8 text-[#8DA5B1] mx-auto mb-3" />
        <h2 className="text-base font-semibold text-[#E4EBEF] mb-1.5">DIMONEX Algo Bot Console</h2>
        <p className="text-xs text-[#A1AFB8] mb-4 max-w-md mx-auto">
          Masuk untuk mengonfigurasi Spot Grid, Layer Orders, Smart Trade, dan Volume Maker Bot.
        </p>
        <Button type="button" variant="primary" size="sm" onClick={onOpenAuthModal}>
          Masuk Akun
        </Button>
      </div>
    );
  }

  const selectedBot = bots.find(b => b.id === selectedBotId) || bots[0];
  const midPriceDisplay = Number(safeBigInt(selectedPair.lastPrice || '0')) / quoteDivisor;
  const gridIntervalNum =
    (Number(gridUpperPrice) - Number(gridLowerPrice)) / Math.max(1, Number(gridCount || 1));

  const duplicateRunningBot = bots.find(
    b =>
      b.pairId === selectedPairId &&
      b.status === 'RUNNING' &&
      ((activeStrategy === 'GRID' && b.strategy === 'SPOT_GRID') ||
        (activeStrategy === 'LAYERS' &&
          ((layerSide === 'BUY' && b.strategy === 'BUY_LAYERS') ||
            (layerSide === 'SELL' && b.strategy === 'SELL_LAYERS'))) ||
        (activeStrategy === 'SMART' && b.strategy === 'SMART_TRADE') ||
        (activeStrategy === 'VOLUME' && b.strategy === 'VOLUME_BOT'))
  );

  const runningBots = bots.filter(b => b.status === 'RUNNING');
  const stoppedBots = bots.filter(b => b.status !== 'RUNNING');
  const displayedBots =
    consoleFilterTab === 'RUNNING' ? runningBots : consoleFilterTab === 'STOPPED' ? stoppedBots : bots;

  return (
    <div className="space-y-5">
      {/* Console Header & API Key Binding */}
      <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="w-4 h-4 text-[#8DA5B1] shrink-0" />
            <h2 className="text-sm sm:text-base font-semibold text-[#E4EBEF] tracking-tight">
              DIMONEX Algo Trading Bot Console
            </h2>
            <StatusBadge tone="brand">HMAC-SHA256 SIGNED</StatusBadge>
            <StatusBadge tone={user.role === 'admin' ? 'warning' : 'neutral'}>
              {user.role === 'admin' ? <Crown className="w-3 h-3" /> : <User className="w-3 h-3" />}
              <span>
                {user.role === 'admin' ? 'AKUN ADMIN' : 'AKUN TRADER'}: {user.email}
              </span>
            </StatusBadge>
            <StatusBadge tone={wsConnected ? 'success' : 'warning'} dot>
              {wsConnected ? 'WS LIVE' : 'SYNCING'}
            </StatusBadge>
          </div>
          <p className="text-xs text-[#A1AFB8] mt-1.5 leading-relaxed">
            Eksekusi otomatis strategi kuantitatif. Semua order limit langsung terdaftar di antrean{' '}
            <strong className="text-[#E4EBEF]">Order Aktif</strong> akun Anda dan ditandai di Buku Order.
          </p>
        </div>

        {/* API Key Selector & Quick Create */}
        <div className="flex flex-wrap items-center gap-2 bg-[#111820] p-2.5 rounded-[7px] border border-[#202B34] shrink-0">
          <span className="text-[11px] text-[#A1AFB8] font-medium flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-[#8DA5B1]" />
            Kunci API:
          </span>
          {apiKeys.length === 0 ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="profit"
                size="sm"
                onClick={handleQuickCreateApiKey}
                isLoading={isGeneratingKey}
                icon={<Zap className="w-3.5 h-3.5" />}
              >
                {isGeneratingKey ? 'Membuat Kunci...' : 'Buat Kunci API Cepat'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onOpenSecurityView}>
                Kelola API
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={selectedApiKeyId}
                onChange={e => setSelectedApiKeyId(e.target.value)}
                aria-label="Pilih Kunci API Bot"
                className="bg-[#141C24] border border-[#2B3944] focus:border-[#8DA5B1] text-xs font-mono text-[#16A879] rounded-[7px] px-2.5 py-1.5 outline-none"
              >
                {apiKeys.map(k => (
                  <option key={k.id} value={k.keyId}>
                    {k.label} ({k.keyId.slice(0, 14)}...)
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleQuickCreateApiKey}
                disabled={isGeneratingKey}
                title="Buat Kunci API Baru"
              >
                + Baru
              </Button>
            </div>
          )}
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 bg-[#12392F]/50 border border-[#16A879]/35 text-[#E4EBEF] text-xs rounded-[7px] flex justify-between items-center">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#16A879] shrink-0" />
            <span>{actionMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="text-[#A1AFB8] hover:text-[#E4EBEF] p-1 cursor-pointer"
            aria-label="Tutup pesan sukses"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-3 bg-[#401F27]/50 border border-[#EA5B65]/35 text-[#E4EBEF] text-xs rounded-[7px] flex justify-between items-center">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#EA5B65] shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-[#A1AFB8] hover:text-[#E4EBEF] p-1 cursor-pointer"
            aria-label="Tutup pesan error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Tabs: Strategy Configurator vs Bot Active Orders */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          activeTab={activeConsoleTab}
          onChange={setActiveConsoleTab}
          tabs={[
            {
              id: 'CONFIG',
              label: 'Konfigurasi Strategi Bot',
              icon: <Settings2 className="w-3.5 h-3.5" />,
            },
            {
              id: 'BOT_ORDERS',
              label: 'Order Aktif dari Bot',
              icon: <ListOrdered className="w-3.5 h-3.5" />,
              badge: botOpenOrders.length > 0 ? botOpenOrders.length : undefined,
            },
          ]}
        />

        {botOpenOrders.length > 0 && (
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={handleCancelAllBotOrders}
            icon={<Square className="w-3.5 h-3.5" />}
          >
            Batalkan Semua Order Bot ({botOpenOrders.length})
          </Button>
        )}
      </div>

      {activeConsoleTab === 'CONFIG' ? (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: Strategy Configurator Forms */}
          <div className="lg:col-span-6 bg-[#141C24] border border-[#202B34] rounded-[10px] p-5 space-y-4">
            {/* Pair Selector & Strategy Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#202B34] pb-3.5">
              <div className="flex items-center gap-2.5">
                <select
                  value={selectedPairId}
                  onChange={e => setSelectedPairId(e.target.value)}
                  aria-label="Pilih Pair Bot"
                  className="bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] text-xs font-semibold font-mono text-[#E4EBEF] rounded-[7px] px-2.5 py-1.5 outline-none"
                >
                  {tradingPairs.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] font-mono tabular-nums text-[#71818B]">
                  Harga Pasar:{' '}
                  <strong className="text-[#E4EBEF]">
                    {formatQuotePrice(
                      selectedPair.lastPrice || '0',
                      selectedPair.quoteCurrency,
                      quoteDecimals,
                      true
                    )}
                  </strong>
                </span>
              </div>

              <div className="flex flex-wrap gap-1 bg-[#111820] p-1 rounded-[7px] border border-[#202B34] text-xs">
                {(
                  [
                    { id: 'GRID', label: 'Spot Grid' },
                    { id: 'LAYERS', label: 'Order Layers' },
                    { id: 'SMART', label: 'Smart Trade' },
                    { id: 'VOLUME', label: 'Bot Volume' },
                    { id: 'VOLUME_V2', label: 'Execution V2' },
                  ] as const
                ).map(item => {
                  const isActive = activeStrategy === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveStrategy(item.id)}
                      className={`px-2.5 py-1 font-medium rounded-[5px] transition-colors flex items-center gap-1 cursor-pointer border ${
                        isActive
                          ? item.id === 'VOLUME'
                            ? 'bg-[#401F27] border-[#EA5B65]/40 text-[#EA5B65] font-semibold'
                            : item.id === 'VOLUME_V2'
                            ? 'bg-[#12392F] border-[#16A879]/40 text-[#35B887] font-semibold'
                            : 'bg-[#1D2832] border-[#2B3944] text-[#E4EBEF] font-semibold'
                          : 'border-transparent text-[#71818B] hover:text-[#E4EBEF] hover:bg-[#17212B]'
                      }`}
                    >
                      {item.id === 'VOLUME' && <Flame className="w-3 h-3 text-[#EA5B65]" />}
                      {item.id === 'VOLUME_V2' && <Shield className="w-3 h-3 text-[#35B887]" />}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {activeStrategy === 'VOLUME_V2' && (
              <div className="p-3 bg-[#111820] rounded-[7px] border border-[#16A879]/30 text-xs text-[#A1AFB8]">
                Volume Execution Engine V2 aktif pada workspace penuh di bawah. Klik tab lain kapan saja untuk kembali
                ke form standar.
              </div>
            )}

            {/* Live Ledger Balance Card */}
            <div className="bg-[#111820] border border-[#202B34] rounded-[7px] p-3 flex items-center justify-between text-xs font-mono tabular-nums">
              <div>
                <span className="text-[10px] font-sans text-[#71818B] block">
                  Saldo Tersedia {selectedPair.quoteCurrency}:
                </span>
                <span className="font-semibold text-[#E4EBEF]">
                  {selectedPair.quoteCurrency === 'IDR'
                    ? formatIDR(
                        safeBigInt(
                          balances.find(b => b.currency === selectedPair.quoteCurrency)?.balanceAvailable || '0'
                        ).toString()
                      )
                    : `${(
                        Number(
                          safeBigInt(
                            balances.find(b => b.currency === selectedPair.quoteCurrency)?.balanceAvailable || '0'
                          )
                        ) /
                        10 ** quoteDecimals
                      ).toLocaleString()} ${selectedPair.quoteCurrency}`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[10px] font-sans text-[#71818B] block">
                    Saldo Tersedia {selectedPair.baseCurrency}:
                  </span>
                  <span className="font-semibold text-[#E4EBEF]">
                    {formatCrypto(
                      safeBigInt(
                        balances.find(b => b.currency === selectedPair.baseCurrency)?.balanceAvailable || '0'
                      ).toString(),
                      selectedPair.baseDecimals
                    )}{' '}
                    {selectedPair.baseCurrency}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRefreshBalances}
                  icon={<RefreshCw className="w-3 h-3" />}
                  title="Segarkan Saldo Ledger"
                >
                  Segarkan
                </Button>
              </div>
            </div>

            {/* STRATEGY 1: SPOT GRID CONFIG */}
            {activeStrategy === 'GRID' && (
              <form onSubmit={handleDeployGrid} className="space-y-4 text-xs">
                <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34] text-[#A1AFB8] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#E4EBEF]">Spot Grid Trading Strategy</span>
                    <StatusBadge tone="brand">Dua Arah: Beli &amp; Jual Berundak</StatusBadge>
                  </div>
                  <p className="text-[11px] text-[#71818B] leading-relaxed">
                    Memasang jaring limit order beli berundak di bawah harga pasar dan order jual di atas harga pasar.
                    Semua order masuk ke antrean <strong className="text-[#E4EBEF]">Order Aktif</strong> akun Anda.
                  </p>
                </div>

                {/* Price Presets */}
                <div className="flex items-center gap-2 text-[11px] text-[#71818B]">
                  <span>Preset Rentang Cepat:</span>
                  {[5, 10, 15].map(pct => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        applyPercentPreset(-pct, 'LOWER');
                        applyPercentPreset(pct, 'UPPER');
                      }}
                      className="px-2 py-0.5 bg-[#111820] hover:bg-[#1D2832] border border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF] rounded-[5px] font-mono tabular-nums transition-colors cursor-pointer"
                    >
                      ±{pct}%
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">
                      Batas Harga Bawah ({selectedPair.quoteCurrency}):
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={gridLowerPrice}
                      onChange={e => setGridLowerPrice(e.target.value)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-3 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">
                      Batas Harga Atas ({selectedPair.quoteCurrency}):
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={gridUpperPrice}
                      onChange={e => setGridUpperPrice(e.target.value)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-3 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">Jumlah Grid (3 - 30):</label>
                    <input
                      type="number"
                      value={gridCount}
                      min={3}
                      max={30}
                      onChange={e => setGridCount(e.target.value)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-3 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">
                      Total Alokasi Investasi ({selectedPair.quoteCurrency}):
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={gridInvestment}
                      onChange={e => setGridInvestment(e.target.value)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-3 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                    />
                  </div>
                </div>

                {/* Spacing Mode */}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[#71818B] text-[11px]">Mode Grid Step:</span>
                  <div className="flex gap-1.5 bg-[#111820] p-0.5 rounded-[7px] border border-[#202B34]">
                    <button
                      type="button"
                      onClick={() => setGridSpacingMode('ARITHMETIC')}
                      className={`px-2.5 py-1 rounded-[5px] text-[11px] font-medium transition-colors cursor-pointer ${
                        gridSpacingMode === 'ARITHMETIC'
                          ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944]'
                          : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
                      }`}
                    >
                      Aritmatika (Jarak {selectedPair.quoteCurrency} Sama)
                    </button>
                    <button
                      type="button"
                      onClick={() => setGridSpacingMode('GEOMETRIC')}
                      className={`px-2.5 py-1 rounded-[5px] text-[11px] font-medium transition-colors cursor-pointer ${
                        gridSpacingMode === 'GEOMETRIC'
                          ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944]'
                          : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
                      }`}
                    >
                      Geometris (Rasio % Sama)
                    </button>
                  </div>
                </div>

                {/* Grid Preview Calculation */}
                <div className="p-3 bg-[#111820] border border-[#202B34] rounded-[7px] text-[11px] space-y-1.5 font-mono tabular-nums">
                  <div className="flex justify-between text-[#71818B]">
                    <span>Jarak Interval Harga:</span>
                    <span className="text-[#E4EBEF] font-semibold">
                      {selectedPair.quoteCurrency === 'IDR'
                        ? `Rp ${Math.round(gridIntervalNum).toLocaleString('id-ID')}`
                        : `${gridIntervalNum.toFixed(Math.min(quoteDecimals, 6))} ${selectedPair.quoteCurrency}`}
                    </span>
                  </div>
                  <div className="flex justify-between text-[#71818B]">
                    <span>Estimasi Profit / Grid:</span>
                    <span className="text-[#16A879] font-semibold">
                      ~
                      {(
                        ((Number(gridUpperPrice) - Number(gridLowerPrice)) /
                          Number(gridLowerPrice || 1) /
                          Number(gridCount || 1)) *
                        100
                      ).toFixed(2)}
                      %
                    </span>
                  </div>
                </div>

                {duplicateRunningBot && (
                  <div className="p-3 bg-[#2C2415]/60 border border-[#D6A85C]/40 text-[#D6A85C] text-xs rounded-[7px] space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Bot Aktif Sedang Berjalan
                    </p>
                    <p className="text-[11px] text-[#A1AFB8]">
                      Bot <strong className="text-[#E4EBEF]">{duplicateRunningBot.name}</strong> sudah aktif di{' '}
                      {selectedPairId}. Hentikan bot sebelumnya sebelum meluncurkan bot baru.
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  disabled={isLoading || !!duplicateRunningBot}
                  isLoading={isLoading}
                  icon={<Play className="w-3.5 h-3.5" />}
                  className="w-full"
                >
                  {isLoading
                    ? 'Menerapkan Grid Order...'
                    : duplicateRunningBot
                      ? `Bot ${duplicateRunningBot.pairId} Sedang Berjalan (Hentikan Dulu)`
                      : 'Luncurkan Spot Grid Bot'}
                </Button>
              </form>
            )}

            {/* STRATEGY 2: LAYERED ORDERS LADDER */}
            {activeStrategy === 'LAYERS' && (
              <form onSubmit={handleDeployLayers} className="space-y-4 text-xs">
                <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34] text-[#A1AFB8] space-y-1">
                  <span className="font-semibold text-[#E4EBEF] flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[#8DA5B1]" />
                    Auto Create Limit Order Layers
                  </span>
                  <p className="text-[11px] text-[#71818B] leading-relaxed">
                    Membangun tangga likuiditas berundak untuk masuk posisi (Buy) atau take-profit bertahap (Sell). Semua
                    limit order otomatis masuk ke <strong className="text-[#E4EBEF]">Order Aktif</strong> akun Anda.
                  </p>
                </div>

                {/* Buy vs Sell side */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLayerSide('BUY');
                      setLayerStartPrice(formatInputPrice(midPriceDisplay * 0.99));
                    }}
                    className={`py-2 rounded-[7px] font-semibold border transition-colors cursor-pointer ${
                      layerSide === 'BUY'
                        ? 'bg-[#12392F] border-[#16A879] text-[#16A879]'
                        : 'bg-[#111820] border-[#202B34] text-[#71818B] hover:text-[#E4EBEF]'
                    }`}
                  >
                    Buy Layers (Tangga Beli)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLayerSide('SELL');
                      setLayerStartPrice(formatInputPrice(midPriceDisplay * 1.01));
                    }}
                    className={`py-2 rounded-[7px] font-semibold border transition-colors cursor-pointer ${
                      layerSide === 'SELL'
                        ? 'bg-[#401F27] border-[#EA5B65] text-[#EA5B65]'
                        : 'bg-[#111820] border-[#202B34] text-[#71818B] hover:text-[#E4EBEF]'
                    }`}
                  >
                    Sell Layers (Tangga Jual)
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">
                      Harga Awal Layer #1 ({selectedPair.quoteCurrency}):
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={layerStartPrice}
                      onChange={e => setLayerStartPrice(e.target.value)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-3 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">Jumlah Layer (2 - 20):</label>
                    <input
                      type="number"
                      value={layerCount}
                      min={2}
                      max={20}
                      onChange={e => setLayerCount(e.target.value)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-3 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">Jarak Antar Layer (% Spread Step):</label>
                    <input
                      type="number"
                      step="0.1"
                      value={layerStepPercent}
                      onChange={e => setLayerStepPercent(e.target.value)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-3 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">
                      Kuantitas per Layer ({selectedPair.baseCurrency}):
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={layerQty}
                      onChange={e => setLayerQty(e.target.value)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-3 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                    />
                  </div>
                </div>

                {duplicateRunningBot && (
                  <div className="p-3 bg-[#2C2415]/60 border border-[#D6A85C]/40 text-[#D6A85C] text-xs rounded-[7px] space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Bot Aktif Sedang Berjalan
                    </p>
                    <p className="text-[11px] text-[#A1AFB8]">
                      Bot <strong className="text-[#E4EBEF]">{duplicateRunningBot.name}</strong> sudah aktif di{' '}
                      {selectedPairId}. Hentikan bot sebelumnya sebelum membuat layer baru.
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  variant={layerSide === 'BUY' ? 'profit' : 'danger'}
                  size="md"
                  disabled={isLoading || !!duplicateRunningBot}
                  isLoading={isLoading}
                  icon={<Zap className="w-3.5 h-3.5" />}
                  className="w-full"
                >
                  {isLoading
                    ? 'Menerapkan Layers...'
                    : duplicateRunningBot
                      ? `Bot ${duplicateRunningBot.pairId} Sedang Berjalan (Hentikan Dulu)`
                      : `Deploy ${layerCount} Layer ${layerSide} Orders`}
                </Button>
              </form>
            )}

            {/* STRATEGY 3: AUTO SMART TRADE */}
            {activeStrategy === 'SMART' && (
              <form onSubmit={handleDeploySmartTrade} className="space-y-4 text-xs">
                <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34] text-[#A1AFB8] space-y-1">
                  <span className="font-semibold text-[#E4EBEF] flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-[#8DA5B1]" />
                    Auto Smart Trade &amp; Slicer (TWAP / Volume Target)
                  </span>
                  <p className="text-[11px] text-[#71818B] leading-relaxed">
                    Mengeksekusi akumulasi atau likuidasi volume target secara bertahap untuk meminimalkan dampak pasar
                    (slippage minimizer).
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSmartSide('BUY')}
                    className={`py-2 rounded-[7px] font-semibold border transition-colors cursor-pointer ${
                      smartSide === 'BUY'
                        ? 'bg-[#12392F] border-[#16A879] text-[#16A879]'
                        : 'bg-[#111820] border-[#202B34] text-[#71818B] hover:text-[#E4EBEF]'
                    }`}
                  >
                    Smart Buy
                  </button>
                  <button
                    type="button"
                    onClick={() => setSmartSide('SELL')}
                    className={`py-2 rounded-[7px] font-semibold border transition-colors cursor-pointer ${
                      smartSide === 'SELL'
                        ? 'bg-[#401F27] border-[#EA5B65] text-[#EA5B65]'
                        : 'bg-[#111820] border-[#202B34] text-[#71818B] hover:text-[#E4EBEF]'
                    }`}
                  >
                    Smart Sell
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">
                      Target Harga Eksekusi ({selectedPair.quoteCurrency}):
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={smartTargetPrice}
                      onChange={e => setSmartTargetPrice(e.target.value)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-3 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">
                      Total Target Volume ({selectedPair.baseCurrency}):
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={smartTotalVol}
                      onChange={e => setSmartTotalVol(e.target.value)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-3 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">Jumlah Slice Pemecah Order:</label>
                    <input
                      type="number"
                      min={2}
                      max={20}
                      value={smartSliceCount}
                      onChange={e => setSmartSliceCount(e.target.value)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-3 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">Tipe Eksekusi Slice:</label>
                    <select
                      value={smartOrderType}
                      onChange={e => setSmartOrderType(e.target.value as any)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-3 py-2 font-mono text-[#E4EBEF] outline-none"
                    >
                      <option value="LIMIT">Limit Order (Buku Order)</option>
                      <option value="MARKET">Market Order</option>
                    </select>
                  </div>
                </div>

                {duplicateRunningBot && (
                  <div className="p-3 bg-[#2C2415]/60 border border-[#D6A85C]/40 text-[#D6A85C] text-xs rounded-[7px] space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Bot Aktif Sedang Berjalan
                    </p>
                    <p className="text-[11px] text-[#A1AFB8]">
                      Bot <strong className="text-[#E4EBEF]">{duplicateRunningBot.name}</strong> sudah aktif di{' '}
                      {selectedPairId}. Hentikan bot sebelumnya terlebih dahulu.
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  variant={smartSide === 'BUY' ? 'profit' : 'danger'}
                  size="md"
                  disabled={isLoading || !!duplicateRunningBot}
                  isLoading={isLoading}
                  icon={<Target className="w-3.5 h-3.5" />}
                  className="w-full"
                >
                  {isLoading
                    ? 'Menginisialisasi Smart Trade...'
                    : duplicateRunningBot
                      ? `Bot ${duplicateRunningBot.pairId} Sedang Berjalan (Hentikan Dulu)`
                      : 'Jalankan Auto Smart Trade'}
                </Button>
              </form>
            )}

            {/* STRATEGY 4: BOT VOLUME (VOLUME MAKER BOT) */}
            {activeStrategy === 'VOLUME' && (
              <form onSubmit={handleDeployVolumeBot} className="space-y-4 text-xs">
                <div className="p-3 bg-[#401F27]/30 rounded-[7px] border border-[#EA5B65]/30 text-[#A1AFB8] space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#E4EBEF] flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 text-[#EA5B65]" />
                      Bot Volume Maker &amp; Turnover Generator
                    </span>
                    <StatusBadge tone="sell">AUTO TARGET</StatusBadge>
                  </div>
                  <p className="text-[11px] text-[#71818B] leading-relaxed">
                    Mengeksekusi transaksi bursa secara berkala dengan interval detik tertentu untuk mencapai target
                    volume perdagangan, menjaga likuiditas, dan memicu volume 24 jam pasar.
                  </p>
                </div>

                {/* 1. Target Volume Reach */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[#A1AFB8] font-medium">
                      Target Volume Reach ({selectedPair.baseCurrency}):
                    </label>
                    <span className="text-[11px] font-mono text-[#16A879]">Batas akhir otomatis</span>
                  </div>
                  <input
                    type="number"
                    step="any"
                    value={volTargetVolume}
                    onChange={e => setVolTargetVolume(e.target.value)}
                    placeholder="Contoh: 5.0"
                    className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#EA5B65] rounded-[7px] px-3 py-2 font-mono tabular-nums text-sm text-[#16A879] font-semibold outline-none"
                    required
                  />
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {(selectedPair.baseCurrency === 'BTC'
                      ? ['0.5', '1.0', '2.5', '5.0']
                      : selectedPair.baseCurrency === 'ETH'
                        ? ['5.0', '10.0', '25.0', '50.0']
                        : ['1000', '2500', '5000', '10000']
                    ).map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setVolTargetVolume(val)}
                        className="px-2 py-0.5 bg-[#111820] hover:bg-[#1D2832] border border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF] rounded-[5px] font-mono text-[10px] cursor-pointer transition-colors"
                      >
                        {val} {selectedPair.baseCurrency}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Min Price & Max Price */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[#A1AFB8] font-medium">
                      Rentang Harga Eksekusi (Min &amp; Max {selectedPair.quoteCurrency}):
                    </label>
                    <div className="flex gap-1 text-[10px]">
                      {[1, 2, 5].map(pct => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => {
                            applyPercentPreset(-pct, 'VOL_MIN');
                            applyPercentPreset(pct, 'VOL_MAX');
                          }}
                          className="px-1.5 py-0.5 bg-[#111820] hover:bg-[#1D2832] border border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF] rounded-[5px] font-mono cursor-pointer transition-colors"
                        >
                          ±{pct}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-[10px] text-[#71818B] block mb-0.5">Min Price:</span>
                      <input
                        type="number"
                        step="any"
                        value={volMinPrice}
                        onChange={e => setVolMinPrice(e.target.value)}
                        className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                        required
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-[#71818B] block mb-0.5">Max Price:</span>
                      <input
                        type="number"
                        step="any"
                        value={volMaxPrice}
                        onChange={e => setVolMaxPrice(e.target.value)}
                        className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Delay Second Amount */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">Delay Antar Order (Detik):</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={volDelaySeconds}
                      onChange={e => setVolDelaySeconds(e.target.value)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-2 font-mono tabular-nums text-[#E4EBEF] outline-none"
                      required
                    />
                    <div className="flex gap-1.5 mt-1.5">
                      {['1', '2', '3', '5'].map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setVolDelaySeconds(s)}
                          className="px-2 py-0.5 bg-[#111820] hover:bg-[#1D2832] border border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF] rounded-[5px] text-[10px] font-mono cursor-pointer transition-colors"
                        >
                          {s}s
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 4. Direction Mode */}
                  <div>
                    <label className="block text-[#A1AFB8] font-medium mb-1">Urutan Arah Eksekusi:</label>
                    <select
                      value={volDirectionMode}
                      onChange={e => setVolDirectionMode(e.target.value as any)}
                      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2.5 py-2 font-sans text-xs text-[#E4EBEF] outline-none"
                    >
                      <option value="RANDOM">Random (Acak Beli/Jual)</option>
                      <option value="BUY_FIRST">Buy First (Beli lalu Jual)</option>
                      <option value="SELL_FIRST">Sell First (Jual lalu Beli)</option>
                    </select>
                    <span className="text-[10px] text-[#71818B] mt-1 block">
                      {volDirectionMode === 'RANDOM' ? 'Arah acak tiap tick' : 'Bergantian net-neutral'}
                    </span>
                  </div>
                </div>

                {/* 5. Amount Random vs Fixed */}
                <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34] space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={volAmountRandom}
                        onChange={e => setVolAmountRandom(e.target.checked)}
                        className="rounded border-[#2B3944] accent-[#EA5B65]"
                      />
                      <span className="font-medium text-[#E4EBEF]">Randomize Kuantitas per Order</span>
                    </label>
                    <span className="text-[10px] text-[#71818B] font-mono">
                      {volAmountRandom ? 'Rentang Min - Max' : 'Kuantitas Tetap'}
                    </span>
                  </div>

                  {volAmountRandom ? (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <span className="text-[10px] text-[#71818B] block mb-0.5">Min Kuantitas:</span>
                        <input
                          type="number"
                          step="any"
                          value={volAmountMin}
                          onChange={e => setVolAmountMin(e.target.value)}
                          className="w-full bg-[#141C24] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2 py-1.5 font-mono tabular-nums text-[#E4EBEF] outline-none"
                          required
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-[#71818B] block mb-0.5">Max Kuantitas:</span>
                        <input
                          type="number"
                          step="any"
                          value={volAmountMax}
                          onChange={e => setVolAmountMax(e.target.value)}
                          className="w-full bg-[#141C24] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2 py-1.5 font-mono tabular-nums text-[#E4EBEF] outline-none"
                          required
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="pt-1">
                      <span className="text-[10px] text-[#71818B] block mb-0.5">Kuantitas Tetap Tiap Order:</span>
                      <input
                        type="number"
                        step="any"
                        value={volAmountMin}
                        onChange={e => setVolAmountMin(e.target.value)}
                        className="w-full bg-[#141C24] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] px-2 py-1.5 font-mono tabular-nums text-[#E4EBEF] outline-none"
                        required
                      />
                    </div>
                  )}
                </div>

                {/* Estimation Preview */}
                <div className="p-3 bg-[#111820] border border-[#202B34] rounded-[7px] text-[11px] space-y-1.5 font-mono tabular-nums">
                  <div className="flex justify-between text-[#71818B]">
                    <span>Estimasi Jumlah Transaksi:</span>
                    <span className="text-[#E4EBEF] font-semibold">
                      ~
                      {Math.round(
                        Number(volTargetVolume || 1) /
                          ((Number(volAmountMin || 0.01) + Number(volAmountMax || 0.05)) / 2)
                      )}{' '}
                      trade
                    </span>
                  </div>
                  <div className="flex justify-between text-[#71818B]">
                    <span>Estimasi Durasi Penyelesaian:</span>
                    <span className="text-[#EA5B65] font-semibold">
                      ~
                      {Math.round(
                        (Math.round(
                          Number(volTargetVolume || 1) /
                            ((Number(volAmountMin || 0.01) + Number(volAmountMax || 0.05)) / 2)
                        ) *
                          Number(volDelaySeconds || 3)) /
                          60
                      )}{' '}
                      menit
                    </span>
                  </div>
                </div>

                {duplicateRunningBot && (
                  <div className="p-3 bg-[#2C2415]/60 border border-[#D6A85C]/40 text-[#D6A85C] text-xs rounded-[7px] space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Bot Aktif Sedang Berjalan
                    </p>
                    <p className="text-[11px] text-[#A1AFB8]">
                      Bot <strong className="text-[#E4EBEF]">{duplicateRunningBot.name}</strong> sudah aktif di{' '}
                      {selectedPairId}. Hentikan bot sebelumnya sebelum meluncurkan bot baru.
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="danger"
                  size="md"
                  disabled={isLoading || !!duplicateRunningBot}
                  isLoading={isLoading}
                  icon={<Flame className="w-3.5 h-3.5" />}
                  className="w-full"
                >
                  {isLoading
                    ? 'Menginisialisasi Bot Volume...'
                    : duplicateRunningBot
                      ? `Bot ${duplicateRunningBot.pairId} Sedang Berjalan (Hentikan Dulu)`
                      : `Luncurkan Bot Volume (Target: ${volTargetVolume} ${selectedPair.baseCurrency})`}
                </Button>
              </form>
            )}
          </div>

          {/* Right Column: Active Bots & Real-Time Terminal Logs */}
          <div className="lg:col-span-6 space-y-4">
            {/* Active Bots Status Cards */}
            <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
              <PanelHeader
                icon={<Activity className="w-4 h-4" />}
                title={`Daftar Bot (${bots.length})`}
                actions={
                  <SegmentedTabs
                    size="sm"
                    activeTab={consoleFilterTab}
                    onChange={setConsoleFilterTab}
                    tabs={[
                      { id: 'ALL', label: 'Semua', badge: bots.length },
                      { id: 'RUNNING', label: 'Berjalan', badge: runningBots.length },
                      { id: 'STOPPED', label: 'Dihentikan', badge: stoppedBots.length },
                    ]}
                  />
                }
              />

              <div className="p-4">
                {displayedBots.length === 0 ? (
                  <div className="text-center py-6 text-xs text-[#71818B]">
                    {consoleFilterTab === 'RUNNING'
                      ? 'Tidak ada bot yang sedang berjalan.'
                      : consoleFilterTab === 'STOPPED'
                        ? 'Tidak ada bot yang dihentikan.'
                        : 'Belum ada strategi bot yang aktif. Konfigurasikan strategi di sebelah kiri untuk memulai.'}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {displayedBots.map(b => {
                      const isVolumeBot = b.strategy === 'VOLUME_BOT';
                      const targetVol = b.config?.targetVolumeReach || '1';
                      const filledVol = b.totalVolumeFilled || '0';
                      const pct = Math.min(100, Math.round((Number(filledVol) / Number(targetVol || 1)) * 100));

                      return (
                        <div
                          key={b.id}
                          onClick={() => setSelectedBotId(b.id)}
                          className={`p-3 rounded-[7px] border cursor-pointer transition-colors text-xs ${
                            selectedBotId === b.id
                              ? 'bg-[#1D2832] border-[#8DA5B1]'
                              : 'bg-[#111820] border-[#202B34] hover:border-[#2B3944]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  b.status === 'RUNNING'
                                    ? 'bg-[#16A879]'
                                    : b.status === 'COMPLETED'
                                      ? 'bg-[#6D9FE8]'
                                      : 'bg-[#71818B]'
                                }`}
                              />
                              <span className="font-semibold text-[#E4EBEF] truncate">{b.name}</span>
                              {isVolumeBot && <StatusBadge tone="sell">VOLUME</StatusBadge>}
                            </div>
                            <span className="font-mono tabular-nums text-[11px] text-[#C1D0D6] font-semibold shrink-0">
                              {b.deployedOrderIds.length} Order
                            </span>
                          </div>

                          {isVolumeBot && (
                            <div className="mt-2 space-y-1">
                              <div className="flex justify-between text-[10px] text-[#71818B] font-mono tabular-nums">
                                <span>Volume Tercapai:</span>
                                <span className="text-[#EA5B65] font-semibold">
                                  {Number(filledVol).toFixed(4)} / {targetVol} {b.pairId.split('-')[0]} ({pct}%)
                                </span>
                              </div>
                              <div className="w-full bg-[#141C24] h-1.5 rounded-[5px] overflow-hidden border border-[#202B34]">
                                <div
                                  className="bg-[#EA5B65] h-full transition-all duration-300"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          )}

                          <div className="flex items-center justify-between mt-2 text-[11px] text-[#71818B]">
                            <span>
                              Status:{' '}
                              <strong
                                className={
                                  b.status === 'RUNNING'
                                    ? 'text-[#16A879]'
                                    : b.status === 'COMPLETED'
                                      ? 'text-[#6D9FE8]'
                                      : 'text-[#A1AFB8]'
                                }
                              >
                                {b.status}
                              </strong>
                            </span>
                            {b.status === 'RUNNING' && (
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                onClick={e => {
                                  e.stopPropagation();
                                  handleStopBot(b.id);
                                }}
                              >
                                Hentikan
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Real-Time Live Execution Terminal */}
            <div className="bg-[#090D12] border border-[#202B34] rounded-[10px] overflow-hidden flex flex-col h-[340px]">
              <PanelHeader
                icon={<Terminal className="w-3.5 h-3.5 text-[#16A879]" />}
                title="Live Bot Terminal Stream"
                actions={
                  <span className="text-[11px] text-[#71818B] font-mono">
                    {selectedBot ? selectedBot.id : 'READY'}
                  </span>
                }
              />

              <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] space-y-1.5 text-[#A1AFB8]">
                {!selectedBot || selectedBot.logs.length === 0 ? (
                  <div className="text-[#53616A] italic">Menunggu log transaksi bot...</div>
                ) : (
                  selectedBot.logs.map((log: any, idx: number) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="text-[#53616A] select-none tabular-nums">
                        [{formatDateTime(log.timestamp)}]
                      </span>
                      <span
                        className={
                          log.type === 'ORDER'
                            ? 'text-[#6D9FE8] font-medium'
                            : log.type === 'FILL'
                              ? 'text-[#16A879] font-medium'
                              : log.type === 'ERROR'
                                ? 'text-[#EA5B65] font-medium'
                                : 'text-[#A1AFB8]'
                        }
                      >
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
        {activeStrategy === 'VOLUME_V2' && (
          <VolumeExecutionV2Panel
            user={user}
            pairs={tradingPairs}
            balances={balances}
            selectedPairId={selectedPairId}
            onSelectPairId={setSelectedPairId}
            onRefreshBalances={onRefreshBalances}
            onRefreshOrders={onRefreshOrders}
            onOpenAuthModal={onOpenAuthModal}
          />
        )}
        </>
      ) : (
        /* TAB 2: BOT ACTIVE OPEN ORDERS TABLE */
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
          <PanelHeader
            icon={<Shield className="w-4 h-4" />}
            title={`Daftar Order Aktif Hasil Eksekusi Bot (${botOpenOrders.length})`}
            subtitle={`Terdaftar atas nama akun ${user.role === 'admin' ? 'Admin' : 'Trader'}: ${user.email}`}
            actions={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={loadBotOpenOrders}
                icon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                Refresh Order
              </Button>
            }
          />

          <div className="overflow-x-auto min-h-[220px]">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead className="bg-[#111820] text-[10px] text-[#71818B] font-sans uppercase tracking-wider border-b border-[#202B34]">
                <tr>
                  <th className="px-4 py-2.5">Waktu</th>
                  <th className="px-4 py-2.5">Client Order ID</th>
                  <th className="px-4 py-2.5">Pair</th>
                  <th className="px-4 py-2.5">Sisi</th>
                  <th className="px-4 py-2.5 text-right">Harga Limit</th>
                  <th className="px-4 py-2.5 text-right">Jumlah</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                  <th className="px-4 py-2.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34]">
                {botOpenOrders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-[#71818B] font-sans text-xs">
                      Tidak ada order limit bot yang aktif saat ini.
                    </td>
                  </tr>
                ) : (
                  botOpenOrders.map(order => {
                    const isBuy = order.side === 'BUY';
                    const matchedPair = tradingPairs.find(p => p.id === order.pairId);
                    const baseDecimals =
                      matchedPair?.baseDecimals ??
                      (order.pairId.startsWith('BTC') ? 8 : order.pairId.startsWith('ETH') ? 8 : 6);
                    const qDec =
                      matchedPair?.quoteDecimals ?? ((order.pairId || '').endsWith('USDT') ? 6 : 2);
                    const qCur = matchedPair?.quoteCurrency || (order.pairId || '').split('-')[1] || 'IDR';
                    return (
                      <tr key={order.id} className="hover:bg-[#17212B] transition-colors">
                        <td className="px-4 py-2.5 text-[#71818B] text-[11px]">
                          {formatDateTime(order.createdAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge tone="brand">
                            {order.clientOrderId || order.id.slice(0, 8)}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-[#E4EBEF]">{order.pairId}</td>
                        <td className="px-4 py-2.5 font-semibold">
                          <StatusBadge tone={isBuy ? 'buy' : 'sell'}>{isBuy ? 'BELI' : 'JUAL'}</StatusBadge>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[#E4EBEF]">
                          {formatQuotePrice(order.price, qCur, qDec, true)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[#A1AFB8]">
                          {formatCrypto(order.quantity, baseDecimals)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <StatusBadge tone="warning">{order.status}</StatusBadge>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => handleCancelSingleOrder(order.id, order.pairId)}
                          >
                            Batal
                          </Button>
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
    </div>
  );
};
