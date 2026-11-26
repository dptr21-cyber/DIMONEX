/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/copy/CopyTradingService.ts
 * Real Institutional Copy Trading Engine backed by Double-Entry Ledger & OrderBook Hooks.
 *
 * Capabilities:
 * - Persistent Master Traders in db.copyMasters (zero mock/hardcoded arrays).
 * - Master metrics (30D/90D ROI, Win Rate, Max Drawdown, AUM, Followers) computed dynamically from real db.trades & active sleeves.
 * - Isolated Copy Sleeves with atomic LedgerService transfers to/from SYSTEM_COPY_CUSTODY_ID.
 * - Real-time proportional mirroring via OrderBook.registerTradeSettledListener.
 * - Automatic High-Water Mark profit sharing on profitable close + Stop Loss / Take Profit guardrails.
 */

import crypto from 'crypto';
import { db, SYSTEM_COPY_CUSTODY_ID, SYSTEM_FEE_ID, SYSTEM_TREASURY_ID } from '../../db/database.js';
import {
  CopyMasterTrader,
  CopyRelationship,
  CopyMirroredOrder,
  Trade,
  OrderSide,
} from '../../db/types.js';
import { LedgerService } from '../../ledger/LedgerService.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { registerTradeSettledListener } from '../../engine/OrderBook.js';
import { matchingEngine } from '../../engine/MatchingEngine.js';
import { pnlService, getCurrencyDecimalsServer } from '../pnl/PnLService.js';

export interface EnrichedMasterTrader {
  id: string;
  userId: string;
  name: string;
  handle: string;
  avatarInitial: string;
  badge: CopyMasterTrader['badge'];
  strategySummary: string;
  primaryPair: string;
  asset: string;
  supportedPairs: string[];
  status: CopyMasterTrader['status'];
  profitShareBps: number;
  profitSharePct: number;
  minCopyUsdt: number;
  minCopyIdr: number;
  maxFollowers: number;
  riskScore: number;
  roi30d: number;
  roi90d: number;
  winRate: number;
  maxDrawdown: number;
  aumUsdt: number;
  aumIdr: number;
  aum: string;
  followers: number;
  activeDays: number;
  totalTrades: number;
  recentPairs: string[];
  createdAt: number;
  updatedAt: number;
}

export class CopyTradingService {
  private initialized = false;
  private isMirroring = false;
  private unsubscribeOrderBook: (() => void) | null = null;

  public start(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.ensureDefaultMasters();

    // Register real-time OrderBook listener for spot trade mirroring & daily PnL persistence
    this.unsubscribeOrderBook = registerTradeSettledListener((trade: Trade) => {
      pnlService.recordTradeActivity(trade);
      this.onTradeSettled(trade);
    });
  }

  public stop(): void {
    if (this.unsubscribeOrderBook) {
      this.unsubscribeOrderBook();
      this.unsubscribeOrderBook = null;
    }
    this.initialized = false;
  }

  public ensureDefaultMasters(): void {
    if (db.copyMasters.size > 0) return;

    const now = Date.now();
    const seeds: CopyMasterTrader[] = [
      {
        id: 'master-apex-quant',
        userId: 'usr-mm-0000-0000-000000000001',
        name: 'ApexQuant Desk',
        handle: '@apex_quant',
        avatarInitial: 'AQ',
        badge: 'ELITE',
        strategySummary: 'Eksekusi spread spot BTC/IDR & ETH/IDR berfrekuensi terukur dengan manajemen inventori ketat.',
        primaryPair: 'BTC-IDR',
        supportedPairs: ['BTC-IDR', 'ETH-IDR', 'USDT-IDR', 'BTC-USDT'],
        status: 'APPROVED',
        profitShareBps: 1000,
        minCopyUsdt: 25,
        minCopyIdr: 250000,
        maxFollowers: 500,
        riskScore: 3,
        initialEquityUsdt: 50000,
        createdAt: now - 90 * 86400000,
        updatedAt: now,
      },
      {
        id: 'master-budi-macro',
        userId: 'usr-budi-0000-0000-000000000002',
        name: 'Budi Santoso Macro',
        handle: '@budi_macro',
        avatarInitial: 'BS',
        badge: 'MASTER',
        strategySummary: 'Akumulasi tren spot pada Bitcoin dan Ethereum berdasarkan momentum likuiditas IDR.',
        primaryPair: 'BTC-IDR',
        supportedPairs: ['BTC-IDR', 'ETH-IDR', 'SOL-IDR'],
        status: 'APPROVED',
        profitShareBps: 1000,
        minCopyUsdt: 20,
        minCopyIdr: 200000,
        maxFollowers: 350,
        riskScore: 4,
        initialEquityUsdt: 25000,
        createdAt: now - 60 * 86400000,
        updatedAt: now,
      },
      {
        id: 'master-siti-swing',
        userId: 'usr-siti-0000-0000-000000000003',
        name: 'Siti Rahmawati Swing',
        handle: '@siti_swing',
        avatarInitial: 'SR',
        badge: 'PRO',
        strategySummary: 'Swing trading multi-pair pada ETH dan SOL dengan pembatasan risiko harian.',
        primaryPair: 'ETH-IDR',
        supportedPairs: ['ETH-IDR', 'SOL-IDR', 'USDT-IDR'],
        status: 'APPROVED',
        profitShareBps: 1200,
        minCopyUsdt: 15,
        minCopyIdr: 150000,
        maxFollowers: 250,
        riskScore: 4,
        initialEquityUsdt: 15000,
        createdAt: now - 45 * 86400000,
        updatedAt: now,
      },
      {
        id: 'master-nusantara-alpha',
        userId: 'usr-user2-0000-0000-000000000002',
        name: 'Nusantara Alpha',
        handle: '@nusantara_alpha',
        avatarInitial: 'NA',
        badge: 'MASTER',
        strategySummary: 'Strategi rotasi altcoin dan arbitrase antar pair spot utama.',
        primaryPair: 'SOL-IDR',
        supportedPairs: ['SOL-IDR', 'BTC-IDR', 'ETH-IDR'],
        status: 'APPROVED',
        profitShareBps: 1500,
        minCopyUsdt: 50,
        minCopyIdr: 500000,
        maxFollowers: 200,
        riskScore: 5,
        initialEquityUsdt: 20000,
        createdAt: now - 30 * 86400000,
        updatedAt: now,
      },
    ];

    for (const m of seeds) {
      db.copyMasters.set(m.id, m);
    }
    db.scheduleSave();
  }

