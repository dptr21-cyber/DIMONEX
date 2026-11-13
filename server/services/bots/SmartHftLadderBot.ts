/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * SmartHftLadderBot.ts
 * SMART HFT LADDER BOT & PATTERN CHART CREATOR ENGINE (DIMONEX Matching Engine Executor)
 * 
 * Architecture:
 * - Modul A: Advanced Pattern Chart Creator Engine
 *     * Deterministic mathematical modeling of 14 geometric chart patterns
 *     * 4 Timeframes (5m, 15m, 1h, 4h) with scaled bar counts & Gaussian noise
 *     * Computes real-time anchor price (current pivot)
 * - Modul B: Guarded Multi-Order HFT Ladder Engine
 *     * Symmetrical ladder order placement (20 Buy Limits & 20 Sell Limits, max 100)
 *     * Absolute Anti-Out-of-Bounds price boundary enforcement [min_price_bound, max_price_bound]
 *     * Uniform linear price interpolation across safe channel
 *     * Volume scaling risk guard (min_lot -> max_lot marti-light distribution)
 *     * Direct atomic integration into DIMONEX Matching Engine
 */

import { db } from '../../db/database.js';
import { matchingEngine } from '../../engine/MatchingEngine.js';
import { klineService } from '../../engine/KlineService.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { marketWsService } from '../../websocket/MarketDataWs.js';
import { BotInstance, SmartHftLadderConfig, PatternFormationType, PatternTimeframe, Trade } from '../../db/types.js';

export interface LadderLevel {
  level: number;
  side: 'BUY' | 'SELL';
  priceUnits: bigint;
  priceDisplay: string;
  quantityUnits: bigint;
  lotDisplay: string;
}

export interface SyntheticPatternPoint {
  index: number;
  normalizedValue: number;
  price: number;
}

export class SmartHftLadderBotExecutor {
  /**
   * Determine pair-specific tick size dynamically based on price magnitude and quote currency
   * to prevent price quantization clustering and duplicate ladder levels.
   */
  public static getTickSize(pair: any, currentPriceNum?: number): number {
    const isUsdtQuote = pair.quoteCurrency === 'USDT' || pair.id?.endsWith('-USDT');
    const quoteDec = pair.quoteDecimals !== undefined ? pair.quoteDecimals : (isUsdtQuote ? 6 : 2);
    const minUnitTick = 1 / (10 ** quoteDec);

    let price = currentPriceNum;
    if (price === undefined || price <= 0) {
      price = pair.lastPrice ? Number(BigInt(pair.lastPrice)) / (10 ** quoteDec) : 10000;
    }

    if (isUsdtQuote) {
      if (price >= 10000) return 0.50;
      if (price >= 1000) return 0.10;
      if (price >= 10) return 0.01;
      if (price >= 1) return 0.001;
      return Math.max(minUnitTick, 0.0001);
    }

    // IDR quote currency
    if (price >= 100000000) return 1000; // e.g. BTC-IDR
    if (price >= 1000000) return 100;    // e.g. ETH-IDR
    if (price >= 50000) return 10;       // e.g. SOL-IDR, ADA-IDR
    if (price >= 100) return 1;          // e.g. USDT-IDR, DOGE-IDR
    if (price >= 1) return 0.1;
    return Math.max(minUnitTick, 0.01);
  }

  /**
   * Format quote price units for human-readable display
   */
  public static formatDisplayPrice(priceUnits: bigint, pair: any): string {
    if (pair.quoteCurrency === 'IDR') {
      return PrecisionMath.formatIDRDisplay(priceUnits);
    }
    const val = Number(priceUnits) / (10 ** (pair.quoteDecimals || 2));
    return `${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: pair.quoteDecimals || 4 })} ${pair.quoteCurrency}`;
  }

  // Memoization cache for deterministic pattern curves: key -> normalized float curve
  private static patternCurveCache = new Map<string, number[]>();

  // LRU/TTL Cache for calculated ladders to avoid redundant calculations in high-frequency loops
  private static ladderCache = new Map<string, { timestamp: number; result: { buyLevels: LadderLevel[]; sellLevels: LadderLevel[] } }>();
  private static readonly LADDER_CACHE_TTL_MS = 1500; // 1.5 seconds TTL for HFT loops

