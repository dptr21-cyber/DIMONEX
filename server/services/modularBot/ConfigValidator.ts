/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/ConfigValidator.ts
 * Versioned JSON Schema v1.0 & Market Capability Validator for MODULAR_STRATEGY_BOT.
 */

import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import {
  BotConfigSchemaV1,
  ConfigValidationResult,
  MarketConstraints,
  RuleNode,
  SupportedIndicatorId,
} from './types.js';
import { strategyRegistry } from './StrategyRegistry.js';

const SUPPORTED_INDICATORS: Set<SupportedIndicatorId> = new Set([
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
]);

const LOGICAL_OPS = new Set(['AND', 'OR', 'NOT']);
const COMPARISON_OPS = new Set([
  'GREATER_THAN',
  'LESS_THAN',
  'CROSS_ABOVE',
  'CROSS_BELOW',
  'EQUAL',
  'BETWEEN',
]);

const ALLOWED_INDICATOR_FIELDS: Record<SupportedIndicatorId, Set<string>> = {
  SMA: new Set(['value']),
  EMA: new Set(['value']),
  RSI: new Set(['value']),
  MACD: new Set(['macdLine', 'signalLine', 'histogram']),
  BOLLINGER_BANDS: new Set(['upper', 'middle', 'lower', 'bandwidthPct']),
  ATR: new Set(['value', 'pctOfPrice']),
  ADX: new Set(['adx', 'plusDi', 'minusDi']),
  STOCHASTIC: new Set(['k', 'd']),
  STOCHASTIC_RSI: new Set(['k', 'd']),
  VWAP: new Set(['value']),
  VOLUME_MA: new Set(['value', 'ratio']),
  OBV: new Set(['value']),
  MFI: new Set(['value']),
};

export function normalizePairId(rawPair: string): string {
  return String(rawPair || '')
    .trim()
    .toUpperCase()
    .replace('/', '-');
}

export function isValidPositiveDecimalString(val: unknown): boolean {
  if (typeof val !== 'string' && typeof val !== 'number') return false;
  const s = String(val).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return false;
  return parseFloat(s) > 0;
}

export function isValidNonNegativeDecimalString(val: unknown): boolean {
  if (typeof val !== 'string' && typeof val !== 'number') return false;
  const s = String(val).trim();
  return /^\d+(\.\d+)?$/.test(s);
}

export function validateRuleNode(node: RuleNode, path: string, errors: string[]): void {
  if (!node || typeof node !== 'object') {
    errors.push(`${path}: Rule node tidak valid.`);
    return;
  }

  if (node.type === 'GROUP') {
    if (!LOGICAL_OPS.has(node.operator)) {
      errors.push(`${path}.operator: Operator logika tidak didukung (${String((node as any).operator)}).`);
    }
    if (!Array.isArray(node.children) || node.children.length === 0) {
      errors.push(`${path}.children: Grup aturan harus memiliki minimal 1 kondisi.`);
      return;
    }
    if (node.operator === 'NOT' && node.children.length !== 1) {
      errors.push(`${path}.children: Operator NOT hanya boleh memiliki tepat 1 child node.`);
    }
    node.children.forEach((child, idx) => validateRuleNode(child, `${path}.children[${idx}]`, errors));
    return;
  }

  if (node.type === 'CONDITION') {
    if (!COMPARISON_OPS.has(node.operator)) {
      errors.push(`${path}.operator: Operator perbandingan tidak valid (${String((node as any).operator)}).`);
    }
    const validateOperand = (op: any, label: string) => {
      if (!op || typeof op !== 'object') {
        errors.push(`${path}.${label}: Operand hilang.`);
        return;
      }
      if (op.kind === 'INDICATOR') {
        if (!op.indicator || !SUPPORTED_INDICATORS.has(op.indicator)) {
          errors.push(`${path}.${label}: Indikator tidak dikenali (${String(op.indicator)}).`);
          return;
        }
        const field = op.field || 'value';
        const allowed = ALLOWED_INDICATOR_FIELDS[op.indicator as SupportedIndicatorId];
        if (allowed && !allowed.has(field)) {
          errors.push(`${path}.${label}: Field "${field}" tidak kompatibel dengan indikator ${op.indicator}.`);
        }
        if (op.params) {
          for (const [pk, pv] of Object.entries(op.params)) {
            if (typeof pv !== 'number' || !Number.isFinite(pv) || pv <= 0) {
              errors.push(`${path}.${label}.params.${pk}: Parameter indikator harus angka positif.`);
            }
          }
        }
      } else if (op.kind === 'PRICE') {
        if (!['close', 'open', 'high', 'low', 'volume'].includes(op.priceField || 'close')) {
          errors.push(`${path}.${label}.priceField: Field harga tidak valid.`);
        }
      } else if (op.kind === 'CONSTANT') {
        if (typeof op.value !== 'number' || !Number.isFinite(op.value)) {
          errors.push(`${path}.${label}.value: Nilai konstanta harus numerik valid.`);
        }
      } else {
        errors.push(`${path}.${label}.kind: Jenis operand tidak didukung.`);
      }
    };

    validateOperand(node.left, 'left');
    validateOperand(node.right, 'right');
    if (node.operator === 'BETWEEN') {
      validateOperand(node.rightUpper, 'rightUpper');
    }
    return;
  }

  errors.push(`${path}.type: Tipe rule node harus GROUP atau CONDITION.`);
}

