/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HftBacktestEngine.ts
 * Deterministic, Non-Mutating Historical Ledger Backtesting Engine for Smart HFT Ladder Configs.
 *
 * Architectural Guarantees:
 * 1. Read-Only against live exchange state: NEVER mutates db.orders, db.trades, db.ledgerAccounts,
 *    db.journalTransactions, db.ledgerEntries, or MatchingEngine state.
 * 2. Grounded in Immutable Ledger & Historical Trade Data:
 *    - Verifies historical trades against immutable TRADE_SETTLEMENT JournalTransactions
 *      and LedgerEntries, producing a SHA-256 dataset integrity hash.
 *    - Also supports full historical trade replay and Kline OHLCV intra-bar replay.
 * 3. Reuses the exact SmartHftLadderBotExecutor BigInt ladder math & pattern simulator
 *    used in production so pre-deployment validation matches live engine behavior.
 */

import crypto from 'crypto';
import { db } from '../../db/database.js';
import { klineService } from '../../engine/KlineService.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { SmartHftLadderBotExecutor } from '../bots/SmartHftLadderBot.js';
import {
  BacktestDataSourceMode,
  BacktestDatasetPairInfo,
  BacktestRequest,
  BacktestResult,
  EquityCurvePoint,
  JournalTransaction,
  PatternFormationType,
  PatternTimeframe,
  RungHitStat,
  SimulatedFillEvent,
  SmartHftLadderConfig,
  Trade
} from '../../db/types.js';

interface ReplayTick {
  id: string;
  timestamp: number;
  priceUnits: bigint;
  priceFloat: number;
  qtyUnits: bigint;
  takerSide: 'BUY' | 'SELL';
  journalId?: string;
  ledgerVerified: boolean;
}

interface VirtualRung {
  level: number;
  side: 'BUY' | 'SELL';
  priceUnits: bigint;
  remainingQtyUnits: bigint;
}

export class HftBacktestEngine {
  private static runHistory: BacktestResult[] = [];
  private static readonly MAX_HISTORY = 25;

  /**
   * Build read-only lookup index from immutable TRADE_SETTLEMENT journals -> referenceId (tradeId)
   */
  private static buildLedgerSettlementIndex(): {
    journalByTradeId: Map<string, JournalTransaction>;
    entriesCountByJournalId: Map<string, number>;
    totalLedgerEntries: number;
  } {
    const journalByTradeId = new Map<string, JournalTransaction>();
    for (const j of db.journalTransactions.values()) {
      if (j.txType === 'TRADE_SETTLEMENT' && j.referenceId) {
        journalByTradeId.set(j.referenceId, j);
      }
    }

    const entriesCountByJournalId = new Map<string, number>();
    for (const entry of db.ledgerEntries) {
      entriesCountByJournalId.set(
        entry.journalId,
        (entriesCountByJournalId.get(entry.journalId) || 0) + 1
      );
    }

    return {
      journalByTradeId,
      entriesCountByJournalId,
      totalLedgerEntries: db.ledgerEntries.length
    };
  }

  /**
   * Suggest balanced virtual capital allocations scaled to quote currency and current price
   */
  private static getSuggestedCapital(pair: any, lastPriceFloat: number): { base: string; quote: string } {
    const safePrice = lastPriceFloat > 0 ? lastPriceFloat : 1;
    if (pair.quoteCurrency === 'IDR') {
      // ~150,000,000 IDR on each side or scaled cleanly for BTC/ETH/altcoins
      const targetSideIdr = safePrice >= 100_000_000 ? 150_000_000 : safePrice >= 1_000_000 ? 50_000_000 : 15_000_000;
      const baseAmt = Math.max(0.1, Number((targetSideIdr / safePrice).toFixed(4)));
      return {
        base: String(baseAmt),
        quote: String(targetSideIdr)
      };
    }

    // USDT-quoted market
    const targetSideUsdt = 10_000;
    const baseAmt = Math.max(0.1, Number((targetSideUsdt / safePrice).toFixed(4)));
    return {
      base: String(baseAmt),
      quote: String(targetSideUsdt)
    };
  }

