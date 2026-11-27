/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/OrderExecutionEngine.ts
 * Layer 3B — Execution Layer.
 * Handles:
 * - Live execution over DIMONEX MatchingEngine & LedgerService
 * - Isolated Paper Trading execution inside per-bot PaperWalletState (zero DB order/trade leakage)
 * - POST_ONLY, LIMIT, IOC, FOK, and Slippage-Collared MARKET orders
 * - Idempotency via clientOrderId, order timeouts, cancel-and-replace, anti-self-trade, and fill reconciliation
 */

import crypto from 'crypto';
import { db } from '../../db/database.js';
import { matchingEngine } from '../../engine/MatchingEngine.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import {
  BotExecutionRecord,
  BotOpenOrderState,
  ModularBotRecord,
  ModularOrderType,
  ModularTimeInForce,
  NormalizedMarketData,
} from './types.js';
import { AuthorizedOrderIntent } from './RiskManager.js';

export interface ExecutionBatchResult {
  submittedOrders: BotOpenOrderState[];
  executions: BotExecutionRecord[];
  cancelledOrderIds: string[];
  errors: string[];
}

export class OrderExecutionEngine {
  /**
   * Cancels expired resting orders whose age >= orderTimeoutSeconds.
   * For Market Making & Grid bots, stale open orders may also be passed in `explicitCancelIds`.
   */
  public static cancelOrders(
    bot: ModularBotRecord,
    orderIds: string[],
    now: number,
    reason = 'Cancel/Replace'
  ): string[] {
    const cancelled: string[] = [];
    if (!orderIds || orderIds.length === 0) return cancelled;
    const cancelSet = new Set(orderIds);

    for (let i = bot.openOrders.length - 1; i >= 0; i--) {
      const oo = bot.openOrders[i];
      if (!cancelSet.has(oo.orderId)) continue;

      if (bot.config.bot.mode === 'LIVE') {
        try {
          const liveOrder = db.orders.get(oo.orderId);
          if (liveOrder && (liveOrder.status === 'NEW' || liveOrder.status === 'PARTIALLY_FILLED')) {
            matchingEngine.cancelOrder(oo.orderId, bot.ownerUserId, bot.pairId);
          }
          bot.openOrders.splice(i, 1);
          bot.metrics.ordersCancelled += 1;
          cancelled.push(oo.orderId);
        } catch (err: any) {
          bot.logs.push({
            timestamp: now,
            type: 'ERROR',
            message: `Gagal membatalkan order ${oo.orderId.slice(0, 8)} (${reason}): ${err?.message}`,
          });
        }
      } else if (bot.config.bot.mode === 'PAPER' && bot.paperWallet) {
        // Unlock reserved PaperWallet balances
        const locked = BigInt(oo.lockedAmountUnits || '0');
        if (locked > 0n) {
          if (oo.lockedCurrency === bot.paperWallet.quoteCurrency) {
            const avail = BigInt(bot.paperWallet.quoteAvailableUnits || '0');
            const currLock = BigInt(bot.paperWallet.quoteLockedUnits || '0');
            const release = locked <= currLock ? locked : currLock;
            bot.paperWallet.quoteAvailableUnits = (avail + release).toString();
            bot.paperWallet.quoteLockedUnits = (currLock - release).toString();
          } else if (oo.lockedCurrency === bot.paperWallet.baseCurrency) {
            const avail = BigInt(bot.paperWallet.baseAvailableUnits || '0');
            const currLock = BigInt(bot.paperWallet.baseLockedUnits || '0');
            const release = locked <= currLock ? locked : currLock;
            bot.paperWallet.baseAvailableUnits = (avail + release).toString();
            bot.paperWallet.baseLockedUnits = (currLock - release).toString();
          }
        }
        bot.openOrders.splice(i, 1);
        bot.metrics.ordersCancelled += 1;
        cancelled.push(oo.orderId);
      }
    }

    if (cancelled.length > 0) {
      bot.logs.push({
        timestamp: now,
        type: 'ORDER',
        message: `Dibatalkan ${cancelled.length} order (${reason}).`,
      });
    }
    return cancelled;
  }

  /**
   * Cancels ALL open orders belonging exclusively to this bot instance (safe stop / emergency stop).
   */
  public static cancelAllBotOrders(bot: ModularBotRecord, now: number, reason = 'Bot Stopped'): string[] {
    const ids = bot.openOrders.map(o => o.orderId);
    return this.cancelOrders(bot, ids, now, reason);
  }

