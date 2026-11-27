/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/strategies/EmaMacdStrategy.ts
 * Category A — Directional Trading: EMA + MACD Trend Following.
 */

import crypto from 'crypto';
import {
  BotConfigSchemaV1,
  BotExecutionRecord,
  BotPositionState,
  ConfigValidationResult,
  NormalizedMarketData,
  StrategyController,
  StrategyExecutionContext,
  StrategyMetadata,
  StrategySignal,
} from '../types.js';
import { IndicatorEngine } from '../IndicatorEngine.js';

export class EmaMacdStrategy implements StrategyController {
  private config: BotConfigSchemaV1 | null = null;
  private lastSignalAt = 0;

  public getMetadata(): StrategyMetadata {
    return {
      strategyId: 'ema_macd',
      name: 'EMA + MACD Trend Following',
      version: '1.0.0',
      category: 'DIRECTIONAL',
      description:
        'Mengikuti tren primer menggunakan persilangan Fast/Slow EMA yang divalidasi oleh momentum histogram MACD.',
      supportedMarketTypes: ['SPOT'],
      supportedTimeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1D'],
      requiredIndicators: ['EMA', 'MACD', 'ATR'],
      configurationSchema: [
        { key: 'fastEmaPeriod', label: 'Fast EMA Period', type: 'number', defaultValue: 12, min: 2, max: 100, step: 1, description: 'Periode EMA cepat.' },
        { key: 'slowEmaPeriod', label: 'Slow EMA Period', type: 'number', defaultValue: 26, min: 5, max: 250, step: 1, description: 'Periode EMA lambat.' },
        { key: 'macdFast', label: 'MACD Fast', type: 'number', defaultValue: 12, min: 2, max: 100, step: 1, description: 'Periode EMA cepat MACD.' },
        { key: 'macdSlow', label: 'MACD Slow', type: 'number', defaultValue: 26, min: 5, max: 200, step: 1, description: 'Periode EMA lambat MACD.' },
        { key: 'macdSignal', label: 'MACD Signal', type: 'number', defaultValue: 9, min: 2, max: 50, step: 1, description: 'Periode garis sinyal MACD.' },
        { key: 'confirmationPeriod', label: 'Confirmation Bars', type: 'number', defaultValue: 2, min: 1, max: 10, step: 1, description: 'Jendela bar pasca-crossover untuk validasi momentum.' },
        { key: 'minMomentumThreshold', label: 'Min Histogram Threshold', type: 'number', defaultValue: 0, min: 0, max: 1000000, step: 0.01, description: 'Ambang minimum histogram MACD bullish.' },
        { key: 'signalCooldownSec', label: 'Signal Cooldown (sec)', type: 'number', defaultValue: 60, min: 0, max: 86400, step: 5, description: 'Jeda minimum antar sinyal.' },
      ],
      riskCompatibility: {
        supportsTripleBarrier: true,
        supportsTrailingStop: true,
        requiresQuoteLevelRisk: false,
      },
      status: 'ACTIVE',
    };
  }

  public initialize(config: BotConfigSchemaV1): void {
    this.config = config;
    this.lastSignalAt = 0;
  }

  public validateConfig(config: BotConfigSchemaV1): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const ind = config.strategy?.indicators || {};

    const fastEma = Number(ind.fastEmaPeriod ?? 12);
    const slowEma = Number(ind.slowEmaPeriod ?? 26);
    const macdFast = Number(ind.macdFast ?? 12);
    const macdSlow = Number(ind.macdSlow ?? 26);
    const macdSig = Number(ind.macdSignal ?? 9);

    if (fastEma >= slowEma) errors.push('fastEmaPeriod harus lebih kecil daripada slowEmaPeriod.');
    if (macdFast >= macdSlow) errors.push('macdFast harus lebih kecil daripada macdSlow.');
    if (macdSig < 2) errors.push('macdSignal minimal 2.');
    if (slowEma - fastEma < 3) warnings.push('Jarak Fast & Slow EMA sangat sempit; berpotensi noise whipsaw.');

