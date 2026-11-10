/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * TimeframeAnalyticsService.ts
 * Real OHLCV Timeframe Technical Analytics & Market Regime Detection Engine for DIMONEX.
 * 
 * Computes:
 * - Exponential Moving Averages: EMA 9, 20, 50, 100, 200
 * - Simple Moving Averages: SMA 20, 50, 200
 * - Relative Strength Index: RSI 14 (Wilder's Smoothing)
 * - Moving Average Convergence Divergence: MACD (12, 26, 9)
 * - Bollinger Bands: Period 20, 2 Standard Deviations (Upper, Middle, Lower, Bandwidth)
 * - Average True Range: ATR 14 (Quote Units and % of Price)
 * - Volume-Weighted Average Price: VWAP
 * - Pivot Support & Resistance: Pivot, S1, R1, S2, R2, S3, R3 & Swing Levels
 * - Volume Analytics: Volume SMA 20, Volume Surge Multiplier
 * 
 * Classifies 8 Market Regimes strictly from real trade klines:
 * 1. SIDEWAYS
 * 2. BULLISH_TREND
 * 3. BEARISH_TREND
 * 4. CONSOLIDATION
 * 5. HIGH_VOLATILITY
 * 6. LOW_VOLATILITY
 * 7. BREAKOUT
 * 8. REVERSAL
 */

import { klineService, Candle, Timeframe } from '../../engine/KlineService.js';
import { db } from '../../db/database.js';

export type MarketRegimeType =
  | 'SIDEWAYS'
  | 'BULLISH_TREND'
  | 'BEARISH_TREND'
  | 'CONSOLIDATION'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'BREAKOUT'
  | 'REVERSAL';

export interface TechnicalIndicators {
  currentPrice: number;
  ema: {
    ema9: number;
    ema20: number;
    ema50: number;
    ema100: number;
    ema200: number;
  };
  sma: {
    sma20: number;
    sma50: number;
    sma200: number;
  };
  rsi14: number;
  macd: {
    macdLine: number;
    signalLine: number;
    histogram: number;
  };
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
    bandwidthPct: number;
  };
  atr14: {
    value: number;
    pctOfPrice: number;
  };
  vwap: number;
  supportResistance: {
    pivot: number;
    r1: number;
    s1: number;
    r2: number;
    s2: number;
    r3: number;
    s3: number;
    recentSwingHigh: number;
    recentSwingLow: number;
  };
  volume: {
    currentVolume: number;
    volumeSma20: number;
    volumeSurgeRatio: number;
  };
}

export interface MarketRegimeReport {
  pairId: string;
  timeframe: Timeframe;
  timestamp: number;
  regime: MarketRegimeType;
  confidenceScorePct: number; // 0 to 100
  summary: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  volatilityLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  indicators: TechnicalIndicators;
}