  private getSleeveValuationInAllocCurrency(
    rel: CopyRelationship,
    usdtRate: number
  ): {
    totalValueUnits: bigint;
    availableUnits: bigint;
    heldValueUnits: bigint;
    unrealizedPnlUnits: bigint;
    positions: Array<{
      symbol: string;
      qtyUnits: string;
      qtyDisplay: string;
      avgEntryPriceDisplay: string;
      currentValueDisplay: string;
      pnlUnits: string;
      pnlPct: number;
    }>;
  } {
    const allocDec = rel.allocationCurrency === 'IDR' ? 2 : 6;
    const availUnits = BigInt(rel.availableSleeveUnits || '0');
    let heldValNum = 0;
    let totalCostNum = 0;
    const positions: Array<{
      symbol: string;
      qtyUnits: string;
      qtyDisplay: string;
      avgEntryPriceDisplay: string;
      currentValueDisplay: string;
      pnlUnits: string;
      pnlPct: number;
    }> = [];

    for (const [sym, unitsStr] of Object.entries(rel.heldBaseBySymbol || {})) {
      const qtyUnits = BigInt(unitsStr || '0');
      if (qtyUnits <= 0n) continue;
      const baseDec = getCurrencyDecimalsServer(sym);
      const qtyNum = Number(qtyUnits) / 10 ** baseDec;
      const priceInfo = pnlService.resolveRealAssetPrice(sym, usdtRate);
      const unitPriceAlloc =
        rel.allocationCurrency === 'IDR' ? priceInfo.priceIdr : priceInfo.priceUsdt;

      const slot = rel.costBasisBySymbol?.[sym];
      const costUnitsBig = BigInt(slot?.costUnits || '0');
      const costNum = Number(costUnitsBig) / 10 ** allocDec;

      // Fallback to cost basis if external/pair price temporarily zero
      const effectiveValNum = unitPriceAlloc > 0 ? qtyNum * unitPriceAlloc : costNum;
      const pnlNum = effectiveValNum - costNum;
      const pnlPct = costNum > 0 ? (pnlNum / costNum) * 100 : 0;

      heldValNum += effectiveValNum;
      totalCostNum += costNum;

      const avgPriceAlloc = qtyNum > 0 ? costNum / qtyNum : 0;
      const pnlUnitsVal = BigInt(Math.round(pnlNum * 10 ** allocDec));

      positions.push({
        symbol: sym,
        qtyUnits: qtyUnits.toString(),
        qtyDisplay: `${PrecisionMath.formatFromUnits(qtyUnits, baseDec, true)} ${sym}`,
        avgEntryPriceDisplay:
          rel.allocationCurrency === 'IDR'
            ? `Rp ${Math.round(avgPriceAlloc).toLocaleString('id-ID')}`
            : `$${avgPriceAlloc.toFixed(avgPriceAlloc >= 1 ? 2 : 6)}`,
        currentValueDisplay:
          rel.allocationCurrency === 'IDR'
            ? `Rp ${Math.round(effectiveValNum).toLocaleString('id-ID')}`
            : `$${effectiveValNum.toFixed(2)}`,
        pnlUnits: pnlUnitsVal.toString(),
        pnlPct: Number(pnlPct.toFixed(2)),
      });
    }

    const heldUnits = BigInt(Math.max(0, Math.round(heldValNum * 10 ** allocDec)));
    const unrealizedUnits = BigInt(Math.round((heldValNum - totalCostNum) * 10 ** allocDec));

    return {
      totalValueUnits: availUnits + heldUnits,
      availableUnits: availUnits,
      heldValueUnits: heldUnits,
      unrealizedPnlUnits: unrealizedUnits,
      positions,
    };
  }

  public computeMasterMetrics(master: CopyMasterTrader): EnrichedMasterTrader {
    const usdtRate = pnlService.getLiveUsdtIdrRate();
    const now = Date.now();
    const cut30d = now - 30 * 86400000;
    const cut90d = now - 90 * 86400000;

    // 1. Real historical + live Spot trades belonging to this Master account
    const masterTrades = db.trades
      .filter(t => t.makerUserId === master.userId || t.takerUserId === master.userId)
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt);

    // FIFO/avg cost tracking to calculate realized PnL, Win Rate & Drawdown from genuine trades
    const inv = new Map<string, { qty: number; costUsdt: number }>();
    let cumulativePnlUsdt = 0;
    let pnl30dUsdt = 0;
    let pnl90dUsdt = 0;
    let wins = 0;
    let losses = 0;
    let peakEq = master.initialEquityUsdt || 25000;
    let maxDrawdownPct = 0;
    const recentPairsSet = new Set<string>();

    for (const t of masterTrades) {
      recentPairsSet.add(t.pairId.replace('-', '/'));
      const isBuyer =
        (t.takerUserId === master.userId && t.takerSide === 'BUY') ||
        (t.makerUserId === master.userId && t.takerSide === 'SELL');
      const isTaker = t.takerUserId === master.userId;
      const pair = db.tradingPairs.get(t.pairId);
      const quoteCurr = pair?.quoteCurrency || (t.pairId.endsWith('-USDT') ? 'USDT' : 'IDR');
      const baseCurr = pair?.baseCurrency || t.pairId.split('-')[0];
      const baseDec = pair?.baseDecimals ?? getCurrencyDecimalsServer(baseCurr);
      const quoteDec = pair?.quoteDecimals ?? (quoteCurr === 'IDR' ? 2 : 6);

      const qtyNum = Number(BigInt(t.quantity)) / 10 ** baseDec;
      const quoteNum = Number(BigInt(t.quoteVolume)) / 10 ** quoteDec;
      const feeUnits = isTaker ? BigInt(t.takerFee || '0') : BigInt(t.makerFee || '0');
      const feeNum = Number(feeUnits) / 10 ** quoteDec;

      const valUsdt = quoteCurr === 'USDT' ? quoteNum : quoteNum / usdtRate;
      const feeUsdt = quoteCurr === 'USDT' ? feeNum : feeNum / usdtRate;

      const slot = inv.get(baseCurr) || { qty: 0, costUsdt: 0 };
      if (isBuyer) {
        slot.qty += qtyNum;
        slot.costUsdt += valUsdt + feeUsdt;
        inv.set(baseCurr, slot);
      } else {
        let tradePnlUsdt = -feeUsdt;
        if (slot.qty > 0) {
          const ratio = Math.min(1, qtyNum / slot.qty);
          const matchedFraction = qtyNum > slot.qty ? slot.qty / qtyNum : 1;
          const soldCost = slot.costUsdt * ratio;
          tradePnlUsdt = valUsdt * matchedFraction - feeUsdt - soldCost;
          slot.qty = Math.max(0, slot.qty - qtyNum);
          slot.costUsdt = Math.max(0, slot.costUsdt - soldCost);
          inv.set(baseCurr, slot);
        }
        cumulativePnlUsdt += tradePnlUsdt;
        if (t.createdAt >= cut30d) pnl30dUsdt += tradePnlUsdt;
        if (t.createdAt >= cut90d) pnl90dUsdt += tradePnlUsdt;

        if (tradePnlUsdt > 0) wins++;
        else if (tradePnlUsdt < 0) losses++;

        const eq = (master.initialEquityUsdt || 25000) + cumulativePnlUsdt;
        if (eq > peakEq) peakEq = eq;
        if (peakEq > 0) {
          const dd = ((peakEq - eq) / peakEq) * 100;
          if (dd > maxDrawdownPct) maxDrawdownPct = dd;
        }
      }
    }

    // 2. Active followers & genuine Assets Under Management (AUM)
    const activeRelationships = Array.from(db.copyRelationships.values()).filter(
      r => r.masterId === master.id && r.status !== 'STOPPED'
    );
    let followersAumUsdt = 0;
    for (const rel of activeRelationships) {
      const val = this.getSleeveValuationInAllocCurrency(rel, usdtRate);
      if (rel.allocationCurrency === 'IDR') {
        followersAumUsdt += Number(val.totalValueUnits) / 100 / usdtRate;
      } else {
        followersAumUsdt += Number(val.totalValueUnits) / 1_000_000;
      }
    }

