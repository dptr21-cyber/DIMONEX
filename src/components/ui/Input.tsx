/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/Input.tsx
 * Precision institutional trading inputs with 7px radius and tabular monospace numeric support.
 */

import React, { useId } from 'react';

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
  name,
  ...props
}) => {
  const generatedId = useId();
  const cleanGenId = generatedId.replace(/[^a-zA-Z0-9_-]/g, '');
  const inputId = id || (label ? label.toLowerCase().replace(/[^a-z0-9_-]/g, '-') : `input-${cleanGenId}`);
  const inputName = name || (label ? label.toLowerCase().replace(/[^a-z0-9_-]/g, '_') : inputId);

  return (
    <div className="w-full">
      {label && (
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor={inputId} className="text-[11px] font-medium text-[#A1AFB8]">
            {label}
          </label>
          {actionText && (
            <button
              type="button"
              onClick={onActionClick}
              className="text-[11px] font-semibold text-[#8DA5B1] hover:text-[#C1D0D6] transition-colors cursor-pointer"
            >
              {actionText}
            </button>
          )}
        </div>
      )}
      <div
        className={`relative flex items-center bg-[#111820] border rounded-[7px] transition-colors ${
          error
            ? 'border-[#EA5B65] focus-within:border-[#EA5B65]'
            : 'border-[#2B3944] focus-within:border-[#8DA5B1]'
        }`}
      >
        {prefixText && (
          <span className="pl-3 pr-1.5 text-xs font-medium text-[#71818B] select-none shrink-0">
            {prefixText}
          </span>
        )}
        <input
          id={inputId}
          name={inputName}
          aria-label={props['aria-label'] || label || prefixText || suffixText || inputName}
          className={`w-full bg-transparent px-3 py-2 text-xs sm:text-sm text-[#E4EBEF] placeholder-[#53616A] font-mono tabular-nums outline-none ${className}`}
          {...props}
        />
        {suffixText && (
          <span className="pr-3 pl-1.5 text-xs font-medium text-[#71818B] font-mono select-none shrink-0">
            {suffixText}
          </span>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] text-[#EA5B65]">{error}</p>}
    </div>
  );
};
