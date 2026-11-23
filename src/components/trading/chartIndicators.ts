/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * chartIndicators.ts
 * Modular, deterministic Technical Indicators & Heikin Ashi / Support-Resistance engine
 * computed strictly from real executed exchange OHLCV bars.
 */

import { CandleItem } from '../../types/index.js';
import { IndicatorConfig } from './chartTypes.js';

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface BollingerPoint {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

export interface MacdPoint {
  time: number;
  macd: number;
  signal: number;
  histogram: number;
}

export interface StochRsiPoint {
  time: number;
  k: number;
  d: number;
}

export interface SupportResistanceLevel {
  price: number;
  kind: 'SUPPORT' | 'RESISTANCE';
  touches: number;
}

export const DEFAULT_INDICATORS: IndicatorConfig[] = [
  { id: 'SMA', label: 'SMA (7)', category: 'TREND', overlay: true, enabled: true, visible: true, params: { period: 7 }, color: '#D6A85C' },
  { id: 'EMA', label: 'EMA (25)', category: 'TREND', overlay: true, enabled: true, visible: true, params: { period: 25 }, color: '#6D9FE8' },
  { id: 'VWAP', label: 'VWAP', category: 'TREND', overlay: true, enabled: false, visible: true, params: {}, color: '#A78BFA' },
  { id: 'BB', label: 'Bollinger Bands', category: 'TREND', overlay: true, enabled: false, visible: true, params: { period: 20, stdDev: 2 }, color: '#38BDF8' },
  { id: 'VOL_MA', label: 'Volume MA (20)', category: 'VOLUME', overlay: true, enabled: false, visible: true, params: { period: 20 }, color: '#F59E0B' },
  { id: 'RSI', label: 'RSI (14)', category: 'MOMENTUM', overlay: false, enabled: false, visible: true, params: { period: 14 }, color: '#F472B6' },
  { id: 'MACD', label: 'MACD (12,26,9)', category: 'MOMENTUM', overlay: false, enabled: false, visible: true, params: { fast: 12, slow: 26, signal: 9 }, color: '#34D399' },
  { id: 'STOCH_RSI', label: 'Stoch RSI (14,14,3,3)', category: 'MOMENTUM', overlay: false, enabled: false, visible: true, params: { rsiPeriod: 14, stochPeriod: 14, kPeriod: 3, dPeriod: 3 }, color: '#60A5FA' },
  { id: 'ATR', label: 'ATR (14)', category: 'VOLATILITY', overlay: false, enabled: false, visible: true, params: { period: 14 }, color: '#FB923C' },
  { id: 'BBW', label: 'BB Width (20,2)', category: 'VOLATILITY', overlay: false, enabled: false, visible: true, params: { period: 20, stdDev: 2 }, color: '#2DD4BF' },
  { id: 'OBV', label: 'OBV', category: 'VOLUME', overlay: false, enabled: false, visible: true, params: {}, color: '#818CF8' },
  { id: 'MFI', label: 'MFI (14)', category: 'VOLUME', overlay: false, enabled: false, visible: true, params: { period: 14 }, color: '#E879F9' },
];

export const INDICATOR_PARAM_LABELS: Record<string, string> = {
  period: 'Period',
  stdDev: 'Std Dev',
  fast: 'Fast EMA',
  slow: 'Slow EMA',
  signal: 'Signal',
  rsiPeriod: 'RSI Period',
  stochPeriod: 'Stoch Period',
  kPeriod: '%K Smooth',
  dPeriod: '%D Smooth',
};

export function mergeIndicators(saved?: Partial<IndicatorConfig>[]): IndicatorConfig[] {
  if (!Array.isArray(saved) || saved.length === 0) {
    return DEFAULT_INDICATORS.map(d => ({ ...d, params: { ...d.params } }));
  }
  const map = new Map(saved.map(s => [s.id, s]));
  return DEFAULT_INDICATORS.map(def => {
    const match = map.get(def.id);
    if (!match) return { ...def, params: { ...def.params } };
    return {
      ...def,
      enabled: typeof match.enabled === 'boolean' ? match.enabled : def.enabled,
      visible: typeof match.visible === 'boolean' ? match.visible : true,
      color: typeof match.color === 'string' ? match.color : def.color,
      params: match.params ? { ...def.params, ...match.params } : { ...def.params },
    };
  });
}

export function formatIndicatorDisplayLabel(cfg: IndicatorConfig): string {
  switch (cfg.id) {
    case 'SMA':
      return `SMA(${cfg.params.period ?? 7})`;
    case 'EMA':
      return `EMA(${cfg.params.period ?? 25})`;
    case 'BB':
      return `BB(${cfg.params.period ?? 20},${cfg.params.stdDev ?? 2})`;
    case 'VOL_MA':
      return `VolMA(${cfg.params.period ?? 20})`;
    case 'RSI':
      return `RSI(${cfg.params.period ?? 14})`;
    case 'MACD':
      return `MACD(${cfg.params.fast ?? 12},${cfg.params.slow ?? 26},${cfg.params.signal ?? 9})`;
    case 'STOCH_RSI':
      return `StochRSI(${cfg.params.rsiPeriod ?? 14},${cfg.params.stochPeriod ?? 14},${cfg.params.kPeriod ?? 3},${cfg.params.dPeriod ?? 3})`;
    case 'ATR':
      return `ATR(${cfg.params.period ?? 14})`;
    case 'BBW':
      return `BBW(${cfg.params.period ?? 20},${cfg.params.stdDev ?? 2})`;
    case 'MFI':
      return `MFI(${cfg.params.period ?? 14})`;
    default:
      return cfg.id;
  }
}

export function formatIndicatorShortName(cfg: IndicatorConfig): string {
  switch (cfg.id) {
    case 'BB':
      return 'BB';
    case 'VOL_MA':
      return 'Vol MA';
    case 'STOCH_RSI':
      return 'Stoch RSI';
    default:
      return cfg.id;
  }
}

export function formatIndicatorParamsSummary(cfg: IndicatorConfig): string {
  const entries = Object.entries(cfg.params || {});
  if (entries.length === 0) return 'Session';
  return entries.map(([k, v]) => `${INDICATOR_PARAM_LABELS[k] || k}: ${v}`).join(' · ');
}

export function computeHeikinAshi(bars: CandleItem[]): CandleItem[] {
  if (!bars || bars.length === 0) return [];
  const out: CandleItem[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    const haHigh = Math.max(b.high, haOpen, haClose);
    const haLow = Math.min(b.low, haOpen, haClose);
    out.push({
      time: b.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: b.volume,
    });
  }
  return out;
}

export function computeSMA(bars: CandleItem[], period: number): IndicatorPoint[] {
  const p = Math.max(1, Math.round(period));
  if (bars.length < p) return [];
  const out: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= p) sum -= bars[i - p].close;
    if (i >= p - 1) {
      out.push({ time: bars[i].time, value: sum / p });
    }
  }
  return out;
}