  /**
   * Checks open LIVE/PAPER orders for fills, partial fills, and timeout expirations,
   * updating `bot.position`, `bot.executions`, and `bot.metrics` authoritatively.
   */
  public static reconcileOpenOrders(
    bot: ModularBotRecord,
    marketData: NormalizedMarketData,
    now: number
  ): BotExecutionRecord[] {
    const newExecutions: BotExecutionRecord[] = [];
    const timeoutMs = Math.max(1, bot.config.execution.orderTimeoutSeconds || 300) * 1000;
    const timedOutIds: string[] = [];

    if (bot.config.bot.mode === 'LIVE') {
      const seenTradeIds = new Set(bot.executions.map(e => e.tradeId).filter(Boolean));

      for (let i = bot.openOrders.length - 1; i >= 0; i--) {
        const oo = bot.openOrders[i];
        const liveOrder = db.orders.get(oo.orderId);
        if (!liveOrder) {
          bot.openOrders.splice(i, 1);
          continue;
        }

        // Reconcile any settled Exchange trades matching this bot order
        const matchingTrades = db.trades.filter(
          t =>
            t.pairId === bot.pairId &&
            (t.makerOrderId === oo.orderId || t.takerOrderId === oo.orderId) &&
            !seenTradeIds.has(t.id)
        );

        for (const tr of matchingTrades) {
          seenTradeIds.add(tr.id);
          const isMaker = tr.makerOrderId === oo.orderId;
          const feeBps = isMaker
            ? marketData.constraints.makerFeeBps
            : marketData.constraints.takerFeeBps;
          const qVol = BigInt(tr.quoteVolume || '0');
          const feeUnits = PrecisionMath.calculateFee(qVol, feeBps);

          const execRec = this.applyExecutionToPosition(bot, marketData, {
            executionId: crypto.randomUUID(),
            orderId: oo.orderId,
            clientOrderId: oo.clientOrderId,
            botId: bot.id,
            mode: 'LIVE',
            pairId: bot.pairId,
            side: oo.side,
            orderType: oo.orderType,
            priceUnits: tr.price,
            quantityUnits: tr.quantity,
            quoteVolumeUnits: tr.quoteVolume,
            feeUnits: feeUnits.toString(),
            feeCurrency: marketData.constraints.quoteCurrency,
            realizedPnlQuoteUnits: '0',
            isPartial: liveOrder.status === 'PARTIALLY_FILLED',
            timestamp: tr.createdAt || now,
            tradeId: tr.id,
          });
          newExecutions.push(execRec);
        }

        oo.filledQuantityUnits = liveOrder.filledQuantity;
        oo.lockedAmountUnits = liveOrder.lockedAmount;
        oo.status = liveOrder.status;
        oo.updatedAt = liveOrder.updatedAt;

        if (liveOrder.status === 'FILLED' || liveOrder.status === 'CANCELLED' || liveOrder.status === 'REJECTED') {
          if (liveOrder.status === 'FILLED') bot.metrics.ordersFilled += 1;
          bot.openOrders.splice(i, 1);
        } else if (oo.expiresAt && now >= oo.expiresAt) {
          timedOutIds.push(oo.orderId);
        } else if (now - oo.createdAt >= timeoutMs) {
          timedOutIds.push(oo.orderId);
        }
      }
    } else if (bot.config.bot.mode === 'PAPER' && bot.paperWallet) {
      // Paper Mode: simulate fill if market price crossed resting limit price
      const bestBid = BigInt(marketData.orderBook.bestBidUnits || marketData.referencePriceUnits || '0');
      const bestAsk = BigInt(marketData.orderBook.bestAskUnits || marketData.referencePriceUnits || '0');

      for (let i = bot.openOrders.length - 1; i >= 0; i--) {
        const oo = bot.openOrders[i];
        const limitPrice = BigInt(oo.priceUnits || '0');
        const totalQty = BigInt(oo.quantityUnits || '0');
        const filledQty = BigInt(oo.filledQuantityUnits || '0');
        const remQty = totalQty - filledQty;

        if (remQty <= 0n) {
          bot.openOrders.splice(i, 1);
          continue;
        }

        const shouldFillBuy = oo.side === 'BUY' && bestAsk > 0n && bestAsk <= limitPrice;
        const shouldFillSell = oo.side === 'SELL' && bestBid > 0n && bestBid >= limitPrice;

        if (shouldFillBuy || shouldFillSell) {
          const fillProb = bot.config.paperConfig?.partialFillProbabilityPct ?? 0;
          const partialTriggered =
            fillProb > 0 && Math.random() * 100 < fillProb && remQty > BigInt(marketData.constraints.minOrderSizeUnits) * 2n;
          const fillQty = partialTriggered ? remQty / 2n : remQty;
          const makerFeeBps = bot.config.paperConfig?.makerFeeBps ?? marketData.constraints.makerFeeBps;
          const execRec = this.settlePaperFill(
            bot,
            oo,
            marketData,
            limitPrice,
            fillQty,
            makerFeeBps,
            partialTriggered,
            now
          );
          newExecutions.push(execRec);
          if (oo.status === 'FILLED') {
            bot.metrics.ordersFilled += 1;
            bot.openOrders.splice(i, 1);
          }
        } else if (now - oo.createdAt >= timeoutMs) {
          timedOutIds.push(oo.orderId);
        }
      }
    }

    if (timedOutIds.length > 0) {
      this.cancelOrders(bot, timedOutIds, now, 'Order Timeout');
    }

    return newExecutions;
  }

