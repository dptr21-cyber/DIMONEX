/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VolumeSpreadBot.ts
 * Volume Bot Phase 2 — Inside-Spread Self-Cross Execution Engine for DIMONEX.
 *
 * Behavior:
 * - Reads live OrderBook bestBid & bestAsk.
 * - Selects an execution price strictly inside the spread (between bestBid and bestAsk)
 *   clamped to [min_limit_price, max_limit_price] and aligned to tickSize.
 * - Submits Maker LIMIT GTC inside the spread, then submits opposing Taker LIMIT IOC
 *   at the exact same price ("makan order sendiri") either synchronously (cross_delay_ms === 0)
 *   or after a configurable micro-delay (cross_delay_ms > 0).
 * - Uses strict BigInt + PrecisionMath + crypto.randomBytes arithmetic (zero floats).
 * - Validates real available Base & Quote balances prior to order submission (no synthetic balance injection).
 */

import crypto from 'crypto';
import { db } from '../../db/database.js';
import { matchingEngine } from '../../engine/MatchingEngine.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { marketWsService } from '../../websocket/MarketDataWs.js';
import { BotInstance, Order, OrderSide, TradingPair, Trade, VolumeSpreadBotConfig } from '../../db/types.js';

export interface SpreadPreparedLeg {
  status: 'READY_FOR_CROSS' | 'STOP_TARGET_REACHED' | 'WAITING_SPREAD' | 'INSUFFICIENT_BALANCE' | 'PAIR_HALTED';
  makerOrderId?: string;
  makerUserId?: string;
  takerUserId?: string;
  makerSide?: OrderSide;
  takerSide?: OrderSide;
  execPriceUnits?: bigint;
  qtyUnits?: bigint;
  bookSpreadBps?: number;
  bestBidUnits?: bigint;
  bestAskUnits?: bigint;
  reason?: string;
}

export interface SpreadCrossResult {
  status: 'EXECUTED' | 'STOP_TARGET_REACHED' | 'MAKER_CONSUMED' | 'NO_FILL' | 'ERROR';
  executedBaseUnits: bigint;
  executedQuoteUnits: bigint;
  tradesCount: number;
  reason?: string;
}

/**
 * Cryptographically uniform random BigInt in [min, max] inclusive.
 */
function randomBigIntInclusive(min: bigint, max: bigint): bigint {
  if (max <= min) return min;
  const range = max - min + 1n;
  if (range <= 1n) return min;

  const bitsNeeded = range.toString(2).length;
  const bytesNeeded = Math.ceil(bitsNeeded / 8);
  const mask = (1n << BigInt(bitsNeeded)) - 1n;

  for (let attempt = 0; attempt < 64; attempt++) {
    const buf = crypto.randomBytes(bytesNeeded);
    let val = 0n;
    for (let i = 0; i < buf.length; i++) {
      val = (val << 8n) | BigInt(buf[i]);
    }
    val = val & mask;
    if (val < range) {
      return min + val;
    }
  }
  // Fallback deterministic modulo if 64 rejection samples miss (extremely improbable < 2^-64)
  const buf = crypto.randomBytes(bytesNeeded + 4);
  let val = 0n;
  for (let i = 0; i < buf.length; i++) {
    val = (val << 8n) | BigInt(buf[i]);
  }
  return min + (val % range);
}

function alignUpToTick(value: bigint, tick: bigint): bigint {
  if (tick <= 1n) return value;
  const rem = value % tick;
  return rem === 0n ? value : value + (tick - rem);
}

function alignDownToTick(value: bigint, tick: bigint): bigint {
  if (tick <= 1n) return value;
  return value - (value % tick);
}

function getAvailableBalanceUnits(userId: string, currency: string): bigint {
  const accId = db.accountIndex.get(`${userId}:${currency}`);
  if (!accId) return 0n;
  const acc = db.ledgerAccounts.get(accId);
  if (!acc) return 0n;
  return BigInt(acc.balanceAvailable || '0');
}

