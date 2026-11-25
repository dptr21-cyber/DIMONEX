/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/types/index.ts
 * Frontend domain types and internationalization dictionaries (ID / EN).
 */

export type AppLanguage = 'ID' | 'EN';

export type UserRole = 'user' | 'compliance' | 'admin' | 'superadmin' | 'USER' | 'MM' | 'ADMIN';
export type Environment = 'DEMO' | 'STAGING' | 'PRODUCTION';
export type BotStatus = 'DRAFT' | 'VALIDATING' | 'READY' | 'RUNNING' | 'PAUSED' | 'STOPPING' | 'STOPPED' | 'ERROR' | 'RISK_HALTED';
export type BotType = 
  | 'ORDER_BOT' 
  | 'VOLUME_BOT' 
  | 'VOLUME_SPREAD_BOT'
  | 'PRICE_FOLLOWER' 
  | 'DEPTH_LIQUIDITY' 
  | 'SPOT_GRID' 
  | 'BUY_LAYERS' 
  | 'SELL_LAYERS' 
  | 'SMART_TRADE'
  | 'QUANT_HFT_MM'
  | 'SMART_HFT_LADDER'
  | 'ADVANCED_MM'
  | 'MOVEMENT_DEPTH_LIQUIDITY';

export type SpotLayoutPreset = 'CLASSIC' | 'PRO_TERMINAL' | 'CHART_FOCUS';

export interface UserTradingPreferences {
  spotLayout: SpotLayoutPreset;
  hideRecentTradesInChartFocus?: boolean;
  updatedAt?: number;
}

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  status: 'active' | 'frozen' | 'suspended';
  isTotpEnabled: boolean;
  kycStatus?: 'unverified' | 'pending' | 'approved' | 'rejected';
  kycTier?: number;
  fullName?: string;
  preferences?: UserTradingPreferences;
}

export interface OrderBotConfig {
  account_id: string;
  price_source: 'BEST_BID' | 'BEST_ASK' | 'MIDPOINT' | 'LAST_PRICE';
  price_decimal: number;
  quantity_decimal: number;
  random_min_quantity: string;
  random_max_quantity: string;
  order_count: number;
  expire_time: number;
  transaction_type: 'BUY' | 'SELL';
  split_order_mode: 'NONE' | 'RANDOM_SPLIT';
  split_range: string;
  buy_trailing_min_percentage: string;
  buy_trailing_max_percentage: string;
  sell_trailing_min_percentage: string;
  sell_trailing_max_percentage: string;
  buy_min_price_limit?: string;
  buy_max_price_limit?: string;
  sell_min_price_limit?: string;
  sell_max_price_limit?: string;
  jitter_timing_pct: number;
  jitter_price_pct: number;
}

export interface VolumeBotConfig {
  account_id: string;
  volume_price_decimal: number;
  volume_quantity_decimal: number;
  volume_random_min_quantity: string;
  volume_random_max_quantity: string;
  min_delay: number;
  max_delay: number;
  min_difference: string;
  max_difference: string;
  priority: 'RANDOM' | 'HIGH' | 'NORMAL';
  max_limit_price: string;
  min_limit_price: string;
  vol_idr_stop_target: string;
  vol_idr_start_threshold: string;
  volume_sell_account_id?: string;
}

export interface VolumeSpreadBotConfig {
  account_id: string;
  counterparty_account_id?: string;
  spread_mode: 'INSIDE_SPREAD' | 'MIDPOINT_JITTER' | 'PING_PONG_EDGE';
  side_pattern: 'ALTERNATE' | 'RANDOM' | 'BUY_EATS_SELL' | 'SELL_EATS_BUY';
  random_min_quantity: string;
  random_max_quantity: string;
  min_delay: number;
  max_delay: number;
  spread_band_min_pct: number;
  spread_band_max_pct: number;
  min_spread_bps: number;
  fallback_half_spread_bps: number;
  require_two_sided_book: boolean;
  cross_delay_ms: number;
  tick_size?: string;
  min_limit_price: string;
  max_limit_price: string;
  vol_quote_stop_target: string;
  lastSideExecuted?: 'BUY' | 'SELL';
  lastSpreadBps?: number;
  lastExecPriceUnits?: string;
  spreadSelfTradesCount?: number;
  executedQuoteVolumeUnits?: string;
}

export interface PriceFollowerConfig {
  account_id: string;
  market_symbol: string;
  reference_provider: 'AGGREGATED' | 'BINANCE' | 'BYBIT' | 'COINMARKETCAP';
  reference_price_source: 'MIDPOINT' | 'LAST_PRICE' | 'BEST_BID' | 'BEST_ASK';
  reference_price_mode: 'STATIC_OFFSET' | 'DYNAMIC_SPREAD';
  target_spread_bps: number;
  buy_offset_bps: number;
  sell_offset_bps: number;
  order_quantity: string;
  minimum_reprice_interval_ms: number;
  minimum_price_change_bps: number;
  maximum_price_deviation_bps: number;
  maximum_order_quantity: string;
  maximum_order_value_idr: string;
  maximum_open_orders: number;
  maximum_inventory: string;
  maximum_daily_turnover_idr: string;
  maximum_daily_loss_idr: string;
  maximum_cancel_replace_rate: number;
  max_data_age_ms: number;
  tick_size: number;
  lot_size: string;
  enabled: boolean;
  dry_run: boolean;
  activeBuyOrderId?: string;
  activeSellOrderId?: string;
  lastRepriceTimestamp?: number;
  lastTargetPriceIdr?: number;
}