  /**
   * Executes authorized order intents with idempotency, order-type semantics, and retries.
   */
  public static executeIntents(
    bot: ModularBotRecord,
    intents: AuthorizedOrderIntent[],
    marketData: NormalizedMarketData,
    now: number
  ): ExecutionBatchResult {
    const submittedOrders: BotOpenOrderState[] = [];
    const executions: BotExecutionRecord[] = [];
    const cancelledOrderIds: string[] = [];
    const errors: string[] = [];

    if (intents.length === 0) {
      return { submittedOrders, executions, cancelledOrderIds, errors };
    }

    const execCfg = bot.config.execution;
    const maxRetries = Math.max(0, Math.min(3, execCfg.retryCount ?? 1));
    const tickSec = Math.floor(now / 1000);

    for (const intent of intents) {
      const effectiveOrderType: ModularOrderType = intent.isBarrierExit
        ? (execCfg.orderType === 'POST_ONLY' ? 'MARKET' : execCfg.orderType)
        : intent.postOnly
          ? 'POST_ONLY'
          : execCfg.orderType;

      const effectiveTif: ModularTimeInForce =
        effectiveOrderType === 'IOC'
          ? 'IOC'
          : effectiveOrderType === 'FOK'
            ? 'FOK'
            : execCfg.timeInForce || 'GTC';

      // Deterministic idempotency clientOrderId per bot, tag, and tick second
      const clientOrderId = `mbot:${bot.id.slice(0, 8)}:${intent.clientTag}:${tickSec}`;
      const isDup =
        bot.openOrders.some(o => o.clientOrderId === clientOrderId) ||
        bot.executions.some(e => e.clientOrderId === clientOrderId);
      if (isDup) continue;

      let attempt = 0;
      let completed = false;
      while (attempt <= maxRetries && !completed) {
        attempt += 1;
        try {
          if (bot.config.bot.mode === 'LIVE') {
            const res = this.submitLiveOrder(
              bot,
              intent,
              effectiveOrderType,
              effectiveTif,
              clientOrderId,
              marketData,
              now
            );
            if (res.openOrder) submittedOrders.push(res.openOrder);
            if (res.executions.length > 0) executions.push(...res.executions);
          } else {
            const res = this.submitPaperOrder(
              bot,
              intent,
              effectiveOrderType,
              effectiveTif,
              clientOrderId,
              marketData,
              now
            );
            if (res.openOrder) submittedOrders.push(res.openOrder);
            if (res.executions.length > 0) executions.push(...res.executions);
          }
          bot.orderTimestampsInWindow.push(now);
          bot.metrics.ordersSubmitted += 1;
          completed = true;
        } catch (err: any) {
          const msg = err?.message || 'Eksekusi order gagal';
          const isTerminalRejection =
            msg.includes('POST_ONLY') ||
            msg.includes('FOK') ||
            msg.includes('Saldo') ||
            msg.includes('Insufficient') ||
            msg.includes('slippage') ||
            msg.includes('Self-trade');
          if (isTerminalRejection || attempt > maxRetries) {
            errors.push(`${intent.side} ${intent.clientTag}: ${msg}`);
            bot.logs.push({ timestamp: now, type: 'RISK', message: `Order ditolak (${intent.clientTag}): ${msg}` });
            break;
          }
        }
      }
    }

    return { submittedOrders, executions, cancelledOrderIds, errors };
  }

