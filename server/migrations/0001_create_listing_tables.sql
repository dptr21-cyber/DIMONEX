-- ============================================================================
-- DIMONEX Centralized Cryptocurrency Spot Exchange (Quote Currency: IDR)
-- Migration: 0001_create_listing_tables.sql
-- Description: Initial Listing domain schema, status-based state management,
--              Maker-Checker approval governance, immutable cryptographic
--              audit trail, and transactional outbox for market activation.
-- Compatible with PostgreSQL 14+ / Supabase / Google Cloud SQL.
-- ============================================================================

-- Ensure uuid-ossp or pgcrypto extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. ENUMS AND CUSTOM TYPES
-- ----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE listing_status_enum AS ENUM (
        'DRAFT',
        'PENDING_REVIEW',
        'APPROVED',
        'REJECTED',
        'SCHEDULED',
        'ACTIVE',
        'SUSPENDED',
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE asset_type_enum AS ENUM ('NATIVE', 'TOKEN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE asset_status_enum AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'RETIRED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE outbox_status_enum AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ----------------------------------------------------------------------------
-- 2. ASSETS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    asset_type asset_type_enum NOT NULL DEFAULT 'TOKEN',
    decimals INT NOT NULL CHECK (decimals >= 0 AND decimals <= 18),
    network VARCHAR(64) NOT NULL,
    contract_address VARCHAR(128) NULL,
    status asset_status_enum NOT NULL DEFAULT 'PENDING',
    deposit_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    withdrawal_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    deposit_opened_at TIMESTAMPTZ NULL,
    withdrawal_opened_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. LISTING REQUESTS TABLE (Status-based State Management)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    quote_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    status listing_status_enum NOT NULL DEFAULT 'DRAFT',
    
    -- Zero-Float exact integer financial parameters (NUMERIC(38,0) = unsigned 128-bit integer)
    tick_size NUMERIC(38, 0) NOT NULL CHECK (tick_size > 0),
    lot_size NUMERIC(38, 0) NOT NULL CHECK (lot_size > 0),
    min_quantity NUMERIC(38, 0) NOT NULL CHECK (min_quantity > 0),
    min_notional NUMERIC(38, 0) NOT NULL CHECK (min_notional > 0),
    
    -- Invariant: minimum order quantity cannot be lower than the matching lot size
    CONSTRAINT chk_min_qty_gte_lot CHECK (min_quantity >= lot_size),
    
    -- Fee parameters in basis points (1 bps = 0.01%, max 10.00% = 1000 bps)
    maker_fee_bps INT NOT NULL DEFAULT 10 CHECK (maker_fee_bps >= 0 AND maker_fee_bps <= 1000),
    taker_fee_bps INT NOT NULL DEFAULT 20 CHECK (taker_fee_bps >= 0 AND taker_fee_bps <= 1000),
    
    -- Scheduled activation and deposit/withdrawal timestamps
    scheduled_at TIMESTAMPTZ NULL,
    deposit_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    withdrawal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    deposit_opened_at TIMESTAMPTZ NULL,
    withdrawal_opened_at TIMESTAMPTZ NULL,
    
    -- Designated Market Maker & Project Owner / Issuer Accounts
    market_maker_account_id VARCHAR(128) NULL,
    project_owner_account_id VARCHAR(128) NULL,
    initial_liquidity_base NUMERIC(38, 0) NULL CHECK (initial_liquidity_base IS NULL OR initial_liquidity_base >= 0),
    initial_liquidity_quote_idr NUMERIC(38, 0) NULL CHECK (initial_liquidity_quote_idr IS NULL OR initial_liquidity_quote_idr >= 0),
    
    -- Maker Identity and concurrency versioning
    created_by VARCHAR(128) NOT NULL,
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Single active listing per pair constraint
    CONSTRAINT uq_listing_requests_base_quote UNIQUE (asset_id, quote_asset_id)
);

-- ----------------------------------------------------------------------------
-- 4. LISTING APPROVALS TABLE (Maker-Checker Governance)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_request_id UUID NOT NULL REFERENCES listing_requests(id) ON DELETE CASCADE,
    reviewer_id VARCHAR(128) NOT NULL,
    decision VARCHAR(16) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
    reason TEXT NOT NULL CHECK (char_length(reason) >= 5),
    config_version INT NOT NULL CHECK (config_version >= 1),
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraint: Only one approval decision recorded per listing config version
    CONSTRAINT uq_listing_approvals_request_version UNIQUE (listing_request_id, config_version)
);

