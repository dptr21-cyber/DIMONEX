/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/strategies/CustomRuleBuilderStrategy.ts
 * Category A — Directional Trading: Declarative Custom Strategy Rule Builder (AST-only, zero eval).
 */

import crypto from 'crypto';
import {
  BotConfigSchemaV1,
  BotExecutionRecord,
  BotPositionState,
  ConfigValidationResult,
  NormalizedMarketData,
  RuleNode,
  StrategyController,
  StrategyExecutionContext,
  StrategyMetadata,
  StrategySignal,
} from '../types.js';
import { IndicatorEngine } from '../IndicatorEngine.js';
import { validateRuleNode } from '../ConfigValidator.js';

export class CustomRuleBuilderStrategy implements StrategyController {
  private config: BotConfigSchemaV1 | null = null;
  private lastSignalAt = 0;

  public getMetadata(): StrategyMetadata {
    return {
      strategyId: 'custom_rule_builder',
      name: 'Custom Strategy Rule Builder (AST)',
      version: '1.0.0',
      category: 'DIRECTIONAL',
      description:
        'Mesin aturan deklaratif berbasis pohon kondisi (AST) mendukung 13 indikator teknikal serta operator logika/persilangan tanpa eksekusi kode dinamis.',
      supportedMarketTypes: ['SPOT'],
      supportedTimeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1D'],
      requiredIndicators: [
        'SMA',
        'EMA',
        'RSI',
        'MACD',
        'BOLLINGER_BANDS',
        'ATR',
        'ADX',
        'STOCHASTIC',
        'STOCHASTIC_RSI',
        'VWAP',
        'VOLUME_MA',
        'OBV',
        'MFI',
      ],
      configurationSchema: [
        {
          key: 'combineMode',
          label: 'Top-Level Rule Combiner',
          type: 'select',
          defaultValue: 'ALL_AND',
          options: ['ALL_AND', 'ANY_OR'],
          description: 'Menggabungkan daftar entryRules/exitRules dengan AND atau OR.',
        },
        { key: 'signalCooldownSec', label: 'Signal Cooldown (sec)', type: 'number', defaultValue: 45, min: 0, max: 86400, step: 5, description: 'Jeda minimum antar sinyal.' },
        { key: 'minCandlesRequired', label: 'Minimum Warmup Candles', type: 'number', defaultValue: 30, min: 5, max: 300, step: 1, description: 'Jumlah candle minimum sebelum aturan dievaluasi.' },
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
    const entryRules = config.strategy?.entryRules || [];
    const exitRules = config.strategy?.exitRules || [];

    if (!Array.isArray(entryRules) || entryRules.length === 0) {
      errors.push('Custom Rule Builder wajib memiliki minimal 1 entryRule.');
    } else {
      entryRules.forEach((r, i) => validateRuleNode(r, `entryRules[${i}]`, errors));
    }

    if (!Array.isArray(exitRules) || exitRules.length === 0) {
      warnings.push('Belum ada exitRule; bot akan bergantung pada Triple Barrier / Trailing Stop.');
    } else {
      exitRules.forEach((r, i) => validateRuleNode(r, `exitRules[${i}]`, errors));
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  public onMarketData(_data: NormalizedMarketData): void {}
  public onPositionUpdate(_position: BotPositionState): void {}
  public onExecutionUpdate(_execution: BotExecutionRecord): void {}
  public reset(): void {
    this.lastSignalAt = 0;
  }

  private evaluateRuleList(
    rules: RuleNode[],
    combineMode: string,
    context: StrategyExecutionContext
  ): { matched: boolean; values: Record<string, number> } {
    if (!rules || rules.length === 0) return { matched: false, values: {} };
    const aggregated: Record<string, number> = {};
    const outcomes = rules.map(rule => {
      const res = IndicatorEngine.evaluateRuleNode(rule, context.marketData.candles);
      Object.assign(aggregated, res.values);
      return res.matched;
    });
    const matched = combineMode === 'ANY_OR' ? outcomes.some(Boolean) : outcomes.every(Boolean);
    return { matched, values: aggregated };
  }

  public generateSignal(context: StrategyExecutionContext): StrategySignal {
    const cfg = this.config || context.config;
    const ind = cfg.strategy.indicators || {};
    const candles = context.marketData.candles;
    const now = context.now;

    const combineMode = String(ind.combineMode || 'ALL_AND');
    const cooldownMs = Math.max(0, Number(ind.signalCooldownSec ?? 45)) * 1000;
    const minWarmup = Math.max(5, Number(ind.minCandlesRequired ?? 30));
    const refPrice = context.marketData.referencePrice;

    const makeHold = (reason: string, vals: Record<string, number | string | boolean> = {}): StrategySignal => ({
      signalId: crypto.randomUUID(),
      strategyId: 'custom_rule_builder',
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

    if (candles.length < minWarmup) {
      return makeHold(`Menunggu ${minWarmup} warmup candles (tersedia ${candles.length}).`);
    }

    if (cooldownMs > 0 && now - this.lastSignalAt < cooldownMs) {
      return makeHold('Menunggu cooldown aturan kustom.');
    }

    const isFlat = context.position.side === 'FLAT' || BigInt(context.position.baseQtyUnits || '0') <= 0n;

    if (!isFlat) {
      const exitEval = this.evaluateRuleList(cfg.strategy.exitRules || [], combineMode, context);
      if (exitEval.matched) {
        this.lastSignalAt = now;
        return {
          signalId: crypto.randomUUID(),
          strategyId: 'custom_rule_builder',
          botInstanceId: context.botId,
          tradingPair: context.marketData.pairId,
          signalTimestamp: now,
          signalExpiration: now + 30_000,
          category: 'DIRECTIONAL',
          signalType: 'EXIT',
          confidenceScore: 82,
          indicatorValues: exitEval.values,
          referenceMarketPriceUnits: context.marketData.referencePriceUnits,
          referenceMarketPrice: refPrice,
          strategyExplanation: `EXIT Custom Rule Builder terpenuhi (${cfg.strategy.exitRules.length} rule ${combineMode}).`,
          riskMetadata: {
            regime: context.marketData.volatility.regime,
            volatilityAtrPct: context.marketData.volatility.atrPct,
            isEligibleForTripleBarrier: false,
          },
        };
      }
      return makeHold('Aturan exit kustom belum terpenuhi; menahan posisi.', exitEval.values);
    }

    const entryEval = this.evaluateRuleList(cfg.strategy.entryRules || [], combineMode, context);
    if (entryEval.matched) {
      this.lastSignalAt = now;
      return {
        signalId: crypto.randomUUID(),
        strategyId: 'custom_rule_builder',
        botInstanceId: context.botId,
        tradingPair: context.marketData.pairId,
        signalTimestamp: now,
        signalExpiration: now + 30_000,
        category: 'DIRECTIONAL',
        signalType: 'BUY',
        confidenceScore: 80,
        indicatorValues: entryEval.values,
        referenceMarketPriceUnits: context.marketData.referencePriceUnits,
        referenceMarketPrice: refPrice,
        strategyExplanation: `BUY Custom Rule Builder terpenuhi (${cfg.strategy.entryRules.length} rule ${combineMode}).`,
        riskMetadata: {
          regime: context.marketData.volatility.regime,
          volatilityAtrPct: context.marketData.volatility.atrPct,
          suggestedStopDistanceBps: Math.max(50, Math.round(context.marketData.volatility.atrPct * 150)),
          isEligibleForTripleBarrier: true,
        },
      };
    }

    return makeHold('Aturan entry kustom belum terpenuhi.', entryEval.values);
  }
}