  private static submitLiveOrder(
    bot: ModularBotRecord,
    intent: AuthorizedOrderIntent,
    orderType: ModularOrderType,
    tif: ModularTimeInForce,
    clientOrderId: string,
    marketData: NormalizedMarketData,
    now: number
  ): { openOrder?: BotOpenOrderState; executions: BotExecutionRecord[] } {
    const qtyUnits = BigInt(intent.quantityUnits);
    const priceUnits = BigInt(intent.priceUnits);
    const c = marketData.constraints;
    const book = matchingEngine.getOrderBook(bot.pairId);
    const bestAskUnits = book.asks.length > 0 ? BigInt(book.asks[0].price) : 0n;
    const bestBidUnits = book.bids.length > 0 ? BigInt(book.bids[0].price) : 0n;

    // Anti-self-trade protection for Market Making / bot-owned quotes
    if (orderType === 'POST_ONLY' || bot.config.bot.category === 'MARKET_MAKING') {
      const opposingOwn = bot.openOrders.some(o => {
        if (o.side === intent.side) return false;
        const opPrice = BigInt(o.priceUnits || '0');
        return intent.side === 'BUY' ? priceUnits >= opPrice : priceUnits <= opPrice;
      });
      if (opposingOwn) {
        throw new Error('Self-trade prevention: harga order bersinggungan dengan order aktif bot sendiri.');
      }
    }

    // POST_ONLY guard: must sit strictly passive on book without crossing best opposing quote
    if (orderType === 'POST_ONLY') {
      if (intent.side === 'BUY' && bestAskUnits > 0n && priceUnits >= bestAskUnits) {
        throw new Error('POST_ONLY_WOULD_CROSS: Bid >= Best Ask.');
      }
      if (intent.side === 'SELL' && bestBidUnits > 0n && priceUnits <= bestBidUnits) {
        throw new Error('POST_ONLY_WOULD_CROSS: Ask <= Best Bid.');
      }
    }

    // MARKET slippage collar validation before dispatch
    if (orderType === 'MARKET') {
      const maxSlipBps = BigInt(Math.max(5, bot.config.execution.maxSlippageBps || 100));
      const refUnits = BigInt(marketData.referencePriceUnits || '0');
      if (refUnits > 0n) {
        if (intent.side === 'BUY' && bestAskUnits > 0n) {
          const capPrice = (refUnits * (10000n + maxSlipBps)) / 10000n;
          if (bestAskUnits > capPrice) {
            throw new Error(`Proteksi slippage terlampaui (Best Ask > batas +${maxSlipBps} bps).`);
          }
        }
        if (intent.side === 'SELL' && bestBidUnits > 0n) {
          const floorPrice = (refUnits * (10000n - maxSlipBps)) / 10000n;
          if (bestBidUnits < floorPrice) {
            throw new Error(`Proteksi slippage terlampaui (Best Bid < batas -${maxSlipBps} bps).`);
          }
        }
      }
    }

    // FOK depth verification: opposing side must have full fillable qty at limitPrice (skipping self if STP cancels)
    if (orderType === 'FOK' || tif === 'FOK') {
      const opposingLevels = intent.side === 'BUY' ? book.asks : book.bids;
      let fillableQty = 0n;
      for (const lvl of opposingLevels) {
        const lvlPrice = BigInt(lvl.price);
        const priceMatches = intent.side === 'BUY' ? lvlPrice <= priceUnits : lvlPrice >= priceUnits;
        if (!priceMatches) break;
        if (lvl.userId !== bot.ownerUserId || db.riskControls.selfTradePreventionPolicy === 'ALLOW_WASH') {
          fillableQty += BigInt(lvl.quantity) - BigInt(lvl.filledQuantity);
        }
        if (fillableQty >= qtyUnits) break;
      }
      if (fillableQty < qtyUnits) {
        throw new Error('FOK_UNFILLABLE: Likuiditas book tidak mencukupi untuk fill penuh sekaligus.');
      }
    }

    const engineOrderType = orderType === 'MARKET' ? 'MARKET' : 'LIMIT';
    const engineTif = orderType === 'IOC' || orderType === 'FOK' || tif === 'IOC' || tif === 'FOK' ? 'IOC' : 'GTC';

    const matchResult = matchingEngine.placeOrder({
      userId: bot.ownerUserId,
      pairId: bot.pairId,
      side: intent.side,
      orderType: engineOrderType,
      timeInForce: engineTif,
      price: engineOrderType === 'LIMIT' ? priceUnits.toString() : undefined,
      quantity: qtyUnits.toString(),
      clientOrderId,
    });

    const takerOrder = matchResult.takerOrder;
    const execs: BotExecutionRecord[] = [];
    for (const tr of matchResult.trades) {
      const feeBps = c.takerFeeBps;
      const feeUnits = PrecisionMath.calculateFee(BigInt(tr.quoteVolume || '0'), feeBps);
      const rec = this.applyExecutionToPosition(bot, marketData, {
        executionId: crypto.randomUUID(),
        orderId: takerOrder.id,
        clientOrderId,
        botId: bot.id,
        mode: 'LIVE',
        pairId: bot.pairId,
        side: intent.side,
        orderType,
        priceUnits: tr.price,
        quantityUnits: tr.quantity,
        quoteVolumeUnits: tr.quoteVolume,
        feeUnits: feeUnits.toString(),
        feeCurrency: c.quoteCurrency,
        realizedPnlQuoteUnits: '0',
        isPartial: takerOrder.status === 'PARTIALLY_FILLED',
        timestamp: tr.createdAt || now,
        tradeId: tr.id,
      });
      execs.push(rec);
    }

    const openState: BotOpenOrderState = {
      orderId: takerOrder.id,
      clientOrderId,
      botId: bot.id,
      pairId: bot.pairId,
      mode: 'LIVE',
      side: intent.side,
      orderType,
      timeInForce: tif,
      priceUnits: takerOrder.price !== '0' ? takerOrder.price : priceUnits.toString(),
      quantityUnits: takerOrder.quantity,
      filledQuantityUnits: takerOrder.filledQuantity,
      lockedAmountUnits: takerOrder.lockedAmount,
      lockedCurrency: takerOrder.lockedCurrency,
      status: takerOrder.status,
      createdAt: takerOrder.createdAt,
      updatedAt: takerOrder.updatedAt,
      expiresAt: now + (bot.config.execution.orderTimeoutSeconds || 300) * 1000,
    };

    if (takerOrder.status === 'NEW' || takerOrder.status === 'PARTIALLY_FILLED') {
      bot.openOrders.push(openState);
    } else if (takerOrder.status === 'FILLED') {
      bot.metrics.ordersFilled += 1;
    }

    bot.logs.push({
      timestamp: now,
      type: execs.length > 0 ? 'FILL' : 'ORDER',
      message: `${orderType} ${intent.side} ${PrecisionMath.formatFromUnits(qtyUnits, c.baseDecimals, true)} ${c.baseCurrency} @ ${PrecisionMath.formatFromUnits(priceUnits, c.quoteDecimals, true)} -> ${takerOrder.status}`,
    });

    return { openOrder: openState, executions: execs };
  }