export interface DepthLiquidityConfig {
  account_id: string;
  market_symbol: string;
  price_mode?: 'EXTERNAL_REFERENCE' | 'CUSTOM_BOUNDS';
  reference_price_source: 'AGGREGATED' | 'BINANCE' | 'BYBIT' | 'COINMARKETCAP' | 'NONE';
  min_limit_buy_price?: string;       // e.g. '15000' IDR or '0.90' USDT (lowest bid in ladder)
  max_limit_buy_price?: string;       // e.g. '16200' IDR or '0.99' USDT (highest bid near spread)
  min_limit_sell_price?: string;      // e.g. '16500' IDR or '1.01' USDT (lowest ask near spread)
  max_limit_sell_price?: string;      // e.g. '18000' IDR or '1.10' USDT (highest ask in ladder)
  spacing_mode?: 'LINEAR' | 'GEOMETRIC' | 'CONCENTRATED' | 'FIXED_IDR' | 'PERCENT_BPS';
  level_spacing_idr?: number;         // e.g. 60 IDR per level
  anti_stacking_enabled?: boolean;    // Strict anti-stacking protection
  number_of_bid_levels: number;       // e.g. 5 to 20
  number_of_ask_levels: number;       // e.g. 5 to 20
  bid_level_offsets_bps: number[];
  ask_level_offsets_bps: number[];
  bid_quantities: string[];
  ask_quantities: string[];
  quantity_randomization_enabled: boolean;
  random_min_quantity: string;
  random_max_quantity: string;
  minimum_reprice_interval_ms: number;
  minimum_price_change_bps: number;
  maximum_open_orders: number;
  maximum_total_bid_value_idr: string;
  maximum_total_ask_quantity: string;
  maximum_inventory: string;
  maximum_order_value_idr: string;
  max_data_age_ms: number;
  tick_size: number;
  lot_size: string;
  dry_run: boolean;
  enabled: boolean;
  activeOrderIds?: string[];
  lastRepriceTimestamp?: number;
  liquidity_refresh_cooldown_sec?: number;
  randomize_placement_enabled?: boolean;
  price_randomization_ticks?: number;
  last_refresh_timestamp?: number;
  next_refresh_timestamp?: number;
}

export interface ExternalWsWhitelistEntry {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  label?: string;
  providers: ('binance' | 'bybit')[];
  enabled: boolean;
  addedBy?: string;
  addedAt: number;
  binancePrice?: number | null;
  bybitPrice?: number | null;
  binanceFresh?: boolean;
  bybitFresh?: boolean;
}

export interface MovementDepthLiquidityConfig {
  account_id: string;
  market_symbol: string;
  leader_symbol: string;
  leader_provider: 'AGGREGATED' | 'BINANCE' | 'BYBIT';
  anchor_local_price: string;
  leader_baseline_price?: number;
  last_leader_price?: number;
  last_leader_return_pct?: number;
  last_projected_local_price?: number;
  movement_sensitivity: number;
  movement_threshold_bps?: number;
  min_price_guard?: string;
  max_price_guard?: string;
  spread_bps?: number;
  spacing_mode: 'LINEAR' | 'GEOMETRIC' | 'CONCENTRATED' | 'FIXED_IDR' | 'PERCENT_BPS';
  level_spacing_idr?: number;
  anti_stacking_enabled?: boolean;
  number_of_bid_levels: number;
  number_of_ask_levels: number;
  bid_level_offsets_bps: number[];
  ask_level_offsets_bps: number[];
  bid_quantities: string[];
  ask_quantities: string[];
  quantity_randomization_enabled: boolean;
  random_min_quantity: string;
  random_max_quantity: string;
  minimum_reprice_interval_ms: number;
  minimum_price_change_bps: number;
  maximum_open_orders: number;
  maximum_total_bid_value_idr: string;
  maximum_total_ask_quantity: string;
  maximum_inventory: string;
  maximum_order_value_idr: string;
  max_data_age_ms: number;
  tick_size: number;
  lot_size: string;
  dry_run: boolean;
  enabled: boolean;
  activeOrderIds?: string[];
  lastRepriceTimestamp?: number;
  liquidity_refresh_cooldown_sec?: number;
  randomize_placement_enabled?: boolean;
  price_randomization_ticks?: number;
  last_refresh_timestamp?: number;
  next_refresh_timestamp?: number;
}

export interface QuantHftConfig {
  target_spread_pct: number;
  min_spread_pct: number;
  max_spread_pct: number;
  micro_order_size: string;
  max_ladder_levels: number;
  max_base_inventory: string;
  max_quote_inventory: string;
  inventory_skew_factor: number;
  volatility_threshold_bps: number;
  pump_dump_multiplier: number;
  defense_perimeter_multiplier: number;
  tighten_spread_enabled: boolean;
  trend_leaning_enabled: boolean;
  flash_defense_enabled: boolean;
  reprice_interval_ms: number;
  activeOrderIds?: string[];
  lastTrend?: 'UPTREND' | 'DOWNTREND' | 'NEUTRAL';
  lastSkewBps?: number;
  isFlashDefenseActive?: boolean;
  lastInventorySkew?: number;
}

export type PatternFormationType = 
  | 'HEAD_AND_SHOULDERS'
  | 'INVERSE_HEAD_AND_SHOULDERS'
  | 'DOUBLE_TOP'
  | 'TRIPLE_TOP'
  | 'DOUBLE_BOTTOM'
  | 'TRIPLE_BOTTOM'
  | 'BULLISH_FLAG'
  | 'BEARISH_FLAG'
  | 'PENNANT'
  | 'CUP_AND_HANDLE'
  | 'RECTANGLE'
  | 'ASCENDING_TRIANGLE'
  | 'DESCENDING_TRIANGLE'
  | 'SYMMETRICAL_TRIANGLE';

export type PatternTimeframe = '5m' | '15m' | '1h' | '4h';

export interface SmartHftLadderConfig {
  account_id: string;
  market_symbol?: string;
  pairId?: string;
  pattern: PatternFormationType;
  timeframe: PatternTimeframe;
  total_orders?: number;
  order_count?: number;
  bound_percentage?: number;
  min_spread_bps?: number;
  spread_percentage?: number;
  min_price_bound: number | string;
  max_price_bound: number | string;
  min_buy_lot: number | string;
  max_buy_lot: number | string;
  min_sell_lot: number | string;
  max_sell_lot: number | string;
  reprice_interval_ms: number;
  activeOrderIds?: string[];
  currentAnchorPrice?: number;
  lastAnchorPrice?: number | string;
  lastExecutionTimestamp?: number;
  currentPatternIndex?: number;
  totalBars?: number;
  lastRepriceTimestamp?: number;
  lastPatternMetrics?: {
    patternName: string;
    barsGenerated: number;
    currentBarIndex?: number;
    totalBars?: number;
    anchorPrice: string;
    buyLevel1: { price: string; lot: string };
    buyLevelFurthest: { price: string; lot: string };
    sellLevel1: { price: string; lot: string };
    sellLevelFurthest: { price: string; lot: string };
  };
}

