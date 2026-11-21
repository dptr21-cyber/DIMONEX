-- ============================================================================
-- DIMONEX Centralized Cryptocurrency Spot Exchange
-- Migration: 0002_create_news_and_notifications.sql
-- Description: News & Announcement CMS, Media Library, Maker-Checker Approval,
--              Append-Only Content Audit Trail, Global Notification Campaigns,
--              Transactional Outbox Queue, Recipient Delivery Records, and
--              Per-User Notification Inbox & Preferences.
-- Compatible with PostgreSQL 14+ / Supabase / Google Cloud SQL.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE announcement_category_enum AS ENUM (
        'ANNOUNCEMENT',
        'PLATFORM_UPDATE',
        'MAINTENANCE',
        'NEW_LISTING',
        'SECURITY_ALERT',
        'TRADING_COMPETITION',
        'DEPOSIT_WITHDRAWAL_UPDATE',
        'IMPORTANT_NOTICE'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE announcement_status_enum AS ENUM (
        'DRAFT',
        'PENDING_APPROVAL',
        'SCHEDULED',
        'PUBLISHED',
        'ARCHIVED'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE campaign_status_enum AS ENUM (
        'QUEUED',
        'PROCESSING',
        'COMPLETED',
        'PARTIALLY_FAILED',
        'FAILED',
        'CANCELLED'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_channel_enum AS ENUM (
        'IN_APP',
        'WEB_PUSH',
        'EMAIL'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE delivery_status_enum AS ENUM (
        'QUEUED',
        'PROCESSING',
        'SENT',
        'FAILED',
        'CANCELLED',
        'SKIPPED'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE target_segment_enum AS ENUM (
        'ALL_USERS',
        'VERIFIED_USERS',
        'KYC_TIER',
        'SEGMENT',
        'SELECTED_USERS'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ----------------------------------------------------------------------------
-- 2. MEDIA ASSETS TABLE (Validated Uploaded Images)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(255) NOT NULL UNIQUE,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(64) NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
    size_bytes INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
    sha256_hash VARCHAR(64) NOT NULL,
    url TEXT NOT NULL,
    alt_text VARCHAR(255) NULL,
    uploaded_by VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. ANNOUNCEMENTS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(240) NOT NULL,
    slug VARCHAR(260) NOT NULL UNIQUE,
    category announcement_category_enum NOT NULL DEFAULT 'ANNOUNCEMENT',
    short_description VARCHAR(600) NOT NULL,
    content_html TEXT NOT NULL,
    content_text TEXT NOT NULL DEFAULT '',
    cover_image_url TEXT NULL,
    author_admin_id VARCHAR(128) NOT NULL,
    last_edited_by VARCHAR(128) NULL,
    approved_by VARCHAR(128) NULL,
    approved_at TIMESTAMPTZ NULL,
    published_by VARCHAR(128) NULL,
    archived_by VARCHAR(128) NULL,
    status announcement_status_enum NOT NULL DEFAULT 'DRAFT',
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    notification_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    notification_channels JSONB NOT NULL DEFAULT '["IN_APP"]'::jsonb,
    target_segment target_segment_enum NOT NULL DEFAULT 'ALL_USERS',
    target_config JSONB NULL,
    published_at TIMESTAMPTZ NULL,
    scheduled_at TIMESTAMPTZ NULL,
    archived_at TIMESTAMPTZ NULL,
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_maker_checker_distinct CHECK (
        approved_by IS NULL OR approved_by <> author_admin_id
    )
);

-- ----------------------------------------------------------------------------
-- 4. ANNOUNCEMENT VERSIONS (PUBLICATION & REVISION HISTORY)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcement_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    version INT NOT NULL CHECK (version >= 1),
    title VARCHAR(240) NOT NULL,
    slug VARCHAR(260) NOT NULL,
    category announcement_category_enum NOT NULL,
    short_description VARCHAR(600) NOT NULL,
    content_html TEXT NOT NULL,
    cover_image_url TEXT NULL,
    status announcement_status_enum NOT NULL,
    edited_by VARCHAR(128) NOT NULL,
    change_summary VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_announcement_version UNIQUE (announcement_id, version)
);

-- ----------------------------------------------------------------------------
-- 5. APPEND-ONLY ANNOUNCEMENT & BROADCAST AUDIT LOGS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcement_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(32) NOT NULL CHECK (entity_type IN ('ANNOUNCEMENT', 'CAMPAIGN', 'MEDIA')),
    entity_id VARCHAR(128) NOT NULL,
    action VARCHAR(64) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    ip_address VARCHAR(64) NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    previous_hash VARCHAR(64) NOT NULL,
    current_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION fn_prevent_cms_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'DIMONEX Security Violation: announcement_audit_logs is append-only.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_cms_audit ON announcement_audit_logs;
CREATE TRIGGER trg_protect_cms_audit
BEFORE UPDATE OR DELETE ON announcement_audit_logs
FOR EACH ROW EXECUTE FUNCTION fn_prevent_cms_audit_tampering();

-- ----------------------------------------------------------------------------
-- 6. GLOBAL NOTIFICATION CAMPAIGNS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE RESTRICT,
    announcement_slug VARCHAR(260) NOT NULL,
    title VARCHAR(240) NOT NULL,
    summary VARCHAR(600) NOT NULL,
    category announcement_category_enum NOT NULL,
    channels JSONB NOT NULL DEFAULT '["IN_APP"]'::jsonb,
    target_segment target_segment_enum NOT NULL DEFAULT 'ALL_USERS',
    target_config JSONB NULL,
    idempotency_key VARCHAR(160) NOT NULL UNIQUE,
    status campaign_status_enum NOT NULL DEFAULT 'QUEUED',
    created_by VARCHAR(128) NOT NULL,
    total_eligible INT NOT NULL DEFAULT 0 CHECK (total_eligible >= 0),
    queued_count INT NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
    sent_count INT NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
    failed_count INT NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    read_count INT NOT NULL DEFAULT 0 CHECK (read_count >= 0),
    scheduled_at TIMESTAMPTZ NULL,
    started_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL,
    cancelled_by VARCHAR(128) NULL,
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 7. TRANSACTIONAL OUTBOX JOBS (CRASH-SAFE WORKER RECOVERY)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_outbox_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES notification_campaigns(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(160) NOT NULL UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INT NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
    next_retry_at TIMESTAMPTZ NULL,
    locked_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 8. PER-RECIPIENT DELIVERY RECORDS (IDEMPOTENT PER CAMPAIGN + USER + CHANNEL)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES notification_campaigns(id) ON DELETE CASCADE,
    user_id VARCHAR(128) NOT NULL,
    channel notification_channel_enum NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL UNIQUE,
    status delivery_status_enum NOT NULL DEFAULT 'QUEUED',
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INT NOT NULL DEFAULT 4 CHECK (max_attempts >= 1),
    next_retry_at TIMESTAMPTZ NULL,
    sent_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_delivery_campaign_user_channel UNIQUE (campaign_id, user_id, channel)
);

-- ----------------------------------------------------------------------------
-- 9. USER IN-APP NOTIFICATIONS INBOX
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(128) NOT NULL,
    campaign_id UUID NULL REFERENCES notification_campaigns(id) ON DELETE SET NULL,
    announcement_id UUID NULL REFERENCES announcements(id) ON DELETE SET NULL,
    announcement_slug VARCHAR(260) NULL,
    category announcement_category_enum NOT NULL DEFAULT 'ANNOUNCEMENT',
    title VARCHAR(240) NOT NULL,
    summary VARCHAR(600) NOT NULL,
    cover_image_url TEXT NULL,
    idempotency_key VARCHAR(200) NOT NULL UNIQUE,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 10. USER NOTIFICATION CHANNEL PREFERENCES & CONSENT
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_notification_preferences (
    user_id VARCHAR(128) PRIMARY KEY,
    in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    web_push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    web_push_permission_granted BOOLEAN NOT NULL DEFAULT FALSE,
    email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    email_consent_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 11. INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_announcements_public_feed
    ON announcements(status, is_pinned DESC, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_scheduled
    ON announcements(status, scheduled_at ASC);
CREATE INDEX IF NOT EXISTS idx_announcements_category
    ON announcements(category, status);
CREATE INDEX IF NOT EXISTS idx_announcement_versions_ann
    ON announcement_versions(announcement_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_cms_audit_entity
    ON announcement_audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_status
    ON notification_campaigns(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON notification_outbox_jobs(status, next_retry_at ASC);
CREATE INDEX IF NOT EXISTS idx_deliveries_campaign_status
    ON notification_deliveries(campaign_id, status, next_retry_at ASC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_inbox
    ON user_notifications(user_id, is_read, created_at DESC);
