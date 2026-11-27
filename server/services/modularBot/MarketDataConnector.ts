/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/MarketDataConnector.ts
 * Layer 1 — Data & Connector Layer.
 * Implements standardized MarketData normalization, monotonic sequence/timestamp
 * checks, stale data protection, and volatility metrics over DIMONEX infrastructure,
 * plus extensible external CEX/DEX connector contracts.
 */

import { db } from '../../db/database.js';
import { matchingEngine } from '../../engine/MatchingEngine.js';
import { klineService, Timeframe } from '../../engine/KlineService.js';
import { timeframeAnalyticsService } from '../analytics/TimeframeAnalyticsService.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import {
  IExchangeConnector,
  MarketConstraints,
  NormalizedCandle,
  NormalizedMarketData,
  NormalizedOrderBook,
  NormalizedTradeTick,
  PriceReferenceType,
} from './types.js';
import { normalizePairId } from './ConfigValidator.js';

function getPairTickUnits(pairId: string, priceNum: number, quoteDec: number, quoteCurrency: string): bigint {
  if (quoteCurrency === 'USDT' || pairId.endsWith('-USDT')) {
    const scale = 10 ** quoteDec;
    if (priceNum >= 10000) return BigInt(Math.max(1, Math.round(0.1 * scale)));
    if (priceNum >= 100) return BigInt(Math.max(1, Math.round(0.01 * scale)));
    if (priceNum >= 1) return BigInt(Math.max(1, Math.round(0.001 * scale)));
    return 1n;
  }
  // IDR quote (1 IDR = 100 units)
  if (priceNum >= 100_000_000) return 100_000n; // Rp 1.000
  if (priceNum >= 1_000_000) return 10_000n;    // Rp 100
  if (priceNum >= 50_000) return 1_000n;        // Rp 10
  return 100n;                                  // Rp 1
}

export class DimonexInternalConnector implements IExchangeConnector {
  public readonly connectorId = 'DIMONEX';
  public readonly isExternal = false;
  private lastSeenSequence: Map<string, number> = new Map();
  private lastSeenTimestamp: Map<string, number> = new Map();

  public getMarketConstraints(rawPairId: string): MarketConstraints | null {
    const pairId = normalizePairId(rawPairId);
    const pair = db.tradingPairs.get(pairId);
    if (!pair) return null;

    const baseDecimals = pair.baseDecimals ?? 8;
    const quoteDecimals = pair.quoteDecimals ?? (pair.quoteCurrency === 'USDT' ? 6 : 2);
    const lastPriceFloat = Number(BigInt(pair.lastPrice || '0')) / 10 ** quoteDecimals;
    const tickUnits = getPairTickUnits(pair.id, lastPriceFloat, quoteDecimals, pair.quoteCurrency);

    return {
      pairId: pair.id,
      baseCurrency: pair.baseCurrency,
      quoteCurrency: pair.quoteCurrency,
      baseDecimals,
      quoteDecimals,
      minOrderSizeUnits: pair.minOrderSize || '1000',
      maxOrderSizeUnits: pair.maxOrderSize || (10_000_000n * (10n ** BigInt(baseDecimals))).toString(),
      tickSizeUnits: tickUnits.toString(),
      lotSizeUnits: '1',
      makerFeeBps: pair.makerFeeBps ?? 10,
      takerFeeBps: pair.takerFeeBps ?? 20,
      supportsShorting: false, // DIMONEX spot markets do not support spot short selling
      supportsPostOnly: true,
      supportsFok: true,
      supportsIoc: true,
      supportsMarket: true,
      isActive: Boolean(pair.isActive) && !Boolean(pair.isDelisted),
      isHalted: Boolean(pair.isHalted),
    };
  }

