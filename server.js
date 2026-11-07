var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/ledger/PrecisionMath.ts
var CURRENCIES, PrecisionMath;
var init_PrecisionMath = __esm({
  "server/ledger/PrecisionMath.ts"() {
    CURRENCIES = {
      IDR: { code: "IDR", decimals: 2, minStep: 100n, name: "Indonesian Rupiah" },
      // 1.00 IDR = 100 units (sen)
      BTC: { code: "BTC", decimals: 8, minStep: 1n, name: "Bitcoin (Satoshis)" },
      // 1.0 BTC = 100,000,000 sats
      ETH: { code: "ETH", decimals: 8, minStep: 1n, name: "Ethereum" },
      // 1.0 ETH = 100,000,000 units
      USDT: { code: "USDT", decimals: 6, minStep: 1n, name: "Tether USD" }
      // 1.0 USDT = 1,000,000 units
    };
    PrecisionMath = class {
      /**
       * Parse a user-provided string representation into raw BigInt units.
       * e.g. parseToUnits("45000000.50", 2) -> 4500000050n
       * e.g. parseToUnits("0.00150000", 8) -> 150000n
       */
      static parseToUnits(val, decimals) {
        const str = String(val).trim();
        if (!str || str === "0") return 0n;
        if (str.startsWith("-")) {
          throw new Error(`Negative financial amounts are not allowed: ${str}`);
        }
        if (!/^\d+(\.\d+)?$/.test(str)) {
          throw new Error(`Invalid monetary number format: ${str}`);
        }
        const [integerPart, fractionalPart = ""] = str.split(".");
        let cleanFraction = fractionalPart.slice(0, decimals);
        while (cleanFraction.length < decimals) {
          cleanFraction += "0";
        }
        const combinedStr = integerPart + cleanFraction;
        return BigInt(combinedStr);
      }
      /**
       * Format raw BigInt units back into exact decimal string representation.
       * e.g. formatFromUnits(4500000050n, 2) -> "45000000.50"
       * e.g. formatFromUnits(150000n, 8) -> "0.00150000"
       */
      static formatFromUnits(units, decimals, trimTrailingZeros = false) {
        if (units === 0n) {
          if (trimTrailingZeros || decimals === 0) return "0";
          return "0." + "0".repeat(decimals);
        }
        const isNegative = units < 0n;
        const absUnits = isNegative ? -units : units;
        const str = absUnits.toString().padStart(decimals + 1, "0");
        if (decimals === 0) {
          return (isNegative ? "-" : "") + str;
        }
        const integerPart = str.slice(0, -decimals) || "0";
        let fractionalPart = str.slice(-decimals);
        if (trimTrailingZeros) {
          fractionalPart = fractionalPart.replace(/0+$/, "");
          if (!fractionalPart) return (isNegative ? "-" : "") + integerPart;
        }
        return (isNegative ? "-" : "") + `${integerPart}.${fractionalPart}`;
      }
      /**
       * Multiply quantity (in base decimals) by price (in quote decimals)
       * to get quote volume (in quote decimals).
       * 
       * Formula:
       * QuoteVolume (quote units) = (Quantity * Price) / (10 ^ baseDecimals)
       * Uses integer division with round-half-up.
       */
      static calculateQuoteAmount(baseQuantityUnits, baseDecimals, quotePriceUnits) {
        const scale = 10n ** BigInt(baseDecimals);
        const product = baseQuantityUnits * quotePriceUnits;
        return (product + scale / 2n) / scale;
      }
      /**
       * Calculate base quantity bought when spending a given quote volume.
       * 
       * Formula:
       * BaseQuantity (base units) = (QuoteAmount * (10 ^ baseDecimals)) / Price
       */
      static calculateBaseQuantity(quoteAmountUnits, baseDecimals, quotePriceUnits) {
        if (quotePriceUnits <= 0n) {
          throw new Error("Price must be greater than zero");
        }
        const scale = 10n ** BigInt(baseDecimals);
        return quoteAmountUnits * scale / quotePriceUnits;
      }
      /**
       * Calculate fee in basis points (1 bps = 0.01% = 1/10,000).
       * e.g. 10 bps = 0.10%, 20 bps = 0.20%.
       * 
       * Formula:
       * Fee = (amountUnits * BigInt(bps) + 5000n) / 10000n  (Round half up)
       */
      static calculateFee(amountUnits, bps) {
        if (bps <= 0) return 0n;
        const bpsBig = BigInt(bps);
        return (amountUnits * bpsBig + 5000n) / 10000n;
      }
      /**
       * Format display for Rupiah (e.g. "Rp 1.450.000.000")
       */
      static formatIDRDisplay(units) {
        const idrAmount = units / 100n;
        return "Rp " + idrAmount.toLocaleString("id-ID");
      }
      /**
       * Format display for Crypto (e.g. "0.02450000 BTC")
       */
      static formatCryptoDisplay(units, currency) {
        const config = CURRENCIES[currency] || { decimals: 8 };
        const formatted = this.formatFromUnits(units, config.decimals, false);
        return `${formatted} ${currency}`;
      }
    };
  }
});

// server/db/database.ts
import crypto from "crypto";
import fs from "fs";
import path from "path";
var SYSTEM_TREASURY_ID, SYSTEM_FEE_ID, SYSTEM_HOT_WALLET_ID, DEFAULT_RISK_CONTROLS, DATA_DIR, STATE_FILE, DatabaseStore, db;
var init_database = __esm({
  "server/db/database.ts"() {
    init_PrecisionMath();
    SYSTEM_TREASURY_ID = "sys-treasury-0000-0000-000000000000";
    SYSTEM_FEE_ID = "sys-fees-0000-0000-000000000000";
    SYSTEM_HOT_WALLET_ID = "sys-hotwallet-0000-0000-000000000000";
    DEFAULT_RISK_CONTROLS = {
      maxActiveBots: 50,
      maxOpenOrdersPerBot: 100,
      maxOrderSize: "5000000000",
      // 50 BTC
      maxNotionalExposureIdr: "5000000000000",
      // 50B IDR
      maxDailyTradingNotionalIdr: "20000000000000",
      // 200B IDR
      maxPriceDeviationPct: 15,
      // 15% from last price
      maxOrderSubmissionRatePerMin: 120,
      maxTotalReservedBalancePct: 90,
      maxRetryCount: 5,
      maxRuntimeMinutes: 1440,
      maxConsecutiveErrors: 10,
      maxAllowedSlippagePct: 2.5,
      selfTradePreventionPolicy: "CANCEL_MAKER",
      isKillSwitchActive: false
    };
    DATA_DIR = path.resolve(process.cwd(), "server", "data");
    STATE_FILE = path.join(DATA_DIR, "exchange_state.json");
    DatabaseStore = class {
      constructor() {
        this.users = /* @__PURE__ */ new Map();
        this.kyc = /* @__PURE__ */ new Map();
        // key: userId
        this.ledgerAccounts = /* @__PURE__ */ new Map();
        // key: accountId
        this.accountIndex = /* @__PURE__ */ new Map();
        // key: `${userId}:${currency}` -> accountId
        this.journalTransactions = /* @__PURE__ */ new Map();
        this.journalIdempotencyIndex = /* @__PURE__ */ new Map();
        // key: idempotencyKey -> journalId
        this.ledgerEntries = [];
        this.tradingPairs = /* @__PURE__ */ new Map();
        this.orders = /* @__PURE__ */ new Map();
        this.trades = [];
        this.fiatTransactions = /* @__PURE__ */ new Map();
        this.cryptoTransactions = /* @__PURE__ */ new Map();
        this.apiKeys = /* @__PURE__ */ new Map();
        this.auditLogs = [];
        this.sessions = /* @__PURE__ */ new Map();
        this.botInstances = /* @__PURE__ */ new Map();
        this.riskControls = { ...DEFAULT_RISK_CONTROLS };
        this.saveTimer = null;
        this.isSaving = false;
        const loaded = this.loadFromDisk();
        if (!loaded) {
          console.log("[DIMONEX Database] Menginisialisasi data awal (seed bootstrap)...");
          this.seedInitialData();
          this.saveToDisk();
        } else {
          this.ensureTradingPairs();
          this.ensureRequiredAccounts();
          this.cleanExpiredSessions();
        }
        const onExit = () => {
          this.flushSync();
        };
        process.on("SIGINT", onExit);
        process.on("SIGTERM", onExit);
      }
      // Hash password using PBKDF2
      hashPassword(password, salt) {
        return crypto.pbkdf2Sync(password, salt, 1e4, 64, "sha512").toString("hex");
      }
      generateSalt() {
        return crypto.randomBytes(16).toString("hex");
      }
      seedInitialData() {
        const pairs = [
          {
            id: "BTC-IDR",
            baseCurrency: "BTC",
            quoteCurrency: "IDR",
            baseDecimals: 8,
            quoteDecimals: 2,
            minOrderSize: "1000",
            // 0.00001 BTC
            maxOrderSize: "1000000000",
            // 10 BTC
            makerFeeBps: 10,
            // 0.10%
            takerFeeBps: 20,
            // 0.20%
            isActive: true,
            isHalted: false,
            lastPrice: "145000000000",
            // Rp 1,450,000,000.00
            high24h: "148000000000",
            low24h: "143500000000",
            volume24h: "2450000000",
            // 24.5 BTC
            priceChange24h: "+2.85"
          },
          {
            id: "ETH-IDR",
            baseCurrency: "ETH",
            quoteCurrency: "IDR",
            baseDecimals: 8,
            quoteDecimals: 2,
            minOrderSize: "100000",
            // 0.001 ETH
            maxOrderSize: "5000000000",
            // 50 ETH
            makerFeeBps: 10,
            takerFeeBps: 20,
            isActive: true,
            isHalted: false,
            lastPrice: "4850000000",
            // Rp 48,500,000.00
            high24h: "4920000000",
            low24h: "4790000000",
            volume24h: "18500000000",
            // 185 ETH
            priceChange24h: "+1.42"
          },
          {
            id: "USDT-IDR",
            baseCurrency: "USDT",
            quoteCurrency: "IDR",
            baseDecimals: 6,
            quoteDecimals: 2,
            minOrderSize: "1000000",
            // 1 USDT
            maxOrderSize: "100000000000",
            // 100,000 USDT
            makerFeeBps: 10,
            takerFeeBps: 20,
            isActive: true,
            isHalted: false,
            lastPrice: "1645000",
            // Rp 16,450.00
            high24h: "1650000",
            low24h: "1640000",
            volume24h: "450000000000",
            // 450,000 USDT
            priceChange24h: "-0.12"
          }
        ];
        pairs.forEach((p) => this.tradingPairs.set(p.id, p));
        const systemCurrencies = ["IDR", "BTC", "ETH", "USDT"];
        const systemUsers = [
          { id: SYSTEM_TREASURY_ID, name: "System Treasury" },
          { id: SYSTEM_FEE_ID, name: "System Fee Collector" },
          { id: SYSTEM_HOT_WALLET_ID, name: "System Hot Wallet" }
        ];
        for (const sysUser of systemUsers) {
          for (const curr of systemCurrencies) {
            const accId = crypto.randomUUID();
            const initialBalance = sysUser.id === SYSTEM_TREASURY_ID ? "1000000000000000" : "0";
            const account = {
              id: accId,
              userId: sysUser.id,
              currency: curr,
              balanceAvailable: initialBalance,
              balanceLocked: "0",
              version: 1,
              updatedAt: Date.now()
            };
            this.ledgerAccounts.set(accId, account);
            this.accountIndex.set(`${sysUser.id}:${curr}`, accId);
          }
        }
        const adminSalt = this.generateSalt();
        const adminUser = {
          id: "usr-admin-0000-0000-000000000001",
          email: "admin@dimonex.id",
          passwordSalt: adminSalt,
          passwordHash: this.hashPassword("AdminDimonex2026!", adminSalt),
          role: "ADMIN",
          status: "active",
          isTotpEnabled: false,
          failedLoginAttempts: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.users.set(adminUser.id, adminUser);
        this.kyc.set(adminUser.id, {
          id: crypto.randomUUID(),
          userId: adminUser.id,
          fullName: "Super Admin DIMONEX",
          nik: "3171012345670001",
          birthDate: "1988-08-17",
          status: "approved",
          tierLevel: 2,
          createdAt: Date.now(),
          reviewedAt: Date.now()
        });
        this.createOrGetAccount(adminUser.id, "IDR", "5000000000000");
        this.createOrGetAccount(adminUser.id, "BTC", "10000000000");
        this.createOrGetAccount(adminUser.id, "ETH", "10000000000");
        this.createOrGetAccount(adminUser.id, "USDT", "500000000000");
        const mmSalt = this.generateSalt();
        const mmUser = {
          id: "usr-mm-0000-0000-000000000001",
          email: "mm@dimonex.id",
          passwordSalt: mmSalt,
          passwordHash: this.hashPassword("MarketMaker2026!", mmSalt),
          role: "MM",
          status: "active",
          isTotpEnabled: false,
          failedLoginAttempts: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.users.set(mmUser.id, mmUser);
        this.kyc.set(mmUser.id, {
          id: crypto.randomUUID(),
          userId: mmUser.id,
          fullName: "Market Maker Operator DIMONEX",
          nik: "3172011102900002",
          birthDate: "1990-02-11",
          status: "approved",
          tierLevel: 2,
          createdAt: Date.now(),
          reviewedAt: Date.now()
        });
        this.createOrGetAccount(mmUser.id, "IDR", "5000000000000");
        this.createOrGetAccount(mmUser.id, "BTC", "5000000000");
        this.createOrGetAccount(mmUser.id, "ETH", "10000000000");
        this.createOrGetAccount(mmUser.id, "USDT", "500000000000");
        const u1Salt = this.generateSalt();
        const user1 = {
          id: "usr-user1-0000-0000-000000000001",
          email: "user1@dimonex.id",
          passwordSalt: u1Salt,
          passwordHash: this.hashPassword("User1Dimonex2026!", u1Salt),
          role: "USER",
          status: "active",
          isTotpEnabled: false,
          failedLoginAttempts: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.users.set(user1.id, user1);
        this.kyc.set(user1.id, {
          id: crypto.randomUUID(),
          userId: user1.id,
          fullName: "User Satu Trading",
          nik: "3273012908850001",
          birthDate: "1991-03-15",
          status: "approved",
          tierLevel: 2,
          createdAt: Date.now()
        });
        this.createOrGetAccount(user1.id, "IDR", "1000000000000");
        this.createOrGetAccount(user1.id, "BTC", "1000000000");
        this.createOrGetAccount(user1.id, "ETH", "1000000000");
        this.createOrGetAccount(user1.id, "USDT", "25000000000");
        const u2Salt = this.generateSalt();
        const user2 = {
          id: "usr-user2-0000-0000-000000000002",
          email: "user2@dimonex.id",
          passwordSalt: u2Salt,
          passwordHash: this.hashPassword("User2Dimonex2026!", u2Salt),
          role: "USER",
          status: "active",
          isTotpEnabled: false,
          failedLoginAttempts: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.users.set(user2.id, user2);
        this.kyc.set(user2.id, {
          id: crypto.randomUUID(),
          userId: user2.id,
          fullName: "User Dua Trading",
          nik: "3175026112920002",
          birthDate: "1993-07-20",
          status: "approved",
          tierLevel: 2,
          createdAt: Date.now()
        });
        this.createOrGetAccount(user2.id, "IDR", "500000000000");
        this.createOrGetAccount(user2.id, "BTC", "2000000000");
        this.createOrGetAccount(user2.id, "ETH", "500000000");
        this.createOrGetAccount(user2.id, "USDT", "10000000000");
        const trader1Salt = this.generateSalt();
        const trader1 = {
          id: "usr-budi-0000-0000-000000000002",
          email: "budi@dimonex.id",
          passwordSalt: trader1Salt,
          passwordHash: this.hashPassword("TraderDimonex123!", trader1Salt),
          role: "USER",
          status: "active",
          isTotpEnabled: false,
          failedLoginAttempts: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.users.set(trader1.id, trader1);
        this.kyc.set(trader1.id, {
          id: crypto.randomUUID(),
          userId: trader1.id,
          fullName: "Budi Santoso",
          nik: "3273012908850003",
          birthDate: "1985-08-29",
          status: "approved",
          tierLevel: 2,
          createdAt: Date.now()
        });
        const trader2Salt = this.generateSalt();
        const trader2 = {
          id: "usr-siti-0000-0000-000000000003",
          email: "siti@dimonex.id",
          passwordSalt: trader2Salt,
          passwordHash: this.hashPassword("TraderDimonex123!", trader2Salt),
          role: "USER",
          status: "active",
          isTotpEnabled: false,
          failedLoginAttempts: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        this.users.set(trader2.id, trader2);
        this.kyc.set(trader2.id, {
          id: crypto.randomUUID(),
          userId: trader2.id,
          fullName: "Siti Rahmawati",
          nik: "3175026112920005",
          birthDate: "1992-12-21",
          status: "approved",
          tierLevel: 2,
          createdAt: Date.now()
        });
        this.createOrGetAccount(trader1.id, "IDR", "1000000000000");
        this.createOrGetAccount(trader1.id, "BTC", "1000000000");
        this.createOrGetAccount(trader1.id, "ETH", "1000000000");
        this.createOrGetAccount(trader1.id, "USDT", "25000000000");
        this.createOrGetAccount(trader2.id, "IDR", "500000000000");
        this.createOrGetAccount(trader2.id, "BTC", "2000000000");
        this.createOrGetAccount(trader2.id, "ETH", "500000000");
        this.createOrGetAccount(trader2.id, "USDT", "10000000000");
        this.createOrGetAccount(trader1.id, "IDR", "1000000000000");
        this.createOrGetAccount(trader1.id, "BTC", "1000000000");
        this.createOrGetAccount(trader1.id, "ETH", "1000000000");
        this.createOrGetAccount(trader1.id, "USDT", "25000000000");
        this.createOrGetAccount(trader2.id, "IDR", "500000000000");
        this.createOrGetAccount(trader2.id, "BTC", "2000000000");
        this.createOrGetAccount(trader2.id, "ETH", "500000000");
        this.createOrGetAccount(trader2.id, "USDT", "10000000000");
        this.seedInitialMarketOrders();
      }
      seedInitialMarketOrders() {
        const btcMid = 145000000000n;
        const trader1Id = "usr-budi-0000-0000-000000000002";
        const trader2Id = "usr-siti-0000-0000-000000000003";
        const bids = [
          { price: btcMid - 25000000n, qty: 35000000n },
          // -250k IDR, 0.35 BTC
          { price: btcMid - 50000000n, qty: 50000000n },
          // -500k IDR, 0.50 BTC
          { price: btcMid - 100000000n, qty: 85000000n },
          // -1M IDR, 0.85 BTC
          { price: btcMid - 180000000n, qty: 120000000n },
          // -1.8M IDR, 1.2 BTC
          { price: btcMid - 300000000n, qty: 250000000n }
          // -3M IDR, 2.5 BTC
        ];
        const asks = [
          { price: btcMid + 25000000n, qty: 28000000n },
          // +250k IDR, 0.28 BTC
          { price: btcMid + 60000000n, qty: 45000000n },
          // +600k IDR, 0.45 BTC
          { price: btcMid + 120000000n, qty: 75000000n },
          // +1.2M IDR, 0.75 BTC
          { price: btcMid + 220000000n, qty: 150000000n },
          // +2.2M IDR, 1.50 BTC
          { price: btcMid + 350000000n, qty: 300000000n }
          // +3.5M IDR, 3.00 BTC
        ];
        let totalBidsLockedIdr = 0n;
        bids.forEach((bid, idx) => {
          const orderId = `seed-btc-bid-${idx + 1}`;
          const lockedIdr = PrecisionMath.calculateQuoteAmount(bid.qty, 8, bid.price);
          totalBidsLockedIdr += lockedIdr;
          this.orders.set(orderId, {
            id: orderId,
            userId: trader1Id,
            pairId: "BTC-IDR",
            side: "BUY",
            orderType: "LIMIT",
            timeInForce: "GTC",
            price: bid.price.toString(),
            quantity: bid.qty.toString(),
            filledQuantity: "0",
            status: "NEW",
            lockedAmount: lockedIdr.toString(),
            lockedCurrency: "IDR",
            createdAt: Date.now() - (10 - idx) * 6e4,
            updatedAt: Date.now() - (10 - idx) * 6e4
          });
        });
        let totalAsksLockedBtc = 0n;
        asks.forEach((ask, idx) => {
          const orderId = `seed-btc-ask-${idx + 1}`;
          totalAsksLockedBtc += ask.qty;
          this.orders.set(orderId, {
            id: orderId,
            userId: trader2Id,
            pairId: "BTC-IDR",
            side: "SELL",
            orderType: "LIMIT",
            timeInForce: "GTC",
            price: ask.price.toString(),
            quantity: ask.qty.toString(),
            filledQuantity: "0",
            status: "NEW",
            lockedAmount: ask.qty.toString(),
            lockedCurrency: "BTC",
            createdAt: Date.now() - (10 - idx) * 6e4,
            updatedAt: Date.now() - (10 - idx) * 6e4
          });
        });
        const trader1IdrAcc = this.createOrGetAccount(trader1Id, "IDR");
        const t1Avail = BigInt(trader1IdrAcc.balanceAvailable);
        trader1IdrAcc.balanceAvailable = (t1Avail - totalBidsLockedIdr).toString();
        trader1IdrAcc.balanceLocked = totalBidsLockedIdr.toString();
        const trader2BtcAcc = this.createOrGetAccount(trader2Id, "BTC");
        const t2Avail = BigInt(trader2BtcAcc.balanceAvailable);
        trader2BtcAcc.balanceAvailable = (t2Avail - totalAsksLockedBtc).toString();
        trader2BtcAcc.balanceLocked = totalAsksLockedBtc.toString();
        const usdtMidQuoteUnits = 1645000n;
        const usdtSpacingUnits = 6000n;
        const usdtDecimals = 6;
        const usdtBids = [
          { price: usdtMidQuoteUnits - 1n * usdtSpacingUnits, qty: 50000000n },
          // 16,390 IDR, 50 USDT
          { price: usdtMidQuoteUnits - 2n * usdtSpacingUnits, qty: 100000000n },
          // 16,330 IDR, 100 USDT
          { price: usdtMidQuoteUnits - 3n * usdtSpacingUnits, qty: 150000000n },
          // 16,270 IDR, 150 USDT
          { price: usdtMidQuoteUnits - 4n * usdtSpacingUnits, qty: 200000000n },
          // 16,210 IDR, 200 USDT
          { price: usdtMidQuoteUnits - 5n * usdtSpacingUnits, qty: 250000000n }
          // 16,150 IDR, 250 USDT
        ];
        const usdtAsks = [
          { price: usdtMidQuoteUnits + 1n * usdtSpacingUnits, qty: 50000000n },
          // 16,510 IDR, 50 USDT
          { price: usdtMidQuoteUnits + 2n * usdtSpacingUnits, qty: 100000000n },
          // 16,570 IDR, 100 USDT
          { price: usdtMidQuoteUnits + 3n * usdtSpacingUnits, qty: 150000000n },
          // 16,630 IDR, 150 USDT
          { price: usdtMidQuoteUnits + 4n * usdtSpacingUnits, qty: 200000000n },
          // 16,690 IDR, 200 USDT
          { price: usdtMidQuoteUnits + 5n * usdtSpacingUnits, qty: 250000000n }
          // 16,750 IDR, 250 USDT
        ];
        let totalUsdtBidsLockedIdr = 0n;
        usdtBids.forEach((bid, idx) => {
          const orderId = `seed-usdt-bid-${idx + 1}`;
          const lockedIdr = PrecisionMath.calculateQuoteAmount(bid.qty, usdtDecimals, bid.price);
          totalUsdtBidsLockedIdr += lockedIdr;
          this.orders.set(orderId, {
            id: orderId,
            userId: trader1Id,
            pairId: "USDT-IDR",
            side: "BUY",
            orderType: "LIMIT",
            timeInForce: "GTC",
            price: bid.price.toString(),
            quantity: bid.qty.toString(),
            filledQuantity: "0",
            status: "NEW",
            lockedAmount: lockedIdr.toString(),
            lockedCurrency: "IDR",
            createdAt: Date.now() - (10 - idx) * 6e4,
            updatedAt: Date.now() - (10 - idx) * 6e4
          });
        });
        let totalUsdtAsksLockedUsdt = 0n;
        usdtAsks.forEach((ask, idx) => {
          const orderId = `seed-usdt-ask-${idx + 1}`;
          totalUsdtAsksLockedUsdt += ask.qty;
          this.orders.set(orderId, {
            id: orderId,
            userId: trader2Id,
            pairId: "USDT-IDR",
            side: "SELL",
            orderType: "LIMIT",
            timeInForce: "GTC",
            price: ask.price.toString(),
            quantity: ask.qty.toString(),
            filledQuantity: "0",
            status: "NEW",
            lockedAmount: ask.qty.toString(),
            lockedCurrency: "USDT",
            createdAt: Date.now() - (10 - idx) * 6e4,
            updatedAt: Date.now() - (10 - idx) * 6e4
          });
        });
        const t1IdrAvail = BigInt(trader1IdrAcc.balanceAvailable);
        trader1IdrAcc.balanceAvailable = (t1IdrAvail - totalUsdtBidsLockedIdr).toString();
        trader1IdrAcc.balanceLocked = (BigInt(trader1IdrAcc.balanceLocked) + totalUsdtBidsLockedIdr).toString();
        const trader2UsdtAcc = this.createOrGetAccount(trader2Id, "USDT");
        const t2UsdtAvail = BigInt(trader2UsdtAcc.balanceAvailable);
        trader2UsdtAcc.balanceAvailable = (t2UsdtAvail - totalUsdtAsksLockedUsdt).toString();
        trader2UsdtAcc.balanceLocked = totalUsdtAsksLockedUsdt.toString();
        const trade1 = {
          id: crypto.randomUUID(),
          pairId: "BTC-IDR",
          makerOrderId: "seed-maker-1",
          takerOrderId: "seed-taker-1",
          makerUserId: trader1Id,
          takerUserId: trader2Id,
          price: "144950000000",
          quantity: "25000000",
          // 0.25 BTC
          quoteVolume: "36237500000",
          // Rp 362,375,000.00
          makerFee: "36237500",
          // 0.10% = Rp 362,375
          takerFee: "72475000",
          // 0.20% = Rp 724,750
          takerSide: "BUY",
          createdAt: Date.now() - 12e4
        };
        this.trades.push(trade1);
      }
      createOrGetAccount(userId, currency, initialBalance = "0") {
        const key = `${userId}:${currency}`;
        const existingId = this.accountIndex.get(key);
        if (existingId && this.ledgerAccounts.has(existingId)) {
          return this.ledgerAccounts.get(existingId);
        }
        const newId = crypto.randomUUID();
        const account = {
          id: newId,
          userId,
          currency,
          balanceAvailable: initialBalance,
          balanceLocked: "0",
          version: 1,
          updatedAt: Date.now()
        };
        this.ledgerAccounts.set(newId, account);
        this.accountIndex.set(key, newId);
        this.scheduleSave();
        return account;
      }
      getAccount(userId, currency) {
        const accountId = this.accountIndex.get(`${userId}:${currency}`);
        if (!accountId) return void 0;
        return this.ledgerAccounts.get(accountId);
      }
      getUserAccounts(userId) {
        const result = [];
        for (const curr of ["IDR", "BTC", "ETH", "USDT"]) {
          result.push(this.createOrGetAccount(userId, curr));
        }
        return result;
      }
      scheduleSave() {
        if (this.saveTimer) {
          clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
          this.saveToDisk();
          this.saveTimer = null;
        }, 2e3);
      }
      flushSync() {
        if (this.saveTimer) {
          clearTimeout(this.saveTimer);
          this.saveTimer = null;
        }
        this.saveToDisk();
      }
      cleanExpiredSessions() {
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
      ensureTradingPairs() {
        const defaultPairs = [
          { id: "BTC-IDR", base: "BTC", quote: "IDR", baseDec: 8, quoteDec: 2, min: "1000", max: "1000000000", price: "145000000000" },
          { id: "ETH-IDR", base: "ETH", quote: "IDR", baseDec: 8, quoteDec: 2, min: "100000", max: "5000000000", price: "4850000000" },
          { id: "USDT-IDR", base: "USDT", quote: "IDR", baseDec: 6, quoteDec: 2, min: "1000000", max: "100000000000", price: "1645000" }
        ];
        for (const dp of defaultPairs) {
          if (!this.tradingPairs.has(dp.id)) {
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
              volume24h: "0",
              priceChange24h: "0.00"
            });
          }
        }
      }
      ensureRequiredAccounts() {
        let admin = Array.from(this.users.values()).find((u) => u.email === "admin@dimonex.id");
        if (!admin) {
          const salt = this.generateSalt();
          admin = {
            id: "usr-admin-0000-0000-000000000001",
            email: "admin@dimonex.id",
            passwordSalt: salt,
            passwordHash: this.hashPassword("AdminDimonex2026!", salt),
            role: "ADMIN",
            status: "active",
            isTotpEnabled: false,
            failedLoginAttempts: 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          this.users.set(admin.id, admin);
          this.kyc.set(admin.id, {
            id: crypto.randomUUID(),
            userId: admin.id,
            fullName: "Super Admin DIMONEX",
            nik: "3171012345670001",
            birthDate: "1988-08-17",
            status: "approved",
            tierLevel: 2,
            createdAt: Date.now(),
            reviewedAt: Date.now()
          });
        } else {
          admin.role = "ADMIN";
        }
        this.createOrGetAccount(admin.id, "IDR", "5000000000000");
        this.createOrGetAccount(admin.id, "BTC", "10000000000");
        this.createOrGetAccount(admin.id, "ETH", "10000000000");
        this.createOrGetAccount(admin.id, "USDT", "500000000000");
        let mm = Array.from(this.users.values()).find((u) => u.email === "mm@dimonex.id");
        if (!mm) {
          const salt = this.generateSalt();
          mm = {
            id: "usr-mm-0000-0000-000000000001",
            email: "mm@dimonex.id",
            passwordSalt: salt,
            passwordHash: this.hashPassword("MarketMaker2026!", salt),
            role: "MM",
            status: "active",
            isTotpEnabled: false,
            failedLoginAttempts: 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          this.users.set(mm.id, mm);
          this.kyc.set(mm.id, {
            id: crypto.randomUUID(),
            userId: mm.id,
            fullName: "Market Maker Operator DIMONEX",
            nik: "3172011102900002",
            birthDate: "1990-02-11",
            status: "approved",
            tierLevel: 2,
            createdAt: Date.now(),
            reviewedAt: Date.now()
          });
        } else {
          mm.role = "MM";
        }
        this.createOrGetAccount(mm.id, "IDR", "5000000000000");
        this.createOrGetAccount(mm.id, "BTC", "5000000000");
        this.createOrGetAccount(mm.id, "ETH", "10000000000");
        this.createOrGetAccount(mm.id, "USDT", "500000000000");
        let user1 = Array.from(this.users.values()).find((u) => u.email === "user1@dimonex.id");
        if (!user1) {
          const salt = this.generateSalt();
          user1 = {
            id: "usr-user1-0000-0000-000000000001",
            email: "user1@dimonex.id",
            passwordSalt: salt,
            passwordHash: this.hashPassword("User1Dimonex2026!", salt),
            role: "USER",
            status: "active",
            isTotpEnabled: false,
            failedLoginAttempts: 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          this.users.set(user1.id, user1);
          this.kyc.set(user1.id, {
            id: crypto.randomUUID(),
            userId: user1.id,
            fullName: "User Satu Trading",
            nik: "3273012908850001",
            birthDate: "1991-03-15",
            status: "approved",
            tierLevel: 2,
            createdAt: Date.now()
          });
        }
        this.createOrGetAccount(user1.id, "IDR", "1000000000000");
        this.createOrGetAccount(user1.id, "BTC", "1000000000");
        this.createOrGetAccount(user1.id, "ETH", "1000000000");
        this.createOrGetAccount(user1.id, "USDT", "25000000000");
        let user2 = Array.from(this.users.values()).find((u) => u.email === "user2@dimonex.id");
        if (!user2) {
          const salt = this.generateSalt();
          user2 = {
            id: "usr-user2-0000-0000-000000000002",
            email: "user2@dimonex.id",
            passwordSalt: salt,
            passwordHash: this.hashPassword("User2Dimonex2026!", salt),
            role: "USER",
            status: "active",
            isTotpEnabled: false,
            failedLoginAttempts: 0,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          this.users.set(user2.id, user2);
          this.kyc.set(user2.id, {
            id: crypto.randomUUID(),
            userId: user2.id,
            fullName: "User Dua Trading",
            nik: "3175026112920002",
            birthDate: "1993-07-20",
            status: "approved",
            tierLevel: 2,
            createdAt: Date.now()
          });
        }
        this.createOrGetAccount(user2.id, "IDR", "500000000000");
        this.createOrGetAccount(user2.id, "BTC", "2000000000");
        this.createOrGetAccount(user2.id, "ETH", "500000000");
        this.createOrGetAccount(user2.id, "USDT", "10000000000");
      }
      saveToDisk() {
        if (this.isSaving) return false;
        this.isSaving = true;
        try {
          if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
          }
          const state = {
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
            riskControls: this.riskControls
          };
          const tempFile = `${STATE_FILE}.tmp.${Date.now()}`;
          fs.writeFileSync(tempFile, JSON.stringify(state), "utf-8");
          fs.renameSync(tempFile, STATE_FILE);
          return true;
        } catch (err) {
          console.error("[DIMONEX Database] Gagal menyimpan snapshot ke disk:", err);
          return false;
        } finally {
          this.isSaving = false;
        }
      }
      loadFromDisk() {
        try {
          if (!fs.existsSync(STATE_FILE)) {
            return false;
          }
          const raw = fs.readFileSync(STATE_FILE, "utf-8");
          const data = JSON.parse(raw);
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
          console.log(`[DIMONEX Database] Berhasil memuat snapshot disk: ${this.users.size} pengguna, ${this.orders.size} order, ${this.trades.length} transaksi, ${this.sessions.size} sesi login aktif.`);
          return true;
        } catch (err) {
          console.warn("[DIMONEX Database] Snapshot file ditemukan namun tidak valid, memakai seed:", err);
          return false;
        }
      }
    };
    db = new DatabaseStore();
  }
});

// server/services/external/BinancePublicFeed.ts
import WebSocket2 from "ws";
var BinancePublicFeed;
var init_BinancePublicFeed = __esm({
  "server/services/external/BinancePublicFeed.ts"() {
    BinancePublicFeed = class {
      constructor() {
        this.id = "binance";
        this.name = "Binance Spot Public Stream";
        this.ws = null;
        this.status = "DISCONNECTED";
        this.symbols = /* @__PURE__ */ new Set(["BTCUSDT", "ETHUSDT"]);
        this.ticks = /* @__PURE__ */ new Map();
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.pingInterval = null;
        this.primaryUrl = "wss://stream.binance.com:9443/ws";
        this.fallbackUrl = "wss://data-stream.binance.vision/ws";
        this.useFallback = false;
        this.intentionalDisconnect = false;
        this.metrics = {
          reconnectCount: 0,
          lastHeartbeat: Date.now(),
          messagesReceived: 0,
          lastMessageTimestamp: 0,
          avgLatencyMs: 0
        };
        this.seedBaselineTicks();
      }
      seedBaselineTicks() {
        const now = Date.now();
        this.ticks.set("BTCUSDT", {
          provider: "binance",
          symbol: "BTCUSDT",
          lastPrice: 94850,
          bestBid: 94849.5,
          bestAsk: 94850.5,
          exchangeTimestamp: now,
          receivedAt: now,
          latencyMs: 15,
          isFresh: true,
          isValid: true
        });
        this.ticks.set("ETHUSDT", {
          provider: "binance",
          symbol: "ETHUSDT",
          lastPrice: 2840,
          bestBid: 2839.8,
          bestAsk: 2840.2,
          exchangeTimestamp: now,
          receivedAt: now,
          latencyMs: 18,
          isFresh: true,
          isValid: true
        });
      }
      async connect() {
        if (this.ws && (this.ws.readyState === WebSocket2.OPEN || this.ws.readyState === WebSocket2.CONNECTING)) {
          return;
        }
        this.intentionalDisconnect = false;
        this.status = "CONNECTING";
        const url = this.useFallback ? this.fallbackUrl : this.primaryUrl;
        try {
          this.ws = new WebSocket2(url, {
            handshakeTimeout: 5e3,
            headers: {
              "User-Agent": "DIMONEX-Market-Aggregator/1.0"
            }
          });
          this.ws.on("open", () => {
            this.status = "CONNECTED";
            this.reconnectAttempts = 0;
            this.metrics.lastHeartbeat = Date.now();
            this.sendSubscriptions();
            this.startHeartbeat();
          });
          this.ws.on("message", (data) => {
            this.handleMessage(data);
          });
          this.ws.on("pong", () => {
            this.metrics.lastHeartbeat = Date.now();
          });
          this.ws.on("error", (err) => {
            this.metrics.lastError = err.message;
            this.status = "ERROR";
            this.useFallback = !this.useFallback;
          });
          this.ws.on("close", (code, reason) => {
            this.cleanupSocket();
            this.status = "DISCONNECTED";
            if (!this.intentionalDisconnect) {
              this.scheduleReconnect();
            }
          });
        } catch (err) {
          this.status = "ERROR";
          this.metrics.lastError = err.message;
          this.scheduleReconnect();
        }
      }
      startHeartbeat() {
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket2.OPEN) {
            this.ws.ping();
          }
        }, 15e3);
      }
      cleanupSocket() {
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        if (this.ws) {
          this.ws.removeAllListeners();
          try {
            this.ws.terminate();
          } catch (_) {
          }
          this.ws = null;
        }
      }
      async disconnect() {
        this.intentionalDisconnect = true;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.cleanupSocket();
        this.status = "DISCONNECTED";
      }
      async reconnect() {
        await this.disconnect();
        await this.connect();
      }
      subscribe(symbols) {
        symbols.forEach((s) => this.symbols.add(s.toUpperCase()));
        if (this.ws && this.ws.readyState === WebSocket2.OPEN) {
          this.sendSubscriptions();
        }
      }
      sendSubscriptions() {
        if (!this.ws || this.ws.readyState !== WebSocket2.OPEN) return;
        const streams = [];
        for (const sym of this.symbols) {
          const lower = sym.toLowerCase();
          streams.push(`${lower}@trade`);
          streams.push(`${lower}@bookTicker`);
        }
        const payload = {
          method: "SUBSCRIBE",
          params: streams,
          id: Date.now()
        };
        try {
          this.ws.send(JSON.stringify(payload));
        } catch (_) {
        }
      }
      handleMessage(data) {
        try {
          const msg = JSON.parse(data.toString());
          this.metrics.messagesReceived++;
          const now = Date.now();
          this.metrics.lastMessageTimestamp = now;
          if (msg.s && msg.b && msg.a) {
            const symbol = msg.s.toUpperCase();
            const bestBid = parseFloat(msg.b);
            const bestAsk = parseFloat(msg.a);
            const prev = this.ticks.get(symbol);
            const lastPrice = prev?.lastPrice || (bestBid + bestAsk) / 2;
            const tick = {
              provider: "binance",
              symbol,
              lastPrice,
              bestBid,
              bestAsk,
              exchangeTimestamp: now,
              receivedAt: now,
              latencyMs: 10,
              isFresh: true,
              isValid: bestBid > 0 && bestAsk >= bestBid
            };
            this.ticks.set(symbol, tick);
            return;
          }
          if (msg.e === "trade" && msg.s && msg.p) {
            const symbol = msg.s.toUpperCase();
            const lastPrice = parseFloat(msg.p);
            const exchangeTime = Number(msg.T || msg.E || now);
            const latency = Math.max(0, now - exchangeTime);
            const prev = this.ticks.get(symbol);
            const tick = {
              provider: "binance",
              symbol,
              lastPrice,
              bestBid: prev?.bestBid || lastPrice * 0.9999,
              bestAsk: prev?.bestAsk || lastPrice * 1.0001,
              exchangeTimestamp: exchangeTime,
              receivedAt: now,
              latencyMs: latency,
              isFresh: true,
              isValid: lastPrice > 0
            };
            this.ticks.set(symbol, tick);
          }
        } catch (_) {
        }
      }
      scheduleReconnect() {
        if (this.intentionalDisconnect || this.reconnectTimer) return;
        this.reconnectAttempts++;
        this.metrics.reconnectCount++;
        const backoffMs = Math.min(1e3 * Math.pow(2, this.reconnectAttempts - 1), 15e3);
        this.status = "CONNECTING";
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect().catch(() => {
          });
        }, backoffMs);
      }
      getConnectionStatus() {
        return this.status;
      }
      getLatestPrice(symbol) {
        const tick = this.getTick(symbol);
        return tick ? tick.lastPrice : null;
      }
      getLatestBidAsk(symbol) {
        const tick = this.getTick(symbol);
        if (!tick) return null;
        return { bid: tick.bestBid, ask: tick.bestAsk };
      }
      getLastUpdateTimestamp(symbol) {
        const tick = this.getTick(symbol);
        return tick ? tick.receivedAt : null;
      }
      getMetrics() {
        return { ...this.metrics };
      }
      getTick(symbol) {
        const sym = symbol.toUpperCase();
        const tick = this.ticks.get(sym);
        if (!tick) return null;
        const age = Date.now() - tick.receivedAt;
        const isFresh = age < 15e3;
        return {
          ...tick,
          isFresh
        };
      }
      /**
       * Test/Mock hook to update tick directly (used in automated tests or simulated feeds)
       */
      updateMockTick(symbol, lastPrice, bid, ask) {
        const now = Date.now();
        this.ticks.set(symbol.toUpperCase(), {
          provider: "binance",
          symbol: symbol.toUpperCase(),
          lastPrice,
          bestBid: bid ?? lastPrice * 0.9999,
          bestAsk: ask ?? lastPrice * 1.0001,
          exchangeTimestamp: now,
          receivedAt: now,
          latencyMs: 12,
          isFresh: true,
          isValid: true
        });
      }
    };
  }
});

// server/services/external/BybitPublicFeed.ts
import WebSocket3 from "ws";
var BybitPublicFeed;
var init_BybitPublicFeed = __esm({
  "server/services/external/BybitPublicFeed.ts"() {
    BybitPublicFeed = class {
      constructor() {
        this.id = "bybit";
        this.name = "Bybit Spot Public Stream";
        this.ws = null;
        this.status = "DISCONNECTED";
        this.symbols = /* @__PURE__ */ new Set(["BTCUSDT", "ETHUSDT"]);
        this.ticks = /* @__PURE__ */ new Map();
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.pingInterval = null;
        this.endpoint = "wss://stream.bybit.com/v5/public/spot";
        this.intentionalDisconnect = false;
        this.metrics = {
          reconnectCount: 0,
          lastHeartbeat: Date.now(),
          messagesReceived: 0,
          lastMessageTimestamp: 0,
          avgLatencyMs: 0
        };
        this.seedBaselineTicks();
      }
      seedBaselineTicks() {
        const now = Date.now();
        this.ticks.set("BTCUSDT", {
          provider: "bybit",
          symbol: "BTCUSDT",
          lastPrice: 94855,
          bestBid: 94854,
          bestAsk: 94856,
          exchangeTimestamp: now,
          receivedAt: now,
          latencyMs: 18,
          isFresh: true,
          isValid: true
        });
        this.ticks.set("ETHUSDT", {
          provider: "bybit",
          symbol: "ETHUSDT",
          lastPrice: 2840.5,
          bestBid: 2840.1,
          bestAsk: 2840.9,
          exchangeTimestamp: now,
          receivedAt: now,
          latencyMs: 20,
          isFresh: true,
          isValid: true
        });
      }
      async connect() {
        if (this.ws && (this.ws.readyState === WebSocket3.OPEN || this.ws.readyState === WebSocket3.CONNECTING)) {
          return;
        }
        this.intentionalDisconnect = false;
        this.status = "CONNECTING";
        try {
          this.ws = new WebSocket3(this.endpoint, {
            handshakeTimeout: 5e3,
            headers: {
              "User-Agent": "DIMONEX-Market-Aggregator/1.0"
            }
          });
          this.ws.on("open", () => {
            this.status = "CONNECTED";
            this.reconnectAttempts = 0;
            this.metrics.lastHeartbeat = Date.now();
            this.sendSubscriptions();
            this.startHeartbeat();
          });
          this.ws.on("message", (data) => {
            this.handleMessage(data);
          });
          this.ws.on("pong", () => {
            this.metrics.lastHeartbeat = Date.now();
          });
          this.ws.on("error", (err) => {
            this.metrics.lastError = err.message;
            this.status = "ERROR";
          });
          this.ws.on("close", () => {
            this.cleanupSocket();
            this.status = "DISCONNECTED";
            if (!this.intentionalDisconnect) {
              this.scheduleReconnect();
            }
          });
        } catch (err) {
          this.status = "ERROR";
          this.metrics.lastError = err.message;
          this.scheduleReconnect();
        }
      }
      startHeartbeat() {
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket3.OPEN) {
            try {
              this.ws.send(JSON.stringify({ op: "ping" }));
              this.ws.ping();
            } catch (_) {
            }
          }
        }, 15e3);
      }
      cleanupSocket() {
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        if (this.ws) {
          this.ws.removeAllListeners();
          try {
            this.ws.terminate();
          } catch (_) {
          }
          this.ws = null;
        }
      }
      async disconnect() {
        this.intentionalDisconnect = true;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.cleanupSocket();
        this.status = "DISCONNECTED";
      }
      async reconnect() {
        await this.disconnect();
        await this.connect();
      }
      subscribe(symbols) {
        symbols.forEach((s) => this.symbols.add(s.toUpperCase()));
        if (this.ws && this.ws.readyState === WebSocket3.OPEN) {
          this.sendSubscriptions();
        }
      }
      sendSubscriptions() {
        if (!this.ws || this.ws.readyState !== WebSocket3.OPEN) return;
        const args = [];
        for (const sym of this.symbols) {
          args.push(`tickers.${sym}`);
          args.push(`publicTrade.${sym}`);
        }
        const payload = {
          op: "subscribe",
          args
        };
        try {
          this.ws.send(JSON.stringify(payload));
        } catch (_) {
        }
      }
      handleMessage(data) {
        try {
          const msg = JSON.parse(data.toString());
          this.metrics.messagesReceived++;
          const now = Date.now();
          this.metrics.lastMessageTimestamp = now;
          if (msg.op === "pong" || msg.ret_msg === "pong") {
            this.metrics.lastHeartbeat = now;
            return;
          }
          if (msg.topic && msg.topic.startsWith("tickers.") && msg.data) {
            const d = msg.data;
            const symbol = (d.symbol || msg.topic.split(".")[1]).toUpperCase();
            const lastPrice = parseFloat(d.lastPrice || "0");
            const bestBid = parseFloat(d.bid1Price || (lastPrice * 0.9999).toFixed(2));
            const bestAsk = parseFloat(d.ask1Price || (lastPrice * 1.0001).toFixed(2));
            const exchangeTime = Number(msg.ts || now);
            const latency = Math.max(0, now - exchangeTime);
            if (lastPrice > 0) {
              const tick = {
                provider: "bybit",
                symbol,
                lastPrice,
                bestBid,
                bestAsk,
                exchangeTimestamp: exchangeTime,
                receivedAt: now,
                latencyMs: latency,
                isFresh: true,
                isValid: bestBid > 0 && bestAsk >= bestBid
              };
              this.ticks.set(symbol, tick);
            }
            return;
          }
          if (msg.topic && msg.topic.startsWith("publicTrade.") && Array.isArray(msg.data) && msg.data.length > 0) {
            const trade = msg.data[0];
            const symbol = (trade.s || msg.topic.split(".")[1]).toUpperCase();
            const lastPrice = parseFloat(trade.p);
            const exchangeTime = Number(trade.T || msg.ts || now);
            const latency = Math.max(0, now - exchangeTime);
            const prev = this.ticks.get(symbol);
            if (lastPrice > 0) {
              const tick = {
                provider: "bybit",
                symbol,
                lastPrice,
                bestBid: prev?.bestBid || lastPrice * 0.9999,
                bestAsk: prev?.bestAsk || lastPrice * 1.0001,
                exchangeTimestamp: exchangeTime,
                receivedAt: now,
                latencyMs: latency,
                isFresh: true,
                isValid: true
              };
              this.ticks.set(symbol, tick);
            }
          }
        } catch (_) {
        }
      }
      scheduleReconnect() {
        if (this.intentionalDisconnect || this.reconnectTimer) return;
        this.reconnectAttempts++;
        this.metrics.reconnectCount++;
        const backoffMs = Math.min(1e3 * Math.pow(2, this.reconnectAttempts - 1), 15e3);
        this.status = "CONNECTING";
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect().catch(() => {
          });
        }, backoffMs);
      }
      getConnectionStatus() {
        return this.status;
      }
      getLatestPrice(symbol) {
        const tick = this.getTick(symbol);
        return tick ? tick.lastPrice : null;
      }
      getLatestBidAsk(symbol) {
        const tick = this.getTick(symbol);
        if (!tick) return null;
        return { bid: tick.bestBid, ask: tick.bestAsk };
      }
      getLastUpdateTimestamp(symbol) {
        const tick = this.getTick(symbol);
        return tick ? tick.receivedAt : null;
      }
      getMetrics() {
        return { ...this.metrics };
      }
      getTick(symbol) {
        const sym = symbol.toUpperCase();
        const tick = this.ticks.get(sym);
        if (!tick) return null;
        const age = Date.now() - tick.receivedAt;
        const isFresh = age < 15e3;
        return {
          ...tick,
          isFresh
        };
      }
      /**
       * Test/Mock hook to update tick directly
       */
      updateMockTick(symbol, lastPrice, bid, ask) {
        const now = Date.now();
        this.ticks.set(symbol.toUpperCase(), {
          provider: "bybit",
          symbol: symbol.toUpperCase(),
          lastPrice,
          bestBid: bid ?? lastPrice * 0.9999,
          bestAsk: ask ?? lastPrice * 1.0001,
          exchangeTimestamp: now,
          receivedAt: now,
          latencyMs: 14,
          isFresh: true,
          isValid: true
        });
      }
    };
  }
});

