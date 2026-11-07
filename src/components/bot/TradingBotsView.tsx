/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/bot/TradingBotsView.tsx
 * DOMINEX Real Automated Trading Bots Terminal — Spot Grid, Layer Ladder, Smart TWAP, & Volume Maker
 * Connected directly to the DOMINEX Matching Engine, Atomic Double-Entry Ledger, & WebSocket Streams.
 * NO MOCK TRADES, NO FAKE DATA: Every bot places real limit orders and executes real trades.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot,
  Play,
  Square,
  TrendingUp,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  Plus,
  AlertTriangle,
  Flame,
  Layers,
  Activity,
  Terminal,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { useToast } from '../ui/Toast.js';
import { UserProfile, UserBalance, TradingPairItem } from '../../types/index.js';
import { formatIDR, formatCrypto, formatDateTime, safeBigInt, formatQuotePrice } from '../../lib/formatters.js';
import { BalanceDiagnosticModal } from '../wallet/BalanceDiagnosticModal.js';

interface Props {
  user: UserProfile | null;
  balances: UserBalance[];
  pairs: TradingPairItem[];
  onOpenAuthModal: () => void;
  displayCurrency: 'USDT' | 'IDR';
  onRefreshBalances?: () => void;
  onRefreshOrders?: () => void;
}

type BotStrategy = 'SPOT_GRID' | 'DCA_LAYERS' | 'SMART_TWAP' | 'VOLUME_MAKER';

