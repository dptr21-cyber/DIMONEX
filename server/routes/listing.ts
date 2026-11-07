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

// GET /track/:id - Track listing application status
listingRouter.get('/track/:id', (req, res) => {
  try {
    const query = req.params.id.trim().toUpperCase();
    const allListings = Array.from(db.listingRequests.values());

    // Search by listing ID or asset symbol or createdBy portal email
    const match = allListings.find(l => {
      const asset = db.assets.get(l.assetId);
      return l.id === query || 
        (asset && asset.symbol === query) ||
        (l.createdBy && l.createdBy.toUpperCase().includes(query));
    });

    if (!match) {
      return res.status(404).json({
        error: `Pengajuan listing tidak ditemukan untuk ID atau Simbol "${query}"`,
        code: 'APPLICATION_NOT_FOUND'
      });
    }

    const asset = db.assets.get(match.assetId);
    const quote = db.assets.get(match.quoteAssetId);
    const approval = db.listingApprovals.get(match.id);
    const market = Array.from(db.markets.values()).find(m => m.listingRequestId === match.id);
    const mmUser = match.marketMakerAccountId ? db.users.get(match.marketMakerAccountId) : db.users.get('usr-mm-0000-0000-000000000001');
    const projectUser = match.projectOwnerAccountId ? db.users.get(match.projectOwnerAccountId) : null;

    const isDepositOpen = asset?.depositEnabled ?? match.depositEnabled ?? true;
    const isWithdrawOpen = asset?.withdrawalEnabled ?? match.withdrawalEnabled ?? true;

    // Compute progress stage
    let stage = 1;
    let stageName = 'Compliance Pre-Screening';
    if (match.status === 'PENDING_REVIEW') {
      stage = 2;
      stageName = 'Maker Review & Risk Assessment';
    } else if (match.status === 'APPROVED' || match.status === 'SCHEDULED') {
      stage = 3;
      stageName = 'Checker Approval & Engine Readiness';
    } else if (match.status === 'ACTIVE') {
      stage = 4;
      stageName = 'Market Live on Spot Exchange';
    } else if (match.status === 'REJECTED') {
      stage = 0;
      stageName = 'Rejected by Review Committee';
    }

    res.json({
      success: true,
      data: {
        id: match.id,
        tokenName: asset ? asset.name : 'Unknown',
        tokenSymbol: asset ? asset.symbol : 'UNKNOWN',
        network: asset ? asset.network : 'Unknown',
        status: match.status,
        stage,
        stageName,
        createdAt: match.createdAt,
        updatedAt: match.updatedAt,
        pair: `${asset?.symbol || 'TOKEN'}/${quote?.symbol || 'IDR'}`,
        approvalReason: approval?.reason,
        marketActive: market?.status === 'ACTIVE',
        depositStatus: isDepositOpen ? 'OPEN' : 'CLOSED',
        withdrawalStatus: isWithdrawOpen ? 'OPEN' : 'CLOSED',
        depositOpenedAt: match.depositOpenedAt || asset?.depositOpenedAt,
        withdrawalOpenedAt: match.withdrawalOpenedAt || asset?.withdrawalOpenedAt,
        marketMakerAccountId: match.marketMakerAccountId || 'usr-mm-0000-0000-000000000001',
        marketMakerEmail: mmUser ? mmUser.email : 'mm@dimonex.id',
        projectOwnerAccountId: match.projectOwnerAccountId || null,
        projectOwnerEmail: projectUser ? projectUser.email : (match.createdBy.startsWith('portal:') ? match.createdBy.replace('portal:', '') : '-')
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

// GET /public-list - Public list of all assets for listing explore tab
listingRouter.get('/public-list', (req, res) => {
  const assets = Array.from(db.assets.values()).map(a => {
    const market = Array.from(db.markets.values()).find(m => m.baseAssetId === a.id);
    const listing = Array.from(db.listingRequests.values()).find(l => l.assetId === a.id);
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
      hasActiveMarket: market ? market.status === 'ACTIVE' : false,
      marketSymbol: market ? market.symbol : `${a.symbol}-IDR`,
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

// POST /api/admin/listings/:id/schedule - Schedule activation
listingRouter.post('/:id/schedule', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { id } = req.params;
    const { scheduledAt } = req.body;

    const scheduled = ListingService.scheduleListing(id, Number(scheduledAt), adminUser.id, extractSecurityMeta(req));
    res.json({ success: true, listing: scheduled });
  } catch (err: any) {
    res.status(400).json({ error: err.message, code: 'SCHEDULE_FAILED' });
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
