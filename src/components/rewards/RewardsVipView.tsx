/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/rewards/RewardsVipView.tsx
 * DIMONEX Institutional VIP Fee Schedule, Task Center & Referral Program — Obsidian Iridium Design
 */

import React, { useState } from 'react';
import { Crown, Copy } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { PageHeader, PanelHeader } from '../ui/PanelHeader.js';
import { SegmentedTabs } from '../ui/Tabs.js';
import { StatusBadge } from '../ui/StatusBadge.js';
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
  onOpenAuthModal,
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'VIP' | 'REWARDS' | 'REFERRAL'>('VIP');

  const [claimedTasks, setClaimedTasks] = useState<Record<string, boolean>>({
    task1: true,
  });

  const referralCode = 'DIMONEX-98421';
  const referralLink = 'https://dimonex.io/register?ref=DIMONEX-98421';

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast('success', 'Copied to Clipboard', `${label} copied successfully.`);
  };

  const handleClaimReward = (taskId: string, _title: string, amount: string) => {
    if (!user) {
      onOpenAuthModal();
      return;
    }
    setClaimedTasks(prev => ({ ...prev, [taskId]: true }));
    showToast('success', 'Reward Claimed', `${amount} has been deposited to your Rewards balance.`);
  };

  const vipTiers: VipTier[] = [
    { level: 0, name: 'Regular', minVolume30d: '< $50,000', makerFee: '0.080%', takerFee: '0.100%', perks: ['Standard API', '24/7 Support'] },
    { level: 1, name: 'VIP 1', minVolume30d: '≥ $50,000', makerFee: '0.060%', takerFee: '0.080%', perks: ['15% Fee Rebate', '100 BTC Daily Withdrawal'] },
    { level: 2, name: 'VIP 2', minVolume30d: '≥ $250,000', makerFee: '0.045%', takerFee: '0.065%', perks: ['Priority Queue', 'Dedicated Support Representative'] },
    { level: 3, name: 'VIP 3', minVolume30d: '≥ $1,000,000', makerFee: '0.035%', takerFee: '0.050%', perks: ['OTC Block Trading Desk', 'Private Channel'] },
    { level: 4, name: 'VIP 4', minVolume30d: '≥ $5,000,000', makerFee: '0.025%', takerFee: '0.040%', perks: ['Sub-account Management', 'Market Maker Program'] },
    { level: 5, name: 'VIP 5', minVolume30d: '≥ $20,000,000', makerFee: '0.015%', takerFee: '0.030%', perks: ['Colocation Gateway Access', 'Zero-Fee Internal Transfers'] },
    { level: 6, name: 'Institutional', minVolume30d: '≥ $50,000,000', makerFee: '0.010%', takerFee: '0.020%', perks: ['Bespoke Custom Liquidity', 'Direct Settlement Lines'] },
  ];

  const tasks = [
    { id: 'task1', title: 'Account Registration & 2FA', reward: '$10 Fee Voucher', desc: 'Secure your DIMONEX account with authenticator 2FA', completed: true },
    { id: 'task2', title: 'First Crypto Deposit', reward: '$30 Bonus Voucher', desc: 'Deposit 100 USDT or equivalent into Spot Wallet', completed: true },
    { id: 'task3', title: 'Complete First Spot Trade', reward: '$50 Mystery Box', desc: 'Execute your first spot buy or sell order', completed: false },
    { id: 'task4', title: 'Trade $2,000 in Futures', reward: '$100 Trading Bonus', desc: 'Trade perpetual contracts on the futures desk', completed: false },
    { id: 'task5', title: 'Advanced KYC Level 2', reward: '100 DMX Tokens', desc: 'Verify government ID to unlock institutional limits', completed: false },
  ];

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto space-y-6">
      <div className="max-w-7xl w-full mx-auto space-y-6">
        <PageHeader
          title="Institutional VIP & Trader Rewards"
          subtitle="Volume-based fee tiers down to 0.010% maker / 0.020% taker, trading vouchers, and partner referral rebates."
          badge={
            <StatusBadge tone="brand" dot>
              <Crown className="w-3 h-3 inline mr-1" />
              DIMONEX VIP Desk
            </StatusBadge>
          }
          actions={
            <SegmentedTabs
              activeTab={activeTab}
              onChange={setActiveTab}
              tabs={[
                { id: 'VIP', label: 'VIP Tier Ladder' },
                { id: 'REWARDS', label: 'Task Center' },
                { id: 'REFERRAL', label: 'Referral Program' },
              ]}
            />
          }
        />

        {/* Tab 1: VIP Tiers */}
        {activeTab === 'VIP' && (
          <div className="space-y-6">
            <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
              <div className="space-y-1.5">
                <span className="text-xs text-[#71818B] block">Current Membership</span>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-[7px] bg-[#1D2832] border border-[#40515D] flex items-center justify-center font-mono font-semibold text-[#C1D0D6] text-sm">
                    V1
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-[#E4EBEF]">VIP Level 1</h3>
                    <span className="text-xs text-[#16A879] font-medium">Active & Verified</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[#A1AFB8]">30-Day Trading Volume</span>
                  <span className="font-mono tabular-nums text-[#E4EBEF] font-semibold">$124,500 / $250,000</span>
                </div>
                <div className="w-full bg-[#111820] rounded-[5px] h-2 overflow-hidden border border-[#202B34]">
                  <div className="bg-[#8DA5B1] h-2 rounded-[5px]" style={{ width: '49.8%' }} />
                </div>
                <span className="text-[11px] text-[#71818B] block">
                  $125,500 more volume to unlock <strong className="text-[#E4EBEF]">VIP 2</strong> fee discounts.
                </span>
              </div>

              <div className="flex items-center justify-around gap-4 p-3.5 rounded-[7px] bg-[#111820] border border-[#202B34] font-mono tabular-nums text-xs">
                <div>
                  <span className="text-[10px] text-[#71818B] block font-sans">Maker Fee</span>
                  <span className="text-base font-semibold text-[#16A879]">0.060%</span>
                </div>
                <div className="w-px h-8 bg-[#202B34]" />
                <div>
                  <span className="text-[10px] text-[#71818B] block font-sans">Taker Fee</span>
                  <span className="text-base font-semibold text-[#E4EBEF]">0.080%</span>
                </div>
              </div>
            </div>

            <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
              <PanelHeader
                title="Institutional Fee Schedule"
                subtitle="Volume recalculates daily at 00:00 UTC based on 30-day rolling spot & futures volume."
              />

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="bg-[#111820] text-[#71818B] border-b border-[#202B34]">
                      <th className="py-3 px-4 font-medium font-sans">Tier</th>
                      <th className="py-3 px-4 font-medium font-sans">30D Rolling Volume</th>
                      <th className="py-3 px-4 font-medium font-sans">Spot Maker</th>
                      <th className="py-3 px-4 font-medium font-sans">Spot Taker</th>
                      <th className="py-3 px-4 font-medium font-sans">Key Privileges</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202B34]">
                    {vipTiers.map(tier => {
                      const isCurrent = tier.level === 1;

                      return (
                        <tr
                          key={tier.level}
                          className={`transition-colors ${
                            isCurrent ? 'bg-[#1D2832]/70' : 'hover:bg-[#17212B]'
                          }`}
                        >
                          <td className="py-3 px-4 font-sans font-semibold text-[#E4EBEF] flex items-center gap-2">
                            {tier.name}
                            {isCurrent && <StatusBadge tone="brand">Current</StatusBadge>}
                          </td>
                          <td className="py-3 px-4 text-[#E4EBEF]">{tier.minVolume30d}</td>
                          <td className="py-3 px-4 text-[#16A879] font-semibold">{tier.makerFee}</td>
                          <td className="py-3 px-4 text-[#E4EBEF]">{tier.takerFee}</td>
                          <td className="py-3 px-4 font-sans text-[#A1AFB8]">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tasks.map(t => {
              const isClaimed = claimedTasks[t.id];

              return (
                <div
                  key={t.id}
                  className="rounded-[10px] bg-[#141C24] border border-[#202B34] hover:border-[#40515D] p-5 flex flex-col justify-between space-y-4 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-sm text-[#E4EBEF]">{t.title}</h4>
                      <p className="text-xs text-[#A1AFB8] mt-1">{t.desc}</p>
                    </div>
                    <StatusBadge tone="brand">{t.reward}</StatusBadge>
                  </div>

                  <div className="pt-3 flex items-center justify-between border-t border-[#202B34]">
                    <span className="text-[11px] text-[#71818B]">
                      Status: <strong className="text-[#A1AFB8]">{isClaimed ? 'Claimed' : t.completed ? 'Ready to Claim' : 'In Progress'}</strong>
                    </span>
                    <Button
                      variant={isClaimed ? 'secondary' : t.completed ? 'primary' : 'outline'}
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
        )}

        {/* Tab 3: Referral Program */}
        {activeTab === 'REFERRAL' && (
          <div className="space-y-6">
            <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-[7px] bg-[#111820] border border-[#202B34]">
                <span className="text-xs text-[#71818B] block">Total Referees</span>
                <span className="text-xl font-mono tabular-nums font-semibold text-[#E4EBEF] mt-1 block">
                  18 Traders
                </span>
              </div>
              <div className="p-4 rounded-[7px] bg-[#111820] border border-[#202B34]">
                <span className="text-xs text-[#71818B] block">Commission Rebate Rate</span>
                <span className="text-xl font-mono tabular-nums font-semibold text-[#8DA5B1] mt-1 block">
                  40% Rebate
                </span>
              </div>
              <div className="p-4 rounded-[7px] bg-[#111820] border border-[#202B34]">
                <span className="text-xs text-[#71818B] block">Total Commission Earned</span>
                <span className="text-xl font-mono tabular-nums font-semibold text-[#16A879] mt-1 block">
                  $1,482.60 USDT
                </span>
              </div>
            </div>

            <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 space-y-4">
              <div>
                <h3 className="font-semibold text-base text-[#E4EBEF]">Invite Friends & Earn Together</h3>
                <p className="text-xs text-[#A1AFB8] mt-0.5">
                  Earn up to 40% lifetime commission on every trading fee generated by your referees.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-[7px] bg-[#111820] border border-[#202B34] flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] text-[#71818B] block">Your Referral Code</span>
                    <span className="font-mono font-semibold text-sm text-[#E4EBEF]">{referralCode}</span>
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

                <div className="p-3.5 rounded-[7px] bg-[#111820] border border-[#202B34] flex items-center justify-between gap-3">
                  <div className="truncate mr-2">
                    <span className="text-[10px] text-[#71818B] block">Your Referral Link</span>
                    <span className="font-mono font-semibold text-xs text-[#E4EBEF] truncate block">{referralLink}</span>
                  </div>
                  <Button
                    variant="primary"
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
    </div>
  );
};
