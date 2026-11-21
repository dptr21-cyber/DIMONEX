# DIMONEX — News & Announcement CMS + Global Notification System

## 1. Architecture Overview

The News & Announcement CMS and Global Notification Broadcast System is natively integrated into the DIMONEX Express/WebSocket backend, durable snapshot store (`server/db/database.ts`), PostgreSQL migration schema (`server/migrations/0002_create_news_and_notifications.sql`), Admin Console, public homepage (`OverviewView`), article reader (`ArticleDetailView`), and user Notification Bell & Inbox (`Navbar` + `NotificationsView`).

### Core Modules
- **SQL Migration**: `server/migrations/0002_create_news_and_notifications.sql`
- **HTML Sanitization**: `server/services/cms/HtmlSanitizer.ts` (server-side allowlist) + `src/components/news/SafeArticleContent.tsx` (client-side DOMParser allowlisted React AST renderer without `dangerouslySetInnerHTML`).
- **Media Validation & Storage**: `server/services/cms/MediaValidationService.ts` (MIME + binary magic-byte verification, 2 MB cap, script/SVG blocking, confined media directory with path-traversal protection).
- **Append-Only Audit Logging**: `server/services/cms/CmsAuditService.ts` (SHA-256 hash-chained audit logs mirrored to platform audit logs).
- **News CMS & Scheduler**: `server/services/cms/NewsCmsService.ts` (lifecycle management, Maker-Checker governance, version snapshots, scheduled publication poller).
- **Transactional Outbox Broadcast Engine**: `server/services/cms/NotificationBroadcastService.ts` (atomic campaign/outbox creation, non-blocking batch workers, idempotency keys, exponential backoff retries, crash/restart recovery, safe cancellation, real-time WebSocket delivery).

---

## 2. Database Schema (`0002_create_news_and_notifications.sql`)

| Table | Purpose |
| --- | --- |
| `announcements` | Primary announcement entity (`DRAFT`, `PENDING_APPROVAL`, `SCHEDULED`, `PUBLISHED`, `ARCHIVED`), category, slug, sanitized HTML, pin flag, Maker-Checker fields, targeting config, version counter. |
| `announcement_versions` | Immutable per-edit revision snapshots (`announcement_id`, `version`). |
| `announcement_audit_logs` | Append-only SHA-256 hash-chained audit trail protected by a PostgreSQL `BEFORE UPDATE OR DELETE` trigger. |
| `media_assets` | Validated uploaded images (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `<= 2 MB`, SHA-256 checksum). |
| `notification_campaigns` | Single logical broadcast campaign per announcement publication (`total_eligible`, `queued_count`, `sent_count`, `failed_count`, `read_count`, status & timestamps). |
| `notification_outbox_jobs` | Durable transactional outbox entries enabling crash-safe worker recovery on server restart. |
| `notification_deliveries` | Per-recipient, per-channel delivery records uniquely keyed by `(campaign_id, user_id, channel)` and `idempotency_key` to guarantee zero duplicate sends. |
| `user_notifications` | Per-user in-app notification inbox entries with unique `idempotency_key`, read state, and announcement deep links. |
| `user_notification_preferences` | Per-user channel permissions & explicit consent (`in_app_enabled`, `web_push_enabled`, `web_push_permission_granted`, `email_enabled`, `email_consent_at`). |

---

## 3. Broadcast Reliability & Transactional Outbox Flow

1. **Atomic Enqueue**: Publishing an announcement with `notifyAllUsers: true` atomically marks the announcement `PUBLISHED`, creates one logical `NotificationCampaign` (idempotency key `campaign:<announcementId>:v<version>`), resolves eligible active users (excluding frozen/suspended/system accounts and enforcing per-user channel consent), creates per-recipient `NotificationDeliveryRecord` entries (`<campaignId>:<userId>:<channel>`), inserts a durable `NotificationOutboxJob`, and flushes state to disk. The HTTP request returns immediately without running an unbounded delivery loop.
2. **Non-Blocking Batch Workers**: The background worker processes queued deliveries in batches of 50 per tick, yielding between ticks via `setImmediate` / interval scheduling.
3. **Duplicate Prevention**: Every delivery and in-app notification is guarded by a deterministic `idempotencyKey`. Retrying a failed delivery or recovering a crashed worker never duplicates already-delivered notifications.
4. **Exponential Backoff & Retry**: Transient failures re-queue the delivery with `delay = baseRetryDelayMs * 2^(attempt - 1)` up to `maxDeliveryAttempts`. Exhausted deliveries transition to `FAILED` and can be re-queued via `POST /api/admin/notification-campaigns/:id/retry` without touching `SENT` records.
5. **Server Restart Recovery**: On server startup, `notificationBroadcastService.start()` invokes `recoverPendingCampaigns()`, resetting stale `PROCESSING` outbox jobs and mid-flight deliveries back to `PENDING`/`QUEUED` so interrupted broadcasts resume seamlessly.
6. **Safe Cancellation**: `POST /api/admin/notification-campaigns/:id/cancel` halts pending/queued deliveries immediately while preserving records already delivered.

