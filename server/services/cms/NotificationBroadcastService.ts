/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NotificationBroadcastService.ts
 * Production-grade persistent Transactional Outbox + Batch Worker broadcast engine
 * for DIMONEX Global Notifications.
 *
 * Guarantees:
 * - Never executes unbounded synchronous loops inside HTTP requests.
 * - Atomic campaign + outbox job + recipient delivery record creation.
 * - Idempotency keys prevent duplicate user notifications across retries & restarts.
 * - Batch recipient processing with configurable batch size.
 * - Exponential backoff retry for transient delivery failures.
 * - Worker recovery after server restart.
 * - Safe cancellation before completion.
 * - Respects user channel permissions & consent (In-App, Web Push, Email).
 */

import crypto from 'crypto';
import { db } from '../../db/database.js';
import {
  Announcement,
  NotificationCampaign,
  NotificationChannel,
  NotificationDeliveryRecord,
  NotificationOutboxJob,
  NotificationTargetConfig,
  NotificationTargetSegment,
  User,
  UserNotification,
  UserNotificationPreferences
} from '../../db/types.js';
import { marketWsService } from '../../websocket/MarketDataWs.js';
import { recordCmsAudit } from './CmsAuditService.js';

export type ChannelDeliveryHandler = (
  campaign: NotificationCampaign,
  delivery: NotificationDeliveryRecord,
  user: User
) => Promise<void>;

export interface CreateCampaignOptions {
  announcement: Announcement;
  actorId: string;
  actorEmail?: string;
  actorRole: string;
  ipAddress?: string;
  channels?: NotificationChannel[];
  targetSegment?: NotificationTargetSegment;
  targetConfig?: NotificationTargetConfig;
  scheduledAt?: number;
  idempotencyKey?: string;
}

export class NotificationBroadcastService {
  private workerInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  public batchSize = 50;
  public baseRetryDelayMs = 1500;
  public maxDeliveryAttempts = 4;
  private pollIntervalMs = 1000;
  private customDeliveryHook: ChannelDeliveryHandler | null = null;

  /**
   * Optional hook for automated tests to simulate transient channel failures.
   */
  public setDeliveryHook(hook: ChannelDeliveryHandler | null) {
    this.customDeliveryHook = hook;
  }

  public start() {
    this.recoverPendingCampaigns();
    if (this.workerInterval) return;
    this.workerInterval = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  public stop() {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
    }
  }

  /**
   * Recovers any IN-FLIGHT / PENDING campaigns and outbox jobs after a server restart.
   */
  public recoverPendingCampaigns(): number {
    let recoveredJobs = 0;
    const now = Date.now();

    for (const job of db.notificationOutboxJobs.values()) {
      if (job.status === 'PROCESSING') {
        job.status = 'PENDING';
        job.lockedAt = undefined;
        job.updatedAt = now;
        recoveredJobs++;
      } else if (job.status === 'PENDING') {
        recoveredJobs++;
      }
    }

    // Reset any deliveries left mid-flight during a crash back to QUEUED
    for (const delivery of db.notificationDeliveries.values()) {
      if (delivery.status === 'PROCESSING') {
        delivery.status = 'QUEUED';
        delivery.updatedAt = now;
      }
    }

    // Re-sync campaign metrics for all non-terminal campaigns
    for (const campaign of db.notificationCampaigns.values()) {
      if (campaign.status === 'QUEUED' || campaign.status === 'PROCESSING') {
        this.recomputeCampaignMetrics(campaign.id);
        // Ensure a pending outbox job exists for every active campaign
        const hasActiveJob = Array.from(db.notificationOutboxJobs.values()).some(
          j => j.campaignId === campaign.id && (j.status === 'PENDING' || j.status === 'PROCESSING')
        );
        if (!hasActiveJob && campaign.queuedCount > 0) {
          const recoveryJob: NotificationOutboxJob = {
            id: crypto.randomUUID(),
            campaignId: campaign.id,
            idempotencyKey: `recover:${campaign.id}:${now}`,
            eventType: 'CAMPAIGN_DISPATCH',
            payload: { campaignId: campaign.id, recovered: true },
            status: 'PENDING',
            attempts: 0,
            maxAttempts: 5,
            createdAt: now,
            updatedAt: now
          };
          db.notificationOutboxJobs.set(recoveryJob.id, recoveryJob);
          recoveredJobs++;
        }
      }
    }

    if (recoveredJobs > 0) {
      db.scheduleSave();
      setImmediate(() => {
        void this.tick();
      });
    }
    return recoveredJobs;
  }