  private static submitPaperOrder(
    bot: ModularBotRecord,
    intent: AuthorizedOrderIntent,
    orderType: ModularOrderType,
    tif: ModularTimeInForce,
    clientOrderId: string,
    marketData: NormalizedMarketData,
    now: number
  ): { openOrder?: BotOpenOrderState; executions: BotExecutionRecord[] } {
    if (!bot.paperWallet) {
      throw new Error('Paper wallet belum diinisialisasi untuk bot mode PAPER.');
    }

    const pw = bot.paperWallet;
    const c = marketData.constraints;
    const qtyUnits = BigInt(intent.quantityUnits);
    const limitPriceUnits = BigInt(intent.priceUnits);
    const bestAsk = BigInt(marketData.orderBook.bestAskUnits || marketData.referencePriceUnits || '0');
    const bestBid = BigInt(marketData.orderBook.bestBidUnits || marketData.referencePriceUnits || '0');

    // Anti-self-trade on Paper MM
    if (orderType === 'POST_ONLY') {
      if (intent.side === 'BUY' && bestAsk > 0n && limitPriceUnits >= bestAsk) {
        throw new Error('POST_ONLY_WOULD_CROSS (Paper): Bid >= Best Ask.');
      }
      if (intent.side === 'SELL' && bestBid > 0n && limitPriceUnits <= bestBid) {
        throw new Error('POST_ONLY_WOULD_CROSS (Paper): Ask <= Best Bid.');
      }
    }

    const takerFeeBps = bot.config.paperConfig?.takerFeeBps ?? c.takerFeeBps;
    const makerFeeBps = bot.config.paperConfig?.makerFeeBps ?? c.makerFeeBps;
    const simSlippageBps = BigInt(bot.config.paperConfig?.simulatedSlippageBps ?? 5);

    // Lock Paper funds strictly against paperWallet.available
    let lockedAmount = 0n;
    let lockedCurrency = '';
    if (intent.side === 'BUY') {
      const refForLock = orderType === 'MARKET' && bestAsk > 0n
        ? (bestAsk * (10000n + simSlippageBps)) / 10000n
        : limitPriceUnits;
      const qVol = PrecisionMath.calculateQuoteAmount(qtyUnits, c.baseDecimals, refForLock);
      const feeEst = PrecisionMath.calculateFee(qVol, takerFeeBps);
      lockedAmount = qVol + feeEst;
      lockedCurrency = c.quoteCurrency;
      const availQ = BigInt(pw.quoteAvailableUnits || '0');
      if (availQ < lockedAmount) {
        throw new Error(`Saldo Paper ${c.quoteCurrency} tidak mencukupi.`);
      }
      pw.quoteAvailableUnits = (availQ - lockedAmount).toString();
      pw.quoteLockedUnits = (BigInt(pw.quoteLockedUnits || '0') + lockedAmount).toString();
    } else {
      lockedAmount = qtyUnits;
      lockedCurrency = c.baseCurrency;
      const availB = BigInt(pw.baseAvailableUnits || '0');
      if (availB < lockedAmount) {
        throw new Error(`Saldo Paper ${c.baseCurrency} tidak mencukupi.`);
      }
      pw.baseAvailableUnits = (availB - lockedAmount).toString();
      pw.baseLockedUnits = (BigInt(pw.baseLockedUnits || '0') + lockedAmount).toString();
    }

    const openState: BotOpenOrderState = {
      orderId: `paper-${crypto.randomUUID()}`,
      clientOrderId,
      botId: bot.id,
      pairId: bot.pairId,
      mode: 'PAPER',
      side: intent.side,
      orderType,
      timeInForce: tif,
      priceUnits: limitPriceUnits.toString(),
      quantityUnits: qtyUnits.toString(),
      filledQuantityUnits: '0',
      lockedAmountUnits: lockedAmount.toString(),
      lockedCurrency,
      status: 'NEW',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + (bot.config.execution.orderTimeoutSeconds || 300) * 1000,
    };

    const executions: BotExecutionRecord[] = [];
    const crossesImmediate =
      orderType === 'MARKET' ||
      orderType === 'IOC' ||
      orderType === 'FOK' ||
      (intent.side === 'BUY' && bestAsk > 0n && limitPriceUnits >= bestAsk) ||
      (intent.side === 'SELL' && bestBid > 0n && limitPriceUnits <= bestBid);

    if (crossesImmediate) {
      let execPrice = intent.side === 'BUY' ? (bestAsk > 0n ? bestAsk : limitPriceUnits) : (bestBid > 0n ? bestBid : limitPriceUnits);
      if (orderType === 'MARKET' || orderType === 'IOC' || orderType === 'FOK') {
        execPrice =
          intent.side === 'BUY'
            ? (execPrice * (10000n + simSlippageBps)) / 10000n
            : (execPrice * (10000n - simSlippageBps)) / 10000n;
      }

      const partialPct = bot.config.paperConfig?.partialFillProbabilityPct ?? 0;
      const isPartial =
        orderType !== 'FOK' &&
        partialPct > 0 &&
        Math.random() * 100 < partialPct &&
        qtyUnits >= BigInt(c.minOrderSizeUnits) * 2n;
      const fillQty = isPartial ? qtyUnits / 2n : qtyUnits;
      const execRec = this.settlePaperFill(
        bot,
        openState,
        marketData,
        execPrice,
        fillQty,
        orderType === 'LIMIT' ? makerFeeBps : takerFeeBps,
        isPartial,
        now
      );
      executions.push(execRec);

      if (openState.status === 'FILLED') {
        bot.metrics.ordersFilled += 1;
      } else if (tif === 'IOC' || tif === 'FOK' || orderType === 'MARKET') {
        // Release remainder for IOC/MARKET
        this.releaseRemainingPaperLock(bot, openState);
        openState.status = 'CANCELLED';
      } else {
        bot.openOrders.push(openState);
      }
    } else {
      bot.openOrders.push(openState);
    }

    bot.logs.push({
      timestamp: now,
      type: executions.length > 0 ? 'FILL' : 'ORDER',
      message: `[PAPER] ${orderType} ${intent.side} ${PrecisionMath.formatFromUnits(qtyUnits, c.baseDecimals, true)} @ ${PrecisionMath.formatFromUnits(limitPriceUnits, c.quoteDecimals, true)} -> ${openState.status}`,
    });

    return { openOrder: openState, executions };
  }

