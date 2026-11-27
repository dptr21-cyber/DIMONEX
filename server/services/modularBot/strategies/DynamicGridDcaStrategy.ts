/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/strategies/DynamicGridDcaStrategy.ts
 * Category B — Hybrid: Dynamic Grid & DCA Trading Strategy.
 * Deploys stepped buy/sell grid levels backed strictly by available funds,
 * optional ATR dynamic spacing, ADX/RSI trend filtering, and emergency drawdown halt.
 */

import crypto from 'crypto';
import { PrecisionMath } from '../../../ledger/PrecisionMath.js';
import {
  BotConfigSchemaV1,
  BotExecutionRecord,
  BotPositionState,
  ConfigValidationResult,
  GridLevelRecommendation,
  MarketMakingQuoteRecommendation,
  NormalizedMarketData,
  StrategyController,
  StrategyExecutionContext,
  StrategyMetadata,
  StrategySignal,
} from '../types.js';
import { IndicatorEngine } from '../IndicatorEngine.js';

function alignToTick(priceUnits: bigint, tickUnits: bigint): bigint {
  if (tickUnits <= 1n) return priceUnits > 0n ? priceUnits : 1n;
  const rem = priceUnits % tickUnits;
  return rem === 0n ? priceUnits : priceUnits - rem;
}

export class DynamicGridDcaStrategy implements StrategyController {
  private config: BotConfigSchemaV1 | null = null;
  private anchorPrice = 0;

