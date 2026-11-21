/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/tests/test_news_and_notifications.ts
 * Comprehensive Automated Verification Suite for DIMONEX News & Announcement CMS
 * and Global Notification Broadcast System (16+ end-to-end & security scenarios).
 */

import assert from 'assert';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import { db } from '../db/database.js';
import { newsCmsService } from '../services/cms/NewsCmsService.js';
import { notificationBroadcastService } from '../services/cms/NotificationBroadcastService.js';
import { sanitizeArticleHtml } from '../services/cms/HtmlSanitizer.js';
import {
  deleteUploadedMedia,
  resolveSafeMediaPath,
  saveUploadedMedia,
  validateImagePayload
} from '../services/cms/MediaValidationService.js';
import { newsAdminRouter } from '../routes/newsAdmin.js';
import { newsPublicRouter } from '../routes/newsPublic.js';
import { notificationsRouter } from '../routes/notifications.js';

// Minimal valid 1x1 PNG binary (89 50 4E 47 0D 0A 1A 0A ...)
const VALID_1X1_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function waitForCampaignTerminal(campaignId: string, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await notificationBroadcastService.tick();
    const c = notificationBroadcastService.recomputeCampaignMetrics(campaignId);
    if (
      c &&
      (c.status === 'COMPLETED' ||
        c.status === 'PARTIALLY_FAILED' ||
        c.status === 'FAILED' ||
        c.status === 'CANCELLED')
    ) {
      return c;
    }
    await new Promise(r => setTimeout(r, 25));
  }
  return notificationBroadcastService.recomputeCampaignMetrics(campaignId);
}