export class TimeframeAnalyticsService {
  /**
   * Calculate full indicators and classify market regime for a pair on a given timeframe.
   */
  public analyze(pairId: string, tf: string = '15m'): MarketRegimeReport {
    const candles = klineService.getCandles(pairId, tf, 220);
    const pair = db.tradingPairs.get(pairId);
    const quoteDec = pair ? (pair.quoteDecimals ?? (pair.quoteCurrency === 'USDT' ? 6 : 2)) : 2;

    const currentPrice = candles.length > 0 
      ? candles[candles.length - 1].close 
      : (pair && pair.lastPrice ? Number(BigInt(pair.lastPrice)) / (10 ** quoteDec) : 0);

    if (candles.length < 5) {
      // Fallback for brand-new pairs with minimal trade history
      const fallbackIndicators: TechnicalIndicators = {
        currentPrice,
        ema: { ema9: currentPrice, ema20: currentPrice, ema50: currentPrice, ema100: currentPrice, ema200: currentPrice },
        sma: { sma20: currentPrice, sma50: currentPrice, sma200: currentPrice },
        rsi14: 50,
        macd: { macdLine: 0, signalLine: 0, histogram: 0 },
        bollingerBands: { upper: currentPrice * 1.01, middle: currentPrice, lower: currentPrice * 0.99, bandwidthPct: 2 },
        atr14: { value: currentPrice * 0.005, pctOfPrice: 0.5 },
        vwap: currentPrice,
        supportResistance: {
          pivot: currentPrice,
          r1: currentPrice * 1.01,
          s1: currentPrice * 0.99,
          r2: currentPrice * 1.02,
          s2: currentPrice * 0.98,
          r3: currentPrice * 1.03,
          s3: currentPrice * 0.97,
          recentSwingHigh: currentPrice * 1.01,
          recentSwingLow: currentPrice * 0.99
        },
        volume: { currentVolume: 0, volumeSma20: 0, volumeSurgeRatio: 1.0 }
      };

      return {
        pairId,
        timeframe: klineService.normalizeResolution(tf),
        timestamp: Date.now(),
        regime: 'SIDEWAYS',
        confidenceScorePct: 50,
        summary: 'Data historis awal terbentuk; pasar dalam fase netral/sideways.',
        bias: 'NEUTRAL',
        volatilityLevel: 'LOW',
        indicators: fallbackIndicators
      };
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    // 1. Moving Averages
    const ema9 = this.calculateEMA(closes, 9);
    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const ema100 = this.calculateEMA(closes, 100);
    const ema200 = this.calculateEMA(closes, 200);

    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = this.calculateSMA(closes, 50);
    const sma200 = this.calculateSMA(closes, 200);

    // 2. RSI 14
    const rsi14 = this.calculateRSI(closes, 14);

    // 3. MACD (12, 26, 9)
    const macd = this.calculateMACD(closes, 12, 26, 9);

    // 4. Bollinger Bands (20, 2)
    const bb = this.calculateBollingerBands(closes, 20, 2);

    // 5. ATR 14
    const atr14 = this.calculateATR(candles, 14);

    // 6. VWAP
    const vwap = this.calculateVWAP(candles);

    // 7. Support & Resistance Pivots
    const sr = this.calculateSupportResistance(candles);

    // 8. Volume Analytics
    const volSma20 = this.calculateSMA(volumes, 20);
    const lastVol = volumes[volumes.length - 1] || 0;
    const volumeSurgeRatio = volSma20 > 0 ? Number((lastVol / volSma20).toFixed(2)) : 1.0;

    const indicators: TechnicalIndicators = {
      currentPrice,
      ema: { ema9, ema20, ema50, ema100, ema200 },
      sma: { sma20, sma50, sma200 },
      rsi14,
      macd,
      bollingerBands: bb,
      atr14,
      vwap,
      supportResistance: sr,
      volume: {
        currentVolume: lastVol,
        volumeSma20: volSma20,
        volumeSurgeRatio
      }
    };

    // Classify Market Regime
    const { regime, confidenceScorePct, summary, bias, volatilityLevel } = this.classifyRegime(
      candles,
      indicators
    );

    return {
      pairId,
      timeframe: klineService.normalizeResolution(tf),
      timestamp: Date.now(),
      regime,
      confidenceScorePct,
      summary,
      bias,
      volatilityLevel,
      indicators
    };
  }

  // ==========================================
  // MATHEMATICAL INDICATOR ALGORITHMS
  // ==========================================

  private calculateSMA(data: number[], period: number): number {
    if (data.length === 0) return 0;
    const slice = data.slice(-period);
    const sum = slice.reduce((acc, v) => acc + v, 0);
    return Number((sum / slice.length).toFixed(4));
  }

  private calculateEMA(data: number[], period: number): number {
    if (data.length === 0) return 0;
    if (data.length <= period) return this.calculateSMA(data, period);

    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return Number(ema.toFixed(4));
  }

  private calculateRSI(closes: number[], period = 14): number {
    if (closes.length < period + 1) return 50.0;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    return Number(rsi.toFixed(2));
  }

  private calculateMACD(closes: number[], fast = 12, slow = 26, signalPeriod = 9) {
    if (closes.length < slow) {
      return { macdLine: 0, signalLine: 0, histogram: 0 };
    }

    const fastK = 2 / (fast + 1);
    const slowK = 2 / (slow + 1);

    let fastEMA = closes[0];
    let slowEMA = closes[0];
    const macdHistory: number[] = [];

    for (let i = 0; i < closes.length; i++) {
      fastEMA = closes[i] * fastK + fastEMA * (1 - fastK);
      slowEMA = closes[i] * slowK + slowEMA * (1 - slowK);
      if (i >= slow - 1) {
        macdHistory.push(fastEMA - slowEMA);
      }
    }

    const macdLine = macdHistory[macdHistory.length - 1] || 0;

    // Signal Line is EMA of macdHistory
    const signalK = 2 / (signalPeriod + 1);
    let signalLine = macdHistory[0] || 0;
    for (let i = 1; i < macdHistory.length; i++) {
      signalLine = macdHistory[i] * signalK + signalLine * (1 - signalK);
    }

    const histogram = macdLine - signalLine;
    return {
      macdLine: Number(macdLine.toFixed(4)),
      signalLine: Number(signalLine.toFixed(4)),
      histogram: Number(histogram.toFixed(4))
    };
  }

  private calculateBollingerBands(closes: number[], period = 20, numStdDev = 2) {
    const middle = this.calculateSMA(closes, period);
    const slice = closes.slice(-period);
    if (slice.length === 0) {
      return { upper: 0, middle: 0, lower: 0, bandwidthPct: 0 };
    }

    const variance = slice.reduce((acc, v) => acc + Math.pow(v - middle, 2), 0) / slice.length;
    const stdDev = Math.sqrt(variance);

    const upper = middle + (stdDev * numStdDev);
    const lower = middle - (stdDev * numStdDev);
    const bandwidthPct = middle > 0 ? ((upper - lower) / middle) * 100 : 0;

    return {
      upper: Number(upper.toFixed(4)),
      middle: Number(middle.toFixed(4)),
      lower: Number(lower.toFixed(4)),
      bandwidthPct: Number(bandwidthPct.toFixed(2))
    };
  }

  private calculateATR(candles: Candle[], period = 14) {
    if (candles.length < 2) {
      const v = candles[0] ? candles[0].high - candles[0].low : 0;
      return { value: Number(v.toFixed(4)), pctOfPrice: 0.5 };
    }

    const trValues: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const prevClose = candles[i - 1].close;
      const cur = candles[i];
      const tr = Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prevClose),
        Math.abs(cur.low - prevClose)
      );
      trValues.push(tr);
    }

    const recentTRs = trValues.slice(-period);
    const atr = recentTRs.reduce((acc, val) => acc + val, 0) / recentTRs.length;
    const lastClose = candles[candles.length - 1].close;
    const pctOfPrice = lastClose > 0 ? (atr / lastClose) * 100 : 0;

    return {
      value: Number(atr.toFixed(4)),
      pctOfPrice: Number(pctOfPrice.toFixed(3))
    };
  }

  private calculateVWAP(candles: Candle[]): number {
    if (candles.length === 0) return 0;
    let cumTypicalVol = 0;
    let cumVol = 0;

    for (const c of candles) {
      const typicalPrice = (c.high + c.low + c.close) / 3;
      const vol = c.volume > 0 ? c.volume : 0.0001;
      cumTypicalVol += typicalPrice * vol;
      cumVol += vol;
    }

    return cumVol > 0 ? Number((cumTypicalVol / cumVol).toFixed(4)) : (candles[candles.length - 1]?.close || 0);
  }

  private calculateSupportResistance(candles: Candle[]) {
    if (candles.length === 0) {
      return { pivot: 0, r1: 0, s1: 0, r2: 0, s2: 0, r3: 0, s3: 0, recentSwingHigh: 0, recentSwingLow: 0 };
    }

    const last = candles[candles.length - 1];
    const prev = candles.length > 1 ? candles[candles.length - 2] : last;

    // Classic Pivot Points
    const pivot = (prev.high + prev.low + prev.close) / 3;
    const r1 = 2 * pivot - prev.low;
    const s1 = 2 * pivot - prev.high;
    const r2 = pivot + (prev.high - prev.low);
    const s2 = pivot - (prev.high - prev.low);
    const r3 = prev.high + 2 * (pivot - prev.low);
    const s3 = prev.low - 2 * (prev.high - pivot);

    // Swing levels from last 30 bars
    const window = candles.slice(-30);
    const recentSwingHigh = Math.max(...window.map(c => c.high));
    const recentSwingLow = Math.min(...window.map(c => c.low));

    return {
      pivot: Number(pivot.toFixed(4)),
      r1: Number(r1.toFixed(4)),
      s1: Number(s1.toFixed(4)),
      r2: Number(r2.toFixed(4)),
      s2: Number(s2.toFixed(4)),
      r3: Number(r3.toFixed(4)),
      s3: Number(s3.toFixed(4)),
      recentSwingHigh: Number(recentSwingHigh.toFixed(4)),
      recentSwingLow: Number(recentSwingLow.toFixed(4))
    };
  }

  // ==========================================
  // MARKET REGIME CLASSIFIER
  // ==========================================

  private classifyRegime(
    candles: Candle[],
    ind: TechnicalIndicators
  ): {
    regime: MarketRegimeType;
    confidenceScorePct: number;
    summary: string;
    bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    volatilityLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  } {
    const p = ind.currentPrice;
    const atrPct = ind.atr14.pctOfPrice;
    const bbWidth = ind.bollingerBands.bandwidthPct;
    const rsi = ind.rsi14;
    const macdHist = ind.macd.histogram;
    const ema20 = ind.ema.ema20;
    const ema50 = ind.ema.ema50;
    const ema200 = ind.ema.ema200;

    // Determine Volatility Tier
    let volatilityLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' = 'NORMAL';
    if (atrPct > 2.5 || bbWidth > 6.0) volatilityLevel = 'EXTREME';
    else if (atrPct > 1.4 || bbWidth > 3.8) volatilityLevel = 'HIGH';
    else if (atrPct < 0.4 || bbWidth < 1.2) volatilityLevel = 'LOW';

    // 1. High Volatility Check
    if (volatilityLevel === 'EXTREME' || (volatilityLevel === 'HIGH' && ind.volume.volumeSurgeRatio > 1.8)) {
      return {
        regime: 'HIGH_VOLATILITY',
        confidenceScorePct: 88,
        summary: `Volatilitas tinggi terdeteksi (ATR: ${atrPct.toFixed(2)}%, Bandwidth: ${bbWidth.toFixed(2)}%). Spread pasar melebar untuk proteksi risiko.`,
        bias: macdHist > 0 ? 'BULLISH' : 'BEARISH',
        volatilityLevel
      };
    }

    // 2. Breakout Check: Price piercing outside Bollinger Bands with strong volume
    if (
      (p > ind.bollingerBands.upper && ind.volume.volumeSurgeRatio >= 1.25) ||
      (p < ind.bollingerBands.lower && ind.volume.volumeSurgeRatio >= 1.25)
    ) {
      const isUpBreak = p > ind.bollingerBands.upper;
      return {
        regime: 'BREAKOUT',
        confidenceScorePct: 85,
        summary: `Breakout ${isUpBreak ? 'Bullish (menembus Resistance)' : 'Bearish (menembus Support)'} terkonfirmasi dengan lonjakan volume (${ind.volume.volumeSurgeRatio}x SMA20).`,
        bias: isUpBreak ? 'BULLISH' : 'BEARISH',
        volatilityLevel: 'HIGH'
      };
    }

    // 3. Reversal Check: Extreme RSI with MACD divergence or pin-bar rejection
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles.length > 1 ? candles[candles.length - 2] : lastCandle;
    const isBullishReversal = (rsi < 32 && macdHist > 0) || (rsi < 35 && lastCandle.close > prevCandle.high);
    const isBearishReversal = (rsi > 68 && macdHist < 0) || (rsi > 65 && lastCandle.close < prevCandle.low);

    if (isBullishReversal || isBearishReversal) {
      return {
        regime: 'REVERSAL',
        confidenceScorePct: 82,
        summary: `Indikasi reversal ${isBullishReversal ? 'Bullish Reversal (Oversold bounce)' : 'Bearish Reversal (Overbought pullback)'} terdeteksi dari RSI (${rsi.toFixed(1)}) & momentum MACD.`,
        bias: isBullishReversal ? 'BULLISH' : 'BEARISH',
        volatilityLevel
      };
    }

    // 4. Strong Bullish Trend
    const isBullishStacked = ema20 > ema50 && p > ema20 && rsi > 52 && macdHist >= 0;
    if (isBullishStacked) {
      const confidence = Math.min(95, 70 + (rsi > 58 ? 15 : 5) + (p > ema200 ? 10 : 0));
      return {
        regime: 'BULLISH_TREND',
        confidenceScorePct: confidence,
        summary: `Tren Bullish kuat. Harga di atas EMA 20 & EMA 50, momentum MACD positif, RSI di level ${rsi.toFixed(1)}.`,
        bias: 'BULLISH',
        volatilityLevel
      };
    }

    // 5. Strong Bearish Trend
    const isBearishStacked = ema20 < ema50 && p < ema20 && rsi < 48 && macdHist <= 0;
    if (isBearishStacked) {
      const confidence = Math.min(95, 70 + (rsi < 42 ? 15 : 5) + (p < ema200 ? 10 : 0));
      return {
        regime: 'BEARISH_TREND',
        confidenceScorePct: confidence,
        summary: `Tren Bearish tertekan. Harga berada di bawah EMA 20 & EMA 50, histogram MACD negatif, RSI di level ${rsi.toFixed(1)}.`,
        bias: 'BEARISH',
        volatilityLevel
      };
    }

    // 6. Consolidation / Compression Check
    if (volatilityLevel === 'LOW' && bbWidth < 1.6 && Math.abs(rsi - 50) < 6) {
      return {
        regime: 'CONSOLIDATION',
        confidenceScorePct: 80,
        summary: `Konsolidasi ketat pasca-pergerakan. Bollinger Bandwidth sangat rapat (${bbWidth.toFixed(2)}%), mempersiapkan potensi pergerakan ekspansi berikutnya.`,
        bias: 'NEUTRAL',
        volatilityLevel: 'LOW'
      };
    }

    // 7. Low Volatility
    if (volatilityLevel === 'LOW') {
      return {
        regime: 'LOW_VOLATILITY',
        confidenceScorePct: 78,
        summary: `Volatilitas rendah (ATR ${atrPct.toFixed(2)}%). Spread pasar dapat dipersempit secara optimal untuk meningkatkan likuiditas.`,
        bias: 'NEUTRAL',
        volatilityLevel: 'LOW'
      };
    }

    // 8. Default: Sideways / Range-Bound
    return {
      regime: 'SIDEWAYS',
      confidenceScorePct: 75,
      summary: `Pasar bergerak mendatar (Sideways / Range-bound). Harga bergerak di antara Support S1 & Resistance R1.`,
      bias: 'NEUTRAL',
      volatilityLevel: 'NORMAL'
    };
  }
}

export const timeframeAnalyticsService = new TimeframeAnalyticsService();