  /**
   * Generates mathematical normalized trajectory [-1.0 to +1.0] for the 14 chart formations
   * Memoized by pattern and bar count to eliminate repetitive math/trigonometry in HFT loops.
   */
  public static generatePatternCurve(pattern: PatternFormationType, count: number): number[] {
    const cacheKey = `${pattern}:${count}`;
    const cached = this.patternCurveCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const curve: number[] = new Array(count).fill(0);
    const n = Math.max(10, count);

    for (let i = 0; i < n; i++) {
      const x = i / (n - 1); // 0.0 to 1.0

      switch (pattern) {
        case 'HEAD_AND_SHOULDERS': {
          const ls = 0.55 * Math.exp(-Math.pow(x - 0.22, 2) / (2 * Math.pow(0.07, 2)));
          const hd = 1.00 * Math.exp(-Math.pow(x - 0.50, 2) / (2 * Math.pow(0.08, 2)));
          const rs = 0.50 * Math.exp(-Math.pow(x - 0.78, 2) / (2 * Math.pow(0.07, 2)));
          const neckline = -0.10 * Math.sin(Math.PI * x);
          curve[i] = ls + hd + rs + neckline - 0.40;
          break;
        }
        case 'INVERSE_HEAD_AND_SHOULDERS': {
          const ls = -0.55 * Math.exp(-Math.pow(x - 0.22, 2) / (2 * Math.pow(0.07, 2)));
          const hd = -1.00 * Math.exp(-Math.pow(x - 0.50, 2) / (2 * Math.pow(0.08, 2)));
          const rs = -0.50 * Math.exp(-Math.pow(x - 0.78, 2) / (2 * Math.pow(0.07, 2)));
          curve[i] = ls + hd + rs + 0.40;
          break;
        }
        case 'DOUBLE_TOP': {
          const top1 = 0.85 * Math.exp(-Math.pow(x - 0.30, 2) / (2 * Math.pow(0.10, 2)));
          const top2 = 0.82 * Math.exp(-Math.pow(x - 0.70, 2) / (2 * Math.pow(0.10, 2)));
          curve[i] = top1 + top2 - 0.35;
          break;
        }
        case 'TRIPLE_TOP': {
          const p1 = 0.80 * Math.exp(-Math.pow(x - 0.20, 2) / (2 * Math.pow(0.07, 2)));
          const p2 = 0.82 * Math.exp(-Math.pow(x - 0.50, 2) / (2 * Math.pow(0.07, 2)));
          const p3 = 0.79 * Math.exp(-Math.pow(x - 0.80, 2) / (2 * Math.pow(0.07, 2)));
          curve[i] = p1 + p2 + p3 - 0.40;
          break;
        }
        case 'DOUBLE_BOTTOM': {
          const bot1 = -0.85 * Math.exp(-Math.pow(x - 0.30, 2) / (2 * Math.pow(0.10, 2)));
          const bot2 = -0.82 * Math.exp(-Math.pow(x - 0.70, 2) / (2 * Math.pow(0.10, 2)));
          curve[i] = bot1 + bot2 + 0.35;
          break;
        }
        case 'TRIPLE_BOTTOM': {
          const b1 = -0.80 * Math.exp(-Math.pow(x - 0.20, 2) / (2 * Math.pow(0.07, 2)));
          const b2 = -0.82 * Math.exp(-Math.pow(x - 0.50, 2) / (2 * Math.pow(0.07, 2)));
          const b3 = -0.79 * Math.exp(-Math.pow(x - 0.80, 2) / (2 * Math.pow(0.07, 2)));
          curve[i] = b1 + b2 + b3 + 0.40;
          break;
        }
        case 'BULLISH_FLAG': {
          if (x <= 0.35) {
            curve[i] = (x / 0.35) * 0.90;
          } else {
            const progress = (x - 0.35) / 0.65;
            curve[i] = (0.90 - progress * 0.30) + 0.10 * Math.sin(progress * 5 * Math.PI);
          }
          break;
        }
        case 'BEARISH_FLAG': {
          if (x <= 0.35) {
            curve[i] = -(x / 0.35) * 0.90;
          } else {
            const progress = (x - 0.35) / 0.65;
            curve[i] = (-0.90 + progress * 0.30) + 0.10 * Math.sin(progress * 5 * Math.PI);
          }
          break;
        }
        case 'PENNANT': {
          if (x <= 0.30) {
            curve[i] = (x / 0.30) * 0.85;
          } else {
            const progress = (x - 0.30) / 0.70;
            const amp = (1.0 - progress) * 0.25;
            curve[i] = 0.85 + amp * Math.sin(progress * 6 * Math.PI);
          }
          break;
        }
        case 'CUP_AND_HANDLE': {
          if (x <= 0.75) {
            const t = (x / 0.75) * 2 - 1;
            curve[i] = Math.pow(t, 2) * 0.75;
          } else {
            const progress = (x - 0.75) / 0.25;
            curve[i] = 0.75 - progress * 0.15 + 0.05 * Math.sin(progress * 3 * Math.PI);
          }
          break;
        }
        case 'RECTANGLE': {
          curve[i] = 0.50 * Math.sin(x * 8 * Math.PI);
          break;
        }
        case 'ASCENDING_TRIANGLE': {
          const upper = 0.60;
          const lower = -0.60 + x * 1.05;
          const cycle = 0.5 * (1 + Math.sin(x * 7 * Math.PI));
          curve[i] = lower + cycle * (upper - lower);
          break;
        }
        case 'DESCENDING_TRIANGLE': {
          const lower = -0.60;
          const upper = 0.60 - x * 1.05;
          const cycle = 0.5 * (1 + Math.sin(x * 7 * Math.PI));
          curve[i] = lower + cycle * (upper - lower);
          break;
        }
        case 'SYMMETRICAL_TRIANGLE': {
          const upper = 0.70 * (1.0 - 0.85 * x);
          const lower = -0.70 * (1.0 - 0.85 * x);
          const cycle = 0.5 * (1 + Math.sin(x * 8 * Math.PI));
          curve[i] = lower + cycle * (upper - lower);
          break;
        }
        default:
          curve[i] = 0.40 * Math.sin(x * 4 * Math.PI);
          break;
      }
    }

    this.patternCurveCache.set(cacheKey, curve);
    return curve;
  }

