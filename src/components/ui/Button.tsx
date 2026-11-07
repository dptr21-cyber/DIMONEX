/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/ui/Button.tsx
 * Reusable buttons adhering to Black & Crimson-Pink design specifications.
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
  const baseStyles = 'relative inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 select-none whitespace-nowrap active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none disabled:active:scale-100';

  const sizeStyles = {
    sm: 'text-xs h-8 px-3 gap-1.5 min-w-[32px]',
    md: 'text-xs sm:text-sm h-9 sm:h-10 px-4 gap-2 min-h-[40px]',
    lg: 'text-sm font-semibold h-11 px-5 gap-2.5 min-h-[44px]',
  };

  const variantStyles = {
    // Primary: Electric Magenta brand accent
    primary: 'bg-[#FF087F] hover:bg-[#FF268F] text-white shadow-sm hover:shadow-[#FF087F]/25 hover:shadow-lg',
    // Gradient: Magenta to Violet Obsidian accent
    gradient: 'bg-gradient-to-r from-[#FF087F] to-[#D926FF] hover:brightness-110 text-white font-semibold shadow-lg shadow-[#FF087F]/25',
    // Secondary: Dark elevated glass surface with subtle border
    secondary: 'bg-[#171923] hover:bg-[#202330] text-[#F5F5F7] border border-white/10',
    // Profit: Crisp Bullish Green (#16C784)
    profit: 'bg-[#16C784] hover:bg-[#1CDA92] text-white font-semibold shadow-sm hover:shadow-[#16C784]/25 hover:shadow-lg',
    // Danger: Bearish Red (#EA3943)
    danger: 'bg-[#EA3943] hover:bg-[#F14D56] text-white font-semibold shadow-sm hover:shadow-[#EA3943]/25',
    // Outline
    outline: 'bg-transparent hover:bg-[#171923] text-[#F5F5F7] border border-white/10 hover:border-white/20',
    // Ghost: Subtle highlight
    ghost: 'bg-transparent hover:bg-[#171923] text-[#9298A6] hover:text-[#F5F5F7]',
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