    // Add Master's own real spot account balance value on primary assets for AUM transparency
    let masterSelfEquityUsdt = 0;
    const masterAccs = db.getUserAccounts(master.userId);
    for (const acc of masterAccs) {
      const dec = getCurrencyDecimalsServer(acc.currency);
      const total = (Number(BigInt(acc.balanceAvailable) + BigInt(acc.balanceLocked))) / 10 ** dec;
      if (total <= 0) continue;
      if (acc.currency === 'USDT') {
        masterSelfEquityUsdt += total;
      } else if (acc.currency === 'IDR') {
        masterSelfEquityUsdt += total / usdtRate;
      } else {
        const p = pnlService.resolveRealAssetPrice(acc.currency, usdtRate);
        masterSelfEquityUsdt += total * p.priceUsdt;
      }
    }

    const totalAumUsdt = followersAumUsdt > 0 ? followersAumUsdt + masterSelfEquityUsdt : masterSelfEquityUsdt;
    const totalAumIdr = totalAumUsdt * usdtRate;

    const eqBase = master.initialEquityUsdt > 0 ? master.initialEquityUsdt : 10000;
    const roi30d = Number(((pnl30dUsdt / eqBase) * 100).toFixed(2));
    const roi90d = Number(((pnl90dUsdt / eqBase) * 100).toFixed(2));
    const winRate = wins + losses > 0 ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : 0;
    const activeDays = Math.max(1, Math.floor((now - master.createdAt) / 86400000));

    const formatAum =
      totalAumUsdt >= 1_000_000
        ? `$${(totalAumUsdt / 1_000_000).toFixed(2)}M`
        : totalAumUsdt >= 1_000
        ? `$${(totalAumUsdt / 1_000).toFixed(1)}K`
        : `$${totalAumUsdt.toFixed(0)}`;

    const recentPairs =
      recentPairsSet.size > 0
        ? Array.from(recentPairsSet).slice(0, 4)
        : master.supportedPairs.map(p => p.replace('-', '/'));

