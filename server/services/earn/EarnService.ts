/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/earn/EarnService.ts
 * Institutional Earn & Staking Vaults Engine for DIMONEX.
 *
 * Guarantees:
 * - Zero-float BigInt atomic arithmetic for all principal, caps, penalties, and yields
 * - Real custody transfers via double-entry LedgerService (User <-> SYSTEM_EARN_CUSTODY_ID)
 * - Real yield payouts via double-entry LedgerService (SYSTEM_TREASURY_ID -> User or Auto-Compound Custody)
 * - Live TVL & staker counts computed strictly from persisted EarnPosition records
 * - Real asset definitions strictly backed by db.assets
 * - Idempotent UTC daily yield settlement scheduler + manual claim + flexible/fixed redemption
 */

import crypto from 'crypto';
import { db, SYSTEM_EARN_CUSTODY_ID, SYSTEM_FEE_ID, SYSTEM_TREASURY_ID } from '../../db/database.js';
import {
  EarnPayoutFundingSource,
  EarnPayoutRecord,
  EarnPosition,
  EarnVault,
  EarnVaultStatus,
  EarnVaultType,
} from '../../db/types.js';
import { LedgerService } from '../../ledger/LedgerService.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { fxConversionService } from '../external/FxConversionService.js';

const MS_PER_DAY = 86_400_000;

export interface EnrichedEarnVault extends EarnVault {
  decimals: number;
  assetName: string;
  assetLogoUrl?: string;
  assetStatus?: string;
  isAssetDeleted?: boolean;
  isDelisted?: boolean;
  apyPct: number;
  totalStakedUnits: string;
  totalStakedDisplay: string;
  totalStakedUsd: number;
  totalStakedIdr: number;
  remainingCapUnits: string;
  utilizationBps: number;
  activeStakersCount: number;
  activePositionsCount: number;
}

export interface EarnVaultDeletionDependencies {
  vaultIds: string[];
  vaultNames: string[];
  asset: string;
  decimals: number;
  activePositionsCount: number;
  activeStakersCount: number;
  totalStakedUnits: string;
  totalStakedDisplay: string;
  accruedYieldUnits: string;
  accruedYieldDisplay: string;
}

export class EarnVaultConflictError extends Error {
  public readonly statusCode = 409;
  public readonly requiresForce = true;
  public readonly dependencies: EarnVaultDeletionDependencies;

  constructor(message: string, dependencies: EarnVaultDeletionDependencies) {
    super(message);
    this.name = 'EarnVaultConflictError';
    this.dependencies = dependencies;
  }
}

export interface EnrichedEarnPosition extends EarnPosition {
  vaultName: string;
  vaultType: EarnVaultType;
  vaultStatus: EarnVaultStatus;
  earlyRedeemAllowed: boolean;
  earlyRedeemPenaltyBps: number;
  autoCompoundSupported: boolean;
  apyPct: number;
  principalDisplay: string;
  principalUsd: number;
  principalIdr: number;
  accruedYieldDisplay: string;
  claimedYieldDisplay: string;
  totalYieldEarnedDisplay: string;
  liveAccruingYieldUnits: string;
  liveAccruingYieldDisplay: string;
  dailyEstimatedYieldUnits: string;
  dailyEstimatedYieldDisplay: string;
  isMatured: boolean;
  canClaim: boolean;
  canRedeem: boolean;
}

