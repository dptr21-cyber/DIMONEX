/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/layout/Navbar.tsx
 * DIMONEX Top Navigation Bar — Obsidian Iridium Institutional Architecture
 */

import React, { useMemo, useState } from 'react';
import {
  Search,
  Bell,
  ChevronDown,
  User,
  ShieldCheck,
  LogOut,
  ArrowDownLeft,
  Crown,
  Cpu,
  Wallet,
  TrendingUp,
} from 'lucide-react';
import { UserProfile, AppLanguage, TradingPairItem } from '../../types/index.js';
import { formatQuotePrice } from '../../lib/formatters.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { DimonexIcon } from '../ui/DimonexBrand.js';
import { PercentageChange } from '../ui/PriceDisplay.js';

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
  pairs,
  onSelectPair,
  displayCurrency,
  onToggleCurrency,
}) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const filteredPairs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return pairs;
    return pairs.filter(p => {
      const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;
      return (
        sym.toLowerCase().includes(q) ||
        p.baseCurrency.toLowerCase().includes(q) ||
        p.quoteCurrency.toLowerCase().includes(q)
      );
    });
  }, [pairs, searchQuery]);

  // Derive real session / market notifications without fabricated trade alerts
  const systemNotices = useMemo(() => {
    const items: { id: string; title: string; desc: string; tag: string; actionView?: string; pairId?: string }[] = [];

    if (user) {
      items.push({
        id: 'session-kyc',
        title: `Account Status: ${(user.kycStatus || 'verified').toUpperCase()}`,
        desc: `Signed in as ${user.email} · KYC Tier ${user.kycTier ?? 2}`,
        tag: 'AUTH',
        actionView: 'SECURITY',
      });
    } else {
      items.push({
        id: 'guest-notice',
        title: 'Guest Read-Only Session',
        desc: 'Sign in to place spot orders, manage bots, or access your wallet.',
        tag: 'SESSION',
      });
    }

    const haltedPairs = pairs.filter(p => p.isHalted);
    haltedPairs.forEach(p => {
      items.push({
        id: `halt-${p.id}`,
        title: `Market Halted: ${p.symbol || p.id}`,
        desc: 'Trading is temporarily paused by exchange surveillance.',
        tag: 'HALT',
        actionView: 'MARKETS',
      });
    });

    const newListings = pairs.filter(p => p.isNewListing).slice(0, 2);
    newListings.forEach(p => {
      items.push({
        id: `new-${p.id}`,
        title: `Spot Pair Active: ${p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`}`,
        desc: `Last traded at ${formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}`,
        tag: 'NEW',
        actionView: 'TRADE',
        pairId: p.id,
      });
    });

    return items;
  }, [user, pairs]);

  const navLinks: { id: string; label: string; badge?: string; icon?: React.ReactNode }[] = [
    { id: 'OVERVIEW', label: 'Overview' },
    { id: 'MARKETS', label: 'Markets' },
    { id: 'TRADE', label: 'Spot' },
    { id: 'FUTURES', label: 'Futures', badge: '50x' },
    { id: 'COPY', label: 'Copy Trading' },
    { id: 'BOT', label: 'Bots' },
    { id: 'CONVERT', label: 'Convert' },
    { id: 'EARN', label: 'Earn' },
    { id: 'REWARDS', label: 'VIP Center', icon: <Crown className="w-3.5 h-3.5 text-[#8DA5B1]" /> },
  ];

  const isAdmin =
    user &&
    (user.role?.toUpperCase() === 'ADMIN' || user.role?.toUpperCase() === 'SUPERADMIN');

  return (
    <header className="flex items-center justify-between gap-4 lg:gap-6 px-4 lg:px-6 h-14 bg-[#090D12] border-b border-[#202B34] sticky top-0 z-40 select-none">
      {/* Zone 1: Brand & Asset Search */}
      <div className="flex items-center gap-5 shrink-0">
        <button
          type="button"
          onClick={() => onSelectView('OVERVIEW')}
          className="flex items-center gap-2.5 text-left group cursor-pointer"
        >
          <DimonexIcon
            size="md"
            className="group-hover:border-[#8DA5B1] transition-colors shadow-sm"
          />
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold tracking-[0.08em] text-[#E4EBEF] group-hover:text-white transition-colors">
              DIMONEX
            </span>
            <span className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-mono font-semibold rounded-[4px] bg-[#17212B] text-[#8DA5B1] border border-[#2B3944] uppercase tracking-wider">
              INSTITUTIONAL
            </span>
          </div>
        </button>

        {/* Global Asset Search */}
        <div className="relative hidden md:block">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[#71818B] absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Search coin or pair..."
              aria-label="Search coin or pair"
              value={searchQuery}
              onFocus={() => setIsSearchOpen(true)}
              onChange={e => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              className="w-48 lg:w-60 bg-[#111820] border border-[#2B3944] rounded-[7px] pl-8 pr-3 py-1.5 text-xs text-[#E4EBEF] placeholder-[#53616A] focus:outline-none focus:border-[#8DA5B1] focus:w-72 transition-all font-mono"
            />
          </div>

          {isSearchOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setIsSearchOpen(false)} />
              <div className="absolute top-full left-0 mt-1.5 w-80 rounded-[10px] bg-[#141C24] border border-[#2B3944] shadow-2xl p-2 z-30 max-h-80 overflow-y-auto divide-y divide-[#202B34]">
                <div className="text-[10px] font-mono font-semibold text-[#71818B] px-2 py-1.5 uppercase tracking-wider">
                  Spot Markets ({filteredPairs.length})
                </div>
                {filteredPairs.length === 0 ? (
                  <div className="py-6 text-center text-xs text-[#71818B]">
                    No matching markets found.
                  </div>
                ) : (
                  filteredPairs.slice(0, 8).map(pair => {
                    const sym = pair.symbol || `${pair.baseCurrency}/${pair.quoteCurrency}`;
                    const chg =
                      pair.priceChangePercent24h || pair.priceChange24h?.replace('+', '') || '0';

                    return (
                      <button
                        key={pair.id}
                        type="button"
                        onClick={() => {
                          onSelectPair(pair.id);
                          onSelectView('TRADE');
                          setIsSearchOpen(false);
                        }}
                        className="w-full flex items-center justify-between p-2 rounded-[7px] hover:bg-[#1D2832] text-xs font-mono transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <AssetIcon symbol={pair.baseCurrency} size="xs" />
                          <div className="text-left">
                            <span className="font-semibold text-[#E4EBEF] block">{sym}</span>
                            <span className="text-[10px] text-[#71818B]">{pair.baseCurrency}</span>
                          </div>
                        </div>
                        <div className="text-right tabular-nums">
                          <span className="text-[#E4EBEF] block">
                            {formatQuotePrice(pair.lastPrice, pair.quoteCurrency, pair.quoteDecimals, true)}
                          </span>
                          <PercentageChange value={chg} size="xs" />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Zone 2: Navigation Shortcuts */}
      <nav className="hidden xl:flex items-center gap-1 text-xs font-medium">
        {navLinks.map(link => {
          const active = currentView === link.id;
          return (
            <button
              key={link.id}
              type="button"
              onClick={() => onSelectView(link.id)}
              className={`px-2.5 py-1.5 rounded-[7px] transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                active
                  ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border border-[#2B3944]'
                  : 'text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#141C24] border border-transparent'
              }`}
            >
              {link.icon}
              <span>{link.label}</span>
              {link.badge && (
                <span className="px-1 py-0.2 text-[9px] font-mono rounded-[4px] bg-[#17212B] text-[#8DA5B1] border border-[#2B3944]">
                  {link.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Actions & Profile */}
      <div className="flex items-center gap-2 shrink-0">
        {isAdmin && (
          <button
            type="button"
            onClick={() => onSelectView('ADMIN')}
            className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] border text-xs font-semibold transition-colors cursor-pointer ${
              currentView === 'ADMIN'
                ? 'bg-[#8DA5B1] text-[#090D12] border-[#C1D0D6]/30'
                : 'bg-[#141C24] text-[#C1D0D6] border-[#2B3944] hover:bg-[#1D2832] hover:border-[#40515D]'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Admin Console</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => onSelectView('DEPOSIT')}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] bg-[#17212B] hover:bg-[#222F3A] text-[#E4EBEF] border border-[#2B3944] hover:border-[#40515D] text-xs font-semibold transition-colors cursor-pointer"
        >
          <ArrowDownLeft className="w-3.5 h-3.5 text-[#16A879]" />
          <span>Deposit</span>
        </button>

        <button
          type="button"
          onClick={onToggleCurrency}
          className="px-2.5 py-1.5 rounded-[7px] bg-[#141C24] border border-[#202B34] hover:border-[#2B3944] text-[11px] font-mono text-[#A1AFB8] hover:text-[#E4EBEF] transition-colors cursor-pointer"
          title="Toggle reference currency"
        >
          {displayCurrency}
        </button>

        {/* System Status & Alerts */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsNotifOpen(prev => !prev)}
            className="w-8 h-8 rounded-[7px] bg-[#141C24] border border-[#202B34] hover:border-[#2B3944] flex items-center justify-center text-[#A1AFB8] hover:text-[#E4EBEF] transition-colors relative cursor-pointer"
            title="System Notices"
            aria-label="System Notices"
          >
            <Bell className="w-4 h-4" />
            {systemNotices.some(n => n.tag === 'HALT' || n.tag === 'NEW') && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#8DA5B1]" />
            )}
          </button>

          {isNotifOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setIsNotifOpen(false)} />
              <div className="absolute right-0 mt-2 w-80 rounded-[10px] bg-[#141C24] border border-[#2B3944] shadow-2xl p-3.5 z-30 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-[#202B34]">
                  <span className="font-semibold text-xs text-[#E4EBEF]">Exchange Notices</span>
                  <span className="text-[10px] font-mono text-[#8DA5B1]">{systemNotices.length} Active</span>
                </div>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {systemNotices.map(n => (
                    <div
                      key={n.id}
                      onClick={() => {
                        if (n.pairId) onSelectPair(n.pairId);
                        if (n.actionView) onSelectView(n.actionView);
                        setIsNotifOpen(false);
                      }}
                      className={`p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] text-xs space-y-1 ${
                        n.actionView ? 'hover:bg-[#17212B] cursor-pointer' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#E4EBEF] truncate">{n.title}</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#17212B] text-[#8DA5B1] border border-[#2B3944]">
                          {n.tag}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#71818B] leading-relaxed">{n.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* User Profile / Auth */}
        {user ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsUserMenuOpen(prev => !prev)}
              className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-[7px] bg-[#141C24] border border-[#202B34] hover:border-[#2B3944] text-xs text-[#E4EBEF] transition-colors cursor-pointer"
            >
              <div className="w-6 h-6 rounded-[5px] bg-[#1D2832] border border-[#40515D] flex items-center justify-center font-mono font-semibold text-[#C1D0D6] text-[11px]">
                {user.email.slice(0, 1).toUpperCase()}
              </div>
              <span className="hidden md:inline-block max-w-[110px] truncate font-mono text-[11px] text-[#E4EBEF]">
                {user.email.split('@')[0]}
              </span>
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-semibold rounded-[4px] bg-[#17212B] text-[#8DA5B1] border border-[#2B3944] uppercase">
                {user.role || 'TRADER'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-[#71818B]" />
            </button>

            {isUserMenuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setIsUserMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-60 rounded-[10px] bg-[#141C24] border border-[#2B3944] shadow-2xl p-2 z-30 space-y-1 text-xs">
                  <div className="p-2 border-b border-[#202B34]">
                    <span className="text-[10px] text-[#71818B] block">Authenticated Account</span>
                    <span className="font-mono font-semibold text-[#E4EBEF] truncate block">{user.email}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onSelectView('WALLET');
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-[7px] hover:bg-[#1D2832] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                  >
                    <Wallet className="w-4 h-4 text-[#8DA5B1]" />
                    <span>Assets & Portfolio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectView('TRADE');
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-[7px] hover:bg-[#1D2832] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                  >
                    <TrendingUp className="w-4 h-4 text-[#8DA5B1]" />
                    <span>Spot Terminal</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectView('REWARDS');
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-[7px] hover:bg-[#1D2832] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                  >
                    <Crown className="w-4 h-4 text-[#D6A85C]" />
                    <span>VIP Tier & Rewards</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectView('SECURITY');
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-[7px] hover:bg-[#1D2832] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4 text-[#35B887]" />
                    <span>Account & Security</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectView('KYC');
                      setIsUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 p-2 rounded-[7px] hover:bg-[#1D2832] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                  >
                    <User className="w-4 h-4 text-[#8DA5B1]" />
                    <span>Identity Verification (KYC)</span>
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectView('ADMIN');
                        setIsUserMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 p-2 rounded-[7px] bg-[#1D2832] hover:bg-[#222F3A] text-[#C1D0D6] font-semibold border border-[#2B3944] cursor-pointer"
                    >
                      <Cpu className="w-4 h-4 text-[#8DA5B1]" />
                      <span>Admin Master Console</span>
                    </button>
                  )}

                  <div className="border-t border-[#202B34] pt-1 mt-1">
                    <button
                      type="button"
                      onClick={() => {
                        onLogout();
                        setIsUserMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 p-2 rounded-[7px] hover:bg-[#401F27] text-[#EA5B65] cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenAuthModal}
            className="px-3.5 py-1.5 rounded-[7px] bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] text-xs font-semibold border border-[#C1D0D6]/20 transition-colors cursor-pointer"
          >
            Sign In
          </button>
        )}
      </div>
    </header>
  );
};
