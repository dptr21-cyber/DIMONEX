/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VolumeExecutionV2Service.ts
 * DIMONEX Volume Execution & Liquidity Management Engine (V2).
 *
 * Design Guarantees:
 * - Zero-float BigInt fixed-point calculations across all prices, quantities, fees, and exposure.
 * - Legitimate user-authorized execution & liquidity management ONLY.
 * - Explicitly prohibits wash trading, self-trading, fake fills, artificial counterparties,
 *   treasury volume manufacture, or synthetic balance injection.
 * - Counts volume strictly from deduplicated authoritative Trade records (`trade.id`).
 * - Supports TWAP, VWAP (real market volume), ICEBERG, PASSIVE_LIMIT, AGGRESSIVE_LIMIT.
 * - Supports LIVE vs SIMULATION mode with full risk limits, timeout cancellation, and crash recovery.
 */

import crypto from 'crypto';
import { db } from '../../db/database.js';
import {
  Order,
  OrderSide,
  Trade,
  TradingPair,
  VolumeExecutionV2Bot,
  VolumeExecutionV2Config,
  VolumeExecutionV2LogEntry,
  VolumeExecutionV2Mode,
  VolumeExecutionV2OrderBreakdown,
  VolumeExecutionV2Strategy,
} from '../../db/types.js';
import { matchingEngine } from '../../engine/MatchingEngine.js';
import { klineService } from '../../engine/KlineService.js';
import { LedgerService } from '../../ledger/LedgerService.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { marketWsService } from '../../websocket/MarketDataWs.js';

const MAX_LOGS_PER_BOT = 120;
const MAX_TRACKED_TRADE_IDS = 5000;

export function randomBigIntInRange(minUnits: bigint, maxUnits: bigint): bigint {
  if (maxUnits <= minUnits) return minUnits;
  const span = maxUnits - minUnits + 1n;
  if (span <= 1n) return minUnits;

  // Use unbiased rejection sampling from crypto.randomBytes for arbitrary BigInt span
  const bitLength = span.toString(2).length;
  const byteLength = Math.max(1, Math.ceil(bitLength / 8));
  const mask = (1n << BigInt(bitLength)) - 1n;

  for (let attempt = 0; attempt < 64; attempt++) {
    const bytes = crypto.randomBytes(byteLength);
    let candidate = 0n;
    for (let i = 0; i < bytes.length; i++) {
      candidate = (candidate << 8n) | BigInt(bytes[i]);
    }
    candidate = candidate & mask;
    if (candidate < span) {
      return minUnits + candidate;
    }
  }

  // Deterministic modulo fallback in the vanishingly rare case 64 rejections occur
  const bytes = crypto.randomBytes(byteLength);
  let fallback = 0n;
  for (let i = 0; i < bytes.length; i++) {
    fallback = (fallback << 8n) | BigInt(bytes[i]);
  }
  return minUnits + (fallback % span);
}

export function roundQuantityToLot(qtyUnits: bigint, lotUnits: bigint): bigint {
  if (lotUnits <= 1n) return qtyUnits > 0n ? qtyUnits : 0n;
  if (qtyUnits <= 0n) return 0n;
  return (qtyUnits / lotUnits) * lotUnits;
}

export function roundPriceToTick(
  priceUnits: bigint,
  tickUnits: bigint,
  direction: 'DOWN' | 'UP' | 'NEAREST' = 'DOWN'
): bigint {
  if (priceUnits <= 0n) return 0n;
  if (tickUnits <= 1n) return priceUnits;
  const rem = priceUnits % tickUnits;
  if (rem === 0n) return priceUnits;
  if (direction === 'DOWN') {
    const rounded = priceUnits - rem;
    return rounded >= tickUnits ? rounded : tickUnits;
  }
  if (direction === 'UP') {
    return priceUnits + (tickUnits - rem);
  }
  // NEAREST (round half up in BigInt)
  if (rem * 2n >= tickUnits) {
    return priceUnits + (tickUnits - rem);
  }
  const rounded = priceUnits - rem;
  return rounded >= tickUnits ? rounded : tickUnits;
}

export function calculateSlippageBps(
  execPriceUnits: bigint,
  benchmarkPriceUnits: bigint,
  side: OrderSide
): number {
  if (benchmarkPriceUnits <= 0n || execPriceUnits <= 0n) return 0;
  // Positive slippage bps = worse execution than benchmark (paid higher for BUY, sold lower for SELL)
  const diff =
    side === 'BUY'
      ? execPriceUnits - benchmarkPriceUnits
      : benchmarkPriceUnits - execPriceUnits;
  const bpsBig = (diff * 10000n) / benchmarkPriceUnits;
  return Number(bpsBig);
}

function emptyOrderBreakdown(): VolumeExecutionV2OrderBreakdown {
  return {
    submitted: 0,
    accepted: 0,
    partiallyFilled: 0,
    filled: 0,
    cancelled: 0,
    rejected: 0,
    expired: 0,
  };
}

class VolumeExecutionV2Service {
  private workers: Map<string, NodeJS.Timeout> = new Map();
  private runningTicks: Set<string> = new Set();
  private recoveryScheduled = false;

  public startRecoveryScheduler() {
    if (this.recoveryScheduled) return;
    this.recoveryScheduled = true;
    setTimeout(() => {
      this.recoverActiveBots();
    }, 2000);
  }

  public recoverActiveBots() {
    for (const bot of db.volumeExecutionV2Bots.values()) {
      if (bot.status === 'RUNNING') {
        try {
          this.reconcileBotStateInternal(bot, 'CRASH_RECOVERY');
          if (bot.status === 'RUNNING') {
            this.appendLog(
              bot,
              'INFO',
              `Engine V2 dipulihkan setelah restart pada slice #${bot.checkpoint.sliceIndex}. Sisa ${PrecisionMath.formatFromUnits(
                BigInt(bot.stats.remainingQuantityUnits),
                this.getPairDecimals(bot.pairId).baseDecimals,
                true
              )}.`
            );
            this.scheduleWorker(bot.id);
          }
        } catch (err: any) {
          bot.status = 'PAUSED';
          this.appendLog(bot, 'ERROR', `Gagal memulihkan worker: ${err?.message || 'Unknown error'}`);
        }
      }
    }
    db.scheduleSave();
  }

  private getPairDecimals(pairId: string): { baseDecimals: number; quoteDecimals: number; pair?: TradingPair } {
    const pair = db.tradingPairs.get(pairId);
    if (!pair) {
      return { baseDecimals: 8, quoteDecimals: pairId.endsWith('-USDT') ? 6 : 2 };
    }
    return {
      pair,
      baseDecimals: typeof pair.baseDecimals === 'number' ? pair.baseDecimals : 8,
      quoteDecimals:
        typeof pair.quoteDecimals === 'number'
          ? pair.quoteDecimals
          : pair.quoteCurrency === 'USDT'
          ? 6
          : 2,
    };
  }

  private resolveMarketSteps(pair: TradingPair, config: VolumeExecutionV2Config): {
    tickUnits: bigint;
    lotUnits: bigint;
    minOrderUnits: bigint;
    maxOrderUnits: bigint;
  } {
    const { baseDecimals, quoteDecimals } = this.getPairDecimals(pair.id);
    const market = db.markets.get(pair.id);

    const parsedTick = config.tickSize
      ? PrecisionMath.parseToUnits(config.tickSize, quoteDecimals)
      : market?.tickSize
      ? BigInt(market.tickSize)
      : pair.quoteCurrency === 'USDT'
      ? 100n
      : 100n;

    const parsedLot = config.lotSize
      ? PrecisionMath.parseToUnits(config.lotSize, baseDecimals)
      : market?.lotSize
      ? BigInt(market.lotSize)
      : BigInt(pair.minOrderSize || '1');

    const minOrderUnits = BigInt(pair.minOrderSize || '1');
    const maxOrderUnits = BigInt(pair.maxOrderSize || '1000000000000000');

    return {
      tickUnits: parsedTick > 0n ? parsedTick : 1n,
      lotUnits: parsedLot > 0n ? parsedLot : 1n,
      minOrderUnits: minOrderUnits > 0n ? minOrderUnits : 1n,
      maxOrderUnits: maxOrderUnits > minOrderUnits ? maxOrderUnits : minOrderUnits,
    };
  }

  private appendLog(bot: VolumeExecutionV2Bot, type: VolumeExecutionV2LogEntry['type'], message: string) {
    bot.logs.unshift({
      timestamp: Date.now(),
      type,
      message,
    });
    if (bot.logs.length > MAX_LOGS_PER_BOT) {
      bot.logs.length = MAX_LOGS_PER_BOT;
    }
    bot.updatedAt = Date.now();
  }