export class VolumeSpreadBotExecutor {
  /**
   * Determine pair tick size in quote units (BigInt).
   */
  public static resolveTickUnits(pair: TradingPair, cfg: VolumeSpreadBotConfig): bigint {
    if (cfg.tick_size && cfg.tick_size.trim() !== '') {
      try {
        const parsed = PrecisionMath.parseToUnits(cfg.tick_size.trim(), pair.quoteDecimals);
        if (parsed > 0n) return parsed;
      } catch {
        // Fallback to market tick size
      }
    }

    const market = db.markets.get(pair.id);
    if (market?.tickSize) {
      try {
        const marketTick = BigInt(market.tickSize);
        if (marketTick > 0n) return marketTick;
      } catch {
        // Fallback
      }
    }

    // Default: 1 IDR (100 sen) when quoteDecimals === 2, or 0.01 USDT (10000) when quoteDecimals === 6
    if (pair.quoteCurrency === 'IDR' && pair.quoteDecimals >= 2) {
      return 10n ** BigInt(pair.quoteDecimals);
    }
    if (pair.quoteDecimals >= 2) {
      return 10n ** BigInt(pair.quoteDecimals - 2);
    }
    return 1n;
  }

  /**
   * Compute next Taker side given configured side_pattern and previous executed side.
   */
  public static pickTakerSide(cfg: VolumeSpreadBotConfig): OrderSide {
    switch (cfg.side_pattern) {
      case 'BUY_EATS_SELL':
        return 'BUY';
      case 'SELL_EATS_BUY':
        return 'SELL';
      case 'RANDOM':
        return crypto.randomInt(0, 2) === 0 ? 'BUY' : 'SELL';
      case 'ALTERNATE':
      default:
        return cfg.lastSideExecuted === 'BUY' ? 'SELL' : 'BUY';
    }
  }

  /**
   * Check whether quote volume stop target has already been met using exact quote unit counter.
   */
  public static isStopTargetReached(pair: TradingPair, cfg: VolumeSpreadBotConfig): {
    reached: boolean;
    executedQuoteUnits: bigint;
    stopTargetUnits: bigint;
  } {
    const stopTargetUnits = PrecisionMath.parseToUnits(cfg.vol_quote_stop_target || '0', pair.quoteDecimals);
    const executedQuoteUnits = BigInt(cfg.executedQuoteVolumeUnits || '0');
    return {
      reached: stopTargetUnits > 0n && executedQuoteUnits >= stopTargetUnits,
      executedQuoteUnits,
      stopTargetUnits
    };
  }

  /**
   * Phase 1 of Tick: Compute inside-spread price & size, validate real balances, and place Maker LIMIT GTC.
   */
  public static prepareSpreadCrossTick(
    bot: BotInstance,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void
  ): SpreadPreparedLeg {
    const cfg = bot.volumeSpreadConfig;
    if (!cfg) {
      throw new Error('Konfigurasi Volume Spread Bot (Phase 2) tidak ditemukan.');
    }

    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair || !pair.isActive || pair.isHalted) {
      return {
        status: 'PAIR_HALTED',
        reason: `Pair ${bot.pairId} tidak aktif atau sedang halted.`
      };
    }

    // 1. Check stop target first
    const targetCheck = this.isStopTargetReached(pair, cfg);
    if (targetCheck.reached) {
      return {
        status: 'STOP_TARGET_REACHED',
        reason: `Target volume ${PrecisionMath.formatFromUnits(targetCheck.stopTargetUnits, pair.quoteDecimals)} ${pair.quoteCurrency} tercapai.`
      };
    }

    const tickUnits = this.resolveTickUnits(pair, cfg);
    const minLimitUnits = cfg.min_limit_price
      ? PrecisionMath.parseToUnits(cfg.min_limit_price, pair.quoteDecimals)
      : tickUnits;
    const maxLimitUnits = cfg.max_limit_price
      ? PrecisionMath.parseToUnits(cfg.max_limit_price, pair.quoteDecimals)
      : (minLimitUnits * 1000n > 0n ? minLimitUnits * 1000n : 10n ** 18n);

    if (minLimitUnits <= 0n || maxLimitUnits < minLimitUnits) {
      throw new Error('Rentang harga batas (min_limit_price / max_limit_price) tidak valid.');
    }

    // 2. Inspect live order book spread
    const book = matchingEngine.getOrderBook(bot.pairId);
    const bestBidUnits = book.bids.length > 0 ? BigInt(book.bids[0].price) : 0n;
    const bestAskUnits = book.asks.length > 0 ? BigInt(book.asks[0].price) : 0n;