    return { valid: errors.length === 0, errors, warnings };
  }

  public onMarketData(_data: NormalizedMarketData): void {}
  public onPositionUpdate(_position: BotPositionState): void {}
  public onExecutionUpdate(_execution: BotExecutionRecord): void {}
  public reset(): void {
    this.lastSignalAt = 0;
  }

  public generateSignal(context: StrategyExecutionContext): StrategySignal {
    const cfg = this.config || context.config;
    const ind = cfg.strategy.indicators || {};
    const candles = context.marketData.candles;
    const now = context.now;

    const fastPeriod = Math.max(2, Number(ind.fastEmaPeriod ?? 12));
    const slowPeriod = Math.max(fastPeriod + 1, Number(ind.slowEmaPeriod ?? 26));
    const macdFast = Math.max(2, Number(ind.macdFast ?? 12));
    const macdSlow = Math.max(macdFast + 1, Number(ind.macdSlow ?? 26));
    const macdSignal = Math.max(2, Number(ind.macdSignal ?? 9));
    const confBars = Math.max(1, Math.trunc(Number(ind.confirmationPeriod ?? 2)));
    const minHist = Math.max(0, Number(ind.minMomentumThreshold ?? 0));
    const cooldownMs = Math.max(0, Number(ind.signalCooldownSec ?? 60)) * 1000;

    const minBars = Math.max(slowPeriod, macdSlow + macdSignal) + confBars;
    const refPrice = context.marketData.referencePrice;

    const makeHold = (reason: string, vals: Record<string, number | string | boolean> = {}): StrategySignal => ({
      signalId: crypto.randomUUID(),
      strategyId: 'ema_macd',
      botInstanceId: context.botId,
      tradingPair: context.marketData.pairId,
      signalTimestamp: now,
      signalExpiration: now + 30_000,
      category: 'DIRECTIONAL',
      signalType: 'HOLD',
      confidenceScore: 0,
      indicatorValues: vals,
      referenceMarketPriceUnits: context.marketData.referencePriceUnits,
      referenceMarketPrice: refPrice,
      strategyExplanation: reason,
      riskMetadata: {
        regime: context.marketData.volatility.regime,
        volatilityAtrPct: context.marketData.volatility.atrPct,
        isEligibleForTripleBarrier: false,
      },
    });

    if (candles.length < minBars) {
      return makeHold(`Menunggu minimal ${minBars} candle untuk EMA + MACD (tersedia ${candles.length}).`);
    }

    const closes = candles.map(c => c.close);
    const fastArr = IndicatorEngine.emaSeries(closes, fastPeriod);
    const slowArr = IndicatorEngine.emaSeries(closes, slowPeriod);
    const macdArr = IndicatorEngine.macdSeries(closes, macdFast, macdSlow, macdSignal);
    const atrInfo = IndicatorEngine.atr(candles, 14);

    const last = candles.length - 1;
    const fNow = fastArr[last];
    const sNow = slowArr[last];
    const mNow = macdArr[last];
    const mPrev = macdArr[last - 1];

    const indicatorValues: Record<string, number | string | boolean> = {
      fastEma: Number(fNow.toFixed(4)),
      slowEma: Number(sNow.toFixed(4)),
      macdLine: Number(mNow.macdLine.toFixed(6)),
      macdSignal: Number(mNow.signalLine.toFixed(6)),
      macdHistogram: Number(mNow.histogram.toFixed(6)),
      atrPct: Number(atrInfo.pctOfPrice.toFixed(3)),
    };

    if (cooldownMs > 0 && now - this.lastSignalAt < cooldownMs) {
      return makeHold('Dalam periode signal cooldown.', indicatorValues);
    }

    const isFlat = context.position.side === 'FLAT' || BigInt(context.position.baseQtyUnits || '0') <= 0n;

    let recentBullCross = false;
    let recentBearCross = false;
    for (let k = Math.max(1, last - confBars + 1); k <= last; k++) {
      if (fastArr[k - 1] <= slowArr[k - 1] && fastArr[k] > slowArr[k]) recentBullCross = true;
      if (fastArr[k - 1] >= slowArr[k - 1] && fastArr[k] < slowArr[k]) recentBearCross = true;
    }

    if (!isFlat) {
      const macdReversed = mNow.histogram < -minHist && mNow.histogram < mPrev.histogram && mNow.macdLine < mNow.signalLine;
      if (recentBearCross || (fNow < sNow && macdReversed)) {
        this.lastSignalAt = now;
        return {
          signalId: crypto.randomUUID(),
          strategyId: 'ema_macd',
          botInstanceId: context.botId,
          tradingPair: context.marketData.pairId,
          signalTimestamp: now,
          signalExpiration: now + 30_000,
          category: 'DIRECTIONAL',
          signalType: 'EXIT',
          confidenceScore: 80,
          indicatorValues,
          referenceMarketPriceUnits: context.marketData.referencePriceUnits,
          referenceMarketPrice: refPrice,
          strategyExplanation: recentBearCross
            ? `EXIT: Fast EMA (${fNow.toFixed(2)}) memotong ke bawah Slow EMA (${sNow.toFixed(2)}).`
            : `EXIT: Pembalikan momentum MACD histogram (${mNow.histogram.toFixed(4)}).`,
          riskMetadata: {
            regime: context.marketData.volatility.regime,
            volatilityAtrPct: atrInfo.pctOfPrice,
            isEligibleForTripleBarrier: false,
          },
        };
      }
      return makeHold('Tren EMA/MACD masih bullish; menahan posisi.', indicatorValues);
    }

    const bullishMomentum = mNow.histogram > minHist && mNow.macdLine >= mNow.signalLine;
    const trendAligned = fNow > sNow;
    const macdFreshCross = mPrev.histogram <= minHist && mNow.histogram > minHist;

    if ((recentBullCross && bullishMomentum) || (trendAligned && macdFreshCross)) {
      this.lastSignalAt = now;
      return {
        signalId: crypto.randomUUID(),
        strategyId: 'ema_macd',
        botInstanceId: context.botId,
        tradingPair: context.marketData.pairId,
        signalTimestamp: now,
        signalExpiration: now + 30_000,
        category: 'DIRECTIONAL',
        signalType: 'BUY',
        confidenceScore: recentBullCross ? 84 : 74,
        indicatorValues,
        referenceMarketPriceUnits: context.marketData.referencePriceUnits,
        referenceMarketPrice: refPrice,
        strategyExplanation: `BUY Trend Following: Fast EMA (${fNow.toFixed(2)}) > Slow EMA (${sNow.toFixed(2)}) & MACD Hist +${mNow.histogram.toFixed(4)}.`,
        riskMetadata: {
          regime: context.marketData.volatility.regime,
          volatilityAtrPct: atrInfo.pctOfPrice,
          suggestedStopDistanceBps: Math.max(60, Math.round(atrInfo.pctOfPrice * 180)),
          isEligibleForTripleBarrier: true,
        },
      };
    }

    return makeHold('Menunggu crossover EMA bullish & konfirmasi histogram MACD.', indicatorValues);
  }
}