export function computeEMA(bars: CandleItem[], period: number): IndicatorPoint[] {
  const p = Math.max(1, Math.round(period));
  if (bars.length < p) return [];
  const k = 2 / (p + 1);
  const out: IndicatorPoint[] = [];
  let seed = 0;
  for (let i = 0; i < p; i++) seed += bars[i].close;
  let ema = seed / p;
  out.push({ time: bars[p - 1].time, value: ema });
  for (let i = p; i < bars.length; i++) {
    ema = bars[i].close * k + ema * (1 - k);
    out.push({ time: bars[i].time, value: ema });
  }
  return out;
}

export function computeVWAP(bars: CandleItem[]): IndicatorPoint[] {
  if (!bars || bars.length === 0) return [];
  const out: IndicatorPoint[] = [];
  let cumTPV = 0;
  let cumVol = 0;
  let lastDay = -1;

  for (const b of bars) {
    const utcDay = Math.floor(b.time / 86400);
    if (utcDay !== lastDay) {
      cumTPV = 0;
      cumVol = 0;
      lastDay = utcDay;
    }
    const typical = (b.high + b.low + b.close) / 3;
    const vol = Math.max(0, b.volume || 0);
    cumTPV += typical * vol;
    cumVol += vol;
    out.push({
      time: b.time,
      value: cumVol > 0 ? cumTPV / cumVol : typical,
    });
  }
  return out;
}

export function computeBollingerBands(
  bars: CandleItem[],
  period = 20,
  stdDevMult = 2
): BollingerPoint[] {
  const p = Math.max(2, Math.round(period));
  if (bars.length < p) return [];
  const out: BollingerPoint[] = [];
  for (let i = p - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - p + 1; j <= i; j++) sum += bars[j].close;
    const mean = sum / p;
    let sq = 0;
    for (let j = i - p + 1; j <= i; j++) {
      const diff = bars[j].close - mean;
      sq += diff * diff;
    }
    const std = Math.sqrt(sq / p);
    out.push({
      time: bars[i].time,
      upper: mean + stdDevMult * std,
      middle: mean,
      lower: mean - stdDevMult * std,
    });
  }
  return out;
}

