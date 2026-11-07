/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/layout/Sidebar.tsx
 * DOMINEX Global Navigation Sidebar — Obsidian Glass Architecture
 */

import React, { useState } from 'react';
import {
  LayoutDashboard,
  BarChart3,
  TrendingUp,
  Zap,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  History,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bot,
  ShieldCheck,
  Cpu,
  Rocket,
  Users,
  ArrowLeftRight,
  PiggyBank,
  Crown,
  Lock
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
    return localStorage.getItem('dominex_sidebar_collapsed') === 'true';
  });

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('dominex_sidebar_collapsed', String(next));
      return next;
    });
  };

  const navItems = [
    { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
    { id: 'MARKETS', label: 'Markets', icon: BarChart3 },
    { id: 'TRADE', label: 'Spot Trading', icon: TrendingUp },
    { id: 'FUTURES', label: 'Futures Trading', icon: Zap, badge: '50x' },
    { id: 'COPY', label: 'Copy Trading', icon: Users, badge: 'Hot' },
    { id: 'BOT', label: 'Trading Bots', icon: Bot },
    { id: 'CONVERT', label: 'Convert', icon: ArrowLeftRight, badge: '0% Fee' },
    { id: 'EARN', label: 'Earn & Stake', icon: PiggyBank },
    { id: 'WALLET', label: 'Assets & Wallet', icon: Wallet },
    { id: 'ORDERS', label: 'Orders & Trades', icon: FileText },
    { id: 'REWARDS', label: 'VIP & Rewards', icon: Crown },
    { id: 'SECURITY', label: 'Account & Security', icon: ShieldCheck },
  ];

  if (isAdmin) {
    navItems.push({ id: 'ADMIN', label: 'Admin Console', icon: Cpu, badge: 'RBAC' });
  }

  return (
    <aside
      className={`hidden md:flex flex-col shrink-0 bg-[#08090D] border-r border-white/10 transition-all duration-200 select-none ${
        isCollapsed ? 'w-14' : 'w-56'
      }`}
    >
      {/* Navigation List */}
      <div className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = currentView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onSelectView(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-xs font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-gradient-to-r from-[#FF087F]/15 to-[#D926FF]/10 text-white border border-[#FF087F]/30 font-semibold shadow-sm'
                  : 'text-[#9298A6] hover:text-[#F5F5F7] hover:bg-[#171923]'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#FF087F]' : 'text-[#686D7A]'}`} />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
              {!isCollapsed && item.badge && (
                <span className={`ml-auto text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${
                  item.badge === 'Hot' || item.badge === '50x'
                    ? 'bg-[#FF087F]/20 text-[#FF087F]'
                    : 'bg-white/10 text-[#C5C9D4]'
                }`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Collapse Toggle Footer */}
      <div className="p-2 border-t border-white/10">
        <button
          onClick={toggleCollapse}
          className="w-full flex items-center justify-center p-2 rounded-lg text-[#9298A6] hover:text-white hover:bg-[#171923] transition-colors"
          title={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : (
            <div className="flex items-center gap-2 text-xs font-medium">
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse Sidebar</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
};