async function runHttpRequest(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: any
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function main() {
  console.log('===================================================================');
  console.log(' DIMONEX News CMS & Global Notification System — Automated Tests');
  console.log('===================================================================');

  // Save original state counts so we clean up synthetic test artifacts afterward
  const createdUserIds: string[] = [];
  const createdSessionTokens: string[] = [];
  const createdAnnouncementIds: string[] = [];
  const createdCampaignIds: string[] = [];
  const createdMediaIds: string[] = [];

  // Configure fast deterministic retries for testing
  const origRetryDelay = notificationBroadcastService.baseRetryDelayMs;
  const origBatchSize = notificationBroadcastService.batchSize;
  notificationBroadcastService.baseRetryDelayMs = 20;
  notificationBroadcastService.batchSize = 50;

  // Create an isolated Express test server mounting the real CMS & Notification routes
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/admin', newsAdminRouter);
  app.use('/api/public', newsPublicRouter);
  app.use('/api/notifications', notificationsRouter);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Helper to create test user + active session token
  const createTestUser = (
    email: string,
    role: 'user' | 'ADMIN' | 'superadmin',
    status: 'active' | 'frozen' | 'suspended' = 'active'
  ) => {
    const id = `test-usr-${crypto.randomUUID()}`;
    const salt = db.generateSalt();
    db.users.set(id, {
      id,
      email,
      passwordSalt: salt,
      passwordHash: db.hashPassword('TestPass123!', salt),
      role,
      status,
      isTotpEnabled: false,
      failedLoginAttempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    const token = `test-tok-${crypto.randomUUID()}`;
    db.sessions.set(token, {
      userId: id,
      token,
      device: 'test-runner',
      ip: '127.0.0.1',
      expiresAt: Date.now() + 3600_000
    });
    createdUserIds.push(id);
    createdSessionTokens.push(token);
    return { id, email, role, token };
  };

  let passed = 0;
  const pass = (name: string) => {
    passed++;
    console.log(`  [PASS] ${passed}. ${name}`);
  };

  try {
    const adminMaker = createTestUser('maker-test@dimonex.id', 'ADMIN');
    const adminChecker = createTestUser('checker-test@dimonex.id', 'superadmin');
    const traderA = createTestUser('trader-a-test@dimonex.id', 'user', 'active');
    const traderB = createTestUser('trader-b-test@dimonex.id', 'user', 'active');
    const frozenUser = createTestUser('frozen-test@dimonex.id', 'user', 'frozen');

    // -------------------------------------------------------------------------
    // TEST 1: Draft Creation & Editing (Version History)
    // -------------------------------------------------------------------------
    const createRes = await runHttpRequest(baseUrl, 'POST', '/api/admin/news', adminMaker.token, {
      title: 'DIMONEX Spot Engine v3 Upgrade',
      category: 'PLATFORM_UPDATE',
      shortDescription: 'Faster order matching latency and enhanced charting.',
      contentHtml: '<h2>Upgrade Details</h2><p>Zero-float BigInt matching upgrade.</p>',
      isPinned: true,
      notificationEnabled: true,
      notificationChannels: ['IN_APP', 'WEB_PUSH', 'EMAIL']
    });
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.data.status, 'DRAFT');
    assert.strictEqual(createRes.data.version, 1);
    const draftId = createRes.data.id;
    createdAnnouncementIds.push(draftId);
    pass('Draft creation creates DRAFT status with version 1');

    // -------------------------------------------------------------------------
    // TEST 2: Editing Announcement Bumps Version & Preserves Revision History
    // -------------------------------------------------------------------------
    const editRes = await runHttpRequest(
      baseUrl,
      'PATCH',
      `/api/admin/news/${draftId}`,
      adminMaker.token,
      {
        title: 'DIMONEX Spot Engine v3.1 Upgrade',
        changeSummary: 'Clarified release version'
      }
    );
    assert.strictEqual(editRes.status, 200);
    assert.strictEqual(editRes.data.version, 2);
    const detailRes = await runHttpRequest(baseUrl, 'GET', `/api/admin/news/${draftId}`, adminMaker.token);
    assert.strictEqual(detailRes.status, 200);
    assert.ok(detailRes.data.versions.length >= 2, 'Should track multiple revision snapshots');
    assert.ok(detailRes.data.auditLogs.length >= 2, 'Should track append-only audit logs');
    pass('Editing announcement increments version and records revision + audit trail');

    // -------------------------------------------------------------------------
    // TEST 3: Unauthorized Access / Publish Rejection
    // -------------------------------------------------------------------------
    const unauthCreate = await runHttpRequest(baseUrl, 'POST', '/api/admin/news', traderA.token, {
      title: 'Unauthorized Hack',
      category: 'ANNOUNCEMENT',
      shortDescription: 'Should fail',
      contentHtml: '<p>Nope</p>'
    });
    assert.strictEqual(unauthCreate.status, 403);

    const unauthPublish = await runHttpRequest(
      baseUrl,
      'POST',
      `/api/admin/news/${draftId}/publish`,
      traderA.token,
      {}
    );
    assert.strictEqual(unauthPublish.status, 403);
    pass('Unauthorized non-admin user is rejected (403) from creating or publishing announcements');

    // -------------------------------------------------------------------------
    // TEST 4: Maker-Checker Approval Governance (High-Priority Category)
    // -------------------------------------------------------------------------
    const secCreate = await runHttpRequest(baseUrl, 'POST', '/api/admin/news', adminMaker.token, {
      title: 'Critical Security Advisory: API Key Rotation',
      category: 'SECURITY_ALERT',
      shortDescription: 'Mandatory security notice for institutional API users.',
      contentHtml: '<p>Rotate compromised keys immediately.</p>',
      notificationEnabled: false
    });
    assert.strictEqual(secCreate.status, 201);
    assert.strictEqual(secCreate.data.requiresApproval, true);
    const secId = secCreate.data.id;
    createdAnnouncementIds.push(secId);

    // Attempt direct publish without approval -> must fail 403
    const prematurePub = await runHttpRequest(
      baseUrl,
      'POST',
      `/api/admin/news/${secId}/publish`,
      adminMaker.token,
      {}
    );
    assert.strictEqual(prematurePub.status, 403);

    // Submit for approval
    const submitRes = await runHttpRequest(
      baseUrl,
      'POST',
      `/api/admin/news/${secId}/submit`,
      adminMaker.token
    );
    assert.strictEqual(submitRes.status, 200);
    assert.strictEqual(submitRes.data.status, 'PENDING_APPROVAL');

    // Creator self-approval MUST be blocked (403)
    const selfApprove = await runHttpRequest(
      baseUrl,
      'POST',
      `/api/admin/news/${secId}/approve`,
      adminMaker.token,
      { note: 'Self approve attempt' }
    );
    assert.strictEqual(selfApprove.status, 403);

    // Distinct checker admin approval succeeds (200)
    const checkerApprove = await runHttpRequest(
      baseUrl,
      'POST',
      `/api/admin/news/${secId}/approve`,
      adminChecker.token,
      { note: 'Verified by Compliance Checker' }
    );
    assert.strictEqual(checkerApprove.status, 200);
    assert.strictEqual(checkerApprove.data.approvedBy, adminChecker.id);

    // Now publish succeeds
    const secPub = await runHttpRequest(
      baseUrl,
      'POST',
      `/api/admin/news/${secId}/publish`,
      adminChecker.token,
      {}
    );
    assert.strictEqual(secPub.status, 200);
    assert.strictEqual(secPub.data.announcement.status, 'PUBLISHED');
    pass('Maker-Checker governance blocks unapproved publish & self-approval, allows distinct checker');

    // -------------------------------------------------------------------------
    // TEST 5: Public Homepage Filtering & Draft/Scheduled Exclusion
    // -------------------------------------------------------------------------
    const pubBeforeDraft = await runHttpRequest(baseUrl, 'GET', '/api/public/news');
    assert.strictEqual(pubBeforeDraft.status, 200);
    assert.ok(
      !pubBeforeDraft.data.items.some((i: any) => i.id === draftId),
      'DRAFT article must never appear in public news'
    );
    assert.ok(
      pubBeforeDraft.data.items.some((i: any) => i.id === secId),
      'PUBLISHED article must appear in public news'
    );
    pass('Public homepage API exposes PUBLISHED articles only and hides DRAFT articles');

    // -------------------------------------------------------------------------
    // TEST 6: Scheduled Publication & Automatic Worker Execution
    // -------------------------------------------------------------------------
    const schedCreate = await runHttpRequest(baseUrl, 'POST', '/api/admin/news', adminMaker.token, {
      title: 'Scheduled New Listing: ARB/IDR',
      category: 'NEW_LISTING',
      shortDescription: 'ARB/IDR spot market launches at scheduled timestamp.',
      contentHtml: '<p>Deposit ARB now.</p>',
      notificationEnabled: true
    });
    const schedId = schedCreate.data.id;
    createdAnnouncementIds.push(schedId);

    const futureTs = Date.now() + 60_000;
    const schedRes = await runHttpRequest(
      baseUrl,
      'POST',
      `/api/admin/news/${schedId}/schedule`,
      adminMaker.token,
      { scheduledAt: futureTs }
    );
    assert.strictEqual(schedRes.status, 200);
    assert.strictEqual(schedRes.data.status, 'SCHEDULED');

    // Before due time -> NOT public
    const pubWhileSched = await runHttpRequest(baseUrl, 'GET', `/api/public/news/${schedCreate.data.slug}`);
    assert.strictEqual(pubWhileSched.status, 404);

    // Trigger scheduler with simulated future clock >= futureTs
    const autoPublished = newsCmsService.processScheduledPublications(futureTs + 1000);
    assert.ok(autoPublished.some(a => a.id === schedId));

    const pubAfterSched = await runHttpRequest(baseUrl, 'GET', `/api/public/news/${schedCreate.data.slug}`);
    assert.strictEqual(pubAfterSched.status, 200);
    assert.strictEqual(pubAfterSched.data.title, 'Scheduled New Listing: ARB/IDR');

    // Find auto-created campaign for scheduled announcement
    const schedCampaign = Array.from(db.notificationCampaigns.values()).find(
      c => c.announcementId === schedId
    );
    assert.ok(schedCampaign, 'Scheduled publish with notifyAllUsers must create broadcast campaign');
    createdCampaignIds.push(schedCampaign!.id);
    await waitForCampaignTerminal(schedCampaign!.id);
    pass('Scheduled publication stays hidden until due time, then auto-publishes & triggers broadcast');

    // -------------------------------------------------------------------------
    // TEST 7: Archived Announcement Exclusion
    // -------------------------------------------------------------------------
    const archRes = await runHttpRequest(
      baseUrl,
      'POST',
      `/api/admin/news/${secId}/archive`,
      adminMaker.token
    );
    assert.strictEqual(archRes.status, 200);
    assert.strictEqual(archRes.data.status, 'ARCHIVED');

    const pubArchivedSlug = await runHttpRequest(baseUrl, 'GET', `/api/public/news/${secCreate.data.slug}`);
    assert.strictEqual(pubArchivedSlug.status, 404);
    const pubListAfterArchive = await runHttpRequest(baseUrl, 'GET', '/api/public/news');
    assert.ok(!pubListAfterArchive.data.items.some((i: any) => i.id === secId));
    pass('Archived announcement is immediately excluded from public list and slug detail (404)');

    // -------------------------------------------------------------------------
    // TEST 8: Broadcast Creation, Disabled User Exclusion & Channel Consent
    // -------------------------------------------------------------------------
    // Opt Trader A into email, keep Trader B default (no email/web push consent)
    await runHttpRequest(baseUrl, 'PUT', '/api/notifications/preferences', traderA.token, {
      inAppEnabled: true,
      emailEnabled: true,
      webPushEnabled: true,
      webPushPermissionGranted: true
    });

    const pubDraftRes = await runHttpRequest(
      baseUrl,
      'POST',
      `/api/admin/news/${draftId}/publish`,
      adminMaker.token,
      {
        notifyAllUsers: true,
        notificationChannels: ['IN_APP', 'WEB_PUSH', 'EMAIL'],
        targetSegment: 'ALL_USERS'
      }
    );
    assert.strictEqual(pubDraftRes.status, 200);
    assert.ok(pubDraftRes.data.campaign, 'Publishing with notifyAllUsers creates a campaign');
    const mainCampaignId = pubDraftRes.data.campaign.id;
    createdCampaignIds.push(mainCampaignId);

    const finishedMain = await waitForCampaignTerminal(mainCampaignId);
    assert.strictEqual(finishedMain!.status, 'COMPLETED');

    // Frozen user MUST NOT receive any notification
    const frozenNotifs = notificationBroadcastService.listUserNotifications(frozenUser.id);
    assert.strictEqual(frozenNotifs.items.length, 0, 'Frozen/disabled users must be excluded');

    // Trader A (opted-in) should have IN_APP + WEB_PUSH + EMAIL deliveries; Trader B ONLY IN_APP
    const mainDeliveries = Array.from(db.notificationDeliveries.values()).filter(
      d => d.campaignId === mainCampaignId
    );
    const traderAChannels = mainDeliveries.filter(d => d.userId === traderA.id).map(d => d.channel);
    const traderBChannels = mainDeliveries.filter(d => d.userId === traderB.id).map(d => d.channel);
    assert.ok(traderAChannels.includes('IN_APP') && traderAChannels.includes('WEB_PUSH') && traderAChannels.includes('EMAIL'));
    assert.deepStrictEqual(traderBChannels, ['IN_APP']);
    pass('Broadcast excludes disabled accounts and enforces per-user Web Push & Email consent');

    // -------------------------------------------------------------------------
    // TEST 9: Duplicate Delivery Prevention (Idempotency)
    // -------------------------------------------------------------------------
    const traderANotifsBefore = Array.from(db.userNotifications.values()).filter(
      n => n.userId === traderA.id && n.campaignId === mainCampaignId
    );
    assert.strictEqual(traderANotifsBefore.length, 1);

    // Attempt to re-create same campaign version -> must return identical campaign, zero duplicates
    const dupCampaign = notificationBroadcastService.createCampaignForAnnouncement({
      announcement: db.announcements.get(draftId)!,
      actorId: adminMaker.id,
      actorRole: adminMaker.role
    });
    assert.strictEqual(dupCampaign.id, mainCampaignId);

    // Force-reset a delivery record back to QUEUED and re-run worker -> idempotency key prevents duplicate UserNotification
    const traderAInAppDelivery = mainDeliveries.find(
      d => d.userId === traderA.id && d.channel === 'IN_APP'
    )!;
    traderAInAppDelivery.status = 'QUEUED';
    const reJobId = crypto.randomUUID();
    db.notificationOutboxJobs.set(reJobId, {
      id: reJobId,
      campaignId: mainCampaignId,
      idempotencyKey: `dup-check:${Date.now()}`,
      eventType: 'CAMPAIGN_RETRY',
      payload: { campaignId: mainCampaignId },
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 3,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    await waitForCampaignTerminal(mainCampaignId);
    const traderANotifsAfter = Array.from(db.userNotifications.values()).filter(
      n => n.userId === traderA.id && n.campaignId === mainCampaignId
    );
    assert.strictEqual(traderANotifsAfter.length, 1, 'Idempotency key must prevent duplicate notifications');
    pass('Idempotency keys prevent duplicate campaigns and duplicate user notifications on retry');

    // -------------------------------------------------------------------------
    // TEST 10: Worker Restart Recovery (Crash Simulation)
    // -------------------------------------------------------------------------
    const crashAnn = newsCmsService.createAnnouncement(
      {
        title: 'Crash Recovery Broadcast Test',
        category: 'ANNOUNCEMENT',
        shortDescription: 'Verifies durable outbox recovery after server restart.',
        contentHtml: '<p>Outbox persistence check.</p>',
        notificationEnabled: false
      },
      { id: adminMaker.id, role: adminMaker.role }
    );
    createdAnnouncementIds.push(crashAnn.id);

    // Manually create campaign & simulate server crash mid-processing (job & deliveries stuck in PROCESSING)
    notificationBroadcastService.stop();
    const crashCampaign = notificationBroadcastService.createCampaignForAnnouncement({
      announcement: crashAnn,
      actorId: adminMaker.id,
      actorRole: adminMaker.role,
      targetSegment: 'SELECTED_USERS',
      targetConfig: { selectedUserIds: [traderA.id, traderB.id] }
    });
    createdCampaignIds.push(crashCampaign.id);

    // Simulate mid-flight crash state before tick finishes
    for (const j of db.notificationOutboxJobs.values()) {
      if (j.campaignId === crashCampaign.id) j.status = 'PROCESSING';
    }
    for (const d of db.notificationDeliveries.values()) {
      if (d.campaignId === crashCampaign.id && d.status !== 'SENT') d.status = 'PROCESSING';
    }
    crashCampaign.status = 'PROCESSING';
    db.saveToDisk();

    // Simulate fresh server restart reloading from disk and invoking recoverPendingCampaigns()
    db.loadFromDisk();
    const recoveredCount = notificationBroadcastService.recoverPendingCampaigns();
    assert.ok(recoveredCount >= 1, 'Restart recovery must detect stale PROCESSING jobs');
    const recoveredCampaign = await waitForCampaignTerminal(crashCampaign.id);
    assert.strictEqual(recoveredCampaign!.status, 'COMPLETED');
    assert.strictEqual(recoveredCampaign!.sentCount, 2);
    pass('Worker restart recovery resumes interrupted PROCESSING outbox jobs without loss or duplicates');

    // -------------------------------------------------------------------------
    // TEST 11: Exponential Backoff Retry & Failed Delivery Recovery
    // -------------------------------------------------------------------------
    const retryAnn = newsCmsService.createAnnouncement(
      {
        title: 'Retry Backoff Test',
        category: 'ANNOUNCEMENT',
        shortDescription: 'Tests exponential backoff and manual admin retry.',
        contentHtml: '<p>Retry test body.</p>',
        notificationEnabled: false
      },
      { id: adminMaker.id, role: adminMaker.role }
    );
    createdAnnouncementIds.push(retryAnn.id);

    // Inject transient failure for Trader B across all automatic attempts so it lands in FAILED
    let failTraderB = true;
    let traderBAttempts = 0;
    notificationBroadcastService.setDeliveryHook(async (_camp, delivery) => {
      if (delivery.userId === traderB.id && failTraderB) {
        traderBAttempts++;
        throw new Error('Simulated transient downstream timeout');
      }
    });

    const retryCamp = notificationBroadcastService.createCampaignForAnnouncement({
      announcement: retryAnn,
      actorId: adminMaker.id,
      actorRole: adminMaker.role,
      targetSegment: 'SELECTED_USERS',
      targetConfig: { selectedUserIds: [traderA.id, traderB.id] }
    });
    createdCampaignIds.push(retryCamp.id);

    const afterFailures = await waitForCampaignTerminal(retryCamp.id);
    assert.strictEqual(afterFailures!.status, 'PARTIALLY_FAILED');
    assert.strictEqual(afterFailures!.sentCount, 1);
    assert.strictEqual(afterFailures!.failedCount, 1);
    assert.strictEqual(
      traderBAttempts,
      notificationBroadcastService.maxDeliveryAttempts,
      'Must retry with exponential backoff up to maxDeliveryAttempts'
    );

    // Clear failure hook and trigger Admin Retry Failed API
    failTraderB = false;
    notificationBroadcastService.setDeliveryHook(null);
    const retryApiRes = await runHttpRequest(
      baseUrl,
      'POST',
      `/api/admin/notification-campaigns/${retryCamp.id}/retry`,
      adminMaker.token
    );
    assert.strictEqual(retryApiRes.status, 200);
    assert.strictEqual(retryApiRes.data.retriedCount, 1);

    const afterRetry = await waitForCampaignTerminal(retryCamp.id);
    assert.strictEqual(afterRetry!.status, 'COMPLETED');
    assert.strictEqual(afterRetry!.sentCount, 2);
    assert.strictEqual(afterRetry!.failedCount, 0);
    // Verify Trader A did NOT get a duplicate notification
    const traderARetryNotifs = Array.from(db.userNotifications.values()).filter(
      n => n.userId === traderA.id && n.campaignId === retryCamp.id
    );
    assert.strictEqual(traderARetryNotifs.length, 1);
    pass('Exponential backoff tracks failures and Admin Retry delivers failed recipients without duplicating sent ones');

    // -------------------------------------------------------------------------
    // TEST 12 & 13: User Notification Isolation (IDOR) & Read/Unread Sync
    // -------------------------------------------------------------------------
    const traderAInbox = await runHttpRequest(baseUrl, 'GET', '/api/notifications', traderA.token);
    assert.strictEqual(traderAInbox.status, 200);
    assert.ok(traderAInbox.data.items.length >= 1);
    const traderANotifId = traderAInbox.data.items[0].id;

    // Trader B tries to read or mark Trader A's notification -> MUST return 404 (strict IDOR isolation)
    const idorGet = await runHttpRequest(
      baseUrl,
      'GET',
      `/api/notifications/${traderANotifId}`,
      traderB.token
    );
    assert.strictEqual(idorGet.status, 404);
    const idorMark = await runHttpRequest(
      baseUrl,
      'POST',
      `/api/notifications/${traderANotifId}/read`,
      traderB.token
    );
    assert.strictEqual(idorMark.status, 404);
    pass('Strict per-user notification isolation blocks IDOR access across accounts');

    // Trader A marks single notification read -> unreadCount decrements & campaign readCount increments
    const unreadBefore = (
      await runHttpRequest(baseUrl, 'GET', '/api/notifications/unread-count', traderA.token)
    ).data.unreadCount;
    assert.ok(unreadBefore >= 1);

    const markReadRes = await runHttpRequest(
      baseUrl,
      'POST',
      `/api/notifications/${traderANotifId}/read`,
      traderA.token
    );
    assert.strictEqual(markReadRes.status, 200);
    assert.strictEqual(markReadRes.data.notification.isRead, true);
    assert.strictEqual(markReadRes.data.unreadCount, unreadBefore - 1);

    // Mark all read -> unreadCount becomes 0
    const markAllRes = await runHttpRequest(
      baseUrl,
      'POST',
      '/api/notifications/read-all',
      traderA.token
    );
    assert.strictEqual(markAllRes.status, 200);
    assert.strictEqual(markAllRes.data.unreadCount, 0);
    pass('Read/unread state and campaign read metrics update accurately on mark-read and mark-all-read');

    // -------------------------------------------------------------------------
    // TEST 14: XSS Sanitization
    // -------------------------------------------------------------------------
    const dirtyHtml = `
      <h2>Safe Heading</h2>
      <script>alert('xss')</script>
      <img src="x" onerror="alert(1)" />
      <a href="javascript:alert(2)" onclick="steal()">Evil Link</a>
      <a href="&#x6A;avascript:alert(3)">Encoded Evil</a>
      <iframe src="https://evil.example"></iframe>
      <a href="https://dimonex.id/markets">Legit Link</a>
    `;
    const cleanHtml = sanitizeArticleHtml(dirtyHtml);
    assert.ok(!cleanHtml.toLowerCase().includes('<script'));
    assert.ok(!cleanHtml.toLowerCase().includes('onerror'));
    assert.ok(!cleanHtml.toLowerCase().includes('onclick'));
    assert.ok(!cleanHtml.toLowerCase().includes('javascript:'));
    assert.ok(!cleanHtml.toLowerCase().includes('<iframe'));
    assert.ok(cleanHtml.includes('<h2>Safe Heading</h2>'));
    assert.ok(cleanHtml.includes('href="https://dimonex.id/markets"'));
    assert.ok(cleanHtml.includes('rel="noopener noreferrer"'));
    pass('HTML sanitizer strips scripts, iframes, event handlers, and javascript: URIs while keeping safe markup');

    // -------------------------------------------------------------------------
    // TEST 15: File Upload Validation (Magic Bytes, MIME Spoof, SVG, Size, Traversal)
    // -------------------------------------------------------------------------
    const validUpload = saveUploadedMedia({
      originalName: 'cover-banner.png',
      declaredMimeType: 'image/png',
      base64Data: VALID_1X1_PNG_BASE64,
      uploadedBy: adminMaker.id
    });
    createdMediaIds.push(validUpload.id);
    assert.strictEqual(validUpload.mimeType, 'image/png');
    assert.ok(validUpload.url.startsWith('/api/public/media/'));

    // Valid PNG with standard C2PA Content Credentials icon metadata (<svg ...> inside caBX chunk) must be accepted
    const validPngBytes = Buffer.from(VALID_1X1_PNG_BASE64.split(',')[1], 'base64');
    const c2paMetadataPayload = Buffer.from(
      'c2pa.icon\0image/svg+xml\0<svg width="24" height="24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z"/></svg>',
      'utf8'
    );
    const pngWithC2pa = Buffer.concat([validPngBytes, c2paMetadataPayload]);
    const c2paValidated = validateImagePayload(
      `data:image/png;base64,${pngWithC2pa.toString('base64')}`,
      'image/png'
    );
    assert.strictEqual(c2paValidated.mimeType, 'image/png');

    // PNG header polyglot with embedded <script> tag must still be rejected
    const polyglotPng = Buffer.concat([
      validPngBytes,
      Buffer.from('<script>alert("xss")</script>', 'utf8')
    ]);
    assert.throws(
      () =>
        validateImagePayload(
          `data:image/png;base64,${polyglotPng.toString('base64')}`,
          'image/png'
        ),
      /Security check failed/i
    );

    // Spoofed text file pretending to be PNG
    assert.throws(
      () =>
        validateImagePayload(
          `data:image/png;base64,${Buffer.from('<html><script>alert(1)</script></html>').toString('base64')}`,
          'image/png'
        ),
      /Invalid image file signature|MIME/i
    );

    // SVG upload must be rejected
    assert.throws(
      () =>
        validateImagePayload(
          `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')}`,
          'image/svg+xml'
        ),
      /Unsupported file MIME type/i
    );

    // Oversized (>5 MB) upload must be rejected
    const oversizedBuf = Buffer.alloc(5 * 1024 * 1024 + 512, 0x00);
    oversizedBuf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    oversizedBuf.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
    assert.throws(
      () => validateImagePayload(oversizedBuf.toString('base64'), 'image/png'),
      /exceeds maximum upload limit/i
    );

    // Path traversal filename must return null
    assert.strictEqual(resolveSafeMediaPath('../../etc/passwd'), null);
    assert.strictEqual(resolveSafeMediaPath('../exchange_state.json'), null);
    pass('Media upload validates magic bytes, accepts C2PA PNGs, rejects spoofed MIME/SVG/polyglots/oversized files, and blocks path traversal');

    // -------------------------------------------------------------------------
    // TEST 16: Large Recipient Batch Processing (260 Users across 6 Batches of 50)
    // -------------------------------------------------------------------------
    const bulkUserIds: string[] = [];
    for (let i = 0; i < 260; i++) {
      const uid = `test-bulk-${i}-${crypto.randomUUID().slice(0, 8)}`;
      db.users.set(uid, {
        id: uid,
        email: `bulk-${i}@dimonex.test`,
        passwordSalt: 's',
        passwordHash: 'h',
        role: 'user',
        status: 'active',
        isTotpEnabled: false,
        failedLoginAttempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      bulkUserIds.push(uid);
      createdUserIds.push(uid);
    }

    const bulkAnn = newsCmsService.createAnnouncement(
      {
        title: 'Large Scale Broadcast Load Test',
        category: 'TRADING_COMPETITION',
        shortDescription: 'Batch delivery test across 260 recipients.',
        contentHtml: '<p>Join the trading competition.</p>',
        notificationEnabled: false
      },
      { id: adminMaker.id, role: adminMaker.role }
    );
    createdAnnouncementIds.push(bulkAnn.id);

    const bulkCamp = notificationBroadcastService.createCampaignForAnnouncement({
      announcement: bulkAnn,
      actorId: adminMaker.id,
      actorRole: adminMaker.role,
      targetSegment: 'SELECTED_USERS',
      targetConfig: { selectedUserIds: bulkUserIds }
    });
    createdCampaignIds.push(bulkCamp.id);

    // First single tick processes exactly one batch of 50 (non-blocking)
    const firstBatch = await notificationBroadcastService.tick();
    assert.strictEqual(firstBatch.processed, 50, 'First batch tick must cap at batchSize=50');

    // Complete remaining batches
    const bulkFinished = await waitForCampaignTerminal(bulkCamp.id, 10_000);
    assert.strictEqual(bulkFinished!.status, 'COMPLETED');
    assert.strictEqual(bulkFinished!.totalEligible, 260);
    assert.strictEqual(bulkFinished!.sentCount, 260);
    assert.strictEqual(bulkFinished!.failedCount, 0);

    const bulkNotifCount = Array.from(db.userNotifications.values()).filter(
      n => n.campaignId === bulkCamp.id
    ).length;
    assert.strictEqual(bulkNotifCount, 260);
    pass('Large recipient broadcast (260 users) processes cleanly in 50-recipient batches with zero duplicates');

    console.log('-------------------------------------------------------------------');
    console.log(` ALL ${passed} AUTOMATED TESTS PASSED SUCCESSFULLY!`);
    console.log('-------------------------------------------------------------------');
  } finally {
    // Restore settings and clean up all synthetic test records from DB & disk
    notificationBroadcastService.setDeliveryHook(null);
    notificationBroadcastService.baseRetryDelayMs = origRetryDelay;
    notificationBroadcastService.batchSize = origBatchSize;

    for (const id of createdMediaIds) deleteUploadedMedia(id);
    const annSet = new Set(createdAnnouncementIds);
    const campSet = new Set(createdCampaignIds);
    const userSet = new Set(createdUserIds);

    for (const id of createdAnnouncementIds) db.announcements.delete(id);
    db.announcementVersions = db.announcementVersions.filter(v => !annSet.has(v.announcementId));
    for (const id of createdCampaignIds) db.notificationCampaigns.delete(id);
    for (const [k, j] of db.notificationOutboxJobs.entries()) {
      if (campSet.has(j.campaignId)) db.notificationOutboxJobs.delete(k);
    }
    for (const [k, d] of db.notificationDeliveries.entries()) {
      if (campSet.has(d.campaignId) || userSet.has(d.userId)) db.notificationDeliveries.delete(k);
    }
    for (const [k, n] of db.userNotifications.entries()) {
      if ((n.campaignId && campSet.has(n.campaignId)) || userSet.has(n.userId)) {
        db.userNotifications.delete(k);
      }
    }
    for (const id of createdUserIds) {
      db.users.delete(id);
      db.userNotificationPreferences.delete(id);
    }
    for (const tok of createdSessionTokens) db.sessions.delete(tok);
    db.cmsAuditLogs = db.cmsAuditLogs.filter(
      l => !annSet.has(l.entityId) && !campSet.has(l.entityId) && !createdMediaIds.includes(l.entityId)
    );
    db.saveToDisk();

    await new Promise<void>(resolve => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('TEST SUITE FAILED:', err);
    process.exit(1);
  });
