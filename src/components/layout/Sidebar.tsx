/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/layout/Sidebar.tsx
 * DIMONEX Global Navigation Sidebar — Obsidian Iridium Matte Architecture
 */

import React, { useState } from 'react';
import {
  LayoutDashboard,
  BarChart3,
  TrendingUp,
  Zap,
  Wallet,
  FileText,
  ChevronLeft,
  ChevronRight,
  Bot,
  ShieldCheck,
  Cpu,
  Users,
  ArrowLeftRight,
  PiggyBank,
  Crown,
  Rocket,
} from 'lucide-react';

interface SidebarProps {
  currentView: string;
  onSelectView: (view: any) => void;
  isAdmin?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onSelectView,
  isAdmin = false,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    return (
      localStorage.getItem('dimonex_sidebar_collapsed') === 'true' ||
      localStorage.getItem('dominex_sidebar_collapsed') === 'true'
    );
  });

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('dimonex_sidebar_collapsed', String(next));
      return next;
    });
  };

  const navItems: {
    id: string;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: string;
  }[] = [
    { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
    { id: 'MARKETS', label: 'Markets', icon: BarChart3 },
    { id: 'TRADE', label: 'Spot Trading', icon: TrendingUp },
    { id: 'FUTURES', label: 'Futures Trading', icon: Zap, badge: '50x' },
    { id: 'COPY', label: 'Copy Trading', icon: Users },
    { id: 'BOT', label: 'Trading Bots', icon: Bot },
    { id: 'CONVERT', label: 'Convert', icon: ArrowLeftRight, badge: '0%' },
    { id: 'EARN', label: 'Earn & Stake', icon: PiggyBank },
    { id: 'WALLET', label: 'Assets & Wallet', icon: Wallet },
    { id: 'ORDERS', label: 'Orders & Trades', icon: FileText },
    { id: 'LISTING', label: 'Token Listing', icon: Rocket },
    { id: 'REWARDS', label: 'VIP & Rewards', icon: Crown },
    { id: 'SECURITY', label: 'Account & Security', icon: ShieldCheck },
  ];

  if (isAdmin) {
    navItems.push({ id: 'ADMIN', label: 'Admin Console', icon: Cpu, badge: 'RBAC' });
  }

  return (
    <aside
      className={`hidden md:flex flex-col shrink-0 bg-[#090D12] border-r border-[#202B34] transition-all duration-150 select-none ${
        isCollapsed ? 'w-14' : 'w-56'
      }`}
    >
      {/* Navigation List */}
      <div className="flex-1 py-3 px-2 space-y-1 overflow-y-auto scrollbar-thin">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive =
            currentView === item.id ||
            (item.id === 'WALLET' && (currentView === 'DEPOSIT' || currentView === 'WITHDRAW')) ||
            (item.id === 'ORDERS' && currentView === 'TRANSACTIONS') ||
            (item.id === 'SECURITY' && (currentView === 'SETTINGS' || currentView === 'KYC'));

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={`relative w-full flex items-center gap-3 px-2.5 py-2 rounded-[7px] text-xs font-medium transition-colors duration-150 cursor-pointer ${
                isActive
                  ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944] font-semibold'
                  : 'text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#141C24] border border-transparent'
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-[#8DA5B1]" />
              )}
              <Icon
                className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#C1D0D6]' : 'text-[#71818B]'}`}
              />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
              {!isCollapsed && item.badge && (
                <span
                  className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-[4px] font-mono font-semibold border ${
                    isActive
                      ? 'bg-[#17212B] text-[#C1D0D6] border-[#40515D]'
                      : 'bg-[#141C24] text-[#8DA5B1] border-[#202B34]'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Collapse Toggle Footer */}
      <div className="p-2 border-t border-[#202B34]">
        <button
          type="button"
          onClick={toggleCollapse}
          className="w-full flex items-center justify-center p-2 rounded-[7px] text-[#71818B] hover:text-[#E4EBEF] hover:bg-[#141C24] transition-colors cursor-pointer"
          title={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <div className="flex items-center gap-2 text-xs font-medium">
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
};
