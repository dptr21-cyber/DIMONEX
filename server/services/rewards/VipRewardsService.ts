/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VipRewardsService.ts
 * Authoritative Institutional VIP Tier Engine, Real Trader Task Center &
 * Referral Commission System backed by live DIMONEX trades, futures orders,
 * deposits, KYC/2FA status, and Double-Entry Atomic Ledger payouts.
 *
 * ZERO mock metrics, ZERO hardcoded user volumes, ZERO fake payouts.
 */

import crypto from 'crypto';
import { db, SYSTEM_TREASURY_ID } from '../../db/database.js';
import {
  RewardTaskId,
  RewardClaimRecord,
  ReferralRelation,
  ReferralPayoutRecord,
  User
} from '../../db/types.js';
import { LedgerService } from '../../ledger/LedgerService.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_REFERRAL_CLAIM_USDT = 0.01;

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
  category: 'SECURITY' | 'FUNDING' | 'TRADING' | 'COMPLIANCE' | 'VIP';
  rewardCurrency: 'USDT';
  rewardAmountUsdt: number;
  rewardDisplay: string;
  actionLabel: string;
  actionView: 'SECURITY' | 'DEPOSIT' | 'TRADE' | 'FUTURES' | 'KYC';
}

export const REWARD_TASK_CATALOG: readonly RewardTaskDefinition[] = [
  {
    id: 'SECURITY_2FA',
    title: 'Enable Authenticator 2FA',
    description: 'Protect your DIMONEX account with RFC-6238 TOTP two-factor authentication.',
    category: 'SECURITY',
    rewardCurrency: 'USDT',
    rewardAmountUsdt: 10,
    rewardDisplay: '10 USDT',
    actionLabel: 'Configure 2FA',
    actionView: 'SECURITY'
  },
  {
    id: 'FIRST_DEPOSIT',
    title: 'Fund Wallet (≥ $100 Equiv.)',
    description: 'Complete at least $100 USDT equivalent in verified IDR or crypto deposits.',
    category: 'FUNDING',
    rewardCurrency: 'USDT',
    rewardAmountUsdt: 25,
    rewardDisplay: '25 USDT',
    actionLabel: 'Deposit Funds',
    actionView: 'DEPOSIT'
  },
  {
    id: 'FIRST_SPOT_TRADE',
    title: 'Execute First Spot Trade',
    description: 'Fill at least one Spot order on any active DIMONEX trading pair.',
    category: 'TRADING',
    rewardCurrency: 'USDT',
    rewardAmountUsdt: 15,
    rewardDisplay: '15 USDT',
    actionLabel: 'Trade Spot',
    actionView: 'TRADE'
  },
  {
    id: 'FUTURES_VOLUME_2K',
    title: 'Trade $2,000 in Perpetual Futures',
    description: 'Reach $2,000 in cumulative filled perpetual futures notional volume.',
    category: 'TRADING',
    rewardCurrency: 'USDT',
    rewardAmountUsdt: 50,
    rewardDisplay: '50 USDT',
    actionLabel: 'Open Futures',
    actionView: 'FUTURES'
  },
  {
    id: 'KYC_TIER_2',
    title: 'Complete Verified KYC',
    description: 'Pass identity verification to unlock institutional withdrawal and compliance limits.',
    category: 'COMPLIANCE',
    rewardCurrency: 'USDT',
    rewardAmountUsdt: 30,
    rewardDisplay: '30 USDT',
    actionLabel: 'Verify KYC',
    actionView: 'KYC'
  },
  {
    id: 'SPOT_VOLUME_50K',
    title: 'Reach VIP 1 ($50,000 30D Volume)',
    description: 'Achieve $50,000 in rolling 30-day Spot & Futures volume to unlock VIP 1.',
    category: 'VIP',
    rewardCurrency: 'USDT',
    rewardAmountUsdt: 100,
    rewardDisplay: '100 USDT',
    actionLabel: 'Start Trading',
    actionView: 'TRADE'
  }
];

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

export class VipRewardsService {
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

    // Ensure seeded / existing users have referral codes materialized before lookup
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

    // Prevent circular referral cycles (e.g., A refers B, B tries to refer A)
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

      // Count user's participating volume (if both maker & taker, count once per trade side executed)
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

