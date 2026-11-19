/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/ui/Tabs.tsx
 * Precision segmented control adhering to matte mineral guidelines.
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
      className={`inline-flex items-center p-1 bg-[#111820] border border-[#202B34] rounded-[7px] ${
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
            className={`${sizeClasses} ${fullWidth ? 'flex-1 justify-center' : ''} flex items-center gap-1.5 rounded-[5px] transition-colors duration-150 whitespace-nowrap cursor-pointer ${
              isActive
                ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border border-[#2B3944]'
                : 'text-[#71818B] hover:text-[#E4EBEF] hover:bg-[#17212B] border border-transparent'
            }`}
          >
            {tab.icon && <span className={`shrink-0 ${isActive ? 'text-[#8DA5B1]' : ''}`}>{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-[5px] font-mono tabular-nums ${
                  isActive
                    ? 'bg-[#8DA5B1]/15 text-[#C1D0D6]'
                    : 'bg-[#141C24] text-[#71818B]'
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