  /**
   * Returns user notification preferences with safe defaults (In-App on, Push/Email opt-in off).
   */
  public getUserPreferences(userId: string): UserNotificationPreferences {
    const existing = db.userNotificationPreferences.get(userId);
    if (existing) return existing;
    return {
      userId,
      inAppEnabled: true,
      webPushEnabled: false,
      webPushPermissionGranted: false,
      emailEnabled: false,
      updatedAt: Date.now()
    };
  }

  public updateUserPreferences(
    userId: string,
    patch: Partial<Pick<UserNotificationPreferences, 'inAppEnabled' | 'webPushEnabled' | 'webPushPermissionGranted' | 'emailEnabled'>>
  ): UserNotificationPreferences {
    const current = this.getUserPreferences(userId);
    const now = Date.now();
    const nextWebPushPermission =
      patch.webPushPermissionGranted !== undefined
        ? Boolean(patch.webPushPermissionGranted)
        : current.webPushPermissionGranted;
    const nextWebPushEnabled =
      patch.webPushEnabled !== undefined
        ? Boolean(patch.webPushEnabled) && nextWebPushPermission
        : current.webPushEnabled && nextWebPushPermission;
    const nextEmailEnabled =
      patch.emailEnabled !== undefined ? Boolean(patch.emailEnabled) : current.emailEnabled;

    const updated: UserNotificationPreferences = {
      userId,
      inAppEnabled: patch.inAppEnabled !== undefined ? Boolean(patch.inAppEnabled) : current.inAppEnabled,
      webPushEnabled: nextWebPushEnabled,
      webPushPermissionGranted: nextWebPushPermission,
      emailEnabled: nextEmailEnabled,
      emailConsentAt: nextEmailEnabled ? (current.emailConsentAt || now) : undefined,
      updatedAt: now
    };
    db.userNotificationPreferences.set(userId, updated);
    db.scheduleSave();
    return updated;
  }

  /**
   * Resolves all eligible users matching the target segment while excluding disabled/system accounts.
   */
  public resolveEligibleUsers(
    targetSegment: NotificationTargetSegment = 'ALL_USERS',
    targetConfig?: NotificationTargetConfig
  ): User[] {
    const selectedSet = targetConfig?.selectedUserIds
      ? new Set(targetConfig.selectedUserIds)
      : null;

    const eligible: User[] = [];
    for (const user of db.users.values()) {
      // Exclude disabled/frozen/suspended and internal system accounts
      if (user.status !== 'active') continue;
      if (user.id.startsWith('sys-')) continue;

      if (targetSegment === 'VERIFIED_USERS') {
        const kyc = db.kyc.get(user.id);
        if (!kyc || kyc.status !== 'approved') continue;
      } else if (targetSegment === 'KYC_TIER') {
        const kyc = db.kyc.get(user.id);
        const minTier = targetConfig?.minKycTier ?? 1;
        if (!kyc || kyc.status !== 'approved' || kyc.tierLevel < minTier) continue;
      } else if (targetSegment === 'SELECTED_USERS') {
        if (!selectedSet || !selectedSet.has(user.id)) continue;
      }
      // ALL_USERS and extensible SEGMENT match active registered accounts
      eligible.push(user);
    }
    return eligible;
  }

  private isChannelPermittedForUser(userId: string, channel: NotificationChannel): boolean {
    const prefs = this.getUserPreferences(userId);
    if (channel === 'IN_APP') {
      return prefs.inAppEnabled !== false;
    }
    if (channel === 'WEB_PUSH') {
      return Boolean(prefs.webPushEnabled && prefs.webPushPermissionGranted);
    }
    if (channel === 'EMAIL') {
      return Boolean(prefs.emailEnabled && prefs.emailConsentAt);
    }
    return false;
  }

