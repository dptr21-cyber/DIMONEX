/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FuturesEngine.ts
 * Real Perpetual Futures Trading Engine for DIMONEX.
 * - Uses ALL real market pairs from db.tradingPairs (both IDR & USDT quote pairs).
 * - Preserves exact per-pair baseDecimals and quoteDecimals (e.g. IDR = 2, USDT = 6) with BigInt math.
 * - Enforces double-entry atomic margin locking and PnL/fee settlement via LedgerService.
 * - Evaluates live resting LIMIT orders and liquidation triggers on a continuous 1500ms loop.
 */

import crypto from 'crypto';
import { db, SYSTEM_FEE_ID, SYSTEM_TREASURY_ID } from '../db/database.js';
import {
  FuturesMarginMode,
  FuturesOrder,
  FuturesOrderType,
  FuturesPosition,
  FuturesSide,
  TradingPair,
} from '../db/types.js';
import { matchingEngine } from '../engine/MatchingEngine.js';
import { LedgerService } from '../ledger/LedgerService.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';
import { marketWsService } from '../websocket/MarketDataWs.js';

export interface PlaceFuturesOrderInput {
  userId: string;
  pairId: string;
  side: FuturesSide;
  orderType: FuturesOrderType;
  marginMode: FuturesMarginMode;
  leverage: number;
  quantity: string;
  limitPrice?: string;
}

class FuturesEngineService {
  private timer: NodeJS.Timeout | null = null;
  private isTicking = false;

