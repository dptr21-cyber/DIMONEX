/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/strategies/BollingerRsiStrategy.ts
 * Category A — Directional Trading: Bollinger Bands + RSI Mean Reversion.
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

export class BollingerRsiStrategy implements StrategyController {
  private config: BotConfigSchemaV1 | null = null;
  private lastSignalAt = 0;
  private lastCandleTs = 0;

  public getMetadata(): StrategyMetadata {
    return {
      strategyId: 'bollinger_rsi',
      name: 'Bollinger Bands + RSI Mean Reversion',
      version: '1.0.0',
      category: 'DIRECTIONAL',
      description:
        'Deteksi jenuh jual/jenuh beli berbasis deviasi Bollinger Bands dan momentum RSI dengan konfirmasi candle serta cooldown deterministik.',
      supportedMarketTypes: ['SPOT'],
      supportedTimeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1D'],
      requiredIndicators: ['BOLLINGER_BANDS', 'RSI', 'ATR'],
      configurationSchema: [
        { key: 'bollingerPeriod', label: 'Bollinger Period', type: 'number', defaultValue: 20, min: 5, max: 100, step: 1, description: 'Periode Moving Average Bollinger Bands.' },
        { key: 'bollingerStdDev', label: 'Bollinger StdDev', type: 'number', defaultValue: 2, min: 0.5, max: 5, step: 0.1, description: 'Pengali standar deviasi band atas dan bawah.' },
        { key: 'rsiPeriod', label: 'RSI Period', type: 'number', defaultValue: 14, min: 2, max: 50, step: 1, description: 'Periode perhitungan Relative Strength Index.' },
        { key: 'rsiOversold', label: 'RSI Oversold', type: 'number', defaultValue: 30, min: 5, max: 50, step: 1, description: 'Ambang RSI oversold untuk sinyal beli.' },
        { key: 'rsiOverbought', label: 'RSI Overbought', type: 'number', defaultValue: 70, min: 50, max: 95, step: 1, description: 'Ambang RSI overbought untuk sinyal keluar.' },
        { key: 'rsiExitThreshold', label: 'RSI Exit Threshold', type: 'number', defaultValue: 58, min: 40, max: 90, step: 1, description: 'Ambang RSI untuk exit posisi long.' },
        { key: 'entryConfirmation', label: 'Entry Confirmation Candle', type: 'boolean', defaultValue: true, description: 'Wajibkan candle konfirmasi pantulan bullish sebelum entry.' },
        {
          key: 'exitCondition',
          label: 'Exit Band Target',
          type: 'select',
          defaultValue: 'MIDDLE_OR_UPPER_BB',
          options: ['MIDDLE_OR_UPPER_BB', 'UPPER_BB_OR_RSI'],
          description: 'Target band Bollinger untuk sinyal exit posisi.',
        },
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
    this.lastCandleTs = 0;
  }

  public validateConfig(config: BotConfigSchemaV1): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const ind = config.strategy?.indicators || {};

    const bbPeriod = Number(ind.bollingerPeriod ?? 20);
    const bbStd = Number(ind.bollingerStdDev ?? 2);
    const rsiPeriod = Number(ind.rsiPeriod ?? 14);
    const rsiOversold = Number(ind.rsiOversold ?? 30);
    const rsiOverbought = Number(ind.rsiOverbought ?? 70);

    if (!Number.isFinite(bbPeriod) || bbPeriod < 5 || bbPeriod > 200) {
      errors.push('bollingerPeriod harus antara 5 dan 200.');
    }
    if (!Number.isFinite(bbStd) || bbStd <= 0 || bbStd > 6) {
      errors.push('bollingerStdDev harus antara 0.1 dan 6.');
    }
    if (!Number.isFinite(rsiPeriod) || rsiPeriod < 2 || rsiPeriod > 100) {
      errors.push('rsiPeriod harus antara 2 dan 100.');
    }
    if (rsiOversold >= rsiOverbought) {
      errors.push('rsiOversold harus lebih kecil daripada rsiOverbought.');
    }
    if (rsiOversold < 10) {
      warnings.push('rsiOversold sangat rendah (< 10) sehingga frekuensi sinyal bisa jarang.');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  public onMarketData(data: NormalizedMarketData): void {
    if (data.candles.length > 0) {
      this.lastCandleTs = data.candles[data.candles.length - 1].time;
    }
  }

  public onPositionUpdate(_position: BotPositionState): void {
    // Stateless candle-driven evaluation reads authoritative context.position
  }

  public onExecutionUpdate(_execution: BotExecutionRecord): void {
    // Cooldown maintained from signal generation
  }

  public reset(): void {
    this.lastSignalAt = 0;
    this.lastCandleTs = 0;
  }

  public generateSignal(context: StrategyExecutionContext): StrategySignal {
    const cfg = this.config || context.config;
    const ind = cfg.strategy.indicators || {};
    const candles = context.marketData.candles;
    const now = context.now;

    const bbPeriod = Math.max(5, Number(ind.bollingerPeriod ?? 20));
    const bbStd = Math.max(0.5, Number(ind.bollingerStdDev ?? 2));
    const rsiPeriod = Math.max(2, Number(ind.rsiPeriod ?? 14));
    const rsiOversold = Number(ind.rsiOversold ?? 30);
    const rsiOverbought = Number(ind.rsiOverbought ?? 70);
    const rsiExitThreshold = Number(ind.rsiExitThreshold ?? 58);
    const entryConfirmation = ind.entryConfirmation !== false;
    const exitCondition = String(ind.exitCondition || 'MIDDLE_OR_UPPER_BB');
    const cooldownMs = Math.max(0, Number(ind.signalCooldownSec ?? 60)) * 1000;

    const minBars = Math.max(bbPeriod, rsiPeriod) + 2;
    const refPrice = context.marketData.referencePrice;

    const makeHold = (
      reason: string,
      indicatorValues: Record<string, number | string | boolean> = {}
    ): StrategySignal => ({
      signalId: crypto.randomUUID(),
      strategyId: 'bollinger_rsi',
      botInstanceId: context.botId,
      tradingPair: context.marketData.pairId,
      signalTimestamp: now,
      signalExpiration: now + 30_000,
      category: 'DIRECTIONAL',
      signalType: 'HOLD',
      confidenceScore: 0,
      indicatorValues,
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
      return makeHold(`Menunggu minimal ${minBars} candle untuk Bollinger + RSI (tersedia ${candles.length}).`);
    }

    const closes = candles.map(c => c.close);
    const bbSeries = IndicatorEngine.bollingerSeries(closes, bbPeriod, bbStd);
    const rsiSeries = IndicatorEngine.rsiSeries(closes, rsiPeriod);
    const atrInfo = IndicatorEngine.atr(candles, 14);

    const lastIdx = candles.length - 1;
    const prevIdx = lastIdx - 1;
    const currCandle = candles[lastIdx];
    const prevCandle = candles[prevIdx];
    const currBb = bbSeries[lastIdx];
    const prevBb = bbSeries[prevIdx];
    const currRsi = rsiSeries[lastIdx];
    const prevRsi = rsiSeries[prevIdx];

    const indicatorValues: Record<string, number | string | boolean> = {
      bbUpper: Number(currBb.upper.toFixed(4)),
      bbMiddle: Number(currBb.middle.toFixed(4)),
      bbLower: Number(currBb.lower.toFixed(4)),
      bbBandwidthPct: Number(currBb.bandwidthPct.toFixed(3)),
      rsi: Number(currRsi.toFixed(2)),
      atrPct: Number(atrInfo.pctOfPrice.toFixed(3)),
      close: currCandle.close,
    };

    if (cooldownMs > 0 && now - this.lastSignalAt < cooldownMs) {
      return makeHold('Menunggu jendela signal cooldown selesai.', indicatorValues);
    }

    const isFlat = context.position.side === 'FLAT' || BigInt(context.position.baseQtyUnits || '0') <= 0n;

    // EXIT / SELL conditions when holding inventory
    if (!isFlat) {
      const targetBand = exitCondition === 'UPPER_BB_OR_RSI' ? currBb.upper : currBb.middle;
      const bandReached = currCandle.close >= targetBand || currCandle.high >= currBb.upper;
      const rsiExit = currRsi >= rsiOverbought || (bandReached && currRsi >= rsiExitThreshold);

      if (bandReached || rsiExit) {
        this.lastSignalAt = now;
        return {
          signalId: crypto.randomUUID(),
          strategyId: 'bollinger_rsi',
          botInstanceId: context.botId,
          tradingPair: context.marketData.pairId,
          signalTimestamp: now,
          signalExpiration: now + 30_000,
          category: 'DIRECTIONAL',
          signalType: 'EXIT',
          confidenceScore: Math.min(98, Math.round(65 + Math.max(0, currRsi - rsiExitThreshold))),
          indicatorValues,
          referenceMarketPriceUnits: context.marketData.referencePriceUnits,
          referenceMarketPrice: refPrice,
          strategyExplanation: `EXIT Long: Harga (${currCandle.close.toFixed(2)}) mencapai target BB (${targetBand.toFixed(2)}) / RSI ${currRsi.toFixed(1)}.`,
          riskMetadata: {
            regime: context.marketData.volatility.regime,
            volatilityAtrPct: atrInfo.pctOfPrice,
            isEligibleForTripleBarrier: false,
          },
        };
      }
      return makeHold(
        `Menahan posisi LONG (RSI ${currRsi.toFixed(1)}, target BB ${targetBand.toFixed(2)}).`,
        indicatorValues
      );
    }

    // ENTRY BUY conditions when flat
    const touchedLower =
      currCandle.low <= currBb.lower ||
      currCandle.close <= currBb.lower ||
      prevCandle.close <= prevBb.lower;
    const rsiIsOversold = currRsi <= rsiOversold || (prevRsi <= rsiOversold && currRsi <= rsiOversold + 5);
    const confirmedBounce = !entryConfirmation || (currCandle.close >= currCandle.open && currCandle.close >= prevCandle.close);

    if (touchedLower && rsiIsOversold && confirmedBounce) {
      this.lastSignalAt = now;
      const oversoldDepth = Math.max(0, rsiOversold - currRsi);
      const confidence = Math.min(95, Math.round(68 + oversoldDepth * 1.4));
      return {
        signalId: crypto.randomUUID(),
        strategyId: 'bollinger_rsi',
        botInstanceId: context.botId,
        tradingPair: context.marketData.pairId,
        signalTimestamp: now,
        signalExpiration: now + 30_000,
        category: 'DIRECTIONAL',
        signalType: 'BUY',
        confidenceScore: confidence,
        indicatorValues,
        referenceMarketPriceUnits: context.marketData.referencePriceUnits,
        referenceMarketPrice: refPrice,
        strategyExplanation: `BUY Mean Reversion: Harga menyentuh Lower BB (${currBb.lower.toFixed(2)}) dengan RSI oversold (${currRsi.toFixed(1)} <= ${rsiOversold}).`,
        riskMetadata: {
          regime: context.marketData.volatility.regime,
          volatilityAtrPct: atrInfo.pctOfPrice,
          suggestedStopDistanceBps: Math.max(50, Math.round(atrInfo.pctOfPrice * 150)),
          isEligibleForTripleBarrier: true,
        },
      };
    }

    return makeHold(
      `Menunggu konvergensi Lower BB (${currBb.lower.toFixed(2)}) & RSI <= ${rsiOversold} (RSI saat ini ${currRsi.toFixed(1)}).`,
      indicatorValues
    );
  }
}
