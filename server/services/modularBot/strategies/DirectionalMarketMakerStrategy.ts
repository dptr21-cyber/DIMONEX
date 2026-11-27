/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/strategies/DirectionalMarketMakerStrategy.ts
 * Category B — Market Making & Liquidity Management: Directional Market Making Strategy.
 * Dynamically skews bid/ask spreads & sizes using inventory ratio, EMA/RSI bias, and ATR volatility.
 */

import crypto from 'crypto';
import { PrecisionMath } from '../../../ledger/PrecisionMath.js';
import {
  BotConfigSchemaV1,
  BotExecutionRecord,
  BotPositionState,
  ConfigValidationResult,
  MarketMakingQuoteRecommendation,
  NormalizedMarketData,
  StrategyController,
  StrategyExecutionContext,
  StrategyMetadata,
  StrategySignal,
} from '../types.js';
import { IndicatorEngine } from '../IndicatorEngine.js';

function alignToTick(priceUnits: bigint, tickUnits: bigint, roundUp: boolean): bigint {
  if (tickUnits <= 1n) return priceUnits > 0n ? priceUnits : 1n;
  const rem = priceUnits % tickUnits;
  if (rem === 0n) return priceUnits;
  return roundUp ? priceUnits + (tickUnits - rem) : priceUnits - rem;
}

export class DirectionalMarketMakerStrategy implements StrategyController {
  private config: BotConfigSchemaV1 | null = null;
  private lastQuoteTimestamp = 0;

  public getMetadata(): StrategyMetadata {
    return {
      strategyId: 'directional_market_making',
      name: 'Directional Market Making Strategy',
      version: '1.0.0',
      category: 'MARKET_MAKING',
      description:
        'Menempatkan kuotasi dua arah (Bid & Ask) Post-Only dengan skew inventori, pelebaran spread berbasis volatilitas ATR, dan bias tren EMA/RSI.',
      supportedMarketTypes: ['SPOT'],
      supportedTimeframes: ['1m', '5m', '15m', '30m', '1h'],
      requiredIndicators: ['EMA', 'RSI', 'ATR'],
      configurationSchema: [
        { key: 'baseSpreadBps', label: 'Base Spread (bps)', type: 'number', defaultValue: 35, min: 5, max: 1000, step: 1, description: 'Spread dasar total antara bid dan ask dalam basis poin.' },
        { key: 'minSpreadBps', label: 'Minimum Spread (bps)', type: 'number', defaultValue: 15, min: 2, max: 500, step: 1, description: 'Batas minimum spread yang diizinkan.' },
        { key: 'maxSpreadBps', label: 'Maximum Spread (bps)', type: 'number', defaultValue: 250, min: 20, max: 2000, step: 5, description: 'Batas maksimum spread saat volatilitas tinggi.' },
        { key: 'levelsPerSide', label: 'Quote Levels Per Side', type: 'number', defaultValue: 2, min: 1, max: 6, step: 1, description: 'Jumlah level order bid & ask.' },
        { key: 'levelStepBps', label: 'Level Step (bps)', type: 'number', defaultValue: 15, min: 2, max: 200, step: 1, description: 'Jarak antar level ladder dalam bps.' },
        { key: 'inventoryTargetPct', label: 'Target Base Inventory (%)', type: 'number', defaultValue: 50, min: 10, max: 90, step: 5, description: 'Rasio ideal nilai aset base vs total alokasi.' },
        { key: 'inventorySkewFactor', label: 'Inventory Skew Factor', type: 'number', defaultValue: 1.5, min: 0, max: 5, step: 0.1, description: 'Agresivitas pergeseran quote akibat ketidakseimbangan inventori.' },
        { key: 'volatilityMultiplier', label: 'Volatility Spread Multiplier', type: 'number', defaultValue: 1.0, min: 0, max: 5, step: 0.1, description: 'Pelebaran spread proporsional terhadap ATR%.' },
        { key: 'trendSkewBps', label: 'Directional Bias Skew (bps)', type: 'number', defaultValue: 12, min: 0, max: 100, step: 1, description: 'Pergeseran midpoint mengikuti bias tren EMA/RSI.' },
        { key: 'repriceThresholdBps', label: 'Stale Quote Reprice Threshold (bps)', type: 'number', defaultValue: 10, min: 1, max: 200, step: 1, description: 'Selisih harga minimum sebelum quote lama dibatalkan & diganti.' },
        { key: 'minRepriceIntervalMs', label: 'Min Reprice Interval (ms)', type: 'number', defaultValue: 2000, min: 500, max: 60000, step: 500, description: 'Jeda minimum cancel/replace kuotasi.' },
      ],
      riskCompatibility: {
        supportsTripleBarrier: false,
        supportsTrailingStop: false,
        requiresQuoteLevelRisk: true,
      },
      status: 'ACTIVE',
    };
  }

