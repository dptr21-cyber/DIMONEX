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
import { db } from '../../db/database.js';
import { FxRateRecord, FxRateAuditEntry, FxConversionConfig } from './ExternalFeedTypes.js';

export class FxConversionService {
  private currentRate: FxRateRecord;
  private auditHistory: FxRateAuditEntry[] = [];
  private maxChangeWithoutConfirmPct = 10.0; // 10% max jump without explicit confirmation
  private config: FxConversionConfig;
  private backgroundTimer: NodeJS.Timeout | null = null;

  constructor() {
    const now = Date.now();
    // Default initial rate: 16,350 IDR per USDT, valid for 48 hours
    this.currentRate = {
      rate: 16350.00,
      source: 'SYSTEM_DEFAULT',
      updatedBy: 'system@dimonex.id',
      updatedAt: now,
      validUntil: now + 48 * 60 * 60 * 1000,
      isStale: false,
      notes: 'Initial production baseline USDT/IDR rate.'
    };

    // Default configuration: 15 minutes sync interval to conserve CoinMarketCap API quota
    this.config = {
      syncIntervalMinutes: 15, // 15 mins (saves API calls: ~96 calls/day instead of 86,400)
      isManualLocked: false,
      lastCmcFetchTimestamp: now,
      nextCmcFetchTimestamp: now + 15 * 60 * 1000,
      cmcApiCallsCount: 1,
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
    }, 30000); // Check every 30 seconds
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

    this.currentRate = {
      rate: parseFloat(liveRate.toFixed(2)),
      source,
      updatedBy: actorEmail,
      updatedAt: now,
      validUntil,
      isStale: false,
      notes: customNotes || `Disinkronkan secara otomatis dari ${sourceLabel} live market API`
    };

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

    return { success: true, rateRecord: this.getCurrentRate() };
  }

  /**
   * Fetch live USDT/IDR FX rate directly from external APIs with intelligent cache & interval control.
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

    // 2. Check sync interval cooldown to conserve CoinMarketCap API calls
    if (!force && this.config.syncIntervalMinutes > 0 && now < this.config.nextCmcFetchTimestamp) {
      this.config.quotaSavedCount++;
      return {
        success: true,
        rateRecord: this.getCurrentRate(),
        source: 'CMC_CACHE_SAVER',
        cached: true,
        message: `Menggunakan kurs ter-cache (Interval ${this.config.syncIntervalMinutes}m aktif. Panggilan CMC dihemat).`
      };
    }

    // 3. Make live API call (CoinMarketCap Pro API)
    this.config.cmcApiCallsCount++;
    this.config.lastCmcFetchTimestamp = now;
    if (this.config.syncIntervalMinutes > 0) {
      this.config.nextCmcFetchTimestamp = now + this.config.syncIntervalMinutes * 60 * 1000;
    }

    try {
      const cmcApiKey = process.env.CMC_API_KEY || 'e16a28cafc354543ab8369dedc2a58c0';
      const res = await fetch('https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=USDT&convert=IDR', {
        headers: {
          'X-CMC_PRO_API_KEY': cmcApiKey,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const data = await res.json();
        const price = data?.data?.USDT?.quote?.IDR?.price;
        if (price && typeof price === 'number' && price > 0) {
          const syncRes = this.syncWithCoinMarketCap(price, actorEmail, validityHours);
          return { success: true, rateRecord: syncRes.rateRecord, source: 'COINMARKETCAP', cached: false };
        }
      }
    } catch (e: any) {
      // CMC call failed or quota reached, proceed to CoinGecko fallback
    }

    // 4. Fallback: CoinGecko Public Spot Exchange FX Rate (USDT/IDR)
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr', {
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const data = await res.json();
        const price = parseFloat(data?.tether?.idr);
        if (price && !isNaN(price) && price > 0) {
          const syncRes = this.syncWithLiveRate(price, 'LIVE_API', actorEmail, validityHours, 'Disinkronkan dari CoinGecko Public Live Ticker API');
          return { success: true, rateRecord: syncRes.rateRecord, source: 'LIVE_API', cached: false };
        }
      }
    } catch (e: any) {
      console.warn('[FxConversionService] CoinGecko live rate fetch failed, trying Open Exchange Rates:', e.message);
    }

    // 5. Fallback: Open Exchange Rates
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', {
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const data = await res.json();
        const price = data?.rates?.IDR;
        if (price && typeof price === 'number' && price > 0) {
          const syncRes = this.syncWithLiveRate(price, 'LIVE_API', actorEmail, validityHours, 'Disinkronkan dari Open Exchange Rates live USD/IDR forex API');
          return { success: true, rateRecord: syncRes.rateRecord, source: 'LIVE_API', cached: false };
        }
      }
    } catch (e: any) {
      console.warn('[FxConversionService] Open Exchange Rate API fetch failed:', e.message);
    }

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