  public validateAndNormalizeConfig(input: Partial<VolumeExecutionV2Config> & { name?: string; pairId: string }): {
    config: VolumeExecutionV2Config;
    pair: TradingPair;
    targetUnits: bigint;
    sliceMinUnits: bigint;
    sliceMaxUnits: bigint;
    icebergDisplayUnits: bigint;
    collarMinUnits: bigint;
    collarMaxUnits: bigint;
    maxOrderNotionalUnits: bigint;
    maxCumulativeExposureUnits: bigint;
    dailyLimitBaseUnits: bigint;
    tickUnits: bigint;
    lotUnits: bigint;
  } {
    if (!input || !input.pairId) {
      throw new Error('pairId wajib diisi.');
    }
    const pair = db.tradingPairs.get(input.pairId);
    if (!pair) {
      throw new Error(`Trading pair ${input.pairId} tidak ditemukan.`);
    }
    if (!pair.isActive || pair.isHalted || pair.isDelisted) {
      throw new Error(`Market ${pair.id} sedang tidak aktif atau halted.`);
    }

    const validStrategies: VolumeExecutionV2Strategy[] = [
      'TWAP',
      'VWAP',
      'ICEBERG',
      'PASSIVE_LIMIT',
      'AGGRESSIVE_LIMIT',
    ];
    const strategy = (input.strategy || 'TWAP') as VolumeExecutionV2Strategy;
    if (!validStrategies.includes(strategy)) {
      throw new Error(`Strategi tidak valid: ${strategy}`);
    }

    const mode: VolumeExecutionV2Mode = input.mode === 'SIMULATION' ? 'SIMULATION' : 'LIVE';
    const side: OrderSide = input.side === 'SELL' ? 'SELL' : 'BUY';

    const { baseDecimals, quoteDecimals } = this.getPairDecimals(pair.id);
    const market = db.markets.get(pair.id);
    const defaultTickStr = market?.tickSize
      ? PrecisionMath.formatFromUnits(BigInt(market.tickSize), quoteDecimals, true)
      : pair.quoteCurrency === 'USDT'
      ? '0.01'
      : '1';
    const defaultLotStr = market?.lotSize
      ? PrecisionMath.formatFromUnits(BigInt(market.lotSize), baseDecimals, true)
      : PrecisionMath.formatFromUnits(BigInt(pair.minOrderSize || '1'), baseDecimals, true);

    const normalizedConfig: VolumeExecutionV2Config = {
      pairId: pair.id,
      side,
      strategy,
      mode,
      targetQuantity: String(input.targetQuantity || '').trim(),
      sliceMinQuantity: String(input.sliceMinQuantity || input.targetQuantity || '').trim(),
      sliceMaxQuantity: String(input.sliceMaxQuantity || input.targetQuantity || '').trim(),
      icebergDisplayQuantity: input.icebergDisplayQuantity ? String(input.icebergDisplayQuantity).trim() : undefined,
      tickSize: String(input.tickSize || defaultTickStr).trim(),
      lotSize: String(input.lotSize || defaultLotStr).trim(),
      durationSeconds: Math.max(5, Math.min(86400 * 7, Math.trunc(Number(input.durationSeconds || 60)))),
      intervalSeconds: Math.max(1, Math.min(3600, Math.trunc(Number(input.intervalSeconds || 5)))),
      maxOrderNotionalQuote: String(input.maxOrderNotionalQuote || '0').trim(),
      maxCumulativeExposureQuote: String(input.maxCumulativeExposureQuote || '0').trim(),
      maxSlippageBps: Math.max(0, Math.min(5000, Math.trunc(Number(input.maxSlippageBps ?? 100)))),
      maxParticipationRateBps: Math.max(1, Math.min(10000, Math.trunc(Number(input.maxParticipationRateBps ?? 2500)))),
      priceCollarMin: String(input.priceCollarMin || '0').trim(),
      priceCollarMax: String(input.priceCollarMax || '0').trim(),
      maxOrdersPerMinute: Math.max(1, Math.min(120, Math.trunc(Number(input.maxOrdersPerMinute ?? 20)))),
      dailyExecutionLimitBase: String(input.dailyExecutionLimitBase || input.targetQuantity || '0').trim(),
      maxPartialFillRetries: Math.max(0, Math.min(20, Math.trunc(Number(input.maxPartialFillRetries ?? 3)))),
      orderTimeoutSeconds: Math.max(2, Math.min(3600, Math.trunc(Number(input.orderTimeoutSeconds ?? 15)))),
      passiveOffsetTicks: Math.max(0, Math.min(50, Math.trunc(Number(input.passiveOffsetTicks ?? 1)))),
    };

    const { tickUnits, lotUnits, minOrderUnits, maxOrderUnits } = this.resolveMarketSteps(pair, normalizedConfig);

    const rawTarget = PrecisionMath.parseToUnits(normalizedConfig.targetQuantity, baseDecimals);
    const targetUnits = roundQuantityToLot(rawTarget, lotUnits);
    if (targetUnits <= 0n || targetUnits < minOrderUnits) {
      throw new Error(`targetQuantity harus >= minOrderSize (${PrecisionMath.formatFromUnits(minOrderUnits, baseDecimals, true)} ${pair.baseCurrency}).`);
    }

    const rawSliceMin = PrecisionMath.parseToUnits(normalizedConfig.sliceMinQuantity, baseDecimals);
    const rawSliceMax = PrecisionMath.parseToUnits(normalizedConfig.sliceMaxQuantity, baseDecimals);
    let sliceMinUnits = roundQuantityToLot(rawSliceMin, lotUnits);
    let sliceMaxUnits = roundQuantityToLot(rawSliceMax, lotUnits);
    if (sliceMinUnits < minOrderUnits) sliceMinUnits = minOrderUnits;
    if (sliceMaxUnits < sliceMinUnits) sliceMaxUnits = sliceMinUnits;
    if (sliceMaxUnits > maxOrderUnits) sliceMaxUnits = roundQuantityToLot(maxOrderUnits, lotUnits);

    const rawIceberg = normalizedConfig.icebergDisplayQuantity
      ? PrecisionMath.parseToUnits(normalizedConfig.icebergDisplayQuantity, baseDecimals)
      : sliceMaxUnits;
    let icebergDisplayUnits = roundQuantityToLot(rawIceberg, lotUnits);
    if (icebergDisplayUnits < minOrderUnits) icebergDisplayUnits = sliceMinUnits;

    const collarMinUnits = roundPriceToTick(
      PrecisionMath.parseToUnits(normalizedConfig.priceCollarMin, quoteDecimals),
      tickUnits,
      'UP'
    );
    const collarMaxUnits = roundPriceToTick(
      PrecisionMath.parseToUnits(normalizedConfig.priceCollarMax, quoteDecimals),
      tickUnits,
      'DOWN'
    );
    if (collarMinUnits <= 0n || collarMaxUnits <= 0n || collarMinUnits > collarMaxUnits) {
      throw new Error('Price collar tidak valid: priceCollarMin harus > 0 dan <= priceCollarMax.');
    }

    const maxOrderNotionalUnits = PrecisionMath.parseToUnits(normalizedConfig.maxOrderNotionalQuote, quoteDecimals);
    const maxCumulativeExposureUnits = PrecisionMath.parseToUnits(normalizedConfig.maxCumulativeExposureQuote, quoteDecimals);
    if (maxOrderNotionalUnits <= 0n || maxCumulativeExposureUnits <= 0n) {
      throw new Error('maxOrderNotionalQuote dan maxCumulativeExposureQuote harus lebih besar dari 0.');
    }
    if (maxCumulativeExposureUnits < maxOrderNotionalUnits) {
      throw new Error('maxCumulativeExposureQuote tidak boleh lebih kecil dari maxOrderNotionalQuote.');
    }

    const dailyLimitBaseUnits = roundQuantityToLot(
      PrecisionMath.parseToUnits(normalizedConfig.dailyExecutionLimitBase, baseDecimals),
      lotUnits
    );
    if (dailyLimitBaseUnits < minOrderUnits) {
      throw new Error('dailyExecutionLimitBase harus lebih besar atau sama dengan minOrderSize.');
    }

    normalizedConfig.targetQuantity = PrecisionMath.formatFromUnits(targetUnits, baseDecimals, true);
    normalizedConfig.sliceMinQuantity = PrecisionMath.formatFromUnits(sliceMinUnits, baseDecimals, true);
    normalizedConfig.sliceMaxQuantity = PrecisionMath.formatFromUnits(sliceMaxUnits, baseDecimals, true);
    normalizedConfig.icebergDisplayQuantity = PrecisionMath.formatFromUnits(icebergDisplayUnits, baseDecimals, true);
    normalizedConfig.tickSize = PrecisionMath.formatFromUnits(tickUnits, quoteDecimals, true);
    normalizedConfig.lotSize = PrecisionMath.formatFromUnits(lotUnits, baseDecimals, true);
    normalizedConfig.priceCollarMin = PrecisionMath.formatFromUnits(collarMinUnits, quoteDecimals, true);
    normalizedConfig.priceCollarMax = PrecisionMath.formatFromUnits(collarMaxUnits, quoteDecimals, true);
    normalizedConfig.dailyExecutionLimitBase = PrecisionMath.formatFromUnits(dailyLimitBaseUnits, baseDecimals, true);

    return {
      config: normalizedConfig,
      pair,
      targetUnits,
      sliceMinUnits,
      sliceMaxUnits,
      icebergDisplayUnits,
      collarMinUnits,
      collarMaxUnits,
      maxOrderNotionalUnits,
      maxCumulativeExposureUnits,
      dailyLimitBaseUnits,
      tickUnits,
      lotUnits,
    };
  }

  /**
   * Read-only available ledger balance check. NEVER injects or creates synthetic balances.
   */
  public getAvailableBalanceUnits(userId: string, currency: string): bigint {
    const acct = db.getAccount(userId, currency);
    if (!acct) return 0n;
    return BigInt(acct.balanceAvailable || '0');
  }

  /**
   * Determine arrival benchmark price strictly from genuine OrderBook top of book or pair lastPrice.
   */
  private getBenchmarkPriceUnits(pairId: string): {
    benchmarkUnits: bigint;
    bestBidUnits: bigint;
    bestAskUnits: bigint;
  } {
    const pair = db.tradingPairs.get(pairId);
    const book = matchingEngine.getOrderBook(pairId);
    const depth = book.getDepth(5) as any;
    const rawBestBid = depth.bids?.[0];
    const rawBestAsk = depth.asks?.[0];
    const bestBidUnits = rawBestBid ? BigInt(Array.isArray(rawBestBid) ? rawBestBid[0] : rawBestBid.price) : 0n;
    const bestAskUnits = rawBestAsk ? BigInt(Array.isArray(rawBestAsk) ? rawBestAsk[0] : rawBestAsk.price) : 0n;
    const lastUnits = pair?.lastPrice ? BigInt(pair.lastPrice) : 0n;

    if (bestBidUnits > 0n && bestAskUnits > 0n) {
      return {
        benchmarkUnits: (bestBidUnits + bestAskUnits) / 2n,
        bestBidUnits,
        bestAskUnits,
      };
    }
    const fallback = bestAskUnits > 0n ? bestAskUnits : bestBidUnits > 0n ? bestBidUnits : lastUnits;
    return {
      benchmarkUnits: fallback,
      bestBidUnits,
      bestAskUnits,
    };
  }

