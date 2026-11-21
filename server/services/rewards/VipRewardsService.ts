/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VipRewardsService.ts
 * Authoritative Institutional VIP Tier Engine, Dynamic Trader Task Center,
 * Redeemable Voucher Engine & Referral Commission System backed by live
 * DIMONEX trades, futures orders, deposits, KYC/2FA status, and
 * Double-Entry Atomic Ledger payouts.
 *
 * ZERO mock metrics, ZERO hardcoded user volumes, ZERO fake payouts.
 */

import crypto from 'crypto';
import { db, SYSTEM_TREASURY_ID } from '../../db/database.js';
import {
  RewardTaskId,
  RewardTaskCategory,
  RewardTaskRuleType,
  RewardTaskActionView,
  RewardTaskConfig,
  RewardVoucherType,
  RewardVoucher,
  VoucherRedemptionRecord,
  RewardClaimRecord,
  ReferralRelation,
  ReferralPayoutRecord,
  User
} from '../../db/types.js';
import { LedgerService } from '../../ledger/LedgerService.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_REFERRAL_CLAIM_USDT = 0.01;
const MAX_SINGLE_REWARD_USDT = 100_000;

export const VALID_TASK_CATEGORIES: readonly RewardTaskCategory[] = [
  'SECURITY',
  'FUNDING',
  'TRADING',
  'COMPLIANCE',
  'VIP'
];

export const VALID_TASK_RULE_TYPES: readonly RewardTaskRuleType[] = [
  'ENABLE_2FA',
  'DEPOSIT_USDT',
  'SPOT_TRADES_COUNT',
  'SPOT_VOLUME_USDT',
  'FUTURES_VOLUME_USDT',
  'COMBINED_VOLUME_30D_USDT',
  'KYC_APPROVED'
];

export const VALID_TASK_ACTION_VIEWS: readonly RewardTaskActionView[] = [
  'SECURITY',
  'DEPOSIT',
  'TRADE',
  'FUTURES',
  'KYC'
];

export const VALID_VOUCHER_TYPES: readonly RewardVoucherType[] = [
  'USDT_BONUS',
  'FEE_REBATE',
  'TRADING_CREDIT'
];

export interface VipTierConfig {
  level: number;
  code: string;
  name: string;
  minVolume30dUsdt: number;
  makerFeeBps: number;
  takerFeeBps: number;
  makerFeePct: string;
  takerFeePct: string;
  referralRebatePct: number;
  dailyWithdrawalLimitBtc: number;
  perks: string[];
}

export const VIP_TIER_SCHEDULE: readonly VipTierConfig[] = [
  {
    level: 0,
    code: 'V0',
    name: 'Regular',
    minVolume30dUsdt: 0,
    makerFeeBps: 10,
    takerFeeBps: 20,
    makerFeePct: '0.100%',
    takerFeePct: '0.200%',
    referralRebatePct: 20,
    dailyWithdrawalLimitBtc: 10,
    perks: ['Standard Spot & Futures API', '20% Referral Fee Rebate', '24/7 Support']
  },
  {
    level: 1,
    code: 'V1',
    name: 'VIP 1',
    minVolume30dUsdt: 50_000,
    makerFeeBps: 6,
    takerFeeBps: 8,
    makerFeePct: '0.060%',
    takerFeePct: '0.080%',
    referralRebatePct: 25,
    dailyWithdrawalLimitBtc: 50,
    perks: ['25% Referral Fee Rebate', '50 BTC Daily Withdrawal', 'Priority Support']
  },
  {
    level: 2,
    code: 'V2',
    name: 'VIP 2',
    minVolume30dUsdt: 250_000,
    makerFeeBps: 4.5,
    takerFeeBps: 6.5,
    makerFeePct: '0.045%',
    takerFeePct: '0.065%',
    referralRebatePct: 30,
    dailyWithdrawalLimitBtc: 100,
    perks: ['30% Referral Fee Rebate', 'Priority Matching Queue', 'Dedicated Account Manager']
  },
  {
    level: 3,
    code: 'V3',
    name: 'VIP 3',
    minVolume30dUsdt: 1_000_000,
    makerFeeBps: 3.5,
    takerFeeBps: 5,
    makerFeePct: '0.035%',
    takerFeePct: '0.050%',
    referralRebatePct: 35,
    dailyWithdrawalLimitBtc: 250,
    perks: ['35% Referral Fee Rebate', 'OTC Block Trading Desk', 'Higher API Rate Limits']
  },
  {
    level: 4,
    code: 'V4',
    name: 'VIP 4',
    minVolume30dUsdt: 5_000_000,
    makerFeeBps: 2.5,
    takerFeeBps: 4,
    makerFeePct: '0.025%',
    takerFeePct: '0.040%',
    referralRebatePct: 40,
    dailyWithdrawalLimitBtc: 500,
    perks: ['40% Referral Fee Rebate', 'Sub-Account Management', 'Market Maker Program Access']
  },
  {
    level: 5,
    code: 'V5',
    name: 'VIP 5',
    minVolume30dUsdt: 20_000_000,
    makerFeeBps: 1.5,
    takerFeeBps: 3,
    makerFeePct: '0.015%',
    takerFeePct: '0.030%',
    referralRebatePct: 40,
    dailyWithdrawalLimitBtc: 1000,
    perks: ['40% Referral Fee Rebate', 'Colocation Gateway Access', 'Zero-Fee Internal Transfers']
  },
  {
    level: 6,
    code: 'V6',
    name: 'Institutional',
    minVolume30dUsdt: 50_000_000,
    makerFeeBps: 1,
    takerFeeBps: 2,
    makerFeePct: '0.010%',
    takerFeePct: '0.020%',
    referralRebatePct: 40,
    dailyWithdrawalLimitBtc: 2500,
    perks: ['Bespoke Liquidity Credit Lines', 'Direct Settlement Desk', 'Custom Institutional SLA']
  }
];

export interface RewardTaskDefinition {
  id: RewardTaskId;
  title: string;
  description: string;
  category: RewardTaskCategory;
  ruleType: RewardTaskRuleType;
  targetValue: number;
  rewardCurrency: 'USDT';
  rewardAmountUsdt: number;
  rewardDisplay: string;
  actionLabel: string;
  actionView: RewardTaskActionView;
}

const DEFAULT_REWARD_TASKS: readonly Omit<
  RewardTaskConfig,
  'createdBy' | 'createdAt' | 'updatedAt'
>[] = [
  {
    id: 'SECURITY_2FA',
    title: 'Enable Authenticator 2FA',
    description: 'Protect your DIMONEX account with RFC-6238 TOTP two-factor authentication.',
    category: 'SECURITY',
    ruleType: 'ENABLE_2FA',
    targetValue: 1,
    rewardCurrency: 'USDT',
    rewardAmountUsdt: 10,
    actionLabel: 'Configure 2FA',
    actionView: 'SECURITY',
    isActive: true,
    sortOrder: 10
  },
  {
    id: 'FIRST_DEPOSIT',
    title: 'Fund Wallet (≥ $100 Equiv.)',
    description: 'Complete at least $100 USDT equivalent in verified IDR or crypto deposits.',
    category: 'FUNDING',
    ruleType: 'DEPOSIT_USDT',
    targetValue: 100,
    rewardCurrency: 'USDT',
    rewardAmountUsdt: 25,
    actionLabel: 'Deposit Funds',
    actionView: 'DEPOSIT',
    isActive: true,
    sortOrder: 20
  },
  {
    id: 'FIRST_SPOT_TRADE',
    title: 'Execute First Spot Trade',
    description: 'Fill at least one Spot order on any active DIMONEX trading pair.',
    category: 'TRADING',
    ruleType: 'SPOT_TRADES_COUNT',
    targetValue: 1,
    rewardCurrency: 'USDT',
    rewardAmountUsdt: 15,
    actionLabel: 'Trade Spot',
    actionView: 'TRADE',
    isActive: true,
    sortOrder: 30
  },
  {
    id: 'FUTURES_VOLUME_2K',
    title: 'Trade $2,000 in Perpetual Futures',
    description: 'Reach $2,000 in cumulative filled perpetual futures notional volume.',
    category: 'TRADING',
    ruleType: 'FUTURES_VOLUME_USDT',
    targetValue: 2000,
    rewardCurrency: 'USDT',
    rewardAmountUsdt: 50,
    actionLabel: 'Open Futures',
    actionView: 'FUTURES',
    isActive: true,
    sortOrder: 40
  },
  {
    id: 'KYC_TIER_2',
    title: 'Complete Verified KYC',
    description: 'Pass identity verification to unlock institutional withdrawal and compliance limits.',
    category: 'COMPLIANCE',
    ruleType: 'KYC_APPROVED',
    targetValue: 1,
    rewardCurrency: 'USDT',
    rewardAmountUsdt: 30,
    actionLabel: 'Verify KYC',
    actionView: 'KYC',
    isActive: true,
    sortOrder: 50
  },
  {
    id: 'SPOT_VOLUME_50K',
    title: 'Reach VIP 1 ($50,000 30D Volume)',
    description: 'Achieve $50,000 in rolling 30-day Spot & Futures volume to unlock VIP 1.',
    category: 'VIP',
    ruleType: 'COMBINED_VOLUME_30D_USDT',
    targetValue: 50_000,
    rewardCurrency: 'USDT',
    rewardAmountUsdt: 100,
    actionLabel: 'Start Trading',
    actionView: 'TRADE',
    isActive: true,
    sortOrder: 60
  }
];