-- ----------------------------------------------------------------------------
-- 5. CRYPTOGRAPHIC IMMUTABLE AUDIT TRAIL TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_trail (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    correlation_id VARCHAR(128) NOT NULL,
    idempotency_key VARCHAR(128) NULL,
    aggregate_version INT NOT NULL CHECK (aggregate_version >= 1),
    payload JSONB NOT NULL,
    reason TEXT NULL,
    security_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    previous_hash VARCHAR(64) NOT NULL,
    current_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable Append-Only Trigger: Absolutely forbid UPDATE or DELETE on audit_trail
CREATE OR REPLACE FUNCTION fn_prevent_audit_trail_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'DIMONEX Security Violation: audit_trail is append-only. UPDATE and DELETE operations are strictly prohibited.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_audit_trail ON audit_trail;
CREATE TRIGGER trg_protect_audit_trail
BEFORE UPDATE OR DELETE ON audit_trail
FOR EACH ROW EXECUTE FUNCTION fn_prevent_audit_trail_tampering();

-- Backward-compatibility view for services referencing listing_audit_trail
CREATE OR REPLACE VIEW listing_audit_trail AS 
SELECT * FROM audit_trail;

-- ----------------------------------------------------------------------------
-- 6. TRANSACTIONAL OUTBOX TABLE FOR IDEMPOTENT MARKET ACTIVATION
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactional_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    status outbox_status_enum NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ NULL
);

-- ----------------------------------------------------------------------------
-- 7. MARKETS TABLE (Settlement and Engine Reference)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS markets (
    id VARCHAR(32) PRIMARY KEY, -- e.g. 'ETH-IDR', 'SOL-IDR'
    base_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    quote_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    listing_request_id UUID NOT NULL REFERENCES listing_requests(id) ON DELETE RESTRICT,
    symbol VARCHAR(32) NOT NULL UNIQUE,
    status VARCHAR(16) NOT NULL DEFAULT 'PREPARING' CHECK (status IN ('PREPARING', 'ACTIVE', 'HALTED', 'CLOSED')),
    tick_size NUMERIC(38, 0) NOT NULL CHECK (tick_size > 0),
    lot_size NUMERIC(38, 0) NOT NULL CHECK (lot_size > 0),
    min_quantity NUMERIC(38, 0) NOT NULL CHECK (min_quantity > 0),
    min_notional NUMERIC(38, 0) NOT NULL CHECK (min_notional > 0),
    maker_fee_bps INT NOT NULL CHECK (maker_fee_bps >= 0),
    taker_fee_bps INT NOT NULL CHECK (taker_fee_bps >= 0),
    activated_at TIMESTAMPTZ NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_markets_base_quote UNIQUE (base_asset_id, quote_asset_id)
);

-- ----------------------------------------------------------------------------
-- 8. INDEXES FOR QUERY OPTIMIZATION & WORKFLOW MONITORING
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_listing_requests_status ON listing_requests(status);
CREATE INDEX IF NOT EXISTS idx_listing_requests_asset_id ON listing_requests(asset_id);
CREATE INDEX IF NOT EXISTS idx_listing_requests_created_by ON listing_requests(created_by);
CREATE INDEX IF NOT EXISTS idx_listing_approvals_request ON listing_approvals(listing_request_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_aggregate ON audit_trail(aggregate_id, aggregate_version);
CREATE INDEX IF NOT EXISTS idx_audit_trail_created ON audit_trail(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactional_outbox_status ON transactional_outbox(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_markets_symbol ON markets(symbol);
