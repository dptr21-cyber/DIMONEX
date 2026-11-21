/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * types.ts
 * Core domain entities and enumerations for DIMONEX exchange.
 */

export type UserRole = 'user' | 'compliance' | 'admin' | 'superadmin' | 'USER' | 'MM' | 'ADMIN';
export type UserStatus = 'active' | 'frozen' | 'suspended';
export type KycStatus = 'unverified' | 'pending' | 'approved' | 'rejected';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';
export type TimeInForce = 'GTC' | 'IOC';
export type OrderStatus = 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type Environment = 'DEMO' | 'STAGING' | 'PRODUCTION';
export type SpotLayoutPreset = 'CLASSIC' | 'PRO_TERMINAL' | 'CHART_FOCUS';

export interface UserTradingPreferences {
  spotLayout: SpotLayoutPreset;
  hideRecentTradesInChartFocus?: boolean;
  updatedAt: number;
}
export type BotStatus = 'DRAFT' | 'VALIDATING' | 'READY' | 'RUNNING' | 'PAUSED' | 'STOPPING' | 'STOPPED' | 'ERROR' | 'RISK_HALTED';
export type BotType = 
  | 'ORDER_BOT' 
  | 'VOLUME_BOT' 
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

export type JournalTxType = 
  | 'DEPOSIT' 
  | 'WITHDRAW' 
  | 'ORDER_LOCK' 
  | 'ORDER_UNLOCK' 
  | 'TRADE_SETTLEMENT' 
  | 'FEE_COLLECTION'
  | 'FUTURES_FEE'
  | 'FUTURES_PNL'
  | 'REWARD_PAYOUT'
  | 'REFERRAL_REBATE';

export type LedgerEntryType = 'DEBIT' | 'CREDIT';

export interface OrderBotConfig {
  account_id: string;
  price_source: 'BEST_BID' | 'BEST_ASK' | 'MIDPOINT' | 'LAST_PRICE';
  price_decimal: number;
  quantity_decimal: number;
  random_min_quantity: string;
  random_max_quantity: string;
  order_count: number;
  expire_time: number; // Duration in seconds (e.g. 60 = 1 minute, 0 = GTC)
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
  min_delay: number; // in seconds
  max_delay: number; // in seconds
  min_difference: string; // price spread or delta ticks
  max_difference: string;
  priority: 'RANDOM' | 'HIGH' | 'NORMAL';
  max_limit_price: string;
  min_limit_price: string;
  vol_idr_stop_target: string; // Target volume in IDR
  vol_idr_start_threshold: string;
  volume_sell_account_id?: string;
}

export interface PriceFollowerConfig {
  account_id: string;
  market_symbol: string;
  reference_provider: 'AGGREGATED' | 'BINANCE' | 'BYBIT' | 'COINMARKETCAP';
  reference_price_source: 'MIDPOINT' | 'LAST_PRICE' | 'BEST_BID' | 'BEST_ASK';
  reference_price_mode: 'STATIC_OFFSET' | 'DYNAMIC_SPREAD';
  target_spread_bps: number;          // e.g. 40 bps = 0.40%
  buy_offset_bps: number;             // e.g. 20 bps = 0.20%
  sell_offset_bps: number;            // e.g. 20 bps = 0.20%
  order_quantity: string;             // Base units string e.g. '0.05'
  minimum_reprice_interval_ms: number;// e.g. 2000
  minimum_price_change_bps: number;   // e.g. 5 bps
  maximum_price_deviation_bps: number;// e.g. 300 bps
  maximum_order_quantity: string;     // e.g. '1.0'
  maximum_order_value_idr: string;    // e.g. '100000000' (100 Juta IDR)
  maximum_open_orders: number;        // e.g. 2 (1 buy, 1 sell)
  maximum_inventory: string;          // Maximum base unit balance allowed to hold
  maximum_daily_turnover_idr: string; // IDR turnover cap
  maximum_daily_loss_idr: string;     // Loss stop cap
  maximum_cancel_replace_rate: number;// max cancels/sec
  max_data_age_ms: number;            // e.g. 5000
  tick_size: number;                  // e.g. 1000 IDR
  lot_size: string;                   // e.g. '0.0001'
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
  bid_level_offsets_bps: number[];    // e.g. [10, 25, 50, 100]
  ask_level_offsets_bps: number[];    // e.g. [10, 25, 50, 100]
  bid_quantities: string[];           // e.g. ['0.02', '0.05', '0.10']
  ask_quantities: string[];           // e.g. ['0.02', '0.05', '0.10']
  quantity_randomization_enabled: boolean;
  random_min_quantity: string;
  random_max_quantity: string;
  minimum_reprice_interval_ms: number;// e.g. 3000
  minimum_price_change_bps: number;   // e.g. 10 bps
  maximum_open_orders: number;        // e.g. 20 to 40
  maximum_total_bid_value_idr: string;// e.g. '500000000'
  maximum_total_ask_quantity: string; // e.g. '5.0'
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
  symbol: string;       // e.g. 'BTCUSDT', 'SOLUSDT'
  baseAsset: string;    // e.g. 'BTC'
  quoteAsset: string;   // e.g. 'USDT'
  label?: string;
  providers: ('binance' | 'bybit')[];
  enabled: boolean;
  addedBy?: string;
  addedAt: number;
}