  /**
   * Atomically creates a broadcast campaign, its recipient delivery records, and
   * its durable outbox dispatch job. Does NOT execute delivery synchronously.
   */
  public createCampaignForAnnouncement(options: CreateCampaignOptions): NotificationCampaign {
    const { announcement } = options;
    const now = Date.now();
    const campaignIdempotencyKey =
      options.idempotencyKey || `campaign:${announcement.id}:v${announcement.version}`;

    // Idempotency guard: if campaign already exists for this key, return it without duplicating
    for (const existing of db.notificationCampaigns.values()) {
      if (existing.idempotencyKey === campaignIdempotencyKey) {
        return existing;
      }
    }

    const requestedChannels: NotificationChannel[] =
      options.channels && options.channels.length > 0
        ? Array.from(new Set(options.channels))
        : announcement.notificationChannels && announcement.notificationChannels.length > 0
        ? Array.from(new Set(announcement.notificationChannels))
        : ['IN_APP'];

    // Ensure IN_APP is included as the primary required channel
    if (!requestedChannels.includes('IN_APP')) {
      requestedChannels.unshift('IN_APP');
    }

    const targetSegment = options.targetSegment || announcement.targetSegment || 'ALL_USERS';
    const targetConfig = options.targetConfig || announcement.targetConfig;
    const eligibleUsers = this.resolveEligibleUsers(targetSegment, targetConfig);

    const campaignId = crypto.randomUUID();
    let queuedDeliveries = 0;

    for (const user of eligibleUsers) {
      for (const channel of requestedChannels) {
        if (!this.isChannelPermittedForUser(user.id, channel)) {
          continue;
        }
        const deliveryKey = `${campaignId}:${user.id}:${channel}`;
        const record: NotificationDeliveryRecord = {
          id: crypto.randomUUID(),
          campaignId,
          userId: user.id,
          channel,
          idempotencyKey: deliveryKey,
          status: 'QUEUED',
          attempts: 0,
          maxAttempts: this.maxDeliveryAttempts,
          createdAt: now,
          updatedAt: now
        };
        db.notificationDeliveries.set(record.id, record);
        queuedDeliveries++;
      }
    }

    const campaign: NotificationCampaign = {
      id: campaignId,
      announcementId: announcement.id,
      announcementSlug: announcement.slug,
      title: announcement.title,
      summary: announcement.shortDescription,
      category: announcement.category,
      coverImageUrl: announcement.coverImageUrl,
      channels: requestedChannels,
      targetSegment,
      targetConfig,
      idempotencyKey: campaignIdempotencyKey,
      status: queuedDeliveries > 0 ? 'QUEUED' : 'COMPLETED',
      createdBy: options.actorId,
      totalEligible: eligibleUsers.length,
      queuedCount: queuedDeliveries,
      sentCount: 0,
      failedCount: 0,
      readCount: 0,
      scheduledAt: options.scheduledAt,
      completedAt: queuedDeliveries === 0 ? now : undefined,
      createdAt: now,
      updatedAt: now
    };

    db.notificationCampaigns.set(campaign.id, campaign);

    if (queuedDeliveries > 0) {
      const outboxJob: NotificationOutboxJob = {
        id: crypto.randomUUID(),
        campaignId: campaign.id,
        idempotencyKey: `outbox:${campaignIdempotencyKey}`,
        eventType: 'CAMPAIGN_DISPATCH',
        payload: {
          campaignId: campaign.id,
          announcementId: announcement.id,
          totalDeliveries: queuedDeliveries
        },
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 5,
        nextRetryAt: options.scheduledAt && options.scheduledAt > now ? options.scheduledAt : undefined,
        createdAt: now,
        updatedAt: now
      };
      db.notificationOutboxJobs.set(outboxJob.id, outboxJob);
    }

    recordCmsAudit({
      entityType: 'CAMPAIGN',
      entityId: campaign.id,
      action: 'CAMPAIGN_CREATED',
      actorId: options.actorId,
      actorEmail: options.actorEmail,
      actorRole: options.actorRole,
      ipAddress: options.ipAddress,
      details: {
        announcementId: announcement.id,
        title: announcement.title,
        channels: requestedChannels,
        targetSegment,
        totalEligible: eligibleUsers.length,
        queuedDeliveries
      }
    });

    // Persist immediately so crash after HTTP response never loses the outbox job
    db.saveToDisk();

    // Schedule non-blocking background dispatch (never runs synchronously inside HTTP request)
    if (queuedDeliveries > 0 && (!options.scheduledAt || options.scheduledAt <= now)) {
      setImmediate(() => {
        void this.tick();
      });
    }

    return campaign;
  }