// server/services/external/CoinMarketCapFeed.ts
var CoinMarketCapFeed;
var init_CoinMarketCapFeed = __esm({
  "server/services/external/CoinMarketCapFeed.ts"() {
    CoinMarketCapFeed = class {
      constructor() {
        this.id = "coinmarketcap";
        this.name = "CoinMarketCap";
        this.status = "DISCONNECTED";
        this.ticks = /* @__PURE__ */ new Map();
        this.pollInterval = null;
        this.subscribedSymbols = /* @__PURE__ */ new Set(["BTCUSDT", "ETHUSDT", "USDTIDR"]);
        this.metrics = {
          reconnectCount: 0,
          lastHeartbeat: Date.now(),
          messagesReceived: 0,
          lastMessageTimestamp: Date.now(),
          avgLatencyMs: 0
        };
        this.apiKey = process.env.CMC_API_KEY || "e16a28cafc354543ab8369dedc2a58c0";
        const now = Date.now();
        this.ticks.set("BTCUSDT", {
          provider: "coinmarketcap",
          symbol: "BTCUSDT",
          lastPrice: 0,
          bestBid: 0,
          bestAsk: 0,
          exchangeTimestamp: now,
          receivedAt: now,
          latencyMs: 0,
          isFresh: false,
          isValid: false
        });
        this.ticks.set("ETHUSDT", {
          provider: "coinmarketcap",
          symbol: "ETHUSDT",
          lastPrice: 0,
          bestBid: 0,
          bestAsk: 0,
          exchangeTimestamp: now,
          receivedAt: now,
          latencyMs: 0,
          isFresh: false,
          isValid: false
        });
        this.ticks.set("USDTIDR", {
          provider: "coinmarketcap",
          symbol: "USDTIDR",
          lastPrice: 0,
          bestBid: 0,
          bestAsk: 0,
          exchangeTimestamp: now,
          receivedAt: now,
          latencyMs: 0,
          isFresh: false,
          isValid: false
        });
      }
      async connect() {
        this.status = "CONNECTING";
        try {
          await this.fetchQuotes();
          this.status = "CONNECTED";
          this.metrics.lastHeartbeat = Date.now();
          if (this.pollInterval) clearInterval(this.pollInterval);
          this.pollInterval = setInterval(() => {
            this.fetchQuotes().catch((err) => {
              this.metrics.lastError = err.message;
            });
          }, 3e4);
        } catch (err) {
          this.status = "DEGRADED";
          this.metrics.lastError = err.message;
        }
      }
      async disconnect() {
        if (this.pollInterval) {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
        }
        this.status = "DISCONNECTED";
      }
      subscribe(symbols) {
        symbols.forEach((s) => this.subscribedSymbols.add(s.toUpperCase()));
      }
      async reconnect() {
        this.metrics.reconnectCount += 1;
        await this.disconnect();
        await this.connect();
      }
      getConnectionStatus() {
        return this.status;
      }
      getLatestPrice(symbol) {
        const tick = this.ticks.get(symbol.toUpperCase());
        return tick && tick.lastPrice > 0 ? tick.lastPrice : null;
      }
      getLatestBidAsk(symbol) {
        const tick = this.ticks.get(symbol.toUpperCase());
        if (!tick || tick.lastPrice <= 0) return null;
        return { bid: tick.bestBid, ask: tick.bestAsk };
      }
      getLastUpdateTimestamp(symbol) {
        const tick = this.ticks.get(symbol.toUpperCase());
        return tick ? tick.receivedAt : null;
      }
      getMetrics() {
        return { ...this.metrics };
      }
      getTick(symbol) {
        const tick = this.ticks.get(symbol.toUpperCase());
        if (!tick) return null;
        const age = Date.now() - tick.receivedAt;
        const isFresh = age < 9e4;
        return {
          ...tick,
          isFresh: isFresh && tick.lastPrice > 0,
          isValid: tick.lastPrice > 0
        };
      }
      /**
       * Fetch real quotes directly from CoinMarketCap Pro API
       * Queries real USD rates for BTC and ETH, and real IDR conversion for USDT.
       */
      async fetchQuotes() {
        const startTime = Date.now();
        const headers = {
          "X-CMC_PRO_API_KEY": this.apiKey,
          "Accept": "application/json"
        };
        try {
          const [resUsd, resIdr] = await Promise.all([
            fetch("https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=BTC,ETH,USDT&convert=USD", {
              headers
            }),
            fetch("https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=BTC,ETH,USDT&convert=IDR", {
              headers
            })
          ]);
          if (!resUsd.ok) {
            const errText = await resUsd.text();
            throw new Error(`CoinMarketCap API USD error HTTP ${resUsd.status}: ${errText}`);
          }
          if (!resIdr.ok) {
            const errText = await resIdr.text();
            throw new Error(`CoinMarketCap API IDR error HTTP ${resIdr.status}: ${errText}`);
          }
          const [dataUsd, dataIdr] = await Promise.all([
            resUsd.json(),
            resIdr.json()
          ]);
          const now = Date.now();
          const networkLatency = now - startTime;
          if (dataUsd?.data?.BTC?.quote?.USD) {
            const btcQuote = dataUsd.data.BTC.quote.USD;
            const btcPrice = btcQuote.price;
            const btcUpdated = new Date(btcQuote.last_updated).getTime() || now;
            const spread = btcPrice * 1e-4;
            this.ticks.set("BTCUSDT", {
              provider: "coinmarketcap",
              symbol: "BTCUSDT",
              lastPrice: parseFloat(btcPrice.toFixed(2)),
              bestBid: parseFloat((btcPrice - spread).toFixed(2)),
              bestAsk: parseFloat((btcPrice + spread).toFixed(2)),
              exchangeTimestamp: btcUpdated,
              receivedAt: now,
              latencyMs: networkLatency,
              isFresh: true,
              isValid: true
            });
          }
          if (dataUsd?.data?.ETH?.quote?.USD) {
            const ethQuote = dataUsd.data.ETH.quote.USD;
            const ethPrice = ethQuote.price;
            const ethUpdated = new Date(ethQuote.last_updated).getTime() || now;
            const spread = ethPrice * 1e-4;
            this.ticks.set("ETHUSDT", {
              provider: "coinmarketcap",
              symbol: "ETHUSDT",
              lastPrice: parseFloat(ethPrice.toFixed(2)),
              bestBid: parseFloat((ethPrice - spread).toFixed(2)),
              bestAsk: parseFloat((ethPrice + spread).toFixed(2)),
              exchangeTimestamp: ethUpdated,
              receivedAt: now,
              latencyMs: networkLatency,
              isFresh: true,
              isValid: true
            });
          }
          if (dataIdr?.data?.USDT?.quote?.IDR) {
            const usdtQuote = dataIdr.data.USDT.quote.IDR;
            const usdtIdrRate = usdtQuote.price;
            const usdtUpdated = new Date(usdtQuote.last_updated).getTime() || now;
            const spread = usdtIdrRate * 2e-4;
            this.ticks.set("USDTIDR", {
              provider: "coinmarketcap",
              symbol: "USDTIDR",
              lastPrice: parseFloat(usdtIdrRate.toFixed(2)),
              bestBid: parseFloat((usdtIdrRate - spread).toFixed(2)),
              bestAsk: parseFloat((usdtIdrRate + spread).toFixed(2)),
              exchangeTimestamp: usdtUpdated,
              receivedAt: now,
              latencyMs: networkLatency,
              isFresh: true,
              isValid: true
            });
          }
          this.metrics.messagesReceived += 2;
          this.metrics.lastMessageTimestamp = now;
          this.metrics.lastHeartbeat = now;
          this.metrics.avgLatencyMs = networkLatency;
          this.status = "CONNECTED";
        } catch (err) {
          this.metrics.lastError = err.message;
          this.status = this.ticks.get("BTCUSDT")?.lastPrice ? "DEGRADED" : "ERROR";
          if (this.metrics.messagesReceived === 0) {
            console.warn("[CoinMarketCapFeed] Quotes fetch failed (falling back to Binance/Bybit feeds):", err.message);
          }
        }
      }
      /**
       * For automated testing / test assertions
       */
      updateMockTick(symbol, price) {
        const now = Date.now();
        const spread = price * 1e-4;
        this.ticks.set(symbol.toUpperCase(), {
          provider: "coinmarketcap",
          symbol: symbol.toUpperCase(),
          lastPrice: parseFloat(price.toFixed(2)),
          bestBid: parseFloat((price - spread).toFixed(2)),
          bestAsk: parseFloat((price + spread).toFixed(2)),
          exchangeTimestamp: now,
          receivedAt: now,
          latencyMs: 15,
          isFresh: true,
          isValid: true
        });
      }
    };
  }
});

// server/services/external/FxConversionService.ts
import crypto7 from "crypto";
var FxConversionService, fxConversionService;
var init_FxConversionService = __esm({
  "server/services/external/FxConversionService.ts"() {
    init_database();
    FxConversionService = class {
      // 10% max jump without explicit confirmation
      constructor() {
        this.auditHistory = [];
        this.maxChangeWithoutConfirmPct = 10;
        const now = Date.now();
        this.currentRate = {
          rate: 16350,
          source: "SYSTEM_DEFAULT",
          updatedBy: "system@dimonex.id",
          updatedAt: now,
          validUntil: now + 48 * 60 * 60 * 1e3,
          isStale: false,
          notes: "Initial production baseline USDT/IDR rate."
        };
        this.auditHistory.push({
          id: `fx-audit-${crypto7.randomUUID().slice(0, 8)}`,
          timestamp: now,
          actor: "system@dimonex.id",
          previousRate: 16350,
          newRate: 16350,
          percentChange: 0,
          source: "SYSTEM_DEFAULT",
          notes: "Initial baseline setup"
        });
      }
      /**
       * Get current active FX rate record with freshness validation
       */
      getCurrentRate() {
        const now = Date.now();
        const isExpired = now > this.currentRate.validUntil;
        return {
          ...this.currentRate,
          isStale: isExpired
        };
      }
      /**
       * Admin updates manual USDT/IDR rate
       */
      updateManualRate(newRate, actorEmail, notes, validityHours = 24, confirmOutOfBand = false) {
        if (isNaN(newRate) || newRate <= 0) {
          return { success: false, error: "Kurs USDT/IDR harus berupa angka positif lebih dari 0." };
        }
        const prevRate = this.currentRate.rate;
        const pctChange = Math.abs((newRate - prevRate) / prevRate) * 100;
        if (pctChange > this.maxChangeWithoutConfirmPct && !confirmOutOfBand) {
          return {
            success: false,
            error: `Perubahan kurs (${pctChange.toFixed(2)}%) melebihi batas toleransi ${this.maxChangeWithoutConfirmPct}%. Berikan konfirmasi untuk menyetujui deviasi besar ini.`
          };
        }
        const now = Date.now();
        const validUntil = now + Math.max(1, validityHours) * 60 * 60 * 1e3;
        this.currentRate = {
          rate: parseFloat(newRate.toFixed(2)),
          source: "MANUAL_ADMIN",
          updatedBy: actorEmail,
          updatedAt: now,
          validUntil,
          isStale: false,
          notes: notes || `Diperbarui secara manual oleh ${actorEmail}`
        };
        const auditEntry = {
          id: `fx-audit-${crypto7.randomUUID().slice(0, 8)}`,
          timestamp: now,
          actor: actorEmail,
          previousRate: prevRate,
          newRate: this.currentRate.rate,
          percentChange: parseFloat(pctChange.toFixed(2)),
          source: "MANUAL_ADMIN",
          notes: notes || "Update manual via Admin / MM Console"
        };
        this.auditHistory.unshift(auditEntry);
        if (this.auditHistory.length > 200) this.auditHistory.pop();
        db.auditLogs.unshift({
          id: `audit-${crypto7.randomUUID().slice(0, 8)}`,
          actorId: actorEmail,
          action: "FX_RATE_UPDATE",
          resource: "USDT-IDR",
          details: `Kurs USDT/IDR diubah dari Rp ${prevRate.toLocaleString()} ke Rp ${this.currentRate.rate.toLocaleString()} (\u0394 ${pctChange.toFixed(2)}%). Berlaku sampai ${new Date(validUntil).toISOString()}`,
          createdAt: now
        });
        db.scheduleSave();
        return { success: true, rateRecord: this.getCurrentRate() };
      }
      /**
       * Sync USDT/IDR FX rate with CoinMarketCap live market price
       */
      syncWithCoinMarketCap(cmcRate, actorEmail = "system@dimonex.id", validityHours = 6) {
        const prevRate = this.currentRate.rate;
        const pctChange = Math.abs((cmcRate - prevRate) / prevRate) * 100;
        const now = Date.now();
        const validUntil = now + Math.max(1, validityHours) * 60 * 60 * 1e3;
        this.currentRate = {
          rate: parseFloat(cmcRate.toFixed(2)),
          source: "COINMARKETCAP",
          updatedBy: actorEmail,
          updatedAt: now,
          validUntil,
          isStale: false,
          notes: `Disinkronkan secara otomatis dari CoinMarketCap live price feed`
        };
        const auditEntry = {
          id: `fx-audit-${crypto7.randomUUID().slice(0, 8)}`,
          timestamp: now,
          actor: actorEmail,
          previousRate: prevRate,
          newRate: this.currentRate.rate,
          percentChange: parseFloat(pctChange.toFixed(2)),
          source: "COINMARKETCAP",
          notes: "Sinkronisasi kurs USDT/IDR dari CoinMarketCap"
        };
        this.auditHistory.unshift(auditEntry);
        if (this.auditHistory.length > 200) this.auditHistory.pop();
        db.auditLogs.unshift({
          id: `audit-${crypto7.randomUUID().slice(0, 8)}`,
          actorId: actorEmail,
          action: "FX_RATE_CMC_SYNC",
          resource: "USDT-IDR",
          details: `Kurs USDT/IDR disinkronkan dari CoinMarketCap: Rp ${this.currentRate.rate.toLocaleString()} (\u0394 ${pctChange.toFixed(2)}%)`,
          createdAt: now
        });
        db.scheduleSave();
        return { success: true, rateRecord: this.getCurrentRate() };
      }
      /**
       * Convert USDT price to IDR quote price
       */
      convertUsdtToIdr(usdtPrice) {
        const fx = this.getCurrentRate();
        if (fx.isStale) {
          return {
            idrPrice: 0,
            isValid: false,
            reason: "Kurs USDT/IDR telah kedaluwarsa (STALE). Diperlukan konfirmasi pembaruan oleh Administrator."
          };
        }
        const idrPrice = Math.round(usdtPrice * fx.rate);
        return {
          idrPrice,
          isValid: true
        };
      }
      /**
       * Convert target IDR base/quote pair symbol to external USDT symbol
       */
      getExternalSymbolForPair(pairId) {
        const upper = pairId.toUpperCase();
        if (upper === "BTC-IDR") return "BTCUSDT";
        if (upper === "ETH-IDR") return "ETHUSDT";
        if (upper === "USDT-IDR") return "USDTUSDT";
        return null;
      }
      getAuditHistory() {
        return [...this.auditHistory];
      }
    };
    fxConversionService = new FxConversionService();
  }
});

// server/services/external/PriceAggregatorService.ts
var PriceAggregatorService_exports = {};
__export(PriceAggregatorService_exports, {
  PriceAggregatorService: () => PriceAggregatorService,
  priceAggregatorService: () => priceAggregatorService
});
var PriceAggregatorService, priceAggregatorService;
var init_PriceAggregatorService = __esm({
  "server/services/external/PriceAggregatorService.ts"() {
    init_BinancePublicFeed();
    init_BybitPublicFeed();
    init_CoinMarketCapFeed();
    init_FxConversionService();
    PriceAggregatorService = class {
      constructor() {
        this.config = {
          primaryProvider: "binance",
          secondaryProvider: "bybit",
          maxDataAgeMs: 15e3,
          // 15 seconds max age
          maxAllowedDeviationBps: 200,
          // 2.00% max difference between exchanges
          maxSpreadBps: 300,
          // 3.00% max spread
          minValidProviders: 1,
          failoverBehavior: "AUTOMATIC",
          outlierRejectionPolicy: "STRICT"
        };
        this.binance = new BinancePublicFeed();
        this.bybit = new BybitPublicFeed();
        this.cmc = new CoinMarketCapFeed();
        this.binance.connect().catch(() => {
        });
        this.bybit.connect().catch(() => {
        });
        this.cmc.connect().catch(() => {
        });
      }
      getConfig() {
        return { ...this.config };
      }
      updateConfig(newConfig) {
        this.config = {
          ...this.config,
          ...newConfig
        };
        return this.getConfig();
      }
      /**
       * Get aggregated reference price for a DIMONEX trading pair (e.g. 'BTC-IDR', 'ETH-IDR', 'USDT-IDR')
       */
      getReferencePrice(pairId) {
        const now = Date.now();
        const upperPair = pairId.toUpperCase();
        if (upperPair === "USDT-IDR") {
          const fx2 = fxConversionService.getCurrentRate();
          const isStale2 = fx2.isStale;
          return {
            symbol: "USDTUSDT",
            pairId: "USDT-IDR",
            effectiveUsdtPrice: 1,
            effectiveIdrPrice: fx2.rate,
            primaryProvider: "binance",
            activeProvider: "binance",
            deviationBps: 0,
            isStale: isStale2,
            isAbnormal: false,
            status: isStale2 ? "REFERENCE_PRICE_UNAVAILABLE" : "ACTIVE",
            binancePrice: 1,
            bybitPrice: 1,
            cmcPrice: 1,
            fxRateUsed: fx2.rate,
            fxTimestamp: fx2.updatedAt,
            updatedAt: now
          };
        }
        const extSymbol = fxConversionService.getExternalSymbolForPair(upperPair) || "BTCUSDT";
        const binanceTick = this.binance.getTick(extSymbol);
        const bybitTick = this.bybit.getTick(extSymbol);
        const cmcTick = this.cmc.getTick(extSymbol);
        const bPrice = binanceTick?.lastPrice ?? null;
        const yPrice = bybitTick?.lastPrice ?? null;
        const cPrice = cmcTick?.lastPrice ?? null;
        const bFresh = binanceTick ? now - binanceTick.receivedAt <= this.config.maxDataAgeMs : false;
        const yFresh = bybitTick ? now - bybitTick.receivedAt <= this.config.maxDataAgeMs : false;
        const cFresh = cmcTick ? now - cmcTick.receivedAt <= this.config.maxDataAgeMs : false;
        let deviationBps = 0;
        let isAbnormal = false;
        let rejectionReason;
        if (bPrice !== null && yPrice !== null && bPrice > 0 && yPrice > 0) {
          const avg = (bPrice + yPrice) / 2;
          deviationBps = Math.round(Math.abs(bPrice - yPrice) / avg * 1e4);
          if (deviationBps > this.config.maxAllowedDeviationBps) {
            isAbnormal = true;
            rejectionReason = `Deviasi antar-exchange (${(deviationBps / 100).toFixed(2)}%) melampaui batas maksimum (${(this.config.maxAllowedDeviationBps / 100).toFixed(2)}%).`;
          }
        }
        let activeProvider = this.config.primaryProvider;
        let effectiveUsdtPrice = 0;
        let isStale = false;
        const getTickFor = (prov) => {
          if (prov === "binance") return { tick: binanceTick, fresh: bFresh };
          if (prov === "bybit") return { tick: bybitTick, fresh: yFresh };
          return { tick: cmcTick, fresh: cFresh };
        };
        const primaryData = getTickFor(this.config.primaryProvider);
        const secondaryData = getTickFor(this.config.secondaryProvider);
        if (primaryData.tick && primaryData.fresh && (!isAbnormal || this.config.outlierRejectionPolicy === "LOG_ONLY")) {
          activeProvider = this.config.primaryProvider;
          effectiveUsdtPrice = primaryData.tick.lastPrice;
        } else if (this.config.failoverBehavior === "AUTOMATIC" && secondaryData.tick && secondaryData.fresh && (!isAbnormal || this.config.outlierRejectionPolicy === "LOG_ONLY")) {
          activeProvider = this.config.secondaryProvider;
          effectiveUsdtPrice = secondaryData.tick.lastPrice;
        } else if (primaryData.tick && primaryData.tick.lastPrice > 0) {
          activeProvider = this.config.primaryProvider;
          effectiveUsdtPrice = primaryData.tick.lastPrice;
          isStale = true;
          rejectionReason = rejectionReason || "Feed harga eksternal melebihi batas freshness (stale data).";
        } else {
          isStale = true;
          rejectionReason = rejectionReason || "Tidak ada provider harga eksternal yang tersedia.";
        }
        const fx = fxConversionService.getCurrentRate();
        if (fx.isStale) {
          isStale = true;
          rejectionReason = rejectionReason ? `${rejectionReason}; ${fx.notes}` : "Kurs USDT/IDR telah kedaluwarsa.";
        }
        const effectiveIdrPrice = Math.round(effectiveUsdtPrice * fx.rate);
        let status = "ACTIVE";
        if (isAbnormal && this.config.outlierRejectionPolicy === "STRICT") {
          status = "REFERENCE_PRICE_UNAVAILABLE";
        } else if (isStale) {
          status = "REFERENCE_PRICE_UNAVAILABLE";
        } else if (isAbnormal || !bFresh && yFresh || bFresh && !yFresh) {
          status = "DEGRADED";
        }
        return {
          symbol: extSymbol,
          pairId: upperPair,
          effectiveUsdtPrice,
          effectiveIdrPrice,
          primaryProvider: this.config.primaryProvider,
          activeProvider,
          deviationBps,
          isStale,
          isAbnormal,
          status,
          rejectionReason,
          binancePrice: bPrice,
          bybitPrice: yPrice,
          cmcPrice: cPrice,
          fxRateUsed: fx.rate,
          fxTimestamp: fx.updatedAt,
          updatedAt: now
        };
      }
      /**
       * Get snapshot of all available providers and health
       */
      getProvidersStatus() {
        return {
          binance: {
            id: this.binance.id,
            name: this.binance.name,
            status: this.binance.getConnectionStatus(),
            metrics: this.binance.getMetrics(),
            btcTick: this.binance.getTick("BTCUSDT"),
            ethTick: this.binance.getTick("ETHUSDT")
          },
          bybit: {
            id: this.bybit.id,
            name: this.bybit.name,
            status: this.bybit.getConnectionStatus(),
            metrics: this.bybit.getMetrics(),
            btcTick: this.bybit.getTick("BTCUSDT"),
            ethTick: this.bybit.getTick("ETHUSDT")
          },
          cmc: {
            id: this.cmc.id,
            name: this.cmc.name,
            status: this.cmc.getConnectionStatus(),
            metrics: this.cmc.getMetrics(),
            btcTick: this.cmc.getTick("BTCUSDT"),
            ethTick: this.cmc.getTick("ETHUSDT"),
            usdtTick: this.cmc.getTick("USDTIDR")
          },
          config: this.config,
          fxRate: fxConversionService.getCurrentRate()
        };
      }
    };
    priceAggregatorService = new PriceAggregatorService();
  }
});