    let windowLowUnits = 0n;
    let windowHighUnits = 0n;
    let bookSpreadBps = 0;
    let usedLiveSpread = false;

    const minSpreadBps = BigInt(Math.max(1, cfg.min_spread_bps || 1));

    if (bestBidUnits > 0n && bestAskUnits > bestBidUnits) {
      const spreadUnits = bestAskUnits - bestBidUnits;
      const midUnits = (bestBidUnits + bestAskUnits) / 2n;
      bookSpreadBps = midUnits > 0n ? Number((spreadUnits * 10000n) / midUnits) : 0;

      const hasMinSpread = midUnits > 0n && (spreadUnits * 10000n) >= (minSpreadBps * midUnits);
      const strictLow = bestBidUnits + tickUnits;
      const strictHigh = bestAskUnits - tickUnits;

      if (hasMinSpread && strictLow <= strictHigh) {
        const clampedLow = strictLow > minLimitUnits ? strictLow : minLimitUnits;
        const clampedHigh = strictHigh < maxLimitUnits ? strictHigh : maxLimitUnits;
        const alignedLow = alignUpToTick(clampedLow, tickUnits);
        const alignedHigh = alignDownToTick(clampedHigh, tickUnits);

        if (alignedLow > bestBidUnits && alignedHigh < bestAskUnits && alignedLow <= alignedHigh) {
          windowLowUnits = alignedLow;
          windowHighUnits = alignedHigh;
          usedLiveSpread = true;
        }
      }
    }

    // Fallback virtual spread band when live book is empty/one-sided/too tight
    if (!usedLiveSpread) {
      if (cfg.require_two_sided_book) {
        return {
          status: 'WAITING_SPREAD',
          bestBidUnits,
          bestAskUnits,
          bookSpreadBps,
          reason: `Spread live (${bookSpreadBps} bps) belum memenuhi syarat minimum (${cfg.min_spread_bps} bps) atau salah satu sisi book kosong.`
        };
      }

      let refPrice = BigInt(pair.lastPrice || '0');
      if (bestBidUnits > 0n && bestAskUnits > bestBidUnits) {
        refPrice = (bestBidUnits + bestAskUnits) / 2n;
      } else if (refPrice <= 0n) {
        refPrice = (minLimitUnits + maxLimitUnits) / 2n;
      }
      if (refPrice < minLimitUnits) refPrice = minLimitUnits;
      if (refPrice > maxLimitUnits) refPrice = maxLimitUnits;

      const halfBps = BigInt(Math.max(1, cfg.fallback_half_spread_bps || 15));
      let halfDelta = (refPrice * halfBps) / 10000n;
      if (halfDelta < tickUnits) halfDelta = tickUnits;

      let fLow = refPrice - halfDelta;
      let fHigh = refPrice + halfDelta;
      if (fLow < minLimitUnits) fLow = minLimitUnits;
      if (fHigh > maxLimitUnits) fHigh = maxLimitUnits;

      // Never cross live external bestBid or bestAsk even in fallback mode
      if (bestBidUnits > 0n && fLow <= bestBidUnits) {
        fLow = bestBidUnits + tickUnits;
      }
      if (bestAskUnits > 0n && fHigh >= bestAskUnits) {
        fHigh = bestAskUnits - tickUnits;
      }

      const alignedLow = alignUpToTick(fLow, tickUnits);
      const alignedHigh = alignDownToTick(fHigh, tickUnits);

      if (
        alignedLow > alignedHigh ||
        (bestBidUnits > 0n && alignedLow <= bestBidUnits) ||
        (bestAskUnits > 0n && alignedHigh >= bestAskUnits)
      ) {
        return {
          status: 'WAITING_SPREAD',
          bestBidUnits,
          bestAskUnits,
          bookSpreadBps,
          reason: 'Spread order book terlalu rapat untuk menempatkan order baru di dalam spread tanpa menyentuh order luar.'
        };
      }

      windowLowUnits = alignedLow;
      windowHighUnits = alignedHigh;
    }

    // 3. Pick taker & maker side
    const takerSide: OrderSide = this.pickTakerSide(cfg);
    const makerSide: OrderSide = takerSide === 'BUY' ? 'SELL' : 'BUY';