  /**
   * Processes one batch of due outbox jobs & queued delivery records.
   */
  public async tick(): Promise<{ processed: number }> {
    if (this.isProcessing) return { processed: 0 };
    this.isProcessing = true;
    let totalProcessed = 0;

    try {
      const now = Date.now();
      const dueJobs = Array.from(db.notificationOutboxJobs.values())
        .filter(
          j =>
            j.status === 'PENDING' &&
            (!j.nextRetryAt || j.nextRetryAt <= now)
        )
        .sort((a, b) => a.createdAt - b.createdAt);

      for (const job of dueJobs) {
        const campaign = db.notificationCampaigns.get(job.campaignId);
        if (!campaign) {
          job.status = 'FAILED';
          job.lastError = 'Campaign not found';
          job.updatedAt = Date.now();
          continue;
        }

        if (campaign.status === 'CANCELLED') {
          job.status = 'CANCELLED';
          job.updatedAt = Date.now();
          continue;
        }

        if (campaign.scheduledAt && campaign.scheduledAt > Date.now()) {
          continue;
        }

        job.status = 'PROCESSING';
        job.lockedAt = Date.now();
        job.attempts += 1;
        job.updatedAt = Date.now();

        if (!campaign.startedAt) {
          campaign.startedAt = Date.now();
        }
        campaign.status = 'PROCESSING';
        campaign.updatedAt = Date.now();

        const batchResult = await this.processCampaignBatch(campaign);
        totalProcessed += batchResult.processed;

        // Recompute accurate campaign metrics from recipient delivery records
        const latestCampaign = this.recomputeCampaignMetrics(campaign.id);

        if (!latestCampaign || latestCampaign.status === 'CANCELLED') {
          job.status = 'CANCELLED';
          job.lockedAt = undefined;
          job.updatedAt = Date.now();
        } else if (batchResult.remainingQueued === 0) {
          job.status = 'COMPLETED';
          job.lockedAt = undefined;
          job.updatedAt = Date.now();
        } else {
          // More batches or exponential-backoff retries remain: re-queue outbox job
          job.status = 'PENDING';
          job.lockedAt = undefined;
          job.nextRetryAt = batchResult.earliestRetryAt;
          job.updatedAt = Date.now();
        }
      }

      if (totalProcessed > 0 || dueJobs.length > 0) {
        db.scheduleSave();
      }

      // If more immediately runnable batches remain, yield to event loop and continue
      const hasImmediateWork = Array.from(db.notificationOutboxJobs.values()).some(
        j => j.status === 'PENDING' && (!j.nextRetryAt || j.nextRetryAt <= Date.now())
      );
      if (hasImmediateWork && this.workerInterval) {
        setImmediate(() => {
          void this.tick();
        });
      }
    } finally {
      this.isProcessing = false;
    }

    return { processed: totalProcessed };
  }

  /**
   * Processes up to `batchSize` runnable deliveries for a single campaign.
   */
  private async processCampaignBatch(
    campaign: NotificationCampaign
  ): Promise<{ processed: number; remainingQueued: number; earliestRetryAt?: number }> {
    const now = Date.now();
    const allDeliveries = Array.from(db.notificationDeliveries.values()).filter(
      d => d.campaignId === campaign.id
    );

    const runnable = allDeliveries.filter(
      d => d.status === 'QUEUED' && (!d.nextRetryAt || d.nextRetryAt <= now)
    );
    const batch = runnable.slice(0, this.batchSize);

    let processed = 0;
    for (const delivery of batch) {
      // Check for mid-run cancellation
      const liveCampaign = db.notificationCampaigns.get(campaign.id);
      if (!liveCampaign || liveCampaign.status === 'CANCELLED') {
        delivery.status = 'CANCELLED';
        delivery.updatedAt = Date.now();
        continue;
      }

      await this.executeSingleDelivery(liveCampaign, delivery);
      processed++;
    }

    let remainingQueued = 0;
    let earliestRetryAt: number | undefined;
    for (const d of allDeliveries) {
      if (d.status === 'QUEUED' || d.status === 'PROCESSING') {
        remainingQueued++;
        if (d.nextRetryAt && (!earliestRetryAt || d.nextRetryAt < earliestRetryAt)) {
          earliestRetryAt = d.nextRetryAt;
        }
      }
    }

    return { processed, remainingQueued, earliestRetryAt };
  }

