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
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { marketWsService } from '../../websocket/MarketDataWs.js';
import { BotInstance, SmartHftLadderConfig, PatternFormationType, PatternTimeframe } from '../../db/types.js';

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
   * Determine pair-specific tick size in quote units
   */
  public static getTickSize(pair: any): number {
    const isUsdtQuote = pair.quoteCurrency === 'USDT' || pair.id.endsWith('-USDT');
    if (isUsdtQuote) return 0.01;
    if (pair.id === 'USDT-IDR') return 1;
    if (pair.id === 'ETH-IDR') return 100;
    return 1000;
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

  /**
   * Generates mathematical normalized trajectory [-1.0 to +1.0] for the 14 chart formations
   */
  public static generatePatternCurve(pattern: PatternFormationType, count: number): number[] {
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
    amplitudePct = 5.0
  ): { points: SyntheticPatternPoint[]; anchorPrice: number } {
    const { bars, noiseStd } = this.getTimeframeConfig(timeframe);
    const rawCurve = this.generatePatternCurve(pattern, bars);
    const amplitude = basePrice * (amplitudePct / 100.0);

    const points: SyntheticPatternPoint[] = [];
    for (let i = 0; i < bars; i++) {
      // Gaussian noise simulation
      const u1 = Math.max(0.0001, Math.random());
      const u2 = Math.random();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const noise = z0 * (basePrice * noiseStd);
      const price = basePrice + rawCurve[i] * amplitude + noise;

      points.push({
        index: i,
        normalizedValue: rawCurve[i],
        price: Math.round(price * 100) / 100
      });
    }

    const anchorPrice = points[points.length - 1].price;
    return { points, anchorPrice };
  }

  /**
   * Calculates the Guarded 20 Buy and 20 Sell ladder levels based on linear interpolation
   * within [min_price_bound, max_price_bound] and volume scaling [min_lot, max_lot].
   */
  public static calculateLadder(
    pair: any,
    anchorPriceNum: number,
    cfg: SmartHftLadderConfig
  ): { buyLevels: LadderLevel[]; sellLevels: LadderLevel[] } {
    const quoteDecimals = pair.quoteDecimals !== undefined ? pair.quoteDecimals : (pair.quoteCurrency === 'USDT' ? 6 : 2);
    const baseDecimals = pair.baseDecimals || 8;
    const tickSize = this.getTickSize(pair);

    const minBoundNum = parseFloat(cfg.min_price_bound);
    const maxBoundNum = parseFloat(cfg.max_price_bound);

    if (isNaN(minBoundNum) || isNaN(maxBoundNum) || minBoundNum >= maxBoundNum) {
      throw new Error(`Batas harga tidak valid: min_price_bound (${minBoundNum}) harus < max_price_bound (${maxBoundNum})`);
    }

    // Anti-Out of Bounds Guard on Anchor
    if (anchorPriceNum <= minBoundNum || anchorPriceNum >= maxBoundNum) {
      throw new Error(`[Anti-Out of Bounds Guard] Running Anchor Price (${anchorPriceNum}) berada di luar batas aman [${minBoundNum}, ${maxBoundNum}]!`);
    }

    const totalOrders = Math.min(100, Math.max(2, cfg.total_orders || 40));
    const levelsPerSide = Math.floor(totalOrders / 2);

    const minBuyLot = parseFloat(cfg.min_buy_lot || '0.01');
    const maxBuyLot = parseFloat(cfg.max_buy_lot || '0.50');
    const minSellLot = parseFloat(cfg.min_sell_lot || '0.01');
    const maxSellLot = parseFloat(cfg.max_sell_lot || '0.50');

    const buyLevels: LadderLevel[] = [];
    const sellLevels: LadderLevel[] = [];

    // 1. BUY LADDER: Level 1 (closest) -> Level N (furthest touching min_price_bound)
    const buyStartPrice = anchorPriceNum - tickSize;
    const buyEndPrice = minBoundNum;

    for (let i = 1; i <= levelsPerSide; i++) {
      const t = (i - 1) / Math.max(1, levelsPerSide - 1);
      const rawPrice = buyStartPrice - t * (buyStartPrice - buyEndPrice);
      const quantizedPrice = Math.round(rawPrice / tickSize) * tickSize;
      const safePrice = Math.max(minBoundNum, Math.min(buyStartPrice, quantizedPrice));

      const rawLot = minBuyLot + t * (maxBuyLot - minBuyLot);
      const safeLot = Math.min(maxBuyLot, Math.max(minBuyLot, rawLot));

      const priceUnits = PrecisionMath.parseToUnits(safePrice.toFixed(quoteDecimals), quoteDecimals);
      const qtyUnits = PrecisionMath.parseToUnits(safeLot.toFixed(baseDecimals), baseDecimals);

      buyLevels.push({
        level: i,
        side: 'BUY',
        priceUnits,
        priceDisplay: this.formatDisplayPrice(priceUnits, pair),
        quantityUnits: qtyUnits,
        lotDisplay: safeLot.toFixed(4)
      });
    }

    // 2. SELL LADDER: Level 1 (closest) -> Level N (furthest touching max_price_bound)
    const sellStartPrice = anchorPriceNum + tickSize;
    const sellEndPrice = maxBoundNum;

    for (let i = 1; i <= levelsPerSide; i++) {
      const t = (i - 1) / Math.max(1, levelsPerSide - 1);
      const rawPrice = sellStartPrice + t * (sellEndPrice - sellStartPrice);
      const quantizedPrice = Math.round(rawPrice / tickSize) * tickSize;
      const safePrice = Math.min(maxBoundNum, Math.max(sellStartPrice, quantizedPrice));

      const rawLot = minSellLot + t * (maxSellLot - minSellLot);
      const safeLot = Math.min(maxSellLot, Math.max(minSellLot, rawLot));

      const priceUnits = PrecisionMath.parseToUnits(safePrice.toFixed(quoteDecimals), quoteDecimals);
      const qtyUnits = PrecisionMath.parseToUnits(safeLot.toFixed(baseDecimals), baseDecimals);

      sellLevels.push({
        level: i,
        side: 'SELL',
        priceUnits,
        priceDisplay: this.formatDisplayPrice(priceUnits, pair),
        quantityUnits: qtyUnits,
        lotDisplay: safeLot.toFixed(4)
      });
    }

    return { buyLevels, sellLevels };
  }

  /**
   * Cancels all active orders deployed by this Smart HFT Ladder bot
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

    for (const orderId of orderIdsToCancel) {
      const order = db.orders.get(orderId);
      if (order && (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED')) {
        try {
          matchingEngine.cancelOrder(orderId, bot.ownerUserId, bot.pairId);
          cancelledCount++;
        } catch {}
      }
    }

    if (cfg) {
      cfg.activeOrderIds = [];
    }

    if (cancelledCount > 0) {
      addLog(bot, `Membatalkan ${cancelledCount} order ladder terbuka (${reason || 'Rotasi/Penyegaran Ladder'}).`, 'INFO');
    }

    return cancelledCount;
  }

  /**
   * Main Execution Cycle:
   * 1. Evaluates or updates synthetic geometric pattern to derive anchor price
   * 2. Calculates 20 Buy / 20 Sell ladder levels with strict price bounds & volume scaling
   * 3. Submits orders directly into the Matching Engine
   * 4. Updates bot metrics and state
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

    // 1. Derive Anchor Price from Market Last Price or Synthetic Pattern Simulator
    const quoteDecimals = pair.quoteDecimals !== undefined ? pair.quoteDecimals : (pair.quoteCurrency === 'USDT' ? 6 : 2);
    const currentMarketPriceNum = Number(BigInt(pair.lastPrice)) / (10 ** quoteDecimals);

    // Generate pattern point
    const { points, anchorPrice } = this.previewPattern(
      currentMarketPriceNum,
      cfg.pattern,
      cfg.timeframe,
      5.0
    );

    const minBound = parseFloat(cfg.min_price_bound);
    const maxBound = parseFloat(cfg.max_price_bound);

    // Check if anchor is bounded
    const safeAnchor = Math.max(minBound + this.getTickSize(pair) * 2, Math.min(maxBound - this.getTickSize(pair) * 2, anchorPrice));
    cfg.lastAnchorPrice = safeAnchor.toFixed(quoteDecimals);

    // 2. Calculate Ladder Levels
    const { buyLevels, sellLevels } = this.calculateLadder(pair, safeAnchor, cfg);

    // 3. Clear older ladder orders (rotasi ladder anti-stacking)
    this.cancelOpenBotOrders(bot, addLog, 'Rotasi Tangga HFT Baru');

    // 4. Place 20 Buy Limit Orders & 20 Sell Limit Orders
    const newOrderIds: string[] = [];
    let placedBuys = 0;
    let placedSells = 0;

    // Deploy BUY Orders
    for (const lvl of buyLevels) {
      try {
        const clientOrderId = `shft-b${lvl.level}-${bot.id.slice(4, 9)}-${Date.now()}`;
        const matchRes = matchingEngine.placeOrder({
          userId: bot.accountId || bot.ownerUserId,
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
        const clientOrderId = `shft-s${lvl.level}-${bot.id.slice(4, 9)}-${Date.now()}`;
        const matchRes = matchingEngine.placeOrder({
          userId: bot.accountId || bot.ownerUserId,
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

    // 5. Update Metrics Record
    cfg.lastPatternMetrics = {
      patternName: cfg.pattern.replace(/_/g, ' '),
      barsGenerated: points.length,
      anchorPrice: this.formatDisplayPrice(PrecisionMath.parseToUnits(safeAnchor.toFixed(quoteDecimals), quoteDecimals), pair),
      buyLevel1: { price: buyLevels[0].priceDisplay, lot: buyLevels[0].lotDisplay },
      buyLevelFurthest: { price: buyLevels[buyLevels.length - 1].priceDisplay, lot: buyLevels[buyLevels.length - 1].lotDisplay },
      sellLevel1: { price: sellLevels[0].priceDisplay, lot: sellLevels[0].lotDisplay },
      sellLevelFurthest: { price: sellLevels[sellLevels.length - 1].priceDisplay, lot: sellLevels[sellLevels.length - 1].lotDisplay }
    };

    bot.lastHeartbeat = Date.now();
    bot.lastExecutionResult = `Berhasil menempatkan ${placedBuys} Buy Limit & ${placedSells} Sell Limit (Anchor: ${cfg.lastAnchorPrice}, Pattern: ${cfg.pattern}).`;

    addLog(
      bot,
      `[HFT Ladder Aktif] ${placedBuys + placedSells} order dipasang simetris (Buy: ${buyLevels[0].priceDisplay} -> ${buyLevels[buyLevels.length - 1].priceDisplay} | Sell: ${sellLevels[0].priceDisplay} -> ${sellLevels[sellLevels.length - 1].priceDisplay}).`,
      'ORDER'
    );

    db.scheduleSave();
    marketWsService.broadcastBotUpdate(bot);
  }
}