export interface MovementDepthLiquidityConfig {
  account_id: string;
  market_symbol: string;
  leader_symbol: string; // e.g. 'BTCUSDT' from Admin WS whitelist
  leader_provider: 'AGGREGATED' | 'BINANCE' | 'BYBIT';
  anchor_local_price: string; // Initial local price for target token e.g. '1000' IDR or '0.05' USDT
  leader_baseline_price?: number; // Captured leader price at start/anchor reset
  last_leader_price?: number;
  last_leader_return_pct?: number;
  last_projected_local_price?: number;
  movement_sensitivity: number; // Beta multiplier e.g. 1.0 = 1:1 % move
  movement_threshold_bps?: number; // Min move bps to trigger early rotation
  min_price_guard?: string; // Optional floor price in local quote currency
  max_price_guard?: string; // Optional ceiling price in local quote currency
  spread_bps?: number; // Half-spread bps around projected price (default 20 bps)
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
  target_spread_pct: number;           // e.g. 0.08%
  min_spread_pct: number;              // e.g. 0.02%
  max_spread_pct: number;              // e.g. 0.40%
  micro_order_size: string;            // Micro-lot size, e.g. '0.001'
  max_ladder_levels: number;           // 2 or 3
  max_base_inventory: string;          // e.g. '5.0'
  max_quote_inventory: string;         // e.g. '50000.0'
  inventory_skew_factor: number;       // -1.0 to 1.0 (default 0.25)
  volatility_threshold_bps: number;    // e.g. 120 bps
  pump_dump_multiplier: number;        // e.g. 2.5
  defense_perimeter_multiplier: number;// e.g. 3.0
  tighten_spread_enabled: boolean;     // Step inside best bid/ask
  trend_leaning_enabled: boolean;      // Shift quotes according to micro-EMA momentum
  flash_defense_enabled: boolean;      // Pump/dump flash defense
  reprice_interval_ms: number;         // e.g. 1500 ms
  activeOrderIds?: string[];
  lastTrend?: 'UPTREND' | 'DOWNTREND' | 'NEUTRAL';
  lastSkewBps?: number;
  isFlashDefenseActive?: boolean;
  lastInventorySkew?: number;
}

export type PatternFormationType = 
  // 1. Reversal Patterns
  | 'HEAD_AND_SHOULDERS'
  | 'INVERSE_HEAD_AND_SHOULDERS'
  | 'DOUBLE_TOP'
  | 'TRIPLE_TOP'
  | 'DOUBLE_BOTTOM'
  | 'TRIPLE_BOTTOM'
  // 2. Continuation Patterns
  | 'BULLISH_FLAG'
  | 'BEARISH_FLAG'
  | 'PENNANT'
  | 'CUP_AND_HANDLE'
  | 'RECTANGLE'
  // 3. Bilateral / Neutral Patterns
  | 'ASCENDING_TRIANGLE'
  | 'DESCENDING_TRIANGLE'
  | 'SYMMETRICAL_TRIANGLE';

export type PatternTimeframe = '5m' | '15m' | '1h' | '4h';

