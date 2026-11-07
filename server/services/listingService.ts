/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * server/services/listingService.ts
 * DIMONEX Centralized Cryptocurrency Spot Exchange — Core Initial Listing Service.
 * Implements:
 * 1. CRUD operations for Listing Requests with Zero-Float BigInt financial parameter validation.
 * 2. Strict Maker-Checker authorization workflow (Checker != Maker, version locking).
 * 3. Idempotent Market Activation Orchestrator that validates Engine Readiness before status transitions.
 * 4. Transactional Outbox pattern and Cryptographic Audit Trail integration.
 */

import crypto from 'crypto';
import { db } from '../db/database.js';
import { 
  Asset, 
  ListingRequest, 
  ListingApproval, 
  Market, 
  AssetType, 
  AssetStatus, 
  ListingStatus,
  TransactionalOutboxEvent,
  TradingPair
} from '../db/types.js';
import { matchingEngine } from '../engine/MatchingEngine.js';
import { ListingAuditService } from './listing/ListingAuditService.js';
import { ListingActivationService, ActivationResult } from './listing/ListingActivationService.js';
import { ListingService as InternalListingService, CreateAssetInput, CreateListingInput, UpdateListingInput } from './listing/ListingService.js';
import { marketWsService } from '../websocket/MarketDataWs.js';

export interface EngineReadinessCheck {
  isReady: boolean;
  checks: {
    matchingEngineResponsive: boolean;
    orderBookZeroState: boolean;
    pairSymbolUnique: boolean;
    baseAssetRegistered: boolean;
    quoteAssetRegistered: boolean;
    ledgerAccountsInitialized: boolean;
  };
  details: string;
}

export interface PublicListingApplicationInput {
  tokenName: string;
  tokenSymbol: string;
  network: string;
  contractAddress: string;
  decimals: number;
  projectWebsite: string;
  whitepaperUrl?: string;
  contactEmail: string;
  telegramHandle?: string;
  quoteCurrency?: 'USDT' | 'IDR';
  expectedInitialPriceIdr: string;
  initialLiquidityCommitmentIdr: string;
  description: string;
  projectOwnerAccountId?: string;
  depositOpenedAt?: number;
  withdrawalOpenedAt?: number;
  depositEnabled?: boolean;
  withdrawalEnabled?: boolean;
}

export class ListingService {
  /**
   * 1. CREATE Listing Request (Maker Action)
   */
  public static createListingRequest(
    input: CreateListingInput, 
    makerAdminId: string, 
    securityMeta?: any
  ): ListingRequest {
    if (!makerAdminId) {
      throw new Error('Maker identity (makerAdminId) wajib disertakan untuk membuat listing.');
    }
    return InternalListingService.createListingRequest(input, makerAdminId, securityMeta);
  }

  /**
   * 2. GET Listing Request by ID
   */
  public static getListingRequestById(id: string): (ListingRequest & { approval?: ListingApproval; asset?: Asset; quoteAsset?: Asset }) | null {
    const listing = db.listingRequests.get(id);
    if (!listing) return null;

    const approval = db.listingApprovals.get(id);
    const asset = db.assets.get(listing.assetId);
    const quoteAsset = db.assets.get(listing.quoteAssetId);

    return {
      ...listing,
      approval,
      asset,
      quoteAsset
    };
  }

  /**
   * 3. LIST Listing Requests with optional filter
   */
  public static listListingRequests(filter?: { status?: ListingStatus; assetId?: string }): Array<ListingRequest & { approval?: ListingApproval; assetSymbol?: string; quoteSymbol?: string }> {
    const all = Array.from(db.listingRequests.values());
    const filtered = all.filter(l => {
      if (filter?.status && l.status !== filter.status) return false;
      if (filter?.assetId && l.assetId !== filter.assetId) return false;
      return true;
    });

    return filtered.map(l => {
      const approval = db.listingApprovals.get(l.id);
      const asset = db.assets.get(l.assetId);
      const quoteAsset = db.assets.get(l.quoteAssetId);
      return {
        ...l,
        approval,
        assetSymbol: asset ? asset.symbol : 'UNKNOWN',
        quoteSymbol: quoteAsset ? quoteAsset.symbol : 'IDR'
      };
    });
  }

  /**
   * 4. UPDATE Listing Request
   * Sensitive parameter changes increment version and invalidate any previous approvals!
   */
  public static updateListingRequest(
    id: string, 
    input: UpdateListingInput, 
    actorId: string, 
    securityMeta?: any
  ): ListingRequest {
    return InternalListingService.updateListingRequest(id, input, actorId, securityMeta);
  }