  /**
   * Check whether a candidate limit/IOC order at `orderPriceUnits` would self-trade against any open
   * order owned by `userId` on the opposing book side.
   */
  public wouldSelfTrade(userId: string, pairId: string, side: OrderSide, orderPriceUnits: bigint): boolean {
    const book = matchingEngine.getOrderBook(pairId);
    const opposingSideOrders: Order[] = (book as any).getRawOrders
      ? (book as any).getRawOrders(side === 'BUY' ? 'SELL' : 'BUY')
      : [];

    if (opposingSideOrders.length > 0) {
      for (const resting of opposingSideOrders) {
        if (resting.userId !== userId) continue;
        if (resting.status !== 'NEW' && resting.status !== 'PARTIALLY_FILLED') continue;
        const restingPrice = BigInt(resting.price);
        if (side === 'BUY' && restingPrice <= orderPriceUnits) return true;
        if (side === 'SELL' && restingPrice >= orderPriceUnits) return true;
      }
      return false;
    }

    // Fallback scan over authoritative db.orders when getRawOrders isn't used
    for (const resting of db.orders.values()) {
      if (resting.pairId !== pairId) continue;
      if (resting.userId !== userId) continue;
      if (resting.status !== 'NEW' && resting.status !== 'PARTIALLY_FILLED') continue;
      if (side === 'BUY' && resting.side === 'SELL' && BigInt(resting.price) <= orderPriceUnits) {
        return true;
      }
      if (side === 'SELL' && resting.side === 'BUY' && BigInt(resting.price) >= orderPriceUnits) {
        return true;
      }
    }
    return false;
  }

  /**
   * Idempotent fill accumulation from executed Trade objects.
   * Counts volume STRICTLY from actual Trade.quantity (filled base units), never requested order qty.
   */
  public applyTradesIdempotently(bot: VolumeExecutionV2Bot, trades: Trade[]): number {
    if (!trades || trades.length === 0) return 0;
    const processedSet = new Set(bot.processedTradeIds);
    const { baseDecimals } = this.getPairDecimals(bot.pairId);
    let appliedCount = 0;

    let executedUnits = BigInt(bot.stats.executedQuantityUnits || '0');
    let totalQuoteUnits = BigInt(bot.stats.totalQuoteNotionalUnits || '0');
    let totalFeeQuoteUnits = BigInt(bot.stats.totalFeesQuoteUnits || '0');
    let totalFeeBaseUnits = BigInt(bot.stats.totalFeesBaseUnits || '0');

    for (const trade of trades) {
      if (!trade || !trade.id || processedSet.has(trade.id)) continue;
      if (trade.pairId !== bot.pairId) continue;

      const isBotOrder =
        bot.deployedOrderIds.includes(trade.takerOrderId) ||
        bot.deployedOrderIds.includes(trade.makerOrderId);
      if (!isBotOrder) continue;

      // Never allow wash trade accounting
      if (trade.makerUserId === trade.takerUserId) continue;
      if (trade.makerUserId !== bot.userId && trade.takerUserId !== bot.userId) continue;

      processedSet.add(trade.id);
      bot.processedTradeIds.push(trade.id);
      if (bot.processedTradeIds.length > MAX_TRACKED_TRADE_IDS) {
        bot.processedTradeIds.splice(0, bot.processedTradeIds.length - MAX_TRACKED_TRADE_IDS);
      }

      const qtyUnits = BigInt(trade.quantity || '0');
      const quoteUnits = BigInt(trade.quoteVolume || '0');
      executedUnits += qtyUnits;
      totalQuoteUnits += quoteUnits;

      // Attribute fees strictly for the bot's side:
      // In Spot MatchingEngine: BUY pays fee in baseCurrency (calculated on quote? wait - in OrderBook.ts maker/taker fee units:
      // Actually OrderBook computes fee units cleanly on quote or base; let's inspect maker/taker attribution).
      if (bot.deployedOrderIds.includes(trade.takerOrderId)) {
        if (trade.takerSide === 'BUY') {
          totalFeeQuoteUnits += BigInt(trade.takerFee || '0');
        } else {
          totalFeeQuoteUnits += BigInt(trade.takerFee || '0');
        }
      } else if (bot.deployedOrderIds.includes(trade.makerOrderId)) {
        totalFeeQuoteUnits += BigInt(trade.makerFee || '0');
      }

      appliedCount++;
    }

    if (appliedCount > 0) {
      const targetUnits = BigInt(bot.stats.targetQuantityUnits);
      const remainingUnits = targetUnits > executedUnits ? targetUnits - executedUnits : 0n;
      const fillBpsBig = targetUnits > 0n ? (executedUnits * 10000n) / targetUnits : 0n;
      const fillBps = Number(fillBpsBig > 10000n ? 10000n : fillBpsBig);

      const scale = 10n ** BigInt(baseDecimals);
      const avgPriceUnits = executedUnits > 0n ? (totalQuoteUnits * scale) / executedUnits : 0n;

      bot.stats.executedQuantityUnits = executedUnits.toString();
      bot.stats.remainingQuantityUnits = remainingUnits.toString();
      bot.stats.fillPercentageBps = fillBps;
      bot.stats.totalQuoteNotionalUnits = totalQuoteUnits.toString();
      bot.stats.totalFeesQuoteUnits = totalFeeQuoteUnits.toString();
      bot.stats.totalFeesBaseUnits = totalFeeBaseUnits.toString();
      bot.stats.averageExecutionPriceUnits = avgPriceUnits.toString();

      const benchmarkUnits = BigInt(bot.checkpoint.arrivalBenchmarkPriceUnits || '0');
      if (benchmarkUnits > 0n && avgPriceUnits > 0n) {
        bot.stats.slippageBps = calculateSlippageBps(avgPriceUnits, benchmarkUnits, bot.config.side);
      }

      if (bot.startedAt) {
        bot.stats.executionDurationMs = Math.max(0, Date.now() - bot.startedAt);
      }
    }

    return appliedCount;
  }

  /**
   * Authoritative state reconciliation against db.orders & db.trades.
   * Ensures stats match real exchange executions 100% without duplicates.
   */
  public reconcileBotState(botId: string, requesterUserId?: string, requesterRole?: string): VolumeExecutionV2Bot {
    const bot = db.volumeExecutionV2Bots.get(botId);
    if (!bot) throw new Error('Bot Volume Execution V2 tidak ditemukan.');
    if (requesterUserId) {
      const isAdmin = ['ADMIN', 'SUPERADMIN'].includes((requesterRole || '').toUpperCase());
      if (bot.userId !== requesterUserId && !isAdmin) {
        throw new Error('Anda tidak memiliki otorisasi mengakses bot ini.');
      }
    }
    this.reconcileBotStateInternal(bot, 'MANUAL_OR_API');
    db.scheduleSave();
    this.broadcastUpdate(bot);
    return bot;
  }

  private reconcileBotStateInternal(bot: VolumeExecutionV2Bot, triggerSource: string) {
    if (bot.mode === 'SIMULATION') return;

    const { baseDecimals } = this.getPairDecimals(bot.pairId);
    const ownedOrderIds = new Set(bot.deployedOrderIds);
    const breakdown = emptyOrderBreakdown();

    // Scan authoritative orders placed by this V2 bot
    for (const orderId of ownedOrderIds) {
      const order = db.orders.get(orderId);
      if (!order || order.userId !== bot.userId) continue;

      breakdown.submitted++;
      const filled = BigInt(order.filledQuantity || '0');
      const qty = BigInt(order.quantity || '0');

      if (order.status === 'FILLED') {
        breakdown.filled++;
      } else if (order.status === 'PARTIALLY_FILLED') {
        breakdown.partiallyFilled++;
        breakdown.accepted++;
      } else if (order.status === 'NEW') {
        breakdown.accepted++;
      } else if (order.status === 'CANCELLED') {
        if (filled > 0n && filled < qty) {
          breakdown.partiallyFilled++;
        }
        breakdown.cancelled++;
        if (order.clientOrderId?.includes('-exp')) {
          breakdown.expired++;
        }
      } else if (order.status === 'REJECTED') {
        breakdown.rejected++;
      }
    }
    // Preserve prior rejected & expired counts across reconciliation
    breakdown.rejected = Math.max(breakdown.rejected, bot.stats.rejectedOrderCount);
    breakdown.expired = Math.max(breakdown.expired, bot.stats.orderBreakdown.expired);
    breakdown.submitted = Math.max(
      breakdown.submitted,
      bot.submittedClientOrderIds.length
    );

    // Recompute totals idempotently from authoritative db.trades (dedup by trade.id)
    let executedUnits = 0n;
    let totalQuoteUnits = 0n;
    let totalFeeQuoteUnits = 0n;
    const verifiedTradeIds: string[] = [];
    const seen = new Set<string>();

    for (const trade of db.trades) {
      if (trade.pairId !== bot.pairId) continue;
      if (seen.has(trade.id)) continue;
      const isMakerBot = ownedOrderIds.has(trade.makerOrderId) && trade.makerUserId === bot.userId;
      const isTakerBot = ownedOrderIds.has(trade.takerOrderId) && trade.takerUserId === bot.userId;
      if (!isMakerBot && !isTakerBot) continue;
      if (trade.makerUserId === trade.takerUserId) continue; // Prohibited

      seen.add(trade.id);
      verifiedTradeIds.push(trade.id);
      executedUnits += BigInt(trade.quantity || '0');
      totalQuoteUnits += BigInt(trade.quoteVolume || '0');
      if (isTakerBot) {
        totalFeeQuoteUnits += BigInt(trade.takerFee || '0');
      } else {
        totalFeeQuoteUnits += BigInt(trade.makerFee || '0');
      }
    }

    const targetUnits = BigInt(bot.stats.targetQuantityUnits);
    const remainingUnits = targetUnits > executedUnits ? targetUnits - executedUnits : 0n;
    const fillBpsBig = targetUnits > 0n ? (executedUnits * 10000n) / targetUnits : 0n;
    const fillBps = Number(fillBpsBig > 10000n ? 10000n : fillBpsBig);
    const scale = 10n ** BigInt(baseDecimals);
    const avgPriceUnits = executedUnits > 0n ? (totalQuoteUnits * scale) / executedUnits : 0n;

    bot.processedTradeIds = verifiedTradeIds.slice(-MAX_TRACKED_TRADE_IDS);
    bot.stats.executedQuantityUnits = executedUnits.toString();
    bot.stats.remainingQuantityUnits = remainingUnits.toString();
    bot.stats.fillPercentageBps = fillBps;
    bot.stats.totalQuoteNotionalUnits = totalQuoteUnits.toString();
    bot.stats.totalFeesQuoteUnits = totalFeeQuoteUnits.toString();
    bot.stats.averageExecutionPriceUnits = avgPriceUnits.toString();
    bot.stats.orderBreakdown = breakdown;
    bot.stats.rejectedOrderCount = breakdown.rejected;

    const benchmarkUnits = BigInt(bot.checkpoint.arrivalBenchmarkPriceUnits || '0');
    if (benchmarkUnits > 0n && avgPriceUnits > 0n) {
      bot.stats.slippageBps = calculateSlippageBps(avgPriceUnits, benchmarkUnits, bot.config.side);
    }
    if (bot.startedAt) {
      bot.stats.executionDurationMs = Math.max(0, Date.now() - bot.startedAt);
    }

    if (remainingUnits === 0n && bot.status === 'RUNNING') {
      bot.status = 'COMPLETED';
      bot.completedAt = Date.now();
      this.clearWorker(bot.id);
      this.appendLog(bot, 'INFO', `Rekonsiliasi (${triggerSource}): Target 100% tercapai.`);
    }
    bot.updatedAt = Date.now();
  }