  /**
   * Calculates timeframe bar count and Gaussian noise scale
   */
  public static getTimeframeConfig(tf: PatternTimeframe): { bars: number; noiseStd: number } {
    switch (tf) {
      case '5m': return { bars: 60, noiseStd: 0.0020 };
      case '15m': return { bars: 100, noiseStd: 0.0035 };
      case '1h': return { bars: 150, noiseStd: 0.0065 };
      case '4h': return { bars: 240, noiseStd: 0.0120 };
      default: return { bars: 100, noiseStd: 0.0035 };
    }
  }

  /**
   * Preview synthetic pattern points and calculate current anchor pivot price
   */
  public static previewPattern(
    basePrice: number,
    pattern: PatternFormationType,
    timeframe: PatternTimeframe,
    amplitudePct = 5.0,
    specificBarIndex?: number
  ): { points: SyntheticPatternPoint[]; anchorPrice: number; currentIndex: number } {
    const { bars, noiseStd } = this.getTimeframeConfig(timeframe);
    const rawCurve = this.generatePatternCurve(pattern, bars);
    const amplitude = basePrice * (amplitudePct / 100.0);

    const points: SyntheticPatternPoint[] = [];
    for (let i = 0; i < bars; i++) {
      // Deterministic pseudo-random noise derived from seed index to keep chart curve stable
      const seed = Math.sin(i * 997.13 + 43.19) * 10000;
      const pseudoRand = seed - Math.floor(seed);
      const u1 = Math.max(0.0001, pseudoRand);
      const u2 = ((i * 137.5) % 100) / 100;
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const noise = z0 * (basePrice * noiseStd * 0.4);
      const price = basePrice + rawCurve[i] * amplitude + noise;

      points.push({
        index: i,
        normalizedValue: rawCurve[i],
        price: Math.round(price * 100) / 100
      });
    }

    const currentIndex = (specificBarIndex !== undefined && specificBarIndex >= 0 && specificBarIndex < bars)
      ? specificBarIndex
      : (points.length - 1);

    const anchorPrice = points[currentIndex].price;
    return { points, anchorPrice, currentIndex };
  }

