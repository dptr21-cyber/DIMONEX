/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/bot/MMConsoleView.tsx
 * Complete Market Maker (MM) Console for DIMONEX Exchange.
 * 
 * Features:
 * - 10 Core Navigation Tabs: Overview, Order Bots, Volume and Test Bots, Configurations,
 *   Bot Accounts, Orders, Executed Trades, Activity Logs, Risk Controls, Settings.
 * - Environment Isolation: DEMO / SANDBOX, STAGING, PRODUCTION.
 * - Full Order Bot & Volume Bot form configuration with exact field schemas.
 * - Bot cloning with fresh ID, independent runtime state, and isolated logs.
 * - CSV Import with column validation and row-level preview.
 * - CSV Export for Order and Volume bot configurations.
 * - Server-side Risk Controls and Emergency Kill-Switch.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  BarChart3,
  BellRing,
  Bot,
  CheckCircle2,
  Coins,
  Cpu,
  Crosshair,
  DollarSign,
  Flame,
  FlaskConical,
  Globe,
  Layers,
  Lock,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Scale,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Square,
  Trash2,
  TrendingUp,
  Unlock,
  X,
  Zap,
  AlertTriangle
} from 'lucide-react';
import { UserProfile, TradingPairItem, BotInstance, OrderItem, TradeItem, Environment, BotStatus, BotType, ExternalWsWhitelistEntry, BacktestRequest, PriceThresholdTrigger, PriceThresholdEvent } from '../../types/index.js';
import { formatIDR, formatCrypto, formatDateTime, safeBigInt, formatQuotePrice } from '../../lib/formatters.js';
import { safeFetchJson, runConcurrentTasks } from '../../lib/safeFetch.js';
import { playThresholdSound } from '../../lib/thresholdAudio.js';
import { Button } from '../ui/Button.js';
import { Modal } from '../ui/Modal.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { useToast } from '../ui/Toast.js';
import { SmartHftLadderSection } from './SmartHftLadderSection.js';
import { HftBacktestSection } from './HftBacktestSection.js';
import { AdvancedMarketMakerSection } from './AdvancedMarketMakerSection.js';
import { PerformanceDashboardSection } from './PerformanceDashboardSection.js';
import { PortfolioRebalanceSection } from './PortfolioRebalanceSection.js';
import { HftEngineTelemetrySection } from './HftEngineTelemetrySection.js';
import { PriceThresholdSection } from './PriceThresholdSection.js';
import { MarketMakerInternalSpreadSection } from './MarketMakerInternalSpreadSection.js';

interface Props {
  user: UserProfile | null;
  tradingPairs: TradingPairItem[];
  onOpenAuthModal: () => void;
  onOpenSecurityView: () => void;
}

type MMTab = 
  | 'OVERVIEW' 
  | 'PERFORMANCE'
  | 'HFT_TELEMETRY'
  | 'PORTFOLIO_REBALANCE'
  | 'ADVANCED_MM'
  | 'SMART_HFT_LADDER'
  | 'HFT_BACKTEST'
  | 'PRICE_THRESHOLDS'
  | 'QUANT_HFT_MM'
  | 'DEPTH_LIQUIDITY'
  | 'MOVEMENT_DEPTH'
  | 'PRICE_FOLLOWER'
  | 'EXTERNAL_FEEDS'
  | 'FX_RATES'
  | 'ORDER_BOTS' 
  | 'VOLUME_BOTS' 
  | 'INTERNAL_SPREAD'
  | 'CONFIGURATIONS' 
  | 'BOT_ACCOUNTS' 
  | 'ORDERS' 
  | 'EXECUTED_TRADES' 
  | 'ACTIVITY_LOGS' 
  | 'RISK_CONTROLS' 
  | 'SETTINGS';

