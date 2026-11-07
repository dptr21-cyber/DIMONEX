/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * server/services/listing/ListingActivationService.ts
 * Idempotent Market Activation Pipeline using Transactional Outbox,
 * Engine Readiness Verification, and Reconciliation.
 */

import crypto from 'crypto';
import { db } from '../../db/database.js';
import { Market, TradingPair, TransactionalOutboxEvent } from '../../db/types.js';
import { matchingEngine } from '../../engine/MatchingEngine.js';
import { ListingAuditService } from './ListingAuditService.js';
import { marketWsService } from '../../websocket/MarketDataWs.js';

export interface ActivationResult {
  success: boolean;
  isIdempotentReplay: boolean;
  market: Market;
  outboxEventId: string;
  message: string;
}

export class ListingActivationService {
  /**
   * Idempotent activation of an APPROVED or SCHEDULED listing request.
   */
  public static async activateMarket(
    listingRequestId: string, 
    actorId: string,
    idempotencyKeyHeader?: string,
    securityMeta?: any
  ): Promise<ActivationResult> {
    const listing = db.listingRequests.get(listingRequestId);
    if (!listing) {
      throw new Error(`Listing request tidak ditemukan: ${listingRequestId}`);
    }

    // 1. Validate status
    if (listing.status !== 'APPROVED' && listing.status !== 'SCHEDULED') {
      if (listing.status === 'ACTIVE') {
        // Find existing market for idempotent response
        const existingMarket = Array.from(db.markets.values()).find(
          m => m.listingRequestId === listing.id
        );
        if (existingMarket) {
          return {
            success: true,
            isIdempotentReplay: true,
            market: existingMarket,
            outboxEventId: `idemp-${listing.id}`,
            message: `Market ${existingMarket.symbol} sudah dalam status ACTIVE (Idempotent replay)`
          };
        }
      }
      throw new Error(`Listing request ${listingRequestId} belum dalam status APPROVED atau SCHEDULED (Status saat ini: ${listing.status})`);
    }

    // 2. Validate Maker-Checker approval validity against current version
    const approval = db.listingApprovals.get(listing.id);
    if (!approval) {
      throw new Error('Listing belum memiliki persetujuan (approval) dari reviewer');
    }
    if (approval.decision !== 'APPROVED') {
      throw new Error('Listing request ditolak (REJECTED) dan tidak dapat diaktifkan');
    }
    if (approval.configVersion !== listing.version) {
      throw new Error(`Persetujuan reviewer tidak valid: disetujui pada versi ${approval.configVersion}, namun versi listing saat ini adalah ${listing.version}`);
    }

    // 3. Ensure base and quote assets exist
    const baseAsset = db.assets.get(listing.assetId);
    const quoteAsset = db.assets.get(listing.quoteAssetId);
    if (!baseAsset || !quoteAsset) {
      throw new Error('Asset dasar atau quote asset untuk listing ini tidak valid');
    }

    const marketSymbol = `${baseAsset.symbol}-${quoteAsset.symbol}`;
    const idempotencyKey = idempotencyKeyHeader || `activate:${listing.id}:v${listing.version}`;

    // 4. Check Idempotency Record
    const existingOutbox = Array.from(db.outboxEvents.values()).find(
      o => o.idempotencyKey === idempotencyKey
    );
    if (existingOutbox && existingOutbox.status === 'DELIVERED') {
      const existingMarket = db.markets.get(marketSymbol);
      if (existingMarket && existingMarket.status === 'ACTIVE') {
        return {
          success: true,
          isIdempotentReplay: true,
          market: existingMarket,
          outboxEventId: existingOutbox.id,
          message: `Aktivasi idempoten: Market ${marketSymbol} telah aktif sebelumnya.`
        };
      }
    }

    // 5. Check if market already exists for (baseAssetId, quoteAssetId)
    const duplicateMarket = Array.from(db.markets.values()).find(
      m => m.baseAssetId === baseAsset.id && m.quoteAssetId === quoteAsset.id && m.id !== marketSymbol
    );
    if (duplicateMarket) {
      throw new Error(`Market pair untuk ${baseAsset.symbol}/${quoteAsset.symbol} sudah ada dengan ID ${duplicateMarket.id}`);
    }

    // 6. Step A: Transactional Outbox + Market PREPARING state
    const outboxId = crypto.randomUUID();
    const outboxEvent: TransactionalOutboxEvent = {
      id: outboxId,
      aggregateId: listing.id,
      eventType: 'COMMAND_ACTIVATE_MARKET',
      payload: {
        listingRequestId: listing.id,
        symbol: marketSymbol,
        baseCurrency: baseAsset.symbol,
        quoteCurrency: quoteAsset.symbol,
        baseDecimals: baseAsset.decimals,
        quoteDecimals: quoteAsset.decimals,
        tickSize: listing.tickSize,
        lotSize: listing.lotSize,
        minQuantity: listing.minQuantity,
        minNotional: listing.minNotional,
        makerFeeBps: listing.makerFeeBps,
        takerFeeBps: listing.takerFeeBps,
        version: listing.version
      },
      idempotencyKey,
      status: 'PROCESSING',
      attempts: 1,
      createdAt: Date.now()
    };
    db.outboxEvents.set(outboxId, outboxEvent);

    const now = Date.now();
    const marketEntity: Market = {
      id: marketSymbol,
      baseAssetId: baseAsset.id,
      quoteAssetId: quoteAsset.id,
      listingRequestId: listing.id,
      symbol: marketSymbol,
      status: 'PREPARING',
      tickSize: listing.tickSize,
      lotSize: listing.lotSize,
      minQuantity: listing.minQuantity,
      minNotional: listing.minNotional,
      makerFeeBps: listing.makerFeeBps,
      takerFeeBps: listing.takerFeeBps,
      version: listing.version,
      createdAt: now,
      updatedAt: now
    };
    db.markets.set(marketSymbol, marketEntity);

    ListingAuditService.recordEvent({
      aggregateId: listing.id,
      eventType: 'MARKET_PREPARED',
      actorId,
      idempotencyKey,
      aggregateVersion: listing.version,
      payload: {
        symbol: marketSymbol,
        marketId: marketEntity.id,
        outboxId
      },
      reason: 'Outbox activation event generated, market set to PREPARING',
      securityMetadata: securityMeta
    });

    // 7. Step B: Engine Consumer Execution (At-least-once, Idempotent)
    try {
      // 7a. Register TradingPair in database store
      const tradingPair: TradingPair = {
        id: marketSymbol,
        baseCurrency: baseAsset.symbol,
        quoteCurrency: quoteAsset.symbol,
        baseDecimals: baseAsset.decimals,
        quoteDecimals: quoteAsset.decimals,
        minOrderSize: listing.minQuantity || '100000000',
        maxOrderSize: (listing as any).maxQuantity || (10000000n * (10n ** BigInt(baseAsset.decimals))).toString(), // 10,000,000 base tokens
        makerFeeBps: listing.makerFeeBps,
        takerFeeBps: listing.takerFeeBps,
        isActive: true,
        isHalted: false,
        lastPrice: '0',
        high24h: '0',
        low24h: '0',
        volume24h: '0',
        priceChange24h: '0.00'
      };
      db.tradingPairs.set(marketSymbol, tradingPair);

      // 7b. Instantiate empty order book in Matching Engine
      const book = matchingEngine.getOrderBook(marketSymbol);
      if (!book) {
        throw new Error(`Matching Engine gagal menginisialisasi order book untuk ${marketSymbol}`);
      }

      // Verify book is truly empty (zero fake trades, zero fake orders)
      const bookDepth = book.getDepth(5);
      if (bookDepth.bids.length > 0 || bookDepth.asks.length > 0) {
        // Clean any unexpected leftover state
        book.bids = [];
        book.asks = [];
      }

      // 7c. Transition state to ACTIVE
      marketEntity.status = 'ACTIVE';
      marketEntity.activatedAt = Date.now();
      marketEntity.updatedAt = Date.now();
      db.markets.set(marketSymbol, marketEntity);

      listing.status = 'ACTIVE';
      listing.updatedAt = Date.now();
      db.listingRequests.set(listing.id, listing);

      // 7d. Update Base Asset Status & Deposit/Withdrawal Schedules
      baseAsset.status = 'ACTIVE';
      baseAsset.depositEnabled = listing.depositEnabled !== undefined ? listing.depositEnabled : true;
      baseAsset.withdrawalEnabled = listing.withdrawalEnabled !== undefined ? listing.withdrawalEnabled : true;
      baseAsset.depositOpenedAt = listing.depositOpenedAt || Date.now();
      baseAsset.withdrawalOpenedAt = listing.withdrawalOpenedAt || Date.now();
      baseAsset.updatedAt = Date.now();
      db.assets.set(baseAsset.id, baseAsset);

      // 7e. Prepare Designated Market Maker (MM) Account with initial liquidity
      const mmUserId = listing.marketMakerAccountId || 'usr-mm-0000-0000-000000000001';
      const initialBaseSeed = listing.initialLiquidityBase || '1000000000000'; // 10,000 base tokens
      const initialQuoteSeed = listing.initialLiquidityQuoteIdr || '5000000000000'; // 50B IDR sen
      db.createOrGetAccount(mmUserId, baseAsset.symbol, initialBaseSeed);
      db.createOrGetAccount(mmUserId, quoteAsset.symbol, initialQuoteSeed);

      // 7f. Prepare Project Owner / Issuer Trader Account
      if (listing.projectOwnerAccountId) {
        db.createOrGetAccount(listing.projectOwnerAccountId, baseAsset.symbol, '0');
        db.createOrGetAccount(listing.projectOwnerAccountId, quoteAsset.symbol, '0');
      }

      // 7g. Outbox Acknowledgment
      outboxEvent.status = 'DELIVERED';
      outboxEvent.deliveredAt = Date.now();
      db.outboxEvents.set(outboxId, outboxEvent);

      db.scheduleSave();

      // 8. Step C: Record Audit Trail Event
      ListingAuditService.recordEvent({
        aggregateId: listing.id,
        eventType: 'MARKET_ACTIVATED',
        actorId,
        idempotencyKey,
        aggregateVersion: listing.version,
        payload: {
          symbol: marketSymbol,
          activatedAt: marketEntity.activatedAt,
          engineReady: true
        },
        reason: 'Market successfully activated and matching engine verified',
        securityMetadata: securityMeta
      });

      // 9. Step D: Broadcast via WebSocket
      marketWsService.broadcast({
        type: 'MARKET_ACTIVATED',
        data: {
          symbol: marketSymbol,
          baseCurrency: baseAsset.symbol,
          quoteCurrency: quoteAsset.symbol,
          tickSize: listing.tickSize,
          lotSize: listing.lotSize,
          activatedAt: marketEntity.activatedAt
        }
      });

      return {
        success: true,
        isIdempotentReplay: false,
        market: marketEntity,
        outboxEventId: outboxId,
        message: `Market ${marketSymbol} berhasil diaktifkan secara idempoten.`
      };
    } catch (engineErr: any) {
      outboxEvent.status = 'FAILED';
      outboxEvent.lastError = engineErr.message;
      db.outboxEvents.set(outboxId, outboxEvent);

      marketEntity.status = 'PREPARING'; // Do NOT allow trading
      db.markets.set(marketSymbol, marketEntity);

      ListingAuditService.recordEvent({
        aggregateId: listing.id,
        eventType: 'ACTIVATION_FAILED',
        actorId,
        idempotencyKey,
        aggregateVersion: listing.version,
        payload: {
          symbol: marketSymbol,
          error: engineErr.message
        },
        reason: 'Engine activation failed during execution',
        securityMetadata: securityMeta
      });

      throw new Error(`Aktivasi market gagal pada matching engine: ${engineErr.message}`);
    }
  }