export function computeBollingerBandWidth(
  bars: CandleItem[],
  period = 20,
  stdDevMult = 2
): IndicatorPoint[] {
  return computeBollingerBands(bars, period, stdDevMult).map(b => ({
    time: b.time,
    value: b.middle > 0 ? ((b.upper - b.lower) / b.middle) * 100 : 0,
  }));
}

export function computeRSI(bars: CandleItem[], period = 14): IndicatorPoint[] {
  const p = Math.max(2, Math.round(period));
  if (bars.length <= p) return [];
  const out: IndicatorPoint[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= p; i++) {
    const chg = bars[i].close - bars[i - 1].close;
    if (chg >= 0) avgGain += chg;
    else avgLoss += Math.abs(chg);
  }
  avgGain /= p;
  avgLoss /= p;

  const firstRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  out.push({ time: bars[p].time, value: firstRsi });

  for (let i = p + 1; i < bars.length; i++) {
    const chg = bars[i].close - bars[i - 1].close;
    const gain = chg > 0 ? chg : 0;
    const loss = chg < 0 ? Math.abs(chg) : 0;
    avgGain = (avgGain * (p - 1) + gain) / p;
    avgLoss = (avgLoss * (p - 1) + loss) / p;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    out.push({ time: bars[i].time, value: rsi });
  }
  return out;
}

function emaFromValues(values: Array<{ time: number; value: number }>, period: number): IndicatorPoint[] {
  const p = Math.max(1, Math.round(period));
  if (values.length < p) return [];
  const k = 2 / (p + 1);
  let seed = 0;
  for (let i = 0; i < p; i++) seed += values[i].value;
  let ema = seed / p;
  const out: IndicatorPoint[] = [{ time: values[p - 1].time, value: ema }];
  for (let i = p; i < values.length; i++) {
    ema = values[i].value * k + ema * (1 - k);
    out.push({ time: values[i].time, value: ema });
  }
  return out;
}

export function computeMACD(
  bars: CandleItem[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MacdPoint[] {
  const fast = computeEMA(bars, fastPeriod);
  const slow = computeEMA(bars, slowPeriod);
  if (fast.length === 0 || slow.length === 0) return [];
  const fastMap = new Map(fast.map(f => [f.time, f.value]));
  const macdLine: IndicatorPoint[] = [];
  for (const s of slow) {
    const fv = fastMap.get(s.time);
    if (fv !== undefined) {
      macdLine.push({ time: s.time, value: fv - s.value });
    }
  }
  const signalLine = emaFromValues(macdLine, signalPeriod);
  const sigMap = new Map(signalLine.map(s => [s.time, s.value]));
  const out: MacdPoint[] = [];
  for (const m of macdLine) {
    const sig = sigMap.get(m.time);
    if (sig !== undefined) {
      out.push({
        time: m.time,
        macd: m.value,
        signal: sig,
        histogram: m.value - sig,
      });
    }
  }
  return out;
}

export function computeStochRSI(
  bars: CandleItem[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kPeriod = 3,
  dPeriod = 3
): StochRsiPoint[] {
  const rsiSeries = computeRSI(bars, rsiPeriod);
  const sp = Math.max(2, Math.round(stochPeriod));
  if (rsiSeries.length < sp) return [];

  const rawStoch: IndicatorPoint[] = [];
  for (let i = sp - 1; i < rsiSeries.length; i++) {
    let minRsi = Infinity;
    let maxRsi = -Infinity;
    for (let j = i - sp + 1; j <= i; j++) {
      if (rsiSeries[j].value < minRsi) minRsi = rsiSeries[j].value;
      if (rsiSeries[j].value > maxRsi) maxRsi = rsiSeries[j].value;
    }
    const span = maxRsi - minRsi;
    const val = span > 0 ? ((rsiSeries[i].value - minRsi) / span) * 100 : 50;
    rawStoch.push({ time: rsiSeries[i].time, value: val });
  }

  const kp = Math.max(1, Math.round(kPeriod));
  const kLine: IndicatorPoint[] = [];
  for (let i = kp - 1; i < rawStoch.length; i++) {
    let sum = 0;
    for (let j = i - kp + 1; j <= i; j++) sum += rawStoch[j].value;
    kLine.push({ time: rawStoch[i].time, value: sum / kp });
  }

  const dp = Math.max(1, Math.round(dPeriod));
  const out: StochRsiPoint[] = [];
  for (let i = dp - 1; i < kLine.length; i++) {
    let sum = 0;
    for (let j = i - dp + 1; j <= i; j++) sum += kLine[j].value;
    out.push({ time: kLine[i].time, k: kLine[i].value, d: sum / dp });
  }
  return out;
}

export function computeATR(bars: CandleItem[], period = 14): IndicatorPoint[] {
  const p = Math.max(1, Math.round(period));
  if (bars.length <= p) return [];
  const trs: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    trs.push(tr);
  }
  let atr = trs.slice(1, p + 1).reduce((a, b) => a + b, 0) / p;
  const out: IndicatorPoint[] = [{ time: bars[p].time, value: atr }];
  for (let i = p + 1; i < bars.length; i++) {
    atr = (atr * (p - 1) + trs[i]) / p;
    out.push({ time: bars[i].time, value: atr });
  }
  return out;
}

export function computeVolumeMA(bars: CandleItem[], period = 20): IndicatorPoint[] {
  const p = Math.max(1, Math.round(period));
  if (bars.length < p) return [];
  const out: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].volume || 0;
    if (i >= p) sum -= bars[i - p].volume || 0;
    if (i >= p - 1) {
      out.push({ time: bars[i].time, value: sum / p });
    }
  }
  return out;
}