function formatUsdtLabel(amount: number): string {
  return Number.isInteger(amount) ? `${amount} USDT` : `${amount.toFixed(2)} USDT`;
}

function taskConfigToDefinition(cfg: RewardTaskConfig): RewardTaskDefinition {
  return {
    id: cfg.id,
    title: cfg.title,
    description: cfg.description,
    category: cfg.category,
    ruleType: cfg.ruleType,
    targetValue: cfg.targetValue,
    rewardCurrency: 'USDT',
    rewardAmountUsdt: cfg.rewardAmountUsdt,
    rewardDisplay: formatUsdtLabel(cfg.rewardAmountUsdt),
    actionLabel: cfg.actionLabel,
    actionView: cfg.actionView
  };
}

function safeUnitsToNumber(raw: string | undefined, decimals: number): number {
  if (!raw) return 0;
  try {
    const num = Number(BigInt(raw));
    if (!Number.isFinite(num)) return 0;
    return num / 10 ** decimals;
  } catch {
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed / 10 ** decimals : 0;
  }
}

function getCurrencyDecimals(currency: string): number {
  const c = (currency || '').toUpperCase();
  if (c === 'IDR') return 2;
  if (c === 'USDT' || c === 'USDC') return 6;
  const asset = Array.from(db.assets.values()).find(a => a.symbol.toUpperCase() === c);
  return typeof asset?.decimals === 'number' ? asset.decimals : 8;
}

export function getLiveUsdtIdrRate(): number {
  const pair = db.tradingPairs.get('USDT-IDR');
  if (pair?.lastPrice) {
    const rate = safeUnitsToNumber(pair.lastPrice, pair.quoteDecimals ?? 2);
    if (rate > 1000) return rate;
  }
  return 16450;
}

function convertCurrencyToUsdt(amount: number, currency: string, usdtIdrRate: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const c = (currency || '').toUpperCase();
  if (c === 'USDT' || c === 'USDC' || c === 'USD') return amount;
  if (c === 'IDR') return usdtIdrRate > 0 ? amount / usdtIdrRate : 0;

  const usdtPair = db.tradingPairs.get(`${c}-USDT`);
  if (usdtPair?.lastPrice) {
    const px = safeUnitsToNumber(usdtPair.lastPrice, usdtPair.quoteDecimals ?? 6);
    if (px > 0) return amount * px;
  }

  const idrPair = db.tradingPairs.get(`${c}-IDR`);
  if (idrPair?.lastPrice) {
    const pxIdr = safeUnitsToNumber(idrPair.lastPrice, idrPair.quoteDecimals ?? 2);
    if (pxIdr > 0 && usdtIdrRate > 0) return (amount * pxIdr) / usdtIdrRate;
  }

  return 0;
}