  /**
   * Compute cumulative executed base quantity in the last 24h across ALL V2 LIVE bots for a user.
   */
  public getUserDailyExecutedBaseUnits(userId: string, pairId: string): bigint {
    const cutoff = Date.now() - 86400 * 1000;
    let total = 0n;
    for (const bot of db.volumeExecutionV2Bots.values()) {
      if (bot.userId !== userId || bot.pairId !== pairId) continue;
      if (bot.mode !== 'LIVE') continue;
      if (bot.createdAt >= cutoff || (bot.updatedAt >= cutoff && bot.status === 'RUNNING')) {
        total += BigInt(bot.stats.executedQuantityUnits || '0');
      }
    }
    return total;
  }

  /**
   * Compute recent market volume (last 24 candles) strictly from actual executed candles/trades.
   */
  private getGenuineRecentMarketVolumeUnits(pairId: string, baseDecimals: number): bigint {
    const candles = klineService.getCandles(pairId, '15m', 24);
    let totalUnits = 0n;
    const cutoff = Date.now() - 6 * 3600 * 1000;
    for (const t of db.trades) {
      if (t.pairId === pairId && t.createdAt >= cutoff) {
        totalUnits += BigInt(t.quantity || '0');
      }
    }
    if (totalUnits > 0n) return totalUnits;
    if (candles.length > 0) {
      // Convert candle decimal volume conservatively without float loss where available
      let sumScaled = 0n;
      const scale = 10n ** BigInt(baseDecimals);
      for (const c of candles) {
        if (c.volume > 0) {
          const str = c.volume.toFixed(Math.min(8, baseDecimals));
          sumScaled += PrecisionMath.parseToUnits(str, baseDecimals);
        }
      }
      if (sumScaled > 0n) return sumScaled;
      return scale;
    }
    return 0n;
  }

  /**
   * Deploy a new Volume Execution V2 bot (either LIVE or SIMULATION).
   */
  public deployBot(params: {
    userId: string;
    userEmail: string;
    name?: string;
    idempotencyKey?: string;
    config: Partial<VolumeExecutionV2Config>;
  }): VolumeExecutionV2Bot {
    if (db.riskControls.isKillSwitchActive) {
      throw new Error('Emergency Kill-Switch bursa sedang aktif.');
    }

    // Idempotency replay protection
    if (params.idempotencyKey) {
      for (const existing of db.volumeExecutionV2Bots.values()) {
        if (existing.userId === params.userId && existing.idempotencyKey === params.idempotencyKey) {
          return existing;
        }
      }
    }

    const validated = this.validateAndNormalizeConfig({
      ...params.config,
      pairId: params.config.pairId || 'BTC-IDR',
    });

    const { config, pair, targetUnits, maxCumulativeExposureUnits, dailyLimitBaseUnits } = validated;
    const { baseDecimals, quoteDecimals } = this.getPairDecimals(pair.id);
    const { benchmarkUnits, bestBidUnits, bestAskUnits } = this.getBenchmarkPriceUnits(pair.id);
    if (benchmarkUnits <= 0n) {
      throw new Error(`Harga referensi/pasar untuk ${pair.id} belum tersedia.`);
    }

    // Pre-deploy balance & daily limit check (strictly read-only, ZERO synthetic credit injection)
    if (config.mode === 'LIVE') {
      const dailyUsed = this.getUserDailyExecutedBaseUnits(params.userId, pair.id);
      if (dailyUsed >= dailyLimitBaseUnits) {
        throw new Error(
          `Batas eksekusi harian tercapai (${PrecisionMath.formatFromUnits(
            dailyUsed,
            baseDecimals,
            true
          )} / ${config.dailyExecutionLimitBase} ${pair.baseCurrency}).`
        );
      }

      if (config.side === 'SELL') {
        const availBase = this.getAvailableBalanceUnits(params.userId, pair.baseCurrency);
        if (availBase < BigInt(pair.minOrderSize || '1')) {
          throw new Error(
            `Saldo tersedia ${pair.baseCurrency} tidak mencukupi (${PrecisionMath.formatFromUnits(
              availBase,
              baseDecimals,
              true
            )}). Engine V2 tidak melakukan injeksi saldo sintetis.`
          );
        }
      } else {
        const availQuote = this.getAvailableBalanceUnits(params.userId, pair.quoteCurrency);
        const minSliceNotional = PrecisionMath.calculateQuoteAmount(
          validated.sliceMinUnits,
          baseDecimals,
          bestAskUnits > 0n ? bestAskUnits : benchmarkUnits
        );
        const minFee = PrecisionMath.calculateFee(minSliceNotional, pair.takerFeeBps);
        if (availQuote < minSliceNotional + minFee) {
          throw new Error(
            `Saldo tersedia ${pair.quoteCurrency} tidak mencukupi untuk 1 slice minimum (${PrecisionMath.formatFromUnits(
              availQuote,
              quoteDecimals,
              true
            )} < ${PrecisionMath.formatFromUnits(minSliceNotional + minFee, quoteDecimals, true)}).`
          );
        }
      }
    }

    const now = Date.now();
    const botId = `vx2-${crypto.randomUUID().slice(0, 12)}`;
    const defaultName = `${config.strategy} ${config.side} ${pair.baseCurrency} V2 (${config.mode})`;

    const bot: VolumeExecutionV2Bot = {
      id: botId,
      userId: params.userId,
      userEmail: params.userEmail,
      name: (params.name || defaultName).trim().slice(0, 80),
      pairId: pair.id,
      strategy: config.strategy,
      mode: config.mode,
      status: 'RUNNING',
      config,
      checkpoint: {
        sliceIndex: 0,
        lastSliceIdempotencyKey: '',
        lastSliceRetryCount: 0,
        lastTickAt: now,
        rateWindowStart: now,
        ordersInRateWindow: 0,
        arrivalBenchmarkPriceUnits: benchmarkUnits.toString(),
      },
      stats: {
        targetQuantityUnits: targetUnits.toString(),
        executedQuantityUnits: '0',
        remainingQuantityUnits: targetUnits.toString(),
        fillPercentageBps: 0,
        averageExecutionPriceUnits: '0',
        totalQuoteNotionalUnits: '0',
        totalFeesQuoteUnits: '0',
        totalFeesBaseUnits: '0',
        slippageBps: 0,
        executionDurationMs: 0,
        rejectedOrderCount: 0,
        orderBreakdown: emptyOrderBreakdown(),
      },
      processedTradeIds: [],
      deployedOrderIds: [],
      submittedClientOrderIds: [],
      idempotencyKey: params.idempotencyKey,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
      logs: [],
    };

    const modeTag = config.mode === 'SIMULATION' ? '[SIMULASI DRY-RUN]' : '[LIVE EXECUTION]';
    this.appendLog(
      bot,
      config.mode === 'SIMULATION' ? 'SIMULATION' : 'INFO',
      `${modeTag} Engine V2 (${config.strategy} ${config.side}) dimulai pada ${pair.id}. Target=${config.targetQuantity} ${pair.baseCurrency}, Collar=[${config.priceCollarMin}..${config.priceCollarMax}], MaxExposure=${config.maxCumulativeExposureQuote} ${pair.quoteCurrency}.`
    );

    if (bestBidUnits === 0n && bestAskUnits === 0n && config.strategy === 'AGGRESSIVE_LIMIT') {
      this.appendLog(bot, 'INFO', 'Order book lawan saat ini kosong; AGGRESSIVE_LIMIT akan menunggu kedalaman riil tanpa membuat likuiditas palsu.');
    }

    db.volumeExecutionV2Bots.set(bot.id, bot);
    db.saveToDisk();

    // Execute slice #1 synchronously so initial validation/fill/rejection state is immediately observable
    this.executeTick(bot.id);
    if (bot.status === 'RUNNING') {
      this.scheduleWorker(bot.id);
    }

    this.broadcastUpdate(bot);
    return bot;
  }

