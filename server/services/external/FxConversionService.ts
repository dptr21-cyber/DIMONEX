/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * FxConversionService.ts
 * USDT/IDR FX Conversion Engine with Admin Manual Overrides, CoinMarketCap Live Feed,
 * Configurable Sync Interval for API Quota Saving, Safeguards, and Cryptographic Audit History.
 * 
 * Formula Spot Price Conversion:
 * BTC/IDR = BTC/USDT × USDT/IDR
 * ETH/IDR = ETH/USDT × USDT/IDR
 * SOL/IDR = SOL/USDT × USDT/IDR
 */

import crypto from 'crypto';
import dns from 'node:dns';
import { db } from '../../db/database.js';
import { FxRateRecord, FxRateAuditEntry, FxConversionConfig } from './ExternalFeedTypes.js';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

const FX_FETCH_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'DIMONEX-FX-Engine/1.0',
};

export class FxConversionService {
  private currentRate: FxRateRecord;
  private auditHistory: FxRateAuditEntry[] = [];
  private maxChangeWithoutConfirmPct = 10.0; // 10% max jump without explicit confirmation
  private config: FxConversionConfig;
  private backgroundTimer: NodeJS.Timeout | null = null;
  private cmcRateLimitedUntil = 0;
  private hasLoggedCmcQuota = false;
  private providerCooldownUntil: Map<string, number> = new Map();
  private providerCooldownLogged: Set<string> = new Set();
  private inFlightSyncPromise: Promise<{
    success: boolean;
    rateRecord?: FxRateRecord;
    error?: string;
    source?: string;
    cached?: boolean;
    message?: string;
  }> | null = null;

  constructor() {
    const now = Date.now();
    // Default initial baseline rate before first live fetch resolves
    this.currentRate = {
      rate: 16350.00,
      source: 'SYSTEM_DEFAULT',
      updatedBy: 'system@dimonex.id',
      updatedAt: now,
      validUntil: now + 48 * 60 * 60 * 1000,
      isStale: false,
      notes: 'Initial production baseline USDT/IDR rate.'
    };

    // Default configuration: 15 minutes sync interval to conserve CoinMarketCap API quota.
    // nextCmcFetchTimestamp starts at 0 so the initial boot sync immediately fetches a real live rate.
    this.config = {
      syncIntervalMinutes: 15, // 15 mins (saves API calls: ~96 calls/day instead of 86,400)
      isManualLocked: false,
      lastCmcFetchTimestamp: 0,
      nextCmcFetchTimestamp: 0,
      cmcApiCallsCount: 0,
      quotaSavedCount: 0
    };

    const initialAudit: FxRateAuditEntry = {
      id: `fx-audit-${crypto.randomUUID().slice(0, 8)}`,
      timestamp: now,
      actor: 'system@dimonex.id',
      previousRate: 16350.00,
      newRate: 16350.00,
      percentChange: 0,
      source: 'SYSTEM_DEFAULT',
      notes: 'Initial baseline setup',
      hash: this.computeAuditHash('system@dimonex.id', 16350, 16350, now, 'SYSTEM_DEFAULT')
    };
    this.auditHistory.push(initialAudit);

    this.startBackgroundSync();
  }

  /**
   * Cryptographic hash verification for immutable audit log integrity
   */
  private computeAuditHash(actor: string, prev: number, next: number, ts: number, source: string): string {
    return crypto.createHash('sha256')
      .update(`${actor}:${prev}:${next}:${ts}:${source}:dimonex-fx-v1`)
      .digest('hex');
  }

  /**
   * Background runner to periodically sync rate based on configured interval
   */
  private startBackgroundSync() {
    if (this.backgroundTimer) clearInterval(this.backgroundTimer);
    this.backgroundTimer = setInterval(async () => {
      const now = Date.now();
      if (!this.config.isManualLocked && this.config.syncIntervalMinutes > 0) {
        if (now >= this.config.nextCmcFetchTimestamp) {
          try {
            await this.fetchAndSyncLiveRate('system-cron@dimonex.id', 6, false);
          } catch (e: any) {
            console.warn('[FxConversionService] Background auto-sync tick failed:', e?.message);
          }
        }
      }
    }, 60000); // Check every 60 seconds (cache saver skips actual API calls within syncIntervalMinutes)
    this.backgroundTimer.unref?.();
  }

