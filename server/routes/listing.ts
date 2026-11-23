/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * server/routes/listing.ts
 * Admin Initial Listing Endpoints with Maker-Checker Authorization,
 * Idempotency, Input Validation, and Structured Error Responses.
 */

import { Router, Request, Response } from 'express';
import { requireAdmin } from './auth.js';
import { db } from '../db/database.js';
import { ListingService } from '../services/listing/ListingService.js';
import { ListingAuditService } from '../services/listing/ListingAuditService.js';
import { ListingActivationService } from '../services/listing/ListingActivationService.js';
import { listingService } from '../services/listingService.js';

export const listingRouter = Router();

// Helper to extract security metadata from Express Request
function extractSecurityMeta(req: Request) {
  const user = (req as any).user;
  return {
    ip: req.ip || req.socket.remoteAddress || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'unknown',
    authRole: user ? user.role : 'UNKNOWN',
    sessionHash: (req as any).token ? (req as any).token.slice(-12) : undefined
  };
}

// -------------------------------------------------------------
// PUBLIC LISTING PORTAL ENDPOINTS (No Admin auth required)
// -------------------------------------------------------------

// POST /apply - Submit new token listing proposal
listingRouter.post('/apply', (req, res) => {
  try {
    const {
      tokenName,
      tokenSymbol,
      network,
      contractAddress,
      decimals,
      projectWebsite,
      whitepaperUrl,
      contactEmail,
      telegramHandle,
      quoteCurrency,
      expectedInitialPriceIdr,
      initialLiquidityCommitmentIdr,
      description,
      projectOwnerAccountId,
      depositOpenedAt,
      withdrawalOpenedAt,
      depositEnabled,
      withdrawalEnabled
    } = req.body;

    if (!tokenName || !tokenSymbol || !network || !contactEmail) {
      return res.status(400).json({
        error: 'Nama token, simbol, jaringan, dan email kontak wajib diisi.',
        code: 'MISSING_FIELDS'
      });
    }

    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const result = listingService.submitPublicListingApplication({
      tokenName,
      tokenSymbol,
      network,
      contractAddress: contractAddress || '',
      decimals: Number(decimals) || 18,
      projectWebsite: projectWebsite || '',
      whitepaperUrl,
      contactEmail,
      telegramHandle,
      quoteCurrency: quoteCurrency === 'USDT' ? 'USDT' : 'IDR',
      expectedInitialPriceIdr: expectedInitialPriceIdr || '1000',
      initialLiquidityCommitmentIdr: initialLiquidityCommitmentIdr || '10000000',
      description: description || '',
      projectOwnerAccountId,
      depositOpenedAt: depositOpenedAt ? Number(depositOpenedAt) : undefined,
      withdrawalOpenedAt: withdrawalOpenedAt ? Number(withdrawalOpenedAt) : undefined,
      depositEnabled: depositEnabled !== undefined ? Boolean(depositEnabled) : true,
      withdrawalEnabled: withdrawalEnabled !== undefined ? Boolean(withdrawalEnabled) : true
    }, clientIp);

    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ error: err.message, code: 'APPLICATION_REJECTED' });
  }
});