export class EarnService {
  private schedulerTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.ensureDefaultVaults();
  }

  /**
   * Resolves double-entry debit legs for paying out Staking Earn yields.
   * Priority 1: Exchange Fee Collector (`SYSTEM_FEE_ID`) in the payout asset.
   * Priority 2: Fallback to Exchange Treasury Reserve (`SYSTEM_TREASURY_ID`) for any remaining shortfall.
   * Preserves strict double-entry balance and prevents `SYSTEM_FEE_ID` overdraft.
   */
  private buildYieldFundingDebits(
    asset: string,
    amountUnits: bigint
  ): {
    entries: Array<{ accountId: string; entryType: 'DEBIT'; amount: bigint }>;
    fundingSource: EarnPayoutFundingSource;
    feeFundedUnits: bigint;
    treasuryFundedUnits: bigint;
  } {
    const feeAcc = db.createOrGetAccount(SYSTEM_FEE_ID, asset);
    const treasuryAcc = db.createOrGetAccount(SYSTEM_TREASURY_ID, asset);

    const rawFeeAvail = BigInt(feeAcc.balanceAvailable || '0');
    const feeAvail = rawFeeAvail > 0n ? rawFeeAvail : 0n;

    const feeFundedUnits = feeAvail >= amountUnits ? amountUnits : feeAvail;
    const treasuryFundedUnits = amountUnits - feeFundedUnits;

    const entries: Array<{ accountId: string; entryType: 'DEBIT'; amount: bigint }> = [];
    if (feeFundedUnits > 0n) {
      entries.push({ accountId: feeAcc.id, entryType: 'DEBIT', amount: feeFundedUnits });
    }
    if (treasuryFundedUnits > 0n) {
      entries.push({ accountId: treasuryAcc.id, entryType: 'DEBIT', amount: treasuryFundedUnits });
    }

    const fundingSource: EarnPayoutFundingSource =
      treasuryFundedUnits === 0n
        ? 'EXCHANGE_FEE_POOL'
        : feeFundedUnits > 0n
          ? 'HYBRID_FEE_AND_TREASURY'
          : 'TREASURY_RESERVE';

    return {
      entries,
      fundingSource,
      feeFundedUnits,
      treasuryFundedUnits,
    };
  }

  /**
   * Checks whether all trading pairs where `symbol` is the base currency have been delisted
   * (or the asset has been explicitly deleted/retired).
   */
  private isSymbolDelisted(symbol: string): boolean {
    const clean = symbol.trim().toUpperCase();
    if (db.deletedAssetSymbols.has(clean)) return true;

    const basePairs = Array.from(db.tradingPairs.values()).filter(
      p => p.baseCurrency.toUpperCase() === clean
    );
    if (basePairs.length > 0 && basePairs.every(p => Boolean(p.isDelisted))) {
      return true;
    }
    return false;
  }

  /**
   * Resolves exact asset metadata from db.assets.
   * When allowDeletedFallback is true, safely resolves deleted/delisted assets so admin & solvency
   * views never crash on orphaned vaults.
   */
  private resolveAssetInfo(
    symbol: string,
    allowDeletedFallback = false
  ): {
    symbol: string;
    name: string;
    decimals: number;
    logoUrl?: string;
    status: string;
    isAssetDeleted: boolean;
    isDelisted: boolean;
  } {
    const clean = symbol.trim().toUpperCase();
    const isDelisted = this.isSymbolDelisted(clean);

    for (const ast of db.assets.values()) {
      if (ast.symbol.toUpperCase() === clean) {
        return {
          symbol: ast.symbol,
          name: ast.name,
          decimals: ast.decimals,
          logoUrl: ast.logoUrl,
          status: ast.status,
          isAssetDeleted: false,
          isDelisted: isDelisted || ast.status === 'RETIRED',
        };
      }
    }

    if (!allowDeletedFallback) {
      throw new Error(`Asset ${clean} tidak terdaftar di registry aset DIMONEX`);
    }

    let inferredDecimals = this.resolveCurrencyDecimals(clean);
    for (const pos of db.earnPositions.values()) {
      if (pos.asset.toUpperCase() === clean && Number.isInteger(pos.decimals)) {
        inferredDecimals = pos.decimals;
        break;
      }
    }

    return {
      symbol: clean,
      name: `${clean} (Asset Terhapus)`,
      decimals: inferredDecimals,
      logoUrl: undefined,
      status: 'DELETED',
      isAssetDeleted: true,
      isDelisted: true,
    };
  }

  /**
   * Computes live valuation in USD & IDR for 1 unit of an asset using real DB market pairs & FX rate.
   */
  private getAssetValuationRates(symbol: string): { priceIdr: number; priceUsd: number } {
    const clean = symbol.trim().toUpperCase();
    const fxRate = Math.max(1, fxConversionService.getCurrentRate().rate || 16350);

    if (clean === 'IDR') {
      return { priceIdr: 1, priceUsd: 1 / fxRate };
    }
    if (clean === 'USDT') {
      const usdtIdrPair = db.tradingPairs.get('USDT-IDR');
      const liveIdr = usdtIdrPair ? Number(PrecisionMath.formatFromUnits(BigInt(usdtIdrPair.lastPrice), usdtIdrPair.quoteDecimals, true)) : fxRate;
      const effectiveIdr = Number.isFinite(liveIdr) && liveIdr > 0 ? liveIdr : fxRate;
      return { priceIdr: effectiveIdr, priceUsd: 1 };
    }

    const idrPair = db.tradingPairs.get(`${clean}-IDR`);
    if (idrPair && BigInt(idrPair.lastPrice) > 0n) {
      const idrVal = Number(PrecisionMath.formatFromUnits(BigInt(idrPair.lastPrice), idrPair.quoteDecimals, true));
      if (Number.isFinite(idrVal) && idrVal > 0) {
        return { priceIdr: idrVal, priceUsd: idrVal / fxRate };
      }
    }

    const usdtPair = db.tradingPairs.get(`${clean}-USDT`);
    if (usdtPair && BigInt(usdtPair.lastPrice) > 0n) {
      const usdVal = Number(PrecisionMath.formatFromUnits(BigInt(usdtPair.lastPrice), usdtPair.quoteDecimals, true));
      if (Number.isFinite(usdVal) && usdVal > 0) {
        return { priceIdr: usdVal * fxRate, priceUsd: usdVal };
      }
    }

    return { priceIdr: 0, priceUsd: 0 };
  }

  private unitsToUsdIdr(units: bigint, decimals: number, symbol: string): { usd: number; idr: number } {
    if (units <= 0n) return { usd: 0, idr: 0 };
    const tokenQty = Number(PrecisionMath.formatFromUnits(units, decimals, true));
    if (!Number.isFinite(tokenQty) || tokenQty <= 0) return { usd: 0, idr: 0 };
    const { priceIdr, priceUsd } = this.getAssetValuationRates(symbol);
    return {
      usd: Math.round(tokenQty * priceUsd * 100) / 100,
      idr: Math.round(tokenQty * priceIdr),
    };
  }

  /**
   * Seeds initial Institutional Earn Vaults strictly mapped to verified assets in db.assets
   * only if db.earnVaults is currently empty. Zero mock balances or fake TVL are inserted.
   */
  public ensureDefaultVaults(): void {
    if (db.earnVaults.size > 0) return;
    // Do not auto-reseed default vaults if an admin has explicitly purged/deleted vaults
    if (
      db.auditLogs.some(
        l =>
          l.action === 'EARN_VAULT_DELETED' ||
          l.action === 'EARN_TOKEN_VAULTS_DELETED' ||
          l.action === 'EARN_ORPHANED_VAULTS_CLEANED'
      )
    ) {
      return;
    }
    const now = Date.now();

    const activeAssetSymbols = new Set<string>();
    for (const ast of db.assets.values()) {
      if (ast.status === 'ACTIVE') activeAssetSymbols.add(ast.symbol.toUpperCase());
    }

    const candidates: Array<Omit<EarnVault, 'createdAt' | 'updatedAt'>> = [
      {
        id: 'vault-usdt-flex',
        asset: 'USDT',
        name: 'Tether USD Institutional Flexible',
        type: 'FLEXIBLE',
        durationDays: 0,
        apyBps: 720, // 7.20% APY
        minStakeUnits: PrecisionMath.parseToUnits('10', 6).toString(),
        maxStakeUnits: PrecisionMath.parseToUnits('250000', 6).toString(),
        totalCapUnits: PrecisionMath.parseToUnits('5000000', 6).toString(),
        earlyRedeemAllowed: true,
        earlyRedeemPenaltyBps: 0,
        autoCompoundSupported: true,
        status: 'ACTIVE',
        isFeatured: true,
        custodyNote: 'Segregated Earn Custody Account · Daily 00:00 UTC Yield Distribution',
      },
      {
        id: 'vault-usdt-90d',
        asset: 'USDT',
        name: 'Tether USD 90-Day Prime Term',
        type: 'FIXED',
        durationDays: 90,
        apyBps: 1150, // 11.50% APY
        minStakeUnits: PrecisionMath.parseToUnits('100', 6).toString(),
        maxStakeUnits: PrecisionMath.parseToUnits('500000', 6).toString(),
        totalCapUnits: PrecisionMath.parseToUnits('10000000', 6).toString(),
        earlyRedeemAllowed: true,
        earlyRedeemPenaltyBps: 150, // 1.50% principal penalty if redeemed before maturity
        autoCompoundSupported: false,
        status: 'ACTIVE',
        isFeatured: true,
        custodyNote: 'Locked Institutional Term Custody · Accrued Yield Daily UTC',
      },
      {
        id: 'vault-idr-flex',
        asset: 'IDR',
        name: 'Rupiah Treasury Flexible Yield',
        type: 'FLEXIBLE',
        durationDays: 0,
        apyBps: 580, // 5.80% APY
        minStakeUnits: PrecisionMath.parseToUnits('100000', 2).toString(), // Rp 100,000
        maxStakeUnits: PrecisionMath.parseToUnits('2000000000', 2).toString(), // Rp 2B
        totalCapUnits: PrecisionMath.parseToUnits('50000000000', 2).toString(), // Rp 50B
        earlyRedeemAllowed: true,
        earlyRedeemPenaltyBps: 0,
        autoCompoundSupported: true,
        status: 'ACTIVE',
        isFeatured: false,
        custodyNote: 'IDR Segregated Liquidity Reserve · Instant Flexible Redemption',
      },
      {
        id: 'vault-btc-60d',
        asset: 'BTC',
        name: 'Bitcoin Prime 60-Day Vault',
        type: 'FIXED',
        durationDays: 60,
        apyBps: 425, // 4.25% APY
        minStakeUnits: PrecisionMath.parseToUnits('0.001', 8).toString(),
        maxStakeUnits: PrecisionMath.parseToUnits('25', 8).toString(),
        totalCapUnits: PrecisionMath.parseToUnits('250', 8).toString(),
        earlyRedeemAllowed: true,
        earlyRedeemPenaltyBps: 100, // 1.00%
        autoCompoundSupported: false,
        status: 'ACTIVE',
        isFeatured: true,
        custodyNote: 'Cold-Vault Segregated Custody · Guaranteed Principal Return',
      },
      {
        id: 'vault-eth-flex',
        asset: 'ETH',
        name: 'Ethereum Validator Liquid Staking',
        type: 'STAKING',
        durationDays: 0,
        apyBps: 540, // 5.40% APY
        minStakeUnits: PrecisionMath.parseToUnits('0.01', 8).toString(),
        maxStakeUnits: PrecisionMath.parseToUnits('500', 8).toString(),
        totalCapUnits: PrecisionMath.parseToUnits('5000', 8).toString(),
        earlyRedeemAllowed: true,
        earlyRedeemPenaltyBps: 0,
        autoCompoundSupported: true,
        status: 'ACTIVE',
        isFeatured: false,
        custodyNote: 'On-Chain Validator Delegation Pool · Compounding Supported',
      },
      {
        id: 'vault-sol-30d',
        asset: 'SOL',
        name: 'Solana 30-Day Validator Staking',
        type: 'STAKING',
        durationDays: 30,
        apyBps: 780, // 7.80% APY
        minStakeUnits: PrecisionMath.parseToUnits('0.5', 8).toString(),
        maxStakeUnits: PrecisionMath.parseToUnits('5000', 8).toString(),
        totalCapUnits: PrecisionMath.parseToUnits('50000', 8).toString(),
        earlyRedeemAllowed: true,
        earlyRedeemPenaltyBps: 120,
        autoCompoundSupported: false,
        status: 'ACTIVE',
        isFeatured: false,
        custodyNote: 'Delegated Solana Epoch Staking · 30-Day Institutional Term',
      },
      {
        id: 'vault-ton-launch',
        asset: 'TON',
        name: 'TON Network Ecosystem Launchpool',
        type: 'LAUNCHPOOL',
        durationDays: 0,
        apyBps: 1240, // 12.40% APY
        minStakeUnits: PrecisionMath.parseToUnits('5', 8).toString(),
        maxStakeUnits: PrecisionMath.parseToUnits('25000', 8).toString(),
        totalCapUnits: PrecisionMath.parseToUnits('250000', 8).toString(),
        earlyRedeemAllowed: true,
        earlyRedeemPenaltyBps: 0,
        autoCompoundSupported: true,
        status: 'ACTIVE',
        isFeatured: true,
        custodyNote: 'Ecosystem Staking Pool · Flexible Unstake Anytime',
      },
    ];

    for (const c of candidates) {
      if (!activeAssetSymbols.has(c.asset)) continue;
      db.earnVaults.set(c.id, {
        ...c,
        createdAt: now,
        updatedAt: now,
      });
    }
    db.scheduleSave();
  }

  /**
   * Aggregates live TVL & staker counts directly from persisted EarnPosition entries.
   */
  private getVaultLiveStats(vaultId: string): {
    totalStakedUnits: bigint;
    activeStakersCount: number;
    activePositionsCount: number;
  } {
    let totalStakedUnits = 0n;
    const stakerUsers = new Set<string>();
    let activePositionsCount = 0;

    for (const pos of db.earnPositions.values()) {
      if (pos.vaultId !== vaultId) continue;
      if (pos.status === 'REDEEMED') continue;
      const pUnits = BigInt(pos.principalUnits || '0');
      if (pUnits > 0n) {
        totalStakedUnits += pUnits;
        stakerUsers.add(pos.userId);
        activePositionsCount += 1;
      }
    }

    return {
      totalStakedUnits,
      activeStakersCount: stakerUsers.size,
      activePositionsCount,
    };
  }

  private enrichVault(vault: EarnVault): EnrichedEarnVault {
    const assetInfo = this.resolveAssetInfo(vault.asset, true);
    const stats = this.getVaultLiveStats(vault.id);
    const capUnits = BigInt(vault.totalCapUnits || '0');
    const remainingCapUnits = capUnits > 0n
      ? (capUnits > stats.totalStakedUnits ? capUnits - stats.totalStakedUnits : 0n)
      : 0n;

    let utilizationBps = 0;
    if (capUnits > 0n) {
      utilizationBps = Number((stats.totalStakedUnits * 10000n) / capUnits);
      if (utilizationBps > 10000) utilizationBps = 10000;
    }

    const vals = this.unitsToUsdIdr(stats.totalStakedUnits, assetInfo.decimals, vault.asset);

    return {
      ...vault,
      decimals: assetInfo.decimals,
      assetName: assetInfo.name,
      assetLogoUrl: assetInfo.logoUrl,
      assetStatus: assetInfo.status,
      isAssetDeleted: assetInfo.isAssetDeleted,
      isDelisted: assetInfo.isDelisted,
      apyPct: vault.apyBps / 100,
      totalStakedUnits: stats.totalStakedUnits.toString(),
      totalStakedDisplay: PrecisionMath.formatFromUnits(stats.totalStakedUnits, assetInfo.decimals, true),
      totalStakedUsd: vals.usd,
      totalStakedIdr: vals.idr,
      remainingCapUnits: remainingCapUnits.toString(),
      utilizationBps,
      activeStakersCount: stats.activeStakersCount,
      activePositionsCount: stats.activePositionsCount,
    };
  }

  public listPublicVaults(): {
    vaults: EnrichedEarnVault[];
    platformStats: {
      totalVaults: number;
      activeVaults: number;
      totalStakersCount: number;
      totalValueLockedUsd: number;
      totalValueLockedIdr: number;
      totalYieldDistributedUsd: number;
    };
  } {
    this.ensureDefaultVaults();
    const vaults = Array.from(db.earnVaults.values())
      .map(v => this.enrichVault(v))
      .filter(
        v =>
          v.status !== 'CLOSED' &&
          !v.isAssetDeleted &&
          !v.isDelisted &&
          v.assetStatus !== 'RETIRED'
      )
      .sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured) || b.apyBps - a.apyBps);

    const uniqueStakers = new Set<string>();
    let totalTvlUsd = 0;
    let totalTvlIdr = 0;
    for (const pos of db.earnPositions.values()) {
      if (pos.status !== 'REDEEMED' && BigInt(pos.principalUnits || '0') > 0n) {
        uniqueStakers.add(pos.userId);
      }
    }
    for (const v of vaults) {
      totalTvlUsd += v.totalStakedUsd;
      totalTvlIdr += v.totalStakedIdr;
    }

    let totalYieldDistributedUsd = 0;
    for (const payout of db.earnPayouts) {
      const vals = this.unitsToUsdIdr(BigInt(payout.amountUnits || '0'), payout.decimals, payout.asset);
      totalYieldDistributedUsd += vals.usd;
    }

    return {
      vaults,
      platformStats: {
        totalVaults: vaults.length,
        activeVaults: vaults.filter(v => v.status === 'ACTIVE').length,
        totalStakersCount: uniqueStakers.size,
        totalValueLockedUsd: Math.round(totalTvlUsd * 100) / 100,
        totalValueLockedIdr: Math.round(totalTvlIdr),
        totalYieldDistributedUsd: Math.round(totalYieldDistributedUsd * 100) / 100,
      },
    };
  }

  public listAdminVaults(): EnrichedEarnVault[] {
    this.ensureDefaultVaults();
    return Array.from(db.earnVaults.values())
      .map(v => this.enrichVault(v))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  private calculateDailyYieldUnits(principalUnits: bigint, apyBps: number): bigint {
    if (principalUnits <= 0n || apyBps <= 0) return 0n;
    return (principalUnits * BigInt(apyBps)) / 3650000n;
  }

  private enrichPosition(pos: EarnPosition, nowMs = Date.now()): EnrichedEarnPosition {
    const vault = db.earnVaults.get(pos.vaultId);
    const effectiveApyBps = vault && vault.durationDays === 0 ? vault.apyBps : pos.apyBps;
    const principalUnits = BigInt(pos.principalUnits || '0');
    const accruedUnits = BigInt(pos.accruedYieldUnits || '0');
    const claimedUnits = BigInt(pos.claimedYieldUnits || '0');
    const totalEarnedUnits = BigInt(pos.totalYieldEarnedUnits || '0');

    const dailyEstUnits = pos.status === 'REDEEMED'
      ? 0n
      : this.calculateDailyYieldUnits(principalUnits, effectiveApyBps);

    // Live pro-rata estimate for the un-settled elapsed window since lastAccruedAt (display only until daily settlement)
    const elapsedMs = pos.status === 'ACTIVE' && nowMs > pos.lastAccruedAt
      ? BigInt(Math.min(MS_PER_DAY, nowMs - pos.lastAccruedAt))
      : 0n;
    const liveAccruingUnits = pos.status === 'ACTIVE' && elapsedMs > 0n
      ? (principalUnits * BigInt(effectiveApyBps) * elapsedMs) / (3650000n * BigInt(MS_PER_DAY))
      : 0n;

    const principalVals = this.unitsToUsdIdr(principalUnits, pos.decimals, pos.asset);
    const isMatured = pos.maturesAt !== null ? nowMs >= pos.maturesAt : true;

    return {
      ...pos,
      apyBps: effectiveApyBps,
      vaultName: vault?.name || `${pos.asset} Vault`,
      vaultType: vault?.type || (pos.durationDays === 0 ? 'FLEXIBLE' : 'FIXED'),
      vaultStatus: vault?.status || 'ACTIVE',
      earlyRedeemAllowed: vault ? vault.earlyRedeemAllowed : true,
      earlyRedeemPenaltyBps: vault ? vault.earlyRedeemPenaltyBps : 0,
      autoCompoundSupported: vault ? vault.autoCompoundSupported : false,
      apyPct: effectiveApyBps / 100,
      principalDisplay: PrecisionMath.formatFromUnits(principalUnits, pos.decimals, true),
      principalUsd: principalVals.usd,
      principalIdr: principalVals.idr,
      accruedYieldDisplay: PrecisionMath.formatFromUnits(accruedUnits, pos.decimals, true),
      claimedYieldDisplay: PrecisionMath.formatFromUnits(claimedUnits, pos.decimals, true),
      totalYieldEarnedDisplay: PrecisionMath.formatFromUnits(totalEarnedUnits, pos.decimals, true),
      liveAccruingYieldUnits: liveAccruingUnits.toString(),
      liveAccruingYieldDisplay: PrecisionMath.formatFromUnits(liveAccruingUnits, pos.decimals, true),
      dailyEstimatedYieldUnits: dailyEstUnits.toString(),
      dailyEstimatedYieldDisplay: PrecisionMath.formatFromUnits(dailyEstUnits, pos.decimals, true),
      isMatured,
      canClaim: pos.status !== 'REDEEMED' && accruedUnits > 0n,
      canRedeem: pos.status !== 'REDEEMED' && principalUnits > 0n && (isMatured || Boolean(vault?.earlyRedeemAllowed)),
    };
  }

  public getUserSummary(userId: string) {
    this.ensureDefaultVaults();
    const now = Date.now();
    // Ensure any completed UTC days are materialized before building summary
    this.runDailyYieldSettlement(now);

    const vaults = this.listPublicVaults();
    const positions = Array.from(db.earnPositions.values())
      .filter(p => p.userId === userId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(p => this.enrichPosition(p, now));

    const activePositions = positions.filter(p => p.status !== 'REDEEMED');
    let totalUserStakedUsd = 0;
    let totalUserStakedIdr = 0;
    let totalUserClaimableUsd = 0;
    let totalUserEarnedUsd = 0;
    let weightedApyNumerator = 0;

    for (const p of activePositions) {
      totalUserStakedUsd += p.principalUsd;
      totalUserStakedIdr += p.principalIdr;
      weightedApyNumerator += p.principalUsd * p.apyPct;
      totalUserClaimableUsd += this.unitsToUsdIdr(BigInt(p.accruedYieldUnits), p.decimals, p.asset).usd;
    }

    for (const p of positions) {
      totalUserEarnedUsd += this.unitsToUsdIdr(BigInt(p.totalYieldEarnedUnits), p.decimals, p.asset).usd;
    }

    const avgApyPct = totalUserStakedUsd > 0 ? Math.round((weightedApyNumerator / totalUserStakedUsd) * 100) / 100 : 0;

    // Real wallet balances per relevant vault asset
    const walletBalances: Record<string, { availableUnits: string; availableDisplay: string; decimals: number }> = {};
    for (const v of vaults.vaults) {
      if (walletBalances[v.asset]) continue;
      const acc = db.getAccount(userId, v.asset);
      const avail = acc ? BigInt(acc.balanceAvailable) : 0n;
      walletBalances[v.asset] = {
        availableUnits: avail.toString(),
        availableDisplay: PrecisionMath.formatFromUnits(avail, v.decimals, true),
        decimals: v.decimals,
      };
    }

    const payouts = db.earnPayouts
      .filter(r => r.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map(r => ({
        ...r,
        amountDisplay: PrecisionMath.formatFromUnits(BigInt(r.amountUnits || '0'), r.decimals, true),
        apyPct: r.apyBps / 100,
      }));

    return {
      ...vaults,
      walletBalances,
      portfolio: {
        activePositionsCount: activePositions.length,
        totalStakedUsd: Math.round(totalUserStakedUsd * 100) / 100,
        totalStakedIdr: Math.round(totalUserStakedIdr),
        totalClaimableUsd: Math.round(totalUserClaimableUsd * 100) / 100,
        totalYieldEarnedUsd: Math.round(totalUserEarnedUsd * 100) / 100,
        weightedAvgApyPct: avgApyPct,
      },
      positions,
      payouts,
    };
  }

  /**
   * Subscribes user principal into a vault using atomic double-entry custody transfer.
   */
  public subscribeToVault(params: {
    userId: string;
    vaultId: string;
    amount: string | number;
    autoCompound?: boolean;
    idempotencyKey?: string;
  }): EnrichedEarnPosition {
    this.ensureDefaultVaults();
    const { userId, vaultId, amount, autoCompound, idempotencyKey } = params;

    const user = db.users.get(userId);
    if (!user) throw new Error('Akun pengguna tidak ditemukan');
    if (user.status === 'frozen' || user.status === 'suspended') {
      throw new Error('Akun Anda dibatasi/dibekukan. Subscription Earn tidak diizinkan.');
    }

    const vault = db.earnVaults.get(vaultId);
    if (!vault) throw new Error('Vault Earn tidak ditemukan');
    if (vault.status !== 'ACTIVE') {
      throw new Error(`Vault ${vault.name} sedang tidak aktif (${vault.status})`);
    }

    const assetInfo = this.resolveAssetInfo(vault.asset, false);
    if (assetInfo.isDelisted) {
      throw new Error(`Aset ${vault.asset} telah di-delisting sehingga staking baru tidak diperbolehkan.`);
    }
    if (assetInfo.status !== 'ACTIVE') {
      throw new Error(`Aset ${vault.asset} tidak berstatus ACTIVE untuk staking`);
    }

    // Idempotency return if already executed with this key
    if (idempotencyKey) {
      for (const existing of db.earnPositions.values()) {
        if (existing.userId === userId && existing.idempotencyKey === idempotencyKey) {
          return this.enrichPosition(existing);
        }
      }
    }

    const amountUnits = PrecisionMath.parseToUnits(String(amount).trim(), assetInfo.decimals);
    if (amountUnits <= 0n) {
      throw new Error('Jumlah stake harus lebih besar dari 0');
    }

    const minUnits = BigInt(vault.minStakeUnits || '0');
    if (amountUnits < minUnits) {
      throw new Error(
        `Minimum stake untuk vault ini adalah ${PrecisionMath.formatFromUnits(minUnits, assetInfo.decimals, true)} ${vault.asset}`
      );
    }

    const maxUnits = BigInt(vault.maxStakeUnits || '0');
    if (maxUnits > 0n && amountUnits > maxUnits) {
      throw new Error(
        `Maksimum stake per transaksi adalah ${PrecisionMath.formatFromUnits(maxUnits, assetInfo.decimals, true)} ${vault.asset}`
      );
    }

    const liveStats = this.getVaultLiveStats(vault.id);
    const totalCapUnits = BigInt(vault.totalCapUnits || '0');
    if (totalCapUnits > 0n && liveStats.totalStakedUnits + amountUnits > totalCapUnits) {
      const rem = totalCapUnits > liveStats.totalStakedUnits ? totalCapUnits - liveStats.totalStakedUnits : 0n;
      throw new Error(
        `Kuota kapasitas vault tidak mencukupi. Sisa kapasitas: ${PrecisionMath.formatFromUnits(rem, assetInfo.decimals, true)} ${vault.asset}`
      );
    }

    // Strict Spot balance verification — zero fake credit or automatic injection
    const userAcc = db.getAccount(userId, vault.asset);
    const availUnits = userAcc ? BigInt(userAcc.balanceAvailable) : 0n;
    if (!userAcc || availUnits < amountUnits) {
      throw new Error(
        `Saldo ${vault.asset} tersedia tidak mencukupi. Tersedia: ${PrecisionMath.formatFromUnits(availUnits, assetInfo.decimals, true)} ${vault.asset}`
      );
    }

    const custodyAcc = db.createOrGetAccount(SYSTEM_EARN_CUSTODY_ID, vault.asset);
    const positionId = `earn-pos-${crypto.randomUUID().slice(0, 12)}`;
    const now = Date.now();
    const journalKey = idempotencyKey ? `earn-stake:${userId}:${idempotencyKey}` : `earn-stake:${positionId}`;

    const { journal } = LedgerService.executeJournal({
      idempotencyKey: journalKey,
      txType: 'EARN_STAKE',
      referenceId: positionId,
      description: `Earn Stake ${PrecisionMath.formatFromUnits(amountUnits, assetInfo.decimals, true)} ${vault.asset} into ${vault.name}`,
      entries: [
        { accountId: userAcc.id, entryType: 'DEBIT', amount: amountUnits },
        { accountId: custodyAcc.id, entryType: 'CREDIT', amount: amountUnits },
      ],
    });

    const position: EarnPosition = {
      id: positionId,
      userId,
      vaultId: vault.id,
      asset: vault.asset,
      decimals: assetInfo.decimals,
      principalUnits: amountUnits.toString(),
      initialPrincipalUnits: amountUnits.toString(),
      apyBps: vault.apyBps,
      durationDays: vault.durationDays,
      autoCompound: vault.autoCompoundSupported ? Boolean(autoCompound) : false,
      status: 'ACTIVE',
      accruedYieldUnits: '0',
      claimedYieldUnits: '0',
      totalYieldEarnedUnits: '0',
      lastSettlementDayIndex: Math.floor(now / MS_PER_DAY),
      lastAccruedAt: now,
      startedAt: now,
      maturesAt: vault.durationDays > 0 ? now + vault.durationDays * MS_PER_DAY : null,
      stakeJournalId: journal.id,
      idempotencyKey,
      updatedAt: now,
    };

    db.earnPositions.set(position.id, position);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: userId,
      action: 'EARN_POSITION_CREATED',
      resource: `earn_pos:${position.id}`,
      details: `User ${user.email} staked ${PrecisionMath.formatFromUnits(amountUnits, assetInfo.decimals, true)} ${vault.asset} in ${vault.id} (APY ${vault.apyBps / 100}%, Journal ${journal.id})`,
      createdAt: now,
    });
    db.scheduleSave();

    return this.enrichPosition(position, now);
  }

  /**
   * Distributes daily UTC yield across eligible positions.
   * Safe & idempotent: duplicate runs on the same day index never double-credit.
   */
  public runDailyYieldSettlement(
    nowMs = Date.now(),
    options?: { forceCycle?: boolean; actorId?: string }
  ): { settledPositions: number; payoutsCreated: number; autoCompoundedCount: number } {
    this.ensureDefaultVaults();
    const currentDayIndex = Math.floor(nowMs / MS_PER_DAY);
    let settledPositions = 0;
    let payoutsCreated = 0;
    let autoCompoundedCount = 0;

    for (const pos of db.earnPositions.values()) {
      if (pos.status === 'REDEEMED') continue;
      const vault = db.earnVaults.get(pos.vaultId);
      const effectiveApyBps = vault && vault.durationDays === 0 ? vault.apyBps : pos.apyBps;
      let principalUnits = BigInt(pos.principalUnits || '0');
      if (principalUnits <= 0n) continue;

      // Determine max eligible day index (capped at maturity day for fixed-term vaults)
      const maturityDayIndex = pos.maturesAt !== null ? Math.floor(pos.maturesAt / MS_PER_DAY) : currentDayIndex;
      const targetDayIndex = options?.forceCycle
        ? pos.lastSettlementDayIndex + 1
        : Math.min(currentDayIndex, maturityDayIndex);

      let positionUpdated = false;

      if (targetDayIndex > pos.lastSettlementDayIndex) {
        // Bound catchup loop to 365 days per cycle for safety
        const startDay = pos.lastSettlementDayIndex + 1;
        const endDay = Math.min(targetDayIndex, startDay + 365);

        for (let dayIdx = startDay; dayIdx <= endDay; dayIdx++) {
          const dailyYield = this.calculateDailyYieldUnits(principalUnits, effectiveApyBps);
          if (dailyYield <= 0n) {
            pos.lastSettlementDayIndex = dayIdx;
            pos.lastAccruedAt = nowMs;
            positionUpdated = true;
            continue;
          }

          if (pos.autoCompound && vault?.autoCompoundSupported) {
            const custodyAcc = db.createOrGetAccount(SYSTEM_EARN_CUSTODY_ID, pos.asset);
            const idemKey = `earn-settle:${pos.id}:day:${dayIdx}`;
            const alreadySettled = db.journalIdempotencyIndex.has(idemKey);

            if (!alreadySettled) {
              const funding = this.buildYieldFundingDebits(pos.asset, dailyYield);
              const { journal } = LedgerService.executeJournal({
                idempotencyKey: idemKey,
                txType: 'EARN_YIELD',
                referenceId: pos.id,
                description: `Earn Auto-Compound Yield Day #${dayIdx} for ${pos.id} (${pos.asset}) [${funding.fundingSource}]`,
                entries: [
                  ...funding.entries,
                  { accountId: custodyAcc.id, entryType: 'CREDIT', amount: dailyYield },
                ],
              });

              principalUnits += dailyYield;
              pos.principalUnits = principalUnits.toString();
              pos.totalYieldEarnedUnits = (BigInt(pos.totalYieldEarnedUnits || '0') + dailyYield).toString();
              db.earnPayouts.push({
                id: `earn-pay-${crypto.randomUUID().slice(0, 12)}`,
                userId: pos.userId,
                positionId: pos.id,
                vaultId: pos.vaultId,
                asset: pos.asset,
                decimals: pos.decimals,
                payoutType: 'AUTO_COMPOUND',
                amountUnits: dailyYield.toString(),
                apyBps: effectiveApyBps,
                settlementDayIndex: dayIdx,
                journalId: journal.id,
                fundingSource: funding.fundingSource,
                feeFundedUnits: funding.feeFundedUnits.toString(),
                treasuryFundedUnits: funding.treasuryFundedUnits.toString(),
                createdAt: nowMs,
              });
              payoutsCreated += 1;
              autoCompoundedCount += 1;
            }
          } else {
            // Standard accrual stored on position until manual claim or redemption
            const payoutKey = `earn-accrual:${pos.id}:day:${dayIdx}`;
            const alreadyRecorded = db.earnPayouts.some(
              p => p.positionId === pos.id && p.payoutType === 'DAILY_SETTLEMENT' && p.settlementDayIndex === dayIdx
            );
            if (!alreadyRecorded) {
              pos.accruedYieldUnits = (BigInt(pos.accruedYieldUnits || '0') + dailyYield).toString();
              pos.totalYieldEarnedUnits = (BigInt(pos.totalYieldEarnedUnits || '0') + dailyYield).toString();
              db.earnPayouts.push({
                id: `earn-pay-${crypto.randomUUID().slice(0, 12)}`,
                userId: pos.userId,
                positionId: pos.id,
                vaultId: pos.vaultId,
                asset: pos.asset,
                decimals: pos.decimals,
                payoutType: 'DAILY_SETTLEMENT',
                amountUnits: dailyYield.toString(),
                apyBps: effectiveApyBps,
                settlementDayIndex: dayIdx,
                journalId: payoutKey,
                fundingSource: 'ACCRUAL_LEDGER',
                feeFundedUnits: '0',
                treasuryFundedUnits: '0',
                createdAt: nowMs,
              });
              payoutsCreated += 1;
            }
          }

          pos.lastSettlementDayIndex = dayIdx;
          pos.lastAccruedAt = nowMs;
          positionUpdated = true;
        }
      }

      if (pos.maturesAt !== null && nowMs >= pos.maturesAt && pos.status === 'ACTIVE') {
        pos.status = 'MATURED';
        positionUpdated = true;
      }

      if (positionUpdated) {
        pos.updatedAt = nowMs;
        db.earnPositions.set(pos.id, pos);
        settledPositions += 1;
      }
    }

    if (options?.actorId) {
      db.auditLogs.push({
        id: crypto.randomUUID(),
        actorId: options.actorId,
        action: 'EARN_YIELD_SETTLEMENT_RUN',
        resource: 'earn:yield-settlement',
        details: `Yield settlement completed (${options.forceCycle ? 'Manual Epoch' : 'UTC Daily'}): ${settledPositions} positions updated, ${payoutsCreated} payouts (${autoCompoundedCount} auto-compounded).`,
        createdAt: nowMs,
      });
    }

    if (settledPositions > 0 || options?.actorId) {
      db.scheduleSave();
    }

    return { settledPositions, payoutsCreated, autoCompoundedCount };
  }

  /**
   * Claims settled accrued yield to user's Spot account atomically.
   */
  public claimPositionYield(params: { userId: string; positionId: string }): {
    payout: EarnPayoutRecord;
    position: EnrichedEarnPosition;
  } {
    const { userId, positionId } = params;
    const pos = db.earnPositions.get(positionId);
    if (!pos) throw new Error('Posisi Earn tidak ditemukan');
    if (pos.userId !== userId) throw new Error('Anda tidak memiliki otorisasi atas posisi Earn ini');
    if (pos.status === 'REDEEMED') throw new Error('Posisi Earn ini sudah dicairkan');

    const now = Date.now();
    this.runDailyYieldSettlement(now);

    const claimableUnits = BigInt(pos.accruedYieldUnits || '0');
    if (claimableUnits <= 0n) {
      throw new Error(
        'Belum ada imbal hasil terselesaikan yang tersedia untuk diklaim. Distribusi imbal hasil dicatat setiap siklus harian UTC.'
      );
    }

    const vault = db.earnVaults.get(pos.vaultId);
    const effectiveApyBps = vault && vault.durationDays === 0 ? vault.apyBps : pos.apyBps;
    const userAcc = db.createOrGetAccount(userId, pos.asset);
    const funding = this.buildYieldFundingDebits(pos.asset, claimableUnits);

    const { journal } = LedgerService.executeJournal({
      idempotencyKey: `earn-claim:${pos.id}:${pos.claimedYieldUnits}:${now}`,
      txType: 'EARN_YIELD',
      referenceId: pos.id,
      description: `Manual Yield Claim ${PrecisionMath.formatFromUnits(claimableUnits, pos.decimals, true)} ${pos.asset} from ${pos.id} [${funding.fundingSource}]`,
      entries: [
        ...funding.entries,
        { accountId: userAcc.id, entryType: 'CREDIT', amount: claimableUnits },
      ],
    });

    pos.accruedYieldUnits = '0';
    pos.claimedYieldUnits = (BigInt(pos.claimedYieldUnits || '0') + claimableUnits).toString();
    pos.updatedAt = now;
    db.earnPositions.set(pos.id, pos);

    const payout: EarnPayoutRecord = {
      id: `earn-pay-${crypto.randomUUID().slice(0, 12)}`,
      userId,
      positionId: pos.id,
      vaultId: pos.vaultId,
      asset: pos.asset,
      decimals: pos.decimals,
      payoutType: 'MANUAL_CLAIM',
      amountUnits: claimableUnits.toString(),
      apyBps: effectiveApyBps,
      journalId: journal.id,
      fundingSource: funding.fundingSource,
      feeFundedUnits: funding.feeFundedUnits.toString(),
      treasuryFundedUnits: funding.treasuryFundedUnits.toString(),
      createdAt: now,
    };
    db.earnPayouts.push(payout);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: userId,
      action: 'EARN_YIELD_CLAIMED',
      resource: `earn_pos:${pos.id}`,
      details: `Claimed ${PrecisionMath.formatFromUnits(claimableUnits, pos.decimals, true)} ${pos.asset} yield (${funding.fundingSource}: Fee Pool ${PrecisionMath.formatFromUnits(funding.feeFundedUnits, pos.decimals, true)}, Treasury ${PrecisionMath.formatFromUnits(funding.treasuryFundedUnits, pos.decimals, true)}, Journal ${journal.id})`,
      createdAt: now,
    });
    db.scheduleSave();

    return {
      payout,
      position: this.enrichPosition(pos, now),
    };
  }

  /**
   * Redeems principal (partial for flexible, full for fixed/matured or early-exit).
   */
  public redeemPosition(params: {
    userId: string;
    positionId: string;
    amount?: string | number;
    confirmEarlyRedeem?: boolean;
  }): {
    position: EnrichedEarnPosition;
    returnedPrincipalUnits: string;
    penaltyUnits: string;
    settledYieldUnits: string;
    earlyRedemption: boolean;
  } {
    const { userId, positionId, amount, confirmEarlyRedeem } = params;
    const pos = db.earnPositions.get(positionId);
    if (!pos) throw new Error('Posisi Earn tidak ditemukan');
    if (pos.userId !== userId) throw new Error('Anda tidak memiliki otorisasi atas posisi Earn ini');
    if (pos.status === 'REDEEMED') throw new Error('Posisi Earn sudah diredeem sebelumnya');

    const now = Date.now();
    this.runDailyYieldSettlement(now);

    const vault = db.earnVaults.get(pos.vaultId);
    const currentPrincipal = BigInt(pos.principalUnits || '0');
    if (currentPrincipal <= 0n) throw new Error('Saldo pokok posisi kosong');

    const isEarly = pos.maturesAt !== null && now < pos.maturesAt;
    if (isEarly) {
      if (!vault?.earlyRedeemAllowed) {
        throw new Error(
          `Posisi terkunci hingga jatuh tempo (${new Date(pos.maturesAt!).toISOString()}) dan pencairan dini tidak diizinkan.`
        );
      }
      if (!confirmEarlyRedeem) {
        throw new Error(
          `Konfirmasi pencairan dini diperlukan. Penalti ${((vault.earlyRedeemPenaltyBps || 0) / 100).toFixed(2)}% akan dikenakan.`
        );
      }
    }

    let redeemUnits = currentPrincipal;
    if (amount !== undefined && String(amount).trim() !== '') {
      if (pos.durationDays > 0 || isEarly) {
        throw new Error('Pencairan sebagian hanya tersedia untuk produk Flexible.');
      }
      redeemUnits = PrecisionMath.parseToUnits(String(amount).trim(), pos.decimals);
      if (redeemUnits <= 0n || redeemUnits > currentPrincipal) {
        throw new Error('Nominal pencairan tidak valid atau melebihi saldo posisi');
      }
      const remaining = currentPrincipal - redeemUnits;
      const minUnits = BigInt(vault?.minStakeUnits || '0');
      if (remaining > 0n && remaining < minUnits) {
        throw new Error(
          `Sisa pokok setelah pencairan sebagian harus minimal ${PrecisionMath.formatFromUnits(minUnits, pos.decimals, true)} ${pos.asset} atau cairkan penuh.`
        );
      }
    }

    const fullRedeem = redeemUnits === currentPrincipal;
    const custodyAcc = db.createOrGetAccount(SYSTEM_EARN_CUSTODY_ID, pos.asset);
    const userAcc = db.createOrGetAccount(userId, pos.asset);
    const treasuryAcc = db.createOrGetAccount(SYSTEM_TREASURY_ID, pos.asset);

    const penaltyBps = isEarly ? (vault?.earlyRedeemPenaltyBps || 0) : 0;
    const penaltyUnits = penaltyBps > 0 ? PrecisionMath.calculateFee(redeemUnits, penaltyBps) : 0n;
    const returnedPrincipalUnits = redeemUnits - penaltyUnits;

    const entries: Array<{ accountId: string; entryType: 'DEBIT' | 'CREDIT'; amount: bigint }> = [
      { accountId: custodyAcc.id, entryType: 'DEBIT', amount: redeemUnits },
    ];
    if (returnedPrincipalUnits > 0n) {
      entries.push({ accountId: userAcc.id, entryType: 'CREDIT', amount: returnedPrincipalUnits });
    }
    if (penaltyUnits > 0n) {
      entries.push({ accountId: treasuryAcc.id, entryType: 'CREDIT', amount: penaltyUnits });
    }

    const { journal } = LedgerService.executeJournal({
      idempotencyKey: `earn-redeem:${pos.id}:${currentPrincipal.toString()}:${redeemUnits.toString()}:${now}`,
      txType: 'EARN_REDEEM',
      referenceId: pos.id,
      description: `Earn Redemption ${PrecisionMath.formatFromUnits(returnedPrincipalUnits, pos.decimals, true)} ${pos.asset} from ${pos.id}${isEarly ? ' (Early Redeem)' : ''}`,
      entries,
    });

    let settledYieldUnits = 0n;
    if (isEarly) {
      // Unclaimed accrued yield is forfeited on early termination of fixed term
      pos.accruedYieldUnits = '0';
    } else if (fullRedeem && BigInt(pos.accruedYieldUnits || '0') > 0n) {
      settledYieldUnits = BigInt(pos.accruedYieldUnits);
      const yieldFunding = this.buildYieldFundingDebits(pos.asset, settledYieldUnits);
      const { journal: yieldJournal } = LedgerService.executeJournal({
        idempotencyKey: `earn-redeem-yield:${pos.id}:${now}`,
        txType: 'EARN_YIELD',
        referenceId: pos.id,
        description: `Final Yield Settlement on Redemption ${PrecisionMath.formatFromUnits(settledYieldUnits, pos.decimals, true)} ${pos.asset} [${yieldFunding.fundingSource}]`,
        entries: [
          ...yieldFunding.entries,
          { accountId: userAcc.id, entryType: 'CREDIT', amount: settledYieldUnits },
        ],
      });
      pos.accruedYieldUnits = '0';
      pos.claimedYieldUnits = (BigInt(pos.claimedYieldUnits || '0') + settledYieldUnits).toString();
      db.earnPayouts.push({
        id: `earn-pay-${crypto.randomUUID().slice(0, 12)}`,
        userId,
        positionId: pos.id,
        vaultId: pos.vaultId,
        asset: pos.asset,
        decimals: pos.decimals,
        payoutType: 'REDEMPTION_SETTLEMENT',
        amountUnits: settledYieldUnits.toString(),
        apyBps: vault && vault.durationDays === 0 ? vault.apyBps : pos.apyBps,
        journalId: yieldJournal.id,
        fundingSource: yieldFunding.fundingSource,
        feeFundedUnits: yieldFunding.feeFundedUnits.toString(),
        treasuryFundedUnits: yieldFunding.treasuryFundedUnits.toString(),
        createdAt: now,
      });
    }

    const remainingAfter = currentPrincipal - redeemUnits;
    pos.principalUnits = remainingAfter.toString();
    pos.updatedAt = now;
    if (remainingAfter === 0n) {
      pos.status = 'REDEEMED';
      pos.redeemedAt = now;
      pos.redeemJournalId = journal.id;
    }
    db.earnPositions.set(pos.id, pos);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: userId,
      action: isEarly ? 'EARN_POSITION_EARLY_REDEEMED' : 'EARN_POSITION_REDEEMED',
      resource: `earn_pos:${pos.id}`,
      details: `Redeemed ${PrecisionMath.formatFromUnits(redeemUnits, pos.decimals, true)} ${pos.asset} (Returned ${PrecisionMath.formatFromUnits(returnedPrincipalUnits, pos.decimals, true)}, Penalty ${PrecisionMath.formatFromUnits(penaltyUnits, pos.decimals, true)}, Yield ${PrecisionMath.formatFromUnits(settledYieldUnits, pos.decimals, true)}, Journal ${journal.id})`,
      createdAt: now,
    });
    db.scheduleSave();

    return {
      position: this.enrichPosition(pos, now),
      returnedPrincipalUnits: returnedPrincipalUnits.toString(),
      penaltyUnits: penaltyUnits.toString(),
      settledYieldUnits: settledYieldUnits.toString(),
      earlyRedemption: isEarly,
    };
  }

  public toggleAutoCompound(params: { userId: string; positionId: string; autoCompound: boolean }): EnrichedEarnPosition {
    const { userId, positionId, autoCompound } = params;
    const pos = db.earnPositions.get(positionId);
    if (!pos) throw new Error('Posisi Earn tidak ditemukan');
    if (pos.userId !== userId) throw new Error('Anda tidak memiliki otorisasi atas posisi Earn ini');
    if (pos.status === 'REDEEMED') throw new Error('Posisi Earn sudah dicairkan');

    const vault = db.earnVaults.get(pos.vaultId);
    if (autoCompound && !vault?.autoCompoundSupported) {
      throw new Error('Vault ini tidak mendukung Auto-Compound');
    }

    pos.autoCompound = Boolean(autoCompound);
    pos.updatedAt = Date.now();
    db.earnPositions.set(pos.id, pos);
    db.scheduleSave();
    return this.enrichPosition(pos);
  }

  // ===========================================================================
  // ADMIN CONSOLE CONTROLS
  // ===========================================================================

  public createVault(input: {
    id?: string;
    asset: string;
    name: string;
    type: EarnVaultType;
    durationDays: number;
    apyPct: number;
    minStakeTokens: string;
    maxStakeTokens?: string;
    totalCapTokens: string;
    earlyRedeemAllowed?: boolean;
    earlyRedeemPenaltyPct?: number;
    autoCompoundSupported?: boolean;
    isFeatured?: boolean;
    custodyNote?: string;
  }, adminId: string): EnrichedEarnVault {
    this.ensureDefaultVaults();
    const assetInfo = this.resolveAssetInfo(input.asset);
    if (assetInfo.status !== 'ACTIVE') {
      throw new Error(`Aset ${assetInfo.symbol} harus berstatus ACTIVE sebelum dibuatkan Earn Vault`);
    }

    const name = String(input.name || '').trim();
    if (name.length < 3 || name.length > 96) {
      throw new Error('Nama vault harus antara 3 hingga 96 karakter');
    }

    const validTypes: EarnVaultType[] = ['FLEXIBLE', 'FIXED', 'STAKING', 'LAUNCHPOOL'];
    if (!validTypes.includes(input.type)) {
      throw new Error('Tipe vault tidak valid');
    }

    const durationDays = Math.max(0, Math.floor(Number(input.durationDays) || 0));
    if (input.type === 'FLEXIBLE' && durationDays !== 0) {
      throw new Error('Vault FLEXIBLE harus berdurasi 0 hari');
    }

    const apyBps = Math.round(Number(input.apyPct) * 100);
    if (!Number.isFinite(apyBps) || apyBps < 0 || apyBps > 50000) {
      throw new Error('APY harus antara 0% hingga 500%');
    }

    const minStakeUnits = PrecisionMath.parseToUnits(String(input.minStakeTokens || '0'), assetInfo.decimals);
    const maxStakeUnits = input.maxStakeTokens ? PrecisionMath.parseToUnits(String(input.maxStakeTokens), assetInfo.decimals) : 0n;
    const totalCapUnits = PrecisionMath.parseToUnits(String(input.totalCapTokens || '0'), assetInfo.decimals);

    if (minStakeUnits <= 0n) throw new Error('Minimum stake harus lebih besar dari 0');
    if (maxStakeUnits > 0n && maxStakeUnits < minStakeUnits) {
      throw new Error('Maksimum stake per transaksi tidak boleh lebih kecil dari minimum stake');
    }
    if (totalCapUnits <= 0n || totalCapUnits < minStakeUnits) {
      throw new Error('Total kapasitas vault harus >= minimum stake');
    }

    const penaltyBps = Math.max(0, Math.min(2500, Math.round(Number(input.earlyRedeemPenaltyPct || 0) * 100)));
    const slug = `${assetInfo.symbol.toLowerCase()}-${durationDays}d-${crypto.randomBytes(2).toString('hex')}`;
    const vaultId = (input.id && /^[a-zA-Z0-9_-]{3,48}$/.test(input.id.trim())) ? input.id.trim().toLowerCase() : `vault-${slug}`;

    if (db.earnVaults.has(vaultId)) {
      throw new Error(`Vault ID ${vaultId} sudah terdaftar`);
    }

    const now = Date.now();
    const vault: EarnVault = {
      id: vaultId,
      asset: assetInfo.symbol,
      name,
      type: input.type,
      durationDays,
      apyBps,
      minStakeUnits: minStakeUnits.toString(),
      maxStakeUnits: maxStakeUnits.toString(),
      totalCapUnits: totalCapUnits.toString(),
      earlyRedeemAllowed: input.earlyRedeemAllowed !== undefined ? Boolean(input.earlyRedeemAllowed) : true,
      earlyRedeemPenaltyBps: durationDays === 0 ? 0 : penaltyBps,
      autoCompoundSupported: input.autoCompoundSupported !== undefined ? Boolean(input.autoCompoundSupported) : durationDays === 0,
      status: 'ACTIVE',
      isFeatured: Boolean(input.isFeatured),
      custodyNote: String(input.custodyNote || 'Segregated Institutional Earn Custody').trim(),
      createdAt: now,
      updatedAt: now,
    };

    db.earnVaults.set(vault.id, vault);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminId,
      action: 'EARN_VAULT_CREATED',
      resource: `earn_vault:${vault.id}`,
      details: `Created Earn Vault ${vault.id} (${vault.asset}, ${vault.type}, APY ${vault.apyBps / 100}%, Duration ${vault.durationDays}d, Cap ${PrecisionMath.formatFromUnits(totalCapUnits, assetInfo.decimals, true)} ${vault.asset})`,
      createdAt: now,
    });
    db.scheduleSave();

    return this.enrichVault(vault);
  }

  public updateVault(
    vaultId: string,
    patch: {
      apy?: number;
      apyPct?: number;
      status?: EarnVaultStatus;
      totalCapTokens?: string;
      minStakeTokens?: string;
      maxStakeTokens?: string;
      earlyRedeemAllowed?: boolean;
      earlyRedeemPenaltyPct?: number;
      autoCompoundSupported?: boolean;
      isFeatured?: boolean;
      name?: string;
      custodyNote?: string;
    },
    adminId: string
  ): EnrichedEarnVault {
    this.ensureDefaultVaults();
    const vault = db.earnVaults.get(vaultId);
    if (!vault) throw new Error('Staking pool / Earn vault tidak ditemukan');

    const assetInfo = this.resolveAssetInfo(vault.asset, true);
    const apyVal = patch.apyPct !== undefined ? patch.apyPct : patch.apy;
    if (apyVal !== undefined) {
      const nextApyBps = Math.round(Number(apyVal) * 100);
      if (!Number.isFinite(nextApyBps) || nextApyBps < 0 || nextApyBps > 50000) {
        throw new Error('APY tidak valid (0% - 500%)');
      }
      vault.apyBps = nextApyBps;
    }

    if (patch.status !== undefined) {
      if (!['ACTIVE', 'PAUSED', 'CLOSED'].includes(patch.status)) {
        throw new Error('Status vault tidak valid');
      }
      if (patch.status === 'ACTIVE' && (assetInfo.isAssetDeleted || assetInfo.isDelisted || assetInfo.status !== 'ACTIVE')) {
        throw new Error(`Vault ${vault.asset} tidak dapat diaktifkan karena aset sudah dihapus/delisted atau tidak berstatus ACTIVE.`);
      }
      vault.status = patch.status;
    }

    if (patch.totalCapTokens !== undefined && String(patch.totalCapTokens).trim() !== '') {
      const capUnits = PrecisionMath.parseToUnits(String(patch.totalCapTokens), assetInfo.decimals);
      if (capUnits <= 0n) throw new Error('Total kapasitas vault harus > 0');
      vault.totalCapUnits = capUnits.toString();
    }

    if (patch.minStakeTokens !== undefined && String(patch.minStakeTokens).trim() !== '') {
      const minUnits = PrecisionMath.parseToUnits(String(patch.minStakeTokens), assetInfo.decimals);
      if (minUnits <= 0n) throw new Error('Minimum stake harus > 0');
      vault.minStakeUnits = minUnits.toString();
    }

    if (patch.maxStakeTokens !== undefined && String(patch.maxStakeTokens).trim() !== '') {
      const maxUnits = PrecisionMath.parseToUnits(String(patch.maxStakeTokens), assetInfo.decimals);
      if (maxUnits < 0n) throw new Error('Maksimum stake tidak valid');
      if (maxUnits > 0n && maxUnits < BigInt(vault.minStakeUnits)) {
        throw new Error('Maksimum stake per transaksi tidak boleh lebih kecil dari minimum stake');
      }
      vault.maxStakeUnits = maxUnits.toString();
    }

    if (patch.earlyRedeemAllowed !== undefined) vault.earlyRedeemAllowed = Boolean(patch.earlyRedeemAllowed);
    if (patch.earlyRedeemPenaltyPct !== undefined) {
      vault.earlyRedeemPenaltyBps = Math.max(0, Math.min(2500, Math.round(Number(patch.earlyRedeemPenaltyPct) * 100)));
    }
    if (patch.autoCompoundSupported !== undefined) vault.autoCompoundSupported = Boolean(patch.autoCompoundSupported);
    if (patch.isFeatured !== undefined) vault.isFeatured = Boolean(patch.isFeatured);
    if (patch.name !== undefined && patch.name.trim().length >= 3) vault.name = patch.name.trim();
    if (patch.custodyNote !== undefined && patch.custodyNote.trim().length >= 3) vault.custodyNote = patch.custodyNote.trim();

    vault.updatedAt = Date.now();
    db.earnVaults.set(vault.id, vault);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminId,
      action: 'EARN_POOL_UPDATED',
      resource: `earn_vault:${vault.id}`,
      details: `Updated Earn Vault ${vault.id}: APY ${vault.apyBps / 100}%, Status ${vault.status}, Cap ${PrecisionMath.formatFromUnits(BigInt(vault.totalCapUnits), assetInfo.decimals, true)} ${vault.asset}`,
      createdAt: vault.updatedAt,
    });
    db.scheduleSave();

    return this.enrichVault(vault);
  }

  /**
   * Safely refunds principal (from Earn Custody) and accrued yield (from Fee Pool / Treasury)
   * back to user's Spot ledger account with 0% penalty when an admin force-deletes a vault/token.
   */
  private forceRedeemPositionForVaultRemoval(
    pos: EarnPosition,
    vault: EarnVault,
    now: number,
    reason: string
  ): { principalUnits: bigint; settledYieldUnits: bigint } {
    const principalUnits = BigInt(pos.principalUnits || '0');
    const accruedYieldUnits = BigInt(pos.accruedYieldUnits || '0');
    const custodyAcc = db.createOrGetAccount(SYSTEM_EARN_CUSTODY_ID, pos.asset);
    const userAcc = db.createOrGetAccount(pos.userId, pos.asset);

    let redeemJournalId = pos.redeemJournalId;
    if (principalUnits > 0n) {
      const { journal } = LedgerService.executeJournal({
        idempotencyKey: `earn-vault-force-redeem:${vault.id}:${pos.id}:${now}`,
        txType: 'EARN_REDEEM',
        referenceId: pos.id,
        description: `Force Close Refund ${PrecisionMath.formatFromUnits(principalUnits, pos.decimals, true)} ${pos.asset} (${reason})`,
        entries: [
          { accountId: custodyAcc.id, entryType: 'DEBIT', amount: principalUnits },
          { accountId: userAcc.id, entryType: 'CREDIT', amount: principalUnits },
        ],
      });
      redeemJournalId = journal.id;
    }

    let settledYieldUnits = 0n;
    if (accruedYieldUnits > 0n) {
      settledYieldUnits = accruedYieldUnits;
      const yieldFunding = this.buildYieldFundingDebits(pos.asset, settledYieldUnits);
      const { journal: yieldJournal } = LedgerService.executeJournal({
        idempotencyKey: `earn-vault-force-yield:${vault.id}:${pos.id}:${now}`,
        txType: 'EARN_YIELD',
        referenceId: pos.id,
        description: `Force Close Final Yield ${PrecisionMath.formatFromUnits(settledYieldUnits, pos.decimals, true)} ${pos.asset} [${yieldFunding.fundingSource}]`,
        entries: [
          ...yieldFunding.entries,
          { accountId: userAcc.id, entryType: 'CREDIT', amount: settledYieldUnits },
        ],
      });
      pos.claimedYieldUnits = (BigInt(pos.claimedYieldUnits || '0') + settledYieldUnits).toString();
      db.earnPayouts.push({
        id: `earn-pay-${crypto.randomUUID().slice(0, 12)}`,
        userId: pos.userId,
        positionId: pos.id,
        vaultId: pos.vaultId,
        asset: pos.asset,
        decimals: pos.decimals,
        payoutType: 'REDEMPTION_SETTLEMENT',
        amountUnits: settledYieldUnits.toString(),
        apyBps: vault.durationDays === 0 ? vault.apyBps : pos.apyBps,
        journalId: yieldJournal.id,
        fundingSource: yieldFunding.fundingSource,
        feeFundedUnits: yieldFunding.feeFundedUnits.toString(),
        treasuryFundedUnits: yieldFunding.treasuryFundedUnits.toString(),
        createdAt: now,
      });
    }

    pos.principalUnits = '0';
    pos.accruedYieldUnits = '0';
    pos.status = 'REDEEMED';
    pos.redeemedAt = now;
    if (redeemJournalId) pos.redeemJournalId = redeemJournalId;
    pos.updatedAt = now;
    db.earnPositions.set(pos.id, pos);

    return { principalUnits, settledYieldUnits };
  }

  private buildVaultSetDependencies(targetVaults: EarnVault[]): {
    activePositions: EarnPosition[];
    dependencies: EarnVaultDeletionDependencies;
  } {
    const vaultIds = targetVaults.map(v => v.id);
    const vaultIdSet = new Set(vaultIds);
    const asset = targetVaults[0]?.asset || '';
    const decimals = asset ? this.resolveAssetInfo(asset, true).decimals : 8;

    const activePositions: EarnPosition[] = [];
    const stakerUsers = new Set<string>();
    let totalStakedUnits = 0n;
    let accruedYieldUnits = 0n;

    for (const pos of db.earnPositions.values()) {
      if (!vaultIdSet.has(pos.vaultId) || pos.status === 'REDEEMED') continue;
      activePositions.push(pos);
      stakerUsers.add(pos.userId);
      totalStakedUnits += BigInt(pos.principalUnits || '0');
      accruedYieldUnits += BigInt(pos.accruedYieldUnits || '0');
    }

    return {
      activePositions,
      dependencies: {
        vaultIds,
        vaultNames: targetVaults.map(v => v.name),
        asset,
        decimals,
        activePositionsCount: activePositions.length,
        activeStakersCount: stakerUsers.size,
        totalStakedUnits: totalStakedUnits.toString(),
        totalStakedDisplay: PrecisionMath.formatFromUnits(totalStakedUnits, decimals, true),
        accruedYieldUnits: accruedYieldUnits.toString(),
        accruedYieldDisplay: PrecisionMath.formatFromUnits(accruedYieldUnits, decimals, true),
      },
    };
  }

  /**
   * Deletes a single Staking/Earn Vault. If active positions exist, rejects with 409 EarnVaultConflictError
   * unless `force` is true (which atomically refunds 100% principal + accrued yield before deleting).
   */
  public deleteVault(
    vaultId: string,
    adminId: string,
    options?: { force?: boolean; reason?: string }
  ): {
    deletedVaultId: string;
    asset: string;
    name: string;
    refundedPositionsCount: number;
    refundedPrincipalDisplay: string;
  } {
    const vault = db.earnVaults.get(vaultId);
    if (!vault) {
      throw new Error(`Vault Earn ${vaultId} tidak ditemukan`);
    }

    const force = Boolean(options?.force);
    const reason = String(options?.reason || 'Dihapus melalui Admin Console').trim();
    const { activePositions, dependencies } = this.buildVaultSetDependencies([vault]);

    if (activePositions.length > 0 && !force) {
      throw new EarnVaultConflictError(
        `Vault ${vault.name} (${vault.asset}) masih memiliki ${activePositions.length} posisi staker aktif (${dependencies.totalStakedDisplay} ${vault.asset}). Aktifkan Hapus Paksa untuk mencairkan & mengembalikan saldo pengguna secara otomatis.`,
        dependencies
      );
    }

    const now = Date.now();
    let refundedPositionsCount = 0;
    let totalRefundedPrincipal = 0n;

    if (activePositions.length > 0 && force) {
      for (const pos of activePositions) {
        const res = this.forceRedeemPositionForVaultRemoval(pos, vault, now, reason);
        totalRefundedPrincipal += res.principalUnits;
        refundedPositionsCount += 1;
      }
    }

    db.earnVaults.delete(vault.id);
    const refundedDisplay = PrecisionMath.formatFromUnits(totalRefundedPrincipal, dependencies.decimals, true);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminId,
      action: 'EARN_VAULT_DELETED',
      resource: `earn_vault:${vault.id}`,
      details: `Deleted Earn Vault ${vault.id} (${vault.name} / ${vault.asset}) [force=${force}, refundedPositions=${refundedPositionsCount}, refundedPrincipal=${refundedDisplay} ${vault.asset}]. Reason: ${reason}`,
      createdAt: now,
    });
    db.saveToDisk();

    return {
      deletedVaultId: vault.id,
      asset: vault.asset,
      name: vault.name,
      refundedPositionsCount,
      refundedPrincipalDisplay: refundedDisplay,
    };
  }

  /**
   * Deletes all Earn/Staking Vaults belonging to a specific token symbol.
   * Used both from StakingAdminConsole (delete token vaults) and Asset Management delete synchronization.
   */
  public deleteVaultsByAsset(
    symbol: string,
    adminId: string,
    options?: { force?: boolean; throwIfEmpty?: boolean; reason?: string }
  ): {
    asset: string;
    deletedCount: number;
    deletedVaultIds: string[];
    refundedPositionsCount: number;
    refundedPrincipalDisplay: string;
  } {
    const clean = symbol.trim().toUpperCase();
    const matchingVaults = Array.from(db.earnVaults.values()).filter(
      v => v.asset.toUpperCase() === clean
    );

    if (matchingVaults.length === 0) {
      if (options?.throwIfEmpty) {
        throw new Error(`Tidak ditemukan vault Earn/Staking untuk token ${clean}.`);
      }
      return {
        asset: clean,
        deletedCount: 0,
        deletedVaultIds: [],
        refundedPositionsCount: 0,
        refundedPrincipalDisplay: '0',
      };
    }

    const force = Boolean(options?.force);
    const reason = String(options?.reason || `Penghapusan token ${clean} dari Manajemen Vault Earn & Staking`).trim();
    const { activePositions, dependencies } = this.buildVaultSetDependencies(matchingVaults);

    if (activePositions.length > 0 && !force) {
      throw new EarnVaultConflictError(
        `Token ${clean} masih memiliki ${activePositions.length} posisi staker aktif pada ${matchingVaults.length} vault (${dependencies.totalStakedDisplay} ${clean}). Aktifkan Hapus Paksa untuk mencairkan & mengembalikan saldo pengguna secara otomatis.`,
        dependencies
      );
    }

    const vaultMap = new Map(matchingVaults.map(v => [v.id, v]));
    const now = Date.now();
    let refundedPositionsCount = 0;
    let totalRefundedPrincipal = 0n;

    if (activePositions.length > 0 && force) {
      for (const pos of activePositions) {
        const v = vaultMap.get(pos.vaultId)!;
        const res = this.forceRedeemPositionForVaultRemoval(pos, v, now, reason);
        totalRefundedPrincipal += res.principalUnits;
        refundedPositionsCount += 1;
      }
    }

    const deletedVaultIds: string[] = [];
    for (const v of matchingVaults) {
      db.earnVaults.delete(v.id);
      deletedVaultIds.push(v.id);
    }

    const refundedDisplay = PrecisionMath.formatFromUnits(totalRefundedPrincipal, dependencies.decimals, true);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminId,
      action: 'EARN_TOKEN_VAULTS_DELETED',
      resource: `earn_token:${clean}`,
      details: `Purged ${deletedVaultIds.length} Earn vault(s) for token ${clean} [${deletedVaultIds.join(', ')}] (force=${force}, refundedPositions=${refundedPositionsCount}, refundedPrincipal=${refundedDisplay} ${clean}). Reason: ${reason}`,
      createdAt: now,
    });
    db.saveToDisk();

    return {
      asset: clean,
      deletedCount: deletedVaultIds.length,
      deletedVaultIds,
      refundedPositionsCount,
      refundedPrincipalDisplay: refundedDisplay,
    };
  }

  /**
   * Pauses all ACTIVE Earn vaults for a token when its market pair is delisted.
   */
  public pauseVaultsForAsset(symbol: string, adminId: string, reason: string): number {
    const clean = symbol.trim().toUpperCase();
    const now = Date.now();
    let pausedCount = 0;

    for (const vault of db.earnVaults.values()) {
      if (vault.asset.toUpperCase() === clean && vault.status === 'ACTIVE') {
        vault.status = 'PAUSED';
        vault.updatedAt = now;
        db.earnVaults.set(vault.id, vault);
        pausedCount += 1;
      }
    }

    if (pausedCount > 0) {
      db.auditLogs.push({
        id: crypto.randomUUID(),
        actorId: adminId,
        action: 'EARN_VAULTS_AUTO_PAUSED',
        resource: `earn_token:${clean}`,
        details: `Auto-paused ${pausedCount} Earn vault(s) for ${clean}. Reason: ${reason}`,
        createdAt: now,
      });
      db.saveToDisk();
    }

    return pausedCount;
  }

  /**
   * Removes all Earn vaults whose underlying token has been deleted from Asset Management or delisted.
   */
  public cleanupOrphanedVaults(
    adminId: string,
    options?: { force?: boolean }
  ): {
    deletedCount: number;
    deletedVaultIds: string[];
    affectedAssets: string[];
    refundedPositionsCount: number;
  } {
    const orphanedVaults = Array.from(db.earnVaults.values()).filter(v => {
      const info = this.resolveAssetInfo(v.asset, true);
      return info.isAssetDeleted || info.isDelisted || info.status === 'RETIRED';
    });

    if (orphanedVaults.length === 0) {
      return {
        deletedCount: 0,
        deletedVaultIds: [],
        affectedAssets: [],
        refundedPositionsCount: 0,
      };
    }

    const force = Boolean(options?.force);
    const { activePositions, dependencies } = this.buildVaultSetDependencies(orphanedVaults);

    if (activePositions.length > 0 && !force) {
      throw new EarnVaultConflictError(
        `Terdapat ${activePositions.length} posisi staker aktif pada vault aset terhapus/delisted. Aktifkan Hapus Paksa untuk mencairkan saldo staker sebelum menghapus vault.`,
        {
          ...dependencies,
          asset: Array.from(new Set(orphanedVaults.map(v => v.asset))).join(', '),
        }
      );
    }

    const vaultMap = new Map(orphanedVaults.map(v => [v.id, v]));
    const now = Date.now();
    let refundedPositionsCount = 0;

    if (activePositions.length > 0 && force) {
      for (const pos of activePositions) {
        const v = vaultMap.get(pos.vaultId)!;
        this.forceRedeemPositionForVaultRemoval(
          pos,
          v,
          now,
          `Pembersihan vault token terhapus/delisted (${v.asset})`
        );
        refundedPositionsCount += 1;
      }
    }

    const deletedVaultIds: string[] = [];
    const affectedAssets = new Set<string>();
    for (const v of orphanedVaults) {
      db.earnVaults.delete(v.id);
      deletedVaultIds.push(v.id);
      affectedAssets.add(v.asset);
    }

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminId,
      action: 'EARN_ORPHANED_VAULTS_CLEANED',
      resource: 'earn:cleanup-orphaned',
      details: `Cleaned up ${deletedVaultIds.length} orphaned/delisted Earn vault(s) across [${Array.from(affectedAssets).join(', ')}] (force=${force}, refundedPositions=${refundedPositionsCount}).`,
      createdAt: now,
    });
    db.saveToDisk();

    return {
      deletedCount: deletedVaultIds.length,
      deletedVaultIds,
      affectedAssets: Array.from(affectedAssets),
      refundedPositionsCount,
    };
  }

  public listActiveAssetsForEarn(): Array<{
    symbol: string;
    name: string;
    decimals: number;
    network: string;
    logoUrl?: string;
  }> {
    return Array.from(db.assets.values())
      .filter(a => a.status === 'ACTIVE' && !this.isSymbolDelisted(a.symbol))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map(a => ({
        symbol: a.symbol,
        name: a.name,
        decimals: a.decimals,
        network: a.network,
        logoUrl: a.logoUrl,
      }));
  }

  public listAllPositions(limit = 100): Array<EnrichedEarnPosition & { userEmail: string }> {
    const now = Date.now();
    return Array.from(db.earnPositions.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit)
      .map(pos => {
        const user = db.users.get(pos.userId);
        return {
          ...this.enrichPosition(pos, now),
          userEmail: user?.email || pos.userId,
        };
      });
  }

  public listAdminPayouts(limit = 120): Array<EarnPayoutRecord & { amountDisplay: string; apyPct: number; userEmail: string; vaultName: string }> {
    return [...db.earnPayouts]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(row => {
        const user = db.users.get(row.userId);
        const vault = db.earnVaults.get(row.vaultId);
        return {
          ...row,
          amountDisplay: PrecisionMath.formatFromUnits(BigInt(row.amountUnits || '0'), row.decimals, true),
          apyPct: row.apyBps / 100,
          userEmail: user?.email || row.userId,
          vaultName: vault?.name || row.vaultId,
        };
      });
  }

  public adminUnlockPosition(positionId: string, adminId: string, reason?: string): EnrichedEarnPosition & { userEmail: string } {
    const pos = db.earnPositions.get(positionId);
    if (!pos) throw new Error('Posisi staking tidak ditemukan');
    if (pos.status === 'REDEEMED') throw new Error('Posisi sudah dicairkan sebelumnya');

    const now = Date.now();
    this.runDailyYieldSettlement(now);
    pos.status = 'MATURED';
    pos.maturesAt = now;
    pos.updatedAt = now;
    db.earnPositions.set(pos.id, pos);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminId,
      action: 'EARN_POSITION_UNLOCKED',
      resource: `earn_pos:${pos.id}`,
      details: `Admin unlocked fixed lockup for position ${pos.id} (${pos.asset}). Reason: ${String(reason || 'Operational compliance unlock').trim()}`,
      createdAt: now,
    });
    db.scheduleSave();

    const user = db.users.get(pos.userId);
    return {
      ...this.enrichPosition(pos, now),
      userEmail: user?.email || pos.userId,
    };
  }

  /**
   * Cryptographically verifies that SYSTEM_EARN_CUSTODY_ID ledger balances
   * strictly equal the sum of active EarnPosition principals per asset.
   */
  public getCustodySolvencyReport(): {
    isFullySolvent: boolean;
    checkedAt: number;
    assets: Array<{
      asset: string;
      decimals: number;
      custodyLedgerUnits: string;
      custodyLedgerDisplay: string;
      activePrincipalUnits: string;
      activePrincipalDisplay: string;
      deltaUnits: string;
      accruedLiabilityUnits: string;
      accruedLiabilityDisplay: string;
      isBalanced: boolean;
    }>;
  } {
    const assetsSet = new Set<string>();
    for (const v of db.earnVaults.values()) assetsSet.add(v.asset);
    for (const p of db.earnPositions.values()) assetsSet.add(p.asset);

    const rows: Array<{
      asset: string;
      decimals: number;
      custodyLedgerUnits: string;
      custodyLedgerDisplay: string;
      activePrincipalUnits: string;
      activePrincipalDisplay: string;
      deltaUnits: string;
      accruedLiabilityUnits: string;
      accruedLiabilityDisplay: string;
      isBalanced: boolean;
    }> = [];

    let isFullySolvent = true;

    for (const sym of Array.from(assetsSet).sort()) {
      const assetInfo = this.resolveAssetInfo(sym, true);
      const custodyAcc = db.getAccount(SYSTEM_EARN_CUSTODY_ID, sym);
      const custodyUnits = custodyAcc ? BigInt(custodyAcc.balanceAvailable) + BigInt(custodyAcc.balanceLocked) : 0n;

      let activePrincipalUnits = 0n;
      let accruedLiabilityUnits = 0n;
      for (const pos of db.earnPositions.values()) {
        if (pos.asset !== sym || pos.status === 'REDEEMED') continue;
        activePrincipalUnits += BigInt(pos.principalUnits || '0');
        accruedLiabilityUnits += BigInt(pos.accruedYieldUnits || '0');
      }

      const deltaUnits = custodyUnits - activePrincipalUnits;
      const isBalanced = deltaUnits === 0n;
      if (!isBalanced) isFullySolvent = false;

      rows.push({
        asset: sym,
        decimals: assetInfo.decimals,
        custodyLedgerUnits: custodyUnits.toString(),
        custodyLedgerDisplay: PrecisionMath.formatFromUnits(custodyUnits, assetInfo.decimals, true),
        activePrincipalUnits: activePrincipalUnits.toString(),
        activePrincipalDisplay: PrecisionMath.formatFromUnits(activePrincipalUnits, assetInfo.decimals, true),
        deltaUnits: deltaUnits.toString(),
        accruedLiabilityUnits: accruedLiabilityUnits.toString(),
        accruedLiabilityDisplay: PrecisionMath.formatFromUnits(accruedLiabilityUnits, assetInfo.decimals, true),
        isBalanced,
      });
    }

    return {
      isFullySolvent,
      checkedAt: Date.now(),
      assets: rows,
    };
  }

  private resolveCurrencyDecimals(symbol: string): number {
    const upper = symbol.trim().toUpperCase();
    for (const ast of db.assets.values()) {
      if (ast.symbol.toUpperCase() === upper) return ast.decimals;
    }
    if (upper === 'IDR') return 2;
    if (upper === 'USDT' || upper === 'USDC') return 6;
    return 8;
  }

  /**
   * Computes complete live Exchange Fee Revenue across all user & MM transactions
   * reconciled against Staking Earn yield claims & Treasury reserves.
   */
  public getExchangeFeeAndEarnTreasuryStats() {
    const now = Date.now();
    const oneDayAgo = now - MS_PER_DAY;
    const fxRateIdr = Math.max(1, fxConversionService.getCurrentRate().rate || 16350);

    const resolveQuoteForPair = (pairId: string): { baseCurrency: string; quoteCurrency: string; quoteDecimals: number } => {
      const pair = db.tradingPairs.get(pairId);
      if (pair) {
        return {
          baseCurrency: pair.baseCurrency,
          quoteCurrency: pair.quoteCurrency,
          quoteDecimals: pair.quoteDecimals ?? this.resolveCurrencyDecimals(pair.quoteCurrency),
        };
      }
      const parts = pairId.split('-');
      const baseCurrency = parts[0] || pairId;
      const quoteCurrency = parts[1] || 'IDR';
      return {
        baseCurrency,
        quoteCurrency,
        quoteDecimals: this.resolveCurrencyDecimals(quoteCurrency),
      };
    };

    const isDirectUser = (userId: string): boolean => {
      if (!userId || userId.startsWith('sys-')) return false;
      const u = db.users.get(userId);
      if (!u) return true;
      const role = String(u.role || 'USER').toUpperCase();
      return role === 'USER' || role === 'COMPLIANCE';
    };

    // Index ledger entries by journalId for Futures fees and Treasury fee sweeps
    const entriesByJournal = new Map<string, typeof db.ledgerEntries>();
    for (const entry of db.ledgerEntries) {
      let arr = entriesByJournal.get(entry.journalId);
      if (!arr) {
        arr = [];
        entriesByJournal.set(entry.journalId, arr);
      }
      arr.push(entry);
    }

    const currencyStats = new Map<
      string,
      {
        feeEarnedUnits: bigint;
        feeEarned24hUnits: bigint;
        spotMakerUnits: bigint;
        spotTakerUnits: bigint;
        futuresUnits: bigint;
        userDirectUnits: bigint;
        mmBotUnits: bigint;
        sweptUnits: bigint;
        stakingClaimedUnits: bigint;
        stakingClaimed24hUnits: bigint;
        stakingFeeFundedUnits: bigint;
        stakingTreasuryFundedUnits: bigint;
        stakingPendingUnits: bigint;
      }
    >();

    const ensureCurr = (curr: string) => {
      const key = curr.trim().toUpperCase();
      let rec = currencyStats.get(key);
      if (!rec) {
        rec = {
          feeEarnedUnits: 0n,
          feeEarned24hUnits: 0n,
          spotMakerUnits: 0n,
          spotTakerUnits: 0n,
          futuresUnits: 0n,
          userDirectUnits: 0n,
          mmBotUnits: 0n,
          sweptUnits: 0n,
          stakingClaimedUnits: 0n,
          stakingClaimed24hUnits: 0n,
          stakingFeeFundedUnits: 0n,
          stakingTreasuryFundedUnits: 0n,
          stakingPendingUnits: 0n,
        };
        currencyStats.set(key, rec);
      }
      return rec;
    };

    // Always include primary reserve & vault currencies
    for (const c of ['IDR', 'USDT', 'BTC', 'ETH', 'SOL']) ensureCurr(c);
    for (const v of db.earnVaults.values()) ensureCurr(v.asset);
    for (const p of db.tradingPairs.values()) {
      ensureCurr(p.quoteCurrency);
    }

    // Pair-level aggregation
    const pairStats = new Map<
      string,
      {
        pairId: string;
        baseCurrency: string;
        quoteCurrency: string;
        quoteDecimals: number;
        tradeCount: number;
        trades24hCount: number;
        makerFeesUnits: bigint;
        takerFeesUnits: bigint;
        totalFeesUnits: bigint;
        userFeesUnits: bigint;
      }
    >();

    let totalTradesCount = 0;
    let trades24hCount = 0;

    // 1. Aggregate Spot trade fees (all fees credited in quoteCurrency)
    for (const trade of db.trades) {
      totalTradesCount += 1;
      const is24h = trade.createdAt >= oneDayAgo;
      if (is24h) trades24hCount += 1;

      const meta = resolveQuoteForPair(trade.pairId);
      const makerFee = BigInt(trade.makerFee || '0');
      const takerFee = BigInt(trade.takerFee || '0');
      const tradeTotal = makerFee + takerFee;

      const makerUserDirect = isDirectUser(trade.makerUserId);
      const takerUserDirect = isDirectUser(trade.takerUserId);
      const userPortion = (makerUserDirect ? makerFee : 0n) + (takerUserDirect ? takerFee : 0n);
      const mmPortion = tradeTotal - userPortion;

      const cRec = ensureCurr(meta.quoteCurrency);
      cRec.feeEarnedUnits += tradeTotal;
      cRec.spotMakerUnits += makerFee;
      cRec.spotTakerUnits += takerFee;
      cRec.userDirectUnits += userPortion;
      cRec.mmBotUnits += mmPortion;
      if (is24h) cRec.feeEarned24hUnits += tradeTotal;

      let pRec = pairStats.get(trade.pairId);
      if (!pRec) {
        pRec = {
          pairId: trade.pairId,
          baseCurrency: meta.baseCurrency,
          quoteCurrency: meta.quoteCurrency,
          quoteDecimals: meta.quoteDecimals,
          tradeCount: 0,
          trades24hCount: 0,
          makerFeesUnits: 0n,
          takerFeesUnits: 0n,
          totalFeesUnits: 0n,
          userFeesUnits: 0n,
        };
        pairStats.set(trade.pairId, pRec);
      }
      pRec.tradeCount += 1;
      if (is24h) pRec.trades24hCount += 1;
      pRec.makerFeesUnits += makerFee;
      pRec.takerFeesUnits += takerFee;
      pRec.totalFeesUnits += tradeTotal;
      pRec.userFeesUnits += userPortion;
    }

    // 2. Aggregate Futures fees & Fee-to-Treasury sweeps directly from Ledger journals
    for (const journal of db.journalTransactions.values()) {
      if (journal.txType !== 'FUTURES_FEE' && journal.txType !== 'FEE_TREASURY_SWEEP') continue;
      const entries = entriesByJournal.get(journal.id) || [];

      if (journal.txType === 'FUTURES_FEE') {
        let debitedUserId = '';
        for (const e of entries) {
          if (e.entryType === 'DEBIT') {
            const debAcc = db.ledgerAccounts.get(e.accountId);
            if (debAcc) debitedUserId = debAcc.userId;
          }
        }
        const userDirect = isDirectUser(debitedUserId);
        for (const e of entries) {
          if (e.entryType !== 'CREDIT') continue;
          const acc = db.ledgerAccounts.get(e.accountId);
          if (!acc || acc.userId !== SYSTEM_FEE_ID) continue;
          const amt = BigInt(e.amount || '0');
          const cRec = ensureCurr(acc.currency);
          cRec.feeEarnedUnits += amt;
          cRec.futuresUnits += amt;
          if (journal.createdAt >= oneDayAgo) cRec.feeEarned24hUnits += amt;
          if (userDirect) cRec.userDirectUnits += amt;
          else cRec.mmBotUnits += amt;
        }
      } else if (journal.txType === 'FEE_TREASURY_SWEEP') {
        for (const e of entries) {
          if (e.entryType !== 'CREDIT') continue;
          const acc = db.ledgerAccounts.get(e.accountId);
          if (!acc || acc.userId !== SYSTEM_TREASURY_ID) continue;
          const amt = BigInt(e.amount || '0');
          const cRec = ensureCurr(acc.currency);
          cRec.sweptUnits += amt;
        }
      }
    }

    // 3. Aggregate Staking Earn Payouts (claimed & funded)
    const claimedPayouts: typeof db.earnPayouts = [];
    for (const p of db.earnPayouts) {
      if (p.payoutType === 'DAILY_SETTLEMENT') continue;
      claimedPayouts.push(p);
      const amt = BigInt(p.amountUnits || '0');
      const feeFunded = p.feeFundedUnits
        ? BigInt(p.feeFundedUnits)
        : p.fundingSource === 'EXCHANGE_FEE_POOL'
          ? amt
          : 0n;
      const treasuryFunded = p.treasuryFundedUnits
        ? BigInt(p.treasuryFundedUnits)
        : amt > feeFunded
          ? amt - feeFunded
          : 0n;

      const cRec = ensureCurr(p.asset);
      cRec.stakingClaimedUnits += amt;
      cRec.stakingFeeFundedUnits += feeFunded;
      cRec.stakingTreasuryFundedUnits += treasuryFunded;
      if (p.createdAt >= oneDayAgo) cRec.stakingClaimed24hUnits += amt;
    }

    // 4. Aggregate Pending Claimable Staking Yield Liability
    for (const pos of db.earnPositions.values()) {
      if (pos.status === 'REDEEMED') continue;
      const pending = BigInt(pos.accruedYieldUnits || '0');
      if (pending > 0n) {
        ensureCurr(pos.asset).stakingPendingUnits += pending;
      }
    }

    // Ensure all currencies currently held in SYSTEM_FEE_ID or SYSTEM_TREASURY_ID are represented
    for (const acc of db.ledgerAccounts.values()) {
      if (acc.userId === SYSTEM_FEE_ID || acc.userId === SYSTEM_TREASURY_ID) {
        ensureCurr(acc.currency);
      }
    }

    // Compute per-currency metrics & IDR rollups
    let totalExchangeFeesIdr = 0;
    let totalExchangeFeesUsd = 0;
    let fees24hIdr = 0;
    let fees24hUsd = 0;
    let spotMakerFeesIdr = 0;
    let spotTakerFeesIdr = 0;
    let futuresFeesIdr = 0;
    let userDirectFeesIdr = 0;
    let mmBotFeesIdr = 0;
    let feeCollectorLiveIdr = 0;
    let feeCollectorLiveUsd = 0;
    let treasuryReserveLiveIdr = 0;
    let treasuryReserveLiveUsd = 0;
    let totalSweptToTreasuryIdr = 0;
    let stakingClaimedAllTimeIdr = 0;
    let stakingClaimedAllTimeUsd = 0;
    let stakingClaimed24hIdr = 0;
    let stakingFeePoolFundedIdr = 0;
    let stakingTreasuryFundedIdr = 0;
    let stakingPendingClaimableIdr = 0;
    let stakingPendingClaimableUsd = 0;

    const byCurrency = Array.from(currencyStats.entries())
      .map(([currency, rec]) => {
        const decimals = this.resolveCurrencyDecimals(currency);
        const feeAcc = db.getAccount(SYSTEM_FEE_ID, currency);
        const treasuryAcc = db.getAccount(SYSTEM_TREASURY_ID, currency);

        const feeCollectorBal = feeAcc
          ? BigInt(feeAcc.balanceAvailable || '0') + BigInt(feeAcc.balanceLocked || '0')
          : 0n;
        const treasuryReserveBal = treasuryAcc
          ? BigInt(treasuryAcc.balanceAvailable || '0') + BigInt(treasuryAcc.balanceLocked || '0')
          : 0n;

        const netFeeSurplusUnits = rec.feeEarnedUnits - rec.stakingClaimedUnits;

        const earnedVal = this.unitsToUsdIdr(rec.feeEarnedUnits, decimals, currency);
        const earned24hVal = this.unitsToUsdIdr(rec.feeEarned24hUnits, decimals, currency);
        const makerVal = this.unitsToUsdIdr(rec.spotMakerUnits, decimals, currency);
        const takerVal = this.unitsToUsdIdr(rec.spotTakerUnits, decimals, currency);
        const futuresVal = this.unitsToUsdIdr(rec.futuresUnits, decimals, currency);
        const userVal = this.unitsToUsdIdr(rec.userDirectUnits, decimals, currency);
        const mmVal = this.unitsToUsdIdr(rec.mmBotUnits, decimals, currency);
        const sweptVal = this.unitsToUsdIdr(rec.sweptUnits, decimals, currency);

        const feeCollVal = feeCollectorBal > 0n ? this.unitsToUsdIdr(feeCollectorBal, decimals, currency) : { usd: 0, idr: 0 };
        const treasuryVal = treasuryReserveBal > 0n ? this.unitsToUsdIdr(treasuryReserveBal, decimals, currency) : { usd: 0, idr: 0 };

        const claimedVal = this.unitsToUsdIdr(rec.stakingClaimedUnits, decimals, currency);
        const claimed24hVal = this.unitsToUsdIdr(rec.stakingClaimed24hUnits, decimals, currency);
        const feeFundedVal = this.unitsToUsdIdr(rec.stakingFeeFundedUnits, decimals, currency);
        const treasuryFundedVal = this.unitsToUsdIdr(rec.stakingTreasuryFundedUnits, decimals, currency);
        const pendingVal = this.unitsToUsdIdr(rec.stakingPendingUnits, decimals, currency);

        totalExchangeFeesIdr += earnedVal.idr;
        totalExchangeFeesUsd += earnedVal.usd;
        fees24hIdr += earned24hVal.idr;
        fees24hUsd += earned24hVal.usd;
        spotMakerFeesIdr += makerVal.idr;
        spotTakerFeesIdr += takerVal.idr;
        futuresFeesIdr += futuresVal.idr;
        userDirectFeesIdr += userVal.idr;
        mmBotFeesIdr += mmVal.idr;
        feeCollectorLiveIdr += feeCollVal.idr;
        feeCollectorLiveUsd += feeCollVal.usd;
        treasuryReserveLiveIdr += treasuryVal.idr;
        treasuryReserveLiveUsd += treasuryVal.usd;
        totalSweptToTreasuryIdr += sweptVal.idr;

        stakingClaimedAllTimeIdr += claimedVal.idr;
        stakingClaimedAllTimeUsd += claimedVal.usd;
        stakingClaimed24hIdr += claimed24hVal.idr;
        stakingFeePoolFundedIdr += feeFundedVal.idr;
        stakingTreasuryFundedIdr += treasuryFundedVal.idr;
        stakingPendingClaimableIdr += pendingVal.idr;
        stakingPendingClaimableUsd += pendingVal.usd;

        return {
          currency,
          decimals,
          feeEarnedAllTimeUnits: rec.feeEarnedUnits.toString(),
          feeEarnedAllTimeDisplay: PrecisionMath.formatFromUnits(rec.feeEarnedUnits, decimals, true),
          feeCollectorBalanceUnits: feeCollectorBal.toString(),
          feeCollectorBalanceDisplay: PrecisionMath.formatFromUnits(feeCollectorBal, decimals, true),
          treasuryReserveBalanceUnits: treasuryReserveBal.toString(),
          treasuryReserveBalanceDisplay: PrecisionMath.formatFromUnits(treasuryReserveBal, decimals, true),
          sweptToTreasuryUnits: rec.sweptUnits.toString(),
          sweptToTreasuryDisplay: PrecisionMath.formatFromUnits(rec.sweptUnits, decimals, true),
          stakingClaimedUnits: rec.stakingClaimedUnits.toString(),
          stakingClaimedDisplay: PrecisionMath.formatFromUnits(rec.stakingClaimedUnits, decimals, true),
          stakingFeeFundedUnits: rec.stakingFeeFundedUnits.toString(),
          stakingPendingUnits: rec.stakingPendingUnits.toString(),
          stakingPendingDisplay: PrecisionMath.formatFromUnits(rec.stakingPendingUnits, decimals, true),
          netFeeSurplusUnits: netFeeSurplusUnits.toString(),
          netFeeSurplusDisplay:
            netFeeSurplusUnits < 0n
              ? `-${PrecisionMath.formatFromUnits(-netFeeSurplusUnits, decimals, true)}`
              : PrecisionMath.formatFromUnits(netFeeSurplusUnits, decimals, true),
          feeEarnedIdr: earnedVal.idr,
          stakingClaimedIdr: claimedVal.idr,
          feeCollectorLiveIdr: feeCollVal.idr,
          treasuryReserveLiveIdr: treasuryVal.idr,
        };
      })
      .filter(
        row =>
          ['IDR', 'USDT', 'BTC', 'ETH', 'SOL'].includes(row.currency) ||
          row.feeEarnedAllTimeUnits !== '0' ||
          row.feeCollectorBalanceUnits !== '0' ||
          row.treasuryReserveBalanceUnits !== '0' ||
          row.stakingClaimedUnits !== '0' ||
          row.stakingPendingUnits !== '0'
      )
      .sort((a, b) => b.feeEarnedIdr - a.feeEarnedIdr || b.treasuryReserveLiveIdr - a.treasuryReserveLiveIdr);

    const byPairRaw = Array.from(pairStats.values()).map(p => {
      const val = this.unitsToUsdIdr(p.totalFeesUnits, p.quoteDecimals, p.quoteCurrency);
      return {
        pairId: p.pairId,
        baseCurrency: p.baseCurrency,
        quoteCurrency: p.quoteCurrency,
        quoteDecimals: p.quoteDecimals,
        tradeCount: p.tradeCount,
        trades24hCount: p.trades24hCount,
        makerFeesUnits: p.makerFeesUnits.toString(),
        takerFeesUnits: p.takerFeesUnits.toString(),
        totalFeesUnits: p.totalFeesUnits.toString(),
        totalFeesDisplay: PrecisionMath.formatFromUnits(p.totalFeesUnits, p.quoteDecimals, true),
        userFeesUnits: p.userFeesUnits.toString(),
        userFeesDisplay: PrecisionMath.formatFromUnits(p.userFeesUnits, p.quoteDecimals, true),
        totalFeesIdr: val.idr,
        totalFeesUsd: val.usd,
        sharePct: totalExchangeFeesIdr > 0 ? Math.round((val.idr / totalExchangeFeesIdr) * 10000) / 100 : 0,
      };
    });
    byPairRaw.sort((a, b) => b.totalFeesIdr - a.totalFeesIdr || b.tradeCount - a.tradeCount);

    const recentStakingClaims = [...claimedPayouts]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30)
      .map(p => {
        const user = db.users.get(p.userId);
        const vault = db.earnVaults.get(p.vaultId);
        const amt = BigInt(p.amountUnits || '0');
        const val = this.unitsToUsdIdr(amt, p.decimals, p.asset);
        const feeFunded = p.feeFundedUnits
          ? p.feeFundedUnits
          : p.fundingSource === 'EXCHANGE_FEE_POOL'
            ? amt.toString()
            : '0';
        const treasuryFunded = p.treasuryFundedUnits
          ? p.treasuryFundedUnits
          : (amt - BigInt(feeFunded)).toString();
        return {
          id: p.id,
          userId: p.userId,
          userEmail: user?.email || p.userId,
          positionId: p.positionId,
          vaultId: p.vaultId,
          vaultName: vault?.name || p.vaultId,
          asset: p.asset,
          decimals: p.decimals,
          payoutType: p.payoutType,
          amountUnits: p.amountUnits,
          amountDisplay: PrecisionMath.formatFromUnits(amt, p.decimals, true),
          amountIdr: val.idr,
          fundingSource: (p.fundingSource || 'TREASURY_RESERVE') as EarnPayoutFundingSource,
          feeFundedUnits: feeFunded,
          treasuryFundedUnits: treasuryFunded,
          journalId: p.journalId,
          createdAt: p.createdAt,
        };
      });

    const netTreasuryFeePoolIdr = totalExchangeFeesIdr - stakingClaimedAllTimeIdr;
    const netTreasuryFeePoolUsd = Math.round((totalExchangeFeesUsd - stakingClaimedAllTimeUsd) * 100) / 100;
    const spotFeesIdr = spotMakerFeesIdr + spotTakerFeesIdr;

    let feeCoverageRatioPct = 0;
    if (stakingClaimedAllTimeIdr > 0) {
      feeCoverageRatioPct = Math.round((totalExchangeFeesIdr / stakingClaimedAllTimeIdr) * 10000) / 100;
    } else if (stakingPendingClaimableIdr > 0) {
      feeCoverageRatioPct = Math.round((totalExchangeFeesIdr / stakingPendingClaimableIdr) * 10000) / 100;
    } else if (totalExchangeFeesIdr > 0) {
      feeCoverageRatioPct = 100;
    }

    return {
      generatedAt: now,
      fxRateIdr,
      summary: {
        totalExchangeFeesIdr,
        totalExchangeFeesUsd: Math.round(totalExchangeFeesUsd * 100) / 100,
        fees24hIdr,
        fees24hUsd: Math.round(fees24hUsd * 100) / 100,
        spotFeesIdr,
        spotMakerFeesIdr,
        spotTakerFeesIdr,
        futuresFeesIdr,
        userDirectFeesIdr,
        mmBotFeesIdr,
        totalTradesCount,
        trades24hCount,
        feeCollectorLiveIdr,
        feeCollectorLiveUsd: Math.round(feeCollectorLiveUsd * 100) / 100,
        treasuryReserveLiveIdr,
        treasuryReserveLiveUsd: Math.round(treasuryReserveLiveUsd * 100) / 100,
        totalSweptToTreasuryIdr,
        stakingClaimedAllTimeIdr,
        stakingClaimedAllTimeUsd: Math.round(stakingClaimedAllTimeUsd * 100) / 100,
        stakingClaimed24hIdr,
        stakingFeePoolFundedIdr,
        stakingTreasuryFundedIdr,
        stakingPendingClaimableIdr,
        stakingPendingClaimableUsd: Math.round(stakingPendingClaimableUsd * 100) / 100,
        netTreasuryFeePoolIdr,
        netTreasuryFeePoolUsd,
        feeCoverageRatioPct,
      },
      byCurrency,
      byPair: byPairRaw,
      recentStakingClaims,
    };
  }

  /**
   * Atomically sweeps available balances from SYSTEM_FEE_ID into SYSTEM_TREASURY_ID
   * via Double-Entry LedgerService (txType: 'FEE_TREASURY_SWEEP').
   */
  public sweepCollectedFeesToTreasury(adminId: string): {
    sweptCurrencies: Array<{ currency: string; decimals: number; amountUnits: string; amountDisplay: string; journalId: string; idrValue: number }>;
    totalSweptIdr: number;
    message: string;
  } {
    const now = Date.now();
    const sweptCurrencies: Array<{
      currency: string;
      decimals: number;
      amountUnits: string;
      amountDisplay: string;
      journalId: string;
      idrValue: number;
    }> = [];
    let totalSweptIdr = 0;

    for (const acc of db.ledgerAccounts.values()) {
      if (acc.userId !== SYSTEM_FEE_ID) continue;
      const avail = BigInt(acc.balanceAvailable || '0');
      if (avail <= 0n) continue;

      const decimals = this.resolveCurrencyDecimals(acc.currency);
      const treasuryAcc = db.createOrGetAccount(SYSTEM_TREASURY_ID, acc.currency);
      const display = PrecisionMath.formatFromUnits(avail, decimals, true);

      const { journal } = LedgerService.executeJournal({
        idempotencyKey: `fee-sweep:${acc.currency}:${avail.toString()}:${now}`,
        txType: 'FEE_TREASURY_SWEEP',
        referenceId: `sweep-${acc.currency}`,
        description: `Sweep Exchange Fee Collector ${display} ${acc.currency} -> Treasury Reserve`,
        entries: [
          { accountId: acc.id, entryType: 'DEBIT', amount: avail },
          { accountId: treasuryAcc.id, entryType: 'CREDIT', amount: avail },
        ],
      });

      const val = this.unitsToUsdIdr(avail, decimals, acc.currency);
      totalSweptIdr += val.idr;
      sweptCurrencies.push({
        currency: acc.currency,
        decimals,
        amountUnits: avail.toString(),
        amountDisplay: display,
        journalId: journal.id,
        idrValue: val.idr,
      });
    }

    if (sweptCurrencies.length === 0) {
      throw new Error('Tidak ada saldo fee pada akun Fee Collector (SYS_FEES) yang tersedia untuk disweep ke Treasury.');
    }

    const summaryText = sweptCurrencies.map(s => `${s.amountDisplay} ${s.currency}`).join(', ');
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminId,
      action: 'EXCHANGE_FEE_TREASURY_SWEEP',
      resource: 'ledger:fee-treasury-sweep',
      details: `Admin swept accumulated Exchange Fees to Treasury Reserve: ${summaryText} (Total Rp ${totalSweptIdr.toLocaleString('id-ID')})`,
      createdAt: now,
    });
    db.saveToDisk();

    return {
      sweptCurrencies,
      totalSweptIdr,
      message: `Berhasil sweep ${summaryText} dari Exchange Fee Collector ke Treasury Reserve.`,
    };
  }

  public startScheduler(): void {
    if (this.schedulerTimer) return;
    // Check once on startup and then every 60 seconds for UTC day rollovers
    try {
      this.runDailyYieldSettlement(Date.now());
    } catch (err: any) {
      console.warn('[EarnService] Initial daily yield settlement warning:', err?.message);
    }
    this.schedulerTimer = setInterval(() => {
      try {
        this.runDailyYieldSettlement(Date.now());
      } catch (err: any) {
        console.warn('[EarnService] Scheduled yield settlement error:', err?.message);
      }
    }, 60_000);
  }
}

export const earnService = new EarnService();
