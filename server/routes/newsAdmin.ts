/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * newsAdmin.ts
 * Admin Console routes for News & Announcement CMS, Media Library,
 * and Global Notification Broadcast Center.
 * Protected by RBAC (requireAdmin), Maker-Checker enforcement, and rate limiting.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAdmin } from './auth.js';
import { db } from '../db/database.js';
import {
  ANNOUNCEMENT_CATEGORIES,
  AdminActor,
  newsCmsService
} from '../services/cms/NewsCmsService.js';
import { notificationBroadcastService } from '../services/cms/NotificationBroadcastService.js';
import {
  deleteUploadedMedia,
  saveUploadedMedia
} from '../services/cms/MediaValidationService.js';
import { recordCmsAudit } from '../services/cms/CmsAuditService.js';

export const newsAdminRouter = Router();

// Sliding-window rate limiter for administrative publishing / upload / broadcast endpoints
const adminPublishRateMap = new Map<string, number[]>();

function createAdminRateLimiter(windowMs: number, maxRequests: number, label: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const key = `${label}:${user?.id || req.ip || 'unknown'}`;
    const now = Date.now();
    const recent = (adminPublishRateMap.get(key) || []).filter(ts => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      return res.status(429).json({
        error: `Rate limit exceeded for ${label}. Please wait before retrying.`,
        retryAfterMs: windowMs - (now - recent[0])
      });
    }
    recent.push(now);
    adminPublishRateMap.set(key, recent);
    next();
  };
}

const publishRateLimit = createAdminRateLimiter(60_000, 20, 'admin_publish');
const uploadRateLimit = createAdminRateLimiter(60_000, 30, 'admin_media_upload');

function getActor(req: Request): AdminActor {
  const user = (req as any).user;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown'
  };
}

// ============================================================================
// 1. NEWS & ANNOUNCEMENTS MANAGEMENT
// ============================================================================

newsAdminRouter.get('/news/categories', requireAdmin, (_req, res) => {
  res.json({ categories: ANNOUNCEMENT_CATEGORIES });
});

