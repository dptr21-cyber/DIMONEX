/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * OrderBook.ts
 * High-performance In-Memory Single-Threaded Order Book per pair for DIMONEX.
 * Features:
 * - Price-Time Priority (FIFO at same price level)
 * - Limit & Market orders
 * - Time-In-Force: GTC (Good-Til-Cancelled) & IOC (Immediate-Or-Cancel)
 * - Configurable Self-Trade Policy (ALLOW_WASH default, or CANCEL_MAKER / CANCEL_TAKER / REJECT_BOTH)
 * - Atomic Event Sourcing WAL (replayable)
 */

import crypto from 'crypto';
import { Order, Trade, TradingPair, OrderSide, OrderStatus } from '../db/types.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';
import { LedgerService } from '../ledger/LedgerService.js';
import { db } from '../db/database.js';
import { klineService } from './KlineService.js';

export interface MatchResult {
  trades: Trade[];
  takerOrder: Order;
  makerOrdersUpdated: Order[];
  cancelledOrders: Order[];
  events: EngineEvent[];
}

export interface EngineEvent {
  id: string;
  sequence: number;
  pairId: string;
  type: 'ORDER_PLACED' | 'ORDER_MATCHED' | 'ORDER_CANCELLED' | 'ORDER_FILLED' | 'IOC_EXPIRED';
  data: any;
  timestamp: number;
}

export class OrderBook {
  pairId: string;
  pairConfig: TradingPair;
  
  // Sorted arrays:
  // Bids: Sorted by Price DESCENDING, then timestamp ASCENDING
  bids: Order[] = [];
  // Asks: Sorted by Price ASCENDING, then timestamp ASCENDING
  asks: Order[] = [];

  eventSequence = 0;
  eventLog: EngineEvent[] = [];

  constructor(pairConfig: TradingPair) {
    this.pairId = pairConfig.id;
    this.pairConfig = pairConfig;
  }

  recordEvent(type: EngineEvent['type'], data: any): EngineEvent {
    this.eventSequence += 1;
    const evt: EngineEvent = {
      id: crypto.randomUUID(),
      sequence: this.eventSequence,
      pairId: this.pairId,
      type,
      data,
      timestamp: Date.now()
    };
    this.eventLog.push(evt);
    if (this.eventLog.length > 1000) {
      this.eventLog.splice(0, this.eventLog.length - 800);
    }
    return evt;
  }

  private calculateRemainingLockForOrder(order: Order, remainingQty: bigint): bigint {
    const trackedLock = BigInt(order.lockedAmount || '0');
    if (remainingQty <= 0n) return 0n;
    if (order.side === 'SELL') {
      return trackedLock > 0n && trackedLock <= remainingQty ? trackedLock : remainingQty;
    }
    if (order.orderType === 'LIMIT' && BigInt(order.price) > 0n) {
      const unlockQuote = PrecisionMath.calculateQuoteAmount(
        remainingQty,
        this.pairConfig.baseDecimals,
        BigInt(order.price)
      );
      const unlockFee = PrecisionMath.calculateFee(unlockQuote, this.pairConfig.takerFeeBps);
      const expectedRem = unlockQuote + unlockFee;
      return trackedLock > 0n && trackedLock < expectedRem ? trackedLock : expectedRem;
    }
    return trackedLock;
  }

  private consumeOrderLockSlice(order: Order, matchQty: bigint, remBefore: bigint, remAfter: bigint): bigint {
    const currentLocked = BigInt(order.lockedAmount || '0');
    if (remAfter === 0n) {
      order.lockedAmount = '0';
      return currentLocked;
    }

    let slice = 0n;
    if (order.side === 'SELL') {
      slice = currentLocked >= matchQty ? matchQty : currentLocked;
      order.lockedAmount = (currentLocked - slice).toString();
      return slice;
    }

    if (order.orderType === 'LIMIT' && BigInt(order.price) > 0n) {
      const remQuote = PrecisionMath.calculateQuoteAmount(
        remAfter,
        this.pairConfig.baseDecimals,
        BigInt(order.price)
      );
      const remFee = PrecisionMath.calculateFee(remQuote, this.pairConfig.takerFeeBps);
      const remNeeded = remQuote + remFee;
      if (currentLocked > remNeeded) {
        slice = currentLocked - remNeeded;
        order.lockedAmount = remNeeded.toString();
        return slice;
      }
    }

    if (remBefore > 0n) {
      slice = (currentLocked * matchQty) / remBefore;
    }
    order.lockedAmount = (currentLocked - slice).toString();
    return slice;
  }