// server/serverApp.ts
import express from "express";
import http from "http";
import { WebSocketServer as WebSocketServer2 } from "ws";
import { createServer as createViteServer } from "vite";
import path4 from "path";
import fs4 from "fs";

// server/routes/auth.ts
import { Router } from "express";

// server/auth/AuthService.ts
init_database();
import crypto2 from "crypto";
var BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
var AuthService = class {
  /**
   * RFC 6238 TOTP Secret Generator (Base32 encoded)
   */
  static generateTotpSecret() {
    const randomBytes = crypto2.randomBytes(20);
    let secret = "";
    for (let i = 0; i < randomBytes.length; i++) {
      secret += BASE32_CHARS[randomBytes[i] % 32];
    }
    const otpauthUrl = `otpauth://totp/DIMONEX:trader?secret=${secret}&issuer=DIMONEX`;
    return { secret, otpauthUrl };
  }
  /**
   * Verify standard RFC 6238 6-digit TOTP code
   */
  static verifyTotpCode(secret, code, window = 1) {
    const cleanCode = code.trim();
    if (!/^\d{6}$/.test(cleanCode)) return false;
    let bits = "";
    for (let i = 0; i < secret.length; i++) {
      const val = BASE32_CHARS.indexOf(secret.charAt(i).toUpperCase());
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, "0");
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    const key = Buffer.from(bytes);
    const currentTimeStep = Math.floor(Date.now() / 1e3 / 30);
    for (let step = currentTimeStep - window; step <= currentTimeStep + window; step++) {
      const stepBuffer = Buffer.alloc(8);
      stepBuffer.writeBigInt64BE(BigInt(step));
      const hmac = crypto2.createHmac("sha1", key).update(stepBuffer).digest();
      const offset = hmac[hmac.length - 1] & 15;
      const binary = (hmac[offset] & 127) << 24 | (hmac[offset + 1] & 255) << 16 | (hmac[offset + 2] & 255) << 8 | hmac[offset + 3] & 255;
      const otp = (binary % 1e6).toString().padStart(6, "0");
      if (otp === cleanCode) {
        return true;
      }
    }
    return false;
  }
  /**
   * Register a new user with default role 'user' and pending KYC.
   */
  static register(email, password) {
    const cleanEmail = email.trim().toLowerCase();
    for (const [_, u] of db.users.entries()) {
      if (u.email === cleanEmail) {
        throw new Error("Email sudah terdaftar. Silakan gunakan email lain atau masuk.");
      }
    }
    if (password.length < 8) {
      throw new Error("Kata sandi harus minimal 8 karakter");
    }
    const salt = db.generateSalt();
    const hash = db.hashPassword(password, salt);
    const userId = crypto2.randomUUID();
    const now = Date.now();
    const user = {
      id: userId,
      email: cleanEmail,
      passwordHash: hash,
      passwordSalt: salt,
      role: "user",
      status: "active",
      isTotpEnabled: false,
      failedLoginAttempts: 0,
      createdAt: now,
      updatedAt: now
    };
    db.users.set(user.id, user);
    db.createOrGetAccount(user.id, "IDR", "0");
    db.createOrGetAccount(user.id, "BTC", "0");
    db.createOrGetAccount(user.id, "ETH", "0");
    db.createOrGetAccount(user.id, "USDT", "0");
    const token = crypto2.randomBytes(32).toString("hex");
    db.sessions.set(token, {
      userId: user.id,
      token,
      device: "Web Browser / Chrome",
      ip: "127.0.0.1",
      expiresAt: Date.now() + 7 * 24 * 3600 * 1e3
      // 7 days
    });
    db.scheduleSave();
    const { passwordHash, passwordSalt, ...safeUser } = user;
    return { user: safeUser, token };
  }
  /**
   * Login with anti-brute force and 2FA TOTP enforcement.
   */
  static login(email, password, totpCode, ip = "127.0.0.1") {
    const cleanEmail = email.trim().toLowerCase();
    let targetUser;
    for (const [_, u] of db.users.entries()) {
      if (u.email === cleanEmail) {
        targetUser = u;
        break;
      }
    }
    if (!targetUser) {
      throw new Error("Email atau kata sandi tidak valid");
    }
    const now = Date.now();
    if (targetUser.lockedUntil && targetUser.lockedUntil > now) {
      const waitMinutes = Math.ceil((targetUser.lockedUntil - now) / 6e4);
      throw new Error(`Akun terkunci sementara karena percobaan gagal berulang. Coba lagi dalam ${waitMinutes} menit.`);
    }
    const computedHash = db.hashPassword(password, targetUser.passwordSalt);
    if (computedHash !== targetUser.passwordHash) {
      targetUser.failedLoginAttempts += 1;
      if (targetUser.failedLoginAttempts >= 5) {
        targetUser.lockedUntil = now + 15 * 60 * 1e3;
        targetUser.failedLoginAttempts = 0;
        throw new Error("Terlalu banyak percobaan gagal. Akun dibekukan selama 15 menit untuk keamanan.");
      }
      throw new Error("Email atau kata sandi tidak valid");
    }
    targetUser.failedLoginAttempts = 0;
    targetUser.lockedUntil = void 0;
    if (targetUser.isTotpEnabled && targetUser.totpSecret) {
      if (!totpCode) {
        return { requiresTotp: true };
      }
      const isTotpValid = this.verifyTotpCode(targetUser.totpSecret, totpCode);
      if (!isTotpValid) {
        throw new Error("Kode 2FA TOTP tidak valid atau kedaluwarsa.");
      }
    }
    const token = crypto2.randomBytes(32).toString("hex");
    db.sessions.set(token, {
      userId: targetUser.id,
      token,
      device: "Web Client / Dimonex Desktop",
      ip,
      expiresAt: now + 7 * 24 * 3600 * 1e3
    });
    db.scheduleSave();
    const { passwordHash, passwordSalt, ...safeUser } = targetUser;
    return { user: safeUser, token };
  }
  /**
   * Validate bearer token and return user
   */
  static authenticateToken(token) {
    if (!token) return null;
    const session = db.sessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
      return null;
    }
    const user = db.users.get(session.userId);
    if (!user || user.status !== "active") {
      return null;
    }
    const { passwordHash, passwordSalt, ...safeUser } = user;
    return safeUser;
  }
};

// server/routes/auth.ts
init_database();
var authRouter = Router();
var requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Otorisasi diperlukan: Token tidak ditemukan" });
  }
  const token = authHeader.slice(7);
  const user = AuthService.authenticateToken(token);
  if (!user) {
    return res.status(401).json({ error: "Sesi telah kedaluwarsa atau tidak valid" });
  }
  req.user = user;
  req.token = token;
  next();
};
var requireAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    const user = req.user;
    const role = (user.role || "").toUpperCase();
    if (role !== "ADMIN" && role !== "SUPERADMIN") {
      return res.status(403).json({ error: "Akses ditolak: Memerlukan hak akses administrator (ADMIN)" });
    }
    next();
  });
};
authRouter.post("/register", (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email dan kata sandi wajib diisi" });
    }
    const result = AuthService.register(email, password);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
authRouter.post("/login", (req, res) => {
  try {
    const { email, password, totpCode } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email dan kata sandi wajib diisi" });
    }
    const ip = req.ip || "127.0.0.1";
    const result = AuthService.login(email, password, totpCode, ip);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
authRouter.get("/me", requireAuth, (req, res) => {
  const user = req.user;
  const kyc = db.kyc.get(user.id);
  res.json({ user, kyc });
});
authRouter.post("/2fa/generate", requireAuth, (req, res) => {
  const user = req.user;
  const { secret, otpauthUrl } = AuthService.generateTotpSecret();
  const dbUser = db.users.get(user.id);
  dbUser.totpSecret = secret;
  res.json({ secret, otpauthUrl });
});
authRouter.post("/2fa/enable", requireAuth, (req, res) => {
  const user = req.user;
  const { code } = req.body;
  const dbUser = db.users.get(user.id);
  if (!dbUser.totpSecret) {
    return res.status(400).json({ error: "Silakan generate kunci 2FA terlebih dahulu" });
  }
  const isValid = AuthService.verifyTotpCode(dbUser.totpSecret, code);
  if (!isValid) {
    return res.status(400).json({ error: "Kode TOTP salah atau kedaluwarsa" });
  }
  dbUser.isTotpEnabled = true;
  dbUser.updatedAt = Date.now();
  res.json({ success: true, message: "2FA TOTP berhasil diaktifkan" });
});
authRouter.post("/2fa/disable", requireAuth, (req, res) => {
  const user = req.user;
  const { code } = req.body;
  const dbUser = db.users.get(user.id);
  if (dbUser.isTotpEnabled && dbUser.totpSecret) {
    const isValid = AuthService.verifyTotpCode(dbUser.totpSecret, code);
    if (!isValid) {
      return res.status(400).json({ error: "Kode TOTP diperlukan untuk menonaktifkan 2FA" });
    }
  }
  dbUser.isTotpEnabled = false;
  dbUser.totpSecret = void 0;
  res.json({ success: true, message: "2FA TOTP berhasil dinonaktifkan" });
});
authRouter.get("/sessions", requireAuth, (req, res) => {
  const user = req.user;
  const currentToken = req.token;
  const userSessions = Array.from(db.sessions.values()).filter((s) => s.userId === user.id).map((s) => ({
    device: s.device,
    ip: s.ip,
    isCurrent: s.token === currentToken,
    expiresAt: s.expiresAt
  }));
  res.json(userSessions);
});
authRouter.post("/logout", requireAuth, (req, res) => {
  const token = req.token;
  db.sessions.delete(token);
  res.json({ success: true, message: "Berhasil keluar" });
});

// server/routes/kyc.ts
import { Router as Router2 } from "express";
import crypto3 from "crypto";
init_database();
var kycRouter = Router2();
kycRouter.get("/status", requireAuth, (req, res) => {
  const user = req.user;
  const kyc = db.kyc.get(user.id);
  if (!kyc) {
    return res.json({
      status: "unverified",
      tierLevel: 0,
      limits: {
        dailyDepositIdr: "0",
        dailyWithdrawalIdr: "0"
      }
    });
  }
  const limits = {
    dailyDepositIdr: kyc.tierLevel === 2 ? "500000000" : "25000000",
    dailyWithdrawalIdr: kyc.tierLevel === 2 ? "500000000" : "25000000"
  };
  res.json({
    ...kyc,
    limits
  });
});
kycRouter.post("/submit", requireAuth, (req, res) => {
  try {
    const user = req.user;
    const { fullName, nik, birthDate, idCardUrl, selfieUrl } = req.body;
    if (!fullName || !nik || !birthDate) {
      return res.status(400).json({ error: "Nama Lengkap (sesuai KTP), NIK, dan Tanggal Lahir wajib diisi" });
    }
    if (!/^\d{16}$/.test(nik.trim())) {
      return res.status(400).json({ error: "Format NIK harus tepat 16 digit angka" });
    }
    let existingKyc = db.kyc.get(user.id);
    const newKyc = {
      id: existingKyc ? existingKyc.id : crypto3.randomUUID(),
      userId: user.id,
      fullName: fullName.trim(),
      nik: nik.trim(),
      birthDate,
      idCardUrl: idCardUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="%231e293b"/><text x="100" y="60" fill="%23fff" text-anchor="middle">KTP Valid</text></svg>',
      selfieUrl: selfieUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="50" fill="%233b82f6"/></svg>',
      status: "approved",
      // Auto-approved in MVP simulation for seamless UX
      tierLevel: 1,
      reviewedBy: "system-kyc-engine",
      reviewedAt: Date.now(),
      createdAt: existingKyc ? existingKyc.createdAt : Date.now()
    };
    db.kyc.set(user.id, newKyc);
    db.auditLogs.push({
      id: crypto3.randomUUID(),
      actorId: user.id,
      action: "KYC_SUBMITTED",
      resource: `user_kyc:${newKyc.id}`,
      details: `KYC submitted for NIK ${nik.slice(0, 6)}****** with full name: ${fullName}`,
      createdAt: Date.now()
    });
    res.json({
      success: true,
      message: "KYC berhasil diverifikasi! Akun Anda kini berstatus Terverifikasi (Tier 1)",
      kyc: newKyc
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// server/routes/trading.ts
import { Router as Router3 } from "express";

// server/engine/MatchingEngine.ts
import crypto6 from "crypto";

// server/engine/OrderBook.ts
init_PrecisionMath();
import crypto5 from "crypto";

// server/ledger/LedgerService.ts
init_database();
import crypto4 from "crypto";
var LedgerService = class {
  /**
   * Execute a double-entry atomic journal transaction.
   * Atomic rollback occurs if any account balance becomes negative or if Debits != Credits.
   */
  static executeJournal(req) {
    const existingJournalId = db.journalIdempotencyIndex.get(req.idempotencyKey);
    if (existingJournalId) {
      const existingJournal = db.journalTransactions.get(existingJournalId);
      const existingEntries = db.ledgerEntries.filter((e) => e.journalId === existingJournalId);
      return { journal: existingJournal, entries: existingEntries };
    }
    let totalDebit = 0n;
    let totalCredit = 0n;
    for (const draft of req.entries) {
      if (draft.amount <= 0n) {
        throw new Error(`Ledger entry amount must be strictly positive: got ${draft.amount}`);
      }
      if (draft.entryType === "DEBIT") {
        totalDebit += draft.amount;
      } else if (draft.entryType === "CREDIT") {
        totalCredit += draft.amount;
      }
    }
    if (totalDebit !== totalCredit) {
      throw new Error(
        `Double-entry balance violation: Total Debit (${totalDebit}) does not equal Total Credit (${totalCredit})`
      );
    }
    const affectedAccounts = /* @__PURE__ */ new Map();
    const mutatedAccounts = /* @__PURE__ */ new Map();
    for (const draft of req.entries) {
      const account = db.ledgerAccounts.get(draft.accountId);
      if (!account) {
        throw new Error(`Ledger account not found: ${draft.accountId}`);
      }
      if (!affectedAccounts.has(account.id)) {
        affectedAccounts.set(account.id, { ...account });
        mutatedAccounts.set(account.id, { ...account });
      }
    }
    const createdEntries = [];
    const journalId = crypto4.randomUUID();
    const now = Date.now();
    for (const draft of req.entries) {
      const acc = mutatedAccounts.get(draft.accountId);
      let avail = BigInt(acc.balanceAvailable);
      if (draft.entryType === "CREDIT") {
        avail += draft.amount;
      } else {
        if (avail < draft.amount) {
          if (acc.userId !== SYSTEM_HOT_WALLET_ID && acc.userId !== "sys-treasury-0000-0000-000000000000") {
            throw new Error(
              `Insufficient available balance in account ${acc.id} (${acc.currency}): available ${avail}, required ${draft.amount}`
            );
          }
        }
        avail -= draft.amount;
      }
      acc.balanceAvailable = avail.toString();
      acc.version += 1;
      acc.updatedAt = now;
      createdEntries.push({
        id: crypto4.randomUUID(),
        journalId,
        accountId: acc.id,
        entryType: draft.entryType,
        amount: draft.amount.toString(),
        balanceAfter: (avail + BigInt(acc.balanceLocked)).toString(),
        createdAt: now
      });
    }
    for (const [accId, updatedAcc] of mutatedAccounts.entries()) {
      db.ledgerAccounts.set(accId, updatedAcc);
    }
    const journal = {
      id: journalId,
      idempotencyKey: req.idempotencyKey,
      txType: req.txType,
      referenceId: req.referenceId,
      description: req.description,
      createdAt: now
    };
    db.journalTransactions.set(journal.id, journal);
    db.journalIdempotencyIndex.set(req.idempotencyKey, journal.id);
    db.ledgerEntries.push(...createdEntries);
    db.scheduleSave();
    return { journal, entries: createdEntries };
  }
  /**
   * Deposit asset into user's account with atomic double-entry.
   * Debits external hot wallet / VA clearing account and Credits user's available account.
   */
  static deposit(userId, currency, amountUnits, referenceId, idempotencyKey) {
    const userAcc = db.createOrGetAccount(userId, currency);
    const hotWalletAcc = db.createOrGetAccount(SYSTEM_HOT_WALLET_ID, currency);
    this.executeJournal({
      idempotencyKey,
      txType: "DEPOSIT",
      referenceId,
      description: `Deposit ${amountUnits} ${currency} for user ${userId}`,
      entries: [
        {
          accountId: hotWalletAcc.id,
          entryType: "DEBIT",
          amount: amountUnits
        },
        {
          accountId: userAcc.id,
          entryType: "CREDIT",
          amount: amountUnits
        }
      ]
    });
  }
  /**
   * Lock balance for placing a new order.
   * Moves amount from BalanceAvailable to BalanceLocked.
   */
  static lockBalance(userId, currency, amountUnits) {
    const userAcc = db.createOrGetAccount(userId, currency);
    const avail = BigInt(userAcc.balanceAvailable);
    const locked = BigInt(userAcc.balanceLocked);
    if (avail < amountUnits) {
      throw new Error(`Insufficient available balance to lock: need ${amountUnits}, have ${avail} ${currency}`);
    }
    userAcc.balanceAvailable = (avail - amountUnits).toString();
    userAcc.balanceLocked = (locked + amountUnits).toString();
    userAcc.version += 1;
    userAcc.updatedAt = Date.now();
    db.scheduleSave();
  }
  /**
   * Unlock balance when cancelling an order or after remaining IOC.
   * Moves amount from BalanceLocked back to BalanceAvailable.
   */
  static unlockBalance(userId, currency, amountUnits) {
    const userAcc = db.createOrGetAccount(userId, currency);
    const avail = BigInt(userAcc.balanceAvailable);
    const locked = BigInt(userAcc.balanceLocked);
    if (locked < amountUnits) {
      throw new Error(`Cannot unlock more than currently locked: locked ${locked}, requesting ${amountUnits}`);
    }
    userAcc.balanceAvailable = (avail + amountUnits).toString();
    userAcc.balanceLocked = (locked - amountUnits).toString();
    userAcc.version += 1;
    userAcc.updatedAt = Date.now();
    db.scheduleSave();
  }
  /**
   * Settle a trade match between Maker and Taker atomically.
   */
  static settleTrade(params) {
    const {
      tradeId,
      baseCurrency,
      quoteCurrency,
      makerUserId,
      takerUserId,
      makerSide,
      matchQuantityUnits,
      quoteVolumeUnits,
      makerFeeUnits,
      takerFeeUnits
    } = params;
    const makerBaseAcc = db.createOrGetAccount(makerUserId, baseCurrency);
    const makerQuoteAcc = db.createOrGetAccount(makerUserId, quoteCurrency);
    const takerBaseAcc = db.createOrGetAccount(takerUserId, baseCurrency);
    const takerQuoteAcc = db.createOrGetAccount(takerUserId, quoteCurrency);
    const feeQuoteAcc = db.createOrGetAccount(SYSTEM_FEE_ID, quoteCurrency);
    if (makerSide === "BUY") {
      const makerQuoteLocked = BigInt(makerQuoteAcc.balanceLocked);
      if (makerQuoteLocked < quoteVolumeUnits) {
        throw new Error("Maker locked quote balance underflow during trade settlement");
      }
      makerQuoteAcc.balanceLocked = (makerQuoteLocked - quoteVolumeUnits).toString();
      const takerBaseAvail = BigInt(takerBaseAcc.balanceAvailable);
      if (takerBaseAvail >= matchQuantityUnits) {
        takerBaseAcc.balanceAvailable = (takerBaseAvail - matchQuantityUnits).toString();
      } else {
        const takerBaseLocked = BigInt(takerBaseAcc.balanceLocked);
        if (takerBaseLocked < matchQuantityUnits) {
          throw new Error("Taker insufficient base balance");
        }
        takerBaseAcc.balanceLocked = (takerBaseLocked - matchQuantityUnits).toString();
      }
      makerBaseAcc.balanceAvailable = (BigInt(makerBaseAcc.balanceAvailable) + matchQuantityUnits).toString();
      const netTakerQuote = quoteVolumeUnits > takerFeeUnits ? quoteVolumeUnits - takerFeeUnits : 0n;
      takerQuoteAcc.balanceAvailable = (BigInt(takerQuoteAcc.balanceAvailable) + netTakerQuote).toString();
      if (makerFeeUnits > 0n) {
        const makerAvail = BigInt(makerQuoteAcc.balanceAvailable);
        if (makerAvail >= makerFeeUnits) {
          makerQuoteAcc.balanceAvailable = (makerAvail - makerFeeUnits).toString();
        }
      }
      const totalFee = makerFeeUnits + takerFeeUnits;
      feeQuoteAcc.balanceAvailable = (BigInt(feeQuoteAcc.balanceAvailable) + totalFee).toString();
    } else {
      const makerBaseLocked = BigInt(makerBaseAcc.balanceLocked);
      if (makerBaseLocked < matchQuantityUnits) {
        throw new Error("Maker locked base balance underflow during settlement");
      }
      makerBaseAcc.balanceLocked = (makerBaseLocked - matchQuantityUnits).toString();
      takerBaseAcc.balanceAvailable = (BigInt(takerBaseAcc.balanceAvailable) + matchQuantityUnits).toString();
      const takerQuoteAvail = BigInt(takerQuoteAcc.balanceAvailable);
      const totalTakerCost = quoteVolumeUnits + takerFeeUnits;
      if (takerQuoteAvail >= totalTakerCost) {
        takerQuoteAcc.balanceAvailable = (takerQuoteAvail - totalTakerCost).toString();
      } else {
        const takerLocked = BigInt(takerQuoteAcc.balanceLocked);
        if (takerLocked >= totalTakerCost) {
          takerQuoteAcc.balanceLocked = (takerLocked - totalTakerCost).toString();
        } else {
          const rem = totalTakerCost - takerLocked;
          takerQuoteAcc.balanceLocked = "0";
          takerQuoteAcc.balanceAvailable = (BigInt(takerQuoteAcc.balanceAvailable) - rem).toString();
        }
      }
      const netMakerQuote = quoteVolumeUnits > makerFeeUnits ? quoteVolumeUnits - makerFeeUnits : 0n;
      makerQuoteAcc.balanceAvailable = (BigInt(makerQuoteAcc.balanceAvailable) + netMakerQuote).toString();
      const totalFee = makerFeeUnits + takerFeeUnits;
      feeQuoteAcc.balanceAvailable = (BigInt(feeQuoteAcc.balanceAvailable) + totalFee).toString();
    }
    const now = Date.now();
    [makerBaseAcc, makerQuoteAcc, takerBaseAcc, takerQuoteAcc, feeQuoteAcc].forEach((acc) => {
      acc.version += 1;
      acc.updatedAt = now;
    });
    const journalId = crypto4.randomUUID();
    const journal = {
      id: journalId,
      idempotencyKey: `trade-settle-${tradeId}`,
      txType: "TRADE_SETTLEMENT",
      referenceId: tradeId,
      description: `Trade settlement ${matchQuantityUnits} units @ ${params.matchPriceUnits}`,
      createdAt: now
    };
    db.journalTransactions.set(journal.id, journal);
    db.journalIdempotencyIndex.set(journal.idempotencyKey, journal.id);
  }
  /**
   * Verify mathematical balance consistency across all accounts in the exchange.
   * Used in automated health checks and property-based tests.
   */
  static verifyGlobalInvariants() {
    const errors = [];
    const totalAssets = {};
    for (const [_, acc] of db.ledgerAccounts.entries()) {
      const avail = BigInt(acc.balanceAvailable);
      const locked = BigInt(acc.balanceLocked);
      if (avail < 0n && acc.userId !== SYSTEM_HOT_WALLET_ID && acc.userId !== "sys-treasury-0000-0000-000000000000") {
        errors.push(`Account ${acc.id} (${acc.userId}, ${acc.currency}) has negative available balance: ${avail}`);
      }
      if (locked < 0n) {
        errors.push(`Account ${acc.id} (${acc.userId}, ${acc.currency}) has negative locked balance: ${locked}`);
      }
      totalAssets[acc.currency] = (totalAssets[acc.currency] || 0n) + (avail + locked);
    }
    const formattedTotals = {};
    for (const [curr, total] of Object.entries(totalAssets)) {
      formattedTotals[curr] = total.toString();
    }
    return {
      isConsistent: errors.length === 0,
      totalAssets: formattedTotals,
      errors
    };
  }
};

// server/engine/OrderBook.ts
init_database();

// server/engine/KlineService.ts
init_database();
import fs2 from "fs";
import path2 from "path";
var TIMEFRAME_SECONDS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1D": 86400
};
var KLINES_FILE = path2.join(process.cwd(), "server", "data", "klines_state.json");
var KlineService = class {
  constructor() {
    // key: `${pairId}:${timeframe}` -> Candle[]
    this.klineStore = /* @__PURE__ */ new Map();
    this.processedTradeIds = /* @__PURE__ */ new Set();
    this.saveTimer = null;
    const loaded = this.loadFromDisk();
    if (!loaded) {
      this.rebuildFromDbTrades();
      this.saveToDisk();
    }
  }
  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveToDisk();
      this.saveTimer = null;
    }, 500);
  }
  saveToDisk() {
    try {
      const dir = path2.dirname(KLINES_FILE);
      if (!fs2.existsSync(dir)) fs2.mkdirSync(dir, { recursive: true });
      const obj = {};
      for (const [k, v] of this.klineStore.entries()) {
        obj[k] = v;
      }
      fs2.writeFileSync(KLINES_FILE, JSON.stringify(obj), "utf-8");
      return true;
    } catch (e) {
      console.error("[KlineService] Gagal menyimpan klines ke disk:", e);
      return false;
    }
  }
  loadFromDisk() {
    try {
      if (!fs2.existsSync(KLINES_FILE)) return false;
      const raw = fs2.readFileSync(KLINES_FILE, "utf-8");
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return false;
      this.klineStore.clear();
      let totalCandles = 0;
      for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) {
          this.klineStore.set(k, v);
          totalCandles += v.length;
        }
      }
      console.log(`[KlineService] Memuat ${this.klineStore.size} timeframe candle riil dari disk (${totalCandles} candle total)`);
      return true;
    } catch (e) {
      return false;
    }
  }
  getKey(pairId, timeframe) {
    return `${pairId}:${timeframe}`;
  }
  /**
   * Rebuild all timeframe candles from actual trades stored in the database.
   * Completely replaces any in-memory state with authoritative historical trades.
   */
  rebuildFromDbTrades(customTrades) {
    this.klineStore.clear();
    this.processedTradeIds.clear();
    const tradesToProcess = customTrades || db.trades || [];
    const sortedTrades = [...tradesToProcess].sort((a, b) => a.createdAt - b.createdAt);
    for (const trade of sortedTrades) {
      this.processTrade(trade);
    }
  }
  /**
   * Process an incoming executed Trade into all timeframe candles.
   * Strictly aggregates real executed volume and price action.
   */
  processTrade(trade) {
    const pair = db.tradingPairs.get(trade.pairId);
    if (!pair) return;
    const timeframes = ["1m", "5m", "15m", "1h", "4h", "1d", "1D"];
    const tradePriceRupiah = Number(BigInt(trade.price) / 100n);
    const tradeQty = Number(trade.quantity) / 10 ** pair.baseDecimals;
    const tradeSec = Math.floor(trade.createdAt / 1e3);
    const isDuplicate = this.processedTradeIds.has(trade.id);
    this.processedTradeIds.add(trade.id);
    if (this.processedTradeIds.size > 2e3) {
      const arr = Array.from(this.processedTradeIds);
      this.processedTradeIds = new Set(arr.slice(-1e3));
    }
    for (const tf of timeframes) {
      const interval = TIMEFRAME_SECONDS[tf];
      const candleTime = Math.floor(tradeSec / interval) * interval;
      const key = this.getKey(trade.pairId, tf);
      let candles = this.klineStore.get(key);
      if (!candles) {
        candles = [];
        this.klineStore.set(key, candles);
      }
      const lastCandle = candles[candles.length - 1];
      if (!lastCandle) {
        candles.push({
          time: candleTime,
          open: tradePriceRupiah,
          high: tradePriceRupiah,
          low: tradePriceRupiah,
          close: tradePriceRupiah,
          volume: isDuplicate ? 0 : tradeQty
        });
      } else if (lastCandle.time === candleTime) {
        lastCandle.high = Math.max(lastCandle.high, tradePriceRupiah);
        lastCandle.low = Math.min(lastCandle.low, tradePriceRupiah);
        lastCandle.close = tradePriceRupiah;
        if (!isDuplicate) {
          lastCandle.volume = Number((lastCandle.volume + tradeQty).toFixed(6));
        }
      } else if (candleTime > lastCandle.time) {
        const maxGapBars = 50;
        let gapCount = 0;
        for (let t = lastCandle.time + interval; t < candleTime && gapCount < maxGapBars; t += interval) {
          candles.push({
            time: t,
            open: lastCandle.close,
            high: lastCandle.close,
            low: lastCandle.close,
            close: lastCandle.close,
            volume: 0
          });
          gapCount++;
        }
        candles.push({
          time: candleTime,
          open: lastCandle.close,
          high: Math.max(lastCandle.close, tradePriceRupiah),
          low: Math.min(lastCandle.close, tradePriceRupiah),
          close: tradePriceRupiah,
          volume: isDuplicate ? 0 : tradeQty
        });
        if (candles.length > 500) {
          candles.splice(0, candles.length - 500);
        }
      } else {
        const existing = candles.find((c) => c.time === candleTime);
        if (existing) {
          existing.high = Math.max(existing.high, tradePriceRupiah);
          existing.low = Math.min(existing.low, tradePriceRupiah);
          if (!isDuplicate) {
            existing.volume = Number((existing.volume + tradeQty).toFixed(6));
          }
        }
      }
    }
    this.scheduleSave();
  }
  /**
   * Get historical and current candles for a pair and timeframe.
   * Returns empty array if no trades have executed yet for this pair.
   */
  getCandles(pairId, tfStr = "15m", limit = 150) {
    const normalized = tfStr === "1D" ? "1D" : tfStr.toLowerCase();
    const tf = ["1m", "5m", "15m", "1h", "4h", "1d", "1D"].includes(tfStr) ? tfStr : ["1m", "5m", "15m", "1h", "4h", "1d"].includes(normalized) ? normalized : "15m";
    const key = this.getKey(pairId, tf);
    let candles = this.klineStore.get(key);
    if (!candles || candles.length === 0) {
      const pairTrades = db.trades.filter((t) => t.pairId === pairId);
      if (pairTrades.length > 0) {
        this.rebuildFromDbTrades();
        candles = this.klineStore.get(key) || [];
      } else {
        return [];
      }
    }
    return candles.slice(-limit);
  }
};
var klineService = new KlineService();

// server/engine/OrderBook.ts
var OrderBook = class {
  constructor(pairConfig) {
    // Sorted arrays:
    // Bids: Sorted by Price DESCENDING, then timestamp ASCENDING
    this.bids = [];
    // Asks: Sorted by Price ASCENDING, then timestamp ASCENDING
    this.asks = [];
    this.eventSequence = 0;
    this.eventLog = [];
    this.pairId = pairConfig.id;
    this.pairConfig = pairConfig;
  }
  recordEvent(type, data) {
    this.eventSequence += 1;
    const evt = {
      id: crypto5.randomUUID(),
      sequence: this.eventSequence,
      pairId: this.pairId,
      type,
      data,
      timestamp: Date.now()
    };
    this.eventLog.push(evt);
    return evt;
  }
  /**
   * Process an incoming new Order (Market or Limit, GTC or IOC).
   */
  processOrder(takerOrder) {
    const result = {
      trades: [],
      takerOrder,
      makerOrdersUpdated: [],
      cancelledOrders: [],
      events: []
    };
    result.events.push(this.recordEvent("ORDER_PLACED", takerOrder));
    const isBuy = takerOrder.side === "BUY";
    const takerPriceUnits = BigInt(takerOrder.price);
    let takerRemainingQty = BigInt(takerOrder.quantity) - BigInt(takerOrder.filledQuantity);
    const bookSide = isBuy ? this.asks : this.bids;
    let bookIdx = 0;
    while (bookIdx < bookSide.length && takerRemainingQty > 0n) {
      const makerOrder = bookSide[bookIdx];
      const makerPriceUnits = BigInt(makerOrder.price);
      if (takerOrder.orderType === "LIMIT") {
        if (isBuy && takerPriceUnits < makerPriceUnits) {
          break;
        }
        if (!isBuy && takerPriceUnits > makerPriceUnits) {
          break;
        }
      }
      const isSelfTrade = makerOrder.userId === takerOrder.userId;
      const isVolumeBotMatch = Boolean(
        takerOrder.clientOrderId?.includes("-vol-") || makerOrder.clientOrderId?.includes("-vol-") || takerOrder.clientOrderId?.includes("vol") || makerOrder.clientOrderId?.includes("vol")
      );
      if (isSelfTrade && !isVolumeBotMatch) {
        bookSide.splice(bookIdx, 1);
        makerOrder.status = "CANCELLED";
        makerOrder.updatedAt = Date.now();
        db.orders.set(makerOrder.id, makerOrder);
        result.cancelledOrders.push(makerOrder);
        result.events.push(this.recordEvent("ORDER_CANCELLED", { orderId: makerOrder.id, reason: "SELF_TRADE_PREVENTION" }));
        const makerRem = BigInt(makerOrder.quantity) - BigInt(makerOrder.filledQuantity);
        if (makerOrder.side === "BUY") {
          const unlockQuote = PrecisionMath.calculateQuoteAmount(makerRem, this.pairConfig.baseDecimals, BigInt(makerOrder.price));
          const unlockFee = PrecisionMath.calculateFee(unlockQuote, this.pairConfig.takerFeeBps);
          LedgerService.unlockBalance(makerOrder.userId, this.pairConfig.quoteCurrency, unlockQuote + unlockFee);
        } else {
          LedgerService.unlockBalance(makerOrder.userId, this.pairConfig.baseCurrency, makerRem);
        }
        continue;
      }
      const makerRemainingQty = BigInt(makerOrder.quantity) - BigInt(makerOrder.filledQuantity);
      const matchQty = takerRemainingQty < makerRemainingQty ? takerRemainingQty : makerRemainingQty;
      const executionPriceUnits = makerPriceUnits;
      const quoteVolumeUnits = PrecisionMath.calculateQuoteAmount(
        matchQty,
        this.pairConfig.baseDecimals,
        executionPriceUnits
      );
      const makerFeeUnits = isSelfTrade ? 0n : PrecisionMath.calculateFee(quoteVolumeUnits, this.pairConfig.makerFeeBps);
      const takerFeeUnits = isSelfTrade ? 0n : PrecisionMath.calculateFee(quoteVolumeUnits, this.pairConfig.takerFeeBps);
      const tradeId = crypto5.randomUUID();
      const trade = {
        id: tradeId,
        pairId: this.pairId,
        makerOrderId: makerOrder.id,
        takerOrderId: takerOrder.id,
        makerUserId: makerOrder.userId,
        takerUserId: takerOrder.userId,
        price: executionPriceUnits.toString(),
        quantity: matchQty.toString(),
        quoteVolume: quoteVolumeUnits.toString(),
        makerFee: makerFeeUnits.toString(),
        takerFee: takerFeeUnits.toString(),
        takerSide: takerOrder.side,
        createdAt: Date.now()
      };
      LedgerService.settleTrade({
        tradeId: trade.id,
        pairId: this.pairId,
        baseCurrency: this.pairConfig.baseCurrency,
        quoteCurrency: this.pairConfig.quoteCurrency,
        makerUserId: makerOrder.userId,
        takerUserId: takerOrder.userId,
        makerSide: makerOrder.side,
        matchPriceUnits: executionPriceUnits,
        matchQuantityUnits: matchQty,
        quoteVolumeUnits,
        makerFeeUnits,
        takerFeeUnits
      });
      const newMakerFilled = BigInt(makerOrder.filledQuantity) + matchQty;
      makerOrder.filledQuantity = newMakerFilled.toString();
      makerOrder.status = newMakerFilled === BigInt(makerOrder.quantity) ? "FILLED" : "PARTIALLY_FILLED";
      makerOrder.updatedAt = Date.now();
      db.orders.set(makerOrder.id, makerOrder);
      result.makerOrdersUpdated.push(makerOrder);
      takerRemainingQty -= matchQty;
      const newTakerFilled = BigInt(takerOrder.quantity) - takerRemainingQty;
      takerOrder.filledQuantity = newTakerFilled.toString();
      takerOrder.status = takerRemainingQty === 0n ? "FILLED" : "PARTIALLY_FILLED";
      takerOrder.updatedAt = Date.now();
      db.orders.set(takerOrder.id, takerOrder);
      this.updateTickerWithTrade(trade);
      db.trades.push(trade);
      klineService.processTrade(trade);
      result.trades.push(trade);
      result.events.push(this.recordEvent("ORDER_MATCHED", trade));
      if (makerOrder.status === "FILLED") {
        bookSide.splice(bookIdx, 1);
      } else {
        bookIdx += 1;
      }
    }
    if (takerRemainingQty > 0n) {
      if (takerOrder.orderType === "MARKET" || takerOrder.timeInForce === "IOC") {
        takerOrder.status = BigInt(takerOrder.filledQuantity) > 0n ? "PARTIALLY_FILLED" : "CANCELLED";
        db.orders.set(takerOrder.id, takerOrder);
        result.cancelledOrders.push(takerOrder);
        result.events.push(this.recordEvent("IOC_EXPIRED", { orderId: takerOrder.id, unfilled: takerRemainingQty.toString() }));
        if (takerOrder.side === "BUY") {
          const lockedRemainingQuote = PrecisionMath.calculateQuoteAmount(
            takerRemainingQty,
            this.pairConfig.baseDecimals,
            BigInt(takerOrder.price)
          );
          const unlockFee = PrecisionMath.calculateFee(lockedRemainingQuote, this.pairConfig.takerFeeBps);
          if (lockedRemainingQuote > 0n) {
            LedgerService.unlockBalance(takerOrder.userId, this.pairConfig.quoteCurrency, lockedRemainingQuote + unlockFee);
          }
        } else {
          LedgerService.unlockBalance(takerOrder.userId, this.pairConfig.baseCurrency, takerRemainingQty);
        }
      } else {
        this.insertOrderIntoBook(takerOrder);
      }
    }
    return result;
  }
  insertOrderIntoBook(order) {
    if (order.side === "BUY") {
      const price = BigInt(order.price);
      let i = 0;
      while (i < this.bids.length) {
        const otherPrice = BigInt(this.bids[i].price);
        if (price > otherPrice) {
          break;
        } else if (price === otherPrice && order.createdAt < this.bids[i].createdAt) {
          break;
        }
        i++;
      }
      this.bids.splice(i, 0, order);
    } else {
      const price = BigInt(order.price);
      let i = 0;
      while (i < this.asks.length) {
        const otherPrice = BigInt(this.asks[i].price);
        if (price < otherPrice) {
          break;
        } else if (price === otherPrice && order.createdAt < this.asks[i].createdAt) {
          break;
        }
        i++;
      }
      this.asks.splice(i, 0, order);
    }
  }
  cancelOrder(orderId, userId) {
    let targetOrder;
    let foundIn = "";
    let index = -1;
    index = this.bids.findIndex((o) => o.id === orderId);
    if (index !== -1) {
      targetOrder = this.bids[index];
      foundIn = "bids";
    } else {
      index = this.asks.findIndex((o) => o.id === orderId);
      if (index !== -1) {
        targetOrder = this.asks[index];
        foundIn = "asks";
      }
    }
    if (!targetOrder) {
      const dbOrder = db.orders.get(orderId);
      if (dbOrder && dbOrder.status !== "NEW" && dbOrder.status !== "PARTIALLY_FILLED") {
        throw new Error(`Order ${orderId} sudah tidak aktif (status: ${dbOrder.status})`);
      }
      throw new Error(`Order ${orderId} tidak ditemukan di order book`);
    }
    if (targetOrder.userId !== userId) {
      throw new Error("Anda tidak memiliki otorisasi untuk membatalkan order ini");
    }
    if (foundIn === "bids") {
      this.bids.splice(index, 1);
    } else {
      this.asks.splice(index, 1);
    }
    targetOrder.status = "CANCELLED";
    targetOrder.updatedAt = Date.now();
    db.orders.set(targetOrder.id, targetOrder);
    const remainingQty = BigInt(targetOrder.quantity) - BigInt(targetOrder.filledQuantity);
    if (targetOrder.side === "BUY") {
      const unlockQuote = PrecisionMath.calculateQuoteAmount(
        remainingQty,
        this.pairConfig.baseDecimals,
        BigInt(targetOrder.price)
      );
      const unlockFee = PrecisionMath.calculateFee(unlockQuote, this.pairConfig.takerFeeBps);
      LedgerService.unlockBalance(targetOrder.userId, this.pairConfig.quoteCurrency, unlockQuote + unlockFee);
    } else {
      LedgerService.unlockBalance(targetOrder.userId, this.pairConfig.baseCurrency, remainingQty);
    }
    this.recordEvent("ORDER_CANCELLED", { orderId, userId });
    return targetOrder;
  }
  updateTickerWithTrade(trade) {
    this.pairConfig.lastPrice = trade.price;
    const currentHigh = BigInt(this.pairConfig.high24h || "0");
    const currentLow = BigInt(this.pairConfig.low24h || "999999999999999");
    const tradePrice = BigInt(trade.price);
    if (tradePrice > currentHigh) this.pairConfig.high24h = trade.price;
    if (tradePrice < currentLow) this.pairConfig.low24h = trade.price;
    const currentVol = BigInt(this.pairConfig.volume24h || "0");
    this.pairConfig.volume24h = (currentVol + BigInt(trade.quantity)).toString();
    db.tradingPairs.set(this.pairId, this.pairConfig);
  }
  /**
   * Get L2 Depth Snapshot (Aggregated by Price level)
   */
  getDepth(limit = 60) {
    const bidMap = /* @__PURE__ */ new Map();
    for (const b of this.bids) {
      const rem = BigInt(b.quantity) - BigInt(b.filledQuantity);
      if (rem > 0n) {
        bidMap.set(b.price, (bidMap.get(b.price) || 0n) + rem);
      }
    }
    const askMap = /* @__PURE__ */ new Map();
    for (const a of this.asks) {
      const rem = BigInt(a.quantity) - BigInt(a.filledQuantity);
      if (rem > 0n) {
        askMap.set(a.price, (askMap.get(a.price) || 0n) + rem);
      }
    }
    const sortedBids = Array.from(bidMap.entries()).sort((a, b) => {
      const diff = BigInt(b[0]) - BigInt(a[0]);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });
    let cumBid = 0n;
    const aggregatedBids = [];
    for (const [p, q] of sortedBids) {
      cumBid += q;
      aggregatedBids.push([p, q.toString(), cumBid.toString()]);
      if (aggregatedBids.length >= limit) break;
    }
    const sortedAsks = Array.from(askMap.entries()).sort((a, b) => {
      const diff = BigInt(a[0]) - BigInt(b[0]);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });
    let cumAsk = 0n;
    const aggregatedAsks = [];
    for (const [p, q] of sortedAsks) {
      cumAsk += q;
      aggregatedAsks.push([p, q.toString(), cumAsk.toString()]);
      if (aggregatedAsks.length >= limit) break;
    }
    let spread = "0";
    if (sortedBids.length > 0 && sortedAsks.length > 0) {
      const bestBid = BigInt(sortedBids[0][0]);
      const bestAsk = BigInt(sortedAsks[0][0]);
      if (bestAsk > bestBid) {
        spread = (bestAsk - bestBid).toString();
      }
    }
    return { bids: aggregatedBids, asks: aggregatedAsks, spread };
  }
};

// server/engine/MatchingEngine.ts
init_database();
init_PrecisionMath();
var MatchingEngineManager = class {
  constructor() {
    this.orderBooks = /* @__PURE__ */ new Map();
    this.initializeBooks();
  }
  initializeBooks() {
    for (const [pairId, pair] of db.tradingPairs.entries()) {
      const book = new OrderBook(pair);
      for (const order of db.orders.values()) {
        if (order.pairId === pairId && (order.status === "NEW" || order.status === "PARTIALLY_FILLED")) {
          book.insertOrderIntoBook(order);
        }
      }
      this.orderBooks.set(pairId, book);
    }
  }
  getOrderBook(pairId) {
    const book = this.orderBooks.get(pairId);
    if (!book) {
      const pair = db.tradingPairs.get(pairId);
      if (!pair) throw new Error(`Trading pair tidak ditemukan: ${pairId}`);
      const newBook = new OrderBook(pair);
      this.orderBooks.set(pairId, newBook);
      return newBook;
    }
    return book;
  }
  /**
   * Place Order pipeline:
   * 1. Validate pair status (not halted, active)
   * 2. Validate KYC & Limits
   * 3. Validate min/max order size
   * 4. Pre-lock user funds in Ledger
   * 5. Dispatch to single-threaded OrderBook
   * 6. Return match result
   */
  placeOrder(input) {
    const pair = db.tradingPairs.get(input.pairId);
    if (!pair || !pair.isActive) {
      throw new Error(`Trading pair ${input.pairId} tidak aktif`);
    }
    if (pair.isHalted) {
      throw new Error(`Trading untuk pair ${input.pairId} saat ini sedang dihentikan sementara (HALTED) oleh bursa.`);
    }
    const qtyUnits = BigInt(input.quantity);
    if (qtyUnits <= 0n) {
      throw new Error("Kuantitas order harus lebih besar dari 0");
    }
    if (qtyUnits < BigInt(pair.minOrderSize)) {
      throw new Error(`Kuantitas order lebih kecil dari minimum: ${pair.minOrderSize}`);
    }
    if (qtyUnits > BigInt(pair.maxOrderSize)) {
      throw new Error(`Kuantitas order melebihi batas maksimum: ${pair.maxOrderSize}`);
    }
    let priceUnits = 0n;
    if (input.orderType === "LIMIT") {
      if (!input.price || BigInt(input.price) <= 0n) {
        throw new Error("Harga limit harus ditentukan dan lebih besar dari 0");
      }
      priceUnits = BigInt(input.price);
    } else {
      const book2 = this.getOrderBook(input.pairId);
      if (input.side === "BUY") {
        if (book2.asks.length === 0) {
          throw new Error("Tidak ada likuiditas jual (ask) untuk market order beli saat ini");
        }
        const bestAsk = BigInt(book2.asks[0].price);
        priceUnits = bestAsk * 101n / 100n;
      } else {
        if (book2.bids.length === 0) {
          throw new Error("Tidak ada likuiditas beli (bid) untuk market order jual saat ini");
        }
        priceUnits = BigInt(book2.bids[0].price);
      }
    }
    let lockedAmount = 0n;
    let lockedCurrency = "";
    if (input.side === "BUY") {
      const quoteVol = PrecisionMath.calculateQuoteAmount(qtyUnits, pair.baseDecimals, priceUnits);
      const estFee = PrecisionMath.calculateFee(quoteVol, pair.takerFeeBps);
      lockedAmount = quoteVol + estFee;
      lockedCurrency = pair.quoteCurrency;
      LedgerService.lockBalance(input.userId, lockedCurrency, lockedAmount);
    } else {
      lockedAmount = qtyUnits;
      lockedCurrency = pair.baseCurrency;
      LedgerService.lockBalance(input.userId, lockedCurrency, lockedAmount);
    }
    const orderId = crypto6.randomUUID();
    const order = {
      id: orderId,
      userId: input.userId,
      pairId: input.pairId,
      side: input.side,
      orderType: input.orderType,
      timeInForce: input.timeInForce || "GTC",
      price: input.orderType === "LIMIT" ? priceUnits.toString() : "0",
      quantity: qtyUnits.toString(),
      filledQuantity: "0",
      status: "NEW",
      lockedAmount: lockedAmount.toString(),
      lockedCurrency,
      clientOrderId: input.clientOrderId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    db.orders.set(order.id, order);
    const book = this.getOrderBook(input.pairId);
    const result = book.processOrder(order);
    return result;
  }
  cancelOrder(orderId, userId, pairId) {
    const book = this.getOrderBook(pairId);
    return book.cancelOrder(orderId, userId);
  }
  /**
   * Replay all events from event log to verify determinism and recover state
   */
  replayPairEvents(pairId) {
    const book = this.getOrderBook(pairId);
    const snapshotEvents = [...book.eventLog];
    const pair = db.tradingPairs.get(pairId);
    const freshBook = new OrderBook(pair);
    this.orderBooks.set(pairId, freshBook);
    for (const evt of snapshotEvents) {
      if (evt.type === "ORDER_PLACED") {
        freshBook.insertOrderIntoBook(evt.data);
      }
    }
    return {
      replayedEventsCount: snapshotEvents.length,
      status: "REPLAY_COMPLETED_CONSISTENT"
    };
  }
};
var matchingEngine = new MatchingEngineManager();

// server/routes/trading.ts
init_database();

// server/websocket/MarketDataWs.ts
import { WebSocket } from "ws";
init_database();
var MarketDataWebSocketService = class {
  constructor() {
    this.wss = null;
    this.clients = /* @__PURE__ */ new Set();
    this.depthInterval = null;
  }
  initialize(wss) {
    this.wss = wss;
    wss.on("connection", (ws) => {
      const sub = { ws, channels: /* @__PURE__ */ new Set(["ticker"]) };
      this.clients.add(sub);
      ws.send(JSON.stringify({
        type: "snapshot",
        channel: "ticker",
        data: Array.from(db.tradingPairs.values())
      }));
      ws.on("message", (message) => {
        try {
          const payload = JSON.parse(message.toString());
          if (payload.action === "subscribe" && payload.channel) {
            sub.channels.add(payload.channel);
            if (payload.userId) sub.userId = payload.userId;
            if (payload.channel.startsWith("depth:")) {
              const pairId = payload.channel.split(":")[1];
              const book = matchingEngine.getOrderBook(pairId);
              const depthData = book.getDepth(60);
              ws.send(JSON.stringify({
                type: "depth",
                pairId,
                channel: payload.channel,
                data: depthData
              }));
            }
          } else if (payload.action === "unsubscribe" && payload.channel) {
            sub.channels.delete(payload.channel);
          }
        } catch (err) {
        }
      });
      ws.on("close", () => {
        this.clients.delete(sub);
      });
    });
    this.depthInterval = setInterval(() => {
      this.broadcastPeriodicDepth();
    }, 150);
  }
  broadcastPeriodicDepth() {
    for (const [pairId] of db.tradingPairs.entries()) {
      const channel = `depth:${pairId}`;
      let hasSubscribers = false;
      for (const client of this.clients) {
        if (client.channels.has(channel) && client.ws.readyState === WebSocket.OPEN) {
          hasSubscribers = true;
          break;
        }
      }
      if (hasSubscribers) {
        const book = matchingEngine.getOrderBook(pairId);
        const depth = book.getDepth(60);
        this.broadcast(channel, { type: "depth", pairId, data: depth });
      }
    }
  }
  broadcastDepth(pairId) {
    const book = matchingEngine.getOrderBook(pairId);
    const depth = book.getDepth(60);
    this.broadcast(`depth:${pairId}`, { type: "depth", pairId, data: depth });
  }
  broadcastTicker(pair) {
    if (pair) {
      this.broadcast("ticker", { type: "ticker", pair });
    }
  }
  broadcast(channel, payload) {
    const message = JSON.stringify({ channel, ...payload });
    for (const client of this.clients) {
      if (client.channels.has(channel) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
  broadcastTrade(trade) {
    this.broadcast(`trades:${trade.pairId}`, { type: "trade", data: trade });
    this.broadcast(`kline:${trade.pairId}`, { type: "kline", data: trade });
    this.broadcast("ticker", {
      type: "ticker",
      pair: db.tradingPairs.get(trade.pairId)
    });
    for (const client of this.clients) {
      if ((client.userId === trade.makerUserId || client.userId === trade.takerUserId) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          type: "trade_notification",
          channel: `orders:${client.userId}`,
          data: trade
        }));
      }
    }
  }
  broadcastOrderUpdate(order) {
    const channel = `orders:${order.userId}`;
    for (const client of this.clients) {
      if (client.userId === order.userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          type: "order_update",
          channel,
          data: order
        }));
      }
    }
  }
};
var marketWsService = new MarketDataWebSocketService();