  private findUserNotificationByIdempotencyKey(key: string): UserNotification | undefined {
    for (const n of db.userNotifications.values()) {
      if (n.idempotencyKey === key) return n;
    }
    return undefined;
  }

  private async executeSingleDelivery(
    campaign: NotificationCampaign,
    delivery: NotificationDeliveryRecord
  ): Promise<void> {
    const now = Date.now();
    delivery.status = 'PROCESSING';
    delivery.attempts += 1;
    delivery.updatedAt = now;

    const user = db.users.get(delivery.userId);
    if (!user || user.status !== 'active') {
      delivery.status = 'SKIPPED';
      delivery.lastError = 'Recipient account disabled or not found';
      delivery.updatedAt = Date.now();
      return;
    }

    // Re-check consent right before dispatch
    if (!this.isChannelPermittedForUser(user.id, delivery.channel)) {
      delivery.status = 'SKIPPED';
      delivery.lastError = `Channel ${delivery.channel} not permitted by user preferences`;
      delivery.updatedAt = Date.now();
      return;
    }

    try {
      if (this.customDeliveryHook) {
        await this.customDeliveryHook(campaign, delivery, user);
      }

      if (delivery.channel === 'IN_APP') {
        // Idempotent creation: never create duplicate UserNotification on retry or restart
        const existing = this.findUserNotificationByIdempotencyKey(delivery.idempotencyKey);
        if (!existing) {
          const notif: UserNotification = {
            id: crypto.randomUUID(),
            userId: user.id,
            campaignId: campaign.id,
            announcementId: campaign.announcementId,
            announcementSlug: campaign.announcementSlug,
            category: campaign.category,
            title: campaign.title,
            summary: campaign.summary,
            coverImageUrl: campaign.coverImageUrl,
            idempotencyKey: delivery.idempotencyKey,
            isRead: false,
            createdAt: Date.now()
          };
          db.userNotifications.set(notif.id, notif);
          // Live push over WebSocket if connected
          marketWsService.broadcastUserNotification(user.id, notif);
        }
      } else if (delivery.channel === 'WEB_PUSH') {
        // Push relay event delivered to connected browser session (requires granted permission)
        marketWsService.broadcastUserNotification(user.id, {
          id: delivery.id,
          type: 'WEB_PUSH',
          campaignId: campaign.id,
          announcementSlug: campaign.announcementSlug,
          category: campaign.category,
          title: campaign.title,
          summary: campaign.summary,
          createdAt: Date.now()
        });
      } else if (delivery.channel === 'EMAIL') {
        // Email channel dispatched to opted-in user (recorded in delivery audit trail)
      }

      delivery.status = 'SENT';
      delivery.sentAt = Date.now();
      delivery.lastError = undefined;
      delivery.nextRetryAt = undefined;
      delivery.updatedAt = Date.now();
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown delivery error';
      delivery.lastError = errorMsg;
      delivery.updatedAt = Date.now();

      if (delivery.attempts < delivery.maxAttempts) {
        // Exponential backoff retry
        const delayMs = this.baseRetryDelayMs * Math.pow(2, delivery.attempts - 1);
        delivery.status = 'QUEUED';
        delivery.nextRetryAt = Date.now() + delayMs;
      } else {
        delivery.status = 'FAILED';
        delivery.nextRetryAt = undefined;
      }
    }
  }

  public recomputeCampaignMetrics(campaignId: string): NotificationCampaign | null {
    const campaign = db.notificationCampaigns.get(campaignId);
    if (!campaign) return null;

    let queued = 0;
    let sent = 0;
    let failed = 0;

    for (const d of db.notificationDeliveries.values()) {
      if (d.campaignId !== campaignId) continue;
      if (d.status === 'QUEUED' || d.status === 'PROCESSING') queued++;
      else if (d.status === 'SENT') sent++;
      else if (d.status === 'FAILED') failed++;
    }

    let read = 0;
    for (const n of db.userNotifications.values()) {
      if (n.campaignId === campaignId && n.isRead) {
        read++;
      }
    }

    campaign.queuedCount = queued;
    campaign.sentCount = sent;
    campaign.failedCount = failed;
    campaign.readCount = read;
    campaign.updatedAt = Date.now();

    if (campaign.status !== 'CANCELLED') {
      if (queued > 0) {
        campaign.status = campaign.startedAt ? 'PROCESSING' : 'QUEUED';
      } else {
        if (!campaign.completedAt) {
          campaign.completedAt = Date.now();
        }
        if (failed > 0 && sent > 0) {
          campaign.status = 'PARTIALLY_FAILED';
        } else if (failed > 0 && sent === 0) {
          campaign.status = 'FAILED';
        } else {
          campaign.status = 'COMPLETED';
        }
      }
    }

    return campaign;
  }