  public getMetadata(): StrategyMetadata {
    return {
      strategyId: 'dynamic_grid_dca',
      name: 'Dynamic Grid & DCA Strategy',
      version: '1.0.0',
      category: 'HYBRID',
      description:
        'Strategi grid adaptif & Dollar-Cost Averaging berjenjang berbasis saldo tersedia riil, spasi ATR opsional, filter tren ADX/RSI, dan emergency stop.',
      supportedMarketTypes: ['SPOT'],
      supportedTimeframes: ['5m', '15m', '30m', '1h', '4h', '1D'],
      requiredIndicators: ['ATR', 'ADX', 'RSI'],
      configurationSchema: [
        { key: 'gridLevels', label: 'Grid Levels', type: 'number', defaultValue: 6, min: 2, max: 20, step: 1, description: 'Total level grid beli dan jual.' },
        { key: 'gridSpacingPct', label: 'Static Grid Spacing (%)', type: 'number', defaultValue: 0.8, min: 0.1, max: 15, step: 0.1, description: 'Jarak persentase antar level grid jika ATR mode nonaktif.' },
        { key: 'useAtrSpacing', label: 'Use ATR Dynamic Spacing', type: 'boolean', defaultValue: false, description: 'Sesuaikan jarak grid otomatis mengikuti volatilitas ATR%.' },
        { key: 'atrMultiplier', label: 'ATR Spacing Multiplier', type: 'number', defaultValue: 1.2, min: 0.3, max: 5, step: 0.1, description: 'Pengali ATR% untuk jarak antar level grid.' },
        { key: 'lowerPrice', label: 'Lower Grid Bound (0=Auto)', type: 'number', defaultValue: 0, min: 0, max: 1e12, step: 1, description: 'Batas harga bawah grid (0 = otomatis dari harga referensi).' },
        { key: 'upperPrice', label: 'Upper Grid Bound (0=Auto)', type: 'number', defaultValue: 0, min: 0, max: 1e12, step: 1, description: 'Batas harga atas grid (0 = otomatis dari harga referensi).' },
        { key: 'dcaMultiplier', label: 'DCA Scale Multiplier', type: 'number', defaultValue: 1.15, min: 1.0, max: 3.0, step: 0.05, description: 'Pengali ukuran order pada level beli lebih rendah.' },
        { key: 'maxInventoryBase', label: 'Max Base Inventory', type: 'number', defaultValue: 5, min: 0.0001, max: 1000000, step: 0.01, description: 'Batas maksimum aset base yang boleh ditahan grid.' },
        { key: 'trendFilterEnabled', label: 'ADX/RSI Trend Filter', type: 'boolean', defaultValue: true, description: 'Tahan pembelian DCA agresif saat tren turun ekstrem (ADX tinggi & RSI sangat rendah).' },
        { key: 'adxMaxThreshold', label: 'Max ADX Trend Threshold', type: 'number', defaultValue: 38, min: 15, max: 80, step: 1, description: 'Batas ADX sebelum filter tren menahan entry grid beli.' },
        { key: 'emergencyStopDropPct', label: 'Emergency Stop Drop (%)', type: 'number', defaultValue: 12, min: 1, max: 80, step: 1, description: 'Persentase penurunan tajam dari anchor/entry yang memicu sinyal EXIT darurat.' },
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
    this.anchorPrice = 0;
  }

  public validateConfig(config: BotConfigSchemaV1): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const ind = config.strategy?.indicators || {};

    const levels = Number(ind.gridLevels ?? 6);
    const spacing = Number(ind.gridSpacingPct ?? 0.8);
    const lo = Number(ind.lowerPrice ?? 0);
    const hi = Number(ind.upperPrice ?? 0);
    const dcaMult = Number(ind.dcaMultiplier ?? 1.15);

    if (levels < 2 || levels > 30) errors.push('gridLevels harus antara 2 dan 30.');
    if (spacing <= 0 || spacing > 25) errors.push('gridSpacingPct harus antara 0.05% dan 25%.');
    if (lo > 0 && hi > 0 && lo >= hi) errors.push('lowerPrice harus lebih kecil dari upperPrice.');
    if (dcaMult < 1 || dcaMult > 5) errors.push('dcaMultiplier harus antara 1.0 dan 5.0.');

    return { valid: errors.length === 0, errors, warnings };
  }

  public onMarketData(_data: NormalizedMarketData): void {}
  public onPositionUpdate(_position: BotPositionState): void {}
  public onExecutionUpdate(_execution: BotExecutionRecord): void {}
  public reset(): void {
    this.anchorPrice = 0;
  }

  public generateSignal(context: StrategyExecutionContext): StrategySignal {
    const cfg = this.config || context.config;
    const ind = cfg.strategy.indicators || {};
    const mkt = context.marketData;
    const constraints = mkt.constraints;
    const now = context.now;

    const totalLevels = Math.max(2, Math.min(20, Math.trunc(Number(ind.gridLevels ?? 6))));
    const staticSpacingPct = Math.max(0.1, Number(ind.gridSpacingPct ?? 0.8));
    const useAtr = Boolean(ind.useAtrSpacing);
    const atrMult = Math.max(0.3, Number(ind.atrMultiplier ?? 1.2));
    const cfgLower = Number(ind.lowerPrice ?? 0);
    const cfgUpper = Number(ind.upperPrice ?? 0);
    const dcaMultiplier = Math.max(1, Number(ind.dcaMultiplier ?? 1.15));
    const trendFilter = ind.trendFilterEnabled !== false;
    const adxMax = Number(ind.adxMaxThreshold ?? 38);
    const emergencyDropPct = Math.max(1, Number(ind.emergencyStopDropPct ?? 12));

    const refPrice = mkt.referencePrice;
    const refUnits = BigInt(mkt.referencePriceUnits || '0');
    if (refPrice > 0 && this.anchorPrice <= 0) {
      this.anchorPrice = refPrice;
    }

    const candles = mkt.candles;
    const closes = candles.map(c => c.close);
    const adxOut = candles.length >= 20 ? IndicatorEngine.adx(candles, 14) : { adx: 18, plusDi: 20, minusDi: 20 };
    const rsiVal = closes.length >= 15 ? IndicatorEngine.rsi(closes, 14) : 50;
    const atrPct = mkt.volatility.atrPct > 0 ? mkt.volatility.atrPct : staticSpacingPct;
    const effectiveSpacingPct = useAtr ? Math.max(0.15, Math.min(10, atrPct * atrMult)) : staticSpacingPct;

    const indicatorValues: Record<string, number | string | boolean> = {
      effectiveSpacingPct: Number(effectiveSpacingPct.toFixed(3)),
      adx: Number(adxOut.adx.toFixed(2)),
      rsi: Number(rsiVal.toFixed(2)),
      atrPct: Number(atrPct.toFixed(3)),
      anchorPrice: Number(this.anchorPrice.toFixed(4)),
    };

    if (refUnits <= 0n || refPrice <= 0) {
      return {
        signalId: crypto.randomUUID(),
        strategyId: 'dynamic_grid_dca',
        botInstanceId: context.botId,
        tradingPair: mkt.pairId,
        signalTimestamp: now,
        signalExpiration: now + 15_000,
        category: 'HYBRID',
        signalType: 'HOLD',
        confidenceScore: 0,
        indicatorValues,
        referenceMarketPriceUnits: mkt.referencePriceUnits,
        referenceMarketPrice: refPrice,
        strategyExplanation: 'Menunggu harga referensi valid untuk sinkronisasi grid.',
        riskMetadata: { regime: mkt.volatility.regime, volatilityAtrPct: atrPct, isEligibleForTripleBarrier: false },
      };
    }

    // Emergency drop detection when holding inventory
    const heldBase = BigInt(context.position.baseQtyUnits || '0');
    if (heldBase > 0n && this.anchorPrice > 0) {
      const dropPct = ((this.anchorPrice - refPrice) / this.anchorPrice) * 100;
      if (dropPct >= emergencyDropPct) {
        return {
          signalId: crypto.randomUUID(),
          strategyId: 'dynamic_grid_dca',
          botInstanceId: context.botId,
          tradingPair: mkt.pairId,
          signalTimestamp: now,
          signalExpiration: now + 20_000,
          category: 'HYBRID',
          signalType: 'EXIT',
          confidenceScore: 95,
          indicatorValues: { ...indicatorValues, dropFromAnchorPct: Number(dropPct.toFixed(2)) },
          referenceMarketPriceUnits: mkt.referencePriceUnits,
          referenceMarketPrice: refPrice,
          strategyExplanation: `EMERGENCY STOP GRID: Harga turun ${dropPct.toFixed(2)}% melampaui batas ${emergencyDropPct}%.`,
          riskMetadata: { regime: mkt.volatility.regime, volatilityAtrPct: atrPct, isEligibleForTripleBarrier: false },
        };
      }
    }

    // Check max inventory limit
    const maxInvStr = String(ind.maxInventoryBase || cfg.risk.limits.maxPositionBase || '1000000');
    let maxInvUnits = BigInt(constraints.maxOrderSizeUnits);
    try {
      maxInvUnits = PrecisionMath.parseToUnits(maxInvStr, constraints.baseDecimals);
    } catch {}
    const inventoryFull = heldBase >= maxInvUnits;

    // Trend filter check for DCA buy side
    const strongDowntrendPause =
      trendFilter && adxOut.adx > adxMax && adxOut.minusDi > adxOut.plusDi && rsiVal < 32;

    // Base sizing from risk.positionSizing
    let baseLevelQty = BigInt(constraints.minOrderSizeUnits);
    try {
      if (cfg.risk.positionSizing.method === 'FIXED_QTY') {
        baseLevelQty = PrecisionMath.parseToUnits(cfg.risk.positionSizing.value, constraints.baseDecimals);
      } else if (cfg.risk.positionSizing.method === 'FIXED_QUOTE') {
        const qPerOrder = PrecisionMath.parseToUnits(cfg.risk.positionSizing.value, constraints.quoteDecimals);
        baseLevelQty = PrecisionMath.calculateBaseQuantity(qPerOrder, constraints.baseDecimals, refUnits);
      }
    } catch {}
    if (baseLevelQty < BigInt(constraints.minOrderSizeUnits)) {
      baseLevelQty = BigInt(constraints.minOrderSizeUnits);
    }

    const tickUnits = BigInt(constraints.tickSizeUnits || '1');
    const halfLevels = Math.max(1, Math.floor(totalLevels / 2));
    const lowerLimitUnits =
      cfgLower > 0
        ? PrecisionMath.parseToUnits(cfgLower.toFixed(constraints.quoteDecimals), constraints.quoteDecimals)
        : (refUnits * BigInt(Math.max(10, Math.round((100 - halfLevels * effectiveSpacingPct) * 100)))) / 10000n;
    const upperLimitUnits =
      cfgUpper > 0
        ? PrecisionMath.parseToUnits(cfgUpper.toFixed(constraints.quoteDecimals), constraints.quoteDecimals)
        : (refUnits * BigInt(Math.round((100 + halfLevels * effectiveSpacingPct) * 100))) / 10000n;

    const quotes: MarketMakingQuoteRecommendation[] = [];
    const gridLevels: GridLevelRecommendation[] = [];

    if (!inventoryFull && !strongDowntrendPause) {
      for (let i = 1; i <= halfLevels; i++) {
        const pctDown = effectiveSpacingPct * i;
        const pUnits = alignToTick(
          (refUnits * BigInt(Math.max(100, Math.round((100 - pctDown) * 100)))) / 10000n,
          tickUnits
        );
        if (pUnits <= 0n || pUnits < lowerLimitUnits) continue;
        const scaleMult = Math.round(Math.pow(dcaMultiplier, i - 1) * 100);
        const qtyUnits = (baseLevelQty * BigInt(scaleMult)) / 100n;
        if (qtyUnits < BigInt(constraints.minOrderSizeUnits)) continue;
        gridLevels.push({ levelIndex: -i, side: 'BUY', priceUnits: pUnits.toString(), quantityUnits: qtyUnits.toString() });
        quotes.push({
          level: i,
          side: 'BUY',
          priceUnits: pUnits.toString(),
          quantityUnits: qtyUnits.toString(),
          postOnly: true,
          clientTag: `grid-b-${i}`,
        });
      }
    }

    if (heldBase > BigInt(constraints.minOrderSizeUnits)) {
      for (let i = 1; i <= halfLevels; i++) {
        const pctUp = effectiveSpacingPct * i;
        const pUnits = alignToTick(
          (refUnits * BigInt(Math.round((100 + pctUp) * 100))) / 10000n,
          tickUnits
        );
        if (pUnits > upperLimitUnits) continue;
        const qtyUnits = baseLevelQty <= heldBase ? baseLevelQty : heldBase;
        if (qtyUnits < BigInt(constraints.minOrderSizeUnits)) continue;
        gridLevels.push({ levelIndex: i, side: 'SELL', priceUnits: pUnits.toString(), quantityUnits: qtyUnits.toString() });
        quotes.push({
          level: i,
          side: 'SELL',
          priceUnits: pUnits.toString(),
          quantityUnits: qtyUnits.toString(),
          postOnly: true,
          clientTag: `grid-s-${i}`,
        });
      }
    }

    const cancelStaleOrderIds: string[] = [];
    for (const open of context.openOrders) {
      if (strongDowntrendPause && open.side === 'BUY') {
        cancelStaleOrderIds.push(open.orderId);
        continue;
      }
      const opPrice = BigInt(open.priceUnits || '0');
      if (opPrice < lowerLimitUnits || opPrice > upperLimitUnits) {
        cancelStaleOrderIds.push(open.orderId);
      }
    }

    const bid0 = quotes.find(q => q.side === 'BUY')?.priceUnits || refUnits.toString();
    const ask0 = quotes.find(q => q.side === 'SELL')?.priceUnits || refUnits.toString();

    return {
      signalId: crypto.randomUUID(),
      strategyId: 'dynamic_grid_dca',
      botInstanceId: context.botId,
      tradingPair: mkt.pairId,
      signalTimestamp: now,
      signalExpiration: now + 20_000,
      category: 'HYBRID',
      signalType: quotes.length > 0 || cancelStaleOrderIds.length > 0 ? 'GRID_SYNC' : 'HOLD',
      confidenceScore: 78,
      indicatorValues,
      referenceMarketPriceUnits: mkt.referencePriceUnits,
      referenceMarketPrice: refPrice,
      strategyExplanation: strongDowntrendPause
        ? `Trend Filter Aktif (ADX ${adxOut.adx.toFixed(1)}): Menunda buy grid baru, mempertahankan proteksi.`
        : `Dynamic Grid Sync: ${quotes.length} level target (spasi ${effectiveSpacingPct.toFixed(2)}%, DCA ${dcaMultiplier}x).`,
      riskMetadata: {
        regime: mkt.volatility.regime,
        volatilityAtrPct: atrPct,
        isEligibleForTripleBarrier: false,
      },
      marketMaking: {
        bidTargetPriceUnits: bid0,
        askTargetPriceUnits: ask0,
        targetSpreadBps: Math.round(effectiveSpacingPct * 200),
        inventorySkewBps: 0,
        recommendedBidQtyUnits: baseLevelQty.toString(),
        recommendedAskQtyUnits: baseLevelQty.toString(),
        quotes,
        gridLevels,
        cancelStaleOrderIds,
      },
    };
  }
}
