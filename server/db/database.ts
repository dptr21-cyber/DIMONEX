/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * database.ts
 * In-memory ACID Transactional Database Store for DIMONEX.
 * Supports thread-safe operations, optimistic locking, indexing, and seed bootstrap.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { 
  User, UserKyc, LedgerAccount, JournalTransaction, LedgerEntry, 
  TradingPair, Order, Trade, FiatTransaction, CryptoTransaction, ApiKey, AuditLog,
  BotInstance, RiskControlsConfig,
  Asset, ListingRequest, ListingApproval, Market, ListingAuditEvent,
  TransactionalOutboxEvent, IdempotencyRecord
} from './types.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';

export const SYSTEM_TREASURY_ID = 'sys-treasury-0000-0000-000000000000';
export const SYSTEM_FEE_ID = 'sys-fees-0000-0000-000000000000';
export const SYSTEM_HOT_WALLET_ID = 'sys-hotwallet-0000-0000-000000000000';

export const DEFAULT_RISK_CONTROLS: RiskControlsConfig = {
  maxActiveBots: 50,
  maxOpenOrdersPerBot: 100,
  maxOrderSize: '5000000000', // 50 BTC
  maxNotionalExposureIdr: '5000000000000', // 50B IDR
  maxDailyTradingNotionalIdr: '20000000000000', // 200B IDR
  maxPriceDeviationPct: 15, // 15% from last price
  maxOrderSubmissionRatePerMin: 120,
  maxTotalReservedBalancePct: 90,
  maxRetryCount: 5,
  maxRuntimeMinutes: 1440,
  maxConsecutiveErrors: 10,
  maxAllowedSlippagePct: 2.5,
  selfTradePreventionPolicy: 'CANCEL_MAKER',
  isKillSwitchActive: false
};

const DATA_DIR = path.resolve(process.cwd(), 'server', 'data');
const STATE_FILE = path.join(DATA_DIR, 'exchange_state.json');

export interface PersistedExchangeState {
  version: number;
  savedAt: number;
  users: [string, User][];
  kyc: [string, UserKyc][];
  ledgerAccounts: [string, LedgerAccount][];
  accountIndex: [string, string][];
  journalTransactions: [string, JournalTransaction][];
  journalIdempotencyIndex: [string, string][];
  ledgerEntries: LedgerEntry[];
  tradingPairs: [string, TradingPair][];
  orders: [string, Order][];
  trades: Trade[];
  fiatTransactions: [string, FiatTransaction][];
  cryptoTransactions: [string, CryptoTransaction][];
  apiKeys: [string, ApiKey][];
  auditLogs: AuditLog[];
  sessions: [string, { userId: string; token: string; device: string; ip: string; expiresAt: number }][];
  botInstances?: [string, BotInstance][];
  riskControls?: RiskControlsConfig;
  assets?: [string, Asset][];
  listingRequests?: [string, ListingRequest][];
  listingApprovals?: [string, ListingApproval][];
  markets?: [string, Market][];
  listingAuditEvents?: ListingAuditEvent[];
  outboxEvents?: [string, TransactionalOutboxEvent][];
  idempotencyRecords?: [string, IdempotencyRecord][];
}

class DatabaseStore {
  users: Map<string, User> = new Map();
  kyc: Map<string, UserKyc> = new Map(); // key: userId
  ledgerAccounts: Map<string, LedgerAccount> = new Map(); // key: accountId
  accountIndex: Map<string, string> = new Map(); // key: `${userId}:${currency}` -> accountId
  journalTransactions: Map<string, JournalTransaction> = new Map();
  journalIdempotencyIndex: Map<string, string> = new Map(); // key: idempotencyKey -> journalId
  ledgerEntries: LedgerEntry[] = [];
  tradingPairs: Map<string, TradingPair> = new Map();
  orders: Map<string, Order> = new Map();
  trades: Trade[] = [];
  fiatTransactions: Map<string, FiatTransaction> = new Map();
  cryptoTransactions: Map<string, CryptoTransaction> = new Map();
  apiKeys: Map<string, ApiKey> = new Map();
  auditLogs: AuditLog[] = [];
  sessions: Map<string, { userId: string; token: string; device: string; ip: string; expiresAt: number }> = new Map();
  botInstances: Map<string, BotInstance> = new Map();
  riskControls: RiskControlsConfig = { ...DEFAULT_RISK_CONTROLS };
  assets: Map<string, Asset> = new Map();
  listingRequests: Map<string, ListingRequest> = new Map();
  listingApprovals: Map<string, ListingApproval> = new Map();
  markets: Map<string, Market> = new Map();
  listingAuditEvents: ListingAuditEvent[] = [];
  outboxEvents: Map<string, TransactionalOutboxEvent> = new Map();
  idempotencyRecords: Map<string, IdempotencyRecord> = new Map();
  
  private saveTimer: NodeJS.Timeout | null = null;
  private isSaving = false;

