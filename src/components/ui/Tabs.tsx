/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/ui/Tabs.tsx
 * Segmented control and tab selector adhering to anti-pill interactive button guidelines.
 */

import React from 'react';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  badge?: string | number;
  icon?: React.ReactNode;
}

interface SegmentedTabsProps<T extends string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}

export function SegmentedTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  size = 'md',
  fullWidth = false,
}: SegmentedTabsProps<T>) {
  const sizeClasses = size === 'sm' ? 'py-1 px-2.5 text-xs' : 'py-1.5 px-3.5 text-xs font-medium';

  return (
    <div
      className={`inline-flex items-center p-1 bg-[#0E1016] border border-[#292C38] rounded-lg ${
        fullWidth ? 'w-full flex' : ''
      }`}
    >
      {tabs.map(tab => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`${sizeClasses} ${fullWidth ? 'flex-1 justify-center' : ''} flex items-center gap-1.5 rounded-md transition-all duration-150 whitespace-nowrap ${
              isActive
                ? 'bg-[#1C1F29] text-[#F5F5F7] font-semibold shadow-sm border border-[#292C38]'
                : 'text-[#969BA8] hover:text-[#F5F5F7] hover:bg-[#15171F]'
            }`}
          >
            {tab.icon && <span className="shrink-0">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                isActive ? 'bg-[#EB3458]/20 text-[#EB3458]' : 'bg-[#15171F] text-[#686D7A]'
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