    // 4. Select execution price strictly inside [windowLowUnits, windowHighUnits] based on spread_mode
    const bandMinPct = Math.max(1, Math.min(99, Math.round(cfg.spread_band_min_pct || 15)));
    const bandMaxPct = Math.max(bandMinPct, Math.min(99, Math.round(cfg.spread_band_max_pct || 85)));

    let effectiveMinPct = bandMinPct;
    let effectiveMaxPct = bandMaxPct;

    if (cfg.spread_mode === 'MIDPOINT_JITTER') {
      effectiveMinPct = Math.max(bandMinPct, 40);
      effectiveMaxPct = Math.min(bandMaxPct, 60);
      if (effectiveMinPct > effectiveMaxPct) {
        effectiveMinPct = 45;
        effectiveMaxPct = 55;
      }
    } else if (cfg.spread_mode === 'PING_PONG_EDGE') {
      if (takerSide === 'SELL') {
        // Sell taker eats inside near Bid side
        effectiveMinPct = bandMinPct;
        effectiveMaxPct = Math.min(bandMaxPct, Math.max(bandMinPct, bandMinPct + 20));
      } else {
        // Buy taker eats inside near Ask side
        effectiveMaxPct = bandMaxPct;
        effectiveMinPct = Math.max(bandMinPct, Math.min(bandMaxPct, bandMaxPct - 20));
      }
    }

    const totalWindow = windowHighUnits - windowLowUnits;
    let pickLow = windowLowUnits + (totalWindow * BigInt(effectiveMinPct)) / 100n;
    let pickHigh = windowLowUnits + (totalWindow * BigInt(effectiveMaxPct)) / 100n;
    pickLow = alignUpToTick(pickLow, tickUnits);
    pickHigh = alignDownToTick(pickHigh, tickUnits);

    if (pickLow < windowLowUnits) pickLow = windowLowUnits;
    if (pickHigh > windowHighUnits) pickHigh = windowHighUnits;

    let execPriceUnits =
      pickLow <= pickHigh
        ? randomBigIntInclusive(pickLow, pickHigh)
        : (windowLowUnits + windowHighUnits) / 2n;

    execPriceUnits = alignDownToTick(execPriceUnits, tickUnits);
    if (execPriceUnits < windowLowUnits) execPriceUnits = windowLowUnits;
    if (execPriceUnits > windowHighUnits) execPriceUnits = windowHighUnits;

    // 5. Generate random quantity in BigInt units respecting pair min/max order size
    let minQtyUnits = PrecisionMath.parseToUnits(cfg.random_min_quantity || '0.01', pair.baseDecimals);
    let maxQtyUnits = PrecisionMath.parseToUnits(cfg.random_max_quantity || cfg.random_min_quantity || '0.05', pair.baseDecimals);
    const pairMin = BigInt(pair.minOrderSize);
    const pairMax = BigInt(pair.maxOrderSize);

    if (minQtyUnits < pairMin) minQtyUnits = pairMin;
    if (maxQtyUnits > pairMax) maxQtyUnits = pairMax;
    if (maxQtyUnits < minQtyUnits) maxQtyUnits = minQtyUnits;

    const qtyUnits = randomBigIntInclusive(minQtyUnits, maxQtyUnits);

    // 6. Validate REAL available balances (NO fake balance injection!)
    const takerUserId = cfg.account_id || bot.accountId || bot.ownerUserId;
    const makerUserId = (cfg.counterparty_account_id && cfg.counterparty_account_id.trim() !== '')
      ? cfg.counterparty_account_id.trim()
      : takerUserId;

    const quoteVolUnits = PrecisionMath.calculateQuoteAmount(qtyUnits, pair.baseDecimals, execPriceUnits);
    const buyerLockUnits = quoteVolUnits + PrecisionMath.calculateFee(quoteVolUnits, pair.takerFeeBps);