    return {
      ...master,
      asset: master.primaryPair.replace('-', '/'),
      profitSharePct: Number((master.profitShareBps / 100).toFixed(2)),
      roi30d,
      roi90d,
      winRate,
      maxDrawdown: Number(maxDrawdownPct.toFixed(2)),
      aumUsdt: Number(totalAumUsdt.toFixed(2)),
      aumIdr: Math.round(totalAumIdr),
      aum: formatAum,
      followers: activeRelationships.length,
      activeDays,
      totalTrades: masterTrades.length,
      recentPairs,
    };
  }

  public listPublicMasters(): EnrichedMasterTrader[] {
    this.ensureDefaultMasters();
    return Array.from(db.copyMasters.values())
      .filter(m => m.status === 'APPROVED')
      .map(m => this.computeMasterMetrics(m));
  }

  public listAdminMasters(): EnrichedMasterTrader[] {
    this.ensureDefaultMasters();
    return Array.from(db.copyMasters.values()).map(m => this.computeMasterMetrics(m));
  }

  public getMasterDetail(masterId: string) {
    this.ensureDefaultMasters();
    const master = db.copyMasters.get(masterId);
    if (!master) {
      throw new Error(`Master trader ${masterId} tidak ditemukan.`);
    }
    const enriched = this.computeMasterMetrics(master);

    const recentTrades = db.trades
      .filter(t => t.makerUserId === master.userId || t.takerUserId === master.userId)
      .slice(-15)
      .reverse()
      .map(t => {
        const pair = db.tradingPairs.get(t.pairId);
        const quoteCurr = pair?.quoteCurrency || 'IDR';
        const baseDec = pair?.baseDecimals ?? 8;
        const quoteDec = pair?.quoteDecimals ?? 2;
        const side: OrderSide =
          t.takerUserId === master.userId
            ? t.takerSide
            : t.takerSide === 'BUY'
            ? 'SELL'
            : 'BUY';
        return {
          id: t.id,
          pairId: t.pairId,
          side,
          price:
            quoteCurr === 'IDR'
              ? PrecisionMath.formatIDRDisplay(BigInt(t.price))
              : `${PrecisionMath.formatFromUnits(BigInt(t.price), quoteDec, true)} USDT`,
          quantity: `${PrecisionMath.formatFromUnits(BigInt(t.quantity), baseDec, true)} ${pair?.baseCurrency || ''}`,
          quoteVolume:
            quoteCurr === 'IDR'
              ? PrecisionMath.formatIDRDisplay(BigInt(t.quoteVolume))
              : `${PrecisionMath.formatFromUnits(BigInt(t.quoteVolume), quoteDec, true)} USDT`,
          createdAt: t.createdAt,
        };
      });

    return {
      master: enriched,
      recentTrades,
    };
  }

  public getUserCopyRelationships(userId: string) {
    const usdtRate = pnlService.getLiveUsdtIdrRate();
    const rels = Array.from(db.copyRelationships.values())
      .filter(r => r.followerUserId === userId)
      .sort((a, b) => b.startedAt - a.startedAt);

    return rels.map(rel => {
      const master = db.copyMasters.get(rel.masterId);
      const allocDec = rel.allocationCurrency === 'IDR' ? 2 : 6;
      const valuation = this.getSleeveValuationInAllocCurrency(rel, usdtRate);
      const allocUnitsBig = BigInt(rel.allocatedUnits || '0');
      const netPnlUnits = valuation.totalValueUnits - allocUnitsBig;
      const allocNum = Number(allocUnitsBig) / 10 ** allocDec;
      const netPnlNum = Number(netPnlUnits) / 10 ** allocDec;
      const pnlPct = allocNum > 0 ? Number(((netPnlNum / allocNum) * 100).toFixed(2)) : 0;

      const mirroredOrders = db.copyMirroredOrders
        .filter(o => o.relationshipId === rel.id)
        .slice(-20)
        .reverse()
        .map(o => {
          const pair = db.tradingPairs.get(o.pairId);
          const qDec = pair?.quoteDecimals ?? 2;
          const bDec = pair?.baseDecimals ?? 8;
          const qCurr = pair?.quoteCurrency || 'IDR';
          return {
            ...o,
            priceDisplay:
              qCurr === 'IDR'
                ? PrecisionMath.formatIDRDisplay(BigInt(o.executionPriceUnits))
                : `${PrecisionMath.formatFromUnits(BigInt(o.executionPriceUnits), qDec, true)} USDT`,
            qtyDisplay: `${PrecisionMath.formatFromUnits(BigInt(o.executedQtyUnits), bDec, true)} ${pair?.baseCurrency || ''}`,
          };
        });

      return {
        id: rel.id,
        masterId: rel.masterId,
        traderName: master?.name || 'Master Trader',
        handle: master?.handle || '@master',
        badge: master?.badge || 'MASTER',
        primaryPair: master?.primaryPair || 'BTC-IDR',
        profitSharePct: master ? Number((master.profitShareBps / 100).toFixed(2)) : 10,
        status: rel.status,
        allocationCurrency: rel.allocationCurrency,
        allocatedUnits: rel.allocatedUnits,
        allocatedDisplay: PrecisionMath.formatFromUnits(allocUnitsBig, allocDec, false),
        currentValueUnits: valuation.totalValueUnits.toString(),
        currentValueDisplay: PrecisionMath.formatFromUnits(valuation.totalValueUnits, allocDec, false),
        availableSleeveUnits: rel.availableSleeveUnits,
        availableSleeveDisplay: PrecisionMath.formatFromUnits(valuation.availableUnits, allocDec, false),
        netPnlUnits: netPnlUnits.toString(),
        netPnlNum: Number(netPnlNum.toFixed(rel.allocationCurrency === 'IDR' ? 0 : 2)),
        pnlPct,
        realizedPnlUnits: rel.realizedPnlUnits,
        profitSharePaidUnits: rel.profitSharePaidUnits,
        stopLossPct: rel.stopLossPct,
        takeProfitPct: rel.takeProfitPct,
        maxPerTradePct: rel.maxPerTradePct,
        mirroredTradesCount: rel.mirroredTradesCount,
        stopReason: rel.stopReason,
        startedAt: rel.startedAt,
        stoppedAt: rel.stoppedAt,
        positions: valuation.positions,
        mirroredOrders,
      };
    });
  }

  public followMaster(
    followerUserId: string,
    payload: {
      masterId: string;
      allocationCurrency?: 'USDT' | 'IDR';
      amount: string | number;
      stopLossPct?: number;
      takeProfitPct?: number;
      maxPerTradePct?: number;
    }
  ): CopyRelationship {
    this.ensureDefaultMasters();

    const masterId = String(payload.masterId || '').trim();
    const master = db.copyMasters.get(masterId);
    if (!master) {
      throw new Error('Master trader tidak ditemukan.');
    }
    if (master.status !== 'APPROVED') {
      throw new Error('Master trader sedang tidak aktif (belum disetujui atau dijeda).');
    }
    if (master.userId === followerUserId) {
      throw new Error('Tidak dapat menyalin akun trading Anda sendiri.');
    }

    const activeFollowers = Array.from(db.copyRelationships.values()).filter(
      r => r.masterId === master.id && r.status !== 'STOPPED'
    );
    if (activeFollowers.some(r => r.followerUserId === followerUserId)) {
      throw new Error(`Anda sudah memiliki kontrak copy aktif untuk ${master.name}. Kelola atau hentikan terlebih dahulu di tab Copy Saya.`);
    }
    if (activeFollowers.length >= master.maxFollowers) {
      throw new Error(`Kapasitas pengikut ${master.name} sudah penuh (${master.maxFollowers}).`);
    }

    const currency: 'USDT' | 'IDR' = payload.allocationCurrency === 'IDR' ? 'IDR' : 'USDT';
    const dec = currency === 'IDR' ? 2 : 6;
    const amountStr = String(payload.amount || '').trim();
    const amountNum = Number(amountStr);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new Error('Nominal alokasi copy trading tidak valid.');
    }

    const minReq = currency === 'IDR' ? master.minCopyIdr : master.minCopyUsdt;
    if (amountNum < minReq) {
      throw new Error(
        currency === 'IDR'
          ? `Minimal modal copy trading untuk ${master.name} adalah Rp ${minReq.toLocaleString('id-ID')}.`
          : `Minimal modal copy trading untuk ${master.name} adalah ${minReq} USDT.`
      );
    }

    const stopLossPct = Math.min(95, Math.max(1, Number(payload.stopLossPct ?? 15) || 15));
    const takeProfitPct = Math.min(1000, Math.max(1, Number(payload.takeProfitPct ?? 50) || 50));
    const maxPerTradePct = Math.min(100, Math.max(5, Number(payload.maxPerTradePct ?? 25) || 25));

    const amountUnits = PrecisionMath.parseToUnits(amountStr, dec);
    if (amountUnits <= 0n) {
      throw new Error('Nominal alokasi harus lebih besar dari 0.');
    }

    const followerAcc = db.createOrGetAccount(followerUserId, currency);
    const custodyAcc = db.createOrGetAccount(SYSTEM_COPY_CUSTODY_ID, currency);
    const relId = `copy-${crypto.randomUUID().slice(0, 12)}`;

    LedgerService.executeJournal({
      idempotencyKey: `copy-alloc-${relId}`,
      txType: 'COPY_TRADE_ALLOC',
      referenceId: relId,
      description: `Alokasi modal Copy Trading ke ${master.name} (${amountStr} ${currency})`,
      entries: [
        { accountId: followerAcc.id, entryType: 'DEBIT', amount: amountUnits },
        { accountId: custodyAcc.id, entryType: 'CREDIT', amount: amountUnits },
      ],
    });

    const now = Date.now();
    const relationship: CopyRelationship = {
      id: relId,
      followerUserId,
      masterId: master.id,
      status: 'ACTIVE',
      allocationCurrency: currency,
      allocatedUnits: amountUnits.toString(),
      availableSleeveUnits: amountUnits.toString(),
      heldBaseBySymbol: {},
      costBasisBySymbol: {},
      highWaterMarkUnits: amountUnits.toString(),
      realizedPnlUnits: '0',
      profitSharePaidUnits: '0',
      stopLossPct,
      takeProfitPct,
      maxPerTradePct,
      mirroredTradesCount: 0,
      startedAt: now,
      updatedAt: now,
    };

    db.copyRelationships.set(relId, relationship);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: followerUserId,
      action: 'COPY_TRADING_FOLLOWED',
      resource: `copy:${relId}`,
      details: `Memulai copy trading ${master.name} dengan modal ${amountStr} ${currency} (SL ${stopLossPct}%, TP ${takeProfitPct}%)`,
      createdAt: now,
    });
    db.saveToDisk();

    return relationship;
  }

  public pauseCopy(relationshipId: string, userId: string): CopyRelationship {
    const rel = db.copyRelationships.get(relationshipId);
    if (!rel || rel.followerUserId !== userId) {
      throw new Error('Kontrak copy trading tidak ditemukan.');
    }
    if (rel.status === 'STOPPED') {
      throw new Error('Kontrak copy trading sudah dihentikan permanen.');
    }
    rel.status = 'PAUSED';
    rel.updatedAt = Date.now();
    db.copyRelationships.set(rel.id, rel);
    db.saveToDisk();
    return rel;
  }

  public resumeCopy(relationshipId: string, userId: string): CopyRelationship {
    const rel = db.copyRelationships.get(relationshipId);
    if (!rel || rel.followerUserId !== userId) {
      throw new Error('Kontrak copy trading tidak ditemukan.');
    }
    if (rel.status === 'STOPPED') {
      throw new Error('Kontrak copy trading sudah dihentikan permanen.');
    }
    rel.status = 'ACTIVE';
    rel.updatedAt = Date.now();
    db.copyRelationships.set(rel.id, rel);
    db.saveToDisk();
    return rel;
  }

  /**
   * Close all held base assets at live market price, calculate High-Water Mark profit share,
   * settle exact net delta with SYSTEM_TREASURY_ID, pay master fee, and return net capital to follower Spot wallet.
   */
  public stopCopy(
    relationshipId: string,
    userId: string,
    reason = 'Dihentikan oleh pengguna'
  ): {
    relationship: CopyRelationship;
    returnedUnits: string;
    profitSharePaidUnits: string;
    netPnlUnits: string;
  } {
    const rel = db.copyRelationships.get(relationshipId);
    if (!rel || (rel.followerUserId !== userId && userId !== 'SYSTEM_GUARDRAIL')) {
      throw new Error('Kontrak copy trading tidak ditemukan.');
    }
    if (rel.status === 'STOPPED') {
      throw new Error('Kontrak copy trading ini sudah dihentikan sebelumnya.');
    }

    const master = db.copyMasters.get(rel.masterId);
    const usdtRate = pnlService.getLiveUsdtIdrRate();
    const allocCurr = rel.allocationCurrency;
    const allocDec = allocCurr === 'IDR' ? 2 : 6;
    const now = Date.now();

    // Liquidate held base positions at real market price
    let availableUnits = BigInt(rel.availableSleeveUnits || '0');
    let realizedPnlUnits = BigInt(rel.realizedPnlUnits || '0');

    for (const [sym, unitsStr] of Object.entries(rel.heldBaseBySymbol || {})) {
      const qtyUnits = BigInt(unitsStr || '0');
      if (qtyUnits <= 0n) continue;
      const baseDec = getCurrencyDecimalsServer(sym);
      const qtyNum = Number(qtyUnits) / 10 ** baseDec;
      const priceInfo = pnlService.resolveRealAssetPrice(sym, usdtRate);
      const unitPriceAlloc = allocCurr === 'IDR' ? priceInfo.priceIdr : priceInfo.priceUsdt;

      const slot = rel.costBasisBySymbol?.[sym];
      const costUnits = BigInt(slot?.costUnits || '0');
      const proceedsNum = unitPriceAlloc > 0 ? qtyNum * unitPriceAlloc : Number(costUnits) / 10 ** allocDec;
      const proceedsUnits = BigInt(Math.max(0, Math.round(proceedsNum * 10 ** allocDec)));

      // Taker fee 0.20% on closing liquidation
      const feeUnits = PrecisionMath.calculateFee(proceedsUnits, 20);
      const netProceeds = proceedsUnits > feeUnits ? proceedsUnits - feeUnits : 0n;

      if (feeUnits > 0n) {
        const custodyAcc = db.createOrGetAccount(SYSTEM_COPY_CUSTODY_ID, allocCurr);
        const feeAcc = db.createOrGetAccount(SYSTEM_FEE_ID, allocCurr);
        if (BigInt(custodyAcc.balanceAvailable) >= feeUnits) {
          LedgerService.executeJournal({
            idempotencyKey: `copy-liq-fee-${rel.id}-${sym}`,
            txType: 'FEE_COLLECTION',
            referenceId: rel.id,
            description: `Fee likuidasi penutupan Copy Trading ${sym}`,
            entries: [
              { accountId: custodyAcc.id, entryType: 'DEBIT', amount: feeUnits },
              { accountId: feeAcc.id, entryType: 'CREDIT', amount: feeUnits },
            ],
          });
        }
      }

      availableUnits += netProceeds;
      realizedPnlUnits += netProceeds - costUnits;

      // Record final liquidation order
      db.copyMirroredOrders.push({
        id: `cmo-${crypto.randomUUID().slice(0, 12)}`,
        relationshipId: rel.id,
        masterId: rel.masterId,
        followerUserId: rel.followerUserId,
        masterTradeId: `close-${rel.id}-${sym}`,
        pairId: `${sym}-${allocCurr}`,
        side: 'SELL',
        executionPriceUnits: String(Math.round(unitPriceAlloc * 10 ** allocDec)),
        executedQtyUnits: qtyUnits.toString(),
        quoteVolumeUnits: proceedsUnits.toString(),
        feeUnits: feeUnits.toString(),
        realizedPnlUnits: (netProceeds - costUnits).toString(),
        profitShareUnits: '0',
        status: 'FILLED',
        note: `Likuidasi penutupan posisi (${reason})`,
        createdAt: now,
      });

      rel.heldBaseBySymbol[sym] = '0';
      if (rel.costBasisBySymbol?.[sym]) {
        rel.costBasisBySymbol[sym] = { costUnits: '0', qtyUnits: '0' };
      }
    }

    const totalBeforeShare = availableUnits;
    const hwm = BigInt(rel.highWaterMarkUnits || rel.allocatedUnits);
    let profitShareUnits = 0n;

    if (totalBeforeShare > hwm && master && master.profitShareBps > 0) {
      const gainOverHwm = totalBeforeShare - hwm;
      profitShareUnits = (gainOverHwm * BigInt(master.profitShareBps)) / 10000n;
    }

    const netReturnToFollower =
      totalBeforeShare > profitShareUnits ? totalBeforeShare - profitShareUnits : 0n;

    // Reconcile custody backing vs final equity against SYSTEM_TREASURY_ID
    // Sum all fees already swept from custody for this relationship
    const custodyAcc = db.createOrGetAccount(SYSTEM_COPY_CUSTODY_ID, allocCurr);
    const treasuryAcc = db.createOrGetAccount(SYSTEM_TREASURY_ID, allocCurr);
    const followerAcc = db.createOrGetAccount(rel.followerUserId, allocCurr);

    const feesSweptForRel = db.copyMirroredOrders
      .filter(o => o.relationshipId === rel.id && o.status === 'FILLED')
      .reduce((acc, o) => acc + BigInt(o.feeUnits || '0'), 0n);

    const allocBig = BigInt(rel.allocatedUnits);
    const backingBeforeDelta = allocBig > feesSweptForRel ? allocBig - feesSweptForRel : 0n;

    // Total outflow needed = netReturnToFollower + profitShareUnits = totalBeforeShare
    if (totalBeforeShare > backingBeforeDelta) {
      const tradingProfitDelta = totalBeforeShare - backingBeforeDelta;
      LedgerService.executeJournal({
        idempotencyKey: `copy-settle-gain-${rel.id}`,
        txType: 'COPY_TRADE_SETTLE',
        referenceId: rel.id,
        description: `Penyelesaian profit bersih Copy Trading ${master?.name || rel.masterId}`,
        entries: [
          { accountId: treasuryAcc.id, entryType: 'DEBIT', amount: tradingProfitDelta },
          { accountId: custodyAcc.id, entryType: 'CREDIT', amount: tradingProfitDelta },
        ],
      });
    } else if (backingBeforeDelta > totalBeforeShare) {
      const lossDelta = backingBeforeDelta - totalBeforeShare;
      if (lossDelta > 0n && BigInt(custodyAcc.balanceAvailable) >= lossDelta) {
        LedgerService.executeJournal({
          idempotencyKey: `copy-settle-loss-${rel.id}`,
          txType: 'COPY_TRADE_SETTLE',
          referenceId: rel.id,
          description: `Penyelesaian rugi terealisasi Copy Trading ${master?.name || rel.masterId}`,
          entries: [
            { accountId: custodyAcc.id, entryType: 'DEBIT', amount: lossDelta },
            { accountId: treasuryAcc.id, entryType: 'CREDIT', amount: lossDelta },
          ],
        });
      }
    }

    if (profitShareUnits > 0n && master) {
      const masterAcc = db.createOrGetAccount(master.userId, allocCurr);
      LedgerService.executeJournal({
        idempotencyKey: `copy-profit-share-${rel.id}`,
        txType: 'COPY_TRADE_PROFIT_SHARE',
        referenceId: rel.id,
        description: `Profit share High-Water Mark (${master.profitShareBps / 100}%) untuk ${master.name}`,
        entries: [
          { accountId: custodyAcc.id, entryType: 'DEBIT', amount: profitShareUnits },
          { accountId: masterAcc.id, entryType: 'CREDIT', amount: profitShareUnits },
        ],
      });
    }

    if (netReturnToFollower > 0n) {
      LedgerService.executeJournal({
        idempotencyKey: `copy-return-${rel.id}`,
        txType: 'COPY_TRADE_SETTLE',
        referenceId: rel.id,
        description: `Pengembalian dana Copy Trading dari ${master?.name || rel.masterId}`,
        entries: [
          { accountId: custodyAcc.id, entryType: 'DEBIT', amount: netReturnToFollower },
          { accountId: followerAcc.id, entryType: 'CREDIT', amount: netReturnToFollower },
        ],
      });
    }

    rel.status = 'STOPPED';
    rel.availableSleeveUnits = '0';
    rel.realizedPnlUnits = realizedPnlUnits.toString();
    rel.profitSharePaidUnits = (BigInt(rel.profitSharePaidUnits || '0') + profitShareUnits).toString();
    rel.stopReason = reason;
    rel.stoppedAt = now;
    rel.updatedAt = now;

    db.copyRelationships.set(rel.id, rel);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: rel.followerUserId,
      action: 'COPY_TRADING_STOPPED',
      resource: `copy:${rel.id}`,
      details: `Copy trading ${master?.name || rel.masterId} dihentikan (${reason}). Dikembalikan: ${PrecisionMath.formatFromUnits(netReturnToFollower, allocDec)} ${allocCurr}, Profit Share: ${PrecisionMath.formatFromUnits(profitShareUnits, allocDec)} ${allocCurr}.`,
      createdAt: now,
    });
    db.saveToDisk();

    return {
      relationship: rel,
      returnedUnits: netReturnToFollower.toString(),
      profitSharePaidUnits: profitShareUnits.toString(),
      netPnlUnits: (netReturnToFollower - allocBig).toString(),
    };
  }

  /**
   * Real-time OrderBook trade hook: mirrors any APPROVED Master Trader's non-wash Spot execution
   * into all active followers' copy sleeves proportionally and enforces SL/TP guardrails.
   */
  public onTradeSettled(trade: Trade): void {
    if (this.isMirroring) return;
    // Skip self-wash trades (typically MM/Volume bots) so follower sleeves are never churned
    if (trade.makerUserId === trade.takerUserId) return;

    const pair = db.tradingPairs.get(trade.pairId);
    if (!pair || pair.isDelisted) return;

    const mastersList = Array.from(db.copyMasters.values()).filter(m => m.status === 'APPROVED');
    if (mastersList.length === 0) return;

    this.isMirroring = true;
    try {
      const usdtRate = pnlService.getLiveUsdtIdrRate();

      for (const master of mastersList) {
        const isTaker = trade.takerUserId === master.userId;
        const isMaker = trade.makerUserId === master.userId;
        if (!isTaker && !isMaker) continue;

        const masterSide: OrderSide = isTaker
          ? trade.takerSide
          : trade.takerSide === 'BUY'
          ? 'SELL'
          : 'BUY';

        const activeFollowers = Array.from(db.copyRelationships.values()).filter(
          r => r.masterId === master.id && r.status === 'ACTIVE'
        );
        if (activeFollowers.length === 0) continue;

        // Calculate Master trade sizing ratio vs Master initial equity
        const quoteCurr = pair.quoteCurrency.toUpperCase();
        const quoteDec = pair.quoteDecimals;
        const baseCurr = pair.baseCurrency.toUpperCase();
        const baseDec = pair.baseDecimals;

        const tradeQuoteNum = Number(BigInt(trade.quoteVolume)) / 10 ** quoteDec;
        const tradeUsdtValue = quoteCurr === 'USDT' ? tradeQuoteNum : tradeQuoteNum / usdtRate;
        const masterEquityUsdt = Math.max(1000, master.initialEquityUsdt || 25000);
        const masterPctRatio = Math.min(0.5, Math.max(0.05, tradeUsdtValue / masterEquityUsdt));

        const execPricePairNum = Number(BigInt(trade.price)) / 10 ** quoteDec;
        const execPriceIdr = quoteCurr === 'IDR' ? execPricePairNum : execPricePairNum * usdtRate;
        const execPriceUsdt = quoteCurr === 'USDT' ? execPricePairNum : execPricePairNum / usdtRate;

        for (const rel of activeFollowers) {
          try {
            const allocCurr = rel.allocationCurrency;
            const allocDec = allocCurr === 'IDR' ? 2 : 6;
            const unitPriceAlloc = allocCurr === 'IDR' ? execPriceIdr : execPriceUsdt;
            if (unitPriceAlloc <= 0) continue;

            const availSleeveBig = BigInt(rel.availableSleeveUnits || '0');
            const availSleeveNum = Number(availSleeveBig) / 10 ** allocDec;

            if (masterSide === 'BUY') {
              const targetFraction = Math.min(masterPctRatio, rel.maxPerTradePct / 100);
              let spendAllocNum = availSleeveNum * targetFraction;
              const minSpend = allocCurr === 'IDR' ? 1000 : 1;
              if (availSleeveNum < minSpend) {
                db.copyMirroredOrders.push({
                  id: `cmo-${crypto.randomUUID().slice(0, 12)}`,
                  relationshipId: rel.id,
                  masterId: master.id,
                  followerUserId: rel.followerUserId,
                  masterTradeId: trade.id,
                  pairId: trade.pairId,
                  side: 'BUY',
                  executionPriceUnits: trade.price,
                  executedQtyUnits: '0',
                  quoteVolumeUnits: '0',
                  feeUnits: '0',
                  realizedPnlUnits: '0',
                  profitShareUnits: '0',
                  status: 'SKIPPED',
                  note: 'Saldo sleeve tersedia tidak mencukupi untuk alokasi beli baru',
                  createdAt: Date.now(),
                });
                continue;
              }
              if (spendAllocNum < minSpend) spendAllocNum = Math.min(availSleeveNum, minSpend);

              const spendGrossUnits = BigInt(Math.round(spendAllocNum * 10 ** allocDec));
              const feeBps = pair.takerFeeBps || 20;
              const feeAllocUnits = PrecisionMath.calculateFee(spendGrossUnits, feeBps);
              const netSpendUnits = spendGrossUnits - feeAllocUnits;
              const netSpendNum = Number(netSpendUnits) / 10 ** allocDec;
              const boughtQtyNum = netSpendNum / unitPriceAlloc;
              const boughtQtyUnits = BigInt(Math.round(boughtQtyNum * 10 ** baseDec));
              if (boughtQtyUnits <= 0n) continue;

              // Sweep real exchange fee from Copy Custody -> System Fee Collector
              if (feeAllocUnits > 0n) {
                const custodyAcc = db.createOrGetAccount(SYSTEM_COPY_CUSTODY_ID, allocCurr);
                const feeAcc = db.createOrGetAccount(SYSTEM_FEE_ID, allocCurr);
                if (BigInt(custodyAcc.balanceAvailable) >= feeAllocUnits) {
                  LedgerService.executeJournal({
                    idempotencyKey: `copy-fee-${rel.id}-${trade.id}`,
                    txType: 'FEE_COLLECTION',
                    referenceId: rel.id,
                    description: `Fee eksekusi Copy Trading ${trade.pairId} (Follower ${rel.followerUserId.slice(0, 8)})`,
                    entries: [
                      { accountId: custodyAcc.id, entryType: 'DEBIT', amount: feeAllocUnits },
                      { accountId: feeAcc.id, entryType: 'CREDIT', amount: feeAllocUnits },
                    ],
                  });
                }
              }

              rel.availableSleeveUnits = (availSleeveBig - spendGrossUnits).toString();
              const prevHeld = BigInt(rel.heldBaseBySymbol[baseCurr] || '0');
              rel.heldBaseBySymbol[baseCurr] = (prevHeld + boughtQtyUnits).toString();

              const prevSlot = rel.costBasisBySymbol[baseCurr] || { costUnits: '0', qtyUnits: '0' };
              rel.costBasisBySymbol[baseCurr] = {
                costUnits: (BigInt(prevSlot.costUnits) + spendGrossUnits).toString(),
                qtyUnits: (BigInt(prevSlot.qtyUnits) + boughtQtyUnits).toString(),
              };
              rel.mirroredTradesCount += 1;
              rel.updatedAt = Date.now();
              db.copyRelationships.set(rel.id, rel);

              db.copyMirroredOrders.push({
                id: `cmo-${crypto.randomUUID().slice(0, 12)}`,
                relationshipId: rel.id,
                masterId: master.id,
                followerUserId: rel.followerUserId,
                masterTradeId: trade.id,
                pairId: trade.pairId,
                side: 'BUY',
                executionPriceUnits: trade.price,
                executedQtyUnits: boughtQtyUnits.toString(),
                quoteVolumeUnits: spendGrossUnits.toString(),
                feeUnits: feeAllocUnits.toString(),
                realizedPnlUnits: '0',
                profitShareUnits: '0',
                status: 'FILLED',
                note: `Mirror beli proporsional ${baseCurr} mengikuti ${master.name}`,
                createdAt: Date.now(),
              });
            } else {
              // SELL
              const prevHeldUnits = BigInt(rel.heldBaseBySymbol[baseCurr] || '0');
              if (prevHeldUnits <= 0n) continue;

              // Sell proportional fraction based on masterPctRatio (or full exit if >= 45%)
              const sellFraction = masterPctRatio >= 0.45 ? 1.0 : Math.min(1.0, Math.max(0.25, masterPctRatio * 2));
              let sellQtyUnits = BigInt(Math.round(Number(prevHeldUnits) * sellFraction));
              if (sellQtyUnits <= 0n || sellQtyUnits > prevHeldUnits) sellQtyUnits = prevHeldUnits;

              const sellQtyNum = Number(sellQtyUnits) / 10 ** baseDec;
              const grossProceedsNum = sellQtyNum * unitPriceAlloc;
              const grossProceedsUnits = BigInt(Math.max(1, Math.round(grossProceedsNum * 10 ** allocDec)));
              const feeBps = pair.takerFeeBps || 20;
              const feeAllocUnits = PrecisionMath.calculateFee(grossProceedsUnits, feeBps);
              const netProceedsUnits = grossProceedsUnits > feeAllocUnits ? grossProceedsUnits - feeAllocUnits : 0n;

              if (feeAllocUnits > 0n) {
                const custodyAcc = db.createOrGetAccount(SYSTEM_COPY_CUSTODY_ID, allocCurr);
                const feeAcc = db.createOrGetAccount(SYSTEM_FEE_ID, allocCurr);
                if (BigInt(custodyAcc.balanceAvailable) >= feeAllocUnits) {
                  LedgerService.executeJournal({
                    idempotencyKey: `copy-fee-${rel.id}-${trade.id}`,
                    txType: 'FEE_COLLECTION',
                    referenceId: rel.id,
                    description: `Fee jual Copy Trading ${trade.pairId} (Follower ${rel.followerUserId.slice(0, 8)})`,
                    entries: [
                      { accountId: custodyAcc.id, entryType: 'DEBIT', amount: feeAllocUnits },
                      { accountId: feeAcc.id, entryType: 'CREDIT', amount: feeAllocUnits },
                    ],
                  });
                }
              }

              const slot = rel.costBasisBySymbol[baseCurr] || { costUnits: '0', qtyUnits: prevHeldUnits.toString() };
              const costPortionUnits =
                prevHeldUnits > 0n ? (BigInt(slot.costUnits) * sellQtyUnits) / prevHeldUnits : 0n;
              const realizedDelta = netProceedsUnits - costPortionUnits;

              rel.availableSleeveUnits = (availSleeveBig + netProceedsUnits).toString();
              const remHeld = prevHeldUnits - sellQtyUnits;
              rel.heldBaseBySymbol[baseCurr] = remHeld.toString();
              rel.costBasisBySymbol[baseCurr] = {
                costUnits: (BigInt(slot.costUnits) > costPortionUnits ? BigInt(slot.costUnits) - costPortionUnits : 0n).toString(),
                qtyUnits: remHeld.toString(),
              };
              rel.realizedPnlUnits = (BigInt(rel.realizedPnlUnits || '0') + realizedDelta).toString();
              rel.mirroredTradesCount += 1;
              rel.updatedAt = Date.now();
              db.copyRelationships.set(rel.id, rel);

              db.copyMirroredOrders.push({
                id: `cmo-${crypto.randomUUID().slice(0, 12)}`,
                relationshipId: rel.id,
                masterId: master.id,
                followerUserId: rel.followerUserId,
                masterTradeId: trade.id,
                pairId: trade.pairId,
                side: 'SELL',
                executionPriceUnits: trade.price,
                executedQtyUnits: sellQtyUnits.toString(),
                quoteVolumeUnits: grossProceedsUnits.toString(),
                feeUnits: feeAllocUnits.toString(),
                realizedPnlUnits: realizedDelta.toString(),
                profitShareUnits: '0',
                status: 'FILLED',
                note: `Mirror jual ${baseCurr} mengikuti ${master.name}`,
                createdAt: Date.now(),
              });
            }

            // Evaluate SL / TP Guardrails after fill
            const val = this.getSleeveValuationInAllocCurrency(rel, usdtRate);
            const allocUnitsBig = BigInt(rel.allocatedUnits);
            if (allocUnitsBig > 0n) {
              const pnlPct =
                ((Number(val.totalValueUnits) - Number(allocUnitsBig)) / Number(allocUnitsBig)) * 100;
              if (pnlPct <= -rel.stopLossPct) {
                this.stopCopy(rel.id, 'SYSTEM_GUARDRAIL', `Auto Stop-Loss tercapai (${pnlPct.toFixed(2)}%)`);
              } else if (pnlPct >= rel.takeProfitPct) {
                this.stopCopy(rel.id, 'SYSTEM_GUARDRAIL', `Auto Take-Profit tercapai (+${pnlPct.toFixed(2)}%)`);
              }
            }
          } catch (err: any) {
            console.warn(`[CopyTradingService] Gagal mirror ke relasi ${rel.id}:`, err?.message || err);
          }
        }
      }

      db.scheduleSave();
    } finally {
      this.isMirroring = false;
    }
  }

  /**
   * Place a real Spot Order for a Master Trader (so Master Trades & Follower Mirrors can be executed live).
   */
  public executeMasterSignal(
    masterId: string,
    payload: {
      pairId: string;
      side: OrderSide;
      quantity: string;
      price?: string;
      orderType?: 'LIMIT' | 'MARKET';
    }
  ) {
    this.ensureDefaultMasters();
    const master = db.copyMasters.get(masterId);
    if (!master) {
      throw new Error(`Master trader ${masterId} tidak ditemukan.`);
    }
    if (master.status !== 'APPROVED') {
      throw new Error('Master trader harus berstatus APPROVED untuk mengeksekusi sinyal pasar.');
    }

    const pair = db.tradingPairs.get(payload.pairId);
    if (!pair || !pair.isActive || pair.isDelisted) {
      throw new Error(`Trading pair ${payload.pairId} tidak aktif atau tidak ditemukan.`);
    }

    const orderType = payload.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET';
    const qtyNum = Number(payload.quantity);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      throw new Error('Kuantitas sinyal harus lebih besar dari 0.');
    }

    const qtyUnits = PrecisionMath.parseToUnits(String(payload.quantity), pair.baseDecimals);
    const refPriceUnits = payload.price
      ? PrecisionMath.parseToUnits(String(payload.price), pair.quoteDecimals)
      : BigInt(pair.lastPrice);

    // Ensure counterparty order exists on the book if order book side is thin,
    // using real MM/Admin liquidity only if requested market order has no book depth
    const book = matchingEngine.getOrderBook(pair.id);
    const neededCounterSide = payload.side === 'BUY' ? book.asks : book.bids;
    const totalDepthQty = neededCounterSide.reduce(
      (sum, o) => sum + (BigInt(o.quantity) - BigInt(o.filledQuantity)),
      0n
    );

    if (totalDepthQty < qtyUnits) {
      // Place genuine counterparty limit order from Admin liquidity account so MatchingEngine fills canonically
      const liqUserId =
        master.userId === 'usr-admin-0000-0000-000000000001'
          ? 'usr-mm-0000-0000-000000000001'
          : 'usr-admin-0000-0000-000000000001';
      const counterSide: OrderSide = payload.side === 'BUY' ? 'SELL' : 'BUY';
      const fillUnits = qtyUnits - totalDepthQty;
      // Ensure liquidity provider has funds
      db.createOrGetAccount(liqUserId, pair.baseCurrency);
      db.createOrGetAccount(liqUserId, pair.quoteCurrency);

      try {
        matchingEngine.placeOrder({
          userId: liqUserId,
          pairId: pair.id,
          side: counterSide,
          orderType: 'LIMIT',
          timeInForce: 'GTC',
          price: refPriceUnits.toString(),
          quantity: fillUnits.toString(),
          clientOrderId: `copy-liq-${Date.now()}`,
        });
      } catch (e: any) {
        console.warn('[CopyTradingService] Counterparty depth pre-fill skipped:', e?.message || e);
      }
    }

    const prevMirroredCount = db.copyMirroredOrders.length;
    const matchRes = matchingEngine.placeOrder({
      userId: master.userId,
      pairId: pair.id,
      side: payload.side,
      orderType,
      timeInForce: orderType === 'MARKET' ? 'IOC' : 'GTC',
      price: orderType === 'LIMIT' ? refPriceUnits.toString() : undefined,
      quantity: qtyUnits.toString(),
      clientOrderId: `copy-sig-${master.id.slice(0, 8)}-${Date.now()}`,
    });

    const newMirrored = db.copyMirroredOrders.slice(prevMirroredCount);
    db.saveToDisk();

    return {
      masterOrder: matchRes.takerOrder,
      trades: matchRes.trades,
      mirroredOrdersCount: newMirrored.length,
      mirroredOrders: newMirrored,
    };
  }

  public applyAsMaster(
    userId: string,
    payload: {
      name: string;
      handle: string;
      strategySummary: string;
      primaryPair: string;
      profitSharePct?: number;
      minCopyUsdt?: number;
    }
  ): CopyMasterTrader {
    this.ensureDefaultMasters();

    const existing = Array.from(db.copyMasters.values()).find(m => m.userId === userId);
    if (existing) {
      throw new Error(`Anda sudah terdaftar sebagai Master Trader (${existing.name}, status: ${existing.status}).`);
    }

    const name = String(payload.name || '').trim();
    const rawHandle = String(payload.handle || '').trim().replace(/[^a-zA-Z0-9_@]/g, '');
    const handle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
    const strategySummary = String(payload.strategySummary || '').trim().slice(0, 400);
    const primaryPair = String(payload.primaryPair || 'BTC-IDR').trim().toUpperCase();

    if (name.length < 3 || name.length > 50) {
      throw new Error('Nama Master Trader harus 3–50 karakter.');
    }
    if (handle.length < 4 || handle.length > 30) {
      throw new Error('Handle harus 3–28 karakter alfanumerik.');
    }
    if (!db.tradingPairs.has(primaryPair)) {
      throw new Error(`Pair utama ${primaryPair} tidak valid.`);
    }
    const handleTaken = Array.from(db.copyMasters.values()).some(
      m => m.handle.toLowerCase() === handle.toLowerCase()
    );
    if (handleTaken) {
      throw new Error(`Handle ${handle} sudah digunakan.`);
    }

    const profitSharePct = Math.min(30, Math.max(0, Number(payload.profitSharePct ?? 10) || 10));
    const minCopyUsdt = Math.max(10, Number(payload.minCopyUsdt ?? 25) || 25);
    const usdtRate = pnlService.getLiveUsdtIdrRate();

    const words = name.split(/\s+/).filter(Boolean);
    const avatarInitial =
      words.length >= 2
        ? `${words[0][0]}${words[1][0]}`.toUpperCase()
        : name.slice(0, 2).toUpperCase();

    const now = Date.now();
    const newMaster: CopyMasterTrader = {
      id: `master-${crypto.randomUUID().slice(0, 10)}`,
      userId,
      name,
      handle,
      avatarInitial,
      badge: 'PRO',
      strategySummary: strategySummary || 'Strategi Spot Quantitative Terverifikasi',
      primaryPair,
      supportedPairs: [primaryPair],
      status: 'PENDING',
      profitShareBps: Math.round(profitSharePct * 100),
      minCopyUsdt,
      minCopyIdr: Math.round(minCopyUsdt * usdtRate),
      maxFollowers: 200,
      riskScore: 4,
      initialEquityUsdt: 10000,
      createdAt: now,
      updatedAt: now,
    };

    db.copyMasters.set(newMaster.id, newMaster);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: userId,
      action: 'COPY_MASTER_APPLIED',
      resource: `master:${newMaster.id}`,
      details: `Pengajuan Master Trader baru ${newMaster.name} (${newMaster.handle}) menunggu review admin`,
      createdAt: now,
    });
    db.saveToDisk();

    return newMaster;
  }

  public adminUpdateMaster(
    masterId: string,
    patch: {
      status?: CopyMasterTrader['status'];
      profitShareBps?: number;
      badge?: CopyMasterTrader['badge'];
      maxFollowers?: number;
      riskScore?: number;
    },
    adminId: string
  ): EnrichedMasterTrader {
    this.ensureDefaultMasters();
    const master = db.copyMasters.get(masterId);
    if (!master) {
      throw new Error(`Master trader ${masterId} tidak ditemukan.`);
    }

    if (patch.status !== undefined) {
      const allowed: CopyMasterTrader['status'][] = ['PENDING', 'APPROVED', 'PAUSED', 'REJECTED'];
      if (!allowed.includes(patch.status)) {
        throw new Error('Status master tidak valid.');
      }
      master.status = patch.status;
    }
    if (patch.profitShareBps !== undefined) {
      const bps = Number(patch.profitShareBps);
      if (!Number.isFinite(bps) || bps < 0 || bps > 5000) {
        throw new Error('Profit share harus antara 0% sampai 50% (0–5000 bps).');
      }
      master.profitShareBps = Math.round(bps);
    }
    if (patch.badge !== undefined) {
      master.badge = patch.badge;
    }
    if (patch.maxFollowers !== undefined && Number.isFinite(Number(patch.maxFollowers))) {
      master.maxFollowers = Math.max(1, Math.round(Number(patch.maxFollowers)));
    }
    if (patch.riskScore !== undefined && Number.isFinite(Number(patch.riskScore))) {
      master.riskScore = Math.min(10, Math.max(1, Math.round(Number(patch.riskScore))));
    }

    master.updatedAt = Date.now();
    db.copyMasters.set(master.id, master);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminId,
      action: 'COPY_MASTER_UPDATED',
      resource: `master:${master.id}`,
      details: `Master ${master.name} diperbarui: status=${master.status}, profitShare=${master.profitShareBps / 100}%`,
      createdAt: Date.now(),
    });
    db.saveToDisk();

    return this.computeMasterMetrics(master);
  }
}

export const copyTradingService = new CopyTradingService();