export interface RebalanceEvent {
  id: string;
  timestamp: number;
  pairId: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  baseAmount?: string;
  price: string;
  quoteAmount: string;
  targetRatioPct: number;
  actualRatioPct: number;
  deviationPct: number;
  orderId?: string;
  status: 'EXECUTED' | 'FAILED' | 'SKIPPED';
  reason: string;
}

export interface PortfolioRebalanceConfig {
  id: string;
  accountId: string;
  pairId: string;
  targetBaseRatioPct: number;
  deviationThresholdPct: number;
  maxOrderSizeQuote: string;
  rebalanceOrderType: 'LIMIT_PASSIVE' | 'LIMIT_AGGRESSIVE';
  slippageTolerancePct: number;
  checkIntervalSec: number;
  enabled: boolean;
  lastRebalanceTimestamp?: number;
  lastTriggerReason?: string;
  rebalanceHistory: RebalanceEvent[];
}

export interface PerformanceMetricPoint {
  timestamp: number;
  cumulativePnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  baseInventoryValue: number;
  quoteInventoryValue: number;
  inventorySkewBps: number;
  inventoryRatioPct: number;
  latencyMs: number;
  tradesCount: number;
  volumeQuote: number;
}

export interface EngineTelemetrySeriesPoint {
  timestamp: number;
  ordersPerSecond: number;
  cancellationsPerSecond: number;
  tradesPerSecond: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  feeGeneratedIdr: number;
  makerFeeIdr: number;
  takerFeeIdr: number;
  cumulativeFeeIdr: number;
}

export interface PairFeeBreakdown {
  pairId: string;
  baseCurrency: string;
  quoteCurrency: string;
  tradesCount: number;
  makerFeesNative: string;
  takerFeesNative: string;
  totalFeesIdr: number;
  volumeIdr: number;
}

export interface EngineTelemetrySnapshot {
  timestamp: number;
  windowSeconds: number;
  pairFilter: string;
  summary: {
    currentOps: number;
    avgOps: number;
    peakOps: number;
    currentTradesPerSec: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    maxLatencyMs: number;
    totalFeesIdr: number;
    makerFeesIdr: number;
    takerFeesIdr: number;
    windowFeesIdr: number;
    feeRatePerMinIdr: number;
    totalOrdersProcessed: number;
    totalOrdersCancelled: number;
    totalTradesExecuted: number;
    openOrdersCount: number;
    activeBotsCount: number;
  };
  pairBreakdown: PairFeeBreakdown[];
  series: EngineTelemetrySeriesPoint[];
}

export type MarketRegimeType =
  | 'SIDEWAYS'
  | 'BULLISH_TREND'
  | 'BEARISH_TREND'
  | 'CONSOLIDATION'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'BREAKOUT'
  | 'REVERSAL';

export interface AdvancedMarketMakerConfig {
  account_id: string;
  pair_id: string;
  timeframe?: string;
  
  // Section B: Liquidity Configuration
  bid_levels: number;
  ask_levels: number;
  bid_base_quantity: string;
  ask_base_quantity: string;
  quantity_distribution: 'LINEAR' | 'GEOMETRIC' | 'EXPONENTIAL' | 'FLAT';
  spread_min_bps: number;
  spread_max_bps: number;
  price_offset_bps: number;
  order_refresh_interval_ms: number;
  maximum_open_orders: number;
  spacing_mode: 'LINEAR' | 'GEOMETRIC' | 'VOLATILITY_ADAPTIVE';

  // Section C: Adaptive Market Configuration
  adaptive_quoting_enabled: boolean;
  volatility_monitoring_enabled: boolean;
  inventory_rebalancing_enabled: boolean;
  dynamic_spread_enabled: boolean;
  market_regime_detection_enabled: boolean;
  risk_protection_enabled: boolean;

  // Section D: Risk Configuration
  maximum_inventory: string;
  maximum_order_value_quote: string;
  maximum_exposure_quote: string;
  maximum_daily_loss_quote: string;
  maximum_price_deviation_pct: number;
  minimum_available_balance_quote: string;
  emergency_stop: boolean;

  // Monitoring State & Runtime Metrics
  activeOrderIds?: string[];
  lastRepriceTimestamp?: number;
  lastReferencePrice?: string;
  lastSpreadBps?: number;
  lastDetectedRegime?: MarketRegimeType | string;
  lastVolatilityAtrPct?: number;
  lastInventoryBase?: string;
  lastInventoryQuote?: string;
  totalBidLiquidityQuote?: string;
  totalAskLiquidityQuote?: string;
  riskWarnings?: string[];
}