  public start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.evaluateMarkAndOrders();
    }, 1500);
    console.log('[DIMONEX FuturesEngine] Real Perpetual Futures engine aktif (1500ms mark/order loop).');
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private resolvePairDecimals(pair: TradingPair): { baseDecimals: number; quoteDecimals: number } {
    const baseDecimals = pair.baseDecimals ?? 8;
    const quoteDecimals =
      pair.quoteDecimals !== undefined && pair.quoteDecimals !== null
        ? pair.quoteDecimals
        : pair.quoteCurrency === 'USDT'
        ? 6
        : 2;
    return { baseDecimals, quoteDecimals };
  }

  private getNext8hFundingTimestamp(now = Date.now()): number {
    const eightHoursMs = 8 * 60 * 60 * 1000;
    return Math.ceil((now + 1000) / eightHoursMs) * eightHoursMs;
  }

  private getLiveBookPrices(pair: TradingPair): {
    lastUnits: bigint;
    bestBidUnits: bigint;
    bestAskUnits: bigint;
  } {
    const book = matchingEngine.getOrderBook(pair.id);
    const lastUnits = BigInt(pair.lastPrice || '0');
    const bestBidUnits =
      book.bids.length > 0 && BigInt(book.bids[0].price) > 0n
        ? BigInt(book.bids[0].price)
        : lastUnits;
    const bestAskUnits =
      book.asks.length > 0 && BigInt(book.asks[0].price) > 0n
        ? BigInt(book.asks[0].price)
        : lastUnits;
    return { lastUnits, bestBidUnits, bestAskUnits };
  }

  private calculateNotionalQuoteUnits(
    sizeUnits: bigint,
    baseDecimals: number,
    priceUnits: bigint
  ): bigint {
    return PrecisionMath.calculateQuoteAmount(sizeUnits, baseDecimals, priceUnits);
  }

  private calculateLiquidationPriceUnits(
    side: FuturesSide,
    entryPriceUnits: bigint,
    leverage: number
  ): bigint {
    if (entryPriceUnits <= 0n) return 1n;
    const lev = BigInt(Math.max(1, Math.min(125, Math.round(leverage))));
    // Maintenance margin buffer = 50 bps (0.50%)
    const maintBuffer = (entryPriceUnits * 50n) / 10000n;

    if (side === 'LONG') {
      if (lev <= 1n) {
        return maintBuffer >= entryPriceUnits ? 1n : maintBuffer || 1n;
      }
      const raw = (entryPriceUnits * (lev - 1n)) / lev + maintBuffer;
      if (raw >= entryPriceUnits) return entryPriceUnits > 1n ? entryPriceUnits - 1n : 1n;
      return raw > 0n ? raw : 1n;
    } else {
      const raw = (entryPriceUnits * (lev + 1n)) / lev - maintBuffer;
      return raw > entryPriceUnits ? raw : entryPriceUnits + 1n;
    }
  }

  private computeUnrealizedPnl(pos: FuturesPosition, markUnits: bigint): {
    unrealizedPnlUnits: bigint;
    roePct: number;
  } {
    const size = BigInt(pos.sizeUnits);
    const entry = BigInt(pos.entryPriceUnits);
    const baseScale = 10n ** BigInt(pos.baseDecimals);
    const diff = pos.side === 'LONG' ? markUnits - entry : entry - markUnits;
    const pnlUnits = (size * diff) / baseScale;
    const margin = BigInt(pos.marginLockedUnits);
    const roePct =
      margin > 0n ? Number((pnlUnits * 10000n) / margin) / 100 : 0;
    return { unrealizedPnlUnits: pnlUnits, roePct };
  }

  public getFuturesMarkets() {
    const now = Date.now();
    const nextFundingTimestamp = this.getNext8hFundingTimestamp(now);
    const markets: any[] = [];

    for (const pair of db.tradingPairs.values()) {
      if (!pair.isActive) continue;
      const { baseDecimals, quoteDecimals } = this.resolvePairDecimals(pair);
      const { lastUnits, bestBidUnits, bestAskUnits } = this.getLiveBookPrices(pair);

      // Compute real orderbook basis/spread tilt for indicative 8h funding rate
      let fundingRatePct = 0.01;
      if (lastUnits > 0n && bestBidUnits > 0n && bestAskUnits > 0n) {
        const mid = (bestBidUnits + bestAskUnits) / 2n;
        const spreadBps = Number(((mid - lastUnits) * 10000n) / lastUnits);
        fundingRatePct = Number(Math.max(-0.075, Math.min(0.075, 0.01 + spreadBps * 0.0005)).toFixed(4));
      }

      let openInterestQuoteUnits = 0n;
      for (const pos of db.futuresPositions.values()) {
        if (pos.status === 'OPEN' && pos.pairId === pair.id) {
          openInterestQuoteUnits += this.calculateNotionalQuoteUnits(
            BigInt(pos.sizeUnits),
            baseDecimals,
            lastUnits > 0n ? lastUnits : BigInt(pos.entryPriceUnits)
          );
        }
      }

      markets.push({
        pairId: pair.id,
        baseCurrency: pair.baseCurrency,
        quoteCurrency: pair.quoteCurrency,
        baseDecimals,
        quoteDecimals,
        lastPrice: lastUnits.toString(),
        bestBid: bestBidUnits.toString(),
        bestAsk: bestAskUnits.toString(),
        high24h: pair.high24h || lastUnits.toString(),
        low24h: pair.low24h || lastUnits.toString(),
        volume24h: pair.volume24h || '0',
        priceChangePercent24h: pair.priceChangePercent24h || pair.priceChange24h || '0',
        minOrderSize: pair.minOrderSize,
        maxOrderSize: pair.maxOrderSize,
        makerFeeBps: pair.makerFeeBps,
        takerFeeBps: pair.takerFeeBps,
        fundingRatePct,
        nextFundingTimestamp,
        maxLeverage: 125,
        openInterestQuoteUnits: openInterestQuoteUnits.toString(),
      });
    }

    return markets;
  }

  public getUserFuturesState(userId: string) {
    const positions: FuturesPosition[] = [];
    const history: FuturesPosition[] = [];
    const openOrders: FuturesOrder[] = [];
    const orderHistory: FuturesOrder[] = [];

    for (const pos of db.futuresPositions.values()) {
      if (pos.userId !== userId) continue;
      if (pos.status === 'OPEN') {
        const pair = db.tradingPairs.get(pos.pairId);
        const markUnits = pair && pair.lastPrice ? BigInt(pair.lastPrice) : BigInt(pos.markPriceUnits);
        const { unrealizedPnlUnits, roePct } = this.computeUnrealizedPnl(pos, markUnits);
        pos.markPriceUnits = markUnits.toString();
        pos.unrealizedPnlUnits = unrealizedPnlUnits.toString();
        pos.roePct = roePct;
        positions.push({ ...pos });
      } else {
        history.push({ ...pos });
      }
    }

    for (const ord of db.futuresOrders.values()) {
      if (ord.userId !== userId) continue;
      if (ord.status === 'OPEN') {
        openOrders.push({ ...ord });
      } else {
        orderHistory.push({ ...ord });
      }
    }

    positions.sort((a, b) => b.updatedAt - a.updatedAt);
    history.sort((a, b) => (b.closedAt || b.updatedAt) - (a.closedAt || a.updatedAt));
    openOrders.sort((a, b) => b.createdAt - a.createdAt);
    orderHistory.sort((a, b) => b.updatedAt - a.updatedAt);

    return {
      positions,
      history: history.slice(0, 100),
      openOrders,
      orderHistory: orderHistory.slice(0, 100),
    };
  }

  public placeOrder(input: PlaceFuturesOrderInput): {
    order: FuturesOrder;
    position?: FuturesPosition;
    executedImmediately: boolean;
  } {
    const user = db.users.get(input.userId);
    if (!user || user.status !== 'active') {
      throw new Error('Akun tidak aktif atau tidak ditemukan.');
    }

    const pair = db.tradingPairs.get(input.pairId);
    if (!pair || !pair.isActive || pair.isHalted) {
      throw new Error(`Market Futures ${input.pairId} tidak tersedia atau sedang di-halt.`);
    }

    const leverage = Math.round(Number(input.leverage));
    if (!Number.isFinite(leverage) || leverage < 1 || leverage > 125) {
      throw new Error('Leverage harus antara 1x hingga 125x.');
    }

    const { baseDecimals, quoteDecimals } = this.resolvePairDecimals(pair);
    const sizeUnits = PrecisionMath.parseToUnits(input.quantity, baseDecimals);
    if (sizeUnits <= 0n) {
      throw new Error('Jumlah kontrak/size harus lebih besar dari 0.');
    }

    const minSize = BigInt(pair.minOrderSize || '1');
    const maxSize = BigInt(pair.maxOrderSize || '0');
    if (sizeUnits < minSize) {
      throw new Error(
        `Ukuran minimal untuk ${pair.id} adalah ${PrecisionMath.formatFromUnits(minSize, baseDecimals)} ${pair.baseCurrency}.`
      );
    }
    if (maxSize > 0n && sizeUnits > maxSize) {
      throw new Error(
        `Ukuran maksimal untuk ${pair.id} adalah ${PrecisionMath.formatFromUnits(maxSize, baseDecimals)} ${pair.baseCurrency}.`
      );
    }

    const { lastUnits, bestBidUnits, bestAskUnits } = this.getLiveBookPrices(pair);
    const liveMarketEntryUnits =
      input.side === 'LONG'
        ? (bestAskUnits > 0n ? bestAskUnits : lastUnits)
        : (bestBidUnits > 0n ? bestBidUnits : lastUnits);

    if (liveMarketEntryUnits <= 0n) {
      throw new Error(`Harga pasar live untuk ${pair.id} belum tersedia.`);
    }

    let orderPriceUnits = liveMarketEntryUnits;
    if (input.orderType === 'LIMIT') {
      if (!input.limitPrice || !String(input.limitPrice).trim()) {
        throw new Error(`Harga limit (${pair.quoteCurrency}, ${quoteDecimals} desimal) wajib diisi.`);
      }
      orderPriceUnits = PrecisionMath.parseToUnits(input.limitPrice, quoteDecimals);
      if (orderPriceUnits <= 0n) {
        throw new Error('Harga limit harus lebih besar dari 0.');
      }
    }

    const notionalUnits = this.calculateNotionalQuoteUnits(sizeUnits, baseDecimals, orderPriceUnits);
    if (notionalUnits <= 0n) {
      throw new Error('Nilai posisi (notional) terlalu kecil untuk presisi pair ini.');
    }

    const levBig = BigInt(leverage);
    const marginRequiredUnits = (notionalUnits + levBig - 1n) / levBig;
    const feeBps = input.orderType === 'MARKET' ? pair.takerFeeBps : pair.makerFeeBps;
    const feeReservedUnits = PrecisionMath.calculateFee(notionalUnits, feeBps);
    const totalLockNeeded = marginRequiredUnits + feeReservedUnits;

    const quoteAcc = db.createOrGetAccount(user.id, pair.quoteCurrency);
    const availQuote = BigInt(quoteAcc.balanceAvailable);
    if (availQuote < totalLockNeeded) {
      throw new Error(
        `Saldo ${pair.quoteCurrency} tidak mencukupi. Butuh ${PrecisionMath.formatFromUnits(totalLockNeeded, quoteDecimals)} ${pair.quoteCurrency} (Margin + Fee), tersedia ${PrecisionMath.formatFromUnits(availQuote, quoteDecimals)} ${pair.quoteCurrency}.`
      );
    }

    // Lock margin + fee reservation atomically
    LedgerService.lockBalance(user.id, pair.quoteCurrency, totalLockNeeded);

    const now = Date.now();
    const order: FuturesOrder = {
      id: `ford-${crypto.randomUUID().slice(0, 8)}`,
      userId: user.id,
      pairId: pair.id,
      baseCurrency: pair.baseCurrency,
      quoteCurrency: pair.quoteCurrency,
      baseDecimals,
      quoteDecimals,
      side: input.side,
      orderType: input.orderType,
      marginMode: input.marginMode || 'CROSS',
      leverage,
      limitPriceUnits: orderPriceUnits.toString(),
      quantityUnits: sizeUnits.toString(),
      marginRequiredUnits: marginRequiredUnits.toString(),
      feeReservedUnits: feeReservedUnits.toString(),
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
    };

    const isMarketableLimit =
      input.orderType === 'LIMIT' &&
      ((input.side === 'LONG' && orderPriceUnits >= liveMarketEntryUnits) ||
        (input.side === 'SHORT' && orderPriceUnits <= liveMarketEntryUnits));

    if (input.orderType === 'MARKET' || isMarketableLimit) {
      const execPriceUnits = input.orderType === 'MARKET' ? liveMarketEntryUnits : orderPriceUnits;
      const position = this.fillOrderIntoPosition(order, execPriceUnits, pair);
      db.futuresOrders.set(order.id, order);
      db.scheduleSave();
      return { order, position, executedImmediately: true };
    }

    db.futuresOrders.set(order.id, order);
    db.scheduleSave();
    return { order, executedImmediately: false };
  }

  private fillOrderIntoPosition(
    order: FuturesOrder,
    execPriceUnits: bigint,
    pair: TradingPair
  ): FuturesPosition {
    const now = Date.now();
    const sizeUnits = BigInt(order.quantityUnits);
    const marginUnits = BigInt(order.marginRequiredUnits);
    const feeUnits = BigInt(order.feeReservedUnits);

    // Move fee from locked -> available -> fee collector atomically
    if (feeUnits > 0n) {
      const unlockedFee = LedgerService.unlockBalanceUpToLocked(order.userId, order.quoteCurrency, feeUnits);
      if (unlockedFee > 0n) {
        const userQuoteAcc = db.createOrGetAccount(order.userId, order.quoteCurrency);
        const sysFeeAcc = db.createOrGetAccount(SYSTEM_FEE_ID, order.quoteCurrency);
        LedgerService.executeJournal({
          idempotencyKey: `fut-open-fee-${order.id}`,
          txType: 'FUTURES_FEE',
          referenceId: order.id,
          description: `Futures open fee ${order.pairId} ${order.side}`,
          entries: [
            { accountId: userQuoteAcc.id, entryType: 'DEBIT', amount: unlockedFee },
            { accountId: sysFeeAcc.id, entryType: 'CREDIT', amount: unlockedFee },
          ],
        });
      }
    }

    // Check if an existing OPEN position exists for the same user + pair + side + marginMode to average/merge
    const existingPos = Array.from(db.futuresPositions.values()).find(
      (p) =>
        p.status === 'OPEN' &&
        p.userId === order.userId &&
        p.pairId === order.pairId &&
        p.side === order.side &&
        p.marginMode === order.marginMode
    );

    const markUnits = BigInt(pair.lastPrice || execPriceUnits.toString());

    let position: FuturesPosition;
    if (existingPos) {
      const oldSize = BigInt(existingPos.sizeUnits);
      const oldEntry = BigInt(existingPos.entryPriceUnits);
      const newSize = oldSize + sizeUnits;
      const weightedEntry = (oldSize * oldEntry + sizeUnits * execPriceUnits) / newSize;
      const newMargin = BigInt(existingPos.marginLockedUnits) + marginUnits;
      const newOpenFee = BigInt(existingPos.openFeeUnits) + feeUnits;

      // Recalculate effective leverage from notional / margin (bounded 1..125)
      const notional = this.calculateNotionalQuoteUnits(newSize, order.baseDecimals, weightedEntry);
      const effLev = newMargin > 0n ? Number(notional / newMargin) : order.leverage;
      const boundedLev = Math.max(1, Math.min(125, effLev || order.leverage));

      existingPos.sizeUnits = newSize.toString();
      existingPos.entryPriceUnits = weightedEntry.toString();
      existingPos.markPriceUnits = markUnits.toString();
      existingPos.leverage = boundedLev;
      existingPos.liqPriceUnits = this.calculateLiquidationPriceUnits(
        existingPos.side,
        weightedEntry,
        boundedLev
      ).toString();
      existingPos.marginLockedUnits = newMargin.toString();
      existingPos.openFeeUnits = newOpenFee.toString();
      const { unrealizedPnlUnits, roePct } = this.computeUnrealizedPnl(existingPos, markUnits);
      existingPos.unrealizedPnlUnits = unrealizedPnlUnits.toString();
      existingPos.roePct = roePct;
      existingPos.updatedAt = now;

      db.futuresPositions.set(existingPos.id, existingPos);
      position = existingPos;
    } else {
      const liqPriceUnits = this.calculateLiquidationPriceUnits(
        order.side,
        execPriceUnits,
        order.leverage
      );
      position = {
        id: `fpos-${crypto.randomUUID().slice(0, 8)}`,
        userId: order.userId,
        pairId: order.pairId,
        baseCurrency: order.baseCurrency,
        quoteCurrency: order.quoteCurrency,
        baseDecimals: order.baseDecimals,
        quoteDecimals: order.quoteDecimals,
        side: order.side,
        marginMode: order.marginMode,
        leverage: order.leverage,
        sizeUnits: sizeUnits.toString(),
        entryPriceUnits: execPriceUnits.toString(),
        markPriceUnits: markUnits.toString(),
        liqPriceUnits: liqPriceUnits.toString(),
        marginLockedUnits: marginUnits.toString(),
        openFeeUnits: feeUnits.toString(),
        unrealizedPnlUnits: '0',
        realizedPnlUnits: '0',
        roePct: 0,
        status: 'OPEN',
        openedAt: now,
        updatedAt: now,
      };
      const { unrealizedPnlUnits, roePct } = this.computeUnrealizedPnl(position, markUnits);
      position.unrealizedPnlUnits = unrealizedPnlUnits.toString();
      position.roePct = roePct;
      db.futuresPositions.set(position.id, position);
    }

    order.status = 'FILLED';
    order.filledAt = now;
    order.positionId = position.id;
    order.updatedAt = now;

    return position;
  }

  public cancelOrder(userId: string, orderId: string): FuturesOrder {
    const order = db.futuresOrders.get(orderId);
    if (!order) {
      throw new Error('Order Futures tidak ditemukan.');
    }
    if (order.userId !== userId) {
      throw new Error('Tidak memiliki izin untuk membatalkan order ini.');
    }
    if (order.status !== 'OPEN') {
      throw new Error(`Order tidak dapat dibatalkan (status: ${order.status}).`);
    }

    const lockedTotal = BigInt(order.marginRequiredUnits) + BigInt(order.feeReservedUnits);
    if (lockedTotal > 0n) {
      LedgerService.unlockBalanceUpToLocked(order.userId, order.quoteCurrency, lockedTotal);
    }

    order.status = 'CANCELLED';
    order.cancelledAt = Date.now();
    order.updatedAt = Date.now();
    db.futuresOrders.set(order.id, order);
    db.scheduleSave();
    return order;
  }

  public closePosition(userId: string, positionId: string, forceLiquidated = false): FuturesPosition {
    const pos = db.futuresPositions.get(positionId);
    if (!pos) {
      throw new Error('Posisi Futures tidak ditemukan.');
    }
    if (!forceLiquidated && pos.userId !== userId) {
      throw new Error('Tidak memiliki izin untuk menutup posisi ini.');
    }
    if (pos.status !== 'OPEN') {
      throw new Error(`Posisi sudah ditutup (status: ${pos.status}).`);
    }

    const pair = db.tradingPairs.get(pos.pairId);
    const { lastUnits, bestBidUnits, bestAskUnits } = pair
      ? this.getLiveBookPrices(pair)
      : {
          lastUnits: BigInt(pos.markPriceUnits),
          bestBidUnits: BigInt(pos.markPriceUnits),
          bestAskUnits: BigInt(pos.markPriceUnits),
        };

    const closePriceUnits = forceLiquidated
      ? BigInt(pos.markPriceUnits || lastUnits.toString())
      : pos.side === 'LONG'
      ? (bestBidUnits > 0n ? bestBidUnits : lastUnits)
      : (bestAskUnits > 0n ? bestAskUnits : lastUnits);

    const sizeUnits = BigInt(pos.sizeUnits);
    const marginUnits = BigInt(pos.marginLockedUnits);
    const { unrealizedPnlUnits: rawPnlUnits } = this.computeUnrealizedPnl(pos, closePriceUnits);

    // Unlock locked margin back to available balance first
    LedgerService.unlockBalanceUpToLocked(pos.userId, pos.quoteCurrency, marginUnits);

    const userQuoteAcc = db.createOrGetAccount(pos.userId, pos.quoteCurrency);
    const treasuryAcc = db.createOrGetAccount(SYSTEM_TREASURY_ID, pos.quoteCurrency);
    const sysFeeAcc = db.createOrGetAccount(SYSTEM_FEE_ID, pos.quoteCurrency);

    let effectiveRealizedPnl = rawPnlUnits;

    if (forceLiquidated) {
      // Liquidation forfeits locked margin to system treasury/insurance fund
      const availNow = BigInt(userQuoteAcc.balanceAvailable);
      const forfeit = marginUnits > availNow ? availNow : marginUnits;
      if (forfeit > 0n) {
        LedgerService.executeJournal({
          idempotencyKey: `fut-liq-${pos.id}`,
          txType: 'FUTURES_PNL',
          referenceId: pos.id,
          description: `Futures liquidation settlement ${pos.pairId} ${pos.side}`,
          entries: [
            { accountId: userQuoteAcc.id, entryType: 'DEBIT', amount: forfeit },
            { accountId: treasuryAcc.id, entryType: 'CREDIT', amount: forfeit },
          ],
        });
      }
      effectiveRealizedPnl = -forfeit;
      pos.closeFeeUnits = '0';
      pos.status = 'LIQUIDATED';
    } else {
      // Settle positive or negative PnL
      if (rawPnlUnits > 0n) {
        LedgerService.executeJournal({
          idempotencyKey: `fut-pnl-${pos.id}`,
          txType: 'FUTURES_PNL',
          referenceId: pos.id,
          description: `Futures profit settlement ${pos.pairId} ${pos.side}`,
          entries: [
            { accountId: treasuryAcc.id, entryType: 'DEBIT', amount: rawPnlUnits },
            { accountId: userQuoteAcc.id, entryType: 'CREDIT', amount: rawPnlUnits },
          ],
        });
      } else if (rawPnlUnits < 0n) {
        const lossAbs = -rawPnlUnits;
        const availNow = BigInt(userQuoteAcc.balanceAvailable);
        const maxDebit = pos.marginMode === 'ISOLATED' ? (marginUnits < availNow ? marginUnits : availNow) : availNow;
        const debitAmount = lossAbs > maxDebit ? maxDebit : lossAbs;
        if (debitAmount > 0n) {
          LedgerService.executeJournal({
            idempotencyKey: `fut-pnl-${pos.id}`,
            txType: 'FUTURES_PNL',
            referenceId: pos.id,
            description: `Futures loss settlement ${pos.pairId} ${pos.side}`,
            entries: [
              { accountId: userQuoteAcc.id, entryType: 'DEBIT', amount: debitAmount },
              { accountId: treasuryAcc.id, entryType: 'CREDIT', amount: debitAmount },
            ],
          });
        }
        effectiveRealizedPnl = -debitAmount;
      }

      // Charge closing taker fee (capped safely so balanceAvailable never turns negative)
      const closeNotional = this.calculateNotionalQuoteUnits(sizeUnits, pos.baseDecimals, closePriceUnits);
      const takerFeeBps = pair?.takerFeeBps ?? 20;
      const calcCloseFee = PrecisionMath.calculateFee(closeNotional, takerFeeBps);
      const freshUserAvail = BigInt(db.createOrGetAccount(pos.userId, pos.quoteCurrency).balanceAvailable);
      const closeFee = calcCloseFee > freshUserAvail ? freshUserAvail : calcCloseFee;
      if (closeFee > 0n) {
        LedgerService.executeJournal({
          idempotencyKey: `fut-close-fee-${pos.id}`,
          txType: 'FUTURES_FEE',
          referenceId: pos.id,
          description: `Futures close fee ${pos.pairId} ${pos.side}`,
          entries: [
            { accountId: userQuoteAcc.id, entryType: 'DEBIT', amount: closeFee },
            { accountId: sysFeeAcc.id, entryType: 'CREDIT', amount: closeFee },
          ],
        });
      }
      pos.closeFeeUnits = closeFee.toString();
      pos.status = 'CLOSED';
    }

    const now = Date.now();
    pos.markPriceUnits = closePriceUnits.toString();
    pos.unrealizedPnlUnits = '0';
    pos.realizedPnlUnits = effectiveRealizedPnl.toString();
    pos.roePct =
      marginUnits > 0n ? Number((effectiveRealizedPnl * 10000n) / marginUnits) / 100 : 0;
    pos.closedAt = now;
    pos.updatedAt = now;

    db.futuresPositions.set(pos.id, pos);
    db.scheduleSave();
    return pos;
  }

  public evaluateMarkAndOrders() {
    if (this.isTicking) return;
    this.isTicking = true;
    try {
      // 1. Evaluate resting LIMIT orders against live market prices
      for (const ord of db.futuresOrders.values()) {
        if (ord.status !== 'OPEN') continue;
        const pair = db.tradingPairs.get(ord.pairId);
        if (!pair || pair.isHalted || !pair.isActive) continue;

        const { lastUnits, bestBidUnits, bestAskUnits } = this.getLiveBookPrices(pair);
        const liveRef =
          ord.side === 'LONG'
            ? (bestAskUnits > 0n ? bestAskUnits : lastUnits)
            : (bestBidUnits > 0n ? bestBidUnits : lastUnits);
        if (liveRef <= 0n) continue;

        const limitUnits = BigInt(ord.limitPriceUnits);
        const shouldFill =
          (ord.side === 'LONG' && liveRef <= limitUnits) ||
          (ord.side === 'SHORT' && liveRef >= limitUnits);

        if (shouldFill) {
          this.fillOrderIntoPosition(ord, limitUnits, pair);
          db.futuresOrders.set(ord.id, ord);
          db.scheduleSave();
          marketWsService.broadcast('ticker', {
            type: 'futures_update',
            userId: ord.userId,
            pairId: ord.pairId,
          });
        }
      }

      // 2. Check open positions for mark price & liquidation threshold breach
      for (const pos of db.futuresPositions.values()) {
        if (pos.status !== 'OPEN') continue;
        const pair = db.tradingPairs.get(pos.pairId);
        if (!pair || !pair.lastPrice) continue;

        const markUnits = BigInt(pair.lastPrice);
        const liqUnits = BigInt(pos.liqPriceUnits);
        pos.markPriceUnits = markUnits.toString();

        const isLiquidated =
          (pos.side === 'LONG' && markUnits <= liqUnits) ||
          (pos.side === 'SHORT' && markUnits >= liqUnits);

        if (isLiquidated) {
          this.closePosition(pos.userId, pos.id, true);
          marketWsService.broadcast('ticker', {
            type: 'futures_update',
            userId: pos.userId,
            pairId: pos.pairId,
          });
        } else {
          const { unrealizedPnlUnits, roePct } = this.computeUnrealizedPnl(pos, markUnits);
          pos.unrealizedPnlUnits = unrealizedPnlUnits.toString();
          pos.roePct = roePct;
          db.futuresPositions.set(pos.id, pos);
        }
      }
    } catch (err) {
      console.error('[FuturesEngine] Evaluation loop error:', err);
    } finally {
      this.isTicking = false;
    }
  }
}

export const futuresEngine = new FuturesEngineService();
