/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NewsCmsService.ts
 * Production News & Announcement CMS service with Maker-Checker governance,
 * version history, HTML sanitization, scheduled publication worker, and
 * atomic notification broadcast integration.
 */

import crypto from 'crypto';
import { db } from '../../db/database.js';
import {
  Announcement,
  AnnouncementCategory,
  AnnouncementStatus,
  AnnouncementVersion,
  NotificationCampaign,
  NotificationChannel,
  NotificationTargetConfig,
  NotificationTargetSegment
} from '../../db/types.js';
import {
  extractPlainText,
  generateSlug,
  isSafeMediaUrl,
  sanitizeArticleHtml
} from './HtmlSanitizer.js';
import { getAuditLogsForEntity, recordCmsAudit } from './CmsAuditService.js';
import { notificationBroadcastService } from './NotificationBroadcastService.js';
import { marketWsService } from '../../websocket/MarketDataWs.js';

export const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = [
  'ANNOUNCEMENT',
  'PLATFORM_UPDATE',
  'MAINTENANCE',
  'NEW_LISTING',
  'SECURITY_ALERT',
  'TRADING_COMPETITION',
  'DEPOSIT_WITHDRAWAL_UPDATE',
  'IMPORTANT_NOTICE'
];

// High-priority categories enforce Maker-Checker dual approval before publishing
export const HIGH_PRIORITY_CATEGORIES = new Set<AnnouncementCategory>([
  'SECURITY_ALERT',
  'IMPORTANT_NOTICE',
  'MAINTENANCE'
]);

export interface AdminActor {
  id: string;
  email?: string;
  role: string;
  ipAddress?: string;
}

export interface CreateAnnouncementInput {
  title: string;
  slug?: string;
  category: AnnouncementCategory;
  shortDescription: string;
  contentHtml: string;
  coverImageUrl?: string;
  isPinned?: boolean;
  requiresApproval?: boolean;
  notificationEnabled?: boolean;
  notificationChannels?: NotificationChannel[];
  targetSegment?: NotificationTargetSegment;
  targetConfig?: NotificationTargetConfig;
  scheduledAt?: number;
}

export interface UpdateAnnouncementInput {
  title?: string;
  slug?: string;
  category?: AnnouncementCategory;
  shortDescription?: string;
  contentHtml?: string;
  coverImageUrl?: string | null;
  isPinned?: boolean;
  requiresApproval?: boolean;
  notificationEnabled?: boolean;
  notificationChannels?: NotificationChannel[];
  targetSegment?: NotificationTargetSegment;
  targetConfig?: NotificationTargetConfig;
  changeSummary?: string;
}

export class NewsCmsService {
  private schedulerInterval: NodeJS.Timeout | null = null;
  private pollIntervalMs = 5000;

  public startScheduler() {
    if (this.schedulerInterval) return;
    // Run an immediate check on startup in case scheduled articles matured during downtime
    this.processScheduledPublications();
    this.schedulerInterval = setInterval(() => {
      this.processScheduledPublications();
    }, this.pollIntervalMs);
  }