    // Also include direct DEPOSIT journals (e.g., seeded/institutional funding) if no fiat/crypto tx exists
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
   * Evaluates all 6 real trader milestone tasks against live DB records.
   */
  public evaluateUserTasks(userId: string, usdtIdrRate: number) {
    const user = db.users.get(userId);
    if (!user) throw new Error('User not found');

    const kyc = db.kyc.get(userId);
    const activity = this.computeUserTradingActivity(userId, usdtIdrRate);
    const depositsUsdt = this.computeUserDepositsUsdt(userId, usdtIdrRate);

    return REWARD_TASK_CATALOG.map(def => {
      const claimKey = `${userId}:${def.id}`;
      const existingClaim = db.rewardClaims.get(claimKey);

      let completed = false;
      let progressPct = 0;
      let progressLabel = '';

      switch (def.id) {
        case 'SECURITY_2FA': {
          completed = Boolean(user.isTotpEnabled);
          progressPct = completed ? 100 : 0;
          progressLabel = completed ? '2FA Enabled' : '2FA Not Configured';
          break;
        }
        case 'FIRST_DEPOSIT': {
          const target = 100;
          completed = depositsUsdt >= target;
          progressPct = Math.min(100, Number(((depositsUsdt / target) * 100).toFixed(1)));
          progressLabel = `$${depositsUsdt.toFixed(2)} / $${target.toFixed(0)} deposited`;
          break;
        }
        case 'FIRST_SPOT_TRADE': {
          completed = activity.spotTradeCountAllTime >= 1;
          progressPct = completed ? 100 : 0;
          progressLabel = `${activity.spotTradeCountAllTime} / 1 spot trade`;
          break;
        }
        case 'FUTURES_VOLUME_2K': {
          const target = 2000;
          completed = activity.futuresVolumeAllTimeUsdt >= target;
          progressPct = Math.min(100, Number(((activity.futuresVolumeAllTimeUsdt / target) * 100).toFixed(1)));
          progressLabel = `$${activity.futuresVolumeAllTimeUsdt.toFixed(2)} / $${target.toLocaleString('en-US')}`;
          break;
        }
        case 'KYC_TIER_2': {
          completed = Boolean(kyc && kyc.status === 'approved');
          progressPct = completed ? 100 : kyc?.status === 'pending' ? 50 : 0;
          progressLabel = completed
            ? `Approved (Tier ${kyc?.tierLevel || 2})`
            : kyc?.status === 'pending'
            ? 'Verification Pending Review'
            : 'Not Verified';
          break;
        }
        case 'SPOT_VOLUME_50K': {
          const target = 50_000;
          completed = activity.totalVolume30dUsdt >= target;
          progressPct = Math.min(100, Number(((activity.totalVolume30dUsdt / target) * 100).toFixed(1)));
          progressLabel = `$${activity.totalVolume30dUsdt.toFixed(2)} / $${target.toLocaleString('en-US')}`;
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
   * Returns the complete authoritative VIP, Task Center, Referral & Payout History payload.
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
    const referral = this.computeReferralSummary(userId, currentTier.referralRebatePct, usdtIdrRate);

    const kyc = db.kyc.get(userId);

    // Combine real persisted reward claims + referral payouts into unified payout history
    const payoutHistory: {
      id: string;
      type: 'TASK_REWARD' | 'REFERRAL_COMMISSION';
      title: string;
      currency: string;
      amountDisplay: string;
      journalId: string;
      claimedAt: number;
    }[] = [];

    for (const claim of db.rewardClaims.values()) {
      if (claim.userId === userId) {
        payoutHistory.push({
          id: claim.id,
          type: 'TASK_REWARD',
          title: claim.taskTitle,
          currency: claim.currency,
          amountDisplay: claim.amountDisplay,
          journalId: claim.journalId,
          claimedAt: claim.claimedAt
        });
      }
    }

    for (const payout of db.referralPayouts.values()) {
      if (payout.userId === userId) {
        payoutHistory.push({
          id: payout.id,
          type: 'REFERRAL_COMMISSION',
          title: `Referral Fee Rebate (${payout.rebateRatePct}% · ${payout.refereeCount} referees)`,
          currency: payout.currency,
          amountDisplay: payout.amountDisplay,
          journalId: payout.journalId,
          claimedAt: payout.claimedAt
        });
      }
    }

    payoutHistory.sort((a, b) => b.claimedAt - a.claimedAt);

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
      referral,
      payoutHistory
    };
  }

  /**
   * Atomically claims an eligible milestone task reward into the user's real USDT ledger account.
   */
  public claimTaskReward(userId: string, taskId: RewardTaskId): RewardClaimRecord {
    const taskDef = REWARD_TASK_CATALOG.find(t => t.id === taskId);
    if (!taskDef) {
      throw new Error(`Unknown reward task: ${taskId}`);
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

    const amountUnits = PrecisionMath.parseToUnits(taskDef.rewardAmountUsdt.toFixed(6), 6);
    const idempotencyKey = `reward-claim:${userId}:${taskId}`;
    const treasuryAcc = db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT');
    const userAcc = db.createOrGetAccount(userId, 'USDT');

    const { journal } = LedgerService.executeJournal({
      idempotencyKey,
      txType: 'REWARD_PAYOUT',
      referenceId: claimKey,
      description: `DIMONEX Trader Reward Claim: ${taskDef.title} (${taskDef.rewardDisplay})`,
      entries: [
        { accountId: treasuryAcc.id, entryType: 'DEBIT', amount: amountUnits },
        { accountId: userAcc.id, entryType: 'CREDIT', amount: amountUnits }
      ]
    });

    const record: RewardClaimRecord = {
      id: crypto.randomUUID(),
      userId,
      taskId,
      taskTitle: taskDef.title,
      currency: 'USDT',
      amountUnits: amountUnits.toString(),
      amountDisplay: `+${taskDef.rewardAmountUsdt.toFixed(2)} USDT`,
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
    return {
      usdtIdrRate: getLiveUsdtIdrRate(),
      vipTiers: VIP_TIER_SCHEDULE,
      taskCatalog: REWARD_TASK_CATALOG,
      minReferralClaimUsdt: MIN_REFERRAL_CLAIM_USDT
    };
  }
}

export const vipRewardsService = new VipRewardsService();