export interface BotInstance {
  id: string;
  name: string;
  botType: BotType;
  pairId: string;
  environment: Environment;
  ownerUserId: string;
  accountId: string;
  version: number;
  status: BotStatus;
  lastHeartbeat: number;
  startedAt?: number;
  stoppedAt?: number;
  lastExecutionResult?: string;
  errorInfo?: string;
  orderBotConfig?: OrderBotConfig;
  volumeBotConfig?: VolumeBotConfig;
  volumeSpreadConfig?: VolumeSpreadBotConfig;
  priceFollowerConfig?: PriceFollowerConfig;
  depthLiquidityConfig?: DepthLiquidityConfig;
  movementDepthConfig?: MovementDepthLiquidityConfig;
  quantHftConfig?: QuantHftConfig;
  smartHftConfig?: SmartHftLadderConfig;
  gridConfig?: any;
  advancedMMConfig?: AdvancedMarketMakerConfig;
  stats: {
    ordersSubmitted: number;
    ordersAccepted: number;
    ordersFilled: number;
    executedVolume: string;
    totalTrades: number;
  };
  deployedOrderIds: string[];
  logs: {
    timestamp: number;
    message: string;
    type: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK';
  }[];
  createdBy: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RiskControlsConfig {
  maxActiveBots: number;
  maxOpenOrdersPerBot: number;
  maxOrderSize: string;
  maxNotionalExposureIdr: string;
  maxDailyTradingNotionalIdr: string;
  maxPriceDeviationPct: number;
  maxOrderSubmissionRatePerMin: number;
  maxTotalReservedBalancePct: number;
  maxRetryCount: number;
  maxRuntimeMinutes: number;
  maxConsecutiveErrors: number;
  maxAllowedSlippagePct: number;
  selfTradePreventionPolicy: 'ALLOW_WASH' | 'CANCEL_MAKER' | 'CANCEL_TAKER' | 'REJECT_BOTH';
  riskControlsPolicyVersion?: number;
  isKillSwitchActive: boolean;
}

export interface UserBalance {
  currency: string;
  balanceAvailable: string;
  balanceLocked: string;
  balanceTotal: string;
  displayAvailable: string;
  displayLocked: string;
  displayTotal: string;
  available?: string | number;
  locked?: string | number;
}

export interface AssetItem {
  id: string;
  symbol: string;
  name: string;
  logoUrl?: string;
  assetType: 'NATIVE' | 'TOKEN';
  category?: string;
  decimals: number;
  network: string;
  contractAddress?: string;
  description?: string;
  websiteUrl?: string;
  explorerUrl?: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  depositOpenedAt?: number;
  withdrawalOpenedAt?: number;
  linkedPairs?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface TradingPairItem {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  baseDecimals: number;
  quoteDecimals: number;
  baseLogoUrl?: string;
  baseName?: string;
  quoteLogoUrl?: string;
  minOrderSize: string;
  maxOrderSize: string;
  makerFeeBps: number;
  takerFeeBps: number;
  isActive: boolean;
  isHalted: boolean;
  isDelisted?: boolean;
  delistedAt?: number;
  delistScheduledAt?: number;
  delistReason?: string;
  lastPrice: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  priceChange24h: string;
  symbol?: string;
  quoteVolume24h?: string;
  priceChangePercent24h?: string;
  isNewListing?: boolean;
  listingStatus?: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'SCHEDULED' | 'ACTIVE' | 'SUSPENDED' | 'DELISTED';
  depositEnabled?: boolean;
  withdrawalEnabled?: boolean;
  depositOpenedAt?: number;
  withdrawalOpenedAt?: number;
  scheduledAt?: number;
}

export interface OrderItem {
  id: string;
  userId: string;
  pairId: string;
  side: 'BUY' | 'SELL';
  orderType: 'LIMIT' | 'MARKET';
  timeInForce: 'GTC' | 'IOC';
  price: string;
  quantity: string;
  filledQuantity: string;
  status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  lockedAmount: string;
  lockedCurrency: string;
  clientOrderId?: string;
  createdAt: number;
}

export interface TradeItem {
  id: string;
  pairId: string;
  makerOrderId: string;
  takerOrderId: string;
  makerUserId?: string;
  takerUserId?: string;
  price: string;
  quantity: string;
  quoteVolume: string;
  takerSide: 'BUY' | 'SELL';
  createdAt: number;
}

export interface CandleItem {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const I18N = {
  ID: {
    brandSubtitle: 'Bursa Kripto Spot IDR',
    navMarkets: 'Pasar',
    navTrade: 'Trading',
    navBot: 'Bot Algo Console',
    navWallet: 'Dompet & Saldo',
    navSecurity: 'Keamanan & API',
    navKyc: 'Verifikasi KYC',
    navAdmin: 'Admin Console',
    login: 'Masuk',
    register: 'Daftar',
    logout: 'Keluar',
    orderBook: 'Buku Order (Order Book)',
    marketTrades: 'Transaksi Pasar Live',
    placeOrder: 'Pasang Order',
    buy: 'Beli',
    sell: 'Jual',
    limit: 'Limit',
    market: 'Market',
    price: 'Harga',
    amount: 'Jumlah',
    total: 'Total',
    available: 'Tersedia',
    locked: 'Terkunci',
    cancel: 'Batal',
    openOrders: 'Order Aktif',
    orderHistory: 'Riwayat Order',
    depositIDR: 'Deposit IDR (Virtual Account)',
    withdrawIDR: 'Tarik Rupiah (Bank Transfer)',
    cryptoDeposit: 'Deposit Kripto',
    cryptoWithdraw: 'Tarik Kripto',
    feeEst: 'Estimasi Biaya',
    tif: 'Waktu Berlaku (TIF)',
    gtc: 'GTC (Good Till Cancelled)',
    ioc: 'IOC (Immediate Or Cancel)',
    securitySettings: 'Pengaturan Keamanan & Kunci API',
    enable2fa: 'Aktifkan 2FA TOTP',
    disable2fa: 'Nonaktifkan 2FA',
    apiKeys: 'Kunci API (HMAC-SHA256)',
    createApiKey: 'Buat Kunci API Baru',
    kycTitle: 'Verifikasi Identitas Resmi (KYC)',
    kycSubtitle: 'Sesuai regulasi Bappebti untuk perlindungan nasabah dan pencegahan pencucian uang.',
    approved: 'Terverifikasi (Tier 1)',
    pending: 'Menunggu Review',
    unverified: 'Belum Terverifikasi',
    switchPair: 'Pilih Pair Spot',
    adminConsole: 'Konsol Operator & Kepatuhan'
  },
  EN: {
    brandSubtitle: 'Spot Crypto Exchange IDR',
    navMarkets: 'Markets',
    navTrade: 'Trade',
    navBot: 'Algo Bot Console',
    navWallet: 'Wallet & Balances',
    navSecurity: 'Security & API',
    navKyc: 'KYC Verification',
    navAdmin: 'Admin Console',
    login: 'Sign In',
    register: 'Sign Up',
    logout: 'Sign Out',
    orderBook: 'Order Book Depth',
    marketTrades: 'Live Market Trades',
    placeOrder: 'Place Order',
    buy: 'Buy',
    sell: 'Sell',
    limit: 'Limit',
    market: 'Market',
    price: 'Price',
    amount: 'Amount',
    total: 'Total',
    available: 'Available',
    locked: 'Locked',
    cancel: 'Cancel',
    openOrders: 'Open Orders',
    orderHistory: 'Order History',
    depositIDR: 'Deposit IDR (Virtual Account)',
    withdrawIDR: 'Withdraw IDR (Bank Transfer)',
    cryptoDeposit: 'Crypto Deposit',
    cryptoWithdraw: 'Crypto Withdraw',
    feeEst: 'Estimated Fee',
    tif: 'Time In Force (TIF)',
    gtc: 'GTC (Good Till Cancelled)',
    ioc: 'IOC (Immediate Or Cancel)',
    securitySettings: 'Security Settings & API Keys',
    enable2fa: 'Enable 2FA TOTP',
    disable2fa: 'Disable 2FA',
    apiKeys: 'API Keys (HMAC-SHA256)',
    createApiKey: 'Generate New API Key',
    kycTitle: 'Identity Verification (KYC)',
    kycSubtitle: 'Compliant with financial regulatory standards and anti-money laundering frameworks.',
    approved: 'Verified (Tier 1)',
    pending: 'Pending Review',
    unverified: 'Unverified',
    switchPair: 'Select Spot Pair',
    adminConsole: 'Operator & Risk Console'
  }
};

export type BacktestDataSourceMode =
  | 'LEDGER_SETTLED_TRADES'
  | 'ALL_HISTORICAL_TRADES'
  | 'KLINE_OHLCV_REPLAY';

export interface BacktestRequest {
  pairId: string;
  dataSourceMode?: BacktestDataSourceMode;
  startTime?: number;
  endTime?: number;
  initialBaseBalance: string;
  initialQuoteBalance: string;
  makerFeeBps?: number;
  takerFeeBps?: number;
  slippageBps?: number;
  timeframe: PatternTimeframe;
  pattern: PatternFormationType;
  total_orders: number;
  bound_percentage?: number;
  min_price_bound?: string;
  max_price_bound?: string;
  min_buy_lot: string;
  max_buy_lot: string;
  min_sell_lot: string;
  max_sell_lot: string;
  min_spread_bps?: number;
  spread_percentage?: number;
  reprice_interval_ms: number;
  klineTimeframe?: string;
  label?: string;
}

export interface SimulatedFillEvent {
  index: number;
  timestamp: number;
  side: 'BUY' | 'SELL';
  ladderLevel: number;
  fillPrice: number;
  quantity: number;
  quoteVolume: number;
  feeQuote: number;
  sourceTradeId: string;
  journalId?: string;
  ledgerVerified: boolean;
  realizedPnl: number;
  equityAfter: number;
  inventoryBaseAfter: number;
}

export interface EquityCurvePoint {
  index: number;
  timestamp: number;
  marketPrice: number;
  anchorPrice: number;
  minBound: number;
  maxBound: number;
  equityQuote: number;
  realizedPnlQuote: number;
  unrealizedPnlQuote: number;
  drawdownPct: number;
  inventoryBase: number;
  inventoryQuote: number;
  cumulativeFeesQuote: number;
  fillsCount: number;
}

export interface RungHitStat {
  level: number;
  side: 'BUY' | 'SELL';
  hits: number;
  volumeBase: number;
  volumeQuote: number;
}

export interface BacktestDatasetPairInfo {
  pairId: string;
  baseCurrency: string;
  quoteCurrency: string;
  baseDecimals: number;
  quoteDecimals: number;
  lastPriceFloat: number;
  totalTrades: number;
  journalVerifiedTrades: number;
  ledgerEntriesLinked: number;
  klineCandles15m: number;
  earliestTradeTs: number | null;
  latestTradeTs: number | null;
  suggestedInitialBase: string;
  suggestedInitialQuote: string;
}

export interface BacktestResult {
  runId: string;
  label?: string;
  createdAt: number;
  pairId: string;
  baseCurrency: string;
  quoteCurrency: string;
  baseDecimals: number;
  quoteDecimals: number;
  dataSourceMode: BacktestDataSourceMode;
  config: SmartHftLadderConfig & {
    makerFeeBps: number;
    takerFeeBps: number;
    slippageBps: number;
    initialBaseBalance: string;
    initialQuoteBalance: string;
  };
  ledgerAudit: {
    totalPairTradesInDb: number;
    journalVerifiedTradesCount: number;
    replayedEventsCount: number;
    ledgerEntriesExamined: number;
    timeRangeStart: number;
    timeRangeEnd: number;
    datasetIntegrityHash: string;
    nonMutatingVerified: true;
  };
  summary: {
    initialEquityQuote: number;
    finalEquityQuote: number;
    netPnlQuote: number;
    netReturnPct: number;
    realizedPnlQuote: number;
    unrealizedPnlQuote: number;
    totalFeesPaidQuote: number;
    grossTradingProfitQuote: number;
    maxDrawdownQuote: number;
    maxDrawdownPct: number;
    sharpeRatio: number;
    winRatePct: number;
    profitFactor: number;
    totalBuyFills: number;
    totalSellFills: number;
    totalFills: number;
    totalRepriceCycles: number;
    totalOrdersSimulated: number;
    fillRatePct: number;
    totalTurnoverQuote: number;
    outOfBoundsSkippedTicks: number;
    insufficientBalanceSkips: number;
    endingBaseInventory: number;
    endingQuoteBalance: number;
    avgEntryCostQuote: number;
  };
  equityCurve: EquityCurvePoint[];
  fills: SimulatedFillEvent[];
  rungHitDistribution: RungHitStat[];
  executionTimeMs: number;
}

export type PriceThresholdCondition = 'ABOVE_OR_EQUAL' | 'BELOW_OR_EQUAL' | 'CROSS_EITHER';
export type PriceThresholdSoundTone = 'NONE' | 'CHIME' | 'PING' | 'ALERT_DOUBLE' | 'SIREN';
export type PriceThresholdAction =
  | 'NONE'
  | 'LADDER_RECENTER'
  | 'LADDER_WIDEN_SPREAD'
  | 'LADDER_SHIFT_UP'
  | 'LADDER_SHIFT_DOWN'
  | 'PAUSE_BOT';

export interface PriceThresholdTrigger {
  id: string;
  name: string;
  pairId: string;
  environment: Environment;
  condition: PriceThresholdCondition;
  thresholdPrice: string;
  thresholdPriceUnits: string;
  quoteCurrency: string;
  quoteDecimals: number;
  soundEnabled: boolean;
  soundTone: PriceThresholdSoundTone;
  action: PriceThresholdAction;
  targetBotId?: string;
  adjustStepPct: number;
  cooldownSec: number;
  autoResetAfterCooldown: boolean;
  enabled: boolean;
  status: 'ARMED' | 'COOLDOWN' | 'TRIGGERED';
  triggerCount: number;
  lastTriggeredAt?: number;
  lastObservedPriceUnits?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface PriceThresholdEvent {
  id: string;
  triggerId: string;
  triggerName: string;
  pairId: string;
  environment: Environment;
  condition: PriceThresholdCondition;
  thresholdPriceUnits: string;
  breachedPriceUnits: string;
  quoteCurrency: string;
  quoteDecimals: number;
  soundEnabled: boolean;
  soundTone: PriceThresholdSoundTone;
  action: PriceThresholdAction;
  targetBotId?: string;
  adjustmentSummary: string;
  timestamp: number;
  isTest?: boolean;
}

export type FuturesSide = 'LONG' | 'SHORT';
export type FuturesMarginMode = 'CROSS' | 'ISOLATED';
export type FuturesOrderType = 'MARKET' | 'LIMIT';
export type FuturesOrderStatus = 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type FuturesPositionStatus = 'OPEN' | 'CLOSED' | 'LIQUIDATED';

export interface FuturesOrder {
  id: string;
  userId: string;
  pairId: string;
  baseCurrency: string;
  quoteCurrency: string;
  baseDecimals: number;
  quoteDecimals: number;
  side: FuturesSide;
  orderType: FuturesOrderType;
  marginMode: FuturesMarginMode;
  leverage: number;
  limitPriceUnits: string;
  quantityUnits: string;
  marginRequiredUnits: string;
  feeReservedUnits: string;
  status: FuturesOrderStatus;
  positionId?: string;
  filledAt?: number;
  cancelledAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface FuturesPosition {
  id: string;
  userId: string;
  pairId: string;
  baseCurrency: string;
  quoteCurrency: string;
  baseDecimals: number;
  quoteDecimals: number;
  side: FuturesSide;
  marginMode: FuturesMarginMode;
  leverage: number;
  sizeUnits: string;
  entryPriceUnits: string;
  markPriceUnits: string;
  liqPriceUnits: string;
  marginLockedUnits: string;
  openFeeUnits: string;
  closeFeeUnits?: string;
  unrealizedPnlUnits: string;
  realizedPnlUnits: string;
  roePct: number;
  status: FuturesPositionStatus;
  openedAt: number;
  closedAt?: number;
  updatedAt: number;
}

export interface FuturesMarketInfo {
  pairId: string;
  baseCurrency: string;
  quoteCurrency: string;
  baseDecimals: number;
  quoteDecimals: number;
  lastPrice: string;
  bestBid: string;
  bestAsk: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  priceChangePercent24h: string;
  minOrderSize: string;
  maxOrderSize: string;
  makerFeeBps: number;
  takerFeeBps: number;
  fundingRatePct: number;
  nextFundingTimestamp: number;
  maxLeverage: number;
  openInterestQuoteUnits: string;
}

// -------------------------------------------------------------
// NEWS & ANNOUNCEMENT CMS + GLOBAL NOTIFICATION TYPES
// -------------------------------------------------------------
export type AnnouncementCategory =
  | 'ANNOUNCEMENT'
  | 'PLATFORM_UPDATE'
  | 'MAINTENANCE'
  | 'NEW_LISTING'
  | 'SECURITY_ALERT'
  | 'TRADING_COMPETITION'
  | 'DEPOSIT_WITHDRAWAL_UPDATE'
  | 'IMPORTANT_NOTICE';

export type AnnouncementStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'ARCHIVED';

export type NotificationChannel = 'IN_APP' | 'WEB_PUSH' | 'EMAIL';

export type NotificationTargetSegment =
  | 'ALL_USERS'
  | 'VERIFIED_USERS'
  | 'KYC_TIER'
  | 'SEGMENT'
  | 'SELECTED_USERS';

export type NotificationCampaignStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'PARTIALLY_FAILED'
  | 'FAILED'
  | 'CANCELLED';

export const ANNOUNCEMENT_CATEGORY_META: Record<
  AnnouncementCategory,
  { label: string; tone: 'brand' | 'info' | 'warning' | 'danger' | 'success' | 'neutral'; highPriority?: boolean }
> = {
  ANNOUNCEMENT: { label: 'Announcement', tone: 'brand' },
  PLATFORM_UPDATE: { label: 'Platform Update', tone: 'info' },
  MAINTENANCE: { label: 'Maintenance', tone: 'warning', highPriority: true },
  NEW_LISTING: { label: 'New Listing', tone: 'success' },
  SECURITY_ALERT: { label: 'Security Alert', tone: 'danger', highPriority: true },
  TRADING_COMPETITION: { label: 'Trading Competition', tone: 'brand' },
  DEPOSIT_WITHDRAWAL_UPDATE: { label: 'Deposit & Withdrawal Update', tone: 'info' },
  IMPORTANT_NOTICE: { label: 'Important Notice', tone: 'warning', highPriority: true },
};

export interface AnnouncementItem {
  id: string;
  title: string;
  slug: string;
  category: AnnouncementCategory;
  shortDescription: string;
  contentHtml?: string;
  contentText?: string;
  coverImageUrl?: string;
  authorAdminId?: string;
  authorName?: string;
  lastEditedBy?: string;
  approvedBy?: string;
  approvedAt?: number;
  publishedBy?: string;
  archivedBy?: string;
  status?: AnnouncementStatus;
  isPinned: boolean;
  requiresApproval?: boolean;
  notificationEnabled?: boolean;
  notificationChannels?: NotificationChannel[];
  targetSegment?: NotificationTargetSegment;
  publishedAt?: number;
  scheduledAt?: number;
  archivedAt?: number;
  version?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface AnnouncementVersionItem {
  id: string;
  announcementId: string;
  version: number;
  title: string;
  slug: string;
  category: AnnouncementCategory;
  shortDescription: string;
  contentHtml: string;
  coverImageUrl?: string;
  status: AnnouncementStatus;
  editedBy: string;
  changeSummary?: string;
  createdAt: number;
}

export interface CmsAuditLogItem {
  id: string;
  entityType: 'ANNOUNCEMENT' | 'CAMPAIGN' | 'MEDIA';
  entityId: string;
  action: string;
  actorId: string;
  actorEmail?: string;
  actorRole: string;
  ipAddress?: string;
  details: Record<string, any>;
  previousHash: string;
  currentHash: string;
  createdAt: number;
}

export interface MediaAssetItem {
  id: string;
  filename: string;
  originalName: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  sizeBytes: number;
  sha256Hash: string;
  url: string;
  altText?: string;
  uploadedBy: string;
  createdAt: number;
}

export interface NotificationCampaignItem {
  id: string;
  announcementId: string;
  announcementSlug: string;
  title: string;
  summary: string;
  category: AnnouncementCategory;
  coverImageUrl?: string;
  channels: NotificationChannel[];
  targetSegment: NotificationTargetSegment;
  idempotencyKey: string;
  status: NotificationCampaignStatus;
  createdBy: string;
  totalEligible: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  readCount: number;
  scheduledAt?: number;
  startedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  cancelledBy?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NotificationDeliveryItem {
  id: string;
  campaignId: string;
  userId: string;
  userEmail?: string;
  channel: NotificationChannel;
  idempotencyKey: string;
  status: 'QUEUED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED' | 'SKIPPED';
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: number;
  sentAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserNotificationItem {
  id: string;
  userId: string;
  campaignId?: string;
  announcementId?: string;
  announcementSlug?: string;
  category: AnnouncementCategory;
  title: string;
  summary: string;
  coverImageUrl?: string;
  isRead: boolean;
  readAt?: number;
  createdAt: number;
}

export interface UserNotificationPreferencesItem {
  userId: string;
  inAppEnabled: boolean;
  webPushEnabled: boolean;
  webPushPermissionGranted: boolean;
  emailEnabled: boolean;
  emailConsentAt?: number;
  updatedAt: number;
}

export type VolumeExecutionV2Strategy =
  | 'TWAP'
  | 'VWAP'
  | 'ICEBERG'
  | 'PASSIVE_LIMIT'
  | 'AGGRESSIVE_LIMIT';

export type VolumeExecutionV2Mode = 'LIVE' | 'SIMULATION';

export type VolumeExecutionV2Status =
  | 'DRAFT'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'STOPPED'
  | 'RISK_HALTED'
  | 'FAILED';

export interface VolumeExecutionV2Config {
  pairId: string;
  side: 'BUY' | 'SELL';
  strategy: VolumeExecutionV2Strategy;
  mode: VolumeExecutionV2Mode;
  targetQuantity: string;
  sliceMinQuantity: string;
  sliceMaxQuantity: string;
  icebergDisplayQuantity?: string;
  tickSize: string;
  lotSize: string;
  durationSeconds: number;
  intervalSeconds: number;
  maxOrderNotionalQuote: string;
  maxCumulativeExposureQuote: string;
  maxSlippageBps: number;
  maxParticipationRateBps: number;
  priceCollarMin: string;
  priceCollarMax: string;
  maxOrdersPerMinute: number;
  dailyExecutionLimitBase: string;
  maxPartialFillRetries: number;
  orderTimeoutSeconds: number;
  passiveOffsetTicks?: number;
}

export interface VolumeExecutionV2BotItem {
  id: string;
  userId: string;
  userEmail: string;
  name: string;
  pairId: string;
  strategy: VolumeExecutionV2Strategy;
  mode: VolumeExecutionV2Mode;
  status: VolumeExecutionV2Status;
  config: VolumeExecutionV2Config;
  checkpoint: {
    sliceIndex: number;
    lastSliceIdempotencyKey: string;
    lastActiveOrderId?: string;
    lastActiveOrderPlacedAt?: number;
    lastSliceRetryCount: number;
    lastTickAt: number;
    rateWindowStart: number;
    ordersInRateWindow: number;
    arrivalBenchmarkPriceUnits: string;
  };
  stats: {
    targetQuantityUnits: string;
    executedQuantityUnits: string;
    remainingQuantityUnits: string;
    fillPercentageBps: number;
    averageExecutionPriceUnits: string;
    totalQuoteNotionalUnits: string;
    totalFeesQuoteUnits: string;
    totalFeesBaseUnits: string;
    slippageBps: number;
    executionDurationMs: number;
    rejectedOrderCount: number;
    orderBreakdown: {
      submitted: number;
      accepted: number;
      partiallyFilled: number;
      filled: number;
      cancelled: number;
      rejected: number;
      expired: number;
    };
  };
  processedTradeIds: string[];
  deployedOrderIds: string[];
  submittedClientOrderIds: string[];
  lastRiskReason?: string;
  startedAt?: number;
  completedAt?: number;
  stoppedAt?: number;
  createdAt: number;
  updatedAt: number;
  logs: Array<{
    timestamp: number;
    type: 'INFO' | 'ORDER' | 'FILL' | 'RISK' | 'ERROR' | 'SIMULATION';
    message: string;
  }>;
}

export type EarnVaultType = 'FLEXIBLE' | 'FIXED' | 'STAKING' | 'LAUNCHPOOL';
export type EarnVaultStatus = 'ACTIVE' | 'PAUSED' | 'CLOSED';
export type EarnPositionStatus = 'ACTIVE' | 'MATURED' | 'REDEEMED';
export type EarnPayoutType = 'DAILY_SETTLEMENT' | 'MANUAL_CLAIM' | 'AUTO_COMPOUND' | 'REDEMPTION_SETTLEMENT';

export interface EarnVaultItem {
  id: string;
  asset: string;
  name: string;
  assetName: string;
  assetLogoUrl?: string;
  decimals: number;
  type: EarnVaultType;
  durationDays: number;
  apyBps: number;
  apyPct: number;
  minStakeUnits: string;
  maxStakeUnits: string;
  totalCapUnits: string;
  earlyRedeemAllowed: boolean;
  earlyRedeemPenaltyBps: number;
  autoCompoundSupported: boolean;
  status: EarnVaultStatus;
  isFeatured: boolean;
  custodyNote: string;
  totalStakedUnits: string;
  totalStakedDisplay: string;
  totalStakedUsd: number;
  totalStakedIdr: number;
  remainingCapUnits: string;
  utilizationBps: number;
  activeStakersCount: number;
  activePositionsCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface EarnPositionItem {
  id: string;
  userId: string;
  userEmail?: string;
  vaultId: string;
  vaultName: string;
  vaultType: EarnVaultType;
  vaultStatus: EarnVaultStatus;
  asset: string;
  decimals: number;
  principalUnits: string;
  principalDisplay: string;
  principalUsd: number;
  principalIdr: number;
  initialPrincipalUnits: string;
  apyBps: number;
  apyPct: number;
  durationDays: number;
  autoCompound: boolean;
  autoCompoundSupported: boolean;
  earlyRedeemAllowed: boolean;
  earlyRedeemPenaltyBps: number;
  status: EarnPositionStatus;
  accruedYieldUnits: string;
  accruedYieldDisplay: string;
  claimedYieldUnits: string;
  claimedYieldDisplay: string;
  totalYieldEarnedUnits: string;
  totalYieldEarnedDisplay: string;
  liveAccruingYieldUnits: string;
  liveAccruingYieldDisplay: string;
  dailyEstimatedYieldUnits: string;
  dailyEstimatedYieldDisplay: string;
  isMatured: boolean;
  canClaim: boolean;
  canRedeem: boolean;
  startedAt: number;
  maturesAt: number | null;
  redeemedAt?: number;
  stakeJournalId: string;
  redeemJournalId?: string;
  updatedAt: number;
}

export type EarnPayoutFundingSource =
  | 'EXCHANGE_FEE_POOL'
  | 'HYBRID_FEE_AND_TREASURY'
  | 'TREASURY_RESERVE'
  | 'ACCRUAL_LEDGER';

export interface EarnPayoutItem {
  id: string;
  userId: string;
  positionId: string;
  vaultId: string;
  asset: string;
  decimals: number;
  payoutType: EarnPayoutType;
  amountUnits: string;
  amountDisplay: string;
  apyBps: number;
  apyPct: number;
  settlementDayIndex?: number;
  journalId: string;
  fundingSource?: EarnPayoutFundingSource;
  feeFundedUnits?: string;
  treasuryFundedUnits?: string;
  createdAt: number;
}

export interface EarnSummaryResponse {
  vaults: EarnVaultItem[];
  platformStats: {
    totalVaults: number;
    activeVaults: number;
    totalStakersCount: number;
    totalValueLockedUsd: number;
    totalValueLockedIdr: number;
    totalYieldDistributedUsd: number;
  };
  walletBalances: Record<string, { availableUnits: string; availableDisplay: string; decimals: number }>;
  portfolio: {
    activePositionsCount: number;
    totalStakedUsd: number;
    totalStakedIdr: number;
    totalClaimableUsd: number;
    totalYieldEarnedUsd: number;
    weightedAvgApyPct: number;
  };
  positions: EarnPositionItem[];
  payouts: EarnPayoutItem[];
}

export interface EarnCustodySolvencyReport {
  isFullySolvent: boolean;
  checkedAt: number;
  assets: Array<{
    asset: string;
    decimals: number;
    custodyLedgerUnits: string;
    custodyLedgerDisplay: string;
    activePrincipalUnits: string;
    activePrincipalDisplay: string;
    deltaUnits: string;
    accruedLiabilityUnits: string;
    accruedLiabilityDisplay: string;
    isBalanced: boolean;
  }>;
}

export interface AdminTreasuryFeeOverview {
  generatedAt: number;
  fxRateIdr: number;
  summary: {
    totalExchangeFeesIdr: number;
    totalExchangeFeesUsd: number;
    fees24hIdr: number;
    fees24hUsd: number;
    spotFeesIdr: number;
    spotMakerFeesIdr: number;
    spotTakerFeesIdr: number;
    futuresFeesIdr: number;
    userDirectFeesIdr: number;
    mmBotFeesIdr: number;
    totalTradesCount: number;
    trades24hCount: number;
    feeCollectorLiveIdr: number;
    feeCollectorLiveUsd: number;
    treasuryReserveLiveIdr: number;
    treasuryReserveLiveUsd: number;
    totalSweptToTreasuryIdr: number;
    stakingClaimedAllTimeIdr: number;
    stakingClaimedAllTimeUsd: number;
    stakingClaimed24hIdr: number;
    stakingFeePoolFundedIdr: number;
    stakingTreasuryFundedIdr: number;
    stakingPendingClaimableIdr: number;
    stakingPendingClaimableUsd: number;
    netTreasuryFeePoolIdr: number;
    netTreasuryFeePoolUsd: number;
    feeCoverageRatioPct: number;
  };
  byCurrency: Array<{
    currency: string;
    decimals: number;
    feeEarnedAllTimeUnits: string;
    feeEarnedAllTimeDisplay: string;
    feeCollectorBalanceUnits: string;
    feeCollectorBalanceDisplay: string;
    treasuryReserveBalanceUnits: string;
    treasuryReserveBalanceDisplay: string;
    sweptToTreasuryUnits: string;
    sweptToTreasuryDisplay: string;
    stakingClaimedUnits: string;
    stakingClaimedDisplay: string;
    stakingFeeFundedUnits: string;
    stakingPendingUnits: string;
    stakingPendingDisplay: string;
    netFeeSurplusUnits: string;
    netFeeSurplusDisplay: string;
    feeEarnedIdr: number;
    stakingClaimedIdr: number;
    feeCollectorLiveIdr: number;
    treasuryReserveLiveIdr: number;
  }>;
  byPair: Array<{
    pairId: string;
    baseCurrency: string;
    quoteCurrency: string;
    quoteDecimals: number;
    tradeCount: number;
    trades24hCount: number;
    makerFeesUnits: string;
    takerFeesUnits: string;
    totalFeesUnits: string;
    totalFeesDisplay: string;
    userFeesUnits: string;
    userFeesDisplay: string;
    totalFeesIdr: number;
    totalFeesUsd: number;
    sharePct: number;
  }>;
  recentStakingClaims: Array<{
    id: string;
    userId: string;
    userEmail: string;
    positionId: string;
    vaultId: string;
    vaultName: string;
    asset: string;
    decimals: number;
    payoutType: EarnPayoutType;
    amountUnits: string;
    amountDisplay: string;
    amountIdr: number;
    fundingSource: EarnPayoutFundingSource;
    feeFundedUnits: string;
    treasuryFundedUnits: string;
    journalId: string;
    createdAt: number;
  }>;
}
