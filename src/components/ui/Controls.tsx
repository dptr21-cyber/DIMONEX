/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/Controls.tsx
 * Shared SearchInput, FilterBar, CopyButton, DataTable, and Pagination primitives.
 */

import React, { useState } from 'react';
import { Search, Copy, Check, ChevronLeft, ChevronRight } from 'lucide-react';

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
  className = '',
  ...props
}) => (
  <div className={`relative flex items-center ${className}`}>
    <Search className="w-3.5 h-3.5 text-[#71818B] absolute left-3 pointer-events-none" />
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] rounded-[7px] pl-8 pr-3 py-1.5 text-xs text-[#E4EBEF] placeholder-[#53616A] outline-none transition-colors"
      {...props}
    />
  </div>
);

interface FilterBarProps {
  children: React.ReactNode;
  className?: string;
}

export const FilterBar: React.FC<FilterBarProps> = ({ children, className = '' }) => (
  <div
    className={`flex flex-wrap items-center justify-between gap-3 p-3 bg-[#141C24] border border-[#202B34] rounded-[10px] ${className}`}
  >
    {children}
  </div>
);

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({ text, label, className = '' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored safely
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] bg-[#17212B] hover:bg-[#222F3A] border border-[#2B3944] text-[11px] font-medium text-[#A1AFB8] hover:text-[#E4EBEF] transition-colors cursor-pointer ${className}`}
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-3 h-3 text-[#35B887]" />
      ) : (
        <Copy className="w-3 h-3 text-[#8DA5B1]" />
      )}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
};

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  onPageChange,
  className = '',
}) => {
  if (totalPages <= 1) return null;

  return (
    <div className={`flex items-center justify-between gap-2 text-xs font-mono tabular-nums ${className}`}>
      <span className="text-[#71818B]">
        Page <strong className="text-[#E4EBEF]">{page}</strong> / {totalPages}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="p-1.5 rounded-[7px] bg-[#17212B] border border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#222F3A] disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="p-1.5 rounded-[7px] bg-[#17212B] border border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#222F3A] disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          aria-label="Next page"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export interface DataColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyState,
  className = '',
}: DataTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[#202B34] bg-[#111820]/70 text-[11px] font-medium uppercase tracking-wider text-[#71818B]">
            {columns.map(col => (
              <th
                key={col.key}
                className={`py-2.5 px-3.5 whitespace-nowrap ${
                  col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                    ? 'text-center'
                    : 'text-left'
                }`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#202B34]/80 text-xs">
          {rows.map((row, idx) => (
            <tr
              key={rowKey(row, idx)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`transition-colors hover:bg-[#17212B]/80 ${
                onRowClick ? 'cursor-pointer' : ''
              }`}
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  className={`py-2.5 px-3.5 whitespace-nowrap ${
                    col.align === 'right'
                      ? 'text-right'
                      : col.align === 'center'
                      ? 'text-center'
                      : 'text-left'
                  }`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