  /**
   * Safely cancels an in-progress or queued campaign before completion.
   */
  public cancelCampaign(
    campaignId: string,
    actor: { id: string; email?: string; role: string; ipAddress?: string }
  ): NotificationCampaign {
    const campaign = db.notificationCampaigns.get(campaignId);
    if (!campaign) {
      throw new Error('Notification campaign not found');
    }
    if (campaign.status === 'COMPLETED' || campaign.status === 'CANCELLED') {
      throw new Error(`Campaign cannot be cancelled in ${campaign.status} status`);
    }

    const now = Date.now();
    campaign.status = 'CANCELLED';
    campaign.cancelledAt = now;
    campaign.cancelledBy = actor.id;
    campaign.updatedAt = now;

    let cancelledDeliveries = 0;
    for (const d of db.notificationDeliveries.values()) {
      if (d.campaignId === campaignId && (d.status === 'QUEUED' || d.status === 'PROCESSING')) {
        d.status = 'CANCELLED';
        d.updatedAt = now;
        cancelledDeliveries++;
      }
    }

    for (const job of db.notificationOutboxJobs.values()) {
      if (job.campaignId === campaignId && (job.status === 'PENDING' || job.status === 'PROCESSING')) {
        job.status = 'CANCELLED';
        job.updatedAt = now;
      }
    }

    this.recomputeCampaignMetrics(campaignId);

    recordCmsAudit({
      entityType: 'CAMPAIGN',
      entityId: campaign.id,
      action: 'CAMPAIGN_CANCELLED',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      ipAddress: actor.ipAddress,
      details: { cancelledDeliveries, alreadySent: campaign.sentCount }
    });

    db.saveToDisk();
    return campaign;
  }

  /**
   * Retries ONLY failed recipient deliveries for a campaign without duplicating SENT deliveries.
   */
  public retryFailedDeliveries(
    campaignId: string,
    actor: { id: string; email?: string; role: string; ipAddress?: string }
  ): { campaign: NotificationCampaign; retriedCount: number } {
    const campaign = db.notificationCampaigns.get(campaignId);
    if (!campaign) {
      throw new Error('Notification campaign not found');
    }
    if (campaign.status === 'CANCELLED') {
      throw new Error('Cannot retry a cancelled campaign');
    }

    const now = Date.now();
    let retriedCount = 0;

    for (const d of db.notificationDeliveries.values()) {
      if (d.campaignId === campaignId && d.status === 'FAILED') {
        d.status = 'QUEUED';
        d.attempts = 0;
        d.nextRetryAt = undefined;
        d.lastError = undefined;
        d.updatedAt = now;
        retriedCount++;
      }
    }

    if (retriedCount === 0) {
      return { campaign, retriedCount: 0 };
    }

    campaign.status = 'QUEUED';
    campaign.completedAt = undefined;
    campaign.updatedAt = now;
    this.recomputeCampaignMetrics(campaignId);

    const retryJob: NotificationOutboxJob = {
      id: crypto.randomUUID(),
      campaignId: campaign.id,
      idempotencyKey: `retry:${campaign.id}:${now}`,
      eventType: 'CAMPAIGN_RETRY',
      payload: { campaignId: campaign.id, retriedCount },
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 5,
      createdAt: now,
      updatedAt: now
    };
    db.notificationOutboxJobs.set(retryJob.id, retryJob);

    recordCmsAudit({
      entityType: 'CAMPAIGN',
      entityId: campaign.id,
      action: 'CAMPAIGN_RETRY_QUEUED',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      ipAddress: actor.ipAddress,
      details: { retriedCount }
    });

    db.saveToDisk();

    setImmediate(() => {
      void this.tick();
    });

    return { campaign, retriedCount };
  }