  /**
   * Health and readiness reconciliation between database and matching engine.
   * If a divergence is found (e.g. market is ACTIVE in DB but OrderBook is missing in Engine),
   * repairs or flags the divergence.
   */
  public static reconcileMarketReadiness(marketSymbol: string): {
    isConsistent: boolean;
    dbStatus: string;
    engineBookLoaded: boolean;
    bidsCount: number;
    asksCount: number;
    repaired: boolean;
  } {
    const market = db.markets.get(marketSymbol);
    if (!market) {
      return {
        isConsistent: false,
        dbStatus: 'NOT_FOUND',
        engineBookLoaded: false,
        bidsCount: 0,
        asksCount: 0,
        repaired: false
      };
    }

    let bookLoaded = false;
    let bidsCount = 0;
    let asksCount = 0;
    let repaired = false;

    try {
      const book = matchingEngine.getOrderBook(marketSymbol);
      if (book) {
        bookLoaded = true;
        bidsCount = book.bids.length;
        asksCount = book.asks.length;
      }
    } catch (e) {
      bookLoaded = false;
    }

    if (market.status === 'ACTIVE' && !bookLoaded) {
      // Divergence: repair by instantiating book
      const pair = db.tradingPairs.get(marketSymbol);
      if (pair) {
        matchingEngine.getOrderBook(marketSymbol);
        repaired = true;
      }
    }

    return {
      isConsistent: market.status === 'ACTIVE' ? bookLoaded : true,
      dbStatus: market.status,
      engineBookLoaded: bookLoaded,
      bidsCount,
      asksCount,
      repaired
    };
  }
}