  /**
   * Calculates the Guarded Buy and Sell ladder levels using fixed-precision arithmetic
   * with BigInt units. Includes memoization for high-frequency update loops to prevent
   * precision degradation, floating-point drift, and CPU spikes.
   */
  public static calculateLadder(
    pair: any,
    anchorPriceInput: number | bigint | string,
    cfg: SmartHftLadderConfig
  ): { buyLevels: LadderLevel[]; sellLevels: LadderLevel[] } {
    const quoteDecimals = pair.quoteDecimals !== undefined ? pair.quoteDecimals : (pair.quoteCurrency === 'USDT' ? 6 : 2);
    const baseDecimals = pair.baseDecimals || 8;

    // Convert boundaries to exact BigInt units
    const minBoundUnits = typeof cfg.min_price_bound === 'string'
      ? PrecisionMath.parseToUnits(cfg.min_price_bound, quoteDecimals)
      : BigInt(cfg.min_price_bound);

    const maxBoundUnits = typeof cfg.max_price_bound === 'string'
      ? PrecisionMath.parseToUnits(cfg.max_price_bound, quoteDecimals)
      : BigInt(cfg.max_price_bound);

    if (minBoundUnits <= 0n || maxBoundUnits <= minBoundUnits) {
      throw new Error(`Batas harga tidak valid: min_price_bound (${minBoundUnits}) harus < max_price_bound (${maxBoundUnits})`);
    }

    // Parse Anchor Price to BigInt units
    let anchorUnits: bigint;
    if (typeof anchorPriceInput === 'bigint') {
      anchorUnits = anchorPriceInput;
    } else if (typeof anchorPriceInput === 'number') {
      anchorUnits = PrecisionMath.parseToUnits(anchorPriceInput.toFixed(quoteDecimals), quoteDecimals);
    } else {
      anchorUnits = PrecisionMath.parseToUnits(String(anchorPriceInput), quoteDecimals);
    }

    const currentPriceNum = Number(anchorUnits) / (10 ** quoteDecimals);

    // Determine tickSize in BigInt units dynamically based on price
    const tickSizeNum = this.getTickSize(pair, currentPriceNum);
    const tickSizeUnits = PrecisionMath.parseToUnits(tickSizeNum.toFixed(quoteDecimals), quoteDecimals);
    const safeTick = tickSizeUnits > 0n ? tickSizeUnits : 1n;

    // Total orders & levels per side
    const totalOrders = Math.min(100, Math.max(2, cfg.total_orders || 40));
    const levelsPerSide = Math.floor(totalOrders / 2);

    // Quantize lots into exact BigInt base units
    const minBuyLotUnits = PrecisionMath.parseToUnits(cfg.min_buy_lot || '0.01', baseDecimals);
    const maxBuyLotUnits = PrecisionMath.parseToUnits(cfg.max_buy_lot || '0.50', baseDecimals);
    const minSellLotUnits = PrecisionMath.parseToUnits(cfg.min_sell_lot || '0.01', baseDecimals);
    const maxSellLotUnits = PrecisionMath.parseToUnits(cfg.max_sell_lot || '0.50', baseDecimals);

    // Guard Anchor Price within safe channel [minBound + 2*tick, maxBound - 2*tick]
    const minSafeAnchorUnits = minBoundUnits + safeTick * 2n;
    const maxSafeAnchorUnits = maxBoundUnits - safeTick * 2n;

    let effectiveAnchorUnits: bigint;
    if (minSafeAnchorUnits < maxSafeAnchorUnits) {
      effectiveAnchorUnits = anchorUnits < minSafeAnchorUnits
        ? minSafeAnchorUnits
        : (anchorUnits > maxSafeAnchorUnits ? maxSafeAnchorUnits : anchorUnits);
    } else {
      effectiveAnchorUnits = (minBoundUnits + maxBoundUnits) / 2n;
    }

    // Check Memoization Cache
    const cacheKey = `${pair.id}:${effectiveAnchorUnits.toString()}:${minBoundUnits.toString()}:${maxBoundUnits.toString()}:${levelsPerSide}:${minBuyLotUnits.toString()}:${maxBuyLotUnits.toString()}:${minSellLotUnits.toString()}:${maxSellLotUnits.toString()}`;
    const now = Date.now();
    const cached = this.ladderCache.get(cacheKey);
    if (cached && (now - cached.timestamp < this.LADDER_CACHE_TTL_MS)) {
      return cached.result;
    }

    const buyLevels: LadderLevel[] = [];
    const sellLevels: LadderLevel[] = [];

    // FIXED-PRECISION SCALING FACTOR (10^8) for sub-integer linear interpolation
    const SCALE = 100000000n;
    const stepsBig = BigInt(Math.max(1, levelsPerSide - 1));

    // Ensure sufficient channel width so all levels have strictly distinct prices
    const minRequiredSpan = BigInt(levelsPerSide) * safeTick;

    // Calculate Half-Spread Offset buffer so Level 1 Buy & Sell are not too tight/mepet
    let halfSpreadUnits = safeTick;
    if (cfg.min_spread_bps && cfg.min_spread_bps > 0) {
      // e.g. 20 bps total spread = 10 bps half spread
      halfSpreadUnits = (effectiveAnchorUnits * BigInt(cfg.min_spread_bps)) / 20000n;
    } else if (cfg.spread_percentage && cfg.spread_percentage > 0) {
      // e.g. 0.30% total spread = 0.15% half spread
      const halfBps = BigInt(Math.round(cfg.spread_percentage * 50));
      halfSpreadUnits = (effectiveAnchorUnits * halfBps) / 10000n;
    } else {
      // Default safe buffer: at least 15 bps (0.15%) or 4 ticks to prevent over-aggressive immediate fills
      const defaultBpsUnits = (effectiveAnchorUnits * 15n) / 20000n;
      halfSpreadUnits = defaultBpsUnits > (safeTick * 4n) ? defaultBpsUnits : (safeTick * 4n);
    }
    const safeSpreadOffset = halfSpreadUnits > safeTick ? halfSpreadUnits : safeTick;

    // 1. BUY LADDER: Level 1 (closest below anchor) -> Level N (touching min_price_bound)
    // Guarantee: P_buy,1 > P_buy,2 > ... > P_buy,N (Never identical prices, non-mepet spread)
    const buyStartUnits = effectiveAnchorUnits - safeSpreadOffset;
    let effectiveMinBoundUnits = minBoundUnits;
    if (buyStartUnits - effectiveMinBoundUnits < minRequiredSpan) {
      effectiveMinBoundUnits = buyStartUnits > minRequiredSpan ? (buyStartUnits - minRequiredSpan) : safeTick;
    }
    const buyPriceSpan = buyStartUnits > effectiveMinBoundUnits ? (buyStartUnits - effectiveMinBoundUnits) : minRequiredSpan;
    const buyLotSpan = maxBuyLotUnits > minBuyLotUnits ? (maxBuyLotUnits - minBuyLotUnits) : 0n;

    for (let i = 1; i <= levelsPerSide; i++) {
      const stepIndex = BigInt(i - 1);
      const tScaled = (stepIndex * SCALE) / stepsBig;

      // Price interpolation using BigInt: price = start - (t * span)
      const rawPriceUnits = buyStartUnits - (tScaled * buyPriceSpan) / SCALE;
      // Quantize to nearest tick size
      let safePriceUnits = ((rawPriceUnits + safeTick / 2n) / safeTick) * safeTick;

      // STRICT ANTI-STACKING GUARANTEE:
      // Each subsequent buy level MUST be strictly lower than the preceding level by at least 1 tick
      if (buyLevels.length > 0) {
        const prevPrice = buyLevels[buyLevels.length - 1].priceUnits;
        if (safePriceUnits >= prevPrice) {
          safePriceUnits = prevPrice - safeTick;
        }
      }

      // Ensure price never drops to <= 0
      if (safePriceUnits <= 0n) {
        safePriceUnits = safeTick;
      }

      // Quantity/Lot interpolation using BigInt
      const rawLotUnits = minBuyLotUnits + (tScaled * buyLotSpan) / SCALE;
      const safeLotUnits = rawLotUnits > maxBuyLotUnits
        ? maxBuyLotUnits
        : (rawLotUnits < minBuyLotUnits ? minBuyLotUnits : rawLotUnits);

      buyLevels.push({
        level: i,
        side: 'BUY',
        priceUnits: safePriceUnits,
        priceDisplay: this.formatDisplayPrice(safePriceUnits, pair),
        quantityUnits: safeLotUnits,
        lotDisplay: PrecisionMath.formatFromUnits(safeLotUnits, baseDecimals, true)
      });
    }

    // 2. SELL LADDER: Level 1 (closest above anchor) -> Level N (touching max_price_bound)
    // Guarantee: P_sell,1 < P_sell,2 < ... < P_sell,N (Never identical prices, non-mepet spread)
    const sellStartUnits = effectiveAnchorUnits + safeSpreadOffset;
    let effectiveMaxBoundUnits = maxBoundUnits;
    if (effectiveMaxBoundUnits - sellStartUnits < minRequiredSpan) {
      effectiveMaxBoundUnits = sellStartUnits + minRequiredSpan;
    }
    const sellPriceSpan = effectiveMaxBoundUnits > sellStartUnits ? (effectiveMaxBoundUnits - sellStartUnits) : minRequiredSpan;
    const sellLotSpan = maxSellLotUnits > minSellLotUnits ? (maxSellLotUnits - minSellLotUnits) : 0n;

    for (let i = 1; i <= levelsPerSide; i++) {
      const stepIndex = BigInt(i - 1);
      const tScaled = (stepIndex * SCALE) / stepsBig;

      // Price interpolation using BigInt: price = start + (t * span)
      const rawPriceUnits = sellStartUnits + (tScaled * sellPriceSpan) / SCALE;
      let safePriceUnits = ((rawPriceUnits + safeTick / 2n) / safeTick) * safeTick;

      // STRICT ANTI-STACKING GUARANTEE:
      // Each subsequent sell level MUST be strictly higher than the preceding level by at least 1 tick
      if (sellLevels.length > 0) {
        const prevPrice = sellLevels[sellLevels.length - 1].priceUnits;
        if (safePriceUnits <= prevPrice) {
          safePriceUnits = prevPrice + safeTick;
        }
      }

      // Quantity/Lot interpolation using BigInt
      const rawLotUnits = minSellLotUnits + (tScaled * sellLotSpan) / SCALE;
      const safeLotUnits = rawLotUnits > maxSellLotUnits
        ? maxSellLotUnits
        : (rawLotUnits < minSellLotUnits ? minSellLotUnits : rawLotUnits);

      sellLevels.push({
        level: i,
        side: 'SELL',
        priceUnits: safePriceUnits,
        priceDisplay: this.formatDisplayPrice(safePriceUnits, pair),
        quantityUnits: safeLotUnits,
        lotDisplay: PrecisionMath.formatFromUnits(safeLotUnits, baseDecimals, true)
      });
    }

    const result = { buyLevels, sellLevels };

    // Maintain cache size under 200 items to avoid memory leak in long-running processes
    if (this.ladderCache.size > 200) {
      const oldestKeys = Array.from(this.ladderCache.keys()).slice(0, 50);
      oldestKeys.forEach(k => this.ladderCache.delete(k));
    }
    this.ladderCache.set(cacheKey, { timestamp: now, result });

    return result;
  }