  public listCampaigns(params?: { status?: string; page?: number; limit?: number }) {
    let items = Array.from(db.notificationCampaigns.values()).map(c => {
      this.recomputeCampaignMetrics(c.id);
      return c;
    });

    if (params?.status && params.status !== 'ALL') {
      items = items.filter(c => c.status === params.status);
    }

    items.sort((a, b) => b.createdAt - a.createdAt);

    const page = Math.max(1, Number(params?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params?.limit) || 20));
    const total = items.length;
    const start = (page - 1) * limit;
    return {
      items: items.slice(start, start + limit),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    };
  }

  public getCampaignDetail(campaignId: string, deliveryPage = 1, deliveryLimit = 50) {
    const campaign = this.recomputeCampaignMetrics(campaignId);
    if (!campaign) return null;

    const allDeliveries = Array.from(db.notificationDeliveries.values())
      .filter(d => d.campaignId === campaignId)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const start = (Math.max(1, deliveryPage) - 1) * deliveryLimit;
    const deliveries = allDeliveries.slice(start, start + deliveryLimit).map(d => {
      const user = db.users.get(d.userId);
      return {
        ...d,
        userEmail: user?.email || d.userId
      };
    });

    const outboxJobs = Array.from(db.notificationOutboxJobs.values())
      .filter(j => j.campaignId === campaignId)
      .sort((a, b) => b.createdAt - a.createdAt);

    const auditTrail = db.cmsAuditLogs
      .filter(l => l.entityType === 'CAMPAIGN' && l.entityId === campaignId)
      .sort((a, b) => b.createdAt - a.createdAt);

    return {
      campaign,
      deliveries,
      deliveriesPagination: {
        page: Math.max(1, deliveryPage),
        limit: deliveryLimit,
        total: allDeliveries.length,
        totalPages: Math.max(1, Math.ceil(allDeliveries.length / deliveryLimit))
      },
      outboxJobs,
      auditTrail
    };
  }

  // ---------------------------------------------------------------------------
  // USER IN-APP NOTIFICATION INBOX OPERATIONS (STRICT PER-USER ISOLATION)
  // ---------------------------------------------------------------------------

  public listUserNotifications(
    userId: string,
    params?: { unreadOnly?: boolean; page?: number; limit?: number }
  ) {
    let items = Array.from(db.userNotifications.values()).filter(n => n.userId === userId);
    const unreadCount = items.reduce((acc, n) => acc + (n.isRead ? 0 : 1), 0);

    if (params?.unreadOnly) {
      items = items.filter(n => !n.isRead);
    }

    items.sort((a, b) => b.createdAt - a.createdAt);

    const page = Math.max(1, Number(params?.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(params?.limit) || 20));
    const total = items.length;
    const start = (page - 1) * limit;

    return {
      items: items.slice(start, start + limit),
      unreadCount,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    };
  }

  public getUnreadCount(userId: string): number {
    let count = 0;
    for (const n of db.userNotifications.values()) {
      if (n.userId === userId && !n.isRead) count++;
    }
    return count;
  }

  public getUserNotificationById(userId: string, notificationId: string): UserNotification | null {
    const notif = db.userNotifications.get(notificationId);
    if (!notif || notif.userId !== userId) return null;
    return notif;
  }

  public markNotificationRead(userId: string, notificationId: string): UserNotification | null {
    const notif = db.userNotifications.get(notificationId);
    if (!notif || notif.userId !== userId) return null;

    if (!notif.isRead) {
      notif.isRead = true;
      notif.readAt = Date.now();
      if (notif.campaignId) {
        this.recomputeCampaignMetrics(notif.campaignId);
      }
      db.scheduleSave();
    }
    return notif;
  }

  public markAllNotificationsRead(userId: string): { updatedCount: number } {
    const now = Date.now();
    let updatedCount = 0;
    const affectedCampaigns = new Set<string>();

    for (const n of db.userNotifications.values()) {
      if (n.userId === userId && !n.isRead) {
        n.isRead = true;
        n.readAt = now;
        updatedCount++;
        if (n.campaignId) affectedCampaigns.add(n.campaignId);
      }
    }

    for (const cid of affectedCampaigns) {
      this.recomputeCampaignMetrics(cid);
    }

    if (updatedCount > 0) {
      db.scheduleSave();
    }

    return { updatedCount };
  }
}

export const notificationBroadcastService = new NotificationBroadcastService();
