/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/bot/TradingBotsView.tsx
 * DIMONEX Real Automated Trading Bots Terminal — Spot Grid, Layer Ladder, Smart TWAP, & Volume Maker
 * Connected directly to the DIMONEX Matching Engine, Atomic Double-Entry Ledger, & WebSocket Streams.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot,
  Play,
  Square,
  ShieldCheck,
  AlertTriangle,
  Flame,
  Activity,
  Terminal,
  RefreshCw,
} from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { useToast } from '../ui/Toast.js';
import { PageHeader, PanelHeader } from '../ui/PanelHeader.js';
import { SegmentedTabs } from '../ui/Tabs.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { UserProfile, UserBalance, TradingPairItem } from '../../types/index.js';
import {
  formatIDR,
  formatCrypto,
  formatDateTime,
  safeBigInt,
  formatQuotePrice,
} from '../../lib/formatters.js';
import { BalanceDiagnosticModal } from '../wallet/BalanceDiagnosticModal.js';
import { runSingleFlight } from '../../lib/safeFetch.js';
import {
  isWebSocketSupported,
  reportWebSocketSuccess,
  reportWebSocketFailure,
} from '../../utils/wsHelper.js';
import { VolumeExecutionV2Panel } from './VolumeExecutionV2Panel.js';

interface Props {
  user: UserProfile | null;
  balances: UserBalance[];
  pairs: TradingPairItem[];
  onOpenAuthModal: () => void;
  displayCurrency: 'USDT' | 'IDR';
  onRefreshBalances?: () => void;
  onRefreshOrders?: () => void;
}

type BotStrategy = 'SPOT_GRID' | 'DCA_LAYERS' | 'SMART_TWAP' | 'VOLUME_MAKER' | 'VOLUME_EXECUTION_V2';

const STRATEGY_CARDS: { id: BotStrategy; title: string; desc: string }[] = [
  {
    id: 'SPOT_GRID',
    title: 'Spot Grid Bot',
    desc: 'Capture volatility by placing real layered buy/sell orders in the order book.',
  },
  {
    id: 'DCA_LAYERS',
    title: 'Layer Ladder DCA',
    desc: 'Automated scaled multi-level limit accumulation or distribution.',
  },
  {
    id: 'SMART_TWAP',
    title: 'Smart TWAP Slicer',
    desc: 'Slice large institutional orders into small randomized chunks over time.',
  },
  {
    id: 'VOLUME_MAKER',
    title: 'Volume Maker Bot (V1)',
    desc: 'Legacy 24h market liquidity & turnover bot across price spreads.',
  },
  {
    id: 'VOLUME_EXECUTION_V2',
    title: 'Volume Execution V2',
    desc: 'Institutional TWAP/VWAP/Iceberg/Passive/Aggressive engine with Zero-Float & Risk Limits.',
  },
];

