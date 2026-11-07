-- Migration 005: Initial Listing, Asset Registry, Maker-Checker Approvals, Outbox, and Cryptographic Audit Trail
-- Compatible with PostgreSQL 14+ / Supabase / Cloud SQL

-- 1. ENUM TYPES
DO $$ BEGIN
    CREATE TYPE asset_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'RETIRED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE asset_type AS ENUM ('NATIVE', 'TOKEN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE listing_status AS ENUM (
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
    CREATE TYPE market_status AS ENUM ('PREPARING', 'ACTIVE', 'HALTED', 'CLOSED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE outbox_status AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. ASSETS TABLE
CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    asset_type asset_type NOT NULL,
    decimals INT NOT NULL CHECK (decimals >= 0 AND decimals <= 18),
    network VARCHAR(64) NOT NULL,
    contract_address VARCHAR(128) NULL,
    status asset_status NOT NULL DEFAULT 'PENDING',
    deposit_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    withdrawal_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. LISTING REQUESTS TABLE (Quote currency default is IDR)
CREATE TABLE IF NOT EXISTS listing_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    quote_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    status listing_status NOT NULL DEFAULT 'DRAFT',
    
    -- Zero-Float exact integer financial parameters
    tick_size NUMERIC(38, 0) NOT NULL CHECK (tick_size > 0),
    lot_size NUMERIC(38, 0) NOT NULL CHECK (lot_size > 0),
    min_quantity NUMERIC(38, 0) NOT NULL CHECK (min_quantity > 0),
    min_notional NUMERIC(38, 0) NOT NULL CHECK (min_notional > 0),
    CONSTRAINT chk_min_qty_gte_lot CHECK (min_quantity >= lot_size),
    
    maker_fee_bps INT NOT NULL DEFAULT 10 CHECK (maker_fee_bps >= 0 AND maker_fee_bps <= 1000),
    taker_fee_bps INT NOT NULL DEFAULT 20 CHECK (taker_fee_bps >= 0 AND taker_fee_bps <= 1000),
    
    -- Scheduled activation and deposit/withdrawal channels
    scheduled_at TIMESTAMP WITH TIME ZONE NULL,
    deposit_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    withdrawal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    deposit_opened_at TIMESTAMP WITH TIME ZONE NULL,
    withdrawal_opened_at TIMESTAMP WITH TIME ZONE NULL,
    
    -- Designated MM and Project Owner accounts
    market_maker_account_id VARCHAR(128) NULL,
    project_owner_account_id VARCHAR(128) NULL,
    initial_liquidity_base NUMERIC(38, 0) NULL CHECK (initial_liquidity_base IS NULL OR initial_liquidity_base >= 0),
    initial_liquidity_quote_idr NUMERIC(38, 0) NULL CHECK (initial_liquidity_quote_idr IS NULL OR initial_liquidity_quote_idr >= 0),
    
    created_by VARCHAR(128) NOT NULL,
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_listing_asset_quote UNIQUE (asset_id, quote_asset_id)
);

-- 4. LISTING APPROVALS TABLE (Maker-Checker Enforcement)
CREATE TABLE IF NOT EXISTS listing_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_request_id UUID NOT NULL REFERENCES listing_requests(id) ON DELETE RESTRICT,
    reviewer_id VARCHAR(128) NOT NULL,
    decision VARCHAR(16) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
    reason TEXT NOT NULL CHECK (length(reason) >= 5),
    config_version INT NOT NULL CHECK (config_version >= 1),
    reviewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_listing_approval_version UNIQUE (listing_request_id, config_version)
);

-- 5. MARKETS TABLE (Single Pair Constraint)
CREATE TABLE IF NOT EXISTS markets (
    id VARCHAR(32) PRIMARY KEY, -- e.g. 'ETH-IDR', 'SOL-IDR'
    base_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    quote_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    listing_request_id UUID NOT NULL REFERENCES listing_requests(id) ON DELETE RESTRICT,
    symbol VARCHAR(32) NOT NULL UNIQUE,
    status market_status NOT NULL DEFAULT 'PREPARING',
    tick_size NUMERIC(38, 0) NOT NULL CHECK (tick_size > 0),
    lot_size NUMERIC(38, 0) NOT NULL CHECK (lot_size > 0),
    min_quantity NUMERIC(38, 0) NOT NULL CHECK (min_quantity > 0),
    min_notional NUMERIC(38, 0) NOT NULL CHECK (min_notional > 0),
    maker_fee_bps INT NOT NULL CHECK (maker_fee_bps >= 0 AND maker_fee_bps <= 1000),
    taker_fee_bps INT NOT NULL CHECK (taker_fee_bps >= 0 AND taker_fee_bps <= 1000),
    activated_at TIMESTAMP WITH TIME ZONE NULL,
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_market_base_quote UNIQUE (base_asset_id, quote_asset_id)
);

-- 6. APPEND-ONLY CRYPTOGRAPHIC AUDIT TRAIL TABLE
CREATE TABLE IF NOT EXISTS audit_trail (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Compatibility views for audit trail
CREATE OR REPLACE VIEW listing_audit_events AS SELECT * FROM audit_trail;
CREATE OR REPLACE VIEW listing_audit_trail AS SELECT * FROM audit_trail;

-- 7. TRANSACTIONAL OUTBOX TABLE FOR IDEMPOTENT ACTIVATION
CREATE TABLE IF NOT EXISTS transactional_outbox (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    status outbox_status NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    delivered_at TIMESTAMP WITH TIME ZONE NULL
);

-- 8. IDEMPOTENCY RECORDS TABLE
CREATE TABLE IF NOT EXISTS idempotency_records (
    key VARCHAR(128) PRIMARY KEY,
    scope VARCHAR(64) NOT NULL,
    response_code INT NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. INDEXES
CREATE INDEX IF NOT EXISTS idx_listing_requests_status ON listing_requests(status);
CREATE INDEX IF NOT EXISTS idx_listing_requests_asset ON listing_requests(asset_id);
CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_listing_audit_aggregate ON listing_audit_events(aggregate_id, aggregate_version);
CREATE INDEX IF NOT EXISTS idx_outbox_status_created ON transactional_outbox(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_idempotency_scope_created ON idempotency_records(scope, created_at DESC);

-- 10. REVERSIBLE DOWN MIGRATION PROCEDURE (COMMENTED)
/*
-- To rollback migration 005 safely:
DROP TABLE IF EXISTS idempotency_records;
DROP TABLE IF EXISTS transactional_outbox;
DROP TABLE IF EXISTS listing_audit_events;
DROP TABLE IF EXISTS markets;
DROP TABLE IF EXISTS listing_approvals;
DROP TABLE IF EXISTS listing_requests;
DROP TABLE IF EXISTS assets;
DROP TYPE IF EXISTS outbox_status;
DROP TYPE IF EXISTS market_status;
DROP TYPE IF EXISTS listing_status;
DROP TYPE IF EXISTS asset_type;
DROP TYPE IF EXISTS asset_status;
*/
