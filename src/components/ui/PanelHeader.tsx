/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/PanelHeader.tsx
 * Consistent headers for pages and matte mineral panels.
 */

import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  badge,
  actions,
  className = '',
}) => (
  <div
    className={`flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#202B34] ${className}`}
  >
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#E4EBEF]">{title}</h1>
        {badge}
      </div>
      {subtitle && <p className="text-xs sm:text-sm text-[#A1AFB8] mt-1">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

interface PanelHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  title,
  subtitle,
  icon,
  actions,
  className = '',
}) => (
  <div
    className={`flex items-center justify-between gap-3 px-4 py-3 border-b border-[#202B34] bg-[#111820]/60 ${className}`}
  >
    <div className="flex items-center gap-2.5 min-w-0">
      {icon && <span className="text-[#8DA5B1] shrink-0">{icon}</span>}
      <div className="min-w-0">
        <h2 className="text-xs sm:text-sm font-semibold text-[#E4EBEF] tracking-tight truncate">{title}</h2>
        {subtitle && <p className="text-[11px] text-[#71818B] truncate">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);
