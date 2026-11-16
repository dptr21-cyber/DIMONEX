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

export function parseDecimalToUnits(val: string | number, decimals: number): bigint {
  const dec = Math.max(0, Math.trunc(decimals || 0));
  const rawStr = String(val ?? '').trim().replace(/,/g, '');
  if (!rawStr) return 0n;
  if (!/^\d*\.?\d*$/.test(rawStr) || rawStr === '.') return 0n;

  const [intRaw = '0', fracRaw = ''] = rawStr.split('.');
  const cleanInt = intRaw || '0';
  if (dec === 0) return BigInt(cleanInt);

  const paddedFrac = fracRaw.slice(0, dec).padEnd(dec, '0');
  return BigInt(cleanInt + paddedFrac);
}

export function formatUnitsToDecimal(
  units: string | bigint | number,
  decimals: number,
  trimTrailingZeros = true
): string {
  const dec = Math.max(0, Math.trunc(decimals || 0));
  const raw = safeBigInt(units);
  if (dec === 0) return raw.toString();

  if (raw === 0n) {
    return trimTrailingZeros ? '0' : `0.${'0'.repeat(dec)}`;
  }

  const isNeg = raw < 0n;
  const abs = isNeg ? -raw : raw;
  const str = abs.toString().padStart(dec + 1, '0');
  const intPart = str.slice(0, -dec) || '0';
  let fracPart = str.slice(-dec);

  if (trimTrailingZeros) {
    fracPart = fracPart.replace(/0+$/, '');
    if (!fracPart) return `${isNeg ? '-' : ''}${intPart}`;
  }
  return `${isNeg ? '-' : ''}${intPart}.${fracPart}`;
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
    const dec = Math.max(
      0,
      quoteDecimals !== undefined && quoteDecimals !== null
        ? quoteDecimals
        : (qCurr === 'USDT' ? 6 : 2)
    );
    const scale = 10n ** BigInt(dec);

    if (qCurr === 'IDR') {
      const isNeg = raw < 0n;
      const abs = isNeg ? -raw : raw;
      const effScale = dec > 0 ? scale : 1n;
      const rupiah = abs / effScale;
      const sen = dec > 0 ? abs % effScale : 0n;
      const formattedRupiah = rupiah.toLocaleString('id-ID');

      let res = `Rp ${isNeg ? '-' : ''}${formattedRupiah}`;
      if (sen !== 0n && dec > 0) {
        const senStr = sen.toString().padStart(dec, '0').slice(0, 2);
        res = `${res},${senStr}`;
      }
      return includeCurrency
        ? res
        : (sen !== 0n && dec > 0
            ? `${isNeg ? '-' : ''}${formattedRupiah},${sen.toString().padStart(dec, '0').slice(0, 2)}`
            : `${isNeg ? '-' : ''}${formattedRupiah}`);
    }

    // USDT / USD / other non-IDR quotes
    const isNeg = raw < 0n;
    const abs = isNeg ? -raw : raw;
    const integerPart = dec > 0 ? abs / scale : abs;
    const fracPart = dec > 0 ? abs % scale : 0n;

    if (dec === 0) {
      const formattedNum = `${isNeg ? '-' : ''}${integerPart.toLocaleString('en-US')}`;
      return includeCurrency ? `${formattedNum} ${qCurr}` : formattedNum;
    }

    const fullFrac = fracPart.toString().padStart(dec, '0');
    let fracStr: string;

    if (abs === 0n) {
      fracStr = '00';
    } else if (integerPart === 0n) {
      // Sub-$1 price (including micro-caps like 0.000025 USDT): keep all significant digits up to `dec`
      const trimmed = fullFrac.replace(/0+$/, '');
      if (trimmed.length <= 2) {
        fracStr = trimmed.padEnd(2, '0');
      } else {
        fracStr = trimmed;
      }
    } else if (integerPart < 100n) {
      // $1 - $99.999999: keep at least 2 decimals, preserve significant decimals up to dec
      const trimmed = fullFrac.replace(/0+$/, '');
      fracStr = trimmed.length <= 2 ? trimmed.padEnd(2, '0') : trimmed.slice(0, Math.min(dec, 6));
    } else {
      // >= $100 (e.g. BTC-USDT 68,500.25): keep at least 2 decimals, preserve up to 4 if non-zero beyond cent
      const trimmed = fullFrac.replace(/0+$/, '');
      fracStr = trimmed.length <= 2 ? trimmed.padEnd(2, '0') : trimmed.slice(0, Math.min(dec, 4));
    }

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
    const dec = Math.max(
      0,
      quoteDecimals !== undefined && quoteDecimals !== null
        ? quoteDecimals
        : (qCurr === 'USDT' ? 6 : 2)
    );
    const scale = 10n ** BigInt(dec);
    const integerPart = dec > 0 ? raw / scale : raw;

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
      const fracNum = dec > 0 ? Number(raw % scale) / Math.pow(10, dec) : 0;
      const num = Number(integerPart) + fracNum;
      if (num >= 1_000_000_000) {
        return `${(num / 1_000_000_000).toFixed(2)}B USDT`;
      }
      if (num >= 1_000_000) {
        return `${(num / 1_000_000).toFixed(2)}M USDT`;
      }
      if (num >= 1_000) {
        return `${(num / 1_000).toFixed(2)}K USDT`;
      }
      return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: num > 0 && num < 1 ? 4 : 2 })} USDT`;
    }

    return `${formatUnitsToDecimal(raw, dec, true)} ${qCurr}`;
  } catch {
    return '0';
  }
}

export function formatCrypto(units: string | bigint | number, decimals: number, currencySymbol?: string): string {
  try {
    const dec = Math.max(0, Math.trunc(decimals || 0));
    const rawUnits = safeBigInt(units);
    if (dec === 0) {
      const res = rawUnits.toString();
      return currencySymbol ? `${res} ${currencySymbol}` : res;
    }
    if (rawUnits === 0n) {
      return `0.${'0'.repeat(Math.min(dec, 4))}${currencySymbol ? ' ' + currencySymbol : ''}`;
    }

    const isNegative = rawUnits < 0n;
    const abs = isNegative ? -rawUnits : rawUnits;
    const str = abs.toString().padStart(dec + 1, '0');

    const integerPart = str.slice(0, -dec) || '0';
    let fraction = str.slice(-dec);

    if (fraction.length > 8) {
      const head = fraction.slice(0, 8);
      if (/^0+$/.test(head)) {
        // Keep enough significant digits so tiny 18-decimal amounts don't render as 0.00000000
        const firstNonZero = fraction.search(/[1-9]/);
        fraction = firstNonZero >= 0 ? fraction.slice(0, Math.min(dec, firstNonZero + 4)) : head;
      } else {
        fraction = head;
      }
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
