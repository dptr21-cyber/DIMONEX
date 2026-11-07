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
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#08090D]/95 backdrop-blur-md border-t border-white/10 pb-safe select-none">
      <div className="grid grid-cols-5 h-14">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = currentView === tab.id || (tab.id === 'TRADE' && currentView === 'TRADE');

          return (
            <button
              key={tab.id}
              onClick={() => onSelectView(tab.id)}
              className="min-h-[44px] flex flex-col items-center justify-center py-1 transition-colors relative"
            >
              <Icon
                className={`w-5 h-5 transition-transform duration-150 ${
                  isActive ? 'text-[#FF087F] scale-110' : 'text-[#9298A6]'
                }`}
              />
              <span
                className={`text-[10px] font-medium tracking-tight mt-0.5 ${
                  isActive ? 'text-[#FF087F] font-bold' : 'text-[#9298A6]'
                }`}
              >
                {tab.label}
              </span>
              {isActive && (
                <span className="absolute top-0 w-8 h-0.5 bg-gradient-to-r from-[#FF087F] to-[#D926FF] rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