  public getMarketSnapshot(
    rawPairId: string,
    timeframe: Timeframe,
    priceReference: PriceReferenceType = 'LAST_TRADE',
    candleLimit = 220,
    maxDataAgeMs = 60_000
  ): NormalizedMarketData {
    const pairId = normalizePairId(rawPairId);
    const constraints = this.getMarketConstraints(pairId);
    const pair = db.tradingPairs.get(pairId);
    if (!pair || !constraints) {
      throw new Error(`Trading pair "${rawPairId}" tidak ditemukan di DIMONEX.`);
    }

    const baseDec = constraints.baseDecimals;
    const quoteDec = constraints.quoteDecimals;
    const baseScale = 10 ** baseDec;
    const quoteScale = 10 ** quoteDec;

    const book = matchingEngine.getOrderBook(pair.id);
    const depth = book.getDepth(25);
    const now = Date.now();

    const prevSeq = this.lastSeenSequence.get(pair.id) ?? 0;
    const currentSeq = book.eventSequence;
    if (currentSeq >= prevSeq) {
      this.lastSeenSequence.set(pair.id, currentSeq);
    }

    const bids = depth.bids.map(lvl => {
      const pUnits = BigInt(lvl[0]);
      const qUnits = BigInt(lvl[1]);
      return {
        priceUnits: lvl[0],
        price: Number(pUnits) / quoteScale,
        quantityUnits: lvl[1],
        quantity: Number(qUnits) / baseScale,
        orderCount: 1,
      };
    });

    const asks = depth.asks.map(lvl => {
      const pUnits = BigInt(lvl[0]);
      const qUnits = BigInt(lvl[1]);
      return {
        priceUnits: lvl[0],
        price: Number(pUnits) / quoteScale,
        quantityUnits: lvl[1],
        quantity: Number(qUnits) / baseScale,
        orderCount: 1,
      };
    });

    const bestBidUnits = bids[0]?.priceUnits || pair.lastPrice || '0';
    const bestAskUnits = asks[0]?.priceUnits || pair.lastPrice || '0';
    const bidBig = BigInt(bestBidUnits);
    const askBig = BigInt(bestAskUnits);
    const midpointUnits =
      bidBig > 0n && askBig > 0n ? ((bidBig + askBig) / 2n).toString() : pair.lastPrice || '0';

    let spreadBps = 0;
    if (bidBig > 0n && askBig >= bidBig) {
      const midBig = (bidBig + askBig) / 2n;
      if (midBig > 0n) {
        spreadBps = Number(((askBig - bidBig) * 10000n) / midBig);
      }
    }

    const orderBook: NormalizedOrderBook = {
      pairId: pair.id,
      bids,
      asks,
      bestBidUnits,
      bestAskUnits,
      midpointUnits,
      spreadBps: Number(spreadBps.toFixed(2)),
      sequence: currentSeq,
      timestamp: now,
    };

    const rawPairTrades = db.trades
      .filter(t => t.pairId === pair.id && !t.id.startsWith('hist-seed-') && !t.id.startsWith('usr-seed-'))
      .slice(-40);

    const recentTrades: NormalizedTradeTick[] = rawPairTrades.map(t => ({
      id: t.id,
      priceUnits: t.price,
      price: Number(BigInt(t.price || '0')) / quoteScale,
      quantityUnits: t.quantity,
      quantity: Number(BigInt(t.quantity || '0')) / baseScale,
      side: t.takerSide,
      timestamp: t.createdAt,
    }));

    const rawCandles = klineService.getCandles(pair.id, timeframe, candleLimit);
    const candles: NormalizedCandle[] = rawCandles.map(c => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    // Reference price resolution
    let refPriceUnitsStr = pair.lastPrice || '0';
    if (priceReference === 'MIDPOINT' && BigInt(midpointUnits) > 0n) {
      refPriceUnitsStr = midpointUnits;
    } else if (priceReference === 'BEST_BID' && bids[0]?.priceUnits) {
      refPriceUnitsStr = bids[0].priceUnits;
    } else if (priceReference === 'BEST_ASK' && asks[0]?.priceUnits) {
      refPriceUnitsStr = asks[0].priceUnits;
    }

    if (BigInt(refPriceUnitsStr || '0') <= 0n && candles.length > 0) {
      refPriceUnitsStr = PrecisionMath.parseToUnits(
        candles[candles.length - 1].close.toFixed(quoteDec),
        quoteDec
      ).toString();
    }

    const referencePrice = Number(BigInt(refPriceUnitsStr || '0')) / quoteScale;

    // Volatility & regime report
    const analytics = timeframeAnalyticsService.analyze(pair.id, timeframe);
    let realizedVolPct = analytics.indicators.atr14.pctOfPrice;
    if (candles.length >= 10) {
      const returns: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        if (candles[i - 1].close > 0) {
          returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
        }
      }
      if (returns.length > 1) {
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const varSum = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
        realizedVolPct = Number((Math.sqrt(varSum) * 100).toFixed(4));
      }
    }

    // Timestamp & Stale check
    const lastTradeTs = recentTrades.length > 0 ? recentTrades[recentTrades.length - 1].timestamp : 0;
    const lastCandleTsMs = candles.length > 0 ? candles[candles.length - 1].time * 1000 : 0;
    const latestActivityTs = Math.max(lastTradeTs, lastCandleTsMs);

    const prevTs = this.lastSeenTimestamp.get(pair.id) ?? 0;
    let isStale = false;
    let staleReason: string | undefined;

    if (constraints.isHalted || !constraints.isActive) {
      isStale = true;
      staleReason = `Market ${pair.id} tidak aktif atau sedang di-halt.`;
    } else if (BigInt(refPriceUnitsStr || '0') <= 0n) {
      isStale = true;
      staleReason = `Harga referensi market ${pair.id} belum tersedia (0).`;
    } else if (maxDataAgeMs > 0 && candles.length === 0 && latestActivityTs > 0 && now - latestActivityTs > maxDataAgeMs) {
      isStale = true;
      staleReason = `Market data stale melebihi ${maxDataAgeMs} ms.`;
    } else if (prevTs > now + 5_000) {
      isStale = true;
      staleReason = 'Anomali timestamp non-monotonik terdeteksi pada feed.';
    }

    if (now >= prevTs) {
      this.lastSeenTimestamp.set(pair.id, now);
    }

    return {
      source: 'DIMONEX',
      pairId: pair.id,
      timeframe,
      timestamp: now,
      sequence: currentSeq,
      isStale,
      staleReason,
      referencePriceUnits: refPriceUnitsStr,
      referencePrice,
      ticker: {
        lastPriceUnits: pair.lastPrice || '0',
        lastPrice: Number(BigInt(pair.lastPrice || '0')) / quoteScale,
        high24h: Number(BigInt(pair.high24h || pair.lastPrice || '0')) / quoteScale,
        low24h: Number(BigInt(pair.low24h || pair.lastPrice || '0')) / quoteScale,
        volume24h: Number(BigInt(pair.volume24h || '0')) / baseScale,
        priceChangePct24h: parseFloat(String(pair.priceChangePercent24h || pair.priceChange24h || '0').replace('+', '')) || 0,
      },
      orderBook,
      recentTrades,
      candles,
      volatility: {
        atr14: analytics.indicators.atr14.value,
        atrPct: analytics.indicators.atr14.pctOfPrice,
        realizedVolPct,
        regime: analytics.regime,
      },
      constraints,
    };
  }