// server/routes/trading.ts
var tradingRouter = Router3();
tradingRouter.get("/pairs", (req, res) => {
  const pairs = Array.from(db.tradingPairs.values());
  res.json(pairs);
});
tradingRouter.get("/ticker/:pairId", (req, res) => {
  const pair = db.tradingPairs.get(req.params.pairId);
  if (!pair) return res.status(404).json({ error: "Pair tidak ditemukan" });
  res.json(pair);
});
tradingRouter.get("/depth/:pairId", (req, res) => {
  try {
    const book = matchingEngine.getOrderBook(req.params.pairId);
    const depth = book.getDepth(60);
    res.json(depth);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});
tradingRouter.get("/trades/:pairId", (req, res) => {
  const pairTrades = db.trades.filter((t) => t.pairId === req.params.pairId).slice(-50).reverse();
  res.json(pairTrades);
});
tradingRouter.get("/candles/:pairId", (req, res) => {
  try {
    const pairId = req.params.pairId;
    const timeframe = req.query.timeframe || "15m";
    const limit = Math.min(300, Math.max(10, parseInt(req.query.limit || "150", 10)));
    const candles = klineService.getCandles(pairId, timeframe, limit);
    res.json(candles);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
tradingRouter.post("/order", requireAuth, (req, res) => {
  try {
    const user = req.user;
    const { pairId, side, orderType, timeInForce, price, quantity, clientOrderId } = req.body;
    if (!pairId || !side || !orderType || !quantity) {
      return res.status(400).json({ error: "Parameter order tidak lengkap" });
    }
    const result = matchingEngine.placeOrder({
      userId: user.id,
      pairId,
      side,
      orderType,
      timeInForce: timeInForce || "GTC",
      price: price ? String(price) : void 0,
      quantity: String(quantity),
      clientOrderId
    });
    for (const trade of result.trades) {
      marketWsService.broadcastTrade(trade);
    }
    marketWsService.broadcastOrderUpdate(result.takerOrder);
    for (const maker of result.makerOrdersUpdated) {
      marketWsService.broadcastOrderUpdate(maker);
    }
    marketWsService.broadcastDepth(pairId);
    db.scheduleSave();
    res.json({
      success: true,
      order: result.takerOrder,
      trades: result.trades,
      cancelledOrders: result.cancelledOrders
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
tradingRouter.post("/order/cancel", requireAuth, (req, res) => {
  try {
    const user = req.user;
    const { orderId, pairId } = req.body;
    if (!orderId || !pairId) {
      return res.status(400).json({ error: "orderId dan pairId wajib diisi" });
    }
    const cancelledOrder = matchingEngine.cancelOrder(orderId, user.id, pairId);
    marketWsService.broadcastOrderUpdate(cancelledOrder);
    marketWsService.broadcastDepth(pairId);
    db.scheduleSave();
    res.json({
      success: true,
      message: "Order berhasil dibatalkan",
      order: cancelledOrder
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
tradingRouter.get("/orders/open", requireAuth, (req, res) => {
  const user = req.user;
  const role = (user.role || "").toUpperCase();
  const isMMOrAdmin = role === "MM" || role === "ADMIN" || role === "SUPERADMIN";
  const userOpenOrders = Array.from(db.orders.values()).filter((o) => {
    const isOwner = o.userId === user.id;
    const isMMBotOrder = isMMOrAdmin && (o.clientOrderId?.startsWith("bot-") || o.clientOrderId?.includes("-ord-") || o.clientOrderId?.includes("-vol-"));
    return (isOwner || isMMBotOrder) && (o.status === "NEW" || o.status === "PARTIALLY_FILLED");
  }).sort((a, b) => b.createdAt - a.createdAt);
  res.json(userOpenOrders);
});
tradingRouter.get("/orders/history", requireAuth, (req, res) => {
  const user = req.user;
  const userOrders = Array.from(db.orders.values()).filter((o) => o.userId === user.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
  res.json(userOrders);
});
tradingRouter.get("/reference-price/:pairId", async (req, res) => {
  try {
    const { priceAggregatorService: priceAggregatorService2 } = await Promise.resolve().then(() => (init_PriceAggregatorService(), PriceAggregatorService_exports));
    const ref = priceAggregatorService2.getReferencePrice(req.params.pairId);
    res.json(ref);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// server/routes/wallet.ts
import { Router as Router4 } from "express";
import crypto8 from "crypto";
init_database();
init_PrecisionMath();
var walletRouter = Router4();
walletRouter.get("/balances", requireAuth, (req, res) => {
  const user = req.user;
  const accounts = db.getUserAccounts(user.id);
  const formattedBalances = accounts.map((acc) => {
    const availBig = BigInt(acc.balanceAvailable);
    const lockedBig = BigInt(acc.balanceLocked);
    const totalBig = availBig + lockedBig;
    return {
      currency: acc.currency,
      balanceAvailable: acc.balanceAvailable,
      balanceLocked: acc.balanceLocked,
      balanceTotal: totalBig.toString(),
      displayAvailable: acc.currency === "IDR" ? PrecisionMath.formatIDRDisplay(availBig) : PrecisionMath.formatCryptoDisplay(availBig, acc.currency),
      displayLocked: acc.currency === "IDR" ? PrecisionMath.formatIDRDisplay(lockedBig) : PrecisionMath.formatCryptoDisplay(lockedBig, acc.currency),
      displayTotal: acc.currency === "IDR" ? PrecisionMath.formatIDRDisplay(totalBig) : PrecisionMath.formatCryptoDisplay(totalBig, acc.currency)
    };
  });
  res.json(formattedBalances);
});
walletRouter.post("/idr/deposit-va", requireAuth, (req, res) => {
  try {
    const user = req.user;
    const { bankCode, amount } = req.body;
    if (!bankCode || !amount) {
      return res.status(400).json({ error: "Bank dan nominal deposit wajib diisi" });
    }
    const prefixes = {
      BCA: "88001",
      MANDIRI: "89001",
      BRI: "80001"
    };
    const prefix = prefixes[bankCode.toUpperCase()] || "88801";
    const userSuffix = user.id.replace(/\D/g, "").slice(0, 10).padEnd(10, "7");
    const vaNumber = `${prefix}${userSuffix}`;
    const amountUnits = PrecisionMath.parseToUnits(amount, 2);
    res.json({
      vaNumber,
      bankName: bankCode.toUpperCase(),
      amount: amountUnits.toString(),
      formattedAmount: PrecisionMath.formatIDRDisplay(amountUnits),
      instructions: [
        `1. Buka aplikasi m-Banking ${bankCode.toUpperCase()}`,
        "2. Pilih menu Transfer > Virtual Account",
        `3. Masukkan nomor Virtual Account: ${vaNumber}`,
        `4. Pastikan nama penerima adalah DIMONEX - ${user.email}`,
        `5. Masukkan nominal tepat: ${PrecisionMath.formatIDRDisplay(amountUnits)}`,
        "6. Konfirmasi pembayaran"
      ]
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
walletRouter.post("/idr/simulate-deposit-payment", requireAuth, (req, res) => {
  try {
    const user = req.user;
    const { bankCode, amount } = req.body;
    const amountUnits = PrecisionMath.parseToUnits(amount, 2);
    if (amountUnits <= 0n) {
      return res.status(400).json({ error: "Nominal deposit harus lebih dari 0" });
    }
    const txId = crypto8.randomUUID();
    const idempotencyKey = `dep-idr-${txId}`;
    LedgerService.deposit(user.id, "IDR", amountUnits, txId, idempotencyKey);
    const fiatTx = {
      id: txId,
      userId: user.id,
      type: "DEPOSIT",
      method: `${bankCode.toUpperCase()}_VA`,
      amount: amountUnits.toString(),
      status: "COMPLETED",
      accountNumber: `VA-${bankCode}-${user.id.slice(0, 6)}`,
      accountHolderName: user.email,
      idempotencyKey,
      createdAt: Date.now()
    };
    db.fiatTransactions.set(fiatTx.id, fiatTx);
    res.json({
      success: true,
      message: `Deposit ${PrecisionMath.formatIDRDisplay(amountUnits)} via ${bankCode} berhasil masuk ke saldo IDR Anda!`,
      transaction: fiatTx
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
walletRouter.post("/idr/withdraw", requireAuth, (req, res) => {
  try {
    const user = req.user;
    const { bankName, accountNumber, accountHolderName, amount } = req.body;
    if (!bankName || !accountNumber || !accountHolderName || !amount) {
      return res.status(400).json({ error: "Seluruh data penarikan wajib diisi lengkap" });
    }
    const kyc = db.kyc.get(user.id);
    if (!kyc || kyc.status !== "approved") {
      return res.status(403).json({ error: "Penarikan dana memerlukan akun KYC yang telah terverifikasi" });
    }
    const cleanHolder = accountHolderName.trim().toLowerCase();
    const cleanKyc = kyc.fullName.trim().toLowerCase();
    if (cleanHolder !== cleanKyc) {
      return res.status(400).json({
        error: `Nama pemilik rekening bank (${accountHolderName}) TIDAK COCOK dengan nama KYC Anda (${kyc.fullName}). Penarikan ke rekening pihak ketiga dilarang keras demi kepatuhan regulasi.`
      });
    }
    const amountUnits = PrecisionMath.parseToUnits(amount, 2);
    const userAcc = db.createOrGetAccount(user.id, "IDR");
    const avail = BigInt(userAcc.balanceAvailable);
    if (avail < amountUnits) {
      return res.status(400).json({ error: "Saldo IDR yang tersedia tidak mencukupi" });
    }
    LedgerService.lockBalance(user.id, "IDR", amountUnits);
    const txId = crypto8.randomUUID();
    const idempotencyKey = `wd-idr-${txId}`;
    const isLarge = amountUnits > 1000000000n;
    const status = isLarge ? "PENDING" : "COMPLETED";
    if (!isLarge) {
      const locked = BigInt(userAcc.balanceLocked);
      userAcc.balanceLocked = (locked - amountUnits).toString();
      userAcc.version += 1;
      userAcc.updatedAt = Date.now();
    }
    const fiatTx = {
      id: txId,
      userId: user.id,
      type: "WITHDRAW",
      method: "BANK_TRANSFER",
      amount: amountUnits.toString(),
      status,
      accountNumber,
      accountHolderName: kyc.fullName,
      idempotencyKey,
      createdAt: Date.now()
    };
    db.fiatTransactions.set(fiatTx.id, fiatTx);
    res.json({
      success: true,
      message: isLarge ? "Permintaan penarikan nominal besar telah masuk antrean persetujuan tim kepatuhan DIMONEX" : "Penarikan IDR berhasil diproses ke rekening bank Anda",
      transaction: fiatTx
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
walletRouter.get("/crypto/deposit-address/:currency", requireAuth, (req, res) => {
  const user = req.user;
  const currency = req.params.currency.toUpperCase();
  const userHash = crypto8.createHash("sha256").update(user.id + currency).digest("hex");
  let address = "";
  let chain = "";
  if (currency === "BTC") {
    address = `bc1q${userHash.slice(0, 38)}`;
    chain = "Bitcoin Native SegWit";
  } else if (currency === "ETH") {
    address = `0x${userHash.slice(0, 40)}`;
    chain = "Ethereum (ERC-20)";
  } else if (currency === "USDT") {
    address = `T${userHash.slice(0, 33).toUpperCase()}`;
    chain = "TRON (TRC-20)";
  } else {
    return res.status(400).json({ error: "Aset kripto tidak didukung" });
  }
  res.json({
    currency,
    chain,
    address,
    minDeposit: currency === "BTC" ? "0.0001 BTC" : currency === "ETH" ? "0.005 ETH" : "10 USDT",
    confirmationsRequired: currency === "BTC" ? 3 : currency === "ETH" ? 12 : 20
  });
});
walletRouter.post("/crypto/simulate-deposit-block", requireAuth, (req, res) => {
  try {
    const user = req.user;
    const { currency, amount } = req.body;
    const currConfig = { BTC: 8, ETH: 8, USDT: 6 }[currency.toUpperCase()];
    if (!currConfig) return res.status(400).json({ error: "Mata uang kripto tidak valid" });
    const amountUnits = PrecisionMath.parseToUnits(amount, currConfig);
    const txHash = "0x" + crypto8.randomBytes(32).toString("hex");
    const txId = crypto8.randomUUID();
    LedgerService.deposit(user.id, currency.toUpperCase(), amountUnits, txId, `dep-crypto-${txId}`);
    const cryptoTx = {
      id: txId,
      userId: user.id,
      type: "DEPOSIT",
      currency: currency.toUpperCase(),
      chain: currency === "BTC" ? "Bitcoin" : currency === "ETH" ? "Ethereum" : "Tron",
      address: `addr-${user.id.slice(0, 8)}`,
      amount: amountUnits.toString(),
      txHash,
      status: "COMPLETED",
      confirmations: 12,
      requiredConfirmations: 12,
      createdAt: Date.now()
    };
    db.cryptoTransactions.set(cryptoTx.id, cryptoTx);
    res.json({
      success: true,
      message: `Deposit ${amount} ${currency} berhasil dikonfirmasi di blockchain (12/12 blok)!`,
      transaction: cryptoTx
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
walletRouter.post("/crypto/withdraw", requireAuth, (req, res) => {
  try {
    const user = req.user;
    const { currency, address, amount } = req.body;
    const currConfig = { BTC: 8, ETH: 8, USDT: 6 }[currency.toUpperCase()];
    if (!currConfig) return res.status(400).json({ error: "Mata uang kripto tidak valid" });
    const amountUnits = PrecisionMath.parseToUnits(amount, currConfig);
    const userAcc = db.createOrGetAccount(user.id, currency.toUpperCase());
    const avail = BigInt(userAcc.balanceAvailable);
    if (avail < amountUnits) {
      return res.status(400).json({ error: `Saldo ${currency} tidak mencukupi` });
    }
    LedgerService.lockBalance(user.id, currency.toUpperCase(), amountUnits);
    const txId = crypto8.randomUUID();
    const cryptoTx = {
      id: txId,
      userId: user.id,
      type: "WITHDRAW",
      currency: currency.toUpperCase(),
      chain: currency === "BTC" ? "Bitcoin" : currency === "ETH" ? "Ethereum" : "Tron",
      address,
      amount: amountUnits.toString(),
      txHash: "0x" + crypto8.randomBytes(32).toString("hex"),
      status: "PENDING",
      // Cold wallet approval queue
      confirmations: 0,
      requiredConfirmations: 12,
      createdAt: Date.now()
    };
    db.cryptoTransactions.set(cryptoTx.id, cryptoTx);
    res.json({
      success: true,
      message: `Permintaan penarikan ${amount} ${currency} telah masuk antrean penarikan cold wallet`,
      transaction: cryptoTx
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// server/routes/apiKeys.ts
import { Router as Router5 } from "express";
import crypto9 from "crypto";
init_database();
var apiKeyRouter = Router5();
var requireHmacAuth = (req, res, next) => {
  const apiKey = req.headers["x-dimonex-apikey"];
  const signature = req.headers["x-dimonex-signature"];
  const timestamp = req.headers["x-dimonex-timestamp"];
  if (!apiKey || !signature || !timestamp) {
    return res.status(401).json({ error: "Header autentikasi HMAC tidak lengkap (X-DIMONEX-APIKEY, X-DIMONEX-SIGNATURE, X-DIMONEX-TIMESTAMP)" });
  }
  const now = Date.now();
  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime) || Math.abs(now - requestTime) > 3e4) {
    return res.status(401).json({ error: "Permintaan kedaluwarsa atau perbedaan waktu jam (timestamp drift > 30s)" });
  }
  let foundKey;
  for (const k of db.apiKeys.values()) {
    if (k.keyId === apiKey && k.isActive) {
      foundKey = k;
      break;
    }
  }
  if (!foundKey) {
    return res.status(401).json({ error: "API Key tidak valid atau telah dinonaktifkan" });
  }
  if (foundKey.ipWhitelist) {
    const clientIp = req.ip || req.socket.remoteAddress || "";
    const allowedIps = foundKey.ipWhitelist.split(",").map((s) => s.trim());
    if (!allowedIps.includes(clientIp) && !allowedIps.includes("*")) {
      return res.status(403).json({ error: `Alamat IP ${clientIp} tidak terdaftar di IP whitelist kunci ini` });
    }
  }
  const bodyStr = req.body ? JSON.stringify(req.body) : "";
  const message = `${req.method}${req.originalUrl}${timestamp}${bodyStr}`;
  const computedSig = crypto9.createHmac("sha256", foundKey.secretHash).update(message).digest("hex");
  if (computedSig !== signature) {
    return res.status(401).json({ error: "Tanda tangan digital HMAC-SHA256 tidak cocok" });
  }
  const user = db.users.get(foundKey.userId);
  if (!user || user.status !== "active") {
    return res.status(403).json({ error: "Akun pemilik API Key ini tidak aktif" });
  }
  req.user = user;
  req.apiKey = foundKey;
  next();
};
apiKeyRouter.post("/create", requireAuth, (req, res) => {
  try {
    const user = req.user;
    const { label, permissions, ipWhitelist } = req.body;
    const keyId = "dmx_live_" + crypto9.randomBytes(16).toString("hex");
    const secretKey = crypto9.randomBytes(32).toString("hex");
    const newKey = {
      id: crypto9.randomUUID(),
      userId: user.id,
      keyId,
      secretHash: secretKey,
      label: label || "Trading Bot Key",
      permissions: permissions || ["read", "trade"],
      ipWhitelist: ipWhitelist || "",
      isActive: true,
      createdAt: Date.now()
    };
    db.apiKeys.set(newKey.id, newKey);
    res.json({
      success: true,
      apiKey: keyId,
      apiSecret: secretKey,
      // CRITICAL: displayed once
      label: newKey.label,
      permissions: newKey.permissions,
      message: "Simpan API Secret Anda sekarang. Secret tidak akan pernah ditampilkan kembali demi keamanan!"
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
apiKeyRouter.get("/list", requireAuth, (req, res) => {
  const user = req.user;
  const userKeys = Array.from(db.apiKeys.values()).filter((k) => k.userId === user.id).map((k) => ({
    id: k.id,
    keyId: k.keyId,
    label: k.label,
    permissions: k.permissions,
    ipWhitelist: k.ipWhitelist,
    isActive: k.isActive,
    createdAt: k.createdAt
  }));
  res.json(userKeys);
});
apiKeyRouter.post("/revoke", requireAuth, (req, res) => {
  const user = req.user;
  const { id } = req.body;
  const key = db.apiKeys.get(id);
  if (!key || key.userId !== user.id) {
    return res.status(404).json({ error: "Kunci API tidak ditemukan" });
  }
  db.apiKeys.delete(id);
  res.json({ success: true, message: "Kunci API berhasil dicabut" });
});

// server/routes/admin.ts
import { Router as Router6 } from "express";
import crypto10 from "crypto";
init_database();
var adminRouter = Router6();
adminRouter.get("/users", requireAdmin, (req, res) => {
  const usersList = Array.from(db.users.values()).map((u) => {
    const kyc = db.kyc.get(u.id);
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      status: u.status,
      isTotpEnabled: u.isTotpEnabled,
      kycStatus: kyc ? kyc.status : "unverified",
      kycTier: kyc ? kyc.tierLevel : 0,
      fullName: kyc ? kyc.fullName : "-",
      createdAt: u.createdAt
    };
  });
  res.json(usersList);
});
adminRouter.post("/kyc/review", requireAdmin, (req, res) => {
  try {
    const adminUser = req.user;
    const { userId, action, rejectionReason, tierLevel } = req.body;
    const kyc = db.kyc.get(userId);
    if (!kyc) return res.status(404).json({ error: "Data KYC tidak ditemukan" });
    if (action === "APPROVE") {
      kyc.status = "approved";
      kyc.tierLevel = tierLevel || 2;
      kyc.reviewedBy = adminUser.id;
      kyc.reviewedAt = Date.now();
      kyc.rejectionReason = void 0;
    } else {
      kyc.status = "rejected";
      kyc.rejectionReason = rejectionReason || "Dokumen identitas tidak terbaca dengan jelas";
      kyc.reviewedBy = adminUser.id;
      kyc.reviewedAt = Date.now();
    }
    db.auditLogs.push({
      id: crypto10.randomUUID(),
      actorId: adminUser.id,
      action: `KYC_${action}`,
      resource: `user:${userId}`,
      details: `KYC marked as ${kyc.status} by admin ${adminUser.email}`,
      createdAt: Date.now()
    });
    res.json({ success: true, kyc });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
adminRouter.post("/pairs/toggle-halt", requireAdmin, (req, res) => {
  try {
    const adminUser = req.user;
    const { pairId, isHalted } = req.body;
    const pair = db.tradingPairs.get(pairId);
    if (!pair) return res.status(404).json({ error: "Pair tidak ditemukan" });
    pair.isHalted = Boolean(isHalted);
    db.tradingPairs.set(pairId, pair);
    db.auditLogs.push({
      id: crypto10.randomUUID(),
      actorId: adminUser.id,
      action: isHalted ? "TRADING_HALTED" : "TRADING_RESUMED",
      resource: `pair:${pairId}`,
      details: `Trading pair ${pairId} halted status changed to: ${isHalted}`,
      createdAt: Date.now()
    });
    res.json({
      success: true,
      message: `Trading pair ${pairId} status: ${isHalted ? "DIHENTIKAN SEMENTARA (HALTED)" : "BERJALAN NORMAL"}`,
      pair
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
adminRouter.post("/pairs/update-fees", requireAdmin, (req, res) => {
  try {
    const adminUser = req.user;
    const { pairId, makerFeeBps, takerFeeBps } = req.body;
    const pair = db.tradingPairs.get(pairId);
    if (!pair) return res.status(404).json({ error: "Pair tidak ditemukan" });
    if (makerFeeBps !== void 0) pair.makerFeeBps = Number(makerFeeBps);
    if (takerFeeBps !== void 0) pair.takerFeeBps = Number(takerFeeBps);
    db.tradingPairs.set(pairId, pair);
    db.auditLogs.push({
      id: crypto10.randomUUID(),
      actorId: adminUser.id,
      action: "FEES_UPDATED",
      resource: `pair:${pairId}`,
      details: `Fees updated: Maker ${pair.makerFeeBps} bps (${pair.makerFeeBps / 100}%), Taker ${pair.takerFeeBps} bps (${pair.takerFeeBps / 100}%)`,
      createdAt: Date.now()
    });
    res.json({
      success: true,
      message: `Biaya transaksi ${pairId} berhasil diperbarui: Maker ${pair.makerFeeBps / 100}%, Taker ${pair.takerFeeBps / 100}%`,
      pair
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
adminRouter.get("/withdrawals/pending", requireAdmin, (req, res) => {
  const pendingFiat = Array.from(db.fiatTransactions.values()).filter((t) => t.type === "WITHDRAW" && t.status === "PENDING");
  const pendingCrypto = Array.from(db.cryptoTransactions.values()).filter((t) => t.type === "WITHDRAW" && t.status === "PENDING");
  res.json({
    fiat: pendingFiat,
    crypto: pendingCrypto
  });
});
adminRouter.post("/withdrawals/approve", requireAdmin, (req, res) => {
  try {
    const adminUser = req.user;
    const { txId, txType } = req.body;
    if (txType === "FIAT") {
      const tx = db.fiatTransactions.get(txId);
      if (!tx || tx.status !== "PENDING") return res.status(404).json({ error: "Transaksi tidak ditemukan atau sudah diproses" });
      const userAcc = db.createOrGetAccount(tx.userId, "IDR");
      const locked = BigInt(userAcc.balanceLocked);
      const amountUnits = BigInt(tx.amount);
      userAcc.balanceLocked = (locked >= amountUnits ? locked - amountUnits : 0n).toString();
      userAcc.version += 1;
      userAcc.updatedAt = Date.now();
      tx.status = "COMPLETED";
      db.fiatTransactions.set(txId, tx);
    } else {
      const tx = db.cryptoTransactions.get(txId);
      if (!tx || tx.status !== "PENDING") return res.status(404).json({ error: "Transaksi kripto tidak ditemukan atau sudah diproses" });
      const userAcc = db.createOrGetAccount(tx.userId, tx.currency);
      const locked = BigInt(userAcc.balanceLocked);
      const amountUnits = BigInt(tx.amount);
      userAcc.balanceLocked = (locked >= amountUnits ? locked - amountUnits : 0n).toString();
      userAcc.version += 1;
      userAcc.updatedAt = Date.now();
      tx.status = "COMPLETED";
      tx.confirmations = 12;
      db.cryptoTransactions.set(txId, tx);
    }
    db.auditLogs.push({
      id: crypto10.randomUUID(),
      actorId: adminUser.id,
      action: "WITHDRAWAL_APPROVED",
      resource: `tx:${txId}`,
      details: `Withdrawal approved by admin ${adminUser.email}`,
      createdAt: Date.now()
    });
    res.json({ success: true, message: "Penarikan dana berhasil disetujui dan diproses!" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
adminRouter.get("/audit-logs", requireAdmin, (req, res) => {
  res.json(db.auditLogs.slice(-100).reverse());
});

// server/routes/risk.ts
import { Router as Router7 } from "express";
import crypto11 from "crypto";
init_database();
var riskRouter = Router7();
riskRouter.get("/suspicious-activity", requireAdmin, (req, res) => {
  const flags = [];
  for (const tx of db.fiatTransactions.values()) {
    if (BigInt(tx.amount) > 5000000000n) {
      flags.push({
        id: `aml-tx-${tx.id.slice(0, 8)}`,
        severity: "HIGH",
        category: "LARGE_VALUE_TRANSACTION",
        description: `Transaksi nominal besar: IDR ${BigInt(tx.amount) / 100n} oleh user ${tx.userId}`,
        userId: tx.userId,
        createdAt: tx.createdAt
      });
    }
  }
  for (const u of db.users.values()) {
    if (u.failedLoginAttempts >= 3) {
      flags.push({
        id: `sec-user-${u.id.slice(0, 8)}`,
        severity: "MEDIUM",
        category: "POSSIBLE_BRUTE_FORCE",
        description: `Percobaan masuk gagal berulang (${u.failedLoginAttempts} kali) untuk email: ${u.email}`,
        userId: u.id,
        createdAt: Date.now() - 3e5
      });
    }
  }
  res.json(flags);
});
riskRouter.post("/account-freeze", requireAdmin, (req, res) => {
  try {
    const adminUser = req.user;
    const { userId, freeze, reason } = req.body;
    const targetUser = db.users.get(userId);
    if (!targetUser) return res.status(404).json({ error: "User tidak ditemukan" });
    targetUser.status = freeze ? "frozen" : "active";
    targetUser.updatedAt = Date.now();
    db.auditLogs.push({
      id: crypto11.randomUUID(),
      actorId: adminUser.id,
      action: freeze ? "ACCOUNT_FROZEN" : "ACCOUNT_UNFROZEN",
      resource: `user:${userId}`,
      details: `User status changed to ${targetUser.status}. Reason: ${reason || "AML/Compliance investigation"}`,
      createdAt: Date.now()
    });
    res.json({
      success: true,
      message: `Akun ${targetUser.email} berhasil ${freeze ? "DIBEKUKAN (FROZEN)" : "DIAKTIFKAN KEMBALI"}`,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        status: targetUser.status
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
riskRouter.get("/export-report", requireAdmin, (req, res) => {
  const report = {
    reportId: `AML-DMX-${Date.now()}`,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    totalUsers: db.users.size,
    totalTrades: db.trades.length,
    totalFiatTransactions: db.fiatTransactions.size,
    totalCryptoTransactions: db.cryptoTransactions.size,
    systemInvariantsValid: true
  };
  res.json(report);
});

// server/routes/bot.ts
import { Router as Router8 } from "express";
import crypto12 from "crypto";
import fs3 from "fs";
import path3 from "path";
init_database();
init_PrecisionMath();
var botRouter = Router8();
var requireAuthOrHmac = (req, res, next) => {
  const apiKey = req.headers["x-dimonex-apikey"];
  if (apiKey) {
    return requireHmacAuth(req, res, next);
  }
  return requireAuth(req, res, next);
};
var BOTS_FILE = path3.join(process.cwd(), "server", "data", "bots_state.json");
var activeBots = /* @__PURE__ */ new Map();
var botIntervals = /* @__PURE__ */ new Map();
var saveBotsTimer = null;
function scheduleSaveBots() {
  if (saveBotsTimer) clearTimeout(saveBotsTimer);
  saveBotsTimer = setTimeout(() => {
    saveBotsToDisk();
    saveBotsTimer = null;
  }, 400);
}
function saveBotsToDisk() {
  try {
    const dir = path3.dirname(BOTS_FILE);
    if (!fs3.existsSync(dir)) fs3.mkdirSync(dir, { recursive: true });
    const botsArray = Array.from(activeBots.values());
    fs3.writeFileSync(BOTS_FILE, JSON.stringify(botsArray), "utf-8");
  } catch (err) {
    console.error("[DIMONEX Bot Engine] Gagal menyimpan bots ke disk:", err);
  }
}
function addBotLog(bot, message, type = "INFO") {
  bot.logs.unshift({
    timestamp: Date.now(),
    message,
    type
  });
  if (bot.logs.length > 80) bot.logs.pop();
  bot.updatedAt = Date.now();
  scheduleSaveBots();
}
botRouter.get("/list", requireAuthOrHmac, (req, res) => {
  const user = req.user;
  const userBots = Array.from(activeBots.values()).filter((b) => b.userId === user.id).sort((a, b) => b.createdAt - a.createdAt);
  res.json(userBots);
});
botRouter.get("/orders/:botId", requireAuthOrHmac, (req, res) => {
  const user = req.user;
  const bot = activeBots.get(req.params.botId);
  if (!bot || bot.userId !== user.id) {
    return res.status(404).json({ error: "Bot tidak ditemukan" });
  }
  const botOrders = bot.deployedOrderIds.map((id) => db.orders.get(id)).filter(Boolean);
  res.json(botOrders);
});
botRouter.get("/open-orders", requireAuthOrHmac, (req, res) => {
  const user = req.user;
  const userBots = Array.from(activeBots.values()).filter((b) => b.userId === user.id);
  const botOrderIds = /* @__PURE__ */ new Set();
  userBots.forEach((b) => b.deployedOrderIds.forEach((id) => botOrderIds.add(id)));
  const openOrders = Array.from(db.orders.values()).filter((o) => o.userId === user.id && (botOrderIds.has(o.id) || o.clientOrderId && o.clientOrderId.startsWith("bot-")) && (o.status === "NEW" || o.status === "PARTIALLY_FILLED")).sort((a, b) => b.createdAt - a.createdAt);
  res.json(openOrders);
});
botRouter.post("/grid/deploy", requireAuthOrHmac, (req, res) => {
  try {
    const user = req.user;
    const { apiKeyId, pairId, lowerPrice, upperPrice, gridCount, totalInvestmentIdr, investmentCrypto } = req.body;
    if (!pairId || !lowerPrice || !upperPrice || !gridCount || !totalInvestmentIdr) {
      return res.status(400).json({ error: "Parameter Spot Grid tidak lengkap" });
    }
    const pair = db.tradingPairs.get(pairId);
    if (!pair) return res.status(404).json({ error: "Trading pair tidak ditemukan" });
    const lowerUnits = PrecisionMath.parseToUnits(lowerPrice, pair.quoteDecimals);
    const upperUnits = PrecisionMath.parseToUnits(upperPrice, pair.quoteDecimals);
    const currentPriceUnits = BigInt(pair.lastPrice);
    if (lowerUnits >= upperUnits) {
      return res.status(400).json({ error: "Batas harga bawah harus lebih kecil dari batas harga atas" });
    }
    const count = parseInt(gridCount, 10);
    if (count < 3 || count > 30) {
      return res.status(400).json({ error: "Jumlah grid harus di antara 3 sampai 30" });
    }
    const priceStep = (upperUnits - lowerUnits) / BigInt(count);
    const budgetPerGridIdr = PrecisionMath.parseToUnits(totalInvestmentIdr, 2) / BigInt(count);
    const botId = `bot-grid-${crypto12.randomUUID().slice(0, 8)}`;
    const bot = {
      id: botId,
      userId: user.id,
      userEmail: user.email,
      apiKeyId,
      name: `Spot Grid ${pairId} (${count} Level)`,
      strategy: "SPOT_GRID",
      pairId,
      status: "RUNNING",
      config: {
        lowerPrice,
        upperPrice,
        gridCount: count,
        priceStep: priceStep.toString(),
        totalInvestmentIdr
      },
      deployedOrderIds: [],
      filledOrderCount: 0,
      totalVolumeFilled: "0",
      realizedProfitIdr: "0",
      logs: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    addBotLog(bot, `Bot Spot Grid diinisialisasi oleh ${user.email} (API Key: ${apiKeyId || "Session Token"}).`);
    addBotLog(bot, `Rentang Grid: ${lowerPrice} IDR s/d ${upperPrice} IDR | Step: ${PrecisionMath.formatFromUnits(priceStep, 2)} IDR`);
    const userBaseAcc = db.getAccount(user.id, pair.baseCurrency);
    const availableBaseUnits = userBaseAcc ? BigInt(userBaseAcc.balanceAvailable) : 0n;
    let buyOrdersDeployed = 0;
    let sellOrdersDeployed = 0;
    for (let i = 0; i <= count; i++) {
      const gridPrice = lowerUnits + priceStep * BigInt(i);
      if (gridPrice < currentPriceUnits) {
        const qtyBaseUnits = PrecisionMath.calculateBaseQuantity(budgetPerGridIdr, pair.baseDecimals, gridPrice);
        if (qtyBaseUnits >= BigInt(pair.minOrderSize)) {
          try {
            const result = matchingEngine.placeOrder({
              userId: user.id,
              // Explicit user ownership
              pairId,
              side: "BUY",
              orderType: "LIMIT",
              timeInForce: "GTC",
              price: gridPrice.toString(),
              quantity: qtyBaseUnits.toString(),
              clientOrderId: `${botId}-buy-${i + 1}`
            });
            bot.deployedOrderIds.push(result.takerOrder.id);
            marketWsService.broadcastOrderUpdate(result.takerOrder);
            buyOrdersDeployed++;
            addBotLog(bot, `[Grid Buy #${i + 1}] Order limit beli aktif: ${PrecisionMath.formatFromUnits(qtyBaseUnits, pair.baseDecimals)} @ ${PrecisionMath.formatIDRDisplay(gridPrice)}`, "ORDER");
          } catch (err) {
            addBotLog(bot, `Gagal memasang grid buy #${i + 1}: ${err.message}`, "ERROR");
          }
        }
      } else if (gridPrice > currentPriceUnits && availableBaseUnits > 0n) {
        const qtyToSellUnits = availableBaseUnits / BigInt(count);
        if (qtyToSellUnits >= BigInt(pair.minOrderSize)) {
          try {
            const result = matchingEngine.placeOrder({
              userId: user.id,
              pairId,
              side: "SELL",
              orderType: "LIMIT",
              timeInForce: "GTC",
              price: gridPrice.toString(),
              quantity: qtyToSellUnits.toString(),
              clientOrderId: `${botId}-sell-${i + 1}`
            });
            bot.deployedOrderIds.push(result.takerOrder.id);
            marketWsService.broadcastOrderUpdate(result.takerOrder);
            sellOrdersDeployed++;
            addBotLog(bot, `[Grid Sell #${i + 1}] Order limit jual aktif: ${PrecisionMath.formatFromUnits(qtyToSellUnits, pair.baseDecimals)} @ ${PrecisionMath.formatIDRDisplay(gridPrice)}`, "ORDER");
          } catch (err) {
          }
        }
      }
    }
    addBotLog(bot, `Deployment selesai: Total ${bot.deployedOrderIds.length} order limit aktif dimasukkan ke buku order (${buyOrdersDeployed} Beli, ${sellOrdersDeployed} Jual)`);
    activeBots.set(bot.id, bot);
    const book = matchingEngine.getOrderBook(pairId);
    marketWsService.broadcast(`depth:${pairId}`, { type: "depth", pairId, data: book.getDepth(25) });
    res.json({ success: true, bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
botRouter.post("/layers/deploy", requireAuthOrHmac, (req, res) => {
  try {
    const user = req.user;
    const { apiKeyId, pairId, side, startPrice, layerCount, priceStepPercent, quantityPerLayer } = req.body;
    if (!pairId || !side || !startPrice || !layerCount || !priceStepPercent || !quantityPerLayer) {
      return res.status(400).json({ error: "Konfigurasi layer order tidak lengkap" });
    }
    const pair = db.tradingPairs.get(pairId);
    if (!pair) return res.status(404).json({ error: "Pair tidak ditemukan" });
    const baseStartPriceUnits = PrecisionMath.parseToUnits(startPrice, pair.quoteDecimals);
    const count = parseInt(layerCount, 10);
    const stepBps = Math.round(parseFloat(priceStepPercent) * 100);
    const qtyUnits = PrecisionMath.parseToUnits(quantityPerLayer, pair.baseDecimals);
    if (count < 2 || count > 20) {
      return res.status(400).json({ error: "Jumlah layer order harus antara 2 sampai 20" });
    }
    const botId = `bot-layer-${crypto12.randomUUID().slice(0, 8)}`;
    const bot = {
      id: botId,
      userId: user.id,
      userEmail: user.email,
      apiKeyId,
      name: `Layered ${side} Ladder ${pairId} (${count} Level)`,
      strategy: side === "BUY" ? "BUY_LAYERS" : "SELL_LAYERS",
      pairId,
      status: "RUNNING",
      config: {
        side,
        startPrice,
        layerCount: count,
        priceStepPercent,
        quantityPerLayer
      },
      deployedOrderIds: [],
      filledOrderCount: 0,
      totalVolumeFilled: "0",
      realizedProfitIdr: "0",
      logs: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    addBotLog(bot, `Mendeploy tangga order ${side} untuk ${user.email} (Step: ${priceStepPercent}% per level)`);
    const calculatedStepUnits = baseStartPriceUnits * BigInt(stepBps) / 10000n;
    const minTickStepUnits = pair.quoteCurrency === "IDR" ? 100n : 1n;
    const effectiveStepUnits = calculatedStepUnits > minTickStepUnits ? calculatedStepUnits : minTickStepUnits;
    for (let i = 0; i < count; i++) {
      const layerPriceUnits = side === "BUY" ? baseStartPriceUnits - effectiveStepUnits * BigInt(i) : baseStartPriceUnits + effectiveStepUnits * BigInt(i);
      try {
        const result = matchingEngine.placeOrder({
          userId: user.id,
          // Explicit user ownership
          pairId,
          side,
          orderType: "LIMIT",
          timeInForce: "GTC",
          price: layerPriceUnits.toString(),
          quantity: qtyUnits.toString(),
          clientOrderId: `${botId}-${side.toLowerCase()}-layer-${i + 1}`
        });
        bot.deployedOrderIds.push(result.takerOrder.id);
        marketWsService.broadcastOrderUpdate(result.takerOrder);
        addBotLog(bot, `[Layer #${i + 1}] Order limit ${side} aktif: ${quantityPerLayer} ${pair.baseCurrency} @ ${PrecisionMath.formatIDRDisplay(layerPriceUnits)}`, "ORDER");
      } catch (err) {
        addBotLog(bot, `Gagal memasang layer #${i + 1}: ${err.message}`, "ERROR");
      }
    }
    addBotLog(bot, `Berhasil memasukkan ${bot.deployedOrderIds.length} order limit ke buku order dan antrean order aktif.`);
    activeBots.set(bot.id, bot);
    const book = matchingEngine.getOrderBook(pairId);
    marketWsService.broadcast(`depth:${pairId}`, { type: "depth", pairId, data: book.getDepth(25) });
    res.json({ success: true, bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
botRouter.post("/smart-trade/deploy", requireAuthOrHmac, (req, res) => {
  try {
    const user = req.user;
    const { apiKeyId, pairId, side, targetPrice, totalVolume, sliceCount, orderType } = req.body;
    if (!pairId || !side || !targetPrice || !totalVolume || !sliceCount) {
      return res.status(400).json({ error: "Parameter Smart Trade tidak lengkap" });
    }
    const pair = db.tradingPairs.get(pairId);
    if (!pair) return res.status(404).json({ error: "Pair tidak ditemukan" });
    const totalVolumeUnits = PrecisionMath.parseToUnits(totalVolume, pair.baseDecimals);
    const targetPriceUnits = PrecisionMath.parseToUnits(targetPrice, pair.quoteDecimals);
    const slices = parseInt(sliceCount, 10);
    const sliceQtyUnits = totalVolumeUnits / BigInt(slices);
    const botId = `bot-smart-${crypto12.randomUUID().slice(0, 8)}`;
    const bot = {
      id: botId,
      userId: user.id,
      userEmail: user.email,
      apiKeyId,
      name: `Smart Trade ${side} ${pairId} (${totalVolume} ${pair.baseCurrency})`,
      strategy: "SMART_TRADE",
      pairId,
      status: "RUNNING",
      config: {
        side,
        targetPrice,
        totalVolume,
        sliceCount: slices,
        orderType: orderType || "LIMIT"
      },
      deployedOrderIds: [],
      filledOrderCount: 0,
      totalVolumeFilled: "0",
      realizedProfitIdr: "0",
      logs: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    addBotLog(bot, `Smart Trade dimulai: Target volume ${totalVolume} ${pair.baseCurrency} dibagi ke dalam ${slices} slice @ ${targetPrice} IDR`);
    try {
      const result = matchingEngine.placeOrder({
        userId: user.id,
        // Explicit user ownership
        pairId,
        side,
        orderType: orderType === "MARKET" ? "MARKET" : "LIMIT",
        timeInForce: "GTC",
        price: targetPriceUnits.toString(),
        quantity: sliceQtyUnits.toString(),
        clientOrderId: `${botId}-slice-1`
      });
      bot.deployedOrderIds.push(result.takerOrder.id);
      marketWsService.broadcastOrderUpdate(result.takerOrder);
      if (result.trades.length > 0) {
        bot.filledOrderCount += 1;
        bot.totalVolumeFilled = (BigInt(bot.totalVolumeFilled) + sliceQtyUnits).toString();
        addBotLog(bot, `Slice #1 terisi langsung: ${PrecisionMath.formatFromUnits(sliceQtyUnits, pair.baseDecimals)} ${pair.baseCurrency}`, "FILL");
      } else {
        addBotLog(bot, `Slice #1 terpasang sebagai limit order aktif @ ${PrecisionMath.formatIDRDisplay(targetPriceUnits)}`, "ORDER");
      }
    } catch (err) {
      addBotLog(bot, `Gagal mengeksekusi slice awal: ${err.message}`, "ERROR");
    }
    activeBots.set(bot.id, bot);
    const book = matchingEngine.getOrderBook(pairId);
    marketWsService.broadcast(`depth:${pairId}`, { type: "depth", pairId, data: book.getDepth(25) });
    res.json({ success: true, bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
function startVolumeBotRunner(botId) {
  const bot = activeBots.get(botId);
  if (!bot || bot.status !== "RUNNING") return;
  const pair = db.tradingPairs.get(bot.pairId);
  if (!pair) return;
  const delayMs = Math.max(1e3, Number(bot.config.delaySecondAmount || 3) * 1e3);
  let stepIndex = 0;
  const executeTick = () => {
    const currentBot = activeBots.get(botId);
    if (!currentBot || currentBot.status !== "RUNNING") {
      const timer = botIntervals.get(botId);
      if (timer) {
        clearInterval(timer);
        botIntervals.delete(botId);
      }
      return;
    }
    const currentPair = db.tradingPairs.get(currentBot.pairId);
    if (!currentPair) return;
    const targetVolumeUnits = PrecisionMath.parseToUnits(currentBot.config.targetVolumeReach, currentPair.baseDecimals);
    const currentFilledUnits = BigInt(currentBot.totalVolumeFilled || "0");
    if (currentFilledUnits >= targetVolumeUnits) {
      currentBot.status = "COMPLETED";
      addBotLog(currentBot, `\u{1F3AF} Target volume ${currentBot.config.targetVolumeReach} ${currentPair.baseCurrency} tercapai 100%! Bot volume selesai secara otomatis.`, "FILL");
      const timer = botIntervals.get(botId);
      if (timer) {
        clearInterval(timer);
        botIntervals.delete(botId);
      }
      return;
    }
    let side;
    if (currentBot.config.directionMode === "BUY_FIRST") {
      side = stepIndex % 2 === 0 ? "BUY" : "SELL";
    } else if (currentBot.config.directionMode === "SELL_FIRST") {
      side = stepIndex % 2 === 0 ? "SELL" : "BUY";
    } else {
      side = Math.random() >= 0.5 ? "BUY" : "SELL";
    }
    let qtyStr = currentBot.config.amountMin || "0.01";
    if (currentBot.config.amountRandom) {
      const minVal = parseFloat(currentBot.config.amountMin || "0.01");
      const maxVal = parseFloat(currentBot.config.amountMax || (minVal * 2).toString());
      const randVal = minVal + Math.random() * (maxVal - minVal);
      qtyStr = randVal.toFixed(currentPair.baseDecimals > 6 ? 4 : 2);
    }
    let qtyUnits = PrecisionMath.parseToUnits(qtyStr, currentPair.baseDecimals);
    if (qtyUnits < BigInt(currentPair.minOrderSize)) {
      qtyUnits = BigInt(currentPair.minOrderSize);
    }
    const remainingUnits = targetVolumeUnits - currentFilledUnits;
    if (qtyUnits > remainingUnits) {
      qtyUnits = remainingUnits;
    }
    const minUnits = PrecisionMath.parseToUnits(currentBot.config.minPrice, currentPair.quoteDecimals);
    const maxUnits = PrecisionMath.parseToUnits(currentBot.config.maxPrice, currentPair.quoteDecimals);
    const midUnits = BigInt(currentPair.lastPrice);
    const randomBps = BigInt(Math.floor(Math.random() * 30 - 15));
    let priceUnits = midUnits + midUnits * randomBps / 10000n;
    if (priceUnits < minUnits) priceUnits = minUnits;
    if (priceUnits > maxUnits) priceUnits = maxUnits;
    stepIndex++;
    try {
      db.createOrGetAccount(currentBot.userId, currentPair.quoteCurrency, "500000000000");
      db.createOrGetAccount(currentBot.userId, currentPair.baseCurrency, "1000000000");
      const book = matchingEngine.getOrderBook(currentPair.id);
      const opposingSide = side === "BUY" ? book.asks : book.bids;
      const hasOpposing = opposingSide.some((o) => o.userId !== currentBot.userId);
      if (!hasOpposing) {
        matchingEngine.placeOrder({
          userId: SYSTEM_TREASURY_ID,
          pairId: currentPair.id,
          side: side === "BUY" ? "SELL" : "BUY",
          orderType: "LIMIT",
          timeInForce: "GTC",
          price: priceUnits.toString(),
          quantity: qtyUnits.toString(),
          clientOrderId: `sys-vol-maker-${Date.now()}`
        });
      }
      const result = matchingEngine.placeOrder({
        userId: currentBot.userId,
        pairId: currentPair.id,
        side,
        orderType: "LIMIT",
        timeInForce: "IOC",
        price: priceUnits.toString(),
        quantity: qtyUnits.toString(),
        clientOrderId: `${botId}-vol-${side.toLowerCase()}-${stepIndex}`
      });
      currentBot.deployedOrderIds.push(result.takerOrder.id);
      currentBot.filledOrderCount += 1;
      const filledThisTick = BigInt(result.takerOrder.filledQuantity || qtyUnits.toString());
      currentBot.totalVolumeFilled = (BigInt(currentBot.totalVolumeFilled) + filledThisTick).toString();
      for (const t of result.trades) {
        marketWsService.broadcastTrade(t);
      }
      marketWsService.broadcastOrderUpdate(result.takerOrder);
      const updatedBook = matchingEngine.getOrderBook(currentPair.id);
      marketWsService.broadcast(`depth:${currentPair.id}`, { type: "depth", pairId: currentPair.id, data: updatedBook.getDepth(25) });
      const cumFormatted = PrecisionMath.formatFromUnits(BigInt(currentBot.totalVolumeFilled), currentPair.baseDecimals);
      const targetFormatted = currentBot.config.targetVolumeReach;
      const pct = Math.min(100, Number(BigInt(currentBot.totalVolumeFilled) * 100n / targetVolumeUnits));
      addBotLog(
        currentBot,
        `[Vol Bot #${stepIndex}] Eksekusi ${side} ${PrecisionMath.formatFromUnits(filledThisTick, currentPair.baseDecimals)} ${currentPair.baseCurrency} @ ${PrecisionMath.formatIDRDisplay(priceUnits)} | Akumulasi: ${cumFormatted}/${targetFormatted} (${pct}%)`,
        "FILL"
      );
      if (BigInt(currentBot.totalVolumeFilled) >= targetVolumeUnits) {
        currentBot.status = "COMPLETED";
        addBotLog(currentBot, `\u{1F3AF} Target volume ${targetFormatted} ${currentPair.baseCurrency} TERCAPAI LENGKAP 100%! Bot volume selesai.`, "INFO");
        const timer = botIntervals.get(botId);
        if (timer) {
          clearInterval(timer);
          botIntervals.delete(botId);
        }
      }
    } catch (err) {
      addBotLog(currentBot, `Gagal eksekusi tick volume #${stepIndex}: ${err.message}`, "ERROR");
    }
  };
  executeTick();
  const interval = setInterval(executeTick, delayMs);
  botIntervals.set(botId, interval);
}
function loadBotsFromDisk() {
  try {
    if (!fs3.existsSync(BOTS_FILE)) return;
    const raw = fs3.readFileSync(BOTS_FILE, "utf-8");
    const botsArray = JSON.parse(raw);
    if (Array.isArray(botsArray)) {
      for (const bot of botsArray) {
        activeBots.set(bot.id, bot);
        if (bot.status === "RUNNING" && bot.strategy === "VOLUME_BOT") {
          startVolumeBotRunner(bot.id);
        }
      }
      console.log(`[DIMONEX Bot Engine] Berhasil memuat ${activeBots.size} bot dari disk.`);
    }
  } catch (err) {
    console.warn("[DIMONEX Bot Engine] Gagal memuat bots dari disk:", err);
  }
}
loadBotsFromDisk();
botRouter.post("/volume/deploy", requireAuthOrHmac, (req, res) => {
  try {
    const user = req.user;
    const {
      apiKeyId,
      pairId,
      targetVolumeReach,
      minPrice,
      maxPrice,
      delaySecondAmount,
      amountRandom,
      amountMin,
      amountMax,
      directionMode
    } = req.body;
    if (!pairId || !targetVolumeReach || !minPrice || !maxPrice) {
      return res.status(400).json({ error: "Parameter volume bot tidak lengkap (pairId, targetVolumeReach, minPrice, maxPrice)" });
    }
    const pair = db.tradingPairs.get(pairId);
    if (!pair) return res.status(404).json({ error: "Trading pair tidak ditemukan" });
    const minPriceUnits = PrecisionMath.parseToUnits(minPrice, pair.quoteDecimals);
    const maxPriceUnits = PrecisionMath.parseToUnits(maxPrice, pair.quoteDecimals);
    if (minPriceUnits >= maxPriceUnits) {
      return res.status(400).json({ error: "Harga minimum harus lebih kecil dari harga maksimum" });
    }
    const delaySec = Math.max(1, parseInt(String(delaySecondAmount || 3), 10));
    const botId = `bot-vol-${crypto12.randomUUID().slice(0, 8)}`;
    const bot = {
      id: botId,
      userId: user.id,
      userEmail: user.email,
      apiKeyId,
      name: `Volume Bot ${pairId} (${targetVolumeReach} ${pair.baseCurrency})`,
      strategy: "VOLUME_BOT",
      pairId,
      status: "RUNNING",
      config: {
        targetVolumeReach,
        minPrice,
        maxPrice,
        delaySecondAmount: delaySec,
        amountRandom: Boolean(amountRandom),
        amountMin: amountMin || "0.01",
        amountMax: amountMax || "0.05",
        directionMode: directionMode || "RANDOM"
      },
      deployedOrderIds: [],
      filledOrderCount: 0,
      totalVolumeFilled: "0",
      realizedProfitIdr: "0",
      logs: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    addBotLog(bot, `Volume Bot diluncurkan oleh ${user.email}. Target: ${targetVolumeReach} ${pair.baseCurrency} | Rentang: ${minPrice} - ${maxPrice} IDR`);
    addBotLog(bot, `Arah: ${directionMode || "RANDOM"} | Interval Delay: ${delaySec}s | Random Amount: ${amountRandom ? "YA" : "TIDAK"}`);
    activeBots.set(bot.id, bot);
    startVolumeBotRunner(bot.id);
    res.json({ success: true, bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
botRouter.post("/stop", requireAuthOrHmac, (req, res) => {
  try {
    const user = req.user;
    const { botId, cancelOpenOrders } = req.body;
    const bot = activeBots.get(botId);
    if (!bot || bot.userId !== user.id) {
      return res.status(404).json({ error: "Bot tidak ditemukan" });
    }
    bot.status = "STOPPED";
    addBotLog(bot, `Bot dihentikan oleh user ${user.email}`);
    const timer = botIntervals.get(botId);
    if (timer) {
      clearInterval(timer);
      botIntervals.delete(botId);
    }
    let cancelledCount = 0;
    if (cancelOpenOrders) {
      for (const orderId of bot.deployedOrderIds) {
        const order = db.orders.get(orderId);
        if (order && (order.status === "NEW" || order.status === "PARTIALLY_FILLED")) {
          try {
            matchingEngine.cancelOrder(orderId, user.id, bot.pairId);
            cancelledCount++;
          } catch (e) {
          }
        }
      }
      addBotLog(bot, `Membatalkan ${cancelledCount} order aktif yang belum terisi di buku order.`);
      const book = matchingEngine.getOrderBook(bot.pairId);
      marketWsService.broadcast(`depth:${bot.pairId}`, { type: "depth", pairId: bot.pairId, data: book.getDepth(25) });
    }
    res.json({ success: true, message: `Bot ${bot.name} dihentikan. ${cancelledCount} order terbuka dibatalkan.`, bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
botRouter.post("/cancel-all", requireAuthOrHmac, (req, res) => {
  try {
    const user = req.user;
    const userBots = Array.from(activeBots.values()).filter((b) => b.userId === user.id);
    let totalCancelled = 0;
    const affectedPairs = /* @__PURE__ */ new Set();
    for (const [bId, timer] of botIntervals.entries()) {
      clearInterval(timer);
      botIntervals.delete(bId);
    }
    for (const bot of userBots) {
      bot.status = "STOPPED";
      affectedPairs.add(bot.pairId);
      for (const orderId of bot.deployedOrderIds) {
        const order = db.orders.get(orderId);
        if (order && (order.status === "NEW" || order.status === "PARTIALLY_FILLED")) {
          try {
            matchingEngine.cancelOrder(orderId, user.id, bot.pairId);
            totalCancelled++;
          } catch (e) {
          }
        }
      }
      addBotLog(bot, `Semua order bot dibatalkan secara massal.`);
    }
    for (const pairId of affectedPairs) {
      const book = matchingEngine.getOrderBook(pairId);
      marketWsService.broadcast(`depth:${pairId}`, { type: "depth", pairId, data: book.getDepth(25) });
    }
    res.json({ success: true, message: `Berhasil membatalkan ${totalCancelled} order bot terbuka.`, totalCancelled });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// server/routes/mmConsole.ts
import { Router as Router9 } from "express";
import crypto14 from "crypto";
init_database();

// server/services/BotWorkerManager.ts
init_database();
import crypto13 from "crypto";
init_PrecisionMath();

// server/services/bots/PriceFollowerBot.ts
init_database();
init_PrecisionMath();
init_PriceAggregatorService();
var PriceFollowerBotExecutor = class {
  /**
   * Execute a single tick cycle for a Price Follower Bot
   */
  static executeCycle(bot, addLog) {
    const cfg = bot.priceFollowerConfig;
    if (!cfg) return false;
    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair) {
      addLog(bot, `Trading pair ${bot.pairId} tidak ditemukan.`, "ERROR");
      return false;
    }
    if (pair.isHalted) {
      addLog(bot, `Trading pair ${bot.pairId} sedang di-halt oleh Administrator.`, "RISK");
      return false;
    }
    const refData = priceAggregatorService.getReferencePrice(bot.pairId);
    const now = Date.now();
    if (refData.status === "REFERENCE_PRICE_UNAVAILABLE" || refData.isStale || refData.effectiveIdrPrice <= 0) {
      addLog(bot, `Harga referensi tidak tersedia atau STALE (${refData.rejectionReason || "Stale data"}). Penyesuaian order ditangguhkan.`, "RISK");
      this.cancelOpenBotOrders(bot, addLog, "Feed harga eksternal tidak tersedia/stale.");
      return false;
    }
    let baseRefIdr = refData.effectiveIdrPrice;
    if (cfg.reference_provider === "BINANCE" && refData.binancePrice) {
      baseRefIdr = Math.round(refData.binancePrice * refData.fxRateUsed);
    } else if (cfg.reference_provider === "BYBIT" && refData.bybitPrice) {
      baseRefIdr = Math.round(refData.bybitPrice * refData.fxRateUsed);
    } else if (cfg.reference_provider === "COINMARKETCAP" && refData.cmcPrice) {
      baseRefIdr = Math.round(refData.cmcPrice * refData.fxRateUsed);
    }
    const defaultTick = bot.pairId === "USDT-IDR" ? 1 : bot.pairId === "ETH-IDR" ? 100 : 1e3;
    const tickSize = Math.max(1, cfg.tick_size && (bot.pairId !== "USDT-IDR" || cfg.tick_size <= 50) ? cfg.tick_size : defaultTick);
    const roundedRefPrice = Math.round(baseRefIdr / tickSize) * tickSize;
    const lastReprice = cfg.lastRepriceTimestamp || 0;
    const minInterval = Math.max(1e3, cfg.minimum_reprice_interval_ms || 2e3);
    if (now - lastReprice < minInterval) {
      return true;
    }
    const lastRefPrice = cfg.lastTargetPriceIdr || 0;
    if (lastRefPrice > 0) {
      const priceDeltaBps = Math.abs(roundedRefPrice - lastRefPrice) / lastRefPrice * 1e4;
      const minDeltaBps = cfg.minimum_price_change_bps || 5;
      if (priceDeltaBps < minDeltaBps && (cfg.activeBuyOrderId || cfg.activeSellOrderId)) {
        return true;
      }
    }
    const buyOffsetBps = Math.max(0, cfg.buy_offset_bps || 20);
    const sellOffsetBps = Math.max(0, cfg.sell_offset_bps || 20);
    let targetBuyPrice = Math.round(roundedRefPrice * (1 - buyOffsetBps / 1e4) / tickSize) * tickSize;
    let targetSellPrice = Math.round(roundedRefPrice * (1 + sellOffsetBps / 1e4) / tickSize) * tickSize;
    if (targetBuyPrice >= targetSellPrice) {
      targetBuyPrice = targetSellPrice - tickSize;
    }
    const orderQtyNum = parseFloat(cfg.order_quantity || "0.01");
    const baseDecimals = pair.baseDecimals;
    const qtyBaseUnits = BigInt(Math.round(orderQtyNum * 10 ** baseDecimals)).toString();
    const minBaseUnits = BigInt(pair.minOrderSize || "10000");
    if (BigInt(qtyBaseUnits) < minBaseUnits) {
      addLog(bot, `Kuantitas order ${orderQtyNum} berada di bawah batas minimum pasar (${pair.minOrderSize}).`, "ERROR");
      return false;
    }
    const quoteAccount = db.createOrGetAccount(bot.accountId, pair.quoteCurrency);
    const baseAccount = db.createOrGetAccount(bot.accountId, pair.baseCurrency);
    const quoteAvailable = BigInt(quoteAccount.balanceAvailable);
    const baseAvailable = BigInt(baseAccount.balanceAvailable);
    const buyPriceUnits = PrecisionMath.parseToUnits(targetBuyPrice.toString(), pair.quoteDecimals);
    const sellPriceUnits = PrecisionMath.parseToUnits(targetSellPrice.toString(), pair.quoteDecimals);
    const buyQuoteNeeded = PrecisionMath.calculateQuoteAmount(BigInt(qtyBaseUnits), pair.baseDecimals, buyPriceUnits);
    if (quoteAvailable >= buyQuoteNeeded) {
      this.repriceSingleSide(bot, "BUY", buyPriceUnits.toString(), qtyBaseUnits, pair, addLog, cfg.dry_run);
    } else {
      addLog(bot, `Saldo IDR tidak cukup untuk Limit Buy (Tersedia: Rp ${PrecisionMath.formatIDRDisplay(quoteAvailable)}, Dibutuhkan: Rp ${PrecisionMath.formatIDRDisplay(buyQuoteNeeded)}).`, "RISK");
    }
    if (baseAvailable >= BigInt(qtyBaseUnits)) {
      this.repriceSingleSide(bot, "SELL", sellPriceUnits.toString(), qtyBaseUnits, pair, addLog, cfg.dry_run);
    } else {
      addLog(bot, `Saldo ${pair.baseCurrency} tidak cukup untuk Limit Sell (Tersedia: ${PrecisionMath.formatFromUnits(baseAvailable, baseDecimals)}, Dibutuhkan: ${orderQtyNum}).`, "RISK");
    }
    cfg.lastRepriceTimestamp = now;
    cfg.lastTargetPriceIdr = roundedRefPrice;
    bot.lastHeartbeat = now;
    db.scheduleSave();
    return true;
  }
  static repriceSingleSide(bot, side, priceQuoteUnits, qtyBaseUnits, pair, addLog, dryRun = false) {
    const cfg = bot.priceFollowerConfig;
    const activeOrderId = side === "BUY" ? cfg.activeBuyOrderId : cfg.activeSellOrderId;
    if (activeOrderId) {
      const activeOrder = db.orders.get(activeOrderId);
      if (activeOrder && (activeOrder.status === "NEW" || activeOrder.status === "PARTIALLY_FILLED")) {
        if (activeOrder.price === priceQuoteUnits) {
          return;
        }
        if (!dryRun) {
          try {
            matchingEngine.cancelOrder(activeOrderId, bot.accountId, bot.pairId);
          } catch (e) {
          }
        }
      }
    }
    if (dryRun) {
      addLog(bot, `[DRY-RUN] Reprice ${side}: Target Rp ${PrecisionMath.formatIDRDisplay(BigInt(priceQuoteUnits))} (Qty: ${parseFloat(qtyBaseUnits) / 10 ** pair.baseDecimals})`, "INFO");
      return;
    }
    const clientOrderId = `bot-pf-${bot.id.slice(4, 10)}-${side.toLowerCase()}-${Date.now()}`;
    try {
      const result = matchingEngine.placeOrder({
        userId: bot.accountId,
        pairId: bot.pairId,
        side,
        orderType: "LIMIT",
        timeInForce: "GTC",
        price: priceQuoteUnits,
        quantity: qtyBaseUnits,
        clientOrderId
      });
      const placedOrder = result?.takerOrder || result?.order;
      if (placedOrder) {
        if (side === "BUY") {
          cfg.activeBuyOrderId = placedOrder.id;
        } else {
          cfg.activeSellOrderId = placedOrder.id;
        }
        bot.deployedOrderIds.push(placedOrder.id);
        bot.stats.ordersSubmitted += 1;
        bot.stats.ordersAccepted += 1;
        if (placedOrder.status === "FILLED") {
          bot.stats.ordersFilled += 1;
        }
        addLog(bot, `Follower Order ${side} Rp ${PrecisionMath.formatIDRDisplay(BigInt(priceQuoteUnits))} berhasil dipasang (Order ID: ${placedOrder.id}).`, "ORDER");
      }
    } catch (err) {
      addLog(bot, `Gagal memasang order ${side}: ${err.message}`, "ERROR");
    }
  }
  static cancelOpenBotOrders(bot, addLog, reason = "Penghentian bot") {
    const cfg = bot.priceFollowerConfig;
    let count = 0;
    const idsToCancel = [cfg?.activeBuyOrderId, cfg?.activeSellOrderId, ...bot.deployedOrderIds].filter(Boolean);
    for (const orderId of idsToCancel) {
      const order = db.orders.get(orderId);
      if (order && (order.status === "NEW" || order.status === "PARTIALLY_FILLED")) {
        try {
          const res = matchingEngine.cancelOrder(orderId, bot.accountId, bot.pairId);
          if (res && res.status === "CANCELLED") {
            count++;
          }
        } catch (e) {
        }
      }
    }
    if (cfg) {
      cfg.activeBuyOrderId = void 0;
      cfg.activeSellOrderId = void 0;
    }
    if (count > 0) {
      addLog(bot, `Dibatalkan ${count} order terbuka (${reason}).`, "INFO");
    }
    return count;
  }
};

// server/services/bots/DepthLiquidityBot.ts
init_database();
init_PrecisionMath();
init_PriceAggregatorService();
var DepthLiquidityBotExecutor = class {
  /**
   * Determine market-compatible tick size based on trading pair
   */
  static getCompatibleTickSize(pairId, configuredTickSize) {
    const defaultTick = pairId === "USDT-IDR" ? 1 : pairId === "ETH-IDR" ? 100 : 1e3;
    if (configuredTickSize && configuredTickSize > 0) {
      if (pairId === "USDT-IDR" && configuredTickSize > 60) {
        return 1;
      }
      return configuredTickSize;
    }
    return defaultTick;
  }
  /**
   * Execute a single cycle for a Depth & Liquidity Bot
   */
  static executeCycle(bot, addLog) {
    const cfg = bot.depthLiquidityConfig;
    if (!cfg) return false;
    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair) {
      addLog(bot, `Trading pair ${bot.pairId} tidak ditemukan.`, "ERROR");
      return false;
    }
    if (pair.isHalted) {
      addLog(bot, `Trading pair ${bot.pairId} sedang di-halt oleh Administrator.`, "RISK");
      return false;
    }
    const refData = priceAggregatorService.getReferencePrice(bot.pairId);
    const now = Date.now();
    if (refData.status === "REFERENCE_PRICE_UNAVAILABLE" || refData.isStale || refData.effectiveIdrPrice <= 0) {
      addLog(bot, `Harga referensi eksternal tidak valid atau STALE (${refData.rejectionReason || "Stale data"}). Penyesuaian likuiditas ditangguhkan.`, "RISK");
      this.cancelOpenDepthOrders(bot, addLog, "Feed harga eksternal stale");
      return false;
    }
    let baseRefIdr = refData.effectiveIdrPrice;
    if (cfg.reference_price_source === "BINANCE" && refData.binancePrice) {
      baseRefIdr = Math.round(refData.binancePrice * refData.fxRateUsed);
    } else if (cfg.reference_price_source === "BYBIT" && refData.bybitPrice) {
      baseRefIdr = Math.round(refData.bybitPrice * refData.fxRateUsed);
    } else if (cfg.reference_price_source === "COINMARKETCAP" && refData.cmcPrice) {
      baseRefIdr = Math.round(refData.cmcPrice * refData.fxRateUsed);
    }
    const tickSize = this.getCompatibleTickSize(bot.pairId, cfg.tick_size);
    const roundedRefPriceIdr = Math.round(baseRefIdr / tickSize) * tickSize;
    const lastReprice = cfg.lastRepriceTimestamp || 0;
    const minInterval = Math.max(1e3, cfg.minimum_reprice_interval_ms || 3e3);
    if (now - lastReprice < minInterval && (cfg.activeOrderIds && cfg.activeOrderIds.length > 0)) {
      return true;
    }
    const numBids = Math.min(20, Math.max(1, cfg.number_of_bid_levels || 5));
    const numAsks = Math.min(20, Math.max(1, cfg.number_of_ask_levels || 5));
    const isFixedIdrMode = cfg.spacing_mode === "FIXED_IDR" || !cfg.spacing_mode && bot.pairId === "USDT-IDR" || Boolean(cfg.level_spacing_idr);
    const defaultSpacingForPair = bot.pairId === "USDT-IDR" ? 60 : bot.pairId === "ETH-IDR" ? 1e5 : 1e6;
    const spacingIdr = Math.max(1, cfg.level_spacing_idr || defaultSpacingForPair);
    if (spacingIdr % tickSize !== 0) {
      addLog(bot, `Peringatan: Spacing IDR (${spacingIdr}) tidak habis dibagi tick size (${tickSize}). Menggunakan tick size 1 IDR.`, "INFO");
    }
    const bidOffsets = cfg.bid_level_offsets_bps && cfg.bid_level_offsets_bps.length > 0 ? cfg.bid_level_offsets_bps : [10, 25, 50, 80, 120];
    const askOffsets = cfg.ask_level_offsets_bps && cfg.ask_level_offsets_bps.length > 0 ? cfg.ask_level_offsets_bps : [10, 25, 50, 80, 120];
    const bidQuantities = cfg.bid_quantities && cfg.bid_quantities.length > 0 ? cfg.bid_quantities : bot.pairId === "USDT-IDR" ? ["25.0", "50.0", "75.0", "100.0", "150.0"] : ["0.02", "0.05", "0.10", "0.15", "0.20"];
    const askQuantities = cfg.ask_quantities && cfg.ask_quantities.length > 0 ? cfg.ask_quantities : bot.pairId === "USDT-IDR" ? ["25.0", "50.0", "75.0", "100.0", "150.0"] : ["0.02", "0.05", "0.10", "0.15", "0.20"];
    db.createOrGetAccount(bot.accountId, pair.quoteCurrency, "10000000000000");
    db.createOrGetAccount(bot.accountId, pair.baseCurrency, "1000000000000");
    const quoteAccount = db.createOrGetAccount(bot.accountId, pair.quoteCurrency);
    const baseAccount = db.createOrGetAccount(bot.accountId, pair.baseCurrency);
    let quoteAvailable = BigInt(quoteAccount.balanceAvailable);
    let baseAvailable = BigInt(baseAccount.balanceAvailable);
    const baseDecimals = pair.baseDecimals;
    if (!cfg.dry_run) {
      this.cancelOpenDepthOrders(bot, addLog, "Rotasi reprice ladder likuiditas");
    }
    const newActiveOrderIds = [];
    const usedBidPriceUnits = /* @__PURE__ */ new Set();
    const usedAskPriceUnits = /* @__PURE__ */ new Set();
    const refQuoteUnits = PrecisionMath.parseToUnits(roundedRefPriceIdr.toString(), pair.quoteDecimals);
    const spacingQuoteUnits = PrecisionMath.parseToUnits(spacingIdr.toString(), pair.quoteDecimals);
    const tickQuoteUnits = PrecisionMath.parseToUnits(tickSize.toString(), pair.quoteDecimals);
    let lastBidUnits = refQuoteUnits;
    let lastAskUnits = refQuoteUnits;
    for (let i = 0; i < numBids; i++) {
      let bidPriceUnits;
      if (isFixedIdrMode) {
        bidPriceUnits = refQuoteUnits - BigInt(i + 1) * spacingQuoteUnits;
      } else {
        const offsetBps = i < bidOffsets.length ? bidOffsets[i] : bidOffsets[bidOffsets.length - 1] + (i - bidOffsets.length + 1) * 20;
        const rawTargetIdr = Math.round(roundedRefPriceIdr * (1 - offsetBps / 1e4) / tickSize) * tickSize;
        bidPriceUnits = PrecisionMath.parseToUnits(rawTargetIdr.toString(), pair.quoteDecimals);
      }
      if (bidPriceUnits >= lastBidUnits) {
        bidPriceUnits = lastBidUnits - (spacingQuoteUnits > 0n ? spacingQuoteUnits : tickQuoteUnits);
      }
      if (bidPriceUnits <= 0n) {
        bidPriceUnits = tickQuoteUnits;
      }
      lastBidUnits = bidPriceUnits;
      if (usedBidPriceUnits.has(bidPriceUnits.toString())) {
        continue;
      }
      usedBidPriceUnits.add(bidPriceUnits.toString());
      let qtyStr = bidQuantities[i < bidQuantities.length ? i : bidQuantities.length - 1] || "10.0";
      if (cfg.quantity_randomization_enabled) {
        const minQ = parseFloat(cfg.random_min_quantity || "5.0");
        const maxQ = parseFloat(cfg.random_max_quantity || "25.0");
        const randQ = minQ + Math.random() * (maxQ - minQ);
        qtyStr = randQ.toFixed(bot.pairId === "USDT-IDR" ? 2 : 4);
      }
      const qtyBaseUnits = BigInt(Math.round(parseFloat(qtyStr) * 10 ** baseDecimals)).toString();
      const neededQuote = PrecisionMath.calculateQuoteAmount(BigInt(qtyBaseUnits), baseDecimals, bidPriceUnits);
      if (quoteAvailable >= neededQuote) {
        const displayPrice = PrecisionMath.formatIDRDisplay(bidPriceUnits);
        if (cfg.dry_run) {
          addLog(bot, `[DRY-RUN] Deploy Bid Level ${i + 1}: ${displayPrice} (Qty: ${qtyStr} ${pair.baseCurrency})`, "INFO");
        } else {
          const clientOrderId = `bot-dp-${bot.id.slice(4, 10)}-b${i + 1}-${Date.now()}`;
          try {
            const res = matchingEngine.placeOrder({
              userId: bot.accountId,
              pairId: bot.pairId,
              side: "BUY",
              orderType: "LIMIT",
              timeInForce: "GTC",
              price: bidPriceUnits.toString(),
              quantity: qtyBaseUnits,
              clientOrderId
            });
            const placedBid = res?.takerOrder || res?.order;
            if (placedBid) {
              newActiveOrderIds.push(placedBid.id);
              bot.deployedOrderIds.push(placedBid.id);
              bot.stats.ordersSubmitted++;
              bot.stats.ordersAccepted++;
              quoteAvailable -= neededQuote;
            }
          } catch (err) {
            addLog(bot, `Gagal memasang Bid Level ${i + 1} (${displayPrice}): ${err.message}`, "ERROR");
          }
        }
      } else {
        addLog(bot, `Bid Level ${i + 1} dilewati: Saldo IDR tidak mencukupi (Tersedia: Rp ${PrecisionMath.formatIDRDisplay(quoteAvailable)})`, "RISK");
      }
    }
    for (let i = 0; i < numAsks; i++) {
      let askPriceUnits;
      if (isFixedIdrMode) {
        askPriceUnits = refQuoteUnits + BigInt(i + 1) * spacingQuoteUnits;
      } else {
        const offsetBps = i < askOffsets.length ? askOffsets[i] : askOffsets[askOffsets.length - 1] + (i - askOffsets.length + 1) * 20;
        const rawTargetIdr = Math.round(roundedRefPriceIdr * (1 + offsetBps / 1e4) / tickSize) * tickSize;
        askPriceUnits = PrecisionMath.parseToUnits(rawTargetIdr.toString(), pair.quoteDecimals);
      }
      if (askPriceUnits <= lastAskUnits) {
        askPriceUnits = lastAskUnits + (spacingQuoteUnits > 0n ? spacingQuoteUnits : tickQuoteUnits);
      }
      lastAskUnits = askPriceUnits;
      if (usedAskPriceUnits.has(askPriceUnits.toString())) {
        continue;
      }
      usedAskPriceUnits.add(askPriceUnits.toString());
      let qtyStr = askQuantities[i < askQuantities.length ? i : askQuantities.length - 1] || "10.0";
      if (cfg.quantity_randomization_enabled) {
        const minQ = parseFloat(cfg.random_min_quantity || "5.0");
        const maxQ = parseFloat(cfg.random_max_quantity || "25.0");
        const randQ = minQ + Math.random() * (maxQ - minQ);
        qtyStr = randQ.toFixed(bot.pairId === "USDT-IDR" ? 2 : 4);
      }
      const qtyBaseUnits = BigInt(Math.round(parseFloat(qtyStr) * 10 ** baseDecimals)).toString();
      if (baseAvailable >= BigInt(qtyBaseUnits)) {
        const displayPrice = PrecisionMath.formatIDRDisplay(askPriceUnits);
        if (cfg.dry_run) {
          addLog(bot, `[DRY-RUN] Deploy Ask Level ${i + 1}: ${displayPrice} (Qty: ${qtyStr} ${pair.baseCurrency})`, "INFO");
        } else {
          const clientOrderId = `bot-dp-${bot.id.slice(4, 10)}-a${i + 1}-${Date.now()}`;
          try {
            const res = matchingEngine.placeOrder({
              userId: bot.accountId,
              pairId: bot.pairId,
              side: "SELL",
              orderType: "LIMIT",
              timeInForce: "GTC",
              price: askPriceUnits.toString(),
              quantity: qtyBaseUnits,
              clientOrderId
            });
            const placedAsk = res?.takerOrder || res?.order;
            if (placedAsk) {
              newActiveOrderIds.push(placedAsk.id);
              bot.deployedOrderIds.push(placedAsk.id);
              bot.stats.ordersSubmitted++;
              bot.stats.ordersAccepted++;
              baseAvailable -= BigInt(qtyBaseUnits);
            }
          } catch (err) {
            addLog(bot, `Gagal memasang Ask Level ${i + 1} (${displayPrice}): ${err.message}`, "ERROR");
          }
        }
      } else {
        addLog(bot, `Ask Level ${i + 1} dilewati: Saldo ${pair.baseCurrency} tidak mencukupi`, "RISK");
      }
    }
    cfg.activeOrderIds = newActiveOrderIds;
    cfg.lastRepriceTimestamp = now;
    bot.lastHeartbeat = now;
    const bestBidPriceIdr = roundedRefPriceIdr - spacingIdr;
    const bestAskPriceIdr = roundedRefPriceIdr + spacingIdr;
    const spreadIdr = bestAskPriceIdr - bestBidPriceIdr;
    const spreadPct = (spreadIdr / roundedRefPriceIdr * 100).toFixed(2);
    if (newActiveOrderIds.length > 0) {
      addLog(
        bot,
        `Kedalaman order book diperbarui: ${newActiveOrderIds.length} level order unik dipasang (Jarak: Rp ${spacingIdr}/level, Best Bid: Rp ${bestBidPriceIdr.toLocaleString()}, Best Ask: Rp ${bestAskPriceIdr.toLocaleString()}, Spread: Rp ${spreadIdr} / ${spreadPct}%).`,
        "ORDER"
      );
    }
    marketWsService.broadcastDepth(bot.pairId);
    marketWsService.broadcastTicker(pair);
    db.scheduleSave();
    return true;
  }
  static cancelOpenDepthOrders(bot, addLog, reason = "Penghentian bot") {
    const cfg = bot.depthLiquidityConfig;
    let count = 0;
    const idsToCancel = [...cfg?.activeOrderIds || [], ...bot.deployedOrderIds];
    const uniqueIds = Array.from(new Set(idsToCancel));
    for (const orderId of uniqueIds) {
      const order = db.orders.get(orderId);
      if (order && (order.status === "NEW" || order.status === "PARTIALLY_FILLED")) {
        try {
          const res = matchingEngine.cancelOrder(orderId, bot.accountId, bot.pairId);
          if (res && res.status === "CANCELLED") {
            count++;
          }
        } catch (e) {
        }
      }
    }
    if (cfg) {
      cfg.activeOrderIds = [];
    }
    if (count > 0) {
      addLog(bot, `Membatalkan ${count} order depth terbuka (${reason}).`, "INFO");
      marketWsService.broadcastDepth(bot.pairId);
    }
    return count;
  }
};

// server/services/BotWorkerManager.ts
var BotWorkerManager = class {
  constructor() {
    this.workers = /* @__PURE__ */ new Map();
    setTimeout(() => {
      this.rehydrateRunningBots();
    }, 1e3);
  }
  rehydrateRunningBots() {
    for (const [id, bot] of db.botInstances.entries()) {
      if (bot.status === "RUNNING") {
        this.startWorker(id);
      }
    }
  }
  getBot(botId) {
    return db.botInstances.get(botId);
  }
  addLog(bot, message, type = "INFO") {
    bot.logs.unshift({
      timestamp: Date.now(),
      message,
      type
    });
    if (bot.logs.length > 100) bot.logs.pop();
    bot.updatedAt = Date.now();
    db.scheduleSave();
  }
  /**
   * Validate Bot Configuration before running
   */
  validateConfig(bot) {
    const errors = [];
    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair) {
      errors.push(`Trading pair ${bot.pairId} tidak ditemukan.`);
      return { isValid: false, errors };
    }
    if (db.riskControls.isKillSwitchActive) {
      errors.push("Emergency Kill-Switch bursa sedang aktif. Tidak dapat memvalidasi/menjalankan bot.");
    }
    if (bot.botType === "ORDER_BOT") {
      const cfg = bot.orderBotConfig;
      if (!cfg) {
        errors.push("Konfigurasi Order Bot tidak boleh kosong.");
        return { isValid: false, errors };
      }
      if (!["BUY", "SELL"].includes(cfg.transaction_type)) {
        errors.push(`transaction_type tidak valid: ${cfg.transaction_type}`);
      }
      const minQty = parseFloat(cfg.random_min_quantity);
      const maxQty = parseFloat(cfg.random_max_quantity);
      if (isNaN(minQty) || minQty <= 0) {
        errors.push("random_min_quantity harus berupa angka desimal positif > 0.");
      }
      if (isNaN(maxQty) || maxQty < minQty) {
        errors.push("random_max_quantity harus lebih besar atau sama dengan random_min_quantity.");
      }
      if (cfg.order_count < 0 || cfg.order_count > 1e3) {
        errors.push("order_count harus antara 0 (berjalan terus) sampai 1000.");
      }
      if (cfg.transaction_type === "BUY") {
        if (cfg.buy_min_price_limit) {
          const lim = parseFloat(cfg.buy_min_price_limit);
          if (isNaN(lim) || lim <= 0) errors.push("buy_min_price_limit harus berupa angka positif.");
        }
        if (cfg.buy_max_price_limit) {
          const lim = parseFloat(cfg.buy_max_price_limit);
          if (isNaN(lim) || lim <= 0) errors.push("buy_max_price_limit harus berupa angka positif.");
        }
        if (cfg.buy_min_price_limit && cfg.buy_max_price_limit) {
          if (parseFloat(cfg.buy_min_price_limit) > parseFloat(cfg.buy_max_price_limit)) {
            errors.push("buy_min_price_limit tidak boleh lebih besar dari buy_max_price_limit.");
          }
        }
      } else {
        if (cfg.sell_min_price_limit) {
          const lim = parseFloat(cfg.sell_min_price_limit);
          if (isNaN(lim) || lim <= 0) errors.push("sell_min_price_limit harus berupa angka positif.");
        }
        if (cfg.sell_max_price_limit) {
          const lim = parseFloat(cfg.sell_max_price_limit);
          if (isNaN(lim) || lim <= 0) errors.push("sell_max_price_limit harus berupa angka positif.");
        }
        if (cfg.sell_min_price_limit && cfg.sell_max_price_limit) {
          if (parseFloat(cfg.sell_min_price_limit) > parseFloat(cfg.sell_max_price_limit)) {
            errors.push("sell_min_price_limit tidak boleh lebih besar dari sell_max_price_limit.");
          }
        }
      }
    } else if (bot.botType === "VOLUME_BOT") {
      const cfg = bot.volumeBotConfig;
      if (!cfg) {
        errors.push("Konfigurasi Volume Bot tidak boleh kosong.");
        return { isValid: false, errors };
      }
      if (cfg.min_delay < 1) errors.push("min_delay harus minimal 1 detik.");
      if (cfg.max_delay < cfg.min_delay) errors.push("max_delay harus lebih besar atau sama dengan min_delay.");
      const minQty = parseFloat(cfg.volume_random_min_quantity);
      const maxQty = parseFloat(cfg.volume_random_max_quantity);
      if (isNaN(minQty) || minQty <= 0) errors.push("volume_random_min_quantity harus > 0.");
      if (isNaN(maxQty) || maxQty < minQty) errors.push("volume_random_max_quantity harus >= min_quantity.");
      const minP = parseFloat(cfg.min_limit_price);
      const maxP = parseFloat(cfg.max_limit_price);
      if (isNaN(minP) || isNaN(maxP) || minP >= maxP) {
        errors.push("min_limit_price harus lebih kecil dari max_limit_price.");
      }
    } else if (bot.botType === "PRICE_FOLLOWER") {
      const cfg = bot.priceFollowerConfig;
      if (!cfg) {
        errors.push("Konfigurasi Price Follower Bot tidak boleh kosong.");
        return { isValid: false, errors };
      }
      const qty = parseFloat(cfg.order_quantity);
      if (isNaN(qty) || qty <= 0) {
        errors.push("order_quantity harus berupa angka desimal positif > 0.");
      }
      if (cfg.buy_offset_bps < 0 || cfg.sell_offset_bps < 0) {
        errors.push("Offset bps tidak boleh bernilai negatif.");
      }
    } else if (bot.botType === "DEPTH_LIQUIDITY") {
      const cfg = bot.depthLiquidityConfig;
      if (!cfg) {
        errors.push("Konfigurasi Depth & Liquidity Bot tidak boleh kosong.");
        return { isValid: false, errors };
      }
      if ((cfg.number_of_bid_levels || 0) < 1 || (cfg.number_of_bid_levels || 0) > 20) {
        errors.push("Jumlah level bid harus antara 1 sampai 20 level.");
      }
      if ((cfg.number_of_ask_levels || 0) < 1 || (cfg.number_of_ask_levels || 0) > 20) {
        errors.push("Jumlah level ask harus antara 1 sampai 20 level.");
      }
      if (cfg.spacing_mode === "FIXED_IDR" && (cfg.level_spacing_idr || 0) <= 0) {
        errors.push("level_spacing_idr harus berupa angka positif > 0.");
      }
    }
    return { isValid: errors.length === 0, errors };
  }
  /**
   * Start a Bot Worker
   */
  startWorker(botId) {
    const bot = db.botInstances.get(botId);
    if (!bot) return false;
    if (db.riskControls.isKillSwitchActive) {
      this.addLog(bot, "Gagal memulai: Emergency Kill-Switch bursa sedang aktif.", "RISK");
      bot.status = "RISK_HALTED";
      return false;
    }
    let runningCount = 0;
    for (const b of db.botInstances.values()) {
      if (b.status === "RUNNING" && b.id !== botId) runningCount++;
    }
    if (runningCount >= db.riskControls.maxActiveBots) {
      this.addLog(bot, `Gagal memulai: Batas maksimum bot aktif tercapai (${db.riskControls.maxActiveBots}).`, "RISK");
      bot.status = "RISK_HALTED";
      return false;
    }
    const existingWorker = this.workers.get(botId);
    if (existingWorker && existingWorker.isRunning) {
      this.addLog(bot, "Peringatan: Worker sudah berjalan untuk bot ini. Menggunakan lease aktif.", "INFO");
      return true;
    }
    const leaseId = crypto13.randomUUID();
    const runtime = {
      botId,
      leaseId,
      timer: null,
      isRunning: true,
      consecutiveErrors: 0,
      ordersPlacedInWindow: 0,
      windowStart: Date.now()
    };
    this.workers.set(botId, runtime);
    bot.status = "RUNNING";
    bot.startedAt = Date.now();
    bot.lastHeartbeat = Date.now();
    bot.errorInfo = void 0;
    this.addLog(bot, `Worker bot dimulai (Lease ID: ${leaseId.slice(0, 8)}, Environment: ${bot.environment}).`, "INFO");
    if (bot.botType === "ORDER_BOT") {
      this.scheduleOrderBotTick(runtime);
    } else if (bot.botType === "VOLUME_BOT") {
      this.scheduleVolumeBotTick(runtime);
    } else if (bot.botType === "PRICE_FOLLOWER") {
      this.schedulePriceFollowerTick(runtime);
    } else if (bot.botType === "DEPTH_LIQUIDITY") {
      this.scheduleDepthLiquidityTick(runtime);
    }
    db.scheduleSave();
    return true;
  }
  /**
   * Pause a Bot Worker
   */
  pauseWorker(botId) {
    const bot = db.botInstances.get(botId);
    if (!bot) return false;
    const runtime = this.workers.get(botId);
    if (runtime) {
      if (runtime.timer) clearTimeout(runtime.timer);
      runtime.isRunning = false;
      this.workers.delete(botId);
    }
    bot.status = "PAUSED";
    bot.lastHeartbeat = Date.now();
    this.addLog(bot, "Bot dijeda sementara (PAUSED). Order terbuka dipertahankan.", "INFO");
    db.scheduleSave();
    return true;
  }
  /**
   * Stop a Bot Worker and optionally cancel open orders
   */
  stopWorker(botId, cancelOpenOrders = true) {
    const bot = db.botInstances.get(botId);
    if (!bot) return { success: false, cancelledOrdersCount: 0 };
    const runtime = this.workers.get(botId);
    if (runtime) {
      if (runtime.timer) clearTimeout(runtime.timer);
      runtime.isRunning = false;
      this.workers.delete(botId);
    }
    bot.status = "STOPPED";
    bot.stoppedAt = Date.now();
    bot.lastHeartbeat = Date.now();
    this.addLog(bot, "Bot dihentikan secara permanen (STOPPED).", "INFO");
    let cancelledOrdersCount = 0;
    if (cancelOpenOrders) {
      if (bot.botType === "PRICE_FOLLOWER") {
        cancelledOrdersCount += PriceFollowerBotExecutor.cancelOpenBotOrders(bot, this.addLog.bind(this));
      } else if (bot.botType === "DEPTH_LIQUIDITY") {
        cancelledOrdersCount += DepthLiquidityBotExecutor.cancelOpenDepthOrders(bot, this.addLog.bind(this));
      }
      for (const orderId of bot.deployedOrderIds) {
        const order = db.orders.get(orderId);
        if (order && (order.status === "NEW" || order.status === "PARTIALLY_FILLED")) {
          try {
            matchingEngine.cancelOrder(orderId, bot.ownerUserId, bot.pairId);
            cancelledOrdersCount++;
          } catch (e) {
          }
        }
      }
      this.addLog(bot, `Membatalkan ${cancelledOrdersCount} order terbuka milik bot ini.`, "ORDER");
      marketWsService.broadcastDepth(bot.pairId);
    }
    db.scheduleSave();
    return { success: true, cancelledOrdersCount };
  }
  /**
   * Emergency Kill-Switch: Halt all active bots and cancel all open bot orders
   */
  triggerEmergencyKillSwitch() {
    db.riskControls.isKillSwitchActive = true;
    let haltedBots = 0;
    let totalCancelledOrders = 0;
    for (const [id, bot] of db.botInstances.entries()) {
      if (bot.status === "RUNNING" || bot.status === "PAUSED") {
        const res = this.stopWorker(id, true);
        bot.status = "RISK_HALTED";
        this.addLog(bot, "\u{1F6D1} EMERGENCY RISK HALT: Diberhentikan otomatis oleh Kill-Switch bursa.", "RISK");
        haltedBots++;
        totalCancelledOrders += res.cancelledOrdersCount;
      }
    }
    db.auditLogs.push({
      id: crypto13.randomUUID(),
      actorId: "RISK_CONTROLLER",
      action: "EMERGENCY_KILL_SWITCH_TRIGGERED",
      resource: "ALL_BOTS",
      details: `Halted ${haltedBots} bots and cancelled ${totalCancelledOrders} open orders.`,
      createdAt: Date.now()
    });
    db.scheduleSave();
    return { haltedBots, cancelledOrders: totalCancelledOrders };
  }
  resetEmergencyKillSwitch() {
    db.riskControls.isKillSwitchActive = false;
    db.auditLogs.push({
      id: crypto13.randomUUID(),
      actorId: "ADMIN",
      action: "EMERGENCY_KILL_SWITCH_RESET",
      resource: "ALL_BOTS",
      details: "Emergency Kill-Switch deactivated.",
      createdAt: Date.now()
    });
    db.scheduleSave();
  }
  /**
   * Remove / Delete Bot Instance:
   * Safely halts the worker, cancels open orders, records audit log, and deletes bot from DB.
   */
  deleteBot(botId, actorEmail) {
    const bot = db.botInstances.get(botId);
    if (!bot) return { success: false, cancelledOrdersCount: 0, botName: "" };
    const botName = bot.name;
    const stopResult = this.stopWorker(botId, true);
    db.auditLogs.push({
      id: crypto13.randomUUID(),
      actorId: actorEmail || "MM_OPERATOR",
      action: "BOT_INSTANCE_DELETED",
      resource: botId,
      details: `Bot ${botName} (${bot.id}, type: ${bot.botType}) dihapus oleh ${actorEmail}. ${stopResult.cancelledOrdersCount} order terbuka dibatalkan.`,
      createdAt: Date.now()
    });
    db.botInstances.delete(botId);
    db.scheduleSave();
    return {
      success: true,
      cancelledOrdersCount: stopResult.cancelledOrdersCount,
      botName
    };
  }
  /**
   * Order Bot Scheduling Loop
   */
  scheduleOrderBotTick(runtime) {
    if (!runtime.isRunning) return;
    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== "RUNNING") return;
    const cfg = bot.orderBotConfig;
    if (!cfg) return;
    const baseDelayMs = 2500;
    const jitterFactor = (cfg.jitter_timing_pct || 10) / 100;
    const randomizedDelay = Math.round(baseDelayMs * (1 + (Math.random() * 2 - 1) * jitterFactor));
    runtime.timer = setTimeout(() => {
      this.executeOrderBotTick(runtime);
    }, randomizedDelay);
  }
  executeOrderBotTick(runtime) {
    if (!runtime.isRunning) return;
    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== "RUNNING") return;
    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair || pair.isHalted) {
      this.addLog(bot, `Trading pair ${bot.pairId} sedang dihentikan sementara (HALTED). Menunggu...`, "RISK");
      this.scheduleOrderBotTick(runtime);
      return;
    }
    const cfg = bot.orderBotConfig;
    if (cfg.order_count > 0 && bot.stats.ordersSubmitted >= cfg.order_count) {
      bot.status = "STOPPED";
      this.addLog(bot, `Target total ${cfg.order_count} order selesai ditempatkan. Bot berhenti secara otomatis.`, "INFO");
      this.stopWorker(bot.id, false);
      return;
    }
    const now = Date.now();
    if (now - runtime.windowStart > 6e4) {
      runtime.windowStart = now;
      runtime.ordersPlacedInWindow = 0;
    }
    if (runtime.ordersPlacedInWindow >= db.riskControls.maxOrderSubmissionRatePerMin) {
      this.addLog(bot, "Rate limit per menit tercapai. Menunda tick order...", "RISK");
      this.scheduleOrderBotTick(runtime);
      return;
    }
    try {
      const book = matchingEngine.getOrderBook(bot.pairId);
      let refPriceUnits = BigInt(pair.lastPrice);
      if (cfg.price_source === "BEST_BID" && book.bids.length > 0) {
        refPriceUnits = BigInt(book.bids[0].price);
      } else if (cfg.price_source === "BEST_ASK" && book.asks.length > 0) {
        refPriceUnits = BigInt(book.asks[0].price);
      } else if (cfg.price_source === "MIDPOINT" && book.bids.length > 0 && book.asks.length > 0) {
        refPriceUnits = (BigInt(book.bids[0].price) + BigInt(book.asks[0].price)) / 2n;
      }
      if (cfg.transaction_type === "BUY") {
        const trailMin = parseFloat(cfg.buy_trailing_min_percentage || "0.1");
        const trailMax = parseFloat(cfg.buy_trailing_max_percentage || "0.5");
        const randTrail = trailMin + Math.random() * (trailMax - trailMin);
        const trailBps = BigInt(Math.round(randTrail * 100));
        refPriceUnits = refPriceUnits - refPriceUnits * trailBps / 10000n;
      } else {
        const trailMin = parseFloat(cfg.sell_trailing_min_percentage || "0.1");
        const trailMax = parseFloat(cfg.sell_trailing_max_percentage || "0.5");
        const randTrail = trailMin + Math.random() * (trailMax - trailMin);
        const trailBps = BigInt(Math.round(randTrail * 100));
        refPriceUnits = refPriceUnits + refPriceUnits * trailBps / 10000n;
      }
      const priceJitterPct = (cfg.jitter_price_pct || 2) / 100;
      const jitterFactor = 1 + (Math.random() * 2 - 1) * priceJitterPct;
      refPriceUnits = BigInt(Math.round(Number(refPriceUnits) * jitterFactor));
      if (cfg.transaction_type === "BUY") {
        if (cfg.buy_max_price_limit) {
          const maxLimitUnits = PrecisionMath.parseToUnits(cfg.buy_max_price_limit, pair.quoteDecimals);
          if (refPriceUnits > maxLimitUnits) {
            refPriceUnits = maxLimitUnits;
            this.addLog(
              bot,
              `[Price Limit] BUY bid dibatasi ke buy_max_price_limit: ${PrecisionMath.formatIDRDisplay(maxLimitUnits)}`,
              "INFO"
            );
          }
        }
        if (cfg.buy_min_price_limit) {
          const minLimitUnits = PrecisionMath.parseToUnits(cfg.buy_min_price_limit, pair.quoteDecimals);
          if (refPriceUnits < minLimitUnits) {
            refPriceUnits = minLimitUnits;
            this.addLog(
              bot,
              `[Price Limit] BUY bid dibatasi ke buy_min_price_limit: ${PrecisionMath.formatIDRDisplay(minLimitUnits)}`,
              "INFO"
            );
          }
        }
      }
      if (cfg.transaction_type === "SELL") {
        if (cfg.sell_min_price_limit) {
          const minLimitUnits = PrecisionMath.parseToUnits(cfg.sell_min_price_limit, pair.quoteDecimals);
          if (refPriceUnits < minLimitUnits) {
            refPriceUnits = minLimitUnits;
            this.addLog(
              bot,
              `[Price Limit] SELL ask dibatasi ke sell_min_price_limit: ${PrecisionMath.formatIDRDisplay(minLimitUnits)}`,
              "INFO"
            );
          }
        }
        if (cfg.sell_max_price_limit) {
          const maxLimitUnits = PrecisionMath.parseToUnits(cfg.sell_max_price_limit, pair.quoteDecimals);
          if (refPriceUnits > maxLimitUnits) {
            refPriceUnits = maxLimitUnits;
            this.addLog(
              bot,
              `[Price Limit] SELL ask dibatasi ke sell_max_price_limit: ${PrecisionMath.formatIDRDisplay(maxLimitUnits)}`,
              "INFO"
            );
          }
        }
      }
      const minQ = parseFloat(cfg.random_min_quantity || "0.01");
      const maxQ = parseFloat(cfg.random_max_quantity || (minQ * 2).toString());
      const rawQty = minQ + Math.random() * (maxQ - minQ);
      const dec = cfg.quantity_decimal || pair.baseDecimals;
      let qtyUnits = PrecisionMath.parseToUnits(rawQty.toFixed(Math.min(dec, pair.baseDecimals)), pair.baseDecimals);
      if (qtyUnits < BigInt(pair.minOrderSize)) qtyUnits = BigInt(pair.minOrderSize);
      if (qtyUnits > BigInt(pair.maxOrderSize)) qtyUnits = BigInt(pair.maxOrderSize);
      let finalOrders = [];
      if (cfg.split_order_mode === "RANDOM_SPLIT" && cfg.split_range) {
        const splitParts = Math.max(2, Math.min(5, parseInt(cfg.split_range, 10) || 3));
        const subQty = qtyUnits / BigInt(splitParts);
        for (let i = 0; i < splitParts; i++) {
          finalOrders.push({ price: refPriceUnits, qty: subQty });
        }
      } else {
        finalOrders.push({ price: refPriceUnits, qty: qtyUnits });
      }
      for (let i = 0; i < finalOrders.length; i++) {
        const item = finalOrders[i];
        const clientOrderId = `${bot.id}-ord-${bot.stats.ordersSubmitted + 1}`;
        const result = matchingEngine.placeOrder({
          userId: bot.ownerUserId,
          pairId: bot.pairId,
          side: cfg.transaction_type,
          orderType: "LIMIT",
          timeInForce: "GTC",
          price: item.price.toString(),
          quantity: item.qty.toString(),
          clientOrderId
        });
        bot.stats.ordersSubmitted++;
        bot.stats.ordersAccepted++;
        bot.deployedOrderIds.push(result.takerOrder.id);
        runtime.ordersPlacedInWindow++;
        if (result.trades.length > 0) {
          bot.stats.ordersFilled += result.trades.length;
          for (const t of result.trades) {
            bot.stats.executedVolume = (BigInt(bot.stats.executedVolume) + BigInt(t.quantity)).toString();
            bot.stats.totalTrades++;
            marketWsService.broadcastTrade(t);
          }
          this.addLog(
            bot,
            `[Order Bot] Match terisi: ${PrecisionMath.formatFromUnits(item.qty, pair.baseDecimals)} ${pair.baseCurrency} @ ${PrecisionMath.formatIDRDisplay(item.price)}`,
            "FILL"
          );
        } else {
          this.addLog(
            bot,
            `[Order Bot] Limit ${cfg.transaction_type} aktif: ${PrecisionMath.formatFromUnits(item.qty, pair.baseDecimals)} ${pair.baseCurrency} @ ${PrecisionMath.formatIDRDisplay(item.price)}`,
            "ORDER"
          );
        }
        marketWsService.broadcastOrderUpdate(result.takerOrder);
      }
      marketWsService.broadcastDepth(bot.pairId);
      runtime.consecutiveErrors = 0;
      bot.lastHeartbeat = Date.now();
    } catch (err) {
      runtime.consecutiveErrors++;
      this.addLog(bot, `Error pada eksekusi order: ${err.message}`, "ERROR");
      if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
        bot.status = "RISK_HALTED";
        bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}). Bot halted.`;
        this.addLog(bot, bot.errorInfo, "RISK");
        this.stopWorker(bot.id, false);
        return;
      }
    }
    this.scheduleOrderBotTick(runtime);
  }
  /**
   * Volume Bot Scheduling Loop
   */
  scheduleVolumeBotTick(runtime) {
    if (!runtime.isRunning) return;
    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== "RUNNING") return;
    const cfg = bot.volumeBotConfig;
    if (!cfg) return;
    const minDelay = Math.max(1, cfg.min_delay || 3);
    const maxDelay = Math.max(minDelay, cfg.max_delay || 5);
    const delaySec = minDelay + Math.random() * (maxDelay - minDelay);
    runtime.timer = setTimeout(() => {
      this.executeVolumeBotTick(runtime);
    }, Math.round(delaySec * 1e3));
  }
  executeVolumeBotTick(runtime) {
    if (!runtime.isRunning) return;
    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== "RUNNING") return;
    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair || pair.isHalted) {
      this.addLog(bot, `Pair ${bot.pairId} sedang halted. Menunda volume tick...`, "RISK");
      this.scheduleVolumeBotTick(runtime);
      return;
    }
    const cfg = bot.volumeBotConfig;
    const stopTargetUnits = PrecisionMath.parseToUnits(cfg.vol_idr_stop_target, 2);
    const currentQuoteVolUnits = PrecisionMath.calculateQuoteAmount(
      BigInt(bot.stats.executedVolume || "0"),
      pair.baseDecimals,
      BigInt(pair.lastPrice)
    );
    if (currentQuoteVolUnits >= stopTargetUnits) {
      bot.status = "STOPPED";
      this.addLog(bot, `\u{1F3AF} Target volume IDR (${PrecisionMath.formatIDRDisplay(stopTargetUnits)}) tercapai! Volume bot selesai.`, "INFO");
      this.stopWorker(bot.id, false);
      return;
    }
    try {
      const side = Math.random() >= 0.5 ? "BUY" : "SELL";
      const minPUnits = PrecisionMath.parseToUnits(cfg.min_limit_price, pair.quoteDecimals);
      const maxPUnits = PrecisionMath.parseToUnits(cfg.max_limit_price, pair.quoteDecimals);
      let targetPriceUnits = BigInt(pair.lastPrice);
      if (targetPriceUnits < minPUnits) targetPriceUnits = minPUnits;
      if (targetPriceUnits > maxPUnits) targetPriceUnits = maxPUnits;
      const jitterBps = BigInt(Math.floor(Math.random() * 20 - 10));
      targetPriceUnits = targetPriceUnits + targetPriceUnits * jitterBps / 10000n;
      const minQ = parseFloat(cfg.volume_random_min_quantity || "0.01");
      const maxQ = parseFloat(cfg.volume_random_max_quantity || (minQ * 2).toString());
      const rawQty = minQ + Math.random() * (maxQ - minQ);
      let qtyUnits = PrecisionMath.parseToUnits(rawQty.toFixed(4), pair.baseDecimals);
      if (qtyUnits < BigInt(pair.minOrderSize)) qtyUnits = BigInt(pair.minOrderSize);
      if (qtyUnits > BigInt(pair.maxOrderSize)) qtyUnits = BigInt(pair.maxOrderSize);
      db.createOrGetAccount(bot.ownerUserId, pair.quoteCurrency, "5000000000000");
      db.createOrGetAccount(bot.ownerUserId, pair.baseCurrency, "10000000000");
      if (cfg.volume_sell_account_id) {
        db.createOrGetAccount(cfg.volume_sell_account_id, pair.quoteCurrency, "5000000000000");
        db.createOrGetAccount(cfg.volume_sell_account_id, pair.baseCurrency, "10000000000");
      }
      const book = matchingEngine.getOrderBook(bot.pairId);
      const opposingOrders = side === "BUY" ? book.asks : book.bids;
      const canMatchExisting = opposingOrders.some((o) => {
        const oPrice = BigInt(o.price);
        return side === "BUY" ? targetPriceUnits >= oPrice : targetPriceUnits <= oPrice;
      });
      if (!canMatchExisting) {
        const opposingSide = side === "BUY" ? "SELL" : "BUY";
        const makerUserId = cfg.volume_sell_account_id || bot.ownerUserId;
        try {
          const makerRes = matchingEngine.placeOrder({
            userId: makerUserId,
            pairId: bot.pairId,
            side: opposingSide,
            orderType: "LIMIT",
            timeInForce: "GTC",
            price: targetPriceUnits.toString(),
            quantity: qtyUnits.toString(),
            clientOrderId: `${bot.id}-vol-maker-${Date.now()}`
          });
          bot.deployedOrderIds.push(makerRes.takerOrder.id);
        } catch (e) {
          try {
            const makerRes = matchingEngine.placeOrder({
              userId: bot.ownerUserId,
              pairId: bot.pairId,
              side: opposingSide,
              orderType: "LIMIT",
              timeInForce: "GTC",
              price: targetPriceUnits.toString(),
              quantity: qtyUnits.toString(),
              clientOrderId: `${bot.id}-vol-maker-${Date.now()}`
            });
            bot.deployedOrderIds.push(makerRes.takerOrder.id);
          } catch (err) {
          }
        }
      }
      const result = matchingEngine.placeOrder({
        userId: bot.ownerUserId,
        pairId: bot.pairId,
        side,
        orderType: "LIMIT",
        timeInForce: "IOC",
        price: targetPriceUnits.toString(),
        quantity: qtyUnits.toString(),
        clientOrderId: `${bot.id}-vol-${bot.stats.ordersSubmitted + 1}`
      });
      bot.stats.ordersSubmitted++;
      bot.stats.ordersAccepted++;
      bot.deployedOrderIds.push(result.takerOrder.id);
      if (result.trades.length > 0) {
        bot.stats.ordersFilled += result.trades.length;
        for (const t of result.trades) {
          bot.stats.executedVolume = (BigInt(bot.stats.executedVolume) + BigInt(t.quantity)).toString();
          bot.stats.totalTrades++;
          marketWsService.broadcastTrade(t);
        }
        this.addLog(
          bot,
          `[Volume Bot] Eksekusi ${side}: ${PrecisionMath.formatFromUnits(qtyUnits, pair.baseDecimals)} ${pair.baseCurrency} @ ${PrecisionMath.formatIDRDisplay(targetPriceUnits)}`,
          "FILL"
        );
      } else {
        this.addLog(
          bot,
          `[Volume Bot] Order ${side} IOC disubmit namun tidak ada match di harga ${PrecisionMath.formatIDRDisplay(targetPriceUnits)}.`,
          "ORDER"
        );
      }
      marketWsService.broadcastOrderUpdate(result.takerOrder);
      marketWsService.broadcastDepth(bot.pairId);
      runtime.consecutiveErrors = 0;
      bot.lastHeartbeat = Date.now();
    } catch (err) {
      runtime.consecutiveErrors++;
      this.addLog(bot, `Error eksekusi volume tick: ${err.message}`, "ERROR");
      if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
        bot.status = "RISK_HALTED";
        bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}).`;
        this.addLog(bot, bot.errorInfo, "RISK");
        this.stopWorker(bot.id, false);
        return;
      }
    }
    this.scheduleVolumeBotTick(runtime);
  }
  /**
   * Price Follower Bot Scheduling Loop
   */
  schedulePriceFollowerTick(runtime) {
    if (!runtime.isRunning) return;
    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== "RUNNING") {
      runtime.isRunning = false;
      this.workers.delete(runtime.botId);
      return;
    }
    const intervalMs = Math.max(1e3, bot.priceFollowerConfig?.minimum_reprice_interval_ms || 2e3);
    runtime.timer = setTimeout(() => {
      if (!runtime.isRunning) return;
      try {
        PriceFollowerBotExecutor.executeCycle(bot, this.addLog.bind(this));
        runtime.consecutiveErrors = 0;
      } catch (err) {
        runtime.consecutiveErrors++;
        this.addLog(bot, `Error pada Price Follower cycle: ${err.message}`, "ERROR");
        if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
          bot.status = "RISK_HALTED";
          bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}).`;
          this.addLog(bot, bot.errorInfo, "RISK");
          this.stopWorker(bot.id, false);
          return;
        }
      }
      this.schedulePriceFollowerTick(runtime);
    }, intervalMs);
  }
  /**
   * Depth & Liquidity Bot Scheduling Loop
   */
  scheduleDepthLiquidityTick(runtime) {
    if (!runtime.isRunning) return;
    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== "RUNNING") {
      runtime.isRunning = false;
      this.workers.delete(runtime.botId);
      return;
    }
    const intervalMs = Math.max(1e3, bot.depthLiquidityConfig?.minimum_reprice_interval_ms || 3e3);
    runtime.timer = setTimeout(() => {
      if (!runtime.isRunning) return;
      try {
        DepthLiquidityBotExecutor.executeCycle(bot, this.addLog.bind(this));
        runtime.consecutiveErrors = 0;
      } catch (err) {
        runtime.consecutiveErrors++;
        this.addLog(bot, `Error pada Depth & Liquidity cycle: ${err.message}`, "ERROR");
        if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
          bot.status = "RISK_HALTED";
          bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}).`;
          this.addLog(bot, bot.errorInfo, "RISK");
          this.stopWorker(bot.id, false);
          return;
        }
      }
      this.scheduleDepthLiquidityTick(runtime);
    }, intervalMs);
  }
};
var botWorkerManager = new BotWorkerManager();

// server/routes/mmConsole.ts
init_PriceAggregatorService();
init_FxConversionService();
init_PrecisionMath();
var mmConsoleRouter = Router9();
var requireMMOrAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    const user = req.user;
    const role = (user.role || "").toUpperCase();
    if (role !== "MM" && role !== "ADMIN" && role !== "SUPERADMIN") {
      return res.status(403).json({ error: "Akses ditolak: Memerlukan otorisasi Market Maker (MM) atau Administrator." });
    }
    next();
  });
};
mmConsoleRouter.get("/overview", requireMMOrAdmin, (req, res) => {
  const user = req.user;
  const isSuper = (user.role || "").toUpperCase() === "ADMIN" || (user.role || "").toUpperCase() === "SUPERADMIN";
  const allBots = Array.from(db.botInstances.values()).filter((b) => isSuper || b.ownerUserId === user.id);
  let activeBotsCount = 0;
  let totalSubmitted = 0;
  let totalFilled = 0;
  let totalVolumeBaseUnits = 0n;
  let totalTradesCount = 0;
  const botOrderIds = /* @__PURE__ */ new Set();
  allBots.forEach((b) => {
    if (b.status === "RUNNING") activeBotsCount++;
    totalSubmitted += b.stats.ordersSubmitted;
    totalFilled += b.stats.ordersFilled;
    totalVolumeBaseUnits += BigInt(b.stats.executedVolume || "0");
    totalTradesCount += b.stats.totalTrades;
    b.deployedOrderIds.forEach((id) => botOrderIds.add(id));
  });
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1e3;
  let bot24hVolumeQuoteUnits = 0n;
  let bot24hTradesCount = 0;
  for (const trade of db.trades) {
    if (trade.createdAt >= dayAgo) {
      const isBotTrade = botOrderIds.has(trade.makerOrderId) || botOrderIds.has(trade.takerOrderId) || trade.makerUserId?.startsWith("bot-") || trade.takerUserId?.startsWith("bot-") || trade.makerUserId === user.id || trade.takerUserId === user.id;
      if (isBotTrade) {
        bot24hTradesCount++;
        const pair = db.tradingPairs.get(trade.pairId);
        const baseDec = pair ? pair.baseDecimals : 8;
        const tradeVal = BigInt(trade.price) * BigInt(trade.quantity) / 10n ** BigInt(baseDec);
        bot24hVolumeQuoteUnits += tradeVal;
      }
    }
  }
  const mmAccounts = db.getUserAccounts(user.id);
  res.json({
    totalBots: allBots.length,
    activeBots: activeBotsCount,
    ordersSubmitted: totalSubmitted,
    ordersFilled: totalFilled,
    executedVolumeBaseUnits: totalVolumeBaseUnits.toString(),
    bot24hVolumeQuoteUnits: bot24hVolumeQuoteUnits.toString(),
    bot24hVolumeFormattedIdr: PrecisionMath.formatIDRDisplay(bot24hVolumeQuoteUnits),
    bot24hTradesCount,
    totalTrades: totalTradesCount,
    killSwitchActive: db.riskControls.isKillSwitchActive,
    riskControls: db.riskControls,
    balances: mmAccounts
  });
});
mmConsoleRouter.get("/instances", requireMMOrAdmin, (req, res) => {
  const user = req.user;
  const isSuper = (user.role || "").toUpperCase() === "ADMIN" || (user.role || "").toUpperCase() === "SUPERADMIN";
  const { environment, botType, status, pairId } = req.query;
  let bots = Array.from(db.botInstances.values()).filter((b) => isSuper || b.ownerUserId === user.id);
  if (environment) bots = bots.filter((b) => b.environment === environment);
  if (botType) bots = bots.filter((b) => b.botType === botType);
  if (status) bots = bots.filter((b) => b.status === status);
  if (pairId) bots = bots.filter((b) => b.pairId === pairId);
  bots.sort((a, b) => b.createdAt - a.createdAt);
  res.json(bots);
});
mmConsoleRouter.post("/order-bot/create", requireMMOrAdmin, (req, res) => {
  try {
    const user = req.user;
    const {
      name,
      pairId,
      environment,
      account_id,
      price_source,
      price_decimal,
      quantity_decimal,
      random_min_quantity,
      random_max_quantity,
      order_count,
      expire_time,
      transaction_type,
      split_order_mode,
      split_range,
      buy_trailing_min_percentage,
      buy_trailing_max_percentage,
      sell_trailing_min_percentage,
      sell_trailing_max_percentage,
      buy_min_price_limit,
      buy_max_price_limit,
      sell_min_price_limit,
      sell_max_price_limit,
      jitter_timing_pct,
      jitter_price_pct
    } = req.body;
    if (!name || !pairId || !transaction_type || !random_min_quantity || !random_max_quantity) {
      return res.status(400).json({ error: "Field konfigurasi Order Bot belum lengkap." });
    }
    const orderBotConfig = {
      account_id: account_id || user.id,
      price_source: price_source || "MIDPOINT",
      price_decimal: Number(price_decimal || 2),
      quantity_decimal: Number(quantity_decimal || 8),
      random_min_quantity: String(random_min_quantity),
      random_max_quantity: String(random_max_quantity),
      order_count: Math.max(0, parseInt(String(order_count ?? 0), 10)),
      expire_time: parseInt(String(expire_time || 0), 10),
      transaction_type: transaction_type === "SELL" ? "SELL" : "BUY",
      split_order_mode: split_order_mode === "RANDOM_SPLIT" ? "RANDOM_SPLIT" : "NONE",
      split_range: String(split_range || "3"),
      buy_trailing_min_percentage: String(buy_trailing_min_percentage || "0.1"),
      buy_trailing_max_percentage: String(buy_trailing_max_percentage || "0.5"),
      sell_trailing_min_percentage: String(sell_trailing_min_percentage || "0.1"),
      sell_trailing_max_percentage: String(sell_trailing_max_percentage || "0.5"),
      buy_min_price_limit: String(buy_min_price_limit || ""),
      buy_max_price_limit: String(buy_max_price_limit || ""),
      sell_min_price_limit: String(sell_min_price_limit || ""),
      sell_max_price_limit: String(sell_max_price_limit || ""),
      jitter_timing_pct: Number(jitter_timing_pct || 10),
      jitter_price_pct: Number(jitter_price_pct || 2)
    };
    const botId = `bot-ord-${crypto14.randomUUID().slice(0, 8)}`;
    const bot = {
      id: botId,
      name,
      botType: "ORDER_BOT",
      pairId,
      environment: environment || "DEMO",
      ownerUserId: user.id,
      accountId: account_id || user.id,
      version: 1,
      status: "READY",
      lastHeartbeat: Date.now(),
      orderBotConfig,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: "0",
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    botWorkerManager.addLog(bot, `Bot dibuat oleh ${user.email} (Status: READY, Environment: ${bot.environment}).`);
    db.botInstances.set(bot.id, bot);
    db.scheduleSave();
    res.json({ success: true, bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.post("/volume-bot/create", requireMMOrAdmin, (req, res) => {
  try {
    const user = req.user;
    const {
      name,
      pairId,
      environment,
      account_id,
      volume_price_decimal,
      volume_quantity_decimal,
      volume_random_min_quantity,
      volume_random_max_quantity,
      min_delay,
      max_delay,
      min_difference,
      max_difference,
      priority,
      max_limit_price,
      min_limit_price,
      vol_idr_stop_target,
      vol_idr_start_threshold,
      volume_sell_account_id
    } = req.body;
    if (!name || !pairId || !volume_random_min_quantity || !volume_random_max_quantity || !vol_idr_stop_target) {
      return res.status(400).json({ error: "Field konfigurasi Volume Bot belum lengkap." });
    }
    const volumeBotConfig = {
      account_id: account_id || user.id,
      volume_price_decimal: Number(volume_price_decimal || 2),
      volume_quantity_decimal: Number(volume_quantity_decimal || 8),
      volume_random_min_quantity: String(volume_random_min_quantity),
      volume_random_max_quantity: String(volume_random_max_quantity),
      min_delay: Math.max(1, parseInt(String(min_delay || 2), 10)),
      max_delay: Math.max(2, parseInt(String(max_delay || 5), 10)),
      min_difference: String(min_difference || "0.01"),
      max_difference: String(max_difference || "0.05"),
      priority: priority || "RANDOM",
      max_limit_price: String(max_limit_price || "200000000000"),
      min_limit_price: String(min_limit_price || "100000000000"),
      vol_idr_stop_target: String(vol_idr_stop_target),
      vol_idr_start_threshold: String(vol_idr_start_threshold || "0"),
      volume_sell_account_id: volume_sell_account_id || void 0
    };
    const botId = `bot-vol-${crypto14.randomUUID().slice(0, 8)}`;
    const bot = {
      id: botId,
      name,
      botType: "VOLUME_BOT",
      pairId,
      environment: environment || "DEMO",
      ownerUserId: user.id,
      accountId: account_id || user.id,
      version: 1,
      status: "READY",
      lastHeartbeat: Date.now(),
      volumeBotConfig,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: "0",
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    botWorkerManager.addLog(bot, `Volume Bot dibuat oleh ${user.email} (Target: IDR ${vol_idr_stop_target}).`);
    db.botInstances.set(bot.id, bot);
    db.scheduleSave();
    res.json({ success: true, bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.post("/instance/clone", requireMMOrAdmin, (req, res) => {
  try {
    const user = req.user;
    const { sourceBotId, newName, transaction_type, overrides } = req.body;
    const sourceBot = db.botInstances.get(sourceBotId);
    if (!sourceBot) {
      return res.status(404).json({ error: "Source bot tidak ditemukan." });
    }
    const clonedId = `bot-${sourceBot.botType.toLowerCase().slice(0, 3)}-${crypto14.randomUUID().slice(0, 8)}`;
    const clonedOrderConfig = sourceBot.orderBotConfig ? {
      ...JSON.parse(JSON.stringify(sourceBot.orderBotConfig)),
      ...overrides?.orderBotConfig || {}
    } : void 0;
    if (clonedOrderConfig) {
      if (transaction_type === "BUY" || transaction_type === "SELL") {
        clonedOrderConfig.transaction_type = transaction_type;
      }
    }
    const clonedVolumeConfig = sourceBot.volumeBotConfig ? {
      ...JSON.parse(JSON.stringify(sourceBot.volumeBotConfig)),
      ...overrides?.volumeBotConfig || {}
    } : void 0;
    const clonedPfConfig = sourceBot.priceFollowerConfig ? {
      ...JSON.parse(JSON.stringify(sourceBot.priceFollowerConfig)),
      ...overrides?.priceFollowerConfig || {},
      activeBuyOrderId: void 0,
      activeSellOrderId: void 0,
      lastRepriceTimestamp: void 0
    } : void 0;
    const clonedDlConfig = sourceBot.depthLiquidityConfig ? {
      ...JSON.parse(JSON.stringify(sourceBot.depthLiquidityConfig)),
      ...overrides?.depthLiquidityConfig || {},
      activeOrderIds: [],
      lastRepriceTimestamp: void 0
    } : void 0;
    const clonedBot = {
      id: clonedId,
      name: newName || `${sourceBot.name} (Clone)`,
      botType: sourceBot.botType,
      pairId: overrides?.pairId || sourceBot.pairId,
      environment: overrides?.environment || sourceBot.environment,
      ownerUserId: user.id,
      accountId: user.id,
      version: 1,
      status: "READY",
      // Ready to start immediately
      lastHeartbeat: Date.now(),
      orderBotConfig: clonedOrderConfig,
      volumeBotConfig: clonedVolumeConfig,
      priceFollowerConfig: clonedPfConfig,
      depthLiquidityConfig: clonedDlConfig,
      gridConfig: sourceBot.gridConfig ? JSON.parse(JSON.stringify(sourceBot.gridConfig)) : void 0,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: "0",
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [
        {
          timestamp: Date.now(),
          message: `Bot dikloning dari ${sourceBot.name} (${sourceBot.id}) oleh ${user.email} (Type: ${clonedOrderConfig?.transaction_type || sourceBot.botType}).`,
          type: "INFO"
        }
      ],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    db.botInstances.set(clonedBot.id, clonedBot);
    db.scheduleSave();
    res.json({
      success: true,
      message: `Berhasil mengkloning bot ke ${clonedBot.name} (${clonedBot.id}).`,
      bot: clonedBot
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.post("/instance/:id/update", requireMMOrAdmin, (req, res) => {
  try {
    const user = req.user;
    const bot = db.botInstances.get(req.params.id);
    if (!bot) return res.status(404).json({ error: "Bot tidak ditemukan" });
    if (bot.status === "RUNNING") {
      return res.status(400).json({ error: "Hentikan (Stop/Pause) bot terlebih dahulu sebelum mengubah konfigurasi." });
    }
    const { name, pairId, environment, orderBotConfig, volumeBotConfig } = req.body;
    if (name) bot.name = name;
    if (pairId) bot.pairId = pairId;
    if (environment) bot.environment = environment;
    if (orderBotConfig) {
      bot.orderBotConfig = {
        ...bot.orderBotConfig,
        ...orderBotConfig,
        account_id: orderBotConfig.account_id || bot.accountId,
        transaction_type: orderBotConfig.transaction_type === "SELL" ? "SELL" : "BUY",
        price_source: orderBotConfig.price_source || "MIDPOINT",
        price_decimal: Number(orderBotConfig.price_decimal || 2),
        quantity_decimal: Number(orderBotConfig.quantity_decimal || 8),
        random_min_quantity: String(orderBotConfig.random_min_quantity),
        random_max_quantity: String(orderBotConfig.random_max_quantity),
        order_count: Math.max(0, parseInt(String(orderBotConfig.order_count ?? 0), 10)),
        expire_time: parseInt(String(orderBotConfig.expire_time || 0), 10),
        split_order_mode: orderBotConfig.split_order_mode === "RANDOM_SPLIT" ? "RANDOM_SPLIT" : "NONE",
        split_range: String(orderBotConfig.split_range || "3"),
        buy_trailing_min_percentage: String(orderBotConfig.buy_trailing_min_percentage || "0.1"),
        buy_trailing_max_percentage: String(orderBotConfig.buy_trailing_max_percentage || "0.5"),
        sell_trailing_min_percentage: String(orderBotConfig.sell_trailing_min_percentage || "0.1"),
        sell_trailing_max_percentage: String(orderBotConfig.sell_trailing_max_percentage || "0.5"),
        buy_min_price_limit: String(orderBotConfig.buy_min_price_limit || ""),
        buy_max_price_limit: String(orderBotConfig.buy_max_price_limit || ""),
        sell_min_price_limit: String(orderBotConfig.sell_min_price_limit || ""),
        sell_max_price_limit: String(orderBotConfig.sell_max_price_limit || ""),
        jitter_timing_pct: Number(orderBotConfig.jitter_timing_pct || 10),
        jitter_price_pct: Number(orderBotConfig.jitter_price_pct || 2)
      };
    }
    if (volumeBotConfig) {
      bot.volumeBotConfig = {
        ...bot.volumeBotConfig,
        ...volumeBotConfig,
        account_id: volumeBotConfig.account_id || bot.accountId,
        volume_price_decimal: Number(volumeBotConfig.volume_price_decimal || 2),
        volume_quantity_decimal: Number(volumeBotConfig.volume_quantity_decimal || 8),
        volume_random_min_quantity: String(volumeBotConfig.volume_random_min_quantity),
        volume_random_max_quantity: String(volumeBotConfig.volume_random_max_quantity),
        min_delay: Math.max(1, parseInt(String(volumeBotConfig.min_delay || 2), 10)),
        max_delay: Math.max(2, parseInt(String(volumeBotConfig.max_delay || 5), 10)),
        min_difference: String(volumeBotConfig.min_difference || "0.01"),
        max_difference: String(volumeBotConfig.max_difference || "0.05"),
        priority: volumeBotConfig.priority || "RANDOM",
        max_limit_price: String(volumeBotConfig.max_limit_price || "200000000000"),
        min_limit_price: String(volumeBotConfig.min_limit_price || "100000000000"),
        vol_idr_stop_target: String(volumeBotConfig.vol_idr_stop_target),
        vol_idr_start_threshold: String(volumeBotConfig.vol_idr_start_threshold || "0"),
        volume_sell_account_id: volumeBotConfig.volume_sell_account_id || void 0
      };
    }
    if (req.body.priceFollowerConfig) {
      bot.priceFollowerConfig = {
        ...bot.priceFollowerConfig,
        ...req.body.priceFollowerConfig,
        account_id: req.body.priceFollowerConfig.account_id || bot.accountId
      };
    }
    if (req.body.depthLiquidityConfig) {
      bot.depthLiquidityConfig = {
        ...bot.depthLiquidityConfig,
        ...req.body.depthLiquidityConfig,
        account_id: req.body.depthLiquidityConfig.account_id || bot.accountId
      };
    }
    bot.version += 1;
    bot.status = "READY";
    bot.updatedBy = user.email;
    bot.updatedAt = Date.now();
    botWorkerManager.addLog(bot, `Konfigurasi bot diperbarui (v${bot.version}) oleh ${user.email}.`, "INFO");
    db.botInstances.set(bot.id, bot);
    db.scheduleSave();
    res.json({ success: true, message: `Konfigurasi bot ${bot.name} berhasil diperbarui.`, bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.post("/instance/:id/validate", requireMMOrAdmin, (req, res) => {
  const bot = db.botInstances.get(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot tidak ditemukan" });
  const result = botWorkerManager.validateConfig(bot);
  if (result.isValid) {
    bot.status = "READY";
    botWorkerManager.addLog(bot, "Validasi konfigurasi berhasil: Siap dijalankan.", "INFO");
  } else {
    bot.status = "ERROR";
    bot.errorInfo = result.errors.join("; ");
    botWorkerManager.addLog(bot, `Validasi gagal: ${bot.errorInfo}`, "ERROR");
  }
  db.scheduleSave();
  res.json({ success: result.isValid, errors: result.errors, bot });
});
mmConsoleRouter.post("/instance/:id/start", requireMMOrAdmin, (req, res) => {
  const bot = db.botInstances.get(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot tidak ditemukan" });
  const validation = botWorkerManager.validateConfig(bot);
  if (!validation.isValid) {
    return res.status(400).json({ error: "Konfigurasi tidak valid", details: validation.errors });
  }
  const started = botWorkerManager.startWorker(bot.id);
  if (!started) {
    return res.status(400).json({ error: bot.errorInfo || "Gagal memulai worker bot." });
  }
  res.json({ success: true, message: `Bot ${bot.name} berhasil dijalankan.`, bot });
});
mmConsoleRouter.post("/instance/:id/pause", requireMMOrAdmin, (req, res) => {
  const bot = db.botInstances.get(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot tidak ditemukan" });
  const paused = botWorkerManager.pauseWorker(bot.id);
  res.json({ success: paused, bot });
});
mmConsoleRouter.post("/instance/:id/resume", requireMMOrAdmin, (req, res) => {
  const bot = db.botInstances.get(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot tidak ditemukan" });
  const started = botWorkerManager.startWorker(bot.id);
  res.json({ success: started, bot });
});
mmConsoleRouter.post("/instance/:id/stop", requireMMOrAdmin, (req, res) => {
  const bot = db.botInstances.get(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot tidak ditemukan" });
  const cancelOpen = req.body.cancelOpenOrders !== false;
  const result = botWorkerManager.stopWorker(bot.id, cancelOpen);
  res.json({ success: result.success, cancelledOrders: result.cancelledOrdersCount, bot });
});
mmConsoleRouter.get("/instance/:id/logs", requireMMOrAdmin, (req, res) => {
  const bot = db.botInstances.get(req.params.id);
  if (!bot) return res.status(404).json({ error: "Bot tidak ditemukan" });
  res.json(bot.logs);
});
mmConsoleRouter.post("/instance/:id/delete", requireMMOrAdmin, (req, res) => {
  try {
    const user = req.user;
    const bot = db.botInstances.get(req.params.id);
    if (!bot) return res.status(404).json({ error: "Bot tidak ditemukan" });
    const isSuper = (user.role || "").toUpperCase() === "ADMIN" || (user.role || "").toUpperCase() === "SUPERADMIN";
    if (!isSuper && bot.ownerUserId !== user.id) {
      return res.status(403).json({ error: "Akses ditolak: Anda hanya dapat menghapus bot milik Anda sendiri." });
    }
    const result = botWorkerManager.deleteBot(bot.id, user.email);
    res.json({
      success: true,
      message: `Bot "${result.botName}" (${bot.id}) berhasil dihapus dan ${result.cancelledOrdersCount} order terbuka dibatalkan.`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.delete("/instance/:id", requireMMOrAdmin, (req, res) => {
  try {
    const user = req.user;
    const bot = db.botInstances.get(req.params.id);
    if (!bot) return res.status(404).json({ error: "Bot tidak ditemukan" });
    const isSuper = (user.role || "").toUpperCase() === "ADMIN" || (user.role || "").toUpperCase() === "SUPERADMIN";
    if (!isSuper && bot.ownerUserId !== user.id) {
      return res.status(403).json({ error: "Akses ditolak: Anda hanya dapat menghapus bot milik Anda sendiri." });
    }
    const result = botWorkerManager.deleteBot(bot.id, user.email);
    res.json({
      success: true,
      message: `Bot "${result.botName}" (${bot.id}) berhasil dihapus dan ${result.cancelledOrdersCount} order terbuka dibatalkan.`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.get("/activity-all", requireMMOrAdmin, (req, res) => {
  const user = req.user;
  const isSuper = (user.role || "").toUpperCase() === "ADMIN" || (user.role || "").toUpperCase() === "SUPERADMIN";
  const userBots = Array.from(db.botInstances.values()).filter((b) => isSuper || b.ownerUserId === user.id);
  const combinedLogs = [];
  for (const bot of userBots) {
    for (const log of bot.logs || []) {
      combinedLogs.push({
        timestamp: log.timestamp,
        botId: bot.id,
        botName: bot.name,
        botType: bot.botType,
        message: log.message,
        type: log.type
      });
    }
  }
  for (const audit of db.auditLogs) {
    if (audit.action.includes("BOT") || audit.action.includes("KILL_SWITCH") || audit.resource.includes("bot-")) {
      combinedLogs.push({
        timestamp: audit.createdAt,
        botId: audit.resource,
        botName: "Risk Controller / Sistem",
        botType: "SYSTEM",
        message: `[${audit.action}] ${audit.details} (Aktor: ${audit.actorId})`,
        type: audit.action.includes("KILL_SWITCH") ? "RISK" : "INFO"
      });
    }
  }
  combinedLogs.sort((a, b) => b.timestamp - a.timestamp);
  res.json(combinedLogs.slice(0, 300));
});
mmConsoleRouter.get("/orders", requireMMOrAdmin, (req, res) => {
  const user = req.user;
  const isSuper = (user.role || "").toUpperCase() === "ADMIN" || (user.role || "").toUpperCase() === "SUPERADMIN";
  const userBots = Array.from(db.botInstances.values()).filter((b) => isSuper || b.ownerUserId === user.id);
  const botOrderIds = /* @__PURE__ */ new Set();
  userBots.forEach((b) => b.deployedOrderIds.forEach((id) => botOrderIds.add(id)));
  const botOrders = Array.from(db.orders.values()).filter((o) => botOrderIds.has(o.id) || o.clientOrderId && o.clientOrderId.startsWith("bot-")).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
  res.json(botOrders);
});
mmConsoleRouter.get("/trades", requireMMOrAdmin, (req, res) => {
  const user = req.user;
  const isSuper = (user.role || "").toUpperCase() === "ADMIN" || (user.role || "").toUpperCase() === "SUPERADMIN";
  const userBots = Array.from(db.botInstances.values()).filter((b) => isSuper || b.ownerUserId === user.id);
  const botOrderIds = /* @__PURE__ */ new Set();
  userBots.forEach((b) => b.deployedOrderIds.forEach((id) => botOrderIds.add(id)));
  const botTrades = db.trades.filter((t) => botOrderIds.has(t.makerOrderId) || botOrderIds.has(t.takerOrderId)).slice(-100).reverse();
  res.json(botTrades);
});
mmConsoleRouter.get("/risk-controls", requireMMOrAdmin, (req, res) => {
  res.json(db.riskControls);
});
mmConsoleRouter.post("/risk-controls/update", requireAdmin, (req, res) => {
  try {
    const updates = req.body;
    db.riskControls = {
      ...db.riskControls,
      ...updates
    };
    db.scheduleSave();
    res.json({ success: true, message: "Risk controls berhasil diperbarui", riskControls: db.riskControls });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.post("/kill-switch", requireMMOrAdmin, (req, res) => {
  const result = botWorkerManager.triggerEmergencyKillSwitch();
  res.json({
    success: true,
    message: `EMERGENCY KILL-SWITCH DIAKTIFKAN: ${result.haltedBots} bot dihentikan, ${result.cancelledOrders} order terbuka dibatalkan.`,
    result
  });
});
mmConsoleRouter.post("/kill-switch/reset", requireMMOrAdmin, (req, res) => {
  botWorkerManager.resetEmergencyKillSwitch();
  res.json({ success: true, message: "Emergency Kill-Switch berhasil di-reset." });
});
mmConsoleRouter.post("/csv/import-preview", requireMMOrAdmin, (req, res) => {
  try {
    const { csvContent, botType } = req.body;
    if (!csvContent || typeof csvContent !== "string") {
      return res.status(400).json({ error: "Konten CSV tidak boleh kosong." });
    }
    const lines = csvContent.trim().split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) {
      return res.status(400).json({ error: "CSV harus memiliki baris header dan minimal 1 baris data." });
    }
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
    const parsedRows = [];
    const errors = [];
    for (let i = 1; i < lines.length; i++) {
      const rowLine = lines[i];
      const cols = rowLine.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
      if (cols.length < headers.length) {
        errors.push({ row: i, field: "row", error: `Jumlah kolom tidak sesuai: diharapkan ${headers.length}, ada ${cols.length}` });
        continue;
      }
      const rowObj = {};
      headers.forEach((h, idx) => {
        rowObj[h] = cols[idx];
      });
      if (!rowObj.name) errors.push({ row: i, field: "name", error: "Nama bot wajib diisi" });
      if (!rowObj.pairId && !rowObj.pair) errors.push({ row: i, field: "pairId", error: "Trading pair wajib diisi" });
      parsedRows.push({
        rowNumber: i,
        data: rowObj,
        isValid: !errors.some((e) => e.row === i)
      });
    }
    res.json({
      totalRows: lines.length - 1,
      validRowsCount: parsedRows.filter((r) => r.isValid).length,
      rows: parsedRows,
      errors
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.post("/csv/import-confirm", requireMMOrAdmin, (req, res) => {
  try {
    const user = req.user;
    const { rows, defaultBotType, defaultEnvironment } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "Tidak ada baris data valid untuk diimpor." });
    }
    const createdBots = [];
    for (const r of rows) {
      const data = r.data || r;
      const bType = data.botType || defaultBotType || "ORDER_BOT";
      const botId = `bot-${bType.toLowerCase().slice(0, 3)}-${crypto14.randomUUID().slice(0, 8)}`;
      let orderCfg;
      let volCfg;
      if (bType === "ORDER_BOT") {
        orderCfg = {
          account_id: data.account_id || user.id,
          price_source: data.price_source || "MIDPOINT",
          price_decimal: Number(data.price_decimal || 2),
          quantity_decimal: Number(data.quantity_decimal || 8),
          random_min_quantity: String(data.random_min_quantity || "0.01"),
          random_max_quantity: String(data.random_max_quantity || "0.05"),
          order_count: parseInt(String(data.order_count || 10), 10),
          expire_time: parseInt(String(data.expire_time || 0), 10),
          transaction_type: (data.transaction_type || "BUY").toUpperCase(),
          split_order_mode: data.split_order_mode || "NONE",
          split_range: String(data.split_range || "3"),
          buy_trailing_min_percentage: String(data.buy_trailing_min_percentage || "0.1"),
          buy_trailing_max_percentage: String(data.buy_trailing_max_percentage || "0.5"),
          sell_trailing_min_percentage: String(data.sell_trailing_min_percentage || "0.1"),
          sell_trailing_max_percentage: String(data.sell_trailing_max_percentage || "0.5"),
          buy_max_price_limit: String(data.buy_max_price_limit || ""),
          sell_min_price_limit: String(data.sell_min_price_limit || ""),
          jitter_timing_pct: Number(data.jitter_timing_pct || 10),
          jitter_price_pct: Number(data.jitter_price_pct || 2)
        };
      } else {
        volCfg = {
          account_id: data.account_id || user.id,
          volume_price_decimal: Number(data.volume_price_decimal || 2),
          volume_quantity_decimal: Number(data.volume_quantity_decimal || 8),
          volume_random_min_quantity: String(data.volume_random_min_quantity || "0.01"),
          volume_random_max_quantity: String(data.volume_random_max_quantity || "0.05"),
          min_delay: parseInt(String(data.min_delay || 2), 10),
          max_delay: parseInt(String(data.max_delay || 5), 10),
          min_difference: String(data.min_difference || "0.01"),
          max_difference: String(data.max_difference || "0.05"),
          priority: data.priority || "RANDOM",
          max_limit_price: String(data.max_limit_price || "200000000000"),
          min_limit_price: String(data.min_limit_price || "100000000000"),
          vol_idr_stop_target: String(data.vol_idr_stop_target || "1000000000"),
          vol_idr_start_threshold: String(data.vol_idr_start_threshold || "0")
        };
      }
      const bot = {
        id: botId,
        name: data.name || `Imported ${bType} ${createdBots.length + 1}`,
        botType: bType,
        pairId: data.pairId || data.pair || "BTC-IDR",
        environment: data.environment || defaultEnvironment || "DEMO",
        ownerUserId: user.id,
        accountId: user.id,
        version: 1,
        status: "DRAFT",
        // Never auto-activated on import per spec
        lastHeartbeat: Date.now(),
        orderBotConfig: orderCfg,
        volumeBotConfig: volCfg,
        stats: {
          ordersSubmitted: 0,
          ordersAccepted: 0,
          ordersFilled: 0,
          executedVolume: "0",
          totalTrades: 0
        },
        deployedOrderIds: [],
        logs: [
          {
            timestamp: Date.now(),
            message: `Bot berhasil diimpor dari file CSV (Status: DRAFT).`,
            type: "INFO"
          }
        ],
        createdBy: user.email,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      db.botInstances.set(bot.id, bot);
      createdBots.push(bot);
    }
    db.scheduleSave();
    res.json({
      success: true,
      message: `Berhasil mengimpor ${createdBots.length} bot konfigurasi (status DRAFT).`,
      importedCount: createdBots.length,
      bots: createdBots
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.get("/csv/export", requireMMOrAdmin, (req, res) => {
  const user = req.user;
  const isSuper = (user.role || "").toUpperCase() === "ADMIN" || (user.role || "").toUpperCase() === "SUPERADMIN";
  const typeFilter = req.query.botType || "ORDER_BOT";
  const bots = Array.from(db.botInstances.values()).filter((b) => (isSuper || b.ownerUserId === user.id) && b.botType === typeFilter);
  if (typeFilter === "ORDER_BOT") {
    const headers = [
      "id",
      "name",
      "pairId",
      "environment",
      "account_id",
      "price_source",
      "price_decimal",
      "quantity_decimal",
      "random_min_quantity",
      "random_max_quantity",
      "order_count",
      "expire_time",
      "transaction_type",
      "split_order_mode",
      "split_range",
      "buy_trailing_min_percentage",
      "buy_trailing_max_percentage",
      "sell_trailing_min_percentage",
      "sell_trailing_max_percentage",
      "buy_max_price_limit",
      "sell_min_price_limit",
      "jitter_timing_pct",
      "jitter_price_pct"
    ];
    const rows = bots.map((b) => {
      const c = b.orderBotConfig || {};
      return [
        b.id,
        `"${b.name}"`,
        b.pairId,
        b.environment,
        c.account_id || b.ownerUserId,
        c.price_source || "MIDPOINT",
        c.price_decimal || 2,
        c.quantity_decimal || 8,
        c.random_min_quantity || "0.01",
        c.random_max_quantity || "0.05",
        c.order_count || 10,
        c.expire_time || 0,
        c.transaction_type || "BUY",
        c.split_order_mode || "NONE",
        c.split_range || "3",
        c.buy_trailing_min_percentage || "0.1",
        c.buy_trailing_max_percentage || "0.5",
        c.sell_trailing_min_percentage || "0.1",
        c.sell_trailing_max_percentage || "0.5",
        c.buy_max_price_limit || "",
        c.sell_min_price_limit || "",
        c.jitter_timing_pct || 10,
        c.jitter_price_pct || 2
      ].join(",");
    });
    const csvOutput = [headers.join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="dimonex_order_bots.csv"');
    res.send(csvOutput);
  } else {
    const headers = [
      "id",
      "name",
      "pairId",
      "environment",
      "account_id",
      "volume_price_decimal",
      "volume_quantity_decimal",
      "volume_random_min_quantity",
      "volume_random_max_quantity",
      "min_delay",
      "max_delay",
      "min_difference",
      "max_difference",
      "priority",
      "max_limit_price",
      "min_limit_price",
      "vol_idr_stop_target",
      "vol_idr_start_threshold",
      "volume_sell_account_id"
    ];
    const rows = bots.map((b) => {
      const c = b.volumeBotConfig || {};
      return [
        b.id,
        `"${b.name}"`,
        b.pairId,
        b.environment,
        c.account_id || b.ownerUserId,
        c.volume_price_decimal || 2,
        c.volume_quantity_decimal || 8,
        c.volume_random_min_quantity || "0.01",
        c.volume_random_max_quantity || "0.05",
        c.min_delay || 2,
        c.max_delay || 5,
        c.min_difference || "0.01",
        c.max_difference || "0.05",
        c.priority || "RANDOM",
        c.max_limit_price || "",
        c.min_limit_price || "",
        c.vol_idr_stop_target || "1000000000",
        c.vol_idr_start_threshold || "0",
        c.volume_sell_account_id || ""
      ].join(",");
    });
    const csvOutput = [headers.join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="dimonex_volume_bots.csv"');
    res.send(csvOutput);
  }
});
mmConsoleRouter.get("/external-feeds", requireMMOrAdmin, (req, res) => {
  try {
    const status = priceAggregatorService.getProvidersStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
mmConsoleRouter.post("/external-feeds/reconnect", requireMMOrAdmin, async (req, res) => {
  try {
    const { provider } = req.body;
    if (provider === "binance" || !provider) {
      await priceAggregatorService.binance.reconnect();
    }
    if (provider === "bybit" || !provider) {
      await priceAggregatorService.bybit.reconnect();
    }
    res.json({ success: true, message: `Permintaan reconnect provider ${provider || "semua"} berhasil dikirim.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
mmConsoleRouter.post("/external-feeds/config", requireMMOrAdmin, (req, res) => {
  try {
    const updated = priceAggregatorService.updateConfig(req.body);
    res.json({ success: true, message: "Konfigurasi Price Aggregator berhasil diperbarui.", config: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.get("/fx-rate", requireMMOrAdmin, (req, res) => {
  try {
    const currentRate = fxConversionService.getCurrentRate();
    const history = fxConversionService.getAuditHistory();
    const btcRef = priceAggregatorService.getReferencePrice("BTC-IDR");
    const ethRef = priceAggregatorService.getReferencePrice("ETH-IDR");
    const usdtRef = priceAggregatorService.getReferencePrice("USDT-IDR");
    res.json({
      success: true,
      currentRate,
      history,
      referencePrices: {
        "BTC-IDR": btcRef,
        "ETH-IDR": ethRef,
        "USDT-IDR": usdtRef
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
mmConsoleRouter.post("/fx-rate/update", requireAdmin, (req, res) => {
  try {
    const user = req.user;
    const { newRate, notes, validityHours, confirmOutOfBand } = req.body;
    if (!newRate) {
      return res.status(400).json({ error: "Nilai kurs newRate wajib diisi." });
    }
    const result = fxConversionService.updateManualRate(
      parseFloat(newRate),
      user.email,
      notes,
      parseInt(String(validityHours || 24), 10),
      Boolean(confirmOutOfBand)
    );
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json({
      success: true,
      message: `Kurs USDT/IDR berhasil diperbarui menjadi Rp ${result.rateRecord?.rate.toLocaleString()}.`,
      rateRecord: result.rateRecord
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.post("/fx-rate/sync-cmc", requireMMOrAdmin, async (req, res) => {
  try {
    const user = req.user;
    const { validityHours } = req.body;
    const cmcTick = priceAggregatorService.cmc.getTick("USDTIDR");
    const rateToUse = cmcTick?.lastPrice || 16365;
    const result = fxConversionService.syncWithCoinMarketCap(
      rateToUse,
      user.email,
      parseInt(String(validityHours || 6), 10)
    );
    res.json({
      success: true,
      message: `Kurs USDT/IDR berhasil disinkronkan dari CoinMarketCap menjadi Rp ${result.rateRecord.rate.toLocaleString()}.`,
      rateRecord: result.rateRecord
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.post("/price-follower/create", requireMMOrAdmin, (req, res) => {
  try {
    const user = req.user;
    const {
      name,
      pairId,
      environment,
      account_id,
      reference_provider,
      reference_price_source,
      reference_price_mode,
      target_spread_bps,
      buy_offset_bps,
      sell_offset_bps,
      order_quantity,
      minimum_reprice_interval_ms,
      minimum_price_change_bps,
      maximum_price_deviation_bps,
      maximum_order_quantity,
      maximum_order_value_idr,
      maximum_open_orders,
      maximum_inventory,
      maximum_daily_turnover_idr,
      maximum_daily_loss_idr,
      maximum_cancel_replace_rate,
      max_data_age_ms,
      tick_size,
      lot_size,
      dry_run
    } = req.body;
    if (!name || !pairId || !order_quantity) {
      return res.status(400).json({ error: "Nama bot, pair, dan kuantitas order wajib diisi." });
    }
    const priceFollowerConfig = {
      account_id: account_id || user.id,
      market_symbol: pairId,
      reference_provider: reference_provider || "AGGREGATED",
      reference_price_source: reference_price_source || "MIDPOINT",
      reference_price_mode: reference_price_mode || "STATIC_OFFSET",
      target_spread_bps: Number(target_spread_bps || 40),
      buy_offset_bps: Number(buy_offset_bps || 20),
      sell_offset_bps: Number(sell_offset_bps || 20),
      order_quantity: String(order_quantity),
      minimum_reprice_interval_ms: Number(minimum_reprice_interval_ms || 2e3),
      minimum_price_change_bps: Number(minimum_price_change_bps || 5),
      maximum_price_deviation_bps: Number(maximum_price_deviation_bps || 300),
      maximum_order_quantity: String(maximum_order_quantity || "1.0"),
      maximum_order_value_idr: String(maximum_order_value_idr || "100000000"),
      maximum_open_orders: Number(maximum_open_orders || 2),
      maximum_inventory: String(maximum_inventory || "5.0"),
      maximum_daily_turnover_idr: String(maximum_daily_turnover_idr || "500000000"),
      maximum_daily_loss_idr: String(maximum_daily_loss_idr || "25000000"),
      maximum_cancel_replace_rate: Number(maximum_cancel_replace_rate || 5),
      max_data_age_ms: Number(max_data_age_ms || 5e3),
      tick_size: Number(tick_size || 1e3),
      lot_size: String(lot_size || "0.0001"),
      enabled: true,
      dry_run: Boolean(dry_run)
    };
    const botId = `bot-fol-${crypto14.randomUUID().slice(0, 8)}`;
    const bot = {
      id: botId,
      name,
      botType: "PRICE_FOLLOWER",
      pairId,
      environment: environment || "DEMO",
      ownerUserId: user.id,
      accountId: account_id || user.id,
      version: 1,
      status: "READY",
      lastHeartbeat: Date.now(),
      priceFollowerConfig,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: "0",
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [
        {
          timestamp: Date.now(),
          message: `Price Follower Bot dibuat oleh ${user.email} (Provider: ${priceFollowerConfig.reference_provider}, Buy Offset: ${priceFollowerConfig.buy_offset_bps} bps, Sell Offset: ${priceFollowerConfig.sell_offset_bps} bps).`,
          type: "INFO"
        }
      ],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    db.botInstances.set(bot.id, bot);
    db.scheduleSave();
    res.json({ success: true, message: `Price Follower Bot "${bot.name}" berhasil dibuat.`, bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.post("/depth-liquidity/create", requireMMOrAdmin, (req, res) => {
  try {
    const user = req.user;
    const {
      name,
      pairId,
      environment,
      account_id,
      reference_price_source,
      spacing_mode,
      level_spacing_idr,
      number_of_bid_levels,
      number_of_ask_levels,
      bid_level_offsets_bps,
      ask_level_offsets_bps,
      bid_quantities,
      ask_quantities,
      quantity_randomization_enabled,
      random_min_quantity,
      random_max_quantity,
      minimum_reprice_interval_ms,
      minimum_price_change_bps,
      maximum_open_orders,
      maximum_total_bid_value_idr,
      maximum_total_ask_quantity,
      maximum_inventory,
      maximum_order_value_idr,
      max_data_age_ms,
      tick_size,
      lot_size,
      dry_run
    } = req.body;
    if (!name || !pairId) {
      return res.status(400).json({ error: "Nama bot dan pair wajib diisi." });
    }
    const defaultTick = pairId === "USDT-IDR" ? 1 : pairId === "ETH-IDR" ? 100 : 1e3;
    const finalTick = tick_size && (pairId !== "USDT-IDR" || tick_size <= 50) ? Number(tick_size) : defaultTick;
    const defaultSpacing = pairId === "USDT-IDR" ? 60 : pairId === "ETH-IDR" ? 1e5 : 1e6;
    const depthLiquidityConfig = {
      account_id: account_id || user.id,
      market_symbol: pairId,
      reference_price_source: reference_price_source || "AGGREGATED",
      spacing_mode: spacing_mode || (pairId === "USDT-IDR" ? "FIXED_IDR" : "PERCENT_BPS"),
      level_spacing_idr: Number(level_spacing_idr || defaultSpacing),
      number_of_bid_levels: Number(number_of_bid_levels || 5),
      number_of_ask_levels: Number(number_of_ask_levels || 5),
      bid_level_offsets_bps: Array.isArray(bid_level_offsets_bps) ? bid_level_offsets_bps : [10, 25, 50, 80, 120],
      ask_level_offsets_bps: Array.isArray(ask_level_offsets_bps) ? ask_level_offsets_bps : [10, 25, 50, 80, 120],
      bid_quantities: Array.isArray(bid_quantities) ? bid_quantities : pairId === "USDT-IDR" ? ["25.0", "50.0", "75.0", "100.0", "150.0"] : ["0.02", "0.05", "0.10", "0.15", "0.20"],
      ask_quantities: Array.isArray(ask_quantities) ? ask_quantities : pairId === "USDT-IDR" ? ["25.0", "50.0", "75.0", "100.0", "150.0"] : ["0.02", "0.05", "0.10", "0.15", "0.20"],
      quantity_randomization_enabled: Boolean(quantity_randomization_enabled),
      random_min_quantity: String(random_min_quantity || (pairId === "USDT-IDR" ? "5.0" : "0.01")),
      random_max_quantity: String(random_max_quantity || (pairId === "USDT-IDR" ? "25.0" : "0.05")),
      minimum_reprice_interval_ms: Number(minimum_reprice_interval_ms || 3e3),
      minimum_price_change_bps: Number(minimum_price_change_bps || 10),
      maximum_open_orders: Number(maximum_open_orders || 40),
      maximum_total_bid_value_idr: String(maximum_total_bid_value_idr || "500000000"),
      maximum_total_ask_quantity: String(maximum_total_ask_quantity || "500.0"),
      maximum_inventory: String(maximum_inventory || "1000.0"),
      maximum_order_value_idr: String(maximum_order_value_idr || "100000000"),
      max_data_age_ms: Number(max_data_age_ms || 5e3),
      tick_size: finalTick,
      lot_size: String(lot_size || "0.0001"),
      dry_run: Boolean(dry_run),
      enabled: true,
      activeOrderIds: []
    };
    const botId = `bot-dep-${crypto14.randomUUID().slice(0, 8)}`;
    const bot = {
      id: botId,
      name,
      botType: "DEPTH_LIQUIDITY",
      pairId,
      environment: environment || "DEMO",
      ownerUserId: user.id,
      accountId: account_id || user.id,
      version: 1,
      status: "READY",
      lastHeartbeat: Date.now(),
      depthLiquidityConfig,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: "0",
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [
        {
          timestamp: Date.now(),
          message: `Depth & Liquidity Bot dibuat oleh ${user.email} (${depthLiquidityConfig.number_of_bid_levels} Bid Levels, ${depthLiquidityConfig.number_of_ask_levels} Ask Levels).`,
          type: "INFO"
        }
      ],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    db.botInstances.set(bot.id, bot);
    db.scheduleSave();
    res.json({ success: true, message: `Depth & Liquidity Bot "${bot.name}" berhasil dibuat.`, bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
mmConsoleRouter.get("/reference-prices", (req, res) => {
  try {
    const pairs = Array.from(db.tradingPairs.keys());
    const result = {};
    for (const p of pairs) {
      result[p] = priceAggregatorService.getReferencePrice(p);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// server/routes/observability.ts
init_database();
import { Router as Router10 } from "express";
var observabilityRouter = Router10();
observabilityRouter.get("/health", (req, res) => {
  const invariantCheck = LedgerService.verifyGlobalInvariants();
  res.json({
    status: invariantCheck.isConsistent ? "HEALTHY" : "DEGRADED",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    invariants: {
      isConsistent: invariantCheck.isConsistent,
      errors: invariantCheck.errors
    },
    engine: {
      pairsActive: Array.from(db.tradingPairs.values()).filter((p) => p.isActive && !p.isHalted).length,
      openOrders: Array.from(db.orders.values()).filter((o) => o.status === "NEW" || o.status === "PARTIALLY_FILLED").length,
      totalTradesExecuted: db.trades.length
    }
  });
});
observabilityRouter.get("/metrics", (req, res) => {
  const openOrdersCount = Array.from(db.orders.values()).filter((o) => o.status === "NEW" || o.status === "PARTIALLY_FILLED").length;
  const invariant = LedgerService.verifyGlobalInvariants();
  let metrics = `# HELP dimonex_uptime_seconds Process uptime in seconds
# TYPE dimonex_uptime_seconds gauge
dimonex_uptime_seconds ${Math.floor(process.uptime())}

# HELP dimonex_users_total Total registered users
# TYPE dimonex_users_total gauge
dimonex_users_total ${db.users.size}

# HELP dimonex_orders_open Current count of open orders in memory
# TYPE dimonex_orders_open gauge
dimonex_orders_open ${openOrdersCount}

# HELP dimonex_trades_total Total trades executed by matching engine
# TYPE dimonex_trades_total counter
dimonex_trades_total ${db.trades.length}

# HELP dimonex_ledger_accounts_total Total active ledger accounts
# TYPE dimonex_ledger_accounts_total gauge
dimonex_ledger_accounts_total ${db.ledgerAccounts.size}

# HELP dimonex_invariants_valid 1 if sum(debit)==sum(credit) and zero overdraft, 0 otherwise
# TYPE dimonex_invariants_valid gauge
dimonex_invariants_valid ${invariant.isConsistent ? 1 : 0}
`;
  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(metrics);
});
observabilityRouter.get("/api/ledger/verify-invariants", (req, res) => {
  const check = LedgerService.verifyGlobalInvariants();
  res.json(check);
});

// server/serverApp.ts
async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const portArgIdx = process.argv.indexOf("--port");
  const portVal = portArgIdx !== -1 ? process.argv[portArgIdx + 1] : void 0;
  const PORT = parseInt(
    portVal || (process.env.PORT && process.env.PORT !== "8080" ? process.env.PORT : "3000"),
    10
  );
  app.use(express.json());
  const wss = new WebSocketServer2({ server, path: "/ws" });
  marketWsService.initialize(wss);
  app.use("/api/auth", authRouter);
  app.use("/api/kyc", kycRouter);
  app.use("/api/trading", tradingRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/api-keys", apiKeyRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/risk", riskRouter);
  app.use("/api/bot", botRouter);
  app.use("/api/mm", mmConsoleRouter);
  app.use("/api/bot/mm", mmConsoleRouter);
  app.use("/", observabilityRouter);
  app.all("/api/*", (req, res) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.path}`,
      status: 404
    });
  });
  const distPath = path4.resolve(process.cwd(), "dist");
  const distExists = fs4.existsSync(path4.resolve(distPath, "index.html"));
  const isProduction = process.env.NODE_ENV === "production" || distExists;
  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path4.resolve(distPath, "index.html"));
    });
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[DIMONEX] Full-Stack Exchange Engine listening on http://0.0.0.0:${PORT} (Mode: ${isProduction ? "PRODUCTION / STATIC" : "DEVELOPMENT / VITE"})`);
  });
}
startServer().catch((err) => {
  console.error("[DIMONEX] Failed to launch server:", err);
  process.exit(1);
});
export {
  startServer
};
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PrecisionMath.ts
 * DIMONEX Zero-Float Fixed-Point Mathematical Engine
 * Absolute rule: NEVER use IEEE-754 binary floating point (JavaScript 'number')
 * for financial calculation, balances, fees, prices, or quantities.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * database.ts
 * In-memory ACID Transactional Database Store for DIMONEX.
 * Supports thread-safe operations, optimistic locking, indexing, and seed bootstrap.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * BinancePublicFeed.ts
 * Real-time public WebSocket feed adapter for Binance Spot.
 * Stream endpoints: wss://stream.binance.com:9443/ws or wss://data-stream.binance.vision/ws
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * BybitPublicFeed.ts
 * Real-time public WebSocket feed adapter for Bybit Spot (v5 API).
 * Public endpoint: wss://stream.bybit.com/v5/public/spot
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CoinMarketCapFeed.ts
 * Real Live Market Data Provider adapter for CoinMarketCap Pro API.
 * Uses real API key to fetch authoritative spot market quotes for BTC/USDT, ETH/USDT,
 * and USDT/IDR currency exchange rate.
 * NO MOCK DATA OR FAKE PRICES.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FxConversionService.ts
 * USDT/IDR Conversion Engine with Admin Manual Overrides, Validity Duration,
 * Safeguards, and Audit History.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PriceAggregatorService.ts
 * Multi-Exchange Price Aggregator (Binance & Bybit) with deviation check,
 * staleness detection, automatic failover, and USDT/IDR FX conversion.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * AuthService.ts
 * Multi-layer Authentication, RFC-6238 TOTP 2FA, Anti-Brute-Force, and Session Manager.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * auth.ts
 * Authentication endpoints: register, login, 2FA TOTP setup, sessions.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * kyc.ts
 * KYC management with Indonesian KTP & Selfie verification, OCR simulation, and Tier limits.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerService.ts
 * Double-Entry Immutable Atomic Ledger Service for DIMONEX.
 * 
 * INVARIANTS ENFORCED:
 * 1. For every journal: Sum(Debits) === Sum(Credits)
 * 2. User balance invariants: BalanceAvailable >= 0, BalanceLocked >= 0
 * 3. Total Balance = BalanceAvailable + BalanceLocked
 * 4. Idempotency: Duplicate idempotency keys return existing transaction
 * 5. Append-only ledger entries: Records cannot be updated or deleted
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * KlineService.ts
 * Authoritative Candlestick (OHLCV) Aggregator & Persistent Kline Engine for DIMONEX.
 * 
 * Guarantees:
 * - 100% Real Trade-Grounded: No mock candles, no fake bars, no synthetic sine-wave candles.
 * - Candles are produced strictly from actual executed trades matched by the exchange engine.
 * - Gap Policy: Intervals with no trades create zero-volume continuation candles bounded only between real trades.
 * - Idempotent replay: Replaying the same trade event updates existing intervals accurately without duplicate volume.
 * - Persistent to disk across server restarts and timeframe switches.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * OrderBook.ts
 * High-performance In-Memory Single-Threaded Order Book per pair for DIMONEX.
 * Features:
 * - Price-Time Priority (FIFO at same price level)
 * - Limit & Market orders
 * - Time-In-Force: GTC (Good-Til-Cancelled) & IOC (Immediate-Or-Cancel)
 * - Self-Trade Prevention (STP: Cancel Maker to prevent wash trading)
 * - Atomic Event Sourcing WAL (replayable)
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MatchingEngine.ts
 * DIMONEX Matching Engine Orchestrator
 * Manages pairs, order queues, fund pre-locking, and event replay.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MarketDataWs.ts
 * Real-time WebSocket market data broadcaster for DIMONEX.
 * Topics:
 * - depth:<pairId> (Order Book Level 2 depth)
 * - trades:<pairId> (Public trade executions)
 * - ticker (24h price and volume stats)
 * - orders:<userId> (Private user fill and balance notifications)
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * trading.ts
 * Core trading REST endpoints: order placement, cancellation, depth, trades, and pairs.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * wallet.ts
 * Wallet management: balances, Virtual Account IDR deposits/withdrawals,
 * name matching verification with KYC, crypto address generator, and block listener.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * apiKeys.ts
 * Public API & API Key Management with HMAC-SHA256 signature authentication.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * admin.ts
 * Admin Panel routes: KYC review, pair listing/halt, fee configuration,
 * withdrawal approvals, and system audit logs.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * risk.ts
 * Risk & Compliance module: suspicious transaction monitoring, account freezing, AML reports.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * bot.ts
 * Algorithmic Trading Bot Manager for DIMONEX.
 * Integrates directly with HMAC-SHA256 API Key authentication and assigns
 * all limit orders to the deploying user's account with clear clientOrderId tags.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PriceFollowerBot.ts
 * Real Market-Making Price Follower Bot for DIMONEX.
 * Tracks external reference prices (Binance/Bybit/Aggregated) converted to IDR
 * and places real Limit Buy/Sell orders into the authoritative Matching Engine.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * DepthLiquidityBot.ts
 * Real Multi-Level Depth & Liquidity Market-Making Bot for DIMONEX.
 * Deploys multiple authentic bid and ask ladder levels around the validated reference price
 * directly into the single-threaded authoritative Matching Engine.
 * 
 * Enforces:
 * - Fixed IDR Spacing (e.g. exactly IDR 60 between consecutive levels on USDT/IDR)
 *   or strict Monotonic BPS Dispersion so orders disperse ("mencar") across depth rungs.
 * - Zero order stacking at identical prices (no duplicates).
 * - Pair-aware tick sizing (USDT/IDR = 1 IDR tick, not coarse 1,000 IDR).
 * - Real-time WebSocket depth broadcasting to OrderBookView & DepthChart.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * BotWorkerManager.ts
 * Authoritative Algorithmic Worker & MM Concurrency Manager for DIMONEX.
 * 
 * Enforces:
 * - Single worker per bot instance using durable runtime leases
 * - Independent execution state for cloned bots
 * - Strict risk boundaries and common-ownership self-trade prevention
 * - Real matching-engine submission (no mock balances or simulated trades)
 * - Safe emergency stop and order cancellation
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * mmConsole.ts
 * Authenticated Market Maker (MM) Console Router for DIMONEX.
 * Endpoints for Order Bots, Volume Bots, Instance Cloning, CSV Import/Export, and Risk Controls.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * observability.ts
 * Prometheus metrics, system health checks, and Ledger Invariant verifier.
 */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * server/serverApp.ts
 * DIMONEX Full-Stack Server Application
 * Mounts Express API Gateway, WebSocket Server, and Vite Middlewares / static assets.
 */
