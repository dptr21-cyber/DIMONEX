/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/layout/MobileBottomNav.tsx
 * Fixed bottom navigation bar for touch devices adhering to 44px+ hitboxes.
 */

import React from 'react';
import { Home, BarChart2, TrendingUp, Zap, Wallet } from 'lucide-react';

interface MobileBottomNavProps {
  currentView: string;
  onSelectView: (view: any) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentView,
  onSelectView,
}) => {
  const tabs = [
    { id: 'MOBILE_HOME', label: 'Home', icon: Home },
    { id: 'MARKETS', label: 'Markets', icon: BarChart2 },
    { id: 'TRADE', label: 'Trade', icon: TrendingUp },
    { id: 'FUTURES', label: 'Futures', icon: Zap },
    { id: 'WALLET', label: 'Assets', icon: Wallet },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#111820] border-t border-[#202B34] pb-safe select-none">
      <div className="grid grid-cols-5 h-14">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive =
            currentView === tab.id ||
            (tab.id === 'WALLET' && (currentView === 'DEPOSIT' || currentView === 'WITHDRAW'));

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectView(tab.id)}
              className="min-h-[44px] flex flex-col items-center justify-center py-1 transition-colors relative cursor-pointer"
            >
              <Icon
                className={`w-5 h-5 transition-colors duration-150 ${
                  isActive ? 'text-[#C1D0D6]' : 'text-[#71818B]'
                }`}
              />
              <span
                className={`text-[10px] tracking-tight mt-0.5 ${
                  isActive ? 'text-[#E4EBEF] font-semibold' : 'text-[#71818B] font-medium'
                }`}
              >
                {tab.label}
              </span>
              {isActive && (
                <span className="absolute top-0 w-8 h-0.5 bg-[#8DA5B1] rounded-b" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
