/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/rewards/RewardsVipView.tsx
 * DOMINEX Rewards & Institutional VIP Center — Obsidian Glass Design
 */

import React, { useState } from 'react';
import {
  Trophy,
  Gift,
  Share2,
  Crown,
  CheckCircle2,
  Copy,
  Clock,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Zap,
  TrendingUp,
  Percent
} from 'lucide-react';
import { Button } from '../ui/Button.js';
import { useToast } from '../ui/Toast.js';
import { UserProfile, UserBalance } from '../../types/index.js';

interface Props {
  user: UserProfile | null;
  balances: UserBalance[];
  onOpenAuthModal: () => void;
  displayCurrency: 'USDT' | 'IDR';
}

interface VipTier {
  level: number;
  name: string;
  minVolume30d: string;
  makerFee: string;
  takerFee: string;
  perks: string[];
}

export const RewardsVipView: React.FC<Props> = ({
  user,
  balances,
  onOpenAuthModal,
  displayCurrency,
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'VIP' | 'REWARDS' | 'REFERRAL'>('VIP');

  // Claimed tasks state
  const [claimedTasks, setClaimedTasks] = useState<Record<string, boolean>>({
    task1: true,
  });

  const referralCode = 'DOMINEX-98421';
  const referralLink = 'https://dominex.io/register?ref=DOMINEX-98421';

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast('success', 'Copied to Clipboard', `${label} copied successfully.`);
  };

  const handleClaimReward = (taskId: string, title: string, amount: string) => {
    if (!user) {
      onOpenAuthModal();
      return;
    }
    setClaimedTasks(prev => ({ ...prev, [taskId]: true }));
    showToast('success', 'Reward Claimed!', `${amount} has been deposited to your Rewards balance.`);
  };

  const vipTiers: VipTier[] = [
    { level: 0, name: 'Regular', minVolume30d: '< $50,000', makerFee: '0.080%', takerFee: '0.100%', perks: ['Standard API', '24/7 Support'] },
    { level: 1, name: 'VIP 1', minVolume30d: '≥ $50,000', makerFee: '0.060%', takerFee: '0.080%', perks: ['15% Fee Rebate', '100 BTC Daily Withdrawal'] },
    { level: 2, name: 'VIP 2', minVolume30d: '≥ $250,000', makerFee: '0.045%', takerFee: '0.065%', perks: ['Priority Queue', 'Dedicated Support Representative'] },
    { level: 3, name: 'VIP 3', minVolume30d: '≥ $1,000,000', makerFee: '0.035%', takerFee: '0.050%', perks: ['OTC Block Trading Desk', 'Private Discord Channel'] },
    { level: 4, name: 'VIP 4', minVolume30d: '≥ $5,000,000', makerFee: '0.025%', takerFee: '0.040%', perks: ['Sub-account Management', 'Exclusive Market Maker Program'] },
    { level: 5, name: 'VIP 5', minVolume30d: '≥ $20,000,000', makerFee: '0.015%', takerFee: '0.030%', perks: ['Colocation Gateway Access', 'Zero-Fee Internal Transfers'] },
    { level: 6, name: 'Institutional', minVolume30d: '≥ $50,000,000', makerFee: '0.010%', takerFee: '0.020%', perks: ['Bespoke Custom Liquidity', 'Direct Settlement Lines'] },
  ];

  const tasks = [
    { id: 'task1', title: 'Account Registration & 2FA', reward: '$10 Fee Voucher', desc: 'Secure your DOMINEX account with Google Authenticator', completed: true },
    { id: 'task2', title: 'First Crypto Deposit', reward: '$30 Bonus Voucher', desc: 'Deposit 100 USDT or equivalent into Spot Wallet', completed: true },
    { id: 'task3', title: 'Complete First Spot Trade', reward: '$50 Mystery Box', desc: 'Execute your first spot buy or sell order', completed: false },
    { id: 'task4', title: 'Trade $2,000 in Futures', reward: '$100 Trading Bonus', desc: 'Experience perpetual futures with up to 50x leverage', completed: false },
    { id: 'task5', title: 'Advanced KYC Level 2', reward: '100 DOMX Tokens', desc: 'Verify government ID to unlock institutional limits', completed: false },
  ];

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#08090D] overflow-y-auto space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl obsidian-glass border border-white/10 p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#FF087F]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-32 w-80 h-80 bg-[#D926FF]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-3xl relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-white/5 border border-white/10 text-xs font-semibold text-[#FF087F] mb-3">
            <Crown className="w-3.5 h-3.5 text-[#FF087F]" />
            DOMINEX Institutional Rewards & VIP
          </div>
          <h1 className="text-2xl lg:text-3xl font-display font-extrabold text-[#F5F5F7] tracking-tight">
            Institutional Fee Tiers & Trader Rewards
          </h1>
          <p className="text-xs lg:text-sm text-[#9298A6] mt-2 leading-relaxed">
            Progress through our volume-based VIP tiers to unlock industry-low taker fees down to 0.020%, negative maker rebates, and claim up to $5,000 in trading vouchers.
          </p>

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => setActiveTab('VIP')}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-all ${
                activeTab === 'VIP'
                  ? 'bg-[#FF087F] text-white shadow-lg shadow-[#FF087F]/25 font-semibold'
                  : 'bg-[#171923] text-[#9298A6] hover:text-white border border-white/10'
              }`}
            >
              VIP Tier Ladder
            </button>
            <button
              onClick={() => setActiveTab('REWARDS')}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-all ${
                activeTab === 'REWARDS'
                  ? 'bg-[#FF087F] text-white shadow-lg shadow-[#FF087F]/25 font-semibold'
                  : 'bg-[#171923] text-[#9298A6] hover:text-white border border-white/10'
              }`}
            >
              Task Center
            </button>
            <button
              onClick={() => setActiveTab('REFERRAL')}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-all ${
                activeTab === 'REFERRAL'
                  ? 'bg-[#FF087F] text-white shadow-lg shadow-[#FF087F]/25 font-semibold'
                  : 'bg-[#171923] text-[#9298A6] hover:text-white border border-white/10'
              }`}
            >
              Referral Program
            </button>
          </div>
        </div>
      </div>

      {/* Tab 1: VIP Tiers */}
      {activeTab === 'VIP' && (
        <div className="space-y-6">
          {/* User Current Tier Snapshot */}
          <div className="rounded-2xl obsidian-glass border border-white/10 p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <span className="text-xs text-[#9298A6] block">Current Membership</span>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#FF087F] to-[#D926FF] flex items-center justify-center font-display font-extrabold text-white text-lg shadow-lg shadow-[#FF087F]/25">
                  V1
                </div>
                <div>
                  <h3 className="font-display font-bold text-lg text-[#F5F5F7]">VIP Level 1</h3>
                  <span className="text-xs text-[#16C784] font-medium">Active & Verified</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-[#9298A6]">30-Day Trading Volume</span>
                <span className="font-mono text-[#F5F5F7] font-bold">$124,500 / $250,000</span>
              </div>
              <div className="w-full bg-[#0D1017] rounded-full h-2.5 overflow-hidden border border-white/5">
                <div className="bg-gradient-to-r from-[#FF087F] to-[#D926FF] h-2.5 rounded-full" style={{ width: '49.8%' }} />
              </div>
              <span className="text-[11px] text-[#9298A6]">
                $125,500 more volume to unlock <strong>VIP 2</strong> fee discounts.
              </span>
            </div>

            <div className="flex items-center justify-end gap-4 p-4 rounded-xl bg-[#0D1017]/80 border border-white/5 font-mono text-xs">
              <div>
                <span className="text-[10px] text-[#9298A6] block font-sans">Maker Fee</span>
                <span className="text-base font-bold text-[#16C784]">0.060%</span>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div>
                <span className="text-[10px] text-[#9298A6] block font-sans">Taker Fee</span>
                <span className="text-base font-bold text-[#F5F5F7]">0.080%</span>
              </div>
            </div>
          </div>

          {/* VIP Tiers Table */}
          <div className="rounded-2xl obsidian-glass border border-white/10 overflow-hidden shadow-xl">
            <div className="p-4 border-b border-white/10">
              <h3 className="font-display font-bold text-base text-[#F5F5F7]">Institutional Fee Schedule</h3>
              <p className="text-xs text-[#9298A6]">Volume recalculates daily at 00:00 UTC based on 30-day rolling spot & futures volume.</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="bg-[#0D1017]/80 text-[#9298A6] border-b border-white/5">
                    <th className="py-3 px-4 font-medium font-sans">Tier</th>
                    <th className="py-3 px-4 font-medium font-sans">30D Rolling Volume</th>
                    <th className="py-3 px-4 font-medium font-sans">Spot Maker</th>
                    <th className="py-3 px-4 font-medium font-sans">Spot Taker</th>
                    <th className="py-3 px-4 font-medium font-sans">Key Privileges</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {vipTiers.map(tier => {
                    const isCurrent = tier.level === 1;

                    return (
                      <tr
                        key={tier.level}
                        className={`transition-colors ${
                          isCurrent ? 'bg-[#FF087F]/10 font-bold' : 'hover:bg-white/5'
                        }`}
                      >
                        <td className="py-3 px-4 font-display font-bold text-white flex items-center gap-2">
                          {tier.name}
                          {isCurrent && (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-[#FF087F] text-white">
                              Current
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[#F5F5F7]">{tier.minVolume30d}</td>
                        <td className="py-3 px-4 text-[#16C784] font-bold">{tier.makerFee}</td>
                        <td className="py-3 px-4 text-[#F5F5F7]">{tier.takerFee}</td>
                        <td className="py-3 px-4 font-sans text-[#9298A6]">
                          {tier.perks.join(' · ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Task Center */}
      {activeTab === 'REWARDS' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tasks.map(t => {
              const isClaimed = claimedTasks[t.id];

              return (
                <div
                  key={t.id}
                  className="rounded-xl obsidian-glass border border-white/10 p-5 flex flex-col justify-between space-y-4 hover:border-white/20 transition-all"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-display font-bold text-sm text-[#F5F5F7]">{t.title}</h4>
                        <p className="text-xs text-[#9298A6] mt-1">{t.desc}</p>
                      </div>
                      <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-[#FF087F]/15 text-[#FF087F] border border-[#FF087F]/30 shrink-0">
                        {t.reward}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between border-t border-white/5">
                    <span className="text-[11px] text-[#9298A6]">
                      Status: {isClaimed ? 'Claimed' : t.completed ? 'Ready to Claim' : 'In Progress'}
                    </span>
                    <Button
                      variant={isClaimed ? 'secondary' : t.completed ? 'gradient' : 'outline'}
                      size="sm"
                      disabled={isClaimed}
                      onClick={() => handleClaimReward(t.id, t.title, t.reward)}
                    >
                      {isClaimed ? 'Claimed' : t.completed ? 'Claim Reward' : 'Go to Task'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 3: Referral Program */}
      {activeTab === 'REFERRAL' && (
        <div className="space-y-6">
          {/* Referral KPI Card */}
          <div className="rounded-2xl obsidian-glass border border-white/10 p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-[#0D1017]">
              <span className="text-xs text-[#9298A6] block">Total Referees</span>
              <span className="text-xl font-mono font-extrabold text-[#F5F5F7] mt-1 block">18 Traders</span>
            </div>
            <div className="p-4 rounded-xl bg-[#0D1017]">
              <span className="text-xs text-[#9298A6] block">Commission Rebate Rate</span>
              <span className="text-xl font-mono font-extrabold text-[#FF087F] mt-1 block">40% Rebate</span>
            </div>
            <div className="p-4 rounded-xl bg-[#0D1017]">
              <span className="text-xs text-[#9298A6] block">Total Commission Earned</span>
              <span className="text-xl font-mono font-extrabold text-[#16C784] mt-1 block">$1,482.60 USDT</span>
            </div>
          </div>

          {/* Share Links Card */}
          <div className="rounded-2xl obsidian-glass border border-white/10 p-6 space-y-4">
            <h3 className="font-display font-bold text-base text-[#F5F5F7]">Invite Friends & Earn Together</h3>
            <p className="text-xs text-[#9298A6]">Earn up to 40% lifetime commission on every trading fee generated by your referees.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 rounded-xl bg-[#0D1017] border border-white/10 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-[#9298A6] block">Your Referral Code</span>
                  <span className="font-mono font-bold text-sm text-[#F5F5F7]">{referralCode}</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Copy className="w-3.5 h-3.5" />}
                  onClick={() => copyToClipboard(referralCode, 'Referral code')}
                >
                  Copy
                </Button>
              </div>

              <div className="p-3 rounded-xl bg-[#0D1017] border border-white/10 flex items-center justify-between">
                <div className="truncate mr-3">
                  <span className="text-[10px] text-[#9298A6] block">Your Referral Link</span>
                  <span className="font-mono font-bold text-xs text-[#F5F5F7] truncate">{referralLink}</span>
                </div>
                <Button
                  variant="gradient"
                  size="sm"
                  icon={<Copy className="w-3.5 h-3.5" />}
                  onClick={() => copyToClipboard(referralLink, 'Referral link')}
                >
                  Copy Link
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