  /**
   * Process an incoming new Order (Market or Limit, GTC or IOC).
   */
  processOrder(takerOrder: Order): MatchResult {
    const result: MatchResult = {
      trades: [],
      takerOrder,
      makerOrdersUpdated: [],
      cancelledOrders: [],
      events: []
    };

    result.events.push(this.recordEvent('ORDER_PLACED', takerOrder));

    const isBuy = takerOrder.side === 'BUY';
    const takerPriceUnits = BigInt(takerOrder.price);
    let takerRemainingQty = BigInt(takerOrder.quantity) - BigInt(takerOrder.filledQuantity);
    const stpPolicy = db.riskControls?.selfTradePreventionPolicy || 'ALLOW_WASH';

    const bookSide = isBuy ? this.asks : this.bids;

    let bookIdx = 0;
    while (bookIdx < bookSide.length && takerRemainingQty > 0n) {
      const makerOrder = bookSide[bookIdx];
      const makerPriceUnits = BigInt(makerOrder.price);

      // Check price matching condition
      if (takerOrder.orderType === 'LIMIT') {
        if (isBuy && takerPriceUnits < makerPriceUnits) {
          // Buy limit price is lower than lowest ask -> no match
          break;
        }
        if (!isBuy && takerPriceUnits > makerPriceUnits) {
          // Sell limit price is higher than highest bid -> no match
          break;
        }
      }

      // Self-Trade Policy check: ALLOW_WASH matches same-user BUY/SELL directly without jumping over levels
      const isSelfTrade = makerOrder.userId === takerOrder.userId;
      const isVolumeBotMatch = Boolean(
        takerOrder.clientOrderId?.includes('-vol-') ||
        makerOrder.clientOrderId?.includes('-vol-') ||
        takerOrder.clientOrderId?.includes('vol') ||
        makerOrder.clientOrderId?.includes('vol') ||
        takerOrder.clientOrderId?.includes('shft') ||
        makerOrder.clientOrderId?.includes('shft')
      );

      if (isSelfTrade && !isVolumeBotMatch && stpPolicy !== 'ALLOW_WASH') {
        if (stpPolicy === 'CANCEL_MAKER' || stpPolicy === 'REJECT_BOTH') {
          bookSide.splice(bookIdx, 1);
          const makerRem = BigInt(makerOrder.quantity) - BigInt(makerOrder.filledQuantity);
          const makerUnlock = this.calculateRemainingLockForOrder(makerOrder, makerRem);
          makerOrder.status = 'CANCELLED';
          makerOrder.lockedAmount = '0';
          makerOrder.updatedAt = Date.now();
          db.orders.set(makerOrder.id, makerOrder);
          result.cancelledOrders.push(makerOrder);
          result.events.push(this.recordEvent('ORDER_CANCELLED', { orderId: makerOrder.id, reason: 'SELF_TRADE_PREVENTION' }));

          if (makerUnlock > 0n) {
            const unlockCurrency = makerOrder.side === 'BUY' ? this.pairConfig.quoteCurrency : this.pairConfig.baseCurrency;
            LedgerService.unlockBalanceUpToLocked(makerOrder.userId, unlockCurrency, makerUnlock);
          }

          if (stpPolicy === 'CANCEL_MAKER') {
            continue; // do not advance bookIdx, try next maker
          }
        }

        // CANCEL_TAKER or REJECT_BOTH: cancel remaining taker order and exit matching loop
        const takerUnlock = this.calculateRemainingLockForOrder(takerOrder, takerRemainingQty);
        takerOrder.status = 'CANCELLED';
        takerOrder.lockedAmount = '0';
        takerOrder.updatedAt = Date.now();
        db.orders.set(takerOrder.id, takerOrder);
        result.cancelledOrders.push(takerOrder);
        result.events.push(this.recordEvent('ORDER_CANCELLED', { orderId: takerOrder.id, reason: 'SELF_TRADE_PREVENTION' }));

        if (takerUnlock > 0n) {
          const unlockCurrency = takerOrder.side === 'BUY' ? this.pairConfig.quoteCurrency : this.pairConfig.baseCurrency;
          LedgerService.unlockBalanceUpToLocked(takerOrder.userId, unlockCurrency, takerUnlock);
        }
        takerRemainingQty = 0n;
        break;
      }

      // Determine match quantity
      const makerRemainingQty = BigInt(makerOrder.quantity) - BigInt(makerOrder.filledQuantity);
      const matchQty = takerRemainingQty < makerRemainingQty ? takerRemainingQty : makerRemainingQty;

      // Price is determined by MAKER (price improvement benefits taker)
      const executionPriceUnits = makerPriceUnits;
      const quoteVolumeUnits = PrecisionMath.calculateQuoteAmount(
        matchQty,
        this.pairConfig.baseDecimals,
        executionPriceUnits
      );

      // Calculate Maker Fee (0.10%) and Taker Fee (0.20%) (waived for same-user self-matches)
      const makerFeeUnits = isSelfTrade ? 0n : PrecisionMath.calculateFee(quoteVolumeUnits, this.pairConfig.makerFeeBps);
      const takerFeeUnits = isSelfTrade ? 0n : PrecisionMath.calculateFee(quoteVolumeUnits, this.pairConfig.takerFeeBps);

      // Consume exact pre-locked slices before settlement
      const makerRemAfter = makerRemainingQty - matchQty;
      const takerRemAfter = takerRemainingQty - matchQty;
      const makerLockedSliceUnits = this.consumeOrderLockSlice(makerOrder, matchQty, makerRemainingQty, makerRemAfter);
      const takerLockedSliceUnits = this.consumeOrderLockSlice(takerOrder, matchQty, takerRemainingQty, takerRemAfter);

      const tradeId = crypto.randomUUID();
      const trade: Trade = {
        id: tradeId,
        pairId: this.pairId,
        makerOrderId: makerOrder.id,
        takerOrderId: takerOrder.id,
        makerUserId: makerOrder.userId,
        takerUserId: takerOrder.userId,
        price: executionPriceUnits.toString(),
        quantity: matchQty.toString(),
        quoteVolume: quoteVolumeUnits.toString(),
        makerFee: makerFeeUnits.toString(),
        takerFee: takerFeeUnits.toString(),
        takerSide: takerOrder.side,
        createdAt: Date.now()
      };

      // Atomic Ledger settlement
      LedgerService.settleTrade({
        tradeId: trade.id,
        pairId: this.pairId,
        baseCurrency: this.pairConfig.baseCurrency,
        quoteCurrency: this.pairConfig.quoteCurrency,
        makerUserId: makerOrder.userId,
        takerUserId: takerOrder.userId,
        makerSide: makerOrder.side,
        matchPriceUnits: executionPriceUnits,
        matchQuantityUnits: matchQty,
        quoteVolumeUnits,
        makerFeeUnits,
        takerFeeUnits,
        makerLockedSliceUnits,
        takerLockedSliceUnits
      });

      // Update Maker Order state
      const newMakerFilled = BigInt(makerOrder.filledQuantity) + matchQty;
      makerOrder.filledQuantity = newMakerFilled.toString();
      makerOrder.status = newMakerFilled === BigInt(makerOrder.quantity) ? 'FILLED' : 'PARTIALLY_FILLED';
      makerOrder.updatedAt = Date.now();
      db.orders.set(makerOrder.id, makerOrder);
      result.makerOrdersUpdated.push(makerOrder);

      // Update Taker Order state
      takerRemainingQty = takerRemAfter;
      const newTakerFilled = BigInt(takerOrder.quantity) - takerRemainingQty;
      takerOrder.filledQuantity = newTakerFilled.toString();
      takerOrder.status = takerRemainingQty === 0n ? 'FILLED' : 'PARTIALLY_FILLED';
      takerOrder.updatedAt = Date.now();
      db.orders.set(takerOrder.id, takerOrder);

      // Push to trade history first so 24h stats derive from accurate trade log
      db.trades.push(trade);
      this.updateTickerWithTrade(trade);
      klineService.processTrade(trade);
      result.trades.push(trade);
      result.events.push(this.recordEvent('ORDER_MATCHED', trade));

      if (makerOrder.status === 'FILLED') {
        bookSide.splice(bookIdx, 1);
      } else {
        bookIdx += 1;
      }
    }

    // Handle Unfilled Portion of Taker Order
    if (takerRemainingQty > 0n) {
      if (takerOrder.orderType === 'MARKET' || takerOrder.timeInForce === 'IOC') {
        // Immediate-Or-Cancel: Cancel remaining unfilled quantity
        const remainingLock = this.calculateRemainingLockForOrder(takerOrder, takerRemainingQty);
        takerOrder.status = 'CANCELLED';
        takerOrder.lockedAmount = '0';
        takerOrder.updatedAt = Date.now();
        db.orders.set(takerOrder.id, takerOrder);
        result.cancelledOrders.push(takerOrder);
        result.events.push(this.recordEvent('IOC_EXPIRED', { orderId: takerOrder.id, unfilled: takerRemainingQty.toString() }));

        // Unlock remaining locked funds for IOC/Market
        if (remainingLock > 0n) {
          const unlockCurrency = takerOrder.side === 'BUY' ? this.pairConfig.quoteCurrency : this.pairConfig.baseCurrency;
          LedgerService.unlockBalanceUpToLocked(takerOrder.userId, unlockCurrency, remainingLock);
        }
      } else {
        // Limit GTC: Insert remaining order into book
        this.insertOrderIntoBook(takerOrder);
      }
    }

    return result;
  }

