/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/StatusBadge.tsx
 * Clean hairline status badge without neon glow.
 */

import React from 'react';

export type BadgeTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'buy'
  | 'sell'
  | 'brand';

interface StatusBadgeProps {
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}

const TONE_MAP: Record<BadgeTone, string> = {
  success: 'bg-[#12392F] text-[#35B887] border-[#35B887]/30',
  buy: 'bg-[#12392F] text-[#16A879] border-[#16A879]/30',
  sell: 'bg-[#401F27] text-[#EA5B65] border-[#EA5B65]/30',
  danger: 'bg-[#401F27] text-[#EA5B65] border-[#EA5B65]/30',
  warning: 'bg-[#2C2415] text-[#D6A85C] border-[#D6A85C]/30',
  info: 'bg-[#162436] text-[#6D9FE8] border-[#6D9FE8]/30',
  brand: 'bg-[#1D2832] text-[#C1D0D6] border-[#40515D]',
  neutral: 'bg-[#17212B] text-[#A1AFB8] border-[#2B3944]',
};

const DOT_MAP: Record<BadgeTone, string> = {
  success: 'bg-[#35B887]',
  buy: 'bg-[#16A879]',
  sell: 'bg-[#EA5B65]',
  danger: 'bg-[#EA5B65]',
  warning: 'bg-[#D6A85C]',
  info: 'bg-[#6D9FE8]',
  brand: 'bg-[#8DA5B1]',
  neutral: 'bg-[#71818B]',
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  children,
  tone = 'neutral',
  dot = false,
  className = '',
}) => {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider rounded-[5px] border whitespace-nowrap ${TONE_MAP[tone]} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_MAP[tone]}`} />}
      {children}
    </span>
  );
};