  public stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  private ensureUniqueSlug(desired: string, excludeId?: string): string {
    const base = generateSlug(desired);
    let candidate = base;
    let suffix = 2;

    const isTaken = (slug: string) => {
      for (const a of db.announcements.values()) {
        if (a.slug === slug && a.id !== excludeId) return true;
      }
      return false;
    };

    while (isTaken(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix++;
    }
    return candidate;
  }

  private validateCategory(category: string): AnnouncementCategory {
    if (!ANNOUNCEMENT_CATEGORIES.includes(category as AnnouncementCategory)) {
      throw new Error(`Invalid announcement category: ${category}`);
    }
    return category as AnnouncementCategory;
  }

  private sanitizeChannels(channels?: NotificationChannel[]): NotificationChannel[] {
    const allowed = new Set<NotificationChannel>(['IN_APP', 'WEB_PUSH', 'EMAIL']);
    const list = (channels || ['IN_APP']).filter(c => allowed.has(c));
    if (!list.includes('IN_APP')) list.unshift('IN_APP');
    return Array.from(new Set(list));
  }

  private recordVersionSnapshot(
    announcement: Announcement,
    editedBy: string,
    changeSummary?: string
  ) {
    const snapshot: AnnouncementVersion = {
      id: crypto.randomUUID(),
      announcementId: announcement.id,
      version: announcement.version,
      title: announcement.title,
      slug: announcement.slug,
      category: announcement.category,
      shortDescription: announcement.shortDescription,
      contentHtml: announcement.contentHtml,
      coverImageUrl: announcement.coverImageUrl,
      status: announcement.status,
      editedBy,
      changeSummary,
      createdAt: Date.now()
    };
    db.announcementVersions.push(snapshot);
  }

  public createAnnouncement(input: CreateAnnouncementInput, actor: AdminActor): Announcement {
    const title = String(input.title || '').trim();
    if (title.length < 3 || title.length > 240) {
      throw new Error('Title must be between 3 and 240 characters');
    }

    const category = this.validateCategory(input.category || 'ANNOUNCEMENT');
    const sanitizedHtml = sanitizeArticleHtml(input.contentHtml || '');
    const contentText = extractPlainText(sanitizedHtml);
    const shortDescription = String(input.shortDescription || contentText.slice(0, 220)).trim();

    if (shortDescription.length < 3 || shortDescription.length > 600) {
      throw new Error('Short description must be between 3 and 600 characters');
    }

    let coverImageUrl: string | undefined;
    if (input.coverImageUrl && String(input.coverImageUrl).trim()) {
      const candidate = String(input.coverImageUrl).trim();
      if (!isSafeMediaUrl(candidate)) {
        throw new Error('Invalid cover image URL');
      }
      coverImageUrl = candidate;
    }

    const slug = this.ensureUniqueSlug(input.slug ? String(input.slug) : title);
    const requiresApproval =
      Boolean(input.requiresApproval) || HIGH_PRIORITY_CATEGORIES.has(category);
    const now = Date.now();
    const authorUser = db.users.get(actor.id);
    const authorKyc = db.kyc.get(actor.id);

    const announcement: Announcement = {
      id: crypto.randomUUID(),
      title,
      slug,
      category,
      shortDescription,
      contentHtml: sanitizedHtml,
      contentText,
      coverImageUrl,
      authorAdminId: actor.id,
      authorName: authorKyc?.fullName || authorUser?.email || 'DIMONEX Editorial',
      lastEditedBy: actor.id,
      status: 'DRAFT',
      isPinned: Boolean(input.isPinned),
      requiresApproval,
      notificationEnabled: Boolean(input.notificationEnabled),
      notificationChannels: this.sanitizeChannels(input.notificationChannels),
      targetSegment: input.targetSegment || 'ALL_USERS',
      targetConfig: input.targetConfig,
      scheduledAt: input.scheduledAt,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    db.announcements.set(announcement.id, announcement);
    this.recordVersionSnapshot(announcement, actor.id, 'Initial draft created');

    recordCmsAudit({
      entityType: 'ANNOUNCEMENT',
      entityId: announcement.id,
      action: 'ANNOUNCEMENT_CREATED',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      ipAddress: actor.ipAddress,
      details: {
        title: announcement.title,
        slug: announcement.slug,
        category: announcement.category,
        requiresApproval: announcement.requiresApproval
      }
    });

    db.saveToDisk();
    return announcement;
  }

  public updateAnnouncement(
    id: string,
    input: UpdateAnnouncementInput,
    actor: AdminActor
  ): Announcement {
    const existing = db.announcements.get(id);
    if (!existing) {
      throw new Error('Announcement not found');
    }

    if (input.title !== undefined) {
      const title = String(input.title).trim();
      if (title.length < 3 || title.length > 240) {
        throw new Error('Title must be between 3 and 240 characters');
      }
      existing.title = title;
    }

    if (input.slug !== undefined && String(input.slug).trim()) {
      existing.slug = this.ensureUniqueSlug(String(input.slug), existing.id);
    }

    if (input.category !== undefined) {
      existing.category = this.validateCategory(input.category);
    }

    if (input.contentHtml !== undefined) {
      existing.contentHtml = sanitizeArticleHtml(input.contentHtml);
      existing.contentText = extractPlainText(existing.contentHtml);
    }

    if (input.shortDescription !== undefined) {
      const desc = String(input.shortDescription).trim();
      if (desc.length < 3 || desc.length > 600) {
        throw new Error('Short description must be between 3 and 600 characters');
      }
      existing.shortDescription = desc;
    }

    if (input.coverImageUrl !== undefined) {
      if (input.coverImageUrl === null || String(input.coverImageUrl).trim() === '') {
        existing.coverImageUrl = undefined;
      } else {
        const candidate = String(input.coverImageUrl).trim();
        if (!isSafeMediaUrl(candidate)) {
          throw new Error('Invalid cover image URL');
        }
        existing.coverImageUrl = candidate;
      }
    }

    if (input.isPinned !== undefined) {
      existing.isPinned = Boolean(input.isPinned);
    }

    if (input.requiresApproval !== undefined || input.category !== undefined) {
      existing.requiresApproval =
        Boolean(input.requiresApproval ?? existing.requiresApproval) ||
        HIGH_PRIORITY_CATEGORIES.has(existing.category);
    }

    if (input.notificationEnabled !== undefined) {
      existing.notificationEnabled = Boolean(input.notificationEnabled);
    }

    if (input.notificationChannels !== undefined) {
      existing.notificationChannels = this.sanitizeChannels(input.notificationChannels);
    }

    if (input.targetSegment !== undefined) {
      existing.targetSegment = input.targetSegment;
    }

    if (input.targetConfig !== undefined) {
      existing.targetConfig = input.targetConfig;
    }

    // If a high-priority or approval-required draft is materially edited, reset prior approval
    if (
      existing.requiresApproval &&
      existing.status !== 'PUBLISHED' &&
      (input.title !== undefined || input.contentHtml !== undefined || input.shortDescription !== undefined)
    ) {
      existing.approvedBy = undefined;
      existing.approvedAt = undefined;
      if (existing.status === 'PENDING_APPROVAL') {
        existing.status = 'DRAFT';
      }
    }

    existing.version += 1;
    existing.lastEditedBy = actor.id;
    existing.updatedAt = Date.now();

    this.recordVersionSnapshot(existing, actor.id, input.changeSummary || `Updated v${existing.version}`);

    recordCmsAudit({
      entityType: 'ANNOUNCEMENT',
      entityId: existing.id,
      action: 'ANNOUNCEMENT_UPDATED',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      ipAddress: actor.ipAddress,
      details: {
        version: existing.version,
        changeSummary: input.changeSummary || 'Content edited'
      }
    });

    db.saveToDisk();
    return existing;
  }

  public previewAnnouncement(id: string) {
    const announcement = db.announcements.get(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }
    // Always re-run sanitizer defensively for preview output
    const safeHtml = sanitizeArticleHtml(announcement.contentHtml);
    return {
      ...announcement,
      contentHtml: safeHtml,
      contentText: extractPlainText(safeHtml),
      previewGeneratedAt: Date.now()
    };
  }

  public submitForApproval(id: string, actor: AdminActor): Announcement {
    const announcement = db.announcements.get(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }
    if (announcement.status === 'PUBLISHED' || announcement.status === 'ARCHIVED') {
      throw new Error(`Cannot submit announcement in ${announcement.status} status`);
    }

    announcement.status = 'PENDING_APPROVAL';
    announcement.requiresApproval = true;
    announcement.updatedAt = Date.now();

    recordCmsAudit({
      entityType: 'ANNOUNCEMENT',
      entityId: announcement.id,
      action: 'ANNOUNCEMENT_SUBMITTED_FOR_APPROVAL',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      ipAddress: actor.ipAddress,
      details: { version: announcement.version }
    });

    db.saveToDisk();
    return announcement;
  }

  /**
   * Maker-Checker Approval: Creator CANNOT approve their own announcement.
   */
  public approveAnnouncement(id: string, actor: AdminActor, note?: string): Announcement {
    const announcement = db.announcements.get(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }
    if (announcement.status !== 'PENDING_APPROVAL') {
      throw new Error(`Announcement must be in PENDING_APPROVAL status to approve (current: ${announcement.status})`);
    }
    if (announcement.authorAdminId === actor.id) {
      throw new Error('Maker-Checker Violation: Announcement creator cannot approve their own announcement');
    }

    announcement.approvedBy = actor.id;
    announcement.approvedAt = Date.now();
    announcement.updatedAt = Date.now();

    recordCmsAudit({
      entityType: 'ANNOUNCEMENT',
      entityId: announcement.id,
      action: 'ANNOUNCEMENT_APPROVED',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      ipAddress: actor.ipAddress,
      details: { version: announcement.version, note: note || 'Approved by checker' }
    });

    db.saveToDisk();
    return announcement;
  }

  /**
   * Publishes an announcement immediately and atomically enqueues a global notification
   * broadcast campaign if `notifyAllUsers` / `notificationEnabled` is true.
   */
  public publishAnnouncement(
    id: string,
    actor: AdminActor,
    options?: {
      notifyAllUsers?: boolean;
      notificationChannels?: NotificationChannel[];
      targetSegment?: NotificationTargetSegment;
      targetConfig?: NotificationTargetConfig;
    }
  ): { announcement: Announcement; campaign: NotificationCampaign | null } {
    const announcement = db.announcements.get(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }
    if (announcement.status === 'ARCHIVED') {
      throw new Error('Archived announcements cannot be published directly; create a new revision or unarchive first');
    }

    // Maker-Checker enforcement for high-priority or approval-flagged announcements
    if (announcement.requiresApproval) {
      if (!announcement.approvedBy) {
        throw new Error(
          'Maker-Checker approval required before publishing high-priority announcements. Submit for approval and have a second admin approve.'
        );
      }
      if (announcement.approvedBy === announcement.authorAdminId) {
        throw new Error('Maker-Checker violation: approver must differ from creator');
      }
    }

    // Re-sanitize before public release
    announcement.contentHtml = sanitizeArticleHtml(announcement.contentHtml);
    announcement.contentText = extractPlainText(announcement.contentHtml);

    const notifyEnabled =
      options?.notifyAllUsers !== undefined
        ? Boolean(options.notifyAllUsers)
        : announcement.notificationEnabled;

    if (options?.notificationChannels) {
      announcement.notificationChannels = this.sanitizeChannels(options.notificationChannels);
    }
    if (options?.targetSegment) {
      announcement.targetSegment = options.targetSegment;
    }
    if (options?.targetConfig) {
      announcement.targetConfig = options.targetConfig;
    }
    announcement.notificationEnabled = notifyEnabled;

    const now = Date.now();
    announcement.status = 'PUBLISHED';
    announcement.publishedAt = now;
    announcement.publishedBy = actor.id;
    announcement.scheduledAt = undefined;
    announcement.updatedAt = now;

    this.recordVersionSnapshot(announcement, actor.id, 'Published');

    recordCmsAudit({
      entityType: 'ANNOUNCEMENT',
      entityId: announcement.id,
      action: 'ANNOUNCEMENT_PUBLISHED',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      ipAddress: actor.ipAddress,
      details: {
        version: announcement.version,
        slug: announcement.slug,
        notifyAllUsers: notifyEnabled,
        channels: announcement.notificationChannels,
        targetSegment: announcement.targetSegment
      }
    });

    // Atomic outbox campaign creation if Notify All Users enabled
    let campaign: NotificationCampaign | null = null;
    if (notifyEnabled) {
      campaign = notificationBroadcastService.createCampaignForAnnouncement({
        announcement,
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        ipAddress: actor.ipAddress,
        channels: announcement.notificationChannels,
        targetSegment: announcement.targetSegment,
        targetConfig: announcement.targetConfig
      });
    } else {
      db.saveToDisk();
    }

    marketWsService.broadcastAnnouncementPublished({
      id: announcement.id,
      slug: announcement.slug,
      title: announcement.title,
      category: announcement.category,
      publishedAt: announcement.publishedAt
    });

    return { announcement, campaign };
  }

  /**
   * Schedules or reschedules future publication of an announcement.
   */
  public scheduleAnnouncement(
    id: string,
    scheduledAt: number,
    actor: AdminActor,
    options?: {
      notifyAllUsers?: boolean;
      notificationChannels?: NotificationChannel[];
      targetSegment?: NotificationTargetSegment;
      targetConfig?: NotificationTargetConfig;
    }
  ): Announcement {
    const announcement = db.announcements.get(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }
    if (announcement.status === 'PUBLISHED' || announcement.status === 'ARCHIVED') {
      throw new Error(`Cannot schedule announcement in ${announcement.status} status`);
    }
    if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) {
      throw new Error('Scheduled publication timestamp must be in the future');
    }

    if (announcement.requiresApproval && !announcement.approvedBy) {
      throw new Error('Maker-Checker approval required before scheduling high-priority announcements');
    }

    const wasScheduled = announcement.status === 'SCHEDULED';
    announcement.status = 'SCHEDULED';
    announcement.scheduledAt = scheduledAt;
    if (options?.notifyAllUsers !== undefined) {
      announcement.notificationEnabled = Boolean(options.notifyAllUsers);
    }
    if (options?.notificationChannels) {
      announcement.notificationChannels = this.sanitizeChannels(options.notificationChannels);
    }
    if (options?.targetSegment) {
      announcement.targetSegment = options.targetSegment;
    }
    if (options?.targetConfig) {
      announcement.targetConfig = options.targetConfig;
    }
    announcement.updatedAt = Date.now();

    recordCmsAudit({
      entityType: 'ANNOUNCEMENT',
      entityId: announcement.id,
      action: wasScheduled ? 'ANNOUNCEMENT_RESCHEDULED' : 'ANNOUNCEMENT_SCHEDULED',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      ipAddress: actor.ipAddress,
      details: {
        scheduledAt,
        scheduledIso: new Date(scheduledAt).toISOString(),
        notifyAllUsers: announcement.notificationEnabled
      }
    });

    db.saveToDisk();
    return announcement;
  }

  public archiveAnnouncement(id: string, actor: AdminActor): Announcement {
    const announcement = db.announcements.get(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }

    const prevStatus = announcement.status;
    announcement.status = 'ARCHIVED';
    announcement.isPinned = false;
    announcement.archivedAt = Date.now();
    announcement.archivedBy = actor.id;
    announcement.updatedAt = Date.now();

    recordCmsAudit({
      entityType: 'ANNOUNCEMENT',
      entityId: announcement.id,
      action: 'ANNOUNCEMENT_ARCHIVED',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      ipAddress: actor.ipAddress,
      details: { previousStatus: prevStatus }
    });

    db.saveToDisk();
    return announcement;
  }

  public togglePinAnnouncement(id: string, isPinned: boolean, actor: AdminActor): Announcement {
    const announcement = db.announcements.get(id);
    if (!announcement) {
      throw new Error('Announcement not found');
    }
    if (announcement.status === 'ARCHIVED' && isPinned) {
      throw new Error('Archived announcements cannot be pinned');
    }

    announcement.isPinned = Boolean(isPinned);
    announcement.updatedAt = Date.now();

    recordCmsAudit({
      entityType: 'ANNOUNCEMENT',
      entityId: announcement.id,
      action: announcement.isPinned ? 'ANNOUNCEMENT_PINNED' : 'ANNOUNCEMENT_UNPINNED',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      ipAddress: actor.ipAddress,
      details: { isPinned: announcement.isPinned }
    });

    db.saveToDisk();
    return announcement;
  }

  /**
   * Background scheduler tick: publishes all SCHEDULED announcements whose scheduledAt <= now.
   */
  public processScheduledPublications(nowMs: number = Date.now()): Announcement[] {
    const published: Announcement[] = [];
    for (const announcement of db.announcements.values()) {
      if (
        announcement.status === 'SCHEDULED' &&
        announcement.scheduledAt !== undefined &&
        announcement.scheduledAt <= nowMs
      ) {
        try {
          const { announcement: pub } = this.publishAnnouncement(announcement.id, {
            id: announcement.lastEditedBy || announcement.authorAdminId,
            role: 'SYSTEM_SCHEDULER'
          });
          published.push(pub);
        } catch (err) {
          console.error(`[NewsCmsService] Scheduled publish failed for ${announcement.id}:`, err);
        }
      }
    }
    return published;
  }

  // ---------------------------------------------------------------------------
  // ADMIN QUERIES
  // ---------------------------------------------------------------------------

  public listAdminAnnouncements(params?: {
    search?: string;
    category?: string;
    status?: string;
    pinnedOnly?: boolean;
    page?: number;
    limit?: number;
  }) {
    let items = Array.from(db.announcements.values());

    if (params?.category && params.category !== 'ALL') {
      items = items.filter(a => a.category === params.category);
    }
    if (params?.status && params.status !== 'ALL') {
      items = items.filter(a => a.status === params.status);
    }
    if (params?.pinnedOnly) {
      items = items.filter(a => a.isPinned);
    }
    if (params?.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();
      items = items.filter(
        a =>
          a.title.toLowerCase().includes(q) ||
          a.slug.toLowerCase().includes(q) ||
          a.shortDescription.toLowerCase().includes(q) ||
          a.contentText.toLowerCase().includes(q)
      );
    }

    items.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });

