/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/PriceDisplay.tsx
 * Monospace tabular formatting components for prices, percentages, and balances.
 */

import React from 'react';

interface PriceDisplayProps {
  value: string | number;
  suffix?: string;
  tone?: 'default' | 'buy' | 'sell' | 'muted';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export const PriceDisplay: React.FC<PriceDisplayProps> = ({
  value,
  suffix,
  tone = 'default',
  size = 'sm',
  className = '',
}) => {
  const toneClass =
    tone === 'buy'
      ? 'text-[#16A879]'
      : tone === 'sell'
      ? 'text-[#EA5B65]'
      : tone === 'muted'
      ? 'text-[#A1AFB8]'
      : 'text-[#E4EBEF]';

  const sizeClass =
    size === 'xs'
      ? 'text-[11px]'
      : size === 'lg'
      ? 'text-lg sm:text-xl font-semibold'
      : size === 'md'
      ? 'text-sm font-medium'
      : 'text-xs font-medium';

  return (
    <span className={`font-mono tabular-nums ${toneClass} ${sizeClass} ${className}`}>
      {value}
      {suffix && <span className="ml-1 text-[0.85em] text-[#71818B] font-normal">{suffix}</span>}
    </span>
  );
};

interface PercentageChangeProps {
  value: string | number;
  size?: 'xs' | 'sm';
  pill?: boolean;
  className?: string;
}

export const PercentageChange: React.FC<PercentageChangeProps> = ({
  value,
  size = 'xs',
  pill = false,
  className = '',
}) => {
  const raw = typeof value === 'string' ? parseFloat(value.replace('%', '').replace('+', '')) : value;
  const num = Number.isFinite(raw) ? raw : 0;
  const isUp = num >= 0;
  const formatted = `${isUp ? '+' : ''}${num.toFixed(2)}%`;

  if (pill) {
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded-[5px] font-mono tabular-nums font-medium border ${
          size === 'xs' ? 'text-[11px]' : 'text-xs'
        } ${
          isUp
            ? 'bg-[#12392F] text-[#16A879] border-[#16A879]/25'
            : 'bg-[#401F27] text-[#EA5B65] border-[#EA5B65]/25'
        } ${className}`}
      >
        {formatted}
      </span>
    );
  }

  return (
    <span
      className={`font-mono tabular-nums font-medium ${size === 'xs' ? 'text-[11px]' : 'text-xs'} ${
        isUp ? 'text-[#16A879]' : 'text-[#EA5B65]'
      } ${className}`}
    >
      {formatted}
    </span>
  );
};

interface CurrencyDisplayProps {
  amount: string;
  currency?: string;
  secondary?: string;
  className?: string;
}

export const CurrencyDisplay: React.FC<CurrencyDisplayProps> = ({
  amount,
  currency,
  secondary,
  className = '',
}) => (
  <div className={`font-mono tabular-nums ${className}`}>
    <span className="text-[#E4EBEF] font-semibold">
      {amount}
      {currency && <span className="ml-1 text-[#71818B] font-normal">{currency}</span>}
    </span>
    {secondary && <span className="block text-[11px] text-[#71818B]">{secondary}</span>}
  </div>
);
