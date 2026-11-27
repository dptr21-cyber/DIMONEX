/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/RiskManager.ts
 * Layer 3A — Centralized Risk Management Engine.
 * Enforces:
 * - Spot-first DerivativesExecutionGuard (no fake shorting/leverage)
 * - Triple Barrier (Take Profit, Stop Loss, Max Holding Time) on eligible directional positions
 * - Trailing Stop & Break-Even ratcheting in exact BigInt integer units
 * - 4 Position Sizing Modes backed strictly by spendable `balanceAvailable`
 * - Multi-bot Account-Level Exposure & Daily Loss Aggregation + Global Kill Switch
 */

import { db } from '../../db/database.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { LedgerService } from '../../ledger/LedgerService.js';
import {
  AccountPortfolioRiskSnapshot,
  BotPositionState,
  DerivativesExecutionAdapter,
  MarketMakingQuoteRecommendation,
  ModularBotRecord,
  NormalizedMarketData,
  StrategySignal,
} from './types.js';

export interface AuthorizedOrderIntent {
  side: 'BUY' | 'SELL';
  priceUnits: string;
  quantityUnits: string;
  postOnly: boolean;
  clientTag: string;
  isBarrierExit?: boolean;
}

export interface RiskAuthorizationResult {
  approved: boolean;
  reason?: string;
  intents: AuthorizedOrderIntent[];
  cancelOrderIds: string[];
  haltBot?: boolean;
  riskWarnings: string[];
}

export class SpotDerivativesExecutionGuard implements DerivativesExecutionAdapter {
  public readonly supported = false;
  public readonly reason =
    'DIMONEX MODULAR_STRATEGY_BOT beroperasi pada mode SPOT-FIRST; short-selling dan leverage derivatif dinonaktifkan sampai modul Futures Adapter eksplisit diaktifkan.';

  public validateDerivativesEligibility(): { eligible: boolean; reason: string } {
    return { eligible: this.supported, reason: this.reason };
  }
}

export const derivativesGuard = new SpotDerivativesExecutionGuard();