  public initialize(config: BotConfigSchemaV1): void {
    this.config = config;
    this.lastQuoteTimestamp = 0;
  }

  public validateConfig(config: BotConfigSchemaV1): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const ind = config.strategy?.indicators || {};

    const minSpread = Number(ind.minSpreadBps ?? 15);
    const maxSpread = Number(ind.maxSpreadBps ?? 250);
    const baseSpread = Number(ind.baseSpreadBps ?? 35);
    const levels = Number(ind.levelsPerSide ?? 2);

    if (minSpread > baseSpread || baseSpread > maxSpread) {
      errors.push('Pastikan minSpreadBps <= baseSpreadBps <= maxSpreadBps.');
    }
    if (levels < 1 || levels > 8) {
      errors.push('levelsPerSide harus antara 1 dan 8.');
    }
    if (!config.execution.postOnly && config.execution.orderType === 'MARKET') {
      warnings.push('Market Making disarankan menggunakan POST_ONLY atau LIMIT GTC agar bertindak sebagai pembuat likuiditas.');
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  public onMarketData(_data: NormalizedMarketData): void {}
  public onPositionUpdate(_position: BotPositionState): void {}
  public onExecutionUpdate(_execution: BotExecutionRecord): void {}
  public reset(): void {
    this.lastQuoteTimestamp = 0;
  }

  public generateSignal(context: StrategyExecutionContext): StrategySignal {
    const cfg = this.config || context.config;
    const ind = cfg.strategy.indicators || {};
    const now = context.now;
    const mkt = context.marketData;
    const constraints = mkt.constraints;

    const baseSpreadBps = Number(ind.baseSpreadBps ?? 35);
    const minSpreadBps = Number(ind.minSpreadBps ?? 15);
    const maxSpreadBps = Number(ind.maxSpreadBps ?? 250);
    const levelsPerSide = Math.max(1, Math.min(6, Math.trunc(Number(ind.levelsPerSide ?? 2))));
    const levelStepBps = Math.max(2, Number(ind.levelStepBps ?? 15));
    const inventoryTargetPct = Number(ind.inventoryTargetPct ?? 50);
    const inventorySkewFactor = Number(ind.inventorySkewFactor ?? 1.5);
    const volMult = Number(ind.volatilityMultiplier ?? 1.0);
    const trendSkewBps = Number(ind.trendSkewBps ?? 12);
    const repriceThresholdBps = Number(ind.repriceThresholdBps ?? 10);
    const minRepriceMs = Math.max(500, Number(ind.minRepriceIntervalMs ?? 2000));

    const candles = mkt.candles;
    const closes = candles.map(c => c.close);
    const emaFast = closes.length >= 9 ? IndicatorEngine.ema(closes, 9) : mkt.referencePrice;
    const emaSlow = closes.length >= 21 ? IndicatorEngine.ema(closes, 21) : mkt.referencePrice;
    const rsiVal = closes.length >= 15 ? IndicatorEngine.rsi(closes, 14) : 50;
    const atrPct = mkt.volatility.atrPct || 0.25;

    let directionalBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let biasSkewBps = 0;
    if (emaFast > emaSlow * 1.0005 && rsiVal < 70) {
      directionalBias = 'BULLISH';
      biasSkewBps = trendSkewBps;
    } else if (emaFast < emaSlow * 0.9995 && rsiVal > 30) {
      directionalBias = 'BEARISH';
      biasSkewBps = -trendSkewBps;
    }

    // Inventory skew calculation from current available base vs quote
    const baseUnits = BigInt(context.availableBaseUnits || '0');
    const quoteUnits = BigInt(context.availableQuoteUnits || '0');
    const refUnits = BigInt(mkt.referencePriceUnits || '0');
    const baseValueQuote =
      refUnits > 0n ? PrecisionMath.calculateQuoteAmount(baseUnits, constraints.baseDecimals, refUnits) : 0n;
    const totalQuoteEq = baseValueQuote + quoteUnits;
    const actualBasePct =
      totalQuoteEq > 0n ? Number((baseValueQuote * 10000n) / totalQuoteEq) / 100 : inventoryTargetPct;
    const inventoryDeviationPct = actualBasePct - inventoryTargetPct; // positive = overweight base
    const inventorySkewBps = Math.round(-inventoryDeviationPct * inventorySkewFactor);

    // Dynamic spread widening under ATR volatility
    const volAdjustmentBps = Math.round(atrPct * 10 * volMult);
    const targetSpreadBps = Math.max(
      minSpreadBps,
      Math.min(maxSpreadBps, baseSpreadBps + volAdjustmentBps)
    );

    const indicatorValues: Record<string, number | string | boolean> = {
      targetSpreadBps,
      inventorySkewBps,
      actualBasePct: Number(actualBasePct.toFixed(2)),
      directionalBias,
      emaFast: Number(emaFast.toFixed(4)),
      emaSlow: Number(emaSlow.toFixed(4)),
      rsi: Number(rsiVal.toFixed(2)),
      atrPct: Number(atrPct.toFixed(3)),
    };

    if (refUnits <= 0n) {
      return {
        signalId: crypto.randomUUID(),
        strategyId: 'directional_market_making',
        botInstanceId: context.botId,
        tradingPair: mkt.pairId,
        signalTimestamp: now,
        signalExpiration: now + 15_000,
        category: 'MARKET_MAKING',
        signalType: 'HOLD',
        confidenceScore: 0,
        indicatorValues,
        referenceMarketPriceUnits: mkt.referencePriceUnits,
        referenceMarketPrice: mkt.referencePrice,
        strategyExplanation: 'Reference price tidak tersedia (0); menunggu market data valid.',
        riskMetadata: {
          regime: mkt.volatility.regime,
          volatilityAtrPct: atrPct,
          isEligibleForTripleBarrier: false,
        },
      };
    }

    if (now - this.lastQuoteTimestamp < minRepriceMs && context.openOrders.length > 0) {
      return {
        signalId: crypto.randomUUID(),
        strategyId: 'directional_market_making',
        botInstanceId: context.botId,
        tradingPair: mkt.pairId,
        signalTimestamp: now,
        signalExpiration: now + 10_000,
        category: 'MARKET_MAKING',
        signalType: 'HOLD',
        confidenceScore: 50,
        indicatorValues,
        referenceMarketPriceUnits: mkt.referencePriceUnits,
        referenceMarketPrice: mkt.referencePrice,
        strategyExplanation: 'Kuotasi aktif masih dalam jendela minRepriceIntervalMs.',
        riskMetadata: {
          regime: mkt.volatility.regime,
          volatilityAtrPct: atrPct,
          isEligibleForTripleBarrier: false,
        },
      };
    }

    const tickUnits = BigInt(constraints.tickSizeUnits || '1');
    const netSkewBps = biasSkewBps + inventorySkewBps;
    const halfSpreadBps = Math.max(Math.ceil(minSpreadBps / 2), Math.floor(targetSpreadBps / 2));

    // Anchor off midpoint or reference price, shifted by netSkewBps
    const skewedMid = (refUnits * BigInt(10000 + netSkewBps)) / 10000n;
    let bestAllowedBid = BigInt(mkt.orderBook.bestAskUnits || '0') > tickUnits
      ? BigInt(mkt.orderBook.bestAskUnits) - tickUnits
      : refUnits;
    let bestAllowedAsk = BigInt(mkt.orderBook.bestBidUnits || '0') > 0n
      ? BigInt(mkt.orderBook.bestBidUnits) + tickUnits
      : refUnits;

    let rawBid0 = (skewedMid * BigInt(10000 - halfSpreadBps)) / 10000n;
    let rawAsk0 = (skewedMid * BigInt(10000 + halfSpreadBps)) / 10000n;

    if (cfg.execution.postOnly || cfg.execution.orderType === 'POST_ONLY') {
      if (BigInt(mkt.orderBook.bestAskUnits || '0') > 0n && rawBid0 >= BigInt(mkt.orderBook.bestAskUnits)) {
        rawBid0 = bestAllowedBid;
      }
      if (BigInt(mkt.orderBook.bestBidUnits || '0') > 0n && rawAsk0 <= BigInt(mkt.orderBook.bestBidUnits)) {
        rawAsk0 = bestAllowedAsk;
      }
    }

    rawBid0 = alignToTick(rawBid0, tickUnits, false);
    rawAsk0 = alignToTick(rawAsk0, tickUnits, true);
    if (rawAsk0 <= rawBid0) {
      rawAsk0 = rawBid0 + tickUnits;
    }

    // Determine desired per-level base quantity
    let baseOrderUnits = BigInt(constraints.minOrderSizeUnits);
    try {
      if (cfg.risk.positionSizing.method === 'FIXED_QTY') {
        baseOrderUnits = PrecisionMath.parseToUnits(cfg.risk.positionSizing.value, constraints.baseDecimals);
      } else if (cfg.risk.positionSizing.method === 'FIXED_QUOTE') {
        const qVal = PrecisionMath.parseToUnits(cfg.risk.positionSizing.value, constraints.quoteDecimals);
        baseOrderUnits = PrecisionMath.calculateBaseQuantity(qVal, constraints.baseDecimals, refUnits);
      }
    } catch {
      baseOrderUnits = BigInt(constraints.minOrderSizeUnits);
    }
    if (baseOrderUnits < BigInt(constraints.minOrderSizeUnits)) {
      baseOrderUnits = BigInt(constraints.minOrderSizeUnits);
    }

    // Skew sizing slightly based on inventory
    const bidSizeMultPct = Math.max(40, Math.min(140, Math.round(100 - inventoryDeviationPct * 0.8)));
    const askSizeMultPct = Math.max(40, Math.min(140, Math.round(100 + inventoryDeviationPct * 0.8)));
    const recBidQty = (baseOrderUnits * BigInt(bidSizeMultPct)) / 100n;
    const recAskQty = (baseOrderUnits * BigInt(askSizeMultPct)) / 100n;

    const quotes: MarketMakingQuoteRecommendation[] = [];
    for (let lvl = 0; lvl < levelsPerSide; lvl++) {
      const stepBps = BigInt(lvl * levelStepBps);
      const bPrice = alignToTick((rawBid0 * (10000n - stepBps)) / 10000n, tickUnits, false);
      const aPrice = alignToTick((rawAsk0 * (10000n + stepBps)) / 10000n, tickUnits, true);

      if (bPrice > 0n && recBidQty >= BigInt(constraints.minOrderSizeUnits)) {
        quotes.push({
          level: lvl,
          side: 'BUY',
          priceUnits: bPrice.toString(),
          quantityUnits: recBidQty.toString(),
          postOnly: true,
          clientTag: `mm-b-${lvl}`,
        });
      }
      if (aPrice > bPrice && recAskQty >= BigInt(constraints.minOrderSizeUnits)) {
        quotes.push({
          level: lvl,
          side: 'SELL',
          priceUnits: aPrice.toString(),
          quantityUnits: recAskQty.toString(),
          postOnly: true,
          clientTag: `mm-s-${lvl}`,
        });
      }
    }

    // Identify stale open orders whose price deviates > repriceThresholdBps from target tier
    const cancelStaleOrderIds: string[] = [];
    for (const open of context.openOrders) {
      const matchingQuote = quotes.find(q => q.side === open.side && open.clientOrderId.includes(q.clientTag));
      if (!matchingQuote) {
        cancelStaleOrderIds.push(open.orderId);
        continue;
      }
      const openP = BigInt(open.priceUnits || '0');
      const targetP = BigInt(matchingQuote.priceUnits || '0');
      if (targetP > 0n) {
        const diff = openP >= targetP ? openP - targetP : targetP - openP;
        const devBps = Number((diff * 10000n) / targetP);
        if (devBps >= repriceThresholdBps) {
          cancelStaleOrderIds.push(open.orderId);
        }
      }
    }

    this.lastQuoteTimestamp = now;

    return {
      signalId: crypto.randomUUID(),
      strategyId: 'directional_market_making',
      botInstanceId: context.botId,
      tradingPair: mkt.pairId,
      signalTimestamp: now,
      signalExpiration: now + 15_000,
      category: 'MARKET_MAKING',
      signalType: 'MARKET_MAKE_QUOTES',
      confidenceScore: 85,
      indicatorValues,
      referenceMarketPriceUnits: mkt.referencePriceUnits,
      referenceMarketPrice: mkt.referencePrice,
      strategyExplanation: `MM Quote: Spread ${targetSpreadBps} bps | Skew Inv ${inventorySkewBps} bps | Bias ${directionalBias}.`,
      riskMetadata: {
        regime: mkt.volatility.regime,
        volatilityAtrPct: atrPct,
        isEligibleForTripleBarrier: false,
      },
      marketMaking: {
        bidTargetPriceUnits: rawBid0.toString(),
        askTargetPriceUnits: rawAsk0.toString(),
        targetSpreadBps,
        inventorySkewBps,
        recommendedBidQtyUnits: recBidQty.toString(),
        recommendedAskQtyUnits: recAskQty.toString(),
        quotes,
        cancelStaleOrderIds,
        directionalBias,
      },
    };
  }
}