export function computeOBV(bars: CandleItem[]): IndicatorPoint[] {
  if (!bars || bars.length === 0) return [];
  let obv = 0;
  const out: IndicatorPoint[] = [{ time: bars[0].time, value: 0 }];
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].close > bars[i - 1].close) obv += bars[i].volume || 0;
    else if (bars[i].close < bars[i - 1].close) obv -= bars[i].volume || 0;
    out.push({ time: bars[i].time, value: obv });
  }
  return out;
}

export function computeMFI(bars: CandleItem[], period = 14): IndicatorPoint[] {
  const p = Math.max(2, Math.round(period));
  if (bars.length <= p) return [];
  const typicals = bars.map(b => (b.high + b.low + b.close) / 3);
  const rawFlows = bars.map((b, i) => typicals[i] * Math.max(0, b.volume || 0));

  const out: IndicatorPoint[] = [];
  for (let i = p; i < bars.length; i++) {
    let posFlow = 0;
    let negFlow = 0;
    for (let j = i - p + 1; j <= i; j++) {
      if (typicals[j] > typicals[j - 1]) posFlow += rawFlows[j];
      else if (typicals[j] < typicals[j - 1]) negFlow += rawFlows[j];
    }
    const mfi = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
    out.push({ time: bars[i].time, value: mfi });
  }
  return out;
}

/**
 * Derive real Support & Resistance levels exclusively from historical pivot highs & lows.
 */
export function detectSupportResistanceLevels(
  bars: CandleItem[],
  lookback = 5,
  maxLevelsPerSide = 2
): SupportResistanceLevel[] {
  if (!bars || bars.length < lookback * 2 + 1) return [];
  const lastClose = bars[bars.length - 1].close;
  const rawPivots: Array<{ price: number; kind: 'SUPPORT' | 'RESISTANCE' }> = [];

  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isHigh = false;
      if (bars[j].low <= bars[i].low) isLow = false;
    }
    if (isHigh) rawPivots.push({ price: bars[i].high, kind: 'RESISTANCE' });
    if (isLow) rawPivots.push({ price: bars[i].low, kind: 'SUPPORT' });
  }

  // Cluster levels within 0.35% tolerance
  const clustered: SupportResistanceLevel[] = [];
  for (const pv of rawPivots) {
    const match = clustered.find(
      c => Math.abs(c.price - pv.price) / Math.max(1e-9, pv.price) <= 0.0035
    );
    if (match) {
      match.price = (match.price * match.touches + pv.price) / (match.touches + 1);
      match.touches += 1;
    } else {
      clustered.push({ price: pv.price, kind: pv.price >= lastClose ? 'RESISTANCE' : 'SUPPORT', touches: 1 });
    }
  }

  const supports = clustered
    .filter(l => l.price < lastClose)
    .sort((a, b) => b.touches - a.touches || b.price - a.price)
    .slice(0, maxLevelsPerSide);

  const resistances = clustered
    .filter(l => l.price >= lastClose)
    .sort((a, b) => b.touches - a.touches || a.price - b.price)
    .slice(0, maxLevelsPerSide);

  return [...supports, ...resistances];
}
