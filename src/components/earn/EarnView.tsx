/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/earn/EarnView.tsx
 * DOMINEX Institutional Earn & Staking Vaults — Obsidian Glass Architecture
 */

import React, { useState } from 'react';
import { Flame, ShieldCheck, ArrowRight, CheckCircle2, Sparkles, TrendingUp, Lock, Rocket, Clock, X } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { useToast } from '../ui/Toast.js';

interface EarnVault {
  id: string;
  asset: string;
  name: string;
  type: 'FLEXIBLE' | 'FIXED' | 'STAKING' | 'LAUNCHPOOL';
  duration: string;
  apy: number;
  minAmount: string;
  totalLocked: string;
  isHot?: boolean;
}

export const EarnView: React.FC = () => {
  const { showToast } = useToast();
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'FLEXIBLE' | 'FIXED' | 'STAKING' | 'LAUNCHPOOL'>('ALL');
  const [selectedVault, setSelectedVault] = useState<EarnVault | null>(null);
  const [stakeAmount, setStakeAmount] = useState('500');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const vaults: EarnVault[] = [
    { id: 'v-domx', asset: 'DOMX', name: 'DOMINEX Launchpool Staking', type: 'LAUNCHPOOL', duration: '90 Days', apy: 24.50, minAmount: '100 DOMX', totalLocked: '12,500,000 DOMX', isHot: true },
    { id: 'v-usdt', asset: 'USDT', name: 'Tether USD Flexible Vault', type: 'FLEXIBLE', duration: 'Flexible', apy: 8.50, minAmount: '10 USDT', totalLocked: '$18,420,500 USDT' },
    { id: 'v-usdt-fixed', asset: 'USDT', name: 'Tether USD Term Deposit', type: 'FIXED', duration: '120 Days', apy: 12.80, minAmount: '100 USDT', totalLocked: '$8,100,000 USDT', isHot: true },
    { id: 'v-btc', asset: 'BTC', name: 'Bitcoin Prime Yield', type: 'FIXED', duration: '60 Days', apy: 4.25, minAmount: '0.001 BTC', totalLocked: '580 BTC' },
    { id: 'v-eth', asset: 'ETH', name: 'Ethereum Liquid Staking', type: 'STAKING', duration: 'Flexible', apy: 5.60, minAmount: '0.01 ETH', totalLocked: '12,450 ETH' },
    { id: 'v-sol', asset: 'SOL', name: 'Solana High-Yield Validator', type: 'STAKING', duration: '30 Days', apy: 7.80, minAmount: '0.5 SOL', totalLocked: '142,000 SOL' },
    { id: 'v-bnb', asset: 'BNB', name: 'BNB Vault Launchpool', type: 'LAUNCHPOOL', duration: 'Flexible', apy: 14.20, minAmount: '0.1 BNB', totalLocked: '45,000 BNB', isHot: true },
  ];

  const filteredVaults = vaults.filter(v => activeFilter === 'ALL' || v.type === activeFilter);

  const handleSubscribe = () => {
    if (!stakeAmount || parseFloat(stakeAmount) <= 0) {
      showToast('error', 'Invalid Amount', 'Please specify staking allocation amount.');
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      showToast('success', 'Subscription Active', `Successfully subscribed ${stakeAmount} ${selectedVault?.asset} at ${selectedVault?.apy}% APY.`);
      setSelectedVault(null);
      setStakeAmount('');
    }, 800);
  };

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#08090D] overflow-y-auto space-y-6">
      {/* Banner */}
      <div className="rounded-2xl obsidian-glass border border-white/10 p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#FF087F]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-2xl relative z-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-white/5 border border-white/10 text-xs font-semibold text-[#FF087F] mb-3">
            <Sparkles className="w-3.5 h-3.5 text-[#FF087F]" />
            DOMINEX Institutional Earn
          </div>
          <h1 className="text-2xl lg:text-3xl font-display font-extrabold text-[#F5F5F7] tracking-tight">
            Earn Up to 24.5% APY on Crypto Assets
          </h1>
          <p className="text-xs lg:text-sm text-[#9298A6] mt-2 leading-relaxed">
            Flexible savings, fixed staking, and ecosystem launchpools backed by audited cold-storage custody and guaranteed daily interest distribution.
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { id: 'ALL', label: 'All Products' },
          { id: 'FLEXIBLE', label: 'Flexible Savings' },
          { id: 'FIXED', label: 'Fixed Term (30-120d)' },
          { id: 'STAKING', label: 'PoS Staking' },
          { id: 'LAUNCHPOOL', label: 'Launchpool' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveFilter(tab.id as any)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-xl transition-all whitespace-nowrap ${
              activeFilter === tab.id
                ? 'bg-gradient-to-r from-[#FF087F]/20 to-[#D926FF]/15 text-white font-bold border border-[#FF087F]/40 shadow-sm'
                : 'text-[#9298A6] hover:text-[#F5F5F7] hover:bg-[#171923] border border-white/5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Vaults Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredVaults.map(vault => (
          <div
            key={vault.id}
            className="rounded-2xl obsidian-glass border border-white/10 p-5 flex flex-col justify-between hover:border-[#FF087F]/40 transition-all shadow-xl group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#171923] border border-white/10 flex items-center justify-center font-bold text-white text-xs">
                    {vault.asset}
                  </div>
                  <div>
                    <span className="font-display font-bold text-xs text-[#F5F5F7] block">{vault.name}</span>
                    <span className="text-[10px] text-[#9298A6] font-mono">{vault.duration}</span>
                  </div>
                </div>

                {vault.isHot && (
                  <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-[#FF087F]/20 text-[#FF087F] border border-[#FF087F]/30">
                    HOT
                  </span>
                )}
              </div>

              <div className="p-3 rounded-xl bg-[#0D1017] border border-white/5 my-3">
                <span className="text-[10px] text-[#9298A6] block">Estimated APY</span>
                <span className="text-2xl font-mono font-extrabold text-[#16C784]">
                  {vault.apy.toFixed(2)}%
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-[#9298A6] font-mono pb-4 border-b border-white/5">
                <div className="flex justify-between">
                  <span>Min Subscription</span>
                  <span className="text-[#F5F5F7]">{vault.minAmount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Capacity</span>
                  <span className="text-[#F5F5F7]">{vault.totalLocked}</span>
                </div>
                <div className="flex justify-between">
                  <span>Payout Schedule</span>
                  <span className="text-[#16C784] font-medium">Daily 00:00 UTC</span>
                </div>
              </div>
            </div>

            <Button
              variant="gradient"
              size="sm"
              className="w-full mt-4"
              onClick={() => setSelectedVault(vault)}
            >
              Subscribe Now
            </Button>
          </div>
        ))}
      </div>

      {/* Subscribe Modal */}
      {selectedVault && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl obsidian-glass border border-white/10 p-6 space-y-4 shadow-2xl relative">
            <button
              onClick={() => setSelectedVault(null)}
              className="absolute top-4 right-4 text-[#9298A6] hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <h3 className="font-display font-bold text-lg text-[#F5F5F7]">
                Subscribe to {selectedVault.name}
              </h3>
              <span className="text-xs text-[#9298A6]">Duration: {selectedVault.duration} · Payout: Daily</span>
            </div>

            <div className="p-3 rounded-xl bg-[#0D1017] border border-white/5 flex items-center justify-between font-mono text-xs">
              <span className="text-[#9298A6]">Annual Yield (APY)</span>
              <span className="text-lg font-bold text-[#16C784]">+{selectedVault.apy.toFixed(2)}%</span>
            </div>

            <Input
              label={`Stake Amount (${selectedVault.asset})`}
              value={stakeAmount}
              onChange={e => setStakeAmount(e.target.value)}
              suffixText={selectedVault.asset}
              actionText={`Min: ${selectedVault.minAmount}`}
            />

            <div className="p-3 rounded-lg bg-[#0D1017]/80 border border-white/5 text-xs text-[#9298A6] space-y-1">
              <div className="flex justify-between">
                <span>Estimated Daily Return:</span>
                <span className="text-[#16C784] font-mono font-bold">
                  ≈ {((parseFloat(stakeAmount || '0') * selectedVault.apy) / 100 / 365).toFixed(4)} {selectedVault.asset}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Redemption:</span>
                <span className="text-[#F5F5F7]">Instant to Spot Wallet</span>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="outline"
                size="md"
                className="flex-1"
                onClick={() => setSelectedVault(null)}
              >
                Cancel
              </Button>
              <Button
                variant="gradient"
                size="md"
                className="flex-1"
                isLoading={isSubmitting}
                onClick={handleSubscribe}
              >
                Confirm Staking
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
