/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/Button.tsx
 * Institutional matte mineral button variants for DIMONEX Obsidian Iridium.
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'profit' | 'danger' | 'ghost' | 'outline' | 'gradient';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles =
    'relative inline-flex items-center justify-center font-medium rounded-[7px] transition-colors duration-150 select-none whitespace-nowrap disabled:opacity-45 disabled:pointer-events-none cursor-pointer';

  const sizeStyles = {
    sm: 'text-xs h-8 px-3 gap-1.5 min-w-[32px]',
    md: 'text-xs sm:text-sm h-9 sm:h-10 px-4 gap-2',
    lg: 'text-sm font-semibold h-11 px-5 gap-2.5',
  };

  const variantStyles = {
    primary:
      'bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] font-semibold border border-[#C1D0D6]/20 shadow-xs',
    gradient:
      'bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] font-semibold border border-[#C1D0D6]/30 shadow-xs',
    secondary:
      'bg-[#1D2832] hover:bg-[#222F3A] text-[#E4EBEF] border border-[#2B3944] hover:border-[#40515D]',
    profit:
      'bg-[#16A879] hover:bg-[#20BC8B] text-[#090D12] font-semibold border border-[#20BC8B]/30 shadow-xs',
    danger:
      'bg-[#EA5B65] hover:bg-[#F16D76] text-[#090D12] font-semibold border border-[#F16D76]/30 shadow-xs',
    outline:
      'bg-transparent hover:bg-[#17212B] text-[#E4EBEF] border border-[#2B3944] hover:border-[#40515D]',
    ghost:
      'bg-transparent hover:bg-[#17212B] text-[#A1AFB8] hover:text-[#E4EBEF] border border-transparent',
  };

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      <span>{children}</span>
    </button>
  );
};