  public isCmcQuotaExhausted(now = Date.now()): boolean {
    return now < this.cmcRateLimitedUntil;
  }

  /**
   * Mark CoinMarketCap API key as quota-exhausted (defaults to 12 hours backoff).
   * Returns true only on the first transition into exhausted state so callers log once cleanly.
   */
  public markCmcQuotaExhausted(cooldownMs = 12 * 60 * 60 * 1000): boolean {
    const now = Date.now();
    const wasActive = now < this.cmcRateLimitedUntil;
    this.cmcRateLimitedUntil = Math.max(this.cmcRateLimitedUntil, now + cooldownMs);
    if (!wasActive && !this.hasLoggedCmcQuota) {
      this.hasLoggedCmcQuota = true;
      return true;
    }
    return false;
  }

  /**
   * Get current active FX rate record with freshness validation
   */
  public getCurrentRate(): FxRateRecord {
    const now = Date.now();
    const isExpired = now > this.currentRate.validUntil;
    return {
      ...this.currentRate,
      isStale: isExpired
    };
  }

  /**
   * Get current configuration
   */
  public getConfig(): FxConversionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (Sync interval, Manual lock)
   */
  public updateConfig(newConfig: Partial<FxConversionConfig>, actorEmail: string): FxConversionConfig {
    if (newConfig.syncIntervalMinutes !== undefined) {
      const minutes = Math.max(0, parseInt(String(newConfig.syncIntervalMinutes), 10));
      this.config.syncIntervalMinutes = minutes;
      const now = Date.now();
      this.config.nextCmcFetchTimestamp = minutes > 0 ? now + minutes * 60 * 1000 : 0;
    }
    if (newConfig.isManualLocked !== undefined) {
      this.config.isManualLocked = Boolean(newConfig.isManualLocked);
    }

    db.auditLogs.unshift({
      id: `audit-${crypto.randomUUID().slice(0, 8)}`,
      actorId: actorEmail,
      action: 'FX_CONFIG_UPDATE',
      resource: 'USDT-IDR',
      details: `Konfigurasi FX diubah: Interval CMC = ${this.config.syncIntervalMinutes} menit, Kunci Manual = ${this.config.isManualLocked}`,
      createdAt: Date.now()
    });
    db.scheduleSave();

    return this.getConfig();
  }