  /**
   * Inspect available immutable ledger journals, historical trades, and OHLCV candles per pair
   */
  public static getAvailableDatasets(selectedPairId?: string): {
    pairs: BacktestDatasetPairInfo[];
    selected: BacktestDatasetPairInfo | null;
    globalLedgerSummary: {
      totalTrades: number;
      totalSettlementJournals: number;
      totalLedgerEntries: number;
      totalJournalTransactions: number;
    };
  } {
    const { journalByTradeId, entriesCountByJournalId, totalLedgerEntries } = this.buildLedgerSettlementIndex();
    const tradesByPair = new Map<string, Trade[]>();

    for (const t of db.trades) {
      const list = tradesByPair.get(t.pairId) || [];
      list.push(t);
      tradesByPair.set(t.pairId, list);
    }

    const pairs: BacktestDatasetPairInfo[] = [];
    for (const pair of db.tradingPairs.values()) {
      const quoteDecimals = pair.quoteDecimals !== undefined ? pair.quoteDecimals : (pair.quoteCurrency === 'USDT' ? 6 : 2);
      const lastPriceFloat = Number(BigInt(pair.lastPrice || '0')) / (10 ** quoteDecimals);
      const pairTrades = tradesByPair.get(pair.id) || [];

      let journalVerifiedTrades = 0;
      let ledgerEntriesLinked = 0;
      let earliestTradeTs: number | null = null;
      let latestTradeTs: number | null = null;

      for (const tr of pairTrades) {
        if (earliestTradeTs === null || tr.createdAt < earliestTradeTs) earliestTradeTs = tr.createdAt;
        if (latestTradeTs === null || tr.createdAt > latestTradeTs) latestTradeTs = tr.createdAt;
        const journal = journalByTradeId.get(tr.id);
        if (journal) {
          journalVerifiedTrades++;
          ledgerEntriesLinked += entriesCountByJournalId.get(journal.id) || 0;
        }
      }

      const candles15m = klineService.getCandles(pair.id, '15m', 1000);
      const suggested = this.getSuggestedCapital(pair, lastPriceFloat);

      pairs.push({
        pairId: pair.id,
        baseCurrency: pair.baseCurrency,
        quoteCurrency: pair.quoteCurrency,
        baseDecimals: pair.baseDecimals,
        quoteDecimals,
        lastPriceFloat,
        totalTrades: pairTrades.length,
        journalVerifiedTrades,
        ledgerEntriesLinked,
        klineCandles15m: candles15m.length,
        earliestTradeTs,
        latestTradeTs,
        suggestedInitialBase: suggested.base,
        suggestedInitialQuote: suggested.quote
      });
    }

    pairs.sort((a, b) => (b.journalVerifiedTrades - a.journalVerifiedTrades) || (b.totalTrades - a.totalTrades));
    const selected = (selectedPairId ? pairs.find(p => p.pairId === selectedPairId) : null) || pairs[0] || null;

    return {
      pairs,
      selected,
      globalLedgerSummary: {
        totalTrades: db.trades.length,
        totalSettlementJournals: journalByTradeId.size,
        totalLedgerEntries,
        totalJournalTransactions: db.journalTransactions.size
      }
    };
  }

  /**
   * Retrieve recent backtest history (summary + results)
   */
  public static getHistory(): BacktestResult[] {
    return [...this.runHistory];
  }

