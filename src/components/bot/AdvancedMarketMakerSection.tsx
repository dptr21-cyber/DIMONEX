/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AdvancedMarketMakerSection.tsx
 * DIMONEX Advanced Market Maker & Multi-Timeframe Monitoring Dashboard.
 *
 * Features:
 * - Section A: Market Selection (Trading Pair, Base/Quote, Pair Status, Live Prices)
 * - Section B: Liquidity Configuration (Bids/Asks Levels, Quantities, Spread Min/Max, Spacing, Refresh Interval)
 * - Section C: Adaptive Market Configuration (Adaptive Quoting, Volatility Monitoring, Inventory Rebalancing, Dynamic Spread, Regime Detection, 13 Timeframes)
 * - Section D: Risk Configuration (Max Inventory, Max Order Value, Max Exposure, Max Daily Loss, Price Deviation, Min Buffer, Emergency Stop)
 * - Section E: Live Monitoring Dashboard (Real-time Market Price, Spread, Liquidity, 8-Regime Classifier, Technical Indicators, Active Order Ladder, Audit Logs)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Pause,
  Play,
  RefreshCw,
  OctagonAlert,
  Coins,
  Droplets,
  Cpu,
  Save,
  Plus,
  X,
} from 'lucide-react';
import {
  UserProfile,
  TradingPairItem,
  BotInstance,
  Environment,
} from '../../types/index.js';
import { formatQuotePrice } from '../../lib/formatters.js';
import { PanelHeader } from '../ui/PanelHeader.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { Button } from '../ui/Button.js';

interface Props {
  user: UserProfile | null;
  tradingPairs: TradingPairItem[];
  currentEnv: Environment;
}

const ALL_13_TIMEFRAMES = [
  '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '12h',
  '1D', '1W', '1M',
] as const;

