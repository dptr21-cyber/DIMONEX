/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/types.ts
 * Authoritative Contracts, Standardized MarketData, StrategySignal,
 * Configuration Schema v1.0, Execution, Risk, and Plugin Interfaces
 * for DIMONEX MODULAR_STRATEGY_BOT.
 */

import { Timeframe } from '../../engine/KlineService.js';

export type ModularBotCategory = 'DIRECTIONAL' | 'MARKET_MAKING' | 'HYBRID';
export type ModularBotMode = 'BACKTEST' | 'PAPER' | 'LIVE';
export type ModularBotStatus =
  | 'DRAFT'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPED'
  | 'ERROR'
  | 'RISK_HALTED';

export type ModularOrderType = 'POST_ONLY' | 'LIMIT' | 'IOC' | 'FOK' | 'MARKET';
export type ModularTimeInForce = 'GTC' | 'IOC' | 'FOK';
export type PriceReferenceType = 'LAST_TRADE' | 'MIDPOINT' | 'BEST_BID' | 'BEST_ASK';
export type PositionSizingMethod = 'FIXED_QTY' | 'FIXED_QUOTE' | 'PERCENT_BALANCE' | 'RISK_PER_TRADE';

export type SupportedIndicatorId =
  | 'SMA'
  | 'EMA'
  | 'RSI'
  | 'MACD'
  | 'BOLLINGER_BANDS'
  | 'ATR'
  | 'ADX'
  | 'STOCHASTIC'
  | 'STOCHASTIC_RSI'
  | 'VWAP'
  | 'VOLUME_MA'
  | 'OBV'
  | 'MFI';

export type RuleLogicalOperator = 'AND' | 'OR' | 'NOT';
export type RuleComparisonOperator =
  | 'GREATER_THAN'
  | 'LESS_THAN'
  | 'CROSS_ABOVE'
  | 'CROSS_BELOW'
  | 'EQUAL'
  | 'BETWEEN';

export interface IndicatorOperand {
  kind: 'INDICATOR' | 'PRICE' | 'CONSTANT';
  indicator?: SupportedIndicatorId;
  field?: string; // e.g. 'value', 'upper', 'middle', 'lower', 'macdLine', 'signalLine', 'histogram', 'k', 'd'
  params?: Record<string, number>;
  priceField?: 'close' | 'open' | 'high' | 'low' | 'volume';
  value?: number;
}

export interface RuleConditionNode {
  type: 'CONDITION';
  left: IndicatorOperand;
  operator: RuleComparisonOperator;
  right: IndicatorOperand;
  rightUpper?: IndicatorOperand; // used for BETWEEN [right, rightUpper]
}

export interface RuleGroupNode {
  type: 'GROUP';
  operator: RuleLogicalOperator;
  children: RuleNode[];
}

export type RuleNode = RuleConditionNode | RuleGroupNode;

// ==========================================
// 1. DATA & CONNECTOR LAYER INTERFACES
// ==========================================