  private static releaseRemainingPaperLock(bot: ModularBotRecord, order: BotOpenOrderState): void {
    if (!bot.paperWallet) return;
    const remLock = BigInt(order.lockedAmountUnits || '0');
    if (remLock <= 0n) return;
    if (order.lockedCurrency === bot.paperWallet.quoteCurrency) {
      const l = BigInt(bot.paperWallet.quoteLockedUnits || '0');
      const rel = remLock <= l ? remLock : l;
      bot.paperWallet.quoteLockedUnits = (l - rel).toString();
      bot.paperWallet.quoteAvailableUnits = (BigInt(bot.paperWallet.quoteAvailableUnits || '0') + rel).toString();
    } else {
      const l = BigInt(bot.paperWallet.baseLockedUnits || '0');
      const rel = remLock <= l ? remLock : l;
      bot.paperWallet.baseLockedUnits = (l - rel).toString();
      bot.paperWallet.baseAvailableUnits = (BigInt(bot.paperWallet.baseAvailableUnits || '0') + rel).toString();
    }
    order.lockedAmountUnits = '0';
  }

  private static settlePaperFill(
    bot: ModularBotRecord,
    order: BotOpenOrderState,
    marketData: NormalizedMarketData,
    fillPriceUnits: bigint,
    fillQtyUnits: bigint,
    feeBps: number,
    isPartial: boolean,
    now: number
  ): BotExecutionRecord {
    const pw = bot.paperWallet!;
    const c = marketData.constraints;
    const quoteVol = PrecisionMath.calculateQuoteAmount(fillQtyUnits, c.baseDecimals, fillPriceUnits);
    const feeUnits = PrecisionMath.calculateFee(quoteVol, feeBps);

    const prevFilled = BigInt(order.filledQuantityUnits || '0');
    const newFilled = prevFilled + fillQtyUnits;
    const totalQty = BigInt(order.quantityUnits || '0');
    order.filledQuantityUnits = newFilled.toString();
    order.status = newFilled >= totalQty ? 'FILLED' : 'PARTIALLY_FILLED';
    order.updatedAt = now;

    if (order.side === 'BUY') {
      const spendTotal = quoteVol + feeUnits;
      const currOrderLock = BigInt(order.lockedAmountUnits || '0');
      const consumed = spendTotal <= currOrderLock ? spendTotal : currOrderLock;
      order.lockedAmountUnits = (currOrderLock - consumed).toString();

      const pwQuoteLocked = BigInt(pw.quoteLockedUnits || '0');
      const deductLocked = consumed <= pwQuoteLocked ? consumed : pwQuoteLocked;
      pw.quoteLockedUnits = (pwQuoteLocked - deductLocked).toString();
      if (order.status === 'FILLED' && BigInt(order.lockedAmountUnits) > 0n) {
        const refund = BigInt(order.lockedAmountUnits);
        const rel = refund <= BigInt(pw.quoteLockedUnits) ? refund : BigInt(pw.quoteLockedUnits);
        pw.quoteLockedUnits = (BigInt(pw.quoteLockedUnits) - rel).toString();
        pw.quoteAvailableUnits = (BigInt(pw.quoteAvailableUnits) + rel).toString();
        order.lockedAmountUnits = '0';
      }
      pw.baseAvailableUnits = (BigInt(pw.baseAvailableUnits || '0') + fillQtyUnits).toString();
    } else {
      const currOrderLock = BigInt(order.lockedAmountUnits || '0');
      const consumedBase = fillQtyUnits <= currOrderLock ? fillQtyUnits : currOrderLock;
      order.lockedAmountUnits = (currOrderLock - consumedBase).toString();

      const pwBaseLocked = BigInt(pw.baseLockedUnits || '0');
      const deductBase = consumedBase <= pwBaseLocked ? consumedBase : pwBaseLocked;
      pw.baseLockedUnits = (pwBaseLocked - deductBase).toString();

      const netProceeds = quoteVol > feeUnits ? quoteVol - feeUnits : 0n;
      pw.quoteAvailableUnits = (BigInt(pw.quoteAvailableUnits || '0') + netProceeds).toString();
    }

    return this.applyExecutionToPosition(bot, marketData, {
      executionId: crypto.randomUUID(),
      orderId: order.orderId,
      clientOrderId: order.clientOrderId,
      botId: bot.id,
      mode: 'PAPER',
      pairId: bot.pairId,
      side: order.side,
      orderType: order.orderType,
      priceUnits: fillPriceUnits.toString(),
      quantityUnits: fillQtyUnits.toString(),
      quoteVolumeUnits: quoteVol.toString(),
      feeUnits: feeUnits.toString(),
      feeCurrency: c.quoteCurrency,
      realizedPnlQuoteUnits: '0',
      isPartial,
      timestamp: now,
    });
  }