export const TradingBotsView: React.FC<Props> = ({
  user,
  balances,
  pairs,
  onOpenAuthModal,
  displayCurrency,
  onRefreshBalances,
  onRefreshOrders,
}) => {
  const { showToast } = useToast();
  const [selectedStrategy, setSelectedStrategy] = useState<BotStrategy>('SPOT_GRID');
  const [selectedPairId, setSelectedPairId] = useState<string>(() => pairs[0]?.id || 'BTC-IDR');
  const [botFilterTab, setBotFilterTab] = useState<'ALL' | 'RUNNING' | 'STOPPED'>('ALL');

  // Real bots state fetched from backend
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
  const [investmentIdr, setInvestmentIdr] = useState('20000000'); // 20M IDR

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
  const [volDirection, setVolDirection] = useState<'BUY_FIRST' | 'SELL_FIRST' | 'RANDOM'>('RANDOM');

  const selectedPair = pairs.find(p => p.id === selectedPairId) || pairs[0] || {
    id: 'BTC-IDR',
    symbol: 'BTC/IDR',
    baseCurrency: 'BTC',
    quoteCurrency: 'IDR',
    baseDecimals: 8,
    quoteDecimals: 2,
    lastPrice: '145000000000'
  };

  // Sync default prices when pair changes
  useEffect(() => {
    if (selectedPair && selectedPair.lastPrice) {
      const midUnits = safeBigInt(selectedPair.lastPrice);
      const midRupiah = Number(midUnits / 100n);
      if (Number.isFinite(midRupiah) && midRupiah > 0) {
        setLowerPrice(Math.round(midRupiah * 0.95).toString());
        setUpperPrice(Math.round(midRupiah * 1.05).toString());
        setLayerStartPrice(Math.round(midRupiah * 0.99).toString());
        setTwapTargetPrice(midRupiah.toString());
        setVolMinPrice(Math.round(midRupiah * 0.98).toString());
        setVolMaxPrice(Math.round(midRupiah * 1.02).toString());
      }
    }
  }, [selectedPairId, selectedPair.lastPrice]);

  // Load real bots from backend
  const loadBots = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    try {
      setIsLoadingBots(true);
      const res = await fetch('/api/bot/list', {
        headers: { 'Authorization': `Bearer ${token}` }
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
  }, []);

  // WebSocket authoritative real-time state management
  useEffect(() => {
    if (!user) return;
    let ws: WebSocket | null = null;
    let isDisposed = false;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectWs = () => {
      if (isDisposed) return;
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          setWsConnected(true);
          ws.send(JSON.stringify({
            action: 'subscribe',
            channel: `bots:${user.id}`,
            userId: user.id
          }));
          ws.send(JSON.stringify({
            action: 'subscribe',
            channel: `orders:${user.id}`,
            userId: user.id
          }));
        };

        ws.onmessage = (event) => {
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
              setActiveBots(prev => prev.map(b => b.id === stoppedBot.id ? { ...b, status: 'STOPPED' } : b));
              if (onRefreshBalances) onRefreshBalances();
              if (onRefreshOrders) onRefreshOrders();
            }
          } catch (e) {}
        };

        ws.onclose = () => {
          setWsConnected(false);
          if (!isDisposed) {
            reconnectTimeout = setTimeout(connectWs, 3000);
          }
        };

        ws.onerror = () => {
          setWsConnected(false);
        };
      } catch (err) {
        setWsConnected(false);
      }
    };

    connectWs();
    loadBots();

    // Fallback sync safety (every 12 seconds)
    const fallbackSync = setInterval(loadBots, 12000);

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      clearInterval(fallbackSync);
      if (ws) ws.close();
    };
  }, [user, loadBots, onRefreshBalances, onRefreshOrders]);

  // Deploy real bot into the Matching Engine
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
          spacingMode: 'ARITHMETIC'
        };
      } else if (selectedStrategy === 'DCA_LAYERS') {
        endpoint = '/api/bot/layers/deploy';
        body = {
          pairId: selectedPair.id,
          side: layerSide,
          startPrice: layerStartPrice,
          layerCount,
          priceStepPercent: layerStepPercent,
          quantityPerLayer: layerQty
        };
      } else if (selectedStrategy === 'SMART_TWAP') {
        endpoint = '/api/bot/smart-trade/deploy';
        body = {
          pairId: selectedPair.id,
          side: twapSide,
          targetPrice: twapTargetPrice,
          totalVolume: twapTotalVolume,
          sliceCount: twapSliceCount,
          orderType: 'LIMIT'
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
          directionMode: volDirection
        };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal meluncurkan bot');
      }

      showToast(
        'success',
        'Bot Berhasil Diluncurkan!',
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

  // Stop bot manually & cancel open orders
  const handleStopBot = async (botId: string, botName: string) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    setStoppingId(botId);
    try {
      const res = await fetch('/api/bot/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ botId, cancelOpenOrders: true })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menghentikan bot');
      }

      showToast('info', 'Bot Berhasil Dihentikan', `${botName} telah dihentikan dan seluruh order terbuka telah dibatalkan.`);
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

  // Cancel all bots
  const handleCancelAllBots = async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    try {
      const res = await fetch('/api/bot/cancel-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', 'Semua Bot Dihentikan', data.message || 'Seluruh bot telah dihentikan secara massal.');
        loadBots();
        if (onRefreshBalances) onRefreshBalances();
        if (onRefreshOrders) onRefreshOrders();
      }
    } catch (e: any) {
      showToast('error', 'Gagal', e.message || 'Terjadi kesalahan');
    }
  };

  // User balances for selected pair directly mapped from atomic ledger units
  const quoteItem = balances.find(b => b.currency === selectedPair.quoteCurrency);
  const baseItem = balances.find(b => b.currency === selectedPair.baseCurrency);

  const quoteRawUnits = safeBigInt(quoteItem?.balanceAvailable || '0');
  const baseRawUnits = safeBigInt(baseItem?.balanceAvailable || '0');

  // Convert raw ledger atomic units to real human readable numbers
  const quoteAvailableNum = selectedPair.quoteCurrency === 'IDR'
    ? Number(quoteRawUnits / 100n)
    : Number(quoteRawUnits) / (10 ** selectedPair.quoteDecimals);

  const baseAvailableNum = Number(baseRawUnits) / (10 ** (selectedPair.baseDecimals || 8));

  // Formatted string representations
  const quoteDisplay = selectedPair.quoteCurrency === 'IDR'
    ? formatIDR(quoteRawUnits.toString())
    : `${quoteAvailableNum.toLocaleString()} ${selectedPair.quoteCurrency}`;

  const baseDisplay = `${formatCrypto(baseRawUnits.toString(), selectedPair.baseDecimals)} ${selectedPair.baseCurrency}`;

  // Duplicate running bot detection
  const duplicateRunningBot = activeBots.find(
    b => b.pairId === selectedPair.id && b.status === 'RUNNING' && (
      (selectedStrategy === 'SPOT_GRID' && b.strategy === 'SPOT_GRID') ||
      (selectedStrategy === 'DCA_LAYERS' && (
        (layerSide === 'BUY' && b.strategy === 'BUY_LAYERS') ||
        (layerSide === 'SELL' && b.strategy === 'SELL_LAYERS')
      )) ||
      (selectedStrategy === 'SMART_TWAP' && b.strategy === 'SMART_TRADE') ||
      (selectedStrategy === 'VOLUME_MAKER' && b.strategy === 'VOLUME_BOT')
    )
  );

  // Ledger available balance validation
  let isInsufficientBalance = false;
  let balanceErrorMessage = '';

  if (selectedStrategy === 'SPOT_GRID') {
    const invNum = parseFloat(investmentIdr) || 0;
    if (invNum > quoteAvailableNum) {
      isInsufficientBalance = true;
      balanceErrorMessage = `Saldo ${selectedPair.quoteCurrency} tidak mencukupi di ledger (Dibutuhkan: Rp ${invNum.toLocaleString('id-ID')}, Tersedia: ${quoteDisplay})`;
    }
  } else if (selectedStrategy === 'DCA_LAYERS') {
    if (layerSide === 'BUY') {
      const startP = parseFloat(layerStartPrice) || 0;
      const count = parseInt(layerCount, 10) || 5;
      const qty = parseFloat(layerQty) || 0;
      const estTotal = startP * count * qty;
      if (estTotal > quoteAvailableNum) {
        isInsufficientBalance = true;
        balanceErrorMessage = `Estimasi saldo ${selectedPair.quoteCurrency} tidak mencukupi (Dibutuhkan: ~Rp ${Math.round(estTotal).toLocaleString('id-ID')}, Tersedia: ${quoteDisplay})`;
      }
    } else {
      const count = parseInt(layerCount, 10) || 5;
      const qty = parseFloat(layerQty) || 0;
      const totalBase = count * qty;
      if (totalBase > baseAvailableNum) {
        isInsufficientBalance = true;
        balanceErrorMessage = `Saldo ${selectedPair.baseCurrency} tidak mencukupi di ledger (Dibutuhkan: ${totalBase} ${selectedPair.baseCurrency}, Tersedia: ${baseDisplay})`;
      }
    }
  } else if (selectedStrategy === 'SMART_TWAP') {
    if (twapSide === 'BUY') {
      const targetP = parseFloat(twapTargetPrice) || 0;
      const vol = parseFloat(twapTotalVolume) || 0;
      const totalReq = targetP * vol;
      if (totalReq > quoteAvailableNum) {
        isInsufficientBalance = true;
        balanceErrorMessage = `Estimasi saldo ${selectedPair.quoteCurrency} tidak mencukupi (Dibutuhkan: ~Rp ${Math.round(totalReq).toLocaleString('id-ID')}, Tersedia: ${quoteDisplay})`;
      }
    } else {
      const vol = parseFloat(twapTotalVolume) || 0;
      if (vol > baseAvailableNum) {
        isInsufficientBalance = true;
        balanceErrorMessage = `Saldo ${selectedPair.baseCurrency} tidak mencukupi di ledger (Dibutuhkan: ${vol} ${selectedPair.baseCurrency}, Tersedia: ${baseDisplay})`;
      }
    }
  }

  const runningBots = activeBots.filter(b => b.status === 'RUNNING');
  const stoppedBots = activeBots.filter(b => b.status !== 'RUNNING');
  const displayedBots = botFilterTab === 'RUNNING'
    ? runningBots
    : botFilterTab === 'STOPPED'
    ? stoppedBots
    : activeBots;

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#08090D] overflow-y-auto space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl obsidian-glass border border-white/10 p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#FF087F]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-3xl relative z-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-white/5 border border-white/10 text-xs font-semibold text-[#FF087F] mb-3">
            <Bot className="w-3.5 h-3.5 text-[#FF087F]" />
            DOMINEX Real Algorithmic Engine · 100% On-Engine Execution
          </div>
          <h1 className="text-2xl lg:text-3xl font-display font-extrabold text-[#F5F5F7] tracking-tight">
            Automated Quantitative Trading Bots
          </h1>
          <p className="text-xs lg:text-sm text-[#9298A6] mt-2 leading-relaxed">
            Deploy authoritative algorithmic trading strategies 24/7. Every order is matched on the in-memory double-entry matching engine without simulated or mock data.
          </p>

          <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-white/5 text-xs">
            <div className="flex items-center gap-1.5 text-emerald-400 font-mono">
              <ShieldCheck className="w-4 h-4" />
              <span>Real Double-Entry Settlement</span>
            </div>
            <div className="flex items-center gap-1.5 text-cyan-400 font-mono">
              <Activity className="w-4 h-4" />
              <span>Instant Stop & Fund Unlock</span>
            </div>
            <div className="flex items-center gap-1.5 text-[#FF087F] font-mono">
              <Flame className="w-4 h-4" />
              <span>L2 Order Book Sync</span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-emerald-400 ml-auto">
              <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span>{wsConnected ? 'WebSocket Live Synced' : 'Syncing...'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Strategy Selector Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { id: 'SPOT_GRID', title: 'Spot Grid Bot', desc: 'Capture volatility by placing real layered buy/sell orders in the order book.' },
          { id: 'DCA_LAYERS', title: 'Layer Ladder DCA', desc: 'Automated scaled multi-level limit accumulation or distribution.' },
          { id: 'SMART_TWAP', title: 'Smart TWAP Slicer', desc: 'Slice large institutional orders into small randomized chunks over time.' },
          { id: 'VOLUME_MAKER', title: 'Volume Maker Bot', desc: 'Generate continuous 24h market liquidity and turnover across price spreads.' },
        ].map(strat => (
          <button
            key={strat.id}
            onClick={() => setSelectedStrategy(strat.id as BotStrategy)}
            className={`p-4 rounded-xl text-left transition-all obsidian-glass border ${
              selectedStrategy === strat.id
                ? 'border-[#FF087F] bg-[#171923] shadow-lg shadow-[#FF087F]/15'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-display font-bold text-sm text-[#F5F5F7]">{strat.title}</span>
              {selectedStrategy === strat.id && (
                <span className="w-2 h-2 rounded-full bg-[#FF087F] animate-pulse" />
              )}
            </div>
            <p className="text-[11px] text-[#9298A6] leading-tight">{strat.desc}</p>
          </button>
        ))}
      </div>

      {/* Main Workspace: Config Form (Left) & Real Active Bots (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Configuration Form (5 cols) */}
        <div className="lg:col-span-5 rounded-2xl obsidian-glass border border-white/10 p-5 space-y-4 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <div>
              <h3 className="font-display font-bold text-sm text-[#F5F5F7]">Konfigurasi Bot</h3>
              <p className="text-[11px] text-[#9298A6]">Order akan langsung masuk ke Order Book akun Anda</p>
            </div>
            <span className="text-xs font-mono font-bold text-[#FF087F] px-2 py-0.5 rounded bg-[#FF087F]/10 border border-[#FF087F]/20">
              {selectedStrategy.replace('_', ' ')}
            </span>
          </div>

          {/* Duplicate Running Bot Warning */}
          {duplicateRunningBot && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-600/60 text-amber-300 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-bold">Bot Aktif Sedang Berjalan</p>
                <p className="text-[11px] text-amber-300/90 leading-tight">
                  Bot <strong>{duplicateRunningBot.name}</strong> saat ini sedang berstatus <strong>RUNNING</strong> pada pair {selectedPair.id}. Untuk mencegah eksekusi ganda dan duplikasi order pada buku order, hentikan bot tersebut terlebih dahulu.
                </p>
              </div>
            </div>
          )}

          {/* Insufficient Balance Warning */}
          {isInsufficientBalance && !duplicateRunningBot && (
            <div className="p-3 rounded-xl bg-red-950/40 border border-red-700/60 text-red-300 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Saldo Ledger Tidak Mencukupi</p>
                <p className="text-[11px] text-red-300/90">{balanceErrorMessage}</p>
              </div>
            </div>
          )}

          {/* Pair Selector */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-[#9298A6]">Trading Pair</label>
              <span className="text-[10px] font-mono text-[#F5F5F7]">
                Harga Terakhir: <strong>{formatQuotePrice(selectedPair.lastPrice, selectedPair.quoteCurrency, selectedPair.quoteDecimals, true)}</strong>
              </span>
            </div>
            <select
              value={selectedPair.id}
              onChange={e => setSelectedPairId(e.target.value)}
              className="w-full bg-[#0D1017] border border-white/10 rounded-lg p-2.5 text-xs font-bold text-white focus:outline-none focus:border-[#FF087F]"
            >
              {pairs.map(p => (
                <option key={p.id} value={p.id}>
                  {p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`} ({p.id})
                </option>
              ))}
            </select>
          </div>

          {/* User Available Balance Indicator */}
          <div className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between text-xs font-mono">
            <div>
              <span className="text-[10px] text-[#9298A6] block">Tersedia {selectedPair.quoteCurrency}</span>
              <span className="font-bold text-[#F5F5F7]">{quoteDisplay}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <span className="text-[10px] text-[#9298A6] block">Tersedia {selectedPair.baseCurrency}</span>
                <span className="font-bold text-[#F5F5F7]">{baseDisplay}</span>
              </div>
              {onRefreshBalances && (
                <button
                  type="button"
                  onClick={onRefreshBalances}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[#9298A6] hover:text-white transition-colors"
                  title="Segarkan Saldo Ledger"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsDiagnosticOpen(true)}
                className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 transition-colors flex items-center gap-1 text-[10px] font-sans font-semibold"
                title="Cek Sinkronisasi Ledger & Matching Engine"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Audit Sync</span>
              </button>
            </div>
          </div>

          {/* STRATEGY SPECIFIC FORMS */}
          {selectedStrategy === 'SPOT_GRID' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Batas Bawah (IDR)</label>
                  <Input
                    type="number"
                    value={lowerPrice}
                    onChange={e => setLowerPrice(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Batas Atas (IDR)</label>
                  <Input
                    type="number"
                    value={upperPrice}
                    onChange={e => setUpperPrice(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Jumlah Grid (3 - 30)</label>
                  <Input
                    type="number"
                    min="3"
                    max="30"
                    value={gridCount}
                    onChange={e => setGridCount(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Total Alokasi (IDR)</label>
                  <Input
                    type="number"
                    value={investmentIdr}
                    onChange={e => setInvestmentIdr(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {selectedStrategy === 'DCA_LAYERS' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLayerSide('BUY')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                    layerSide === 'BUY'
                      ? 'bg-[#16C784]/20 border-[#16C784] text-[#16C784]'
                      : 'border-white/10 text-[#9298A6]'
                  }`}
                >
                  Ladder Buy (Akumulasi)
                </button>
                <button
                  type="button"
                  onClick={() => setLayerSide('SELL')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                    layerSide === 'SELL'
                      ? 'bg-[#EA3943]/20 border-[#EA3943] text-[#EA3943]'
                      : 'border-white/10 text-[#9298A6]'
                  }`}
                >
                  Ladder Sell (Distribusi)
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Harga Awal (IDR)</label>
                  <Input
                    type="number"
                    value={layerStartPrice}
                    onChange={e => setLayerStartPrice(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Jumlah Layer</label>
                  <Input
                    type="number"
                    value={layerCount}
                    onChange={e => setLayerCount(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Langkah Jarak (%)</label>
                  <Input
                    type="number"
                    step="0.1"
                    value={layerStepPercent}
                    onChange={e => setLayerStepPercent(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Kuantitas per Layer</label>
                  <Input
                    type="number"
                    step="0.001"
                    value={layerQty}
                    onChange={e => setLayerQty(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {selectedStrategy === 'SMART_TWAP' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTwapSide('BUY')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                    twapSide === 'BUY'
                      ? 'bg-[#16C784]/20 border-[#16C784] text-[#16C784]'
                      : 'border-white/10 text-[#9298A6]'
                  }`}
                >
                  TWAP Buy
                </button>
                <button
                  type="button"
                  onClick={() => setTwapSide('SELL')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                    twapSide === 'SELL'
                      ? 'bg-[#EA3943]/20 border-[#EA3943] text-[#EA3943]'
                      : 'border-white/10 text-[#9298A6]'
                  }`}
                >
                  TWAP Sell
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Target Harga (IDR)</label>
                  <Input
                    type="number"
                    value={twapTargetPrice}
                    onChange={e => setTwapTargetPrice(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Jumlah Slice</label>
                  <Input
                    type="number"
                    value={twapSliceCount}
                    onChange={e => setTwapSliceCount(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] text-[#9298A6] block mb-1">Total Volume ({selectedPair.baseCurrency})</label>
                <Input
                  type="number"
                  step="0.01"
                  value={twapTotalVolume}
                  onChange={e => setTwapTotalVolume(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          )}

          {selectedStrategy === 'VOLUME_MAKER' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Harga Minimum (IDR)</label>
                  <Input
                    type="number"
                    value={volMinPrice}
                    onChange={e => setVolMinPrice(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Harga Maksimum (IDR)</label>
                  <Input
                    type="number"
                    value={volMaxPrice}
                    onChange={e => setVolMaxPrice(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Target Turnover ({selectedPair.baseCurrency})</label>
                  <Input
                    type="number"
                    value={volTarget}
                    onChange={e => setVolTarget(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#9298A6] block mb-1">Interval Delay (Detik)</label>
                  <Input
                    type="number"
                    value={volDelaySec}
                    onChange={e => setVolDelaySec(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Submit Deploy Button with Duplicate Guard */}
          <Button
            onClick={handleDeployBot}
            disabled={isDeploying || !!duplicateRunningBot || isInsufficientBalance}
            className={`w-full py-3 text-xs font-bold shadow-lg transition-all ${
              duplicateRunningBot
                ? 'bg-amber-950/80 text-amber-400 border border-amber-700/80 cursor-not-allowed opacity-90'
                : isInsufficientBalance
                ? 'bg-red-950/80 text-red-400 border border-red-700/80 cursor-not-allowed opacity-90'
                : 'bg-[#FF087F] hover:bg-[#D926FF] text-white shadow-[#FF087F]/20 cursor-pointer'
            }`}
          >
            {isDeploying ? (
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Menghubungkan ke Matching Engine...</span>
              </div>
            ) : duplicateRunningBot ? (
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Bot {duplicateRunningBot.pairId} Sudah Aktif (Hentikan Dulu)</span>
              </div>
            ) : isInsufficientBalance ? (
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span>Saldo Ledger Tidak Mencukupi</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 fill-current" />
                <span>Luncurkan Bot Nyata (Deploy to Order Book)</span>
              </div>
            )}
          </Button>

          <p className="text-[10px] text-center text-[#9298A6]">
            Dana dialokasikan dan dikunci secara aman via Double-Entry Ledger. Anda dapat menghentikan bot kapan saja.
          </p>
        </div>

        {/* Right: Real Active Bots & Engine Execution (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="font-display font-bold text-base text-[#F5F5F7]">Daftar Bot Trading</h3>
              <div className="flex items-center gap-1 bg-[#171923] p-1 rounded-lg border border-white/10 text-xs">
                <button
                  type="button"
                  onClick={() => setBotFilterTab('ALL')}
                  className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
                    botFilterTab === 'ALL' ? 'bg-white/10 text-white font-bold' : 'text-[#9298A6] hover:text-white'
                  }`}
                >
                  Semua ({activeBots.length})
                </button>
                <button
                  type="button"
                  onClick={() => setBotFilterTab('RUNNING')}
                  className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
                    botFilterTab === 'RUNNING' ? 'bg-emerald-950 border border-emerald-700 text-emerald-400 font-bold' : 'text-[#9298A6] hover:text-white'
                  }`}
                >
                  Berjalan ({runningBots.length})
                </button>
                <button
                  type="button"
                  onClick={() => setBotFilterTab('STOPPED')}
                  className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
                    botFilterTab === 'STOPPED' ? 'bg-slate-800 border border-slate-700 text-slate-300 font-bold' : 'text-[#9298A6] hover:text-white'
                  }`}
                >
                  Dihentikan ({stoppedBots.length})
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={loadBots}
                disabled={isLoadingBots}
                className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-[#9298A6] hover:text-white transition-colors"
                title="Refresh Bot List"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBots ? 'animate-spin' : ''}`} />
              </button>

              {runningBots.length > 0 && (
                <button
                  onClick={handleCancelAllBots}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-red-950/60 border border-red-800 text-red-300 hover:bg-red-900/60 transition-colors"
                >
                  Hentikan Semua Bot
                </button>
              )}
            </div>
          </div>

          {/* Bots Cards List */}
          {displayedBots.length === 0 ? (
            <div className="rounded-2xl obsidian-glass border border-white/10 p-12 text-center space-y-3">
              <Bot className="w-12 h-12 text-[#9298A6] mx-auto opacity-40" />
              <div className="space-y-1">
                <p className="font-bold text-sm text-[#F5F5F7]">
                  {botFilterTab === 'RUNNING'
                    ? 'Tidak ada bot yang sedang berjalan'
                    : botFilterTab === 'STOPPED'
                    ? 'Tidak ada bot yang dihentikan'
                    : 'Belum ada bot trading aktif'}
                </p>
                <p className="text-xs text-[#9298A6] max-w-md mx-auto">
                  Pilih strategi di sebelah kiri dan klik <strong>Luncurkan Bot Nyata</strong>. Order limit akan langsung dipasang di buku order DOMINEX.
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
                    className="rounded-xl obsidian-glass border border-white/10 p-4 space-y-3 hover:border-white/20 transition-all shadow-md"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-[#16C784] animate-pulse' : 'bg-[#9298A6]'}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-sm text-[#F5F5F7] font-display">{bot.name}</h4>
                            <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-white/5 border border-white/10 text-slate-300">
                              {bot.pairId}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#9298A6] font-mono">
                            ID: {bot.id} · Dimulai: {formatDateTime(bot.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded border ${
                          isRunning
                            ? 'bg-emerald-950/80 text-emerald-400 border-emerald-700/60'
                            : bot.status === 'COMPLETED'
                            ? 'bg-blue-950/80 text-blue-400 border-blue-700/60'
                            : 'bg-slate-800/80 text-slate-400 border-slate-700'
                        }`}>
                          {bot.status}
                        </span>

                        {isRunning && (
                          <button
                            type="button"
                            disabled={isStopping}
                            onClick={() => handleStopBot(bot.id, bot.name)}
                            className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg bg-red-950/80 border border-red-700/80 text-red-300 hover:bg-red-900/80 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                          >
                            <Square className="w-3 h-3 fill-current" />
                            <span>{isStopping ? 'Menghentikan...' : 'Stop Manual'}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setSelectedBotLog(selectedBotLog?.id === bot.id ? null : bot)}
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white/5 border border-white/10 text-[#9298A6] hover:text-white"
                        >
                          {selectedBotLog?.id === bot.id ? 'Tutup Log' : 'Log Eksekusi'}
                        </button>
                      </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/5 text-xs font-mono">
                      <div className="p-2 rounded-lg bg-[#0D1017]">
                        <span className="text-[10px] text-[#9298A6] block">Order Diterapkan</span>
                        <span className="font-bold text-[#F5F5F7]">{deployedCount} Order</span>
                      </div>
                      <div className="p-2 rounded-lg bg-[#0D1017]">
                        <span className="text-[10px] text-[#9298A6] block">Order Terisi (Matched)</span>
                        <span className="font-bold text-emerald-400">{filledCount} Matched</span>
                      </div>
                      <div className="p-2 rounded-lg bg-[#0D1017]">
                        <span className="text-[10px] text-[#9298A6] block">Volume Eksekusi</span>
                        <span className="font-bold text-[#F5F5F7]">{bot.totalVolumeFilled || '0'}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-[#0D1017]">
                        <span className="text-[10px] text-[#9298A6] block">Profit Terealisasi</span>
                        <span className="font-bold text-[#16C784]">
                          {formatIDR(bot.realizedProfitIdr || '0')}
                        </span>
                      </div>
                    </div>

                    {/* Execution Logs Drawer */}
                    {selectedBotLog?.id === bot.id && (
                      <div className="p-3 rounded-xl bg-[#08090D] border border-white/10 space-y-2 mt-2">
                        <div className="flex items-center justify-between text-xs font-mono text-[#9298A6] border-b border-white/5 pb-1">
                          <span className="flex items-center gap-1.5 text-white font-bold">
                            <Terminal className="w-3.5 h-3.5 text-[#FF087F]" />
                            Server Execution Audit Trail
                          </span>
                          <span>{bot.logs?.length || 0} Events Recorded</span>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-[11px] pr-1">
                          {(!bot.logs || bot.logs.length === 0) ? (
                            <p className="text-slate-500 py-2">Belum ada aktivitas log yang tercatat.</p>
                          ) : (
                            bot.logs.map((log: any, idx: number) => (
                              <div key={idx} className="flex items-start gap-2 text-slate-300">
                                <span className="text-slate-500 shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                <span className={`shrink-0 font-bold ${
                                  log.type === 'FILL' ? 'text-emerald-400' :
                                  log.type === 'ORDER' ? 'text-blue-400' :
                                  log.type === 'ERROR' ? 'text-red-400' : 'text-slate-300'
                                }`}>
                                  {log.type}
                                </span>
                                <span className="text-slate-300 break-all">{log.message}</span>
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

      {/* Balance & Engine Synchronization Diagnostic Tool Modal */}
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