function getWibDateString(ts = Date.now()): string {
  // UTC+7 (Asia/Jakarta)
  const d = new Date(ts + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function alignDownToLot(qtyUnits: bigint, lotUnits: bigint): bigint {
  if (lotUnits <= 1n) return qtyUnits;
  return qtyUnits - (qtyUnits % lotUnits);
}

function alignToTick(priceUnits: bigint, tickUnits: bigint, roundUp: boolean): bigint {
  if (tickUnits <= 1n) return priceUnits > 0n ? priceUnits : 1n;
  const rem = priceUnits % tickUnits;
  if (rem === 0n) return priceUnits;
  return roundUp ? priceUnits + (tickUnits - rem) : priceUnits - rem;
}

export class RiskManager {
  /**
   * Computes Account-Level Portfolio Risk Aggregation across ALL live modular bots owned by `userId`.
   */
  public static getAccountPortfolioRisk(
    userId: string,
    allBots: Iterable<ModularBotRecord>
  ): AccountPortfolioRiskSnapshot {
    let activeLiveBotsCount = 0;
    let activePaperBotsCount = 0;
    let totalLiveOpenOrders = 0;
    let totalLiveExposureQuoteUnits = 0n;
    let totalLiveDailyPnlQuoteUnits = 0n;
    const todayWib = getWibDateString();

    for (const bot of allBots) {
      if (bot.ownerUserId !== userId) continue;
      if (bot.config.bot.mode === 'LIVE') {
        if (bot.status === 'RUNNING' || bot.status === 'PAUSED') {
          activeLiveBotsCount += 1;
        }
        totalLiveOpenOrders += bot.openOrders.length;

        const pair = db.tradingPairs.get(bot.pairId);
        const baseDec = pair?.baseDecimals ?? 8;
        const refPriceUnits = BigInt(pair?.lastPrice || '0');
        const posQty = BigInt(bot.position.baseQtyUnits || '0');
        if (posQty > 0n && refPriceUnits > 0n) {
          totalLiveExposureQuoteUnits += PrecisionMath.calculateQuoteAmount(posQty, baseDec, refPriceUnits);
        }
        for (const oo of bot.openOrders) {
          if (oo.side === 'BUY') {
            totalLiveExposureQuoteUnits += BigInt(oo.lockedAmountUnits || '0');
          } else if (refPriceUnits > 0n) {
            const remBase = BigInt(oo.quantityUnits || '0') - BigInt(oo.filledQuantityUnits || '0');
            if (remBase > 0n) {
              totalLiveExposureQuoteUnits += PrecisionMath.calculateQuoteAmount(remBase, baseDec, refPriceUnits);
            }
          }
        }

        if (bot.metrics.dailyLossDateWib === todayWib) {
          // dailyLossQuoteUnits stores accumulated positive loss
          totalLiveDailyPnlQuoteUnits -= BigInt(bot.metrics.dailyLossQuoteUnits || '0');
        }
      } else if (bot.config.bot.mode === 'PAPER' && bot.status === 'RUNNING') {
        activePaperBotsCount += 1;
      }
    }

    const maxAllowedExposure = BigInt(db.riskControls.maxNotionalExposureIdr || '5000000000000');
    const maxAllowedDailyLoss = BigInt(db.riskControls.maxDailyTradingNotionalIdr || '20000000000000');

    let isRiskLocked = Boolean(db.riskControls.isKillSwitchActive);
    let lockReason = isRiskLocked ? 'Global Exchange Kill-Switch aktif.' : undefined;

    if (!isRiskLocked && totalLiveExposureQuoteUnits > maxAllowedExposure) {
      isRiskLocked = true;
      lockReason = 'Total eksposur live akun melampaui batas risiko global bursa.';
    }

    return {
      userId,
      activeLiveBotsCount,
      activePaperBotsCount,
      totalLiveOpenOrders,
      totalLiveExposureQuoteUnits: totalLiveExposureQuoteUnits.toString(),
      maxAllowedAccountExposureQuoteUnits: maxAllowedExposure.toString(),
      totalLiveDailyPnlQuoteUnits: totalLiveDailyPnlQuoteUnits.toString(),
      maxAllowedAccountDailyLossQuoteUnits: maxAllowedDailyLoss.toString(),
      isRiskLocked,
      lockReason,
    };
  }

  /**
   * Evaluates Triple Barrier (Upper TP, Lower SL, Vertical Time Limit) + Trailing Stop / Break-Even.
   * Mutates `position` watermarks/stop levels in memory and returns an exit reason if triggered.
   * Explicitly skipped for resting Market Making / Hybrid quote bots.
   */
  public static evaluatePositionBarriers(
    bot: ModularBotRecord,
    marketData: NormalizedMarketData,
    now: number
  ): { triggerExit: boolean; reason?: string; exitPolicy?: string } {
    const pos: BotPositionState = bot.position;
    const heldBase = BigInt(pos.baseQtyUnits || '0');
    if (pos.side !== 'LONG' || heldBase <= 0n) {
      return { triggerExit: false };
    }

    // Do not apply directional triple barrier to Market Making resting quote strategies
    if (bot.config.bot.category === 'MARKET_MAKING') {
      return { triggerExit: false };
    }

    const currentUnits = BigInt(marketData.referencePriceUnits || '0');
    const entryUnits = BigInt(pos.avgEntryPriceUnits || '0');
    if (currentUnits <= 0n || entryUnits <= 0n) {
      return { triggerExit: false };
    }

    const quoteDec = marketData.constraints.quoteDecimals;
    const tb = bot.config.risk.tripleBarrier;
    const ts = bot.config.risk.trailingStop;

    // Track High-Water Mark
    const prevHwm = BigInt(pos.highWaterMarkPriceUnits || pos.avgEntryPriceUnits || '0');
    if (currentUnits > prevHwm) {
      pos.highWaterMarkPriceUnits = currentUnits.toString();
    }
    const hwm = BigInt(pos.highWaterMarkPriceUnits || currentUnits.toString());

    // Compute Unrealized PnL in exact BigInt quote units
    const currentVal = PrecisionMath.calculateQuoteAmount(
      heldBase,
      marketData.constraints.baseDecimals,
      currentUnits
    );
    const costBasis = BigInt(pos.quoteCostBasisUnits || '0');
    pos.unrealizedPnlQuoteUnits = (currentVal - costBasis).toString();

    // 1. Update Break-Even & Trailing Stop SL ratchet (only moves upwards)
    let activeSl = pos.activeStopLossPriceUnits ? BigInt(pos.activeStopLossPriceUnits) : 0n;
    let activeTp = pos.activeTakeProfitPriceUnits ? BigInt(pos.activeTakeProfitPriceUnits) : 0n;

    if (tb.enabled) {
      if (activeTp <= 0n) {
        if (tb.takeProfitAbsPrice && parseFloat(tb.takeProfitAbsPrice) > 0) {
          activeTp = PrecisionMath.parseToUnits(tb.takeProfitAbsPrice, quoteDec);
        } else if (tb.takeProfitBps > 0) {
          activeTp = (entryUnits * BigInt(10000 + Math.trunc(tb.takeProfitBps))) / 10000n;
        }
        if (activeTp > 0n) pos.activeTakeProfitPriceUnits = activeTp.toString();
      }
      if (activeSl <= 0n) {
        if (tb.stopLossAbsPrice && parseFloat(tb.stopLossAbsPrice) > 0) {
          activeSl = PrecisionMath.parseToUnits(tb.stopLossAbsPrice, quoteDec);
        } else if (tb.stopLossBps > 0) {
          const mult = Math.max(1, 10000 - Math.trunc(tb.stopLossBps));
          activeSl = (entryUnits * BigInt(mult)) / 10000n;
        }
        if (activeSl > 0n) pos.activeStopLossPriceUnits = activeSl.toString();
      }
    }

    if (ts.enabled) {
      // Break-Even arming
      if (ts.breakEvenActivationBps && ts.breakEvenActivationBps > 0 && !pos.breakEvenArmed) {
        const beTrigger = (entryUnits * BigInt(10000 + Math.trunc(ts.breakEvenActivationBps))) / 10000n;
        if (hwm >= beTrigger) {
          const bePrice = (entryUnits * BigInt(10000 + Math.trunc(ts.breakEvenOffsetBps || 0))) / 10000n;
          if (bePrice > activeSl) {
            activeSl = bePrice;
            pos.activeStopLossPriceUnits = activeSl.toString();
          }
          pos.breakEvenArmed = true;
        }
      }

      // Trailing Stop activation & step ratchet
      const trailTrigger = (entryUnits * BigInt(10000 + Math.trunc(ts.activationBps))) / 10000n;
      if (hwm >= trailTrigger) {
        pos.trailingStopActive = true;
        const distMult = Math.max(1, 10000 - Math.trunc(ts.distanceBps));
        const candidateTrailSl = (hwm * BigInt(distMult)) / 10000n;
        const stepBps = Math.max(0, Math.trunc(ts.stepBps || 0));
        const minAdvance = activeSl > 0n ? (activeSl * BigInt(10000 + stepBps)) / 10000n : 0n;
        if (candidateTrailSl > activeSl && candidateTrailSl >= minAdvance) {
          activeSl = candidateTrailSl;
          pos.activeStopLossPriceUnits = activeSl.toString();
        }
      }
    }

    // 2. Check Barrier Triggers
    if (activeTp > 0n && currentUnits >= activeTp) {
      return {
        triggerExit: true,
        reason: `Triple Barrier Take Profit tercapai (${PrecisionMath.formatFromUnits(currentUnits, quoteDec, true)} >= ${PrecisionMath.formatFromUnits(activeTp, quoteDec, true)}).`,
        exitPolicy: tb.exitExecutionPolicy || 'MARKET_PROTECTED',
      };
    }

    if (activeSl > 0n && currentUnits <= activeSl) {
      const label = pos.trailingStopActive
        ? 'Trailing Stop'
        : pos.breakEvenArmed
          ? 'Break-Even Stop'
          : 'Triple Barrier Stop Loss';
      return {
        triggerExit: true,
        reason: `${label} terpicu (${PrecisionMath.formatFromUnits(currentUnits, quoteDec, true)} <= ${PrecisionMath.formatFromUnits(activeSl, quoteDec, true)}).`,
        exitPolicy: tb.exitExecutionPolicy || 'MARKET_PROTECTED',
      };
    }

    if (tb.enabled && tb.maxHoldingSeconds > 0 && pos.openedAt) {
      const heldSec = Math.floor((now - pos.openedAt) / 1000);
      if (heldSec >= tb.maxHoldingSeconds) {
        return {
          triggerExit: true,
          reason: `Triple Barrier Time Limit tercapai (${heldSec}s >= ${tb.maxHoldingSeconds}s).`,
          exitPolicy: tb.exitExecutionPolicy || 'MARKET_PROTECTED',
        };
      }
    }

    return { triggerExit: false };
  }

  /**
   * Computes spendable balances (strictly `balanceAvailable`) for PAPER or LIVE mode.
   */
  public static getSpendableBalances(
    bot: ModularBotRecord,
    baseCurrency: string,
    quoteCurrency: string
  ): { baseAvailableUnits: bigint; quoteAvailableUnits: bigint } {
    if (bot.config.bot.mode === 'PAPER' && bot.paperWallet) {
      return {
        baseAvailableUnits: BigInt(bot.paperWallet.baseAvailableUnits || '0'),
        quoteAvailableUnits: BigInt(bot.paperWallet.quoteAvailableUnits || '0'),
      };
    }
    const baseAcc = db.createOrGetAccount(bot.ownerUserId, baseCurrency);
    const quoteAcc = db.createOrGetAccount(bot.ownerUserId, quoteCurrency);
    return {
      baseAvailableUnits: BigInt(baseAcc.balanceAvailable || '0'),
      quoteAvailableUnits: BigInt(quoteAcc.balanceAvailable || '0'),
    };
  }

  /**
   * Calculates desired base quantity using the configured positionSizing method,
   * clamped by spendable available balance and exchange market min/max constraints.
   */
  public static calculateDirectionalBuyQuantity(
    bot: ModularBotRecord,
    marketData: NormalizedMarketData,
    priceUnits: bigint,
    quoteAvailableUnits: bigint
  ): { qtyUnits: bigint; warning?: string } {
    const c = marketData.constraints;
    const sizing = bot.config.risk.positionSizing;
    const refUnits = priceUnits > 0n ? priceUnits : BigInt(marketData.referencePriceUnits || '0');
    if (refUnits <= 0n) return { qtyUnits: 0n, warning: 'Harga referensi 0.' };

    let rawQty = 0n;
    if (sizing.method === 'FIXED_QTY') {
      rawQty = PrecisionMath.parseToUnits(sizing.value, c.baseDecimals);
    } else if (sizing.method === 'FIXED_QUOTE') {
      const targetQuote = PrecisionMath.parseToUnits(sizing.value, c.quoteDecimals);
      rawQty = PrecisionMath.calculateBaseQuantity(targetQuote, c.baseDecimals, refUnits);
    } else if (sizing.method === 'PERCENT_BALANCE') {
      const pctBps = BigInt(Math.max(1, Math.min(10000, Math.round(parseFloat(sizing.value) * 100))));
      const budgetQuote = (quoteAvailableUnits * pctBps) / 10000n;
      rawQty = PrecisionMath.calculateBaseQuantity(budgetQuote, c.baseDecimals, refUnits);
    } else if (sizing.method === 'RISK_PER_TRADE') {
      // Risk-per-trade: riskQuote = quoteAvailable * riskPct / 100; positionQuote = riskQuote / slRatio
      const riskPct = Math.max(0.05, Math.min(50, parseFloat(sizing.riskPctPerTrade || sizing.value || '1')));
      const slBps = Math.max(25, bot.config.risk.tripleBarrier?.stopLossBps || 200);
      const riskQuote = (quoteAvailableUnits * BigInt(Math.round(riskPct * 100))) / 10000n;
      const targetQuote = (riskQuote * 10000n) / BigInt(slBps);
      rawQty = PrecisionMath.calculateBaseQuantity(targetQuote, c.baseDecimals, refUnits);
    }

    // Clamp to maxNotional limit
    const maxNotionalUnits = PrecisionMath.parseToUnits(bot.config.risk.limits.maxNotional, c.quoteDecimals);
    const maxBaseFromNotional = PrecisionMath.calculateBaseQuantity(maxNotionalUnits, c.baseDecimals, refUnits);
    if (rawQty > maxBaseFromNotional) rawQty = maxBaseFromNotional;

    // Clamp to maxPositionBase if configured
    if (bot.config.risk.limits.maxPositionBase) {
      const maxPos = PrecisionMath.parseToUnits(bot.config.risk.limits.maxPositionBase, c.baseDecimals);
      const currentHeld = BigInt(bot.position.baseQtyUnits || '0');
      const headroom = maxPos > currentHeld ? maxPos - currentHeld : 0n;
      if (rawQty > headroom) rawQty = headroom;
    }

    // Clamp strictly to spendable balanceAvailable (including taker fee headroom)
    const maxAffordableQuote = (quoteAvailableUnits * 10000n) / BigInt(10000 + Math.max(c.takerFeeBps, c.makerFeeBps) + 5);
    const maxAffordableBase = PrecisionMath.calculateBaseQuantity(maxAffordableQuote, c.baseDecimals, refUnits);
    if (rawQty > maxAffordableBase) rawQty = maxAffordableBase;

    const minUnits = BigInt(c.minOrderSizeUnits);
    const maxUnits = BigInt(c.maxOrderSizeUnits);
    const lotUnits = BigInt(c.lotSizeUnits || '1');

    if (rawQty > maxUnits) rawQty = maxUnits;
    rawQty = alignDownToLot(rawQty, lotUnits);

    if (rawQty < minUnits) {
      return {
        qtyUnits: 0n,
        warning: `Ukuran order terhitung di bawah minimum market atau saldo quote tersedia tidak cukup.`,
      };
    }

    return { qtyUnits: rawQty };
  }

  /**
   * Central Signal & Pre-Trade Risk Gatekeeper.
   * StrategyControllers must pass through this gate before any order reaches OrderExecutionEngine.
   */
  public static authorizeSignal(
    bot: ModularBotRecord,
    signal: StrategySignal,
    marketData: NormalizedMarketData,
    allBots: Iterable<ModularBotRecord>,
    now: number
  ): RiskAuthorizationResult {
    const riskWarnings: string[] = [];
    const limits = bot.config.risk.limits;
    const c = marketData.constraints;

    // 1. Global kill switch & emergency stop checks
    if (bot.config.bot.mode === 'LIVE' && db.riskControls.isKillSwitchActive) {
      return {
        approved: false,
        reason: 'Global Exchange Kill-Switch sedang aktif.',
        intents: [],
        cancelOrderIds: bot.openOrders.map(o => o.orderId),
        haltBot: true,
        riskWarnings,
      };
    }

    if (limits.emergencyStop) {
      return {
        approved: false,
        reason: 'Emergency Stop bot aktif pada konfigurasi risiko.',
        intents: [],
        cancelOrderIds: bot.openOrders.map(o => o.orderId),
        haltBot: true,
        riskWarnings,
      };
    }

    if (marketData.isStale) {
      return {
        approved: false,
        reason: marketData.staleReason || 'Market data stale; eksekusi ditolak.',
        intents: [],
        cancelOrderIds: [],
        riskWarnings,
      };
    }

    if (now > signal.signalExpiration) {
      return {
        approved: false,
        reason: 'Sinyal kadaluarsa sebelum melewati RiskManager.',
        intents: [],
        cancelOrderIds: [],
        riskWarnings,
      };
    }

    // 2. Daily Loss & Max Drawdown Protection
    const todayWib = getWibDateString(now);
    if (bot.metrics.dailyLossDateWib !== todayWib) {
      bot.metrics.dailyLossDateWib = todayWib;
      bot.metrics.dailyLossQuoteUnits = '0';
    }
    const maxDailyLossUnits = PrecisionMath.parseToUnits(limits.maxDailyLoss, c.quoteDecimals);
    const currentDailyLoss = BigInt(bot.metrics.dailyLossQuoteUnits || '0');
    if (currentDailyLoss >= maxDailyLossUnits) {
      return {
        approved: false,
        reason: `Daily loss limit tercapai (${PrecisionMath.formatFromUnits(currentDailyLoss, c.quoteDecimals, true)} >= ${limits.maxDailyLoss}).`,
        intents: [],
        cancelOrderIds: bot.openOrders.map(o => o.orderId),
        haltBot: true,
        riskWarnings,
      };
    }

    if (limits.maxDrawdownPct && bot.metrics.maxDrawdownPct >= limits.maxDrawdownPct) {
      return {
        approved: false,
        reason: `Max Drawdown ${bot.metrics.maxDrawdownPct.toFixed(2)}% mencapai batas ${limits.maxDrawdownPct}%.`,
        intents: [],
        cancelOrderIds: bot.openOrders.map(o => o.orderId),
        haltBot: true,
        riskWarnings,
      };
    }

    // 3. Account-Level Multi-Bot Exposure Check (LIVE only)
    if (bot.config.bot.mode === 'LIVE') {
      const portfolioRisk = this.getAccountPortfolioRisk(bot.ownerUserId, allBots);
      if (portfolioRisk.isRiskLocked && signal.signalType !== 'EXIT' && signal.signalType !== 'SELL') {
        return {
          approved: false,
          reason: portfolioRisk.lockReason || 'Account exposure risk lock aktif.',
          intents: [],
          cancelOrderIds: [],
          riskWarnings,
        };
      }
    }

    // 4. Rate Limit (Max Orders Per Minute)
    const maxRate = limits.maxOrdersPerMinute ?? 30;
    bot.orderTimestampsInWindow = (bot.orderTimestampsInWindow || []).filter(t => now - t < 60_000);
    if (bot.orderTimestampsInWindow.length >= maxRate && signal.signalType !== 'EXIT') {
      return {
        approved: false,
        reason: `Rate limit tercapai (${bot.orderTimestampsInWindow.length}/${maxRate} order/menit).`,
        intents: [],
        cancelOrderIds: [],
        riskWarnings,
      };
    }

    // 5. Reject unsupported SHORT on spot
    if (signal.signalType === 'SHORT' && !c.supportsShorting) {
      const guard = derivativesGuard.validateDerivativesEligibility();
      return {
        approved: false,
        reason: guard.reason,
        intents: [],
        cancelOrderIds: [],
        riskWarnings,
      };
    }

    if (signal.signalType === 'HOLD' || signal.signalType === 'NEUTRAL') {
      return {
        approved: true,
        intents: [],
        cancelOrderIds: signal.marketMaking?.cancelStaleOrderIds || [],
        riskWarnings,
      };
    }

    const { baseAvailableUnits, quoteAvailableUnits } = this.getSpendableBalances(
      bot,
      c.baseCurrency,
      c.quoteCurrency
    );
    const tickUnits = BigInt(c.tickSizeUnits || '1');
    const minQtyUnits = BigInt(c.minOrderSizeUnits);
    const maxQtyUnits = BigInt(c.maxOrderSizeUnits);

    // 6. Market Making / Grid Multi-Quote Synchronization
    if (
      (signal.signalType === 'MARKET_MAKE_QUOTES' || signal.signalType === 'GRID_SYNC') &&
      signal.marketMaking
    ) {
      const cancelOrderIds = [...(signal.marketMaking.cancelStaleOrderIds || [])];
      const cancelSet = new Set(cancelOrderIds);
      const remainingOpenCount = bot.openOrders.filter(o => !cancelSet.has(o.orderId)).length;
      const availableOrderSlots = Math.max(0, limits.maxOpenOrders - remainingOpenCount);
      const maxNotionalUnits = PrecisionMath.parseToUnits(limits.maxNotional, c.quoteDecimals);

      // Available inventory tracking across quotes (prevent double spend)
      let remQuote = quoteAvailableUnits;
      let remBase = baseAvailableUnits;
      // Add back funds that will be freed by cancelled stale orders in Paper/Local check
      for (const oo of bot.openOrders) {
        if (cancelSet.has(oo.orderId)) {
          if (oo.lockedCurrency === c.quoteCurrency) remQuote += BigInt(oo.lockedAmountUnits || '0');
          if (oo.lockedCurrency === c.baseCurrency) remBase += BigInt(oo.lockedAmountUnits || '0');
        }
      }

      const intents: AuthorizedOrderIntent[] = [];
      const existingTags = new Set(
        bot.openOrders.filter(o => !cancelSet.has(o.orderId)).map(o => o.clientOrderId)
      );

      for (const q of signal.marketMaking.quotes as MarketMakingQuoteRecommendation[]) {
        if (intents.length >= availableOrderSlots) {
          riskWarnings.push(`Batas maxOpenOrders (${limits.maxOpenOrders}) membatasi jumlah quote.`);
          break;
        }
        // Skip if order with same tag already resting and not marked stale
        const hasTag = Array.from(existingTags).some(cid => cid.includes(q.clientTag));
        if (hasTag) continue;

        let pUnits = alignToTick(BigInt(q.priceUnits || '0'), tickUnits, q.side === 'SELL');
        let qUnits = alignDownToLot(BigInt(q.quantityUnits || '0'), BigInt(c.lotSizeUnits || '1'));
        if (pUnits <= 0n || qUnits < minQtyUnits) continue;
        if (qUnits > maxQtyUnits) qUnits = maxQtyUnits;

        const notional = PrecisionMath.calculateQuoteAmount(qUnits, c.baseDecimals, pUnits);
        if (notional > maxNotionalUnits) {
          qUnits = alignDownToLot(
            PrecisionMath.calculateBaseQuantity(maxNotionalUnits, c.baseDecimals, pUnits),
            BigInt(c.lotSizeUnits || '1')
          );
        }
        if (qUnits < minQtyUnits) continue;

        if (q.side === 'BUY') {
          const reqQuote = PrecisionMath.calculateQuoteAmount(qUnits, c.baseDecimals, pUnits);
          const feeEst = PrecisionMath.calculateFee(reqQuote, Math.max(c.makerFeeBps, c.takerFeeBps));
          if (remQuote < reqQuote + feeEst) {
            riskWarnings.push(`Saldo tersedia ${c.quoteCurrency} tidak cukup untuk bid level ${q.level}.`);
            continue;
          }
          remQuote -= reqQuote + feeEst;
        } else {
          if (remBase < qUnits) {
            riskWarnings.push(`Saldo tersedia ${c.baseCurrency} tidak cukup untuk ask level ${q.level}.`);
            continue;
          }
          remBase -= qUnits;
        }

        intents.push({
          side: q.side,
          priceUnits: pUnits.toString(),
          quantityUnits: qUnits.toString(),
          postOnly: q.postOnly,
          clientTag: q.clientTag,
        });
      }

      return {
        approved: true,
        intents,
        cancelOrderIds,
        riskWarnings,
      };
    }

    // 7. Directional Entry (BUY / LONG)
    if (signal.signalType === 'BUY' || signal.signalType === 'LONG') {
      if (bot.openOrders.length >= limits.maxOpenOrders) {
        return {
          approved: false,
          reason: `Maksimum open orders (${limits.maxOpenOrders}) telah tercapai.`,
          intents: [],
          cancelOrderIds: [],
          riskWarnings,
        };
      }

      let targetPriceUnits = BigInt(signal.referenceMarketPriceUnits || marketData.referencePriceUnits);
      if (bot.config.execution.orderType === 'POST_ONLY' && BigInt(marketData.orderBook.bestAskUnits || '0') > tickUnits) {
        const maxPostOnlyBid = BigInt(marketData.orderBook.bestAskUnits) - tickUnits;
        if (targetPriceUnits >= BigInt(marketData.orderBook.bestAskUnits)) {
          targetPriceUnits = maxPostOnlyBid;
        }
      } else if (BigInt(marketData.orderBook.bestAskUnits || '0') > 0n && bot.config.execution.orderType !== 'LIMIT') {
        targetPriceUnits = BigInt(marketData.orderBook.bestAskUnits);
      }
      targetPriceUnits = alignToTick(targetPriceUnits, tickUnits, false);

      const { qtyUnits, warning } = this.calculateDirectionalBuyQuantity(
        bot,
        marketData,
        targetPriceUnits,
        quoteAvailableUnits
      );
      if (warning) riskWarnings.push(warning);
      if (qtyUnits < minQtyUnits) {
        return {
          approved: false,
          reason: warning || 'Saldo tersedia atau batasan ukuran tidak mencukupi untuk BUY.',
          intents: [],
          cancelOrderIds: [],
          riskWarnings,
        };
      }

      return {
        approved: true,
        intents: [
          {
            side: 'BUY',
            priceUnits: targetPriceUnits.toString(),
            quantityUnits: qtyUnits.toString(),
            postOnly: bot.config.execution.postOnly || bot.config.execution.orderType === 'POST_ONLY',
            clientTag: 'dir-entry',
          },
        ],
        cancelOrderIds: [],
        riskWarnings,
      };
    }

    // 8. Directional Exit / Sell (SELL / EXIT)
    if (signal.signalType === 'SELL' || signal.signalType === 'EXIT') {
      const heldPos = BigInt(bot.position.baseQtyUnits || '0');
      const sellTargetQty = heldPos > 0n ? (heldPos <= baseAvailableUnits ? heldPos : baseAvailableUnits) : 0n;
      const clampedQty = alignDownToLot(
        sellTargetQty > maxQtyUnits ? maxQtyUnits : sellTargetQty,
        BigInt(c.lotSizeUnits || '1')
      );

      if (clampedQty < minQtyUnits) {
        return {
          approved: false,
          reason: 'Tidak ada saldo inventori base yang cukup untuk dieksekusi SELL/EXIT.',
          intents: [],
          cancelOrderIds: [],
          riskWarnings,
        };
      }

      let exitPriceUnits = BigInt(signal.referenceMarketPriceUnits || marketData.referencePriceUnits);
      if (BigInt(marketData.orderBook.bestBidUnits || '0') > 0n && bot.config.execution.orderType !== 'LIMIT') {
        exitPriceUnits = BigInt(marketData.orderBook.bestBidUnits);
      }
      exitPriceUnits = alignToTick(exitPriceUnits, tickUnits, true);

      return {
        approved: true,
        intents: [
          {
            side: 'SELL',
            priceUnits: exitPriceUnits.toString(),
            quantityUnits: clampedQty.toString(),
            postOnly: false,
            clientTag: 'dir-exit',
            isBarrierExit: String((signal as any).strategyExplanation || '').includes('Barrier') || String((signal as any).strategyExplanation || '').includes('Stop'),
          },
        ],
        // Cancel open BUY orders owned by this bot on EXIT signal
        cancelOrderIds: bot.openOrders.filter(o => o.side === 'BUY').map(o => o.orderId),
        riskWarnings,
      };
    }

    return { approved: false, reason: 'Signal type tidak dikenal.', intents: [], cancelOrderIds: [], riskWarnings };
  }
}