function maskEmail(email: string): string {
  const clean = (email || '').trim();
  const atIdx = clean.indexOf('@');
  if (atIdx <= 1) return clean;
  const local = clean.slice(0, atIdx);
  const domain = clean.slice(atIdx);
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}***${local.slice(-1)}${domain}`;
}

export type RewardHistoryRecordType = 'TASK_REWARD' | 'VOUCHER_REDEMPTION' | 'REFERRAL_COMMISSION';

export interface UnifiedRewardHistoryItem {
  id: string;
  userId: string;
  userEmail?: string;
  type: RewardHistoryRecordType;
  title: string;
  code: string | null;
  currency: string;
  amountUsdt: number;
  amountDisplay: string;
  status: 'SETTLED';
  journalId: string;
  claimedAt: number;
}

export interface CreateRewardTaskInput {
  id?: string;
  title: string;
  description: string;
  category: RewardTaskCategory;
  ruleType: RewardTaskRuleType;
  targetValue: number;
  rewardAmountUsdt: number;
  actionLabel?: string;
  actionView: RewardTaskActionView;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateRewardTaskInput {
  title?: string;
  description?: string;
  category?: RewardTaskCategory;
  ruleType?: RewardTaskRuleType;
  targetValue?: number;
  rewardAmountUsdt?: number;
  actionLabel?: string;
  actionView?: RewardTaskActionView;
  isActive?: boolean;
  sortOrder?: number;
}

export interface CreateVoucherInput {
  code: string;
  title: string;
  description?: string;
  voucherType: RewardVoucherType;
  rewardAmountUsdt: number;
  minVipLevel?: number;
  maxRedemptions: number;
  isActive?: boolean;
  expiresAt?: number | null;
}

export interface UpdateVoucherInput {
  code?: string;
  title?: string;
  description?: string;
  voucherType?: RewardVoucherType;
  rewardAmountUsdt?: number;
  minVipLevel?: number;
  maxRedemptions?: number;
  isActive?: boolean;
  expiresAt?: number | null;
}

export class VipRewardsService {
  /**
   * Seeds the 6 baseline institutional tasks into db.rewardTasks only if the store is empty.
   * Once seeded, admins have full persistent CRUD control over all tasks.
   */
  public ensureDefaultRewardTasks(): void {
    if (db.rewardTasks.size > 0) return;
    const now = Date.now();
    for (const def of DEFAULT_REWARD_TASKS) {
      db.rewardTasks.set(def.id, {
        ...def,
        createdBy: 'system',
        createdAt: now,
        updatedAt: now
      });
    }
    db.scheduleSave();
  }

  public getActiveTaskConfigs(): RewardTaskConfig[] {
    this.ensureDefaultRewardTasks();
    return Array.from(db.rewardTasks.values())
      .filter(t => t.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
  }

  /**
   * Ensures every user has a unique, persistent, deterministic-format referral code (`DMX-XXXXXX`).
   */
  public ensureUserReferralCode(userId: string): string {
    const user = db.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }
    if (user.referralCode && /^DMX-[A-Z0-9]{6,10}$/.test(user.referralCode)) {
      return user.referralCode;
    }

    const existingCodes = new Set<string>();
    for (const u of db.users.values()) {
      if (u.referralCode) existingCodes.add(u.referralCode.toUpperCase());
    }

    let attempt = 0;
    let candidate = '';
    do {
      const digest = crypto
        .createHash('sha256')
        .update(`dimonex-ref:${userId}:${attempt}`)
        .digest('hex')
        .slice(0, 6)
        .toUpperCase();
      candidate = `DMX-${digest}`;
      attempt++;
    } while (existingCodes.has(candidate) && attempt < 20);

    user.referralCode = candidate;
    user.updatedAt = Date.now();
    db.scheduleSave();
    return candidate;
  }

  /**
   * Resolves a user by their referral code (case-insensitive).
   */
  public findUserByReferralCode(rawCode: string): User | null {
    const normalized = String(rawCode || '').trim().toUpperCase();
    if (!normalized) return null;

    for (const u of db.users.values()) {
      if (!u.referralCode) {
        this.ensureUserReferralCode(u.id);
      }
      if (u.referralCode && u.referralCode.toUpperCase() === normalized) {
        return u;
      }
    }
    return null;
  }

  /**
   * Binds a referrer to a referee account with strict anti-abuse checks
   * (no self-referral, no duplicate rebinding, no circular A->B->A loops).
   */
  public bindReferralCode(refereeUserId: string, rawCode: string): ReferralRelation {
    const referee = db.users.get(refereeUserId);
    if (!referee) {
      throw new Error('User account not found');
    }

    const cleanCode = String(rawCode || '').trim().toUpperCase();
    if (!/^DMX-[A-Z0-9]{4,12}$/.test(cleanCode)) {
      throw new Error('Invalid referral code format. Expected format: DMX-XXXXXX.');
    }

    if (referee.referredByUserId || db.referralRelations.has(refereeUserId)) {
      throw new Error('A referral code is already bound to this account.');
    }

    const referrer = this.findUserByReferralCode(cleanCode);
    if (!referrer) {
      throw new Error(`Referral code "${cleanCode}" was not found.`);
    }

    if (referrer.id === refereeUserId) {
      throw new Error('You cannot apply your own referral code.');
    }

    if (referrer.status !== 'active') {
      throw new Error('Referrer account is not eligible.');
    }

    let cursorId: string | undefined = referrer.referredByUserId;
    let hops = 0;
    while (cursorId && hops < 10) {
      if (cursorId === refereeUserId) {
        throw new Error('Circular referral relationship is not allowed.');
      }
      cursorId = db.users.get(cursorId)?.referredByUserId;
      hops++;
    }

    const relation: ReferralRelation = {
      id: crypto.randomUUID(),
      referrerUserId: referrer.id,
      refereeUserId,
      referralCodeUsed: cleanCode,
      createdAt: Date.now()
    };

    referee.referredByUserId = referrer.id;
    referee.updatedAt = Date.now();
    db.referralRelations.set(refereeUserId, relation);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: refereeUserId,
      action: 'REFERRAL_CODE_BOUND',
      resource: cleanCode,
      details: `User ${referee.email} bound referral code ${cleanCode} (referrer: ${referrer.email})`,
      createdAt: Date.now()
    });

    db.saveToDisk();
    return relation;
  }

  /**
   * Computes a user's REAL trading volume & fees from db.trades and db.futuresOrders.
   */
  public computeUserTradingActivity(userId: string, usdtIdrRate: number) {
    const cutoff30d = Date.now() - THIRTY_DAYS_MS;

    let spotVolume30dUsdt = 0;
    let spotVolumeAllTimeUsdt = 0;
    let spotFees30dUsdt = 0;
    let spotFeesAllTimeUsdt = 0;
    let spotTradeCount30d = 0;
    let spotTradeCountAllTime = 0;

    for (const trade of db.trades) {
      const isMaker = trade.makerUserId === userId;
      const isTaker = trade.takerUserId === userId;
      if (!isMaker && !isTaker) continue;

      const pair = db.tradingPairs.get(trade.pairId);
      const quoteCurrency = pair?.quoteCurrency || (trade.pairId.endsWith('-USDT') ? 'USDT' : 'IDR');
      const quoteDecimals = pair?.quoteDecimals ?? (quoteCurrency === 'USDT' ? 6 : 2);

      const quoteAmt = safeUnitsToNumber(trade.quoteVolume, quoteDecimals);
      const volUsdt = convertCurrencyToUsdt(quoteAmt, quoteCurrency, usdtIdrRate);

      let feeQuoteAmt = 0;
      if (isMaker) feeQuoteAmt += safeUnitsToNumber(trade.makerFee, quoteDecimals);
      if (isTaker) feeQuoteAmt += safeUnitsToNumber(trade.takerFee, quoteDecimals);
      const feeUsdt = convertCurrencyToUsdt(feeQuoteAmt, quoteCurrency, usdtIdrRate);

      spotVolumeAllTimeUsdt += volUsdt;
      spotFeesAllTimeUsdt += feeUsdt;
      spotTradeCountAllTime += 1;

      if (trade.createdAt >= cutoff30d) {
        spotVolume30dUsdt += volUsdt;
        spotFees30dUsdt += feeUsdt;
        spotTradeCount30d += 1;
      }
    }

    let futuresVolume30dUsdt = 0;
    let futuresVolumeAllTimeUsdt = 0;
    let futuresFees30dUsdt = 0;
    let futuresFeesAllTimeUsdt = 0;
    let futuresOrderCount30d = 0;
    let futuresOrderCountAllTime = 0;

    for (const order of db.futuresOrders.values()) {
      if (order.userId !== userId || order.status !== 'FILLED') continue;

      const qty = safeUnitsToNumber(order.quantityUnits, order.baseDecimals ?? 8);
      const px = safeUnitsToNumber(order.limitPriceUnits, order.quoteDecimals ?? 6);
      const notionalQuote = qty * px;
      const volUsdt = convertCurrencyToUsdt(notionalQuote, order.quoteCurrency || 'USDT', usdtIdrRate);

      const feeQuote = safeUnitsToNumber(order.feeReservedUnits, order.quoteDecimals ?? 6);
      const feeUsdt = convertCurrencyToUsdt(feeQuote, order.quoteCurrency || 'USDT', usdtIdrRate);

      futuresVolumeAllTimeUsdt += volUsdt;
      futuresFeesAllTimeUsdt += feeUsdt;
      futuresOrderCountAllTime += 1;

      const ts = order.filledAt || order.createdAt;
      if (ts >= cutoff30d) {
        futuresVolume30dUsdt += volUsdt;
        futuresFees30dUsdt += feeUsdt;
        futuresOrderCount30d += 1;
      }
    }

    return {
      spotVolume30dUsdt,
      spotVolumeAllTimeUsdt,
      spotFees30dUsdt,
      spotFeesAllTimeUsdt,
      spotTradeCount30d,
      spotTradeCountAllTime,
      futuresVolume30dUsdt,
      futuresVolumeAllTimeUsdt,
      futuresFees30dUsdt,
      futuresFeesAllTimeUsdt,
      futuresOrderCount30d,
      futuresOrderCountAllTime,
      totalVolume30dUsdt: spotVolume30dUsdt + futuresVolume30dUsdt,
      totalVolumeAllTimeUsdt: spotVolumeAllTimeUsdt + futuresVolumeAllTimeUsdt,
      totalFees30dUsdt: spotFees30dUsdt + futuresFees30dUsdt,
      totalFeesAllTimeUsdt: spotFeesAllTimeUsdt + futuresFeesAllTimeUsdt,
      totalTrades30d: spotTradeCount30d + futuresOrderCount30d
    };
  }

  /**
   * Computes a user's REAL total completed deposits (in USDT equivalent).
   */
  public computeUserDepositsUsdt(userId: string, usdtIdrRate: number): number {
    let totalUsdt = 0;

    for (const tx of db.fiatTransactions.values()) {
      if (tx.userId === userId && tx.type === 'DEPOSIT' && (tx.status === 'COMPLETED' || tx.status === 'APPROVED')) {
        const idrAmt = safeUnitsToNumber(tx.amount, 2);
        totalUsdt += convertCurrencyToUsdt(idrAmt, 'IDR', usdtIdrRate);
      }
    }

    for (const tx of db.cryptoTransactions.values()) {
      if (tx.userId === userId && tx.type === 'DEPOSIT' && (tx.status === 'COMPLETED' || tx.status === 'APPROVED')) {
        const dec = getCurrencyDecimals(tx.currency);
        const amt = safeUnitsToNumber(tx.amount, dec);
        totalUsdt += convertCurrencyToUsdt(amt, tx.currency, usdtIdrRate);
      }
    }

    if (totalUsdt === 0) {
      const userAccountIds = new Set(db.getUserAccounts(userId).map(a => a.id));
      for (const journal of db.journalTransactions.values()) {
        if (journal.txType !== 'DEPOSIT') continue;
        const creditEntries = db.ledgerEntries.filter(
          e => e.journalId === journal.id && e.entryType === 'CREDIT' && userAccountIds.has(e.accountId)
        );
        for (const entry of creditEntries) {
          const acc = db.ledgerAccounts.get(entry.accountId);
          if (!acc) continue;
          const dec = getCurrencyDecimals(acc.currency);
          const amt = safeUnitsToNumber(entry.amount, dec);
          totalUsdt += convertCurrencyToUsdt(amt, acc.currency, usdtIdrRate);
        }
      }
    }

    return totalUsdt;
  }

  /**
   * Computes a user's REAL total portfolio equity (USDT & IDR) from live ledger accounts.
   */
  public computeUserPortfolioUsdt(userId: string, usdtIdrRate: number): number {
    const accounts = db.getUserAccounts(userId);
    let totalUsdt = 0;
    for (const acc of accounts) {
      const totalUnits = BigInt(acc.balanceAvailable) + BigInt(acc.balanceLocked);
      if (totalUnits <= 0n) continue;
      const dec = getCurrencyDecimals(acc.currency);
      const amt = safeUnitsToNumber(totalUnits.toString(), dec);
      totalUsdt += convertCurrencyToUsdt(amt, acc.currency, usdtIdrRate);
    }
    return totalUsdt;
  }

  /**
   * Resolves the authoritative VIP tier for a given 30-day rolling USDT volume.
   */
  public resolveVipTier(volume30dUsdt: number): {
    currentTier: VipTierConfig;
    nextTier: VipTierConfig | null;
    progressPct: number;
    remainingVolumeUsdt: number;
  } {
    let currentTier = VIP_TIER_SCHEDULE[0];
    for (const tier of VIP_TIER_SCHEDULE) {
      if (volume30dUsdt >= tier.minVolume30dUsdt) {
        currentTier = tier;
      }
    }

    const nextTier =
      VIP_TIER_SCHEDULE.find(t => t.level === currentTier.level + 1) || null;

    if (!nextTier) {
      return {
        currentTier,
        nextTier: null,
        progressPct: 100,
        remainingVolumeUsdt: 0
      };
    }

    const floor = currentTier.minVolume30dUsdt;
    const span = Math.max(1, nextTier.minVolume30dUsdt - floor);
    const rawPct = ((volume30dUsdt - floor) / span) * 100;
    const progressPct = Math.max(0, Math.min(100, Number(rawPct.toFixed(2))));
    const remainingVolumeUsdt = Math.max(0, nextTier.minVolume30dUsdt - volume30dUsdt);

    return { currentTier, nextTier, progressPct, remainingVolumeUsdt };
  }

  /**
   * Evaluates all active dynamic tasks in db.rewardTasks against real live DB state.
   */
  public evaluateUserTasks(userId: string, usdtIdrRate: number) {
    const user = db.users.get(userId);
    if (!user) throw new Error('User not found');

    const activeTasks = this.getActiveTaskConfigs();
    const kyc = db.kyc.get(userId);
    const activity = this.computeUserTradingActivity(userId, usdtIdrRate);
    const depositsUsdt = this.computeUserDepositsUsdt(userId, usdtIdrRate);

    return activeTasks.map(cfg => {
      const def = taskConfigToDefinition(cfg);
      const claimKey = `${userId}:${cfg.id}`;
      const existingClaim = db.rewardClaims.get(claimKey);

      let completed = false;
      let progressPct = 0;
      let progressLabel = '';
      const target = Math.max(1, Number(cfg.targetValue || 1));

      switch (cfg.ruleType) {
        case 'ENABLE_2FA': {
          completed = Boolean(user.isTotpEnabled);
          progressPct = completed ? 100 : 0;
          progressLabel = completed ? '2FA Enabled' : '2FA Not Configured';
          break;
        }
        case 'DEPOSIT_USDT': {
          completed = depositsUsdt >= target;
          progressPct = Math.min(100, Number(((depositsUsdt / target) * 100).toFixed(1)));
          progressLabel = `$${depositsUsdt.toFixed(2)} / $${target.toLocaleString('en-US')} deposited`;
          break;
        }
        case 'SPOT_TRADES_COUNT': {
          const countTarget = Math.max(1, Math.round(target));
          completed = activity.spotTradeCountAllTime >= countTarget;
          progressPct = Math.min(100, Number(((activity.spotTradeCountAllTime / countTarget) * 100).toFixed(1)));
          progressLabel = `${activity.spotTradeCountAllTime} / ${countTarget} spot ${countTarget === 1 ? 'trade' : 'trades'}`;
          break;
        }
        case 'SPOT_VOLUME_USDT': {
          completed = activity.spotVolumeAllTimeUsdt >= target;
          progressPct = Math.min(100, Number(((activity.spotVolumeAllTimeUsdt / target) * 100).toFixed(1)));
          progressLabel = `$${activity.spotVolumeAllTimeUsdt.toFixed(2)} / $${target.toLocaleString('en-US')} spot vol`;
          break;
        }
        case 'FUTURES_VOLUME_USDT': {
          completed = activity.futuresVolumeAllTimeUsdt >= target;
          progressPct = Math.min(100, Number(((activity.futuresVolumeAllTimeUsdt / target) * 100).toFixed(1)));
          progressLabel = `$${activity.futuresVolumeAllTimeUsdt.toFixed(2)} / $${target.toLocaleString('en-US')} futures`;
          break;
        }
        case 'KYC_APPROVED': {
          completed = Boolean(kyc && kyc.status === 'approved');
          progressPct = completed ? 100 : kyc?.status === 'pending' ? 50 : 0;
          progressLabel = completed
            ? `Approved (Tier ${kyc?.tierLevel || 2})`
            : kyc?.status === 'pending'
            ? 'Verification Pending Review'
            : 'Not Verified';
          break;
        }
        case 'COMBINED_VOLUME_30D_USDT': {
          completed = activity.totalVolume30dUsdt >= target;
          progressPct = Math.min(100, Number(((activity.totalVolume30dUsdt / target) * 100).toFixed(1)));
          progressLabel = `$${activity.totalVolume30dUsdt.toFixed(2)} / $${target.toLocaleString('en-US')} (30d)`;
          break;
        }
      }

      return {
        ...def,
        completed,
        progressPct,
        progressLabel,
        claimed: Boolean(existingClaim),
        claimedAt: existingClaim?.claimedAt || null,
        journalId: existingClaim?.journalId || null,
        status: existingClaim ? ('CLAIMED' as const) : completed ? ('READY' as const) : ('IN_PROGRESS' as const)
      };
    });
  }

  /**
   * Lists active platform vouchers with user-specific redemption and VIP eligibility status.
   */
  public listUserVouchers(userId: string, currentVipLevel: number) {
    const now = Date.now();
    const items = Array.from(db.rewardVouchers.values())
      .filter(v => {
        const redeemedByUser = db.voucherRedemptions.has(`${userId}:${v.id}`);
        if (redeemedByUser) return true;
        if (!v.isActive) return false;
        if (v.expiresAt && v.expiresAt <= now) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(v => {
        const redemption = db.voucherRedemptions.get(`${userId}:${v.id}`);
        const isExpired = Boolean(v.expiresAt && v.expiresAt <= now);
        const isExhausted = v.redeemedCount >= v.maxRedemptions;
        const remainingSlots = Math.max(0, v.maxRedemptions - v.redeemedCount);
        const eligibleByVip = currentVipLevel >= v.minVipLevel;
        const canRedeem = Boolean(
          v.isActive && !isExpired && !isExhausted && !redemption && eligibleByVip
        );

        return {
          id: v.id,
          code: v.code,
          title: v.title,
          description: v.description,
          voucherType: v.voucherType,
          rewardCurrency: v.rewardCurrency,
          rewardAmountUsdt: v.rewardAmountUsdt,
          rewardDisplay: formatUsdtLabel(v.rewardAmountUsdt),
          minVipLevel: v.minVipLevel,
          maxRedemptions: v.maxRedemptions,
          redeemedCount: v.redeemedCount,
          remainingSlots,
          expiresAt: v.expiresAt || null,
          isExpired,
          isExhausted,
          eligibleByVip,
          redeemed: Boolean(redemption),
          redeemedAt: redemption?.redeemedAt || null,
          journalId: redemption?.journalId || null,
          canRedeem
        };
      });

    const userRedemptions = Array.from(db.voucherRedemptions.values()).filter(r => r.userId === userId);
    const totalRedeemedUsdt = userRedemptions.reduce(
      (sum, r) => sum + safeUnitsToNumber(r.amountUnits, 6),
      0
    );

    return {
      items,
      availableCount: items.filter(i => i.canRedeem).length,
      redeemedCount: userRedemptions.length,
      totalRedeemedUsdt: Number(totalRedeemedUsdt.toFixed(2))
    };
  }

  /**
   * Computes real referral stats, per-referee breakdown, and claimable USDT commissions.
   */
  public computeReferralSummary(userId: string, rebateRatePct: number, usdtIdrRate: number) {
    const referralCode = this.ensureUserReferralCode(userId);
    const user = db.users.get(userId);

    let referredBy: { code: string; emailMasked: string; boundAt: number } | null = null;
    const ownRel = db.referralRelations.get(userId);
    if (ownRel) {
      const refUser = db.users.get(ownRel.referrerUserId);
      referredBy = {
        code: ownRel.referralCodeUsed,
        emailMasked: refUser ? maskEmail(refUser.email) : 'Verified Partner',
        boundAt: ownRel.createdAt
      };
    } else if (user?.referredByUserId) {
      const refUser = db.users.get(user.referredByUserId);
      referredBy = {
        code: refUser?.referralCode || 'DMX-PARTNER',
        emailMasked: refUser ? maskEmail(refUser.email) : 'Verified Partner',
        boundAt: user.createdAt
      };
    }

    const referees: {
      userId: string;
      emailMasked: string;
      joinedAt: number;
      volume30dUsdt: number;
      volumeAllTimeUsdt: number;
      feesGeneratedUsdt: number;
      commissionEarnedUsdt: number;
      isActiveTrader: boolean;
    }[] = [];

    let totalCommissionEarnedUsdt = 0;
    let totalRefereeVolumeUsdt = 0;

    for (const rel of db.referralRelations.values()) {
      if (rel.referrerUserId !== userId) continue;
      const refereeUser = db.users.get(rel.refereeUserId);
      if (!refereeUser) continue;

      const refActivity = this.computeUserTradingActivity(refereeUser.id, usdtIdrRate);
      const commissionUsdt = Number(((refActivity.totalFeesAllTimeUsdt * rebateRatePct) / 100).toFixed(6));

      totalCommissionEarnedUsdt += commissionUsdt;
      totalRefereeVolumeUsdt += refActivity.totalVolumeAllTimeUsdt;

      referees.push({
        userId: refereeUser.id,
        emailMasked: maskEmail(refereeUser.email),
        joinedAt: rel.createdAt,
        volume30dUsdt: Number(refActivity.totalVolume30dUsdt.toFixed(2)),
        volumeAllTimeUsdt: Number(refActivity.totalVolumeAllTimeUsdt.toFixed(2)),
        feesGeneratedUsdt: Number(refActivity.totalFeesAllTimeUsdt.toFixed(4)),
        commissionEarnedUsdt: Number(commissionUsdt.toFixed(4)),
        isActiveTrader: refActivity.totalTrades30d > 0
      });
    }

    referees.sort((a, b) => b.joinedAt - a.joinedAt);

    let totalCommissionClaimedUsdt = 0;
    for (const payout of db.referralPayouts.values()) {
      if (payout.userId === userId) {
        totalCommissionClaimedUsdt += safeUnitsToNumber(payout.amountUnits, 6);
      }
    }

    const claimableCommissionUsdt = Math.max(
      0,
      Number((totalCommissionEarnedUsdt - totalCommissionClaimedUsdt).toFixed(6))
    );

    return {
      referralCode,
      referredBy,
      rebateRatePct,
      totalReferees: referees.length,
      activeReferees: referees.filter(r => r.isActiveTrader).length,
      totalRefereeVolumeUsdt: Number(totalRefereeVolumeUsdt.toFixed(2)),
      totalCommissionEarnedUsdt: Number(totalCommissionEarnedUsdt.toFixed(4)),
      totalCommissionClaimedUsdt: Number(totalCommissionClaimedUsdt.toFixed(4)),
      claimableCommissionUsdt: Number(claimableCommissionUsdt.toFixed(4)),
      minClaimThresholdUsdt: MIN_REFERRAL_CLAIM_USDT,
      referees
    };
  }

  /**
   * Builds unified settled rewards history rows across tasks, vouchers, and referral commissions.
   */
  private buildUnifiedHistoryRecords(filterUserId?: string): UnifiedRewardHistoryItem[] {
    const records: UnifiedRewardHistoryItem[] = [];

    for (const claim of db.rewardClaims.values()) {
      if (filterUserId && claim.userId !== filterUserId) continue;
      const u = db.users.get(claim.userId);
      records.push({
        id: claim.id,
        userId: claim.userId,
        userEmail: u?.email,
        type: 'TASK_REWARD',
        title: claim.taskTitle,
        code: claim.taskId,
        currency: claim.currency,
        amountUsdt: Number(safeUnitsToNumber(claim.amountUnits, 6).toFixed(4)),
        amountDisplay: claim.amountDisplay,
        status: claim.status || 'SETTLED',
        journalId: claim.journalId,
        claimedAt: claim.claimedAt
      });
    }

    for (const red of db.voucherRedemptions.values()) {
      if (filterUserId && red.userId !== filterUserId) continue;
      const u = db.users.get(red.userId);
      records.push({
        id: red.id,
        userId: red.userId,
        userEmail: u?.email,
        type: 'VOUCHER_REDEMPTION',
        title: red.voucherTitle,
        code: red.voucherCode,
        currency: red.currency,
        amountUsdt: Number(safeUnitsToNumber(red.amountUnits, 6).toFixed(4)),
        amountDisplay: red.amountDisplay,
        status: red.status || 'SETTLED',
        journalId: red.journalId,
        claimedAt: red.redeemedAt
      });
    }

    for (const payout of db.referralPayouts.values()) {
      if (filterUserId && payout.userId !== filterUserId) continue;
      const u = db.users.get(payout.userId);
      records.push({
        id: payout.id,
        userId: payout.userId,
        userEmail: u?.email,
        type: 'REFERRAL_COMMISSION',
        title: `Referral Fee Rebate (${payout.rebateRatePct}% · ${payout.refereeCount} referees)`,
        code: null,
        currency: payout.currency,
        amountUsdt: Number(safeUnitsToNumber(payout.amountUnits, 6).toFixed(4)),
        amountDisplay: payout.amountDisplay,
        status: payout.status || 'SETTLED',
        journalId: payout.journalId,
        claimedAt: payout.claimedAt
      });
    }

    records.sort((a, b) => b.claimedAt - a.claimedAt);
    return records;
  }

  /**
   * Dedicated per-user Rewards History query with type filtering and server pagination.
   */
  public getUserRewardsHistory(
    userId: string,
    options?: { type?: string; page?: number; limit?: number }
  ) {
    const user = db.users.get(userId);
    if (!user) throw new Error('User account not found');

    const allUserRecords = this.buildUnifiedHistoryRecords(userId);
    const typeFilter = String(options?.type || 'ALL').toUpperCase();
    const filtered =
      typeFilter === 'ALL'
        ? allUserRecords
        : allUserRecords.filter(r => r.type === typeFilter);

    const limit = Math.max(1, Math.min(100, Number(options?.limit) || 15));
    const totalFiltered = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));
    const page = Math.max(1, Math.min(totalPages, Number(options?.page) || 1));
    const offset = (page - 1) * limit;

    const items = filtered.slice(offset, offset + limit).map(({ userEmail: _ignored, ...rest }) => rest);

    const totalSettledUsdt = allUserRecords.reduce((sum, r) => sum + r.amountUsdt, 0);
    const taskCount = allUserRecords.filter(r => r.type === 'TASK_REWARD').length;
    const voucherCount = allUserRecords.filter(r => r.type === 'VOUCHER_REDEMPTION').length;
    const referralCount = allUserRecords.filter(r => r.type === 'REFERRAL_COMMISSION').length;

    return {
      items,
      summary: {
        totalCount: allUserRecords.length,
        totalSettledUsdt: Number(totalSettledUsdt.toFixed(4)),
        taskCount,
        voucherCount,
        referralCount
      },
      pagination: {
        page,
        limit,
        total: totalFiltered,
        totalPages
      }
    };
  }

  /**
   * Returns the complete authoritative VIP, Task Center, Vouchers, Referral & Payout History payload.
   */
  public getUserSummary(userId: string) {
    const user = db.users.get(userId);
    if (!user) throw new Error('User account not found');

    const usdtIdrRate = getLiveUsdtIdrRate();
    const activity = this.computeUserTradingActivity(userId, usdtIdrRate);
    const portfolioUsdt = this.computeUserPortfolioUsdt(userId, usdtIdrRate);
    const { currentTier, nextTier, progressPct, remainingVolumeUsdt } = this.resolveVipTier(
      activity.totalVolume30dUsdt
    );
    const tasks = this.evaluateUserTasks(userId, usdtIdrRate);
    const vouchers = this.listUserVouchers(userId, currentTier.level);
    const referral = this.computeReferralSummary(userId, currentTier.referralRebatePct, usdtIdrRate);
    const kyc = db.kyc.get(userId);

    const payoutHistory = this.buildUnifiedHistoryRecords(userId).map(
      ({ userEmail: _ignored, ...rest }) => rest
    );

    const totalTaskRewardsClaimedUsdt = Array.from(db.rewardClaims.values())
      .filter(c => c.userId === userId)
      .reduce((sum, c) => sum + safeUnitsToNumber(c.amountUnits, 6), 0);

    const totalTasksReady = tasks.filter(t => t.status === 'READY').length;

    return {
      usdtIdrRate,
      account: {
        userId: user.id,
        email: user.email,
        status: user.status,
        kycStatus: kyc?.status || 'unverified',
        kycTier: kyc?.tierLevel || 0,
        isTotpEnabled: Boolean(user.isTotpEnabled),
        portfolioEquityUsdt: Number(portfolioUsdt.toFixed(2)),
        portfolioEquityIdr: Math.round(portfolioUsdt * usdtIdrRate)
      },
      vip: {
        currentTier,
        nextTier,
        progressPct,
        remainingVolumeUsdt: Number(remainingVolumeUsdt.toFixed(2)),
        volume30dUsdt: Number(activity.totalVolume30dUsdt.toFixed(2)),
        volume30dIdr: Math.round(activity.totalVolume30dUsdt * usdtIdrRate),
        spotVolume30dUsdt: Number(activity.spotVolume30dUsdt.toFixed(2)),
        futuresVolume30dUsdt: Number(activity.futuresVolume30dUsdt.toFixed(2)),
        feesPaid30dUsdt: Number(activity.totalFees30dUsdt.toFixed(4)),
        tradesCount30d: activity.totalTrades30d,
        schedule: VIP_TIER_SCHEDULE
      },
      tasks: {
        items: tasks,
        readyCount: totalTasksReady,
        claimedCount: tasks.filter(t => t.claimed).length,
        totalClaimedUsdt: Number(totalTaskRewardsClaimedUsdt.toFixed(2))
      },
      vouchers,
      referral,
      payoutHistory
    };
  }

  /**
   * Atomically claims an eligible milestone task reward into the user's real USDT ledger account.
   */
  public claimTaskReward(userId: string, taskId: RewardTaskId): RewardClaimRecord {
    this.ensureDefaultRewardTasks();
    const taskCfg = db.rewardTasks.get(taskId);
    if (!taskCfg) {
      throw new Error(`Unknown reward task: ${taskId}`);
    }
    if (!taskCfg.isActive) {
      throw new Error('This reward task is currently paused and cannot be claimed.');
    }

    const claimKey = `${userId}:${taskId}`;
    const existing = db.rewardClaims.get(claimKey);
    if (existing) {
      throw new Error('This reward task has already been claimed.');
    }

    const usdtIdrRate = getLiveUsdtIdrRate();
    const evaluated = this.evaluateUserTasks(userId, usdtIdrRate).find(t => t.id === taskId);
    if (!evaluated || !evaluated.completed) {
      throw new Error(`Task requirements not met yet (${evaluated?.progressLabel || 'Incomplete'}).`);
    }

    const amountUnits = PrecisionMath.parseToUnits(taskCfg.rewardAmountUsdt.toFixed(6), 6);
    const idempotencyKey = `reward-claim:${userId}:${taskId}`;
    const treasuryAcc = db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT');
    const userAcc = db.createOrGetAccount(userId, 'USDT');

    const { journal } = LedgerService.executeJournal({
      idempotencyKey,
      txType: 'REWARD_PAYOUT',
      referenceId: claimKey,
      description: `DIMONEX Trader Reward Claim: ${taskCfg.title} (${formatUsdtLabel(taskCfg.rewardAmountUsdt)})`,
      entries: [
        { accountId: treasuryAcc.id, entryType: 'DEBIT', amount: amountUnits },
        { accountId: userAcc.id, entryType: 'CREDIT', amount: amountUnits }
      ]
    });

    const record: RewardClaimRecord = {
      id: crypto.randomUUID(),
      userId,
      taskId,
      taskTitle: taskCfg.title,
      currency: 'USDT',
      amountUnits: amountUnits.toString(),
      amountDisplay: `+${taskCfg.rewardAmountUsdt.toFixed(2)} USDT`,
      status: 'SETTLED',
      journalId: journal.id,
      idempotencyKey,
      claimedAt: Date.now()
    };

    db.rewardClaims.set(claimKey, record);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: userId,
      action: 'REWARD_TASK_CLAIMED',
      resource: taskId,
      details: `Credited ${record.amountDisplay} to Spot Wallet (Journal ${journal.id})`,
      createdAt: Date.now()
    });
    db.saveToDisk();

    return record;
  }

  /**
   * Atomically redeems a platform voucher code into the user's real USDT ledger account.
   */
  public redeemVoucher(userId: string, rawCode: string): VoucherRedemptionRecord {
    const user = db.users.get(userId);
    if (!user) throw new Error('User account not found');
    if (user.status !== 'active') {
      throw new Error('Account is not eligible to redeem vouchers.');
    }

    const normalized = String(rawCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(normalized)) {
      throw new Error('Invalid voucher code format. Use 3–32 alphanumeric characters.');
    }

    let voucher: RewardVoucher | undefined;
    for (const v of db.rewardVouchers.values()) {
      if (v.code.toUpperCase() === normalized) {
        voucher = v;
        break;
      }
    }

    if (!voucher) {
      throw new Error(`Voucher code "${normalized}" was not found.`);
    }
    if (!voucher.isActive) {
      throw new Error(`Voucher "${voucher.code}" is currently inactive or revoked.`);
    }
    if (voucher.expiresAt && voucher.expiresAt <= Date.now()) {
      throw new Error(`Voucher "${voucher.code}" has expired.`);
    }
    if (voucher.redeemedCount >= voucher.maxRedemptions) {
      throw new Error(`Voucher "${voucher.code}" has reached its maximum redemption limit.`);
    }

    const redemptionKey = `${userId}:${voucher.id}`;
    if (db.voucherRedemptions.has(redemptionKey)) {
      throw new Error(`You have already redeemed voucher "${voucher.code}".`);
    }

    const usdtIdrRate = getLiveUsdtIdrRate();
    const activity = this.computeUserTradingActivity(userId, usdtIdrRate);
    const { currentTier } = this.resolveVipTier(activity.totalVolume30dUsdt);
    if (currentTier.level < voucher.minVipLevel) {
      const reqTier = VIP_TIER_SCHEDULE.find(t => t.level === voucher!.minVipLevel);
      throw new Error(
        `Voucher "${voucher.code}" requires ${reqTier?.name || `VIP ${voucher.minVipLevel}`} or higher (your current tier: ${currentTier.name}).`
      );
    }

    const amountUnits = PrecisionMath.parseToUnits(voucher.rewardAmountUsdt.toFixed(6), 6);
    if (amountUnits <= 0n) {
      throw new Error('Voucher reward amount must be positive.');
    }

    const idempotencyKey = `voucher-redeem:${userId}:${voucher.id}`;
    const treasuryAcc = db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT');
    const userAcc = db.createOrGetAccount(userId, 'USDT');

    const { journal } = LedgerService.executeJournal({
      idempotencyKey,
      txType: 'VOUCHER_REDEMPTION',
      referenceId: redemptionKey,
      description: `DIMONEX Voucher Redemption: ${voucher.code} — ${voucher.title}`,
      entries: [
        { accountId: treasuryAcc.id, entryType: 'DEBIT', amount: amountUnits },
        { accountId: userAcc.id, entryType: 'CREDIT', amount: amountUnits }
      ]
    });

    const record: VoucherRedemptionRecord = {
      id: crypto.randomUUID(),
      voucherId: voucher.id,
      voucherCode: voucher.code,
      voucherTitle: voucher.title,
      voucherType: voucher.voucherType,
      userId,
      currency: 'USDT',
      amountUnits: amountUnits.toString(),
      amountDisplay: `+${voucher.rewardAmountUsdt.toFixed(2)} USDT`,
      status: 'SETTLED',
      journalId: journal.id,
      idempotencyKey,
      redeemedAt: Date.now()
    };

    voucher.redeemedCount += 1;
    voucher.updatedAt = Date.now();
    db.voucherRedemptions.set(redemptionKey, record);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: userId,
      action: 'VOUCHER_REDEEMED',
      resource: voucher.code,
      details: `User ${user.email} redeemed voucher ${voucher.code} for ${record.amountDisplay} (Journal ${journal.id})`,
      createdAt: Date.now()
    });

    db.saveToDisk();
    return record;
  }

  /**
   * Atomically claims accrued real referral commissions into the user's real USDT ledger account.
   */
  public claimReferralCommission(userId: string): ReferralPayoutRecord {
    const usdtIdrRate = getLiveUsdtIdrRate();
    const activity = this.computeUserTradingActivity(userId, usdtIdrRate);
    const { currentTier } = this.resolveVipTier(activity.totalVolume30dUsdt);
    const referral = this.computeReferralSummary(userId, currentTier.referralRebatePct, usdtIdrRate);

    if (referral.claimableCommissionUsdt < MIN_REFERRAL_CLAIM_USDT) {
      throw new Error(
        `Minimum claimable referral commission is ${MIN_REFERRAL_CLAIM_USDT.toFixed(2)} USDT (current: ${referral.claimableCommissionUsdt.toFixed(4)} USDT).`
      );
    }

    const payoutAmountStr = referral.claimableCommissionUsdt.toFixed(6);
    const amountUnits = PrecisionMath.parseToUnits(payoutAmountStr, 6);
    if (amountUnits <= 0n) {
      throw new Error('No claimable referral commission available.');
    }

    const payoutId = crypto.randomUUID();
    const idempotencyKey = `referral-payout:${userId}:${payoutId}`;
    const treasuryAcc = db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT');
    const userAcc = db.createOrGetAccount(userId, 'USDT');

    const { journal } = LedgerService.executeJournal({
      idempotencyKey,
      txType: 'REFERRAL_REBATE',
      referenceId: payoutId,
      description: `DIMONEX Referral Commission Payout (${currentTier.referralRebatePct}% rebate)`,
      entries: [
        { accountId: treasuryAcc.id, entryType: 'DEBIT', amount: amountUnits },
        { accountId: userAcc.id, entryType: 'CREDIT', amount: amountUnits }
      ]
    });

    const record: ReferralPayoutRecord = {
      id: payoutId,
      userId,
      currency: 'USDT',
      amountUnits: amountUnits.toString(),
      amountDisplay: `+${referral.claimableCommissionUsdt.toFixed(4)} USDT`,
      status: 'SETTLED',
      rebateRatePct: currentTier.referralRebatePct,
      refereeCount: referral.totalReferees,
      journalId: journal.id,
      idempotencyKey,
      claimedAt: Date.now()
    };

    db.referralPayouts.set(record.id, record);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: userId,
      action: 'REFERRAL_COMMISSION_CLAIMED',
      resource: record.id,
      details: `Credited ${record.amountDisplay} referral commission (Journal ${journal.id})`,
      createdAt: Date.now()
    });
    db.saveToDisk();

    return record;
  }

  public getPublicSchedule() {
    const activeTasks = this.getActiveTaskConfigs().map(taskConfigToDefinition);
    return {
      usdtIdrRate: getLiveUsdtIdrRate(),
      vipTiers: VIP_TIER_SCHEDULE,
      taskCatalog: activeTasks,
      minReferralClaimUsdt: MIN_REFERRAL_CLAIM_USDT
    };
  }

  // ==========================================================================
  // ADMIN CONSOLE MANAGEMENT — TASK CENTER, VOUCHERS & GLOBAL PAYOUT LEDGER
  // ==========================================================================

  public getAdminRewardsOverview() {
    this.ensureDefaultRewardTasks();
    const now = Date.now();
    const allTasks = Array.from(db.rewardTasks.values());
    const allVouchers = Array.from(db.rewardVouchers.values());
    const allHistory = this.buildUnifiedHistoryRecords();

    let taskDistributedUsdt = 0;
    let voucherDistributedUsdt = 0;
    let referralDistributedUsdt = 0;

    for (const item of allHistory) {
      if (item.type === 'TASK_REWARD') taskDistributedUsdt += item.amountUsdt;
      else if (item.type === 'VOUCHER_REDEMPTION') voucherDistributedUsdt += item.amountUsdt;
      else if (item.type === 'REFERRAL_COMMISSION') referralDistributedUsdt += item.amountUsdt;
    }

    return {
      tasks: {
        total: allTasks.length,
        active: allTasks.filter(t => t.isActive).length,
        paused: allTasks.filter(t => !t.isActive).length,
        totalClaims: db.rewardClaims.size,
        totalDistributedUsdt: Number(taskDistributedUsdt.toFixed(4))
      },
      vouchers: {
        total: allVouchers.length,
        active: allVouchers.filter(
          v => v.isActive && (!v.expiresAt || v.expiresAt > now) && v.redeemedCount < v.maxRedemptions
        ).length,
        totalRedemptions: db.voucherRedemptions.size,
        totalDistributedUsdt: Number(voucherDistributedUsdt.toFixed(4))
      },
      referrals: {
        totalRelations: db.referralRelations.size,
        totalPayouts: db.referralPayouts.size,
        totalDistributedUsdt: Number(referralDistributedUsdt.toFixed(4))
      },
      totals: {
        totalSettlements: allHistory.length,
        totalDistributedUsdt: Number(
          (taskDistributedUsdt + voucherDistributedUsdt + referralDistributedUsdt).toFixed(4)
        )
      }
    };
  }

  public listAdminTasks() {
    this.ensureDefaultRewardTasks();
    const claimsByTask = new Map<string, { count: number; totalUsdt: number }>();
    for (const claim of db.rewardClaims.values()) {
      const prev = claimsByTask.get(claim.taskId) || { count: 0, totalUsdt: 0 };
      prev.count += 1;
      prev.totalUsdt += safeUnitsToNumber(claim.amountUnits, 6);
      claimsByTask.set(claim.taskId, prev);
    }

    return Array.from(db.rewardTasks.values())
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
      .map(t => {
        const stats = claimsByTask.get(t.id) || { count: 0, totalUsdt: 0 };
        return {
          ...t,
          rewardDisplay: formatUsdtLabel(t.rewardAmountUsdt),
          claimCount: stats.count,
          totalDistributedUsdt: Number(stats.totalUsdt.toFixed(2))
        };
      });
  }

  public createAdminTask(input: CreateRewardTaskInput, actorId: string): RewardTaskConfig {
    this.ensureDefaultRewardTasks();

    const title = String(input.title || '').trim();
    const description = String(input.description || '').trim();
    if (title.length < 3 || title.length > 100) {
      throw new Error('Task title must be between 3 and 100 characters.');
    }
    if (description.length < 5 || description.length > 300) {
      throw new Error('Task description must be between 5 and 300 characters.');
    }
    if (!VALID_TASK_CATEGORIES.includes(input.category)) {
      throw new Error(`Invalid task category: ${input.category}`);
    }
    if (!VALID_TASK_RULE_TYPES.includes(input.ruleType)) {
      throw new Error(`Invalid task rule type: ${input.ruleType}`);
    }
    if (!VALID_TASK_ACTION_VIEWS.includes(input.actionView)) {
      throw new Error(`Invalid action view: ${input.actionView}`);
    }

    const rewardAmountUsdt = Number(input.rewardAmountUsdt);
    if (!Number.isFinite(rewardAmountUsdt) || rewardAmountUsdt <= 0 || rewardAmountUsdt > MAX_SINGLE_REWARD_USDT) {
      throw new Error(`Reward amount must be between 0.01 and ${MAX_SINGLE_REWARD_USDT.toLocaleString()} USDT.`);
    }

    const isBinaryRule = input.ruleType === 'ENABLE_2FA' || input.ruleType === 'KYC_APPROVED';
    const targetValue = isBinaryRule ? 1 : Number(input.targetValue);
    if (!Number.isFinite(targetValue) || targetValue <= 0) {
      throw new Error('Target threshold must be a positive number.');
    }

    let id = String(input.id || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '_');
    if (!id) {
      id = `TASK_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }
    if (!/^[A-Z0-9_-]{3,48}$/.test(id)) {
      throw new Error('Task ID must be 3–48 uppercase alphanumeric, dash, or underscore characters.');
    }
    if (db.rewardTasks.has(id)) {
      throw new Error(`Task ID "${id}" already exists.`);
    }

    const actionLabel = String(input.actionLabel || 'Complete Task').trim().slice(0, 40) || 'Complete Task';
    const maxSort = Array.from(db.rewardTasks.values()).reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : maxSort + 10;
    const now = Date.now();

    const task: RewardTaskConfig = {
      id,
      title,
      description,
      category: input.category,
      ruleType: input.ruleType,
      targetValue: Number(targetValue.toFixed(4)),
      rewardCurrency: 'USDT',
      rewardAmountUsdt: Number(rewardAmountUsdt.toFixed(2)),
      actionLabel,
      actionView: input.actionView,
      isActive: input.isActive !== false,
      sortOrder,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now
    };

    db.rewardTasks.set(task.id, task);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId,
      action: 'ADMIN_REWARD_TASK_CREATED',
      resource: task.id,
      details: `Created trader reward task "${task.title}" (${task.ruleType} >= ${task.targetValue}, reward: ${task.rewardAmountUsdt} USDT)`,
      createdAt: now
    });
    db.saveToDisk();

    return task;
  }

  public updateAdminTask(taskId: string, patch: UpdateRewardTaskInput, actorId: string): RewardTaskConfig {
    this.ensureDefaultRewardTasks();
    const task = db.rewardTasks.get(taskId);
    if (!task) {
      throw new Error(`Reward task "${taskId}" not found.`);
    }

    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (title.length < 3 || title.length > 100) {
        throw new Error('Task title must be between 3 and 100 characters.');
      }
      task.title = title;
    }
    if (patch.description !== undefined) {
      const desc = String(patch.description).trim();
      if (desc.length < 5 || desc.length > 300) {
        throw new Error('Task description must be between 5 and 300 characters.');
      }
      task.description = desc;
    }
    if (patch.category !== undefined) {
      if (!VALID_TASK_CATEGORIES.includes(patch.category)) {
        throw new Error(`Invalid task category: ${patch.category}`);
      }
      task.category = patch.category;
    }
    if (patch.ruleType !== undefined) {
      if (!VALID_TASK_RULE_TYPES.includes(patch.ruleType)) {
        throw new Error(`Invalid task rule type: ${patch.ruleType}`);
      }
      task.ruleType = patch.ruleType;
    }
    if (patch.targetValue !== undefined) {
      const isBinary = task.ruleType === 'ENABLE_2FA' || task.ruleType === 'KYC_APPROVED';
      const val = isBinary ? 1 : Number(patch.targetValue);
      if (!Number.isFinite(val) || val <= 0) {
        throw new Error('Target threshold must be a positive number.');
      }
      task.targetValue = Number(val.toFixed(4));
    }
    if (patch.rewardAmountUsdt !== undefined) {
      const amt = Number(patch.rewardAmountUsdt);
      if (!Number.isFinite(amt) || amt <= 0 || amt > MAX_SINGLE_REWARD_USDT) {
        throw new Error(`Reward amount must be between 0.01 and ${MAX_SINGLE_REWARD_USDT.toLocaleString()} USDT.`);
      }
      task.rewardAmountUsdt = Number(amt.toFixed(2));
    }
    if (patch.actionLabel !== undefined) {
      const label = String(patch.actionLabel).trim().slice(0, 40);
      if (label) task.actionLabel = label;
    }
    if (patch.actionView !== undefined) {
      if (!VALID_TASK_ACTION_VIEWS.includes(patch.actionView)) {
        throw new Error(`Invalid action view: ${patch.actionView}`);
      }
      task.actionView = patch.actionView;
    }
    if (patch.isActive !== undefined) {
      task.isActive = Boolean(patch.isActive);
    }
    if (patch.sortOrder !== undefined && Number.isFinite(Number(patch.sortOrder))) {
      task.sortOrder = Number(patch.sortOrder);
    }

    task.updatedAt = Date.now();
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId,
      action: 'ADMIN_REWARD_TASK_UPDATED',
      resource: task.id,
      details: `Updated reward task "${task.title}" (active=${task.isActive}, reward=${task.rewardAmountUsdt} USDT)`,
      createdAt: task.updatedAt
    });
    db.saveToDisk();

    return task;
  }

  public deleteAdminTask(taskId: string, actorId: string) {
    this.ensureDefaultRewardTasks();
    const task = db.rewardTasks.get(taskId);
    if (!task) {
      throw new Error(`Reward task "${taskId}" not found.`);
    }

    let claimCount = 0;
    for (const c of db.rewardClaims.values()) {
      if (c.taskId === taskId) claimCount++;
    }

    const now = Date.now();
    if (claimCount > 0) {
      task.isActive = false;
      task.updatedAt = now;
      db.auditLogs.push({
        id: crypto.randomUUID(),
        actorId,
        action: 'ADMIN_REWARD_TASK_ARCHIVED',
        resource: task.id,
        details: `Paused reward task "${task.title}" instead of hard-deleting (${claimCount} settled claims preserved).`,
        createdAt: now
      });
      db.saveToDisk();
      return { deleted: false, archived: true, task };
    }

    db.rewardTasks.delete(taskId);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId,
      action: 'ADMIN_REWARD_TASK_DELETED',
      resource: taskId,
      details: `Deleted reward task "${task.title}" (0 claims).`,
      createdAt: now
    });
    db.saveToDisk();
    return { deleted: true, archived: false };
  }

  public listAdminVouchers() {
    const now = Date.now();
    const distributedByVoucher = new Map<string, number>();
    for (const red of db.voucherRedemptions.values()) {
      const prev = distributedByVoucher.get(red.voucherId) || 0;
      distributedByVoucher.set(red.voucherId, prev + safeUnitsToNumber(red.amountUnits, 6));
    }

    return Array.from(db.rewardVouchers.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(v => ({
        ...v,
        rewardDisplay: formatUsdtLabel(v.rewardAmountUsdt),
        remainingSlots: Math.max(0, v.maxRedemptions - v.redeemedCount),
        isExpired: Boolean(v.expiresAt && v.expiresAt <= now),
        isExhausted: v.redeemedCount >= v.maxRedemptions,
        totalDistributedUsdt: Number((distributedByVoucher.get(v.id) || 0).toFixed(2))
      }));
  }

  public createAdminVoucher(input: CreateVoucherInput, actorId: string): RewardVoucher {
    const code = String(input.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      throw new Error('Voucher code must be 3–32 uppercase alphanumeric, hyphen, or underscore characters.');
    }

    for (const existing of db.rewardVouchers.values()) {
      if (existing.code.toUpperCase() === code) {
        throw new Error(`Voucher code "${code}" already exists.`);
      }
    }

    const title = String(input.title || '').trim();
    if (title.length < 3 || title.length > 100) {
      throw new Error('Voucher title must be between 3 and 100 characters.');
    }
    const description = String(input.description || '').trim().slice(0, 300);

    if (!VALID_VOUCHER_TYPES.includes(input.voucherType)) {
      throw new Error(`Invalid voucher type: ${input.voucherType}`);
    }

    const rewardAmountUsdt = Number(input.rewardAmountUsdt);
    if (!Number.isFinite(rewardAmountUsdt) || rewardAmountUsdt <= 0 || rewardAmountUsdt > MAX_SINGLE_REWARD_USDT) {
      throw new Error(`Voucher reward must be between 0.01 and ${MAX_SINGLE_REWARD_USDT.toLocaleString()} USDT.`);
    }

    const minVipLevel = Math.max(0, Math.min(6, Math.round(Number(input.minVipLevel) || 0)));
    const maxRedemptions = Math.round(Number(input.maxRedemptions));
    if (!Number.isFinite(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 1_000_000) {
      throw new Error('Max redemptions must be between 1 and 1,000,000.');
    }

    let expiresAt: number | undefined;
    if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== ('' as any)) {
      const ts = Number(input.expiresAt);
      if (!Number.isFinite(ts) || ts <= Date.now()) {
        throw new Error('Voucher expiration date must be in the future.');
      }
      expiresAt = ts;
    }

    const now = Date.now();
    const voucher: RewardVoucher = {
      id: crypto.randomUUID(),
      code,
      title,
      description,
      voucherType: input.voucherType,
      rewardCurrency: 'USDT',
      rewardAmountUsdt: Number(rewardAmountUsdt.toFixed(2)),
      minVipLevel,
      maxRedemptions,
      redeemedCount: 0,
      isActive: input.isActive !== false,
      expiresAt,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now
    };

    db.rewardVouchers.set(voucher.id, voucher);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId,
      action: 'ADMIN_REWARD_VOUCHER_CREATED',
      resource: voucher.code,
      details: `Created voucher ${voucher.code} (${voucher.rewardAmountUsdt} USDT, max ${voucher.maxRedemptions}, min VIP ${voucher.minVipLevel})`,
      createdAt: now
    });
    db.saveToDisk();

    return voucher;
  }

  public updateAdminVoucher(voucherId: string, patch: UpdateVoucherInput, actorId: string): RewardVoucher {
    const voucher = db.rewardVouchers.get(voucherId);
    if (!voucher) {
      throw new Error('Voucher not found.');
    }

    if (patch.code !== undefined) {
      const code = String(patch.code).trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
        throw new Error('Voucher code must be 3–32 uppercase alphanumeric, hyphen, or underscore characters.');
      }
      for (const existing of db.rewardVouchers.values()) {
        if (existing.id !== voucherId && existing.code.toUpperCase() === code) {
          throw new Error(`Voucher code "${code}" is already in use.`);
        }
      }
      voucher.code = code;
    }

    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (title.length < 3 || title.length > 100) {
        throw new Error('Voucher title must be between 3 and 100 characters.');
      }
      voucher.title = title;
    }

    if (patch.description !== undefined) {
      voucher.description = String(patch.description).trim().slice(0, 300);
    }

    if (patch.voucherType !== undefined) {
      if (!VALID_VOUCHER_TYPES.includes(patch.voucherType)) {
        throw new Error(`Invalid voucher type: ${patch.voucherType}`);
      }
      voucher.voucherType = patch.voucherType;
    }

    if (patch.rewardAmountUsdt !== undefined) {
      const amt = Number(patch.rewardAmountUsdt);
      if (!Number.isFinite(amt) || amt <= 0 || amt > MAX_SINGLE_REWARD_USDT) {
        throw new Error(`Voucher reward must be between 0.01 and ${MAX_SINGLE_REWARD_USDT.toLocaleString()} USDT.`);
      }
      voucher.rewardAmountUsdt = Number(amt.toFixed(2));
    }

    if (patch.minVipLevel !== undefined) {
      voucher.minVipLevel = Math.max(0, Math.min(6, Math.round(Number(patch.minVipLevel) || 0)));
    }

    if (patch.maxRedemptions !== undefined) {
      const maxRed = Math.round(Number(patch.maxRedemptions));
      if (!Number.isFinite(maxRed) || maxRed < voucher.redeemedCount || maxRed > 1_000_000) {
        throw new Error(
          `Max redemptions must be at least ${Math.max(1, voucher.redeemedCount)} and at most 1,000,000.`
        );
      }
      voucher.maxRedemptions = maxRed;
    }

    if (patch.isActive !== undefined) {
      voucher.isActive = Boolean(patch.isActive);
    }

    if (patch.expiresAt !== undefined) {
      if (patch.expiresAt === null) {
        voucher.expiresAt = undefined;
      } else {
        const ts = Number(patch.expiresAt);
        if (!Number.isFinite(ts) || ts <= 0) {
          throw new Error('Invalid expiration timestamp.');
        }
        voucher.expiresAt = ts;
      }
    }

    voucher.updatedAt = Date.now();
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId,
      action: 'ADMIN_REWARD_VOUCHER_UPDATED',
      resource: voucher.code,
      details: `Updated voucher ${voucher.code} (active=${voucher.isActive}, reward=${voucher.rewardAmountUsdt} USDT, max=${voucher.maxRedemptions})`,
      createdAt: voucher.updatedAt
    });
    db.saveToDisk();

    return voucher;
  }

  public deleteAdminVoucher(voucherId: string, actorId: string) {
    const voucher = db.rewardVouchers.get(voucherId);
    if (!voucher) {
      throw new Error('Voucher not found.');
    }

    const now = Date.now();
    if (voucher.redeemedCount > 0) {
      voucher.isActive = false;
      voucher.updatedAt = now;
      db.auditLogs.push({
        id: crypto.randomUUID(),
        actorId,
        action: 'ADMIN_REWARD_VOUCHER_REVOKED',
        resource: voucher.code,
        details: `Revoked voucher ${voucher.code} instead of deleting (${voucher.redeemedCount} settled redemptions preserved).`,
        createdAt: now
      });
      db.saveToDisk();
      return { deleted: false, archived: true, voucher };
    }

    db.rewardVouchers.delete(voucherId);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId,
      action: 'ADMIN_REWARD_VOUCHER_DELETED',
      resource: voucher.code,
      details: `Deleted unused voucher ${voucher.code}.`,
      createdAt: now
    });
    db.saveToDisk();
    return { deleted: true, archived: false };
  }

  public listAdminRewardsHistory(options?: {
    type?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const all = this.buildUnifiedHistoryRecords();
    const typeFilter = String(options?.type || 'ALL').toUpperCase();
    const q = String(options?.search || '').trim().toLowerCase();

    const filtered = all.filter(item => {
      if (typeFilter !== 'ALL' && item.type !== typeFilter) return false;
      if (q) {
        const hay = `${item.userEmail || ''} ${item.title} ${item.code || ''} ${item.journalId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const limit = Math.max(1, Math.min(100, Number(options?.limit) || 25));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.max(1, Math.min(totalPages, Number(options?.page) || 1));
    const offset = (page - 1) * limit;

    const totalFilteredUsdt = filtered.reduce((sum, r) => sum + r.amountUsdt, 0);

    return {
      items: filtered.slice(offset, offset + limit),
      summary: {
        totalRecords: total,
        totalFilteredUsdt: Number(totalFilteredUsdt.toFixed(4))
      },
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    };
  }
}

export const vipRewardsService = new VipRewardsService();