---

## 4. Security & Governance Controls

- **RBAC Enforcement**: All `/api/admin/news*`, `/api/admin/media*`, and `/api/admin/notification-campaigns*` endpoints require `requireAdmin`.
- **Maker-Checker Dual Approval**: High-priority categories (`SECURITY_ALERT`, `IMPORTANT_NOTICE`, `MAINTENANCE`) and manually flagged announcements enforce `PENDING_APPROVAL` → approval by a **different** admin (`approvedBy !== authorAdminId`) before publishing or scheduling.
- **Rate Limiting**: Administrative publish, schedule, campaign retry, and media upload routes are protected by per-admin sliding-window rate limits.
- **XSS Defense in Depth**: Strict server-side HTML allowlist sanitization on write/preview/public read, paired with a client-side `DOMParser` allowlisted React tree renderer (no `dangerouslySetInnerHTML`).
- **Upload Security**: Verifies declared MIME type AND raw binary magic bytes (PNG/JPEG/WebP/GIF), blocks SVG/HTML/script polyglots, enforces a 2 MB size cap, writes randomized filenames into a confined directory, and serves with `X-Content-Type-Options: nosniff`.
- **IDOR Prevention**: Every `/api/notifications/*` endpoint enforces `notif.userId === authenticatedUser.id`.

---

## 5. REST API Reference

### Admin Routes (`/api/admin`)
- `GET /api/admin/news` — List with search, category, status, pinned filter, and pagination
- `POST /api/admin/news` — Create draft announcement
- `GET /api/admin/news/:id` — Announcement details, revision versions, audit logs, linked campaigns
- `PATCH /api/admin/news/:id` — Edit announcement (increments version)
- `POST /api/admin/news/:id/preview` — Server-sanitized article preview
- `POST /api/admin/news/:id/submit` — Submit for Maker-Checker approval
- `POST /api/admin/news/:id/approve` — Checker approval (blocks self-approval)
- `POST /api/admin/news/:id/publish` — Publish immediately (+ atomic broadcast if enabled)
- `POST /api/admin/news/:id/schedule` — Schedule / reschedule publication
- `POST /api/admin/news/:id/archive` — Archive announcement
- `POST /api/admin/news/:id/pin` — Pin / unpin announcement
- `GET /api/admin/notification-campaigns` — List broadcast campaigns
- `GET /api/admin/notification-campaigns/:id` — Campaign metrics, recipient deliveries, audit trail
- `POST /api/admin/notification-campaigns/:id/retry` — Retry failed deliveries idempotently
- `POST /api/admin/notification-campaigns/:id/cancel` — Safely cancel active campaign
- `GET /api/admin/media`, `POST /api/admin/media/upload`, `DELETE /api/admin/media/:id` — Media Library

### Public Routes (`/api/public`)
- `GET /api/public/news` — Paginated published announcements (pinned first, category/search filter)
- `GET /api/public/news/:slug` — Full sanitized published article (`404` for drafts/scheduled/archived)
- `GET /api/public/media/:filename` — Confined uploaded media serving

### User Notification Routes (`/api/notifications`)
- `GET /api/notifications` — Paginated inbox with `unreadOnly` filter
- `GET /api/notifications/unread-count` — Current unread count
- `GET /api/notifications/:id` — Single notification detail (owner-isolated)
- `POST /api/notifications/:id/read` — Mark single notification read (updates campaign `readCount`)
- `POST /api/notifications/read-all` — Mark all user notifications read
- `GET /api/notifications/preferences` & `PUT /api/notifications/preferences` — Channel consent preferences
