/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/AssetIcon.tsx
 * Clean metallic mineral asset avatar badge.
 */

import React from 'react';

interface AssetIconProps {
  symbol: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SYMBOL_STYLES: Record<string, string> = {
  BTC: 'bg-[#2C2415] text-[#D6A85C] border-[#D6A85C]/30',
  ETH: 'bg-[#17212B] text-[#C1D0D6] border-[#40515D]',
  USDT: 'bg-[#12392F] text-[#16A879] border-[#16A879]/30',
  IDR: 'bg-[#162436] text-[#6D9FE8] border-[#6D9FE8]/30',
  SOL: 'bg-[#1D2832] text-[#A5BAC4] border-[#40515D]',
  BNB: 'bg-[#2C2415] text-[#D6A85C] border-[#D6A85C]/30',
  XRP: 'bg-[#17212B] text-[#A1AFB8] border-[#2B3944]',
};

const SIZE_CLASSES: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'w-5 h-5 text-[9px] rounded-[5px]',
  sm: 'w-7 h-7 text-[10px] rounded-[6px]',
  md: 'w-8 h-8 text-xs rounded-[7px]',
  lg: 'w-10 h-10 text-sm rounded-[9px]',
};

export const AssetIcon: React.FC<AssetIconProps> = ({ symbol, size = 'md', className = '' }) => {
  const clean = (symbol || '?').toUpperCase().trim();
  const label = clean.slice(0, 3);
  const style = SYMBOL_STYLES[clean] || 'bg-[#17212B] text-[#8DA5B1] border-[#2B3944]';

  return (
    <span
      className={`inline-flex items-center justify-center font-mono font-semibold border shrink-0 select-none ${SIZE_CLASSES[size]} ${style} ${className}`}
      aria-hidden="true"
    >
      {label}
    </span>
  );
};