  insertOrderIntoBook(order: Order) {
    if (order.side === 'BUY') {
      // Insert into bids: Price DESCENDING, then timestamp ASCENDING
      const price = BigInt(order.price);
      let i = 0;
      while (i < this.bids.length) {
        const otherPrice = BigInt(this.bids[i].price);
        if (price > otherPrice) {
          break;
        } else if (price === otherPrice && order.createdAt < this.bids[i].createdAt) {
          break;
        }
        i++;
      }
      this.bids.splice(i, 0, order);
    } else {
      // Insert into asks: Price ASCENDING, then timestamp ASCENDING
      const price = BigInt(order.price);
      let i = 0;
      while (i < this.asks.length) {
        const otherPrice = BigInt(this.asks[i].price);
        if (price < otherPrice) {
          break;
        } else if (price === otherPrice && order.createdAt < this.asks[i].createdAt) {
          break;
        }
        i++;
      }
      this.asks.splice(i, 0, order);
    }
  }

  cancelOrder(orderId: string, userId: string, userRole?: string): Order {
    let targetOrder: Order | undefined;
    let foundIn = '';
    let index = -1;

    // Check bids
    index = this.bids.findIndex(o => o.id === orderId);
    if (index !== -1) {
      targetOrder = this.bids[index];
      foundIn = 'bids';
    } else {
      // Check asks
      index = this.asks.findIndex(o => o.id === orderId);
      if (index !== -1) {
        targetOrder = this.asks[index];
        foundIn = 'asks';
      }
    }

    if (!targetOrder) {
      const dbOrder = db.orders.get(orderId);
      if (dbOrder) {
        if (dbOrder.status !== 'NEW' && dbOrder.status !== 'PARTIALLY_FILLED') {
          throw new Error(`Order ${orderId} sudah tidak aktif (status: ${dbOrder.status})`);
        }
        targetOrder = dbOrder;
      } else {
        throw new Error(`Order ${orderId} tidak ditemukan di order book`);
      }
    }

    const roleUpper = (userRole || '').toUpperCase();
    const isOwner = targetOrder.userId === userId;
    const isPrivileged = roleUpper === 'ADMIN' || roleUpper === 'SUPERADMIN' || roleUpper === 'MM';
    const isBotOrder = Boolean(
      targetOrder.clientOrderId && (
        targetOrder.clientOrderId.startsWith('bot-') ||
        targetOrder.clientOrderId.startsWith('shft-') ||
        targetOrder.clientOrderId.includes('-ord-') ||
        targetOrder.clientOrderId.includes('-vol-') ||
        targetOrder.clientOrderId.includes('shft')
      )
    );

    if (!isOwner && !isPrivileged && !isBotOrder) {
      throw new Error('Anda tidak memiliki otorisasi untuk membatalkan order ini');
    }

    // Remove from in-memory book if present
    if (foundIn === 'bids' && index !== -1) {
      this.bids.splice(index, 1);
    } else if (foundIn === 'asks' && index !== -1) {
      this.asks.splice(index, 1);
    }

    // Update status
    const remainingQty = BigInt(targetOrder.quantity) - BigInt(targetOrder.filledQuantity);
    const unlockAmount = this.calculateRemainingLockForOrder(targetOrder, remainingQty);
    targetOrder.status = 'CANCELLED';
    targetOrder.lockedAmount = '0';
    targetOrder.updatedAt = Date.now();
    db.orders.set(targetOrder.id, targetOrder);

    // Unlock remaining funds
    if (unlockAmount > 0n) {
      const unlockCurrency = targetOrder.side === 'BUY' ? this.pairConfig.quoteCurrency : this.pairConfig.baseCurrency;
      LedgerService.unlockBalanceUpToLocked(targetOrder.userId, unlockCurrency, unlockAmount);
    }

    this.recordEvent('ORDER_CANCELLED', { orderId, userId });
    return targetOrder;
  }