function maskEmailForPublicView(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const [local, domain] = parts;
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function findAuditApplicationId(listingId: string): string | undefined {
  for (let i = db.listingAuditEvents.length - 1; i >= 0; i--) {
    const ev = db.listingAuditEvents[i];
    if (ev.aggregateId === listingId && ev.payload && typeof ev.payload.applicationId === 'string') {
      return ev.payload.applicationId;
    }
  }
  return undefined;
}

function resolveListingTrack(rawInput: string) {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { status: 400 as const, error: 'Masukkan Application ID, Simbol Token, atau Pair untuk melacak.', code: 'EMPTY_QUERY' };
  }
  if (trimmed.length > 128) {
    return { status: 400 as const, error: 'Query pelacakan terlalu panjang (maksimal 128 karakter).', code: 'INVALID_QUERY' };
  }

  const qUpper = trimmed.toUpperCase();
  const qNormalizedPair = qUpper.replace('/', '-');
  const pairParts = qNormalizedPair.includes('-') ? qNormalizedPair.split('-').filter(Boolean) : null;
  const baseFromPair = pairParts && pairParts.length >= 2 ? pairParts[0] : null;
  const quoteFromPair = pairParts && pairParts.length >= 2 ? pairParts[1] : null;

  // Sort newest first; prefer active / non-cancelled / non-rejected listings when matching by symbol
  const allListings = Array.from(db.listingRequests.values()).sort((a, b) => {
    const aTerminal = a.status === 'CANCELLED' || a.status === 'REJECTED' ? 1 : 0;
    const bTerminal = b.status === 'CANCELLED' || b.status === 'REJECTED' ? 1 : 0;
    if (aTerminal !== bTerminal) return aTerminal - bTerminal;
    return b.createdAt - a.createdAt;
  });

  let matchedByDirectSecret = false;

  // 1. Exact match on applicationId or listing UUID (case-insensitive)
  let match = allListings.find(l => {
    const appId = l.applicationId?.toUpperCase();
    return appId === qUpper || l.id.toUpperCase() === qUpper;
  });
  if (match) matchedByDirectSecret = true;

  // 2. Historical audit event match for legacy submissions where applicationId was only logged in listingAuditEvents
  if (!match) {
    const auditEvent = [...db.listingAuditEvents]
      .reverse()
      .find(ev => ev.payload && typeof ev.payload.applicationId === 'string' && ev.payload.applicationId.toUpperCase() === qUpper);
    if (auditEvent) {
      match = db.listingRequests.get(auditEvent.aggregateId);
      if (match) matchedByDirectSecret = true;
    }
  }

  // 3. Exact trading pair match (e.g. BTC-IDR, BTC/IDR, SOL-USDT)
  if (!match && baseFromPair && quoteFromPair) {
    match = allListings.find(l => {
      const asset = db.assets.get(l.assetId);
      const quote = db.assets.get(l.quoteAssetId);
      return asset?.symbol.toUpperCase() === baseFromPair && quote?.symbol.toUpperCase() === quoteFromPair;
    });
  }

  // 4. Exact asset symbol match
  if (!match) {
    match = allListings.find(l => {
      const asset = db.assets.get(l.assetId);
      return asset && (asset.symbol.toUpperCase() === qUpper || (baseFromPair && asset.symbol.toUpperCase() === baseFromPair));
    });
  }

  // 5. Exact applicant contact email match
  if (!match && qUpper.includes('@')) {
    match = allListings.find(l => {
      if (!l.createdBy) return false;
      const cleaned = l.createdBy.replace(/^portal:/i, '').toUpperCase();
      return cleaned === qUpper;
    });
    if (match) matchedByDirectSecret = true;
  }

  // 6. Partial match on applicationId, UUID, asset name, or portal email (min 3 chars)
  if (!match && qUpper.length >= 3) {
    match = allListings.find(l => {
      const asset = db.assets.get(l.assetId);
      const appId = (l.applicationId || findAuditApplicationId(l.id) || '').toUpperCase();
      const createdByClean = (l.createdBy || '').replace(/^portal:/i, '').toUpperCase();
      return (
        appId.includes(qUpper) ||
        l.id.toUpperCase().includes(qUpper) ||
        (asset && asset.name.toUpperCase().includes(qUpper)) ||
        (qUpper.includes('@') && createdByClean.includes(qUpper))
      );
    });
  }

  if (match) {
    const asset = db.assets.get(match.assetId);
    const quote = db.assets.get(match.quoteAssetId);
    const approval = db.listingApprovals.get(match.id);
    const pairKey = `${asset?.symbol || 'TOKEN'}-${quote?.symbol || 'IDR'}`;
    const market =
      Array.from(db.markets.values()).find(m => m.listingRequestId === match!.id) ||
      Array.from(db.markets.values()).find(m => m.symbol.toUpperCase() === pairKey.toUpperCase());
    const tradingPair = db.tradingPairs.get(pairKey);
    const mmUser = match.marketMakerAccountId
      ? db.users.get(match.marketMakerAccountId)
      : db.users.get('usr-mm-0000-0000-000000000001');
    const projectUser = match.projectOwnerAccountId ? db.users.get(match.projectOwnerAccountId) : null;

    const isDepositOpen = asset?.depositEnabled ?? match.depositEnabled ?? true;
    const isWithdrawOpen = asset?.withdrawalEnabled ?? match.withdrawalEnabled ?? true;
    const resolvedAppId = match.applicationId || findAuditApplicationId(match.id) || match.id;
    const isMarketLive =
      market?.status === 'ACTIVE' ||
      Boolean(tradingPair && tradingPair.isActive && !tradingPair.isDelisted && !tradingPair.isHalted);

    let stage = 1;
    let stageName = 'Compliance Pre-Screening';
    if (match.status === 'DRAFT') {
      stage = 1;
      stageName = 'Draft — Compliance Pre-Screening';
    } else if (match.status === 'PENDING_REVIEW') {
      stage = 2;
      stageName = 'Maker Review & Risk Assessment';
    } else if (match.status === 'APPROVED') {
      stage = 3;
      stageName = 'Checker Approval & Engine Readiness';
    } else if (match.status === 'SCHEDULED') {
      stage = 3;
      stageName = 'Scheduled for Spot Market Launch';
    } else if (match.status === 'ACTIVE') {
      stage = 4;
      stageName = 'Market Live on Spot Exchange';
    } else if (match.status === 'SUSPENDED') {
      stage = 4;
      stageName = 'Market Temporarily Suspended';
    } else if (match.status === 'REJECTED') {
      stage = 0;
      stageName = 'Rejected by Review Committee';
    } else if (match.status === 'CANCELLED') {
      stage = 0;
      stageName = 'Application Cancelled';
    }

    const rawOwnerEmail = projectUser
      ? projectUser.email
      : match.createdBy.startsWith('portal:')
      ? match.createdBy.replace('portal:', '')
      : '-';
    const safeOwnerEmail =
      rawOwnerEmail !== '-' && !matchedByDirectSecret
        ? maskEmailForPublicView(rawOwnerEmail)
        : rawOwnerEmail;

    return {
      status: 200 as const,
      data: {
        id: match.id,
        applicationId: resolvedAppId,
        tokenName: asset ? asset.name : 'Unknown',
        tokenSymbol: asset ? asset.symbol : 'UNKNOWN',
        network: asset ? asset.network : 'Unknown',
        status: match.status,
        stage,
        stageName,
        scheduledAt: match.scheduledAt,
        createdAt: match.createdAt,
        updatedAt: match.updatedAt,
        pair: `${asset?.symbol || 'TOKEN'}/${quote?.symbol || 'IDR'}`,
        approvalReason: approval?.reason,
        marketActive: isMarketLive,
        depositStatus: isDepositOpen ? 'OPEN' : 'CLOSED',
        withdrawalStatus: isWithdrawOpen ? 'OPEN' : 'CLOSED',
        depositOpenedAt: match.depositOpenedAt || asset?.depositOpenedAt,
        withdrawalOpenedAt: match.withdrawalOpenedAt || asset?.withdrawalOpenedAt,
        marketMakerAccountId: match.marketMakerAccountId || 'usr-mm-0000-0000-000000000001',
        marketMakerEmail: mmUser ? mmUser.email : 'mm@dimonex.id',
        projectOwnerAccountId: match.projectOwnerAccountId || null,
        projectOwnerEmail: safeOwnerEmail,
        source: 'LISTING_REQUEST' as const
      }
    };
  }

  // 7. Fallback to real Exchange Asset Registry (for already-listed core/seeded assets such as BTC, ETH, SOL)
  const allAssets = Array.from(db.assets.values());
  const matchedAsset =
    allAssets.find(a => a.symbol.toUpperCase() === qUpper || a.id.toUpperCase() === qUpper) ||
    (baseFromPair ? allAssets.find(a => a.symbol.toUpperCase() === baseFromPair) : undefined) ||
    (qUpper.length >= 3 ? allAssets.find(a => a.name.toUpperCase().includes(qUpper)) : undefined);

  if (matchedAsset) {
    const assetMarkets = Array.from(db.markets.values()).filter(m => m.baseAssetId === matchedAsset.id);
    const assetPairs = Array.from(db.tradingPairs.values()).filter(
      p => p.baseCurrency.toUpperCase() === matchedAsset.symbol.toUpperCase() && !p.isDelisted
    );
    const preferredPair =
      (quoteFromPair
        ? assetPairs.find(p => p.quoteCurrency.toUpperCase() === quoteFromPair)
        : undefined) ||
      assetPairs.find(p => p.isActive && !p.isHalted) ||
      assetPairs[0];
    const preferredMarket =
      (quoteFromPair
        ? assetMarkets.find(m => m.symbol.toUpperCase() === `${matchedAsset.symbol}-${quoteFromPair}`.toUpperCase())
        : undefined) ||
      assetMarkets.find(m => m.status === 'ACTIVE') ||
      assetMarkets[0];

    const isMarketLive =
      preferredMarket?.status === 'ACTIVE' ||
      Boolean(preferredPair && preferredPair.isActive && !preferredPair.isDelisted && !preferredPair.isHalted);

    let stage = 1;
    let stageName = 'Compliance Pre-Screening';
    if (matchedAsset.status === 'ACTIVE' || isMarketLive) {
      stage = 4;
      stageName = isMarketLive ? 'Market Live on Spot Exchange' : 'Active Exchange Settlement Asset';
    } else if (matchedAsset.status === 'SUSPENDED') {
      stage = 4;
      stageName = 'Asset Temporarily Suspended';
    } else if (matchedAsset.status === 'RETIRED') {
      stage = 0;
      stageName = 'Asset Retired / Delisted';
    }

    const pairLabel = preferredPair
      ? `${preferredPair.baseCurrency}/${preferredPair.quoteCurrency}`
      : preferredMarket
      ? preferredMarket.symbol.replace('-', '/')
      : `${matchedAsset.symbol}/IDR`;

    const mmUser = db.users.get('usr-mm-0000-0000-000000000001');

    return {
      status: 200 as const,
      data: {
        id: matchedAsset.id,
        applicationId: `LISTED-${matchedAsset.symbol}`,
        tokenName: matchedAsset.name,
        tokenSymbol: matchedAsset.symbol,
        network: matchedAsset.network,
        status: isMarketLive ? 'ACTIVE' : matchedAsset.status,
        stage,
        stageName,
        scheduledAt: preferredPair?.scheduledAt,
        createdAt: matchedAsset.createdAt,
        updatedAt: matchedAsset.updatedAt,
        pair: pairLabel,
        approvalReason: isMarketLive
          ? 'Aset telah terverifikasi dan aktif diperdagangkan di Pasar Spot DIMONEX.'
          : undefined,
        marketActive: isMarketLive,
        depositStatus: matchedAsset.depositEnabled ? 'OPEN' : 'CLOSED',
        withdrawalStatus: matchedAsset.withdrawalEnabled ? 'OPEN' : 'CLOSED',
        depositOpenedAt: matchedAsset.depositOpenedAt,
        withdrawalOpenedAt: matchedAsset.withdrawalOpenedAt,
        marketMakerAccountId: 'usr-mm-0000-0000-000000000001',
        marketMakerEmail: mmUser ? mmUser.email : 'mm@dimonex.id',
        projectOwnerAccountId: null,
        projectOwnerEmail: 'DIMONEX Official Registry',
        source: 'EXCHANGE_REGISTRY' as const
      }
    };
  }

  return {
    status: 404 as const,
    error: `Pengajuan listing tidak ditemukan untuk ID atau Simbol "${trimmed}". Pastikan Kode Permohonan (REQ-...) atau Simbol Token sudah benar.`,
    code: 'APPLICATION_NOT_FOUND'
  };
}