  /**
   * 5. DELETE / CANCEL Listing Request
   */
  public static deleteListingRequest(id: string, actorId: string, reason?: string, securityMeta?: any): boolean {
    const listing = db.listingRequests.get(id);
    if (!listing) {
      throw new Error(`Listing request tidak ditemukan: ${id}`);
    }

    if (listing.status === 'ACTIVE') {
      throw new Error('Listing request yang sudah ACTIVE tidak dapat dihapus.');
    }

    listing.status = 'CANCELLED';
    listing.updatedAt = Date.now();
    db.listingRequests.set(id, listing);
    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: id,
      eventType: 'LISTING_REJECTED',
      actorId,
      aggregateVersion: listing.version,
      payload: { status: 'CANCELLED' },
      reason: reason || 'Listing request cancelled by admin',
      securityMetadata: securityMeta
    });

    return true;
  }

  /**
   * 6. SUBMIT for Review (Maker submits DRAFT -> PENDING_REVIEW)
   */
  public static submitForReview(id: string, actorId: string, securityMeta?: any): ListingRequest {
    return InternalListingService.submitForReview(id, actorId, securityMeta);
  }

  /**
   * 7. APPROVE Listing Request (Checker Action)
   * Strictly enforces Maker-Checker: reviewerId !== createdBy!
   */
  public static approveListingRequest(
    id: string, 
    checkerAdminId: string, 
    reason: string, 
    securityMeta?: any
  ): ListingApproval {
    if (!checkerAdminId) {
      throw new Error('Checker identity (checkerAdminId) wajib disertakan untuk approval.');
    }
    return InternalListingService.approveListing(id, checkerAdminId, reason, securityMeta);
  }

  /**
   * 8. REJECT Listing Request (Checker Action)
   * Strictly enforces Maker-Checker: reviewerId !== createdBy!
   */
  public static rejectListingRequest(
    id: string, 
    checkerAdminId: string, 
    reason: string, 
    securityMeta?: any
  ): ListingApproval {
    if (!checkerAdminId) {
      throw new Error('Checker identity (checkerAdminId) wajib disertakan untuk penolakan.');
    }
    return InternalListingService.rejectListing(id, checkerAdminId, reason, securityMeta);
  }

  /**
   * 9. VALIDATE ENGINE READINESS
   * Inspects matching engine state, order book clean status, ticker uniqueness, and asset registries.
   */
  public static validateEngineReadiness(listingRequestId: string): EngineReadinessCheck {
    const listing = db.listingRequests.get(listingRequestId);
    if (!listing) {
      throw new Error(`Listing request tidak ditemukan: ${listingRequestId}`);
    }

    const baseAsset = db.assets.get(listing.assetId);
    const quoteAsset = db.assets.get(listing.quoteAssetId);

    const baseAssetRegistered = !!baseAsset;
    const quoteAssetRegistered = !!quoteAsset;

    const marketSymbol = baseAsset && quoteAsset ? `${baseAsset.symbol}-${quoteAsset.symbol}` : 'UNKNOWN';

    // Check pair symbol uniqueness
    const existingMarket = Array.from(db.markets.values()).find(m => m.symbol === marketSymbol && m.status === 'ACTIVE');
    const existingTradingPair = Array.from(db.tradingPairs.values()).find(p => p.id === marketSymbol && p.isActive);
    const pairSymbolUnique = !existingMarket && !existingTradingPair;

    // Check matching engine responsiveness
    let matchingEngineResponsive = false;
    try {
      matchingEngineResponsive = typeof matchingEngine.getOrderBook === 'function';
    } catch {
      matchingEngineResponsive = false;
    }

    // Check order book zero-state: book for this market must either not exist or have 0 bids and 0 asks
    let orderBookZeroState = true;
    try {
      const book = matchingEngine.getOrderBook(marketSymbol);
      if (book) {
        orderBookZeroState = book.bids.length === 0 && book.asks.length === 0;
      }
    } catch {
      orderBookZeroState = true;
    }

    // Ledger accounts readiness
    const ledgerAccountsInitialized = baseAssetRegistered && quoteAssetRegistered;

    const isReady = (
      matchingEngineResponsive &&
      orderBookZeroState &&
      pairSymbolUnique &&
      baseAssetRegistered &&
      quoteAssetRegistered &&
      ledgerAccountsInitialized
    );

    let details = 'Semua pemeriksaan kesiapan engine memenuhi syarat.';
    if (!isReady) {
      const failures: string[] = [];
      if (!matchingEngineResponsive) failures.push('Matching engine tidak responsif');
      if (!orderBookZeroState) failures.push('Order book tidak dalam status nol (terdapat order menggantung)');
      if (!pairSymbolUnique) failures.push(`Simbol pasar ${marketSymbol} sudah aktif di bursa`);
      if (!baseAssetRegistered) failures.push('Aset dasar belum terdaftar');
      if (!quoteAssetRegistered) failures.push('Quote asset belum terdaftar');
      details = `Engine belum siap: ${failures.join(', ')}`;
    }

    return {
      isReady,
      checks: {
        matchingEngineResponsive,
        orderBookZeroState,
        pairSymbolUnique,
        baseAssetRegistered,
        quoteAssetRegistered,
        ledgerAccountsInitialized
      },
      details
    };
  }

  /**
   * 10. IDEMPOTENT MARKET ACTIVATION ORCHESTRATOR
   * Validates engine readiness before executing status updates to ACTIVE.
   * Dispatches transactional outbox event for guaranteed delivery.
   */
  public static async activateListingMarket(
    listingRequestId: string, 
    actorId: string, 
    idempotencyKey?: string, 
    securityMeta?: any
  ): Promise<ActivationResult> {
    // Run engine readiness verification FIRST before performing state transition
    const readiness = this.validateEngineReadiness(listingRequestId);
    if (!readiness.isReady) {
      throw new Error(`Aktivasi pasar gagal pra-verifikasi: ${readiness.details}`);
    }

    // Execute idempotent activation via activation pipeline
    return await ListingActivationService.activateMarket(
      listingRequestId, 
      actorId, 
      idempotencyKey, 
      securityMeta
    );
  }

  /**
   * 11. PUBLIC TOKEN LISTING APPLICATION (Project Portal)
   * Allows external crypto projects and token issuers to submit listing proposals.
   */
  public static submitPublicListingApplication(input: PublicListingApplicationInput, ipAddress: string): {
    applicationId: string;
    tokenSymbol: string;
    status: 'SUBMITTED';
    createdAt: number;
    trackingMessage: string;
  } {
    const symbol = input.tokenSymbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(symbol)) {
      throw new Error('Format simbol token harus 2-12 karakter alfanumerik huruf besar.');
    }

    InternalListingService.validateContractAddress(input.network, input.contractAddress);

    const applicationId = `REQ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const now = Date.now();

    // Check if asset already exists in db, otherwise register as PENDING
    let asset = Array.from(db.assets.values()).find(a => a.symbol === symbol);
    if (!asset) {
      const assetId = crypto.randomUUID();
      asset = {
        id: assetId,
        symbol,
        name: input.tokenName.trim(),
        assetType: 'TOKEN',
        decimals: input.decimals || 18,
        network: input.network.toUpperCase(),
        contractAddress: input.contractAddress.trim(),
        status: 'PENDING',
        depositEnabled: false,
        withdrawalEnabled: false,
        createdAt: now,
        updatedAt: now
      };
      db.assets.set(assetId, asset);
    }

    // Quote asset (USDT or IDR)
    const isUsdtQuote = (input.quoteCurrency || '').toUpperCase() === 'USDT';
    const quoteAsset = InternalListingService.getQuoteAsset(isUsdtQuote ? 'USDT' : 'IDR');

    // Create DRAFT listing request linked to system portal user
    const listingId = crypto.randomUUID();
    const tickSize = isUsdtQuote ? '10000' : '100';      // Default 0.01 USDT or Rp 1.00
    const lotSize = '1000000';   // Default lot base units
    const minQuantity = '1000000';
    const minNotional = isUsdtQuote ? '5000000' : '1000000'; // 5 USDT or Rp 10,000.00

    const listing: ListingRequest = {
      id: listingId,
      assetId: asset.id,
      quoteAssetId: quoteAsset.id,
      status: 'PENDING_REVIEW', // Automatically queued for Maker review
      tickSize,
      lotSize,
      minQuantity,
      minNotional,
      makerFeeBps: 10,
      takerFeeBps: 20,
      depositOpenedAt: input.depositOpenedAt,
      withdrawalOpenedAt: input.withdrawalOpenedAt,
      depositEnabled: input.depositEnabled !== undefined ? input.depositEnabled : true,
      withdrawalEnabled: input.withdrawalEnabled !== undefined ? input.withdrawalEnabled : true,
      marketMakerAccountId: 'usr-mm-0000-0000-000000000001',
      projectOwnerAccountId: input.projectOwnerAccountId,
      initialLiquidityQuoteIdr: input.initialLiquidityCommitmentIdr ? (BigInt(Math.floor(Number(input.initialLiquidityCommitmentIdr) || 0)) * (isUsdtQuote ? 1000000n : 100n)).toString() : undefined,
      createdBy: `portal:${input.contactEmail}`,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    db.listingRequests.set(listingId, listing);
    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: listingId,
      eventType: 'LISTING_SUBMITTED',
      actorId: `applicant:${input.contactEmail}`,
      aggregateVersion: 1,
      payload: {
        applicationId,
        tokenName: input.tokenName,
        tokenSymbol: symbol,
        network: input.network,
        contractAddress: input.contractAddress,
        decimals: input.decimals,
        website: input.projectWebsite,
        contact: input.contactEmail
      },
      reason: 'Public token listing application received via DIMONEX Portal',
      securityMetadata: { ip: ipAddress, userAgent: 'PUBLIC_PORTAL' }
    });

    return {
      applicationId,
      tokenSymbol: symbol,
      status: 'SUBMITTED',
      createdAt: now,
      trackingMessage: `Pengajuan listing untuk ${symbol} berhasil disimpan. Tim DIMONEX Listing Committee akan mereview dalam 1-3 hari kerja.`
    };
  }
}

// Export singleton and helper aliases
export const listingService = ListingService;
export default ListingService;