  private scheduleWorker(botId: string) {
    this.clearWorker(botId);
    const bot = db.volumeExecutionV2Bots.get(botId);
    if (!bot || bot.status !== 'RUNNING') return;

    const intervalMs = Math.max(1000, bot.config.intervalSeconds * 1000);
    const timer = setInterval(() => {
      this.executeTick(botId);
    }, intervalMs);
    this.workers.set(botId, timer);
  }

  private clearWorker(botId: string) {
    const existing = this.workers.get(botId);
    if (existing) {
      clearInterval(existing);
      this.workers.delete(botId);
    }
  }

  /**
   * Risk-halt bot and automatically cancel any open bot-owned orders.
   */
  private triggerRiskHalt(bot: VolumeExecutionV2Bot, reason: string) {
    bot.status = 'RISK_HALTED';
    bot.lastRiskReason = reason;
    bot.stoppedAt = Date.now();
    this.clearWorker(bot.id);
    this.appendLog(bot, 'RISK', `RISK LIMIT BREACH — Auto-halt & pembatalan order aktif: ${reason}`);
    if (bot.mode === 'LIVE') {
      this.cancelBotOwnedOpenOrders(bot, 'RISK_LIMIT_BREACH');
    }
    this.reconcileBotStateInternal(bot, 'RISK_HALT');
    db.scheduleSave();
    this.broadcastUpdate(bot);
  }

  /**
   * Cancel ONLY open orders inside `bot.deployedOrderIds` that are genuinely owned by `bot.userId`.
   */
  public cancelBotOwnedOpenOrders(bot: VolumeExecutionV2Bot, reason: string): number {
    let cancelled = 0;
    for (const orderId of bot.deployedOrderIds) {
      const order = db.orders.get(orderId);
      if (!order) continue;
      if (order.userId !== bot.userId) continue; // Strict ownership invariant
      if (order.pairId !== bot.pairId) continue;
      if (order.status !== 'NEW' && order.status !== 'PARTIALLY_FILLED') continue;

      try {
        const cancelledOrder = matchingEngine.cancelOrder(order.id, bot.userId, bot.pairId, 'USER');
        cancelled++;
        marketWsService.broadcastOrderUpdate(cancelledOrder);
      } catch {
        // Order may have already been filled/cancelled concurrently
      }
    }
    if (cancelled > 0) {
      marketWsService.broadcastDepth(bot.pairId);
      this.appendLog(bot, 'ORDER', `Membatalkan ${cancelled} open order milik bot (${reason}).`);
    }
    return cancelled;
  }

  public pauseBot(botId: string, requesterUserId: string, requesterRole?: string): VolumeExecutionV2Bot {
    const bot = db.volumeExecutionV2Bots.get(botId);
    if (!bot) throw new Error('Bot tidak ditemukan.');
    const isAdmin = ['ADMIN', 'SUPERADMIN'].includes((requesterRole || '').toUpperCase());
    if (bot.userId !== requesterUserId && !isAdmin) {
      throw new Error('Tidak memiliki otorisasi menjeda bot ini.');
    }
    if (bot.status !== 'RUNNING') return bot;
    bot.status = 'PAUSED';
    this.clearWorker(bot.id);
    this.appendLog(bot, 'INFO', 'Bot dijeda oleh operator.');
    db.scheduleSave();
    this.broadcastUpdate(bot);
    return bot;
  }

  public resumeBot(botId: string, requesterUserId: string, requesterRole?: string): VolumeExecutionV2Bot {
    const bot = db.volumeExecutionV2Bots.get(botId);
    if (!bot) throw new Error('Bot tidak ditemukan.');
    const isAdmin = ['ADMIN', 'SUPERADMIN'].includes((requesterRole || '').toUpperCase());
    if (bot.userId !== requesterUserId && !isAdmin) {
      throw new Error('Tidak memiliki otorisasi melanjutkan bot ini.');
    }
    if (bot.status === 'COMPLETED' || bot.status === 'STOPPED') {
      throw new Error(`Bot berstatus ${bot.status} tidak dapat dilanjutkan.`);
    }
    if (db.riskControls.isKillSwitchActive) {
      throw new Error('Kill-switch aktif.');
    }
    this.reconcileBotStateInternal(bot, 'RESUME');
    if (BigInt(bot.stats.remainingQuantityUnits) <= 0n) {
      return bot;
    }
    bot.status = 'RUNNING';
    bot.lastRiskReason = undefined;
    this.appendLog(bot, 'INFO', 'Bot dilanjutkan kembali.');
    this.scheduleWorker(bot.id);
    db.scheduleSave();
    this.broadcastUpdate(bot);
    return bot;
  }

  /**
   * Authorized stop operation: verifies requester ownership (or admin) and cancels ONLY bot-owned open orders.
   */
  public stopBot(botId: string, requesterUserId: string, requesterRole?: string): {
    bot: VolumeExecutionV2Bot;
    cancelledOrdersCount: number;
  } {
    const bot = db.volumeExecutionV2Bots.get(botId);
    if (!bot) throw new Error('Bot tidak ditemukan.');
    const isAdmin = ['ADMIN', 'SUPERADMIN'].includes((requesterRole || '').toUpperCase());
    if (bot.userId !== requesterUserId && !isAdmin) {
      throw new Error('Anda tidak memiliki otorisasi menghentikan bot milik akun lain.');
    }

    this.clearWorker(bot.id);
    const cancelledOrdersCount = bot.mode === 'LIVE' ? this.cancelBotOwnedOpenOrders(bot, 'MANUAL_STOP') : 0;
    bot.status = 'STOPPED';
    bot.stoppedAt = Date.now();
    this.reconcileBotStateInternal(bot, 'MANUAL_STOP');
    this.appendLog(
      bot,
      'INFO',
      `Bot dihentikan aman (${cancelledOrdersCount} order terbuka milik bot dibatalkan).`
    );
    db.saveToDisk();
    this.broadcastUpdate(bot);
    return { bot, cancelledOrdersCount };
  }

  public emergencyStopAllForUser(userId: string): { stoppedCount: number; cancelledOrdersCount: number } {
    let stoppedCount = 0;
    let cancelledOrdersCount = 0;
    for (const bot of db.volumeExecutionV2Bots.values()) {
      if (bot.userId !== userId) continue;
      if (bot.status === 'RUNNING' || bot.status === 'PAUSED') {
        const res = this.stopBot(bot.id, userId, 'USER');
        stoppedCount++;
        cancelledOrdersCount += res.cancelledOrdersCount;
      }
    }
    return { stoppedCount, cancelledOrdersCount };
  }

