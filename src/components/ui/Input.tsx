/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/ui/Input.tsx
 * High-density trading inputs with prefix/suffix affordances and tabular formatting.
 */

import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  prefixText?: string;
  suffixText?: string;
  error?: string;
  actionText?: string;
  onActionClick?: () => void;
}

export const Input: React.FC<InputProps> = ({
  label,
  prefixText,
  suffixText,
  error,
  actionText,
  onActionClick,
  className = '',
  id,
  ...props
}) => {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="w-full">
      {label && (
        <div className="flex items-center justify-between mb-1">
          <label htmlFor={inputId} className="text-[11px] font-medium text-[#969BA8]">
            {label}
          </label>
          {actionText && (
            <button
              type="button"
              onClick={onActionClick}
              className="text-[10px] font-bold text-[#FF087F] hover:text-[#D926FF] transition-colors"
            >
              {actionText}
            </button>
          )}
        </div>
      )}
      <div className="relative flex items-center bg-[#0D1017] border border-white/10 focus-within:border-[#FF087F] focus-within:ring-1 focus-within:ring-[#FF087F]/40 rounded-lg transition-all">
        {prefixText && (
          <span className="pl-3 pr-1 text-xs font-medium text-[#9298A6] select-none">
            {prefixText}
          </span>
        )}
        <input
          id={inputId}
          className={`w-full bg-transparent px-3 py-2 text-xs sm:text-sm text-[#F5F5F7] placeholder-[#686D7A] font-mono tabular-nums outline-none ${className}`}
          {...props}
        />
        {suffixText && (
          <span className="pr-3 pl-1 text-xs font-medium text-[#9298A6] select-none">
            {suffixText}
          </span>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] text-[#EA3943]">{error}</p>}
    </div>
  );
};