  constructor() {
    const loaded = this.loadFromDisk();
    if (!loaded) {
      console.log('[DIMONEX Database] Menginisialisasi data awal (seed bootstrap)...');
      this.seedInitialData();
      this.ensureInitialListingData();
      this.ensureHistoricalTrades();
      this.recalculatePair24hStats();
      this.saveToDisk();
    } else {
      this.ensureTradingPairs();
      this.ensureRequiredAccounts();
      this.ensureInitialListingData();
      this.cleanExpiredSessions();
      this.ensureHistoricalTrades();
      this.recalculatePair24hStats();
      this.saveToDisk();
    }

    // Register exit handlers to ensure state is flushed to disk
    const onExit = () => {
      this.flushSync();
    };
    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);
  }

  // Hash password using PBKDF2
  hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  }

  generateSalt(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  seedInitialData() {
    // 1. Setup Trading Pairs (BTC/IDR, ETH/IDR, USDT/IDR)
    const pairs: TradingPair[] = [
      {
        id: 'BTC-IDR',
        baseCurrency: 'BTC',
        quoteCurrency: 'IDR',
        baseDecimals: 8,
        quoteDecimals: 2,
        minOrderSize: '1000', // 0.00001 BTC
        maxOrderSize: '1000000000', // 10 BTC
        makerFeeBps: 10, // 0.10%
        takerFeeBps: 20, // 0.20%
        isActive: true,
        isHalted: false,
        lastPrice: '145000000000', // Rp 1,450,000,000.00
        high24h: '148000000000',
        low24h: '143500000000',
        volume24h: '2450000000', // 24.5 BTC
        priceChange24h: '+2.85'
      },
      {
        id: 'ETH-IDR',
        baseCurrency: 'ETH',
        quoteCurrency: 'IDR',
        baseDecimals: 8,
        quoteDecimals: 2,
        minOrderSize: '100000', // 0.001 ETH
        maxOrderSize: '5000000000', // 50 ETH
        makerFeeBps: 10,
        takerFeeBps: 20,
        isActive: true,
        isHalted: false,
        lastPrice: '4850000000', // Rp 48,500,000.00
        high24h: '4920000000',
        low24h: '4790000000',
        volume24h: '18500000000', // 185 ETH
        priceChange24h: '+1.42'
      },
      {
        id: 'USDT-IDR',
        baseCurrency: 'USDT',
        quoteCurrency: 'IDR',
        baseDecimals: 6,
        quoteDecimals: 2,
        minOrderSize: '1000000', // 1 USDT
        maxOrderSize: '100000000000', // 100,000 USDT
        makerFeeBps: 10,
        takerFeeBps: 20,
        isActive: true,
        isHalted: false,
        lastPrice: '1645000', // Rp 16,450.00
        high24h: '1650000',
        low24h: '1640000',
        volume24h: '450000000000', // 450,000 USDT
        priceChange24h: '-0.12'
      },
      {
        id: 'SOL-IDR',
        baseCurrency: 'SOL',
        quoteCurrency: 'IDR',
        baseDecimals: 8,
        quoteDecimals: 2,
        minOrderSize: '1000000', // 0.01 SOL
        maxOrderSize: '10000000000', // 100 SOL
        makerFeeBps: 10,
        takerFeeBps: 20,
        isActive: true,
        isHalted: false,
        lastPrice: '285000000', // Rp 2,850,000.00
        high24h: '292000000',
        low24h: '278000000',
        volume24h: '1245000000000', // 12,450 SOL
        priceChange24h: '+4.12'
      }
    ];

    pairs.forEach(p => this.tradingPairs.set(p.id, p));

    // 2. Setup System Accounts (Treasury, Fee Collector, Hot Wallets)
    const systemCurrencies = ['IDR', 'BTC', 'ETH', 'USDT', 'SOL'];
    const systemUsers = [
      { id: SYSTEM_TREASURY_ID, name: 'System Treasury' },
      { id: SYSTEM_FEE_ID, name: 'System Fee Collector' },
      { id: SYSTEM_HOT_WALLET_ID, name: 'System Hot Wallet' }
    ];

    for (const sysUser of systemUsers) {
      for (const curr of systemCurrencies) {
        const accId = crypto.randomUUID();
        const initialBalance = sysUser.id === SYSTEM_TREASURY_ID ? '1000000000000000' : '0';
        const account: LedgerAccount = {
          id: accId,
          userId: sysUser.id,
          currency: curr,
          balanceAvailable: initialBalance,
          balanceLocked: '0',
          version: 1,
          updatedAt: Date.now()
        };
        this.ledgerAccounts.set(accId, account);
        this.accountIndex.set(`${sysUser.id}:${curr}`, accId);
      }
    }

    // 3. Seed Default Admin User
    const adminSalt = this.generateSalt();
    const adminUser: User = {
      id: 'usr-admin-0000-0000-000000000001',
      email: 'admin@dimonex.id',
      passwordSalt: adminSalt,
      passwordHash: this.hashPassword('AdminDimonex2026!', adminSalt),
      role: 'ADMIN',
      status: 'active',
      isTotpEnabled: false,
      failedLoginAttempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.users.set(adminUser.id, adminUser);
    this.kyc.set(adminUser.id, {
      id: crypto.randomUUID(),
      userId: adminUser.id,
      fullName: 'Super Admin DIMONEX',
      nik: '3171012345670001',
      birthDate: '1988-08-17',
      status: 'approved',
      tierLevel: 2,
      createdAt: Date.now(),
      reviewedAt: Date.now()
    });

    // Give Admin starting balance
    this.createOrGetAccount(adminUser.id, 'IDR', '5000000000000'); // Rp 50,000,000,000.00
    this.createOrGetAccount(adminUser.id, 'BTC', '10000000000');   // 100.0 BTC
    this.createOrGetAccount(adminUser.id, 'ETH', '10000000000');   // 100.0 ETH
    this.createOrGetAccount(adminUser.id, 'USDT', '500000000000'); // 500,000 USDT

    // 4. Seed MM (Market Maker Operator) Account
    const mmSalt = this.generateSalt();
    const mmUser: User = {
      id: 'usr-mm-0000-0000-000000000001',
      email: 'mm@dimonex.id',
      passwordSalt: mmSalt,
      passwordHash: this.hashPassword('MarketMaker2026!', mmSalt),
      role: 'MM',
      status: 'active',
      isTotpEnabled: false,
      failedLoginAttempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.users.set(mmUser.id, mmUser);
    this.kyc.set(mmUser.id, {
      id: crypto.randomUUID(),
      userId: mmUser.id,
      fullName: 'Market Maker Operator DIMONEX',
      nik: '3172011102900002',
      birthDate: '1990-02-11',
      status: 'approved',
      tierLevel: 2,
      createdAt: Date.now(),
      reviewedAt: Date.now()
    });
    this.createOrGetAccount(mmUser.id, 'IDR', '5000000000000'); // 50B IDR
    this.createOrGetAccount(mmUser.id, 'BTC', '5000000000');   // 50.0 BTC
    this.createOrGetAccount(mmUser.id, 'ETH', '10000000000');  // 100.0 ETH
    this.createOrGetAccount(mmUser.id, 'USDT', '500000000000'); // 500,000 USDT

    // 5. Seed user1 (Regular Trading User 1)
    const u1Salt = this.generateSalt();
    const user1: User = {
      id: 'usr-user1-0000-0000-000000000001',
      email: 'user1@dimonex.id',
      passwordSalt: u1Salt,
      passwordHash: this.hashPassword('User1Dimonex2026!', u1Salt),
      role: 'USER',
      status: 'active',
      isTotpEnabled: false,
      failedLoginAttempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.users.set(user1.id, user1);
    this.kyc.set(user1.id, {
      id: crypto.randomUUID(),
      userId: user1.id,
      fullName: 'User Satu Trading',
      nik: '3273012908850001',
      birthDate: '1991-03-15',
      status: 'approved',
      tierLevel: 2,
      createdAt: Date.now()
    });
    this.createOrGetAccount(user1.id, 'IDR', '1000000000000'); // 10B IDR
    this.createOrGetAccount(user1.id, 'BTC', '1000000000');   // 10.0 BTC
    this.createOrGetAccount(user1.id, 'ETH', '1000000000');   // 10.0 ETH
    this.createOrGetAccount(user1.id, 'USDT', '25000000000'); // 25,000 USDT

    // 6. Seed user2 (Regular Trading User 2)
    const u2Salt = this.generateSalt();
    const user2: User = {
      id: 'usr-user2-0000-0000-000000000002',
      email: 'user2@dimonex.id',
      passwordSalt: u2Salt,
      passwordHash: this.hashPassword('User2Dimonex2026!', u2Salt),
      role: 'USER',
      status: 'active',
      isTotpEnabled: false,
      failedLoginAttempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.users.set(user2.id, user2);
    this.kyc.set(user2.id, {
      id: crypto.randomUUID(),
      userId: user2.id,
      fullName: 'User Dua Trading',
      nik: '3175026112920002',
      birthDate: '1993-07-20',
      status: 'approved',
      tierLevel: 2,
      createdAt: Date.now()
    });
    this.createOrGetAccount(user2.id, 'IDR', '500000000000'); // 5B IDR
    this.createOrGetAccount(user2.id, 'BTC', '2000000000');  // 20.0 BTC
    this.createOrGetAccount(user2.id, 'ETH', '500000000');   // 5.0 ETH
    this.createOrGetAccount(user2.id, 'USDT', '10000000000'); // 10,000 USDT

    // 7. Seed Trader Budi & Trader Siti (Aliases for existing test setups)
    const trader1Salt = this.generateSalt();
    const trader1: User = {
      id: 'usr-budi-0000-0000-000000000002',
      email: 'budi@dimonex.id',
      passwordSalt: trader1Salt,
      passwordHash: this.hashPassword('TraderDimonex123!', trader1Salt),
      role: 'USER',
      status: 'active',
      isTotpEnabled: false,
      failedLoginAttempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.users.set(trader1.id, trader1);
    this.kyc.set(trader1.id, {
      id: crypto.randomUUID(),
      userId: trader1.id,
      fullName: 'Budi Santoso',
      nik: '3273012908850003',
      birthDate: '1985-08-29',
      status: 'approved',
      tierLevel: 2,
      createdAt: Date.now()
    });

    const trader2Salt = this.generateSalt();
    const trader2: User = {
      id: 'usr-siti-0000-0000-000000000003',
      email: 'siti@dimonex.id',
      passwordSalt: trader2Salt,
      passwordHash: this.hashPassword('TraderDimonex123!', trader2Salt),
      role: 'USER',
      status: 'active',
      isTotpEnabled: false,
      failedLoginAttempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.users.set(trader2.id, trader2);
    this.kyc.set(trader2.id, {
      id: crypto.randomUUID(),
      userId: trader2.id,
      fullName: 'Siti Rahmawati',
      nik: '3175026112920005',
      birthDate: '1992-12-21',
      status: 'approved',
      tierLevel: 2,
      createdAt: Date.now()
    });

    // Starting balances for budi and siti
    this.createOrGetAccount(trader1.id, 'IDR', '1000000000000');
    this.createOrGetAccount(trader1.id, 'BTC', '1000000000');
    this.createOrGetAccount(trader1.id, 'ETH', '1000000000');
    this.createOrGetAccount(trader1.id, 'USDT', '25000000000');

    this.createOrGetAccount(trader2.id, 'IDR', '500000000000');
    this.createOrGetAccount(trader2.id, 'BTC', '2000000000');
    this.createOrGetAccount(trader2.id, 'ETH', '500000000');
    this.createOrGetAccount(trader2.id, 'USDT', '10000000000');

    // Give Trader 1 starting balance: Rp 10,000,000,000 IDR and 10 BTC
    this.createOrGetAccount(trader1.id, 'IDR', '1000000000000'); // Rp 10,000,000,000.00
    this.createOrGetAccount(trader1.id, 'BTC', '1000000000');   // 10.0 BTC
    this.createOrGetAccount(trader1.id, 'ETH', '1000000000');  // 10 ETH
    this.createOrGetAccount(trader1.id, 'USDT', '25000000000'); // 25,000 USDT

    // Give Trader 2 starting balance: Rp 5,000,000,000 IDR and 20.0 BTC
    this.createOrGetAccount(trader2.id, 'IDR', '500000000000'); // Rp 5,000,000,000.00
    this.createOrGetAccount(trader2.id, 'BTC', '2000000000');   // 20.0 BTC
    this.createOrGetAccount(trader2.id, 'ETH', '500000000');   // 5 ETH
    this.createOrGetAccount(trader2.id, 'USDT', '10000000000'); // 10,000 USDT

    // Seed Initial Realistic Order Book depth for BTC-IDR, ETH-IDR, USDT-IDR
    this.seedInitialMarketOrders();
  }

  seedInitialMarketOrders() {
    const btcMid = 145000000000n; // Rp 1,450,000,000.00
    const trader1Id = 'usr-budi-0000-0000-000000000002';
    const trader2Id = 'usr-siti-0000-0000-000000000003';

    // Bids (Buy orders below mid price)
    const bids = [
      { price: btcMid - 25000000n, qty: 35000000n },  // -250k IDR, 0.35 BTC
      { price: btcMid - 50000000n, qty: 50000000n },  // -500k IDR, 0.50 BTC
      { price: btcMid - 100000000n, qty: 85000000n }, // -1M IDR, 0.85 BTC
      { price: btcMid - 180000000n, qty: 120000000n },// -1.8M IDR, 1.2 BTC
      { price: btcMid - 300000000n, qty: 250000000n },// -3M IDR, 2.5 BTC
    ];

    // Asks (Sell orders above mid price)
    const asks = [
      { price: btcMid + 25000000n, qty: 28000000n },  // +250k IDR, 0.28 BTC
      { price: btcMid + 60000000n, qty: 45000000n },  // +600k IDR, 0.45 BTC
      { price: btcMid + 120000000n, qty: 75000000n }, // +1.2M IDR, 0.75 BTC
      { price: btcMid + 220000000n, qty: 150000000n },// +2.2M IDR, 1.50 BTC
      { price: btcMid + 350000000n, qty: 300000000n },// +3.5M IDR, 3.00 BTC
    ];

    let totalBidsLockedIdr = 0n;
    bids.forEach((bid, idx) => {
      const orderId = `seed-btc-bid-${idx + 1}`;
      const lockedIdr = PrecisionMath.calculateQuoteAmount(bid.qty, 8, bid.price);
      totalBidsLockedIdr += lockedIdr;
      this.orders.set(orderId, {
        id: orderId,
        userId: trader1Id,
        pairId: 'BTC-IDR',
        side: 'BUY',
        orderType: 'LIMIT',
        timeInForce: 'GTC',
        price: bid.price.toString(),
        quantity: bid.qty.toString(),
        filledQuantity: '0',
        status: 'NEW',
        lockedAmount: lockedIdr.toString(),
        lockedCurrency: 'IDR',
        createdAt: Date.now() - (10 - idx) * 60000,
        updatedAt: Date.now() - (10 - idx) * 60000
      });
    });

    let totalAsksLockedBtc = 0n;
    asks.forEach((ask, idx) => {
      const orderId = `seed-btc-ask-${idx + 1}`;
      totalAsksLockedBtc += ask.qty;
      this.orders.set(orderId, {
        id: orderId,
        userId: trader2Id,
        pairId: 'BTC-IDR',
        side: 'SELL',
        orderType: 'LIMIT',
        timeInForce: 'GTC',
        price: ask.price.toString(),
        quantity: ask.qty.toString(),
        filledQuantity: '0',
        status: 'NEW',
        lockedAmount: ask.qty.toString(),
        lockedCurrency: 'BTC',
        createdAt: Date.now() - (10 - idx) * 60000,
        updatedAt: Date.now() - (10 - idx) * 60000
      });
    });

    // Update trader1 locked IDR and trader2 locked BTC
    const trader1IdrAcc = this.createOrGetAccount(trader1Id, 'IDR');
    const t1Avail = BigInt(trader1IdrAcc.balanceAvailable);
    trader1IdrAcc.balanceAvailable = (t1Avail - totalBidsLockedIdr).toString();
    trader1IdrAcc.balanceLocked = totalBidsLockedIdr.toString();

    const trader2BtcAcc = this.createOrGetAccount(trader2Id, 'BTC');
    const t2Avail = BigInt(trader2BtcAcc.balanceAvailable);
    trader2BtcAcc.balanceAvailable = (t2Avail - totalAsksLockedBtc).toString();
    trader2BtcAcc.balanceLocked = totalAsksLockedBtc.toString();

    // Seed Initial Realistic Order Book depth for USDT-IDR (Exact IDR 60 Ladder Spacing)
    const usdtMidQuoteUnits = 1645000n; // Rp 16,450.00
    const usdtSpacingUnits = 6000n;     // Rp 60.00 spacing per level
    const usdtDecimals = 6;             // USDT baseDecimals

    const usdtBids = [
      { price: usdtMidQuoteUnits - 1n * usdtSpacingUnits, qty: 50000000n },  // 16,390 IDR, 50 USDT
      { price: usdtMidQuoteUnits - 2n * usdtSpacingUnits, qty: 100000000n }, // 16,330 IDR, 100 USDT
      { price: usdtMidQuoteUnits - 3n * usdtSpacingUnits, qty: 150000000n }, // 16,270 IDR, 150 USDT
      { price: usdtMidQuoteUnits - 4n * usdtSpacingUnits, qty: 200000000n }, // 16,210 IDR, 200 USDT
      { price: usdtMidQuoteUnits - 5n * usdtSpacingUnits, qty: 250000000n }, // 16,150 IDR, 250 USDT
    ];

    const usdtAsks = [
      { price: usdtMidQuoteUnits + 1n * usdtSpacingUnits, qty: 50000000n },  // 16,510 IDR, 50 USDT
      { price: usdtMidQuoteUnits + 2n * usdtSpacingUnits, qty: 100000000n }, // 16,570 IDR, 100 USDT
      { price: usdtMidQuoteUnits + 3n * usdtSpacingUnits, qty: 150000000n }, // 16,630 IDR, 150 USDT
      { price: usdtMidQuoteUnits + 4n * usdtSpacingUnits, qty: 200000000n }, // 16,690 IDR, 200 USDT
      { price: usdtMidQuoteUnits + 5n * usdtSpacingUnits, qty: 250000000n }, // 16,750 IDR, 250 USDT
    ];

    let totalUsdtBidsLockedIdr = 0n;
    usdtBids.forEach((bid, idx) => {
      const orderId = `seed-usdt-bid-${idx + 1}`;
      const lockedIdr = PrecisionMath.calculateQuoteAmount(bid.qty, usdtDecimals, bid.price);
      totalUsdtBidsLockedIdr += lockedIdr;
      this.orders.set(orderId, {
        id: orderId,
        userId: trader1Id,
        pairId: 'USDT-IDR',
        side: 'BUY',
        orderType: 'LIMIT',
        timeInForce: 'GTC',
        price: bid.price.toString(),
        quantity: bid.qty.toString(),
        filledQuantity: '0',
        status: 'NEW',
        lockedAmount: lockedIdr.toString(),
        lockedCurrency: 'IDR',
        createdAt: Date.now() - (10 - idx) * 60000,
        updatedAt: Date.now() - (10 - idx) * 60000
      });
    });

    let totalUsdtAsksLockedUsdt = 0n;
    usdtAsks.forEach((ask, idx) => {
      const orderId = `seed-usdt-ask-${idx + 1}`;
      totalUsdtAsksLockedUsdt += ask.qty;
      this.orders.set(orderId, {
        id: orderId,
        userId: trader2Id,
        pairId: 'USDT-IDR',
        side: 'SELL',
        orderType: 'LIMIT',
        timeInForce: 'GTC',
        price: ask.price.toString(),
        quantity: ask.qty.toString(),
        filledQuantity: '0',
        status: 'NEW',
        lockedAmount: ask.qty.toString(),
        lockedCurrency: 'USDT',
        createdAt: Date.now() - (10 - idx) * 60000,
        updatedAt: Date.now() - (10 - idx) * 60000
      });
    });

    const t1IdrAvail = BigInt(trader1IdrAcc.balanceAvailable);
    trader1IdrAcc.balanceAvailable = (t1IdrAvail - totalUsdtBidsLockedIdr).toString();
    trader1IdrAcc.balanceLocked = (BigInt(trader1IdrAcc.balanceLocked) + totalUsdtBidsLockedIdr).toString();

    const trader2UsdtAcc = this.createOrGetAccount(trader2Id, 'USDT');
    const t2UsdtAvail = BigInt(trader2UsdtAcc.balanceAvailable);
    trader2UsdtAcc.balanceAvailable = (t2UsdtAvail - totalUsdtAsksLockedUsdt).toString();
    trader2UsdtAcc.balanceLocked = totalUsdtAsksLockedUsdt.toString();

    // Seed some initial trade history
    const trade1: Trade = {
      id: crypto.randomUUID(),
      pairId: 'BTC-IDR',
      makerOrderId: 'seed-maker-1',
      takerOrderId: 'seed-taker-1',
      makerUserId: trader1Id,
      takerUserId: trader2Id,
      price: '144950000000',
      quantity: '25000000', // 0.25 BTC
      quoteVolume: '36237500000', // Rp 362,375,000.00
      makerFee: '36237500', // 0.10% = Rp 362,375
      takerFee: '72475000', // 0.20% = Rp 724,750
      takerSide: 'BUY',
      createdAt: Date.now() - 120000
    };
    this.trades.push(trade1);
  }

  createOrGetAccount(userId: string, currency: string, initialBalance = '0'): LedgerAccount {
    const key = `${userId}:${currency}`;
    const existingId = this.accountIndex.get(key);
    if (existingId && this.ledgerAccounts.has(existingId)) {
      return this.ledgerAccounts.get(existingId)!;
    }

    const newId = crypto.randomUUID();
    const account: LedgerAccount = {
      id: newId,
      userId,
      currency,
      balanceAvailable: initialBalance,
      balanceLocked: '0',
      version: 1,
      updatedAt: Date.now()
    };
    this.ledgerAccounts.set(newId, account);
    this.accountIndex.set(key, newId);
    this.scheduleSave();
    return account;
  }

  getAccount(userId: string, currency: string): LedgerAccount | undefined {
    const accountId = this.accountIndex.get(`${userId}:${currency}`);
    if (!accountId) return undefined;
    return this.ledgerAccounts.get(accountId);
  }

  getAllCurrencies(): string[] {
    const set = new Set<string>(['IDR', 'BTC', 'ETH', 'USDT', 'SOL', 'TON', 'DOGE']);
    for (const pair of this.tradingPairs.values()) {
      if (pair.baseCurrency) set.add(pair.baseCurrency.toUpperCase());
      if (pair.quoteCurrency) set.add(pair.quoteCurrency.toUpperCase());
    }
    for (const asset of this.assets.values()) {
      if (asset.symbol) set.add(asset.symbol.toUpperCase());
    }
    return Array.from(set);
  }

  getUserAccounts(userId: string): LedgerAccount[] {
    const result: LedgerAccount[] = [];
    const currencies = this.getAllCurrencies();
    for (const key of this.accountIndex.keys()) {
      if (key.startsWith(`${userId}:`)) {
        const curr = key.split(':')[1];
        if (curr && !currencies.includes(curr)) {
          currencies.push(curr);
        }
      }
    }
    for (const curr of currencies) {
      result.push(this.createOrGetAccount(userId, curr));
    }
    return result;
  }

  public scheduleSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveToDisk();
      this.saveTimer = null;
    }, 2000);
  }

  public flushSync() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveToDisk();
  }

  /**
   * Authoritative calculation of rolling 24h market statistics derived strictly from executed trades in db.trades.
   * Calculates true lastPrice, high24h, low24h, volume24h, quoteVolume24h, and priceChange24h.
   */
  public recalculatePair24hStats(pairId?: string): TradingPair | TradingPair[] {
    const pairsToUpdate = pairId
      ? [this.tradingPairs.get(pairId)].filter(Boolean) as TradingPair[]
      : Array.from(this.tradingPairs.values());

    const now = Date.now();
    const window24hStart = now - 24 * 60 * 60 * 1000;
    const updatedPairs: TradingPair[] = [];

    for (const pair of pairsToUpdate) {
      const pairTrades = this.trades.filter(t => t.pairId === pair.id);

      if (pairTrades.length === 0) {
        // Zero trades executed historically: freeze at lastPrice or seed defaults
        const lastP = pair.lastPrice && pair.lastPrice !== '0' ? pair.lastPrice : '0';
        pair.lastPrice = lastP;
        pair.high24h = pair.high24h && pair.high24h !== '0' ? pair.high24h : lastP;
        pair.low24h = pair.low24h && pair.low24h !== '0' ? pair.low24h : lastP;
        pair.volume24h = pair.volume24h || '0';
        pair.quoteVolume24h = pair.quoteVolume24h || '0';
        pair.priceChange24h = pair.priceChange24h || '+0.00';
        pair.priceChangePercent24h = (pair.priceChange24h || '0.00').replace('+', '');
        this.tradingPairs.set(pair.id, pair);
        updatedPairs.push(pair);
        continue;
      }

      // Trades executed within the rolling 24-hour window
      const trades24h = pairTrades.filter(t => t.createdAt >= window24hStart);
      const latestTrade = pairTrades[pairTrades.length - 1];
      pair.lastPrice = latestTrade.price;
      const lastPriceBig = BigInt(latestTrade.price);

      if (trades24h.length === 0) {
        // Trades exist historically but none in the last 24h
        pair.high24h = latestTrade.price;
        pair.low24h = latestTrade.price;
        pair.volume24h = '0';
        pair.quoteVolume24h = '0';
        pair.priceChange24h = '+0.00';
        pair.priceChangePercent24h = '0.00';
      } else {
        let highBig = BigInt(trades24h[0].price);
        let lowBig = BigInt(trades24h[0].price);
        let volBaseBig = 0n;
        let volQuoteBig = 0n;

        for (const t of trades24h) {
          const p = BigInt(t.price);
          if (p > highBig) highBig = p;
          if (p < lowBig) lowBig = p;
          volBaseBig += BigInt(t.quantity);
          volQuoteBig += BigInt(t.quoteVolume || '0');
        }

        pair.high24h = highBig.toString();
        pair.low24h = lowBig.toString();
        pair.volume24h = volBaseBig.toString();
        pair.quoteVolume24h = volQuoteBig.toString();

        // Determine 24h Open Price
        // If trades exist before the 24h window, the latest trade prior to window start is the open price
        const priorTrades = pairTrades.filter(t => t.createdAt < window24hStart);
        const openPriceBig = priorTrades.length > 0
          ? BigInt(priorTrades[priorTrades.length - 1].price)
          : BigInt(trades24h[0].price);

        if (openPriceBig > 0n) {
          const diff = lastPriceBig - openPriceBig;
          // Basis points precision calculation (diff * 10000 / openPrice)
          const basisPoints = (diff * 10000n) / openPriceBig;
          const pctNum = Number(basisPoints) / 100;
          pair.priceChange24h = `${pctNum >= 0 ? '+' : ''}${pctNum.toFixed(2)}`;
          pair.priceChangePercent24h = pctNum.toFixed(2);
        } else {
          pair.priceChange24h = '+0.00';
          pair.priceChangePercent24h = '0.00';
        }
      }

      this.tradingPairs.set(pair.id, pair);
      updatedPairs.push(pair);
    }

    return pairId ? (updatedPairs[0] || pairsToUpdate[0]) : updatedPairs;
  }

  public cleanExpiredSessions() {
    const now = Date.now();
    let cleaned = 0;
    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(token);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.scheduleSave();
    }
  }

  public ensureTradingPairs() {
    const defaultPairs = [
      { id: 'BTC-IDR', base: 'BTC', quote: 'IDR', baseDec: 8, quoteDec: 2, min: '1000', max: '1000000000', price: '145000000000' }, // 0.00001 BTC min, 10 BTC max
      { id: 'ETH-IDR', base: 'ETH', quote: 'IDR', baseDec: 8, quoteDec: 2, min: '100000', max: '5000000000', price: '4850000000' }, // 0.001 ETH min, 50 ETH max
      { id: 'USDT-IDR', base: 'USDT', quote: 'IDR', baseDec: 6, quoteDec: 2, min: '1000000', max: '100000000000', price: '1645000' }, // 1 USDT min, 100,000 USDT max
      { id: 'BTC-USDT', base: 'BTC', quote: 'USDT', baseDec: 8, quoteDec: 6, min: '1000', max: '1000000000', price: '68500000000' }, // 0.00001 BTC min, 10 BTC max, 68,500 USDT
      { id: 'DOGE-IDR', base: 'DOGE', quote: 'IDR', baseDec: 8, quoteDec: 2, min: '100000000', max: '1000000000000000', price: '250000' } // 1 DOGE min, 10,000,000 DOGE max
    ];

    for (const dp of defaultPairs) {
      const existing = this.tradingPairs.get(dp.id);
      if (!existing) {
        this.tradingPairs.set(dp.id, {
          id: dp.id,
          baseCurrency: dp.base,
          quoteCurrency: dp.quote,
          baseDecimals: dp.baseDec,
          quoteDecimals: dp.quoteDec,
          minOrderSize: dp.min,
          maxOrderSize: dp.max,
          makerFeeBps: 10,
          takerFeeBps: 20,
          isActive: true,
          isHalted: false,
          lastPrice: dp.price,
          high24h: dp.price,
          low24h: dp.price,
          volume24h: '0',
          priceChange24h: '0.00'
        });
      } else {
        // Heal outdated or overly restrictive maxOrderSize caps (such as 50 DOGE)
        if (dp.id === 'DOGE-IDR') {
          if (BigInt(existing.maxOrderSize) < 100000000000000n) {
            existing.maxOrderSize = '1000000000000000'; // 10,000,000 DOGE
          }
          if (BigInt(existing.minOrderSize) > 10000000000n) {
            existing.minOrderSize = '100000000'; // 1 DOGE
          }
        }
      }
    }

    // Inspect all pairs to avoid integer overflow / restrictive limits on tokens with high decimals
    for (const [pairId, pair] of this.tradingPairs.entries()) {
      const dec = pair.baseDecimals || 8;
      const oneToken = 10n ** BigInt(dec);
      // If maxOrderSize is less than 50 tokens on non-BTC/ETH, increase to at least 1,000,000 tokens
      if (pair.baseCurrency !== 'BTC' && pair.baseCurrency !== 'ETH') {
        const currentCapTokens = BigInt(pair.maxOrderSize) / (oneToken > 0n ? oneToken : 1n);
        if (currentCapTokens < 1000n) {
          pair.maxOrderSize = (10000000n * oneToken).toString(); // 10,000,000 tokens
        }
      }
    }
  }

  public ensureRequiredAccounts() {
    // Definisi 8 Akun Resmi untuk Pengujian Lengkap
    const requiredTestAccounts = [
      {
        id: 'usr-admin-0000-0000-000000000001',
        email: 'admin@dimonex.id',
        password: 'AdminDimonex2026!',
        role: 'ADMIN' as const,
        fullName: 'Super Admin DIMONEX',
        nik: '3171012345670001',
        birthDate: '1988-08-17',
        balances: { IDR: '5000000000000', BTC: '10000000000', ETH: '10000000000', USDT: '500000000000', DOGE: '1000000000000' }
      },
      {
        id: 'usr-admin-0000-0000-000000000002',
        email: 'compliance@dimonex.id',
        password: 'ComplianceDimonex2026!',
        role: 'ADMIN' as const,
        fullName: 'Compliance & Risk Officer DIMONEX',
        nik: '3171012345670002',
        birthDate: '1989-11-20',
        balances: { IDR: '500000000000', BTC: '1000000000', ETH: '1000000000', USDT: '50000000000' }
      },
      {
        id: 'usr-mm-0000-0000-000000000001',
        email: 'mm@dimonex.id',
        password: 'MarketMaker2026!',
        role: 'MM' as const,
        fullName: 'Market Maker Operator DIMONEX',
        nik: '3172011102900002',
        birthDate: '1990-02-11',
        balances: { IDR: '5000000000000', BTC: '5000000000', ETH: '10000000000', USDT: '500000000000', DOGE: '1000000000000' }
      },
      {
        id: 'usr-budi-0000-0000-000000000002',
        email: 'budi@dimonex.id',
        password: 'TraderDimonex123!',
        role: 'USER' as const,
        fullName: 'Budi Santoso',
        nik: '3273012908850003',
        birthDate: '1985-08-29',
        balances: { IDR: '1000000000000', BTC: '1000000000', ETH: '1000000000', USDT: '25000000000', DOGE: '100000000000' }
      },
      {
        id: 'usr-siti-0000-0000-000000000003',
        email: 'siti@dimonex.id',
        password: 'TraderDimonex123!',
        role: 'USER' as const,
        fullName: 'Siti Rahmawati',
        nik: '3175026112920005',
        birthDate: '1992-12-21',
        balances: { IDR: '500000000000', BTC: '2000000000', ETH: '500000000', USDT: '10000000000' }
      },
      {
        id: 'usr-user1-0000-0000-000000000001',
        email: 'user1@dimonex.id',
        password: 'User1Dimonex2026!',
        role: 'USER' as const,
        fullName: 'User Satu Trading',
        nik: '3273012908850001',
        birthDate: '1991-03-15',
        balances: { IDR: '1000000000000', BTC: '1000000000', ETH: '1000000000', USDT: '25000000000' }
      },
      {
        id: 'usr-user2-0000-0000-000000000002',
        email: 'user2@dimonex.id',
        password: 'User2Dimonex2026!',
        role: 'USER' as const,
        fullName: 'User Dua Trading',
        nik: '3175026112920002',
        birthDate: '1993-07-20',
        balances: { IDR: '500000000000', BTC: '2000000000', ETH: '500000000', USDT: '10000000000' }
      },
      {
        id: 'f77fb7e4-219f-4c26-8898-0653acd37d66',
        email: 'test@dimonex.id',
        password: 'TestDimonex2026!',
        role: 'USER' as const,
        fullName: 'Akun Pengujian Baru',
        nik: '3171019999990001',
        birthDate: '1995-05-05',
        balances: { IDR: '10000000000', BTC: '100000000', ETH: '200000000', USDT: '5000000000' }
      }
    ];

    for (const acc of requiredTestAccounts) {
      let user = Array.from(this.users.values()).find(u => u.email.toLowerCase() === acc.email.toLowerCase());
      const salt = user?.passwordSalt || this.generateSalt();
      const hash = this.hashPassword(acc.password, salt);

      if (!user) {
        user = {
          id: acc.id,
          email: acc.email,
          passwordSalt: salt,
          passwordHash: hash,
          role: acc.role,
          status: 'active',
          isTotpEnabled: false,
          failedLoginAttempts: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.users.set(user.id, user);
      } else {
        user.role = acc.role;
        user.status = 'active';
        user.passwordSalt = salt;
        user.passwordHash = hash;
        user.failedLoginAttempts = 0;
        user.lockedUntil = undefined;
        user.updatedAt = Date.now();
      }

      // KYC
      if (!this.kyc.has(user.id)) {
        this.kyc.set(user.id, {
          id: crypto.randomUUID(),
          userId: user.id,
          fullName: acc.fullName,
          nik: acc.nik,
          birthDate: acc.birthDate,
          status: 'approved',
          tierLevel: 2,
          createdAt: Date.now(),
          reviewedAt: Date.now()
        });
      }

      // Balances
      for (const [curr, minBal] of Object.entries(acc.balances)) {
        const ledgerAcc = this.createOrGetAccount(user.id, curr);
        if (BigInt(ledgerAcc.balanceAvailable) < BigInt(minBal)) {
          ledgerAcc.balanceAvailable = minBal;
        }
      }
    }
  }

  public ensureHistoricalTrades() {
    const hasHist = this.trades.some(t => t.id.startsWith('hist-seed-'));
    if (hasHist && this.trades.length >= 25) return;

    const testUsers = [
      'usr-budi-0000-0000-000000000002',
      'usr-siti-0000-0000-000000000003',
      'usr-user1-0000-0000-000000000001',
      'usr-user2-0000-0000-000000000002',
      'usr-admin-0000-0000-000000000001',
      'usr-mm-0000-0000-000000000001',
      'f77fb7e4-219f-4c26-8898-0653acd37d66'
    ];

    const pairs = [
      { id: 'BTC-IDR', baseDec: 8, quoteDec: 2, basePrice: 145000000000n, qtyBase: 15000000n }, // 0.15 BTC
      { id: 'ETH-IDR', baseDec: 8, quoteDec: 2, basePrice: 4850000000n, qtyBase: 120000000n },   // 1.20 ETH
      { id: 'USDT-IDR', baseDec: 6, quoteDec: 2, basePrice: 1645000n, qtyBase: 350000000n },     // 350 USDT
      { id: 'SOL-IDR', baseDec: 8, quoteDec: 2, basePrice: 285000000n, qtyBase: 500000000n }      // 5.0 SOL
    ];

    const now = Date.now();
    const newTrades: Trade[] = [];

    // Seed historical trades for the last 28 days
    for (let dayOffset = 28; dayOffset >= 0; dayOffset--) {
      const dayBase = now - dayOffset * 86400000;
      // Skip a couple of days to look like authentic organic market trading
      if (dayOffset === 21 || dayOffset === 14 || dayOffset === 7) continue;

      const numTrades = 2 + (dayOffset % 3); // 2 to 4 trades per day
      // 75% winning days, 25% retracements
      const isProfitableDay = (dayOffset % 4) !== 2;

      for (let tIdx = 0; tIdx < numTrades; tIdx++) {
        const p = pairs[(dayOffset + tIdx) % pairs.length];
        const tradeTime = dayBase + (tIdx * 7200000) + 14400000; // spread during active hours
        
        // Price variation
        const variationBps = isProfitableDay 
          ? BigInt(15 + ((dayOffset * 7 + tIdx * 13) % 45)) // +0.15% to +0.60%
          : -BigInt(15 + ((dayOffset * 5 + tIdx * 11) % 35)); // -0.15% to -0.50%
        
        const execPrice = p.basePrice + (p.basePrice * variationBps) / 10000n;
        const qty = p.qtyBase + (BigInt((dayOffset * 3 + tIdx * 7) % 50) * p.qtyBase) / 100n;
        const quoteVol = PrecisionMath.calculateQuoteAmount(qty, p.baseDec, execPrice);
        const makerFee = PrecisionMath.calculateFee(quoteVol, 10);
        const takerFee = PrecisionMath.calculateFee(quoteVol, 20);

        const primaryUser = testUsers[(dayOffset + tIdx) % testUsers.length];
        const counterUser = testUsers[(dayOffset + tIdx + 1) % testUsers.length];

        const isBuy = tIdx % 2 === 0;

        newTrades.push({
          id: `hist-seed-${dayOffset}-${tIdx}-${crypto.randomUUID().slice(0, 8)}`,
          pairId: p.id,
          makerOrderId: `hist-ord-m-${dayOffset}-${tIdx}`,
          takerOrderId: `hist-ord-t-${dayOffset}-${tIdx}`,
          makerUserId: isBuy ? counterUser : primaryUser,
          takerUserId: isBuy ? primaryUser : counterUser,
          price: execPrice.toString(),
          quantity: qty.toString(),
          quoteVolume: quoteVol.toString(),
          makerFee: makerFee.toString(),
          takerFee: takerFee.toString(),
          takerSide: isBuy ? 'BUY' : 'SELL',
          createdAt: tradeTime
        });
      }
    }

    this.trades.push(...newTrades);
    this.scheduleSave();
  }

  public saveToDisk(): boolean {
    if (this.isSaving) return false;
    this.isSaving = true;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const state: PersistedExchangeState = {
        version: 1,
        savedAt: Date.now(),
        users: Array.from(this.users.entries()),
        kyc: Array.from(this.kyc.entries()),
        ledgerAccounts: Array.from(this.ledgerAccounts.entries()),
        accountIndex: Array.from(this.accountIndex.entries()),
        journalTransactions: Array.from(this.journalTransactions.entries()),
        journalIdempotencyIndex: Array.from(this.journalIdempotencyIndex.entries()),
        ledgerEntries: this.ledgerEntries,
        tradingPairs: Array.from(this.tradingPairs.entries()),
        orders: Array.from(this.orders.entries()),
        trades: this.trades,
        fiatTransactions: Array.from(this.fiatTransactions.entries()),
        cryptoTransactions: Array.from(this.cryptoTransactions.entries()),
        apiKeys: Array.from(this.apiKeys.entries()),
        auditLogs: this.auditLogs,
        sessions: Array.from(this.sessions.entries()),
        botInstances: Array.from(this.botInstances.entries()),
        riskControls: this.riskControls,
        assets: Array.from(this.assets.entries()),
        listingRequests: Array.from(this.listingRequests.entries()),
        listingApprovals: Array.from(this.listingApprovals.entries()),
        markets: Array.from(this.markets.entries()),
        listingAuditEvents: this.listingAuditEvents,
        outboxEvents: Array.from(this.outboxEvents.entries()),
        idempotencyRecords: Array.from(this.idempotencyRecords.entries())
      };

      const tempFile = `${STATE_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tempFile, JSON.stringify(state), 'utf-8');
      fs.renameSync(tempFile, STATE_FILE);
      return true;
    } catch (err) {
      console.error('[DIMONEX Database] Gagal menyimpan snapshot ke disk:', err);
      return false;
    } finally {
      this.isSaving = false;
    }
  }

  public loadFromDisk(): boolean {
    try {
      if (!fs.existsSync(STATE_FILE)) {
        return false;
      }
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const data: PersistedExchangeState = JSON.parse(raw);
      if (!data || !Array.isArray(data.users) || !Array.isArray(data.ledgerAccounts)) {
        return false;
      }

      this.users = new Map(data.users);
      this.kyc = new Map(data.kyc || []);
      this.ledgerAccounts = new Map(data.ledgerAccounts);
      this.accountIndex = new Map(data.accountIndex || []);
      this.journalTransactions = new Map(data.journalTransactions || []);
      this.journalIdempotencyIndex = new Map(data.journalIdempotencyIndex || []);
      this.ledgerEntries = data.ledgerEntries || [];
      this.tradingPairs = new Map(data.tradingPairs || []);
      this.orders = new Map(data.orders || []);
      this.trades = data.trades || [];
      this.fiatTransactions = new Map(data.fiatTransactions || []);
      this.cryptoTransactions = new Map(data.cryptoTransactions || []);
      this.apiKeys = new Map(data.apiKeys || []);
      this.auditLogs = data.auditLogs || [];
      this.sessions = new Map(data.sessions || []);
      this.botInstances = new Map(data.botInstances || []);
      if (data.riskControls) {
        this.riskControls = { ...DEFAULT_RISK_CONTROLS, ...data.riskControls };
      }
      if (data.assets) this.assets = new Map(data.assets);
      if (data.listingRequests) this.listingRequests = new Map(data.listingRequests);
      if (data.listingApprovals) this.listingApprovals = new Map(data.listingApprovals);
      if (data.markets) this.markets = new Map(data.markets);
      if (data.listingAuditEvents) this.listingAuditEvents = data.listingAuditEvents;
      if (data.outboxEvents) this.outboxEvents = new Map(data.outboxEvents);
      if (data.idempotencyRecords) this.idempotencyRecords = new Map(data.idempotencyRecords);

      console.log(`[DIMONEX Database] Berhasil memuat snapshot disk: ${this.users.size} pengguna, ${this.orders.size} order, ${this.trades.length} transaksi, ${this.sessions.size} sesi login aktif.`);
      return true;
    } catch (err) {
      console.warn('[DIMONEX Database] Snapshot file ditemukan namun tidak valid, memakai seed:', err);
      return false;
    }
  }

  /**
   * Ensures default assets, secondary checker admin, and market records exist
   */
  public ensureInitialListingData() {
    // 1. Seed Second Admin for Maker-Checker Enforcement
    const checkerAdminId = 'usr-admin-0000-0000-000000000002';
    if (!this.users.has(checkerAdminId)) {
      const checkerSalt = this.generateSalt();
      const checkerUser: User = {
        id: checkerAdminId,
        email: 'compliance@dimonex.id',
        passwordSalt: checkerSalt,
        passwordHash: this.hashPassword('ComplianceAdmin2026!', checkerSalt),
        role: 'ADMIN',
        status: 'active',
        isTotpEnabled: false,
        failedLoginAttempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.users.set(checkerAdminId, checkerUser);
      this.kyc.set(checkerAdminId, {
        id: crypto.randomUUID(),
        userId: checkerAdminId,
        fullName: 'Compliance & Risk Officer DIMONEX',
        nik: '3171012345670002',
        birthDate: '1989-11-20',
        status: 'approved',
        tierLevel: 2,
        createdAt: Date.now(),
        reviewedAt: Date.now()
      });
    }

    // 2. Seed Default Assets
    const defaultAssets: Asset[] = [
      {
        id: 'ast-idr-0000-0000-000000000001',
        symbol: 'IDR',
        name: 'Indonesian Rupiah',
        assetType: 'NATIVE',
        decimals: 2,
        network: 'FIAT',
        status: 'ACTIVE',
        depositEnabled: true,
        withdrawalEnabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: 'ast-btc-0000-0000-000000000001',
        symbol: 'BTC',
        name: 'Bitcoin',
        assetType: 'NATIVE',
        decimals: 8,
        network: 'BITCOIN',
        status: 'ACTIVE',
        depositEnabled: true,
        withdrawalEnabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: 'ast-eth-0000-0000-000000000001',
        symbol: 'ETH',
        name: 'Ethereum',
        assetType: 'NATIVE',
        decimals: 8,
        network: 'ETHEREUM',
        status: 'ACTIVE',
        depositEnabled: true,
        withdrawalEnabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: 'ast-sol-0000-0000-000000000001',
        symbol: 'SOL',
        name: 'Solana',
        assetType: 'NATIVE',
        decimals: 8,
        network: 'SOLANA',
        status: 'ACTIVE',
        depositEnabled: true,
        withdrawalEnabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: 'ast-usdt-0000-0000-000000000001',
        symbol: 'USDT',
        name: 'Tether USD',
        assetType: 'TOKEN',
        decimals: 8,
        network: 'TRON',
        contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        status: 'ACTIVE',
        depositEnabled: true,
        withdrawalEnabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: 'ast-ton-0000-0000-000000000001',
        symbol: 'TON',
        name: 'The Open Network',
        assetType: 'TOKEN',
        decimals: 8,
        network: 'TON',
        status: 'ACTIVE',
        depositEnabled: true,
        withdrawalEnabled: true,
        depositOpenedAt: Date.now() - 3600000 * 4,
        withdrawalOpenedAt: Date.now() + 86400000,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: 'ast-doge-0000-0000-000000000001',
        symbol: 'DOGE',
        name: 'Dogecoin',
        assetType: 'NATIVE',
        decimals: 8,
        network: 'DOGECOIN',
        status: 'PENDING',
        depositEnabled: false,
        withdrawalEnabled: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];

    for (const a of defaultAssets) {
      if (!this.assets.has(a.id)) {
        this.assets.set(a.id, a);
      }
    }

    // 3. Ensure Markets Map matches Trading Pairs
    const idrAsset = defaultAssets[0];
    for (const pair of this.tradingPairs.values()) {
      if (!this.markets.has(pair.id)) {
        const baseAsset = defaultAssets.find(a => a.symbol === pair.baseCurrency);
        const quoteAsset = defaultAssets.find(a => a.symbol === pair.quoteCurrency) || idrAsset;
        if (baseAsset) {
          const mkt: Market = {
            id: pair.id,
            baseAssetId: baseAsset.id,
            quoteAssetId: quoteAsset.id,
            listingRequestId: `seed-listing-${pair.id.toLowerCase()}`,
            symbol: pair.id,
            status: pair.isHalted ? 'HALTED' : (pair.isActive ? 'ACTIVE' : 'PREPARING'),
            tickSize: pair.quoteCurrency === 'USDT' ? '10000' : '100', // 10000 = 0.01 USDT, 100 sen = 1 IDR
            lotSize: pair.minOrderSize,
            minQuantity: pair.minOrderSize,
            minNotional: '1000000', // Rp 10,000.00
            makerFeeBps: pair.makerFeeBps,
            takerFeeBps: pair.takerFeeBps,
            activatedAt: Date.now() - 86400000,
            version: 1,
            createdAt: Date.now() - 86400000,
            updatedAt: Date.now()
          };
          this.markets.set(pair.id, mkt);
        }
      }
    }

    // 4. Seed Representative Initial Listing Requests for Crypto Exchange Workflow
    const solAsset = defaultAssets.find(a => a.symbol === 'SOL')!;
    const tonAsset = defaultAssets.find(a => a.symbol === 'TON')!;
    const dogeAsset = defaultAssets.find(a => a.symbol === 'DOGE')!;
    const makerAdminId = 'usr-admin-0000-0000-000000000001';
    const checkerAdminIdVal = 'usr-admin-0000-0000-000000000002';

    // SOL/IDR: ACTIVE Initial Listing (Live on Spot Exchange)
    const solListingId = 'req-listing-sol-0000-0000-00000001';
    if (!this.listingRequests.has(solListingId)) {
      this.listingRequests.set(solListingId, {
        id: solListingId,
        assetId: solAsset.id,
        quoteAssetId: idrAsset.id,
        status: 'ACTIVE',
        tickSize: '100',
        lotSize: '1000000',
        minQuantity: '1000000',
        minNotional: '1000000',
        makerFeeBps: 10,
        takerFeeBps: 20,
        depositEnabled: true,
        withdrawalEnabled: true,
        depositOpenedAt: Date.now() - 86400000 * 2,
        withdrawalOpenedAt: Date.now() - 86400000,
        marketMakerAccountId: 'usr-mm-0000-0000-000000000001',
        projectOwnerAccountId: 'usr-user1-0000-0000-000000000001',
        initialLiquidityBase: '500000000000', // 5,000 SOL
        initialLiquidityQuoteIdr: '1425000000000', // Rp 14.25 Miliar
        createdBy: makerAdminId,
        version: 1,
        createdAt: Date.now() - 86400000 * 3,
        updatedAt: Date.now() - 86400000
      });
      this.listingApprovals.set(solListingId, {
        id: crypto.randomUUID(),
        listingRequestId: solListingId,
        reviewerId: checkerAdminIdVal,
        decision: 'APPROVED',
        reason: 'Pemeriksaan audit smart contract, likuiditas awal SOL/IDR, dan izin Bappebti disetujui.',
        configVersion: 1,
        reviewedAt: Date.now() - 86400000 * 2
      });
    }

    // TON/IDR: SCHEDULED Initial Listing (Upcoming Launchpad with Deposit Open)
    const tonListingId = 'req-listing-ton-0000-0000-00000001';
    if (!this.listingRequests.has(tonListingId)) {
      this.listingRequests.set(tonListingId, {
        id: tonListingId,
        assetId: tonAsset.id,
        quoteAssetId: idrAsset.id,
        status: 'SCHEDULED',
        scheduledAt: Date.now() + 86400000 * 2, // Launches in 48 hours
        tickSize: '100',
        lotSize: '1000000',
        minQuantity: '1000000',
        minNotional: '1000000',
        makerFeeBps: 10,
        takerFeeBps: 20,
        depositEnabled: true,
        withdrawalEnabled: true,
        depositOpenedAt: Date.now() - 3600000 * 6, // Deposit opened 6h ago
        withdrawalOpenedAt: Date.now() + 86400000 * 2,
        marketMakerAccountId: 'usr-mm-0000-0000-000000000001',
        projectOwnerAccountId: 'usr-user1-0000-0000-000000000001',
        initialLiquidityBase: '250000000000',
        initialLiquidityQuoteIdr: '850000000000',
        createdBy: makerAdminId,
        version: 1,
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 3600000 * 2
      });
      this.listingApprovals.set(tonListingId, {
        id: crypto.randomUUID(),
        listingRequestId: tonListingId,
        reviewerId: checkerAdminIdVal,
        decision: 'APPROVED',
        reason: 'Verifikasi legalitas TON blockchain dan komitmen MM disetujui. Siap listing.',
        configVersion: 1,
        reviewedAt: Date.now() - 3600000 * 3
      });
    }

    // DOGE/IDR: PENDING_REVIEW Initial Listing
    const dogeListingId = 'req-listing-doge-0000-0000-0000001';
    if (!this.listingRequests.has(dogeListingId)) {
      this.listingRequests.set(dogeListingId, {
        id: dogeListingId,
        assetId: dogeAsset.id,
        quoteAssetId: idrAsset.id,
        status: 'PENDING_REVIEW',
        tickSize: '10',
        lotSize: '100000000',
        minQuantity: '100000000',
        minNotional: '1000000',
        makerFeeBps: 10,
        takerFeeBps: 20,
        depositEnabled: false,
        withdrawalEnabled: false,
        marketMakerAccountId: 'usr-mm-0000-0000-000000000001',
        createdBy: `portal:contact@dogecoin.org`,
        version: 1,
        createdAt: Date.now() - 3600000 * 5,
        updatedAt: Date.now() - 3600000 * 5
      });
    }
  }
}

export const db = new DatabaseStore();
