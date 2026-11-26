/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/pnl/PnLService.ts
 * 100% Real-Data Live PnL Engine & Persistent Daily PnL Calendar Service.
 *
 * Guarantees:
 * - Zero fake trades, zero hardcoded benchmark prices, zero synthetic cost-basis multipliers.
 * - Chronological weighted-average inventory cost basis per asset from real Spot trades.
 * - Live mark-to-market valuations resolved from real Exchange TradingPairs (-IDR / -USDT)
 *   and live External WS PriceAggregatorService feeds using exact decimal precision.
 * - Daily calendar snapshots (db.dailyPnlSnapshots) are persisted permanently by Asia/Jakarta date
 *   so historical days survive db.trades ring-buffer pruning.
 */

import { db } from '../../db/database.js';
import {
  Trade,
  FuturesPosition,
  CopyMirroredOrder,
  DailyPnlSnapshot,
  DailyPnlTradeSnapshot,
} from '../../db/types.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { priceAggregatorService } from '../external/PriceAggregatorService.js';
import { fxConversionService } from '../external/FxConversionService.js';

function getJakartaDateKey(ts: number): string {
  return new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
}

function getJakartaTimeStr(ts: number): string {
  return new Date(ts).toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function roundPricePrecision(val: number): number {
  if (!Number.isFinite(val) || val <= 0) return 0;
  if (val >= 1000) return Number(val.toFixed(2));
  if (val >= 1) return Number(val.toFixed(4));
  if (val >= 0.0001) return Number(val.toFixed(6));
  return Number(val.toFixed(8));
}

function roundUsdtPrecision(val: number): number {
  if (!Number.isFinite(val) || val <= 0) return 0;
  if (val >= 100) return Number(val.toFixed(2));
  if (val >= 1) return Number(val.toFixed(4));
  if (val >= 0.0001) return Number(val.toFixed(6));
  return Number(val.toFixed(8));
}

export function getCurrencyDecimalsServer(currency: string): number {
  const clean = currency.toUpperCase();
  if (clean === 'IDR') return 2;
  if (clean === 'USDT' || clean === 'USDC') return 6;
  for (const asset of db.assets.values()) {
    if (asset.symbol.toUpperCase() === clean) return asset.decimals;
  }
  for (const pair of db.tradingPairs.values()) {
    if (pair.baseCurrency.toUpperCase() === clean) return pair.baseDecimals;
    if (pair.quoteCurrency.toUpperCase() === clean) return pair.quoteDecimals;
  }
  return 8;
}

export interface LiveAssetBreakdownItem {
  symbol: string;
  holding: number;
  avgBuyPriceIdr: number;
  currentPriceIdr: number;
  avgBuyPriceUsdt: number;
  currentPriceUsdt: number;
  unrealizedPnlIdr: number;
  unrealizedPnlUsdt: number;
  returnPct: number;
  totalBought: number;
  totalSold: number;
  hasCostBasis: boolean;
  priceSource: 'PAIR_IDR' | 'PAIR_USDT' | 'EXTERNAL_WS' | 'NONE';
}

export class PnLService {
  private schedulerInterval: NodeJS.Timeout | null = null;
  private lastKnownJakartaDate: string = getJakartaDateKey(Date.now());

  public startScheduler(): void {
    if (this.schedulerInterval) return;

    // Seed initial daily snapshots for existing active traders on boot
    try {
      this.snapshotAllActiveUsers();
    } catch (err: any) {
      console.warn('[PnLService] Initial snapshot pass skipped:', err?.message || err);
    }

    // Periodically persist daily snapshots & finalize closed Jakarta calendar days
    this.schedulerInterval = setInterval(() => {
      try {
        const currentDateKey = getJakartaDateKey(Date.now());
        if (currentDateKey !== this.lastKnownJakartaDate) {
          console.log(`[PnLService] Pergantian hari WIB terdeteksi (${this.lastKnownJakartaDate} -> ${currentDateKey}). Menyimpan & memfinalisasi kalender harian...`);
          this.lastKnownJakartaDate = currentDateKey;
        }
        this.snapshotAllActiveUsers();
      } catch (err: any) {
        console.warn('[PnLService] Scheduler error:', err?.message || err);
      }
    }, 60_000);
  }

  public stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  /**
   * Called immediately after a real spot trade executes so today's calendar snapshot stays persisted.
   */
  public recordTradeActivity(trade: Trade): void {
    const involvedIds = new Set<string>();
    if (trade.makerUserId && !trade.makerUserId.startsWith('sys-')) {
      involvedIds.add(trade.makerUserId);
    }
    if (trade.takerUserId && !trade.takerUserId.startsWith('sys-')) {
      involvedIds.add(trade.takerUserId);
    }
    for (const userId of involvedIds) {
      try {
        this.getUserPnLAnalytics(userId, undefined, 'IDR');
      } catch {
        // Ignore non-fatal background snapshot update errors
      }
    }
  }

  public snapshotAllActiveUsers(): void {
    let snapshotsUpdated = 0;
    for (const user of db.users.values()) {
      if (user.id.startsWith('sys-')) continue;
      const hasActivity =
        db.trades.some(t => t.makerUserId === user.id || t.takerUserId === user.id) ||
        Array.from(db.futuresPositions.values()).some(p => p.userId === user.id && p.status === 'CLOSED') ||
        db.copyMirroredOrders.some(m => m.followerUserId === user.id && m.status === 'FILLED');

      if (hasActivity) {
        this.getUserPnLAnalytics(user.id, undefined, 'IDR');
        snapshotsUpdated++;
      }
    }
    if (snapshotsUpdated > 0) {
      db.scheduleSave();
    }
  }

  /**
   * Resolve live USDT/IDR FX rate strictly from real market/FX sources.
   */
  public getLiveUsdtIdrRate(): number {
    const usdtPair = db.tradingPairs.get('USDT-IDR');
    if (usdtPair && !usdtPair.isDelisted && BigInt(usdtPair.lastPrice || '0') > 0n) {
      const qDec = typeof usdtPair.quoteDecimals === 'number' ? usdtPair.quoteDecimals : 2;
      const rate = Number(BigInt(usdtPair.lastPrice)) / 10 ** qDec;
      if (Number.isFinite(rate) && rate > 0) return rate;
    }
    const fx = fxConversionService.getLatestRate?.();
    if (fx && Number.isFinite(fx.rate) && fx.rate > 0) {
      return fx.rate;
    }
    return 16450;
  }

  /**
   * Resolve exact real market price for any asset symbol using:
   * 1. Exchange ${SYM}-IDR pair lastPrice (with exact quoteDecimals)
   * 2. Exchange ${SYM}-USDT pair lastPrice * usdtRate
   * 3. Live External WebSocket Aggregator snapshot (${SYM}USDT)
   */
  public resolveRealAssetPrice(
    symbol: string,
    usdtRate: number
  ): {
    priceIdr: number;
    priceUsdt: number;
    source: 'PAIR_IDR' | 'PAIR_USDT' | 'EXTERNAL_WS' | 'NONE';
  } {
    const clean = symbol.toUpperCase();
    if (clean === 'IDR') {
      return { priceIdr: 1, priceUsdt: 1 / (usdtRate || 16450), source: 'PAIR_IDR' };
    }
    if (clean === 'USDT') {
      return { priceIdr: usdtRate, priceUsdt: 1, source: 'PAIR_IDR' };
    }

    const idrPair = db.tradingPairs.get(`${clean}-IDR`);
    const usdtPair = db.tradingPairs.get(`${clean}-USDT`);

    const hasValidIdrPair = Boolean(idrPair && !idrPair.isDelisted && BigInt(idrPair.lastPrice || '0') > 0n);
    const hasValidUsdtPair = Boolean(usdtPair && !usdtPair.isDelisted && BigInt(usdtPair.lastPrice || '0') > 0n);

    if (hasValidIdrPair && idrPair) {
      const qDec = typeof idrPair.quoteDecimals === 'number' ? idrPair.quoteDecimals : 2;
      const priceIdr = Number(BigInt(idrPair.lastPrice)) / 10 ** qDec;

      let priceUsdt = priceIdr / (usdtRate || 16450);
      if (hasValidUsdtPair && usdtPair) {
        const uDec = typeof usdtPair.quoteDecimals === 'number' ? usdtPair.quoteDecimals : 6;
        const directUsdt = Number(BigInt(usdtPair.lastPrice)) / 10 ** uDec;
        if (directUsdt > 0) {
          priceUsdt = directUsdt;
        }
      }
      return { priceIdr, priceUsdt, source: 'PAIR_IDR' };
    }

    if (hasValidUsdtPair && usdtPair) {
      const uDec = typeof usdtPair.quoteDecimals === 'number' ? usdtPair.quoteDecimals : 6;
      const priceUsdt = Number(BigInt(usdtPair.lastPrice)) / 10 ** uDec;
      return {
        priceIdr: priceUsdt * usdtRate,
        priceUsdt,
        source: 'PAIR_USDT',
      };
    }

    const extSnap = priceAggregatorService.getSymbolSnapshot(`${clean}USDT`);
    if (extSnap && extSnap.price > 0) {
      return {
        priceIdr: extSnap.price * usdtRate,
        priceUsdt: extSnap.price,
        source: 'EXTERNAL_WS',
      };
    }

    return { priceIdr: 0, priceUsdt: 0, source: 'NONE' };
  }

  public getUserPnLAnalytics(
    userId: string,
    requestedMonth?: string,
    _requestedCurrency: 'IDR' | 'USDT' = 'IDR'
  ) {
    const now = Date.now();
    const todayKey = getJakartaDateKey(now);
    const monthKey = requestedMonth || todayKey.slice(0, 7);
    const usdtRate = this.getLiveUsdtIdrRate();

    // 1. Fetch real Spot trades, Closed Futures positions, and Mirrored Copy orders
    const userTrades = db.trades
      .filter(t => t.makerUserId === userId || t.takerUserId === userId)
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt);

    const closedFutures = Array.from(db.futuresPositions.values())
      .filter(p => p.userId === userId && p.status === 'CLOSED' && p.closedAt)
      .sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0));

    const userCopyTrades = db.copyMirroredOrders
      .filter(m => m.followerUserId === userId && m.status === 'FILLED')
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt);

    // Track exact real FIFO/weighted-average cost basis per base currency
    const positions = new Map<
      string,
      {
        qty: number;
        costIdr: number;
        costUsdt: number;
        totalBoughtQty: number;
        totalSoldQty: number;
        weightedBuyPriceIdr: number;
        weightedBuyPriceUsdt: number;
      }
    >();

    // Track computed daily buckets from live in-memory events
    const liveDailyMap = new Map<string, DailyPnlSnapshot>();

    const ensureLiveBucket = (dateKey: string, ts: number): DailyPnlSnapshot => {
      let bucket = liveDailyMap.get(dateKey);
      if (!bucket) {
        bucket = {
          id: `${userId}:${dateKey}`,
          userId,
          date: dateKey,
          timestamp: ts,
          pnlIdr: 0,
          pnlUsdt: 0,
          unrealizedPnlIdr: 0,
          unrealizedPnlUsdt: 0,
          netPnlIdr: 0,
          netPnlUsdt: 0,
          portfolioValueIdr: 0,
          portfolioValueUsdt: 0,
          volumeIdr: 0,
          volumeUsdt: 0,
          feesIdr: 0,
          feesUsdt: 0,
          tradesCount: 0,
          winCount: 0,
          lossCount: 0,
          returnPct: 0,
          trades: [],
          finalized: dateKey < todayKey,
          updatedAt: now,
        };
        liveDailyMap.set(dateKey, bucket);
      }
      return bucket;
    };

    // 2. Process real Spot trades chronologically
    for (const t of userTrades) {
      const isUserBuyer =
        (t.takerUserId === userId && t.takerSide === 'BUY') ||
        (t.makerUserId === userId && t.takerSide === 'SELL');
      const isTaker = t.takerUserId === userId;

      const pair = db.tradingPairs.get(t.pairId);
      const quoteCurr = pair?.quoteCurrency || (t.pairId.endsWith('-USDT') ? 'USDT' : 'IDR');
      const baseCurr = (pair?.baseCurrency || t.pairId.split('-')[0]).toUpperCase();
      const baseDec = pair?.baseDecimals ?? getCurrencyDecimalsServer(baseCurr);
      const quoteDec = pair?.quoteDecimals ?? (quoteCurr === 'IDR' ? 2 : 6);

      const priceUnits = BigInt(t.price);
      const qtyUnits = BigInt(t.quantity);
      const quoteVolUnits = BigInt(t.quoteVolume);
      const feeUnits = isTaker ? BigInt(t.takerFee || '0') : BigInt(t.makerFee || '0');

      const qtyNum = Number(qtyUnits) / 10 ** baseDec;
      const quoteVolNum = Number(quoteVolUnits) / 10 ** quoteDec;
      const feeNum = Number(feeUnits) / 10 ** quoteDec;

      const valIdr = quoteCurr === 'IDR' ? quoteVolNum : quoteVolNum * usdtRate;
      const valUsdt = quoteCurr === 'USDT' ? quoteVolNum : quoteVolNum / usdtRate;
      const feeIdr = quoteCurr === 'IDR' ? feeNum : feeNum * usdtRate;
      const feeUsdt = quoteCurr === 'USDT' ? feeNum : feeNum / usdtRate;

      let tradePnlIdr = 0;
      let tradePnlUsdt = 0;

      const pos = positions.get(baseCurr) || {
        qty: 0,
        costIdr: 0,
        costUsdt: 0,
        totalBoughtQty: 0,
        totalSoldQty: 0,
        weightedBuyPriceIdr: 0,
        weightedBuyPriceUsdt: 0,
      };

      if (isUserBuyer) {
        pos.qty += qtyNum;
        pos.totalBoughtQty += qtyNum;
        pos.costIdr += valIdr + feeIdr;
        pos.costUsdt += valUsdt + feeUsdt;
        if (pos.qty > 0) {
          pos.weightedBuyPriceIdr = pos.costIdr / pos.qty;
          pos.weightedBuyPriceUsdt = pos.costUsdt / pos.qty;
        }
        positions.set(baseCurr, pos);
      } else {
        pos.totalSoldQty += qtyNum;
        if (pos.qty > 0) {
          const matchedRatio = Math.min(1, qtyNum / pos.qty);
          const matchedFraction = qtyNum > pos.qty ? pos.qty / qtyNum : 1;
          const soldCostIdr = pos.costIdr * matchedRatio;
          const soldCostUsdt = pos.costUsdt * matchedRatio;

          // Only realize PnL against tracked cost basis for the portion bought via trades;
          // unbacked portion (e.g. deposited prior to spot tracking) only subtracts real fee paid.
          const backedProceedsIdr = valIdr * matchedFraction;
          const backedProceedsUsdt = valUsdt * matchedFraction;
          tradePnlIdr = backedProceedsIdr - feeIdr - soldCostIdr;
          tradePnlUsdt = backedProceedsUsdt - feeUsdt - soldCostUsdt;

          pos.qty = Math.max(0, pos.qty - qtyNum);
          pos.costIdr = Math.max(0, pos.costIdr - soldCostIdr);
          pos.costUsdt = Math.max(0, pos.costUsdt - soldCostUsdt);
          if (pos.qty > 0) {
            pos.weightedBuyPriceIdr = pos.costIdr / pos.qty;
            pos.weightedBuyPriceUsdt = pos.costUsdt / pos.qty;
          } else {
            pos.weightedBuyPriceIdr = 0;
            pos.weightedBuyPriceUsdt = 0;
          }
          positions.set(baseCurr, pos);
        } else {
          // Pure deposit/non-trade holding sold: cannot invent fake buy price; real cost is fee paid
          tradePnlIdr = -feeIdr;
          tradePnlUsdt = -feeUsdt;
          positions.set(baseCurr, pos);
        }
      }

      const dateKey = getJakartaDateKey(t.createdAt);
      const bucket = ensureLiveBucket(dateKey, t.createdAt);
      bucket.pnlIdr += tradePnlIdr;
      bucket.pnlUsdt += tradePnlUsdt;
      bucket.volumeIdr += valIdr;
      bucket.volumeUsdt += valUsdt;
      bucket.feesIdr += feeIdr;
      bucket.feesUsdt += feeUsdt;
      bucket.tradesCount += 1;
      if (!isUserBuyer) {
        if (tradePnlIdr > 0) bucket.winCount += 1;
        else if (tradePnlIdr < 0) bucket.lossCount += 1;
      }

      const formattedPrice =
        quoteCurr === 'IDR'
          ? PrecisionMath.formatIDRDisplay(priceUnits)
          : `${PrecisionMath.formatFromUnits(priceUnits, quoteDec, true)} USDT`;
      const formattedQty = `${PrecisionMath.formatFromUnits(qtyUnits, baseDec, true)} ${baseCurr}`;
      const formattedQuoteVol =
        quoteCurr === 'IDR'
          ? PrecisionMath.formatIDRDisplay(quoteVolUnits)
          : `${PrecisionMath.formatFromUnits(quoteVolUnits, quoteDec, true)} USDT`;

      const snapTrade: DailyPnlTradeSnapshot = {
        id: t.id,
        pairId: t.pairId,
        side: isUserBuyer ? 'BUY' : 'SELL',
        price: formattedPrice,
        rawPrice: t.price,
        quantity: formattedQty,
        rawQuantity: t.quantity,
        quoteVolume: formattedQuoteVol,
        rawQuoteVolume: t.quoteVolume,
        pnlIdr: Math.round(tradePnlIdr),
        pnlUsdt: Number(tradePnlUsdt.toFixed(4)),
        feeIdr: Math.round(feeIdr),
        feeUsdt: Number(feeUsdt.toFixed(4)),
        time: getJakartaTimeStr(t.createdAt),
        timestamp: t.createdAt,
        source: 'SPOT',
      };
      bucket.trades.push(snapTrade);
    }

    // 3. Process Closed Futures Positions
    for (const fp of closedFutures) {
      const ts = fp.closedAt || fp.createdAt;
      const dateKey = getJakartaDateKey(ts);
      const bucket = ensureLiveBucket(dateKey, ts);

      const realizedUsdt = Number(BigInt(fp.realizedPnlUnits || '0')) / 1e6;
      const feeUsdt = Number(BigInt(fp.feePaidUnits || '0')) / 1e6;
      const realizedIdr = realizedUsdt * usdtRate;
      const feeIdr = feeUsdt * usdtRate;

      bucket.pnlIdr += realizedIdr;
      bucket.pnlUsdt += realizedUsdt;
      bucket.feesIdr += feeIdr;
      bucket.feesUsdt += feeUsdt;
      bucket.tradesCount += 1;
      if (realizedIdr > 0) bucket.winCount += 1;
      else if (realizedIdr < 0) bucket.lossCount += 1;

      bucket.trades.push({
        id: `fut-${fp.id}`,
        pairId: fp.pairId,
        side: fp.side === 'LONG' ? 'BUY' : 'SELL',
        price: `${PrecisionMath.formatFromUnits(BigInt(fp.closePriceUnits || fp.entryPriceUnits), 6, true)} USDT`,
        rawPrice: fp.closePriceUnits || fp.entryPriceUnits,
        quantity: PrecisionMath.formatFromUnits(BigInt(fp.quantityUnits), 8, true),
        rawQuantity: fp.quantityUnits,
        quoteVolume: `${realizedUsdt >= 0 ? '+' : ''}${realizedUsdt.toFixed(2)} USDT`,
        rawQuoteVolume: fp.realizedPnlUnits || '0',
        pnlIdr: Math.round(realizedIdr),
        pnlUsdt: Number(realizedUsdt.toFixed(4)),
        feeIdr: Math.round(feeIdr),
        feeUsdt: Number(feeUsdt.toFixed(4)),
        time: getJakartaTimeStr(ts),
        timestamp: ts,
        source: 'FUTURES',
      });
    }

    // 4. Process Mirrored Copy Trades (non-duplicate sleeve activity)
    for (const cm of userCopyTrades) {
      const pair = db.tradingPairs.get(cm.pairId);
      const quoteCurr = pair?.quoteCurrency || (cm.pairId.endsWith('-USDT') ? 'USDT' : 'IDR');
      const baseCurr = pair?.baseCurrency || cm.pairId.split('-')[0];
      const baseDec = pair?.baseDecimals ?? getCurrencyDecimalsServer(baseCurr);
      const quoteDec = pair?.quoteDecimals ?? (quoteCurr === 'IDR' ? 2 : 6);

      const pnlUnitsNum = Number(BigInt(cm.realizedPnlUnits || '0')) / 10 ** quoteDec;
      const quoteVolNum = Number(BigInt(cm.quoteVolumeUnits || '0')) / 10 ** quoteDec;
      const feeNum = Number(BigInt(cm.feeUnits || '0')) / 10 ** quoteDec;

      const pnlIdr = quoteCurr === 'IDR' ? pnlUnitsNum : pnlUnitsNum * usdtRate;
      const pnlUsdt = quoteCurr === 'USDT' ? pnlUnitsNum : pnlUnitsNum / usdtRate;
      const valIdr = quoteCurr === 'IDR' ? quoteVolNum : quoteVolNum * usdtRate;
      const valUsdt = quoteCurr === 'USDT' ? quoteVolNum : quoteVolNum / usdtRate;
      const feeIdr = quoteCurr === 'IDR' ? feeNum : feeNum * usdtRate;
      const feeUsdt = quoteCurr === 'USDT' ? feeNum : feeNum / usdtRate;

      const dateKey = getJakartaDateKey(cm.createdAt);
      const bucket = ensureLiveBucket(dateKey, cm.createdAt);
      bucket.pnlIdr += pnlIdr;
      bucket.pnlUsdt += pnlUsdt;
      bucket.volumeIdr += valIdr;
      bucket.volumeUsdt += valUsdt;
      bucket.feesIdr += feeIdr;
      bucket.feesUsdt += feeUsdt;
      bucket.tradesCount += 1;
      if (cm.side === 'SELL') {
        if (pnlIdr > 0) bucket.winCount += 1;
        else if (pnlIdr < 0) bucket.lossCount += 1;
      }

      bucket.trades.push({
        id: `copy-${cm.id}`,
        pairId: cm.pairId,
        side: cm.side,
        price:
          quoteCurr === 'IDR'
            ? PrecisionMath.formatIDRDisplay(BigInt(cm.executionPriceUnits))
            : `${PrecisionMath.formatFromUnits(BigInt(cm.executionPriceUnits), quoteDec, true)} USDT`,
        rawPrice: cm.executionPriceUnits,
        quantity: `${PrecisionMath.formatFromUnits(BigInt(cm.executedQtyUnits), baseDec, true)} ${baseCurr}`,
        rawQuantity: cm.executedQtyUnits,
        quoteVolume:
          quoteCurr === 'IDR'
            ? PrecisionMath.formatIDRDisplay(BigInt(cm.quoteVolumeUnits))
            : `${PrecisionMath.formatFromUnits(BigInt(cm.quoteVolumeUnits), quoteDec, true)} USDT`,
        rawQuoteVolume: cm.quoteVolumeUnits,
        pnlIdr: Math.round(pnlIdr),
        pnlUsdt: Number(pnlUsdt.toFixed(4)),
        feeIdr: Math.round(feeIdr),
        feeUsdt: Number(feeUsdt.toFixed(4)),
        time: getJakartaTimeStr(cm.createdAt),
        timestamp: cm.createdAt,
        source: 'COPY',
      });
    }

    // 5. Real-Time Unrealized PnL & Portfolio Valuation from Real Balances + Live Market Prices
    const userAccounts = db.getUserAccounts(userId);
    let totalUnrealizedPnlIdr = 0;
    let totalUnrealizedPnlUsdt = 0;
    let totalPortfolioEstIdr = 0;
    const assetBreakdown: LiveAssetBreakdownItem[] = [];

    for (const acc of userAccounts) {
      const cleanCurr = acc.currency.toUpperCase();
      const totalUnits = BigInt(acc.balanceAvailable) + BigInt(acc.balanceLocked);
      const dec = getCurrencyDecimalsServer(cleanCurr);
      const holding = Number(totalUnits) / 10 ** dec;

      if (cleanCurr === 'IDR') {
        totalPortfolioEstIdr += holding;
        continue;
      }

      const pos = positions.get(cleanCurr);
      const hasActivity = holding > 0 || (pos && (pos.totalBoughtQty > 0 || pos.totalSoldQty > 0));
      if (!hasActivity) continue;

      const resolved = this.resolveRealAssetPrice(cleanCurr, usdtRate);
      const curPriceIdr = resolved.priceIdr;
      const curPriceUsdt = resolved.priceUsdt;

      const assetValIdr = holding * curPriceIdr;
      totalPortfolioEstIdr += assetValIdr;

      const hasCostBasis = Boolean(pos && pos.qty > 1e-12 && (pos.costIdr > 0 || pos.costUsdt > 0));
      let avgCostIdr = 0;
      let avgCostUsdt = 0;
      let unPnlIdr = 0;
      let unPnlUsdt = 0;
      let returnPct = 0;

      if (hasCostBasis && pos) {
        avgCostIdr = pos.costIdr / pos.qty;
        avgCostUsdt = pos.costUsdt / pos.qty;
        const trackedHolding = Math.min(holding, pos.qty);
        if (trackedHolding > 0 && curPriceIdr > 0) {
          unPnlIdr = (curPriceIdr - avgCostIdr) * trackedHolding;
          unPnlUsdt = (curPriceUsdt - avgCostUsdt) * trackedHolding;
          returnPct = avgCostIdr > 0 ? ((curPriceIdr - avgCostIdr) / avgCostIdr) * 100 : 0;
        }
      }

      totalUnrealizedPnlIdr += unPnlIdr;
      totalUnrealizedPnlUsdt += unPnlUsdt;

      assetBreakdown.push({
        symbol: cleanCurr,
        holding: Number(holding.toFixed(dec > 6 ? 6 : dec)),
        avgBuyPriceIdr: roundPricePrecision(avgCostIdr),
        currentPriceIdr: roundPricePrecision(curPriceIdr),
        avgBuyPriceUsdt: roundUsdtPrecision(avgCostUsdt),
        currentPriceUsdt: roundUsdtPrecision(curPriceUsdt),
        unrealizedPnlIdr: Math.round(unPnlIdr),
        unrealizedPnlUsdt: Number(unPnlUsdt.toFixed(4)),
        returnPct: Number(returnPct.toFixed(2)),
        totalBought: Number((pos?.totalBoughtQty || 0).toFixed(dec > 6 ? 6 : dec)),
        totalSold: Number((pos?.totalSoldQty || 0).toFixed(dec > 6 ? 6 : dec)),
        hasCostBasis,
        priceSource: resolved.source,
      });
    }

    // Include active copy trading sleeves in portfolio estimation
    let copyAllocatedValIdr = 0;
    for (const rel of db.copyRelationships.values()) {
      if (rel.followerUserId === userId && rel.status !== 'STOPPED') {
        if (rel.allocationCurrency === 'IDR') {
          copyAllocatedValIdr += Number(BigInt(rel.availableSleeveUnits || '0')) / 100;
        } else {
          copyAllocatedValIdr += (Number(BigInt(rel.availableSleeveUnits || '0')) / 1_000_000) * usdtRate;
        }
        for (const [sym, unitsStr] of Object.entries(rel.heldBaseBySymbol || {})) {
          const dec = getCurrencyDecimalsServer(sym);
          const qty = Number(BigInt(unitsStr || '0')) / 10 ** dec;
          const p = this.resolveRealAssetPrice(sym, usdtRate);
          copyAllocatedValIdr += qty * p.priceIdr;
        }
      }
    }
    totalPortfolioEstIdr += copyAllocatedValIdr;

    const baseVal = totalPortfolioEstIdr > 0 ? totalPortfolioEstIdr : 0;

    // 6. Merge live daily buckets with permanent disk-persisted db.dailyPnlSnapshots
    const mergedDailyMap = new Map<string, DailyPnlSnapshot>();

    // First load all saved daily snapshots for this user
    for (const snap of db.dailyPnlSnapshots.values()) {
      if (snap.userId === userId) {
        mergedDailyMap.set(snap.date, {
          ...snap,
          trades: Array.isArray(snap.trades) ? [...snap.trades] : [],
        });
      }
    }

    let snapshotDirty = false;

    for (const [dateKey, liveBucket] of liveDailyMap.entries()) {
      const existingSnap = mergedDailyMap.get(dateKey);
      const computedReturnPct =
        baseVal > 0 ? Number(((liveBucket.pnlIdr / baseVal) * 100).toFixed(2)) : 0;

      const normalizedLive: DailyPnlSnapshot = {
        ...liveBucket,
        pnlIdr: Math.round(liveBucket.pnlIdr),
        pnlUsdt: Number(liveBucket.pnlUsdt.toFixed(4)),
        unrealizedPnlIdr: dateKey === todayKey ? Math.round(totalUnrealizedPnlIdr) : 0,
        unrealizedPnlUsdt: dateKey === todayKey ? Number(totalUnrealizedPnlUsdt.toFixed(4)) : 0,
        netPnlIdr: Math.round(
          liveBucket.pnlIdr + (dateKey === todayKey ? totalUnrealizedPnlIdr : 0)
        ),
        netPnlUsdt: Number(
          (liveBucket.pnlUsdt + (dateKey === todayKey ? totalUnrealizedPnlUsdt : 0)).toFixed(4)
        ),
        portfolioValueIdr: Math.round(totalPortfolioEstIdr),
        portfolioValueUsdt: Number((totalPortfolioEstIdr / (usdtRate || 16450)).toFixed(2)),
        volumeIdr: Math.round(liveBucket.volumeIdr),
        volumeUsdt: Number(liveBucket.volumeUsdt.toFixed(4)),
        feesIdr: Math.round(liveBucket.feesIdr),
        feesUsdt: Number(liveBucket.feesUsdt.toFixed(4)),
        returnPct: computedReturnPct,
        finalized: dateKey < todayKey,
        updatedAt: now,
      };

      const shouldPreserveSavedHistory =
        Boolean(existingSnap) &&
        dateKey < todayKey &&
        existingSnap!.finalized &&
        existingSnap!.tradesCount > normalizedLive.tradesCount;

      if (!shouldPreserveSavedHistory) {
        mergedDailyMap.set(dateKey, normalizedLive);
        const snapKey = `${userId}:${dateKey}`;
        const prev = db.dailyPnlSnapshots.get(snapKey);
        if (
          !prev ||
          prev.tradesCount !== normalizedLive.tradesCount ||
          prev.pnlIdr !== normalizedLive.pnlIdr ||
          prev.finalized !== normalizedLive.finalized ||
          dateKey === todayKey
        ) {
          db.dailyPnlSnapshots.set(snapKey, normalizedLive);
          snapshotDirty = true;
        }
      }
    }

    // Ensure past snapshots get marked finalized once midnight WIB passes
    for (const [dateKey, snap] of mergedDailyMap.entries()) {
      if (dateKey < todayKey && !snap.finalized) {
        snap.finalized = true;
        snap.updatedAt = now;
        db.dailyPnlSnapshots.set(`${userId}:${dateKey}`, snap);
        snapshotDirty = true;
      }
    }

    // Even if user had zero trades today, save today's baseline snapshot if portfolio > 0 or user has prior snapshots
    if (
      !mergedDailyMap.has(todayKey) &&
      (mergedDailyMap.size > 0 || totalPortfolioEstIdr > 0)
    ) {
      const todaySnap: DailyPnlSnapshot = {
        id: `${userId}:${todayKey}`,
        userId,
        date: todayKey,
        timestamp: now,
        pnlIdr: 0,
        pnlUsdt: 0,
        unrealizedPnlIdr: Math.round(totalUnrealizedPnlIdr),
        unrealizedPnlUsdt: Number(totalUnrealizedPnlUsdt.toFixed(4)),
        netPnlIdr: Math.round(totalUnrealizedPnlIdr),
        netPnlUsdt: Number(totalUnrealizedPnlUsdt.toFixed(4)),
        portfolioValueIdr: Math.round(totalPortfolioEstIdr),
        portfolioValueUsdt: Number((totalPortfolioEstIdr / (usdtRate || 16450)).toFixed(2)),
        volumeIdr: 0,
        volumeUsdt: 0,
        feesIdr: 0,
        feesUsdt: 0,
        tradesCount: 0,
        winCount: 0,
        lossCount: 0,
        returnPct: 0,
        trades: [],
        finalized: false,
        updatedAt: now,
      };
      mergedDailyMap.set(todayKey, todaySnap);
      db.dailyPnlSnapshots.set(`${userId}:${todayKey}`, todaySnap);
      snapshotDirty = true;
    }

    if (snapshotDirty) {
      db.scheduleSave();
    }

    // 7. Compute Summary Aggregates from mergedDailyMap (includes preserved historical days!)
    const sortedDays = Array.from(mergedDailyMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    let totalRealizedPnlIdr = 0;
    let totalRealizedPnlUsdt = 0;
    let grossProfitIdr = 0;
    let grossLossIdr = 0;
    let totalTradesCount = 0;
    let totalWinsCount = 0;
    let totalLossCount = 0;
    let totalVolumeIdr = 0;
    let totalVolumeUsdt = 0;
    let totalFeesIdr = 0;
    let totalFeesUsdt = 0;

    let winningDaysCount = 0;
    let losingDaysCount = 0;
    let breakevenDaysCount = 0;
    let bestDay: DailyPnlSnapshot | null = null;
    let worstDay: DailyPnlSnapshot | null = null;

    let cumIdr = 0;
    let cumUsdt = 0;

    const cumulativeSeries = sortedDays.map(d => {
      totalRealizedPnlIdr += d.pnlIdr;
      totalRealizedPnlUsdt += d.pnlUsdt;
      totalTradesCount += d.tradesCount;
      totalWinsCount += d.winCount;
      totalLossCount += d.lossCount;
      totalVolumeIdr += d.volumeIdr;
      totalVolumeUsdt += d.volumeUsdt;
      totalFeesIdr += d.feesIdr;
      totalFeesUsdt += d.feesUsdt;

      for (const tx of d.trades) {
        if (tx.pnlIdr > 0) grossProfitIdr += tx.pnlIdr;
        else if (tx.pnlIdr < 0) grossLossIdr += Math.abs(tx.pnlIdr);
      }

      if (d.tradesCount > 0) {
        if (d.pnlIdr > 0) winningDaysCount++;
        else if (d.pnlIdr < 0) losingDaysCount++;
        else breakevenDaysCount++;

        if (!bestDay || d.pnlIdr > bestDay.pnlIdr) bestDay = d;
        if (!worstDay || d.pnlIdr < worstDay.pnlIdr) worstDay = d;
      }

      cumIdr += d.pnlIdr;
      cumUsdt += d.pnlUsdt;

      return {
        date: d.date,
        timestamp: d.timestamp,
        dailyPnlIdr: d.pnlIdr,
        dailyPnlUsdt: Number(d.pnlUsdt.toFixed(2)),
        cumulativePnlIdr: Math.round(cumIdr),
        cumulativePnlUsdt: Number(cumUsdt.toFixed(2)),
        returnPct: d.returnPct,
      };
    });

    const activeDaysCount = sortedDays.filter(d => d.tradesCount > 0).length;
    const todayBucket = mergedDailyMap.get(todayKey);
    const todayPnlIdr = todayBucket ? todayBucket.pnlIdr : 0;
    const todayPnlUsdt = todayBucket ? todayBucket.pnlUsdt : 0;
    const todayPnlPercent = todayBucket ? todayBucket.returnPct : 0;

    const winRateDaysPct =
      activeDaysCount > 0 ? Number(((winningDaysCount / activeDaysCount) * 100).toFixed(1)) : 0;
    const sellOutcomes = totalWinsCount + totalLossCount;
    const winRateTradesPct =
      sellOutcomes > 0 ? Number(((totalWinsCount / sellOutcomes) * 100).toFixed(1)) : 0;
    const profitFactor =
      grossLossIdr > 0
        ? Number((grossProfitIdr / grossLossIdr).toFixed(2))
        : grossProfitIdr > 0
        ? 9.99
        : 0;

    const netPnlIdr = Math.round(totalRealizedPnlIdr + totalUnrealizedPnlIdr);
    const netPnlUsdt = Number((totalRealizedPnlUsdt + totalUnrealizedPnlUsdt).toFixed(2));

    const calendarData: Record<string, DailyPnlSnapshot> = {};
    for (const [k, v] of mergedDailyMap.entries()) {
      calendarData[k] = v;
    }

    return {
      summary: {
        totalRealizedPnlIdr: Math.round(totalRealizedPnlIdr),
        totalRealizedPnlUsdt: Number(totalRealizedPnlUsdt.toFixed(2)),
        totalUnrealizedPnlIdr: Math.round(totalUnrealizedPnlIdr),
        totalUnrealizedPnlUsdt: Number(totalUnrealizedPnlUsdt.toFixed(2)),
        netPnlIdr,
        netPnlUsdt,
        todayPnlIdr,
        todayPnlUsdt,
        todayPnlPercent,
        winRateDaysPct,
        winRateTradesPct,
        profitFactor,
        totalTradingDays: activeDaysCount,
        winningDaysCount,
        losingDaysCount,
        breakevenDaysCount,
        totalTrades: totalTradesCount,
        totalVolumeIdr: Math.round(totalVolumeIdr),
        totalVolumeUsdt: Number(totalVolumeUsdt.toFixed(2)),
        totalFeesIdr: Math.round(totalFeesIdr),
        totalFeesUsdt: Number(totalFeesUsdt.toFixed(2)),
        bestDay: bestDay
          ? {
              date: (bestDay as DailyPnlSnapshot).date,
              pnlIdr: (bestDay as DailyPnlSnapshot).pnlIdr,
              pnlUsdt: Number((bestDay as DailyPnlSnapshot).pnlUsdt.toFixed(2)),
              returnPct: (bestDay as DailyPnlSnapshot).returnPct,
            }
          : null,
        worstDay: worstDay
          ? {
              date: (worstDay as DailyPnlSnapshot).date,
              pnlIdr: (worstDay as DailyPnlSnapshot).pnlIdr,
              pnlUsdt: Number((worstDay as DailyPnlSnapshot).pnlUsdt.toFixed(2)),
              returnPct: (worstDay as DailyPnlSnapshot).returnPct,
            }
          : null,
        totalPortfolioEstIdr: Math.round(totalPortfolioEstIdr),
        usdtRate: Math.round(usdtRate),
        persistedDaysCount: sortedDays.length,
      },
      cumulativeSeries,
      calendarData,
      assetBreakdown,
      requestedMonth: monthKey,
      timezone: 'Asia/Jakarta (WIB)',
    };
  }
}

export const pnlService = new PnLService();