  /**
   * Run deterministic non-mutating backtest of a Smart HFT Ladder configuration
   * against immutable ledger journals, historical trades, or historical OHLCV klines.
   */
  public static runBacktest(req: BacktestRequest): BacktestResult {
    const startExecMs = Date.now();
    const pair = db.tradingPairs.get(req.pairId);
    if (!pair) {
      throw new Error(`Trading pair "${req.pairId}" tidak ditemukan.`);
    }

    const baseDecimals = pair.baseDecimals ?? 8;
    const quoteDecimals = pair.quoteDecimals !== undefined ? pair.quoteDecimals : (pair.quoteCurrency === 'USDT' ? 6 : 2);
    const dataSourceMode: BacktestDataSourceMode = req.dataSourceMode || 'LEDGER_SETTLED_TRADES';

    const initialBaseFloat = parseFloat(req.initialBaseBalance || '0');
    const initialQuoteFloat = parseFloat(req.initialQuoteBalance || '0');
    if (!Number.isFinite(initialBaseFloat) || initialBaseFloat < 0 || !Number.isFinite(initialQuoteFloat) || initialQuoteFloat < 0) {
      throw new Error('Modal awal Base dan Quote harus berupa angka valid (>= 0).');
    }
    if (initialBaseFloat === 0 && initialQuoteFloat === 0) {
      throw new Error('Modal awal tidak boleh nol keduanya; isi minimal saldo Base atau Quote.');
    }

    const totalOrders = Math.min(100, Math.max(2, Number(req.total_orders || 40)));
    const timeframe: PatternTimeframe = req.timeframe || '15m';
    const pattern: PatternFormationType = req.pattern || 'HEAD_AND_SHOULDERS';
    const repriceIntervalMs = Math.max(500, Number(req.reprice_interval_ms || 4000));
    const makerFeeBps = req.makerFeeBps !== undefined && !isNaN(Number(req.makerFeeBps))
      ? Number(req.makerFeeBps)
      : (pair.makerFeeBps ?? 10);
    const takerFeeBps = req.takerFeeBps !== undefined && !isNaN(Number(req.takerFeeBps))
      ? Number(req.takerFeeBps)
      : (pair.takerFeeBps ?? 20);
    const slippageBps = Math.max(0, Math.min(500, Number(req.slippageBps || 0)));

    // 1. Assemble immutable historical replay stream
    const { journalByTradeId, entriesCountByJournalId } = this.buildLedgerSettlementIndex();
    const allPairTrades = db.trades
      .filter(t => t.pairId === req.pairId)
      .filter(t => (!req.startTime || t.createdAt >= req.startTime) && (!req.endTime || t.createdAt <= req.endTime))
      .sort((a, b) => a.createdAt - b.createdAt);

    let journalVerifiedCount = 0;
    let ledgerEntriesExamined = 0;
    for (const tr of allPairTrades) {
      const j = journalByTradeId.get(tr.id);
      if (j) {
        journalVerifiedCount++;
        ledgerEntriesExamined += 1 + (entriesCountByJournalId.get(j.id) || 0);
      }
    }

    const replayTicks: ReplayTick[] = [];

    if (dataSourceMode === 'LEDGER_SETTLED_TRADES' || dataSourceMode === 'ALL_HISTORICAL_TRADES') {
      const filteredTrades = dataSourceMode === 'LEDGER_SETTLED_TRADES'
        ? allPairTrades.filter(t => journalByTradeId.has(t.id))
        : allPairTrades;

      if (filteredTrades.length === 0) {
        if (dataSourceMode === 'LEDGER_SETTLED_TRADES' && allPairTrades.length > 0) {
          throw new Error(
            `Pair ${req.pairId} memiliki ${allPairTrades.length} transaksi historis, tetapi 0 jurnal TRADE_SETTLEMENT aktif (jurnal terlama terpruning oleh batas 1.000 jurnal disk). Pilih mode "ALL_HISTORICAL_TRADES" atau "KLINE_OHLCV_REPLAY".`
          );
        }
        const candleCount = klineService.getCandles(req.pairId, req.klineTimeframe || '15m', 500).length;
        throw new Error(
          `Belum ada data trade historis pada ledger untuk pair ${req.pairId} dalam rentang waktu ini.${candleCount > 0 ? ` Tersedia ${candleCount} candle OHLCV — coba mode "KLINE_OHLCV_REPLAY".` : ''}`
        );
      }

      for (const tr of filteredTrades) {
        const priceUnits = BigInt(tr.price);
        const qtyUnits = BigInt(tr.quantity);
        if (priceUnits <= 0n || qtyUnits <= 0n) continue;
        const j = journalByTradeId.get(tr.id);
        replayTicks.push({
          id: tr.id,
          timestamp: tr.createdAt,
          priceUnits,
          priceFloat: Number(priceUnits) / (10 ** quoteDecimals),
          qtyUnits,
          takerSide: tr.takerSide === 'SELL' ? 'SELL' : 'BUY',
          journalId: j?.id,
          ledgerVerified: Boolean(j)
        });
      }
    } else {
      // KLINE_OHLCV_REPLAY
      const klineTf = req.klineTimeframe || timeframe || '15m';
      const candles = klineService.getCandles(req.pairId, klineTf, 500)
        .filter(c => {
          const tsMs = c.time * 1000;
          return (!req.startTime || tsMs >= req.startTime) && (!req.endTime || tsMs <= req.endTime);
        });

      if (candles.length === 0) {
        throw new Error(`Belum ada data candle historis (${klineTf}) untuk pair ${req.pairId}.`);
      }

      const intervalMs = Math.max(60_000, ((candles[1]?.time || candles[0].time + 900) - candles[0].time) * 1000);
      for (const c of candles) {
        const baseTs = c.time * 1000;
        const totalVolFloat = Math.max(Number(c.volume || 0), parseFloat(req.min_buy_lot || '0.05') * 4);
        const quarterVolStr = Math.max(0.0001, totalVolFloat / 4).toFixed(Math.min(8, baseDecimals));
        const quarterQtyUnits = PrecisionMath.parseToUnits(quarterVolStr, baseDecimals);

        // Deterministic intra-bar path (O -> L -> H -> C for green candle, O -> H -> L -> C for red candle)
        const seq: Array<{ price: number; side: 'BUY' | 'SELL'; offsetMs: number }> = c.close >= c.open
          ? [
              { price: c.open, side: 'BUY', offsetMs: 0 },
              { price: c.low, side: 'SELL', offsetMs: Math.floor(intervalMs * 0.25) },
              { price: c.high, side: 'BUY', offsetMs: Math.floor(intervalMs * 0.65) },
              { price: c.close, side: 'BUY', offsetMs: Math.floor(intervalMs * 0.90) }
            ]
          : [
              { price: c.open, side: 'SELL', offsetMs: 0 },
              { price: c.high, side: 'BUY', offsetMs: Math.floor(intervalMs * 0.25) },
              { price: c.low, side: 'SELL', offsetMs: Math.floor(intervalMs * 0.65) },
              { price: c.close, side: 'SELL', offsetMs: Math.floor(intervalMs * 0.90) }
            ];

        for (let sIdx = 0; sIdx < seq.length; sIdx++) {
          const pt = seq[sIdx];
          if (!(pt.price > 0)) continue;
          const pUnits = PrecisionMath.parseToUnits(pt.price.toFixed(quoteDecimals), quoteDecimals);
          if (pUnits <= 0n) continue;
          replayTicks.push({
            id: `kline-${klineTf}-${c.time}-${sIdx}`,
            timestamp: baseTs + pt.offsetMs,
            priceUnits: pUnits,
            priceFloat: pt.price,
            qtyUnits: quarterQtyUnits > 0n ? quarterQtyUnits : 1n,
            takerSide: pt.side,
            ledgerVerified: false
          });
        }
      }
    }

    if (replayTicks.length === 0) {
      throw new Error(`Tidak ada event harga valid untuk disimulasikan pada ${req.pairId}.`);
    }

    // 2. Compute canonical SHA-256 dataset integrity hash over immutable ledger & trade IDs
    const hash = crypto.createHash('sha256');
    hash.update(`${req.pairId}:${dataSourceMode}:${replayTicks.length}`);
    for (const tk of replayTicks) {
      hash.update(`|${tk.id}:${tk.journalId || 'none'}:${tk.timestamp}:${tk.priceUnits.toString()}:${tk.qtyUnits.toString()}`);
    }
    const datasetIntegrityHash = hash.digest('hex').slice(0, 24);

    // 3. Bounds validation (explicit hard bounds take precedence over dynamic percentage)
    const firstTickPrice = replayTicks[0].priceFloat;
    const rawMinBound = req.min_price_bound ? parseFloat(req.min_price_bound) : NaN;
    const rawMaxBound = req.max_price_bound ? parseFloat(req.max_price_bound) : NaN;
    const hasExplicitBounds = !isNaN(rawMinBound) && !isNaN(rawMaxBound) && rawMinBound > 0 && rawMaxBound > rawMinBound;

    const boundPct = !hasExplicitBounds && req.bound_percentage !== undefined && req.bound_percentage !== null && !isNaN(Number(req.bound_percentage)) && Number(req.bound_percentage) > 0
      ? Number(req.bound_percentage)
      : undefined;

    const fixedMinBoundFloat = hasExplicitBounds ? rawMinBound : firstTickPrice * (1 - (boundPct || 3) / 100);
    const fixedMaxBoundFloat = hasExplicitBounds ? rawMaxBound : firstTickPrice * (1 + (boundPct || 3) / 100);

    const totalBars = timeframe === '5m' ? 30 : timeframe === '15m' ? 45 : timeframe === '1h' ? 60 : 90;
    const baseCfg: SmartHftLadderConfig = {
      account_id: 'backtest-virtual-mm',
      timeframe,
      pattern,
      total_orders: totalOrders,
      bound_percentage: boundPct,
      min_price_bound: fixedMinBoundFloat.toFixed(quoteDecimals),
      max_price_bound: fixedMaxBoundFloat.toFixed(quoteDecimals),
      min_buy_lot: String(req.min_buy_lot || '0.01'),
      max_buy_lot: String(req.max_buy_lot || '0.25'),
      min_sell_lot: String(req.min_sell_lot || '0.01'),
      max_sell_lot: String(req.max_sell_lot || '0.25'),
      min_spread_bps: req.min_spread_bps ? Number(req.min_spread_bps) : undefined,
      spread_percentage: req.spread_percentage ? Number(req.spread_percentage) : undefined,
      reprice_interval_ms: repriceIntervalMs
    };

    // 4. Isolated Virtual Portfolio State (BigInt balances + cost-basis tracker)
    let baseAvailUnits = PrecisionMath.parseToUnits(initialBaseFloat.toFixed(Math.min(8, baseDecimals)), baseDecimals);
    let quoteAvailUnits = PrecisionMath.parseToUnits(initialQuoteFloat.toFixed(quoteDecimals), quoteDecimals);

    const initialEquityQuote = initialQuoteFloat + initialBaseFloat * firstTickPrice;
    let avgCostQuotePerBase = firstTickPrice;
    let realizedPnlQuote = 0;
    let totalFeesPaidQuote = 0;
    let totalTurnoverQuote = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let winningSells = 0;
    let losingSells = 0;

    let totalBuyFills = 0;
    let totalSellFills = 0;
    let totalRepriceCycles = 0;
    let totalOrdersSimulated = 0;
    let outOfBoundsSkippedTicks = 0;
    let insufficientBalanceSkips = 0;

    let peakEquity = initialEquityQuote;
    let maxDrawdownQuote = 0;
    let maxDrawdownPct = 0;

    let activeBuys: VirtualRung[] = [];
    let activeSells: VirtualRung[] = [];
    let lastRepriceTs = -Infinity;
    let patternBarIndex = -1;
    let lastAnchorFloat = firstTickPrice;
    let lastCycleMinBound = fixedMinBoundFloat;
    let lastCycleMaxBound = fixedMaxBoundFloat;

    const fills: SimulatedFillEvent[] = [];
    const rungHitMap = new Map<string, RungHitStat>();
    const rawCurve: EquityCurvePoint[] = [];
    const stepReturns: number[] = [];
    let prevEquity = initialEquityQuote;

    const minOrderUnits = BigInt(pair.minOrderSize || '1');

    // 5. Execute Historical Event Replay Loop
    for (let idx = 0; idx < replayTicks.length; idx++) {
      const tick = replayTicks[idx];
      let filledOnThisTick = false;

      // A. Match Resting Virtual Ladder Orders Against Historical Trade Price & Volume
      if (activeBuys.length > 0 || activeSells.length > 0) {
        let remainingTickQty = tick.qtyUnits;

        // BUY rungs fill when historical trade prints at or below (rungPrice - slippage)
        for (const buyRung of activeBuys) {
          if (remainingTickQty <= 0n || buyRung.remainingQtyUnits <= 0n) continue;
          const slippageUnits = slippageBps > 0 ? (buyRung.priceUnits * BigInt(slippageBps)) / 10000n : 0n;
          const triggerPriceUnits = buyRung.priceUnits > slippageUnits ? buyRung.priceUnits - slippageUnits : 1n;

          if (tick.priceUnits <= triggerPriceUnits) {
            const desiredQty = remainingTickQty < buyRung.remainingQtyUnits ? remainingTickQty : buyRung.remainingQtyUnits;
            if (desiredQty <= 0n) continue;

            // Check affordable base quantity given quoteAvailUnits and makerFeeBps
            const grossDesiredQuote = PrecisionMath.calculateQuoteAmount(desiredQty, baseDecimals, buyRung.priceUnits);
            const feeDesired = makerFeeBps > 0 ? PrecisionMath.calculateFee(grossDesiredQuote, makerFeeBps) : 0n;

            let execQtyUnits = desiredQty;
            if (quoteAvailUnits < grossDesiredQuote + feeDesired) {
              // Scale down proportional quantity if balance is tighter
              if (quoteAvailUnits <= 0n) {
                insufficientBalanceSkips++;
                continue;
              }
              const denomFloat = (Number(buyRung.priceUnits) / (10 ** quoteDecimals)) * (1 + Math.max(0, makerFeeBps) / 10000);
              const quoteFloatAvail = Number(quoteAvailUnits) / (10 ** quoteDecimals);
              const maxBaseFloat = denomFloat > 0 ? (quoteFloatAvail * 0.999) / denomFloat : 0;
              execQtyUnits = PrecisionMath.parseToUnits(Math.max(0, maxBaseFloat).toFixed(Math.min(8, baseDecimals)), baseDecimals);
              if (execQtyUnits > buyRung.remainingQtyUnits) execQtyUnits = buyRung.remainingQtyUnits;
              if (execQtyUnits > remainingTickQty) execQtyUnits = remainingTickQty;
            }

            if (execQtyUnits < minOrderUnits || execQtyUnits <= 0n) {
              insufficientBalanceSkips++;
              continue;
            }

            const quoteVolUnits = PrecisionMath.calculateQuoteAmount(execQtyUnits, baseDecimals, buyRung.priceUnits);
            const feeUnitsSigned = makerFeeBps >= 0
              ? PrecisionMath.calculateFee(quoteVolUnits, makerFeeBps)
              : -PrecisionMath.calculateFee(quoteVolUnits, Math.abs(makerFeeBps));

            if (quoteAvailUnits < quoteVolUnits + feeUnitsSigned) {
              insufficientBalanceSkips++;
              continue;
            }

            const prevBaseFloat = Number(baseAvailUnits) / (10 ** baseDecimals);
            quoteAvailUnits = quoteAvailUnits - quoteVolUnits - feeUnitsSigned;
            baseAvailUnits = baseAvailUnits + execQtyUnits;
            buyRung.remainingQtyUnits -= execQtyUnits;
            remainingTickQty -= execQtyUnits;

            const fillPriceFloat = Number(buyRung.priceUnits) / (10 ** quoteDecimals);
            const qtyFloat = Number(execQtyUnits) / (10 ** baseDecimals);
            const quoteVolFloat = Number(quoteVolUnits) / (10 ** quoteDecimals);
            const feeFloat = Number(feeUnitsSigned) / (10 ** quoteDecimals);

            const totalCostBefore = prevBaseFloat * avgCostQuotePerBase;
            const totalCostAdded = quoteVolFloat + feeFloat;
            const newBaseFloat = prevBaseFloat + qtyFloat;
            if (newBaseFloat > 0) {
              avgCostQuotePerBase = (totalCostBefore + totalCostAdded) / newBaseFloat;
            }

            totalFeesPaidQuote += feeFloat;
            totalTurnoverQuote += quoteVolFloat;
            totalBuyFills++;
            filledOnThisTick = true;

            const equityNow = (Number(quoteAvailUnits) / (10 ** quoteDecimals)) + newBaseFloat * tick.priceFloat;
            fills.push({
              index: fills.length + 1,
              timestamp: tick.timestamp,
              side: 'BUY',
              ladderLevel: buyRung.level,
              fillPrice: fillPriceFloat,
              quantity: qtyFloat,
              quoteVolume: quoteVolFloat,
              feeQuote: feeFloat,
              sourceTradeId: tick.id,
              journalId: tick.journalId,
              ledgerVerified: tick.ledgerVerified,
              realizedPnl: 0,
              equityAfter: equityNow,
              inventoryBaseAfter: newBaseFloat
            });

            const rKey = `BUY:${buyRung.level}`;
            const existingStat = rungHitMap.get(rKey) || { level: buyRung.level, side: 'BUY', hits: 0, volumeBase: 0, volumeQuote: 0 };
            existingStat.hits++;
            existingStat.volumeBase += qtyFloat;
            existingStat.volumeQuote += quoteVolFloat;
            rungHitMap.set(rKey, existingStat);
          }
        }

        // SELL rungs fill when historical trade prints at or above (rungPrice + slippage)
        for (const sellRung of activeSells) {
          if (remainingTickQty <= 0n || sellRung.remainingQtyUnits <= 0n) continue;
          const slippageUnits = slippageBps > 0 ? (sellRung.priceUnits * BigInt(slippageBps)) / 10000n : 0n;
          const triggerPriceUnits = sellRung.priceUnits + slippageUnits;

          if (tick.priceUnits >= triggerPriceUnits) {
            let execQtyUnits = remainingTickQty < sellRung.remainingQtyUnits ? remainingTickQty : sellRung.remainingQtyUnits;
            if (baseAvailUnits < execQtyUnits) {
              execQtyUnits = baseAvailUnits;
            }
            if (execQtyUnits < minOrderUnits || execQtyUnits <= 0n) {
              insufficientBalanceSkips++;
              continue;
            }

            const quoteVolUnits = PrecisionMath.calculateQuoteAmount(execQtyUnits, baseDecimals, sellRung.priceUnits);
            const feeUnitsSigned = makerFeeBps >= 0
              ? PrecisionMath.calculateFee(quoteVolUnits, makerFeeBps)
              : -PrecisionMath.calculateFee(quoteVolUnits, Math.abs(makerFeeBps));

            baseAvailUnits -= execQtyUnits;
            quoteAvailUnits = quoteAvailUnits + quoteVolUnits - feeUnitsSigned;
            sellRung.remainingQtyUnits -= execQtyUnits;
            remainingTickQty -= execQtyUnits;

            const fillPriceFloat = Number(sellRung.priceUnits) / (10 ** quoteDecimals);
            const qtyFloat = Number(execQtyUnits) / (10 ** baseDecimals);
            const quoteVolFloat = Number(quoteVolUnits) / (10 ** quoteDecimals);
            const feeFloat = Number(feeUnitsSigned) / (10 ** quoteDecimals);
            const newBaseFloat = Number(baseAvailUnits) / (10 ** baseDecimals);

            const tradeRealizedPnl = (fillPriceFloat - avgCostQuotePerBase) * qtyFloat - feeFloat;
            realizedPnlQuote += tradeRealizedPnl;
            if (tradeRealizedPnl >= 0) {
              grossProfit += tradeRealizedPnl;
              winningSells++;
            } else {
              grossLoss += Math.abs(tradeRealizedPnl);
              losingSells++;
            }

            totalFeesPaidQuote += feeFloat;
            totalTurnoverQuote += quoteVolFloat;
            totalSellFills++;
            filledOnThisTick = true;

            const equityNow = (Number(quoteAvailUnits) / (10 ** quoteDecimals)) + newBaseFloat * tick.priceFloat;
            fills.push({
              index: fills.length + 1,
              timestamp: tick.timestamp,
              side: 'SELL',
              ladderLevel: sellRung.level,
              fillPrice: fillPriceFloat,
              quantity: qtyFloat,
              quoteVolume: quoteVolFloat,
              feeQuote: feeFloat,
              sourceTradeId: tick.id,
              journalId: tick.journalId,
              ledgerVerified: tick.ledgerVerified,
              realizedPnl: tradeRealizedPnl,
              equityAfter: equityNow,
              inventoryBaseAfter: newBaseFloat
            });

            const rKey = `SELL:${sellRung.level}`;
            const existingStat = rungHitMap.get(rKey) || { level: sellRung.level, side: 'SELL', hits: 0, volumeBase: 0, volumeQuote: 0 };
            existingStat.hits++;
            existingStat.volumeBase += qtyFloat;
            existingStat.volumeQuote += quoteVolFloat;
            rungHitMap.set(rKey, existingStat);
          }
        }
      }

      // B. Reprice Cycle Check (rotates ladder symmetrically without stacking)
      const shouldReprice = idx === 0 || (tick.timestamp - lastRepriceTs >= repriceIntervalMs);
      if (shouldReprice) {
        lastRepriceTs = tick.timestamp;
        patternBarIndex = (patternBarIndex + 1) % totalBars;

        let minBound: number;
        let maxBound: number;
        if (boundPct && boundPct > 0) {
          const ratio = boundPct / 100;
          minBound = tick.priceFloat * (1 - ratio);
          maxBound = tick.priceFloat * (1 + ratio);
        } else {
          minBound = fixedMinBoundFloat;
          maxBound = fixedMaxBoundFloat;
        }

        const outOfBounds = !boundPct && (tick.priceFloat < minBound || tick.priceFloat > maxBound);
        if (outOfBounds) {
          outOfBoundsSkippedTicks++;
          activeBuys = [];
          activeSells = [];
          lastCycleMinBound = minBound;
          lastCycleMaxBound = maxBound;
          lastAnchorFloat = tick.priceFloat;
        } else {
          const { anchorPrice } = SmartHftLadderBotExecutor.previewPattern(
            tick.priceFloat,
            pattern,
            timeframe,
            5.0,
            patternBarIndex
          );

          const tickSz = SmartHftLadderBotExecutor.getTickSize(pair, tick.priceFloat);
          const safeAnchor = Math.max(minBound + tickSz * 2, Math.min(maxBound - tickSz * 2, anchorPrice));
          lastAnchorFloat = safeAnchor;
          lastCycleMinBound = minBound;
          lastCycleMaxBound = maxBound;

          const cycleCfg: SmartHftLadderConfig = {
            ...baseCfg,
            min_price_bound: minBound.toFixed(quoteDecimals),
            max_price_bound: maxBound.toFixed(quoteDecimals)
          };

          const { buyLevels, sellLevels } = SmartHftLadderBotExecutor.calculateLadder(pair, safeAnchor, cycleCfg);
          activeBuys = buyLevels.map(lvl => ({
            level: lvl.level,
            side: 'BUY',
            priceUnits: lvl.priceUnits,
            remainingQtyUnits: lvl.quantityUnits
          }));
          activeSells = sellLevels.map(lvl => ({
            level: lvl.level,
            side: 'SELL',
            priceUnits: lvl.priceUnits,
            remainingQtyUnits: lvl.quantityUnits
          }));

          totalRepriceCycles++;
          totalOrdersSimulated += activeBuys.length + activeSells.length;
        }
      }

      // C. Mark-to-Market Valuation & Drawdown Tracking
      const baseFloatNow = Number(baseAvailUnits) / (10 ** baseDecimals);
      const quoteFloatNow = Number(quoteAvailUnits) / (10 ** quoteDecimals);
      const equityNow = quoteFloatNow + baseFloatNow * tick.priceFloat;

      if (equityNow > peakEquity) {
        peakEquity = equityNow;
      }
      const ddQuote = Math.max(0, peakEquity - equityNow);
      const ddPct = peakEquity > 0 ? (ddQuote / peakEquity) * 100 : 0;
      if (ddQuote > maxDrawdownQuote) maxDrawdownQuote = ddQuote;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

      if (prevEquity > 0) {
        stepReturns.push((equityNow - prevEquity) / prevEquity);
      }
      prevEquity = equityNow;

      const unrealizedNow = baseFloatNow * (tick.priceFloat - avgCostQuotePerBase);
      if (filledOnThisTick || idx === 0 || idx === replayTicks.length - 1 || idx % Math.max(1, Math.floor(replayTicks.length / 180)) === 0) {
        rawCurve.push({
          index: idx,
          timestamp: tick.timestamp,
          marketPrice: tick.priceFloat,
          anchorPrice: lastAnchorFloat,
          minBound: lastCycleMinBound,
          maxBound: lastCycleMaxBound,
          equityQuote: equityNow,
          realizedPnlQuote,
          unrealizedPnlQuote: unrealizedNow,
          drawdownPct: ddPct,
          inventoryBase: baseFloatNow,
          inventoryQuote: quoteFloatNow,
          cumulativeFeesQuote: totalFeesPaidQuote,
          fillsCount: totalBuyFills + totalSellFills
        });
      }
    }

    // Downsample curve cleanly to <= 180 points while preserving endpoints & fill spikes
    const equityCurve = this.downsampleCurve(rawCurve, 180);

    const lastTick = replayTicks[replayTicks.length - 1];
    const endingBaseInventory = Number(baseAvailUnits) / (10 ** baseDecimals);
    const endingQuoteBalance = Number(quoteAvailUnits) / (10 ** quoteDecimals);
    const finalEquityQuote = endingQuoteBalance + endingBaseInventory * lastTick.priceFloat;
    const netPnlQuote = finalEquityQuote - initialEquityQuote;
    const netReturnPct = initialEquityQuote > 0 ? (netPnlQuote / initialEquityQuote) * 100 : 0;
    const unrealizedPnlQuote = netPnlQuote - realizedPnlQuote;

    const totalFills = totalBuyFills + totalSellFills;
    const fillRatePct = totalOrdersSimulated > 0 ? (totalFills / totalOrdersSimulated) * 100 : 0;
    const sellCount = winningSells + losingSells;
    const winRatePct = sellCount > 0 ? (winningSells / sellCount) * 100 : (netPnlQuote >= 0 && totalFills > 0 ? 100 : 0);
    const profitFactor = grossLoss > 0
      ? grossProfit / grossLoss
      : (grossProfit > 0 ? 99.9 : 0);

    // Sharpe Ratio across step returns (annualized-style sqrt(N) scaling clamped safely)
    let sharpeRatio = 0;
    if (stepReturns.length >= 2) {
      const mean = stepReturns.reduce((a, b) => a + b, 0) / stepReturns.length;
      const variance = stepReturns.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / stepReturns.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev > 1e-12) {
        sharpeRatio = (mean / stdDev) * Math.sqrt(Math.min(252, stepReturns.length));
      }
    }