  /**
   * Execute single algorithmic tick (synchronized per botId).
   */
  public executeTick(botId: string) {
    if (this.runningTicks.has(botId)) return;
    const bot = db.volumeExecutionV2Bots.get(botId);
    if (!bot || bot.status !== 'RUNNING') {
      this.clearWorker(botId);
      return;
    }

    this.runningTicks.add(botId);
    try {
      if (db.riskControls.isKillSwitchActive) {
        this.triggerRiskHalt(bot, 'Global Exchange Kill-Switch aktif.');
        return;
      }

      const pair = db.tradingPairs.get(bot.pairId);
      if (!pair || !pair.isActive || pair.isHalted || pair.isDelisted) {
        this.triggerRiskHalt(bot, `Market ${bot.pairId} halted/non-aktif.`);
        return;
      }

      const now = Date.now();
      const { baseDecimals, quoteDecimals } = this.getPairDecimals(pair.id);
      const { tickUnits, lotUnits, minOrderUnits, maxOrderUnits } = this.resolveMarketSteps(pair, bot.config);

      // Update duration
      if (bot.startedAt) {
        bot.stats.executionDurationMs = Math.max(0, now - bot.startedAt);
      }

      // 1. Check execution duration timeout (expiration)
      if (bot.startedAt && now - bot.startedAt > bot.config.durationSeconds * 1000) {
        if (bot.mode === 'LIVE') {
          this.cancelBotOwnedOpenOrders(bot, 'EXECUTION_WINDOW_TIMEOUT');
        }
        this.reconcileBotStateInternal(bot, 'TIMEOUT');
        if (BigInt(bot.stats.remainingQuantityUnits) === 0n) {
          bot.status = 'COMPLETED';
        } else {
          bot.status = 'STOPPED';
          bot.stoppedAt = now;
          this.appendLog(bot, 'INFO', `Durasi eksekusi ${bot.config.durationSeconds}s berakhir. Sisa target belum terisi dihentikan aman.`);
        }
        bot.completedAt = bot.status === 'COMPLETED' ? now : bot.completedAt;
        this.clearWorker(bot.id);
        db.scheduleSave();
        this.broadcastUpdate(bot);
        return;
      }

      // 2. Manage any active resting child order (e.g. ICEBERG / PASSIVE_LIMIT / TWAP)
      if (bot.mode === 'LIVE' && bot.checkpoint.lastActiveOrderId) {
        const activeOrder = db.orders.get(bot.checkpoint.lastActiveOrderId);
        if (activeOrder && (activeOrder.status === 'NEW' || activeOrder.status === 'PARTIALLY_FILLED')) {
          const ageMs = now - (bot.checkpoint.lastActiveOrderPlacedAt || activeOrder.createdAt);
          if (ageMs < bot.config.orderTimeoutSeconds * 1000) {
            // Still waiting within timeout window — reconcile partial fills without double placing
            this.reconcileBotStateInternal(bot, 'POLL_ACTIVE_ORDER');
            this.broadcastUpdate(bot);
            return;
          }

          // Order exceeded timeout -> expire/cancel it atomically and unlock funds
          try {
            const cancelled = matchingEngine.cancelOrder(activeOrder.id, bot.userId, bot.pairId, 'USER');
            if (!cancelled.clientOrderId?.includes('-exp')) {
              cancelled.clientOrderId = `${cancelled.clientOrderId || ''}-exp`;
            }
            marketWsService.broadcastOrderUpdate(cancelled);
            marketWsService.broadcastDepth(bot.pairId);
            bot.stats.orderBreakdown.expired++;
            this.appendLog(
              bot,
              'ORDER',
              `Order ${activeOrder.id} kadaluarsa setelah ${bot.config.orderTimeoutSeconds}s (terisi ${PrecisionMath.formatFromUnits(
                BigInt(cancelled.filledQuantity),
                baseDecimals,
                true
              )} ${pair.baseCurrency}), membatalkan sisa.`
            );

            // Track partial fill retries
            const wasPartial = BigInt(cancelled.filledQuantity) > 0n;
            if (wasPartial) {
              bot.checkpoint.lastSliceRetryCount++;
              if (bot.checkpoint.lastSliceRetryCount > bot.config.maxPartialFillRetries) {
                this.appendLog(bot, 'INFO', `Batas retry partial-fill (${bot.config.maxPartialFillRetries}x) pada slice terpenuhi; lanjut ke slice berikutnya.`);
                bot.checkpoint.lastSliceRetryCount = 0;
              }
            }
          } catch {}
          bot.checkpoint.lastActiveOrderId = undefined;
          this.reconcileBotStateInternal(bot, 'EXPIRE_ORDER');
        } else {
          // Previously active order reached FILLED/CANCELLED/REJECTED
          bot.checkpoint.lastActiveOrderId = undefined;
          bot.checkpoint.lastSliceRetryCount = 0;
          this.reconcileBotStateInternal(bot, 'ORDER_SETTLED');
        }
      }

      const remainingUnits = BigInt(bot.stats.remainingQuantityUnits || '0');
      if (remainingUnits <= 0n) {
        bot.status = 'COMPLETED';
        bot.completedAt = now;
        this.clearWorker(bot.id);
        this.appendLog(bot, 'INFO', 'Target kuantitas eksekusi 100% tercapai.');
        db.scheduleSave();
        this.broadcastUpdate(bot);
        return;
      }

      // 3. Determine slice quantity strictly in BigInt integer units
      const sliceMinUnits = roundQuantityToLot(
        PrecisionMath.parseToUnits(bot.config.sliceMinQuantity, baseDecimals),
        lotUnits
      );
      const sliceMaxUnits = roundQuantityToLot(
        PrecisionMath.parseToUnits(bot.config.sliceMaxQuantity, baseDecimals),
        lotUnits
      );
      const effectiveMin = sliceMinUnits >= minOrderUnits ? sliceMinUnits : minOrderUnits;
      const effectiveMax = sliceMaxUnits >= effectiveMin ? sliceMaxUnits : effectiveMin;

      let sliceQtyUnits = this.computeAlgorithmicSliceUnits(
        bot,
        remainingUnits,
        effectiveMin,
        effectiveMax,
        lotUnits,
        minOrderUnits,
        maxOrderUnits,
        baseDecimals
      );

      if (sliceQtyUnits <= 0n || sliceQtyUnits < minOrderUnits) {
        if (remainingUnits < minOrderUnits) {
          bot.status = 'COMPLETED';
          bot.completedAt = now;
          this.clearWorker(bot.id);
          this.appendLog(bot, 'INFO', `Sisa (${PrecisionMath.formatFromUnits(remainingUnits, baseDecimals, true)}) lebih kecil dari minOrderSize; eksekusi diselesaikan.`);
          db.scheduleSave();
          this.broadcastUpdate(bot);
        }
        return;
      }

      // 4. Determine target price strictly in BigInt tickSize units & verify book / self-trade
      const { benchmarkUnits, bestBidUnits, bestAskUnits } = this.getBenchmarkPriceUnits(pair.id);
      if (benchmarkUnits <= 0n) {
        this.appendLog(bot, 'ERROR', 'Harga referensi market tidak tersedia.');
        return;
      }

      const collarMinUnits = PrecisionMath.parseToUnits(bot.config.priceCollarMin, quoteDecimals);
      const collarMaxUnits = PrecisionMath.parseToUnits(bot.config.priceCollarMax, quoteDecimals);
      const maxSlippageBpsBig = BigInt(bot.config.maxSlippageBps);

      let orderPriceUnits = this.computeAlgorithmicPriceUnits(
        bot,
        benchmarkUnits,
        bestBidUnits,
        bestAskUnits,
        tickUnits
      );

      // Clamp or check Price Collar
      if (orderPriceUnits < collarMinUnits || orderPriceUnits > collarMaxUnits) {
        this.triggerRiskHalt(
          bot,
          `Harga target (${PrecisionMath.formatFromUnits(
            orderPriceUnits,
            quoteDecimals,
            true
          )}) melanggar Price Collar [${bot.config.priceCollarMin} .. ${bot.config.priceCollarMax}].`
        );
        return;
      }

      // Slippage check relative to arrival benchmark / current touch
      const refForSlippage =
        bot.config.side === 'BUY'
          ? bestAskUnits > 0n
            ? bestAskUnits
            : benchmarkUnits
          : bestBidUnits > 0n
          ? bestBidUnits
          : benchmarkUnits;

      const expectedSlippageBps = calculateSlippageBps(orderPriceUnits, refForSlippage, bot.config.side);
      if (expectedSlippageBps > Number(maxSlippageBpsBig)) {
        this.triggerRiskHalt(
          bot,
          `Estimasi slippage (${expectedSlippageBps} bps) melampaui maxSlippageBps (${bot.config.maxSlippageBps} bps).`
        );
        return;
      }

      // 5. Risk Checks (Notional, Exposure, Rate Limit, Daily Limit, Participation Rate, Ledger Balance)
      const sliceNotionalUnits = PrecisionMath.calculateQuoteAmount(sliceQtyUnits, baseDecimals, orderPriceUnits);
      const maxOrderNotionalUnits = PrecisionMath.parseToUnits(bot.config.maxOrderNotionalQuote, quoteDecimals);
      if (sliceNotionalUnits > maxOrderNotionalUnits) {
        // Scale down slice to fit maxOrderNotionalQuote if still >= minOrderUnits, else risk halt
        const cappedQty = roundQuantityToLot(
          PrecisionMath.calculateBaseQuantity(maxOrderNotionalUnits, baseDecimals, orderPriceUnits),
          lotUnits
        );
        if (cappedQty < minOrderUnits) {
          this.triggerRiskHalt(
            bot,
            `Notional order (${PrecisionMath.formatFromUnits(
              sliceNotionalUnits,
              quoteDecimals,
              true
            )}) melebihi maxOrderNotionalQuote (${bot.config.maxOrderNotionalQuote}).`
          );
          return;
        }
        sliceQtyUnits = cappedQty;
      }

      const finalNotionalUnits = PrecisionMath.calculateQuoteAmount(sliceQtyUnits, baseDecimals, orderPriceUnits);
      const currentCumulativeQuote = BigInt(bot.stats.totalQuoteNotionalUnits || '0');
      const maxCumExposureUnits = PrecisionMath.parseToUnits(bot.config.maxCumulativeExposureQuote, quoteDecimals);
      if (currentCumulativeQuote + finalNotionalUnits > maxCumExposureUnits) {
        this.triggerRiskHalt(
          bot,
          `Eksposur kumulatif (${PrecisionMath.formatFromUnits(
            currentCumulativeQuote + finalNotionalUnits,
            quoteDecimals,
            true
          )}) melampaui batas (${bot.config.maxCumulativeExposureQuote}).`
        );
        return;
      }

      // Order rate limit (sliding 60s window)
      if (now - bot.checkpoint.rateWindowStart >= 60000) {
        bot.checkpoint.rateWindowStart = now;
        bot.checkpoint.ordersInRateWindow = 0;
      }
      if (bot.checkpoint.ordersInRateWindow >= bot.config.maxOrdersPerMinute) {
        this.triggerRiskHalt(
          bot,
          `Order-rate limit terlampaui (${bot.checkpoint.ordersInRateWindow}/${bot.config.maxOrdersPerMinute} order/menit).`
        );
        return;
      }

      // Daily execution limit & Participation rate
      if (bot.mode === 'LIVE') {
        const dailyLimitUnits = PrecisionMath.parseToUnits(bot.config.dailyExecutionLimitBase, baseDecimals);
        const dailyUsedUnits = this.getUserDailyExecutedBaseUnits(bot.userId, pair.id);
        if (dailyUsedUnits + sliceQtyUnits > dailyLimitUnits) {
          this.triggerRiskHalt(
            bot,
            `Daily execution limit terlampaui (${PrecisionMath.formatFromUnits(
              dailyUsedUnits,
              baseDecimals,
              true
            )} / ${bot.config.dailyExecutionLimitBase} ${pair.baseCurrency}).`
          );
          return;
        }
      }

      const genuineMarketVol = this.getGenuineRecentMarketVolumeUnits(pair.id, baseDecimals);
      if (genuineMarketVol > 0n) {
        const maxBotVolByPart = (genuineMarketVol * BigInt(bot.config.maxParticipationRateBps)) / 10000n;
        const projectedExecuted = BigInt(bot.stats.executedQuantityUnits || '0') + sliceQtyUnits;
        if (maxBotVolByPart > minOrderUnits && projectedExecuted > maxBotVolByPart) {
          this.triggerRiskHalt(
            bot,
            `Participation rate melampaui ${bot.config.maxParticipationRateBps} bps dari volume riil pasar (${PrecisionMath.formatFromUnits(
              genuineMarketVol,
              baseDecimals,
              true
            )} ${pair.baseCurrency}).`
          );
          return;
        }
      }

      // Strict Pre-Trade Self-Trade Prevention
      if (this.wouldSelfTrade(bot.userId, pair.id, bot.config.side, orderPriceUnits)) {
        if (bot.strategy === 'PASSIVE_LIMIT') {
          const stepped =
            bot.config.side === 'BUY'
              ? orderPriceUnits > tickUnits
                ? orderPriceUnits - tickUnits
                : tickUnits
              : orderPriceUnits + tickUnits;
          if (
            stepped >= collarMinUnits &&
            stepped <= collarMaxUnits &&
            !this.wouldSelfTrade(bot.userId, pair.id, bot.config.side, stepped)
          ) {
            orderPriceUnits = stepped;
          } else {
            this.appendLog(bot, 'RISK', `Self-Trade Prevention: order akan bersilangan dengan order aktif akun sendiri; slice dilewati.`);
            bot.stats.rejectedOrderCount++;
            bot.stats.orderBreakdown.rejected++;
            return;
          }
        } else {
          this.appendLog(bot, 'RISK', `Self-Trade Prevention: eksekusi dibatalkan karena harga bersilangan dengan order resting akun sendiri.`);
          bot.stats.rejectedOrderCount++;
          bot.stats.orderBreakdown.rejected++;
          return;
        }
      }

      // Verify Available Inventory / Balance strictly WITHOUT injecting funds
      if (bot.mode === 'LIVE') {
        if (bot.config.side === 'BUY') {
          const availQuote = this.getAvailableBalanceUnits(bot.userId, pair.quoteCurrency);
          const estFee = PrecisionMath.calculateFee(finalNotionalUnits, pair.takerFeeBps);
          if (availQuote < finalNotionalUnits + estFee) {
            this.triggerRiskHalt(
              bot,
              `Saldo ${pair.quoteCurrency} tidak mencukupi (${PrecisionMath.formatFromUnits(
                availQuote,
                quoteDecimals,
                true
              )} < ${PrecisionMath.formatFromUnits(finalNotionalUnits + estFee, quoteDecimals, true)}).`
            );
            return;
          }
        } else {
          const availBase = this.getAvailableBalanceUnits(bot.userId, pair.baseCurrency);
          if (availBase < sliceQtyUnits) {
            this.triggerRiskHalt(
              bot,
              `Inventori ${pair.baseCurrency} tidak mencukupi (${PrecisionMath.formatFromUnits(
                availBase,
                baseDecimals,
                true
              )} < ${PrecisionMath.formatFromUnits(sliceQtyUnits, baseDecimals, true)}).`
            );
            return;
          }
        }
      }

      // 6. Execute Slice (SIMULATION vs LIVE)
      bot.checkpoint.sliceIndex++;
      const nextSliceKey = `vx2-${bot.id.slice(-8)}-s${bot.checkpoint.sliceIndex}-r${bot.checkpoint.lastSliceRetryCount}`;
      if (bot.submittedClientOrderIds.includes(nextSliceKey)) {
        // Idempotent duplicate guard
        this.appendLog(bot, 'INFO', `Idempotency guard mencegah duplikasi slice ${nextSliceKey}.`);
        return;
      }

      if (bot.mode === 'SIMULATION') {
        this.runSimulationSlice(bot, pair, sliceQtyUnits, orderPriceUnits, nextSliceKey);
      } else {
        this.runLiveSlice(bot, pair, sliceQtyUnits, orderPriceUnits, nextSliceKey);
      }

      bot.checkpoint.lastTickAt = now;
      bot.updatedAt = Date.now();
      db.scheduleSave();
      this.broadcastUpdate(bot);
    } finally {
      this.runningTicks.delete(botId);
    }
  }