  public validateFreshness(
    snapshot: NormalizedMarketData,
    maxAgeMs: number
  ): { fresh: boolean; reason?: string } {
    if (snapshot.isStale) {
      return { fresh: false, reason: snapshot.staleReason || 'Market snapshot flagged stale.' };
    }
    const age = Date.now() - snapshot.timestamp;
    if (age > maxAgeMs) {
      return { fresh: false, reason: `Market snapshot age ${age}ms exceeds limit ${maxAgeMs}ms.` };
    }
    return { fresh: true };
  }

  public resynchronize(pairId: string): void {
    const clean = normalizePairId(pairId);
    this.lastSeenSequence.delete(clean);
    this.lastSeenTimestamp.delete(clean);
    // Ensure KlineStore is synced with latest trades if needed
    klineService.getCandles(clean, '1m', 10);
  }
}

/**
 * Extensible Contract Stub for Future External CEX / DEX Integrations.
 * Explicitly rejects execution rather than claiming unimplemented connectivity.
 */
export class ExternalConnectorStub implements IExchangeConnector {
  public readonly connectorId: string;
  public readonly isExternal = true;

  constructor(connectorId: string) {
    this.connectorId = connectorId;
  }

  public getMarketConstraints(): MarketConstraints | null {
    return null;
  }

  public getMarketSnapshot(): NormalizedMarketData {
    throw new Error(
      `External connector "${this.connectorId}" belum diaktifkan pada instance produksi DIMONEX.`
    );
  }

  public validateFreshness(): { fresh: boolean; reason?: string } {
    return {
      fresh: false,
      reason: `External connector "${this.connectorId}" tidak terhubung.`,
    };
  }

  public resynchronize(): void {
    // No-op until implemented
  }
}

export const dimonexConnector = new DimonexInternalConnector();
