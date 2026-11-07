/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/layout/Navbar.tsx
 * DOMINEX Top Navigation Bar — Obsidian Glass Architecture
 */

import React, { useState } from 'react';
import {
  Search,
  Bell,
  ChevronDown,
  User,
  ShieldCheck,
  LogOut,
  Sparkles,
  ArrowUpRight,
  TrendingUp,
  Globe,
  Sliders,
  Wallet,
  CheckCircle2,
  Clock,
  Layers,
  Flame,
  ArrowDownLeft,
  Crown,
  Cpu
} from 'lucide-react';
import { UserProfile, AppLanguage, TradingPairItem } from '../../types/index.js';
import { formatIDR, formatCrypto } from '../../lib/formatters.js';

interface Props {
  currentView: string;
  onSelectView: (view: any) => void;
  user: UserProfile | null;
  onOpenAuthModal: () => void;
  onLogout: () => void;
  lang: AppLanguage;
  onToggleLang: () => void;
  pairs: TradingPairItem[];
  selectedPairId: string;
  onSelectPair: (pairId: string) => void;
  onQuickLogin: (email: string, pass: string) => void;
  displayCurrency: 'USDT' | 'IDR';
  onToggleCurrency: () => void;
}

export const Navbar: React.FC<Props> = ({
  currentView,
  onSelectView,
  user,
  onOpenAuthModal,
  onLogout,
  lang,
  onToggleLang,
  pairs,
  selectedPairId,
  onSelectPair,
  onQuickLogin,
  displayCurrency,
  onToggleCurrency,
}) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const notifications = [
    { id: '1', title: 'Limit Order Executed', desc: 'BTC/USDT Buy 0.05 BTC filled at $91,240', time: '2m ago', unread: true },
    { id: '2', title: 'Deposit Confirmed', desc: '1,500.00 USDT received on TRC-20 network', time: '14m ago', unread: true },
    { id: '3', title: 'Copy Trading PnL', desc: 'ApexQuant closed SOL long position (+18.4%)', time: '1h ago', unread: false },
  ];

  const filteredPairs = pairs.filter(p => {
    const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;
    return sym.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.baseCurrency.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <header className="flex items-center justify-between gap-4 lg:gap-8 px-4 lg:px-6 h-14 bg-[#08090D] border-b border-white/10 sticky top-0 z-40 select-none">
      {/* Zone 1: Brand Zone */}
      <div className="flex items-center gap-6 shrink-0">
        <button
          onClick={() => onSelectView('OVERVIEW')}
          className="flex items-center gap-2.5 text-left group focus:outline-none"
        >
          {/* Obsidian Magenta Brand Mark */}
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#FF087F] to-[#D926FF] flex items-center justify-center shadow-lg shadow-[#FF087F]/30 group-hover:brightness-110 transition-all">
            <Flame className="w-4 h-4 text-white fill-white" />
          </div>
          <div>
            <span className="text-base font-display font-extrabold tracking-wider text-[#F5F5F7] group-hover:text-white transition-colors block">
              DOMINEX
            </span>
          </div>
          <span className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-mono font-bold rounded bg-[#FF087F]/15 text-[#FF087F] border border-[#FF087F]/30 uppercase tracking-wider">
            PRO
          </span>
        </button>

        {/* Global Asset Search */}
        <div className="relative hidden md:block">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[#9298A6] absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Search coin / pair..."
              value={searchQuery}
              onFocus={() => setIsSearchOpen(true)}
              onChange={e => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              className="w-48 lg:w-60 bg-[#171923] border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#F5F5F7] placeholder-[#686D7A] focus:outline-none focus:border-[#FF087F] focus:w-72 transition-all font-mono"
            />
          </div>

          {/* Quick Search Dropdown */}
          {isSearchOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setIsSearchOpen(false)}
              />
              <div className="absolute top-full left-0 mt-1.5 w-72 rounded-xl obsidian-glass border border-white/10 shadow-2xl p-2 z-30 max-h-80 overflow-y-auto divide-y divide-white/5">
                <div className="text-[10px] font-bold text-[#9298A6] px-2 py-1 uppercase tracking-wider">
                  Spot & Futures Pairs
                </div>
                {filteredPairs.slice(0, 6).map(pair => {
                  const sym = pair.symbol || `${pair.baseCurrency}/${pair.quoteCurrency}`;
                  const chg = parseFloat(pair.priceChangePercent24h || pair.priceChange24h?.replace('+', '') || '0');

                  return (
                    <button
                      key={pair.id}
                      onClick={() => {
                        onSelectPair(pair.id);
                        onSelectView('TRADE');
                        setIsSearchOpen(false);
                      }}
                      className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-white/5 text-xs font-mono transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#F5F5F7]">{sym}</span>
                        <span className="text-[10px] text-[#9298A6]">{pair.baseCurrency}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[#F5F5F7] block">
                          Rp {(parseFloat(pair.lastPrice) / 100).toLocaleString()}
                        </span>
                        <span className={`text-[10px] ${chg >= 0 ? 'text-[#16C784]' : 'text-[#EA3943]'}`}>
                          {chg >= 0 ? `+${chg.toFixed(2)}%` : `${chg.toFixed(2)}%`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Zone 2: Navigation Shortcuts */}
      <nav className="hidden xl:flex items-center gap-5 text-xs font-medium text-[#9298A6]">
        <button
          onClick={() => onSelectView('OVERVIEW')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
            currentView === 'OVERVIEW' ? 'text-[#FF087F] font-semibold' : ''
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => onSelectView('MARKETS')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
            currentView === 'MARKETS' ? 'text-[#FF087F] font-semibold' : ''
          }`}
        >
          Markets
        </button>
        <button
          onClick={() => onSelectView('TRADE')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
            currentView === 'TRADE' ? 'text-[#FF087F] font-semibold' : ''
          }`}
        >
          Spot
        </button>
        <button
          onClick={() => onSelectView('FUTURES')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
            currentView === 'FUTURES' ? 'text-[#FF087F] font-semibold' : ''
          }`}
        >
          Futures
          <span className="px-1 text-[9px] font-mono rounded bg-[#FF087F]/20 text-[#FF087F]">50x</span>
        </button>
        <button
          onClick={() => onSelectView('COPY')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
            currentView === 'COPY' ? 'text-[#FF087F] font-semibold' : ''
          }`}
        >
          Copy Trading
        </button>
        <button
          onClick={() => onSelectView('BOT')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
            currentView === 'BOT' ? 'text-[#FF087F] font-semibold' : ''
          }`}
        >
          Bots
        </button>
        <button
          onClick={() => onSelectView('CONVERT')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
            currentView === 'CONVERT' ? 'text-[#FF087F] font-semibold' : ''
          }`}
        >
          Convert
        </button>
        <button
          onClick={() => onSelectView('EARN')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
            currentView === 'EARN' ? 'text-[#FF087F] font-semibold' : ''
          }`}
        >
          Earn
        </button>
        <button
          onClick={() => onSelectView('REWARDS')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
            currentView === 'REWARDS' ? 'text-[#FF087F] font-semibold' : ''
          }`}
        >
          <Crown className="w-3.5 h-3.5 text-[#FF087F]" />
          VIP Center
        </button>
      </nav>

      {/* Zone 3: Actions & Profile */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Admin Console Shortcut for Operators */}
        {user && (user.role?.toUpperCase() === 'ADMIN' || user.role?.toUpperCase() === 'SUPERADMIN') && (
          <button
            onClick={() => onSelectView('ADMIN')}
            className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
              currentView === 'ADMIN'
                ? 'bg-[#FF087F] text-white border-[#FF087F] shadow-md shadow-[#FF087F]/30'
                : 'bg-[#171923] text-[#FF087F] border-[#FF087F]/40 hover:bg-[#FF087F]/10'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            Admin Console
          </button>
        )}

        {/* Deposit Quick Action */}
        <button
          onClick={() => onSelectView('DEPOSIT')}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#FF087F] to-[#D926FF] text-white text-xs font-semibold hover:brightness-110 shadow-md shadow-[#FF087F]/20 active:scale-95 transition-all"
        >
          <ArrowDownLeft className="w-3.5 h-3.5" />
          Deposit
        </button>

        {/* Currency Switcher */}
        <button
          onClick={onToggleCurrency}
          className="px-2 py-1 rounded bg-[#171923] border border-white/10 text-[11px] font-mono text-[#9298A6] hover:text-white transition-colors"
          title="Toggle display currency"
        >
          {displayCurrency}
        </button>

        {/* Notifications Icon & Drawer */}
        <div className="relative">
          <button
            onClick={() => setIsNotifOpen(prev => !prev)}
            className="w-8 h-8 rounded-lg bg-[#171923] border border-white/10 flex items-center justify-center text-[#9298A6] hover:text-white hover:border-white/20 transition-all relative"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#FF087F]" />
          </button>

          {isNotifOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setIsNotifOpen(false)}
              />
              <div className="absolute right-0 mt-2 w-80 rounded-2xl obsidian-glass border border-white/10 shadow-2xl p-4 z-30 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <span className="font-display font-bold text-xs text-[#F5F5F7]">Notifications</span>
                  <span className="text-[10px] font-mono text-[#FF087F]">2 Unread</span>
                </div>
                <div className="space-y-2">
                  {notifications.map(n => (
                    <div
                      key={n.id}
                      className="p-2.5 rounded-xl bg-[#0D1017] border border-white/5 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#F5F5F7]">{n.title}</span>
                        <span className="text-[10px] text-[#9298A6] font-mono">{n.time}</span>
                      </div>
                      <p className="text-[11px] text-[#9298A6]">{n.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* User Profile / Auth State */}
        {user ? (
          <div className="relative">
            <button
              onClick={() => setIsUserMenuOpen(prev => !prev)}
              className="flex items-center gap-2 pl-2 pr-2.5 py-1 rounded-lg bg-[#171923] border border-white/10 hover:border-white/20 text-xs text-[#F5F5F7] transition-all"
            >
              <div className="w-6 h-6 rounded-md bg-gradient-to-tr from-[#FF087F] to-[#D926FF] flex items-center justify-center font-bold text-white text-[11px]">
                {user.email.slice(0, 1).toUpperCase()}
              </div>
              <span className="hidden md:inline-block max-w-[100px] truncate font-mono text-[11px]">
                {user.email.split('@')[0]}
              </span>
              <span className="px-1 text-[9px] font-bold rounded bg-[#FF087F]/20 text-[#FF087F] font-mono">
                VIP 1
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-[#9298A6]" />
            </button>

            {isUserMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setIsUserMenuOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-56 rounded-xl obsidian-glass border border-white/10 shadow-2xl p-2 z-30 space-y-1 text-xs">
                  <div className="p-2 border-b border-white/5">
                    <span className="text-[10px] text-[#9298A6] block">Signed in as</span>
                    <span className="font-mono font-bold text-[#F5F5F7] truncate block">{user.email}</span>
                  </div>

                  <button
                    onClick={() => {
                      onSelectView('WALLET');
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 text-[#9298A6] hover:text-white"
                  >
                    <Wallet className="w-4 h-4" />
                    Assets & Portfolio
                  </button>
                  <button
                    onClick={() => {
                      onSelectView('REWARDS');
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 text-[#9298A6] hover:text-white"
                  >
                    <Crown className="w-4 h-4 text-[#FF087F]" />
                    VIP Tier & Rewards
                  </button>
                  <button
                    onClick={() => {
                      onSelectView('SECURITY');
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 text-[#9298A6] hover:text-white"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    Account & Security
                  </button>
                  <button
                    onClick={() => {
                      onSelectView('KYC');
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 text-[#9298A6] hover:text-white"
                  >
                    <User className="w-4 h-4" />
                    Identity Verification (KYC)
                  </button>

                  {user && (user.role?.toUpperCase() === 'ADMIN' || user.role?.toUpperCase() === 'SUPERADMIN') && (
                    <button
                      onClick={() => {
                        onSelectView('ADMIN');
                        setIsUserMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 p-2 rounded-lg bg-[#FF087F]/10 hover:bg-[#FF087F]/20 text-[#FF087F] font-bold border border-[#FF087F]/30"
                    >
                      <Cpu className="w-4 h-4" />
                      Admin Master Console
                    </button>
                  )}

                  <div className="border-t border-white/5 pt-1 mt-1">
                    <button
                      onClick={() => {
                        onLogout();
                        setIsUserMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-[#EA3943]/15 text-[#EA3943]"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            onClick={onOpenAuthModal}
            className="px-3.5 py-1.5 rounded-lg bg-[#FF087F] hover:bg-[#FF268F] text-white text-xs font-semibold shadow-md shadow-[#FF087F]/20 active:scale-95 transition-all"
          >
            Sign In
          </button>
        )}
      </div>
    </header>
  );
};