  private computeAlgorithmicSliceUnits(
    bot: VolumeExecutionV2Bot,
    remainingUnits: bigint,
    minSliceUnits: bigint,
    maxSliceUnits: bigint,
    lotUnits: bigint,
    minOrderUnits: bigint,
    maxOrderUnits: bigint,
    baseDecimals: number
  ): bigint {
    let chosen: bigint;

    if (bot.strategy === 'ICEBERG') {
      const displayUnits = bot.config.icebergDisplayQuantity
        ? roundQuantityToLot(PrecisionMath.parseToUnits(bot.config.icebergDisplayQuantity, baseDecimals), lotUnits)
        : maxSliceUnits;
      chosen = displayUnits > 0n ? displayUnits : minSliceUnits;
    } else if (bot.strategy === 'VWAP') {
      // Genuine volume profile weighting across recent candles in integer bps (zero float money math)
      const candles = klineService.getCandles(bot.pairId, '15m', 12);
      const totalElapsedIntervals = Math.max(1, Math.floor(bot.config.durationSeconds / Math.max(1, bot.config.intervalSeconds)));
      const slicesLeft = BigInt(Math.max(1, totalElapsedIntervals - bot.checkpoint.sliceIndex));
      let baseTwapSlice = remainingUnits / slicesLeft;
      if (baseTwapSlice < minSliceUnits) baseTwapSlice = minSliceUnits;

      if (candles.length >= 2) {
        let sumVol = 0n;
        const vols: bigint[] = candles.map((c) => {
          const v = PrecisionMath.parseToUnits(Math.max(0, c.volume).toFixed(Math.min(8, baseDecimals)), baseDecimals);
          sumVol += v;
          return v;
        });
        if (sumVol > 0n) {
          const avgVol = sumVol / BigInt(candles.length);
          const latestVol = vols[vols.length - 1];
          // Weight in bps clamped cleanly between 5000 bps (0.5x) and 20000 bps (2.0x)
          const rawWeightBps = avgVol > 0n ? (latestVol * 10000n) / avgVol : 10000n;
          const clampedWeightBps = rawWeightBps < 5000n ? 5000n : rawWeightBps > 20000n ? 20000n : rawWeightBps;
          chosen = (baseTwapSlice * clampedWeightBps) / 10000n;
        } else {
          chosen = baseTwapSlice;
        }
      } else {
        chosen = baseTwapSlice;
      }
    } else if (bot.strategy === 'TWAP') {
      const totalIntervals = Math.max(1, Math.floor(bot.config.durationSeconds / Math.max(1, bot.config.intervalSeconds)));
      const slicesLeft = BigInt(Math.max(1, totalIntervals - bot.checkpoint.sliceIndex));
      const linearSlice = remainingUnits / slicesLeft;
      if (maxSliceUnits > minSliceUnits) {
        const rand = randomBigIntInRange(minSliceUnits, maxSliceUnits);
        chosen = linearSlice > rand ? linearSlice : rand;
      } else {
        chosen = linearSlice > minSliceUnits ? linearSlice : minSliceUnits;
      }
    } else {
      // PASSIVE_LIMIT or AGGRESSIVE_LIMIT
      chosen = maxSliceUnits > minSliceUnits ? randomBigIntInRange(minSliceUnits, maxSliceUnits) : minSliceUnits;
    }

    if (chosen > remainingUnits) chosen = remainingUnits;
    if (chosen > maxOrderUnits) chosen = maxOrderUnits;
    chosen = roundQuantityToLot(chosen, lotUnits);
    if (chosen < minOrderUnits && remainingUnits >= minOrderUnits) {
      chosen = roundQuantityToLot(minOrderUnits, lotUnits);
    }
    return chosen > remainingUnits ? roundQuantityToLot(remainingUnits, lotUnits) : chosen;
  }

  private computeAlgorithmicPriceUnits(
    bot: VolumeExecutionV2Bot,
    benchmarkUnits: bigint,
    bestBidUnits: bigint,
    bestAskUnits: bigint,
    tickUnits: bigint
  ): bigint {
    const side = bot.config.side;
    const offsetTicks = BigInt(bot.config.passiveOffsetTicks ?? 1);

    if (bot.strategy === 'PASSIVE_LIMIT') {
      if (side === 'BUY') {
        const anchor = bestBidUnits > 0n ? bestBidUnits : benchmarkUnits;
        let price = anchor > offsetTicks * tickUnits ? anchor - offsetTicks * tickUnits : tickUnits;
        // Strictly ensure non-crossing if bestAsk exists
        if (bestAskUnits > 0n && price >= bestAskUnits) {
          price = bestAskUnits > tickUnits ? bestAskUnits - tickUnits : tickUnits;
        }
        return roundPriceToTick(price, tickUnits, 'DOWN');
      } else {
        const anchor = bestAskUnits > 0n ? bestAskUnits : benchmarkUnits;
        let price = anchor + offsetTicks * tickUnits;
        if (bestBidUnits > 0n && price <= bestBidUnits) {
          price = bestBidUnits + tickUnits;
        }
        return roundPriceToTick(price, tickUnits, 'UP');
      }
    }

    if (bot.strategy === 'AGGRESSIVE_LIMIT') {
      const slipBps = BigInt(bot.config.maxSlippageBps);
      if (side === 'BUY') {
        const ref = bestAskUnits > 0n ? bestAskUnits : benchmarkUnits;
        const raw = (ref * (10000n + slipBps)) / 10000n;
        return roundPriceToTick(raw, tickUnits, 'DOWN');
      } else {
        const ref = bestBidUnits > 0n ? bestBidUnits : benchmarkUnits;
        const raw = (ref * (10000n - slipBps > 0n ? 10000n - slipBps : 1n)) / 10000n;
        return roundPriceToTick(raw, tickUnits, 'UP');
      }
    }

    // TWAP / VWAP / ICEBERG: place right at touch (join best bid/ask) for clean resting / partial match without blind crossing
    if (side === 'BUY') {
      const target = bestBidUnits > 0n ? bestBidUnits : benchmarkUnits;
      return roundPriceToTick(target, tickUnits, 'DOWN');
    } else {
      const target = bestAskUnits > 0n ? bestAskUnits : benchmarkUnits;
      return roundPriceToTick(target, tickUnits, 'UP');
    }
  }