  /**
   * Cancels all active orders deployed by this Smart HFT Ladder bot.
   * Performs deep reconciliation against matching engine book and db.orders to prevent order stacking.
   */
  public static cancelOpenBotOrders(
    bot: BotInstance,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void,
    reason?: string
  ): number {
    const cfg = bot.smartHftConfig;
    let cancelledCount = 0;
    const orderIdsToCancel = new Set<string>();

    if (cfg?.activeOrderIds) {
      cfg.activeOrderIds.forEach(id => orderIdsToCancel.add(id));
    }
    bot.deployedOrderIds.forEach(id => orderIdsToCancel.add(id));

    const botUser = bot.accountId || bot.ownerUserId;
    const botIdSnippet = bot.id.slice(4, 9);

    // Deep reconciliation against Matching Engine OrderBook:
    // Purges any orphaned, unpersisted, or stale ladder rungs from this pair
    try {
      const book = matchingEngine.getOrderBook(bot.pairId);
      const allBookOrders = [...book.bids, ...book.asks];
      for (const ord of allBookOrders) {
        if (
          ord.userId === botUser ||
          (ord.clientOrderId && (ord.clientOrderId.startsWith('shft-') || ord.clientOrderId.includes(botIdSnippet)))
        ) {
          orderIdsToCancel.add(ord.id);
        }
      }
    } catch {}

    // Deep reconciliation against db.orders
    try {
      for (const ord of db.orders.values()) {
        if (
          ord.pairId === bot.pairId &&
          (ord.status === 'NEW' || ord.status === 'PARTIALLY_FILLED') &&
          (ord.userId === botUser || (ord.clientOrderId && ord.clientOrderId.startsWith('shft-')))
        ) {
          orderIdsToCancel.add(ord.id);
        }
      }
    } catch {}

    for (const orderId of orderIdsToCancel) {
      const order = db.orders.get(orderId);
      if (order && (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED')) {
        try {
          matchingEngine.cancelOrder(orderId, botUser, bot.pairId);
          cancelledCount++;
        } catch {}
      }
    }

    if (cfg) {
      cfg.activeOrderIds = [];
    }

    if (cancelledCount > 0) {
      addLog(bot, `Pembersihan anti-numpuk: membatalkan ${cancelledCount} order ladder terbuka (${reason || 'Rotasi/Penyegaran Ladder'}).`, 'INFO');
    }

    return cancelledCount;
  }

  /**
   * Main Execution Cycle:
   * 1. Evaluates or updates synthetic geometric pattern to derive anchor price bar-by-bar
   * 2. Anti-stacking: Sweeps and cancels existing ladder orders prior to deploying new ones
   * 3. Calculates 20 Buy / 20 Sell ladder levels with strict price bounds & volume scaling
   * 4. Submits orders directly into the Matching Engine
   * 5. Paints the selected chart pattern into real OHLC candlesticks via micro-crossing trade
   * 6. Updates bot metrics and state
   */
  public static executeCycle(
    bot: BotInstance,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void
  ) {
    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair || pair.isHalted) {
      addLog(bot, `Trading pair ${bot.pairId} dihentikan sementara (HALTED). Menunggu cycle berikutnya...`, 'RISK');
      return;
    }

    const cfg = bot.smartHftConfig;
    if (!cfg) {
      addLog(bot, 'Konfigurasi Smart HFT Ladder kosong. Melewati cycle.', 'ERROR');
      return;
    }

    // 1. Advance pattern progression bar-by-bar
    const totalBars = cfg.timeframe === '5m' ? 30 : cfg.timeframe === '15m' ? 45 : cfg.timeframe === '1h' ? 60 : 90;
    cfg.totalBars = totalBars;

    const currentIndex = typeof cfg.currentPatternIndex === 'number' ? cfg.currentPatternIndex : 0;
    const nextIndex = (currentIndex + 1) % totalBars;
    cfg.currentPatternIndex = nextIndex;
    cfg.lastRepriceTimestamp = Date.now();

    // 2. Derive Anchor Price from Market Last Price and Synthetic Pattern Simulator at nextIndex
    const quoteDecimals = pair.quoteDecimals !== undefined ? pair.quoteDecimals : (pair.quoteCurrency === 'USDT' ? 6 : 2);
    const currentMarketPriceNum = Number(BigInt(pair.lastPrice)) / (10 ** quoteDecimals);

    // Generate pattern point at nextIndex
    const { points, anchorPrice } = this.previewPattern(
      currentMarketPriceNum,
      cfg.pattern,
      cfg.timeframe,
      5.0,
      nextIndex
    );

    // Guarded Min/Max Price Bounds (Percentage-aware & Anti-Divergence)
    let minBound: number;
    let maxBound: number;

    if (cfg.bound_percentage && cfg.bound_percentage > 0) {
      const pctRatio = cfg.bound_percentage / 100;
      minBound = currentMarketPriceNum * (1 - pctRatio);
      maxBound = currentMarketPriceNum * (1 + pctRatio);
    } else {
      minBound = parseFloat(cfg.min_price_bound);
      maxBound = parseFloat(cfg.max_price_bound);

      // Guard: clamp bounds if they are unreasonably far (> 15% deviation from current price)
      const MAX_ALLOWED_SPREAD_PCT = 0.15; // 15% maximum safe channel
      const hardFloor = currentMarketPriceNum * (1 - MAX_ALLOWED_SPREAD_PCT);
      const hardCeil = currentMarketPriceNum * (1 + MAX_ALLOWED_SPREAD_PCT);

      if (minBound < hardFloor) minBound = hardFloor;
      if (maxBound > hardCeil) maxBound = hardCeil;
    }

    if (isNaN(minBound) || isNaN(maxBound) || minBound >= maxBound || minBound <= 0) {
      minBound = currentMarketPriceNum * 0.95;
      maxBound = currentMarketPriceNum * 1.05;
    }

    // Synchronize bounded strings
    cfg.min_price_bound = minBound.toFixed(quoteDecimals);
    cfg.max_price_bound = maxBound.toFixed(quoteDecimals);

    // Check if anchor is bounded safely inside channel
    const tick = this.getTickSize(pair, currentMarketPriceNum);
    const safeAnchor = Math.max(minBound + tick * 2, Math.min(maxBound - tick * 2, anchorPrice));
    cfg.lastAnchorPrice = safeAnchor.toFixed(quoteDecimals);

    // 3. Clear older ladder orders (rotasi ladder anti-stacking)
    this.cancelOpenBotOrders(bot, addLog, `Rotasi Reprice Bar #${nextIndex + 1}/${totalBars}`);

    // 4. Calculate Ladder Levels around safeAnchor
    const { buyLevels, sellLevels } = this.calculateLadder(pair, safeAnchor, cfg);

    // 5. Place 20 Buy Limit Orders & 20 Sell Limit Orders
    const newOrderIds: string[] = [];
    let placedBuys = 0;
    let placedSells = 0;
    const botUser = bot.accountId || bot.ownerUserId;
    const botIdSnippet = bot.id.slice(4, 9);
    const timestamp = Date.now();

    // Deploy BUY Orders
    for (const lvl of buyLevels) {
      try {
        const clientOrderId = `shft-b${lvl.level}-${botIdSnippet}-${timestamp}`;
        const matchRes = matchingEngine.placeOrder({
          userId: botUser,
          pairId: bot.pairId,
          side: 'BUY',
          orderType: 'LIMIT',
          timeInForce: 'GTC',
          price: lvl.priceUnits.toString(),
          quantity: lvl.quantityUnits.toString(),
          clientOrderId
        });
        const orderId = matchRes.takerOrder?.id || (matchRes as any)?.order?.id;
        if (orderId) {
          newOrderIds.push(orderId);
          placedBuys++;
          bot.stats.ordersSubmitted++;
          bot.stats.ordersAccepted++;
        }
      } catch (err: any) {
        addLog(bot, `Gagal menaruh Buy Lvl ${lvl.level} (${lvl.priceDisplay}): ${err.message}`, 'ERROR');
      }
    }

    // Deploy SELL Orders
    for (const lvl of sellLevels) {
      try {
        const clientOrderId = `shft-s${lvl.level}-${botIdSnippet}-${timestamp}`;
        const matchRes = matchingEngine.placeOrder({
          userId: botUser,
          pairId: bot.pairId,
          side: 'SELL',
          orderType: 'LIMIT',
          timeInForce: 'GTC',
          price: lvl.priceUnits.toString(),
          quantity: lvl.quantityUnits.toString(),
          clientOrderId
        });
        const orderId = matchRes.takerOrder?.id || (matchRes as any)?.order?.id;
        if (orderId) {
          newOrderIds.push(orderId);
          placedSells++;
          bot.stats.ordersSubmitted++;
          bot.stats.ordersAccepted++;
        }
      } catch (err: any) {
        addLog(bot, `Gagal menaruh Sell Lvl ${lvl.level} (${lvl.priceDisplay}): ${err.message}`, 'ERROR');
      }
    }

    cfg.activeOrderIds = newOrderIds;
    bot.deployedOrderIds.push(...newOrderIds);
    if (bot.deployedOrderIds.length > 80) {
      bot.deployedOrderIds = bot.deployedOrderIds.slice(-80);
    }

    // 6. Chart Painter Trade: Execute micro-crossing trade at anchorUnits to form the chart pattern
    const anchorUnits = PrecisionMath.parseToUnits(safeAnchor.toFixed(quoteDecimals), quoteDecimals);
    const minLotUnits = PrecisionMath.parseToUnits(cfg.min_buy_lot || '0.001', pair.baseDecimals);
    const paintQtyUnits = minLotUnits > 0n ? minLotUnits : 1n;
    const currentPriceUnits = BigInt(pair.lastPrice);

    if (anchorUnits > 0n && anchorUnits !== currentPriceUnits) {
      try {
        const paintTrade: Trade = {
          id: `paint-shft-${botIdSnippet}-${timestamp}`,
          pairId: bot.pairId,
          makerOrderId: `paint-m-${timestamp}`,
          takerOrderId: `paint-t-${timestamp}`,
          makerUserId: botUser,
          takerUserId: botUser,
          price: anchorUnits.toString(),
          quantity: paintQtyUnits.toString(),
          quoteVolume: PrecisionMath.calculateQuoteAmount(paintQtyUnits, pair.baseDecimals, anchorUnits).toString(),
          makerFee: '0',
          takerFee: '0',
          takerSide: anchorUnits > currentPriceUnits ? 'BUY' : 'SELL',
          createdAt: timestamp
        };

        db.trades.push(paintTrade);
        if (db.trades.length > 5000) {
          db.trades = db.trades.slice(-5000);
        }
        pair.lastPrice = anchorUnits.toString();
        db.tradingPairs.set(pair.id, pair);
        db.recalculatePair24hStats(pair.id);
        klineService.processTrade(paintTrade);
        marketWsService.broadcastTrade(paintTrade);
        bot.stats.ordersFilled++;
        bot.stats.totalTrades++;
      } catch (err: any) {
        console.warn('[SmartHftLadderBot] Gagal paint candlestick trade:', err);
      }
    }

    // Broadcast depth update so orderbook in UI updates instantly without stacking
    try {
      marketWsService.broadcastDepth(pair.id);
    } catch {}

    // 7. Update Metrics Record
    cfg.lastPatternMetrics = {
      patternName: cfg.pattern.replace(/_/g, ' '),
      barsGenerated: points.length,
      currentBarIndex: nextIndex + 1,
      totalBars,
      anchorPrice: this.formatDisplayPrice(anchorUnits, pair),
      buyLevel1: { price: buyLevels[0].priceDisplay, lot: buyLevels[0].lotDisplay },
      buyLevelFurthest: { price: buyLevels[buyLevels.length - 1].priceDisplay, lot: buyLevels[buyLevels.length - 1].lotDisplay },
      sellLevel1: { price: sellLevels[0].priceDisplay, lot: sellLevels[0].lotDisplay },
      sellLevelFurthest: { price: sellLevels[sellLevels.length - 1].priceDisplay, lot: sellLevels[sellLevels.length - 1].lotDisplay }
    };

    bot.lastHeartbeat = Date.now();
    bot.lastExecutionResult = `Reprice Bar #${nextIndex + 1}/${totalBars}: Berhasil menempatkan ${placedBuys} Buy Limit & ${placedSells} Sell Limit (Anchor: ${cfg.lastAnchorPrice}, Pola: ${cfg.pattern}).`;

    addLog(
      bot,
      `[HFT Ladder Reprice] Bar #${nextIndex + 1}/${totalBars}: ${placedBuys + placedSells} order dipasang simetris (Buy: ${buyLevels[0].priceDisplay} -> ${buyLevels[buyLevels.length - 1].priceDisplay} | Sell: ${sellLevels[0].priceDisplay} -> ${sellLevels[sellLevels.length - 1].priceDisplay} | Anchor: ${cfg.lastAnchorPrice}).`,
      'ORDER'
    );

    db.scheduleSave();
    marketWsService.broadcastBotUpdate(bot);
  }
}
