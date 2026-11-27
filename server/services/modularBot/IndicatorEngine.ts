/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/IndicatorEngine.ts
 * Pure Deterministic Quantitative Indicator Suite & Safe Declarative AST Rule Evaluator.
 * Supports all 13 required indicators + Supertrend without look-ahead bias or eval().
 */

import {
  IndicatorOperand,
  NormalizedCandle,
  RuleNode,
} from './types.js';

export interface BollingerOutput {
  upper: number;
  middle: number;
  lower: number;
  bandwidthPct: number;
}

export interface MacdOutput {
  macdLine: number;
  signalLine: number;
  histogram: number;
}

export interface AdxOutput {
  adx: number;
  plusDi: number;
  minusDi: number;
}

export interface StochasticOutput {
  k: number;
  d: number;
}

export interface SupertrendOutput {
  trend: 'UP' | 'DOWN';
  supertrend: number;
  upperBand: number;
  lowerBand: number;
  atr: number;
}

export class IndicatorEngine {
  public static smaSeries(values: number[], period: number): number[] {
    const out: number[] = [];
    const p = Math.max(1, Math.trunc(period));
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= p) sum -= values[i - p];
      const count = Math.min(i + 1, p);
      out.push(sum / count);
    }
    return out;
  }

  public static sma(values: number[], period: number): number {
    if (values.length === 0) return 0;
    const p = Math.max(1, Math.trunc(period));
    const slice = values.slice(-p);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  public static emaSeries(values: number[], period: number): number[] {
    if (values.length === 0) return [];
    const p = Math.max(1, Math.trunc(period));
    const k = 2 / (p + 1);
    const out: number[] = [values[0]];
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
      out.push(ema);
    }
    return out;
  }

  public static ema(values: number[], period: number): number {
    const s = this.emaSeries(values, period);
    return s.length > 0 ? s[s.length - 1] : 0;
  }

  public static rsiSeries(closes: number[], period = 14): number[] {
    if (closes.length === 0) return [];
    const p = Math.max(2, Math.trunc(period));
    const out: number[] = new Array(closes.length).fill(50);
    if (closes.length <= p) return out;

    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= p; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) avgGain += diff;
      else avgLoss += Math.abs(diff);
    }
    avgGain /= p;
    avgLoss /= p;

    const toRsi = (g: number, l: number) => {
      if (l === 0) return g === 0 ? 50 : 100;
      const rs = g / l;
      return 100 - 100 / (1 + rs);
    };

    out[p] = toRsi(avgGain, avgLoss);
    for (let i = p + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;
      avgGain = (avgGain * (p - 1) + gain) / p;
      avgLoss = (avgLoss * (p - 1) + loss) / p;
      out[i] = toRsi(avgGain, avgLoss);
    }
    return out;
  }

  public static rsi(closes: number[], period = 14): number {
    const s = this.rsiSeries(closes, period);
    return s.length > 0 ? s[s.length - 1] : 50;
  }

  public static macdSeries(closes: number[], fast = 12, slow = 26, signal = 9): MacdOutput[] {
    if (closes.length === 0) return [];
    const fastEma = this.emaSeries(closes, fast);
    const slowEma = this.emaSeries(closes, slow);
    const macdArr = closes.map((_, i) => fastEma[i] - slowEma[i]);
    const sigArr = this.emaSeries(macdArr, signal);
    return macdArr.map((m, i) => ({
      macdLine: m,
      signalLine: sigArr[i],
      histogram: m - sigArr[i],
    }));
  }

  public static macd(closes: number[], fast = 12, slow = 26, signal = 9): MacdOutput {
    const s = this.macdSeries(closes, fast, slow, signal);
    return s.length > 0 ? s[s.length - 1] : { macdLine: 0, signalLine: 0, histogram: 0 };
  }

  public static bollingerSeries(closes: number[], period = 20, stdDevMult = 2): BollingerOutput[] {
    const out: BollingerOutput[] = [];
    const p = Math.max(2, Math.trunc(period));
    for (let i = 0; i < closes.length; i++) {
      const start = Math.max(0, i - p + 1);
      const win = closes.slice(start, i + 1);
      const mean = win.reduce((a, b) => a + b, 0) / win.length;
      const variance = win.reduce((acc, v) => acc + (v - mean) ** 2, 0) / win.length;
      const sd = Math.sqrt(variance);
      const upper = mean + stdDevMult * sd;
      const lower = Math.max(0, mean - stdDevMult * sd);
      const bandwidthPct = mean > 0 ? ((upper - lower) / mean) * 100 : 0;
      out.push({ upper, middle: mean, lower, bandwidthPct });
    }
    return out;
  }

  public static bollinger(closes: number[], period = 20, stdDevMult = 2): BollingerOutput {
    const s = this.bollingerSeries(closes, period, stdDevMult);
    return s.length > 0 ? s[s.length - 1] : { upper: 0, middle: 0, lower: 0, bandwidthPct: 0 };
  }

  public static atrSeries(candles: NormalizedCandle[], period = 14): number[] {
    if (candles.length === 0) return [];
    const p = Math.max(1, Math.trunc(period));
    const tr: number[] = [];
    for (let i = 0; i < candles.length; i++) {
      if (i === 0) {
        tr.push(Math.max(0, candles[0].high - candles[0].low));
      } else {
        const c = candles[i];
        const pc = candles[i - 1].close;
        tr.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
      }
    }
    const atr: number[] = [];
    let current = tr[0];
    for (let i = 0; i < tr.length; i++) {
      if (i < p) {
        const sub = tr.slice(0, i + 1);
        current = sub.reduce((a, b) => a + b, 0) / sub.length;
      } else {
        current = (current * (p - 1) + tr[i]) / p;
      }
      atr.push(current);
    }
    return atr;
  }

  public static atr(candles: NormalizedCandle[], period = 14): { value: number; pctOfPrice: number } {
    if (candles.length === 0) return { value: 0, pctOfPrice: 0 };
    const s = this.atrSeries(candles, period);
    const val = s[s.length - 1] || 0;
    const price = candles[candles.length - 1].close;
    return { value: val, pctOfPrice: price > 0 ? (val / price) * 100 : 0 };
  }

  public static adxSeries(candles: NormalizedCandle[], period = 14): AdxOutput[] {
    if (candles.length === 0) return [];
    const p = Math.max(2, Math.trunc(period));
    const n = candles.length;
    const out: AdxOutput[] = new Array(n).fill(null).map(() => ({ adx: 0, plusDi: 0, minusDi: 0 }));
    if (n < 3) return out;

    const tr: number[] = [candles[0].high - candles[0].low];
    const plusDm: number[] = [0];
    const minusDm: number[] = [0];

    for (let i = 1; i < n; i++) {
      const curr = candles[i];
      const prev = candles[i - 1];
      const upMove = curr.high - prev.high;
      const downMove = prev.low - curr.low;
      plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
      tr.push(Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close)));
    }

    let smoothTr = 0;
    let smoothPlus = 0;
    let smoothMinus = 0;
    let adxSmooth = 0;
    const dxArr: number[] = new Array(n).fill(0);

    for (let i = 1; i < n; i++) {
      if (i <= p) {
        smoothTr += tr[i];
        smoothPlus += plusDm[i];
        smoothMinus += minusDm[i];
      } else {
        smoothTr = smoothTr - smoothTr / p + tr[i];
        smoothPlus = smoothPlus - smoothPlus / p + plusDm[i];
        smoothMinus = smoothMinus - smoothMinus / p + minusDm[i];
      }

      if (i >= p && smoothTr > 0) {
        const pdi = (smoothPlus / smoothTr) * 100;
        const mdi = (smoothMinus / smoothTr) * 100;
        const denom = pdi + mdi;
        const dx = denom > 0 ? (Math.abs(pdi - mdi) / denom) * 100 : 0;
        dxArr[i] = dx;

        if (i < 2 * p) {
          adxSmooth += dx / p;
        } else {
          adxSmooth = (adxSmooth * (p - 1) + dx) / p;
        }
        out[i] = {
          adx: i >= 2 * p - 1 ? adxSmooth : dx,
          plusDi: pdi,
          minusDi: mdi,
        };
      }
    }
    return out;
  }

  public static adx(candles: NormalizedCandle[], period = 14): AdxOutput {
    const s = this.adxSeries(candles, period);
    return s.length > 0 ? s[s.length - 1] : { adx: 0, plusDi: 0, minusDi: 0 };
  }

  public static stochasticSeries(candles: NormalizedCandle[], kPeriod = 14, dPeriod = 3): StochasticOutput[] {
    const kp = Math.max(2, Math.trunc(kPeriod));
    const dp = Math.max(1, Math.trunc(dPeriod));
    const kVals: number[] = [];
    for (let i = 0; i < candles.length; i++) {
      const start = Math.max(0, i - kp + 1);
      const win = candles.slice(start, i + 1);
      const low = Math.min(...win.map(c => c.low));
      const high = Math.max(...win.map(c => c.high));
      const range = high - low;
      const k = range > 0 ? ((candles[i].close - low) / range) * 100 : 50;
      kVals.push(k);
    }
    const dVals = this.smaSeries(kVals, dp);
    return kVals.map((k, i) => ({ k, d: dVals[i] }));
  }

  public static stochRsiSeries(closes: number[], rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3): StochasticOutput[] {
    const rsis = this.rsiSeries(closes, rsiPeriod);
    const sp = Math.max(2, Math.trunc(stochPeriod));
    const raw: number[] = [];
    for (let i = 0; i < rsis.length; i++) {
      const start = Math.max(0, i - sp + 1);
      const win = rsis.slice(start, i + 1);
      const minR = Math.min(...win);
      const maxR = Math.max(...win);
      raw.push(maxR > minR ? ((rsis[i] - minR) / (maxR - minR)) * 100 : 50);
    }
    const kArr = this.smaSeries(raw, Math.max(1, Math.trunc(kSmooth)));
    const dArr = this.smaSeries(kArr, Math.max(1, Math.trunc(dSmooth)));
    return kArr.map((k, i) => ({ k, d: dArr[i] }));
  }

  public static vwapSeries(candles: NormalizedCandle[]): number[] {
    let cumPv = 0;
    let cumVol = 0;
    return candles.map(c => {
      const tp = (c.high + c.low + c.close) / 3;
      const v = c.volume > 0 ? c.volume : 1;
      cumPv += tp * v;
      cumVol += v;
      return cumVol > 0 ? cumPv / cumVol : c.close;
    });
  }

  public static obvSeries(candles: NormalizedCandle[]): number[] {
    let obv = 0;
    const out: number[] = [];
    for (let i = 0; i < candles.length; i++) {
      if (i > 0) {
        if (candles[i].close > candles[i - 1].close) obv += candles[i].volume;
        else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume;
      }
      out.push(obv);
    }
    return out;
  }

  public static mfiSeries(candles: NormalizedCandle[], period = 14): number[] {
    const p = Math.max(2, Math.trunc(period));
    const out: number[] = new Array(candles.length).fill(50);
    if (candles.length <= p) return out;

    const tp = candles.map(c => (c.high + c.low + c.close) / 3);
    const mf = candles.map((c, i) => tp[i] * c.volume);

    for (let i = p; i < candles.length; i++) {
      let posFlow = 0;
      let negFlow = 0;
      for (let j = i - p + 1; j <= i; j++) {
        if (tp[j] > tp[j - 1]) posFlow += mf[j];
        else if (tp[j] < tp[j - 1]) negFlow += mf[j];
      }
      if (negFlow === 0) out[i] = posFlow > 0 ? 100 : 50;
      else {
        const mfr = posFlow / negFlow;
        out[i] = 100 - 100 / (1 + mfr);
      }
    }
    return out;
  }

  public static supertrendSeries(
    candles: NormalizedCandle[],
    atrPeriod = 10,
    multiplier = 3
  ): SupertrendOutput[] {
    if (candles.length === 0) return [];
    const atrs = this.atrSeries(candles, atrPeriod);
    const out: SupertrendOutput[] = [];

    let finalUpper = 0;
    let finalLower = 0;
    let trend: 'UP' | 'DOWN' = 'UP';

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const atr = atrs[i] || 0;
      const hl2 = (c.high + c.low) / 2;
      const basicUpper = hl2 + multiplier * atr;
      const basicLower = Math.max(0, hl2 - multiplier * atr);

      if (i === 0) {
        finalUpper = basicUpper;
        finalLower = basicLower;
        trend = c.close >= hl2 ? 'UP' : 'DOWN';
      } else {
        const prevClose = candles[i - 1].close;
        finalUpper =
          basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
        finalLower =
          basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;

        if (trend === 'UP' && c.close < finalLower) {
          trend = 'DOWN';
        } else if (trend === 'DOWN' && c.close > finalUpper) {
          trend = 'UP';
        }
      }

      out.push({
        trend,
        supertrend: trend === 'UP' ? finalLower : finalUpper,
        upperBand: finalUpper,
        lowerBand: finalLower,
        atr,
      });
    }
    return out;
  }

  /**
   * Evaluate a single operand on `candles` ending at `barIdx` (no look-ahead bias!).
   */
  public static resolveOperandAt(
    operand: IndicatorOperand,
    candles: NormalizedCandle[],
    barIdx: number
  ): number {
    if (barIdx < 0 || barIdx >= candles.length) return 0;
    if (operand.kind === 'CONSTANT') return Number(operand.value ?? 0);

    const c = candles[barIdx];
    if (operand.kind === 'PRICE') {
      switch (operand.priceField || 'close') {
        case 'open': return c.open;
        case 'high': return c.high;
        case 'low': return c.low;
        case 'volume': return c.volume;
        default: return c.close;
      }
    }

    // Strict causal slice: candles[0 .. barIdx]
    const slice = candles.slice(0, barIdx + 1);
    const closes = slice.map(x => x.close);
    const params = operand.params || {};
    const field = operand.field || 'value';

    switch (operand.indicator) {
      case 'SMA':
        return this.sma(closes, params.period || 20);
      case 'EMA':
        return this.ema(closes, params.period || 20);
      case 'RSI':
        return this.rsi(closes, params.period || 14);
      case 'MACD': {
        const res = this.macd(closes, params.fast || 12, params.slow || 26, params.signal || 9);
        if (field === 'signalLine') return res.signalLine;
        if (field === 'histogram') return res.histogram;
        return res.macdLine;
      }
      case 'BOLLINGER_BANDS': {
        const res = this.bollinger(closes, params.period || 20, params.stdDev || 2);
        if (field === 'upper') return res.upper;
        if (field === 'lower') return res.lower;
        if (field === 'bandwidthPct') return res.bandwidthPct;
        return res.middle;
      }
      case 'ATR': {
        const res = this.atr(slice, params.period || 14);
        return field === 'pctOfPrice' ? res.pctOfPrice : res.value;
      }
      case 'ADX': {
        const res = this.adx(slice, params.period || 14);
        if (field === 'plusDi') return res.plusDi;
        if (field === 'minusDi') return res.minusDi;
        return res.adx;
      }
      case 'STOCHASTIC': {
        const arr = this.stochasticSeries(slice, params.kPeriod || 14, params.dPeriod || 3);
        const last = arr[arr.length - 1] || { k: 50, d: 50 };
        return field === 'd' ? last.d : last.k;
      }
      case 'STOCHASTIC_RSI': {
        const arr = this.stochRsiSeries(
          closes,
          params.rsiPeriod || 14,
          params.stochPeriod || 14,
          params.kSmooth || 3,
          params.dSmooth || 3
        );
        const last = arr[arr.length - 1] || { k: 50, d: 50 };
        return field === 'd' ? last.d : last.k;
      }
      case 'VWAP': {
        const arr = this.vwapSeries(slice);
        return arr[arr.length - 1] ?? c.close;
      }
      case 'VOLUME_MA': {
        const vols = slice.map(x => x.volume);
        const vma = this.sma(vols, params.period || 20);
        if (field === 'ratio') return vma > 0 ? c.volume / vma : 1;
        return vma;
      }
      case 'OBV': {
        const arr = this.obvSeries(slice);
        return arr[arr.length - 1] ?? 0;
      }
      case 'MFI': {
        const arr = this.mfiSeries(slice, params.period || 14);
        return arr[arr.length - 1] ?? 50;
      }
      default:
        return 0;
    }
  }

  /**
   * Declarative Safe Rule Evaluator (AST). Never compiles or executes JS strings.
   */
  public static evaluateRuleNode(node: RuleNode, candles: NormalizedCandle[]): {
    matched: boolean;
    values: Record<string, number>;
  } {
    const idx = candles.length - 1;
    if (idx < 0) return { matched: false, values: {} };
    const values: Record<string, number> = {};

    const evalRecursive = (n: RuleNode): boolean => {
      if (n.type === 'GROUP') {
        if (n.operator === 'AND') return n.children.every(c => evalRecursive(c));
        if (n.operator === 'OR') return n.children.some(c => evalRecursive(c));
        if (n.operator === 'NOT') return n.children.length > 0 ? !evalRecursive(n.children[0]) : false;
        return false;
      }

      const lNow = this.resolveOperandAt(n.left, candles, idx);
      const rNow = this.resolveOperandAt(n.right, candles, idx);
      const lKey = n.left.indicator
        ? `${n.left.indicator}_${n.left.field || 'val'}`
        : n.left.priceField || 'left';
      values[lKey] = Number(lNow.toFixed(6));

      switch (n.operator) {
        case 'GREATER_THAN':
          return lNow > rNow;
        case 'LESS_THAN':
          return lNow < rNow;
        case 'EQUAL':
          return Math.abs(lNow - rNow) <= Math.max(1e-8, Math.abs(rNow) * 1e-6);
        case 'BETWEEN': {
          const upper = n.rightUpper ? this.resolveOperandAt(n.rightUpper, candles, idx) : rNow;
          const lo = Math.min(rNow, upper);
          const hi = Math.max(rNow, upper);
          return lNow >= lo && lNow <= hi;
        }
        case 'CROSS_ABOVE': {
          if (idx < 1) return false;
          const lPrev = this.resolveOperandAt(n.left, candles, idx - 1);
          const rPrev = this.resolveOperandAt(n.right, candles, idx - 1);
          return lPrev <= rPrev && lNow > rNow;
        }
        case 'CROSS_BELOW': {
          if (idx < 1) return false;
          const lPrev = this.resolveOperandAt(n.left, candles, idx - 1);
          const rPrev = this.resolveOperandAt(n.right, candles, idx - 1);
          return lPrev >= rPrev && lNow < rNow;
        }
        default:
          return false;
      }
    };

    const matched = evalRecursive(node);
    return { matched, values };
  }
}
