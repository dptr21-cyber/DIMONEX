/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/lib/formatters.ts
 * Number and currency formatters strictly enforcing tabular numerals and zero-float principles.
 */

export function safeBigInt(val: any, fallback = 0n): bigint {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || Number.isNaN(val)) return fallback;
    return BigInt(Math.trunc(val));
  }
  if (typeof val === 'string') {
    const cleaned = val.trim();
    if (!cleaned) return fallback;
    if (cleaned.includes('.')) {
      const num = parseFloat(cleaned);
      if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
      return BigInt(Math.trunc(num));
    }
    try {
      return BigInt(cleaned);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function formatIDR(senOrUnits: string | bigint | number, includeSen = false): string {
  try {
    const rawUnits = safeBigInt(senOrUnits);
    const rupiah = rawUnits / 100n;
    const sen = rawUnits % 100n;

    const formattedRupiah = rupiah.toLocaleString('id-ID');
    if (includeSen && sen !== 0n) {
      const senStr = sen.toString().padStart(2, '0');
      return `Rp ${formattedRupiah},${senStr}`;
    }
    return `Rp ${formattedRupiah}`;
  } catch (err) {
    return 'Rp 0';
  }
}

export function formatQuotePrice(
  units: string | bigint | number,
  quoteCurrency = 'IDR',
  quoteDecimals = 2,
  includeCurrency = true
): string {
  try {
    const raw = safeBigInt(units);
    const qCurr = (quoteCurrency || 'IDR').toUpperCase();
    const dec = Math.max(0, quoteDecimals !== undefined && quoteDecimals !== null ? quoteDecimals : (qCurr === 'USDT' ? 6 : 2));
    const scale = 10n ** BigInt(dec);

    if (qCurr === 'USDT' || qCurr === 'USD') {
      const isNeg = raw < 0n;
      const abs = isNeg ? -raw : raw;
      const integerPart = abs / (scale > 0n ? scale : 1n);
      const fracPart = abs % (scale > 0n ? scale : 1n);

      const maxDec = Math.min(dec, 4);
      let fracStr = fracPart.toString().padStart(dec, '0').slice(0, maxDec);
      if (fracStr.length < 2) {
        fracStr = fracStr.padEnd(2, '0');
      }
      const formattedNum = `${isNeg ? '-' : ''}${integerPart.toLocaleString('en-US')}.${fracStr}`;
      return includeCurrency ? `${formattedNum} ${qCurr}` : formattedNum;
    }

    if (qCurr === 'IDR') {
      const isNeg = raw < 0n;
      const abs = isNeg ? -raw : raw;
      const rupiah = abs / (scale > 0n ? scale : 100n);
      const sen = abs % (scale > 0n ? scale : 100n);
      const formattedRupiah = rupiah.toLocaleString('id-ID');

      let res = `Rp ${isNeg ? '-' : ''}${formattedRupiah}`;
      if (sen !== 0n && dec > 0) {
        const senStr = sen.toString().padStart(dec, '0').slice(0, 2);
        res = `${res},${senStr}`;
      }
      return includeCurrency ? res : (sen !== 0n && dec > 0 ? `${formattedRupiah},${sen.toString().padStart(dec, '0').slice(0, 2)}` : formattedRupiah);
    }

    // Generic fallback for other quote currencies
    const isNeg = raw < 0n;
    const abs = isNeg ? -raw : raw;
    const integerPart = abs / (scale > 0n ? scale : 1n);
    const fracPart = abs % (scale > 0n ? scale : 1n);
    const fracStr = fracPart.toString().padStart(dec, '0').slice(0, Math.min(dec, 6));
    const formattedNum = `${isNeg ? '-' : ''}${integerPart.toLocaleString('en-US')}.${fracStr}`;
    return includeCurrency ? `${formattedNum} ${qCurr}` : formattedNum;
  } catch {
    return (quoteCurrency || '').toUpperCase() === 'IDR' ? 'Rp 0' : `0 ${quoteCurrency || ''}`.trim();
  }
}

export function formatPairVolume(
  units: string | bigint | number,
  quoteCurrency = 'IDR',
  quoteDecimals = 2
): string {
  try {
    const raw = safeBigInt(units);
    const qCurr = (quoteCurrency || 'IDR').toUpperCase();
    const dec = Math.max(0, quoteDecimals !== undefined && quoteDecimals !== null ? quoteDecimals : (qCurr === 'USDT' ? 6 : 2));
    const scale = 10n ** BigInt(dec);
    const integerPart = raw / (scale > 0n ? scale : 1n);

    if (qCurr === 'IDR') {
      const num = Number(integerPart);
      if (num >= 1_000_000_000_000) {
        return `Rp ${(num / 1_000_000_000_000).toFixed(2)} T`;
      }
      if (num >= 1_000_000_000) {
        return `Rp ${(num / 1_000_000_000).toFixed(2)} M`;
      }
      if (num >= 1_000_000) {
        return `Rp ${(num / 1_000_000).toFixed(2)} Jt`;
      }
      return `Rp ${num.toLocaleString('id-ID')}`;
    }

    if (qCurr === 'USDT' || qCurr === 'USD') {
      const num = Number(integerPart);
      if (num >= 1_000_000_000) {
        return `${(num / 1_000_000_000).toFixed(2)}B USDT`;
      }
      if (num >= 1_000_000) {
        return `${(num / 1_000_000).toFixed(2)}M USDT`;
      }
      if (num >= 1_000) {
        return `${(num / 1_000).toFixed(2)}K USDT`;
      }
      return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
    }

    return `${integerPart.toLocaleString('en-US')} ${qCurr}`;
  } catch {
    return '0';
  }
}

export function formatCrypto(units: string | bigint | number, decimals: number, currencySymbol?: string): string {
  try {
    const rawUnits = safeBigInt(units);
    if (rawUnits === 0n) return `0.${'0'.repeat(Math.min(decimals, 4))}${currencySymbol ? ' ' + currencySymbol : ''}`;

    const isNegative = rawUnits < 0n;
    const abs = isNegative ? -rawUnits : rawUnits;
    const str = abs.toString().padStart(decimals + 1, '0');

    const integerPart = str.slice(0, -decimals) || '0';
    let fraction = str.slice(-decimals);

    // Trim excessive trailing zeros beyond 4 digits if zero
    if (fraction.length > 4) {
      fraction = fraction.slice(0, 8);
    }

    const res = `${isNegative ? '-' : ''}${integerPart}.${fraction}`;
    return currencySymbol ? `${res} ${currencySymbol}` : res;
  } catch (err) {
    return `0${currencySymbol ? ' ' + currencySymbol : ''}`;
  }
}

export function formatTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