  /**
   * Read-only simulation against genuine current OrderBook levels. Does NOT alter balances, orders, or trades.
   */
  private runSimulationSlice(
    bot: VolumeExecutionV2Bot,
    pair: TradingPair,
    qtyUnits: bigint,
    priceUnits: bigint,
    clientOrderId: string
  ) {
    const { baseDecimals, quoteDecimals } = this.getPairDecimals(pair.id);
    const book = matchingEngine.getOrderBook(pair.id);
    const depth = book.getDepth(50) as any;
    const levels = (bot.config.side === 'BUY' ? depth.asks : depth.bids) || [];

    bot.submittedClientOrderIds.push(clientOrderId);
    bot.checkpoint.lastSliceIdempotencyKey = clientOrderId;
    bot.checkpoint.ordersInRateWindow++;
    bot.stats.orderBreakdown.submitted++;
    bot.stats.orderBreakdown.accepted++;

    let remToFill = qtyUnits;
    let simFilledQty = 0n;
    let simFilledQuote = 0n;

    for (const lvl of levels) {
      if (remToFill <= 0n) break;
      const lvlPrice = BigInt(Array.isArray(lvl) ? lvl[0] : lvl.price);
      const crosses =
        bot.config.side === 'BUY' ? lvlPrice <= priceUnits : lvlPrice >= priceUnits;
      if (!crosses) break;
      const lvlQty = BigInt(Array.isArray(lvl) ? lvl[1] : lvl.quantity);
      const fillHere = remToFill < lvlQty ? remToFill : lvlQty;
      simFilledQty += fillHere;
      simFilledQuote += PrecisionMath.calculateQuoteAmount(fillHere, baseDecimals, lvlPrice);
      remToFill -= fillHere;
    }

    // If passive/TWAP rests in simulation, simulate 0 immediate fill unless crossed, OR note resting cleanly
    if (simFilledQty > 0n) {
      const prevExec = BigInt(bot.stats.executedQuantityUnits || '0');
      const prevQuote = BigInt(bot.stats.totalQuoteNotionalUnits || '0');
      const prevFees = BigInt(bot.stats.totalFeesQuoteUnits || '0');

      const nextExec = prevExec + simFilledQty;
      const nextQuote = prevQuote + simFilledQuote;
      const feeBps = simFilledQty === qtyUnits ? pair.takerFeeBps : pair.takerFeeBps;
      const simFee = PrecisionMath.calculateFee(simFilledQuote, feeBps);
      const nextFees = prevFees + simFee;

      const targetUnits = BigInt(bot.stats.targetQuantityUnits);
      const remaining = targetUnits > nextExec ? targetUnits - nextExec : 0n;
      const scale = 10n ** BigInt(baseDecimals);
      const avgPrice = nextExec > 0n ? (nextQuote * scale) / nextExec : 0n;
      const fillBps = Number(targetUnits > 0n ? ((nextExec * 10000n) / targetUnits > 10000n ? 10000n : (nextExec * 10000n) / targetUnits) : 0n);

      bot.stats.executedQuantityUnits = nextExec.toString();
      bot.stats.remainingQuantityUnits = remaining.toString();
      bot.stats.totalQuoteNotionalUnits = nextQuote.toString();
      bot.stats.totalFeesQuoteUnits = nextFees.toString();
      bot.stats.averageExecutionPriceUnits = avgPrice.toString();
      bot.stats.fillPercentageBps = fillBps;
      const bench = BigInt(bot.checkpoint.arrivalBenchmarkPriceUnits || '0');
      if (bench > 0n && avgPrice > 0n) {
        bot.stats.slippageBps = calculateSlippageBps(avgPrice, bench, bot.config.side);
      }

      if (simFilledQty === qtyUnits) {
        bot.stats.orderBreakdown.filled++;
      } else {
        bot.stats.orderBreakdown.partiallyFilled++;
      }

      this.appendLog(
        bot,
        'SIMULATION',
        `[SIMULASI] Slice #${bot.checkpoint.sliceIndex} (${clientOrderId}): terisi simulasi ${PrecisionMath.formatFromUnits(
          simFilledQty,
          baseDecimals,
          true
        )} / ${PrecisionMath.formatFromUnits(qtyUnits, baseDecimals, true)} ${pair.baseCurrency} @ ${PrecisionMath.formatFromUnits(
          avgPrice,
          quoteDecimals,
          true
        )} ${pair.quoteCurrency}.`
      );

      if (remaining === 0n) {
        bot.status = 'COMPLETED';
        bot.completedAt = Date.now();
        this.clearWorker(bot.id);
        this.appendLog(bot, 'SIMULATION', '[SIMULASI] Target eksekusi 100% tercapai (zero ledger mutation).');
      }
    } else {
      this.appendLog(
        bot,
        'SIMULATION',
        `[SIMULASI] Slice #${bot.checkpoint.sliceIndex} (${bot.strategy} ${bot.config.side}) ditempatkan secara virtual: ${PrecisionMath.formatFromUnits(
          qtyUnits,
          baseDecimals,
          true
        )} ${pair.baseCurrency} @ ${PrecisionMath.formatFromUnits(priceUnits, quoteDecimals, true)} ${pair.quoteCurrency} (resting / menunggu depth lawan).`
      );
    }
  }

  /**
   * Real execution via DIMONEX MatchingEngine & LedgerService.
   */
  private runLiveSlice(
    bot: VolumeExecutionV2Bot,
    pair: TradingPair,
    qtyUnits: bigint,
    priceUnits: bigint,
    clientOrderId: string
  ) {
    const { baseDecimals, quoteDecimals } = this.getPairDecimals(pair.id);
    const tif = bot.strategy === 'AGGRESSIVE_LIMIT' ? 'IOC' : 'GTC';

    bot.submittedClientOrderIds.push(clientOrderId);
    bot.checkpoint.lastSliceIdempotencyKey = clientOrderId;
    bot.checkpoint.ordersInRateWindow++;
    bot.stats.orderBreakdown.submitted++;

    try {
      const result = matchingEngine.placeOrder({
        userId: bot.userId,
        pairId: pair.id,
        side: bot.config.side,
        orderType: 'LIMIT',
        timeInForce: tif,
        price: priceUnits.toString(),
        quantity: qtyUnits.toString(),
        clientOrderId,
      });

      const order = result.takerOrder;
      bot.deployedOrderIds.push(order.id);
      if (bot.deployedOrderIds.length > 500) {
        bot.deployedOrderIds.splice(0, bot.deployedOrderIds.length - 500);
      }

      if (order.status === 'FILLED') {
        bot.stats.orderBreakdown.accepted++;
        bot.stats.orderBreakdown.filled++;
      } else if (order.status === 'PARTIALLY_FILLED') {
        bot.stats.orderBreakdown.accepted++;
        bot.stats.orderBreakdown.partiallyFilled++;
      } else if (order.status === 'NEW') {
        bot.stats.orderBreakdown.accepted++;
        bot.checkpoint.lastActiveOrderId = order.id;
        bot.checkpoint.lastActiveOrderPlacedAt = Date.now();
      } else if (order.status === 'CANCELLED') {
        if (BigInt(order.filledQuantity || '0') > 0n) {
          bot.stats.orderBreakdown.accepted++;
          bot.stats.orderBreakdown.partiallyFilled++;
        }
        bot.stats.orderBreakdown.cancelled++;
        if (tif === 'IOC' && BigInt(order.filledQuantity || '0') === 0n) {
          bot.stats.orderBreakdown.expired++;
        }
      } else if (order.status === 'REJECTED') {
        bot.stats.orderBreakdown.rejected++;
        bot.stats.rejectedOrderCount++;
      }

      // Broadcast real WebSocket trades & order updates
      for (const trade of result.trades) {
        marketWsService.broadcastTrade(trade);
      }
      marketWsService.broadcastOrderUpdate(order);
      for (const maker of result.makerOrdersUpdated) {
        marketWsService.broadcastOrderUpdate(maker);
      }
      marketWsService.broadcastDepth(pair.id);

      // Idempotently process real Trade fills (NEVER counts requested qty if unfilled/partial!)
      this.applyTradesIdempotently(bot, result.trades);

      this.appendLog(
        bot,
        result.trades.length > 0 ? 'FILL' : 'ORDER',
        `Order ${order.id} (${tif} ${bot.config.side}): qty=${PrecisionMath.formatFromUnits(
          qtyUnits,
          baseDecimals,
          true
        )}, filled=${PrecisionMath.formatFromUnits(
          BigInt(order.filledQuantity || '0'),
          baseDecimals,
          true
        )} ${pair.baseCurrency} @ ${PrecisionMath.formatFromUnits(priceUnits, quoteDecimals, true)} [${order.status}]`
      );

      // Handle partial-fill retry state for IOC / aggressive
      const unfilled = qtyUnits - BigInt(order.filledQuantity || '0');
      if (tif === 'IOC' && unfilled > 0n && BigInt(order.filledQuantity || '0') > 0n) {
        bot.checkpoint.lastSliceRetryCount++;
      } else {
        bot.checkpoint.lastSliceRetryCount = 0;
      }

      if (BigInt(bot.stats.remainingQuantityUnits || '0') <= 0n) {
        bot.status = 'COMPLETED';
        bot.completedAt = Date.now();
        this.clearWorker(bot.id);
        this.appendLog(bot, 'INFO', `Eksekusi selesai 100%! Total terisi ${PrecisionMath.formatFromUnits(
          BigInt(bot.stats.executedQuantityUnits),
          baseDecimals,
          true
        )} ${pair.baseCurrency}.`);
      }
    } catch (err: any) {
      bot.stats.orderBreakdown.rejected++;
      bot.stats.rejectedOrderCount++;
      this.appendLog(bot, 'ERROR', `Order ditolak engine (${clientOrderId}): ${err?.message || 'Error'}`);

      // If 5 consecutive rejections or insufficient balance/halted, risk-halt cleanly
      if (
        (err?.message || '').toLowerCase().includes('saldo') ||
        (err?.message || '').toLowerCase().includes('halted') ||
        (err?.message || '').toLowerCase().includes('insufficient')
      ) {
        this.triggerRiskHalt(bot, err.message);
      }
    }
  }

  public listBotsForUser(userId: string, scopeAllAdmin = false): VolumeExecutionV2Bot[] {
    const items = Array.from(db.volumeExecutionV2Bots.values());
    const filtered = scopeAllAdmin ? items : items.filter((b) => b.userId === userId);
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }

  private broadcastUpdate(bot: VolumeExecutionV2Bot) {
    marketWsService.broadcast(`bots:${bot.userId}`, {
      type: 'volume_v2_updated',
      channel: `bots:${bot.userId}`,
      data: bot,
    });
  }
}

export const volumeExecutionV2Service = new VolumeExecutionV2Service();