// GET /track?q=... - Track listing application status via query string (handles pairs like BTC/IDR & emails cleanly)
listingRouter.get('/track', (req, res) => {
  try {
    const rawQuery = String(req.query.q || req.query.id || '');
    const result = resolveListingTrack(rawQuery);
    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

// GET /track/:id - Track listing application status via path parameter
listingRouter.get('/track/:id', (req, res) => {
  try {
    const result = resolveListingTrack(req.params.id || '');
    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

// GET /public-list - Public list of all assets for listing explore tab
listingRouter.get('/public-list', (req, res) => {
  const assets = Array.from(db.assets.values()).map(a => {
    const assetMarkets = Array.from(db.markets.values()).filter(m => m.baseAssetId === a.id);
    const activeMarket = assetMarkets.find(m => m.status === 'ACTIVE') || assetMarkets[0];
    const listing = Array.from(db.listingRequests.values()).find(l => l.assetId === a.id && l.status !== 'CANCELLED' && l.status !== 'REJECTED')
      || Array.from(db.listingRequests.values()).find(l => l.assetId === a.id);
    const listingQuote = listing ? db.assets.get(listing.quoteAssetId) : undefined;
    const fallbackMarketSymbol = listingQuote ? `${a.symbol}-${listingQuote.symbol}` : `${a.symbol}-IDR`;
    const activeMarketSymbols = assetMarkets.filter(m => m.status === 'ACTIVE').map(m => m.symbol);

    return {
      id: a.id,
      symbol: a.symbol,
      name: a.name,
      assetType: a.assetType,
      network: a.network,
      contractAddress: a.contractAddress,
      decimals: a.decimals,
      status: a.status,
      depositEnabled: a.depositEnabled,
      withdrawalEnabled: a.withdrawalEnabled,
      depositOpenedAt: a.depositOpenedAt || listing?.depositOpenedAt,
      withdrawalOpenedAt: a.withdrawalOpenedAt || listing?.withdrawalOpenedAt,
      hasActiveMarket: activeMarket ? activeMarket.status === 'ACTIVE' : false,
      marketSymbol: activeMarket ? activeMarket.symbol : fallbackMarketSymbol,
      activeMarketSymbols,
      marketMakerAccountId: listing?.marketMakerAccountId,
      projectOwnerAccountId: listing?.projectOwnerAccountId
    };
  });
  res.json({ success: true, assets });
});

// -------------------------------------------------------------
// ASSETS ENDPOINTS
// -------------------------------------------------------------

// List All Registered Assets
listingRouter.get('/assets/list', requireAdmin, (req, res) => {
  const assets = Array.from(db.assets.values());
  res.json({ success: true, assets });
});

// Create New Asset
listingRouter.post('/assets', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { symbol, name, assetType, decimals, network, contractAddress, depositEnabled, withdrawalEnabled } = req.body;

    const asset = ListingService.createAsset({
      symbol,
      name,
      assetType,
      decimals,
      network,
      contractAddress,
      depositEnabled,
      withdrawalEnabled
    }, adminUser.id, extractSecurityMeta(req));

    res.status(201).json({ success: true, asset });
  } catch (err: any) {
    res.status(400).json({ error: err.message, code: 'INVALID_ASSET_DATA' });
  }
});

// -------------------------------------------------------------
// LISTING REQUESTS ENDPOINTS
// -------------------------------------------------------------

// GET /api/admin/listings - List listings with pagination and filters
listingRouter.get('/', requireAdmin, (req, res) => {
  try {
    const { status, search, page = '1', limit = '20' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));

    let listings = Array.from(db.listingRequests.values());

    if (status) {
      listings = listings.filter(l => l.status === (status as string).toUpperCase());
    }

    if (search) {
      const q = (search as string).toUpperCase();
      listings = listings.filter(l => {
        const baseAsset = db.assets.get(l.assetId);
        const quoteAsset = db.assets.get(l.quoteAssetId);
        return (
          (baseAsset && baseAsset.symbol.includes(q)) ||
          (quoteAsset && quoteAsset.symbol.includes(q)) ||
          l.id.includes(search as string)
        );
      });
    }

    // Sort by createdAt descending
    listings.sort((a, b) => b.createdAt - a.createdAt);

    const totalCount = listings.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = listings.slice(startIndex, startIndex + limitNum);

    const enriched = paginated.map(l => {
      const baseAsset = db.assets.get(l.assetId);
      const quoteAsset = db.assets.get(l.quoteAssetId);
      const approval = db.listingApprovals.get(l.id);
      const market = Array.from(db.markets.values()).find(m => m.listingRequestId === l.id);
      const creator = db.users.get(l.createdBy);
      const reviewer = approval ? db.users.get(approval.reviewerId) : null;
      const mmUser = l.marketMakerAccountId ? db.users.get(l.marketMakerAccountId) : db.users.get('usr-mm-0000-0000-000000000001');
      const projectUser = l.projectOwnerAccountId ? db.users.get(l.projectOwnerAccountId) : null;

      const isDepositOpen = baseAsset?.depositEnabled ?? l.depositEnabled ?? true;
      const isWithdrawOpen = baseAsset?.withdrawalEnabled ?? l.withdrawalEnabled ?? true;

      return {
        ...l,
        baseAsset,
        quoteAsset,
        symbol: baseAsset && quoteAsset ? `${baseAsset.symbol}-${quoteAsset.symbol}` : l.id,
        approval: approval ? {
          ...approval,
          reviewerEmail: reviewer ? reviewer.email : 'Unknown'
        } : null,
        market: market || null,
        creatorEmail: creator ? creator.email : (l.createdBy.startsWith('portal:') ? l.createdBy.replace('portal:', '') : 'Unknown'),
        marketMakerEmail: mmUser ? mmUser.email : 'mm@dimonex.id',
        marketMakerAccountId: l.marketMakerAccountId || 'usr-mm-0000-0000-000000000001',
        projectOwnerEmail: projectUser ? projectUser.email : (l.createdBy.startsWith('portal:') ? l.createdBy.replace('portal:', '') : '-'),
        projectOwnerAccountId: l.projectOwnerAccountId || null,
        depositStatus: isDepositOpen ? 'OPEN' : 'CLOSED',
        withdrawalStatus: isWithdrawOpen ? 'OPEN' : 'CLOSED',
        depositOpenedAt: l.depositOpenedAt || baseAsset?.depositOpenedAt,
        withdrawalOpenedAt: l.withdrawalOpenedAt || baseAsset?.withdrawalOpenedAt
      };
    });

    res.json({
      success: true,
      data: enriched,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalItems: totalCount,
        totalPages: Math.ceil(totalCount / limitNum)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

// GET /api/admin/listings/:id - Detailed view
listingRouter.get('/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const listing = db.listingRequests.get(id);
    if (!listing) {
      return res.status(404).json({ error: `Listing request tidak ditemukan: ${id}`, code: 'NOT_FOUND' });
    }

    const baseAsset = db.assets.get(listing.assetId);
    const quoteAsset = db.assets.get(listing.quoteAssetId);
    const approval = db.listingApprovals.get(listing.id);
    const market = Array.from(db.markets.values()).find(m => m.listingRequestId === listing.id);
    const creator = db.users.get(listing.createdBy);
    const reviewer = approval ? db.users.get(approval.reviewerId) : null;
    const auditEvents = ListingAuditService.getEventsForAggregate(listing.id);

    res.json({
      success: true,
      listing: {
        ...listing,
        baseAsset,
        quoteAsset,
        symbol: baseAsset && quoteAsset ? `${baseAsset.symbol}-${quoteAsset.symbol}` : listing.id,
        approval: approval ? {
          ...approval,
          reviewerEmail: reviewer ? reviewer.email : 'Unknown'
        } : null,
        market,
        creatorEmail: creator ? creator.email : 'Unknown',
        auditEvents
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

// GET /api/admin/listings/accounts/eligible - List available Market Maker and Project Trader accounts
listingRouter.get('/accounts/eligible', requireAdmin, (req, res) => {
  const accounts = Array.from(db.users.values()).map(u => {
    const kyc = db.kyc.get(u.id);
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      fullName: kyc?.fullName || u.email.split('@')[0],
      isMM: u.role === 'MM' || u.id === 'usr-mm-0000-0000-000000000001'
    };
  });
  res.json({ success: true, accounts });
});

// POST /api/admin/listings - Maker creates draft listing
listingRouter.post('/', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { 
      assetId, 
      quoteAssetId, 
      tickSize, 
      lotSize, 
      minQuantity, 
      maxQuantity,
      minNotional, 
      makerFeeBps, 
      takerFeeBps, 
      scheduledAt,
      depositOpenedAt,
      withdrawalOpenedAt,
      depositEnabled,
      withdrawalEnabled,
      marketMakerAccountId,
      projectOwnerAccountId,
      initialLiquidityBase,
      initialLiquidityQuoteIdr
    } = req.body;

    const listing = ListingService.createListingRequest({
      assetId,
      quoteAssetId,
      tickSize,
      lotSize,
      minQuantity,
      maxQuantity,
      minNotional,
      makerFeeBps,
      takerFeeBps,
      scheduledAt,
      depositOpenedAt,
      withdrawalOpenedAt,
      depositEnabled,
      withdrawalEnabled,
      marketMakerAccountId,
      projectOwnerAccountId,
      initialLiquidityBase,
      initialLiquidityQuoteIdr
    }, adminUser.id, extractSecurityMeta(req));

    res.status(201).json({ success: true, listing });
  } catch (err: any) {
    res.status(400).json({ error: err.message, code: 'LISTING_VALIDATION_ERROR' });
  }
});

// POST /api/admin/listings/:id/toggle-deposit - Toggle or schedule deposit open
listingRouter.post('/:id/toggle-deposit', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { id } = req.params;
    const { enabled, openedAt } = req.body;

    const listing = db.listingRequests.get(id);
    if (!listing) return res.status(404).json({ error: 'Listing tidak ditemukan' });

    const baseAsset = db.assets.get(listing.assetId);
    const newEnabled = enabled !== undefined ? Boolean(enabled) : !(listing.depositEnabled ?? true);
    listing.depositEnabled = newEnabled;
    if (openedAt !== undefined) listing.depositOpenedAt = openedAt;
    else if (newEnabled && !listing.depositOpenedAt) listing.depositOpenedAt = Date.now();
    listing.updatedAt = Date.now();

    if (baseAsset) {
      baseAsset.depositEnabled = newEnabled;
      baseAsset.depositOpenedAt = listing.depositOpenedAt;
      baseAsset.updatedAt = Date.now();
      db.assets.set(baseAsset.id, baseAsset);
    }
    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: listing.id,
      eventType: 'LISTING_UPDATED',
      actorId: adminUser.id,
      aggregateVersion: listing.version,
      payload: { depositEnabled: newEnabled, depositOpenedAt: listing.depositOpenedAt },
      reason: `Deposit status changed to ${newEnabled ? 'OPEN' : 'CLOSED'} by admin`,
      securityMetadata: extractSecurityMeta(req)
    });

    res.json({ success: true, depositEnabled: newEnabled, depositOpenedAt: listing.depositOpenedAt });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/listings/:id/toggle-withdraw - Toggle or schedule withdraw open
listingRouter.post('/:id/toggle-withdraw', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { id } = req.params;
    const { enabled, openedAt } = req.body;

    const listing = db.listingRequests.get(id);
    if (!listing) return res.status(404).json({ error: 'Listing tidak ditemukan' });

    const baseAsset = db.assets.get(listing.assetId);
    const newEnabled = enabled !== undefined ? Boolean(enabled) : !(listing.withdrawalEnabled ?? true);
    listing.withdrawalEnabled = newEnabled;
    if (openedAt !== undefined) listing.withdrawalOpenedAt = openedAt;
    else if (newEnabled && !listing.withdrawalOpenedAt) listing.withdrawalOpenedAt = Date.now();
    listing.updatedAt = Date.now();

    if (baseAsset) {
      baseAsset.withdrawalEnabled = newEnabled;
      baseAsset.withdrawalOpenedAt = listing.withdrawalOpenedAt;
      baseAsset.updatedAt = Date.now();
      db.assets.set(baseAsset.id, baseAsset);
    }
    db.scheduleSave();

    ListingAuditService.recordEvent({
      aggregateId: listing.id,
      eventType: 'LISTING_UPDATED',
      actorId: adminUser.id,
      aggregateVersion: listing.version,
      payload: { withdrawalEnabled: newEnabled, withdrawalOpenedAt: listing.withdrawalOpenedAt },
      reason: `Withdrawal status changed to ${newEnabled ? 'OPEN' : 'CLOSED'} by admin`,
      securityMetadata: extractSecurityMeta(req)
    });

    res.json({ success: true, withdrawalEnabled: newEnabled, withdrawalOpenedAt: listing.withdrawalOpenedAt });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/listings/:id - Update parameters (Maker or Admin)
listingRouter.patch('/:id', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { id } = req.params;
    const updated = ListingService.updateListingRequest(id, req.body, adminUser.id, extractSecurityMeta(req));
    res.json({ success: true, listing: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message, code: 'UPDATE_FAILED' });
  }
});

// POST /api/admin/listings/:id/submit - Submit draft for review
listingRouter.post('/:id/submit', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { id } = req.params;
    const submitted = ListingService.submitForReview(id, adminUser.id, extractSecurityMeta(req));
    res.json({ success: true, listing: submitted });
  } catch (err: any) {
    res.status(400).json({ error: err.message, code: 'SUBMIT_FAILED' });
  }
});

// POST /api/admin/listings/:id/approve - Checker approves
listingRouter.post('/:id/approve', requireAdmin, (req, res) => {
  try {
    const checkerUser = (req as any).user;
    const { id } = req.params;
    const { reason } = req.body;

    const approval = ListingService.approveListing(id, checkerUser.id, reason, extractSecurityMeta(req));
    res.json({ success: true, approval });
  } catch (err: any) {
    const isSelfApproval = err.message.includes('Maker-Checker');
    res.status(isSelfApproval ? 403 : 400).json({ 
      error: err.message, 
      code: isSelfApproval ? 'SELF_APPROVAL_FORBIDDEN' : 'APPROVAL_FAILED' 
    });
  }
});

// POST /api/admin/listings/:id/reject - Checker rejects
listingRouter.post('/:id/reject', requireAdmin, (req, res) => {
  try {
    const checkerUser = (req as any).user;
    const { id } = req.params;
    const { reason } = req.body;

    const approval = ListingService.rejectListing(id, checkerUser.id, reason, extractSecurityMeta(req));
    res.json({ success: true, approval });
  } catch (err: any) {
    const isSelfApproval = err.message.includes('Maker-Checker');
    res.status(isSelfApproval ? 403 : 400).json({ 
      error: err.message, 
      code: isSelfApproval ? 'SELF_APPROVAL_FORBIDDEN' : 'REJECTION_FAILED' 
    });
  }
});

// POST /api/admin/listings/:id/schedule - Schedule or reschedule activation
listingRouter.post('/:id/schedule', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { id } = req.params;
    const { scheduledAt } = req.body;

    const scheduled = ListingService.scheduleListing(id, Number(scheduledAt), adminUser.id, extractSecurityMeta(req));
    res.json({
      success: true,
      message: `Listing berhasil dijadwalkan untuk ${new Date(scheduled.scheduledAt || 0).toLocaleString('id-ID')}. Countdown timer kini aktif di Market Chart.`,
      listing: scheduled
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message, code: 'SCHEDULE_FAILED' });
  }
});

// POST /api/admin/listings/:id/unschedule - Cancel scheduled launch time
listingRouter.post('/:id/unschedule', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { id } = req.params;
    const updated = ListingService.cancelScheduleListing(id, adminUser.id, extractSecurityMeta(req));
    res.json({
      success: true,
      message: 'Jadwal aktivasi listing dibatalkan (kembali ke status APPROVED).',
      listing: updated
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message, code: 'UNSCHEDULE_FAILED' });
  }
});

// POST /api/admin/listings/:id/activate - Idempotent Market Activation
listingRouter.post('/:id/activate', requireAdmin, async (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { id } = req.params;
    const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;

    const result = await ListingService.activateListing(
      id, 
      adminUser.id, 
      idempotencyKey, 
      extractSecurityMeta(req)
    );

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message, code: 'ACTIVATION_FAILED' });
  }
});

