/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * server/services/listing/ListingService.ts
 * Core Initial Listing Domain Service for DIMONEX.
 * Enforces Zero-Float BigInt math, Maker-Checker authorization,
 * State Machine transitions, Asset Validation, and Immutable Audit Trail.
 */

import crypto from 'crypto';
import { db } from '../../db/database.js';
import { 
  Asset, ListingRequest, ListingApproval, Market, 
  AssetType, AssetStatus, ListingStatus 
} from '../../db/types.js';
import { ListingAuditService } from './ListingAuditService.js';
import { ListingActivationService, ActivationResult } from './ListingActivationService.js';
import { marketWsService } from '../../websocket/MarketDataWs.js';

export interface CreateAssetInput {
  symbol: string;
  name: string;
  assetType: AssetType;
  decimals: number;
  network: string;
  contractAddress?: string;
  depositEnabled?: boolean;
  withdrawalEnabled?: boolean;
  depositOpenedAt?: number;
  withdrawalOpenedAt?: number;
}

export interface CreateListingInput {
  assetId: string;
  quoteAssetId?: string; // Defaults to IDR asset
  tickSize: string;      // BigInt sen integer string (e.g. '100' = Rp 1)
  lotSize: string;       // BigInt base unit integer string
  minQuantity: string;   // BigInt base unit integer string
  maxQuantity?: string;   // BigInt base unit integer string
  minNotional: string;   // BigInt quote sen integer string (e.g. '1000000' = Rp 10,000)
  makerFeeBps?: number;  // Integer bps (default 10 = 0.10%)
  takerFeeBps?: number;  // Integer bps (default 20 = 0.20%)
  scheduledAt?: number;
  depositOpenedAt?: number;
  withdrawalOpenedAt?: number;
  depositEnabled?: boolean;
  withdrawalEnabled?: boolean;
  marketMakerAccountId?: string;
  projectOwnerAccountId?: string;
  initialLiquidityBase?: string;
  initialLiquidityQuoteIdr?: string;
}

export interface UpdateListingInput {
  tickSize?: string;
  lotSize?: string;
  minQuantity?: string;
  minNotional?: string;
  makerFeeBps?: number;
  takerFeeBps?: number;
  scheduledAt?: number;
  depositOpenedAt?: number;
  withdrawalOpenedAt?: number;
  depositEnabled?: boolean;
  withdrawalEnabled?: boolean;
  marketMakerAccountId?: string;
  projectOwnerAccountId?: string;
  initialLiquidityBase?: string;
  initialLiquidityQuoteIdr?: string;
}