export interface SmartHftLadderConfig {
  account_id: string;
  timeframe: PatternTimeframe;
  pattern: PatternFormationType;
  total_orders: number; // Default 40, max 100
  bound_percentage?: number; // Optional percentage range from current price (e.g. 1%, 2%, 3%, 5%, 8%)
  min_spread_bps?: number; // Minimum spread buffer in basis points (e.g. 20 bps = 0.20%, prevents Level 1 from being too tight)
  spread_percentage?: number; // Minimum spread buffer in percentage (e.g. 0.25%)
  min_price_bound: string; // Absolute lower bound (IDR / USDT quote unit)
  max_price_bound: string; // Absolute upper bound (IDR / USDT quote unit)
  min_buy_lot: string; // Base asset units (closest level)
  max_buy_lot: string; // Base asset units (furthest level)
  min_sell_lot: string;
  max_sell_lot: string;
  reprice_interval_ms: number; // e.g. 3000ms
  gaussian_noise_scale?: number;
  activeOrderIds?: string[];
  lastAnchorPrice?: string;
  currentPatternIndex?: number; // Progressive bar step along the 14 geometric chart patterns (0 to totalBars - 1)
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
  targetBaseRatioPct: number; // e.g. 50 (50% base, 50% quote asset value)
  deviationThresholdPct: number; // e.g. 5 (triggers when |actual - target| >= 5%)
  maxOrderSizeQuote: string; // Max quote value cap per rebalance order e.g. '100000000'
  rebalanceOrderType: 'LIMIT_PASSIVE' | 'LIMIT_AGGRESSIVE';
  slippageTolerancePct: number; // e.g. 0.2%
  checkIntervalSec: number; // e.g. 10s
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

export interface AdvancedMarketMakerConfig {
  account_id: string;
  pair_id: string;
  timeframe?: string; // Analysis timeframe, default '15m'
  
  // Section B: Liquidity Configuration
  bid_levels: number; // e.g. 1 to 20
  ask_levels: number; // e.g. 1 to 20
  bid_base_quantity: string; // Base start quantity per level e.g. '0.01'
  ask_base_quantity: string; // Base start quantity per level e.g. '0.01'
  quantity_distribution: 'LINEAR' | 'GEOMETRIC' | 'EXPONENTIAL' | 'FLAT';
  spread_min_bps: number; // e.g. 10 bps (0.10%)
  spread_max_bps: number; // e.g. 150 bps (1.50%)
  price_offset_bps: number; // e.g. 0
  order_refresh_interval_ms: number; // e.g. 2500 ms
  maximum_open_orders: number; // e.g. 40
  spacing_mode: 'LINEAR' | 'GEOMETRIC' | 'VOLATILITY_ADAPTIVE';

  // Section C: Adaptive Market Configuration
  adaptive_quoting_enabled: boolean;
  volatility_monitoring_enabled: boolean;
  inventory_rebalancing_enabled: boolean;
  dynamic_spread_enabled: boolean;
  market_regime_detection_enabled: boolean;
  risk_protection_enabled: boolean;

  // Section D: Risk Configuration
  maximum_inventory: string; // Base units limit (e.g. '5.0')
  maximum_order_value_quote: string; // Quote units limit per order (e.g. '50000000' IDR)
  maximum_exposure_quote: string; // Quote units limit across all orders (e.g. '500000000' IDR)
  maximum_daily_loss_quote: string; // Quote loss limit (e.g. '25000000' IDR)
  maximum_price_deviation_pct: number; // Maximum % deviation from mid/last price (e.g. 5.0%)
  minimum_available_balance_quote: string; // Minimum quote balance buffer
  emergency_stop: boolean; // Emergency stop kill-switch toggle