export const MMConsoleView: React.FC<Props> = ({
  user,
  tradingPairs,
  onOpenAuthModal,
  onOpenSecurityView
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTabState] = useState<MMTab>(() => {
    return (localStorage.getItem('dimonex_mm_tab') as MMTab) || 'OVERVIEW';
  });
  const setActiveTab = (tab: MMTab) => {
    setActiveTabState(tab);
    localStorage.setItem('dimonex_mm_tab', tab);
  };

  const [currentEnv, setCurrentEnvState] = useState<Environment>(() => {
    return (localStorage.getItem('dimonex_mm_env') as Environment) || 'DEMO';
  });
  const setCurrentEnv = (env: Environment) => {
    setCurrentEnvState(env);
    localStorage.setItem('dimonex_mm_env', env);
  };

  const [selectedPairId, setSelectedPairId] = useState<string>(() => {
    return localStorage.getItem('dimonex_mm_pair') || 'BTC-IDR';
  });
  const setSelectedPair = (pairId: string) => {
    setSelectedPairId(pairId);
    localStorage.setItem('dimonex_mm_pair', pairId);
  };

  // Overview data
  const [overview, setOverview] = useState<any>(null);
  const [instances, setInstances] = useState<BotInstance[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [botLogs, setBotLogs] = useState<any[]>([]);
  const [botOrders, setBotOrders] = useState<OrderItem[]>([]);
  const [botTrades, setBotTrades] = useState<TradeItem[]>([]);
  const [riskControls, setRiskControls] = useState<any>(null);

  // Modal states
  const [isOrderBotModalOpen, setIsOrderBotModalOpen] = useState(false);
  const [isVolumeBotModalOpen, setIsVolumeBotModalOpen] = useState(false);
  const [isVolumeSpreadModalOpen, setIsVolumeSpreadModalOpen] = useState(false);
  const [isPriceFollowerModalOpen, setIsPriceFollowerModalOpen] = useState(false);
  const [isDepthLiquidityModalOpen, setIsDepthLiquidityModalOpen] = useState(false);
  const [isMovementDepthModalOpen, setIsMovementDepthModalOpen] = useState(false);
  const [isQuantHftModalOpen, setIsQuantHftModalOpen] = useState(false);
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCsvImportModalOpen, setIsCsvImportModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [botToDelete, setBotToDelete] = useState<BotInstance | null>(null);
  const [isKillSwitchConfirmOpen, setIsKillSwitchConfirmOpen] = useState(false);
  const [backtestPreset, setBacktestPreset] = useState<Partial<BacktestRequest> | null>(null);
  const [deployPresetFromBacktest, setDeployPresetFromBacktest] = useState<BacktestRequest | null>(null);

  // Price Threshold Alerts & Automated Ladder Adjustment State
  const [thresholdTriggers, setThresholdTriggers] = useState<PriceThresholdTrigger[]>([]);
  const [thresholdEvents, setThresholdEvents] = useState<PriceThresholdEvent[]>([]);
  const [thresholdSoundMuted, setThresholdSoundMuted] = useState<boolean>(
    () => localStorage.getItem('dimonex_threshold_muted') === '1'
  );
  const seenThresholdEventIdsRef = useRef<Set<string>>(new Set());
  const thresholdInitializedRef = useRef<boolean>(false);

  // External Feeds & FX Rate State
  const [externalFeeds, setExternalFeeds] = useState<any>(null);
  const [fxData, setFxData] = useState<any>(null);
  const [manualFxRate, setManualFxRate] = useState<string>('16350');
  const [manualFxNotes, setManualFxNotes] = useState<string>('Penyesuaian kurs resmi oleh operator');
  const [manualFxValidityHours, setManualFxValidityHours] = useState<string>('24');
  const [manualFxConfirm, setManualFxConfirm] = useState<boolean>(false);

  // Price Follower Form State
  const [pfName, setPfName] = useState('Price Follower Alpha');
  const [pfPairId, setPfPairId] = useState('BTC-IDR');
  const [pfProvider, setPfProvider] = useState<'AGGREGATED' | 'BINANCE' | 'BYBIT'>('AGGREGATED');
  const [pfTargetSpreadBps, setPfTargetSpreadBps] = useState('40');
  const [pfBuyOffsetBps, setPfBuyOffsetBps] = useState('20');
  const [pfSellOffsetBps, setPfSellOffsetBps] = useState('20');
  const [pfOrderQty, setPfOrderQty] = useState('0.02');
  const [pfRepriceInterval, setPfRepriceInterval] = useState('2000');
  const [pfMinPriceChangeBps, setPfMinPriceChangeBps] = useState('5');
  const [pfDryRun, setPfDryRun] = useState(false);

  // Depth Liquidity Form State
  const [dlName, setDlName] = useState('Depth Liquidity BTC-IDR Ladder');
  const [dlPairId, setDlPairId] = useState('BTC-IDR');
  const [dlPriceMode, setDlPriceMode] = useState<'EXTERNAL_REFERENCE' | 'CUSTOM_BOUNDS'>('EXTERNAL_REFERENCE');
  const [dlMinBuyPrice, setDlMinBuyPrice] = useState('1400000000');
  const [dlMaxBuyPrice, setDlMaxBuyPrice] = useState('1440000000');
  const [dlMinSellPrice, setDlMinSellPrice] = useState('1460000000');
  const [dlMaxSellPrice, setDlMaxSellPrice] = useState('1500000000');
  const [dlSource, setDlSource] = useState<'AGGREGATED' | 'BINANCE' | 'BYBIT' | 'COINMARKETCAP' | 'NONE'>('AGGREGATED');
  const [dlSpacingMode, setDlSpacingMode] = useState<'LINEAR' | 'GEOMETRIC' | 'CONCENTRATED' | 'FIXED_IDR' | 'PERCENT_BPS'>('LINEAR');
  const [dlAntiStacking, setDlAntiStacking] = useState(true);
  const [dlLevelSpacingIdr, setDlLevelSpacingIdr] = useState('60');
  const [dlNumBids, setDlNumBids] = useState('5');
  const [dlNumAsks, setDlNumAsks] = useState('5');
  const [dlBidOffsets, setDlBidOffsets] = useState('10, 25, 50, 80, 120');
  const [dlAskOffsets, setDlAskOffsets] = useState('10, 25, 50, 80, 120');
  const [dlBidQuantities, setDlBidQuantities] = useState('25.0, 50.0, 75.0, 100.0, 150.0');
  const [dlAskQuantities, setDlAskQuantities] = useState('25.0, 50.0, 75.0, 100.0, 150.0');
  const [dlRandomizeQty, setDlRandomizeQty] = useState(false);
  const [dlRandomMinQty, setDlRandomMinQty] = useState('10.0');
  const [dlRandomMaxQty, setDlRandomMaxQty] = useState('50.0');
  const [dlRepriceInterval, setDlRepriceInterval] = useState('3000');
  const [dlDryRun, setDlDryRun] = useState(false);
  const [dlRefreshCooldownSec, setDlRefreshCooldownSec] = useState('10');
  const [dlExactPlacement, setDlExactPlacement] = useState(true);
  const [dlRandomizePlacement, setDlRandomizePlacement] = useState(false);
  const [dlPriceRandomizationTicks, setDlPriceRandomizationTicks] = useState('0');
  const [dlMaxInventory, setDlMaxInventory] = useState('1000.0');
  const [dlMaxTotalBidValIdr, setDlMaxTotalBidValIdr] = useState('500000000');
  const [dlMaxTotalAskQty, setDlMaxTotalAskQty] = useState('500.0');
  const [dlMaxOpenOrders, setDlMaxOpenOrders] = useState('20');
  const [dlTickSize, setDlTickSize] = useState('');
  const [dlLotSize, setDlLotSize] = useState('0.0001');

  // Admin Curated WebSocket Whitelist & Movement Depth (WS) Bot Form State
  const [wsWhitelist, setWsWhitelist] = useState<ExternalWsWhitelistEntry[]>([]);
  const [wsFeedConnStatus, setWsFeedConnStatus] = useState<{ binance?: string; bybit?: string }>({});
  const [mdName, setMdName] = useState('Depth Movement Bot BTC-Follower');
  const [mdPairId, setMdPairId] = useState('BTC-IDR');
  const [mdLeaderSymbol, setMdLeaderSymbol] = useState('BTCUSDT');
  const [mdLeaderProvider, setMdLeaderProvider] = useState<'AGGREGATED' | 'BINANCE' | 'BYBIT'>('AGGREGATED');
  const [mdAnchorLocalPrice, setMdAnchorLocalPrice] = useState('1000');
  const [mdSensitivity, setMdSensitivity] = useState('1.0');
  const [mdThresholdBps, setMdThresholdBps] = useState('10');
  const [mdMinPriceGuard, setMdMinPriceGuard] = useState('');
  const [mdMaxPriceGuard, setMdMaxPriceGuard] = useState('');
  const [mdSpreadBps, setMdSpreadBps] = useState('20');
  const [mdSpacingMode, setMdSpacingMode] = useState<'LINEAR' | 'GEOMETRIC' | 'CONCENTRATED' | 'FIXED_IDR' | 'PERCENT_BPS'>('PERCENT_BPS');
  const [mdAntiStacking, setMdAntiStacking] = useState(true);
  const [mdLevelSpacing, setMdLevelSpacing] = useState('10');
  const [mdNumBids, setMdNumBids] = useState('5');
  const [mdNumAsks, setMdNumAsks] = useState('5');
  const [mdBidOffsets, setMdBidOffsets] = useState('20, 45, 75, 110, 150');
  const [mdAskOffsets, setMdAskOffsets] = useState('20, 45, 75, 110, 150');
  const [mdBidQuantities, setMdBidQuantities] = useState('10.0, 20.0, 30.0, 50.0, 80.0');
  const [mdAskQuantities, setMdAskQuantities] = useState('10.0, 20.0, 30.0, 50.0, 80.0');
  const [mdRandomizeQty, setMdRandomizeQty] = useState(false);
  const [mdRandomMinQty, setMdRandomMinQty] = useState('5.0');
  const [mdRandomMaxQty, setMdRandomMaxQty] = useState('25.0');
  const [mdRepriceInterval, setMdRepriceInterval] = useState('3000');
  const [mdRefreshCooldownSec, setMdRefreshCooldownSec] = useState('10');
  const [mdExactPlacement, setMdExactPlacement] = useState(true);
  const [mdRandomizePlacement, setMdRandomizePlacement] = useState(false);
  const [mdPriceRandomizationTicks, setMdPriceRandomizationTicks] = useState('0');
  const [mdMaxInventory, setMdMaxInventory] = useState('1000000.0');
  const [mdMaxTotalBidValIdr, setMdMaxTotalBidValIdr] = useState('5000000000');
  const [mdMaxTotalAskQty, setMdMaxTotalAskQty] = useState('1000000.0');
  const [mdMaxOpenOrders, setMdMaxOpenOrders] = useState('20');
  const [mdTickSize, setMdTickSize] = useState('');
  const [mdLotSize, setMdLotSize] = useState('0.0001');
  const [mdDryRun, setMdDryRun] = useState(false);
  const [mdSimMovePct, setMdSimMovePct] = useState<number>(2.0);

  // Quant HFT Market Maker Form State
  const [qhftName, setQhftName] = useState('Quant HFT MM BTC-IDR');
  const [qhftPairId, setQhftPairId] = useState('BTC-IDR');
  const [qhftTargetSpreadPct, setQhftTargetSpreadPct] = useState('0.08');
  const [qhftMinSpreadPct, setQhftMinSpreadPct] = useState('0.02');
  const [qhftMaxSpreadPct, setQhftMaxSpreadPct] = useState('0.40');
  const [qhftMicroOrderSize, setQhftMicroOrderSize] = useState('0.001');
  const [qhftMaxLadderLevels, setQhftMaxLadderLevels] = useState('3');
  const [qhftMaxBaseInventory, setQhftMaxBaseInventory] = useState('5.0');
  const [qhftMaxQuoteInventory, setQhftMaxQuoteInventory] = useState('50000.0');
  const [qhftInventorySkewFactor, setQhftInventorySkewFactor] = useState('0.25');
  const [qhftVolatilityThresholdBps, setQhftVolatilityThresholdBps] = useState('120');
  const [qhftPumpDumpMultiplier, setQhftPumpDumpMultiplier] = useState('2.5');
  const [qhftDefensePerimeterMultiplier, setQhftDefensePerimeterMultiplier] = useState('3.0');
  const [qhftTightenSpreadEnabled, setQhftTightenSpreadEnabled] = useState(true);
  const [qhftTrendLeaningEnabled, setQhftTrendLeaningEnabled] = useState(true);
  const [qhftFlashDefenseEnabled, setQhftFlashDefenseEnabled] = useState(true);
  const [qhftRepriceIntervalMs, setQhftRepriceIntervalMs] = useState('1500');

  // Quant HFT Edit State
  const [editQhftTargetSpread, setEditQhftTargetSpread] = useState('0.08');
  const [editQhftMicroOrderSize, setEditQhftMicroOrderSize] = useState('0.001');
  const [editQhftMaxLadderLevels, setEditQhftMaxLadderLevels] = useState('3');
  const [editQhftMaxBaseInventory, setEditQhftMaxBaseInventory] = useState('5.0');
  const [editQhftMaxQuoteInventory, setEditQhftMaxQuoteInventory] = useState('50000.0');
  const [editQhftTightenSpread, setEditQhftTightenSpread] = useState(true);
  const [editQhftTrendLeaning, setEditQhftTrendLeaning] = useState(true);
  const [editQhftFlashDefense, setEditQhftFlashDefense] = useState(true);
  const [editQhftRepriceInterval, setEditQhftRepriceInterval] = useState('1500');

  const [logFilterMode, setLogFilterMode] = useState<'ALL_SYSTEM' | 'SINGLE_BOT'>('ALL_SYSTEM');
  const [allActivityLogs, setAllActivityLogs] = useState<any[]>([]);
  const [cloneSourceBot, setCloneSourceBot] = useState<BotInstance | null>(null);
  const [cloneNewName, setCloneNewName] = useState('');
  const [cloneTxType, setCloneTxType] = useState<'BUY' | 'SELL' | 'SAME'>('BUY');
  const [orderBotFilter, setOrderBotFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [editingBot, setEditingBot] = useState<BotInstance | null>(null);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editPairId, setEditPairId] = useState('BTC-IDR');
  const [editEnv, setEditEnv] = useState<Environment>('DEMO');
  const [editObTxType, setEditObTxType] = useState<'BUY' | 'SELL'>('BUY');
  const [editObPriceSource, setEditObPriceSource] = useState<'BEST_BID' | 'BEST_ASK' | 'MIDPOINT' | 'LAST_PRICE'>('MIDPOINT');
  const [editObPriceDecimal, setEditObPriceDecimal] = useState('2');
  const [editObQtyDecimal, setEditObQtyDecimal] = useState('8');
  const [editObRandomMinQty, setEditObRandomMinQty] = useState('0.01');
  const [editObRandomMaxQty, setEditObRandomMaxQty] = useState('0.05');
  const [editObOrderCount, setEditObOrderCount] = useState('0'); // 0 = continuous
  const [editObExpireTime, setEditObExpireTime] = useState('0');
  const [editObSplitMode, setEditObSplitMode] = useState<'NONE' | 'RANDOM_SPLIT'>('NONE');
  const [editObSplitRange, setEditObSplitRange] = useState('3');
  const [editObBuyTrailMin, setEditObBuyTrailMin] = useState('0.1');
  const [editObBuyTrailMax, setEditObBuyTrailMax] = useState('0.5');
  const [editObSellTrailMin, setEditObSellTrailMin] = useState('0.1');
  const [editObSellTrailMax, setEditObSellTrailMax] = useState('0.5');
  const [editObBuyMinPrice, setEditObBuyMinPrice] = useState('');
  const [editObBuyMaxPrice, setEditObBuyMaxPrice] = useState('');
  const [editObSellMinPrice, setEditObSellMinPrice] = useState('');
  const [editObSellMaxPrice, setEditObSellMaxPrice] = useState('');
  const [editObJitterTiming, setEditObJitterTiming] = useState('10');
  const [editObJitterPrice, setEditObJitterPrice] = useState('2');

  const [editVbPriceDecimal, setEditVbPriceDecimal] = useState('2');
  const [editVbQtyDecimal, setEditVbQtyDecimal] = useState('8');
  const [editVbRandomMinQty, setEditVbRandomMinQty] = useState('0.02');
  const [editVbRandomMaxQty, setEditVbRandomMaxQty] = useState('0.08');
  const [editVbMinDelay, setEditVbMinDelay] = useState('2');
  const [editVbMaxDelay, setEditVbMaxDelay] = useState('5');
  const [editVbMinDiff, setEditVbMinDiff] = useState('0.01');
  const [editVbMaxDiff, setEditVbMaxDiff] = useState('0.05');
  const [editVbPriority, setEditVbPriority] = useState<'RANDOM' | 'HIGH' | 'NORMAL'>('RANDOM');
  const [editVbMaxLimitPrice, setEditVbMaxLimitPrice] = useState('1550000000');
  const [editVbMinLimitPrice, setEditVbMinLimitPrice] = useState('1400000000');
  const [editVbVolIdrStop, setEditVbVolIdrStop] = useState('5000000000');
  const [editVbVolIdrStart, setEditVbVolIdrStart] = useState('0');
  const [editVbSellAccountId, setEditVbSellAccountId] = useState('');

  // Volume Spread Bot Phase 2 Edit state
  const [editVsbSpreadMode, setEditVsbSpreadMode] = useState<'INSIDE_SPREAD' | 'MIDPOINT_JITTER' | 'PING_PONG_EDGE'>('INSIDE_SPREAD');
  const [editVsbSidePattern, setEditVsbSidePattern] = useState<'ALTERNATE' | 'RANDOM' | 'BUY_EATS_SELL' | 'SELL_EATS_BUY'>('ALTERNATE');
  const [editVsbMinQty, setEditVsbMinQty] = useState('0.005');
  const [editVsbMaxQty, setEditVsbMaxQty] = useState('0.025');
  const [editVsbMinDelay, setEditVsbMinDelay] = useState('2');
  const [editVsbMaxDelay, setEditVsbMaxDelay] = useState('5');
  const [editVsbBandMinPct, setEditVsbBandMinPct] = useState('15');
  const [editVsbBandMaxPct, setEditVsbBandMaxPct] = useState('85');
  const [editVsbMinSpreadBps, setEditVsbMinSpreadBps] = useState('2');
  const [editVsbFallbackHalfSpreadBps, setEditVsbFallbackHalfSpreadBps] = useState('15');
  const [editVsbRequireTwoSided, setEditVsbRequireTwoSided] = useState(false);
  const [editVsbCrossDelayMs, setEditVsbCrossDelayMs] = useState('150');
  const [editVsbTickSize, setEditVsbTickSize] = useState('');
  const [editVsbMinLimitPrice, setEditVsbMinLimitPrice] = useState('1400000000');
  const [editVsbMaxLimitPrice, setEditVsbMaxLimitPrice] = useState('1550000000');
  const [editVsbVolQuoteStop, setEditVsbVolQuoteStop] = useState('5000000000');
  const [editVsbCounterpartyAccountId, setEditVsbCounterpartyAccountId] = useState('');

  // Depth Liquidity Edit state
  const [editDlPriceMode, setEditDlPriceMode] = useState<'EXTERNAL_REFERENCE' | 'CUSTOM_BOUNDS'>('CUSTOM_BOUNDS');
  const [editDlMinBuyPrice, setEditDlMinBuyPrice] = useState('16200');
  const [editDlMaxBuyPrice, setEditDlMaxBuyPrice] = useState('16400');
  const [editDlMinSellPrice, setEditDlMinSellPrice] = useState('16500');
  const [editDlMaxSellPrice, setEditDlMaxSellPrice] = useState('16700');
  const [editDlSpacingMode, setEditDlSpacingMode] = useState<'LINEAR' | 'GEOMETRIC' | 'CONCENTRATED' | 'FIXED_IDR' | 'PERCENT_BPS'>('LINEAR');
  const [editDlAntiStacking, setEditDlAntiStacking] = useState(true);
  const [editDlRefreshCooldown, setEditDlRefreshCooldown] = useState('10');
  const [editDlRandomizePlacement, setEditDlRandomizePlacement] = useState(true);
  const [editDlPriceRandomizationTicks, setEditDlPriceRandomizationTicks] = useState('2');
  const [editDlLevelSpacingIdr, setEditDlLevelSpacingIdr] = useState('60');
  const [editDlNumBids, setEditDlNumBids] = useState('5');
  const [editDlNumAsks, setEditDlNumAsks] = useState('5');
  const [editDlExactPlacement, setEditDlExactPlacement] = useState(true);
  const [editDlMaxInventory, setEditDlMaxInventory] = useState('1000.0');
  const [editDlMaxTotalBidValIdr, setEditDlMaxTotalBidValIdr] = useState('500000000');
  const [editDlMaxTotalAskQty, setEditDlMaxTotalAskQty] = useState('500.0');
  const [editDlMaxOpenOrders, setEditDlMaxOpenOrders] = useState('20');
  const [editDlTickSize, setEditDlTickSize] = useState('');
  const [editDlLotSize, setEditDlLotSize] = useState('0.0001');

  // Movement Depth Edit state
  const [editMdLeaderSymbol, setEditMdLeaderSymbol] = useState('BTCUSDT');
  const [editMdLeaderProvider, setEditMdLeaderProvider] = useState<'AGGREGATED' | 'BINANCE' | 'BYBIT'>('AGGREGATED');
  const [editMdAnchorLocalPrice, setEditMdAnchorLocalPrice] = useState('1000');
  const [editMdSensitivity, setEditMdSensitivity] = useState('1.0');
  const [editMdThresholdBps, setEditMdThresholdBps] = useState('10');
  const [editMdMinPriceGuard, setEditMdMinPriceGuard] = useState('');
  const [editMdMaxPriceGuard, setEditMdMaxPriceGuard] = useState('');
  const [editMdSpreadBps, setEditMdSpreadBps] = useState('20');
  const [editMdSpacingMode, setEditMdSpacingMode] = useState<'LINEAR' | 'GEOMETRIC' | 'CONCENTRATED' | 'FIXED_IDR' | 'PERCENT_BPS'>('PERCENT_BPS');
  const [editMdLevelSpacing, setEditMdLevelSpacing] = useState('10');
  const [editMdAntiStacking, setEditMdAntiStacking] = useState(true);
  const [editMdNumBids, setEditMdNumBids] = useState('5');
  const [editMdNumAsks, setEditMdNumAsks] = useState('5');
  const [editMdRefreshCooldown, setEditMdRefreshCooldown] = useState('10');
  const [editMdExactPlacement, setEditMdExactPlacement] = useState(true);
  const [editMdRandomizePlacement, setEditMdRandomizePlacement] = useState(false);
  const [editMdPriceRandomizationTicks, setEditMdPriceRandomizationTicks] = useState('0');
  const [editMdMaxOpenOrders, setEditMdMaxOpenOrders] = useState('20');
  const [editMdTickSize, setEditMdTickSize] = useState('');

  // Interactive Spot Formula Calculator State
  const [calcBasePair, setCalcBasePair] = useState<'BTC' | 'ETH' | 'SOL'>('BTC');
  const [calcUsdtPrice, setCalcUsdtPrice] = useState<string>('95000');

  // CSV Import state
  const [csvRawText, setCsvRawText] = useState('');
  const [csvPreview, setCsvPreview] = useState<{ totalRows: number; validRowsCount: number; rows: any[]; errors: any[] } | null>(null);
  const [csvImportType, setCsvImportType] = useState<BotType>('ORDER_BOT');

  // Loading & Feedback
  const [isLoading, setIsLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Order Bot Form state (Exact schema from Phase 7)
  const [obName, setObName] = useState('Order Bot Alpha');
  const [obPairId, setObPairId] = useState('BTC-IDR');
  const [obPriceSource, setObPriceSource] = useState<'BEST_BID' | 'BEST_ASK' | 'MIDPOINT' | 'LAST_PRICE'>('MIDPOINT');
  const [obPriceDecimal, setObPriceDecimal] = useState('2');
  const [obQtyDecimal, setObQtyDecimal] = useState('8');
  const [obRandomMinQty, setObRandomMinQty] = useState('0.01');
  const [obRandomMaxQty, setObRandomMaxQty] = useState('0.05');
  const [obOrderCount, setObOrderCount] = useState('0'); // 0 = continuous / berjalan terus
  const [obExpireTime, setObExpireTime] = useState('0'); // 0 = GTC
  const [obTransactionType, setObTransactionType] = useState<'BUY' | 'SELL'>('BUY');
  const [obSplitMode, setObSplitMode] = useState<'NONE' | 'RANDOM_SPLIT'>('NONE');
  const [obSplitRange, setObSplitRange] = useState('3');
  const [obBuyTrailMin, setObBuyTrailMin] = useState('0.1');
  const [obBuyTrailMax, setObBuyTrailMax] = useState('0.5');
  const [obSellTrailMin, setObSellTrailMin] = useState('0.1');
  const [obSellTrailMax, setObSellTrailMax] = useState('0.5');
  const [obBuyMinPrice, setObBuyMinPrice] = useState('1300000000');
  const [obBuyMaxPrice, setObBuyMaxPrice] = useState('1600000000');
  const [obSellMinPrice, setObSellMinPrice] = useState('1300000000');
  const [obSellMaxPrice, setObSellMaxPrice] = useState('1650000000');
  const [obJitterTiming, setObJitterTiming] = useState('10');
  const [obJitterPrice, setObJitterPrice] = useState('2');

  // Volume Bot Form state (Exact schema from Phase 9)
  const [vbName, setVbName] = useState('Volume Bot Tier 1');
  const [vbPairId, setVbPairId] = useState('BTC-IDR');
  const [vbPriceDecimal, setVbPriceDecimal] = useState('2');
  const [vbQtyDecimal, setVbQtyDecimal] = useState('8');
  const [vbRandomMinQty, setVbRandomMinQty] = useState('0.02');
  const [vbRandomMaxQty, setVbRandomMaxQty] = useState('0.08');
  const [vbMinDelay, setVbMinDelay] = useState('2');
  const [vbMaxDelay, setVbMaxDelay] = useState('5');
  const [vbMinDiff, setVbMinDiff] = useState('0.01');
  const [vbMaxDiff, setVbMaxDiff] = useState('0.05');
  const [vbPriority, setVbPriority] = useState<'RANDOM' | 'HIGH' | 'NORMAL'>('RANDOM');
  const [vbMaxLimitPrice, setVbMaxLimitPrice] = useState('1550000000');
  const [vbMinLimitPrice, setVbMinLimitPrice] = useState('1400000000');
  const [vbVolIdrStop, setVbVolIdrStop] = useState('5000000000'); // 5B IDR
  const [vbVolIdrStart, setVbVolIdrStart] = useState('0');
  const [vbSellAccountId, setVbSellAccountId] = useState('');

  // Volume Spread Bot Phase 2 Form state
  const [vsbName, setVsbName] = useState('Volume Spread Phase 2');
  const [vsbPairId, setVsbPairId] = useState('BTC-IDR');
  const [vsbSpreadMode, setVsbSpreadMode] = useState<'INSIDE_SPREAD' | 'MIDPOINT_JITTER' | 'PING_PONG_EDGE'>('INSIDE_SPREAD');
  const [vsbSidePattern, setVsbSidePattern] = useState<'ALTERNATE' | 'RANDOM' | 'BUY_EATS_SELL' | 'SELL_EATS_BUY'>('ALTERNATE');
  const [vsbMinQty, setVsbMinQty] = useState('0.005');
  const [vsbMaxQty, setVsbMaxQty] = useState('0.025');
  const [vsbMinDelay, setVsbMinDelay] = useState('2');
  const [vsbMaxDelay, setVsbMaxDelay] = useState('5');
  const [vsbBandMinPct, setVsbBandMinPct] = useState('15');
  const [vsbBandMaxPct, setVsbBandMaxPct] = useState('85');
  const [vsbMinSpreadBps, setVsbMinSpreadBps] = useState('2');
  const [vsbFallbackHalfSpreadBps, setVsbFallbackHalfSpreadBps] = useState('15');
  const [vsbRequireTwoSided, setVsbRequireTwoSided] = useState(false);
  const [vsbCrossDelayMs, setVsbCrossDelayMs] = useState('150');
  const [vsbTickSize, setVsbTickSize] = useState('');
  const [vsbMinLimitPrice, setVsbMinLimitPrice] = useState('500000000');
  const [vsbMaxLimitPrice, setVsbMaxLimitPrice] = useState('2500000000');
  const [vsbVolQuoteStop, setVsbVolQuoteStop] = useState('5000000000');
  const [vsbCounterpartyAccountId, setVsbCounterpartyAccountId] = useState('');

  const selectedPair = tradingPairs.find(p => p.id === selectedPairId) || tradingPairs[0] || {
    id: 'BTC-IDR',
    baseCurrency: 'BTC',
    quoteCurrency: 'IDR',
    baseDecimals: 8,
    quoteDecimals: 2,
    lastPrice: '145000000000'
  };

  const getAuthHeaders = () => {
    const token = localStorage.getItem('dimonex_auth_token');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  const loadData = useCallback(async () => {
    if (!user) return;
    const headers = getAuthHeaders();
    const fetchOpts: RequestInit = { headers, cache: 'no-store' };
    const retryOpts = { retries: 1, retryDelayMs: 250 };
    const [ovRes, instRes, ordRes, trdRes, rskRes] = await runConcurrentTasks(
      [
        () => safeFetchJson('/api/mm/overview', fetchOpts, retryOpts),
        () => safeFetchJson(`/api/mm/instances?environment=${currentEnv}`, fetchOpts, retryOpts),
        () => safeFetchJson('/api/mm/orders', fetchOpts, retryOpts),
        () => safeFetchJson('/api/mm/trades', fetchOpts, retryOpts),
        () => safeFetchJson('/api/mm/risk-controls', fetchOpts, retryOpts),
      ],
      3
    );

    if (ovRes.ok && ovRes.data) setOverview(ovRes.data);
    if (instRes.ok && Array.isArray(instRes.data)) {
      const list = instRes.data;
      // Authoritative sync: server list is the single source of truth
      setInstances(list);
      try {
        if (list.length > 0) {
          localStorage.setItem(`dimonex_mm_instances_${currentEnv}`, JSON.stringify(list));
        } else {
          localStorage.removeItem(`dimonex_mm_instances_${currentEnv}`);
        }
      } catch {}

      if (list.length > 0) {
        // If currently selected bot is no longer in the list, switch to first available bot
        if (!selectedBotId || !list.some(b => b.id === selectedBotId)) {
          setSelectedBotId(list[0].id);
        }
      } else {
        setSelectedBotId(null);
      }
    }
    if (ordRes.ok && ordRes.data) setBotOrders(ordRes.data);
    if (trdRes.ok && trdRes.data) setBotTrades(trdRes.data);
    if (rskRes.ok && rskRes.data) setRiskControls(rskRes.data);
  }, [user, currentEnv, selectedBotId]);

  const loadThresholds = useCallback(async () => {
    if (!user) return;
    const res = await safeFetchJson<{ triggers?: PriceThresholdTrigger[]; events?: PriceThresholdEvent[] }>(
      `/api/mm/thresholds?environment=${currentEnv}`,
      { headers: getAuthHeaders(), cache: 'no-store' }
    );
    if (!res.ok || !res.data) return;
    const data = res.data;
    const triggersList: PriceThresholdTrigger[] = Array.isArray(data.triggers) ? data.triggers : [];
    const eventsList: PriceThresholdEvent[] = Array.isArray(data.events) ? data.events : [];
    setThresholdTriggers(triggersList);
    setThresholdEvents(eventsList);

    if (!thresholdInitializedRef.current) {
      eventsList.forEach(ev => seenThresholdEventIdsRef.current.add(ev.id));
      thresholdInitializedRef.current = true;
    } else {
      const freshEvents = eventsList.filter(ev => !seenThresholdEventIdsRef.current.has(ev.id));
      if (freshEvents.length > 0) {
        freshEvents.forEach(ev => seenThresholdEventIdsRef.current.add(ev.id));
        const latest = freshEvents[0];
        if (latest.soundEnabled && !thresholdSoundMuted) {
          playThresholdSound(latest.soundTone);
        }
        showToast(
          'warning',
          `[${latest.pairId}] ${latest.triggerName}: ${latest.adjustmentSummary}`
        );
      }
    }
  }, [user, currentEnv, thresholdSoundMuted, showToast]);

  useEffect(() => {
    loadData();
    loadThresholds();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      loadData();
      loadThresholds();
    }, 2500);
    return () => clearInterval(timer);
  }, [loadData, loadThresholds]);

  // Load selected bot logs
  useEffect(() => {
    if (!selectedBotId) return;
    const fetchLogs = async () => {
      const res = await safeFetchJson(`/api/mm/instance/${selectedBotId}/logs`, {
        headers: getAuthHeaders(),
        cache: 'no-store',
      });
      if (res.ok && res.data) setBotLogs(res.data);
    };
    fetchLogs();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      fetchLogs();
    }, 2000);
    return () => clearInterval(timer);
  }, [selectedBotId]);

  // Load all system & bot activity logs
  useEffect(() => {
    if (!user) return;
    const fetchAllLogs = async () => {
      const res = await safeFetchJson('/api/mm/activity-all', {
        headers: getAuthHeaders(),
        cache: 'no-store',
      });
      if (res.ok && res.data) setAllActivityLogs(res.data);
    };
    fetchAllLogs();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      fetchAllLogs();
    }, 2500);
    return () => clearInterval(timer);
  }, [user]);

  // Load external feeds, WS whitelist & FX data
  useEffect(() => {
    if (!user) return;
    const fetchFeedsAndFx = async () => {
      const fetchOpts: RequestInit = { headers: getAuthHeaders(), cache: 'no-store' };
      const [feedsRes, fxRes, wlRes] = await runConcurrentTasks(
        [
          () => safeFetchJson('/api/mm/external-feeds', fetchOpts),
          () => safeFetchJson('/api/mm/fx-rate', fetchOpts),
          () => safeFetchJson('/api/mm/external-feeds/whitelist', fetchOpts),
        ],
        3
      );
      if (feedsRes.ok && feedsRes.data) setExternalFeeds(feedsRes.data);
      if (fxRes.ok && fxRes.data) {
        const fx = fxRes.data;
        setFxData(fx);
        if (fx.currentRate?.rate && (!manualFxRate || manualFxRate === '16350')) {
          setManualFxRate(String(fx.currentRate.rate));
        }
      }
      if (wlRes.ok && wlRes.data) {
        const wl = wlRes.data;
        const items: ExternalWsWhitelistEntry[] = wl.items || [];
        setWsWhitelist(items);
        setWsFeedConnStatus({ binance: wl.binanceStatus, bybit: wl.bybitStatus });
        if (items.length > 0 && !items.some(i => i.symbol === mdLeaderSymbol)) {
          setMdLeaderSymbol(items[0].symbol);
        }
      }
    };
    fetchFeedsAndFx();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      fetchFeedsAndFx();
    }, 3000);
    return () => clearInterval(timer);
  }, [user]);

  const handleAction = async (url: string, method: string, body?: any) => {
    setIsLoading(true);
    setFeedbackMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detailsStr = Array.isArray(data.details) && data.details.length > 0
          ? `: ${data.details.join('; ')}`
          : '';
        const errMsg = (data.error || 'Operasi gagal.') + detailsStr;
        setFeedbackMsg({ type: 'error', text: errMsg });
        return null;
      }

      setFeedbackMsg({ type: 'success', text: data.message || 'Operasi berhasil dieksekusi.' });
      if (data?.bot) {
        setInstances(prev => {
          const next = [data.bot, ...prev.filter(b => b.id !== data.bot.id)];
          try { localStorage.setItem(`dimonex_mm_instances_${currentEnv}`, JSON.stringify(next)); } catch {}
          return next;
        });
      }
      loadData();
      return data;
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || 'Koneksi gagal atau terjadi kesalahan.' });
      console.warn('MMConsole Action Warning:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Bot Lifecycle Handlers
  const handleStartBot = (id: string) => handleAction(`/api/mm/instance/${id}/start`, 'POST');
  const handlePauseBot = (id: string) => handleAction(`/api/mm/instance/${id}/pause`, 'POST');
  const handleResumeBot = (id: string) => handleAction(`/api/mm/instance/${id}/resume`, 'POST');
  const handleStopBot = (id: string) => handleAction(`/api/mm/instance/${id}/stop`, 'POST', { cancelOpenOrders: true });
  const handleValidateBot = (id: string) => handleAction(`/api/mm/instance/${id}/validate`, 'POST');

  const handleOpenDeleteModal = (bot: BotInstance) => {
    setBotToDelete(bot);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDeleteBot = async () => {
    if (!botToDelete) return;
    const deletedId = botToDelete.id;
    try {
      await handleAction(`/api/mm/instance/${deletedId}/delete`, 'POST');
      setIsDeleteModalOpen(false);
      setBotToDelete(null);
      setInstances(prev => {
        const next = prev.filter(b => b.id !== deletedId);
        try {
          if (next.length > 0) {
            localStorage.setItem(`dimonex_mm_instances_${currentEnv}`, JSON.stringify(next));
          } else {
            localStorage.removeItem(`dimonex_mm_instances_${currentEnv}`);
          }
        } catch {}
        return next;
      });
      if (selectedBotId === deletedId) {
        setSelectedBotId(null);
      }
    } catch (e) {}
  };

  const handleOpenCloneModal = (bot: BotInstance) => {
    setCloneSourceBot(bot);
    setCloneNewName(`${bot.name} (Clone)`);
    if (bot.orderBotConfig) {
      setCloneTxType(bot.orderBotConfig.transaction_type === 'BUY' ? 'SELL' : 'BUY');
    } else {
      setCloneTxType('SAME');
    }
    setIsCloneModalOpen(true);
  };

  const handleConfirmClone = async () => {
    if (!cloneSourceBot) return;
    try {
      await handleAction('/api/mm/instance/clone', 'POST', {
        sourceBotId: cloneSourceBot.id,
        newName: cloneNewName,
        transaction_type: cloneSourceBot.botType === 'ORDER_BOT' && cloneTxType !== 'SAME' ? cloneTxType : undefined
      });
      setIsCloneModalOpen(false);
    } catch (e) {}
  };

  const handleOpenEditModal = (bot: BotInstance) => {
    setEditingBot(bot);
    setEditName(bot.name);
    setEditPairId(bot.pairId);
    setEditEnv(bot.environment);

    if (bot.orderBotConfig) {
      setEditObTxType(bot.orderBotConfig.transaction_type);
      setEditObPriceSource(bot.orderBotConfig.price_source);
      setEditObPriceDecimal(String(bot.orderBotConfig.price_decimal));
      setEditObQtyDecimal(String(bot.orderBotConfig.quantity_decimal));
      setEditObRandomMinQty(bot.orderBotConfig.random_min_quantity);
      setEditObRandomMaxQty(bot.orderBotConfig.random_max_quantity);
      setEditObOrderCount(String(bot.orderBotConfig.order_count));
      setEditObExpireTime(String(bot.orderBotConfig.expire_time));
      setEditObSplitMode(bot.orderBotConfig.split_order_mode);
      setEditObSplitRange(bot.orderBotConfig.split_range);
      setEditObBuyTrailMin(bot.orderBotConfig.buy_trailing_min_percentage);
      setEditObBuyTrailMax(bot.orderBotConfig.buy_trailing_max_percentage);
      setEditObSellTrailMin(bot.orderBotConfig.sell_trailing_min_percentage);
      setEditObSellTrailMax(bot.orderBotConfig.sell_trailing_max_percentage);
      setEditObBuyMinPrice(bot.orderBotConfig.buy_min_price_limit || '');
      setEditObBuyMaxPrice(bot.orderBotConfig.buy_max_price_limit || '');
      setEditObSellMinPrice(bot.orderBotConfig.sell_min_price_limit || '');
      setEditObSellMaxPrice(bot.orderBotConfig.sell_max_price_limit || '');
      setEditObJitterTiming(String(bot.orderBotConfig.jitter_timing_pct));
      setEditObJitterPrice(String(bot.orderBotConfig.jitter_price_pct));
    }

    if (bot.volumeBotConfig) {
      setEditVbPriceDecimal(String(bot.volumeBotConfig.volume_price_decimal));
      setEditVbQtyDecimal(String(bot.volumeBotConfig.volume_quantity_decimal));
      setEditVbRandomMinQty(bot.volumeBotConfig.volume_random_min_quantity);
      setEditVbRandomMaxQty(bot.volumeBotConfig.volume_random_max_quantity);
      setEditVbMinDelay(String(bot.volumeBotConfig.min_delay));
      setEditVbMaxDelay(String(bot.volumeBotConfig.max_delay));
      setEditVbMinDiff(bot.volumeBotConfig.min_difference);
      setEditVbMaxDiff(bot.volumeBotConfig.max_difference);
      setEditVbPriority(bot.volumeBotConfig.priority);
      setEditVbMaxLimitPrice(bot.volumeBotConfig.max_limit_price);
      setEditVbMinLimitPrice(bot.volumeBotConfig.min_limit_price);
      setEditVbVolIdrStop(bot.volumeBotConfig.vol_idr_stop_target);
      setEditVbVolIdrStart(bot.volumeBotConfig.vol_idr_start_threshold || '0');
      setEditVbSellAccountId(bot.volumeBotConfig.volume_sell_account_id || '');
    }

    if (bot.volumeSpreadConfig) {
      setEditVsbSpreadMode(bot.volumeSpreadConfig.spread_mode || 'INSIDE_SPREAD');
      setEditVsbSidePattern(bot.volumeSpreadConfig.side_pattern || 'ALTERNATE');
      setEditVsbMinQty(bot.volumeSpreadConfig.random_min_quantity || '0.005');
      setEditVsbMaxQty(bot.volumeSpreadConfig.random_max_quantity || '0.025');
      setEditVsbMinDelay(String(bot.volumeSpreadConfig.min_delay ?? 2));
      setEditVsbMaxDelay(String(bot.volumeSpreadConfig.max_delay ?? 5));
      setEditVsbBandMinPct(String(bot.volumeSpreadConfig.spread_band_min_pct ?? 15));
      setEditVsbBandMaxPct(String(bot.volumeSpreadConfig.spread_band_max_pct ?? 85));
      setEditVsbMinSpreadBps(String(bot.volumeSpreadConfig.min_spread_bps ?? 2));
      setEditVsbFallbackHalfSpreadBps(String(bot.volumeSpreadConfig.fallback_half_spread_bps ?? 15));
      setEditVsbRequireTwoSided(Boolean(bot.volumeSpreadConfig.require_two_sided_book));
      setEditVsbCrossDelayMs(String(bot.volumeSpreadConfig.cross_delay_ms ?? 150));
      setEditVsbTickSize(bot.volumeSpreadConfig.tick_size || '');
      setEditVsbMinLimitPrice(bot.volumeSpreadConfig.min_limit_price || '1400000000');
      setEditVsbMaxLimitPrice(bot.volumeSpreadConfig.max_limit_price || '1550000000');
      setEditVsbVolQuoteStop(bot.volumeSpreadConfig.vol_quote_stop_target || '5000000000');
      setEditVsbCounterpartyAccountId(bot.volumeSpreadConfig.counterparty_account_id || '');
    }

    if (bot.depthLiquidityConfig) {
      setEditDlPriceMode(bot.depthLiquidityConfig.price_mode || (bot.depthLiquidityConfig.min_limit_buy_price ? 'CUSTOM_BOUNDS' : 'EXTERNAL_REFERENCE'));
      setEditDlMinBuyPrice(bot.depthLiquidityConfig.min_limit_buy_price || '');
      setEditDlMaxBuyPrice(bot.depthLiquidityConfig.max_limit_buy_price || '');
      setEditDlMinSellPrice(bot.depthLiquidityConfig.min_limit_sell_price || '');
      setEditDlMaxSellPrice(bot.depthLiquidityConfig.max_limit_sell_price || '');
      setEditDlAntiStacking(bot.depthLiquidityConfig.anti_stacking_enabled !== false);
      setEditDlRefreshCooldown(String(bot.depthLiquidityConfig.liquidity_refresh_cooldown_sec || 10));
      const isExact = bot.depthLiquidityConfig.randomize_placement_enabled === false || (bot.depthLiquidityConfig.price_randomization_ticks ?? 0) === 0;
      setEditDlExactPlacement(isExact);
      setEditDlRandomizePlacement(!isExact);
      setEditDlPriceRandomizationTicks(String(bot.depthLiquidityConfig.price_randomization_ticks ?? (isExact ? 0 : 2)));
      setEditDlSpacingMode(bot.depthLiquidityConfig.spacing_mode || 'LINEAR');
      setEditDlLevelSpacingIdr(String(bot.depthLiquidityConfig.level_spacing_idr || 60));
      setEditDlNumBids(String(bot.depthLiquidityConfig.number_of_bid_levels || 5));
      setEditDlNumAsks(String(bot.depthLiquidityConfig.number_of_ask_levels || 5));
      setEditDlMaxInventory(bot.depthLiquidityConfig.maximum_inventory || '1000.0');
      setEditDlMaxTotalBidValIdr(bot.depthLiquidityConfig.maximum_total_bid_value_idr || '500000000');
      setEditDlMaxTotalAskQty(bot.depthLiquidityConfig.maximum_total_ask_quantity || '500.0');
      setEditDlMaxOpenOrders(String(bot.depthLiquidityConfig.maximum_open_orders || 20));
      setEditDlTickSize(bot.depthLiquidityConfig.tick_size ? String(bot.depthLiquidityConfig.tick_size) : '');
      setEditDlLotSize(bot.depthLiquidityConfig.lot_size || '0.0001');
    }

    if (bot.movementDepthConfig) {
      const m = bot.movementDepthConfig;
      setEditMdLeaderSymbol(m.leader_symbol || 'BTCUSDT');
      setEditMdLeaderProvider(m.leader_provider || 'AGGREGATED');
      setEditMdAnchorLocalPrice(m.anchor_local_price || '1000');
      setEditMdSensitivity(String(m.movement_sensitivity ?? 1.0));
      setEditMdThresholdBps(String(m.movement_threshold_bps ?? 10));
      setEditMdMinPriceGuard(m.min_price_guard || '');
      setEditMdMaxPriceGuard(m.max_price_guard || '');
      setEditMdSpreadBps(String(m.spread_bps ?? 20));
      setEditMdSpacingMode(m.spacing_mode || 'PERCENT_BPS');
      setEditMdLevelSpacing(String(m.level_spacing_idr || 10));
      setEditMdAntiStacking(m.anti_stacking_enabled !== false);
      setEditMdNumBids(String(m.number_of_bid_levels || 5));
      setEditMdNumAsks(String(m.number_of_ask_levels || 5));
      setEditMdRefreshCooldown(String(m.liquidity_refresh_cooldown_sec || 10));
      const isExact = m.randomize_placement_enabled === false || (m.price_randomization_ticks ?? 0) === 0;
      setEditMdExactPlacement(isExact);
      setEditMdRandomizePlacement(!isExact);
      setEditMdPriceRandomizationTicks(String(m.price_randomization_ticks ?? (isExact ? 0 : 2)));
      setEditMdMaxOpenOrders(String(m.maximum_open_orders || 20));
      setEditMdTickSize(m.tick_size ? String(m.tick_size) : '');
    }

    if (bot.quantHftConfig) {
      setEditQhftTargetSpread(String(bot.quantHftConfig.target_spread_pct || 0.08));
      setEditQhftMicroOrderSize(bot.quantHftConfig.micro_order_size || '0.001');
      setEditQhftMaxLadderLevels(String(bot.quantHftConfig.max_ladder_levels || 3));
      setEditQhftMaxBaseInventory(bot.quantHftConfig.max_base_inventory || '5.0');
      setEditQhftMaxQuoteInventory(bot.quantHftConfig.max_quote_inventory || '50000.0');
      setEditQhftTightenSpread(bot.quantHftConfig.tighten_spread_enabled !== false);
      setEditQhftTrendLeaning(bot.quantHftConfig.trend_leaning_enabled !== false);
      setEditQhftFlashDefense(bot.quantHftConfig.flash_defense_enabled !== false);
      setEditQhftRepriceInterval(String(bot.quantHftConfig.reprice_interval_ms || 1500));
    }

    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBot) return;

    const payload: any = {
      name: editName,
      pairId: editPairId,
      environment: editEnv
    };

    if (editingBot.botType === 'ORDER_BOT') {
      payload.orderBotConfig = {
        transaction_type: editObTxType,
        price_source: editObPriceSource,
        price_decimal: Number(editObPriceDecimal),
        quantity_decimal: Number(editObQtyDecimal),
        random_min_quantity: editObRandomMinQty,
        random_max_quantity: editObRandomMaxQty,
        order_count: Number(editObOrderCount),
        expire_time: Number(editObExpireTime),
        split_order_mode: editObSplitMode,
        split_range: editObSplitRange,
        buy_trailing_min_percentage: editObBuyTrailMin,
        buy_trailing_max_percentage: editObBuyTrailMax,
        sell_trailing_min_percentage: editObSellTrailMin,
        sell_trailing_max_percentage: editObSellTrailMax,
        buy_min_price_limit: editObBuyMinPrice,
        buy_max_price_limit: editObBuyMaxPrice,
        sell_min_price_limit: editObSellMinPrice,
        sell_max_price_limit: editObSellMaxPrice,
        jitter_timing_pct: Number(editObJitterTiming),
        jitter_price_pct: Number(editObJitterPrice)
      };
    } else if (editingBot.botType === 'VOLUME_BOT') {
      payload.volumeBotConfig = {
        volume_price_decimal: Number(editVbPriceDecimal),
        volume_quantity_decimal: Number(editVbQtyDecimal),
        volume_random_min_quantity: editVbRandomMinQty,
        volume_random_max_quantity: editVbRandomMaxQty,
        min_delay: Number(editVbMinDelay),
        max_delay: Number(editVbMaxDelay),
        min_difference: editVbMinDiff,
        max_difference: editVbMaxDiff,
        priority: editVbPriority,
        max_limit_price: editVbMaxLimitPrice,
        min_limit_price: editVbMinLimitPrice,
        vol_idr_stop_target: editVbVolIdrStop,
        vol_idr_start_threshold: editVbVolIdrStart,
        volume_sell_account_id: editVbSellAccountId || undefined
      };
    } else if (editingBot.botType === 'VOLUME_SPREAD_BOT') {
      payload.volumeSpreadConfig = {
        ...editingBot.volumeSpreadConfig,
        spread_mode: editVsbSpreadMode,
        side_pattern: editVsbSidePattern,
        random_min_quantity: editVsbMinQty,
        random_max_quantity: editVsbMaxQty,
        min_delay: Number(editVsbMinDelay),
        max_delay: Number(editVsbMaxDelay),
        spread_band_min_pct: Number(editVsbBandMinPct),
        spread_band_max_pct: Number(editVsbBandMaxPct),
        min_spread_bps: Number(editVsbMinSpreadBps),
        fallback_half_spread_bps: Number(editVsbFallbackHalfSpreadBps),
        require_two_sided_book: editVsbRequireTwoSided,
        cross_delay_ms: Number(editVsbCrossDelayMs),
        tick_size: editVsbTickSize || undefined,
        min_limit_price: editVsbMinLimitPrice,
        max_limit_price: editVsbMaxLimitPrice,
        vol_quote_stop_target: editVsbVolQuoteStop,
        counterparty_account_id: editVsbCounterpartyAccountId || undefined
      };
    } else if (editingBot.botType === 'DEPTH_LIQUIDITY') {
      payload.depthLiquidityConfig = {
        ...editingBot.depthLiquidityConfig,
        price_mode: editDlPriceMode,
        min_limit_buy_price: editDlMinBuyPrice,
        max_limit_buy_price: editDlMaxBuyPrice,
        min_limit_sell_price: editDlMinSellPrice,
        max_limit_sell_price: editDlMaxSellPrice,
        anti_stacking_enabled: editDlAntiStacking,
        liquidity_refresh_cooldown_sec: Math.max(3, parseInt(editDlRefreshCooldown, 10) || 10),
        randomize_placement_enabled: editDlExactPlacement ? false : editDlRandomizePlacement,
        price_randomization_ticks: editDlExactPlacement ? 0 : Math.max(1, parseInt(editDlPriceRandomizationTicks, 10) || 2),
        spacing_mode: editDlSpacingMode,
        level_spacing_idr: Math.max(1, parseInt(editDlLevelSpacingIdr, 10) || 60),
        number_of_bid_levels: Math.min(20, Math.max(1, parseInt(editDlNumBids, 10) || 5)),
        number_of_ask_levels: Math.min(20, Math.max(1, parseInt(editDlNumAsks, 10) || 5)),
        maximum_inventory: editDlMaxInventory,
        maximum_total_bid_value_idr: editDlMaxTotalBidValIdr,
        maximum_total_ask_quantity: editDlMaxTotalAskQty,
        maximum_open_orders: parseInt(editDlMaxOpenOrders, 10) || 20,
        tick_size: editDlTickSize ? parseFloat(editDlTickSize) : undefined,
        lot_size: editDlLotSize
      };
    } else if (editingBot.botType === 'MOVEMENT_DEPTH_LIQUIDITY') {
      payload.movementDepthConfig = {
        ...editingBot.movementDepthConfig,
        leader_symbol: editMdLeaderSymbol,
        leader_provider: editMdLeaderProvider,
        anchor_local_price: editMdAnchorLocalPrice,
        movement_sensitivity: parseFloat(editMdSensitivity) || 1.0,
        movement_threshold_bps: Math.max(1, parseInt(editMdThresholdBps, 10) || 10),
        min_price_guard: editMdMinPriceGuard.trim() || undefined,
        max_price_guard: editMdMaxPriceGuard.trim() || undefined,
        spread_bps: Math.max(2, parseInt(editMdSpreadBps, 10) || 20),
        spacing_mode: editMdSpacingMode,
        level_spacing_idr: parseFloat(editMdLevelSpacing) || 10,
        anti_stacking_enabled: editMdAntiStacking,
        number_of_bid_levels: Math.min(20, Math.max(1, parseInt(editMdNumBids, 10) || 5)),
        number_of_ask_levels: Math.min(20, Math.max(1, parseInt(editMdNumAsks, 10) || 5)),
        liquidity_refresh_cooldown_sec: Math.max(2, parseInt(editMdRefreshCooldown, 10) || 10),
        randomize_placement_enabled: editMdExactPlacement ? false : editMdRandomizePlacement,
        price_randomization_ticks: editMdExactPlacement ? 0 : Math.max(1, parseInt(editMdPriceRandomizationTicks, 10) || 2),
        maximum_open_orders: parseInt(editMdMaxOpenOrders, 10) || 20,
        tick_size: editMdTickSize ? parseFloat(editMdTickSize) : undefined
      };
    } else if (editingBot.botType === 'QUANT_HFT_MM') {
      payload.quantHftConfig = {
        ...editingBot.quantHftConfig,
        target_spread_pct: parseFloat(editQhftTargetSpread),
        micro_order_size: editQhftMicroOrderSize,
        max_ladder_levels: parseInt(editQhftMaxLadderLevels, 10),
        max_base_inventory: editQhftMaxBaseInventory,
        max_quote_inventory: editQhftMaxQuoteInventory,
        tighten_spread_enabled: editQhftTightenSpread,
        trend_leaning_enabled: editQhftTrendLeaning,
        flash_defense_enabled: editQhftFlashDefense,
        reprice_interval_ms: parseInt(editQhftRepriceInterval, 10)
      };
    }

    try {
      await handleAction(`/api/mm/instance/${editingBot.id}/update`, 'POST', payload);
      setIsEditModalOpen(false);
      setEditingBot(null);
    } catch (err) {}
  };

  // Create Order Bot
  const handleCreateOrderBot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await handleAction('/api/mm/order-bot/create', 'POST', {
        name: obName,
        pairId: obPairId,
        environment: currentEnv,
        price_source: obPriceSource,
        price_decimal: obPriceDecimal,
        quantity_decimal: obQtyDecimal,
        random_min_quantity: obRandomMinQty,
        random_max_quantity: obRandomMaxQty,
        order_count: obOrderCount,
        expire_time: obExpireTime,
        transaction_type: obTransactionType,
        split_order_mode: obSplitMode,
        split_range: obSplitRange,
        buy_trailing_min_percentage: obBuyTrailMin,
        buy_trailing_max_percentage: obBuyTrailMax,
        sell_trailing_min_percentage: obSellTrailMin,
        sell_trailing_max_percentage: obSellTrailMax,
        buy_min_price_limit: obBuyMinPrice,
        buy_max_price_limit: obBuyMaxPrice,
        sell_min_price_limit: obSellMinPrice,
        sell_max_price_limit: obSellMaxPrice,
        jitter_timing_pct: obJitterTiming,
        jitter_price_pct: obJitterPrice
      });
      setIsOrderBotModalOpen(false);
    } catch (e) {}
  };

  // Create Volume Bot
  const handleCreateVolumeBot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await handleAction('/api/mm/volume-bot/create', 'POST', {
        name: vbName,
        pairId: vbPairId,
        environment: currentEnv,
        volume_price_decimal: vbPriceDecimal,
        volume_quantity_decimal: vbQtyDecimal,
        volume_random_min_quantity: vbRandomMinQty,
        volume_random_max_quantity: vbRandomMaxQty,
        min_delay: vbMinDelay,
        max_delay: vbMaxDelay,
        min_difference: vbMinDiff,
        max_difference: vbMaxDiff,
        priority: vbPriority,
        max_limit_price: vbMaxLimitPrice,
        min_limit_price: vbMinLimitPrice,
        vol_idr_stop_target: vbVolIdrStop,
        vol_idr_start_threshold: vbVolIdrStart,
        volume_sell_account_id: vbSellAccountId
      });
      setIsVolumeBotModalOpen(false);
    } catch (e) {}
  };

  // Create Volume Spread Bot (Phase 2 — Inside Spread Self-Cross)
  const handleCreateVolumeSpreadBot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await handleAction('/api/mm/volume-spread-bot/create', 'POST', {
        name: vsbName,
        pairId: vsbPairId,
        environment: currentEnv,
        spread_mode: vsbSpreadMode,
        side_pattern: vsbSidePattern,
        random_min_quantity: vsbMinQty,
        random_max_quantity: vsbMaxQty,
        min_delay: vsbMinDelay,
        max_delay: vsbMaxDelay,
        spread_band_min_pct: vsbBandMinPct,
        spread_band_max_pct: vsbBandMaxPct,
        min_spread_bps: vsbMinSpreadBps,
        fallback_half_spread_bps: vsbFallbackHalfSpreadBps,
        require_two_sided_book: vsbRequireTwoSided,
        cross_delay_ms: vsbCrossDelayMs,
        tick_size: vsbTickSize || undefined,
        min_limit_price: vsbMinLimitPrice,
        max_limit_price: vsbMaxLimitPrice,
        vol_quote_stop_target: vsbVolQuoteStop,
        counterparty_account_id: vsbCounterpartyAccountId || undefined
      });
      setIsVolumeSpreadModalOpen(false);
    } catch (e) {}
  };

  // FX Rate Update Handler
  const handleUpdateFxRate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await handleAction('/api/mm/fx-rate/update', 'POST', {
        newRate: parseFloat(manualFxRate),
        notes: manualFxNotes,
        validityHours: parseInt(manualFxValidityHours, 10),
        confirmOutOfBand: manualFxConfirm
      });
      setManualFxConfirm(false);
      // Refresh FX data immediately
      const fxRes = await fetch('/api/mm/fx-rate', { headers: getAuthHeaders() });
      if (fxRes.ok) setFxData(await fxRes.json());
    } catch (e) {}
  };

  // Sync FX Rate from CoinMarketCap (with force support)
  const handleSyncCmcFx = async (force: boolean = true) => {
    try {
      await handleAction('/api/mm/fx-rate/sync-cmc', 'POST', { validityHours: 6, force });
      const fxRes = await fetch('/api/mm/fx-rate', { headers: getAuthHeaders() });
      if (fxRes.ok) setFxData(await fxRes.json());
    } catch (e) {}
  };

  // Update CoinMarketCap API sync interval & manual lock config
  const handleUpdateFxConfig = async (syncIntervalMinutes: number, isManualLocked: boolean) => {
    try {
      await handleAction('/api/mm/fx-rate/config', 'POST', {
        syncIntervalMinutes,
        isManualLocked
      });
      const fxRes = await fetch('/api/mm/fx-rate', { headers: getAuthHeaders() });
      if (fxRes.ok) setFxData(await fxRes.json());
    } catch (e) {}
  };

  // Immediate Liquidity & Price Refresh (Bypasses cooldown & triggers new random micro-jitter)
  const handleRefreshLiquidity = async (botId: string) => {
    try {
      await handleAction(`/api/mm/instance/${botId}/refresh-liquidity`, 'POST');
    } catch (e) {}
  };

  // Reconnect External Provider
  const handleReconnectProvider = async (provider?: string) => {
    await handleAction('/api/mm/external-feeds/reconnect', 'POST', { provider });
    // Refresh feeds immediately
    const feedsRes = await fetch('/api/mm/external-feeds', { headers: getAuthHeaders() });
    if (feedsRes.ok) setExternalFeeds(await feedsRes.json());
  };

  // Create Price Follower Bot
  const handleCreatePriceFollower = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await handleAction('/api/mm/price-follower/create', 'POST', {
        name: pfName,
        pairId: pfPairId,
        environment: currentEnv,
        reference_provider: pfProvider,
        target_spread_bps: parseInt(pfTargetSpreadBps, 10),
        buy_offset_bps: parseInt(pfBuyOffsetBps, 10),
        sell_offset_bps: parseInt(pfSellOffsetBps, 10),
        order_quantity: pfOrderQty,
        minimum_reprice_interval_ms: parseInt(pfRepriceInterval, 10),
        minimum_price_change_bps: parseInt(pfMinPriceChangeBps, 10),
        dry_run: pfDryRun
      });
      setIsPriceFollowerModalOpen(false);
    } catch (e) {}
  };

  const handleDlPairChange = (newPair: string) => {
    setDlPairId(newPair);
    const activePair = tradingPairs.find(p => p.id === newPair);
    const isUsdtQuote = activePair?.quoteCurrency === 'USDT' || newPair.endsWith('-USDT');

    const feedRef = fxData?.referencePrices?.[newPair]?.effectiveIdrPrice;
    const pairLastPriceRef = activePair && activePair.lastPrice
      ? Number(safeBigInt(activePair.lastPrice)) / (10 ** (activePair.quoteDecimals || (isUsdtQuote ? 4 : 2)))
      : 0;

    let basePrice = 1000;
    if (newPair === 'BTC-IDR') basePrice = 1450000000;
    else if (newPair === 'ETH-IDR') basePrice = 48500000;
    else if (newPair === 'USDT-IDR') basePrice = 16450;
    else if (newPair === 'DOGE-IDR') basePrice = 2600;
    else if (newPair === 'ADA-IDR') basePrice = 12000;
    else if (newPair === 'SOL-IDR') basePrice = 3100000;
    else if (newPair === 'TON-IDR') basePrice = 85000;
    else if (isUsdtQuote) basePrice = 1.0;
    else if (feedRef && feedRef > 0) basePrice = feedRef;
    else if (pairLastPriceRef > 0) basePrice = pairLastPriceRef;

    if (isUsdtQuote) {
      setDlName(`Depth Liquidity ${newPair} Ladder`);
      setDlMinBuyPrice((basePrice * 0.95).toFixed(4));
      setDlMaxBuyPrice((basePrice * 0.99).toFixed(4));
      setDlMinSellPrice((basePrice * 1.01).toFixed(4));
      setDlMaxSellPrice((basePrice * 1.05).toFixed(4));
      setDlLevelSpacingIdr('0.01');
      setDlBidQuantities('50.0, 100.0, 150.0, 200.0, 300.0');
      setDlAskQuantities('50.0, 100.0, 150.0, 200.0, 300.0');
      setDlRandomMinQty('20.0');
      setDlRandomMaxQty('100.0');
    } else if (newPair === 'BTC-IDR') {
      setDlName('Depth Liquidity BTC-IDR Ladder');
      setDlMinBuyPrice('1400000000');
      setDlMaxBuyPrice('1445000000');
      setDlMinSellPrice('1455000000');
      setDlMaxSellPrice('1500000000');
      setDlLevelSpacingIdr('1000000');
      setDlBidQuantities('0.02, 0.05, 0.08, 0.12, 0.20');
      setDlAskQuantities('0.02, 0.05, 0.08, 0.12, 0.20');
      setDlRandomMinQty('0.01');
      setDlRandomMaxQty('0.10');
    } else if (newPair === 'ETH-IDR') {
      setDlName('Depth Liquidity ETH-IDR Ladder');
      setDlMinBuyPrice('46000000');
      setDlMaxBuyPrice('48000000');
      setDlMinSellPrice('49000000');
      setDlMaxSellPrice('51000000');
      setDlLevelSpacingIdr('100000');
      setDlBidQuantities('0.5, 1.0, 1.5, 2.0, 3.0');
      setDlAskQuantities('0.5, 1.0, 1.5, 2.0, 3.0');
      setDlRandomMinQty('0.2');
      setDlRandomMaxQty('2.0');
    } else if (newPair === 'USDT-IDR') {
      setDlName('Depth Liquidity USDT-IDR Ladder');
      setDlMinBuyPrice('16200');
      setDlMaxBuyPrice('16400');
      setDlMinSellPrice('16500');
      setDlMaxSellPrice('16700');
      setDlLevelSpacingIdr('60');
      setDlBidQuantities('25.0, 50.0, 75.0, 100.0, 150.0');
      setDlAskQuantities('25.0, 50.0, 75.0, 100.0, 150.0');
      setDlRandomMinQty('10.0');
      setDlRandomMaxQty('50.0');
    } else if (newPair === 'DOGE-IDR') {
      setDlName('Depth Liquidity DOGE-IDR Ladder');
      setDlMinBuyPrice('2400');
      setDlMaxBuyPrice('2580');
      setDlMinSellPrice('2620');
      setDlMaxSellPrice('2800');
      setDlLevelSpacingIdr('10');
      setDlBidQuantities('1000.0, 2000.0, 3000.0, 4000.0, 5000.0');
      setDlAskQuantities('1000.0, 2000.0, 3000.0, 4000.0, 5000.0');
      setDlRandomMinQty('500.0');
      setDlRandomMaxQty('2500.0');
    } else if (newPair === 'ADA-IDR') {
      setDlName('Depth Liquidity ADA-IDR Ladder');
      setDlMinBuyPrice('11200');
      setDlMaxBuyPrice('11850');
      setDlMinSellPrice('12150');
      setDlMaxSellPrice('12800');
      setDlLevelSpacingIdr('50');
      setDlBidQuantities('100.0, 250.0, 500.0, 750.0, 1000.0');
      setDlAskQuantities('100.0, 250.0, 500.0, 750.0, 1000.0');
      setDlRandomMinQty('50.0');
      setDlRandomMaxQty('500.0');
    } else {
      setDlName(`Depth Liquidity ${newPair} Ladder`);
      setDlMinBuyPrice(String(Math.round(basePrice * 0.95)));
      setDlMaxBuyPrice(String(Math.round(basePrice * 0.99)));
      setDlMinSellPrice(String(Math.round(basePrice * 1.01)));
      setDlMaxSellPrice(String(Math.round(basePrice * 1.05)));
      setDlLevelSpacingIdr(String(Math.max(1, Math.round(basePrice * 0.01))));
    }
  };

  // Create Depth Liquidity Bot
  const handleCreateDepthLiquidity = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const bidOffsets = dlBidOffsets.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      const askOffsets = dlAskOffsets.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      const bidQtys = dlBidQuantities.split(',').map(s => s.trim()).filter(Boolean);
      const askQtys = dlAskQuantities.split(',').map(s => s.trim()).filter(Boolean);
      const defaultPairSpacing = dlPairId === 'BTC-IDR' ? 1000000 : dlPairId === 'ETH-IDR' ? 100000 : 60;

      await handleAction('/api/mm/depth-liquidity/create', 'POST', {
        name: dlName,
        pairId: dlPairId,
        environment: currentEnv,
        price_mode: dlPriceMode,
        min_limit_buy_price: dlMinBuyPrice,
        max_limit_buy_price: dlMaxBuyPrice,
        min_limit_sell_price: dlMinSellPrice,
        max_limit_sell_price: dlMaxSellPrice,
        anti_stacking_enabled: dlAntiStacking,
        reference_price_source: dlPriceMode === 'CUSTOM_BOUNDS' ? 'NONE' : dlSource,
        spacing_mode: dlSpacingMode,
        level_spacing_idr: parseInt(dlLevelSpacingIdr, 10) || defaultPairSpacing,
        number_of_bid_levels: parseInt(dlNumBids, 10),
        number_of_ask_levels: parseInt(dlNumAsks, 10),
        bid_level_offsets_bps: bidOffsets,
        ask_level_offsets_bps: askOffsets,
        bid_quantities: bidQtys,
        ask_quantities: askQtys,
        quantity_randomization_enabled: dlExactPlacement ? false : dlRandomizeQty,
        random_min_quantity: dlRandomMinQty,
        random_max_quantity: dlRandomMaxQty,
        minimum_reprice_interval_ms: parseInt(dlRepriceInterval, 10),
        dry_run: dlDryRun,
        liquidity_refresh_cooldown_sec: Math.max(3, parseInt(dlRefreshCooldownSec, 10) || 10),
        randomize_placement_enabled: dlExactPlacement ? false : dlRandomizePlacement,
        price_randomization_ticks: dlExactPlacement ? 0 : Math.max(1, parseInt(dlPriceRandomizationTicks, 10) || 2),
        maximum_inventory: dlMaxInventory,
        maximum_total_bid_value_idr: dlMaxTotalBidValIdr,
        maximum_total_ask_quantity: dlMaxTotalAskQty,
        maximum_open_orders: parseInt(dlMaxOpenOrders, 10) || 20,
        tick_size: dlTickSize ? parseFloat(dlTickSize) : undefined,
        lot_size: dlLotSize
      });
      setIsDepthLiquidityModalOpen(false);
    } catch (e) {}
  };

  const handleMdPairChange = (newPair: string) => {
    setMdPairId(newPair);
    const activePair = tradingPairs.find(p => p.id === newPair);
    const isUsdtQuote = activePair?.quoteCurrency === 'USDT' || newPair.endsWith('-USDT');
    const pairLastFloat = activePair && activePair.lastPrice
      ? Number(safeBigInt(activePair.lastPrice)) / (10 ** (activePair.quoteDecimals || (isUsdtQuote ? 4 : 2)))
      : 0;

    setMdName(`Depth Movement ${newPair} <- ${mdLeaderSymbol}`);
    if (pairLastFloat > 0) {
      setMdAnchorLocalPrice(isUsdtQuote ? pairLastFloat.toFixed(pairLastFloat < 1 ? 5 : 4) : String(Math.round(pairLastFloat)));
      setMdLevelSpacing(isUsdtQuote ? (pairLastFloat < 1 ? '0.001' : '0.01') : String(Math.max(1, Math.round(pairLastFloat * 0.005))));
    } else if (isUsdtQuote) {
      setMdAnchorLocalPrice('0.05');
      setMdLevelSpacing('0.0005');
    } else {
      setMdAnchorLocalPrice('1000');
      setMdLevelSpacing('10');
    }
  };

  const handleResetAnchor = async (botId: string) => {
    try {
      await handleAction(`/api/mm/instance/${botId}/reset-anchor`, 'POST', {});
    } catch (e) {}
  };

  const handleCreateMovementDepth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const bidOffsets = mdBidOffsets.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      const askOffsets = mdAskOffsets.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      const bidQtys = mdBidQuantities.split(',').map(s => s.trim()).filter(Boolean);
      const askQtys = mdAskQuantities.split(',').map(s => s.trim()).filter(Boolean);

      const res = await handleAction('/api/mm/movement-depth/create', 'POST', {
        name: mdName,
        pairId: mdPairId,
        environment: currentEnv,
        leader_symbol: mdLeaderSymbol,
        leader_provider: mdLeaderProvider,
        anchor_local_price: mdAnchorLocalPrice,
        movement_sensitivity: parseFloat(mdSensitivity) || 1.0,
        movement_threshold_bps: Math.max(1, parseInt(mdThresholdBps, 10) || 10),
        min_price_guard: mdMinPriceGuard.trim() || undefined,
        max_price_guard: mdMaxPriceGuard.trim() || undefined,
        spread_bps: Math.max(2, parseInt(mdSpreadBps, 10) || 20),
        spacing_mode: mdSpacingMode,
        level_spacing_idr: parseFloat(mdLevelSpacing) || 10,
        anti_stacking_enabled: mdAntiStacking,
        number_of_bid_levels: Math.min(20, Math.max(1, parseInt(mdNumBids, 10) || 5)),
        number_of_ask_levels: Math.min(20, Math.max(1, parseInt(mdNumAsks, 10) || 5)),
        bid_level_offsets_bps: bidOffsets,
        ask_level_offsets_bps: askOffsets,
        bid_quantities: bidQtys,
        ask_quantities: askQtys,
        quantity_randomization_enabled: mdExactPlacement ? false : mdRandomizeQty,
        random_min_quantity: mdRandomMinQty,
        random_max_quantity: mdRandomMaxQty,
        minimum_reprice_interval_ms: parseInt(mdRepriceInterval, 10) || 3000,
        dry_run: mdDryRun,
        liquidity_refresh_cooldown_sec: Math.max(2, parseInt(mdRefreshCooldownSec, 10) || 10),
        randomize_placement_enabled: mdExactPlacement ? false : mdRandomizePlacement,
        price_randomization_ticks: mdExactPlacement ? 0 : Math.max(1, parseInt(mdPriceRandomizationTicks, 10) || 2),
        maximum_inventory: mdMaxInventory,
        maximum_total_bid_value_idr: mdMaxTotalBidValIdr,
        maximum_total_ask_quantity: mdMaxTotalAskQty,
        maximum_open_orders: parseInt(mdMaxOpenOrders, 10) || 20,
        tick_size: mdTickSize ? parseFloat(mdTickSize) : undefined,
        lot_size: mdLotSize
      });
      if (res) {
        setIsMovementDepthModalOpen(false);
        setActiveTab('MOVEMENT_DEPTH');
      }
    } catch (e) {}
  };

  const handleQhftPairChange = (newPair: string) => {
    setQhftPairId(newPair);
    if (newPair === 'BTC-USDT' || newPair === 'BTC-IDR') {
      setQhftName(`Quant HFT MM BTC`);
      setQhftMicroOrderSize('0.001');
      setQhftMaxBaseInventory('5.0');
      setQhftMaxQuoteInventory('50000.0');
    } else if (newPair === 'ETH-USDT' || newPair === 'ETH-IDR') {
      setQhftName(`Quant HFT MM ETH`);
      setQhftMicroOrderSize('0.02');
      setQhftMaxBaseInventory('20.0');
      setQhftMaxQuoteInventory('50000.0');
    } else if (newPair === 'USDT-IDR') {
      setQhftName(`Quant HFT MM USDT-IDR`);
      setQhftMicroOrderSize('10.0');
      setQhftMaxBaseInventory('5000.0');
      setQhftMaxQuoteInventory('100000000');
    } else if (newPair === 'DOGE-IDR' || newPair === 'DOGE-USDT') {
      setQhftName(`Quant HFT MM DOGE`);
      setQhftMicroOrderSize('50.0');
      setQhftMaxBaseInventory('50000.0');
      setQhftMaxQuoteInventory('10000.0');
    } else {
      setQhftName(`Quant HFT MM ${newPair}`);
      setQhftMicroOrderSize('1.0');
      setQhftMaxBaseInventory('1000.0');
      setQhftMaxQuoteInventory('10000.0');
    }
  };

  const handleCreateQuantHft = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await handleAction('/api/mm/quant-hft/create', 'POST', {
        name: qhftName,
        pairId: qhftPairId,
        environment: currentEnv,
        target_spread_pct: parseFloat(qhftTargetSpreadPct),
        min_spread_pct: parseFloat(qhftMinSpreadPct),
        max_spread_pct: parseFloat(qhftMaxSpreadPct),
        micro_order_size: qhftMicroOrderSize,
        max_ladder_levels: parseInt(qhftMaxLadderLevels, 10),
        max_base_inventory: qhftMaxBaseInventory,
        max_quote_inventory: qhftMaxQuoteInventory,
        inventory_skew_factor: parseFloat(qhftInventorySkewFactor),
        volatility_threshold_bps: parseFloat(qhftVolatilityThresholdBps),
        pump_dump_multiplier: parseFloat(qhftPumpDumpMultiplier),
        defense_perimeter_multiplier: parseFloat(qhftDefensePerimeterMultiplier),
        tighten_spread_enabled: qhftTightenSpreadEnabled,
        trend_leaning_enabled: qhftTrendLeaningEnabled,
        flash_defense_enabled: qhftFlashDefenseEnabled,
        reprice_interval_ms: parseInt(qhftRepriceIntervalMs, 10)
      });
      setIsQuantHftModalOpen(false);
    } catch (e) {}
  };

  // CSV Preview & Confirm
  const handleCsvPreview = async () => {
    try {
      const data = await handleAction('/api/mm/csv/import-preview', 'POST', {
        csvContent: csvRawText,
        botType: csvImportType
      });
      setCsvPreview(data);
    } catch (e) {}
  };

  const handleCsvConfirm = async () => {
    if (!csvPreview || csvPreview.validRowsCount === 0) return;
    try {
      await handleAction('/api/mm/csv/import-confirm', 'POST', {
        rows: csvPreview.rows.filter(r => r.isValid),
        defaultBotType: csvImportType,
        defaultEnvironment: currentEnv
      });
      setIsCsvImportModalOpen(false);
      setCsvPreview(null);
      setCsvRawText('');
    } catch (e) {}
  };

  const handleExportCsv = async (botType: 'ORDER_BOT' | 'VOLUME_BOT') => {
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch(`/api/mm/csv/export?botType=${botType}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFeedbackMsg({ type: 'error', text: err.error || 'Gagal mengekspor konfigurasi CSV.' });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `dimonex_${botType.toLowerCase()}_export.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setFeedbackMsg({ type: 'success', text: `Ekspor CSV ${botType} selesai diunduh.` });
    } catch (e: any) {
      setFeedbackMsg({ type: 'error', text: e?.message || 'Gagal mengekspor CSV.' });
    }
  };

  const handleKillSwitch = () => {
    setIsKillSwitchConfirmOpen(true);
  };

  const handleResetKillSwitch = async () => {
    try {
      await handleAction('/api/mm/kill-switch/reset', 'POST');
    } catch (e) {}
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-[#141C24] border border-[#202B34] rounded-[10px] text-center">
        <div className="w-11 h-11 rounded-[10px] bg-[#1D2832] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1] mb-4">
          <Lock className="w-5 h-5" />
        </div>
        <h2 className="text-lg font-semibold text-[#E4EBEF] mb-2">Market Maker Console Memerlukan Login</h2>
        <p className="text-sm text-[#A1AFB8] max-w-md mb-6">
          Akses MM Console dibatasi untuk peran Market Maker (MM) dan Administrator bursa dengan otorisasi khusus.
        </p>
        <Button variant="primary" size="md" onClick={onOpenAuthModal}>
          Masuk ke Akun MM
        </Button>
      </div>
    );
  }

  const selectedBot = instances.find(b => b.id === selectedBotId) || instances[0];

  const navTabs: { id: MMTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'OVERVIEW', label: 'Overview', icon: Layers },
    { id: 'PERFORMANCE', label: 'Dasbor Kinerja (D3)', icon: TrendingUp },
    { id: 'HFT_TELEMETRY', label: 'HFT Telemetry', icon: Activity },
    { id: 'PORTFOLIO_REBALANCE', label: 'Rebalancing', icon: Scale },
    { id: 'ADVANCED_MM', label: 'Advanced MM', icon: ShieldCheck },
    { id: 'SMART_HFT_LADDER', label: 'Smart HFT Ladder', icon: Sliders },
    { id: 'HFT_BACKTEST', label: 'Backtest Engine', icon: FlaskConical },
    { id: 'PRICE_THRESHOLDS', label: 'Price Thresholds', icon: BellRing },
    { id: 'QUANT_HFT_MM', label: 'Quant HFT MM', icon: Zap },
    { id: 'DEPTH_LIQUIDITY', label: 'Depth & Liquidity', icon: BarChart3 },
    { id: 'MOVEMENT_DEPTH', label: 'Depth Movement (WS)', icon: Radio },
    { id: 'PRICE_FOLLOWER', label: 'Price Follower', icon: Crosshair },
    { id: 'EXTERNAL_FEEDS', label: 'External Feeds', icon: Globe },
    { id: 'FX_RATES', label: 'USDT/IDR FX Engine', icon: DollarSign },
    { id: 'ORDER_BOTS', label: 'Order Bots', icon: Bot },
    { id: 'VOLUME_BOTS', label: 'Volume & Test Bots', icon: Cpu },
    { id: 'INTERNAL_SPREAD', label: 'Internal Spread', icon: Flame },
    { id: 'CONFIGURATIONS', label: 'Configurations', icon: Sliders },
    { id: 'BOT_ACCOUNTS', label: 'Bot Accounts', icon: ShieldCheck },
    { id: 'ORDERS', label: 'Orders', icon: Layers },
    { id: 'EXECUTED_TRADES', label: 'Executed Trades', icon: CheckCircle2 },
    { id: 'ACTIVITY_LOGS', label: 'Activity Logs', icon: Activity },
    { id: 'RISK_CONTROLS', label: 'Risk Controls', icon: ShieldAlert },
    { id: 'SETTINGS', label: 'Settings', icon: Settings }
  ];

  return (
    <div className="flex flex-col gap-5 w-full">
      {/* Top Console Header & Environment Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-[#141C24] border border-[#202B34] rounded-[10px]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[7px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1] shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-[#E4EBEF] tracking-tight">Market Maker & Algorithmic Bot Console</h1>
            <p className="text-xs text-[#A1AFB8]">
              Operasional likuiditas real-time terhubung langsung ke mesin matching engine internal DIMONEX.
            </p>
          </div>
        </div>

        {/* Environment Badge & Switcher */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-[#111820] p-1 rounded-[7px] border border-[#202B34]">
            {(['DEMO', 'STAGING', 'PRODUCTION'] as const).map(env => (
              <button
                key={env}
                type="button"
                onClick={() => setCurrentEnv(env)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-[5px] transition-colors cursor-pointer ${
                  currentEnv === env
                    ? env === 'PRODUCTION'
                      ? 'bg-[#401F27] text-[#EA5B65] border border-[#EA5B65]/40'
                      : env === 'STAGING'
                      ? 'bg-[#2C2415] text-[#D6A85C] border border-[#D6A85C]/40'
                      : 'bg-[#12392F] text-[#35B887] border border-[#16A879]/40'
                    : 'text-[#71818B] hover:text-[#E4EBEF]'
                }`}
              >
                {env === 'DEMO' ? 'DEMO / SANDBOX' : env}
              </button>
            ))}
          </div>

          {riskControls?.isKillSwitchActive ? (
            <Button variant="profit" size="sm" onClick={handleResetKillSwitch} icon={<CheckCircle2 className="w-3.5 h-3.5" />}>
              Reset Kill-Switch
            </Button>
          ) : (
            <Button
              variant="danger"
              size="sm"
              onClick={handleKillSwitch}
              title="Emergency Kill-Switch: Halt all bots and purge open orders"
              icon={<ShieldAlert className="w-3.5 h-3.5" />}
            >
              Kill-Switch
            </Button>
          )}
        </div>
      </div>

      {/* REAL-TIME METRICS SUMMARY & EMERGENCY KILL-SWITCH BAR */}
      <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-[#202B34]">
          <div className="flex items-center gap-2.5">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                (overview?.activeBots ?? 0) > 0 ? 'bg-[#16A879]' : 'bg-[#71818B]'
              }`}
            />
            <span className="text-xs font-semibold text-[#E4EBEF] tracking-wide uppercase">
              Ringkasan Metrik Real-Time Market Maker ({currentEnv})
            </span>
            <StatusBadge tone="info">Live Engine Stream</StatusBadge>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {riskControls?.isKillSwitchActive ? (
              <StatusBadge tone="danger" dot>EMERGENCY KILL-SWITCH AKTIF</StatusBadge>
            ) : (
              <StatusBadge tone="success" dot>Sistem Operasional Normal</StatusBadge>
            )}
          </div>
        </div>

        {/* 3 Metrik Utama + Tombol Kill-Switch */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 bg-[#111820] border border-[#202B34] rounded-[10px] flex flex-col justify-between hover:border-[#2B3944] transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[#A1AFB8]">Jumlah Bot Aktif</span>
              <StatusBadge tone={(overview?.activeBots ?? 0) > 0 ? 'success' : 'neutral'}>
                {overview?.activeBots ?? 0} RUNNING
              </StatusBadge>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold font-mono tabular-nums text-[#35B887]">
                {overview?.activeBots ?? 0}
              </span>
              <span className="text-xs font-mono tabular-nums text-[#71818B]">
                / {overview?.totalBots ?? instances.length} terdaftar
              </span>
            </div>
            <span className="text-[11px] text-[#71818B] mt-1.5 block font-mono">
              Smart HFT: {instances.filter(b => b.botType === 'SMART_HFT_LADDER' && b.status === 'RUNNING').length} · Quant HFT: {instances.filter(b => b.botType === 'QUANT_HFT_MM' && b.status === 'RUNNING').length} · Depth: {instances.filter(b => b.botType === 'DEPTH_LIQUIDITY' && b.status === 'RUNNING').length} · WS Move: {instances.filter(b => b.botType === 'MOVEMENT_DEPTH_LIQUIDITY' && b.status === 'RUNNING').length} · Order: {instances.filter(b => b.botType === 'ORDER_BOT' && b.status === 'RUNNING').length} · Vol P1: {instances.filter(b => b.botType === 'VOLUME_BOT' && b.status === 'RUNNING').length} · Vol P2: {instances.filter(b => b.botType === 'VOLUME_SPREAD_BOT' && b.status === 'RUNNING').length}
            </span>
          </div>

          <div className="p-3.5 bg-[#111820] border border-[#202B34] rounded-[10px] flex flex-col justify-between hover:border-[#2B3944] transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[#A1AFB8]">Total Order Ditempatkan</span>
              <StatusBadge tone="info">{overview?.ordersFilled ?? 0} filled</StatusBadge>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold font-mono tabular-nums text-[#E4EBEF]">
                {(overview?.ordersSubmitted ?? 0).toLocaleString('id-ID')}
              </span>
              <span className="text-xs font-mono text-[#71818B]">orders</span>
            </div>
            <span className="text-[11px] text-[#71818B] mt-1.5 block font-mono tabular-nums">
              Fill Rate: {overview?.ordersSubmitted ? Math.round(((overview.ordersFilled || 0) / overview.ordersSubmitted) * 100) : 0}% ({overview?.totalTrades ?? 0} trades executed)
            </span>
          </div>

          <div className="p-3.5 bg-[#111820] border border-[#202B34] rounded-[10px] flex flex-col justify-between hover:border-[#2B3944] transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-[#A1AFB8]">Volume 24 Jam Khusus Bot</span>
              <StatusBadge tone="warning">{overview?.bot24hTradesCount ?? 0} trades / 24j</StatusBadge>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-semibold font-mono tabular-nums text-[#D6A85C] truncate">
                {overview?.bot24hVolumeFormattedIdr || 'Rp 0'}
              </span>
            </div>
            <span className="text-[11px] text-[#71818B] mt-1.5 block">
              Dihasilkan murni dari transaksi pasar internal bot
            </span>
          </div>

          <div
            className={`p-3.5 rounded-[10px] border flex flex-col justify-between transition-colors ${
              riskControls?.isKillSwitchActive
                ? 'bg-[#401F27]/50 border-[#EA5B65]/60'
                : 'bg-[#111820] border-[#EA5B65]/30 hover:border-[#EA5B65]/60'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-[#EA5B65] flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Tombol Kill-Switch</span>
              </span>
              <StatusBadge tone="danger">
                {riskControls?.isKillSwitchActive ? 'HALTED' : 'ARMED'}
              </StatusBadge>
            </div>
            <div className="my-1.5">
              {riskControls?.isKillSwitchActive ? (
                <Button
                  type="button"
                  variant="profit"
                  size="sm"
                  className="w-full"
                  onClick={handleResetKillSwitch}
                  disabled={isLoading}
                  icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                >
                  Reset &amp; Pulihkan Bot
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  className="w-full"
                  onClick={handleKillSwitch}
                  disabled={isLoading}
                  icon={<Square className="w-3.5 h-3.5" />}
                >
                  STOP SEMUA BOT (KILL-SWITCH)
                </Button>
              )}
            </div>
            <span className="text-[11px] text-[#A1AFB8] block truncate">
              {riskControls?.isKillSwitchActive
                ? 'Semua order ditarik & worker dinonaktifkan.'
                : 'Hentikan seketika & batalkan seluruh order aktif.'}
            </span>
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackMsg && (
        <div
          className={`p-3 rounded-[7px] text-xs font-medium border flex items-center justify-between ${
            feedbackMsg.type === 'success'
              ? 'bg-[#12392F]/60 text-[#35B887] border-[#16A879]/40'
              : 'bg-[#401F27]/60 text-[#EA5B65] border-[#EA5B65]/40'
          }`}
        >
          <span>{feedbackMsg.text}</span>
          <button type="button" onClick={() => setFeedbackMsg(null)} className="text-[#A1AFB8] hover:text-[#E4EBEF] p-1 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-[#202B34]">
        {navTabs.map(t => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2 text-xs font-medium rounded-t-[7px] transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                active
                  ? 'bg-[#17212B] text-[#E4EBEF] border-b-2 border-[#8DA5B1] font-semibold'
                  : 'text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#111820]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#8DA5B1]' : 'text-[#71818B]'}`} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'OVERVIEW' && (
        <div className="flex flex-col gap-5">
          {/* KPI Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-4 bg-[#141C24] border border-[#202B34] rounded-[10px]">
              <span className="text-xs text-[#A1AFB8] block mb-1">Active Bots ({currentEnv})</span>
              <span className="text-2xl font-semibold font-mono tabular-nums text-[#35B887]">
                {overview?.activeBots ?? 0} <span className="text-xs text-[#71818B] font-normal">/ {overview?.totalBots ?? 0} total</span>
              </span>
            </div>
            <div className="p-4 bg-[#141C24] border border-[#202B34] rounded-[10px]">
              <span className="text-xs text-[#A1AFB8] block mb-1">Orders Submitted</span>
              <span className="text-2xl font-semibold font-mono tabular-nums text-[#E4EBEF]">
                {(overview?.ordersSubmitted ?? 0).toLocaleString('id-ID')}
              </span>
            </div>
            <div className="p-4 bg-[#141C24] border border-[#202B34] rounded-[10px]">
              <span className="text-xs text-[#A1AFB8] block mb-1">Orders Filled</span>
              <span className="text-2xl font-semibold font-mono tabular-nums text-[#6D9FE8]">
                {(overview?.ordersFilled ?? 0).toLocaleString('id-ID')}
              </span>
            </div>
            <div className="p-4 bg-[#141C24] border border-[#202B34] rounded-[10px]">
              <span className="text-xs text-[#A1AFB8] block mb-1">Trades Generated</span>
              <span className="text-2xl font-semibold font-mono tabular-nums text-[#D6A85C]">
                {(overview?.totalTrades ?? 0).toLocaleString('id-ID')}
              </span>
            </div>
          </div>

          {/* Quick Action Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-[#141C24] border border-[#202B34] rounded-[10px]">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="profit" size="sm" onClick={() => setActiveTab('SMART_HFT_LADDER')} icon={<Sliders className="w-3.5 h-3.5" />}>
                Smart HFT Ladder
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setActiveTab('HFT_BACKTEST')} icon={<FlaskConical className="w-3.5 h-3.5" />}>
                Ledger Backtest
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setActiveTab('PRICE_THRESHOLDS')} icon={<BellRing className="w-3.5 h-3.5" />}>
                Price Thresholds ({thresholdTriggers.filter(t => t.enabled).length})
              </Button>
              <Button variant="primary" size="sm" onClick={() => setIsOrderBotModalOpen(true)}>
                + Order Bot
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setIsVolumeBotModalOpen(true)}>
                + Volume Bot
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setIsVolumeSpreadModalOpen(true)}>
                + Spread Volume Bot (P2)
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setActiveTab('INTERNAL_SPREAD')} icon={<Flame className="w-3.5 h-3.5" />}>
                Internal Spread (Self-Eating)
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setIsPriceFollowerModalOpen(true)}>
                + Price Follower
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setIsDepthLiquidityModalOpen(true)}>
                + Depth &amp; Liquidity
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setIsMovementDepthModalOpen(true)}>
                + Depth Movement (WS)
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsCsvImportModalOpen(true)}>
                CSV Import
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleExportCsv('ORDER_BOT')}>
                Export Order CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleExportCsv('VOLUME_BOT')}>
                Export Volume CSV
              </Button>
            </div>
          </div>

          {/* Active Bot Instances Table */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#202B34] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#E4EBEF]">Bot Instances ({currentEnv})</h3>
              <span className="text-xs font-mono text-[#A1AFB8]">Total: {instances.length} bots</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111820] text-[#71818B] uppercase font-mono text-[11px] border-b border-[#202B34]">
                  <tr>
                    <th className="py-2.5 px-4">Bot ID / Name</th>
                    <th className="py-2.5 px-4">Type</th>
                    <th className="py-2.5 px-4">Pair</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Orders (Sub / Fill)</th>
                    <th className="py-2.5 px-4">Last Heartbeat</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34] text-[#A1AFB8] font-mono tabular-nums">
                  {instances.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-[#71818B] font-sans">
                        Belum ada bot instance yang dibuat di environment {currentEnv}.
                      </td>
                    </tr>
                  ) : (
                    instances.map(b => (
                      <tr key={b.id} className="hover:bg-[#17212B] transition-colors">
                        <td className="py-3 px-4 font-sans">
                          <strong className="text-[#E4EBEF] block">{b.name}</strong>
                          <span className="text-[11px] text-[#71818B] font-mono">{b.id}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-xs font-semibold text-[#8DA5B1]">{b.botType}</span>
                        </td>
                        <td className="py-3 px-4 font-bold text-[#E4EBEF]">{b.pairId}</td>
                        <td className="py-3 px-4">
                          <StatusBadge
                            tone={
                              b.status === 'RUNNING'
                                ? 'success'
                                : b.status === 'PAUSED'
                                ? 'warning'
                                : b.status === 'ERROR' || b.status === 'RISK_HALTED'
                                ? 'danger'
                                : 'neutral'
                            }
                          >
                            {b.status}
                          </StatusBadge>
                        </td>
                        <td className="py-3 px-4">
                          {b.stats.ordersSubmitted} / <span className="text-[#35B887]">{b.stats.ordersFilled}</span>
                        </td>
                        <td className="py-3 px-4 text-[#A1AFB8] text-[11px]">
                          {formatDateTime(b.lastHeartbeat)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5 font-sans">
                            {b.status === 'RUNNING' ? (
                              <>
                                <Button variant="outline" size="sm" onClick={() => handlePauseBot(b.id)}>
                                  Pause
                                </Button>
                                <Button variant="danger" size="sm" onClick={() => handleStopBot(b.id)}>
                                  Stop
                                </Button>
                              </>
                            ) : b.status === 'PAUSED' ? (
                              <>
                                <Button variant="profit" size="sm" onClick={() => handleResumeBot(b.id)}>
                                  Resume
                                </Button>
                                <Button variant="danger" size="sm" onClick={() => handleStopBot(b.id)}>
                                  Stop
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button variant="outline" size="sm" onClick={() => handleValidateBot(b.id)}>
                                  Validate
                                </Button>
                                <Button variant="profit" size="sm" onClick={() => handleStartBot(b.id)}>
                                  Start
                                </Button>
                              </>
                            )}
                            <Button variant="secondary" size="sm" onClick={() => handleOpenEditModal(b)} title="Edit Bot Configuration">
                              Edit
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => handleOpenCloneModal(b)} title="Clone Bot">
                              Clone
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setSelectedBotId(b.id)}>
                              Logs
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleOpenDeleteModal(b)}
                              title="Hapus Bot Permanen & Batalkan Seluruh Order Terbuka"
                            >
                              Hapus
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: EXTERNAL FEEDS */}
      {activeTab === 'EXTERNAL_FEEDS' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Public External Price Feeds (Binance & Bybit)
              </h2>
              <p className="text-xs text-[#A1AFB8]">
                Integrasi WebSocket publik langsung ke Binance Spot dan Bybit Spot v5 API untuk referensi harga trading.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleReconnectProvider()}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-[7px] shadow transition-colors flex items-center gap-1.5"
              >
                Reconnect All Feeds
              </button>
            </div>
          </div>

          {/* Provider Status Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Binance Card */}
            <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5 shadow-lg flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-[#202B34] mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-amber-400"></span>
                    <h3 className="text-sm font-bold text-white">Binance Spot Public Stream</h3>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    externalFeeds?.binance?.status === 'CONNECTED'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}>
                    {externalFeeds?.binance?.status || 'CONNECTING'}
                  </span>
                </div>

                <div className="space-y-2.5 text-xs font-mono">
                  <div className="flex justify-between text-[#A1AFB8]">
                    <span>Endpoint:</span>
                    <span className="text-[#E4EBEF] truncate max-w-[240px]">wss://stream.binance.com:9443/ws</span>
                  </div>
                  <div className="flex justify-between text-[#A1AFB8]">
                    <span>Latency:</span>
                    <span className="text-emerald-400 font-bold">{externalFeeds?.binance?.metrics?.avgLatencyMs || 12} ms</span>
                  </div>
                  <div className="flex justify-between text-[#A1AFB8]">
                    <span>Messages Received:</span>
                    <span className="text-white">{externalFeeds?.binance?.metrics?.messagesReceived?.toLocaleString() || 0}</span>
                  </div>
                  <div className="flex justify-between text-[#A1AFB8]">
                    <span>Reconnect Count:</span>
                    <span className="text-[#E4EBEF]">{externalFeeds?.binance?.metrics?.reconnectCount || 0}</span>
                  </div>
                  <div className="pt-2 border-t border-[#202B34] space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-[#A1AFB8]">BTC/USDT:</span>
                      <span className="text-base font-bold text-white">
                        ${externalFeeds?.binance?.btcTick?.lastPrice ? externalFeeds.binance.btcTick.lastPrice.toLocaleString() : '94,850.00'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#A1AFB8]">ETH/USDT:</span>
                      <span className="text-base font-bold text-white">
                        ${externalFeeds?.binance?.ethTick?.lastPrice ? externalFeeds.binance.ethTick.lastPrice.toLocaleString() : '2,840.00'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-[#202B34]">
                <button
                  onClick={() => handleReconnectProvider('binance')}
                  className="w-full py-1.5 bg-[#17212B] hover:bg-[#1D2832] text-[#E4EBEF] text-xs font-semibold rounded-[7px] transition-colors"
                >
                  Reconnect Binance Stream
                </button>
              </div>
            </div>

            {/* Bybit Card */}
            <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5 shadow-lg flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-[#202B34] mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-orange-400"></span>
                    <h3 className="text-sm font-bold text-white">Bybit Spot Public Stream (v5)</h3>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    externalFeeds?.bybit?.status === 'CONNECTED'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}>
                    {externalFeeds?.bybit?.status || 'CONNECTING'}
                  </span>
                </div>

                <div className="space-y-2.5 text-xs font-mono">
                  <div className="flex justify-between text-[#A1AFB8]">
                    <span>Endpoint:</span>
                    <span className="text-[#E4EBEF] truncate max-w-[240px]">wss://stream.bybit.com/v5/public/spot</span>
                  </div>
                  <div className="flex justify-between text-[#A1AFB8]">
                    <span>Latency:</span>
                    <span className="text-emerald-400 font-bold">{externalFeeds?.bybit?.metrics?.avgLatencyMs || 15} ms</span>
                  </div>
                  <div className="flex justify-between text-[#A1AFB8]">
                    <span>Messages Received:</span>
                    <span className="text-white">{externalFeeds?.bybit?.metrics?.messagesReceived?.toLocaleString() || 0}</span>
                  </div>
                  <div className="flex justify-between text-[#A1AFB8]">
                    <span>Reconnect Count:</span>
                    <span className="text-[#E4EBEF]">{externalFeeds?.bybit?.metrics?.reconnectCount || 0}</span>
                  </div>
                  <div className="pt-2 border-t border-[#202B34] space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-[#A1AFB8]">BTC/USDT:</span>
                      <span className="text-base font-bold text-white">
                        ${externalFeeds?.bybit?.btcTick?.lastPrice ? externalFeeds.bybit.btcTick.lastPrice.toLocaleString() : '94,855.00'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#A1AFB8]">ETH/USDT:</span>
                      <span className="text-base font-bold text-white">
                        ${externalFeeds?.bybit?.ethTick?.lastPrice ? externalFeeds.bybit.ethTick.lastPrice.toLocaleString() : '2,840.50'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-[#202B34]">
                <button
                  onClick={() => handleReconnectProvider('bybit')}
                  className="w-full py-1.5 bg-[#17212B] hover:bg-[#1D2832] text-[#E4EBEF] text-xs font-semibold rounded-[7px] transition-colors"
                >
                  Reconnect Bybit Stream
                </button>
              </div>
            </div>

            {/* CoinMarketCap Card */}
            <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5 shadow-lg flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-[#202B34] mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                    <h3 className="text-sm font-bold text-white">CoinMarketCap Market Feed</h3>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    externalFeeds?.cmc?.status === 'CONNECTED'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}>
                    {externalFeeds?.cmc?.status || 'CONNECTED'}
                  </span>
                </div>

                <div className="space-y-2.5 text-xs font-mono">
                  <div className="flex justify-between text-[#A1AFB8]">
                    <span>Source:</span>
                    <span className="text-[#E4EBEF] truncate max-w-[200px]">CoinMarketCap Public API & Quotes</span>
                  </div>
                  <div className="flex justify-between text-[#A1AFB8]">
                    <span>Latency:</span>
                    <span className="text-emerald-400 font-bold">{externalFeeds?.cmc?.metrics?.avgLatencyMs || 42} ms</span>
                  </div>
                  <div className="flex justify-between text-[#A1AFB8]">
                    <span>Updates Polled:</span>
                    <span className="text-white">{externalFeeds?.cmc?.metrics?.messagesReceived?.toLocaleString() || 1}</span>
                  </div>
                  <div className="flex justify-between text-[#A1AFB8]">
                    <span>USDT/IDR Rate:</span>
                    <span className="text-emerald-400 font-bold">
                      Rp {externalFeeds?.cmc?.usdtTick?.lastPrice ? externalFeeds.cmc.usdtTick.lastPrice.toLocaleString('id-ID') : '16.365'}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-[#202B34] space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-[#A1AFB8]">BTC/USDT:</span>
                      <span className="text-base font-bold text-white">
                        ${externalFeeds?.cmc?.btcTick?.lastPrice ? externalFeeds.cmc.btcTick.lastPrice.toLocaleString() : '95,050.00'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#A1AFB8]">ETH/USDT:</span>
                      <span className="text-base font-bold text-white">
                        ${externalFeeds?.cmc?.ethTick?.lastPrice ? externalFeeds.cmc.ethTick.lastPrice.toLocaleString() : '3,425.00'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 mt-4 border-t border-[#202B34]">
                <button
                  onClick={() => handleReconnectProvider('coinmarketcap')}
                  className="w-full py-1.5 bg-[#17212B] hover:bg-[#1D2832] text-[#E4EBEF] text-xs font-semibold rounded-[7px] transition-colors"
                >
                  Refresh CMC Feed
                </button>
              </div>
            </div>
          </div>

          {/* Aggregator Config & Health Summary */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5 shadow-lg">
            <h3 className="text-sm font-bold text-white mb-3">Multi-Exchange Price Aggregator Controls</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
              <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34]">
                <span className="text-[#A1AFB8] block mb-1">Primary Feed Provider</span>
                <span className="text-base font-bold text-amber-400">BINANCE SPOT</span>
                <span className="text-[10px] text-[#71818B] block mt-1">Fallback: Bybit Spot (Automatic Failover)</span>
              </div>
              <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34]">
                <span className="text-[#A1AFB8] block mb-1">Max Deviation Threshold</span>
                <span className="text-base font-bold text-sky-400">200 bps (2.00%)</span>
                <span className="text-[10px] text-[#71818B] block mt-1">Pencegah outlier tick abnormal</span>
              </div>
              <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34]">
                <span className="text-[#A1AFB8] block mb-1">Max Data Age (Freshness Guard)</span>
                <span className="text-base font-bold text-emerald-400">15,000 ms</span>
                <span className="text-[10px] text-[#71818B] block mt-1">Bot pause otomatis jika data stale</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: FX RATES */}
      {activeTab === 'FX_RATES' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                USDT/IDR FX Conversion Engine
              </h2>
              <p className="text-xs text-[#A1AFB8]">
                Formula konversi harga spot: <strong className="text-emerald-400 font-mono">BTC/IDR = BTC/USDT × USDT/IDR</strong> dengan kontrol manual admin, manajemen interval CoinMarketCap hemat kuota API, dan rekam jejak audit SHA-256.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                fxData?.config?.isManualLocked
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              }`}>
                <span className={`w-2 h-2 rounded-full ${fxData?.config?.isManualLocked ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
                {fxData?.config?.isManualLocked ? 'Kurs Terkunci Manual' : 'Auto-Sync CMC Aktif'}
              </span>
            </div>
          </div>

          {/* 1. SPOT PRICE CONVERSION FORMULA BANNER */}
          <div className="bg-[#141C24] border border-blue-500/30 rounded-[10px] p-5 shadow-xl relative overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-blue-500/20 mb-4">
              <div>
                <span className="text-[10px] font-bold tracking-wider text-blue-400 uppercase block mb-1">
                  DIMONEX Mathematical Core Specification
                </span>
                <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                  Formula Konversi Harga Spot Real-Time
                </h3>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-[#E4EBEF]">
                <span className="text-[#A1AFB8]">Kurs Acuan Multiplier:</span>
                <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded font-bold">
                  1 USDT = Rp {fxData?.currentRate?.rate ? fxData.currentRate.rate.toLocaleString('id-ID') : '16.350'}
                </span>
              </div>
            </div>

            {/* Formula Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs mb-5">
              <div className="p-4 bg-[#090e18]/80 rounded-[10px] border border-blue-500/20 hover:border-blue-500/40 transition-all">
                <div className="flex items-center justify-between text-[#A1AFB8] mb-1.5">
                  <span className="font-sans font-bold text-white text-sm">Bitcoin (BTC)</span>
                  <span className="text-[10px] text-blue-400">BTC-IDR SPOT</span>
                </div>
                <div className="text-xs text-amber-400 font-bold mb-2">
                  BTC/IDR = BTC/USDT × USDT/IDR
                </div>
                <div className="pt-2 border-t border-slate-800 space-y-1 text-[11px] text-[#E4EBEF]">
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">BTC/USDT Ref:</span>
                    <span className="text-white">${fxData?.referencePrices?.['BTC-IDR']?.effectiveUsdtPrice?.toLocaleString() || '94,850.00'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">USDT/IDR Kurs:</span>
                    <span className="text-emerald-400">Rp {fxData?.currentRate?.rate ? fxData.currentRate.rate.toLocaleString('id-ID') : '16.350'}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t border-slate-800/60">
                    <span className="text-blue-300">Hasil Spot:</span>
                    <span className="text-emerald-400 text-xs">Rp {fxData?.spotFormulas?.['BTC-IDR']?.calculatedIdrPrice?.toLocaleString('id-ID') || fxData?.referencePrices?.['BTC-IDR']?.effectiveIdrPrice?.toLocaleString('id-ID') || '1.550.797.500'}</span>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[#090e18]/80 rounded-[10px] border border-purple-500/20 hover:border-purple-500/40 transition-all">
                <div className="flex items-center justify-between text-[#A1AFB8] mb-1.5">
                  <span className="font-sans font-bold text-white text-sm">Ethereum (ETH)</span>
                  <span className="text-[10px] text-purple-400">ETH-IDR SPOT</span>
                </div>
                <div className="text-xs text-purple-400 font-bold mb-2">
                  ETH/IDR = ETH/USDT × USDT/IDR
                </div>
                <div className="pt-2 border-t border-slate-800 space-y-1 text-[11px] text-[#E4EBEF]">
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">ETH/USDT Ref:</span>
                    <span className="text-white">${fxData?.referencePrices?.['ETH-IDR']?.effectiveUsdtPrice?.toLocaleString() || '2,840.00'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">USDT/IDR Kurs:</span>
                    <span className="text-emerald-400">Rp {fxData?.currentRate?.rate ? fxData.currentRate.rate.toLocaleString('id-ID') : '16.350'}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t border-slate-800/60">
                    <span className="text-purple-300">Hasil Spot:</span>
                    <span className="text-emerald-400 text-xs">Rp {fxData?.spotFormulas?.['ETH-IDR']?.calculatedIdrPrice?.toLocaleString('id-ID') || fxData?.referencePrices?.['ETH-IDR']?.effectiveIdrPrice?.toLocaleString('id-ID') || '46.434.000'}</span>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[#090e18]/80 rounded-[10px] border border-emerald-500/20 hover:border-emerald-500/40 transition-all">
                <div className="flex items-center justify-between text-[#A1AFB8] mb-1.5">
                  <span className="font-sans font-bold text-white text-sm">Solana (SOL)</span>
                  <span className="text-[10px] text-emerald-400">SOL-IDR SPOT</span>
                </div>
                <div className="text-xs text-emerald-400 font-bold mb-2">
                  SOL/IDR = SOL/USDT × USDT/IDR
                </div>
                <div className="pt-2 border-t border-slate-800 space-y-1 text-[11px] text-[#E4EBEF]">
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">SOL/USDT Ref:</span>
                    <span className="text-white">$174.50</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#71818B]">USDT/IDR Kurs:</span>
                    <span className="text-emerald-400">Rp {fxData?.currentRate?.rate ? fxData.currentRate.rate.toLocaleString('id-ID') : '16.350'}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t border-slate-800/60">
                    <span className="text-emerald-300">Hasil Spot:</span>
                    <span className="text-emerald-400 text-xs">Rp {fxData?.spotFormulas?.['SOL-IDR']?.calculatedIdrPrice?.toLocaleString('id-ID') || '2.853.075'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Preview Calculator */}
            <div className="p-3 bg-[#111820] rounded-[7px] border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[#A1AFB8] font-sans font-medium">Kalkulator Simulasi Formula:</span>
                <div className="flex items-center gap-1 bg-[#17212B] p-1 rounded border border-slate-700">
                  {(['BTC', 'ETH', 'SOL'] as const).map(sym => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => {
                        setCalcBasePair(sym);
                        if (sym === 'BTC') setCalcUsdtPrice('95000');
                        else if (sym === 'ETH') setCalcUsdtPrice('2850');
                        else setCalcUsdtPrice('175');
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        calcBasePair === sym ? 'bg-blue-600 text-white' : 'text-[#A1AFB8] hover:text-white'
                      }`}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 font-mono">
                  <span className="text-[#A1AFB8]">$</span>
                  <input
                    type="number"
                    value={calcUsdtPrice}
                    onChange={e => setCalcUsdtPrice(e.target.value)}
                    className="w-28 bg-[#17212B] text-white px-2 py-1 rounded border border-slate-700 text-xs"
                    placeholder="Harga USDT"
                  />
                  <span className="text-[#71818B]">USDT ×</span>
                  <span className="text-emerald-400 font-bold">
                    Rp {fxData?.currentRate?.rate ? fxData.currentRate.rate.toLocaleString('id-ID') : '16.350'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 font-mono">
                <span className="text-[#A1AFB8]">=</span>
                <span className="text-sm font-extrabold text-emerald-400 bg-emerald-950/40 px-3 py-1 rounded border border-emerald-500/30">
                  Rp {(Math.round((parseFloat(calcUsdtPrice) || 0) * (fxData?.currentRate?.rate || 16350))).toLocaleString('id-ID')}
                </span>
                <span className="text-[10px] text-[#71818B]">({calcBasePair}/IDR)</span>
              </div>
            </div>
          </div>

          {/* 2. COINMARKETCAP API INTERVAL & QUOTA SAVER */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5 shadow-lg space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[#202B34]">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Manajemen Interval CoinMarketCap & Penghemat Kuota API
                </h3>
                <p className="text-xs text-[#A1AFB8]">
                  Batasi panggilan API eksternal dengan interval polling otomatis pintar (Default: 15 menit = ~96 calls/hari) agar kuota API gratis tidak cepat habis.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleUpdateFxConfig(
                    fxData?.config?.syncIntervalMinutes ?? 15,
                    !fxData?.config?.isManualLocked
                  )}
                  className={`px-3 py-1.5 rounded-[7px] text-xs font-semibold border transition-all cursor-pointer ${
                    fxData?.config?.isManualLocked
                      ? 'bg-amber-600/20 text-amber-400 border-amber-500/30 hover:bg-amber-600/30'
                      : 'bg-slate-800 text-[#E4EBEF] border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {fxData?.config?.isManualLocked ? 'Kunci Manual Aktif (Klik Buka Kunci)' : 'Buka Kunci (Klik untuk Kunci Manual)'}
                </button>

                <button
                  onClick={() => handleSyncCmcFx(true)}
                  disabled={isLoading}
                  className="px-4 py-1.5 bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] text-white font-bold rounded-[7px] text-xs shadow flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  Ambil Kurs CMC Sekarang (Force Fetch)
                </button>
              </div>
            </div>

            {/* Quota Saver Metrics & Interval Select */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 font-mono text-xs">
              <div className="p-3.5 bg-[#111820] rounded-[7px] border border-[#202B34] flex flex-col justify-between">
                <span className="text-[#A1AFB8] block mb-1">Pengaturan Interval Sinkronisasi</span>
                <select
                  value={fxData?.config?.syncIntervalMinutes ?? 15}
                  onChange={e => handleUpdateFxConfig(parseInt(e.target.value, 10), fxData?.config?.isManualLocked ?? false)}
                  className="bg-[#17212B] text-white font-bold p-2 rounded border border-[#2B3944] text-xs cursor-pointer"
                >
                  <option value={5}>5 Menit (High Freshness)</option>
                  <option value={15}>15 Menit (Rekomendasi Hemat API: ~96 calls/hari)</option>
                  <option value={30}>30 Menit (Sangat Hemat: ~48 calls/hari)</option>
                  <option value={60}>1 Jam (Hemat Maksimal: ~24 calls/hari)</option>
                  <option value={360}>6 Jam (Ultra Hemat)</option>
                  <option value={0}>Manual Saja (Polling Otomatis Mati)</option>
                </select>
                <span className="text-[10px] text-[#71818B] mt-1 block">
                  {fxData?.config?.syncIntervalMinutes === 0 ? 'Hanya sinkron jika tombol manual ditekan.' : `Auto-fetch setiap ${fxData?.config?.syncIntervalMinutes || 15} menit.`}
                </span>
              </div>

              <div className="p-3.5 bg-[#111820] rounded-[7px] border border-[#202B34] flex flex-col justify-between">
                <span className="text-[#A1AFB8] block mb-1">Total Panggilan API CMC</span>
                <span className="text-xl font-bold text-white">
                  {fxData?.config?.cmcApiCallsCount ?? 1} <span className="text-xs font-normal text-[#71818B]">calls</span>
                </span>
                <span className="text-[10px] text-[#71818B] mt-1 block">
                  Limit gratis: 333 calls / hari
                </span>
              </div>

              <div className="p-3.5 bg-[#111820] rounded-[7px] border border-[#202B34] flex flex-col justify-between">
                <span className="text-[#A1AFB8] block mb-1">Panggilan API Dihemat (Cache Saver)</span>
                <span className="text-xl font-bold text-emerald-400">
                  {fxData?.config?.quotaSavedCount ?? 0} <span className="text-xs font-normal text-[#71818B]">requests</span>
                </span>
                <span className="text-[10px] text-emerald-500 mt-1 block">
                  Berhasil dihemat melalui cache interval
                </span>
              </div>

              <div className="p-3.5 bg-[#111820] rounded-[7px] border border-[#202B34] flex flex-col justify-between">
                <span className="text-[#A1AFB8] block mb-1">Jadwal Fetch Otomatis Berikutnya</span>
                <span className="text-xs font-bold text-sky-400">
                  {fxData?.config?.nextCmcFetchTimestamp
                    ? new Date(fxData.config.nextCmcFetchTimestamp).toLocaleTimeString('id-ID')
                    : 'Siap / Sesuai Jadwal'}
                </span>
                <span className="text-[10px] text-[#71818B] mt-1 block">
                  {fxData?.config?.isManualLocked ? 'Tertunda karena Kurs Terkunci Manual' : 'Berjalan di background'}
                </span>
              </div>
            </div>
          </div>

          {/* Current Rate Banner & Converted Benchmark Preview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-[#141C24] border border-[#202B34] rounded-[10px] flex flex-col justify-between">
              <span className="text-xs text-[#A1AFB8] block mb-1">Kurs Aktif USDT/IDR</span>
              <span className="text-2xl font-bold font-mono text-emerald-400">
                Rp {fxData?.currentRate?.rate ? fxData.currentRate.rate.toLocaleString('id-ID') : '16.350'}
              </span>
              <span className="text-[10px] text-[#71818B] mt-1">
                Sumber: {fxData?.currentRate?.source || 'SYSTEM_DEFAULT'}
              </span>
            </div>

            <div className="p-4 bg-[#141C24] border border-[#202B34] rounded-[10px] flex flex-col justify-between">
              <span className="text-xs text-[#A1AFB8] block mb-1">Benchmark BTC/IDR (Terkonversi)</span>
              <span className="text-xl font-bold font-mono text-white">
                Rp {fxData?.referencePrices?.['BTC-IDR']?.effectiveIdrPrice?.toLocaleString('id-ID') || '1.550.797.500'}
              </span>
              <span className="text-[10px] text-[#71818B] mt-1">
                ${fxData?.referencePrices?.['BTC-IDR']?.effectiveUsdtPrice?.toLocaleString() || '94,850'} USDT × Kurs
              </span>
            </div>

            <div className="p-4 bg-[#141C24] border border-[#202B34] rounded-[10px] flex flex-col justify-between">
              <span className="text-xs text-[#A1AFB8] block mb-1">Benchmark ETH/IDR (Terkonversi)</span>
              <span className="text-xl font-bold font-mono text-white">
                Rp {fxData?.referencePrices?.['ETH-IDR']?.effectiveIdrPrice?.toLocaleString('id-ID') || '46.434.000'}
              </span>
              <span className="text-[10px] text-[#71818B] mt-1">
                ${fxData?.referencePrices?.['ETH-IDR']?.effectiveUsdtPrice?.toLocaleString() || '2,840'} USDT × Kurs
              </span>
            </div>

            <div className="p-4 bg-[#141C24] border border-[#202B34] rounded-[10px] flex flex-col justify-between">
              <span className="text-xs text-[#A1AFB8] block mb-1">Status Keabsahan Kurs</span>
              <span className={`text-base font-bold font-mono ${fxData?.currentRate?.isStale ? 'text-red-400' : 'text-emerald-400'}`}>
                {fxData?.currentRate?.isStale ? 'STALE (KEDALUWARSA)' : 'AKTIF & VALID'}
              </span>
              <span className="text-[10px] text-[#71818B] mt-1">
                Berlaku s/d: {fxData?.currentRate?.validUntil ? new Date(fxData.currentRate.validUntil).toLocaleString('id-ID') : '-'}
              </span>
            </div>
          </div>

          {/* Form Pembaruan Manual Kurs */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5 shadow-lg">
            <h3 className="text-sm font-bold text-white mb-2">Pembaruan Manual Kurs USDT/IDR (Admin / MM)</h3>
            <p className="text-xs text-[#A1AFB8] mb-4">
              Setiap perubahan kurs manual akan mengunci kurs dari overwrite otomatis CoinMarketCap dan dicatat dalam audit trail permanen ber-hash kriptografis.
            </p>

            <form onSubmit={handleUpdateFxRate} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-semibold text-[#E4EBEF] block mb-1">Kurs Baru (IDR per 1 USDT)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={manualFxRate}
                    onChange={e => setManualFxRate(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2.5 rounded-[7px] border border-[#2B3944] font-mono font-bold text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#E4EBEF] block mb-1">Masa Berlaku (Jam)</label>
                  <input
                    type="number"
                    value={manualFxValidityHours}
                    onChange={e => setManualFxValidityHours(e.target.value)}
                    min="1"
                    max="168"
                    required
                    className="w-full bg-[#17212B] text-white p-2.5 rounded-[7px] border border-[#2B3944] font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#E4EBEF] block mb-1">Catatan / Alasan Penetapan</label>
                  <input
                    type="text"
                    value={manualFxNotes}
                    onChange={e => setManualFxNotes(e.target.value)}
                    placeholder="Contoh: Penyesuaian kurs tengah BI / OTC rate"
                    className="w-full bg-[#17212B] text-white p-2.5 rounded-[7px] border border-[#2B3944] text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 text-xs text-[#A1AFB8] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manualFxConfirm}
                    onChange={e => setManualFxConfirm(e.target.checked)}
                    className="rounded bg-[#17212B] border-[#2B3944] text-blue-600"
                  />
                  <span>Konfirmasi perubahan di luar toleransi normal jika deviasi &gt; 10%</span>
                </label>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-[7px] shadow transition-colors cursor-pointer"
                >
                  Simpan & Kunci Kurs Baru
                </button>
              </div>
            </form>
          </div>

          {/* Audit History Table */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden shadow-lg">
            <div className="px-5 py-3 border-b border-[#202B34] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Rekam Jejak Audit Perubahan Kurs (Cryptographic SHA-256)
                </h3>
                <p className="text-[11px] text-[#A1AFB8]">Setiap perubahan kurs diautentikasi dengan hash chaining matematis permanen.</p>
              </div>
              <span className="text-xs text-[#A1AFB8] font-mono">{fxData?.history?.length || 0} entri terverifikasi</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#111820] text-[#A1AFB8] uppercase text-[11px] border-b border-[#202B34]">
                  <tr>
                    <th className="py-2.5 px-4">Waktu</th>
                    <th className="py-2.5 px-4 font-sans">Aktor / Admin</th>
                    <th className="py-2.5 px-4">Kurs Sebelumnya</th>
                    <th className="py-2.5 px-4">Kurs Baru</th>
                    <th className="py-2.5 px-4">Perubahan (%)</th>
                    <th className="py-2.5 px-4">Sumber</th>
                    <th className="py-2.5 px-4">Integritas SHA-256</th>
                    <th className="py-2.5 px-4 font-sans">Catatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34] text-[#E4EBEF]">
                  {(!fxData?.history || fxData.history.length === 0) ? (
                    <tr>
                      <td colSpan={8} className="text-center py-6 text-[#71818B] font-sans">
                        Belum ada riwayat perubahan kurs tercatat.
                      </td>
                    </tr>
                  ) : (
                    fxData.history.map((entry: any) => (
                      <tr key={entry.id} className="hover:bg-[#17212B]">
                        <td className="py-2.5 px-4 text-[#A1AFB8]">{formatDateTime(entry.timestamp)}</td>
                        <td className="py-2.5 px-4 font-sans text-white">{entry.actor}</td>
                        <td className="py-2.5 px-4">Rp {entry.previousRate?.toLocaleString('id-ID')}</td>
                        <td className="py-2.5 px-4 font-bold text-emerald-400">Rp {entry.newRate?.toLocaleString('id-ID')}</td>
                        <td className="py-2.5 px-4">{entry.percentChange > 0 ? `+${entry.percentChange}%` : `${entry.percentChange}%`}</td>
                        <td className="py-2.5 px-4 text-[#A1AFB8]">{entry.source}</td>
                        <td className="py-2.5 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1">
                            
                            <span>{entry.hash ? entry.hash.slice(0, 10) + '...' : 'GENESIS'}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-sans text-[#E4EBEF]">{entry.notes || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: PRICE FOLLOWER BOTS */}
      {activeTab === 'PRICE_FOLLOWER' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Price Follower Market-Making Bots
              </h2>
              <p className="text-xs text-[#A1AFB8]">
                Bot market maker yang mengikuti pergerakan harga referensi eksternal secara otomatis dan menempatkan order riil pada Matching Engine DIMONEX.
              </p>
            </div>
            <button
              onClick={() => setIsPriceFollowerModalOpen(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-[7px] shadow transition-colors flex items-center gap-1.5"
            >
              <span>+</span> Deploy Price Follower Bot
            </button>
          </div>

          {/* Table of Price Follower Bots */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden shadow-lg">
            <div className="px-5 py-3 border-b border-[#202B34] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Daftar Price Follower Bot ({currentEnv})</h3>
              <span className="text-xs text-[#A1AFB8]">
                {instances.filter(b => b.botType === 'PRICE_FOLLOWER').length} bot terdaftar
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111820] text-[#A1AFB8] uppercase font-mono text-[11px] border-b border-[#202B34]">
                  <tr>
                    <th className="py-2.5 px-4">Bot ID / Name</th>
                    <th className="py-2.5 px-4">Pair</th>
                    <th className="py-2.5 px-4">Provider Source</th>
                    <th className="py-2.5 px-4">Buy Offset (bps)</th>
                    <th className="py-2.5 px-4">Sell Offset (bps)</th>
                    <th className="py-2.5 px-4">Qty per Order</th>
                    <th className="py-2.5 px-4">Reprice Int.</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34] text-[#E4EBEF] font-mono">
                  {instances.filter(b => b.botType === 'PRICE_FOLLOWER').length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-[#71818B] font-sans">
                        Belum ada Price Follower bot yang dikonfigurasi. Klik "+ Deploy Price Follower Bot" untuk memulai.
                      </td>
                    </tr>
                  ) : (
                    instances.filter(b => b.botType === 'PRICE_FOLLOWER').map(b => {
                      const cfg = b.priceFollowerConfig;
                      return (
                        <tr key={b.id} className="hover:bg-[#17212B] transition-colors">
                          <td className="py-3 px-4 font-sans">
                            <strong className="text-white block">{b.name}</strong>
                            <span className="text-[10px] text-[#71818B] font-mono">{b.id}</span>
                          </td>
                          <td className="py-3 px-4 font-bold text-white">{b.pairId}</td>
                          <td className="py-3 px-4 text-amber-400">{cfg?.reference_provider || 'AGGREGATED'}</td>
                          <td className="py-3 px-4 text-emerald-400">{cfg?.buy_offset_bps ?? 20} bps</td>
                          <td className="py-3 px-4 text-red-400">{cfg?.sell_offset_bps ?? 20} bps</td>
                          <td className="py-3 px-4 font-bold text-white">{cfg?.order_quantity || '0.01'}</td>
                          <td className="py-3 px-4 text-[#A1AFB8]">{cfg?.minimum_reprice_interval_ms || 2000} ms</td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              b.status === 'RUNNING'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : b.status === 'PAUSED'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-slate-700 text-[#E4EBEF]'
                            }`}>
                              {b.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5 font-sans">
                              {b.status === 'RUNNING' ? (
                                <button
                                  onClick={() => handlePauseBot(b.id)}
                                  className="px-2 py-1 bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 rounded text-xs"
                                >
                                  Pause
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleStartBot(b.id)}
                                  className="px-2 py-1 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded text-xs"
                                >
                                  Start
                                </button>
                              )}
                              <button
                                onClick={() => handleStopBot(b.id)}
                                className="px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-xs"
                              >
                                Stop
                              </button>
                              <button
                                onClick={() => setSelectedBotId(b.id)}
                                className="px-2 py-1 bg-[#17212B] text-[#A1AFB8] hover:text-white rounded text-xs"
                              >
                                Logs
                              </button>
                              <button
                                onClick={() => handleOpenDeleteModal(b)}
                                className="px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/40 rounded text-xs"
                              >
                                Hapus
                              </button>
                            </div>
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

      {/* TAB: DEPTH & LIQUIDITY BOTS */}
      {activeTab === 'DEPTH_LIQUIDITY' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Depth & Liquidity Market-Making Bots
              </h2>
              <p className="text-xs text-[#A1AFB8]">
                Menyediakan likuiditas multi-level yang tebal dan nyata pada Order Book DIMONEX tanpa fake liquidity atau order buatan frontend.
              </p>
            </div>
            <button
              onClick={() => setIsDepthLiquidityModalOpen(true)}
              className="px-4 py-2.5 bg-[#1D2832] hover:bg-[#222F3A] border border-[#40515D] text-white text-xs font-bold rounded-[7px] shadow-lg transition-all flex items-center gap-2 border border-purple-400/40"
            >
              
              <span>Konfigurasi Penyediaan Likuiditas (Liquidity Provision Configuration)</span>
            </button>
          </div>

          {/* Table of Depth Bots */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden shadow-lg">
            <div className="px-5 py-3 border-b border-[#202B34] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Daftar Depth & Liquidity Bot ({currentEnv})</h3>
              <span className="text-xs text-[#A1AFB8]">
                {instances.filter(b => b.botType === 'DEPTH_LIQUIDITY').length} bot terdaftar
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111820] text-[#A1AFB8] uppercase font-mono text-[11px] border-b border-[#202B34]">
                  <tr>
                    <th className="py-2.5 px-4">Bot ID / Name</th>
                    <th className="py-2.5 px-4">Pair</th>
                    <th className="py-2.5 px-4">Bid / Ask Levels</th>
                    <th className="py-2.5 px-4">Offsets (bps)</th>
                    <th className="py-2.5 px-4">Quantities</th>
                    <th className="py-2.5 px-4">Cooldown & Jitter</th>
                    <th className="py-2.5 px-4">Active Orders</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34] text-[#E4EBEF] font-mono">
                  {instances.filter(b => b.botType === 'DEPTH_LIQUIDITY').length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-[#71818B] font-sans">
                        Belum ada Depth & Liquidity bot yang dikonfigurasi. Klik "+ Deploy Depth & Liquidity Bot" untuk mulai menginjeksi likuiditas riil.
                      </td>
                    </tr>
                  ) : (
                    instances.filter(b => b.botType === 'DEPTH_LIQUIDITY').map(b => {
                      const cfg = b.depthLiquidityConfig;
                      return (
                        <tr key={b.id} className="hover:bg-[#17212B] transition-colors">
                          <td className="py-3 px-4 font-sans">
                            <strong className="text-white block">{b.name}</strong>
                            <span className="text-[10px] text-[#71818B] font-mono">{b.id}</span>
                          </td>
                          <td className="py-3 px-4 font-bold text-white">{b.pairId}</td>
                          <td className="py-3 px-4">
                            <span className="text-emerald-400">{cfg?.number_of_bid_levels || 3} Bids</span> /{' '}
                            <span className="text-red-400">{cfg?.number_of_ask_levels || 3} Asks</span>
                          </td>
                          <td className="py-3 px-4 text-[#E4EBEF] text-[11px]">
                            {cfg?.price_mode === 'CUSTOM_BOUNDS' ? (
                              <div>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                  CUSTOM BOUNDS
                                </span>
                                <div className="text-[10px] text-[#A1AFB8] font-mono mt-0.5">
                                  Buy: {cfg.min_limit_buy_price}-{cfg.max_limit_buy_price}
                                </div>
                                <div className="text-[10px] text-[#A1AFB8] font-mono">
                                  Sell: {cfg.min_limit_sell_price}-{cfg.max_limit_sell_price}
                                </div>
                              </div>
                            ) : (
                              <div>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                  REFF: {cfg?.reference_price_source || 'AGGREGATED'}
                                </span>
                                <div className="text-[10px] text-[#A1AFB8] font-mono mt-0.5">
                                  {cfg?.bid_level_offsets_bps?.join(', ') || '10, 25, 50'} bps
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-[#E4EBEF] text-[11px]">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-purple-300 border border-purple-500/30 block mb-1 w-max">
                              {cfg?.spacing_mode || 'LINEAR'}
                            </span>
                            <span className="text-[#A1AFB8] text-[10px]">
                              {cfg?.bid_quantities?.slice(0, 3).join(', ')}...
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[11px]">
                            <div className="flex flex-col">
                              <span className="text-amber-400 font-semibold">{cfg?.liquidity_refresh_cooldown_sec || 10}s cooldown</span>
                              <span className="text-purple-300 text-[10px]">
                                {cfg?.randomize_placement_enabled !== false ? `Jitter: ±${cfg?.price_randomization_ticks || 2} ticks` : 'Static Placement'}
                              </span>
                              <span className="text-emerald-400 text-[10px] font-semibold mt-0.5">
                                Anti-Stacking OK
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-bold text-sky-400">
                            {cfg?.activeOrderIds?.length || 0} level di Order Book
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              b.status === 'RUNNING'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : b.status === 'PAUSED'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-slate-700 text-[#E4EBEF]'
                            }`}>
                              {b.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5 font-sans">
                              {b.status === 'RUNNING' && (
                                <button
                                  type="button"
                                  onClick={() => handleRefreshLiquidity(b.id)}
                                  title="Segarkan Likuiditas Sekarang (Reset Cooldown & Hitung Ulang Jitter)"
                                  className="px-2 py-1 bg-[#1D2832] hover:bg-[#222F3A] border border-[#40515D] text-white rounded text-xs font-bold shadow flex items-center gap-1 cursor-pointer"
                                >
                                  Segarkan
                                </button>
                              )}
                              {b.status === 'RUNNING' ? (
                                <button
                                  onClick={() => handlePauseBot(b.id)}
                                  className="px-2 py-1 bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 rounded text-xs"
                                >
                                  Pause
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleStartBot(b.id)}
                                  className="px-2 py-1 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded text-xs"
                                >
                                  Start
                                </button>
                              )}
                              <button
                                onClick={() => handleOpenEditModal(b)}
                                className="px-2 py-1 bg-[#17212B] text-amber-400 hover:bg-[#1D2832] rounded text-xs"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleStopBot(b.id)}
                                className="px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-xs"
                              >
                                Stop
                              </button>
                              <button
                                onClick={() => setSelectedBotId(b.id)}
                                className="px-2 py-1 bg-[#17212B] text-[#A1AFB8] hover:text-white rounded text-xs"
                              >
                                Logs
                              </button>
                              <button
                                onClick={() => handleOpenDeleteModal(b)}
                                className="px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/40 rounded text-xs"
                              >
                                Hapus
                              </button>
                            </div>
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

      {/* TAB: MOVEMENT DEPTH LIQUIDITY BOTS (RELATIVE WS FOLLOWER) */}
      {activeTab === 'MOVEMENT_DEPTH' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Depth Movement Bots (Pengikut Pergerakan WS Binance/Bybit)
              </h2>
              <p className="text-xs text-[#A1AFB8]">
                Cocok untuk token baru listing / harga mandiri: Bot menjaga harga lokal token Anda sendiri dan memproyeksikan <strong>% pergerakan relatif</strong> dari pair acuan WebSocket yang dikurasi Admin (bukan meniru nominal harganya).
              </p>
            </div>
            <button
              onClick={() => setIsMovementDepthModalOpen(true)}
              className="px-4 py-2.5 bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] text-white text-xs font-bold rounded-[7px] shadow-lg transition-all flex items-center gap-2 border border-cyan-400/40"
            >
              
              <span>+ Konfigurasi Bot Depth Movement (WS)</span>
            </button>
          </div>

          {/* Admin Curated WS Whitelist Live Strip */}
          <div className="p-3.5 bg-[#141C24] border border-cyan-500/20 rounded-[10px] space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-cyan-300">
                Pair Acuan WebSocket Aktif (Kurasi Whitelist Admin): {wsWhitelist.length} pair
              </span>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className={`px-2 py-0.5 rounded ${wsFeedConnStatus.binance === 'CONNECTED' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                  Binance WS: {wsFeedConnStatus.binance || 'CONNECTING'}
                </span>
                <span className={`px-2 py-0.5 rounded ${wsFeedConnStatus.bybit === 'CONNECTED' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                  Bybit WS: {wsFeedConnStatus.bybit || 'CONNECTING'}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {wsWhitelist.length === 0 ? (
                <span className="text-xs text-amber-400">
                  Belum ada pair aktif di whitelist Admin. Minta Admin mengaktifkan pair acuan di Admin Console &rarr; FX Engine &amp; WS Pairs.
                </span>
              ) : (
                wsWhitelist.map(w => (
                  <div key={w.symbol} className="px-2.5 py-1.5 rounded-[7px] bg-[#131b2a] border border-white/10 text-[11px] font-mono flex items-center gap-2">
                    <span className="font-bold text-white">{w.symbol}</span>
                    {w.binancePrice && <span className="text-amber-300">BN: {w.binancePrice}</span>}
                    {w.bybitPrice && <span className="text-cyan-300">BY: {w.bybitPrice}</span>}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Table of Movement Depth Bots */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden shadow-lg">
            <div className="px-5 py-3 border-b border-[#202B34] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Daftar Bot Depth Movement (WS) ({currentEnv})</h3>
              <span className="text-xs text-[#A1AFB8]">
                {instances.filter(b => b.botType === 'MOVEMENT_DEPTH_LIQUIDITY').length} bot terdaftar
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111820] text-[#A1AFB8] uppercase font-mono text-[11px] border-b border-[#202B34]">
                  <tr>
                    <th className="py-2.5 px-4">Bot ID / Name</th>
                    <th className="py-2.5 px-4">Target Pair</th>
                    <th className="py-2.5 px-4">Acuan WS &amp; Move %</th>
                    <th className="py-2.5 px-4">Anchor &rarr; Proyeksi</th>
                    <th className="py-2.5 px-4">Beta &amp; Mode</th>
                    <th className="py-2.5 px-4">Active Orders</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34] text-[#E4EBEF] font-mono">
                  {instances.filter(b => b.botType === 'MOVEMENT_DEPTH_LIQUIDITY').length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-[#71818B] font-sans">
                        Belum ada bot Depth Movement (WS). Klik "+ Konfigurasi Bot Depth Movement (WS)" untuk menghubungkan token Anda dengan pergerakan % BTC/SOL/ETH di Binance &amp; Bybit.
                      </td>
                    </tr>
                  ) : (
                    instances.filter(b => b.botType === 'MOVEMENT_DEPTH_LIQUIDITY').map(b => {
                      const cfg = b.movementDepthConfig;
                      const retPct = cfg?.last_leader_return_pct ?? 0;
                      return (
                        <tr key={b.id} className="hover:bg-[#17212B] transition-colors">
                          <td className="py-3 px-4 font-sans">
                            <strong className="text-white block">{b.name}</strong>
                            <span className="text-[10px] text-[#71818B] font-mono">{b.id}</span>
                          </td>
                          <td className="py-3 px-4 font-bold text-white">{b.pairId}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold text-[10px]">
                                {cfg?.leader_symbol || 'BTCUSDT'}
                              </span>
                              <span className="text-[10px] text-[#A1AFB8]">({cfg?.leader_provider || 'AGG'})</span>
                            </div>
                            <div className={`text-[11px] font-bold mt-1 ${retPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {retPct >= 0 ? '+' : ''}{retPct.toFixed(3)}%
                              {cfg?.last_leader_price ? ` (${cfg.last_leader_price})` : ''}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-[10px] text-[#A1AFB8]">Anchor: {cfg?.anchor_local_price || '-'}</div>
                            <div className="text-xs font-bold text-amber-300 mt-0.5">
                              &rarr; {cfg?.last_projected_local_price ?? cfg?.anchor_local_price}
                            </div>
                            <div className="text-[10px] text-[#71818B]">
                              Base WS: {cfg?.leader_baseline_price ? cfg.leader_baseline_price : 'Auto on Start'}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-[11px]">
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-cyan-500/30 font-bold">
                              Beta {cfg?.movement_sensitivity ?? 1.0}x
                            </span>
                            <div className="text-[10px] text-[#A1AFB8] mt-1">
                              {cfg?.spacing_mode || 'PERCENT_BPS'} · {cfg?.number_of_bid_levels || 5}B/{cfg?.number_of_ask_levels || 5}A
                            </div>
                          </td>
                          <td className="py-3 px-4 font-bold text-sky-400">
                            {cfg?.activeOrderIds?.length || 0} level aktif
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              b.status === 'RUNNING'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : b.status === 'PAUSED'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-slate-700 text-[#E4EBEF]'
                            }`}>
                              {b.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex flex-wrap items-center justify-end gap-1.5 font-sans">
                              {b.status === 'RUNNING' && (
                                <button
                                  type="button"
                                  onClick={() => handleRefreshLiquidity(b.id)}
                                  className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-bold"
                                >
                                  Segarkan
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleResetAnchor(b.id)}
                                title="Kunci ulang harga acuan WS saat ini sebagai 0% terhadap Anchor Lokal"
                                className="px-2 py-1 bg-blue-600/20 text-blue-300 hover:bg-blue-600/40 rounded text-xs"
                              >
                                Reset Anchor
                              </button>
                              {b.status === 'RUNNING' ? (
                                <button onClick={() => handlePauseBot(b.id)} className="px-2 py-1 bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 rounded text-xs">
                                  Pause
                                </button>
                              ) : (
                                <button onClick={() => handleStartBot(b.id)} className="px-2 py-1 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 rounded text-xs">
                                  Start
                                </button>
                              )}
                              <button onClick={() => handleOpenEditModal(b)} className="px-2 py-1 bg-[#17212B] text-amber-400 hover:bg-[#1D2832] rounded text-xs">
                                Edit
                              </button>
                              <button onClick={() => handleStopBot(b.id)} className="px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-xs">
                                Stop
                              </button>
                              <button onClick={() => setSelectedBotId(b.id)} className="px-2 py-1 bg-[#17212B] text-[#A1AFB8] hover:text-white rounded text-xs">
                                Logs
                              </button>
                              <button onClick={() => handleOpenDeleteModal(b)} className="px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/40 rounded text-xs">
                                Hapus
                              </button>
                            </div>
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

      {/* TAB: HFT PERFORMANCE DASHBOARD (D3 TELEMETRY) */}
      {activeTab === 'PERFORMANCE' && (
        <PerformanceDashboardSection
          tradingPairs={tradingPairs}
          onSetFeedback={setFeedbackMsg}
        />
      )}

      {/* TAB: REAL-TIME HFT ENGINE TELEMETRY (OPS / LATENCY / FEE GENERATION) */}
      {activeTab === 'HFT_TELEMETRY' && (
        <HftEngineTelemetrySection
          tradingPairs={tradingPairs}
          onSetFeedback={setFeedbackMsg}
        />
      )}

      {/* TAB: MARKET MAKER INTERNAL SPREAD (SELF-EATING ENGINE + D3 HEATMAP) */}
      {activeTab === 'INTERNAL_SPREAD' && (
        <MarketMakerInternalSpreadSection
          tradingPairs={tradingPairs}
          currentEnv={currentEnv}
          instances={instances}
          onSetFeedback={setFeedbackMsg}
        />
      )}

      {/* TAB: AUTOMATED PORTFOLIO REBALANCING */}
      {activeTab === 'PORTFOLIO_REBALANCE' && (
        <PortfolioRebalanceSection
          tradingPairs={tradingPairs}
          onSetFeedback={setFeedbackMsg}
        />
      )}

      {/* TAB: ADVANCED MARKET MAKER & MULTI-TIMEFRAME ENGINE */}
      {activeTab === 'ADVANCED_MM' && (
        <AdvancedMarketMakerSection
          user={user}
          tradingPairs={tradingPairs}
          currentEnv={currentEnv}
        />
      )}

      {/* TAB: SMART HFT LADDER BOT & PATTERN CHART CREATOR ENGINE */}
      {activeTab === 'SMART_HFT_LADDER' && (
        <SmartHftLadderSection
          user={user}
          instances={instances}
          tradingPairs={tradingPairs}
          onRefresh={loadData}
          onSetFeedback={setFeedbackMsg}
          initialBacktestPreset={deployPresetFromBacktest}
          onOpenBacktestWithConfig={(preset) => {
            setBacktestPreset(preset);
            setActiveTab('HFT_BACKTEST');
          }}
        />
      )}

      {/* TAB: IMMUTABLE LEDGER HFT BACKTESTING ENGINE */}
      {activeTab === 'HFT_BACKTEST' && (
        <HftBacktestSection
          tradingPairs={tradingPairs}
          instances={instances}
          initialPreset={backtestPreset}
          onApplyPresetToDeploy={(preset) => {
            setDeployPresetFromBacktest(preset);
            setActiveTab('SMART_HFT_LADDER');
            setFeedbackMsg({
              type: 'success',
              text: `Konfigurasi terverifikasi (${preset.pairId} · ${preset.pattern}) siap di-deploy di Smart HFT Ladder.`
            });
          }}
          onSetFeedback={setFeedbackMsg}
        />
      )}

      {/* TAB: PRICE THRESHOLD ALERTS & AUTOMATED LADDER ADJUSTMENT */}
      {activeTab === 'PRICE_THRESHOLDS' && (
        <PriceThresholdSection
          environment={currentEnv}
          tradingPairs={tradingPairs}
          instances={instances}
          triggers={thresholdTriggers}
          events={thresholdEvents}
          soundMuted={thresholdSoundMuted}
          onToggleMute={() => {
            const next = !thresholdSoundMuted;
            setThresholdSoundMuted(next);
            localStorage.setItem('dimonex_threshold_muted', next ? '1' : '0');
          }}
          onRefresh={() => {
            loadThresholds();
            loadData();
          }}
        />
      )}

      {/* TAB: QUANTITATIVE HFT MARKET MAKER (HFT-MM) */}
      {activeTab === 'QUANT_HFT_MM' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Quantitative High-Frequency Market Maker (HFT-MM)
              </h2>
              <p className="text-xs text-[#A1AFB8]">
                Bot MM algoritma 3-Pilar: Analisa Top-5 Depth, Pengetatan Spread Dinamis (Inside Spread), Micro-EMA Trend Leaning, dan Anti-Manipulation Flash Defense.
              </p>
            </div>
            <button
              onClick={() => setIsQuantHftModalOpen(true)}
              className="px-4 py-2.5 bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] text-white text-xs font-bold rounded-[7px] shadow-lg transition-all flex items-center gap-2 border border-cyan-400/40"
            >
              
              <span>+ Deploy Quant HFT MM Bot</span>
            </button>
          </div>

          {/* Quick Quantitative Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 bg-[#0c1322] border border-cyan-500/20 rounded-[10px]">
              <span className="text-[11px] text-cyan-300 font-semibold block mb-1">Bot HFT Aktif</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-cyan-400">
                  {instances.filter(b => b.botType === 'QUANT_HFT_MM' && b.status === 'RUNNING').length}
                </span>
                <span className="text-xs text-[#71818B] font-mono">
                  / {instances.filter(b => b.botType === 'QUANT_HFT_MM').length} terdaftar
                </span>
              </div>
              <span className="text-[10px] text-[#A1AFB8] mt-1 block">Siklus frekuensi tinggi ~1.5s per tick</span>
            </div>

            <div className="p-3 bg-[#0c1322] border border-cyan-500/20 rounded-[10px]">
              <span className="text-[11px] text-cyan-300 font-semibold block mb-1">Spread Tightening</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-xs font-bold font-mono">
                  1-Tick Inside Spread
                </span>
              </div>
              <span className="text-[10px] text-[#A1AFB8] mt-2 block">Prioritas antrean buku pesanan terdepan</span>
            </div>

            <div className="p-3 bg-[#0c1322] border border-cyan-500/20 rounded-[10px]">
              <span className="text-[11px] text-cyan-300 font-semibold block mb-1">Flash Defense Trigger</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs font-bold font-mono">
                  120 bps / 2.5x Vol
                </span>
              </div>
              <span className="text-[10px] text-[#A1AFB8] mt-2 block">Perlebar perimeter 3.0x & micro-lot saat spike</span>
            </div>

            <div className="p-3 bg-[#0c1322] border border-cyan-500/20 rounded-[10px]">
              <span className="text-[11px] text-cyan-300 font-semibold block mb-1">Presisi Aset</span>
              <div className="text-xs font-mono text-[#E4EBEF] mt-1">
                Base: <span className="text-cyan-400 font-bold">8 dec</span> · Quote: <span className="text-emerald-400 font-bold">6 dec</span>
              </div>
              <span className="text-[10px] text-[#A1AFB8] mt-2 block">Zero Float Precision via integer arithmetic</span>
            </div>
          </div>

          {/* Table of Quant HFT Bots */}
          <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden shadow-lg">
            <div className="px-5 py-3 border-b border-[#202B34] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Daftar Instance Quant HFT MM ({currentEnv})
              </h3>
              <span className="text-xs text-[#A1AFB8]">
                {instances.filter(b => b.botType === 'QUANT_HFT_MM').length} bot terdaftar
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111820] text-[#A1AFB8] uppercase font-mono text-[11px] border-b border-[#202B34]">
                  <tr>
                    <th className="py-2.5 px-4">Bot ID / Name</th>
                    <th className="py-2.5 px-4">Pair</th>
                    <th className="py-2.5 px-4">Target Spread</th>
                    <th className="py-2.5 px-4">Micro-Lot & Ladder</th>
                    <th className="py-2.5 px-4">Trend Leaning</th>
                    <th className="py-2.5 px-4">Flash Defense</th>
                    <th className="py-2.5 px-4">Orders & Volume</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34] text-[#E4EBEF] font-mono">
                  {instances.filter(b => b.botType === 'QUANT_HFT_MM').length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-10 text-[#71818B] font-sans">
                        Belum ada Quantitative HFT MM bot yang dikonfigurasi. Klik "+ Deploy Quant HFT MM Bot" untuk mulai mengoperasikan bot pembuat pasar kuantitatif canggih.
                      </td>
                    </tr>
                  ) : (
                    instances.filter(b => b.botType === 'QUANT_HFT_MM').map(b => {
                      const cfg = b.quantHftConfig;
                      const pair = tradingPairs.find(p => p.id === b.pairId);
                      return (
                        <tr key={b.id} className="hover:bg-[#17212B] transition-colors">
                          <td className="py-3 px-4 font-sans">
                            <strong className="text-white block flex items-center gap-1.5">
                              {b.name}
                            </strong>
                            <span className="text-[10px] text-[#71818B] font-mono">{b.id}</span>
                          </td>
                          <td className="py-3 px-4 font-bold text-white">
                            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                              {b.pairId}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-cyan-300 font-bold">{cfg?.target_spread_pct || 0.08}%</span>
                            <span className="text-[10px] text-[#A1AFB8] block">
                              {cfg?.tighten_spread_enabled ? 'Inside Tightened' : 'Passive'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-emerald-400">{cfg?.micro_order_size || '0.001'} {pair?.baseCurrency || ''}</span>
                            <span className="text-[10px] text-[#A1AFB8] block">{cfg?.max_ladder_levels || 3} Levels Ladder</span>
                          </td>
                          <td className="py-3 px-4">
                            {cfg?.lastTrend === 'UPTREND' ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30">
                                ▲ UPTREND (+{cfg.lastSkewBps || 0} bps)
                              </span>
                            ) : cfg?.lastTrend === 'DOWNTREND' ? (
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-bold border border-amber-500/30">
                                ▼ DOWNTREND ({cfg.lastSkewBps || 0} bps)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-slate-800 text-[#A1AFB8] text-[10px] border border-slate-700">
                                ● NEUTRAL
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {cfg?.isFlashDefenseActive ? (
                              <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px] font-bold border border-red-500/30">
                                DEFENSE ACTIVE (3x)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-[10px] border border-cyan-500/20">
                                NORMAL
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="text-white font-bold">{b.stats.ordersSubmitted}</span>
                              <span className="text-[#71818B]">sub /</span>
                              <span className="text-emerald-400 font-bold">{b.stats.ordersFilled}</span>
                              <span className="text-[#71818B]">fill</span>
                            </div>
                            <span className="text-[10px] text-[#A1AFB8] block">
                              {Number(b.stats.executedVolume || 0) > 0 ? `${(Number(b.stats.executedVolume) / (10 ** (pair?.baseDecimals || 8))).toFixed(4)} ${pair?.baseCurrency || ''}` : '0 volume'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              b.status === 'RUNNING' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                              b.status === 'PAUSED' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                              b.status === 'RISK_HALTED' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                              'bg-slate-700 text-[#A1AFB8]'
                            }`}>
                              {b.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {b.status === 'RUNNING' ? (
                                <button
                                  onClick={() => handleAction(`/api/mm/instance/${b.id}/pause`, 'POST')}
                                  className="px-2 py-1 bg-amber-600/20 text-amber-400 hover:bg-amber-600/40 rounded text-xs"
                                >
                                  Pause
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleAction(`/api/mm/instance/${b.id}/start`, 'POST')}
                                  className="px-2 py-1 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40 rounded text-xs"
                                >
                                  Start
                                </button>
                              )}
                              <button
                                onClick={() => handleAction(`/api/mm/instance/${b.id}/stop`, 'POST')}
                                className="px-2 py-1 bg-slate-700 text-[#E4EBEF] hover:bg-slate-600 rounded text-xs"
                              >
                                Stop
                              </button>
                              <button
                                onClick={() => handleOpenEditModal(b)}
                                className="px-2 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 rounded text-xs"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleOpenCloneModal(b)}
                                className="px-2 py-1 bg-purple-600/20 text-purple-400 hover:bg-purple-600/40 rounded text-xs"
                              >
                                Clone
                              </button>
                              <button
                                onClick={() => setSelectedBotId(b.id)}
                                className="px-2 py-1 bg-slate-800 text-[#E4EBEF] hover:bg-slate-700 rounded text-xs"
                              >
                                Logs
                              </button>
                              <button
                                onClick={() => handleOpenDeleteModal(b)}
                                className="px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/40 rounded text-xs"
                              >
                                Hapus
                              </button>
                            </div>
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

      {/* TAB 2: ORDER BOTS */}
      {activeTab === 'ORDER_BOTS' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white">Order Bots Configuration & Operations</h2>
              <p className="text-xs text-[#A1AFB8]">Kelola multi-bot BUY dan SELL independen dengan konfigurasi terpisah.</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Filter BUY / SELL */}
              <div className="flex items-center bg-[#17212B] p-0.5 rounded-[7px] border border-[#202B34] text-xs">
                {(['ALL', 'BUY', 'SELL'] as const).map(flt => {
                  const count = flt === 'ALL' 
                    ? instances.filter(b => b.botType === 'ORDER_BOT').length
                    : instances.filter(b => b.botType === 'ORDER_BOT' && b.orderBotConfig?.transaction_type === flt).length;
                  return (
                    <button
                      key={flt}
                      onClick={() => setOrderBotFilter(flt)}
                      className={`px-3 py-1 font-semibold rounded-md transition-all ${
                        orderBotFilter === flt
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-[#A1AFB8] hover:text-[#E4EBEF]'
                      }`}
                    >
                      {flt === 'ALL' ? 'Semua' : flt} ({count})
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setIsOrderBotModalOpen(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-[7px] shadow"
              >
                + Deploy New Order Bot
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {instances
              .filter(b => b.botType === 'ORDER_BOT')
              .filter(b => orderBotFilter === 'ALL' || b.orderBotConfig?.transaction_type === orderBotFilter)
              .map(b => (
              <div key={b.id} className="p-4 bg-[#141C24] border border-[#202B34] rounded-[10px] flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white">{b.name}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      b.status === 'RUNNING' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-[#A1AFB8]'
                    }`}>
                      {b.status}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-[#A1AFB8] font-mono mb-4">
                    <div className="flex justify-between">
                      <span>Side / Transaction Type:</span>
                      <strong className={b.orderBotConfig?.transaction_type === 'BUY' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                        {b.orderBotConfig?.transaction_type}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Price Source:</span>
                      <span className="text-[#E4EBEF]">{b.orderBotConfig?.price_source}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Range Qty:</span>
                      <span className="text-[#E4EBEF]">{b.orderBotConfig?.random_min_quantity} - {b.orderBotConfig?.random_max_quantity}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Order Count:</span>
                      <span className="text-white">{b.stats.ordersSubmitted} / {b.orderBotConfig?.order_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Split Mode:</span>
                      <span className="text-[#E4EBEF]">{b.orderBotConfig?.split_order_mode}</span>
                    </div>
                    {b.orderBotConfig?.buy_max_price_limit && (
                      <div className="flex justify-between text-amber-300">
                        <span>Buy Max Price Limit:</span>
                        <span className="font-bold">Rp {Number(b.orderBotConfig.buy_max_price_limit).toLocaleString('id-ID')}</span>
                      </div>
                    )}
                    {b.orderBotConfig?.sell_min_price_limit && (
                      <div className="flex justify-between text-amber-300">
                        <span>Sell Min Price Limit:</span>
                        <span className="font-bold">Rp {Number(b.orderBotConfig.sell_min_price_limit).toLocaleString('id-ID')}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pt-3 border-t border-[#202B34]">
                  {b.status === 'RUNNING' ? (
                    <button onClick={() => handleStopBot(b.id)} className="flex-1 py-1 bg-red-600/20 text-red-400 text-xs rounded font-medium">
                      Stop
                    </button>
                  ) : (
                    <button onClick={() => handleStartBot(b.id)} className="flex-1 py-1 bg-emerald-600 text-white text-xs rounded font-medium">
                      Start
                    </button>
                  )}
                  <button onClick={() => handleOpenEditModal(b)} className="px-2.5 py-1 bg-[#17212B] text-amber-400 hover:bg-[#1D2832] text-xs rounded">
                    Edit
                  </button>
                  <button onClick={() => handleOpenCloneModal(b)} className="px-2.5 py-1 bg-[#17212B] text-blue-400 hover:bg-[#1D2832] text-xs rounded">
                    Clone
                  </button>
                  <button onClick={() => setSelectedBotId(b.id)} className="px-2.5 py-1 bg-[#17212B] text-[#E4EBEF] hover:text-white text-xs rounded">
                    Logs
                  </button>
                  <button
                    onClick={() => handleOpenDeleteModal(b)}
                    title="Hapus Bot Permanen"
                    className="px-2.5 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 text-xs rounded font-medium"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: VOLUME & TEST BOTS */}
      {activeTab === 'VOLUME_BOTS' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white">Volume & Test Bots (Phase 9)</h2>
              <p className="text-xs text-[#A1AFB8]">Penyedia likuiditas otomatis dengan target IDR stop/start dan isolasi sandbox.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setActiveTab('INTERNAL_SPREAD')}
                icon={<Flame className="w-3.5 h-3.5" />}
              >
                Internal Spread Mode
              </Button>
              <button
                onClick={() => setIsVolumeBotModalOpen(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-[7px] shadow whitespace-nowrap"
              >
                + Deploy Volume Bot
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {instances.filter(b => b.botType === 'VOLUME_BOT').map(b => (
              <div key={b.id} className="p-4 bg-[#141C24] border border-[#202B34] rounded-[10px] flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white">{b.name}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      b.status === 'RUNNING' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-[#A1AFB8]'
                    }`}>
                      {b.status}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-[#A1AFB8] font-mono mb-4">
                    <div className="flex justify-between">
                      <span>Target Stop IDR:</span>
                      <span className="text-[#E4EBEF]">Rp {parseInt(b.volumeBotConfig?.vol_idr_stop_target || '0').toLocaleString('id-ID')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Delay:</span>
                      <span className="text-[#E4EBEF]">{b.volumeBotConfig?.min_delay}s - {b.volumeBotConfig?.max_delay}s</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Qty:</span>
                      <span className="text-[#E4EBEF]">{b.volumeBotConfig?.volume_random_min_quantity} - {b.volumeBotConfig?.volume_random_max_quantity}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Executed Vol:</span>
                      <span className="text-emerald-400">{b.stats.executedVolume}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pt-3 border-t border-[#202B34]">
                  {b.status === 'RUNNING' ? (
                    <button onClick={() => handleStopBot(b.id)} className="flex-1 py-1 bg-red-600/20 text-red-400 text-xs rounded font-medium">
                      Stop
                    </button>
                  ) : (
                    <button onClick={() => handleStartBot(b.id)} className="flex-1 py-1 bg-emerald-600 text-white text-xs rounded font-medium">
                      Start
                    </button>
                  )}
                  <button onClick={() => handleOpenEditModal(b)} className="px-2.5 py-1 bg-[#17212B] text-amber-400 hover:bg-[#1D2832] text-xs rounded">
                    Edit
                  </button>
                  <button onClick={() => handleOpenCloneModal(b)} className="px-2.5 py-1 bg-[#17212B] text-blue-400 text-xs rounded">
                    Clone
                  </button>
                  <button onClick={() => setSelectedBotId(b.id)} className="px-2.5 py-1 bg-[#17212B] text-[#E4EBEF] text-xs rounded">
                    Logs
                  </button>
                  <button
                    onClick={() => handleOpenDeleteModal(b)}
                    title="Hapus Bot Permanen"
                    className="px-2.5 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 text-xs rounded font-medium"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* PHASE 2: SPREAD VOLUME BOT (ANTAR SPREAD / SELF-CROSS) */}
          <div className="mt-6 pt-5 border-t border-[#202B34] flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[#E4EBEF]">
                  Volume Bot Phase 2 — Antar Spread (Self-Cross)
                </h2>
                <p className="text-xs text-[#A1AFB8]">
                  Menempatkan Maker GTC di dalam celah Bid-Ask lalu mengeksekusi Taker IOC di harga sama (makan order sendiri antar spread tanpa menyentuh order luar).
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsVolumeSpreadModalOpen(true)}
                className="whitespace-nowrap"
              >
                + Deploy Spread Volume Bot (Phase 2)
              </Button>
            </div>

            {instances.filter(b => b.botType === 'VOLUME_SPREAD_BOT').length === 0 ? (
              <div className="p-6 bg-[#141C24] border border-[#202B34] rounded-[10px] text-center">
                <p className="text-xs text-[#A1AFB8] mb-3">
                  Belum ada instance Volume Bot Phase 2 (Antar Spread) di environment {currentEnv}.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsVolumeSpreadModalOpen(true)}
                  className="whitespace-nowrap"
                >
                  Buat Volume Bot Phase 2 Pertama
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {instances.filter(b => b.botType === 'VOLUME_SPREAD_BOT').map(b => {
                  const cfg = b.volumeSpreadConfig;
                  const botPair = tradingPairs.find(p => p.id === b.pairId);
                  const qDec = botPair?.quoteDecimals ?? 2;
                  const bDec = botPair?.baseDecimals ?? 8;
                  const quoteSym = botPair?.quoteCurrency || 'IDR';
                  const baseSym = botPair?.baseCurrency || b.pairId.split('-')[0];
                  const execQuoteDisplay = cfg?.executedQuoteVolumeUnits
                    ? formatQuotePrice(cfg.executedQuoteVolumeUnits, quoteSym, qDec)
                    : `0 ${quoteSym}`;
                  const lastPriceDisplay = cfg?.lastExecPriceUnits
                    ? formatQuotePrice(cfg.lastExecPriceUnits, quoteSym, qDec)
                    : '—';

                  return (
                    <div
                      key={b.id}
                      className="p-4 bg-[#141C24] border border-[#202B34] hover:border-[#2B3944] transition-colors rounded-[10px] flex flex-col justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-[#E4EBEF] truncate">{b.name}</span>
                              <span className="text-[10px] font-mono text-[#71818B] shrink-0">{b.pairId}</span>
                            </div>
                            <div className="text-[11px] font-mono text-[#8DA5B1] mt-0.5">
                              {cfg?.spread_mode || 'INSIDE_SPREAD'} · {cfg?.side_pattern || 'ALTERNATE'}
                            </div>
                          </div>
                          <StatusBadge
                            tone={
                              b.status === 'RUNNING'
                                ? 'success'
                                : b.status === 'RISK_HALTED' || b.status === 'ERROR'
                                ? 'danger'
                                : b.status === 'PAUSED'
                                ? 'warning'
                                : 'neutral'
                            }
                          >
                            {b.status}
                          </StatusBadge>
                        </div>

                        <div className="space-y-1.5 text-xs text-[#A1AFB8] font-mono tabular-nums">
                          <div className="flex justify-between">
                            <span className="text-[#71818B]">Spread Band:</span>
                            <span className="text-[#E4EBEF]">
                              {cfg?.spread_band_min_pct ?? 15}% – {cfg?.spread_band_max_pct ?? 85}% ({cfg?.cross_delay_ms ?? 150} ms)
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#71818B]">Qty / Delay:</span>
                            <span className="text-[#E4EBEF]">
                              {cfg?.random_min_quantity}–{cfg?.random_max_quantity} {baseSym} · {cfg?.min_delay}s–{cfg?.max_delay}s
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#71818B]">Last Cross:</span>
                            <span className="text-[#E4EBEF]">
                              {cfg?.lastSideExecuted ? `${cfg.lastSideExecuted} @ ` : ''}{lastPriceDisplay}
                              {typeof cfg?.lastSpreadBps === 'number' ? ` (${cfg.lastSpreadBps} bps)` : ''}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#71818B]">Self-Trades / Base:</span>
                            <span className="text-[#E4EBEF]">
                              {cfg?.spreadSelfTradesCount ?? b.stats.totalTrades} tx · {formatCrypto(b.stats.executedVolume || '0', bDec, baseSym)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[#71818B]">Exec Quote / Target:</span>
                            <span className="text-[#35B887]">
                              {execQuoteDisplay} / {cfg?.vol_quote_stop_target || '0'} {quoteSym}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 pt-3 border-t border-[#202B34] flex-wrap">
                        {b.status === 'RUNNING' ? (
                          <>
                            <button
                              onClick={() => handlePauseBot(b.id)}
                              className="flex-1 py-1.5 px-2 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 text-xs rounded-[6px] font-medium whitespace-nowrap"
                            >
                              Pause
                            </button>
                            <button
                              onClick={() => handleStopBot(b.id)}
                              className="flex-1 py-1.5 px-2 bg-red-600/20 text-red-400 hover:bg-red-600/30 text-xs rounded-[6px] font-medium whitespace-nowrap"
                            >
                              Stop
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleStartBot(b.id)}
                            className="flex-1 py-1.5 px-2 bg-[#16A36E] hover:bg-[#19B87C] text-white text-xs rounded-[6px] font-medium whitespace-nowrap"
                          >
                            Start
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenEditModal(b)}
                          className="px-2.5 py-1.5 bg-[#17212B] text-amber-400 hover:bg-[#1D2832] text-xs rounded-[6px] whitespace-nowrap"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleOpenCloneModal(b)}
                          className="px-2.5 py-1.5 bg-[#17212B] text-sky-400 hover:bg-[#1D2832] text-xs rounded-[6px] whitespace-nowrap"
                        >
                          Clone
                        </button>
                        <button
                          onClick={() => setSelectedBotId(b.id)}
                          className="px-2.5 py-1.5 bg-[#17212B] text-[#E4EBEF] hover:bg-[#1D2832] text-xs rounded-[6px] whitespace-nowrap"
                        >
                          Logs
                        </button>
                        <button
                          onClick={() => handleOpenDeleteModal(b)}
                          title="Hapus Bot Permanen"
                          className="px-2.5 py-1.5 bg-red-600/20 text-red-400 hover:bg-red-600/30 text-xs rounded-[6px] font-medium whitespace-nowrap"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: CONFIGURATIONS (CSV Import & Export) */}
      {activeTab === 'CONFIGURATIONS' && (
        <div className="flex flex-col gap-5">
          <div className="p-4 bg-[#141C24] border border-[#202B34] rounded-[10px] flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white mb-1">CSV Configuration Manager (Phase 11)</h3>
              <p className="text-xs text-[#A1AFB8]">Impor dan ekspor batch konfigurasi bot dengan validasi baris per baris tanpa aktivasi otomatis.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsCsvImportModalOpen(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-[7px] shadow"
              >
                Upload CSV File
              </button>
              <button
                onClick={() => handleExportCsv('ORDER_BOT')}
                className="px-3 py-2 bg-[#17212B] hover:bg-[#1D2832] text-[#E4EBEF] text-xs rounded-[7px] border border-[#2B3944]"
              >
                Export Order Bots CSV
              </button>
              <button
                onClick={() => handleExportCsv('VOLUME_BOT')}
                className="px-3 py-2 bg-[#17212B] hover:bg-[#1D2832] text-[#E4EBEF] text-xs rounded-[7px] border border-[#2B3944]"
              >
                Export Volume Bots CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: BOT ACCOUNTS */}
      {activeTab === 'BOT_ACCOUNTS' && (
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4">
          <h3 className="text-sm font-bold text-white mb-2">Authorized Market Maker Accounts</h3>
          <p className="text-xs text-[#A1AFB8] mb-4">Daftar saldo dan aset akun MM yang terdaftar di matching engine bursa.</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {overview?.balances?.map((b: any) => (
              <div key={b.currency} className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34]">
                <span className="text-xs font-bold text-[#E4EBEF] block mb-1">{b.currency}</span>
                <span className="text-lg font-bold font-mono text-emerald-400 block">
                  {b.currency === 'IDR' ? formatIDR(b.balanceAvailable, true) : (Number(b.balanceAvailable) / (10 ** (b.currency === 'BTC' ? 8 : b.currency === 'ETH' ? 8 : 6))).toFixed(4)}
                </span>
                <span className="text-[11px] text-[#71818B] block">
                  Locked: {b.currency === 'IDR' ? formatIDR(b.balanceLocked, true) : (Number(b.balanceLocked) / (10 ** (b.currency === 'BTC' ? 8 : b.currency === 'ETH' ? 8 : 6))).toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 6: ORDERS */}
      {activeTab === 'ORDERS' && (
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#202B34] flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Bot Open & Historical Orders</h3>
            <span className="text-xs text-[#A1AFB8]">Real database orders</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#111820] text-[#A1AFB8] uppercase text-[11px]">
                <tr>
                  <th className="py-2.5 px-4">Order ID</th>
                  <th className="py-2.5 px-4">Pair</th>
                  <th className="py-2.5 px-4">Side</th>
                  <th className="py-2.5 px-4">Price</th>
                  <th className="py-2.5 px-4">Quantity</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Created At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34] text-[#E4EBEF]">
                {botOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-6 text-[#71818B] font-sans">
                      Belum ada order bot yang tercatat.
                    </td>
                  </tr>
                ) : (
                  botOrders.map(o => (
                    <tr key={o.id} className="hover:bg-[#17212B]">
                      <td className="py-2.5 px-4 text-[#A1AFB8]">{o.id.slice(0, 8)}...</td>
                      <td className="py-2.5 px-4 font-bold text-white">{o.pairId}</td>
                      <td className={`py-2.5 px-4 font-bold ${o.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {o.side}
                      </td>
                      <td className="py-2.5 px-4 font-mono">
                        {formatQuotePrice(o.price, (o.pairId || '').split('-')[1] || 'IDR', (o.pairId || '').endsWith('USDT') ? 6 : 2, true)}
                      </td>
                      <td className="py-2.5 px-4">{o.quantity}</td>
                      <td className="py-2.5 px-4">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          o.status === 'FILLED' ? 'text-emerald-400 bg-emerald-500/10' : 'text-blue-400 bg-blue-500/10'
                        }`}>
                          {o.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-[#71818B]">{formatDateTime(o.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 7: EXECUTED TRADES */}
      {activeTab === 'EXECUTED_TRADES' && (
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#202B34]">
            <h3 className="text-sm font-bold text-white">Bot Executed Trades</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#111820] text-[#A1AFB8] uppercase text-[11px]">
                <tr>
                  <th className="py-2.5 px-4">Trade ID</th>
                  <th className="py-2.5 px-4">Pair</th>
                  <th className="py-2.5 px-4">Taker Side</th>
                  <th className="py-2.5 px-4">Price</th>
                  <th className="py-2.5 px-4">Quantity</th>
                  <th className="py-2.5 px-4">Quote Volume</th>
                  <th className="py-2.5 px-4">Executed At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34] text-[#E4EBEF]">
                {botTrades.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-6 text-[#71818B] font-sans">
                      Belum ada transaksi trade yang dieksekusi oleh bot.
                    </td>
                  </tr>
                ) : (
                  botTrades.map(t => (
                    <tr key={t.id} className="hover:bg-[#17212B]">
                      <td className="py-2.5 px-4 text-[#A1AFB8]">{t.id.slice(0, 8)}...</td>
                      <td className="py-2.5 px-4 font-bold text-white">{t.pairId}</td>
                      <td className={`py-2.5 px-4 font-bold ${t.takerSide === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {t.takerSide}
                      </td>
                      <td className="py-2.5 px-4 font-mono">
                        {formatQuotePrice(t.price, (t.pairId || '').split('-')[1] || 'IDR', (t.pairId || '').endsWith('USDT') ? 6 : 2, true)}
                      </td>
                      <td className="py-2.5 px-4">{t.quantity}</td>
                      <td className="py-2.5 px-4 font-mono">
                        {formatQuotePrice(t.quoteVolume, (t.pairId || '').split('-')[1] || 'IDR', (t.pairId || '').endsWith('USDT') ? 6 : 2, true)}
                      </td>
                      <td className="py-2.5 px-4 text-[#71818B]">{formatDateTime(t.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 8: ACTIVITY LOGS */}
      {activeTab === 'ACTIVITY_LOGS' && (
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Real-Time MM Activity & Execution Logs</span>
                <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
              </h3>
              <p className="text-xs text-[#A1AFB8]">Stream audit aktivitas real-time: order submit, fill, limit cap, stop, delete bot, dan emergency kill-switch.</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center bg-[#17212B] p-0.5 rounded-[7px] border border-[#202B34] text-xs">
                <button
                  type="button"
                  onClick={() => setLogFilterMode('ALL_SYSTEM')}
                  className={`px-3 py-1 font-semibold rounded-md transition-all ${
                    logFilterMode === 'ALL_SYSTEM'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-[#A1AFB8] hover:text-[#E4EBEF]'
                  }`}
                >
                  Semua Aktivitas Live ({allActivityLogs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setLogFilterMode('SINGLE_BOT')}
                  className={`px-3 py-1 font-semibold rounded-md transition-all ${
                    logFilterMode === 'SINGLE_BOT'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-[#A1AFB8] hover:text-[#E4EBEF]'
                  }`}
                >
                  Filter Per Bot
                </button>
              </div>

              {logFilterMode === 'SINGLE_BOT' && (
                <select
                  value={selectedBotId || ''}
                  onChange={e => setSelectedBotId(e.target.value)}
                  className="bg-[#17212B] text-white text-xs px-3 py-1.5 rounded border border-[#2B3944]"
                >
                  {instances.map(b => (
                    <option key={b.id} value={b.id}>{b.name} ({b.id})</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="bg-[#05080f] rounded-[7px] p-3 font-mono text-xs max-h-[460px] overflow-y-auto space-y-1.5 border border-[#202B34]">
            {logFilterMode === 'ALL_SYSTEM' ? (
              allActivityLogs.length === 0 ? (
                <div className="py-8 text-center text-[#71818B] font-sans">
                  Belum ada log aktivitas global yang tercatat.
                </div>
              ) : (
                allActivityLogs.map((l, i) => (
                  <div key={i} className="flex items-start gap-2 text-[#E4EBEF] py-1 border-b border-[#0f172a] last:border-0 hover:bg-[#0d1424] px-1 rounded transition-colors">
                    <span className="text-[#71818B] shrink-0 text-[11px]">{formatDateTime(l.timestamp)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 font-bold ${
                      l.type === 'FILL' ? 'bg-emerald-500/20 text-emerald-400' :
                      l.type === 'ORDER' ? 'bg-blue-500/20 text-blue-400' :
                      l.type === 'ERROR' ? 'bg-red-500/20 text-red-400' :
                      l.type === 'RISK' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-[#A1AFB8]'
                    }`}>
                      {l.type || 'INFO'}
                    </span>
                    {l.botName && (
                      <span className="text-blue-400 shrink-0 font-semibold text-[11px]">
                        [{l.botName}]
                      </span>
                    )}
                    <span className="break-all text-[11px] text-[#E4EBEF]">{l.message}</span>
                  </div>
                ))
              )
            ) : (
              botLogs.length === 0 ? (
                <div className="py-8 text-center text-[#71818B] font-sans">
                  Tidak ada log aktivitas untuk bot ini.
                </div>
              ) : (
                botLogs.map((l, i) => (
                  <div key={i} className="flex items-start gap-2 text-[#E4EBEF] py-1 border-b border-[#0f172a] last:border-0 hover:bg-[#0d1424] px-1 rounded transition-colors">
                    <span className="text-[#71818B] shrink-0 text-[11px]">{formatDateTime(l.timestamp)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 font-bold ${
                      l.type === 'FILL' ? 'bg-emerald-500/20 text-emerald-400' :
                      l.type === 'ORDER' ? 'bg-blue-500/20 text-blue-400' :
                      l.type === 'ERROR' ? 'bg-red-500/20 text-red-400' :
                      l.type === 'RISK' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-[#A1AFB8]'
                    }`}>
                      {l.type}
                    </span>
                    <span className="break-all text-[11px] text-[#E4EBEF]">{l.message}</span>
                  </div>
                ))
              )
            )}
          </div>
        </div>
      )}

      {/* TAB 9: RISK CONTROLS (Phase 10) */}
      {activeTab === 'RISK_CONTROLS' && (
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5">
          <h3 className="text-base font-bold text-white mb-2">Market Maker Risk Controls & Thresholds</h3>
          <p className="text-xs text-[#A1AFB8] mb-6">
            Batas pengaman bursa server-side untuk mencegah runaway loops, slippage berlebih, dan over-exposure.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 font-mono text-xs text-[#E4EBEF]">
            <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34]">
              <span className="text-[#A1AFB8] block mb-1">Max Active Bots</span>
              <strong className="text-white text-base">{riskControls?.maxActiveBots ?? 50}</strong>
            </div>
            <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34]">
              <span className="text-[#A1AFB8] block mb-1">Max Open Orders per Bot</span>
              <strong className="text-white text-base">{riskControls?.maxOpenOrdersPerBot ?? 100}</strong>
            </div>
            <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34]">
              <span className="text-[#A1AFB8] block mb-1">Max Price Deviation</span>
              <strong className="text-amber-400 text-base">{riskControls?.maxPriceDeviationPct ?? 15}%</strong>
            </div>
            <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34]">
              <span className="text-[#A1AFB8] block mb-1">Max Order Submission Rate</span>
              <strong className="text-white text-base">{riskControls?.maxOrderSubmissionRatePerMin ?? 120} / min</strong>
            </div>
            <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34]">
              <span className="text-[#A1AFB8] block mb-1">Max Allowed Slippage</span>
              <strong className="text-amber-400 text-base">{riskControls?.maxAllowedSlippagePct ?? 2.5}%</strong>
            </div>
            <div className="p-3 bg-[#111820] rounded-[7px] border border-[#202B34]">
              <span className="text-[#A1AFB8] block mb-1">Self-Trade Policy (STP)</span>
              <div className="flex items-center justify-between gap-2">
                <strong className={`text-sm ${(riskControls?.selfTradePreventionPolicy ?? 'ALLOW_WASH') === 'ALLOW_WASH' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {riskControls?.selfTradePreventionPolicy ?? 'ALLOW_WASH'}
                </strong>
                <select
                  value={riskControls?.selfTradePreventionPolicy ?? 'ALLOW_WASH'}
                  onChange={async (e) => {
                    const nextPolicy = e.target.value;
                    try {
                      const res = await handleAction('/api/mm/risk-controls/update', 'POST', {
                        selfTradePreventionPolicy: nextPolicy
                      });
                      if (res?.riskControls) setRiskControls(res.riskControls);
                    } catch {}
                  }}
                  className="bg-[#17212B] text-[#E4EBEF] text-[11px] px-2 py-1 rounded border border-[#2B3944] focus:outline-none focus:border-emerald-500"
                >
                  <option value="ALLOW_WASH">ALLOW_WASH (Match Langsung)</option>
                  <option value="CANCEL_MAKER">CANCEL_MAKER (Tolak Wash)</option>
                  <option value="CANCEL_TAKER">CANCEL_TAKER</option>
                  <option value="REJECT_BOTH">REJECT_BOTH</option>
                </select>
              </div>
              <span className="text-[10px] text-[#71818B] mt-1 block">
                {(riskControls?.selfTradePreventionPolicy ?? 'ALLOW_WASH') === 'ALLOW_WASH'
                  ? 'Order BUY/SELL milik sendiri langsung match tanpa lompat level.'
                  : 'Order akun sama dibatalkan sesuai kebijakan STP.'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 10: SETTINGS */}
      {activeTab === 'SETTINGS' && (
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-5">
          <h3 className="text-base font-bold text-white mb-2">MM Operator Security & API Keys</h3>
          <p className="text-xs text-[#A1AFB8] mb-4">Kelola API Keys HMAC-SHA256 untuk trading otomatis terautentikasi.</p>
          <button
            onClick={onOpenSecurityView}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-[7px] shadow"
          >
            Buka Panel Kunci API & 2FA
          </button>
        </div>
      )}

      {/* MODAL: CREATE ORDER BOT (Phase 7 exact fields) */}
      {isOrderBotModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090D12]/80 p-4 overflow-y-auto">
          <div className="bg-[#111820] border border-[#202B34] rounded-[10px] max-w-2xl w-full p-6 text-[#E4EBEF] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#202B34]">
              <div>
                <h2 className="text-base font-bold text-white">Deploy New Order Bot ({currentEnv})</h2>
                <p className="text-xs text-[#A1AFB8]">Konfigurasi bot likuiditas BUY atau SELL independen dengan batas harga & trailing.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOrderBotModalOpen(false)}
                className="text-[#A1AFB8] hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOrderBot} className="space-y-4 text-xs font-sans">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Bot Name</label>
                  <input
                    type="text"
                    value={obName}
                    onChange={e => setObName(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Trading Pair</label>
                  <select
                    value={obPairId}
                    onChange={e => setObPairId(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  >
                    {tradingPairs.map(p => (
                      <option key={p.id} value={p.id}>{p.id}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1 font-semibold">Side / Transaction Type</label>
                  <select
                    value={obTransactionType}
                    onChange={e => setObTransactionType(e.target.value as any)}
                    className="w-full bg-[#17212B] font-bold text-xs p-2 rounded border border-[#2B3944]"
                  >
                    <option value="BUY" className="text-emerald-400">BUY (Beli / Bid)</option>
                    <option value="SELL" className="text-red-400">SELL (Jual / Ask)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Price Source</label>
                  <select
                    value={obPriceSource}
                    onChange={e => setObPriceSource(e.target.value as any)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  >
                    <option value="MIDPOINT">MIDPOINT</option>
                    <option value="BEST_BID">BEST_BID</option>
                    <option value="BEST_ASK">BEST_ASK</option>
                    <option value="LAST_PRICE">LAST_PRICE</option>
                  </select>
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">
                    Order Count <span className="text-[10px] text-blue-400 font-normal">(0 = Berjalan Terus)</span>
                  </label>
                  <input
                    type="number"
                    value={obOrderCount}
                    onChange={e => setObOrderCount(e.target.value)}
                    required
                    placeholder="0 = Tanpa Henti"
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                  <span className="text-[10px] text-[#71818B] mt-0.5 block">
                    {Number(obOrderCount) === 0 ? 'Berjalan terus tanpa batas' : `Akan stop otomatis setelah ${obOrderCount} order`}
                  </span>
                </div>
              </div>

              {/* DYNAMIC PRICE LIMITS: BUY vs SELL */}
              {obTransactionType === 'BUY' ? (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-[7px] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-300 uppercase tracking-wide flex items-center gap-1.5">
                      Batas Perlindungan Harga BUY (Price Limit Constraints)
                    </span>
                    <span className="text-[10px] text-emerald-400 font-medium">Khusus Order Beli (Bid)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-emerald-200 block mb-1 font-semibold">
                        Min Buy Price Limit (IDR)
                      </label>
                      <input
                        type="text"
                        value={obBuyMinPrice}
                        onChange={e => setObBuyMinPrice(e.target.value)}
                        placeholder="Contoh: 1300000000 (Kosongkan jika tanpa batas)"
                        className="w-full bg-[#17212B] text-emerald-300 font-mono p-2 rounded border border-emerald-500/40 focus:border-emerald-400 outline-none"
                      />
                      <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                        Floor: Bot BUY tidak akan memasang bid di bawah harga ini.
                      </span>
                    </div>
                    <div>
                      <label className="text-emerald-200 block mb-1 font-semibold">
                        Max Buy Price Limit (IDR)
                      </label>
                      <input
                        type="text"
                        value={obBuyMaxPrice}
                        onChange={e => setObBuyMaxPrice(e.target.value)}
                        placeholder="Contoh: 1600000000 (Kosongkan jika tanpa batas)"
                        className="w-full bg-[#17212B] text-emerald-300 font-mono p-2 rounded border border-emerald-500/40 focus:border-emerald-400 outline-none"
                      />
                      <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                        Ceiling: Bot BUY tidak akan memasang bid di atas harga ini.
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-[7px] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-red-300 uppercase tracking-wide flex items-center gap-1.5">
                      Batas Perlindungan Harga SELL (Price Limit Constraints)
                    </span>
                    <span className="text-[10px] text-red-400 font-medium">Khusus Order Jual (Ask)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-red-200 block mb-1 font-semibold">
                        Min Sell Price Limit (IDR)
                      </label>
                      <input
                        type="text"
                        value={obSellMinPrice}
                        onChange={e => setObSellMinPrice(e.target.value)}
                        placeholder="Contoh: 1300000000 (Kosongkan jika tanpa batas)"
                        className="w-full bg-[#17212B] text-red-300 font-mono p-2 rounded border border-red-500/40 focus:border-red-400 outline-none"
                      />
                      <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                        Floor: Bot SELL tidak akan menjual di bawah harga ini.
                      </span>
                    </div>
                    <div>
                      <label className="text-red-200 block mb-1 font-semibold">
                        Max Sell Price Limit (IDR)
                      </label>
                      <input
                        type="text"
                        value={obSellMaxPrice}
                        onChange={e => setObSellMaxPrice(e.target.value)}
                        placeholder="Contoh: 1650000000 (Kosongkan jika tanpa batas)"
                        className="w-full bg-[#17212B] text-red-300 font-mono p-2 rounded border border-red-500/40 focus:border-red-400 outline-none"
                      />
                      <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                        Ceiling: Bot SELL tidak akan memasang ask di atas harga ini.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Random Min Quantity</label>
                  <input
                    type="text"
                    value={obRandomMinQty}
                    onChange={e => setObRandomMinQty(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Random Max Quantity</label>
                  <input
                    type="text"
                    value={obRandomMaxQty}
                    onChange={e => setObRandomMaxQty(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Price Decimal</label>
                  <input
                    type="number"
                    value={obPriceDecimal}
                    onChange={e => setObPriceDecimal(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Quantity Decimal</label>
                  <input
                    type="number"
                    value={obQtyDecimal}
                    onChange={e => setObQtyDecimal(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Split Order Mode</label>
                  <select
                    value={obSplitMode}
                    onChange={e => setObSplitMode(e.target.value as any)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  >
                    <option value="NONE">NONE</option>
                    <option value="RANDOM_SPLIT">RANDOM_SPLIT</option>
                  </select>
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Split Range</label>
                  <input
                    type="text"
                    value={obSplitRange}
                    onChange={e => setObSplitRange(e.target.value)}
                    disabled={obSplitMode === 'NONE'}
                    className={`w-full p-2 rounded border border-[#2B3944] ${obSplitMode === 'NONE' ? 'bg-[#111820] text-slate-600' : 'bg-[#17212B] text-white'}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Buy Trailing (Min % - Max %)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={obBuyTrailMin}
                      onChange={e => setObBuyTrailMin(e.target.value)}
                      placeholder="Min %"
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                    <input
                      type="text"
                      value={obBuyTrailMax}
                      onChange={e => setObBuyTrailMax(e.target.value)}
                      placeholder="Max %"
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Sell Trailing (Min % - Max %)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={obSellTrailMin}
                      onChange={e => setObSellTrailMin(e.target.value)}
                      placeholder="Min %"
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                    <input
                      type="text"
                      value={obSellTrailMax}
                      onChange={e => setObSellTrailMax(e.target.value)}
                      placeholder="Max %"
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Expire Time (Detik, 0 = GTC)</label>
                  <input
                    type="number"
                    value={obExpireTime}
                    onChange={e => setObExpireTime(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Jitter Timing (%)</label>
                  <input
                    type="number"
                    value={obJitterTiming}
                    onChange={e => setObJitterTiming(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Jitter Price (%)</label>
                  <input
                    type="number"
                    value={obJitterPrice}
                    onChange={e => setObJitterPrice(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#202B34]">
                <button
                  type="button"
                  onClick={() => setIsOrderBotModalOpen(false)}
                  className="px-4 py-2 bg-slate-700 text-white rounded text-xs"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded text-xs"
                >
                  Deploy Order Bot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE VOLUME BOT (Phase 9 exact fields) */}
      {isVolumeBotModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090D12]/80 p-4 overflow-y-auto">
          <div className="bg-[#111820] border border-[#202B34] rounded-[10px] max-w-2xl w-full p-6 text-[#E4EBEF] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#202B34]">
              <div>
                <h2 className="text-base font-bold text-white mb-0.5">Deploy New Volume Bot ({currentEnv})</h2>
                <p className="text-xs text-[#A1AFB8]">Bot volume wash-trading & likuiditas dua arah (Buy/Sell cross matched).</p>
              </div>
              <button
                type="button"
                onClick={() => setIsVolumeBotModalOpen(false)}
                className="text-[#A1AFB8] hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateVolumeBot} className="space-y-4 text-xs font-sans">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Bot Name</label>
                  <input
                    type="text"
                    value={vbName}
                    onChange={e => setVbName(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Trading Pair</label>
                  <select
                    value={vbPairId}
                    onChange={e => setVbPairId(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  >
                    {tradingPairs.map(p => (
                      <option key={p.id} value={p.id}>{p.id}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Target Stop Volume (IDR)</label>
                  <input
                    type="text"
                    value={vbVolIdrStop}
                    onChange={e => setVbVolIdrStop(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Priority</label>
                  <select
                    value={vbPriority}
                    onChange={e => setVbPriority(e.target.value as any)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  >
                    <option value="RANDOM">random</option>
                    <option value="HIGH">high</option>
                    <option value="NORMAL">normal</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Random Min Quantity</label>
                  <input
                    type="text"
                    value={vbRandomMinQty}
                    onChange={e => setVbRandomMinQty(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Random Max Quantity</label>
                  <input
                    type="text"
                    value={vbRandomMaxQty}
                    onChange={e => setVbRandomMaxQty(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Volume Price Decimal</label>
                  <input
                    type="number"
                    value={vbPriceDecimal}
                    onChange={e => setVbPriceDecimal(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Volume Quantity Decimal</label>
                  <input
                    type="number"
                    value={vbQtyDecimal}
                    onChange={e => setVbQtyDecimal(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Scheduling Delay (Min - Max Detik)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={vbMinDelay}
                      onChange={e => setVbMinDelay(e.target.value)}
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                    <input
                      type="number"
                      value={vbMaxDelay}
                      onChange={e => setVbMaxDelay(e.target.value)}
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Difference Spread (Min - Max)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={vbMinDiff}
                      onChange={e => setVbMinDiff(e.target.value)}
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                    <input
                      type="text"
                      value={vbMaxDiff}
                      onChange={e => setVbMaxDiff(e.target.value)}
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Min Limit Price (IDR)</label>
                  <input
                    type="text"
                    value={vbMinLimitPrice}
                    onChange={e => setVbMinLimitPrice(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Max Limit Price (IDR)</label>
                  <input
                    type="text"
                    value={vbMaxLimitPrice}
                    onChange={e => setVbMaxLimitPrice(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Vol IDR Start Threshold</label>
                  <input
                    type="text"
                    value={vbVolIdrStart}
                    onChange={e => setVbVolIdrStart(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Volume Sell Account ID (Default: None)</label>
                  <input
                    type="text"
                    value={vbSellAccountId}
                    onChange={e => setVbSellAccountId(e.target.value)}
                    placeholder="None"
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#202B34]">
                <button
                  type="button"
                  onClick={() => setIsVolumeBotModalOpen(false)}
                  className="px-4 py-2 bg-slate-700 text-white rounded text-xs"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded text-xs"
                >
                  Deploy Volume Bot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE VOLUME SPREAD BOT (Phase 2 — Inside Spread Self-Cross) */}
      {isVolumeSpreadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090D12]/80 p-4 overflow-y-auto">
          <div className="bg-[#111820] border border-[#202B34] rounded-[10px] max-w-2xl w-full p-6 text-[#E4EBEF] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#202B34]">
              <div>
                <h2 className="text-base font-semibold text-[#E4EBEF] mb-0.5">
                  Deploy Volume Bot Phase 2 — Antar Spread ({currentEnv})
                </h2>
                <p className="text-xs text-[#A1AFB8]">
                  Maker GTC &amp; Taker IOC mengeksekusi tepat di dalam spread Bid-Ask (makan order sendiri antar spread tanpa menyapu order luar).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsVolumeSpreadModalOpen(false)}
                className="text-[#A1AFB8] hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateVolumeSpreadBot} className="space-y-4 text-xs font-sans">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Nama Bot</label>
                  <input
                    type="text"
                    value={vsbName}
                    onChange={e => setVsbName(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Trading Pair</label>
                  <select
                    value={vsbPairId}
                    onChange={e => {
                      const nextPairId = e.target.value;
                      setVsbPairId(nextPairId);
                      const p = tradingPairs.find(item => item.id === nextPairId);
                      if (p && safeBigInt(p.lastPrice) > 0n) {
                        const last = safeBigInt(p.lastPrice);
                        const dec = p.quoteDecimals;
                        const div = 10n ** BigInt(dec);
                        const floorStr = ((last * 70n) / 100n / div).toString();
                        const ceilStr = ((last * 130n) / 100n / div).toString();
                        if (floorStr !== '0' && ceilStr !== '0') {
                          setVsbMinLimitPrice(floorStr);
                          setVsbMaxLimitPrice(ceilStr);
                        }
                      }
                    }}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  >
                    {tradingPairs.map(p => (
                      <option key={p.id} value={p.id}>{p.id}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Mode Penempatan Spread</label>
                  <select
                    value={vsbSpreadMode}
                    onChange={e => setVsbSpreadMode(e.target.value as any)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  >
                    <option value="INSIDE_SPREAD">Inside Spread (Acak dalam rentang %)</option>
                    <option value="MIDPOINT_JITTER">Midpoint Jitter (Dekat titik tengah)</option>
                    <option value="PING_PONG_EDGE">Ping-Pong Edge (Dekat sisi Bid/Ask)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Pola Arah Makan Order</label>
                  <select
                    value={vsbSidePattern}
                    onChange={e => setVsbSidePattern(e.target.value as any)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  >
                    <option value="ALTERNATE">Alternate (Bergantian Buy/Sell)</option>
                    <option value="RANDOM">Random (Acak Buy/Sell)</option>
                    <option value="BUY_EATS_SELL">Buy Eats Sell (Maker Sell, Taker Buy)</option>
                    <option value="SELL_EATS_BUY">Sell Eats Buy (Maker Buy, Taker Sell)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Random Min Quantity</label>
                  <input
                    type="text"
                    value={vsbMinQty}
                    onChange={e => setVsbMinQty(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Random Max Quantity</label>
                  <input
                    type="text"
                    value={vsbMaxQty}
                    onChange={e => setVsbMaxQty(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Inside-Spread Band Min - Max (%)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={vsbBandMinPct}
                      onChange={e => setVsbBandMinPct(e.target.value)}
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                    />
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={vsbBandMaxPct}
                      onChange={e => setVsbBandMaxPct(e.target.value)}
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Jeda Taker Makan Maker (ms, 0 = instan)</label>
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    value={vsbCrossDelayMs}
                    onChange={e => setVsbCrossDelayMs(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Interval Siklus (Min - Max Detik)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={vsbMinDelay}
                      onChange={e => setVsbMinDelay(e.target.value)}
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                    />
                    <input
                      type="number"
                      min={1}
                      value={vsbMaxDelay}
                      onChange={e => setVsbMaxDelay(e.target.value)}
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Min Book Spread / Fallback Half (bps)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={vsbMinSpreadBps}
                      onChange={e => setVsbMinSpreadBps(e.target.value)}
                      placeholder="Min Spread bps"
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                    />
                    <input
                      type="number"
                      min={1}
                      value={vsbFallbackHalfSpreadBps}
                      onChange={e => setVsbFallbackHalfSpreadBps(e.target.value)}
                      placeholder="Fallback bps"
                      className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Min Limit Price (Floor)</label>
                  <input
                    type="text"
                    value={vsbMinLimitPrice}
                    onChange={e => setVsbMinLimitPrice(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Max Limit Price (Ceiling)</label>
                  <input
                    type="text"
                    value={vsbMaxLimitPrice}
                    onChange={e => setVsbMaxLimitPrice(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Target Stop Volume (Quote)</label>
                  <input
                    type="text"
                    value={vsbVolQuoteStop}
                    onChange={e => setVsbVolQuoteStop(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Tick Size (Opsional)</label>
                  <input
                    type="text"
                    value={vsbTickSize}
                    onChange={e => setVsbTickSize(e.target.value)}
                    placeholder="Auto dari market"
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Akun Maker Lawan (Opsional)</label>
                  <input
                    type="text"
                    value={vsbCounterpartyAccountId}
                    onChange={e => setVsbCounterpartyAccountId(e.target.value)}
                    placeholder="Kosong = Akun Sendiri"
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-[#E4EBEF] cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={vsbRequireTwoSided}
                  onChange={e => setVsbRequireTwoSided(e.target.checked)}
                  className="rounded border-[#2B3944] bg-[#17212B]"
                />
                <span>Wajibkan Order Book 2 Sisi Aktif (Jeda jika salah satu sisi Bid/Ask kosong atau spread &lt; Min Spread bps)</span>
              </label>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#202B34]">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsVolumeSpreadModalOpen(false)}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isLoading}
                >
                  Deploy Volume Bot Phase 2
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE PRICE FOLLOWER BOT */}
      {isPriceFollowerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090D12]/80 p-4 overflow-y-auto">
          <div className="bg-[#111820] border border-[#202B34] rounded-[10px] max-w-2xl w-full p-6 text-[#E4EBEF] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#202B34]">
              <div>
                <h2 className="text-base font-bold text-white mb-0.5">Deploy Price Follower Bot ({currentEnv})</h2>
                <p className="text-xs text-[#A1AFB8]">Bot otomatis yang menempatkan Limit Buy & Sell mengikuti feed harga eksternal.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsPriceFollowerModalOpen(false)}
                className="text-[#A1AFB8] hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePriceFollower} className="space-y-4 text-xs font-sans">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Bot Name</label>
                  <input
                    type="text"
                    value={pfName}
                    onChange={e => setPfName(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Trading Pair</label>
                  <select
                    value={pfPairId}
                    onChange={e => setPfPairId(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  >
                    {tradingPairs.map(p => (
                      <option key={p.id} value={p.id}>{p.id}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Reference Feed Provider</label>
                  <select
                    value={pfProvider}
                    onChange={e => setPfProvider(e.target.value as any)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  >
                    <option value="AGGREGATED">AGGREGATED (Binance + Bybit + CMC)</option>
                    <option value="BINANCE">BINANCE SPOT ONLY</option>
                    <option value="BYBIT">BYBIT SPOT ONLY</option>
                    <option value="COINMARKETCAP">COINMARKETCAP ONLY</option>
                  </select>
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Order Quantity (Base Asset)</label>
                  <input
                    type="text"
                    value={pfOrderQty}
                    onChange={e => setPfOrderQty(e.target.value)}
                    required
                    placeholder="e.g. 0.02"
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Buy Offset (bps below reference)</label>
                  <input
                    type="number"
                    value={pfBuyOffsetBps}
                    onChange={e => setPfBuyOffsetBps(e.target.value)}
                    min="0"
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono"
                  />
                  <span className="text-[10px] text-[#71818B] mt-0.5 block">20 bps = 0.20% di bawah harga acuan</span>
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Sell Offset (bps above reference)</label>
                  <input
                    type="number"
                    value={pfSellOffsetBps}
                    onChange={e => setPfSellOffsetBps(e.target.value)}
                    min="0"
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono"
                  />
                  <span className="text-[10px] text-[#71818B] mt-0.5 block">20 bps = 0.20% di atas harga acuan</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Minimum Reprice Interval (ms)</label>
                  <input
                    type="number"
                    value={pfRepriceInterval}
                    onChange={e => setPfRepriceInterval(e.target.value)}
                    min="1000"
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono"
                  />
                  <span className="text-[10px] text-[#71818B] mt-0.5 block">Mencegah churn cancel/replace berlebihan</span>
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Minimum Price Change Threshold (bps)</label>
                  <input
                    type="number"
                    value={pfMinPriceChangeBps}
                    onChange={e => setPfMinPriceChangeBps(e.target.value)}
                    min="1"
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono"
                  />
                  <span className="text-[10px] text-[#71818B] mt-0.5 block">Reprice hanya jika pergerakan &ge; X bps</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="pfDryRun"
                  checked={pfDryRun}
                  onChange={e => setPfDryRun(e.target.checked)}
                  className="rounded bg-[#17212B] border-[#2B3944] text-emerald-600"
                />
                <label htmlFor="pfDryRun" className="text-[#E4EBEF] cursor-pointer">
                  Dry-Run Mode (Simulasi kalkulasi harga & log tanpa submit order ke Matching Engine)
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#202B34]">
                <button
                  type="button"
                  onClick={() => setIsPriceFollowerModalOpen(false)}
                  className="px-4 py-2 bg-slate-700 text-white rounded text-xs"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded text-xs"
                >
                  Deploy Price Follower Bot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: LIQUIDITY PROVISION CONFIGURATION (DEPTH & LIQUIDITY BOT) */}
      {isDepthLiquidityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090D12]/80 p-4 overflow-y-auto">
          <div className="bg-[#111820] border border-[#202B34] rounded-[10px] max-w-3xl w-full p-6 text-[#E4EBEF] max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#202B34]">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white flex items-center gap-1.5">
                    Konfigurasi Penyediaan Likuiditas (Liquidity Provision Configuration)
                  </h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    {currentEnv}
                  </span>
                </div>
                <p className="text-xs text-[#A1AFB8] mt-0.5">
                  Generate instance bot depth baru untuk pair trading spesifik dengan kontrol rentang mandiri (Custom Pricing Mode), jarak tangga (anti-stacking), dan manajemen inventaris.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDepthLiquidityModalOpen(false)}
                className="text-[#A1AFB8] hover:text-white text-lg font-bold p-1 rounded hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateDepthLiquidity} className="space-y-4 text-xs font-sans">
              {/* SECTION 1: IDENTITY & PAIR */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#E4EBEF] block mb-1 font-semibold">Bot Instance Name</label>
                  <input
                    type="text"
                    value={dlName}
                    onChange={e => setDlName(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] focus:border-purple-400 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[#E4EBEF] block mb-1 font-semibold">Trading Pair (Target Market)</label>
                  <select
                    value={dlPairId}
                    onChange={e => handleDlPairChange(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] focus:border-purple-400 outline-none"
                  >
                    {tradingPairs.map(p => (
                      <option key={p.id} value={p.id}>{p.id} ({p.quoteCurrency})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* QUICK PRESETS BAR */}
              <div className="p-2.5 bg-[#131b2a] border border-purple-500/30 rounded-[7px] space-y-2">
                <span className="text-[11px] font-bold text-purple-300 block">
                  Preset Cepat Depth & Liquidity (Pilih Sesuai Karakter Pasar):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setDlPriceMode('CUSTOM_BOUNDS');
                      setDlSpacingMode('LINEAR');
                      const activePair = tradingPairs.find(p => p.id === dlPairId);
                      const isUsdtQuote = activePair?.quoteCurrency === 'USDT' || dlPairId.endsWith('-USDT');
                      if (isUsdtQuote) {
                        setDlMinBuyPrice('0.85');
                        setDlMaxBuyPrice('0.98');
                        setDlMinSellPrice('1.02');
                        setDlMaxSellPrice('1.20');
                        setDlLevelSpacingIdr('0.02');
                      } else {
                        const mid = dlPairId === 'DOGE-IDR' ? 2600 : dlPairId === 'ADA-IDR' ? 12000 : 1000;
                        setDlMinBuyPrice(String(Math.round(mid * 0.90)));
                        setDlMaxBuyPrice(String(Math.round(mid * 0.98)));
                        setDlMinSellPrice(String(Math.round(mid * 1.02)));
                        setDlMaxSellPrice(String(Math.round(mid * 1.15)));
                        setDlLevelSpacingIdr(String(Math.max(1, Math.round(mid * 0.02))));
                      }
                    }}
                    className="px-2.5 py-1 bg-purple-900/60 hover:bg-purple-800 text-purple-200 text-[10px] font-semibold rounded border border-purple-500/40 transition-colors"
                  >
                    Token Baru / New Listing (Custom Bounds)
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setDlPriceMode('CUSTOM_BOUNDS');
                      setDlSpacingMode('GEOMETRIC');
                      setDlMinBuyPrice(dlPairId === 'BTC-IDR' ? '1380000000' : '45000000');
                      setDlMaxBuyPrice(dlPairId === 'BTC-IDR' ? '1445000000' : '48000000');
                      setDlMinSellPrice(dlPairId === 'BTC-IDR' ? '1455000000' : '49000000');
                      setDlMaxSellPrice(dlPairId === 'BTC-IDR' ? '1520000000' : '52000000');
                    }}
                    className="px-2.5 py-1 bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 text-[10px] font-semibold rounded border border-indigo-500/40 transition-colors"
                  >
                    Deep Protection (Geometric Ladder)
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setDlPriceMode('CUSTOM_BOUNDS');
                      setDlSpacingMode('CONCENTRATED');
                      setDlPairId('USDT-IDR');
                      setDlMinBuyPrice('16250');
                      setDlMaxBuyPrice('16420');
                      setDlMinSellPrice('16480');
                      setDlMaxSellPrice('16650');
                      setDlLevelSpacingIdr('30');
                    }}
                    className="px-2.5 py-1 bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 text-[10px] font-semibold rounded border border-emerald-500/40 transition-colors"
                  >
                    USDT/IDR Tight Spread
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setDlPriceMode('EXTERNAL_REFERENCE');
                      setDlSource('AGGREGATED');
                      setDlSpacingMode('PERCENT_BPS');
                    }}
                    className="px-2.5 py-1 bg-blue-900/60 hover:bg-blue-800 text-blue-200 text-[10px] font-semibold rounded border border-blue-500/40 transition-colors"
                  >
                    External Feed Tracker (Binance/Bybit)
                  </button>
                </div>
              </div>

              {/* SECTION 2: CUSTOM PRICING MODE TOGGLE & PRICE RANGE INPUTS */}
              <div className="p-3 bg-[#0d1424] border border-purple-500/40 rounded-[10px] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    {/* Explicit toggle switch */}
                    <button
                      type="button"
                      onClick={() => setDlPriceMode(dlPriceMode === 'CUSTOM_BOUNDS' ? 'EXTERNAL_REFERENCE' : 'CUSTOM_BOUNDS')}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        dlPriceMode === 'CUSTOM_BOUNDS' ? 'bg-purple-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          dlPriceMode === 'CUSTOM_BOUNDS' ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <div>
                      <span className="text-xs font-bold text-white flex items-center gap-2">
                        <span>Toggle Custom Pricing Mode</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                          dlPriceMode === 'CUSTOM_BOUNDS'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                            : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                        }`}>
                          {dlPriceMode === 'CUSTOM_BOUNDS' ? 'AKTIF (Otonom / Tanpa Feed)' : 'NONAKTIF (Feed Eksternal)'}
                        </span>
                      </span>
                      <p className="text-[10px] text-[#A1AFB8]">
                        {dlPriceMode === 'CUSTOM_BOUNDS'
                          ? 'Menggantikan ketergantungan harga eksternal sepenuhnya. Anda menentukan batas Min/Max beli & jual secara bebas.'
                          : 'Mengikuti pergerakan harga spot bursa Binance/Bybit/CoinMarketCap via USDT/IDR FX Conversion Engine.'}
                      </p>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono text-purple-400">
                    {dlPriceMode === 'CUSTOM_BOUNDS' ? 'Mode: Autonomous MM' : 'Mode: Market Tracker'}
                  </span>
                </div>

                {/* IF CUSTOM BOUNDS: 4-GRID INPUTS */}
                {dlPriceMode === 'CUSTOM_BOUNDS' ? (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                        Batas Harga Manual (Min/Max Limit Buy & Sell)
                      </span>
                      {(() => {
                        const minB = parseFloat(dlMinBuyPrice) || 0;
                        const maxB = parseFloat(dlMaxBuyPrice) || 0;
                        const minS = parseFloat(dlMinSellPrice) || 0;
                        const maxS = parseFloat(dlMaxSellPrice) || 0;
                        const spread = minS - maxB;
                        const isSpreadValid = spread > 0 && maxB >= minB && maxS >= minS;
                        const spreadPct = maxB > 0 ? ((spread / maxB) * 100).toFixed(2) : '0';
                        const activeDlPair = tradingPairs.find(p => p.id === dlPairId);
                        const isUsdtQuote = activeDlPair?.quoteCurrency === 'USDT' || dlPairId.endsWith('-USDT');
                        return (
                          <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded border ${
                            isSpreadValid ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40' : 'bg-red-950/80 text-red-400 border-red-500/40'
                          }`}>
                            {isSpreadValid ? `Spread Valid: ${isUsdtQuote ? `$${spread.toFixed(4)}` : `Rp ${spread.toLocaleString('id-ID')}`} (${spreadPct}%)` : '⚠️ Warning: Max Buy harus lebih rendah dari Min Sell'}
                          </span>
                        );
                      })()}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div>
                        <label className="text-[11px] text-emerald-400 font-semibold block mb-1">
                          Min Limit Buy Price
                        </label>
                        <input
                          type="text"
                          value={dlMinBuyPrice}
                          onChange={e => setDlMinBuyPrice(e.target.value)}
                          placeholder="e.g. 15000"
                          required
                          className="w-full bg-[#17212B] text-emerald-400 font-mono p-2 rounded border border-emerald-500/40 text-xs focus:border-emerald-400 outline-none"
                        />
                        <span className="text-[9px] text-[#71818B] mt-0.5 block">Bid terbawah tangga (Floor)</span>
                      </div>

                      <div>
                        <label className="text-[11px] text-emerald-300 font-semibold block mb-1">
                          Max Limit Buy Price
                        </label>
                        <input
                          type="text"
                          value={dlMaxBuyPrice}
                          onChange={e => setDlMaxBuyPrice(e.target.value)}
                          placeholder="e.g. 16200"
                          required
                          className="w-full bg-[#17212B] text-emerald-300 font-mono p-2 rounded border border-emerald-500/40 text-xs focus:border-emerald-400 outline-none"
                        />
                        <span className="text-[9px] text-[#71818B] mt-0.5 block">Bid teratas / dekat spread</span>
                      </div>

                      <div>
                        <label className="text-[11px] text-red-300 font-semibold block mb-1">
                          Min Limit Sell Price
                        </label>
                        <input
                          type="text"
                          value={dlMinSellPrice}
                          onChange={e => setDlMinSellPrice(e.target.value)}
                          placeholder="e.g. 16500"
                          required
                          className="w-full bg-[#17212B] text-red-300 font-mono p-2 rounded border border-red-500/40 text-xs focus:border-red-400 outline-none"
                        />
                        <span className="text-[9px] text-[#71818B] mt-0.5 block">Ask terendah / dekat spread</span>
                      </div>

                      <div>
                        <label className="text-[11px] text-red-400 font-semibold block mb-1">
                          Max Limit Sell Price
                        </label>
                        <input
                          type="text"
                          value={dlMaxSellPrice}
                          onChange={e => setDlMaxSellPrice(e.target.value)}
                          placeholder="e.g. 18000"
                          required
                          className="w-full bg-[#17212B] text-red-400 font-mono p-2 rounded border border-red-500/40 text-xs focus:border-red-400 outline-none"
                        />
                        <span className="text-[9px] text-[#71818B] mt-0.5 block">Ask teratas tangga (Ceiling)</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 p-3 bg-blue-950/20 border border-blue-500/30 rounded-[7px]">
                    <div>
                      <label className="text-[#E4EBEF] block mb-1 font-semibold">Reference Price Source</label>
                      <select
                        value={dlSource}
                        onChange={e => setDlSource(e.target.value as any)}
                        className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] text-xs"
                      >
                        <option value="AGGREGATED">AGGREGATED (Konsensus Gabungan)</option>
                        <option value="BINANCE">BINANCE (Binance Spot)</option>
                        <option value="BYBIT">BYBIT (Bybit Spot)</option>
                        <option value="COINMARKETCAP">COINMARKETCAP (CMC Official)</option>
                      </select>
                    </div>
                    <div>
                      <span className="text-[#A1AFB8] text-[11px] block mb-1">Status Kurs FX DIMONEX</span>
                      <div className="p-2 bg-[#17212B] rounded border border-[#2B3944] text-xs font-mono text-emerald-400 flex items-center justify-between">
                        <span>1 USDT = Rp {Number(fxData?.rate || 16350).toLocaleString('id-ID')}</span>
                        <span className="text-[10px] text-[#A1AFB8]">Aktif & Fresh</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 3: SPACING LADDER DISTRIBUTION & STEP SIZES */}
              <div className="p-3 bg-purple-950/30 border border-purple-500/30 rounded-[7px] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-300 uppercase tracking-wide flex items-center gap-1.5">
                    Mode Distribusi Jarak Tangga (Spacing Ladder Mode)
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="dlAntiStacking"
                      checked={dlAntiStacking}
                      onChange={e => setDlAntiStacking(e.target.checked)}
                      className="rounded bg-[#17212B] border-[#2B3944] text-purple-600"
                    />
                    <label htmlFor="dlAntiStacking" className="text-[11px] text-emerald-400 font-semibold cursor-pointer">
                      Anti-Numpuk / Anti-Stacking Aktif
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-purple-200 block mb-1 font-semibold">Mode Distribusi Level</label>
                    <select
                      value={dlSpacingMode}
                      onChange={e => setDlSpacingMode(e.target.value as any)}
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-purple-500/40 text-xs"
                    >
                      <option value="LINEAR">LINEAR (Jarak Tangga Rata & Proporsional - Rekomendasi)</option>
                      <option value="GEOMETRIC">GEOMETRIC (Jarak Melebar ke Pinggir - Proteksi Risiko)</option>
                      <option value="CONCENTRATED">CONCENTRATED (Likuiditas Padat Dekat Spread)</option>
                      <option value="FIXED_IDR">FIXED_STEP (Jarak Nominal Tetap per Level)</option>
                      <option value="PERCENT_BPS">PERCENT_BPS (Basis Points Offset Dinamis)</option>
                    </select>
                    <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                      {dlSpacingMode === 'LINEAR' && 'Level order terbagi rata secara linier antara batas Min dan Max.'}
                      {dlSpacingMode === 'GEOMETRIC' && 'Rung makin rapat dekat spread, dan makin renggang menjauh untuk kedalaman buku order aman.'}
                      {dlSpacingMode === 'CONCENTRATED' && 'Likuiditas tebal berkonsentrasi di level terdekat dari spread.'}
                      {dlSpacingMode === 'FIXED_IDR' && 'Jarak antar level konstan sesuai angka nominal di samping.'}
                      {dlSpacingMode === 'PERCENT_BPS' && 'Offset bertingkat berdasarkan persentase BPS.'}
                    </span>
                  </div>

                  <div>
                    <label className="text-purple-200 block mb-1 font-semibold">
                      Jarak Nominal Step (Khusus FIXED_STEP)
                    </label>
                    <input
                      type="number"
                      value={dlLevelSpacingIdr}
                      onChange={e => setDlLevelSpacingIdr(e.target.value)}
                      min="1"
                      disabled={dlSpacingMode !== 'FIXED_IDR'}
                      placeholder={dlPairId === 'BTC-IDR' ? '1000000' : dlPairId === 'ETH-IDR' ? '100000' : '60'}
                      className="w-full bg-[#17212B] text-purple-300 font-mono p-2 rounded border border-purple-500/40 text-xs disabled:opacity-40"
                    />
                    <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                      Jarak tiap order berurutan saat menggunakan mode Fixed Step.
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Number of Bid Levels (Beli)</label>
                    <input
                      type="number"
                      value={dlNumBids}
                      onChange={e => setDlNumBids(e.target.value)}
                      min="1"
                      max="20"
                      required
                      className="w-full bg-[#17212B] text-emerald-400 font-mono p-2 rounded border border-[#2B3944] text-xs"
                    />
                    <span className="text-[10px] text-[#71818B] mt-0.5 block">Maksimal 20 level bertingkat</span>
                  </div>
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Number of Ask Levels (Jual)</label>
                    <input
                      type="number"
                      value={dlNumAsks}
                      onChange={e => setDlNumAsks(e.target.value)}
                      min="1"
                      max="20"
                      required
                      className="w-full bg-[#17212B] text-red-400 font-mono p-2 rounded border border-[#2B3944] text-xs"
                    />
                    <span className="text-[10px] text-[#71818B] mt-0.5 block">Maksimal 20 level bertingkat</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Bid Quantities ({dlPairId.split('-')[0]} per level)</label>
                    <input
                      type="text"
                      value={dlBidQuantities}
                      onChange={e => setDlBidQuantities(e.target.value)}
                      placeholder="e.g. 10.0, 20.0, 30.0, 40.0, 50.0"
                      required
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Ask Quantities ({dlPairId.split('-')[0]} per level)</label>
                    <input
                      type="text"
                      value={dlAskQuantities}
                      onChange={e => setDlAskQuantities(e.target.value)}
                      placeholder="e.g. 10.0, 20.0, 30.0, 40.0, 50.0"
                      required
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 4: INVENTORY MANAGEMENT PARAMETERS */}
              <div className="p-3 bg-[#0a101d] border border-blue-500/30 rounded-[7px] space-y-3">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                  <span className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                    Parameter Manajemen Inventaris & Batas Risiko (Inventory Controls)
                  </span>
                  <span className="text-[10px] text-[#A1AFB8]">Proteksi Saldo & Volume Bursa</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[11px] text-[#E4EBEF] block mb-1 font-semibold">
                      Max Inventory ({dlPairId.split('-')[0]})
                    </label>
                    <input
                      type="text"
                      value={dlMaxInventory}
                      onChange={e => setDlMaxInventory(e.target.value)}
                      placeholder="1000.0"
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                    <span className="text-[9px] text-[#71818B] mt-0.5 block">Batas stok koin dasar</span>
                  </div>

                  <div>
                    <label className="text-[11px] text-[#E4EBEF] block mb-1 font-semibold">
                      Max Total Bid Value ({dlPairId.split('-')[1] || 'IDR'})
                    </label>
                    <input
                      type="text"
                      value={dlMaxTotalBidValIdr}
                      onChange={e => setDlMaxTotalBidValIdr(e.target.value)}
                      placeholder="500000000"
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                    <span className="text-[9px] text-[#71818B] mt-0.5 block">Total komitmen beli</span>
                  </div>

                  <div>
                    <label className="text-[11px] text-[#E4EBEF] block mb-1 font-semibold">
                      Max Total Ask Qty ({dlPairId.split('-')[0]})
                    </label>
                    <input
                      type="text"
                      value={dlMaxTotalAskQty}
                      onChange={e => setDlMaxTotalAskQty(e.target.value)}
                      placeholder="500.0"
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                    <span className="text-[9px] text-[#71818B] mt-0.5 block">Total komitmen jual</span>
                  </div>

                  <div>
                    <label className="text-[11px] text-[#E4EBEF] block mb-1 font-semibold">
                      Max Open Orders
                    </label>
                    <input
                      type="number"
                      value={dlMaxOpenOrders}
                      onChange={e => setDlMaxOpenOrders(e.target.value)}
                      min="1"
                      max="100"
                      placeholder="20"
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                    <span className="text-[9px] text-[#71818B] mt-0.5 block">Order aktif maksimum</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-[11px] text-[#E4EBEF] block mb-1 font-semibold">
                      Custom Tick Size (Opsional)
                    </label>
                    <input
                      type="text"
                      value={dlTickSize}
                      onChange={e => setDlTickSize(e.target.value)}
                      placeholder={dlPairId === 'USDT-IDR' ? '1' : dlPairId.endsWith('-USDT') ? '0.01' : '10'}
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                    <span className="text-[9px] text-[#71818B] mt-0.5 block">Kelipatan harga minimum (tick size)</span>
                  </div>

                  <div>
                    <label className="text-[11px] text-[#E4EBEF] block mb-1 font-semibold">
                      Minimum Lot Size
                    </label>
                    <input
                      type="text"
                      value={dlLotSize}
                      onChange={e => setDlLotSize(e.target.value)}
                      placeholder="0.0001"
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                    <span className="text-[9px] text-[#71818B] mt-0.5 block">Satuan ukuran terkecil per order</span>
                  </div>
                </div>
              </div>

              {/* SECTION 5: EXACT PREVIEW GUARANTEE & COOLDOWN REFRESH */}
              <div className="p-3 bg-purple-950/25 border border-purple-500/30 rounded-[7px] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-purple-500/20">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-purple-300">
                      Jaminan Presisi & Penempatan Order
                    </span>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-semibold">
                    {dlExactPlacement ? '100% Persis dengan Tabel Preview' : 'Micro-Jitter Aktif'}
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-[#131b2a] rounded border border-purple-500/30">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      id="dlExactPlacement"
                      checked={dlExactPlacement}
                      onChange={e => {
                        const checked = e.target.checked;
                        setDlExactPlacement(checked);
                        if (checked) {
                          setDlRandomizePlacement(false);
                          setDlPriceRandomizationTicks('0');
                        }
                      }}
                      className="h-4 w-4 rounded bg-[#17212B] border-[#2B3944] text-purple-600 cursor-pointer"
                    />
                    <div>
                      <label htmlFor="dlExactPlacement" className="text-xs text-white font-bold cursor-pointer">
                        Mode Penempatan Presisi (Persis Sama 100% dengan Preview)
                      </label>
                      <p className="text-[10px] text-[#A1AFB8]">
                        Menonaktifkan pergeseran harga acak (Jitter = 0). Order yang dipasang di matching engine dijamin sama persis dengan angka preview.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-purple-200 block mb-1 font-semibold">
                      Liquidity Refresh Cooldown (detik)
                    </label>
                    <input
                      type="number"
                      value={dlRefreshCooldownSec}
                      onChange={e => setDlRefreshCooldownSec(e.target.value)}
                      min="3"
                      max="300"
                      required
                      className="w-full bg-[#17212B] text-purple-300 font-mono p-2 rounded border border-purple-500/40 text-xs"
                    />
                    <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                      Jeda sebelum rotasi ladder anti-stacking berikutnya (Default 10s).
                    </span>
                  </div>

                  <div>
                    <label className="text-purple-200 block mb-1 font-semibold">
                      Price Jitter (Ticks)
                    </label>
                    <input
                      type="number"
                      value={dlExactPlacement ? '0' : dlPriceRandomizationTicks}
                      onChange={e => setDlPriceRandomizationTicks(e.target.value)}
                      min="0"
                      max="10"
                      disabled={dlExactPlacement}
                      className="w-full bg-[#17212B] text-purple-300 font-mono p-2 rounded border border-purple-500/40 text-xs disabled:opacity-40"
                    />
                    <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                      {dlExactPlacement ? 'Terkunci 0 tick (Presisi Penuh)' : `Variasi ±${dlPriceRandomizationTicks} ticks`}
                    </span>
                  </div>
                </div>
              </div>

              {/* SECTION 6: INTERACTIVE LIVE LADDER PREVIEW (100% IDENTICAL TO ORDER OUTPUT) */}
              {(() => {
                const activeDlPair = tradingPairs.find(p => p.id === dlPairId);
                const isUsdtQuote = activeDlPair?.quoteCurrency === 'USDT' || dlPairId.endsWith('-USDT');
                const quoteCurr = activeDlPair?.quoteCurrency || (isUsdtQuote ? 'USDT' : 'IDR');
                const baseAsset = dlPairId.split('-')[0] || '';
                const defaultPairTick = isUsdtQuote ? 0.01 : (dlPairId === 'USDT-IDR' ? 1 : dlPairId === 'ETH-IDR' ? 100 : 1000);
                const pairTickSize = dlTickSize ? parseFloat(dlTickSize) || defaultPairTick : defaultPairTick;

                const numBids = Math.min(20, Math.max(1, parseInt(dlNumBids, 10) || 5));
                const numAsks = Math.min(20, Math.max(1, parseInt(dlNumAsks, 10) || 5));

                const parsedBidQtys = dlBidQuantities.split(',').map(s => s.trim()).filter(Boolean);
                const parsedAskQtys = dlAskQuantities.split(',').map(s => s.trim()).filter(Boolean);

                let previewBids: Array<{ level: number; price: number; qty: string; totalVal: number; offset: number }> = [];
                let previewAsks: Array<{ level: number; price: number; qty: string; totalVal: number; offset: number }> = [];

                if (dlPriceMode === 'CUSTOM_BOUNDS') {
                  const minB = parseFloat(dlMinBuyPrice) || 0;
                  const maxB = parseFloat(dlMaxBuyPrice) || 0;
                  const minS = parseFloat(dlMinSellPrice) || 0;
                  const maxS = parseFloat(dlMaxSellPrice) || 0;
                  const spacingStep = parseFloat(dlLevelSpacingIdr) || 60;

                  // Bids: from maxB down to minB
                  for (let i = 0; i < numBids; i++) {
                    const frac = numBids > 1 ? i / (numBids - 1) : 0;
                    let bp = 0;
                    if (dlSpacingMode === 'GEOMETRIC') {
                      bp = maxB - Math.pow(frac, 1.6) * (maxB - minB);
                    } else if (dlSpacingMode === 'CONCENTRATED') {
                      bp = maxB - Math.pow(frac, 0.65) * (maxB - minB);
                    } else if (dlSpacingMode === 'FIXED_IDR') {
                      bp = maxB - i * spacingStep;
                    } else {
                      // LINEAR
                      bp = maxB - frac * (maxB - minB);
                    }
                    bp = Math.min(maxB, Math.max(minB, bp));
                    bp = Math.round(bp / pairTickSize) * pairTickSize;
                    if (bp <= 0) bp = pairTickSize;

                    const qty = parsedBidQtys[i < parsedBidQtys.length ? i : parsedBidQtys.length - 1] || '10.0';
                    const totalVal = bp * (parseFloat(qty) || 0);
                    previewBids.push({ level: i + 1, price: bp, qty, totalVal, offset: i === 0 ? 0 : Math.abs(bp - (previewBids[0]?.price || bp)) });
                  }

                  // Asks: from minS up to maxS
                  for (let i = 0; i < numAsks; i++) {
                    const frac = numAsks > 1 ? i / (numAsks - 1) : 0;
                    let sp = 0;
                    if (dlSpacingMode === 'GEOMETRIC') {
                      sp = minS + Math.pow(frac, 1.6) * (maxS - minS);
                    } else if (dlSpacingMode === 'CONCENTRATED') {
                      sp = minS + Math.pow(frac, 0.65) * (maxS - minS);
                    } else if (dlSpacingMode === 'FIXED_IDR') {
                      sp = minS + i * spacingStep;
                    } else {
                      // LINEAR
                      sp = minS + frac * (maxS - minS);
                    }
                    sp = Math.max(minS, Math.min(maxS, sp));
                    sp = Math.round(sp / pairTickSize) * pairTickSize;

                    // Anti-Crossing guarantee
                    if (previewBids.length > 0 && sp <= previewBids[0].price) {
                      sp = previewBids[0].price + pairTickSize;
                    }

                    const qty = parsedAskQtys[i < parsedAskQtys.length ? i : parsedAskQtys.length - 1] || '10.0';
                    const totalVal = sp * (parseFloat(qty) || 0);
                    previewAsks.push({ level: i + 1, price: sp, qty, totalVal, offset: i === 0 ? 0 : Math.abs(sp - (previewAsks[0]?.price || sp)) });
                  }
                } else {
                  // External reference preview
                  const feedRef = fxData?.referencePrices?.[dlPairId]?.effectiveIdrPrice;
                  const pairLast = activeDlPair && activeDlPair.lastPrice
                    ? Number(safeBigInt(activeDlPair.lastPrice)) / (10 ** (activeDlPair.quoteDecimals || (isUsdtQuote ? 4 : 2)))
                    : 0;
                  const ref = feedRef && feedRef > 0 ? feedRef : (pairLast > 0 ? pairLast : (dlPairId === 'BTC-IDR' ? 1450000000 : 16450));
                  const step = parseFloat(dlLevelSpacingIdr) || (dlPairId === 'BTC-IDR' ? 1000000 : 60);

                  for (let i = 0; i < numBids; i++) {
                    let bp = 0;
                    if (dlSpacingMode === 'FIXED_IDR') {
                      bp = ref - (i + 1) * step;
                    } else if (dlSpacingMode === 'GEOMETRIC') {
                      const bps = Math.round(15 * Math.pow(1.35, i));
                      bp = ref * (1 - bps / 10000);
                    } else {
                      const bps = (i + 1) * 25;
                      bp = ref * (1 - bps / 10000);
                    }
                    bp = Math.round(bp / pairTickSize) * pairTickSize;
                    const qty = parsedBidQtys[i < parsedBidQtys.length ? i : parsedBidQtys.length - 1] || '10.0';
                    previewBids.push({ level: i + 1, price: bp, qty, totalVal: bp * parseFloat(qty || '0'), offset: Math.abs(ref - bp) });
                  }

                  for (let i = 0; i < numAsks; i++) {
                    let sp = 0;
                    if (dlSpacingMode === 'FIXED_IDR') {
                      sp = ref + (i + 1) * step;
                    } else if (dlSpacingMode === 'GEOMETRIC') {
                      const bps = Math.round(15 * Math.pow(1.35, i));
                      sp = ref * (1 + bps / 10000);
                    } else {
                      const bps = (i + 1) * 25;
                      sp = ref * (1 + bps / 10000);
                    }
                    sp = Math.round(sp / pairTickSize) * pairTickSize;
                    const qty = parsedAskQtys[i < parsedAskQtys.length ? i : parsedAskQtys.length - 1] || '10.0';
                    previewAsks.push({ level: i + 1, price: sp, qty, totalVal: sp * parseFloat(qty || '0'), offset: Math.abs(sp - ref) });
                  }
                }

                const bestBid = previewBids[0]?.price || 0;
                const bestAsk = previewAsks[0]?.price || 0;
                const spreadVal = bestAsk - bestBid;
                const spreadPct = bestBid > 0 ? ((spreadVal / bestBid) * 100).toFixed(2) : '0';

                const formatPriceDisplay = (val: number) => {
                  if (isUsdtQuote) return `$${val.toFixed(pairTickSize < 0.01 ? 4 : 2)}`;
                  return `Rp ${val.toLocaleString('id-ID')}`;
                };

                return (
                  <div className="p-3 bg-[#0b111e] rounded-[10px] border border-purple-500/40 text-[11px] font-mono space-y-3">
                    <div className="flex flex-wrap items-center justify-between text-[#A1AFB8] pb-2 border-b border-slate-800 gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-sans font-bold text-slate-100 flex items-center gap-1.5">
                          Pratinjau Tangga Order ({numBids} Bids × {numAsks} Asks)
                        </span>
                        <span className="bg-purple-900/60 text-purple-300 px-2 py-0.5 rounded text-[10px] border border-purple-500/40">
                          {dlPriceMode === 'CUSTOM_BOUNDS' ? 'Custom Pricing Mode' : 'External Tracker'}
                        </span>
                        <span className="bg-indigo-900/60 text-indigo-300 px-2 py-0.5 rounded text-[10px]">
                          Mode: {dlSpacingMode}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[#E4EBEF] text-[10px]">
                          Spread: <strong className="text-emerald-400 font-bold">{formatPriceDisplay(spreadVal)} ({spreadPct}%)</strong>
                        </span>
                      </div>
                    </div>

                    {/* GUARANTEE BANNER */}
                    <div className="px-3 py-1.5 bg-emerald-950/40 border border-emerald-500/30 rounded text-[10px] text-emerald-300 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        
                        <strong>Jaminan Presisi 100%:</strong> Harga & kuantitas order yang dipasang ke Matching Engine akan sama persis dengan tabel preview di bawah.
                      </span>
                      <span className="font-mono text-emerald-400 font-bold">Anti-Numpuk: AKTIF</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* BUY LADDER */}
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-bold text-emerald-400 uppercase flex justify-between px-1">
                          <span>BIDS / BUY LADDER (Level 1 = Spread)</span>
                          <span>QTY ({baseAsset})</span>
                        </div>
                        <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                          {previewBids.map((b, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-[#131b2a] px-2.5 py-1.5 rounded text-[#E4EBEF] border border-emerald-500/10 hover:border-emerald-500/30 transition-colors">
                              <div>
                                <span className="text-emerald-400 font-bold text-xs">{formatPriceDisplay(b.price)}</span>
                                <span className="text-[#71818B] text-[9px] ml-1.5">Lvl {b.level} {idx === 0 ? '(Dekat Spread)' : `(-${formatPriceDisplay(b.offset)})`}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-white font-semibold">{b.qty}</span>
                                <span className="text-[9px] text-[#71818B] block">{formatPriceDisplay(b.totalVal)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* SELL LADDER */}
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-bold text-red-400 uppercase flex justify-between px-1">
                          <span>ASKS / SELL LADDER (Level 1 = Spread)</span>
                          <span>QTY ({baseAsset})</span>
                        </div>
                        <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                          {previewAsks.map((a, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-[#131b2a] px-2.5 py-1.5 rounded text-[#E4EBEF] border border-red-500/10 hover:border-red-500/30 transition-colors">
                              <div>
                                <span className="text-red-400 font-bold text-xs">{formatPriceDisplay(a.price)}</span>
                                <span className="text-[#71818B] text-[9px] ml-1.5">Lvl {a.level} {idx === 0 ? '(Dekat Spread)' : `(+${formatPriceDisplay(a.offset)})`}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-white font-semibold">{a.qty}</span>
                                <span className="text-[9px] text-[#71818B] block">{formatPriceDisplay(a.totalVal)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#202B34]">
                <button
                  type="button"
                  onClick={() => setIsDepthLiquidityModalOpen(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-6 py-2.5 bg-[#1D2832] hover:bg-[#222F3A] border border-[#40515D] text-white font-bold rounded text-xs shadow-lg transition-all"
                >
                  Simpan & Deploy Bot Penyedia Likuiditas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MOVEMENT DEPTH BOT CONFIGURATION (RELATIVE WS MOVEMENT FOLLOWER) */}
      {isMovementDepthModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090D12]/80 p-4 overflow-y-auto">
          <div className="bg-[#111820] border border-cyan-500/30 rounded-[10px] max-w-3xl w-full p-6 text-[#E4EBEF] max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#202B34]">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white flex items-center gap-1.5">
                    Konfigurasi Bot Depth Movement (WS Binance &amp; Bybit)
                  </h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    {currentEnv}
                  </span>
                </div>
                <p className="text-xs text-[#A1AFB8] mt-0.5">
                  Bot likuiditas multi-level yang mengikuti <strong>% pergerakan pasar</strong> dari pair WS acuan (kiblat market), sambil mempertahankan skala harga lokal token Anda sendiri.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsMovementDepthModalOpen(false)}
                className="text-[#A1AFB8] hover:text-white text-lg font-bold p-1 rounded hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateMovementDepth} className="space-y-4 text-xs font-sans">
              {/* SECTION 1: IDENTITY & TARGET PAIR */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[#E4EBEF] block mb-1 font-semibold">Bot Instance Name</label>
                  <input
                    type="text"
                    value={mdName}
                    onChange={e => setMdName(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] focus:border-cyan-400 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[#E4EBEF] block mb-1 font-semibold">Trading Pair (Target Market Token Anda)</label>
                  <select
                    value={mdPairId}
                    onChange={e => handleMdPairChange(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] focus:border-cyan-400 outline-none"
                  >
                    {tradingPairs.map(p => (
                      <option key={p.id} value={p.id}>{p.id} ({p.baseCurrency}/{p.quoteCurrency})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* SECTION 2: KIBLAT WEBSOCKET WHITELIST & RELATIVE PROJECTION */}
              <div className="p-3.5 bg-[#0b1322] border border-cyan-500/40 rounded-[10px] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                  <span className="text-xs font-bold text-cyan-300">
                    Kiblat Pergerakan WebSocket (Admin Whitelist) &amp; Anchor Harga Lokal
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400">
                    Rumus: Anchor × (1 + %Move_WS × Beta)
                  </span>
                </div>

                {wsWhitelist.length === 0 ? (
                  <div className="p-3 rounded-[7px] bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs">
                    Belum ada pair WebSocket aktif di Whitelist Admin. Hubungi Admin untuk menambahkan pair (misal BTCUSDT / SOLUSDT) di Admin Console &rarr; FX Engine &amp; WS Pairs.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-cyan-200 block mb-1 font-semibold">Pair Acuan WebSocket (Whitelist Admin)</label>
                      <select
                        value={mdLeaderSymbol}
                        onChange={e => setMdLeaderSymbol(e.target.value)}
                        className="w-full bg-[#17212B] text-white font-mono p-2 rounded border border-cyan-500/40 text-xs"
                      >
                        {wsWhitelist.map(w => (
                          <option key={w.symbol} value={w.symbol}>
                            {w.symbol} — BN: {w.binancePrice ?? '-'} | BY: {w.bybitPrice ?? '-'}
                          </option>
                        ))}
                      </select>
                      <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                        Hanya daftar minimal yang diizinkan Admin pada stream WS Binance/Bybit.
                      </span>
                    </div>

                    <div>
                      <label className="text-cyan-200 block mb-1 font-semibold">Sumber Stream WebSocket</label>
                      <select
                        value={mdLeaderProvider}
                        onChange={e => setMdLeaderProvider(e.target.value as any)}
                        className="w-full bg-[#17212B] text-white p-2 rounded border border-cyan-500/40 text-xs"
                      >
                        <option value="AGGREGATED">AGGREGATED (Konsensus Binance + Bybit)</option>
                        <option value="BINANCE">BINANCE Spot WS</option>
                        <option value="BYBIT">BYBIT Spot WS</option>
                      </select>
                      {(() => {
                        const wl = wsWhitelist.find(x => x.symbol === mdLeaderSymbol);
                        return (
                          <span className="text-[10px] font-mono text-emerald-400 mt-0.5 block">
                            Live {mdLeaderSymbol}: Binance {wl?.binancePrice ?? '-'} · Bybit {wl?.bybitPrice ?? '-'}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-emerald-300 font-semibold">Anchor Harga Lokal Target</label>
                      <button
                        type="button"
                        onClick={() => handleMdPairChange(mdPairId)}
                        className="text-[10px] text-cyan-300 hover:underline"
                      >
                        Ambil Harga Market
                      </button>
                    </div>
                    <input
                      type="text"
                      value={mdAnchorLocalPrice}
                      onChange={e => setMdAnchorLocalPrice(e.target.value)}
                      required
                      placeholder="Misal 1000 atau 0.05"
                      className="w-full bg-[#17212B] text-emerald-300 font-mono p-2 rounded border border-emerald-500/40 text-xs"
                    />
                    <span className="text-[9px] text-[#A1AFB8] mt-0.5 block">
                      Patokan harga awal token lokal Anda ({mdPairId.split('-')[1] || 'IDR'}).
                    </span>
                  </div>

                  <div>
                    <label className="text-cyan-200 block mb-1 font-semibold">Sensitivitas Pergerakan (Beta)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={mdSensitivity}
                      onChange={e => setMdSensitivity(e.target.value)}
                      required
                      className="w-full bg-[#17212B] text-cyan-300 font-mono p-2 rounded border border-cyan-500/40 text-xs"
                    />
                    <span className="text-[9px] text-[#A1AFB8] mt-0.5 block">
                      1.0 = ikut 1:1 | 1.5 = lebih agresif | -1.0 = berlawanan
                    </span>
                  </div>

                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Threshold Trigger (bps) &amp; Spread (bps)</label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        value={mdThresholdBps}
                        onChange={e => setMdThresholdBps(e.target.value)}
                        min="1"
                        title="Threshold Move (bps)"
                        className="w-1/2 bg-[#17212B] text-white font-mono p-2 rounded border border-[#2B3944] text-xs"
                      />
                      <input
                        type="number"
                        value={mdSpreadBps}
                        onChange={e => setMdSpreadBps(e.target.value)}
                        min="2"
                        title="Half Spread (bps)"
                        className="w-1/2 bg-[#17212B] text-amber-300 font-mono p-2 rounded border border-[#2B3944] text-xs"
                      />
                    </div>
                    <span className="text-[9px] text-[#A1AFB8] mt-0.5 block">
                      Kiri: Trigger rotasi ({mdThresholdBps} bps) · Kanan: Spread ({mdSpreadBps} bps)
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Min Price Guard / Floor (Opsional)</label>
                    <input
                      type="text"
                      value={mdMinPriceGuard}
                      onChange={e => setMdMinPriceGuard(e.target.value)}
                      placeholder="Kosongkan jika bebas"
                      className="w-full bg-[#17212B] text-white font-mono p-2 rounded border border-[#2B3944] text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Max Price Guard / Ceiling (Opsional)</label>
                    <input
                      type="text"
                      value={mdMaxPriceGuard}
                      onChange={e => setMdMaxPriceGuard(e.target.value)}
                      placeholder="Kosongkan jika bebas"
                      className="w-full bg-[#17212B] text-white font-mono p-2 rounded border border-[#2B3944] text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 3: DEPTH & LADDER CONFIGURATION */}
              <div className="p-3 bg-purple-950/25 border border-purple-500/30 rounded-[7px] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-300 uppercase tracking-wide flex items-center gap-1.5">
                    Mode Distribusi Tangga Likuiditas &amp; Anti-Stacking
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="mdAntiStacking"
                      checked={mdAntiStacking}
                      onChange={e => setMdAntiStacking(e.target.checked)}
                      className="rounded bg-[#17212B] border-[#2B3944]"
                    />
                    <label htmlFor="mdAntiStacking" className="text-[11px] text-emerald-400 font-semibold cursor-pointer">
                      Anti-Stacking Aktif
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-purple-200 block mb-1 font-semibold">Mode Distribusi Level</label>
                    <select
                      value={mdSpacingMode}
                      onChange={e => setMdSpacingMode(e.target.value as any)}
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-purple-500/40 text-xs"
                    >
                      <option value="PERCENT_BPS">PERCENT_BPS (Persentase BPS Dinamis)</option>
                      <option value="LINEAR">LINEAR (Jarak Tangga Proporsional)</option>
                      <option value="GEOMETRIC">GEOMETRIC (Makin Lebar ke Luar)</option>
                      <option value="CONCENTRATED">CONCENTRATED (Padat Dekat Spread)</option>
                      <option value="FIXED_IDR">FIXED_STEP (Nominal Step Tetap)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-purple-200 block mb-1 font-semibold">Nominal Step (Khusus LINEAR / FIXED_STEP)</label>
                    <input
                      type="text"
                      value={mdLevelSpacing}
                      onChange={e => setMdLevelSpacing(e.target.value)}
                      className="w-full bg-[#17212B] text-purple-300 font-mono p-2 rounded border border-purple-500/40 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Number of Bid Levels</label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={mdNumBids}
                      onChange={e => setMdNumBids(e.target.value)}
                      className="w-full bg-[#17212B] text-emerald-400 font-mono p-2 rounded border border-[#2B3944] text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Number of Ask Levels</label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={mdNumAsks}
                      onChange={e => setMdNumAsks(e.target.value)}
                      className="w-full bg-[#17212B] text-red-400 font-mono p-2 rounded border border-[#2B3944] text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Bid Quantities ({mdPairId.split('-')[0]})</label>
                    <input
                      type="text"
                      value={mdBidQuantities}
                      onChange={e => setMdBidQuantities(e.target.value)}
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Ask Quantities ({mdPairId.split('-')[0]})</label>
                    <input
                      type="text"
                      value={mdAskQuantities}
                      onChange={e => setMdAskQuantities(e.target.value)}
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 4: PRECISION, COOLDOWN & RISK CAPS */}
              <div className="p-3 bg-[#0a101d] border border-blue-500/30 rounded-[7px] space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[11px] text-[#E4EBEF] block mb-1 font-semibold">Cooldown Refresh (dtk)</label>
                    <input
                      type="number"
                      min="2"
                      max="300"
                      value={mdRefreshCooldownSec}
                      onChange={e => setMdRefreshCooldownSec(e.target.value)}
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#E4EBEF] block mb-1 font-semibold">Max Open Orders</label>
                    <input
                      type="number"
                      min="2"
                      max="100"
                      value={mdMaxOpenOrders}
                      onChange={e => setMdMaxOpenOrders(e.target.value)}
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#E4EBEF] block mb-1 font-semibold">Custom Tick Size (Opsional)</label>
                    <input
                      type="text"
                      value={mdTickSize}
                      onChange={e => setMdTickSize(e.target.value)}
                      placeholder="Auto sesuai harga"
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] font-mono text-xs"
                    />
                  </div>
                  <div className="flex flex-col justify-end">
                    <label className="flex items-center gap-2 text-xs text-[#E4EBEF] cursor-pointer pb-2">
                      <input
                        type="checkbox"
                        checked={mdDryRun}
                        onChange={e => setMdDryRun(e.target.checked)}
                        className="rounded bg-[#17212B] border-[#2B3944]"
                      />
                      <span>Dry Run (Log saja)</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* SECTION 5: SIMULATED WS MOVEMENT PREVIEW */}
              {(() => {
                const anchor = parseFloat(mdAnchorLocalPrice) || 1000;
                const beta = parseFloat(mdSensitivity) || 1.0;
                const spreadBpsNum = Math.max(2, parseFloat(mdSpreadBps) || 20);
                let projected = anchor * (1 + (mdSimMovePct / 100) * beta);
                const minG = mdMinPriceGuard ? parseFloat(mdMinPriceGuard) : 0;
                const maxG = mdMaxPriceGuard ? parseFloat(mdMaxPriceGuard) : 0;
                if (minG > 0 && projected < minG) projected = minG;
                if (maxG > 0 && projected > maxG) projected = maxG;

                const activePair = tradingPairs.find(p => p.id === mdPairId);
                const isUsdtQ = activePair?.quoteCurrency === 'USDT' || mdPairId.endsWith('-USDT');
                const autoTick = isUsdtQ ? (projected < 0.01 ? 0.00001 : projected < 1 ? 0.0001 : 0.01) : (projected < 500 ? 1 : projected < 5000 ? 10 : 100);
                const tick = mdTickSize ? (parseFloat(mdTickSize) || autoTick) : autoTick;
                const fmt = (v: number) => isUsdtQ ? `$${v.toFixed(tick < 0.001 ? 5 : tick < 0.01 ? 4 : 2)}` : `Rp ${Math.round(v).toLocaleString('id-ID')}`;

                const nB = Math.min(8, Math.max(1, parseInt(mdNumBids, 10) || 5));
                const nA = Math.min(8, Math.max(1, parseInt(mdNumAsks, 10) || 5));
                const bidLevels = Array.from({ length: nB }, (_, i) => {
                  const bps = spreadBpsNum + i * 25;
                  return Math.round((projected * (1 - bps / 10000)) / tick) * tick;
                });
                const askLevels = Array.from({ length: nA }, (_, i) => {
                  const bps = spreadBpsNum + i * 25;
                  return Math.round((projected * (1 + bps / 10000)) / tick) * tick;
                });

                return (
                  <div className="p-3 bg-[#0b111e] rounded-[10px] border border-cyan-500/40 text-[11px] font-mono space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                      <span className="font-sans font-bold text-cyan-300">
                        Simulasi Proyeksi Pergerakan ({mdLeaderSymbol} &rarr; {mdPairId})
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[#A1AFB8]">Simulasi {mdLeaderSymbol}:</span>
                        <input
                          type="range"
                          min="-5"
                          max="5"
                          step="0.5"
                          value={mdSimMovePct}
                          onChange={e => setMdSimMovePct(parseFloat(e.target.value))}
                          className="w-28 accent-cyan-400"
                        />
                        <span className={`font-bold ${mdSimMovePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {mdSimMovePct >= 0 ? '+' : ''}{mdSimMovePct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-[#E4EBEF] flex flex-wrap gap-4">
                      <span>Anchor Lokal: <strong className="text-white">{fmt(anchor)}</strong></span>
                      <span>&rarr; Proyeksi Mid ({beta}x): <strong className="text-amber-300">{fmt(projected)}</strong></span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-[11px]">
                      <div className="space-y-1">
                        <div className="text-emerald-400 font-bold">BID LADDER (Preview {nB} level)</div>
                        {bidLevels.map((p, idx) => (
                          <div key={idx} className="flex justify-between bg-[#131b2a] px-2 py-1 rounded">
                            <span className="text-[#A1AFB8]">Lvl {idx + 1}</span>
                            <span className="text-emerald-300 font-bold">{fmt(p)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-1">
                        <div className="text-red-400 font-bold">ASK LADDER (Preview {nA} level)</div>
                        {askLevels.map((p, idx) => (
                          <div key={idx} className="flex justify-between bg-[#131b2a] px-2 py-1 rounded">
                            <span className="text-[#A1AFB8]">Lvl {idx + 1}</span>
                            <span className="text-red-300 font-bold">{fmt(p)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#202B34]">
                <button
                  type="button"
                  onClick={() => setIsMovementDepthModalOpen(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isLoading || wsWhitelist.length === 0}
                  className="px-6 py-2.5 bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] disabled:opacity-50 text-white font-bold rounded text-xs shadow-lg transition-all"
                >
                  Simpan &amp; Deploy Bot Depth Movement (WS)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: QUANTITATIVE HIGH-FREQUENCY MARKET MAKER (HFT-MM) */}
      {isQuantHftModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090D12]/80 p-4 overflow-y-auto">
          <div className="bg-[#111820] border border-[#202B34] rounded-[10px] max-w-3xl w-full p-6 text-[#E4EBEF] max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#202B34]">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white flex items-center gap-1.5">
                    Deploy Quantitative HFT Market Maker Bot
                  </h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    {currentEnv}
                  </span>
                </div>
                <p className="text-xs text-[#A1AFB8] mt-0.5">
                  Arsitektur 3-Pilar: Analisa Top-5 Depth, Pengetatan Spread Dinamis, Micro-EMA Trend Leaning, dan Anti-Manipulation Flash Defense.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsQuantHftModalOpen(false)}
                className="text-[#A1AFB8] hover:text-white text-lg font-bold p-1 rounded hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateQuantHft} className="space-y-4 text-xs font-sans">
              {/* SECTION 1: IDENTITY & PAIR */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#E4EBEF] block mb-1 font-semibold">Bot Instance Name</label>
                  <input
                    type="text"
                    value={qhftName}
                    onChange={e => setQhftName(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] focus:border-cyan-400 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[#E4EBEF] block mb-1 font-semibold">Trading Pair (Target Market)</label>
                  <select
                    value={qhftPairId}
                    onChange={e => handleQhftPairChange(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] focus:border-cyan-400 outline-none"
                  >
                    {tradingPairs.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.id} ({p.baseCurrency}/{p.quoteCurrency})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* SECTION 2: PILLAR A - PRICING & SPREAD TIGHTENING */}
              <div className="p-3 bg-[#17212B] border border-[#202B34] rounded-[7px] space-y-3">
                <span className="text-xs font-bold text-cyan-400 block uppercase tracking-wide flex items-center gap-1.5">
                  Pillar A: Dynamic Spread Tightening & Micro-Lot Sizing
                </span>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Target Spread (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={qhftTargetSpreadPct}
                      onChange={e => setQhftTargetSpreadPct(e.target.value)}
                      required
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                    <span className="text-[10px] text-[#71818B] mt-0.5 block">Default: 0.08% (8 bps)</span>
                  </div>
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Micro-Lot Order Size</label>
                    <input
                      type="text"
                      value={qhftMicroOrderSize}
                      onChange={e => setQhftMicroOrderSize(e.target.value)}
                      required
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                    <span className="text-[10px] text-[#71818B] mt-0.5 block">Ukuran mikro per kuotasi</span>
                  </div>
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Ladder Levels (1-3)</label>
                    <input
                      type="number"
                      min="1"
                      max="3"
                      value={qhftMaxLadderLevels}
                      onChange={e => setQhftMaxLadderLevels(e.target.value)}
                      required
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                    <span className="text-[10px] text-[#71818B] mt-0.5 block">Jumlah tingkat kedalaman</span>
                  </div>
                </div>

                <div className="p-2.5 bg-[#0b111c] rounded border border-cyan-500/20">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={qhftTightenSpreadEnabled}
                      onChange={e => setQhftTightenSpreadEnabled(e.target.checked)}
                      className="rounded border-slate-700 text-cyan-500 w-4 h-4"
                    />
                    <div>
                      <span className="text-white font-semibold block text-xs">Aktifkan Dynamic Spread Tightening</span>
                      <span className="text-[10px] text-[#A1AFB8]">
                        Saat spread pasar &gt; 2 tick, pasang order limit 1 tick di dalam Best Bid & Ask untuk mempersempit spread dan mendapatkan prioritas eksekusi pertama.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* SECTION 3: PILLAR C - RISK & INVENTORY MANAGEMENT */}
              <div className="p-3 bg-[#17212B] border border-[#202B34] rounded-[7px] space-y-3">
                <span className="text-xs font-bold text-emerald-400 block uppercase tracking-wide flex items-center gap-1.5">
                  Pillar C: Risk & Inventory Limits (Anti-Exposure)
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Max Base Token Inventory</label>
                    <input
                      type="text"
                      value={qhftMaxBaseInventory}
                      onChange={e => setQhftMaxBaseInventory(e.target.value)}
                      required
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                    <span className="text-[10px] text-[#71818B] mt-0.5 block">Batas maksimal akumulasi token dasar</span>
                  </div>
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Max Quote (USDT/IDR) Inventory</label>
                    <input
                      type="text"
                      value={qhftMaxQuoteInventory}
                      onChange={e => setQhftMaxQuoteInventory(e.target.value)}
                      required
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                    <span className="text-[10px] text-[#71818B] mt-0.5 block">Batas modal kuotasi yang diekspos</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Inventory Skew Factor (0.0 - 1.0)</label>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={qhftInventorySkewFactor}
                      onChange={e => setQhftInventorySkewFactor(e.target.value)}
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                    <span className="text-[10px] text-[#71818B] mt-0.5 block">Sensitivitas pergeseran harga penyeimbang saldo</span>
                  </div>
                  <div>
                    <label className="text-[#E4EBEF] block mb-1 font-semibold">Siklus Reprice Interval (ms)</label>
                    <input
                      type="number"
                      step="100"
                      min="500"
                      max="5000"
                      value={qhftRepriceIntervalMs}
                      onChange={e => setQhftRepriceIntervalMs(e.target.value)}
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                    <span className="text-[10px] text-[#71818B] mt-0.5 block">Kecepatan refresh kuotasi (Default: 1500ms)</span>
                  </div>
                </div>
              </div>

              {/* SECTION 4: TREND LEANING & FLASH DEFENSE */}
              <div className="p-3 bg-[#17212B] border border-[#202B34] rounded-[7px] space-y-3">
                <span className="text-xs font-bold text-amber-400 block uppercase tracking-wide flex items-center gap-1.5">
                  Trend-Following & Anti-Manipulation (Pump/Dump Protection)
                </span>
                
                <div className="space-y-2">
                  <div className="p-2.5 bg-[#0b111c] rounded border border-amber-500/20">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={qhftTrendLeaningEnabled}
                        onChange={e => setQhftTrendLeaningEnabled(e.target.checked)}
                        className="rounded border-slate-700 text-amber-500 w-4 h-4"
                      />
                      <div>
                        <span className="text-white font-semibold block text-xs">Aktifkan Micro-EMA Trend Leaning</span>
                        <span className="text-[10px] text-[#A1AFB8]">
                          Mendeteksi tren jangka mikro (Fast EMA 12 vs Slow EMA 36). Pada UPTREND, geser bid & ask lebih tinggi. Pada DOWNTREND, turunkan bid agar tidak menangkap pisau jatuh (*falling knife*).
                        </span>
                      </div>
                    </label>
                  </div>

                  <div className="p-2.5 bg-[#0b111c] rounded border border-red-500/20">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={qhftFlashDefenseEnabled}
                        onChange={e => setQhftFlashDefenseEnabled(e.target.checked)}
                        className="rounded border-slate-700 text-red-500 w-4 h-4"
                      />
                      <div>
                        <span className="text-white font-semibold block text-xs">Aktifkan Flash Defense (Pump & Dump Protection)</span>
                        <span className="text-[10px] text-[#A1AFB8]">
                          Bila terjadi lonjakan volume &gt; 2.5x atau lonjakan harga &gt; 120 bps, hentikan kuotasi agresif, lebarkan perimeter 3.0x, dan kecilkan lot size ke 20% micro-fraksi pada blok support/resistance kunci.
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div>
                    <label className="text-[#E4EBEF] block mb-1">Volatility Threshold (bps)</label>
                    <input
                      type="number"
                      value={qhftVolatilityThresholdBps}
                      onChange={e => setQhftVolatilityThresholdBps(e.target.value)}
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                  </div>
                  <div>
                    <label className="text-[#E4EBEF] block mb-1">Volume Surge Factor</label>
                    <input
                      type="number"
                      step="0.5"
                      value={qhftPumpDumpMultiplier}
                      onChange={e => setQhftPumpDumpMultiplier(e.target.value)}
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                  </div>
                  <div>
                    <label className="text-[#E4EBEF] block mb-1">Defense Perimeter Multiplier</label>
                    <input
                      type="number"
                      step="0.5"
                      value={qhftDefensePerimeterMultiplier}
                      onChange={e => setQhftDefensePerimeterMultiplier(e.target.value)}
                      className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                    />
                  </div>
                </div>
              </div>

              {/* ACTION BUTTONS */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#202B34]">
                <button
                  type="button"
                  onClick={() => setIsQuantHftModalOpen(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-6 py-2.5 bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] text-white font-bold rounded text-xs shadow-lg transition-all flex items-center gap-1.5"
                >
                  
                  <span>Deploy Quantitative HFT MM Bot</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT BOT CONFIGURATION */}
      {isEditModalOpen && editingBot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090D12]/80 p-4 overflow-y-auto">
          <div className="bg-[#111820] border border-[#202B34] rounded-[10px] max-w-2xl w-full p-6 text-[#E4EBEF] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#202B34]">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Edit Konfigurasi Bot:</span>
                  <span className="text-blue-400 font-mono text-sm">{editingBot.name}</span>
                </h2>
                <span className="text-xs text-[#A1AFB8]">
                  ID: <span className="font-mono text-[#E4EBEF]">{editingBot.id}</span> · Tipe: <span className="font-semibold text-emerald-400">{editingBot.botType}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-[#A1AFB8] hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs font-sans">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Bot Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    required
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  />
                </div>
                <div>
                  <label className="text-[#A1AFB8] block mb-1">Trading Pair</label>
                  <select
                    value={editPairId}
                    onChange={e => setEditPairId(e.target.value)}
                    className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                  >
                    {tradingPairs.map(p => (
                      <option key={p.id} value={p.id}>{p.id}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ORDER BOT SPECIFIC FIELDS */}
              {editingBot.botType === 'ORDER_BOT' && (
                <>
                  <div className="p-3 bg-[#17212B] rounded-[7px] border border-[#202B34] space-y-3">
                    <span className="text-xs font-bold text-amber-400 block uppercase tracking-wide">
                      Pengaturan Eksekusi Order Bot (BUY / SELL)
                    </span>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[#A1AFB8] block mb-1 font-semibold">Side / Transaction Type</label>
                        <select
                          value={editObTxType}
                          onChange={e => setEditObTxType(e.target.value as any)}
                          className="w-full bg-[#17212B] font-bold text-xs p-2 rounded border border-[#2B3944]"
                        >
                          <option value="BUY" className="text-emerald-400">BUY (Beli / Bid)</option>
                          <option value="SELL" className="text-red-400">SELL (Jual / Ask)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Price Source</label>
                        <select
                          value={editObPriceSource}
                          onChange={e => setEditObPriceSource(e.target.value as any)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        >
                          <option value="MIDPOINT">MIDPOINT</option>
                          <option value="BEST_BID">BEST_BID</option>
                          <option value="BEST_ASK">BEST_ASK</option>
                          <option value="LAST_PRICE">LAST_PRICE</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Order Count (0 = Berjalan Terus)</label>
                        <input
                          type="number"
                          value={editObOrderCount}
                          onChange={e => setEditObOrderCount(e.target.value)}
                          required
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Random Min Quantity</label>
                        <input
                          type="text"
                          value={editObRandomMinQty}
                          onChange={e => setEditObRandomMinQty(e.target.value)}
                          required
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Random Max Quantity</label>
                        <input
                          type="text"
                          value={editObRandomMaxQty}
                          onChange={e => setEditObRandomMaxQty(e.target.value)}
                          required
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Price Decimal</label>
                        <input
                          type="number"
                          value={editObPriceDecimal}
                          onChange={e => setEditObPriceDecimal(e.target.value)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Quantity Decimal</label>
                        <input
                          type="number"
                          value={editObQtyDecimal}
                          onChange={e => setEditObQtyDecimal(e.target.value)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Split Order Mode</label>
                        <select
                          value={editObSplitMode}
                          onChange={e => setEditObSplitMode(e.target.value as any)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        >
                          <option value="NONE">NONE</option>
                          <option value="RANDOM_SPLIT">RANDOM_SPLIT</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Split Range</label>
                        <input
                          type="text"
                          value={editObSplitRange}
                          onChange={e => setEditObSplitRange(e.target.value)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Buy Trailing (Min % - Max %)</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={editObBuyTrailMin}
                            onChange={e => setEditObBuyTrailMin(e.target.value)}
                            className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                          />
                          <input
                            type="text"
                            value={editObBuyTrailMax}
                            onChange={e => setEditObBuyTrailMax(e.target.value)}
                            className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Sell Trailing (Min % - Max %)</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={editObSellTrailMin}
                            onChange={e => setEditObSellTrailMin(e.target.value)}
                            className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                          />
                          <input
                            type="text"
                            value={editObSellTrailMax}
                            onChange={e => setEditObSellTrailMax(e.target.value)}
                            className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                          />
                        </div>
                      </div>
                    </div>

                    {editObTxType === 'BUY' ? (
                      <div className="p-3 bg-emerald-950/20 border border-emerald-500/30 rounded-[7px]">
                        <span className="text-[11px] font-bold text-emerald-400 block mb-2 uppercase tracking-wide">
                          Batasan Harga Order Buy (Beli / Bid)
                        </span>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-emerald-200 block mb-1 font-semibold">
                              Min Buy Price Limit (IDR)
                            </label>
                            <input
                              type="text"
                              value={editObBuyMinPrice}
                              onChange={e => setEditObBuyMinPrice(e.target.value)}
                              placeholder="Contoh: 1200000000 (Kosongkan jika tanpa batas)"
                              className="w-full bg-[#17212B] text-emerald-300 font-mono p-2 rounded border border-emerald-500/40 focus:border-emerald-400 outline-none"
                            />
                            <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                              Floor: Bot BUY tidak akan memasang bid di bawah harga ini.
                            </span>
                          </div>
                          <div>
                            <label className="text-emerald-200 block mb-1 font-semibold">
                              Max Buy Price Limit (IDR)
                            </label>
                            <input
                              type="text"
                              value={editObBuyMaxPrice}
                              onChange={e => setEditObBuyMaxPrice(e.target.value)}
                              placeholder="Contoh: 1500000000 (Kosongkan jika tanpa batas)"
                              className="w-full bg-[#17212B] text-emerald-300 font-mono p-2 rounded border border-emerald-500/40 focus:border-emerald-400 outline-none"
                            />
                            <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                              Ceiling: Bot BUY tidak akan membeli di atas harga ini.
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-red-950/20 border border-red-500/30 rounded-[7px]">
                        <span className="text-[11px] font-bold text-red-400 block mb-2 uppercase tracking-wide">
                          Batasan Harga Order Sell (Jual / Ask)
                        </span>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-red-200 block mb-1 font-semibold">
                              Min Sell Price Limit (IDR)
                            </label>
                            <input
                              type="text"
                              value={editObSellMinPrice}
                              onChange={e => setEditObSellMinPrice(e.target.value)}
                              placeholder="Contoh: 1300000000 (Kosongkan jika tanpa batas)"
                              className="w-full bg-[#17212B] text-red-300 font-mono p-2 rounded border border-red-500/40 focus:border-red-400 outline-none"
                            />
                            <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                              Floor: Bot SELL tidak akan menjual di bawah harga ini.
                            </span>
                          </div>
                          <div>
                            <label className="text-red-200 block mb-1 font-semibold">
                              Max Sell Price Limit (IDR)
                            </label>
                            <input
                              type="text"
                              value={editObSellMaxPrice}
                              onChange={e => setEditObSellMaxPrice(e.target.value)}
                              placeholder="Contoh: 1650000000 (Kosongkan jika tanpa batas)"
                              className="w-full bg-[#17212B] text-red-300 font-mono p-2 rounded border border-red-500/40 focus:border-red-400 outline-none"
                            />
                            <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                              Ceiling: Bot SELL tidak akan memasang ask di atas harga ini.
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Expire Time (Detik, 0 = GTC)</label>
                        <input
                          type="number"
                          value={editObExpireTime}
                          onChange={e => setEditObExpireTime(e.target.value)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Jitter Timing (%)</label>
                        <input
                          type="number"
                          value={editObJitterTiming}
                          onChange={e => setEditObJitterTiming(e.target.value)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Jitter Price (%)</label>
                        <input
                          type="number"
                          value={editObJitterPrice}
                          onChange={e => setEditObJitterPrice(e.target.value)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* VOLUME BOT SPECIFIC FIELDS */}
              {editingBot.botType === 'VOLUME_BOT' && (
                <>
                  <div className="p-3 bg-[#17212B] rounded-[7px] border border-[#202B34] space-y-3">
                    <span className="text-xs font-bold text-indigo-400 block uppercase tracking-wide">
                      Pengaturan Eksekusi Volume Bot
                    </span>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Target Stop Volume (IDR)</label>
                        <input
                          type="text"
                          value={editVbVolIdrStop}
                          onChange={e => setEditVbVolIdrStop(e.target.value)}
                          required
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Priority</label>
                        <select
                          value={editVbPriority}
                          onChange={e => setEditVbPriority(e.target.value as any)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        >
                          <option value="RANDOM">random</option>
                          <option value="HIGH">high</option>
                          <option value="NORMAL">normal</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Random Min Quantity</label>
                        <input
                          type="text"
                          value={editVbRandomMinQty}
                          onChange={e => setEditVbRandomMinQty(e.target.value)}
                          required
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Random Max Quantity</label>
                        <input
                          type="text"
                          value={editVbRandomMaxQty}
                          onChange={e => setEditVbRandomMaxQty(e.target.value)}
                          required
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Scheduling Delay (Min - Max Detik)</label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            value={editVbMinDelay}
                            onChange={e => setEditVbMinDelay(e.target.value)}
                            className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                          />
                          <input
                            type="number"
                            value={editVbMaxDelay}
                            onChange={e => setEditVbMaxDelay(e.target.value)}
                            className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Difference Spread (Min - Max)</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={editVbMinDiff}
                            onChange={e => setEditVbMinDiff(e.target.value)}
                            className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                          />
                          <input
                            type="text"
                            value={editVbMaxDiff}
                            onChange={e => setEditVbMaxDiff(e.target.value)}
                            className="w-1/2 bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Min Limit Price (IDR)</label>
                        <input
                          type="text"
                          value={editVbMinLimitPrice}
                          onChange={e => setEditVbMinLimitPrice(e.target.value)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Max Limit Price (IDR)</label>
                        <input
                          type="text"
                          value={editVbMaxLimitPrice}
                          onChange={e => setEditVbMaxLimitPrice(e.target.value)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Vol IDR Start Threshold</label>
                        <input
                          type="text"
                          value={editVbVolIdrStart}
                          onChange={e => setEditVbVolIdrStart(e.target.value)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                      <div>
                        <label className="text-[#A1AFB8] block mb-1">Volume Sell Account ID (Opsional)</label>
                        <input
                          type="text"
                          value={editVbSellAccountId}
                          onChange={e => setEditVbSellAccountId(e.target.value)}
                          placeholder="None (Gunakan akun default)"
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* VOLUME SPREAD BOT (PHASE 2) SPECIFIC FIELDS */}
              {editingBot.botType === 'VOLUME_SPREAD_BOT' && (
                <div className="p-3 bg-[#17212B] rounded-[7px] border border-[#202B34] space-y-3">
                  <span className="text-xs font-semibold text-[#35B887] block uppercase tracking-wide">
                    Pengaturan Volume Bot Phase 2 (Antar Spread / Self-Cross)
                  </span>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Mode Penempatan Spread</label>
                      <select
                        value={editVsbSpreadMode}
                        onChange={e => setEditVsbSpreadMode(e.target.value as any)}
                        className="w-full bg-[#111820] text-white p-2 rounded border border-[#2B3944]"
                      >
                        <option value="INSIDE_SPREAD">Inside Spread</option>
                        <option value="MIDPOINT_JITTER">Midpoint Jitter</option>
                        <option value="PING_PONG_EDGE">Ping-Pong Edge</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Pola Arah Makan Order</label>
                      <select
                        value={editVsbSidePattern}
                        onChange={e => setEditVsbSidePattern(e.target.value as any)}
                        className="w-full bg-[#111820] text-white p-2 rounded border border-[#2B3944]"
                      >
                        <option value="ALTERNATE">Alternate (Buy/Sell)</option>
                        <option value="RANDOM">Random</option>
                        <option value="BUY_EATS_SELL">Buy Eats Sell</option>
                        <option value="SELL_EATS_BUY">Sell Eats Buy</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Random Min Quantity</label>
                      <input
                        type="text"
                        value={editVsbMinQty}
                        onChange={e => setEditVsbMinQty(e.target.value)}
                        required
                        className="w-full bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Random Max Quantity</label>
                      <input
                        type="text"
                        value={editVsbMaxQty}
                        onChange={e => setEditVsbMaxQty(e.target.value)}
                        required
                        className="w-full bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Inside-Spread Band Min - Max (%)</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={editVsbBandMinPct}
                          onChange={e => setEditVsbBandMinPct(e.target.value)}
                          className="w-1/2 bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                        />
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={editVsbBandMaxPct}
                          onChange={e => setEditVsbBandMaxPct(e.target.value)}
                          className="w-1/2 bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Jeda Taker Makan Maker (ms)</label>
                      <input
                        type="number"
                        min={0}
                        max={2000}
                        value={editVsbCrossDelayMs}
                        onChange={e => setEditVsbCrossDelayMs(e.target.value)}
                        className="w-full bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Interval Siklus (Min - Max Detik)</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min={1}
                          value={editVsbMinDelay}
                          onChange={e => setEditVsbMinDelay(e.target.value)}
                          className="w-1/2 bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                        />
                        <input
                          type="number"
                          min={1}
                          value={editVsbMaxDelay}
                          onChange={e => setEditVsbMaxDelay(e.target.value)}
                          className="w-1/2 bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Min Book Spread / Fallback (bps)</label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min={1}
                          value={editVsbMinSpreadBps}
                          onChange={e => setEditVsbMinSpreadBps(e.target.value)}
                          className="w-1/2 bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                        />
                        <input
                          type="number"
                          min={1}
                          value={editVsbFallbackHalfSpreadBps}
                          onChange={e => setEditVsbFallbackHalfSpreadBps(e.target.value)}
                          className="w-1/2 bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Min Limit Price</label>
                      <input
                        type="text"
                        value={editVsbMinLimitPrice}
                        onChange={e => setEditVsbMinLimitPrice(e.target.value)}
                        className="w-full bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Max Limit Price</label>
                      <input
                        type="text"
                        value={editVsbMaxLimitPrice}
                        onChange={e => setEditVsbMaxLimitPrice(e.target.value)}
                        className="w-full bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Target Stop Volume (Quote)</label>
                      <input
                        type="text"
                        value={editVsbVolQuoteStop}
                        onChange={e => setEditVsbVolQuoteStop(e.target.value)}
                        required
                        className="w-full bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Tick Size (Opsional)</label>
                      <input
                        type="text"
                        value={editVsbTickSize}
                        onChange={e => setEditVsbTickSize(e.target.value)}
                        placeholder="Auto"
                        className="w-full bg-[#111820] text-white p-2 rounded border border-[#2B3944] font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="text-[#A1AFB8] block mb-1">Akun Maker Lawan</label>
                      <input
                        type="text"
                        value={editVsbCounterpartyAccountId}
                        onChange={e => setEditVsbCounterpartyAccountId(e.target.value)}
                        placeholder="Kosong = Sendiri"
                        className="w-full bg-[#111820] text-white p-2 rounded border border-[#2B3944]"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-[#E4EBEF] cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={editVsbRequireTwoSided}
                      onChange={e => setEditVsbRequireTwoSided(e.target.checked)}
                      className="rounded border-[#2B3944] bg-[#111820]"
                    />
                    <span>Wajibkan Order Book 2 Sisi Aktif</span>
                  </label>
                </div>
              )}

              {/* DEPTH LIQUIDITY BOT SPECIFIC FIELDS */}
              {editingBot.botType === 'DEPTH_LIQUIDITY' && (
                <>
                  <div className="p-3 bg-purple-950/25 border border-purple-500/30 rounded-[7px] space-y-3">
                    <span className="text-xs font-bold text-purple-300 block uppercase tracking-wide flex items-center gap-1.5">
                      Pengaturan Depth & Liquidity (Cooldown, Jitter & Ladder)
                    </span>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-purple-200 block mb-1 font-semibold">
                          Liquidity Refresh Cooldown (detik)
                        </label>
                        <input
                          type="number"
                          value={editDlRefreshCooldown}
                          onChange={e => setEditDlRefreshCooldown(e.target.value)}
                          min="3"
                          max="300"
                          required
                          className="w-full bg-[#17212B] text-purple-300 font-mono p-2 rounded border border-purple-500/40 text-xs"
                        />
                        <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                          Jeda cooldown antar siklus refresh. Default 10s (Min 3s).
                        </span>
                      </div>

                      <div>
                        <label className="text-purple-200 block mb-1 font-semibold">
                          Max Price Jitter (Ticks)
                        </label>
                        <input
                          type="number"
                          value={editDlPriceRandomizationTicks}
                          onChange={e => setEditDlPriceRandomizationTicks(e.target.value)}
                          min="1"
                          max="10"
                          disabled={!editDlRandomizePlacement}
                          required
                          className="w-full bg-[#17212B] text-purple-300 font-mono p-2 rounded border border-purple-500/40 text-xs disabled:opacity-50"
                        />
                        <span className="text-[10px] text-[#A1AFB8] mt-0.5 block">
                          Rentang jitter acak halus (±{editDlPriceRandomizationTicks} ticks).
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        id="editDlRandomizePlacement"
                        checked={editDlRandomizePlacement}
                        onChange={e => setEditDlRandomizePlacement(e.target.checked)}
                        className="rounded bg-[#17212B] border-[#2B3944] text-purple-600 cursor-pointer"
                      />
                      <label htmlFor="editDlRandomizePlacement" className="text-[#E4EBEF] font-medium cursor-pointer">
                        Aktifkan Dynamic Micro-Jitter Placement (Mencegah bot placing di harga yang sama terus)
                      </label>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        id="editDlAntiStacking"
                        checked={editDlAntiStacking}
                        onChange={e => setEditDlAntiStacking(e.target.checked)}
                        className="rounded bg-[#17212B] border-[#2B3944] text-purple-600"
                      />
                      <label htmlFor="editDlAntiStacking" className="text-emerald-400 font-semibold cursor-pointer text-xs">
                        Anti-Numpuk / Anti-Stacking (Rotasi Bersih Cancel-and-Replace)
                      </label>
                    </div>

                    <div className="pt-2 border-t border-purple-500/20 space-y-2">
                      <label className="text-[#E4EBEF] block font-semibold">Mode Penentuan Harga</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setEditDlPriceMode('CUSTOM_BOUNDS')}
                          className={`p-2 rounded text-left border text-xs ${
                            editDlPriceMode === 'CUSTOM_BOUNDS'
                              ? 'bg-purple-900/40 border-purple-500 text-white font-bold'
                              : 'bg-[#17212B] border-[#2B3944] text-[#A1AFB8]'
                          }`}
                        >
                          Custom Bounds (Bebas / Tanpa Feed)
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditDlPriceMode('EXTERNAL_REFERENCE')}
                          className={`p-2 rounded text-left border text-xs ${
                            editDlPriceMode === 'EXTERNAL_REFERENCE'
                              ? 'bg-blue-900/40 border-blue-500 text-white font-bold'
                              : 'bg-[#17212B] border-[#2B3944] text-[#A1AFB8]'
                          }`}
                        >
                          External Reference Tracker
                        </button>
                      </div>

                      {editDlPriceMode === 'CUSTOM_BOUNDS' && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                          <div>
                            <label className="text-[10px] text-emerald-400 font-semibold block">Min Limit Buy</label>
                            <input
                              type="text"
                              value={editDlMinBuyPrice}
                              onChange={e => setEditDlMinBuyPrice(e.target.value)}
                              className="w-full bg-[#17212B] text-emerald-400 font-mono p-1.5 rounded border border-emerald-500/40 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-emerald-300 font-semibold block">Max Limit Buy</label>
                            <input
                              type="text"
                              value={editDlMaxBuyPrice}
                              onChange={e => setEditDlMaxBuyPrice(e.target.value)}
                              className="w-full bg-[#17212B] text-emerald-300 font-mono p-1.5 rounded border border-emerald-500/40 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-red-300 font-semibold block">Min Limit Sell</label>
                            <input
                              type="text"
                              value={editDlMinSellPrice}
                              onChange={e => setEditDlMinSellPrice(e.target.value)}
                              className="w-full bg-[#17212B] text-red-300 font-mono p-1.5 rounded border border-red-500/40 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-red-400 font-semibold block">Max Limit Sell</label>
                            <input
                              type="text"
                              value={editDlMaxSellPrice}
                              onChange={e => setEditDlMaxSellPrice(e.target.value)}
                              className="w-full bg-[#17212B] text-red-400 font-mono p-1.5 rounded border border-red-500/40 text-xs"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-3 pt-2 border-t border-purple-500/20">
                      <div>
                        <label className="text-[#E4EBEF] block mb-1">Mode Spacing</label>
                        <select
                          value={editDlSpacingMode}
                          onChange={e => setEditDlSpacingMode(e.target.value as any)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] text-xs"
                        >
                          <option value="LINEAR">LINEAR</option>
                          <option value="GEOMETRIC">GEOMETRIC</option>
                          <option value="CONCENTRATED">CONCENTRATED</option>
                          <option value="FIXED_IDR">FIXED_STEP</option>
                          <option value="PERCENT_BPS">PERCENT_BPS</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[#E4EBEF] block mb-1">Jarak Antar Level (IDR/Step)</label>
                        <input
                          type="number"
                          value={editDlLevelSpacingIdr}
                          onChange={e => setEditDlLevelSpacingIdr(e.target.value)}
                          className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[#E4EBEF] block mb-1">Levels (Bid / Ask)</label>
                        <div className="flex gap-1.5">
                          <input
                            type="number"
                            value={editDlNumBids}
                            onChange={e => setEditDlNumBids(e.target.value)}
                            min="1"
                            max="20"
                            placeholder="Bids"
                            className="w-1/2 bg-[#17212B] text-emerald-400 font-bold p-2 rounded border border-[#2B3944] text-xs"
                          />
                          <input
                            type="number"
                            value={editDlNumAsks}
                            onChange={e => setEditDlNumAsks(e.target.value)}
                            min="1"
                            max="20"
                            placeholder="Asks"
                            className="w-1/2 bg-[#17212B] text-red-400 font-bold p-2 rounded border border-[#2B3944] text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* MOVEMENT DEPTH LIQUIDITY SPECIFIC FIELDS */}
              {editingBot.botType === 'MOVEMENT_DEPTH_LIQUIDITY' && (
                <div className="p-3 bg-cyan-950/25 border border-cyan-500/30 rounded-[7px] space-y-3">
                  <span className="text-xs font-bold text-cyan-300 block uppercase tracking-wide flex items-center gap-1.5">
                    Pengaturan Depth Movement (WS Acuan &amp; Anchor Lokal)
                  </span>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-cyan-200 block mb-1 font-semibold">Pair Acuan WS (Whitelist Admin)</label>
                      <select
                        value={editMdLeaderSymbol}
                        onChange={e => setEditMdLeaderSymbol(e.target.value)}
                        className="w-full bg-[#17212B] text-white font-mono p-2 rounded border border-cyan-500/40 text-xs"
                      >
                        {wsWhitelist.map(w => (
                          <option key={w.symbol} value={w.symbol}>{w.symbol}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-cyan-200 block mb-1 font-semibold">Provider WebSocket</label>
                      <select
                        value={editMdLeaderProvider}
                        onChange={e => setEditMdLeaderProvider(e.target.value as any)}
                        className="w-full bg-[#17212B] text-white p-2 rounded border border-cyan-500/40 text-xs"
                      >
                        <option value="AGGREGATED">AGGREGATED (Binance + Bybit)</option>
                        <option value="BINANCE">BINANCE Spot WS</option>
                        <option value="BYBIT">BYBIT Spot WS</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-emerald-300 block mb-1 font-semibold">Anchor Harga Lokal</label>
                      <input
                        type="text"
                        value={editMdAnchorLocalPrice}
                        onChange={e => setEditMdAnchorLocalPrice(e.target.value)}
                        className="w-full bg-[#17212B] text-emerald-300 font-mono p-2 rounded border border-emerald-500/40 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-cyan-200 block mb-1 font-semibold">Sensitivitas Beta</label>
                      <input
                        type="number"
                        step="0.1"
                        value={editMdSensitivity}
                        onChange={e => setEditMdSensitivity(e.target.value)}
                        className="w-full bg-[#17212B] text-cyan-300 font-mono p-2 rounded border border-cyan-500/40 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[#E4EBEF] block mb-1 font-semibold">Spread / Threshold (bps)</label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          value={editMdSpreadBps}
                          onChange={e => setEditMdSpreadBps(e.target.value)}
                          placeholder="Spread"
                          className="w-1/2 bg-[#17212B] text-white font-mono p-2 rounded border border-[#2B3944] text-xs"
                        />
                        <input
                          type="number"
                          value={editMdThresholdBps}
                          onChange={e => setEditMdThresholdBps(e.target.value)}
                          placeholder="Move"
                          className="w-1/2 bg-[#17212B] text-amber-300 font-mono p-2 rounded border border-[#2B3944] text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[#E4EBEF] block mb-1">Mode Spacing</label>
                      <select
                        value={editMdSpacingMode}
                        onChange={e => setEditMdSpacingMode(e.target.value as any)}
                        className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] text-xs"
                      >
                        <option value="PERCENT_BPS">PERCENT_BPS</option>
                        <option value="LINEAR">LINEAR</option>
                        <option value="GEOMETRIC">GEOMETRIC</option>
                        <option value="CONCENTRATED">CONCENTRATED</option>
                        <option value="FIXED_IDR">FIXED_STEP</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[#E4EBEF] block mb-1">Cooldown (dtk)</label>
                      <input
                        type="number"
                        min="2"
                        value={editMdRefreshCooldown}
                        onChange={e => setEditMdRefreshCooldown(e.target.value)}
                        className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[#E4EBEF] block mb-1">Levels (Bid / Ask)</label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={editMdNumBids}
                          onChange={e => setEditMdNumBids(e.target.value)}
                          className="w-1/2 bg-[#17212B] text-emerald-400 p-2 rounded border border-[#2B3944] text-xs"
                        />
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={editMdNumAsks}
                          onChange={e => setEditMdNumAsks(e.target.value)}
                          className="w-1/2 bg-[#17212B] text-red-400 p-2 rounded border border-[#2B3944] text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* QUANT HFT MM SPECIFIC FIELDS */}
              {editingBot.botType === 'QUANT_HFT_MM' && (
                <div className="p-3 bg-cyan-950/25 border border-cyan-500/30 rounded-[7px] space-y-3">
                  <span className="text-xs font-bold text-cyan-300 block uppercase tracking-wide flex items-center gap-1.5">
                    Parameter Quantitative HFT MM (3-Pillar Execution)
                  </span>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-cyan-200 block mb-1 font-semibold">Target Spread (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editQhftTargetSpread}
                        onChange={e => setEditQhftTargetSpread(e.target.value)}
                        className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-cyan-200 block mb-1 font-semibold">Micro-Lot Size</label>
                      <input
                        type="text"
                        value={editQhftMicroOrderSize}
                        onChange={e => setEditQhftMicroOrderSize(e.target.value)}
                        className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-cyan-200 block mb-1 font-semibold">Ladder Levels (1-3)</label>
                      <input
                        type="number"
                        min="1"
                        max="3"
                        value={editQhftMaxLadderLevels}
                        onChange={e => setEditQhftMaxLadderLevels(e.target.value)}
                        className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[#E4EBEF] block mb-1 font-semibold">Max Base Inventory</label>
                      <input
                        type="text"
                        value={editQhftMaxBaseInventory}
                        onChange={e => setEditQhftMaxBaseInventory(e.target.value)}
                        className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[#E4EBEF] block mb-1 font-semibold">Max Quote Inventory</label>
                      <input
                        type="text"
                        value={editQhftMaxQuoteInventory}
                        onChange={e => setEditQhftMaxQuoteInventory(e.target.value)}
                        className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944] text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-cyan-500/20 text-[11px]">
                    <label className="flex items-center gap-2 cursor-pointer bg-[#111820] p-2 rounded border border-cyan-500/20">
                      <input
                        type="checkbox"
                        checked={editQhftTightenSpread}
                        onChange={e => setEditQhftTightenSpread(e.target.checked)}
                        className="rounded border-slate-700 text-cyan-500"
                      />
                      <span className="text-[#E4EBEF] font-semibold">Tighten Inside Spread</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer bg-[#111820] p-2 rounded border border-cyan-500/20">
                      <input
                        type="checkbox"
                        checked={editQhftTrendLeaning}
                        onChange={e => setEditQhftTrendLeaning(e.target.checked)}
                        className="rounded border-slate-700 text-cyan-500"
                      />
                      <span className="text-[#E4EBEF] font-semibold">Trend Leaning Skew</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer bg-[#111820] p-2 rounded border border-cyan-500/20">
                      <input
                        type="checkbox"
                        checked={editQhftFlashDefense}
                        onChange={e => setEditQhftFlashDefense(e.target.checked)}
                        className="rounded border-slate-700 text-cyan-500"
                      />
                      <span className="text-[#E4EBEF] font-semibold">Flash Defense Protection</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#202B34]">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 bg-slate-700 text-white rounded text-xs"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded text-xs shadow-md"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CLONE BOT (Phase 8 - Enhanced Multi-Instance Support) */}
      {isCloneModalOpen && cloneSourceBot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090D12]/80 p-4">
          <div className="bg-[#111820] border border-[#202B34] rounded-[10px] max-w-lg w-full p-6 text-[#E4EBEF]">
            <h2 className="text-base font-bold text-white mb-2">Clone Bot Instance (Multi-Bot Setup)</h2>
            <p className="text-xs text-[#A1AFB8] mb-4 leading-relaxed">
              Kloning membuat instance bot baru dengan ID unik dan worker lease independen.
              Anda dapat mengkloning untuk membuat kombinasi misal <strong>3 Bot BUY dan 3 Bot SELL</strong> dengan setingan config yang beda.
            </p>

            <div className="space-y-4 text-xs font-sans">
              <div>
                <label className="text-[#A1AFB8] block mb-1 font-semibold">New Bot Name</label>
                <input
                  type="text"
                  value={cloneNewName}
                  onChange={e => setCloneNewName(e.target.value)}
                  required
                  className="w-full bg-[#17212B] text-white p-2 rounded border border-[#2B3944]"
                />
              </div>

              {/* Order Bot Side Selection on Clone */}
              {cloneSourceBot.botType === 'ORDER_BOT' && (
                <div className="p-3 bg-[#17212B] rounded-[7px] border border-[#202B34]">
                  <label className="text-amber-400 block mb-1.5 font-bold uppercase text-[11px]">
                    Pilih Sisi Transaksi untuk Kloning Ini:
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setCloneTxType('BUY')}
                      className={`p-2.5 rounded-[7px] border text-left font-bold transition-all ${
                        cloneTxType === 'BUY'
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400 shadow-sm'
                          : 'bg-[#17212B] border-[#2B3944] text-[#A1AFB8] hover:text-white'
                      }`}
                    >
                      <span className="block text-xs">BUY Bot (Beli)</span>
                      <span className="block text-[10px] font-normal opacity-75">Pasang likuiditas bid / beli</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCloneTxType('SELL')}
                      className={`p-2.5 rounded-[7px] border text-left font-bold transition-all ${
                        cloneTxType === 'SELL'
                          ? 'bg-red-600/20 border-red-500 text-red-400 shadow-sm'
                          : 'bg-[#17212B] border-[#2B3944] text-[#A1AFB8] hover:text-white'
                      }`}
                    >
                      <span className="block text-xs">SELL Bot (Jual)</span>
                      <span className="block text-[10px] font-normal opacity-75">Pasang likuiditas ask / jual</span>
                    </button>
                  </div>
                  <span className="text-[10px] text-[#A1AFB8] block mt-2">
                    * Induk saat ini: <strong>{cloneSourceBot.orderBotConfig?.transaction_type}</strong> · Kloning ini akan diset sebagai <strong>{cloneTxType}</strong>.
                  </span>
                </div>
              )}

              <div className="p-3 bg-[#0a0f18] rounded border border-[#202B34] text-[#A1AFB8] font-mono text-[11px] space-y-1">
                <div>Pair: <span className="text-white font-bold">{cloneSourceBot.pairId}</span></div>
                <div>Environment: <span className="text-white">{cloneSourceBot.environment}</span></div>
                <div>Config Version: <span className="text-white">v1 (Fresh independent configuration)</span></div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5 pt-3 border-t border-[#202B34]">
              <button
                type="button"
                onClick={() => setIsCloneModalOpen(false)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-xs"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={handleConfirmClone}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded text-xs shadow-md"
              >
                Konfirmasi Kloning
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CSV IMPORT (Phase 11) */}
      {isCsvImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#090D12]/80 p-4 overflow-y-auto">
          <div className="bg-[#111820] border border-[#202B34] rounded-[10px] max-w-2xl w-full p-6 text-[#E4EBEF]">
            <h2 className="text-base font-bold text-white mb-2">CSV Bot Configuration Import (Phase 11)</h2>
            <p className="text-xs text-[#A1AFB8] mb-4">
              Tempelkan konten CSV Anda di bawah ini untuk melihat pratinjau validasi baris per baris sebelum disimpan.
            </p>

            <div className="mb-3">
              <label className="text-xs text-[#A1AFB8] block mb-1">Bot Type Scheme</label>
              <select
                value={csvImportType}
                onChange={e => setCsvImportType(e.target.value as any)}
                className="bg-[#17212B] text-white text-xs p-2 rounded border border-[#2B3944]"
              >
                <option value="ORDER_BOT">Order Bot Scheme</option>
                <option value="VOLUME_BOT">Volume Bot Scheme</option>
              </select>
            </div>

            <textarea
              rows={6}
              value={csvRawText}
              onChange={e => setCsvRawText(e.target.value)}
              placeholder="id,name,pairId,transaction_type,random_min_quantity,random_max_quantity,order_count..."
              className="w-full bg-[#05080f] text-[#E4EBEF] font-mono text-xs p-3 rounded border border-[#2B3944] mb-4"
            />

            {csvPreview && (
              <div className="mb-4 p-3 bg-[#17212B] rounded border border-[#202B34] text-xs">
                <div className="flex justify-between font-bold mb-2">
                  <span>Pratinjau Hasil Validasi:</span>
                  <span className={csvPreview.validRowsCount > 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {csvPreview.validRowsCount} / {csvPreview.totalRows} Baris Valid
                  </span>
                </div>
                {csvPreview.errors.length > 0 && (
                  <div className="text-red-400 space-y-0.5 max-h-28 overflow-y-auto font-mono text-[11px]">
                    {csvPreview.errors.map((err, i) => (
                      <div key={i}>Baris #{err.row}: {err.error} ({err.field})</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-[#202B34]">
              <button
                type="button"
                onClick={handleCsvPreview}
                className="px-4 py-2 bg-[#17212B] hover:bg-[#1D2832] text-white text-xs font-semibold rounded"
              >
                Pratinjau & Validasi Baris
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsCsvImportModalOpen(false)}
                  className="px-4 py-2 bg-slate-700 text-white rounded text-xs"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  disabled={!csvPreview || csvPreview.validRowsCount === 0}
                  onClick={handleCsvConfirm}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded text-xs"
                >
                  Konfirmasi Impor ({csvPreview?.validRowsCount || 0} Bot)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DELETE BOT CONFIRMATION */}
      <Modal
        isOpen={isDeleteModalOpen && Boolean(botToDelete)}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setBotToDelete(null);
        }}
        title="Hapus Bot Instance?"
        subtitle="Tindakan ini bersifat permanen dan tidak dapat dibatalkan."
        maxWidth="max-w-md"
      >
        {botToDelete && (
          <div className="space-y-4">
            <div className="p-3 bg-[#17212B] rounded-[7px] border border-[#2B3944] space-y-1.5 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-[#A1AFB8]">Nama Bot:</span>
                <strong className="text-[#E4EBEF]">{botToDelete.name}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[#A1AFB8]">ID Bot:</span>
                <span className="text-[#E4EBEF]">{botToDelete.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#A1AFB8]">Tipe / Pair:</span>
                <span className="text-[#D6A85C]">{botToDelete.botType} ({botToDelete.pairId})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#A1AFB8]">Status Saat Ini:</span>
                <span className={botToDelete.status === 'RUNNING' ? 'text-[#35B887] font-semibold' : 'text-[#A1AFB8]'}>
                  {botToDelete.status}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2.5 text-xs text-[#D6A85C] bg-[#2C2415]/60 p-3 rounded-[7px] border border-[#D6A85C]/30 leading-relaxed">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                <strong>Perhatian:</strong> Jika bot sedang berjalan, worker akan segera dihentikan dan seluruh order terbuka milik bot ini pada buku order akan otomatis dibatalkan.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#202B34]">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setBotToDelete(null);
                }}
              >
                Batal
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={handleConfirmDeleteBot}
                isLoading={isLoading}
                icon={<Trash2 className="w-3.5 h-3.5" />}
              >
                Ya, Hapus Bot
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL: KILL-SWITCH CONFIRMATION */}
      <Modal
        isOpen={isKillSwitchConfirmOpen}
        onClose={() => setIsKillSwitchConfirmOpen(false)}
        title="Konfirmasi Emergency Kill-Switch"
        subtitle="Penghentian Darurat Semua Aktivitas Bot"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-xs text-[#E4EBEF] leading-relaxed">
            Apakah Anda yakin ingin mengaktifkan <strong>Emergency Kill-Switch</strong>?
          </p>

          <div className="p-3 bg-[#401F27]/50 rounded-[7px] border border-[#EA5B65]/40 text-xs text-[#E4EBEF] space-y-1.5">
            <div>• <strong>Semua bot aktif</strong> di seluruh environment akan seketika dihentikan (HALTED).</div>
            <div>• <strong>Seluruh order terbuka</strong> yang dipasang oleh bot akan langsung ditarik dari order book.</div>
            <div>• Sistem dapat dipulihkan kapan saja dengan menekan <em>Reset Kill-Switch</em>.</div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#202B34]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsKillSwitchConfirmOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={async () => {
                setIsKillSwitchConfirmOpen(false);
                try {
                  await handleAction('/api/mm/kill-switch', 'POST');
                } catch (e) {}
              }}
              isLoading={isLoading}
              icon={<ShieldAlert className="w-3.5 h-3.5" />}
            >
              Aktifkan Kill-Switch Sekarang
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