export class ConfigValidator {
  public static validate(
    rawConfig: BotConfigSchemaV1,
    constraints?: MarketConstraints | null
  ): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!rawConfig || typeof rawConfig !== 'object') {
      return { valid: false, errors: ['Konfigurasi JSON tidak valid.'], warnings };
    }

    if (rawConfig.schemaVersion !== '1.0') {
      errors.push(`schemaVersion harus "1.0" (diterima: "${String((rawConfig as any).schemaVersion)}").`);
    }

    const bot = rawConfig.bot;
    if (!bot || typeof bot !== 'object') {
      errors.push('Section "bot" wajib diisi.');
    } else {
      if (!bot.name || String(bot.name).trim().length < 2) {
        errors.push('bot.name minimal 2 karakter.');
      }
      if (!['DIRECTIONAL', 'MARKET_MAKING', 'HYBRID'].includes(bot.category)) {
        errors.push(`bot.category tidak valid: ${String(bot.category)}`);
      }
      if (!bot.strategyId || !strategyRegistry.has(bot.strategyId)) {
        errors.push(`bot.strategyId "${String(bot.strategyId)}" tidak terdaftar.`);
      } else {
        const meta = strategyRegistry.getMetadata(bot.strategyId)!;
        if (meta.category !== bot.category && !(meta.category === 'HYBRID' && bot.category === 'MARKET_MAKING')) {
          errors.push(`Kategori "${bot.category}" tidak sesuai dengan strategi "${bot.strategyId}" (${meta.category}).`);
        }
        if (bot.strategyVersion && bot.strategyVersion !== meta.version) {
          warnings.push(`Versi strategi dikonfigurasi (${bot.strategyVersion}) berbeda dengan plugin aktif (${meta.version}).`);
        }
      }
      if (!['BACKTEST', 'PAPER', 'LIVE'].includes(bot.mode)) {
        errors.push(`bot.mode tidak valid: ${String(bot.mode)}`);
      }
      if (!bot.tradingPair || !normalizePairId(bot.tradingPair)) {
        errors.push('bot.tradingPair wajib diisi.');
      }
    }

    const market = rawConfig.market;
    if (!market || typeof market !== 'object') {
      errors.push('Section "market" wajib diisi.');
    } else {
      const strategyMeta = bot?.strategyId ? strategyRegistry.getMetadata(bot.strategyId) : null;
      if (strategyMeta && !strategyMeta.supportedTimeframes.includes(market.timeframe)) {
        errors.push(`Timeframe ${market.timeframe} tidak didukung oleh strategi ${strategyMeta.name}.`);
      }
      if (market.dataSource !== 'DIMONEX') {
        errors.push(`Sumber data "${String(market.dataSource)}" belum tersedia; gunakan "DIMONEX".`);
      }
      if (!['LAST_TRADE', 'MIDPOINT', 'BEST_BID', 'BEST_ASK'].includes(market.priceReference)) {
        errors.push(`market.priceReference tidak valid: ${String(market.priceReference)}`);
      }
      if (market.maxDataAgeMs !== undefined && (market.maxDataAgeMs < 1000 || market.maxDataAgeMs > 300_000)) {
        errors.push('market.maxDataAgeMs harus antara 1000 ms dan 300000 ms.');
      }
    }

    const exec = rawConfig.execution;
    if (!exec || typeof exec !== 'object') {
      errors.push('Section "execution" wajib diisi.');
    } else {
      if (!['POST_ONLY', 'LIMIT', 'IOC', 'FOK', 'MARKET'].includes(exec.orderType)) {
        errors.push(`execution.orderType tidak valid: ${String(exec.orderType)}`);
      }
      if (!['GTC', 'IOC', 'FOK'].includes(exec.timeInForce)) {
        errors.push(`execution.timeInForce tidak valid: ${String(exec.timeInForce)}`);
      }
      if (exec.maxSlippageBps < 0 || exec.maxSlippageBps > 2000) {
        errors.push('execution.maxSlippageBps harus di antara 0 dan 2000 bps.');
      }
      if (exec.orderTimeoutSeconds < 1 || exec.orderTimeoutSeconds > 86400) {
        errors.push('execution.orderTimeoutSeconds harus di antara 1 detik dan 86400 detik.');
      }
      if (constraints) {
        if (!constraints.isActive || constraints.isHalted) {
          errors.push(`Market ${constraints.pairId} saat ini tidak aktif atau di-halt.`);
        }
        if (exec.orderType === 'POST_ONLY' && !constraints.supportsPostOnly) {
          errors.push(`Market ${constraints.pairId} tidak mendukung POST_ONLY.`);
        }
        if (exec.orderType === 'FOK' && !constraints.supportsFok) {
          warnings.push(`MatchingEngine mengeksekusi FOK melalui verifikasi fillability penuh sisi-lawan sebelum commit.`);
        }
      }
    }

    const risk = rawConfig.risk;
    if (!risk || typeof risk !== 'object') {
      errors.push('Section "risk" wajib diisi.');
    } else {
      if (!risk.positionSizing || !['FIXED_QTY', 'FIXED_QUOTE', 'PERCENT_BALANCE', 'RISK_PER_TRADE'].includes(risk.positionSizing.method)) {
        errors.push('risk.positionSizing.method tidak valid.');
      } else if (!isValidPositiveDecimalString(risk.positionSizing.value)) {
        errors.push('risk.positionSizing.value harus angka desimal positif.');
      } else if (risk.positionSizing.method === 'PERCENT_BALANCE' && parseFloat(risk.positionSizing.value) > 100) {
        errors.push('risk.positionSizing.value (PERCENT_BALANCE) tidak boleh melebihi 100%.');
      }

      if (risk.tripleBarrier?.enabled) {
        if (bot?.category === 'MARKET_MAKING') {
          warnings.push('Triple Barrier position TP/SL tidak diterapkan ke order kuotasi Market Making; kontrol risiko level-kuotasi dan batas inventori yang digunakan.');
        }
        if (risk.tripleBarrier.takeProfitBps <= 0 && !risk.tripleBarrier.takeProfitAbsPrice) {
          errors.push('tripleBarrier.takeProfitBps harus > 0 ketika Triple Barrier aktif.');
        }
        if (risk.tripleBarrier.stopLossBps <= 0 && !risk.tripleBarrier.stopLossAbsPrice) {
          errors.push('tripleBarrier.stopLossBps harus > 0 ketika Triple Barrier aktif.');
        }
        if (risk.tripleBarrier.maxHoldingSeconds < 10) {
          errors.push('tripleBarrier.maxHoldingSeconds minimal 10 detik.');
        }
      }

      if (risk.trailingStop?.enabled) {
        if (risk.trailingStop.activationBps <= 0 || risk.trailingStop.distanceBps <= 0) {
          errors.push('trailingStop.activationBps dan distanceBps harus > 0.');
        }
      }

      if (!risk.limits) {
        errors.push('risk.limits wajib diisi.');
      } else {
        if (risk.limits.maxOpenOrders < 1 || risk.limits.maxOpenOrders > 100) {
          errors.push('risk.limits.maxOpenOrders harus antara 1 dan 100.');
        }
        if (!isValidPositiveDecimalString(risk.limits.maxNotional)) {
          errors.push('risk.limits.maxNotional harus angka positif (string desimal).');
        }
        if (!isValidPositiveDecimalString(risk.limits.maxDailyLoss)) {
          errors.push('risk.limits.maxDailyLoss harus angka positif (string desimal).');
        }
        if (risk.limits.maxPositionBase && !isValidPositiveDecimalString(risk.limits.maxPositionBase)) {
          errors.push('risk.limits.maxPositionBase harus angka desimal positif.');
        }
        if (risk.limits.maxDrawdownPct !== undefined && (risk.limits.maxDrawdownPct <= 0 || risk.limits.maxDrawdownPct > 100)) {
          errors.push('risk.limits.maxDrawdownPct harus di antara 0 dan 100.');
        }
      }
    }

    // Validate Custom Rule Nodes cleanly without executing code
    if (Array.isArray(rawConfig.strategy?.entryRules)) {
      rawConfig.strategy.entryRules.forEach((n, idx) => validateRuleNode(n, `strategy.entryRules[${idx}]`, errors));
    }
    if (Array.isArray(rawConfig.strategy?.exitRules)) {
      rawConfig.strategy.exitRules.forEach((n, idx) => validateRuleNode(n, `strategy.exitRules[${idx}]`, errors));
    }

    // Precision check against market constraints (FIXED_QTY sizing)
    if (constraints && risk?.positionSizing?.method === 'FIXED_QTY' && isValidPositiveDecimalString(risk.positionSizing.value)) {
      try {
        const qtyUnits = PrecisionMath.parseToUnits(risk.positionSizing.value, constraints.baseDecimals);
        const minUnits = BigInt(constraints.minOrderSizeUnits);
        const maxUnits = BigInt(constraints.maxOrderSizeUnits);
        if (qtyUnits < minUnits) {
          errors.push(
            `positionSizing FIXED_QTY (${risk.positionSizing.value} ${constraints.baseCurrency}) di bawah minimum market (${PrecisionMath.formatFromUnits(minUnits, constraints.baseDecimals, true)} ${constraints.baseCurrency}).`
          );
        }
        if (qtyUnits > maxUnits) {
          errors.push(`positionSizing FIXED_QTY melebihi batas maksimum market.`);
        }
      } catch (e: any) {
        errors.push(`Presisi FIXED_QTY tidak sesuai desimal base (${constraints.baseDecimals}): ${e?.message}`);
      }
    }

    // Delegate plugin-specific parameter validation if plugin exists
    if (bot?.strategyId && strategyRegistry.has(bot.strategyId)) {
      try {
        const controller = strategyRegistry.createController(bot.strategyId);
        const stratCheck = controller.validateConfig(rawConfig, constraints || undefined);
        errors.push(...stratCheck.errors);
        warnings.push(...stratCheck.warnings);
      } catch (e: any) {
        errors.push(`Validasi plugin gagal: ${e?.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