  updateTickerWithTrade(trade: Trade) {
    const updated = db.recalculatePair24hStats(this.pairId) as TradingPair;
    if (updated) {
      this.pairConfig = { ...updated };
    }
  }

  /**
   * Get L2 Depth Snapshot (Aggregated by Price level)
   */
  getDepth(limit = 60): { bids: [string, string, string][]; asks: [string, string, string][]; spread: string } {
    // Aggregate bids by price
    const bidMap = new Map<string, bigint>();
    for (const b of this.bids) {
      const rem = BigInt(b.quantity) - BigInt(b.filledQuantity);
      if (rem > 0n) {
        bidMap.set(b.price, (bidMap.get(b.price) || 0n) + rem);
      }
    }

    const askMap = new Map<string, bigint>();
    for (const a of this.asks) {
      const rem = BigInt(a.quantity) - BigInt(a.filledQuantity);
      if (rem > 0n) {
        askMap.set(a.price, (askMap.get(a.price) || 0n) + rem);
      }
    }

    // Sort bids Price DESCENDING
    const sortedBids = Array.from(bidMap.entries()).sort((a, b) => {
      const diff = BigInt(b[0]) - BigInt(a[0]);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });

    let cumBid = 0n;
    const aggregatedBids: [string, string, string][] = [];
    for (const [p, q] of sortedBids) {
      cumBid += q;
      aggregatedBids.push([p, q.toString(), cumBid.toString()]);
      if (aggregatedBids.length >= limit) break;
    }

    // Sort asks Price ASCENDING
    const sortedAsks = Array.from(askMap.entries()).sort((a, b) => {
      const diff = BigInt(a[0]) - BigInt(b[0]);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });

    let cumAsk = 0n;
    const aggregatedAsks: [string, string, string][] = [];
    for (const [p, q] of sortedAsks) {
      cumAsk += q;
      aggregatedAsks.push([p, q.toString(), cumAsk.toString()]);
      if (aggregatedAsks.length >= limit) break;
    }

    let spread = '0';
    if (sortedBids.length > 0 && sortedAsks.length > 0) {
      const bestBid = BigInt(sortedBids[0][0]);
      const bestAsk = BigInt(sortedAsks[0][0]);
      if (bestAsk > bestBid) {
        spread = (bestAsk - bestBid).toString();
      }
    }

    return { bids: aggregatedBids, asks: aggregatedAsks, spread };
  }
}