  /**
   * Authoritative position, weighted avg entry, realized PnL, fees, and drawdown ledger tracker.
   */
  public static applyExecutionToPosition(
    bot: ModularBotRecord,
    marketData: NormalizedMarketData,
    exec: BotExecutionRecord
  ): BotExecutionRecord {
    const pos = bot.position;
    const baseDec = marketData.constraints.baseDecimals;
    const qtyUnits = BigInt(exec.quantityUnits);
    const priceUnits = BigInt(exec.priceUnits);
    const quoteVol = BigInt(exec.quoteVolumeUnits);
    const feeUnits = BigInt(exec.feeUnits);

    let realizedPnl = 0n;

    if (exec.side === 'BUY') {
      const prevQty = BigInt(pos.baseQtyUnits || '0');
      const prevCost = BigInt(pos.quoteCostBasisUnits || '0');
      const newQty = prevQty + qtyUnits;
      const newCost = prevCost + quoteVol + feeUnits;

      pos.side = 'LONG';
      pos.baseQtyUnits = newQty.toString();
      pos.quoteCostBasisUnits = newCost.toString();
      const baseScale = 10n ** BigInt(baseDec);
      pos.avgEntryPriceUnits = newQty > 0n ? ((newCost * baseScale) / newQty).toString() : priceUnits.toString();
      if (!pos.openedAt) pos.openedAt = exec.timestamp;
      if (BigInt(pos.highWaterMarkPriceUnits || '0') < priceUnits) {
        pos.highWaterMarkPriceUnits = priceUnits.toString();
      }
      realizedPnl = -feeUnits;
    } else {
      const prevQty = BigInt(pos.baseQtyUnits || '0');
      const prevCost = BigInt(pos.quoteCostBasisUnits || '0');
      if (prevQty > 0n) {
        const closedQty = qtyUnits <= prevQty ? qtyUnits : prevQty;
        const propCost = (prevCost * closedQty) / prevQty;
        const netProceeds = quoteVol - feeUnits;
        realizedPnl = netProceeds - propCost;

        const remQty = prevQty - closedQty;
        const remCost = prevCost > propCost ? prevCost - propCost : 0n;
        pos.baseQtyUnits = remQty.toString();
        pos.quoteCostBasisUnits = remCost.toString();

        if (remQty === 0n) {
          pos.side = 'FLAT';
          pos.avgEntryPriceUnits = '0';
          pos.openedAt = null;
          pos.highWaterMarkPriceUnits = '0';
          pos.breakEvenArmed = false;
          pos.trailingStopActive = false;
          pos.activeStopLossPriceUnits = null;
          pos.activeTakeProfitPriceUnits = null;
          pos.unrealizedPnlQuoteUnits = '0';
        }
      } else {
        realizedPnl = quoteVol - feeUnits;
      }
    }

    exec.realizedPnlQuoteUnits = realizedPnl.toString();
    pos.realizedPnlQuoteUnits = (BigInt(pos.realizedPnlQuoteUnits || '0') + realizedPnl).toString();

    bot.metrics.totalTrades += 1;
    bot.metrics.totalVolumeBaseUnits = (BigInt(bot.metrics.totalVolumeBaseUnits || '0') + qtyUnits).toString();
    bot.metrics.totalVolumeQuoteUnits = (BigInt(bot.metrics.totalVolumeQuoteUnits || '0') + quoteVol).toString();
    bot.metrics.totalFeesQuoteUnits = (BigInt(bot.metrics.totalFeesQuoteUnits || '0') + feeUnits).toString();
    bot.metrics.realizedPnlQuoteUnits = pos.realizedPnlQuoteUnits;

    if (realizedPnl < 0n) {
      bot.metrics.dailyLossQuoteUnits = (BigInt(bot.metrics.dailyLossQuoteUnits || '0') + (-realizedPnl)).toString();
    }

    bot.executions.push(exec);
    if (bot.executions.length > 500) {
      bot.executions.splice(0, bot.executions.length - 500);
    }
    return exec;
  }
}