// POST /api/admin/listings/:id/suspend - Suspend Market
listingRouter.post('/:id/suspend', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { id } = req.params;
    const { reason = 'Emergency regulatory halt' } = req.body;

    const market = ListingService.suspendMarket(id, adminUser.id, reason, extractSecurityMeta(req));
    res.json({ success: true, market });
  } catch (err: any) {
    res.status(400).json({ error: err.message, code: 'SUSPEND_FAILED' });
  }
});

// POST /api/admin/listings/:id/resume - Resume Market
listingRouter.post('/:id/resume', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { id } = req.params;
    const { reason = 'Resumed by market operations' } = req.body;

    const market = ListingService.resumeMarket(id, adminUser.id, reason, extractSecurityMeta(req));
    res.json({ success: true, market });
  } catch (err: any) {
    res.status(400).json({ error: err.message, code: 'RESUME_FAILED' });
  }
});

// GET /api/admin/listings/audit/verify - Cryptographic hash chain verification
listingRouter.get('/audit/verify', requireAdmin, (req, res) => {
  const result = ListingAuditService.verifyAuditIntegrity();
  res.json({ success: true, ...result });
});

// GET /api/admin/listings/:id/reconcile - Reconcile engine readiness
listingRouter.get('/:id/reconcile', requireAdmin, (req, res) => {
  const { id } = req.params;
  const listing = db.listingRequests.get(id);
  const symbol = listing ? `${db.assets.get(listing.assetId)?.symbol}-${db.assets.get(listing.quoteAssetId)?.symbol}` : id;
  const report = ListingActivationService.reconcileMarketReadiness(symbol);
  res.json({ success: true, symbol, report });
});