export interface NormalizedCandle {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NormalizedOrderBookLevel {
  priceUnits: string; // Fixed-point integer string
  price: number;      // Scaled display/analysis figure
  quantityUnits: string;
  quantity: number;
  orderCount: number;
}

export interface NormalizedOrderBook {
  pairId: string;
  bids: NormalizedOrderBookLevel[];
  asks: NormalizedOrderBookLevel[];
  bestBidUnits: string;
  bestAskUnits: string;
  midpointUnits: string;
  spreadBps: number;
  sequence: number;
  timestamp: number;
}

export interface NormalizedTradeTick {
  id: string;
  priceUnits: string;
  price: number;
  quantityUnits: string;
  quantity: number;
  side: 'BUY' | 'SELL';
  timestamp: number;
}

export interface MarketVolatilityMetrics {
  atr14: number;
  atrPct: number;
  realizedVolPct: number;
  regime: string;
}

export interface MarketConstraints {
  pairId: string;
  baseCurrency: string;
  quoteCurrency: string;
  baseDecimals: number;
  quoteDecimals: number;
  minOrderSizeUnits: string;
  maxOrderSizeUnits: string;
  tickSizeUnits: string;
  lotSizeUnits: string;
  makerFeeBps: number;
  takerFeeBps: number;
  supportsShorting: boolean;
  supportsPostOnly: boolean;
  supportsFok: boolean;
  supportsIoc: boolean;
  supportsMarket: boolean;
  isActive: boolean;
  isHalted: boolean;
}

export interface NormalizedMarketData {
  source: string;
  pairId: string;
  timeframe: Timeframe;
  timestamp: number;
  sequence: number;
  isStale: boolean;
  staleReason?: string;
  referencePriceUnits: string;
  referencePrice: number;
  ticker: {
    lastPriceUnits: string;
    lastPrice: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    priceChangePct24h: number;
  };
  orderBook: NormalizedOrderBook;
  recentTrades: NormalizedTradeTick[];
  candles: NormalizedCandle[];
  volatility: MarketVolatilityMetrics;
  constraints: MarketConstraints;
}

export interface IExchangeConnector {
  readonly connectorId: string;
  readonly isExternal: boolean;
  getMarketConstraints(pairId: string): MarketConstraints | null;
  getMarketSnapshot(
    pairId: string,
    timeframe: Timeframe,
    priceReference?: PriceReferenceType,
    candleLimit?: number,
    maxDataAgeMs?: number
  ): NormalizedMarketData;
  validateFreshness(snapshot: NormalizedMarketData, maxAgeMs: number): { fresh: boolean; reason?: string };
  resynchronize(pairId: string): void;
}

// ==========================================
// 2. STRATEGY & SIGNAL LAYER INTERFACES
// ==========================================

export type DirectionalSignalType = 'LONG' | 'BUY' | 'SHORT' | 'SELL' | 'EXIT' | 'HOLD' | 'NEUTRAL';

export interface MarketMakingQuoteRecommendation {
  level: number;
  side: 'BUY' | 'SELL';
  priceUnits: string;
  quantityUnits: string;
  postOnly: boolean;
  clientTag: string;
}

export interface GridLevelRecommendation {
  levelIndex: number;
  side: 'BUY' | 'SELL';
  priceUnits: string;
  quantityUnits: string;
}

export interface MarketMakingSignalPayload {
  bidTargetPriceUnits: string;
  askTargetPriceUnits: string;
  targetSpreadBps: number;
  inventorySkewBps: number;
  recommendedBidQtyUnits: string;
  recommendedAskQtyUnits: string;
  quotes: MarketMakingQuoteRecommendation[];
  gridLevels?: GridLevelRecommendation[];
  cancelStaleOrderIds?: string[];
  directionalBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface StrategySignal {
  signalId: string;
  strategyId: string;
  botInstanceId: string;
  tradingPair: string;
  signalTimestamp: number;
  signalExpiration: number;
  category: ModularBotCategory;
  signalType: DirectionalSignalType | 'MARKET_MAKE_QUOTES' | 'GRID_SYNC';
  confidenceScore: number; // 0..100
  indicatorValues: Record<string, number | string | boolean>;
  referenceMarketPriceUnits: string;
  referenceMarketPrice: number;
  strategyExplanation: string;
  riskMetadata: {
    regime: string;
    volatilityAtrPct: number;
    suggestedStopDistanceBps?: number;
    isEligibleForTripleBarrier: boolean;
  };
  marketMaking?: MarketMakingSignalPayload;
}

export interface BotPositionState {
  botId: string;
  pairId: string;
  side: 'LONG' | 'FLAT';
  baseQtyUnits: string;
  quoteCostBasisUnits: string;
  avgEntryPriceUnits: string;
  openedAt: number | null;
  highWaterMarkPriceUnits: string;
  breakEvenArmed: boolean;
  trailingStopActive: boolean;
  activeStopLossPriceUnits: string | null;
  activeTakeProfitPriceUnits: string | null;
  unrealizedPnlQuoteUnits: string;
  realizedPnlQuoteUnits: string;
}

export interface BotExecutionRecord {
  executionId: string;
  orderId: string;
  clientOrderId: string;
  botId: string;
  mode: ModularBotMode;
  pairId: string;
  side: 'BUY' | 'SELL';
  orderType: ModularOrderType;
  priceUnits: string;
  quantityUnits: string;
  quoteVolumeUnits: string;
  feeUnits: string;
  feeCurrency: string;
  realizedPnlQuoteUnits: string;
  isPartial: boolean;
  timestamp: number;
  tradeId?: string;
}

export interface BotOpenOrderState {
  orderId: string;
  clientOrderId: string;
  botId: string;
  pairId: string;
  mode: ModularBotMode;
  side: 'BUY' | 'SELL';
  orderType: ModularOrderType;
  timeInForce: ModularTimeInForce;
  priceUnits: string;
  quantityUnits: string;
  filledQuantityUnits: string;
  lockedAmountUnits: string;
  lockedCurrency: string;
  status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

export interface StrategyExecutionContext {
  botId: string;
  mode: ModularBotMode;
  config: BotConfigSchemaV1;
  marketData: NormalizedMarketData;
  position: BotPositionState;
  openOrders: BotOpenOrderState[];
  availableBaseUnits: string;
  availableQuoteUnits: string;
  now: number;
}

export interface ConfigParameterSpec {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'string' | 'select';
  defaultValue: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  description: string;
}

export interface StrategyMetadata {
  strategyId: string;
  name: string;
  version: string;
  category: ModularBotCategory;
  description: string;
  supportedMarketTypes: ('SPOT')[];
  supportedTimeframes: Timeframe[];
  requiredIndicators: SupportedIndicatorId[];
  configurationSchema: ConfigParameterSpec[];
  riskCompatibility: {
    supportsTripleBarrier: boolean;
    supportsTrailingStop: boolean;
    requiresQuoteLevelRisk: boolean;
  };
  status: 'ACTIVE' | 'BETA' | 'DEPRECATED';
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface StrategyController {
  initialize(config: BotConfigSchemaV1): void;
  validateConfig(config: BotConfigSchemaV1, constraints?: MarketConstraints): ConfigValidationResult;
  onMarketData(data: NormalizedMarketData): void;
  generateSignal(context: StrategyExecutionContext): StrategySignal;
  onPositionUpdate(position: BotPositionState): void;
  onExecutionUpdate(execution: BotExecutionRecord): void;
  reset(): void;
  getMetadata(): StrategyMetadata;
}

// ==========================================
// 3. STANDARDIZED CONFIGURATION SCHEMA v1.0
// ==========================================

export interface BotConfigSchemaV1 {
  schemaVersion: '1.0';
  bot: {
    name: string;
    category: ModularBotCategory;
    strategyId: string;
    strategyVersion: string;
    tradingPair: string; // Supports 'BTC-IDR' or 'BTC/IDR' (normalized internally)
    mode: ModularBotMode;
  };
  market: {
    timeframe: Timeframe;
    dataSource: 'DIMONEX';
    priceReference: PriceReferenceType;
    maxDataAgeMs?: number;
  };
  strategy: {
    indicators: Record<string, number | boolean | string>;
    entryRules: RuleNode[];
    exitRules: RuleNode[];
  };
  execution: {
    orderType: ModularOrderType;
    timeInForce: ModularTimeInForce;
    postOnly: boolean;
    maxSlippageBps: number;
    orderTimeoutSeconds: number;
    retryCount?: number;
    tickIntervalMs?: number;
  };
  risk: {
    positionSizing: {
      method: PositionSizingMethod;
      value: string; // Decimal string in base units, quote units, or %
      riskPctPerTrade?: string;
    };
    tripleBarrier: {
      enabled: boolean;
      takeProfitBps: number;
      stopLossBps: number;
      takeProfitAbsPrice?: string;
      stopLossAbsPrice?: string;
      maxHoldingSeconds: number;
      exitExecutionPolicy?: 'MARKET_PROTECTED' | 'IOC' | 'LIMIT_TOP_BOOK';
    };
    trailingStop: {
      enabled: boolean;
      activationBps: number;
      distanceBps: number;
      stepBps?: number;
      breakEvenActivationBps?: number;
      breakEvenOffsetBps?: number;
    };
    limits: {
      maxOpenOrders: number;
      maxPositionBase?: string;
      maxNotional: string; // Quote currency decimal string e.g. '100000000'
      maxDailyLoss: string; // Quote currency decimal string
      maxDrawdownPct?: number;
      maxOrdersPerMinute?: number;
      emergencyStop?: boolean;
    };
  };
  paperConfig?: {
    initialQuoteBalance: string;
    initialBaseBalance: string;
    simulatedLatencyMs: number;
    simulatedSlippageBps: number;
    partialFillProbabilityPct: number;
    makerFeeBps?: number;
    takerFeeBps?: number;
  };
}

// ==========================================
// 4. EXECUTION, RISK & MODE PERSISTENCE
// ==========================================

export interface DerivativesExecutionAdapter {
  readonly supported: boolean;
  readonly reason: string;
  validateDerivativesEligibility(): { eligible: boolean; reason: string };
}

export interface AccountPortfolioRiskSnapshot {
  userId: string;
  activeLiveBotsCount: number;
  activePaperBotsCount: number;
  totalLiveOpenOrders: number;
  totalLiveExposureQuoteUnits: string;
  maxAllowedAccountExposureQuoteUnits: string;
  totalLiveDailyPnlQuoteUnits: string;
  maxAllowedAccountDailyLossQuoteUnits: string;
  isRiskLocked: boolean;
  lockReason?: string;
}

export interface PaperWalletState {
  baseCurrency: string;
  quoteCurrency: string;
  baseAvailableUnits: string;
  baseLockedUnits: string;
  quoteAvailableUnits: string;
  quoteLockedUnits: string;
}

export interface ModularBotLogEntry {
  timestamp: number;
  type: 'INFO' | 'SIGNAL' | 'ORDER' | 'FILL' | 'RISK' | 'ERROR';
  message: string;
}

export interface ModularBotRecord {
  id: string;
  botType: 'MODULAR_STRATEGY_BOT';
  ownerUserId: string;
  accountId: string;
  pairId: string;
  status: ModularBotStatus;
  config: BotConfigSchemaV1;
  livePromotionConfirmed: boolean;
  livePromotionConfirmedAt?: number;
  position: BotPositionState;
  paperWallet?: PaperWalletState;
  openOrders: BotOpenOrderState[];
  executions: BotExecutionRecord[];
  recentSignals: StrategySignal[];
  logs: ModularBotLogEntry[];
  metrics: {
    ordersSubmitted: number;
    ordersCancelled: number;
    ordersFilled: number;
    totalTrades: number;
    totalVolumeBaseUnits: string;
    totalVolumeQuoteUnits: string;
    totalFeesQuoteUnits: string;
    realizedPnlQuoteUnits: string;
    unrealizedPnlQuoteUnits: string;
    peakEquityQuoteUnits: string;
    maxDrawdownPct: number;
    dailyLossQuoteUnits: string;
    dailyLossDateWib: string;
    lastRegime: string;
    lastReferencePrice: number;
  };
  consecutiveErrors: number;
  orderTimestampsInWindow: number[];
  errorInfo?: string;
  lastTickAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface BacktestRunRequest {
  config: BotConfigSchemaV1;
  startTimeMs?: number;
  endTimeMs?: number;
  initialQuoteBalance: string;
  initialBaseBalance?: string;
  makerFeeBps?: number;
  takerFeeBps?: number;
  slippageBps?: number;
  partialFillPct?: number;
  candleLimit?: number;
  optimizeGrid?: Array<{
    paramKey: string;
    values: Array<number | string>;
  }>;
}

export interface BacktestMetricsSummary {
  totalReturnPct: number;
  netProfitQuote: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  maxDrawdownQuote: number;
  sharpeRatio: number;
  sortinoRatio: number;
  averageTradeQuote: number;
  totalFeesQuote: number;
  exposureDurationMs: number;
  exposureDurationPct: number;
  numberOfTrades: number;
  initialEquityQuote: number;
  finalEquityQuote: number;
}

export interface BacktestEquityPoint {
  time: number;
  price: number;
  equityQuote: number;
  drawdownPct: number;
  baseQty: number;
  quoteBalance: number;
}

export interface BacktestOptimizationRow {
  params: Record<string, number | string>;
  totalReturnPct: number;
  netProfitQuote: number;
  winRatePct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  numberOfTrades: number;
}

export interface BacktestReport {
  runId: string;
  ownerUserId: string;
  pairId: string;
  strategyId: string;
  timeframe: Timeframe;
  candleCount: number;
  lookAheadBiasGuardVerified: true;
  createdAt: number;
  configSnapshot: BotConfigSchemaV1;
  metrics: BacktestMetricsSummary;
  equityCurve: BacktestEquityPoint[];
  trades: BotExecutionRecord[];
  optimizationResults?: BacktestOptimizationRow[];
}