export class ListingService {
  /**
   * Validate network-specific contract address format
   */
  public static validateContractAddress(network: string, contractAddress?: string): void {
    if (!contractAddress) return;
    const net = network.toUpperCase();

    if (net.includes('ETHEREUM') || net.includes('ERC20') || net.includes('BSC') || net.includes('BEP20') || net.includes('POLYGON') || net.includes('ARBITRUM')) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
        throw new Error(`Alamat kontrak EVM tidak valid untuk jaringan ${network}: harus diawali 0x diikuti 40 digit heksadesimal`);
      }
    } else if (net.includes('SOLANA') || net.includes('SPL')) {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(contractAddress)) {
        throw new Error(`Alamat mint Solana tidak valid: harus 32-44 karakter Base58`);
      }
    } else if (net.includes('TRON') || net.includes('TRC20')) {
      if (!/^T[a-km-zA-HJ-NP-Z1-9]{33}$/.test(contractAddress)) {
        throw new Error(`Alamat kontrak TRON TRC-20 tidak valid: harus diawali huruf T dengan panjang 34 karakter Base58`);
      }
    }
  }

  /**
   * Register a new Asset in the catalog
   */
  public static createAsset(input: CreateAssetInput, actorId: string, securityMeta?: any): Asset {
    const normalizedSymbol = input.symbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(normalizedSymbol)) {
      throw new Error(`Format simbol aset tidak valid: ${input.symbol}. Harus 2-12 karakter alfanumerik huruf besar.`);
    }

    // Uniqueness validation
    for (const a of db.assets.values()) {
      if (a.symbol === normalizedSymbol) {
        throw new Error(`Aset dengan simbol ${normalizedSymbol} sudah terdaftar di bursa.`);
      }
    }

    if (!input.name || input.name.trim().length < 2) {
      throw new Error('Nama aset wajib diisi (minimal 2 karakter).');
    }

    // Decimals validation (0 to 18)
    const decimals = Number(input.decimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw new Error('Presisi desimal aset harus berupa integer antara 0 dan 18.');
    }

    if (!input.network || input.network.trim().length < 2) {
      throw new Error('Jaringan aset (network) wajib ditentukan.');
    }

    if (input.assetType === 'TOKEN' && !input.contractAddress) {
      throw new Error(`Aset bertipe TOKEN pada jaringan ${input.network} wajib menyertakan contractAddress.`);
    }

    this.validateContractAddress(input.network, input.contractAddress);

    const assetId = crypto.randomUUID();
    const now = Date.now();
    const asset: Asset = {
      id: assetId,
      symbol: normalizedSymbol,
      name: input.name.trim(),
      assetType: input.assetType,
      decimals,
      network: input.network.trim().toUpperCase(),
      contractAddress: input.contractAddress ? input.contractAddress.trim() : undefined,
      status: 'PENDING',
      depositEnabled: input.depositEnabled !== undefined ? Boolean(input.depositEnabled) : true,
      withdrawalEnabled: input.withdrawalEnabled !== undefined ? Boolean(input.withdrawalEnabled) : true,
      depositOpenedAt: input.depositOpenedAt,
      withdrawalOpenedAt: input.withdrawalOpenedAt,
      createdAt: now,
      updatedAt: now
    };

    db.assets.set(assetId, asset);
    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: assetId,
      eventType: 'ASSET_CREATED',
      actorId,
      aggregateVersion: 1,
      payload: {
        symbol: asset.symbol,
        name: asset.name,
        decimals: asset.decimals,
        network: asset.network,
        contractAddress: asset.contractAddress,
        assetType: asset.assetType
      },
      reason: `Asset ${asset.symbol} created by admin`,
      securityMetadata: securityMeta
    });

    return asset;
  }

  /**
   * Helper to retrieve or validate Quote Asset (Default is IDR)
   */
  public static getQuoteAsset(quoteAssetIdOrSymbol?: string): Asset {
    if (quoteAssetIdOrSymbol) {
      // 1. Try lookup by exact ID
      const customQuote = db.assets.get(quoteAssetIdOrSymbol);
      if (customQuote) return customQuote;

      // 2. Try lookup by uppercase symbol (e.g. 'USDT', 'IDR')
      const targetSym = quoteAssetIdOrSymbol.trim().toUpperCase();
      for (const a of db.assets.values()) {
        if (a.symbol === targetSym) return a;
      }
      throw new Error(`Quote asset tidak ditemukan: ${quoteAssetIdOrSymbol}`);
    }

    // Default: find IDR asset
    for (const a of db.assets.values()) {
      if (a.symbol === 'IDR') return a;
    }

    // Fallback IDR
    const idrAsset: Asset = {
      id: 'ast-idr-0000-0000-000000000001',
      symbol: 'IDR',
      name: 'Indonesian Rupiah',
      assetType: 'NATIVE',
      decimals: 2,
      network: 'FIAT',
      status: 'ACTIVE',
      depositEnabled: true,
      withdrawalEnabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    db.assets.set(idrAsset.id, idrAsset);
    return idrAsset;
  }

  /**
   * Validate exact BigInt financial parameters
   */
  private static validateFinancialParameters(params: {
    tickSize: string;
    lotSize: string;
    minQuantity: string;
    minNotional: string;
    makerFeeBps?: number;
    takerFeeBps?: number;
  }): void {
    try {
      const tick = BigInt(params.tickSize);
      if (tick <= 0n) throw new Error('Tick size harus berupa integer positif lebih besar dari 0');
    } catch {
      throw new Error(`Nilai tickSize tidak valid: ${params.tickSize}. Wajib berupa string integer eksak.`);
    }

    try {
      const lot = BigInt(params.lotSize);
      if (lot <= 0n) throw new Error('Lot size harus berupa integer positif lebih besar dari 0');
    } catch {
      throw new Error(`Nilai lotSize tidak valid: ${params.lotSize}. Wajib berupa string integer eksak.`);
    }

    try {
      const minQty = BigInt(params.minQuantity);
      if (minQty <= 0n) throw new Error('Min quantity harus berupa integer positif lebih besar dari 0');
      const lot = BigInt(params.lotSize);
      if (minQty < lot) throw new Error(`Min quantity (${minQty}) tidak boleh lebih kecil dari lot size (${lot})`);
    } catch (err: any) {
      throw new Error(err.message || `Nilai minQuantity tidak valid: ${params.minQuantity}`);
    }

    try {
      const minNotional = BigInt(params.minNotional);
      if (minNotional <= 0n) throw new Error('Min notional harus berupa integer positif lebih besar dari 0 sen');
    } catch {
      throw new Error(`Nilai minNotional tidak valid: ${params.minNotional}. Wajib berupa string integer sen.`);
    }

    if (params.makerFeeBps !== undefined) {
      if (!Number.isInteger(params.makerFeeBps) || params.makerFeeBps < 0 || params.makerFeeBps > 1000) {
        throw new Error('Maker fee harus berupa integer antara 0 dan 1000 basis poin (maks 10.00%)');
      }
    }

    if (params.takerFeeBps !== undefined) {
      if (!Number.isInteger(params.takerFeeBps) || params.takerFeeBps < 0 || params.takerFeeBps > 1000) {
        throw new Error('Taker fee harus berupa integer antara 0 dan 1000 basis poin (maks 10.00%)');
      }
    }
  }

  /**
   * 1. MAKER: Create Draft Listing Request
   */
  public static createListingRequest(input: CreateListingInput, makerAdminId: string, securityMeta?: any): ListingRequest {
    const baseAsset = db.assets.get(input.assetId);
    if (!baseAsset) {
      throw new Error(`Aset dasar tidak ditemukan: ${input.assetId}`);
    }

    const quoteAsset = this.getQuoteAsset(input.quoteAssetId);

    // Validate pair uniqueness
    const existingListing = Array.from(db.listingRequests.values()).find(
      l => l.assetId === baseAsset.id && l.quoteAssetId === quoteAsset.id && l.status !== 'CANCELLED' && l.status !== 'REJECTED'
    );
    if (existingListing) {
      throw new Error(`Listing untuk pasangan ${baseAsset.symbol}/${quoteAsset.symbol} sudah ada (Status: ${existingListing.status})`);
    }

    this.validateFinancialParameters(input);

    const listingId = crypto.randomUUID();
    const now = Date.now();
    const listing: ListingRequest = {
      id: listingId,
      assetId: baseAsset.id,
      quoteAssetId: quoteAsset.id,
      status: 'DRAFT',
      tickSize: input.tickSize,
      lotSize: input.lotSize,
      minQuantity: input.minQuantity,
      maxQuantity: input.maxQuantity,
      minNotional: input.minNotional,
      makerFeeBps: input.makerFeeBps !== undefined ? input.makerFeeBps : 10,
      takerFeeBps: input.takerFeeBps !== undefined ? input.takerFeeBps : 20,
      scheduledAt: input.scheduledAt,
      depositOpenedAt: input.depositOpenedAt,
      withdrawalOpenedAt: input.withdrawalOpenedAt,
      depositEnabled: input.depositEnabled !== undefined ? input.depositEnabled : true,
      withdrawalEnabled: input.withdrawalEnabled !== undefined ? input.withdrawalEnabled : true,
      marketMakerAccountId: input.marketMakerAccountId || 'usr-mm-0000-0000-000000000001',
      projectOwnerAccountId: input.projectOwnerAccountId,
      initialLiquidityBase: input.initialLiquidityBase,
      initialLiquidityQuoteIdr: input.initialLiquidityQuoteIdr,
      createdBy: makerAdminId,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    db.listingRequests.set(listingId, listing);
    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: listingId,
      eventType: 'LISTING_CREATED',
      actorId: makerAdminId,
      aggregateVersion: 1,
      payload: {
        symbol: `${baseAsset.symbol}-${quoteAsset.symbol}`,
        tickSize: listing.tickSize,
        lotSize: listing.lotSize,
        minQuantity: listing.minQuantity,
        minNotional: listing.minNotional,
        makerFeeBps: listing.makerFeeBps,
        takerFeeBps: listing.takerFeeBps,
        status: listing.status
      },
      reason: 'Draft listing created by Maker Admin',
      securityMetadata: securityMeta
    });

    return listing;
  }

  /**
   * 2. Update Draft or Pending Listing Request
   * If sensitive parameters change, increments version and invalidates any previous approval.
   */
  public static updateListingRequest(
    id: string, 
    input: UpdateListingInput, 
    actorId: string, 
    securityMeta?: any
  ): ListingRequest {
    const listing = db.listingRequests.get(id);
    if (!listing) throw new Error(`Listing request tidak ditemukan: ${id}`);

    if (listing.status !== 'DRAFT' && listing.status !== 'PENDING_REVIEW' && listing.status !== 'APPROVED') {
      throw new Error(`Listing request dalam status ${listing.status} tidak dapat diubah (Hanya DRAFT, PENDING_REVIEW, atau APPROVED sebelum aktif).`);
    }

    if (listing.status === 'APPROVED') {
      listing.status = 'DRAFT'; // Reset status to DRAFT requiring re-submission and re-approval
    }

    if (input.tickSize || input.lotSize || input.minQuantity || input.minNotional || input.makerFeeBps !== undefined || input.takerFeeBps !== undefined) {
      this.validateFinancialParameters({
        tickSize: input.tickSize || listing.tickSize,
        lotSize: input.lotSize || listing.lotSize,
        minQuantity: input.minQuantity || listing.minQuantity,
        minNotional: input.minNotional || listing.minNotional,
        makerFeeBps: input.makerFeeBps !== undefined ? input.makerFeeBps : listing.makerFeeBps,
        takerFeeBps: input.takerFeeBps !== undefined ? input.takerFeeBps : listing.takerFeeBps
      });
    }

    const previousVersion = listing.version;
    const newVersion = previousVersion + 1;

    if (input.tickSize) listing.tickSize = input.tickSize;
    if (input.lotSize) listing.lotSize = input.lotSize;
    if (input.minQuantity) listing.minQuantity = input.minQuantity;
    if (input.minNotional) listing.minNotional = input.minNotional;
    if (input.makerFeeBps !== undefined) listing.makerFeeBps = input.makerFeeBps;
    if (input.takerFeeBps !== undefined) listing.takerFeeBps = input.takerFeeBps;
    if (input.scheduledAt !== undefined) listing.scheduledAt = input.scheduledAt;
    if (input.depositOpenedAt !== undefined) listing.depositOpenedAt = input.depositOpenedAt;
    if (input.withdrawalOpenedAt !== undefined) listing.withdrawalOpenedAt = input.withdrawalOpenedAt;
    if (input.depositEnabled !== undefined) listing.depositEnabled = input.depositEnabled;
    if (input.withdrawalEnabled !== undefined) listing.withdrawalEnabled = input.withdrawalEnabled;
    if (input.marketMakerAccountId !== undefined) listing.marketMakerAccountId = input.marketMakerAccountId;
    if (input.projectOwnerAccountId !== undefined) listing.projectOwnerAccountId = input.projectOwnerAccountId;
    if (input.initialLiquidityBase !== undefined) listing.initialLiquidityBase = input.initialLiquidityBase;
    if (input.initialLiquidityQuoteIdr !== undefined) listing.initialLiquidityQuoteIdr = input.initialLiquidityQuoteIdr;

    listing.version = newVersion;
    listing.updatedAt = Date.now();

    // Invalidate prior approval if version changed
    db.listingApprovals.delete(listing.id);

    db.listingRequests.set(id, listing);
    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: id,
      eventType: 'LISTING_UPDATED',
      actorId,
      aggregateVersion: newVersion,
      payload: {
        previousVersion,
        newVersion,
        updatedFields: input
      },
      reason: 'Listing parameters updated by Admin, previous approvals invalidated',
      securityMetadata: securityMeta
    });

    return listing;
  }

  /**
   * 3. Submit Listing Request for Review
   * Transitions DRAFT -> PENDING_REVIEW
   */
  public static submitForReview(id: string, actorId: string, securityMeta?: any): ListingRequest {
    const listing = db.listingRequests.get(id);
    if (!listing) throw new Error(`Listing request tidak ditemukan: ${id}`);

    if (listing.status !== 'DRAFT') {
      throw new Error(`Hanya listing berstatus DRAFT yang dapat diajukan untuk review (Status saat ini: ${listing.status})`);
    }

    listing.status = 'PENDING_REVIEW';
    listing.updatedAt = Date.now();
    db.listingRequests.set(id, listing);
    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: id,
      eventType: 'LISTING_SUBMITTED',
      actorId,
      aggregateVersion: listing.version,
      payload: {
        status: listing.status
      },
      reason: 'Submitted for Maker-Checker review',
      securityMetadata: securityMeta
    });

    return listing;
  }

  /**
   * 4. CHECKER: Approve Listing Request
   * Strictly enforces Maker-Checker: reviewerId !== createdBy!
   */
  public static approveListing(
    id: string, 
    reviewerId: string, 
    reason: string, 
    securityMeta?: any
  ): ListingApproval {
    const listing = db.listingRequests.get(id);
    if (!listing) throw new Error(`Listing request tidak ditemukan: ${id}`);

    if (listing.status !== 'PENDING_REVIEW') {
      throw new Error(`Hanya listing berstatus PENDING_REVIEW yang dapat disetujui (Status saat ini: ${listing.status})`);
    }

    // STRICT MAKER-CHECKER ENFORCEMENT
    if (listing.createdBy === reviewerId) {
      throw new Error('Pelanggaran Maker-Checker: Pembuat listing (Maker) tidak diperbolehkan menyetujui (Approve) listing buatannya sendiri.');
    }

    if (!reason || reason.trim().length < 5) {
      throw new Error('Alasan persetujuan (approval reason) wajib diisi dengan jelas minimal 5 karakter.');
    }

    // Check duplicate approval for this version
    const existingApproval = db.listingApprovals.get(listing.id);
    if (existingApproval && existingApproval.configVersion === listing.version && existingApproval.decision === 'APPROVED') {
      throw new Error(`Listing versi ${listing.version} sudah memiliki persetujuan aktif.`);
    }

    const approvalId = crypto.randomUUID();
    const approval: ListingApproval = {
      id: approvalId,
      listingRequestId: listing.id,
      reviewerId,
      decision: 'APPROVED',
      reason: reason.trim(),
      configVersion: listing.version,
      reviewedAt: Date.now()
    };

    db.listingApprovals.set(listing.id, approval);

    // State transition to APPROVED
    listing.status = 'APPROVED';
    listing.updatedAt = Date.now();
    db.listingRequests.set(listing.id, listing);

    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: listing.id,
      eventType: 'LISTING_APPROVED',
      actorId: reviewerId,
      aggregateVersion: listing.version,
      payload: {
        approvalId,
        decision: 'APPROVED',
        configVersion: approval.configVersion,
        reason: approval.reason,
        makerId: listing.createdBy,
        checkerId: reviewerId
      },
      reason: `Listing approved by Checker Admin: ${reason}`,
      securityMetadata: securityMeta
    });

    return approval;
  }

  /**
   * 5. CHECKER: Reject Listing Request
   * Strictly enforces Maker-Checker: reviewerId !== createdBy!
   */
  public static rejectListing(
    id: string, 
    reviewerId: string, 
    reason: string, 
    securityMeta?: any
  ): ListingApproval {
    const listing = db.listingRequests.get(id);
    if (!listing) throw new Error(`Listing request tidak ditemukan: ${id}`);

    if (listing.status !== 'PENDING_REVIEW') {
      throw new Error(`Hanya listing berstatus PENDING_REVIEW yang dapat ditolak (Status saat ini: ${listing.status})`);
    }

    // STRICT MAKER-CHECKER ENFORCEMENT
    if (listing.createdBy === reviewerId) {
      throw new Error('Pelanggaran Maker-Checker: Pembuat listing (Maker) tidak diperbolehkan menolak/memutuskan listing buatannya sendiri.');
    }

    if (!reason || reason.trim().length < 5) {
      throw new Error('Alasan penolakan (rejection reason) wajib diisi minimal 5 karakter.');
    }

    const approvalId = crypto.randomUUID();
    const approval: ListingApproval = {
      id: approvalId,
      listingRequestId: listing.id,
      reviewerId,
      decision: 'REJECTED',
      reason: reason.trim(),
      configVersion: listing.version,
      reviewedAt: Date.now()
    };

    db.listingApprovals.set(listing.id, approval);

    // State transition to REJECTED
    listing.status = 'REJECTED';
    listing.updatedAt = Date.now();
    db.listingRequests.set(listing.id, listing);

    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: listing.id,
      eventType: 'LISTING_REJECTED',
      actorId: reviewerId,
      aggregateVersion: listing.version,
      payload: {
        approvalId,
        decision: 'REJECTED',
        configVersion: approval.configVersion,
        reason: approval.reason,
        makerId: listing.createdBy,
        checkerId: reviewerId
      },
      reason: `Listing rejected by Checker Admin: ${reason}`,
      securityMetadata: securityMeta
    });

    return approval;
  }

  /**
   * 6. Schedule Listing Request
   */
  public static scheduleListing(
    id: string, 
    scheduledAt: number, 
    actorId: string, 
    securityMeta?: any
  ): ListingRequest {
    const listing = db.listingRequests.get(id);
    if (!listing) throw new Error(`Listing request tidak ditemukan: ${id}`);

    if (listing.status !== 'APPROVED') {
      throw new Error(`Hanya listing yang sudah di-APPROVED yang dapat dijadwalkan (Status saat ini: ${listing.status})`);
    }

    if (!scheduledAt || scheduledAt <= Date.now()) {
      throw new Error('Waktu jadwal (scheduledAt) harus berupa waktu masa depan.');
    }

    listing.status = 'SCHEDULED';
    listing.scheduledAt = scheduledAt;
    listing.updatedAt = Date.now();
    db.listingRequests.set(listing.id, listing);
    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: listing.id,
      eventType: 'LISTING_SCHEDULED',
      actorId,
      aggregateVersion: listing.version,
      payload: {
        scheduledAt: listing.scheduledAt
      },
      reason: `Listing scheduled for activation at ${new Date(scheduledAt).toISOString()}`,
      securityMetadata: securityMeta
    });

    return listing;
  }

  /**
   * 7. Idempotent Market Activation
   */
  public static async activateListing(
    id: string, 
    actorId: string, 
    idempotencyKey?: string, 
    securityMeta?: any
  ): Promise<ActivationResult> {
    return ListingActivationService.activateMarket(id, actorId, idempotencyKey, securityMeta);
  }

  /**
   * 8. Suspend Market Trading
   */
  public static suspendMarket(id: string, actorId: string, reason: string, securityMeta?: any): Market {
    const listing = db.listingRequests.get(id);
    let market: Market | undefined;

    if (listing) {
      market = Array.from(db.markets.values()).find(m => m.listingRequestId === listing.id);
    } else {
      market = db.markets.get(id);
    }

    if (!market) {
      throw new Error(`Market tidak ditemukan untuk ID ${id}`);
    }

    market.status = 'HALTED';
    market.updatedAt = Date.now();
    db.markets.set(market.id, market);

    // Also update tradingPairs state
    const pair = db.tradingPairs.get(market.id);
    if (pair) {
      pair.isHalted = true;
      db.tradingPairs.set(pair.id, pair);
    }

    if (listing) {
      listing.status = 'SUSPENDED';
      listing.updatedAt = Date.now();
      db.listingRequests.set(listing.id, listing);
    }

    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: listing ? listing.id : market.id,
      eventType: 'MARKET_SUSPENDED',
      actorId,
      aggregateVersion: market.version,
      payload: {
        marketId: market.id,
        symbol: market.symbol,
        reason
      },
      reason: `Market suspended: ${reason}`,
      securityMetadata: securityMeta
    });

    marketWsService.broadcast({
      type: 'MARKET_STATUS_CHANGED',
      data: {
        symbol: market.symbol,
        status: 'HALTED',
        isHalted: true
      }
    });

    return market;
  }

  /**
   * 9. Resume Market Trading
   */
  public static resumeMarket(id: string, actorId: string, reason: string, securityMeta?: any): Market {
    const listing = db.listingRequests.get(id);
    let market: Market | undefined;

    if (listing) {
      market = Array.from(db.markets.values()).find(m => m.listingRequestId === listing.id);
    } else {
      market = db.markets.get(id);
    }

    if (!market) throw new Error(`Market tidak ditemukan untuk ID ${id}`);

    market.status = 'ACTIVE';
    market.updatedAt = Date.now();
    db.markets.set(market.id, market);

    const pair = db.tradingPairs.get(market.id);
    if (pair) {
      pair.isHalted = false;
      pair.isActive = true;
      db.tradingPairs.set(pair.id, pair);
    }

    if (listing) {
      listing.status = 'ACTIVE';
      listing.updatedAt = Date.now();
      db.listingRequests.set(listing.id, listing);
    }

    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: listing ? listing.id : market.id,
      eventType: 'MARKET_RESUMED',
      actorId,
      aggregateVersion: market.version,
      payload: {
        marketId: market.id,
        symbol: market.symbol,
        reason
      },
      reason: `Market resumed: ${reason}`,
      securityMetadata: securityMeta
    });

    marketWsService.broadcast({
      type: 'MARKET_STATUS_CHANGED',
      data: {
        symbol: market.symbol,
        status: 'ACTIVE',
        isHalted: false
      }
    });

    return market;
  }
}