newsAdminRouter.get('/news', requireAdmin, (req, res) => {
  try {
    const result = newsCmsService.listAdminAnnouncements({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      pinnedOnly: req.query.pinned === 'true',
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 15
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

newsAdminRouter.post('/news', requireAdmin, (req, res) => {
  try {
    const actor = getActor(req);
    const announcement = newsCmsService.createAnnouncement(req.body || {}, actor);
    res.status(201).json(announcement);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

newsAdminRouter.get('/news/:id', requireAdmin, (req, res) => {
  const detail = newsCmsService.getAdminAnnouncementDetail(req.params.id);
  if (!detail) {
    return res.status(404).json({ error: 'Announcement not found' });
  }
  res.json(detail);
});

newsAdminRouter.patch('/news/:id', requireAdmin, (req, res) => {
  try {
    const actor = getActor(req);
    const updated = newsCmsService.updateAnnouncement(req.params.id, req.body || {}, actor);
    res.json(updated);
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

newsAdminRouter.post('/news/:id/preview', requireAdmin, (req, res) => {
  try {
    const preview = newsCmsService.previewAnnouncement(req.params.id);
    res.json(preview);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

newsAdminRouter.post('/news/:id/submit', requireAdmin, (req, res) => {
  try {
    const actor = getActor(req);
    const updated = newsCmsService.submitForApproval(req.params.id, actor);
    res.json(updated);
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

newsAdminRouter.post('/news/:id/approve', requireAdmin, (req, res) => {
  try {
    const actor = getActor(req);
    const updated = newsCmsService.approveAnnouncement(
      req.params.id,
      actor,
      typeof req.body?.note === 'string' ? req.body.note : undefined
    );
    res.json(updated);
  } catch (err: any) {
    const msg = err.message || 'Approval failed';
    const status = msg.includes('not found')
      ? 404
      : msg.includes('Maker-Checker')
      ? 403
      : 400;
    res.status(status).json({ error: msg });
  }
});

newsAdminRouter.post('/news/:id/publish', requireAdmin, publishRateLimit, (req, res) => {
  try {
    const actor = getActor(req);
    const body = req.body || {};
    const result = newsCmsService.publishAnnouncement(req.params.id, actor, {
      notifyAllUsers:
        body.notifyAllUsers !== undefined
          ? Boolean(body.notifyAllUsers)
          : body.notificationEnabled !== undefined
          ? Boolean(body.notificationEnabled)
          : undefined,
      notificationChannels: Array.isArray(body.notificationChannels)
        ? body.notificationChannels
        : undefined,
      targetSegment: body.targetSegment,
      targetConfig: body.targetConfig
    });
    res.json(result);
  } catch (err: any) {
    const msg = err.message || 'Publish failed';
    const status = msg.includes('not found')
      ? 404
      : msg.includes('Maker-Checker')
      ? 403
      : 400;
    res.status(status).json({ error: msg });
  }
});

newsAdminRouter.post('/news/:id/schedule', requireAdmin, publishRateLimit, (req, res) => {
  try {
    const actor = getActor(req);
    const body = req.body || {};
    const rawTs = body.scheduledAt;
    const scheduledAt =
      typeof rawTs === 'number' ? rawTs : typeof rawTs === 'string' ? Date.parse(rawTs) : NaN;
    if (!Number.isFinite(scheduledAt)) {
      return res.status(400).json({ error: 'Valid scheduledAt timestamp is required' });
    }
    const updated = newsCmsService.scheduleAnnouncement(req.params.id, scheduledAt, actor, {
      notifyAllUsers:
        body.notifyAllUsers !== undefined
          ? Boolean(body.notifyAllUsers)
          : body.notificationEnabled !== undefined
          ? Boolean(body.notificationEnabled)
          : undefined,
      notificationChannels: Array.isArray(body.notificationChannels)
        ? body.notificationChannels
        : undefined,
      targetSegment: body.targetSegment,
      targetConfig: body.targetConfig
    });
    res.json(updated);
  } catch (err: any) {
    const msg = err.message || 'Schedule failed';
    const status = msg.includes('not found')
      ? 404
      : msg.includes('Maker-Checker')
      ? 403
      : 400;
    res.status(status).json({ error: msg });
  }
});

newsAdminRouter.post('/news/:id/archive', requireAdmin, (req, res) => {
  try {
    const actor = getActor(req);
    const updated = newsCmsService.archiveAnnouncement(req.params.id, actor);
    res.json(updated);
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

newsAdminRouter.post('/news/:id/pin', requireAdmin, (req, res) => {
  try {
    const actor = getActor(req);
    const isPinned = Boolean(req.body?.isPinned);
    const updated = newsCmsService.togglePinAnnouncement(req.params.id, isPinned, actor);
    res.json(updated);
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ============================================================================
// 2. NOTIFICATION CAMPAIGNS (ADMIN NOTIFICATION CENTER)
// ============================================================================

newsAdminRouter.get('/notification-campaigns', requireAdmin, (req, res) => {
  const result = notificationBroadcastService.listCampaigns({
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    page: req.query.page ? Number(req.query.page) : 1,
    limit: req.query.limit ? Number(req.query.limit) : 20
  });
  res.json(result);
});

newsAdminRouter.get('/notification-campaigns/:id', requireAdmin, (req, res) => {
  const detail = notificationBroadcastService.getCampaignDetail(
    req.params.id,
    req.query.page ? Number(req.query.page) : 1,
    req.query.limit ? Number(req.query.limit) : 50
  );
  if (!detail) {
    return res.status(404).json({ error: 'Notification campaign not found' });
  }
  res.json(detail);
});

newsAdminRouter.post('/notification-campaigns/:id/retry', requireAdmin, publishRateLimit, (req, res) => {
  try {
    const actor = getActor(req);
    const result = notificationBroadcastService.retryFailedDeliveries(req.params.id, actor);
    res.json(result);
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

newsAdminRouter.post('/notification-campaigns/:id/cancel', requireAdmin, (req, res) => {
  try {
    const actor = getActor(req);
    const campaign = notificationBroadcastService.cancelCampaign(req.params.id, actor);
    res.json({ campaign });
  } catch (err: any) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

// ============================================================================
// 3. MEDIA LIBRARY
// ============================================================================

newsAdminRouter.get('/media', requireAdmin, (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  let items = Array.from(db.mediaAssets.values());
  if (search) {
    items = items.filter(
      m =>
        m.originalName.toLowerCase().includes(search) ||
        (m.altText || '').toLowerCase().includes(search)
    );
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ items, total: items.length });
});

newsAdminRouter.post('/media/upload', requireAdmin, uploadRateLimit, (req, res) => {
  try {
    const actor = getActor(req);
    const { originalName, mimeType, base64Data, altText } = req.body || {};
    const asset = saveUploadedMedia({
      originalName: String(originalName || 'upload.png'),
      declaredMimeType: typeof mimeType === 'string' ? mimeType : undefined,
      base64Data: String(base64Data || ''),
      altText: typeof altText === 'string' ? altText : undefined,
      uploadedBy: actor.id
    });

    recordCmsAudit({
      entityType: 'MEDIA',
      entityId: asset.id,
      action: 'MEDIA_UPLOADED',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      ipAddress: actor.ipAddress,
      details: {
        filename: asset.filename,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes
      }
    });

    res.status(201).json(asset);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Image upload failed' });
  }
});

newsAdminRouter.delete('/media/:id', requireAdmin, (req, res) => {
  const actor = getActor(req);
  const existing = db.mediaAssets.get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Media asset not found' });
  }
  deleteUploadedMedia(req.params.id);
  recordCmsAudit({
    entityType: 'MEDIA',
    entityId: existing.id,
    action: 'MEDIA_DELETED',
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    ipAddress: actor.ipAddress,
    details: { filename: existing.filename, originalName: existing.originalName }
  });
  res.json({ success: true });
});