    const page = Math.max(1, Number(params?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params?.limit) || 15));
    const total = items.length;
    const start = (page - 1) * limit;

    return {
      items: items.slice(start, start + limit),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    };
  }

  public getAdminAnnouncementDetail(id: string) {
    const announcement = db.announcements.get(id);
    if (!announcement) return null;

    const versions = db.announcementVersions
      .filter(v => v.announcementId === id)
      .sort((a, b) => b.version - a.version);

    const auditLogs = getAuditLogsForEntity('ANNOUNCEMENT', id);

    const campaigns = Array.from(db.notificationCampaigns.values())
      .filter(c => c.announcementId === id)
      .sort((a, b) => b.createdAt - a.createdAt);

    return {
      announcement,
      versions,
      auditLogs,
      campaigns
    };
  }

  // ---------------------------------------------------------------------------
  // PUBLIC QUERIES (STRICTLY PUBLISHED ONLY — ZERO DRAFTS/ARCHIVED LEAKAGE)
  // ---------------------------------------------------------------------------

  public listPublicAnnouncements(params?: {
    category?: string;
    search?: string;
    pinnedOnly?: boolean;
    page?: number;
    limit?: number;
  }) {
    const allPublished = Array.from(db.announcements.values()).filter(
      a => a.status === 'PUBLISHED' && a.publishedAt !== undefined
    );

    const pinnedCount = allPublished.filter(a => a.isPinned).length;
    let items = allPublished;

    if (params?.category && params.category !== 'ALL') {
      items = items.filter(a => a.category === params.category);
    }

    if (params?.pinnedOnly) {
      items = items.filter(a => a.isPinned);
    }

    if (params?.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();
      items = items.filter(
        a =>
          a.title.toLowerCase().includes(q) ||
          a.shortDescription.toLowerCase().includes(q)
      );
    }

    // Pinned announcements always appear first, then newest publishedAt descending
    items.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return (b.publishedAt || 0) - (a.publishedAt || 0);
    });

    const page = Math.max(1, Number(params?.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(params?.limit) || 12));
    const total = items.length;
    const start = (page - 1) * limit;

    return {
      items: items.slice(start, start + limit).map(a => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        category: a.category,
        shortDescription: a.shortDescription,
        coverImageUrl: a.coverImageUrl,
        status: 'PUBLISHED' as const,
        isPinned: Boolean(a.isPinned),
        publishedAt: a.publishedAt,
        authorName: a.authorName || 'DIMONEX Official'
      })),
      pinnedCount,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    };
  }

  public getPublicAnnouncementBySlug(slug: string) {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    for (const a of db.announcements.values()) {
      if (a.slug.toLowerCase() === cleanSlug && a.status === 'PUBLISHED') {
        return {
          id: a.id,
          title: a.title,
          slug: a.slug,
          category: a.category,
          shortDescription: a.shortDescription,
          contentHtml: sanitizeArticleHtml(a.contentHtml),
          coverImageUrl: a.coverImageUrl,
          isPinned: a.isPinned,
          publishedAt: a.publishedAt,
          updatedAt: a.updatedAt,
          version: a.version,
          authorName: a.authorName || 'DIMONEX Official'
        };
      }
    }
    return null;
  }
}

export const newsCmsService = new NewsCmsService();