  /**
   * Admin updates manual USDT/IDR rate
   */
  public updateManualRate(
    newRate: number, 
    actorEmail: string, 
    notes?: string, 
    validityHours = 24, 
    confirmOutOfBand = false
  ): { success: boolean; error?: string; rateRecord?: FxRateRecord } {
    if (isNaN(newRate) || newRate <= 0) {
      return { success: false, error: 'Kurs USDT/IDR harus berupa angka positif lebih dari 0.' };
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
    const validUntil = now + Math.max(1, validityHours) * 60 * 60 * 1000;

    this.currentRate = {
      rate: parseFloat(newRate.toFixed(2)),
      source: 'MANUAL_ADMIN',
      updatedBy: actorEmail,
      updatedAt: now,
      validUntil,
      isStale: false,
      notes: notes || `Diperbarui secara manual oleh ${actorEmail}`
    };

    // Automatically lock manual override so automatic background CMC calls do not instantly overwrite
    this.config.isManualLocked = true;

    const auditEntry: FxRateAuditEntry = {
      id: `fx-audit-${crypto.randomUUID().slice(0, 8)}`,
      timestamp: now,
      actor: actorEmail,
      previousRate: prevRate,
      newRate: this.currentRate.rate,
      percentChange: parseFloat(pctChange.toFixed(2)),
      source: 'MANUAL_ADMIN',
      notes: notes || 'Update manual via Admin / MM Console',
      hash: this.computeAuditHash(actorEmail, prevRate, this.currentRate.rate, now, 'MANUAL_ADMIN')
    };

    this.auditHistory.unshift(auditEntry);
    if (this.auditHistory.length > 200) this.auditHistory.pop();

    // Record in global audit logs
    db.auditLogs.unshift({
      id: `audit-${crypto.randomUUID().slice(0, 8)}`,
      actorId: actorEmail,
      action: 'FX_RATE_UPDATE',
      resource: 'USDT-IDR',
      details: `Kurs USDT/IDR diubah dari Rp ${prevRate.toLocaleString()} ke Rp ${this.currentRate.rate.toLocaleString()} (Δ ${pctChange.toFixed(2)}%). Berlaku sampai ${new Date(validUntil).toISOString()}`,
      createdAt: now
    });
    db.scheduleSave();

    return { success: true, rateRecord: this.getCurrentRate() };
  }

  /**
   * Sync USDT/IDR FX rate with CoinMarketCap live market price
   */
  public syncWithCoinMarketCap(
    cmcRate: number,
    actorEmail = 'system@dimonex.id',
    validityHours = 6
  ): { success: boolean; rateRecord: FxRateRecord } {
    return this.syncWithLiveRate(cmcRate, 'COINMARKETCAP', actorEmail, validityHours, 'Sinkronisasi kurs USDT/IDR dari CoinMarketCap live price feed');
  }

  /**
   * Sync USDT/IDR FX rate from an authoritative live market source
   */
  public syncWithLiveRate(
    liveRate: number,
    source: 'COINMARKETCAP' | 'INDODAX' | 'LIVE_API' = 'COINMARKETCAP',
    actorEmail = 'system@dimonex.id',
    validityHours = 6,
    customNotes?: string
  ): { success: boolean; rateRecord: FxRateRecord } {
    const prevRate = this.currentRate.rate;
    const pctChange = Math.abs((liveRate - prevRate) / prevRate) * 100;
    const now = Date.now();
    const validUntil = now + Math.max(1, validityHours) * 60 * 60 * 1000;

    const sourceLabel = source === 'INDODAX' ? 'Indodax Ticker' : source === 'LIVE_API' ? 'Live Forex API' : 'CoinMarketCap';

    const changedMeaningfully = pctChange >= 0.01 || source !== this.currentRate.source;
    this.currentRate = {
      rate: parseFloat(liveRate.toFixed(2)),
      source,
      updatedBy: actorEmail,
      updatedAt: now,
      validUntil,
      isStale: false,
      notes: customNotes || `Disinkronkan secara otomatis dari ${sourceLabel} live market API`
    };

    if (changedMeaningfully) {
      const auditEntry: FxRateAuditEntry = {
        id: `fx-audit-${crypto.randomUUID().slice(0, 8)}`,
        timestamp: now,
        actor: actorEmail,
        previousRate: prevRate,
        newRate: this.currentRate.rate,
        percentChange: parseFloat(pctChange.toFixed(2)),
        source,
        notes: customNotes || `Sinkronisasi kurs USDT/IDR dari ${sourceLabel} live API`,
        hash: this.computeAuditHash(actorEmail, prevRate, this.currentRate.rate, now, source)
      };

      this.auditHistory.unshift(auditEntry);
      if (this.auditHistory.length > 200) this.auditHistory.pop();

      db.auditLogs.unshift({
        id: `audit-${crypto.randomUUID().slice(0, 8)}`,
        actorId: actorEmail,
        action: 'FX_RATE_LIVE_SYNC',
        resource: 'USDT-IDR',
        details: `Kurs USDT/IDR disinkronkan dari ${sourceLabel} API: Rp ${this.currentRate.rate.toLocaleString()} (Δ ${pctChange.toFixed(2)}%)`,
        createdAt: now
      });
      db.scheduleSave();
    }

    return { success: true, rateRecord: this.getCurrentRate() };
  }

  private isValidIdrRate(rate: number): boolean {
    return Number.isFinite(rate) && rate >= 1000 && rate <= 100000;
  }

  private isProviderInCooldown(providerKey: string, now = Date.now()): boolean {
    return now < (this.providerCooldownUntil.get(providerKey) || 0);
  }

  private markProviderFailure(providerKey: string, errMsg: string, cooldownMs = 30 * 60 * 1000) {
    const now = Date.now();
    this.providerCooldownUntil.set(providerKey, now + cooldownMs);
    if (!this.providerCooldownLogged.has(providerKey)) {
      this.providerCooldownLogged.add(providerKey);
      console.log(`[FxConversionService] ${providerKey} unavailable (${errMsg}); backing off for ${Math.round(cooldownMs / 60000)}m and using alternate FX feeds.`);
    }
  }

  private markProviderHealthy(providerKey: string) {
    this.providerCooldownUntil.delete(providerKey);
    this.providerCooldownLogged.delete(providerKey);
  }

  /**
   * Fetch live USDT/IDR FX rate directly from external APIs with intelligent cache, single-flight lock & interval control.
   * If called within the configured sync interval and force is false: returns cached rate, saving API credits.
   */
  public async fetchAndSyncLiveRate(
    actorEmail = 'system@dimonex.id',
    validityHours = 6,
    force = false
  ): Promise<{ success: boolean; rateRecord?: FxRateRecord; error?: string; source?: string; cached?: boolean; message?: string }> {
    const now = Date.now();

    // 1. Check if rate is manually locked by Admin
    if (this.config.isManualLocked && !force) {
      return {
        success: true,
        rateRecord: this.getCurrentRate(),
        source: 'MANUAL_ADMIN',
        cached: true,
        message: 'Kurs saat ini dikunci manual oleh Admin. Gunakan Force Fetch untuk memperbarui dari CMC.'
      };
    }

    // 2. Check sync interval cooldown to conserve external API calls (only when a live sync has already run)
    if (
      !force &&
      this.config.syncIntervalMinutes > 0 &&
      this.config.lastCmcFetchTimestamp > 0 &&
      this.currentRate.source !== 'SYSTEM_DEFAULT' &&
      now < this.config.nextCmcFetchTimestamp
    ) {
      this.config.quotaSavedCount++;
      return {
        success: true,
        rateRecord: this.getCurrentRate(),
        source: 'CMC_CACHE_SAVER',
        cached: true,
        message: `Menggunakan kurs ter-cache (Interval ${this.config.syncIntervalMinutes}m aktif. Panggilan CMC dihemat).`
      };
    }

    if (this.inFlightSyncPromise) {
      return this.inFlightSyncPromise;
    }

    this.inFlightSyncPromise = this.executeLiveRateFetch(actorEmail, validityHours, force).finally(() => {
      this.inFlightSyncPromise = null;
    });

    return this.inFlightSyncPromise;
  }

  private async executeLiveRateFetch(
    actorEmail: string,
    validityHours: number,
    force: boolean
  ): Promise<{ success: boolean; rateRecord?: FxRateRecord; error?: string; source?: string; cached?: boolean; message?: string }> {
    const now = Date.now();
    this.config.lastCmcFetchTimestamp = now;
    if (this.config.syncIntervalMinutes > 0) {
      this.config.nextCmcFetchTimestamp = now + this.config.syncIntervalMinutes * 60 * 1000;
    }

    // 3. CoinMarketCap Pro API (unless monthly quota cooldown is active)
    if (!this.isCmcQuotaExhausted(now)) {
      this.config.cmcApiCallsCount++;
      try {
        const cmcApiKey = process.env.CMC_API_KEY || 'e16a28cafc354543ab8369dedc2a58c0';
        const res = await fetch('https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=USDT&convert=IDR', {
          headers: {
            'X-CMC_PRO_API_KEY': cmcApiKey,
            ...FX_FETCH_HEADERS,
          },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const data = await res.json();
          const price = Number(data?.data?.USDT?.quote?.IDR?.price);
          if (this.isValidIdrRate(price)) {
            this.hasLoggedCmcQuota = false;
            const syncRes = this.syncWithCoinMarketCap(price, actorEmail, validityHours);
            return { success: true, rateRecord: syncRes.rateRecord, source: 'COINMARKETCAP', cached: false };
          }
        } else if (res.status === 429 || res.status === 402 || res.status === 403) {
          this.markCmcQuotaExhausted(12 * 60 * 60 * 1000);
        }
      } catch {
        // Proceed to public fallback feeds
      }
    }

    // 4. Multi-provider public live feeds with per-provider circuit breakers (zero timeout spam)
    const providers: Array<{
      key: string;
      sourceName: string;
      note: string;
      fetchRate: () => Promise<number>;
    }> = [
      {
        key: 'CoinGecko',
        sourceName: 'COINGECKO',
        note: 'Disinkronkan dari CoinGecko Public Live Ticker API',
        fetchRate: async () => {
          const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr', {
            headers: FX_FETCH_HEADERS,
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          return parseFloat(data?.tether?.idr);
        },
      },
      {
        key: 'OpenExchangeRates',
        sourceName: 'OPEN_EXCHANGE_RATES',
        note: 'Disinkronkan dari Open Exchange Rates live USD/IDR forex API',
        fetchRate: async () => {
          const res = await fetch('https://open.er-api.com/v6/latest/USD', {
            headers: FX_FETCH_HEADERS,
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          return Number(data?.rates?.IDR);
        },
      },
      {
        key: 'CurrencyApiCDN',
        sourceName: 'CURRENCY_API_CDN',
        note: 'Disinkronkan dari Currency API CDN live USD/IDR feed',
        fetchRate: async () => {
          const res = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', {
            headers: FX_FETCH_HEADERS,
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          return Number(data?.usd?.idr);
        },
      },
      {
        key: 'FrankfurterECB',
        sourceName: 'FRANKFURTER_ECB',
        note: 'Disinkronkan dari Frankfurter ECB live USD/IDR forex API',
        fetchRate: async () => {
          const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=IDR', {
            headers: FX_FETCH_HEADERS,
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          return Number(data?.rates?.IDR);
        },
      },
    ];

    // First pass: try providers not currently in cooldown
    // Second pass (only if force=true and all healthy providers failed): try cooled-down providers too
    const orderedCandidates = [
      ...providers.filter(p => !this.isProviderInCooldown(p.key, now)),
      ...(force ? providers.filter(p => this.isProviderInCooldown(p.key, now)) : []),
    ];
    // If all providers are in cooldown on a scheduled tick, reset cooldowns so we can recover
    const candidates = orderedCandidates.length > 0 ? orderedCandidates : providers;

    for (const provider of candidates) {
      try {
        const price = await provider.fetchRate();
        if (this.isValidIdrRate(price)) {
          this.markProviderHealthy(provider.key);
          const syncRes = this.syncWithLiveRate(price, 'LIVE_API', actorEmail, validityHours, provider.note);
          return { success: true, rateRecord: syncRes.rateRecord, source: provider.sourceName, cached: false };
        }
        this.markProviderFailure(provider.key, 'Invalid IDR rate payload');
      } catch (e: any) {
        this.markProviderFailure(provider.key, e?.message || 'Fetch error');
      }
    }

    // Short retry backoff (2m) when all external providers failed so boot recovers quickly
    if (this.config.syncIntervalMinutes > 0) {
      this.config.nextCmcFetchTimestamp = Date.now() + 2 * 60 * 1000;
    }

    console.warn('[FxConversionService] All external FX providers failed on this cycle; retaining current rate Rp', this.currentRate.rate);
    return { success: false, error: 'Gagal mengambil kurs real live USDT/IDR dari API eksternal.' };
  }

  /**
   * Convert spot price using authoritative conversion formula:
   * Formula: [PAIR]/IDR = [PAIR]/USDT × USDT/IDR
   * Example: BTC/IDR = BTC/USDT × USDT/IDR
   */
  public convertSpotPair(baseCurrency: string, usdtPrice: number): {
    baseCurrency: string;
    usdtPrice: number;
    usdtIdrRate: number;
    idrPrice: number;
    formula: string;
    isStale: boolean;
  } {
    const fx = this.getCurrentRate();
    const idrPrice = Math.round(usdtPrice * fx.rate);
    const formula = `${baseCurrency.toUpperCase()}/IDR = ${baseCurrency.toUpperCase()}/USDT (${usdtPrice.toLocaleString()} USDT) × USDT/IDR (Rp ${fx.rate.toLocaleString('id-ID')}) = Rp ${idrPrice.toLocaleString('id-ID')}`;

    return {
      baseCurrency: baseCurrency.toUpperCase(),
      usdtPrice,
      usdtIdrRate: fx.rate,
      idrPrice,
      formula,
      isStale: fx.isStale
    };
  }

  /**
   * Convert USDT price to IDR quote price
   */
  public convertUsdtToIdr(usdtPrice: number): {
    idrPrice: number;
    isValid: boolean;
    reason?: string;
  } {
    const fx = this.getCurrentRate();
    if (fx.isStale) {
      return {
        idrPrice: 0,
        isValid: false,
        reason: 'Kurs USDT/IDR telah kedaluwarsa (STALE). Diperlukan konfirmasi pembaruan oleh Administrator.'
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
  public getExternalSymbolForPair(pairId: string): string | null {
    const upper = pairId.toUpperCase();
    if (upper === 'BTC-IDR') return 'BTCUSDT';
    if (upper === 'ETH-IDR') return 'ETHUSDT';
    if (upper === 'SOL-IDR') return 'SOLUSDT';
    if (upper === 'USDT-IDR') return 'USDTUSDT';
    return null;
  }

  public getAuditHistory(): FxRateAuditEntry[] {
    return [...this.auditHistory];
  }
}

export const fxConversionService = new FxConversionService();