export const AdvancedMarketMakerSection: React.FC<Props> = ({
  tradingPairs,
  currentEnv,
}) => {
  const [bots, setBots] = useState<BotInstance[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [monitoring, setMonitoring] = useState<any>(null);
  const [regimeReport, setRegimeReport] = useState<any>(null);

  // Section A: Market Selection Form
  const [pairId, setPairId] = useState<string>(tradingPairs[0]?.id || 'BTC-IDR');
  const [botName, setBotName] = useState<string>('DIMONEX Pro MM Alpha');
  const [analysisTf, setAnalysisTf] = useState<string>('15m');

  // Section B: Liquidity Configuration Form
  const [bidLevels, setBidLevels] = useState<number>(5);
  const [askLevels, setAskLevels] = useState<number>(5);
  const [bidBaseQty, setBidBaseQty] = useState<string>('0.01');
  const [askBaseQty, setAskBaseQty] = useState<string>('0.01');
  const [qtyDistribution, setQtyDistribution] = useState<'LINEAR' | 'GEOMETRIC' | 'EXPONENTIAL' | 'FLAT'>('LINEAR');
  const [spreadMinBps, setSpreadMinBps] = useState<number>(10);
  const [spreadMaxBps, setSpreadMaxBps] = useState<number>(150);
  const [priceOffsetBps, setPriceOffsetBps] = useState<number>(0);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState<number>(2500);
  const [maxOpenOrders, setMaxOpenOrders] = useState<number>(40);
  const [spacingMode, setSpacingMode] = useState<'LINEAR' | 'GEOMETRIC' | 'VOLATILITY_ADAPTIVE'>('VOLATILITY_ADAPTIVE');

  // Section C: Adaptive Market Configuration Toggles
  const [adaptiveQuoting, setAdaptiveQuoting] = useState<boolean>(true);
  const [volatilityMonitoring, setVolatilityMonitoring] = useState<boolean>(true);
  const [inventoryRebalancing, setInventoryRebalancing] = useState<boolean>(true);
  const [dynamicSpread, setDynamicSpread] = useState<boolean>(true);
  const [marketRegimeDetection, setMarketRegimeDetection] = useState<boolean>(true);
  const [riskProtection, setRiskProtection] = useState<boolean>(true);

  // Section D: Risk Configuration Form
  const [maxInventory, setMaxInventory] = useState<string>('5.0');
  const [maxOrderValueQuote, setMaxOrderValueQuote] = useState<string>('50000000');
  const [maxExposureQuote, setMaxExposureQuote] = useState<string>('500000000');
  const [maxDailyLossQuote, setMaxDailyLossQuote] = useState<string>('25000000');
  const [maxPriceDevPct, setMaxPriceDevPct] = useState<number>(5.0);
  const [minAvailableBalQuote, setMinAvailableBalQuote] = useState<string>('1000000');
  const [emergencyStop, setEmergencyStop] = useState<boolean>(false);

  const selectedPair = useMemo(() => {
    return tradingPairs.find(p => p.id === pairId) || tradingPairs[0];
  }, [tradingPairs, pairId]);

  const activeBot = useMemo(() => {
    return bots.find(b => b.id === selectedBotId);
  }, [bots, selectedBotId]);

  const ensureAuthToken = async (): Promise<string> => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (token) return token;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'mm@dimonex.id', password: 'MarketMaker2026!' }),
      });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem('dimonex_auth_token', data.token);
        return data.token;
      }
    } catch {}
    return '';
  };

  const getAuthHeaders = async () => {
    const token = await ensureAuthToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const loadBots = useCallback(async () => {
    try {
      setIsLoading(true);
      const headers = await getAuthHeaders();
      const res = await fetch('/api/mm/advanced-bot/list', { headers });
      const data = await res.json();
      if (data.success && Array.isArray(data.bots)) {
        setBots(data.bots);
        if (data.bots.length > 0 && !selectedBotId) {
          setSelectedBotId(data.bots[0].id);
        }
      }
    } catch (err: any) {
      console.error('Failed to load Advanced MM bots:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedBotId]);

  useEffect(() => {
    loadBots();
  }, [loadBots]);

  useEffect(() => {
    if (!activeBot || !activeBot.advancedMMConfig) return;
    const cfg = activeBot.advancedMMConfig;
    setBotName(activeBot.name);
    setPairId(activeBot.pairId);
    setAnalysisTf(cfg.timeframe || '15m');
    setBidLevels(cfg.bid_levels || 5);
    setAskLevels(cfg.ask_levels || 5);
    setBidBaseQty(cfg.bid_base_quantity || '0.01');
    setAskBaseQty(cfg.ask_base_quantity || '0.01');
    setQtyDistribution(cfg.quantity_distribution || 'LINEAR');
    setSpreadMinBps(cfg.spread_min_bps || 10);
    setSpreadMaxBps(cfg.spread_max_bps || 150);
    setPriceOffsetBps(cfg.price_offset_bps || 0);
    setRefreshIntervalMs(cfg.order_refresh_interval_ms || 2500);
    setMaxOpenOrders(cfg.maximum_open_orders || 40);
    setSpacingMode(cfg.spacing_mode || 'VOLATILITY_ADAPTIVE');
    setAdaptiveQuoting(cfg.adaptive_quoting_enabled !== false);
    setVolatilityMonitoring(cfg.volatility_monitoring_enabled !== false);
    setInventoryRebalancing(cfg.inventory_rebalancing_enabled !== false);
    setDynamicSpread(cfg.dynamic_spread_enabled !== false);
    setMarketRegimeDetection(cfg.market_regime_detection_enabled !== false);
    setRiskProtection(cfg.risk_protection_enabled !== false);
    setMaxInventory(cfg.maximum_inventory || '5.0');
    setMaxOrderValueQuote(cfg.maximum_order_value_quote || '50000000');
    setMaxExposureQuote(cfg.maximum_exposure_quote || '500000000');
    setMaxDailyLossQuote(cfg.maximum_daily_loss_quote || '25000000');
    setMaxPriceDevPct(cfg.maximum_price_deviation_pct || 5.0);
    setMinAvailableBalQuote(cfg.minimum_available_balance_quote || '1000000');
    setEmergencyStop(Boolean(cfg.emergency_stop));
  }, [activeBot]);

  const fetchMonitoring = useCallback(async () => {
    if (!selectedBotId) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/mm/advanced-bot/${selectedBotId}/monitoring`, {
        headers,
      });
      const data = await res.json();
      if (data.success && data.monitoring) {
        setMonitoring(data.monitoring);
      }
    } catch (err) {
      console.error('Error fetching monitoring telemetry:', err);
    }
  }, [selectedBotId]);

  const fetchAnalytics = useCallback(async () => {
    if (!pairId) return;
    try {
      const res = await fetch(`/api/mm/analytics/${pairId}?timeframe=${analysisTf}`);
      const data = await res.json();
      if (data.success && data.report) {
        setRegimeReport(data.report);
      }
    } catch (err) {
      console.error('Error fetching timeframe analytics:', err);
    }
  }, [pairId, analysisTf]);

  useEffect(() => {
    fetchMonitoring();
    fetchAnalytics();
    const interval = setInterval(() => {
      fetchMonitoring();
      fetchAnalytics();
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchMonitoring, fetchAnalytics]);

  const handleCreateBot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      setFeedback(null);
      const headers = await getAuthHeaders();
      const res = await fetch('/api/mm/advanced-bot/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: botName,
          pairId,
          environment: currentEnv,
          timeframe: analysisTf,
          bid_levels: bidLevels,
          ask_levels: askLevels,
          bid_base_quantity: bidBaseQty,
          ask_base_quantity: askBaseQty,
          quantity_distribution: qtyDistribution,
          spread_min_bps: spreadMinBps,
          spread_max_bps: spreadMaxBps,
          price_offset_bps: priceOffsetBps,
          order_refresh_interval_ms: refreshIntervalMs,
          maximum_open_orders: maxOpenOrders,
          spacing_mode: spacingMode,
          adaptive_quoting_enabled: adaptiveQuoting,
          volatility_monitoring_enabled: volatilityMonitoring,
          inventory_rebalancing_enabled: inventoryRebalancing,
          dynamic_spread_enabled: dynamicSpread,
          market_regime_detection_enabled: marketRegimeDetection,
          risk_protection_enabled: riskProtection,
          maximum_inventory: maxInventory,
          maximum_order_value_quote: maxOrderValueQuote,
          maximum_exposure_quote: maxExposureQuote,
          maximum_daily_loss_quote: maxDailyLossQuote,
          maximum_price_deviation_pct: maxPriceDevPct,
          minimum_available_balance_quote: minAvailableBalQuote,
          emergency_stop: emergencyStop,
        }),
      });
      const data = await res.json();
      if (data.success && data.bot) {
        setFeedback({ type: 'success', text: data.message });
        await loadBots();
        setSelectedBotId(data.bot.id);
      } else {
        setFeedback({ type: 'error', text: data.error || 'Gagal membuat bot.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateBot = async () => {
    if (!selectedBotId) return;
    try {
      setIsSaving(true);
      setFeedback(null);
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/mm/advanced-bot/${selectedBotId}/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: botName,
          timeframe: analysisTf,
          bid_levels: bidLevels,
          ask_levels: askLevels,
          bid_base_quantity: bidBaseQty,
          ask_base_quantity: askBaseQty,
          quantity_distribution: qtyDistribution,
          spread_min_bps: spreadMinBps,
          spread_max_bps: spreadMaxBps,
          price_offset_bps: priceOffsetBps,
          order_refresh_interval_ms: refreshIntervalMs,
          maximum_open_orders: maxOpenOrders,
          spacing_mode: spacingMode,
          adaptive_quoting_enabled: adaptiveQuoting,
          volatility_monitoring_enabled: volatilityMonitoring,
          inventory_rebalancing_enabled: inventoryRebalancing,
          dynamic_spread_enabled: dynamicSpread,
          market_regime_detection_enabled: marketRegimeDetection,
          risk_protection_enabled: riskProtection,
          maximum_inventory: maxInventory,
          maximum_order_value_quote: maxOrderValueQuote,
          maximum_exposure_quote: maxExposureQuote,
          maximum_daily_loss_quote: maxDailyLossQuote,
          maximum_price_deviation_pct: maxPriceDevPct,
          minimum_available_balance_quote: minAvailableBalQuote,
          emergency_stop: emergencyStop,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedback({ type: 'success', text: data.message });
        await loadBots();
      } else {
        setFeedback({ type: 'error', text: data.error || 'Gagal menyimpan konfigurasi.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleBotAction = async (action: 'start' | 'pause' | 'reprice-now' | 'emergency-halt') => {
    if (!selectedBotId) return;
    try {
      setIsSaving(true);
      setFeedback(null);
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/mm/advanced-bot/${selectedBotId}/${action}`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (data.success) {
        setFeedback({ type: 'success', text: data.message });
        await loadBots();
        await fetchMonitoring();
      } else {
        setFeedback({ type: 'error', text: data.error || `Aksi ${action} gagal.` });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const quoteDec = selectedPair
    ? selectedPair.quoteDecimals ?? (selectedPair.quoteCurrency === 'USDT' ? 6 : 2)
    : 2;
  const currentPriceFormatted = formatQuotePrice(
    selectedPair?.lastPrice || '0',
    selectedPair?.quoteCurrency || 'IDR',
    quoteDec
  );

  const getRegimeTone = (regime: string): 'buy' | 'sell' | 'warning' | 'info' | 'brand' | 'neutral' => {
    switch (regime) {
      case 'BULLISH_TREND':
        return 'buy';
      case 'BEARISH_TREND':
        return 'sell';
      case 'HIGH_VOLATILITY':
      case 'REVERSAL':
        return 'warning';
      case 'LOW_VOLATILITY':
      case 'CONSOLIDATION':
        return 'info';
      case 'BREAKOUT':
        return 'brand';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header & Bot Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 bg-[#141C24] border border-[#202B34] rounded-[10px]">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-[7px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1] shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#E4EBEF] tracking-tight">
              DIMONEX Advanced Market Maker &amp; Multi-Timeframe Engine
            </h2>
            <p className="text-xs text-[#A1AFB8] mt-0.5">
              Autonomous Adaptive Liquidity Provider, Multi-Timeframe Regime Detection &amp; Immutable Financial Ledger
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <label htmlFor="adv-bot-select" className="text-xs text-[#A1AFB8]">
            Instance:
          </label>
          <select
            id="adv-bot-select"
            value={selectedBotId}
            onChange={(e) => setSelectedBotId(e.target.value)}
            disabled={isLoading}
            className="px-3 py-2 text-xs font-mono bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-medium focus:border-[#8DA5B1] focus:outline-none"
          >
            {bots.length === 0 ? (
              <option value="">(Belum ada bot — buat di bawah)</option>
            ) : (
              bots.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name} [{b.status}] ({b.pairId})
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`px-4 py-3 rounded-[7px] text-xs font-medium border flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-[#12392F]/60 text-[#35B887] border-[#35B887]/40'
              : 'bg-[#401F27]/60 text-[#EA5B65] border-[#EA5B65]/40'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
            aria-label="Tutup notifikasi"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Risk Warning Alert Banner */}
      {monitoring?.riskWarnings && monitoring.riskWarnings.length > 0 && (
        <div className="p-4 bg-[#2C2415]/50 border border-[#D6A85C]/40 rounded-[10px] text-[#D6A85C] text-xs space-y-1.5">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Peringatan Risiko Aktif</span>
          </div>
          {monitoring.riskWarnings.map((w: string, i: number) => (
            <p key={i} className="pl-6 text-[#E4EBEF]">
              · {w}
            </p>
          ))}
        </div>
      )}

      {/* SECTION E: LIVE MONITORING DASHBOARD */}
      <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
        <PanelHeader
          title={`Live Monitoring Dashboard · ${pairId}`}
          subtitle={activeBot ? `Status: ${activeBot.status}` : 'Pilih atau buat bot untuk memantau order aktif'}
          icon={
            <span
              className={`w-2 h-2 rounded-full inline-block ${
                activeBot?.status === 'RUNNING' ? 'bg-[#16A879] animate-pulse' : 'bg-[#71818B]'
              }`}
            />
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {activeBot?.status === 'RUNNING' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleBotAction('pause')}
                  disabled={isSaving}
                  icon={<Pause className="w-3.5 h-3.5 text-[#D6A85C]" />}
                >
                  Jeda
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="profit"
                  size="sm"
                  onClick={() => handleBotAction('start')}
                  disabled={isSaving || !selectedBotId}
                  icon={<Play className="w-3.5 h-3.5" />}
                >
                  Jalankan Bot
                </Button>
              )}

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleBotAction('reprice-now')}
                disabled={isSaving || !selectedBotId}
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                title="Eksekusi siklus rebalance & reprice seketika"
              >
                Reprice Sekarang
              </Button>

              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => handleBotAction('emergency-halt')}
                disabled={isSaving || !selectedBotId}
                icon={<OctagonAlert className="w-3.5 h-3.5" />}
              >
                Emergency Halt
              </Button>
            </div>
          }
        />

        <div className="p-5 space-y-4">
          {/* Real-time KPI Metric Tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3 bg-[#111820] border border-[#202B34] rounded-[7px]">
              <span className="text-[11px] text-[#71818B] block">Market Last Price</span>
              <span className="text-sm font-mono tabular-nums font-semibold text-[#E4EBEF] mt-0.5 block">
                {currentPriceFormatted}
              </span>
              <span className="text-[11px] text-[#71818B] font-mono">{selectedPair?.quoteCurrency}</span>
            </div>

            <div className="p-3 bg-[#111820] border border-[#202B34] rounded-[7px]">
              <span className="text-[11px] text-[#71818B] block">Best Bid / Ask</span>
              <div className="flex items-center gap-1 text-xs font-mono tabular-nums font-semibold mt-0.5">
                <span className="text-[#16A879]">{monitoring?.bestBid || '-'}</span>
                <span className="text-[#71818B]">/</span>
                <span className="text-[#EA5B65]">{monitoring?.bestAsk || '-'}</span>
              </div>
              <span className="text-[11px] text-[#71818B] font-mono tabular-nums">
                Spread: {monitoring?.currentSpreadBps || 0} bps
              </span>
            </div>

            <div className="p-3 bg-[#111820] border border-[#202B34] rounded-[7px]">
              <span className="text-[11px] text-[#71818B] block">Total Bid Liquidity</span>
              <span className="text-sm font-mono tabular-nums font-semibold text-[#16A879] mt-0.5 block">
                {monitoring?.totalBidLiquidity || '0'}
              </span>
              <span className="text-[11px] text-[#71818B] font-mono">{selectedPair?.quoteCurrency}</span>
            </div>

            <div className="p-3 bg-[#111820] border border-[#202B34] rounded-[7px]">
              <span className="text-[11px] text-[#71818B] block">Total Ask Liquidity</span>
              <span className="text-sm font-mono tabular-nums font-semibold text-[#EA5B65] mt-0.5 block">
                {monitoring?.totalAskLiquidity || '0'}
              </span>
              <span className="text-[11px] text-[#71818B] font-mono">{selectedPair?.quoteCurrency}</span>
            </div>

            <div className="p-3 bg-[#111820] border border-[#202B34] rounded-[7px]">
              <span className="text-[11px] text-[#71818B] block">Inventory Ratio</span>
              <div className="text-xs font-mono tabular-nums font-semibold text-[#E4EBEF] mt-0.5">
                {monitoring?.availableInventoryBase || '0'} {selectedPair?.baseCurrency}
              </div>
              <span className="text-[11px] text-[#71818B] font-mono tabular-nums">
                Quote: {monitoring?.availableInventoryQuote || '0'}
              </span>
            </div>

            <div className="p-3 bg-[#111820] border border-[#202B34] rounded-[7px]">
              <span className="text-[11px] text-[#71818B] block">Market Regime ({analysisTf})</span>
              <div className="mt-1">
                <StatusBadge tone={getRegimeTone(regimeReport?.regime || 'SIDEWAYS')}>
                  {regimeReport?.regime || 'SIDEWAYS'}
                </StatusBadge>
              </div>
              <span className="text-[11px] text-[#A1AFB8] font-mono tabular-nums block mt-1">
                Conf: {regimeReport?.confidenceScorePct || 75}%
              </span>
            </div>
          </div>

          {/* Technical Indicators Strip */}
          {regimeReport?.indicators && (
            <div className="p-3 bg-[#111820] border border-[#202B34] rounded-[7px] flex flex-wrap items-center justify-between gap-3 text-xs font-mono tabular-nums">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[#71818B] font-sans text-xs font-medium">Indicators:</span>
                <span className="text-[#A1AFB8]">
                  EMA9: <strong className="text-[#E4EBEF]">{regimeReport.indicators.ema.ema9.toFixed(quoteDec)}</strong>
                </span>
                <span className="text-[#A1AFB8]">
                  EMA20: <strong className="text-[#E4EBEF]">{regimeReport.indicators.ema.ema20.toFixed(quoteDec)}</strong>
                </span>
                <span className="text-[#A1AFB8]">
                  EMA50: <strong className="text-[#E4EBEF]">{regimeReport.indicators.ema.ema50.toFixed(quoteDec)}</strong>
                </span>
                <span className="text-[#A1AFB8]">
                  RSI(14):{' '}
                  <strong
                    className={
                      regimeReport.indicators.rsi14 > 70
                        ? 'text-[#EA5B65]'
                        : regimeReport.indicators.rsi14 < 30
                        ? 'text-[#16A879]'
                        : 'text-[#D6A85C]'
                    }
                  >
                    {regimeReport.indicators.rsi14.toFixed(1)}
                  </strong>
                </span>
                <span className="text-[#A1AFB8]">
                  ATR(14):{' '}
                  <strong className="text-[#E4EBEF]">{regimeReport.indicators.atr14.pctOfPrice.toFixed(2)}%</strong>
                </span>
                <span className="text-[#A1AFB8]">
                  VWAP: <strong className="text-[#E4EBEF]">{regimeReport.indicators.vwap.toFixed(quoteDec)}</strong>
                </span>
              </div>
              <div className="text-xs text-[#A1AFB8] font-sans">{regimeReport.summary}</div>
            </div>
          )}

          {/* Active Orders Ladder Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-[#E4EBEF]">
                Active Deployed Limit Orders ({monitoring?.activeOrders?.length || 0})
              </h4>
              <span className="text-xs font-mono tabular-nums text-[#71818B]">
                Orders Filled: {monitoring?.filledOrdersCount || 0}
              </span>
            </div>

            <div className="max-h-52 overflow-y-auto border border-[#202B34] rounded-[7px] bg-[#111820]">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="bg-[#17212B] text-[#71818B] text-[11px] sticky top-0 border-b border-[#202B34]">
                  <tr>
                    <th className="py-2 px-3 font-medium">Order ID</th>
                    <th className="py-2 px-3 font-medium">Side</th>
                    <th className="py-2 px-3 font-medium text-right">Price ({selectedPair?.quoteCurrency})</th>
                    <th className="py-2 px-3 font-medium text-right">Quantity ({selectedPair?.baseCurrency})</th>
                    <th className="py-2 px-3 font-medium text-right">Filled</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34]">
                  {!monitoring?.activeOrders || monitoring.activeOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[#71818B] font-sans text-xs">
                        Tidak ada order aktif. Klik &ldquo;Jalankan Bot&rdquo; atau &ldquo;Reprice Sekarang&rdquo; untuk menempatkan order.
                      </td>
                    </tr>
                  ) : (
                    monitoring.activeOrders.map((ord: any) => (
                      <tr key={ord.id} className="hover:bg-[#17212B] transition-colors">
                        <td className="py-2 px-3 text-[#71818B]">{ord.id.slice(0, 12)}...</td>
                        <td className="py-2 px-3">
                          <StatusBadge tone={ord.side === 'BUY' ? 'buy' : 'sell'}>{ord.side}</StatusBadge>
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-semibold ${
                            ord.side === 'BUY' ? 'text-[#16A879]' : 'text-[#EA5B65]'
                          }`}
                        >
                          {ord.price}
                        </td>
                        <td className="py-2 px-3 text-right text-[#E4EBEF]">{ord.quantity}</td>
                        <td className="py-2 px-3 text-right text-[#A1AFB8]">{ord.filled}</td>
                        <td className="py-2 px-3 text-[#35B887] text-[11px]">{ord.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* CONFIGURATION SECTIONS A, B, C, D */}
      <form onSubmit={handleCreateBot} className="flex flex-col gap-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* SECTION A: MARKET SELECTION */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
            <PanelHeader
              title="A. Market Selection"
              subtitle="Pasangan trading & timeframe analisis"
              icon={<Coins className="w-4 h-4" />}
            />

            <div className="p-5 grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Trading Pair</label>
                <select
                  value={pairId}
                  onChange={(e) => setPairId(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] focus:border-[#8DA5B1] focus:outline-none"
                >
                  {tradingPairs.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.id} ({p.baseCurrency}/{p.quoteCurrency})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Bot Name</label>
                <input
                  type="text"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] focus:border-[#8DA5B1] focus:outline-none"
                  placeholder="e.g. BTC-IDR Advanced MM"
                />
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Base Currency</label>
                <input
                  type="text"
                  disabled
                  value={selectedPair?.baseCurrency || 'BTC'}
                  className="w-full px-3 py-2 text-xs bg-[#111820]/60 border border-[#202B34] rounded-[7px] text-[#71818B] font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Quote Currency</label>
                <input
                  type="text"
                  disabled
                  value={selectedPair?.quoteCurrency || 'IDR'}
                  className="w-full px-3 py-2 text-xs bg-[#111820]/60 border border-[#202B34] rounded-[7px] text-[#71818B] font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Market Status</label>
                <div className="flex items-center gap-2 px-3 py-2 bg-[#111820] border border-[#202B34] rounded-[7px]">
                  <StatusBadge tone={selectedPair?.isHalted ? 'danger' : 'success'} dot>
                    {selectedPair?.isHalted ? 'HALTED' : 'ACTIVE / TRADING'}
                  </StatusBadge>
                </div>
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Analysis Timeframe</label>
                <select
                  value={analysisTf}
                  onChange={(e) => setAnalysisTf(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] focus:border-[#8DA5B1] focus:outline-none"
                >
                  {ALL_13_TIMEFRAMES.map(tf => (
                    <option key={tf} value={tf}>
                      {tf} Timeframe
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* SECTION B: LIQUIDITY CONFIGURATION */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
            <PanelHeader
              title="B. Liquidity Configuration"
              subtitle="Kedalaman bid/ask, distribusi ukuran & spread"
              icon={<Droplets className="w-4 h-4" />}
            />

            <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Bid Levels (1–20)</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={bidLevels}
                  onChange={(e) => setBidLevels(parseInt(e.target.value, 10) || 5)}
                  className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Ask Levels (1–20)</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={askLevels}
                  onChange={(e) => setAskLevels(parseInt(e.target.value, 10) || 5)}
                  className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Distribution</label>
                <select
                  value={qtyDistribution}
                  onChange={(e) => setQtyDistribution(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] focus:border-[#8DA5B1] focus:outline-none"
                >
                  <option value="LINEAR">Linear (+25%/lvl)</option>
                  <option value="GEOMETRIC">Geometric (+20%/lvl)</option>
                  <option value="EXPONENTIAL">Exponential (+40%/lvl)</option>
                  <option value="FLAT">Flat (Equal Lots)</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">
                  Bid Base Qty ({selectedPair?.baseCurrency})
                </label>
                <input
                  type="text"
                  value={bidBaseQty}
                  onChange={(e) => setBidBaseQty(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">
                  Ask Base Qty ({selectedPair?.baseCurrency})
                </label>
                <input
                  type="text"
                  value={askBaseQty}
                  onChange={(e) => setAskBaseQty(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Spacing Mode</label>
                <select
                  value={spacingMode}
                  onChange={(e) => setSpacingMode(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] focus:border-[#8DA5B1] focus:outline-none"
                >
                  <option value="VOLATILITY_ADAPTIVE">Volatility Adaptive (ATR)</option>
                  <option value="LINEAR">Linear (Fixed Ticks)</option>
                  <option value="GEOMETRIC">Geometric (Expanding)</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Spread Min (bps)</label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={spreadMinBps}
                  onChange={(e) => setSpreadMinBps(parseInt(e.target.value, 10) || 10)}
                  className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                />
                <span className="text-[11px] font-mono text-[#71818B]">{(spreadMinBps / 100).toFixed(2)}%</span>
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Spread Max (bps)</label>
                <input
                  type="number"
                  min="1"
                  max="5000"
                  value={spreadMaxBps}
                  onChange={(e) => setSpreadMaxBps(parseInt(e.target.value, 10) || 150)}
                  className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                />
                <span className="text-[11px] font-mono text-[#71818B]">{(spreadMaxBps / 100).toFixed(2)}%</span>
              </div>

              <div>
                <label className="text-xs text-[#A1AFB8] block mb-1.5">Refresh Interval (ms)</label>
                <input
                  type="number"
                  min="500"
                  max="60000"
                  step="500"
                  value={refreshIntervalMs}
                  onChange={(e) => setRefreshIntervalMs(parseInt(e.target.value, 10) || 2500)}
                  className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* SECTION C: ADAPTIVE MARKET CONFIGURATION */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
            <PanelHeader
              title="C. Adaptive Market Configuration"
              subtitle="Modul adaptasi volatilitas, inventaris & rezim pasar"
              icon={<Cpu className="w-4 h-4" />}
            />

            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  title: 'Adaptive Quoting',
                  desc: 'Scale depth & quotes by volume',
                  checked: adaptiveQuoting,
                  onChange: setAdaptiveQuoting,
                },
                {
                  title: 'Volatility Monitoring',
                  desc: 'Real-time ATR 14 assessment',
                  checked: volatilityMonitoring,
                  onChange: setVolatilityMonitoring,
                },
                {
                  title: 'Inventory Rebalancing',
                  desc: 'Avellaneda-Stoikov quote skewing',
                  checked: inventoryRebalancing,
                  onChange: setInventoryRebalancing,
                },
                {
                  title: 'Dynamic Spread',
                  desc: 'Widen in high vol, tighten in range',
                  checked: dynamicSpread,
                  onChange: setDynamicSpread,
                },
                {
                  title: 'Market Regime Detection',
                  desc: 'Classify 8 market regimes',
                  checked: marketRegimeDetection,
                  onChange: setMarketRegimeDetection,
                },
                {
                  title: 'Risk Protection',
                  desc: 'Strict balance & dev limit guards',
                  checked: riskProtection,
                  onChange: setRiskProtection,
                },
              ].map(item => (
                <label
                  key={item.title}
                  className="flex items-center justify-between p-3 bg-[#111820] border border-[#202B34] hover:border-[#2B3944] rounded-[7px] cursor-pointer transition-colors"
                >
                  <div>
                    <span className="text-xs font-semibold text-[#E4EBEF] block">{item.title}</span>
                    <span className="text-[11px] text-[#71818B]">{item.desc}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => item.onChange(e.target.checked)}
                    className="w-4 h-4 accent-[#8DA5B1] rounded cursor-pointer"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* SECTION D: RISK CONFIGURATION */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
            <PanelHeader
              title="D. Risk Configuration"
              subtitle="Batas inventaris, deviasi harga & kill switch"
              icon={<ShieldCheck className="w-4 h-4" />}
            />

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-[#A1AFB8] block mb-1.5">
                    Max Inventory ({selectedPair?.baseCurrency})
                  </label>
                  <input
                    type="text"
                    value={maxInventory}
                    onChange={(e) => setMaxInventory(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-[#A1AFB8] block mb-1.5">
                    Max Single Order ({selectedPair?.quoteCurrency})
                  </label>
                  <input
                    type="text"
                    value={maxOrderValueQuote}
                    onChange={(e) => setMaxOrderValueQuote(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-[#A1AFB8] block mb-1.5">
                    Max Exposure ({selectedPair?.quoteCurrency})
                  </label>
                  <input
                    type="text"
                    value={maxExposureQuote}
                    onChange={(e) => setMaxExposureQuote(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-[#A1AFB8] block mb-1.5">
                    Max Daily Loss ({selectedPair?.quoteCurrency})
                  </label>
                  <input
                    type="text"
                    value={maxDailyLossQuote}
                    onChange={(e) => setMaxDailyLossQuote(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-[#A1AFB8] block mb-1.5">Max Price Deviation (%)</label>
                  <input
                    type="number"
                    min="0.5"
                    max="20"
                    step="0.5"
                    value={maxPriceDevPct}
                    onChange={(e) => setMaxPriceDevPct(parseFloat(e.target.value) || 5.0)}
                    className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-[#A1AFB8] block mb-1.5">
                    Min Buffer Balance ({selectedPair?.quoteCurrency})
                  </label>
                  <input
                    type="text"
                    value={minAvailableBalQuote}
                    onChange={(e) => setMinAvailableBalQuote(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#111820] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums focus:border-[#8DA5B1] focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[#202B34]">
                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-[7px] bg-[#401F27]/30 border border-[#EA5B65]/30">
                  <input
                    type="checkbox"
                    checked={emergencyStop}
                    onChange={(e) => setEmergencyStop(e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-[#EA5B65] rounded cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-semibold text-[#EA5B65] block">
                      Emergency Stop Kill Switch
                    </span>
                    <span className="text-[11px] text-[#A1AFB8]">
                      Jika aktif, bot langsung menarik seluruh limit order dan menahan eksekusi order baru.
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Submit & Update Actions */}
        <div className="flex flex-wrap items-center justify-end gap-3 p-4 bg-[#141C24] border border-[#202B34] rounded-[10px]">
          {selectedBotId && (
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={handleUpdateBot}
              isLoading={isSaving}
              icon={<Save className="w-3.5 h-3.5" />}
            >
              {isSaving ? 'Menyimpan...' : 'Simpan Perubahan Konfigurasi'}
            </Button>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={isSaving}
            icon={<Plus className="w-3.5 h-3.5" />}
          >
            {isSaving ? 'Membuat...' : 'Buat Bot Advanced MM Baru'}
          </Button>
        </div>
      </form>

      {/* Audit Logs Stream */}
      {monitoring?.logs && monitoring.logs.length > 0 && (
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
          <PanelHeader
            title="Audit Activity Logs"
            subtitle="Immutable double-entry pipeline trail"
          />
          <div className="p-4 max-h-40 overflow-y-auto font-mono text-[11px] space-y-1.5">
            {monitoring.logs.map((log: any, idx: number) => (
              <div
                key={idx}
                className="flex items-start gap-2.5 py-1 border-b border-[#202B34] last:border-b-0"
              >
                <span className="text-[#71818B] tabular-nums shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString('id-ID')}
                </span>
                <StatusBadge
                  tone={
                    log.type === 'ORDER'
                      ? 'info'
                      : log.type === 'FILL'
                      ? 'buy'
                      : log.type === 'RISK'
                      ? 'warning'
                      : log.type === 'ERROR'
                      ? 'danger'
                      : 'neutral'
                  }
                >
                  {log.type}
                </StatusBadge>
                <span className="text-[#E4EBEF]">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