  // Monitoring State & Runtime Metrics
  activeOrderIds?: string[];
  lastRepriceTimestamp?: number;
  lastReferencePrice?: string;
  lastSpreadBps?: number;
  lastDetectedRegime?: string;
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
    executedVolume: string; // Base units
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

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  role: UserRole;
  status: UserStatus;
  totpSecret?: string;
  isTotpEnabled: boolean;
  failedLoginAttempts: number;
  lockedUntil?: number; // epoch ms
  preferences?: UserTradingPreferences;
  referralCode?: string;
  referredByUserId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserKyc {
  id: string;
  userId: string;
  fullName: string;
  nik: string; // Indonesian National ID
  birthDate: string;
  idCardUrl?: string;
  selfieUrl?: string;
  status: KycStatus;
  rejectionReason?: string;
  tierLevel: number; // 1 = 25M IDR/day, 2 = 500M IDR/day
  reviewedBy?: string;
  reviewedAt?: number;
  createdAt: number;
}

export interface LedgerAccount {
  id: string;
  userId: string;
  currency: string;
  balanceAvailable: string; // BigInt unit string
  balanceLocked: string;    // BigInt unit string
  version: number;
  updatedAt: number;
}

export interface JournalTransaction {
  id: string;
  idempotencyKey: string;
  txType: JournalTxType;
  referenceId: string;
  description: string;
  createdAt: number;
}

export interface LedgerEntry {
  id: string;
  journalId: string;
  accountId: string;
  entryType: LedgerEntryType;
  amount: string; // BigInt unit string
  balanceAfter: string;
  createdAt: number;
}

export interface TradingPair {
  id: string; // e.g. 'BTC-IDR'
  baseCurrency: string;
  quoteCurrency: string;
  baseDecimals: number;
  quoteDecimals: number;
  minOrderSize: string; // in base units
  maxOrderSize: string;
  makerFeeBps: number;  // 10 = 0.10%
  takerFeeBps: number;  // 20 = 0.20%
  isActive: boolean;
  isHalted: boolean;
  isDelisted?: boolean;
  delistedAt?: number;
  delistScheduledAt?: number;
  delistReason?: string;
  scheduledAt?: number;
  lastPrice: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  priceChange24h: string; // percentage string e.g. "+2.45"
  quoteVolume24h?: string;
  priceChangePercent24h?: string;
}

export interface Order {
  id: string;
  userId: string;
  pairId: string;
  side: OrderSide;
  orderType: OrderType;
  timeInForce: TimeInForce;
  price: string;          // Quote unit string (0 if market)
  quantity: string;       // Base unit string
  filledQuantity: string; // Base unit string
  status: OrderStatus;
  lockedAmount: string;   // Units locked when placing
  lockedCurrency: string; // 'IDR' for BUY, baseCurrency for SELL
  clientOrderId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Trade {
  id: string;
  pairId: string;
  makerOrderId: string;
  takerOrderId: string;
  makerUserId: string;
  takerUserId: string;
  price: string;
  quantity: string;
  quoteVolume: string;
  makerFee: string;
  takerFee: string;
  takerSide: OrderSide;
  createdAt: number;
}

export interface FiatTransaction {
  id: string;
  userId: string;
  type: 'DEPOSIT' | 'WITHDRAW';
  method: 'BCA_VA' | 'MANDIRI_VA' | 'BRI_VA' | 'BANK_TRANSFER';
  amount: string; // IDR units (2 decimals)
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  accountNumber: string;
  accountHolderName: string;
  idempotencyKey: string;
  txHash?: string;
  createdAt: number;
}

export interface CryptoTransaction {
  id: string;
  userId: string;
  type: 'DEPOSIT' | 'WITHDRAW';
  currency: string;
  chain: string;
  address: string;
  amount: string;
  txHash: string;
  status: 'PENDING' | 'CONFIRMING' | 'APPROVED' | 'COMPLETED' | 'REJECTED';
  confirmations: number;
  requiredConfirmations: number;
  createdAt: number;
}

export interface ApiKey {
  id: string;
  userId: string;
  keyId: string;
  secretHash: string;
  label: string;
  permissions: ('read' | 'trade')[];
  ipWhitelist?: string;
  isActive: boolean;
  createdAt: number;
}

export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  resource: string;
  details: string;
  ipAddress?: string;
  createdAt: number;
}

// -------------------------------------------------------------
// INITIAL LISTING DOMAIN ENTITIES & ENUMS
// -------------------------------------------------------------
export type AssetStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
export type AssetType = 'NATIVE' | 'TOKEN';

export type ListingStatus = 
  | 'DRAFT' 
  | 'PENDING_REVIEW' 
  | 'APPROVED' 
  | 'REJECTED' 
  | 'SCHEDULED' 
  | 'ACTIVE' 
  | 'SUSPENDED' 
  | 'CANCELLED';

export type MarketStatus = 'PREPARING' | 'ACTIVE' | 'HALTED' | 'CLOSED';
export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED';

export interface Asset {
  id: string;
  symbol: string;           // Normalized, uppercase, unique (e.g. BTC, IDR, SOL)
  name: string;             // e.g. 'Solana'
  logoUrl?: string;         // Uploaded data URI (PNG/WebP/SVG) or HTTPS icon URL
  assetType: AssetType;     // 'NATIVE' | 'TOKEN'
  category?: string;        // e.g. 'Layer 1', 'Stablecoin', 'DeFi', 'Meme', 'Fiat'
  decimals: number;         // Display & unit precision (0 - 18)
  network: string;          // e.g. 'BITCOIN', 'ETHEREUM', 'SOLANA', 'FIAT'
  contractAddress?: string; // Validated per network
  description?: string;     // Asset overview shown in market details
  websiteUrl?: string;      // Official project website
  explorerUrl?: string;     // Block explorer URL
  status: AssetStatus;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  depositOpenedAt?: number;    // Timestamp ms when deposit opens
  withdrawalOpenedAt?: number; // Timestamp ms when withdrawal opens
  createdAt: number;
  updatedAt: number;
}

export interface ListingRequest {
  id: string;
  assetId: string;
  quoteAssetId: string;     // Default quote asset is IDR
  status: ListingStatus;
  tickSize: string;         // BigInt sen integer string
  lotSize: string;          // BigInt base unit integer string
  minQuantity: string;      // BigInt base unit integer string
  maxQuantity?: string;     // BigInt base unit integer string
  minNotional: string;      // BigInt quote sen integer string
  makerFeeBps: number;      // Integer bps e.g. 10
  takerFeeBps: number;      // Integer bps e.g. 20
  scheduledAt?: number;     // Timestamp ms
  depositOpenedAt?: number; // Timestamp ms when deposit opens (null = immediately upon listing)
  withdrawalOpenedAt?: number; // Timestamp ms when withdrawal opens
  depositEnabled?: boolean;
  withdrawalEnabled?: boolean;
  marketMakerAccountId?: string;  // Designated Market Maker account ID (e.g. 'usr-mm-0000-0000-000000000001')
  projectOwnerAccountId?: string; // Project Owner / Issuer Trader account ID
  initialLiquidityBase?: string;  // Pre-seed base token quantity string (BigInt)
  initialLiquidityQuoteIdr?: string; // Pre-seed IDR quote sen string (BigInt)
  createdBy: string;        // Maker Admin user ID
  version: number;          // Optimistic concurrency control
  createdAt: number;
  updatedAt: number;
}

export interface ListingApproval {
  id: string;
  listingRequestId: string;
  reviewerId: string;       // Checker Admin user ID (must NOT equal createdBy)
  decision: 'APPROVED' | 'REJECTED';
  reason: string;
  configVersion: number;    // Version of listing that was approved
  reviewedAt: number;
}

export interface Market {
  id: string;               // e.g. 'SOL-IDR'
  baseAssetId: string;
  quoteAssetId: string;
  listingRequestId: string;
  symbol: string;           // e.g. 'SOL-IDR'
  status: MarketStatus;     // 'PREPARING' | 'ACTIVE' | 'HALTED' | 'CLOSED'
  tickSize: string;
  lotSize: string;
  minQuantity: string;
  minNotional: string;
  makerFeeBps: number;
  takerFeeBps: number;
  activatedAt?: number;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ListingAuditEvent {
  id: string;
  aggregateId: string;
  eventType: 
    | 'ASSET_CREATED' 
    | 'LISTING_CREATED' 
    | 'LISTING_UPDATED' 
    | 'LISTING_SUBMITTED' 
    | 'LISTING_APPROVED' 
    | 'LISTING_REJECTED' 
    | 'LISTING_SCHEDULED' 
    | 'MARKET_PREPARED' 
    | 'MARKET_ACTIVATED' 
    | 'MARKET_SUSPENDED' 
    | 'MARKET_RESUMED' 
    | 'MARKET_HALTED'
    | 'ACTIVATION_FAILED';
  actorId: string;
  correlationId: string;
  idempotencyKey?: string;
  aggregateVersion: number;
  payload: Record<string, any>;
  reason?: string;
  securityMetadata: {
    ip?: string;
    userAgent?: string;
    authRole?: string;
    sessionHash?: string;
  };
  previousHash: string;     // SHA-256 canonical hash chaining
  currentHash: string;      // SHA-256 canonical hash chaining
  createdAt: number;
}

export interface TransactionalOutboxEvent {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, any>;
  idempotencyKey: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  createdAt: number;
  deliveredAt?: number;
}

export interface IdempotencyRecord {
  key: string;
  scope: string;
  responseCode: number;
  responseBody: any;
  createdAt: number;
}

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

// -------------------------------------------------------------
// NEWS & ANNOUNCEMENT CMS + GLOBAL NOTIFICATION SYSTEM
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

export type DeliveryStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'SENT'
  | 'FAILED'
  | 'CANCELLED'
  | 'SKIPPED';

export interface NotificationTargetConfig {
  minKycTier?: number;
  segmentKey?: string;
  selectedUserIds?: string[];
}

export interface MediaAsset {
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

export interface Announcement {
  id: string;
  title: string;
  slug: string;
  category: AnnouncementCategory;
  shortDescription: string;
  contentHtml: string;
  contentText: string;
  coverImageUrl?: string;
  authorAdminId: string;
  authorName?: string;
  lastEditedBy?: string;
  approvedBy?: string;
  approvedAt?: number;
  publishedBy?: string;
  archivedBy?: string;
  status: AnnouncementStatus;
  isPinned: boolean;
  requiresApproval: boolean;
  notificationEnabled: boolean;
  notificationChannels: NotificationChannel[];
  targetSegment: NotificationTargetSegment;
  targetConfig?: NotificationTargetConfig;
  publishedAt?: number;
  scheduledAt?: number;
  archivedAt?: number;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface AnnouncementVersion {
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

export interface CmsAuditLog {
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

export interface NotificationCampaign {
  id: string;
  announcementId: string;
  announcementSlug: string;
  title: string;
  summary: string;
  category: AnnouncementCategory;
  coverImageUrl?: string;
  channels: NotificationChannel[];
  targetSegment: NotificationTargetSegment;
  targetConfig?: NotificationTargetConfig;
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

export interface NotificationOutboxJob {
  id: string;
  campaignId: string;
  idempotencyKey: string;
  eventType: 'CAMPAIGN_DISPATCH' | 'CAMPAIGN_RETRY';
  payload: Record<string, any>;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: number;
  lockedAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NotificationDeliveryRecord {
  id: string;
  campaignId: string;
  userId: string;
  channel: NotificationChannel;
  idempotencyKey: string; // `${campaignId}:${userId}:${channel}`
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: number;
  sentAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserNotification {
  id: string;
  userId: string;
  campaignId?: string;
  announcementId?: string;
  announcementSlug?: string;
  category: AnnouncementCategory;
  title: string;
  summary: string;
  coverImageUrl?: string;
  idempotencyKey: string;
  isRead: boolean;
  readAt?: number;
  createdAt: number;
}

export interface UserNotificationPreferences {
  userId: string;
  inAppEnabled: boolean;
  webPushEnabled: boolean;
  webPushPermissionGranted: boolean;
  emailEnabled: boolean;
  emailConsentAt?: number;
  updatedAt: number;
}

// ============================================================================
// INSTITUTIONAL VIP, TRADER REWARDS & REFERRAL PROGRAM ENTITIES
// ============================================================================

export type RewardTaskId =
  | 'SECURITY_2FA'
  | 'FIRST_DEPOSIT'
  | 'FIRST_SPOT_TRADE'
  | 'FUTURES_VOLUME_2K'
  | 'KYC_TIER_2'
  | 'SPOT_VOLUME_50K';

export interface RewardClaimRecord {
  id: string;
  userId: string;
  taskId: RewardTaskId;
  taskTitle: string;
  currency: string;
  amountUnits: string; // BigInt unit string (6 decimals for USDT)
  amountDisplay: string;
  journalId: string;
  idempotencyKey: string;
  claimedAt: number;
}

export interface ReferralRelation {
  id: string;
  referrerUserId: string;
  refereeUserId: string;
  referralCodeUsed: string;
  createdAt: number;
}

export interface ReferralPayoutRecord {
  id: string;
  userId: string;
  currency: string;
  amountUnits: string; // BigInt unit string (6 decimals for USDT)
  amountDisplay: string;
  rebateRatePct: number;
  refereeCount: number;
  journalId: string;
  idempotencyKey: string;
  claimedAt: number;
}


