/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/strategies/SupertrendStrategy.ts
 * Category A — Directional Trading: ATR-Based Supertrend Follower.
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

export class SupertrendStrategy implements StrategyController {
  private config: BotConfigSchemaV1 | null = null;
  private lastSignalAt = 0;

  public getMetadata(): StrategyMetadata {
    return {
      strategyId: 'supertrend',
      name: 'Supertrend ATR Trend',
      version: '1.0.0',
      category: 'DIRECTIONAL',
      description:
        'Deteksi pembalikan dan kelanjutan tren dinamis berbasis Average True Range (ATR) dengan konfirmasi jumlah candle.',
      supportedMarketTypes: ['SPOT'],
      supportedTimeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1D'],
      requiredIndicators: ['ATR'],
      configurationSchema: [
        { key: 'atrPeriod', label: 'ATR Period', type: 'number', defaultValue: 10, min: 3, max: 50, step: 1, description: 'Periode volatilitas ATR.' },
        { key: 'atrMultiplier', label: 'ATR Multiplier', type: 'number', defaultValue: 3, min: 0.5, max: 8, step: 0.1, description: 'Faktor pengali band Supertrend.' },
        { key: 'trendConfirmation', label: 'Trend Confirmation Bars', type: 'number', defaultValue: 1, min: 1, max: 6, step: 1, description: 'Jumlah candle UP berturut-turut untuk entry.' },
        { key: 'reversalConfirmation', label: 'Reversal Confirmation Bars', type: 'number', defaultValue: 1, min: 1, max: 6, step: 1, description: 'Jumlah candle DOWN berturut-turut untuk exit.' },
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

    const atrPeriod = Number(ind.atrPeriod ?? 10);
    const atrMult = Number(ind.atrMultiplier ?? 3);
    if (!Number.isFinite(atrPeriod) || atrPeriod < 3 || atrPeriod > 100) {
      errors.push('atrPeriod harus antara 3 dan 100.');
    }
    if (!Number.isFinite(atrMult) || atrMult <= 0 || atrMult > 10) {
      errors.push('atrMultiplier harus antara 0.1 dan 10.');
    }
    if (atrMult < 1.2) {
      warnings.push('atrMultiplier < 1.2 meningkatkan sensitivitas false flip.');
    }
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

    const atrPeriod = Math.max(3, Number(ind.atrPeriod ?? 10));
    const atrMult = Math.max(0.5, Number(ind.atrMultiplier ?? 3));
    const trendConf = Math.max(1, Math.trunc(Number(ind.trendConfirmation ?? 1)));
    const revConf = Math.max(1, Math.trunc(Number(ind.reversalConfirmation ?? 1)));
    const cooldownMs = Math.max(0, Number(ind.signalCooldownSec ?? 60)) * 1000;

    const minBars = atrPeriod + Math.max(trendConf, revConf) + 2;
    const refPrice = context.marketData.referencePrice;

    const makeHold = (reason: string, vals: Record<string, number | string | boolean> = {}): StrategySignal => ({
      signalId: crypto.randomUUID(),
      strategyId: 'supertrend',
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
      return makeHold(`Menunggu minimal ${minBars} candle untuk Supertrend (tersedia ${candles.length}).`);
    }

    const stSeries = IndicatorEngine.supertrendSeries(candles, atrPeriod, atrMult);
    const last = stSeries.length - 1;
    const curr = stSeries[last];
    const close = candles[last].close;
    const atrPct = close > 0 ? (curr.atr / close) * 100 : context.marketData.volatility.atrPct;

    const vals: Record<string, number | string | boolean> = {
      supertrendTrend: curr.trend,
      supertrendLevel: Number(curr.supertrend.toFixed(4)),
      upperBand: Number(curr.upperBand.toFixed(4)),
      lowerBand: Number(curr.lowerBand.toFixed(4)),
      atr: Number(curr.atr.toFixed(6)),
      atrPct: Number(atrPct.toFixed(3)),
    };

    if (cooldownMs > 0 && now - this.lastSignalAt < cooldownMs) {
      return makeHold('Menunggu cooldown sinyal Supertrend.', vals);
    }

    const isFlat = context.position.side === 'FLAT' || BigInt(context.position.baseQtyUnits || '0') <= 0n;

    if (!isFlat) {
      const consecutiveDown = stSeries
        .slice(Math.max(0, stSeries.length - revConf))
        .every(s => s.trend === 'DOWN');
      if (consecutiveDown) {
        this.lastSignalAt = now;
        return {
          signalId: crypto.randomUUID(),
          strategyId: 'supertrend',
          botInstanceId: context.botId,
          tradingPair: context.marketData.pairId,
          signalTimestamp: now,
          signalExpiration: now + 30_000,
          category: 'DIRECTIONAL',
          signalType: 'EXIT',
          confidenceScore: 85,
          indicatorValues: vals,
          referenceMarketPriceUnits: context.marketData.referencePriceUnits,
          referenceMarketPrice: refPrice,
          strategyExplanation: `EXIT Supertrend Reversal: ${revConf} bar terkonfirmasi DOWN di bawah level ${curr.supertrend.toFixed(2)}.`,
          riskMetadata: {
            regime: context.marketData.volatility.regime,
            volatilityAtrPct: atrPct,
            isEligibleForTripleBarrier: false,
          },
        };
      }
      return makeHold(`Supertrend masih UP (support ${curr.supertrend.toFixed(2)}).`, vals);
    }

    const consecutiveUp = stSeries
      .slice(Math.max(0, stSeries.length - trendConf))
      .every(s => s.trend === 'UP');
    const priorIdx = stSeries.length - trendConf - 1;
    const flippedRecently = priorIdx >= 0 ? stSeries[priorIdx].trend === 'DOWN' : true;

    if (consecutiveUp && (flippedRecently || close > curr.lowerBand)) {
      this.lastSignalAt = now;
      return {
        signalId: crypto.randomUUID(),
        strategyId: 'supertrend',
        botInstanceId: context.botId,
        tradingPair: context.marketData.pairId,
        signalTimestamp: now,
        signalExpiration: now + 30_000,
        category: 'DIRECTIONAL',
        signalType: 'BUY',
        confidenceScore: flippedRecently ? 86 : 75,
        indicatorValues: vals,
        referenceMarketPriceUnits: context.marketData.referencePriceUnits,
        referenceMarketPrice: refPrice,
        strategyExplanation: `BUY Supertrend UP: ${trendConf} bar konfirmasi bullish di atas band ${curr.supertrend.toFixed(2)}.`,
        riskMetadata: {
          regime: context.marketData.volatility.regime,
          volatilityAtrPct: atrPct,
          suggestedStopDistanceBps: Math.max(60, Math.round(atrPct * atrMult * 100)),
          isEligibleForTripleBarrier: true,
        },
      };
    }

    return makeHold(`Supertrend dalam fase ${curr.trend} (level ${curr.supertrend.toFixed(2)}).`, vals);
  }
}