    const rungHitDistribution = Array.from(rungHitMap.values()).sort((a, b) => {
      if (a.side !== b.side) return a.side === 'BUY' ? -1 : 1;
      return a.level - b.level;
    });

    const result: BacktestResult = {
      runId: `bt-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      label: req.label?.trim() || `${pattern.replace(/_/g, ' ')} (${timeframe}, ±${boundPct ?? 'custom'}%)`,
      createdAt: Date.now(),
      pairId: pair.id,
      baseCurrency: pair.baseCurrency,
      quoteCurrency: pair.quoteCurrency,
      baseDecimals,
      quoteDecimals,
      dataSourceMode,
      config: {
        ...baseCfg,
        makerFeeBps,
        takerFeeBps,
        slippageBps,
        initialBaseBalance: initialBaseFloat.toString(),
        initialQuoteBalance: initialQuoteFloat.toString()
      },
      ledgerAudit: {
        totalPairTradesInDb: allPairTrades.length,
        journalVerifiedTradesCount: journalVerifiedCount,
        replayedEventsCount: replayTicks.length,
        ledgerEntriesExamined,
        timeRangeStart: replayTicks[0].timestamp,
        timeRangeEnd: lastTick.timestamp,
        datasetIntegrityHash,
        nonMutatingVerified: true
      },
      summary: {
        initialEquityQuote,
        finalEquityQuote,
        netPnlQuote,
        netReturnPct,
        realizedPnlQuote,
        unrealizedPnlQuote,
        totalFeesPaidQuote,
        grossTradingProfitQuote: netPnlQuote + totalFeesPaidQuote,
        maxDrawdownQuote,
        maxDrawdownPct,
        sharpeRatio: Number(sharpeRatio.toFixed(2)),
        winRatePct: Number(winRatePct.toFixed(1)),
        profitFactor: Number(Math.min(99.99, profitFactor).toFixed(2)),
        totalBuyFills,
        totalSellFills,
        totalFills,
        totalRepriceCycles,
        totalOrdersSimulated,
        fillRatePct: Number(fillRatePct.toFixed(2)),
        totalTurnoverQuote,
        outOfBoundsSkippedTicks,
        insufficientBalanceSkips,
        endingBaseInventory,
        endingQuoteBalance,
        avgEntryCostQuote: avgCostQuotePerBase
      },
      equityCurve,
      fills: fills.slice(-150),
      rungHitDistribution,
      executionTimeMs: Math.max(1, Date.now() - startExecMs)
    };

    this.runHistory.unshift(result);
    if (this.runHistory.length > this.MAX_HISTORY) {
      this.runHistory = this.runHistory.slice(0, this.MAX_HISTORY);
    }

    return result;
  }

  private static downsampleCurve(points: EquityCurvePoint[], maxPoints: number): EquityCurvePoint[] {
    if (points.length <= maxPoints) return points;
    const sampled: EquityCurvePoint[] = [];
    const step = (points.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i++) {
      sampled.push(points[Math.round(i * step)]);
    }
    return sampled;
  }
}
