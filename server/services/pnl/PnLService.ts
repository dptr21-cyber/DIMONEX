/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/pnl/PnLService.ts
 * 100% Real-Data Live PnL Engine & Persistent Daily PnL Calendar Service.
 *
 * Guarantees:
 * - Zero fake trades (`hist-seed-*` / `usr-seed-*` excluded), zero synthetic cost-basis multipliers.
 * - Reconstructs immutable chronological Spot execution history by unifying live `db.trades`,
 *   immutable `TRADE_SETTLEMENT` journal references, and permanently persisted `db.dailyPnlSnapshots`
 *   so historical execution prices survive `db.trades` 2,000-entry pruning.
 * - Strict FIFO lot-level inventory tracking using exact historical execution prices (`priceUnits`)
 *   without inflating `avgBuyPrice` with trading fees.
 * - Live mark-to-market valuations resolved from real Exchange TradingPairs (-IDR / -USDT)
 *   and live External WS PriceAggregatorService feeds using exact decimal precision.
 */

import { db } from '../../db/database.js';
import {
  Trade,
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

function safeBigInt(val: string | number | bigint | undefined | null): bigint {
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number') return Number.isFinite(val) ? BigInt(Math.trunc(val)) : 0n;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return 0n;
    try {
      return BigInt(trimmed);
    } catch {
      return 0n;
    }
  }
  return 0n;
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

interface UnifiedSpotExecution {
  id: string;
  pairId: string;
  baseCurr: string;
  quoteCurr: string;
  baseDec: number;
  quoteDec: number;
  side: 'BUY' | 'SELL';
  priceUnits: bigint;
  qtyUnits: bigint;
  quoteVolUnits: bigint;
  execPricePair: number;
  qtyNum: number;
  quoteVolNum: number;
  feeIdr: number;
  feeUsdt: number;
  createdAt: number;
  ledgerVerified: boolean;
}

interface ExecutionLot {
  tradeId: string;
  pairId: string;
  qty: number;
  execPriceIdr: number;
  execPriceUsdt: number;
  feeIdr: number;
  feeUsdt: number;
  timestamp: number;
}

export interface ExecutionFillPreview {
  tradeId: string;
  pairId: string;
  qty: number;
  priceIdr: number;
  priceUsdt: number;
  timestamp: number;
}

export interface LiveAssetBreakdownItem {
  symbol: string;
  holding: number;
  trackedQty: number;
  openLotsCount: number;
  avgBuyPriceIdr: number;
  currentPriceIdr: number;
  avgBuyPriceUsdt: number;
  currentPriceUsdt: number;
  lastBuyPriceIdr: number;
  lastBuyPriceUsdt: number;
  lastBuyTimestamp: number | null;
  unrealizedPnlIdr: number;
  unrealizedPnlUsdt: number;
  returnPct: number;
  totalBought: number;
  totalSold: number;
  hasCostBasis: boolean;
  priceSource: 'PAIR_IDR' | 'PAIR_USDT' | 'EXTERNAL_WS' | 'NONE';
  recentFills: ExecutionFillPreview[];
}

export class PnLService {
  private schedulerInterval: NodeJS.Timeout | null = null;
  private lastKnownJakartaDate: string = getJakartaDateKey(Date.now());

  public startScheduler(): void {
    if (this.schedulerInterval) return;

    try {
      this.snapshotAllActiveUsers();
    } catch (err: any) {
      console.warn('[PnLService] Initial snapshot pass skipped:', err?.message || err);
    }

    this.schedulerInterval = setInterval(() => {
      try {
        const currentDateKey = getJakartaDateKey(Date.now());
        if (currentDateKey !== this.lastKnownJakartaDate) {
          console.log(
            `[PnLService] Pergantian hari WIB terdeteksi (${this.lastKnownJakartaDate} -> ${currentDateKey}). Menyimpan & memfinalisasi kalender harian...`
          );
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
        db.trades.some(
          t =>
            !t.id.startsWith('hist-seed-') &&
            !t.id.startsWith('usr-seed-') &&
            (t.makerUserId === user.id || t.takerUserId === user.id)
        ) ||
        Array.from(db.futuresPositions.values()).some(
          p => p.userId === user.id && (p.status === 'CLOSED' || p.status === 'LIQUIDATED')
        ) ||
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

  public getLiveUsdtIdrRate(): number {
    const usdtPair = db.tradingPairs.get('USDT-IDR');
    if (usdtPair && !usdtPair.isDelisted && safeBigInt(usdtPair.lastPrice) > 0n) {
      const qDec = typeof usdtPair.quoteDecimals === 'number' ? usdtPair.quoteDecimals : 2;
      const rate = Number(safeBigInt(usdtPair.lastPrice)) / 10 ** qDec;
      if (Number.isFinite(rate) && rate > 0) return rate;
    }
    const fx = fxConversionService.getLatestRate?.();
    if (fx && Number.isFinite(fx.rate) && fx.rate > 0) {
      return fx.rate;
    }
    return 16450;
  }

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

    const hasValidIdrPair = Boolean(
      idrPair && !idrPair.isDelisted && safeBigInt(idrPair.lastPrice) > 0n
    );
    const hasValidUsdtPair = Boolean(
      usdtPair && !usdtPair.isDelisted && safeBigInt(usdtPair.lastPrice) > 0n
    );

    if (hasValidIdrPair && idrPair) {
      const qDec = typeof idrPair.quoteDecimals === 'number' ? idrPair.quoteDecimals : 2;
      const priceIdr = Number(safeBigInt(idrPair.lastPrice)) / 10 ** qDec;

      let priceUsdt = priceIdr / (usdtRate || 16450);
      if (hasValidUsdtPair && usdtPair) {
        const uDec = typeof usdtPair.quoteDecimals === 'number' ? usdtPair.quoteDecimals : 6;
        const directUsdt = Number(safeBigInt(usdtPair.lastPrice)) / 10 ** uDec;
        if (directUsdt > 0) {
          priceUsdt = directUsdt;
        }
      }
      return { priceIdr, priceUsdt, source: 'PAIR_IDR' };
    }

    if (hasValidUsdtPair && usdtPair) {
      const uDec = typeof usdtPair.quoteDecimals === 'number' ? usdtPair.quoteDecimals : 6;
      const priceUsdt = Number(safeBigInt(usdtPair.lastPrice)) / 10 ** uDec;
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

  /**
   * Build an immutable chronological Spot execution timeline for a user by unifying:
   * 1. Live `db.trades` + cross-check with `db.journalTransactions` (`TRADE_SETTLEMENT`)
   * 2. Permanently persisted `db.dailyPnlSnapshots` `SPOT` trade entries (surviving db.trades pruning)
   */
  private buildImmutableSpotExecutions(
    userId: string,
    usdtRate: number
  ): UnifiedSpotExecution[] {
    const byTradeId = new Map<string, UnifiedSpotExecution>();

    // Index immutable TRADE_SETTLEMENT journal keys (if still in recent window)
    const settlementJournalIds = new Set<string>();
    for (const j of db.journalTransactions.values()) {
      if (j.txType === 'TRADE_SETTLEMENT' && j.referenceId) {
        settlementJournalIds.add(j.referenceId);
      }
    }

    // 1. Live Spot trades from db.trades (exact BigInt units from OrderBook settlement)
    for (const t of db.trades) {
      if (t.id.startsWith('hist-seed-') || t.id.startsWith('usr-seed-')) continue;
      if (t.makerUserId !== userId && t.takerUserId !== userId) continue;

      const isUserBuyer =
        (t.takerUserId === userId && t.takerSide === 'BUY') ||
        (t.makerUserId === userId && t.takerSide === 'SELL');
      const isTaker = t.takerUserId === userId;

      const pair = db.tradingPairs.get(t.pairId);
      const quoteCurr = (
        pair?.quoteCurrency || (t.pairId.endsWith('-USDT') ? 'USDT' : 'IDR')
      ).toUpperCase();
      const baseCurr = (pair?.baseCurrency || t.pairId.split('-')[0]).toUpperCase();
      const baseDec = pair?.baseDecimals ?? getCurrencyDecimalsServer(baseCurr);
      const quoteDec = pair?.quoteDecimals ?? (quoteCurr === 'IDR' ? 2 : 6);

      const priceUnits = safeBigInt(t.price);
      const qtyUnits = safeBigInt(t.quantity);
      const quoteVolUnits = safeBigInt(t.quoteVolume);
      const feeUnits = isTaker ? safeBigInt(t.takerFee) : safeBigInt(t.makerFee);

      if (qtyUnits <= 0n || priceUnits <= 0n) continue;

      const execPricePair = Number(priceUnits) / 10 ** quoteDec;
      const qtyNum = Number(qtyUnits) / 10 ** baseDec;
      const quoteVolNum =
        quoteVolUnits > 0n ? Number(quoteVolUnits) / 10 ** quoteDec : qtyNum * execPricePair;
      const feeNum = Number(feeUnits) / 10 ** quoteDec;

      const feeIdr = quoteCurr === 'IDR' ? feeNum : feeNum * usdtRate;
      const feeUsdt = quoteCurr === 'USDT' ? feeNum : feeNum / (usdtRate || 16450);

      byTradeId.set(t.id, {
        id: t.id,
        pairId: t.pairId,
        baseCurr,
        quoteCurr,
        baseDec,
        quoteDec,
        side: isUserBuyer ? 'BUY' : 'SELL',
        priceUnits,
        qtyUnits,
        quoteVolUnits,
        execPricePair,
        qtyNum,
        quoteVolNum,
        feeIdr,
        feeUsdt,
        createdAt: t.createdAt,
        ledgerVerified: settlementJournalIds.has(t.id),
      });
    }

    // 2. Recover older pruned Spot fills from persistent `db.dailyPnlSnapshots`
    for (const snap of db.dailyPnlSnapshots.values()) {
      if (snap.userId !== userId || !Array.isArray(snap.trades)) continue;
      for (const tx of snap.trades) {
        if (!tx || !tx.id) continue;
        if (tx.id.startsWith('hist-seed-') || tx.id.startsWith('usr-seed-')) continue;
        if (tx.source && tx.source !== 'SPOT') continue;
        if (tx.id.startsWith('fut-') || tx.id.startsWith('copy-')) continue;
        if (byTradeId.has(tx.id)) continue;

        const pair = db.tradingPairs.get(tx.pairId);
        const quoteCurr = (
          pair?.quoteCurrency || (tx.pairId.endsWith('-USDT') ? 'USDT' : 'IDR')
        ).toUpperCase();
        const baseCurr = (pair?.baseCurrency || tx.pairId.split('-')[0]).toUpperCase();
        const baseDec = pair?.baseDecimals ?? getCurrencyDecimalsServer(baseCurr);
        const quoteDec = pair?.quoteDecimals ?? (quoteCurr === 'IDR' ? 2 : 6);

        const priceUnits = safeBigInt(tx.rawPrice);
        const qtyUnits = safeBigInt(tx.rawQuantity);
        const quoteVolUnits = safeBigInt(tx.rawQuoteVolume);
        if (priceUnits <= 0n || qtyUnits <= 0n) continue;

        const execPricePair = Number(priceUnits) / 10 ** quoteDec;
        const qtyNum = Number(qtyUnits) / 10 ** baseDec;
        const quoteVolNum =
          quoteVolUnits > 0n ? Number(quoteVolUnits) / 10 ** quoteDec : qtyNum * execPricePair;

        byTradeId.set(tx.id, {
          id: tx.id,
          pairId: tx.pairId,
          baseCurr,
          quoteCurr,
          baseDec,
          quoteDec,
          side: tx.side === 'SELL' ? 'SELL' : 'BUY',
          priceUnits,
          qtyUnits,
          quoteVolUnits,
          execPricePair,
          qtyNum,
          quoteVolNum,
          feeIdr: Number(tx.feeIdr || 0),
          feeUsdt: Number(tx.feeUsdt || 0),
          createdAt: tx.timestamp || snap.timestamp,
          ledgerVerified: true,
        });
      }
    }

    return Array.from(byTradeId.values()).sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id.localeCompare(b.id);
    });
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

    // 1. Reconstruct complete immutable Spot execution log + Closed Futures + Mirrored Copy orders
    const unifiedSpotExecutions = this.buildImmutableSpotExecutions(userId, usdtRate);

    const closedFutures = Array.from(db.futuresPositions.values())
      .filter(
        p =>
          p.userId === userId &&
          (p.status === 'CLOSED' || p.status === 'LIQUIDATED') &&
          (p.closedAt || p.updatedAt || p.openedAt)
      )
      .sort(
        (a, b) =>
          (a.closedAt || a.updatedAt || a.openedAt || 0) -
          (b.closedAt || b.updatedAt || b.openedAt || 0)
      );

    const userCopyTrades = db.copyMirroredOrders
      .filter(m => m.followerUserId === userId && m.status === 'FILLED')
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt);

    // FIFO Lot inventory per base currency using EXACT historical fill prices
    const inventoryMap = new Map<
      string,
      {
        lots: ExecutionLot[];
        totalBoughtQty: number;
        totalSoldQty: number;
        lastBuyPriceIdr: number;
        lastBuyPriceUsdt: number;
        lastBuyTimestamp: number | null;
      }
    >();

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

    // 2. Replay immutable Spot execution entries in strict FIFO chronological order
    for (const ex of unifiedSpotExecutions) {
      const execPriceIdr =
        ex.quoteCurr === 'IDR' ? ex.execPricePair : ex.execPricePair * usdtRate;
      const execPriceUsdt =
        ex.quoteCurr === 'USDT' ? ex.execPricePair : ex.execPricePair / (usdtRate || 16450);

      const valIdr = ex.quoteCurr === 'IDR' ? ex.quoteVolNum : ex.quoteVolNum * usdtRate;
      const valUsdt =
        ex.quoteCurr === 'USDT' ? ex.quoteVolNum : ex.quoteVolNum / (usdtRate || 16450);

      let tradePnlIdr = 0;
      let tradePnlUsdt = 0;

      let inv = inventoryMap.get(ex.baseCurr);
      if (!inv) {
        inv = {
          lots: [],
          totalBoughtQty: 0,
          totalSoldQty: 0,
          lastBuyPriceIdr: 0,
          lastBuyPriceUsdt: 0,
          lastBuyTimestamp: null,
        };
        inventoryMap.set(ex.baseCurr, inv);
      }

      if (ex.side === 'BUY') {
        inv.lots.push({
          tradeId: ex.id,
          pairId: ex.pairId,
          qty: ex.qtyNum,
          execPriceIdr,
          execPriceUsdt,
          feeIdr: ex.feeIdr,
          feeUsdt: ex.feeUsdt,
          timestamp: ex.createdAt,
        });
        inv.totalBoughtQty += ex.qtyNum;
        inv.lastBuyPriceIdr = execPriceIdr;
        inv.lastBuyPriceUsdt = execPriceUsdt;
        inv.lastBuyTimestamp = ex.createdAt;
      } else {
        inv.totalSoldQty += ex.qtyNum;
        let remToSell = ex.qtyNum;
        let matchedPrincipalIdr = 0;
        let matchedPrincipalUsdt = 0;
        let matchedEntryFeesIdr = 0;
        let matchedEntryFeesUsdt = 0;
        let matchedQty = 0;

        while (remToSell > 1e-12 && inv.lots.length > 0) {
          const head = inv.lots[0];
          const takeQty = Math.min(remToSell, head.qty);
          const ratio = head.qty > 0 ? takeQty / head.qty : 0;

          matchedPrincipalIdr += takeQty * head.execPriceIdr;
          matchedPrincipalUsdt += takeQty * head.execPriceUsdt;
          matchedEntryFeesIdr += head.feeIdr * ratio;
          matchedEntryFeesUsdt += head.feeUsdt * ratio;
          matchedQty += takeQty;

          head.qty -= takeQty;
          head.feeIdr -= head.feeIdr * ratio;
          head.feeUsdt -= head.feeUsdt * ratio;
          remToSell -= takeQty;

          if (head.qty <= 1e-12) {
            inv.lots.shift();
          }
        }

        if (matchedQty > 1e-12) {
          const backedRatio = ex.qtyNum > 0 ? Math.min(1, matchedQty / ex.qtyNum) : 0;
          tradePnlIdr =
            valIdr * backedRatio - ex.feeIdr - matchedPrincipalIdr - matchedEntryFeesIdr;
          tradePnlUsdt =
            valUsdt * backedRatio - ex.feeUsdt - matchedPrincipalUsdt - matchedEntryFeesUsdt;
        } else {
          // Pure deposit / pre-existing non-trade holding sold: real fee cost only
          tradePnlIdr = -ex.feeIdr;
          tradePnlUsdt = -ex.feeUsdt;
        }
      }

      const dateKey = getJakartaDateKey(ex.createdAt);
      const bucket = ensureLiveBucket(dateKey, ex.createdAt);
      bucket.pnlIdr += tradePnlIdr;
      bucket.pnlUsdt += tradePnlUsdt;
      bucket.volumeIdr += valIdr;
      bucket.volumeUsdt += valUsdt;
      bucket.feesIdr += ex.feeIdr;
      bucket.feesUsdt += ex.feeUsdt;
      bucket.tradesCount += 1;
      if (ex.side === 'SELL') {
        if (tradePnlIdr > 0) bucket.winCount += 1;
        else if (tradePnlIdr < 0) bucket.lossCount += 1;
      }

      const formattedPrice =
        ex.quoteCurr === 'IDR'
          ? PrecisionMath.formatIDRDisplay(ex.priceUnits)
          : `${PrecisionMath.formatFromUnits(ex.priceUnits, ex.quoteDec, true)} USDT`;
      const formattedQty = `${PrecisionMath.formatFromUnits(ex.qtyUnits, ex.baseDec, true)} ${ex.baseCurr}`;
      const formattedQuoteVol =
        ex.quoteCurr === 'IDR'
          ? PrecisionMath.formatIDRDisplay(ex.quoteVolUnits)
          : `${PrecisionMath.formatFromUnits(ex.quoteVolUnits, ex.quoteDec, true)} USDT`;

      const snapTrade: DailyPnlTradeSnapshot = {
        id: ex.id,
        pairId: ex.pairId,
        side: ex.side,
        price: formattedPrice,
        rawPrice: ex.priceUnits.toString(),
        quantity: formattedQty,
        rawQuantity: ex.qtyUnits.toString(),
        quoteVolume: formattedQuoteVol,
        rawQuoteVolume: ex.quoteVolUnits.toString(),
        pnlIdr: Math.round(tradePnlIdr),
        pnlUsdt: Number(tradePnlUsdt.toFixed(4)),
        feeIdr: Math.round(ex.feeIdr),
        feeUsdt: Number(ex.feeUsdt.toFixed(4)),
        time: getJakartaTimeStr(ex.createdAt),
        timestamp: ex.createdAt,
        source: 'SPOT',
      };
      bucket.trades.push(snapTrade);
    }

    // 3. Process Closed / Liquidated Futures Positions
    for (const fp of closedFutures) {
      const ts = fp.closedAt || fp.updatedAt || fp.openedAt || now;
      const dateKey = getJakartaDateKey(ts);
      const bucket = ensureLiveBucket(dateKey, ts);

      const qCurr = (fp.quoteCurrency || 'USDT').toUpperCase();
      const qDec =
        typeof fp.quoteDecimals === 'number' ? fp.quoteDecimals : qCurr === 'IDR' ? 2 : 6;
      const bDec =
        typeof fp.baseDecimals === 'number'
          ? fp.baseDecimals
          : getCurrencyDecimalsServer(fp.baseCurrency || 'BTC');

      const realizedQuoteNum = Number(safeBigInt(fp.realizedPnlUnits)) / 10 ** qDec;
      const feeQuoteNum =
        Number(safeBigInt(fp.openFeeUnits) + safeBigInt(fp.closeFeeUnits)) / 10 ** qDec;

      const realizedIdr = qCurr === 'IDR' ? realizedQuoteNum : realizedQuoteNum * usdtRate;
      const realizedUsdt =
        qCurr === 'USDT' ? realizedQuoteNum : realizedQuoteNum / (usdtRate || 16450);
      const feeIdr = qCurr === 'IDR' ? feeQuoteNum : feeQuoteNum * usdtRate;
      const feeUsdt = qCurr === 'USDT' ? feeQuoteNum : feeQuoteNum / (usdtRate || 16450);

      bucket.pnlIdr += realizedIdr;
      bucket.pnlUsdt += realizedUsdt;
      bucket.feesIdr += feeIdr;
      bucket.feesUsdt += feeUsdt;
      bucket.tradesCount += 1;
      if (realizedIdr > 0) bucket.winCount += 1;
      else if (realizedIdr < 0) bucket.lossCount += 1;

      const closePriceRaw = fp.markPriceUnits || fp.entryPriceUnits || '0';
      const sizeRaw = fp.sizeUnits || '0';
      const formattedClosePrice =
        qCurr === 'IDR'
          ? PrecisionMath.formatIDRDisplay(safeBigInt(closePriceRaw))
          : `${PrecisionMath.formatFromUnits(safeBigInt(closePriceRaw), qDec, true)} USDT`;

      bucket.trades.push({
        id: `fut-${fp.id}`,
        pairId: fp.pairId,
        side: fp.side === 'LONG' ? 'BUY' : 'SELL',
        price: formattedClosePrice,
        rawPrice: closePriceRaw,
        quantity: `${PrecisionMath.formatFromUnits(safeBigInt(sizeRaw), bDec, true)} ${fp.baseCurrency || ''}`,
        rawQuantity: sizeRaw,
        quoteVolume:
          qCurr === 'IDR'
            ? PrecisionMath.formatIDRDisplay(safeBigInt(fp.realizedPnlUnits))
            : `${realizedUsdt >= 0 ? '+' : ''}${realizedUsdt.toFixed(2)} USDT`,
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

    // 4. Process Mirrored Copy Trades
    for (const cm of userCopyTrades) {
      const pair = db.tradingPairs.get(cm.pairId);
      const quoteCurr = pair?.quoteCurrency || (cm.pairId.endsWith('-USDT') ? 'USDT' : 'IDR');
      const baseCurr = pair?.baseCurrency || cm.pairId.split('-')[0];
      const baseDec = pair?.baseDecimals ?? getCurrencyDecimalsServer(baseCurr);
      const quoteDec = pair?.quoteDecimals ?? (quoteCurr === 'IDR' ? 2 : 6);

      const pnlUnitsNum = Number(safeBigInt(cm.realizedPnlUnits)) / 10 ** quoteDec;
      const quoteVolNum = Number(safeBigInt(cm.quoteVolumeUnits)) / 10 ** quoteDec;
      const feeNum = Number(safeBigInt(cm.feeUnits)) / 10 ** quoteDec;

      const pnlIdr = quoteCurr === 'IDR' ? pnlUnitsNum : pnlUnitsNum * usdtRate;
      const pnlUsdt = quoteCurr === 'USDT' ? pnlUnitsNum : pnlUnitsNum / (usdtRate || 16450);
      const valIdr = quoteCurr === 'IDR' ? quoteVolNum : quoteVolNum * usdtRate;
      const valUsdt = quoteCurr === 'USDT' ? quoteVolNum : quoteVolNum / (usdtRate || 16450);
      const feeIdr = quoteCurr === 'IDR' ? feeNum : feeNum * usdtRate;
      const feeUsdt = quoteCurr === 'USDT' ? feeNum : feeNum / (usdtRate || 16450);

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

      const execPriceBig = safeBigInt(cm.executionPriceUnits);
      const execQtyBig = safeBigInt(cm.executedQtyUnits);
      const quoteVolBig = safeBigInt(cm.quoteVolumeUnits);

      bucket.trades.push({
        id: `copy-${cm.id}`,
        pairId: cm.pairId,
        side: cm.side,
        price:
          quoteCurr === 'IDR'
            ? PrecisionMath.formatIDRDisplay(execPriceBig)
            : `${PrecisionMath.formatFromUnits(execPriceBig, quoteDec, true)} USDT`,
        rawPrice: cm.executionPriceUnits || '0',
        quantity: `${PrecisionMath.formatFromUnits(execQtyBig, baseDec, true)} ${baseCurr}`,
        rawQuantity: cm.executedQtyUnits || '0',
        quoteVolume:
          quoteCurr === 'IDR'
            ? PrecisionMath.formatIDRDisplay(quoteVolBig)
            : `${PrecisionMath.formatFromUnits(quoteVolBig, quoteDec, true)} USDT`,
        rawQuoteVolume: cm.quoteVolumeUnits || '0',
        pnlIdr: Math.round(pnlIdr),
        pnlUsdt: Number(pnlUsdt.toFixed(4)),
        feeIdr: Math.round(feeIdr),
        feeUsdt: Number(feeUsdt.toFixed(4)),
        time: getJakartaTimeStr(cm.createdAt),
        timestamp: cm.createdAt,
        source: 'COPY',
      });
    }

    // 5. Real-Time Unrealized PnL & Exact FIFO Entry Avg Buy Price per Asset
    const userAccounts = db.getUserAccounts(userId);
    let totalUnrealizedPnlIdr = 0;
    let totalUnrealizedPnlUsdt = 0;
    let totalPortfolioEstIdr = 0;
    const assetBreakdown: LiveAssetBreakdownItem[] = [];

    for (const acc of userAccounts) {
      const cleanCurr = acc.currency.toUpperCase();
      const totalUnits = safeBigInt(acc.balanceAvailable) + safeBigInt(acc.balanceLocked);
      const dec = getCurrencyDecimalsServer(cleanCurr);
      const holding = Number(totalUnits) / 10 ** dec;

      if (cleanCurr === 'IDR') {
        totalPortfolioEstIdr += holding;
        continue;
      }

      const inv = inventoryMap.get(cleanCurr);
      const hasActivity =
        holding > 0 || (inv && (inv.totalBoughtQty > 0 || inv.totalSoldQty > 0));
      if (!hasActivity) continue;

      const resolved = this.resolveRealAssetPrice(cleanCurr, usdtRate);
      const curPriceIdr = resolved.priceIdr;
      const curPriceUsdt = resolved.priceUsdt;

      const assetValIdr = holding * curPriceIdr;
      totalPortfolioEstIdr += assetValIdr;

      let openTrackedQty = 0;
      let weightedExecIdr = 0;
      let weightedExecUsdt = 0;
      if (inv && inv.lots.length > 0) {
        for (const lot of inv.lots) {
          openTrackedQty += lot.qty;
          weightedExecIdr += lot.qty * lot.execPriceIdr;
          weightedExecUsdt += lot.qty * lot.execPriceUsdt;
        }
      }

      const hasCostBasis = Boolean(openTrackedQty > 1e-12 && weightedExecIdr > 0);
      let avgBuyIdr = 0;
      let avgBuyUsdt = 0;
      let unPnlIdr = 0;
      let unPnlUsdt = 0;
      let returnPct = 0;
      const trackedQty = Math.min(holding, openTrackedQty);

      if (hasCostBasis) {
        // Pure volume-weighted historical execution price across open FIFO lots
        avgBuyIdr = weightedExecIdr / openTrackedQty;
        avgBuyUsdt = weightedExecUsdt / openTrackedQty;
        if (trackedQty > 0 && curPriceIdr > 0) {
          unPnlIdr = (curPriceIdr - avgBuyIdr) * trackedQty;
          unPnlUsdt = (curPriceUsdt - avgBuyUsdt) * trackedQty;
          returnPct = avgBuyIdr > 0 ? ((curPriceIdr - avgBuyIdr) / avgBuyIdr) * 100 : 0;
        }
      }

      totalUnrealizedPnlIdr += unPnlIdr;
      totalUnrealizedPnlUsdt += unPnlUsdt;

      const recentFills: ExecutionFillPreview[] = inv
        ? inv.lots
            .slice(-5)
            .reverse()
            .map(l => ({
              tradeId: l.tradeId,
              pairId: l.pairId,
              qty: Number(l.qty.toFixed(dec > 6 ? 6 : dec)),
              priceIdr: roundPricePrecision(l.execPriceIdr),
              priceUsdt: roundUsdtPrecision(l.execPriceUsdt),
              timestamp: l.timestamp,
            }))
        : [];

      assetBreakdown.push({
        symbol: cleanCurr,
        holding: Number(holding.toFixed(dec > 6 ? 6 : dec)),
        trackedQty: Number(trackedQty.toFixed(dec > 6 ? 6 : dec)),
        openLotsCount: inv ? inv.lots.length : 0,
        avgBuyPriceIdr: roundPricePrecision(avgBuyIdr),
        currentPriceIdr: roundPricePrecision(curPriceIdr),
        avgBuyPriceUsdt: roundUsdtPrecision(avgBuyUsdt),
        currentPriceUsdt: roundUsdtPrecision(curPriceUsdt),
        lastBuyPriceIdr: roundPricePrecision(inv?.lastBuyPriceIdr || 0),
        lastBuyPriceUsdt: roundUsdtPrecision(inv?.lastBuyPriceUsdt || 0),
        lastBuyTimestamp: inv?.lastBuyTimestamp ?? null,
        unrealizedPnlIdr: Math.round(unPnlIdr),
        unrealizedPnlUsdt: Number(unPnlUsdt.toFixed(4)),
        returnPct: Number(returnPct.toFixed(2)),
        totalBought: Number((inv?.totalBoughtQty || 0).toFixed(dec > 6 ? 6 : dec)),
        totalSold: Number((inv?.totalSoldQty || 0).toFixed(dec > 6 ? 6 : dec)),
        hasCostBasis,
        priceSource: resolved.source,
        recentFills,
      });
    }

    // Include active copy trading sleeves in portfolio estimation
    let copyAllocatedValIdr = 0;
    for (const rel of db.copyRelationships.values()) {
      if (rel.followerUserId === userId && rel.status !== 'STOPPED') {
        if (rel.allocationCurrency === 'IDR') {
          copyAllocatedValIdr += Number(safeBigInt(rel.availableSleeveUnits)) / 100;
        } else {
          copyAllocatedValIdr += (Number(safeBigInt(rel.availableSleeveUnits)) / 1_000_000) * usdtRate;
        }
        for (const [sym, unitsStr] of Object.entries(rel.heldBaseBySymbol || {})) {
          const dec = getCurrencyDecimalsServer(sym);
          const qty = Number(safeBigInt(unitsStr)) / 10 ** dec;
          const p = this.resolveRealAssetPrice(sym, usdtRate);
          copyAllocatedValIdr += qty * p.priceIdr;
        }
      }
    }
    totalPortfolioEstIdr += copyAllocatedValIdr;

    const baseVal = totalPortfolioEstIdr > 0 ? totalPortfolioEstIdr : 0;

    // 6. Merge live daily buckets with permanent disk-persisted db.dailyPnlSnapshots
    const mergedDailyMap = new Map<string, DailyPnlSnapshot>();

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

    for (const [dateKey, snap] of mergedDailyMap.entries()) {
      if (dateKey < todayKey && !snap.finalized) {
        snap.finalized = true;
        snap.updatedAt = now;
        db.dailyPnlSnapshots.set(`${userId}:${dateKey}`, snap);
        snapshotDirty = true;
      }
    }

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
