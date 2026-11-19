/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/earn/EarnView.tsx
 * DIMONEX Institutional Earn & Staking Vaults — Obsidian Iridium Matte Design
 */

import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Modal } from '../ui/Modal.js';
import { PageHeader } from '../ui/PanelHeader.js';
import { SegmentedTabs } from '../ui/Tabs.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { AssetIcon } from '../ui/AssetIcon.js';
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
    { id: 'v-dmx', asset: 'DMX', name: 'DIMONEX Launchpool Staking', type: 'LAUNCHPOOL', duration: '90 Days', apy: 24.50, minAmount: '100 DMX', totalLocked: '12,500,000 DMX', isHot: true },
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
      showToast(
        'success',
        'Subscription Active',
        `Successfully subscribed ${stakeAmount} ${selectedVault?.asset} at ${selectedVault?.apy}% APY.`
      );
      setSelectedVault(null);
      setStakeAmount('');
    }, 800);
  };

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto space-y-6">
      <div className="max-w-7xl w-full mx-auto space-y-6">
        <PageHeader
          title="Institutional Earn & Staking Vaults"
          subtitle="Flexible savings, fixed-term custody yields, and validator staking with daily UTC interest settlement."
          badge={<StatusBadge tone="brand" dot>DIMONEX Earn</StatusBadge>}
          actions={
            <div className="flex items-center gap-2 text-xs text-[#A1AFB8] bg-[#141C24] border border-[#202B34] rounded-[7px] px-3 py-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#35B887]" />
              <span>Audited Cold-Storage Custody</span>
            </div>
          }
        />

        <div className="overflow-x-auto pb-1">
          <SegmentedTabs
            activeTab={activeFilter}
            onChange={setActiveFilter}
            tabs={[
              { id: 'ALL', label: 'All Products' },
              { id: 'FLEXIBLE', label: 'Flexible Savings' },
              { id: 'FIXED', label: 'Fixed Term (30–120d)' },
              { id: 'STAKING', label: 'PoS Staking' },
              { id: 'LAUNCHPOOL', label: 'Launchpool' },
            ]}
          />
        </div>

        {/* Vaults Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredVaults.map(vault => (
            <div
              key={vault.id}
              className="rounded-[10px] bg-[#141C24] border border-[#202B34] hover:border-[#40515D] p-5 flex flex-col justify-between transition-colors"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AssetIcon symbol={vault.asset} size="md" />
                    <div className="min-w-0">
                      <span className="font-semibold text-xs text-[#E4EBEF] block truncate">{vault.name}</span>
                      <span className="text-[11px] text-[#71818B] font-mono">{vault.duration}</span>
                    </div>
                  </div>

                  {vault.isHot && <StatusBadge tone="warning">FEATURED</StatusBadge>}
                </div>

                <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] my-3">
                  <span className="text-[10px] uppercase tracking-wider text-[#71818B] block">Estimated APY</span>
                  <span className="text-2xl font-mono tabular-nums font-semibold text-[#16A879]">
                    {vault.apy.toFixed(2)}%
                  </span>
                </div>

                <div className="space-y-1.5 text-xs text-[#A1AFB8] font-mono tabular-nums pb-4 border-b border-[#202B34]">
                  <div className="flex justify-between">
                    <span className="font-sans text-[#71818B]">Min Subscription</span>
                    <span className="text-[#E4EBEF]">{vault.minAmount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-[#71818B]">Total Capacity</span>
                    <span className="text-[#E4EBEF]">{vault.totalLocked}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-[#71818B]">Payout Schedule</span>
                    <span className="text-[#16A879] font-medium">Daily 00:00 UTC</span>
                  </div>
                </div>
              </div>

              <Button
                variant="primary"
                size="sm"
                className="w-full mt-4"
                onClick={() => {
                  setSelectedVault(vault);
                  setStakeAmount('500');
                }}
              >
                Subscribe Vault
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Subscribe Modal */}
      <Modal
        isOpen={Boolean(selectedVault)}
        onClose={() => setSelectedVault(null)}
        title={selectedVault ? `Subscribe to ${selectedVault.name}` : 'Subscribe'}
        subtitle={selectedVault ? `Duration: ${selectedVault.duration} · Payout: Daily` : undefined}
        maxWidth="max-w-md"
      >
        {selectedVault && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-[10px] bg-[#111820] border border-[#202B34] flex items-center justify-between font-mono tabular-nums text-xs">
              <span className="text-[#A1AFB8] font-sans">Annual Yield (APY)</span>
              <span className="text-lg font-semibold text-[#16A879]">+{selectedVault.apy.toFixed(2)}%</span>
            </div>

            <Input
              label={`Stake Amount (${selectedVault.asset})`}
              value={stakeAmount}
              onChange={e => setStakeAmount(e.target.value)}
              suffixText={selectedVault.asset}
              actionText={`Min: ${selectedVault.minAmount}`}
            />

            <div className="p-3.5 rounded-[10px] bg-[#111820] border border-[#202B34] text-xs text-[#A1AFB8] space-y-1.5">
              <div className="flex justify-between">
                <span>Estimated Daily Return</span>
                <span className="text-[#16A879] font-mono tabular-nums font-semibold">
                  ≈ {((parseFloat(stakeAmount || '0') * selectedVault.apy) / 100 / 365).toFixed(4)} {selectedVault.asset}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Redemption</span>
                <span className="text-[#E4EBEF]">Instant to Spot Wallet</span>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button variant="outline" size="md" className="flex-1" onClick={() => setSelectedVault(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="md" className="flex-1" isLoading={isSubmitting} onClick={handleSubscribe}>
                Confirm Staking
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