    if (makerUserId === takerUserId) {
      const availBase = getAvailableBalanceUnits(takerUserId, pair.baseCurrency);
      const availQuote = getAvailableBalanceUnits(takerUserId, pair.quoteCurrency);
      if (availBase < qtyUnits) {
        return {
          status: 'INSUFFICIENT_BALANCE',
          reason: `Saldo ${pair.baseCurrency} akun ${takerUserId} tidak cukup (${PrecisionMath.formatFromUnits(availBase, pair.baseDecimals)} < ${PrecisionMath.formatFromUnits(qtyUnits, pair.baseDecimals)}).`
        };
      }
      if (availQuote < buyerLockUnits) {
        return {
          status: 'INSUFFICIENT_BALANCE',
          reason: `Saldo ${pair.quoteCurrency} akun ${takerUserId} tidak cukup (${PrecisionMath.formatFromUnits(availQuote, pair.quoteDecimals)} < ${PrecisionMath.formatFromUnits(buyerLockUnits, pair.quoteDecimals)}).`
        };
      }
    } else {
      const sellerUserId = makerSide === 'SELL' ? makerUserId : takerUserId;
      const buyerUserId = makerSide === 'BUY' ? makerUserId : takerUserId;
      const availSellerBase = getAvailableBalanceUnits(sellerUserId, pair.baseCurrency);
      const availBuyerQuote = getAvailableBalanceUnits(buyerUserId, pair.quoteCurrency);
      if (availSellerBase < qtyUnits) {
        return {
          status: 'INSUFFICIENT_BALANCE',
          reason: `Saldo ${pair.baseCurrency} penjual (${sellerUserId}) tidak mencukupi.`
        };
      }
      if (availBuyerQuote < buyerLockUnits) {
        return {
          status: 'INSUFFICIENT_BALANCE',
          reason: `Saldo ${pair.quoteCurrency} pembeli (${buyerUserId}) tidak mencukupi.`
        };
      }
    }

    // 7. Place Maker LIMIT GTC strictly inside the spread
    const seq = crypto.randomUUID().slice(0, 8);
    const makerRes = matchingEngine.placeOrder({
      userId: makerUserId,
      pairId: bot.pairId,
      side: makerSide,
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      price: execPriceUnits.toString(),
      quantity: qtyUnits.toString(),
      clientOrderId: `${bot.id}-vol-sp-m-${seq}`
    });

    bot.deployedOrderIds.push(makerRes.takerOrder.id);
    if (bot.deployedOrderIds.length > 500) {
      bot.deployedOrderIds = bot.deployedOrderIds.slice(-300);
    }

    bot.stats.ordersSubmitted += 1;
    bot.stats.ordersAccepted += 1;

    // In rare edge case if Maker unexpectedly matched an external order immediately
    if (makerRes.trades.length > 0) {
      let matchedBase = 0n;
      let matchedQuote = 0n;
      for (const t of makerRes.trades) {
        matchedBase += BigInt(t.quantity);
        matchedQuote += BigInt(t.quoteVolume);
        marketWsService.broadcastTrade(t);
      }
      this.recordTradesOnBot(bot, cfg, matchedBase, matchedQuote, makerRes.trades.length, takerSide, execPriceUnits, bookSpreadBps);
      marketWsService.broadcastOrderUpdate(makerRes.takerOrder);
      marketWsService.broadcastDepth(bot.pairId);
    } else {
      marketWsService.broadcastOrderUpdate(makerRes.takerOrder);
      marketWsService.broadcastDepth(bot.pairId);
    }

    const makerRemaining = BigInt(makerRes.takerOrder.quantity) - BigInt(makerRes.takerOrder.filledQuantity);
    if (makerRemaining <= 0n || (makerRes.takerOrder.status !== 'NEW' && makerRes.takerOrder.status !== 'PARTIALLY_FILLED')) {
      return {
        status: 'READY_FOR_CROSS',
        makerOrderId: makerRes.takerOrder.id,
        makerUserId,
        takerUserId,
        makerSide,
        takerSide,
        execPriceUnits,
        qtyUnits: 0n,
        bookSpreadBps,
        bestBidUnits,
        bestAskUnits
      };
    }