export const TradingBotsView: React.FC<Props> = ({
  user,
  balances,
  pairs,
  onOpenAuthModal,
  onRefreshBalances,
  onRefreshOrders,
}) => {
  const { showToast } = useToast();
  const [selectedStrategy, setSelectedStrategy] = useState<BotStrategy>('SPOT_GRID');
  const [selectedPairId, setSelectedPairId] = useState<string>(() => pairs[0]?.id || 'BTC-IDR');
  const [botFilterTab, setBotFilterTab] = useState<'ALL' | 'RUNNING' | 'STOPPED'>('ALL');

  const [activeBots, setActiveBots] = useState<any[]>([]);
  const [isLoadingBots, setIsLoadingBots] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [selectedBotLog, setSelectedBotLog] = useState<any | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);

  // Spot Grid Form inputs
  const [lowerPrice, setLowerPrice] = useState('1400000000');
  const [upperPrice, setUpperPrice] = useState('1520000000');
  const [gridCount, setGridCount] = useState('6');
  const [investmentIdr, setInvestmentIdr] = useState('20000000');

  // DCA / Layer Ladder inputs
  const [layerSide, setLayerSide] = useState<'BUY' | 'SELL'>('BUY');
  const [layerStartPrice, setLayerStartPrice] = useState('1440000000');
  const [layerCount, setLayerCount] = useState('5');
  const [layerStepPercent, setLayerStepPercent] = useState('0.8');
  const [layerQty, setLayerQty] = useState('0.05');

  // Smart TWAP inputs
  const [twapSide, setTwapSide] = useState<'BUY' | 'SELL'>('BUY');
  const [twapTargetPrice, setTwapTargetPrice] = useState('1450000000');
  const [twapTotalVolume, setTwapTotalVolume] = useState('0.25');
  const [twapSliceCount, setTwapSliceCount] = useState('5');

  // Volume Maker inputs
  const [volTarget, setVolTarget] = useState('2.0');
  const [volMinPrice, setVolMinPrice] = useState('1420000000');
  const [volMaxPrice, setVolMaxPrice] = useState('1480000000');
  const [volDelaySec, setVolDelaySec] = useState('3');
  const [volDirection] = useState<'BUY_FIRST' | 'SELL_FIRST' | 'RANDOM'>('RANDOM');

  const selectedPair =
    pairs.find(p => p.id === selectedPairId) ||
    pairs[0] || {
      id: 'BTC-IDR',
      symbol: 'BTC/IDR',
      baseCurrency: 'BTC',
      quoteCurrency: 'IDR',
      baseDecimals: 8,
      quoteDecimals: 2,
      lastPrice: '145000000000',
    };

  const quoteDecimals = selectedPair.quoteDecimals ?? (selectedPair.quoteCurrency === 'IDR' ? 2 : 6);

  // Format human-readable numeric price respecting pair decimals (IDR or USDT)
  const formatPriceInput = useCallback(
    (rawVal: number): string => {
      if (!Number.isFinite(rawVal) || rawVal <= 0) return '0';
      if (selectedPair.quoteCurrency === 'IDR') {
        return Math.round(rawVal).toString();
      }
      const precision = rawVal >= 100 ? 2 : rawVal >= 1 ? 4 : Math.min(quoteDecimals, 6);
      return Number(rawVal.toFixed(precision)).toString();
    },
    [selectedPair.quoteCurrency, quoteDecimals]
  );

  // Sync default prices when pair changes using accurate quoteDecimals scaling
  useEffect(() => {
    if (selectedPair && selectedPair.lastPrice) {
      const midUnits = safeBigInt(selectedPair.lastPrice);
      const scale = 10 ** quoteDecimals;
      const midHuman = Number(midUnits) / scale;
      if (Number.isFinite(midHuman) && midHuman > 0) {
        setLowerPrice(formatPriceInput(midHuman * 0.95));
        setUpperPrice(formatPriceInput(midHuman * 1.05));
        setLayerStartPrice(formatPriceInput(midHuman * 0.99));
        setTwapTargetPrice(formatPriceInput(midHuman));
        setVolMinPrice(formatPriceInput(midHuman * 0.98));
        setVolMaxPrice(formatPriceInput(midHuman * 1.02));
      }
    }
  }, [selectedPairId, selectedPair.lastPrice, quoteDecimals, formatPriceInput]);

  const loadBots = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    return runSingleFlight('trading-bots:list', async () => {
      try {
        setIsLoadingBots(true);
        const res = await fetch('/api/bot/list', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setActiveBots(data);
          }
        }
      } catch (e) {
        console.warn('Failed to load bots:', e);
      } finally {
        setIsLoadingBots(false);
      }
    });
  }, []);

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

        ws.onmessage = event => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'bot_snapshot' && Array.isArray(msg.data)) {
              setActiveBots(msg.data);
            } else if (msg.type === 'bot_updated' && msg.data) {
              const updatedBot = msg.data;
              setActiveBots(prev => {
                const idx = prev.findIndex(b => b.id === updatedBot.id);
                if (idx !== -1) {
                  const next = [...prev];
                  next[idx] = { ...next[idx], ...updatedBot };
                  return next;
                }
                return [updatedBot, ...prev];
              });
              if (onRefreshBalances) onRefreshBalances();
              if (onRefreshOrders) onRefreshOrders();
            } else if (msg.type === 'bot_stopped' && msg.data) {
              const stoppedBot = msg.data;
              setActiveBots(prev =>
                prev.map(b => (b.id === stoppedBot.id ? { ...b, status: 'STOPPED' } : b))
              );
              if (onRefreshBalances) onRefreshBalances();
              if (onRefreshOrders) onRefreshOrders();
            }
          } catch {}
        };

        ws.onclose = () => {
          setWsConnected(false);
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
    loadBots();

    const pollInterval = isWebSocketSupported() ? 25000 : 5000;
    const fallbackSync = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      loadBots();
    }, pollInterval);

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      clearInterval(fallbackSync);
      if (ws) ws.close();
    };
  }, [user, loadBots, onRefreshBalances, onRefreshOrders]);

  const handleDeployBot = async () => {
    if (!user) {
      onOpenAuthModal();
      return;
    }

    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      showToast('warning', 'Login Diperlukan', 'Silakan login untuk meluncurkan bot trading');
      return;
    }

    setIsDeploying(true);
    try {
      let endpoint = '';
      let body: any = {};

      if (selectedStrategy === 'SPOT_GRID') {
        endpoint = '/api/bot/grid/deploy';
        body = {
          pairId: selectedPair.id,
          lowerPrice,
          upperPrice,
          gridCount,
          totalInvestmentIdr: investmentIdr,
          spacingMode: 'ARITHMETIC',
        };
      } else if (selectedStrategy === 'DCA_LAYERS') {
        endpoint = '/api/bot/layers/deploy';
        body = {
          pairId: selectedPair.id,
          side: layerSide,
          startPrice: layerStartPrice,
          layerCount,
          priceStepPercent: layerStepPercent,
          quantityPerLayer: layerQty,
        };
      } else if (selectedStrategy === 'SMART_TWAP') {
        endpoint = '/api/bot/smart-trade/deploy';
        body = {
          pairId: selectedPair.id,
          side: twapSide,
          targetPrice: twapTargetPrice,
          totalVolume: twapTotalVolume,
          sliceCount: twapSliceCount,
          orderType: 'LIMIT',
        };
      } else if (selectedStrategy === 'VOLUME_MAKER') {
        endpoint = '/api/bot/volume/deploy';
        body = {
          pairId: selectedPair.id,
          targetVolumeReach: volTarget,
          minPrice: volMinPrice,
          maxPrice: volMaxPrice,
          delaySecondAmount: volDelaySec,
          amountRandom: true,
          amountMin: (parseFloat(volTarget) * 0.01).toFixed(4),
          amountMax: (parseFloat(volTarget) * 0.05).toFixed(4),
          directionMode: volDirection,
        };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal meluncurkan bot');
      }

      showToast(
        'success',
        'Bot Berhasil Diluncurkan',
        `${data.bot?.name || 'Bot'} aktif di matching engine dengan ${data.bot?.deployedOrderIds?.length || 0} order nyata.`
      );

      loadBots();
      if (onRefreshBalances) onRefreshBalances();
      if (onRefreshOrders) onRefreshOrders();
    } catch (err: any) {
      console.error('Deploy bot error:', err);
      showToast('error', 'Gagal Meluncurkan Bot', err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleStopBot = async (botId: string, botName: string) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    setStoppingId(botId);
    try {
      const res = await fetch('/api/bot/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ botId, cancelOpenOrders: true }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menghentikan bot');
      }

      showToast(
        'info',
        'Bot Dihentikan',
        `${botName} telah dihentikan dan seluruh order terbuka telah dibatalkan.`
      );
      loadBots();
      if (onRefreshBalances) onRefreshBalances();
      if (onRefreshOrders) onRefreshOrders();
    } catch (err: any) {
      console.error('Stop bot error:', err);
      showToast('error', 'Gagal Menghentikan Bot', err.message || 'Koneksi gagal');
    } finally {
      setStoppingId(null);
    }
  };

  const handleCancelAllBots = async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    try {
      const res = await fetch('/api/bot/cancel-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', 'Semua Bot Dihentikan', data.message || 'Seluruh bot telah dihentikan.');
        loadBots();
        if (onRefreshBalances) onRefreshBalances();
        if (onRefreshOrders) onRefreshOrders();
      }
    } catch (e: any) {
      showToast('error', 'Gagal', e.message || 'Terjadi kesalahan');
    }
  };

  const quoteItem = balances.find(b => b.currency === selectedPair.quoteCurrency);
  const baseItem = balances.find(b => b.currency === selectedPair.baseCurrency);

  const quoteRawUnits = safeBigInt(quoteItem?.balanceAvailable || '0');
  const baseRawUnits = safeBigInt(baseItem?.balanceAvailable || '0');

  const quoteAvailableNum =
    selectedPair.quoteCurrency === 'IDR'
      ? Number(quoteRawUnits / 100n)
      : Number(quoteRawUnits) / 10 ** quoteDecimals;

  const baseAvailableNum = Number(baseRawUnits) / 10 ** (selectedPair.baseDecimals || 8);

  const quoteDisplay =
    selectedPair.quoteCurrency === 'IDR'
      ? formatIDR(quoteRawUnits.toString())
      : `${quoteAvailableNum.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${selectedPair.quoteCurrency}`;

  const baseDisplay = `${formatCrypto(baseRawUnits.toString(), selectedPair.baseDecimals)} ${selectedPair.baseCurrency}`;

  const duplicateRunningBot = activeBots.find(
    b =>
      b.pairId === selectedPair.id &&
      b.status === 'RUNNING' &&
      ((selectedStrategy === 'SPOT_GRID' && b.strategy === 'SPOT_GRID') ||
        (selectedStrategy === 'DCA_LAYERS' &&
          ((layerSide === 'BUY' && b.strategy === 'BUY_LAYERS') ||
            (layerSide === 'SELL' && b.strategy === 'SELL_LAYERS'))) ||
        (selectedStrategy === 'SMART_TWAP' && b.strategy === 'SMART_TRADE') ||
        (selectedStrategy === 'VOLUME_MAKER' && b.strategy === 'VOLUME_BOT'))
  );

  let isInsufficientBalance = false;
  let balanceErrorMessage = '';

  const fmtReqQuote = (amt: number) =>
    selectedPair.quoteCurrency === 'IDR'
      ? `Rp ${Math.round(amt).toLocaleString('id-ID')}`
      : `${amt.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${selectedPair.quoteCurrency}`;

  if (selectedStrategy === 'SPOT_GRID') {
    const invNum = parseFloat(investmentIdr) || 0;
    if (invNum > quoteAvailableNum) {
      isInsufficientBalance = true;
      balanceErrorMessage = `Saldo ${selectedPair.quoteCurrency} tidak mencukupi (Dibutuhkan: ${fmtReqQuote(invNum)}, Tersedia: ${quoteDisplay})`;
    }
  } else if (selectedStrategy === 'DCA_LAYERS') {
    if (layerSide === 'BUY') {
      const startP = parseFloat(layerStartPrice) || 0;
      const count = parseInt(layerCount, 10) || 5;
      const qty = parseFloat(layerQty) || 0;
      const estTotal = startP * count * qty;
      if (estTotal > quoteAvailableNum) {
        isInsufficientBalance = true;
        balanceErrorMessage = `Estimasi saldo ${selectedPair.quoteCurrency} tidak mencukupi (Dibutuhkan: ~${fmtReqQuote(estTotal)}, Tersedia: ${quoteDisplay})`;
      }
    } else {
      const count = parseInt(layerCount, 10) || 5;
      const qty = parseFloat(layerQty) || 0;
      const totalBase = count * qty;
      if (totalBase > baseAvailableNum) {
        isInsufficientBalance = true;
        balanceErrorMessage = `Saldo ${selectedPair.baseCurrency} tidak mencukupi (Dibutuhkan: ${totalBase} ${selectedPair.baseCurrency}, Tersedia: ${baseDisplay})`;
      }
    }
  } else if (selectedStrategy === 'SMART_TWAP') {
    if (twapSide === 'BUY') {
      const targetP = parseFloat(twapTargetPrice) || 0;
      const vol = parseFloat(twapTotalVolume) || 0;
      const totalReq = targetP * vol;
      if (totalReq > quoteAvailableNum) {
        isInsufficientBalance = true;
        balanceErrorMessage = `Estimasi saldo ${selectedPair.quoteCurrency} tidak mencukupi (Dibutuhkan: ~${fmtReqQuote(totalReq)}, Tersedia: ${quoteDisplay})`;
      }
    } else {
      const vol = parseFloat(twapTotalVolume) || 0;
      if (vol > baseAvailableNum) {
        isInsufficientBalance = true;
        balanceErrorMessage = `Saldo ${selectedPair.baseCurrency} tidak mencukupi (Dibutuhkan: ${vol} ${selectedPair.baseCurrency}, Tersedia: ${baseDisplay})`;
      }
    }
  }

  const runningBots = activeBots.filter(b => b.status === 'RUNNING');
  const stoppedBots = activeBots.filter(b => b.status !== 'RUNNING');
  const displayedBots =
    botFilterTab === 'RUNNING'
      ? runningBots
      : botFilterTab === 'STOPPED'
      ? stoppedBots
      : activeBots;

  const filterTabs: { id: 'ALL' | 'RUNNING' | 'STOPPED'; label: string; badge: number }[] = [
    { id: 'ALL', label: 'Semua', badge: activeBots.length },
    { id: 'RUNNING', label: 'Berjalan', badge: runningBots.length },
    { id: 'STOPPED', label: 'Dihentikan', badge: stoppedBots.length },
  ];

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5 lg:p-6 space-y-4">
        <PageHeader
          title="Automated Quantitative Trading Bots"
          subtitle="Deploy algorithmic trading strategies directly on the DIMONEX double-entry matching engine with atomic fund reservation."
          badge={<StatusBadge tone="brand">DIMONEX Engine</StatusBadge>}
          actions={
            <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-[#A1AFB8]">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  wsConnected ? 'bg-[#35B887] animate-pulse' : 'bg-[#D6A85C]'
                }`}
              />
              <span>{wsConnected ? 'WebSocket Synced' : 'Polling Sync'}</span>
            </div>
          }
          className="border-b-0 pb-0"
        />

        <div className="flex flex-wrap items-center gap-5 pt-3 border-t border-[#202B34] text-xs text-[#A1AFB8]">
          <div className="flex items-center gap-1.5 font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-[#35B887]" />
            <span>Double-Entry Settlement</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono">
            <Activity className="w-3.5 h-3.5 text-[#8DA5B1]" />
            <span>Instant Stop &amp; Fund Unlock</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono">
            <Flame className="w-3.5 h-3.5 text-[#D6A85C]" />
            <span>L2 Order Book Sync</span>
          </div>
        </div>
      </div>

      {/* Strategy Selector Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {STRATEGY_CARDS.map(strat => {
          const isSelected = selectedStrategy === strat.id;
          return (
            <button
              key={strat.id}
              type="button"
              onClick={() => setSelectedStrategy(strat.id)}
              className={`p-4 rounded-[10px] text-left transition-colors border cursor-pointer ${
                isSelected
                  ? 'bg-[#17212B] border-[#8DA5B1]'
                  : 'bg-[#141C24] border-[#202B34] hover:border-[#2B3944] hover:bg-[#17212B]/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="font-semibold text-sm text-[#E4EBEF]">{strat.title}</span>
                {isSelected && <StatusBadge tone="brand">Active</StatusBadge>}
              </div>
              <p className="text-xs text-[#71818B] leading-relaxed">{strat.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Main Workspace */}
      {selectedStrategy === 'VOLUME_EXECUTION_V2' ? (
        <VolumeExecutionV2Panel
          user={user}
          pairs={pairs}
          balances={balances}
          selectedPairId={selectedPairId}
          onSelectPairId={setSelectedPairId}
          onRefreshBalances={onRefreshBalances}
          onRefreshOrders={onRefreshOrders}
          onOpenAuthModal={onOpenAuthModal}
        />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Configuration Form (5 cols) */}
        <div className="lg:col-span-5 bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden self-start">
          <PanelHeader
            title="Konfigurasi Bot"
            subtitle="Order ditempatkan langsung ke order book akun Anda"
            actions={<StatusBadge tone="brand">{selectedStrategy.replace('_', ' ')}</StatusBadge>}
          />

          <div className="p-5 space-y-4">
            {duplicateRunningBot && (
              <div className="p-3 rounded-[7px] bg-[#2C2415]/50 border border-[#D6A85C]/40 text-[#D6A85C] text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold">Bot Aktif Sedang Berjalan</p>
                  <p className="text-xs text-[#E4EBEF]/90 leading-relaxed">
                    Bot <strong>{duplicateRunningBot.name}</strong> sedang RUNNING pada pair {selectedPair.id}. Hentikan bot tersebut terlebih dahulu untuk mencegah duplikasi order.
                  </p>
                </div>
              </div>
            )}

            {isInsufficientBalance && !duplicateRunningBot && (
              <div className="p-3 rounded-[7px] bg-[#401F27]/50 border border-[#EA5B65]/40 text-[#EA5B65] text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Saldo Ledger Tidak Mencukupi</p>
                  <p className="text-xs text-[#E4EBEF]/90 mt-0.5">{balanceErrorMessage}</p>
                </div>
              </div>
            )}

            {/* Pair Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="bot-pair-select" className="text-xs font-medium text-[#A1AFB8]">
                  Trading Pair
                </label>
                <span className="text-[11px] font-mono tabular-nums text-[#A1AFB8]">
                  Last:{' '}
                  <strong className="text-[#E4EBEF]">
                    {formatQuotePrice(
                      selectedPair.lastPrice,
                      selectedPair.quoteCurrency,
                      selectedPair.quoteDecimals,
                      true
                    )}
                  </strong>
                </span>
              </div>
              <select
                id="bot-pair-select"
                value={selectedPair.id}
                onChange={e => setSelectedPairId(e.target.value)}
                className="w-full bg-[#111820] border border-[#2B3944] rounded-[7px] px-3 py-2 text-xs font-mono font-semibold text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
              >
                {pairs.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`} ({p.id})
                  </option>
                ))}
              </select>
            </div>

            {/* Available Balances Strip */}
            <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] flex items-center justify-between gap-3 text-xs font-mono tabular-nums">
              <div className="min-w-0">
                <span className="text-[11px] font-sans text-[#71818B] block">
                  Tersedia {selectedPair.quoteCurrency}
                </span>
                <span className="font-semibold text-[#E4EBEF] truncate block">{quoteDisplay}</span>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <div className="text-right">
                  <span className="text-[11px] font-sans text-[#71818B] block">
                    Tersedia {selectedPair.baseCurrency}
                  </span>
                  <span className="font-semibold text-[#E4EBEF]">{baseDisplay}</span>
                </div>
                {onRefreshBalances && (
                  <button
                    type="button"
                    onClick={onRefreshBalances}
                    className="p-2 rounded-[7px] bg-[#17212B] hover:bg-[#222F3A] border border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF] transition-colors cursor-pointer"
                    title="Segarkan Saldo Ledger"
                    aria-label="Segarkan Saldo Ledger"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsDiagnosticOpen(true)}
                  className="px-2.5 py-2 rounded-[7px] bg-[#12392F] hover:bg-[#16A879]/20 text-[#35B887] border border-[#35B887]/30 transition-colors flex items-center gap-1.5 text-[11px] font-sans font-medium cursor-pointer"
                  title="Cek Sinkronisasi Ledger & Matching Engine"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Audit</span>
                </button>
              </div>
            </div>

            {/* STRATEGY FORMS */}
            {selectedStrategy === 'SPOT_GRID' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={`Batas Bawah (${selectedPair.quoteCurrency})`}
                    type="number"
                    step="any"
                    value={lowerPrice}
                    onChange={e => setLowerPrice(e.target.value)}
                  />
                  <Input
                    label={`Batas Atas (${selectedPair.quoteCurrency})`}
                    type="number"
                    step="any"
                    value={upperPrice}
                    onChange={e => setUpperPrice(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Jumlah Grid (3–30)"
                    type="number"
                    min="3"
                    max="30"
                    value={gridCount}
                    onChange={e => setGridCount(e.target.value)}
                  />
                  <Input
                    label={`Total Alokasi (${selectedPair.quoteCurrency})`}
                    type="number"
                    step="any"
                    value={investmentIdr}
                    onChange={e => setInvestmentIdr(e.target.value)}
                  />
                </div>
              </div>
            )}

            {selectedStrategy === 'DCA_LAYERS' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setLayerSide('BUY')}
                    className={`py-2 text-xs font-semibold rounded-[7px] border transition-colors cursor-pointer ${
                      layerSide === 'BUY'
                        ? 'bg-[#12392F] border-[#16A879] text-[#16A879]'
                        : 'bg-[#111820] border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF]'
                    }`}
                  >
                    Ladder Buy (Akumulasi)
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayerSide('SELL')}
                    className={`py-2 text-xs font-semibold rounded-[7px] border transition-colors cursor-pointer ${
                      layerSide === 'SELL'
                        ? 'bg-[#401F27] border-[#EA5B65] text-[#EA5B65]'
                        : 'bg-[#111820] border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF]'
                    }`}
                  >
                    Ladder Sell (Distribusi)
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={`Harga Awal (${selectedPair.quoteCurrency})`}
                    type="number"
                    step="any"
                    value={layerStartPrice}
                    onChange={e => setLayerStartPrice(e.target.value)}
                  />
                  <Input
                    label="Jumlah Layer"
                    type="number"
                    value={layerCount}
                    onChange={e => setLayerCount(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Langkah Jarak (%)"
                    type="number"
                    step="0.1"
                    value={layerStepPercent}
                    onChange={e => setLayerStepPercent(e.target.value)}
                  />
                  <Input
                    label={`Kuantitas / Layer (${selectedPair.baseCurrency})`}
                    type="number"
                    step="0.001"
                    value={layerQty}
                    onChange={e => setLayerQty(e.target.value)}
                  />
                </div>
              </div>
            )}

            {selectedStrategy === 'SMART_TWAP' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTwapSide('BUY')}
                    className={`py-2 text-xs font-semibold rounded-[7px] border transition-colors cursor-pointer ${
                      twapSide === 'BUY'
                        ? 'bg-[#12392F] border-[#16A879] text-[#16A879]'
                        : 'bg-[#111820] border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF]'
                    }`}
                  >
                    TWAP Buy
                  </button>
                  <button
                    type="button"
                    onClick={() => setTwapSide('SELL')}
                    className={`py-2 text-xs font-semibold rounded-[7px] border transition-colors cursor-pointer ${
                      twapSide === 'SELL'
                        ? 'bg-[#401F27] border-[#EA5B65] text-[#EA5B65]'
                        : 'bg-[#111820] border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF]'
                    }`}
                  >
                    TWAP Sell
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={`Target Harga (${selectedPair.quoteCurrency})`}
                    type="number"
                    step="any"
                    value={twapTargetPrice}
                    onChange={e => setTwapTargetPrice(e.target.value)}
                  />
                  <Input
                    label="Jumlah Slice"
                    type="number"
                    value={twapSliceCount}
                    onChange={e => setTwapSliceCount(e.target.value)}
                  />
                </div>

                <Input
                  label={`Total Volume (${selectedPair.baseCurrency})`}
                  type="number"
                  step="0.01"
                  value={twapTotalVolume}
                  onChange={e => setTwapTotalVolume(e.target.value)}
                />
              </div>
            )}

            {selectedStrategy === 'VOLUME_MAKER' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={`Harga Minimum (${selectedPair.quoteCurrency})`}
                    type="number"
                    step="any"
                    value={volMinPrice}
                    onChange={e => setVolMinPrice(e.target.value)}
                  />
                  <Input
                    label={`Harga Maksimum (${selectedPair.quoteCurrency})`}
                    type="number"
                    step="any"
                    value={volMaxPrice}
                    onChange={e => setVolMaxPrice(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={`Target Turnover (${selectedPair.baseCurrency})`}
                    type="number"
                    step="any"
                    value={volTarget}
                    onChange={e => setVolTarget(e.target.value)}
                  />
                  <Input
                    label="Interval Delay (Detik)"
                    type="number"
                    value={volDelaySec}
                    onChange={e => setVolDelaySec(e.target.value)}
                  />
                </div>
              </div>
            )}

            <Button
              type="button"
              variant={duplicateRunningBot || isInsufficientBalance ? 'secondary' : 'primary'}
              size="lg"
              onClick={handleDeployBot}
              isLoading={isDeploying}
              disabled={isDeploying || !!duplicateRunningBot || isInsufficientBalance}
              icon={
                duplicateRunningBot || isInsufficientBalance ? (
                  <AlertTriangle className="w-4 h-4 text-[#D6A85C]" />
                ) : (
                  <Play className="w-4 h-4" />
                )
              }
              className="w-full"
            >
              {isDeploying
                ? 'Menghubungkan ke Engine...'
                : duplicateRunningBot
                ? `Bot ${duplicateRunningBot.pairId} Sudah Aktif`
                : isInsufficientBalance
                ? 'Saldo Ledger Tidak Mencukupi'
                : 'Luncurkan Bot Nyata (Deploy)'}
            </Button>

            <p className="text-[11px] text-center text-[#71818B]">
              Dana dialokasikan secara atomik via Double-Entry Ledger dan dapat dihentikan kapan saja.
            </p>
          </div>
        </div>

        {/* Right: Active Bots List (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-semibold text-base text-[#E4EBEF]">Daftar Bot Trading</h3>
              <SegmentedTabs
                tabs={filterTabs}
                activeTab={botFilterTab}
                onChange={setBotFilterTab}
                size="sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={loadBots}
                isLoading={isLoadingBots}
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                title="Refresh Bot List"
              >
                Refresh
              </Button>

              {runningBots.length > 0 && (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={handleCancelAllBots}
                >
                  Hentikan Semua Bot
                </Button>
              )}
            </div>
          </div>

          {displayedBots.length === 0 ? (
            <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-12 text-center space-y-3">
              <Bot className="w-10 h-10 text-[#536B77] mx-auto" />
              <div className="space-y-1">
                <p className="font-semibold text-sm text-[#E4EBEF]">
                  {botFilterTab === 'RUNNING'
                    ? 'Tidak ada bot yang sedang berjalan'
                    : botFilterTab === 'STOPPED'
                    ? 'Tidak ada bot yang dihentikan'
                    : 'Belum ada bot trading aktif'}
                </p>
                <p className="text-xs text-[#71818B] max-w-md mx-auto">
                  Pilih strategi di sebelah kiri dan klik Luncurkan Bot Nyata untuk memasang order limit di buku order DIMONEX.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {displayedBots.map(bot => {
                const isRunning = bot.status === 'RUNNING';
                const isStopping = stoppingId === bot.id;
                const deployedCount = bot.deployedOrderIds?.length || 0;
                const filledCount = bot.filledOrderCount || 0;

                return (
                  <div
                    key={bot.id}
                    className="rounded-[10px] bg-[#141C24] border border-[#202B34] hover:border-[#2B3944] p-4 space-y-3 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                            isRunning ? 'bg-[#16A879] animate-pulse' : 'bg-[#53616A]'
                          }`}
                        />
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold text-sm text-[#E4EBEF]">{bot.name}</h4>
                            <span className="text-xs font-mono text-[#8DA5B1]">{bot.pairId}</span>
                          </div>
                          <p className="text-[11px] text-[#71818B] font-mono tabular-nums mt-0.5">
                            ID: {bot.id} · {formatDateTime(bot.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <StatusBadge
                          tone={
                            isRunning
                              ? 'success'
                              : bot.status === 'COMPLETED'
                              ? 'info'
                              : 'neutral'
                          }
                        >
                          {bot.status}
                        </StatusBadge>

                        {isRunning && (
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            disabled={isStopping}
                            onClick={() => handleStopBot(bot.id, bot.name)}
                            icon={<Square className="w-3 h-3 fill-current" />}
                          >
                            {isStopping ? 'Menghentikan...' : 'Stop Manual'}
                          </Button>
                        )}

                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setSelectedBotLog(selectedBotLog?.id === bot.id ? null : bot)}
                        >
                          {selectedBotLog?.id === bot.id ? 'Tutup Log' : 'Log Eksekusi'}
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-3 border-t border-[#202B34] text-xs font-mono tabular-nums">
                      <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                        <span className="text-[11px] font-sans text-[#71818B] block">Order Diterapkan</span>
                        <span className="font-semibold text-[#E4EBEF]">{deployedCount} Order</span>
                      </div>
                      <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                        <span className="text-[11px] font-sans text-[#71818B] block">Order Terisi</span>
                        <span className="font-semibold text-[#35B887]">{filledCount} Matched</span>
                      </div>
                      <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                        <span className="text-[11px] font-sans text-[#71818B] block">Volume Eksekusi</span>
                        <span className="font-semibold text-[#E4EBEF]">{bot.totalVolumeFilled || '0'}</span>
                      </div>
                      <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34]">
                        <span className="text-[11px] font-sans text-[#71818B] block">Profit Terealisasi</span>
                        <span className="font-semibold text-[#16A879]">
                          {formatIDR(bot.realizedProfitIdr || '0')}
                        </span>
                      </div>
                    </div>

                    {selectedBotLog?.id === bot.id && (
                      <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-2 mt-2">
                        <div className="flex items-center justify-between text-xs font-mono text-[#A1AFB8] border-b border-[#202B34] pb-1.5">
                          <span className="flex items-center gap-1.5 text-[#E4EBEF] font-semibold">
                            <Terminal className="w-3.5 h-3.5 text-[#8DA5B1]" />
                            Server Execution Audit Trail
                          </span>
                          <span className="tabular-nums">{bot.logs?.length || 0} Events</span>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-[11px] pr-1">
                          {!bot.logs || bot.logs.length === 0 ? (
                            <p className="text-[#71818B] py-2 font-sans">
                              Belum ada aktivitas log yang tercatat.
                            </p>
                          ) : (
                            bot.logs.map((log: any, idx: number) => (
                              <div key={idx} className="flex items-start gap-2 text-[#A1AFB8]">
                                <span className="text-[#71818B] tabular-nums shrink-0">
                                  [{new Date(log.timestamp).toLocaleTimeString()}]
                                </span>
                                <span
                                  className={`shrink-0 font-semibold ${
                                    log.type === 'FILL'
                                      ? 'text-[#16A879]'
                                      : log.type === 'ORDER'
                                      ? 'text-[#6D9FE8]'
                                      : log.type === 'ERROR'
                                      ? 'text-[#EA5B65]'
                                      : 'text-[#A1AFB8]'
                                  }`}
                                >
                                  {log.type}
                                </span>
                                <span className="text-[#E4EBEF] break-all">{log.message}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      )}

      <BalanceDiagnosticModal
        isOpen={isDiagnosticOpen}
        onClose={() => setIsDiagnosticOpen(false)}
        onBalancesUpdated={() => {
          if (onRefreshBalances) onRefreshBalances();
          loadBots();
        }}
      />
    </div>
  );
};