    return {
      status: 'READY_FOR_CROSS',
      makerOrderId: makerRes.takerOrder.id,
      makerUserId,
      takerUserId,
      makerSide,
      takerSide,
      execPriceUnits,
      qtyUnits: makerRemaining,
      bookSpreadBps,
      bestBidUnits,
      bestAskUnits
    };
  }

  /**
   * Phase 2 of Tick: Submit opposing Taker LIMIT IOC at execPriceUnits so it matches our Maker inside spread.
   */
  public static completeSpreadCrossLeg(
    bot: BotInstance,
    leg: SpreadPreparedLeg,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void
  ): SpreadCrossResult {
    const cfg = bot.volumeSpreadConfig!;
    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair || !pair.isActive || pair.isHalted) {
      // Cancel resting maker if halted mid-cross
      if (leg.makerOrderId && leg.makerUserId) {
        try {
          matchingEngine.cancelOrder(leg.makerOrderId, leg.makerUserId, bot.pairId);
        } catch {
          // ignore
        }
      }
      return {
        status: 'ERROR',
        executedBaseUnits: 0n,
        executedQuoteUnits: 0n,
        tradesCount: 0,
        reason: `Pair ${bot.pairId} tidak aktif atau halted sebelum cross leg.`
      };
    }

    if (!leg.makerOrderId || !leg.execPriceUnits || !leg.takerSide || !leg.takerUserId || !leg.makerUserId) {
      return {
        status: 'NO_FILL',
        executedBaseUnits: 0n,
        executedQuoteUnits: 0n,
        tradesCount: 0
      };
    }

    const makerOrder = db.orders.get(leg.makerOrderId);
    if (!makerOrder || (makerOrder.status !== 'NEW' && makerOrder.status !== 'PARTIALLY_FILLED')) {
      return {
        status: 'MAKER_CONSUMED',
        executedBaseUnits: 0n,
        executedQuoteUnits: 0n,
        tradesCount: 0,
        reason: 'Maker order sudah terpenuhi atau dibatalkan sebelum Taker IOC dieksekusi.'
      };
    }

    const makerRemaining = BigInt(makerOrder.quantity) - BigInt(makerOrder.filledQuantity);
    if (makerRemaining <= 0n || (leg.qtyUnits !== undefined && leg.qtyUnits <= 0n)) {
      return {
        status: 'MAKER_CONSUMED',
        executedBaseUnits: 0n,
        executedQuoteUnits: 0n,
        tradesCount: 0
      };
    }

    const takerQty = leg.qtyUnits && leg.qtyUnits < makerRemaining ? leg.qtyUnits : makerRemaining;

    // Submit opposing Taker LIMIT IOC at the exact inside-spread maker price
    const seq = crypto.randomUUID().slice(0, 8);
    const takerRes = matchingEngine.placeOrder({
      userId: leg.takerUserId,
      pairId: bot.pairId,
      side: leg.takerSide,
      orderType: 'LIMIT',
      timeInForce: 'IOC',
      price: leg.execPriceUnits.toString(),
      quantity: takerQty.toString(),
      clientOrderId: `${bot.id}-vol-sp-t-${seq}`
    });

    bot.deployedOrderIds.push(takerRes.takerOrder.id);
    bot.stats.ordersSubmitted += 1;
    bot.stats.ordersAccepted += 1;

    // Immediately clean up any unfilled Maker remainder so bot never leaves dangling spread orders
    const refreshedMaker = db.orders.get(leg.makerOrderId);
    if (refreshedMaker && (refreshedMaker.status === 'NEW' || refreshedMaker.status === 'PARTIALLY_FILLED')) {
      try {
        matchingEngine.cancelOrder(refreshedMaker.id, refreshedMaker.userId, bot.pairId);
        marketWsService.broadcastOrderUpdate(refreshedMaker);
      } catch {
        // ignore if already filled/cancelled
      }
    }

    let execBaseUnits = 0n;
    let execQuoteUnits = 0n;
    for (const trade of takerRes.trades) {
      execBaseUnits += BigInt(trade.quantity);
      execQuoteUnits += BigInt(trade.quoteVolume);
      marketWsService.broadcastTrade(trade);
    }

    for (const updatedMaker of takerRes.makerOrdersUpdated) {
      marketWsService.broadcastOrderUpdate(updatedMaker);
    }
    marketWsService.broadcastOrderUpdate(takerRes.takerOrder);
    marketWsService.broadcastDepth(bot.pairId);

    if (takerRes.trades.length > 0 && execBaseUnits > 0n) {
      this.recordTradesOnBot(
        bot,
        cfg,
        execBaseUnits,
        execQuoteUnits,
        takerRes.trades.length,
        leg.takerSide,
        leg.execPriceUnits,
        leg.bookSpreadBps || 0
      );

      const formattedPrice = PrecisionMath.formatFromUnits(leg.execPriceUnits, pair.quoteDecimals);
      const formattedQty = PrecisionMath.formatFromUnits(execBaseUnits, pair.baseDecimals);
      const formattedQuote = PrecisionMath.formatFromUnits(execQuoteUnits, pair.quoteDecimals);
      const bidDisplay = leg.bestBidUnits && leg.bestBidUnits > 0n
        ? PrecisionMath.formatFromUnits(leg.bestBidUnits, pair.quoteDecimals)
        : '-';
      const askDisplay = leg.bestAskUnits && leg.bestAskUnits > 0n
        ? PrecisionMath.formatFromUnits(leg.bestAskUnits, pair.quoteDecimals)
        : '-';

      addLog(
        bot,
        `[Spread Cross ${leg.takerSide}] Makan order sendiri @ ${formattedPrice} ${pair.quoteCurrency} × ${formattedQty} ${pair.baseCurrency} (Quote: ${formattedQuote}, Book: ${bidDisplay} / ${askDisplay})`,
        'FILL'
      );

      const stopCheck = this.isStopTargetReached(pair, cfg);
      if (stopCheck.reached) {
        return {
          status: 'STOP_TARGET_REACHED',
          executedBaseUnits: execBaseUnits,
          executedQuoteUnits: execQuoteUnits,
          tradesCount: takerRes.trades.length
        };
      }

      return {
        status: 'EXECUTED',
        executedBaseUnits: execBaseUnits,
        executedQuoteUnits: execQuoteUnits,
        tradesCount: takerRes.trades.length
      };
    }

    addLog(
      bot,
      `Taker IOC (${leg.takerSide}) selesai tanpa fill baru; sisa maker dibersihkan.`,
      'ORDER'
    );

    return {
      status: 'NO_FILL',
      executedBaseUnits: 0n,
      executedQuoteUnits: 0n,
      tradesCount: 0
    };
  }

  private static recordTradesOnBot(
    bot: BotInstance,
    cfg: VolumeSpreadBotConfig,
    execBaseUnits: bigint,
    execQuoteUnits: bigint,
    tradesCount: number,
    takerSide: OrderSide,
    execPriceUnits: bigint,
    bookSpreadBps: number
  ) {
    bot.stats.ordersFilled += tradesCount;
    bot.stats.totalTrades += tradesCount;
    bot.stats.executedVolume = (BigInt(bot.stats.executedVolume || '0') + execBaseUnits).toString();

    cfg.executedQuoteVolumeUnits = (BigInt(cfg.executedQuoteVolumeUnits || '0') + execQuoteUnits).toString();
    cfg.lastSideExecuted = takerSide;
    cfg.lastExecPriceUnits = execPriceUnits.toString();
    cfg.lastSpreadBps = bookSpreadBps;
    cfg.spreadSelfTradesCount = (cfg.spreadSelfTradesCount || 0) + tradesCount;
    bot.lastExecutionResult = `CROSS_${takerSide} @ ${execPriceUnits.toString()}`;
    bot.lastHeartbeat = Date.now();
  }

  /**
   * Cancel any resting open orders owned by this Volume Spread Bot.
   */
  public static cancelOpenBotOrders(
    bot: BotInstance,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void
  ): number {
    let cancelled = 0;
    const seen = new Set<string>();
    for (const orderId of bot.deployedOrderIds) {
      if (seen.has(orderId)) continue;
      seen.add(orderId);
      const order: Order | undefined = db.orders.get(orderId);
      if (order && (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED')) {
        try {
          matchingEngine.cancelOrder(order.id, order.userId, bot.pairId);
          cancelled++;
          marketWsService.broadcastOrderUpdate(order);
        } catch {
          // ignore
        }
      }
    }
    if (cancelled > 0) {
      addLog(bot, `Volume Spread Bot membersihkan ${cancelled} order maker tersisa.`, 'ORDER');
      marketWsService.broadcastDepth(bot.pairId);
    }
    return cancelled;
  }
}
