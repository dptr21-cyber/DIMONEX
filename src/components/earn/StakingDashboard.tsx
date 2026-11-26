/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/earn/StakingDashboard.tsx
 * Real-time Staking Dashboard inside EarnView: fetches live yield data from backend,
 * displays active vaults, APY%, lock-up periods, and user-staked amounts per asset.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Coins,
  Lock,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { Button } from '../ui/Button.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import {
  EarnPositionItem,
  EarnSummaryResponse,
  EarnVaultItem,
  UserBalance,
  UserProfile,
} from '../../types/index.js';

export interface ClaimBurstFeedback {
  positionId: string;
  vaultId?: string;
  asset: string;
  amountDisplay: string;
  timestamp: number;
}

interface StakingDashboardProps {
  user?: UserProfile | null;
  balances?: UserBalance[];
  displayCurrency?: 'IDR' | 'USD' | 'USDT';
  externalSummary?: EarnSummaryResponse | null;
  externalVaults?: EarnVaultItem[];
  busyPositionId?: string | null;
  claimedBurst?: ClaimBurstFeedback | null;
  onSelectVaultToStake: (vault: EarnVaultItem) => void;
  onClaimPosition?: (pos: EarnPositionItem) => void;
  onNavigateTab?: (tab: 'DASHBOARD' | 'VAULTS' | 'POSITIONS' | 'HISTORY') => void;
  onOpenAuthModal?: () => void;
}

function formatUnitsReadable(unitsStr: string, decimals: number): string {
  try {
    const raw = BigInt(unitsStr || '0');
    if (raw === 0n) return '0';
    const str = raw.toString().padStart(decimals + 1, '0');
    if (decimals === 0) return str;
    const intPart = str.slice(0, -decimals) || '0';
    const fracPart = str.slice(-decimals).replace(/0+$/, '');
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fracPart ? `${intFormatted}.${fracPart}` : intFormatted;
  } catch {
    return '0';
  }
}

function formatFiatValue(usd: number, idr: number, currency: 'IDR' | 'USD' | 'USDT'): string {
  if (currency === 'IDR') {
    return `Rp ${Math.round(idr || 0).toLocaleString('id-ID')}`;
  }
  return `$${(usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const StakingDashboard: React.FC<StakingDashboardProps> = ({
  user = null,
  balances = [],
  displayCurrency = 'USD',
  externalSummary = null,
  externalVaults = [],
  busyPositionId = null,
  claimedBurst = null,
  onSelectVaultToStake,
  onClaimPosition,
  onNavigateTab,
  onOpenAuthModal,
}) => {
  const [summary, setSummary] = useState<EarnSummaryResponse | null>(externalSummary);
  const [vaults, setVaults] = useState<EarnVaultItem[]>(externalVaults);
  const [selectedAssetFilter, setSelectedAssetFilter] = useState<string>('ALL');
  const [isFetching, setIsFetching] = useState<boolean>(!externalVaults.length);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now());
  const [nowTick, setNowTick] = useState<number>(Date.now());

  const fetchRealtimeYield = useCallback(async (silent = false) => {
    if (!silent) setIsFetching(true);
    setFetchError(null);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      if (user && token) {
        const res = await fetch('/api/earn/summary', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data: EarnSummaryResponse = await res.json();
          setSummary(data);
          setVaults(data.vaults || []);
          setLastUpdatedAt(Date.now());
          return;
        }
      }

      const pubRes = await fetch('/api/earn/vaults');
      if (!pubRes.ok) {
        const err = await pubRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch staking vaults');
      }
      const pubData = await pubRes.json();
      setVaults(pubData.vaults || []);
      if (!user) setSummary(null);
      setLastUpdatedAt(Date.now());
    } catch (err: any) {
      setFetchError(err?.message || 'Unable to sync real-time yield data');
    } finally {
      setIsFetching(false);
    }
  }, [user]);

  useEffect(() => {
    if (externalSummary) setSummary(externalSummary);
  }, [externalSummary]);

  useEffect(() => {
    if (externalVaults.length > 0) setVaults(externalVaults);
  }, [externalVaults]);

  useEffect(() => {
    fetchRealtimeYield(externalVaults.length > 0);
    const poll = setInterval(() => {
      fetchRealtimeYield(true);
    }, 10_000);
    return () => clearInterval(poll);
  }, [fetchRealtimeYield, externalVaults.length]);

  // 1s clock for real-time pro-rata accruing indicator (strictly derived from server-issued rates & principal)
  useEffect(() => {
    const tick = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const activeVaults = useMemo(
    () => vaults.filter(v => v.status === 'ACTIVE'),
    [vaults]
  );

  // Build asset-level summary combining all active vault assets & user positions
  const assetHoldings = useMemo(() => {
    const map = new Map<
      string,
      {
        asset: string;
        decimals: number;
        logoUrl?: string;
        activeVaultCount: number;
        bestApyPct: number;
        userStakedUnits: bigint;
        userClaimableUnits: bigint;
        userDailyEstUnits: bigint;
        userLiveAccruingUnits: bigint;
        userStakedUsd: number;
        userStakedIdr: number;
        spotAvailableUnits: string;
        spotAvailableDisplay: string;
      }
    >();

    for (const v of activeVaults) {
      const existing = map.get(v.asset) || {
        asset: v.asset,
        decimals: v.decimals,
        logoUrl: v.assetLogoUrl,
        activeVaultCount: 0,
        bestApyPct: 0,
        userStakedUnits: 0n,
        userClaimableUnits: 0n,
        userDailyEstUnits: 0n,
        userLiveAccruingUnits: 0n,
        userStakedUsd: 0,
        userStakedIdr: 0,
        spotAvailableUnits: '0',
        spotAvailableDisplay: '0',
      };
      existing.activeVaultCount += 1;
      if (v.apyPct > existing.bestApyPct) existing.bestApyPct = v.apyPct;
      if (!existing.logoUrl && v.assetLogoUrl) existing.logoUrl = v.assetLogoUrl;
      map.set(v.asset, existing);
    }

    for (const [assetSym, item] of map.entries()) {
      const fromSummary = summary?.walletBalances?.[assetSym];
      if (fromSummary) {
        item.spotAvailableUnits = fromSummary.availableUnits;
        item.spotAvailableDisplay = fromSummary.availableDisplay;
      } else {
        const fromProp = balances.find(b => b.currency.toUpperCase() === assetSym.toUpperCase());
        if (fromProp) {
          item.spotAvailableUnits = fromProp.balanceAvailable || '0';
          item.spotAvailableDisplay = formatUnitsReadable(fromProp.balanceAvailable || '0', item.decimals);
        }
      }
    }

    const activePositions = (summary?.positions || []).filter(p => p.status !== 'REDEEMED');
    const elapsedSinceFetchMs = BigInt(Math.max(0, Math.min(60_000, nowTick - lastUpdatedAt)));

    for (const pos of activePositions) {
      const item = map.get(pos.asset) || {
        asset: pos.asset,
        decimals: pos.decimals,
        activeVaultCount: 0,
        bestApyPct: pos.apyPct,
        userStakedUnits: 0n,
        userClaimableUnits: 0n,
        userDailyEstUnits: 0n,
        userLiveAccruingUnits: 0n,
        userStakedUsd: 0,
        userStakedIdr: 0,
        spotAvailableUnits: '0',
        spotAvailableDisplay: '0',
      };

      const principal = BigInt(pos.principalUnits || '0');
      item.userStakedUnits += principal;
      item.userClaimableUnits += BigInt(pos.accruedYieldUnits || '0');
      item.userDailyEstUnits += BigInt(pos.dailyEstimatedYieldUnits || '0');
      item.userStakedUsd += pos.principalUsd || 0;
      item.userStakedIdr += pos.principalIdr || 0;

      const baseLive = BigInt(pos.liveAccruingYieldUnits || '0');
      const deltaLive = pos.status === 'ACTIVE'
        ? (principal * BigInt(pos.apyBps) * elapsedSinceFetchMs) / (3650000n * 86_400_000n)
        : 0n;
      item.userLiveAccruingUnits += baseLive + deltaLive;
      map.set(pos.asset, item);
    }

    return Array.from(map.values()).sort(
      (a, b) => b.userStakedUsd - a.userStakedUsd || b.bestApyPct - a.bestApyPct
    );
  }, [activeVaults, summary, balances, nowTick, lastUpdatedAt]);

  // Map user's staked principal & claimable yield per vault ID
  const userStakeByVaultId = useMemo(() => {
    const byVault = new Map<
      string,
      { stakedUnits: bigint; claimableUnits: bigint; activePosCount: number; primaryPosition?: EarnPositionItem }
    >();
    for (const pos of summary?.positions || []) {
      if (pos.status === 'REDEEMED') continue;
      const cur = byVault.get(pos.vaultId) || {
        stakedUnits: 0n,
        claimableUnits: 0n,
        activePosCount: 0,
      };
      cur.stakedUnits += BigInt(pos.principalUnits || '0');
      cur.claimableUnits += BigInt(pos.accruedYieldUnits || '0');
      cur.activePosCount += 1;
      if (!cur.primaryPosition || BigInt(pos.accruedYieldUnits) > BigInt(cur.primaryPosition.accruedYieldUnits)) {
        cur.primaryPosition = pos;
      }
      byVault.set(pos.vaultId, cur);
    }
    return byVault;
  }, [summary]);

  const filteredActiveVaults = useMemo(() => {
    if (selectedAssetFilter === 'ALL') return activeVaults;
    return activeVaults.filter(v => v.asset === selectedAssetFilter);
  }, [activeVaults, selectedAssetFilter]);

  const chartData = useMemo(() => {
    const hasUserStake = assetHoldings.some(a => a.userStakedUsd > 0);
    if (hasUserStake) {
      return assetHoldings
        .filter(a => a.userStakedUsd > 0)
        .map(a => ({
          asset: a.asset,
          stakedUsd: Math.round(a.userStakedUsd * 100) / 100,
          apyPct: a.bestApyPct,
        }));
    }
    return activeVaults.slice(0, 7).map(v => ({
      asset: `${v.asset} (${v.durationDays === 0 ? 'Flex' : `${v.durationDays}d`})`,
      stakedUsd: Math.round((v.totalStakedUsd || 0) * 100) / 100,
      apyPct: v.apyPct,
    }));
  }, [assetHoldings, activeVaults]);

  const hasUserStake = assetHoldings.some(a => a.userStakedUnits > 0n);

  return (
    <section className="space-y-5" aria-label="Staking Dashboard">
      {/* Real-time Dashboard Control Header */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#E4EBEF]">Real-Time Staking Dashboard</h2>
          <p className="text-xs text-[#71818B] font-mono tabular-nums mt-0.5">
            Active vaults {activeVaults.length} · Synced {new Date(lastUpdatedAt).toLocaleTimeString('id-ID')} · Settlement UTC 00:00
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!user && onOpenAuthModal && (
            <Button variant="primary" size="sm" onClick={onOpenAuthModal}>
              Sign In to Track Stakes
            </Button>
          )}
          {onNavigateTab && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onNavigateTab('POSITIONS')}
              icon={<ArrowUpRight className="w-3.5 h-3.5" />}
            >
              Manage Positions ({summary?.portfolio.activePositionsCount || 0})
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchRealtimeYield(false)}
            disabled={isFetching}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />}
          >
            Sync Live Yield
          </Button>
        </div>
      </div>

      {fetchError && (
        <div className="rounded-[10px] bg-[#401F27]/60 border border-[#EA5B65]/40 p-3.5 flex items-center justify-between gap-3 text-xs text-[#E4EBEF]">
          <span>{fetchError}</span>
          <Button variant="secondary" size="sm" onClick={() => fetchRealtimeYield(false)}>
            Retry
          </Button>
        </div>
      )}

      {/* User-Staked Amounts Per Specific Asset */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#A1AFB8] font-mono">
            User-Staked Allocation by Asset
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedAssetFilter('ALL')}
              className={`px-2.5 py-1 rounded-[6px] text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                selectedAssetFilter === 'ALL'
                  ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#40515D]'
                  : 'text-[#A1AFB8] hover:text-[#E4EBEF] bg-[#141C24] border border-[#202B34]'
              }`}
            >
              All Assets
            </button>
            {assetHoldings.map(item => (
              <button
                key={item.asset}
                type="button"
                onClick={() => setSelectedAssetFilter(item.asset)}
                className={`px-2.5 py-1 rounded-[6px] text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                  selectedAssetFilter === item.asset
                    ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#40515D]'
                    : 'text-[#A1AFB8] hover:text-[#E4EBEF] bg-[#141C24] border border-[#202B34]'
                }`}
              >
                {item.asset}
              </button>
            ))}
          </div>
        </div>

        {isFetching && assetHoldings.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 rounded-[10px] bg-[#141C24] border border-[#202B34] animate-pulse p-4" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {assetHoldings
              .filter(a => selectedAssetFilter === 'ALL' || a.asset === selectedAssetFilter)
              .map(item => {
                const stakedDisplay = formatUnitsReadable(item.userStakedUnits.toString(), item.decimals);
                const claimableDisplay = formatUnitsReadable(item.userClaimableUnits.toString(), item.decimals);
                const accruingDisplay = formatUnitsReadable(item.userLiveAccruingUnits.toString(), item.decimals);
                const dailyDisplay = formatUnitsReadable(item.userDailyEstUnits.toString(), item.decimals);
                const bestVaultForAsset = activeVaults.find(v => v.asset === item.asset && v.apyPct === item.bestApyPct)
                  || activeVaults.find(v => v.asset === item.asset);

                return (
                  <div
                    key={item.asset}
                    className="rounded-[10px] bg-[#141C24] border border-[#202B34] hover:border-[#40515D] p-4 space-y-3 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <AssetIcon symbol={item.asset} logoUrl={item.logoUrl} size="sm" />
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-[#E4EBEF] block">{item.asset}</span>
                          <span className="text-[11px] font-mono text-[#71818B]">
                            {item.activeVaultCount} active vault{item.activeVaultCount !== 1 ? 's' : ''} · Up to {item.bestApyPct.toFixed(2)}% APY
                          </span>
                        </div>
                      </div>
                      {bestVaultForAsset && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onSelectVaultToStake(bestVaultForAsset)}
                        >
                          Stake
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#202B34] font-mono tabular-nums text-xs">
                      <div>
                        <span className="text-[10px] uppercase text-[#71818B] block">User Staked</span>
                        <span className="text-sm font-semibold text-[#E4EBEF]">
                          {stakedDisplay} {item.asset}
                        </span>
                        <span className="text-[10px] text-[#71818B] block">
                          {formatFiatValue(item.userStakedUsd, item.userStakedIdr, displayCurrency)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase text-[#71818B] block">Real-Time Yield</span>
                        <span className="text-sm font-semibold text-[#16A879]">
                          +{claimableDisplay} {item.asset}
                        </span>
                        <span className="text-[10px] text-[#71818B] block">
                          {item.userStakedUnits > 0n
                            ? `Live +${accruingDisplay} (${dailyDisplay}/d)`
                            : `Spot Avail: ${item.spotAvailableDisplay}`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Analytics + Active Vaults Matrix */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left/Main: Active Vaults Table with APY%, Lock-up Periods, Live TVL & User Staked */}
        <div className="xl:col-span-8 rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
          <div className="px-4 py-3 bg-[#17212B] border-b border-[#202B34] flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-[#E4EBEF]">
                Active Staking Vaults & Lock-up Schedules ({filteredActiveVaults.length})
              </h3>
              <p className="text-[11px] text-[#71818B]">
                Live custody vaults with real-time APY%, lock-up periods, and your active principal per vault.
              </p>
            </div>
            {selectedAssetFilter !== 'ALL' && (
              <Button variant="secondary" size="sm" onClick={() => setSelectedAssetFilter('ALL')}>
                Show All Assets
              </Button>
            )}
          </div>

          {filteredActiveVaults.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <Coins className="w-6 h-6 text-[#71818B] mx-auto" />
              <p className="text-sm font-semibold text-[#E4EBEF]">No active vaults for {selectedAssetFilter}</p>
              <Button variant="secondary" size="sm" onClick={() => setSelectedAssetFilter('ALL')}>
                Reset Asset Filter
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="bg-[#111820] text-[11px] text-[#A1AFB8] border-b border-[#202B34] font-sans">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Vault / Asset</th>
                    <th className="px-4 py-2.5 font-semibold">APY%</th>
                    <th className="px-4 py-2.5 font-semibold">Lock-Up Period</th>
                    <th className="px-4 py-2.5 font-semibold">Vault TVL</th>
                    <th className="px-4 py-2.5 font-semibold">Your Staked</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34]">
                  {filteredActiveVaults.map(vault => {
                    const userVaultData = userStakeByVaultId.get(vault.id);
                    const userStakedStr = userVaultData
                      ? formatUnitsReadable(userVaultData.stakedUnits.toString(), vault.decimals)
                      : '0';
                    const claimableUnits = userVaultData?.claimableUnits || 0n;
                    const capPct = Math.min(100, Math.round(vault.utilizationBps / 100));
                    const primaryPosId = userVaultData?.primaryPosition?.id;
                    const isClaimingRow = Boolean(primaryPosId && busyPositionId === primaryPosId);
                    const showRowClaimBurst = Boolean(
                      claimedBurst &&
                        (claimedBurst.vaultId === vault.id ||
                          (primaryPosId && claimedBurst.positionId === primaryPosId))
                    );

                    return (
                      <motion.tr
                        key={vault.id}
                        animate={
                          showRowClaimBurst
                            ? { backgroundColor: ['rgba(22, 168, 121, 0.14)', 'rgba(20, 28, 36, 0)'] }
                            : undefined
                        }
                        transition={{ duration: 1.1, ease: 'easeOut' }}
                        className="hover:bg-[#17212B]/60 transition-colors"
                      >
                        <td className="px-4 py-3 font-sans">
                          <div className="flex items-center gap-2.5">
                            <AssetIcon symbol={vault.asset} logoUrl={vault.assetLogoUrl} size="sm" />
                            <div className="min-w-0">
                              <span className="font-semibold text-[#E4EBEF] block truncate max-w-[200px]">
                                {vault.name}
                              </span>
                              <span className="text-[11px] font-mono text-[#71818B]">
                                {vault.asset} · {vault.type} · Min {formatUnitsReadable(vault.minStakeUnits, vault.decimals)} {vault.asset}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-bold text-[#16A879]">{vault.apyPct.toFixed(2)}%</span>
                          {vault.autoCompoundSupported && (
                            <span className="block text-[10px] text-[#71818B]">Auto-Compound</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 text-[#E4EBEF]">
                            {vault.durationDays === 0 ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#16A879] shrink-0" />
                            ) : (
                              <Lock className="w-3.5 h-3.5 text-[#D6A85C] shrink-0" />
                            )}
                            {vault.durationDays === 0 ? 'Flexible (0d)' : `${vault.durationDays} Days`}
                          </span>
                          <span className="block text-[10px] text-[#71818B]">
                            {vault.durationDays === 0
                              ? 'Instant redeem'
                              : vault.earlyRedeemAllowed
                                ? `Early fee ${(vault.earlyRedeemPenaltyBps / 100).toFixed(2)}%`
                                : 'Strict lock'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[#E4EBEF] block">
                            {vault.totalStakedDisplay} {vault.asset}
                          </span>
                          <span className="text-[10px] text-[#71818B]">
                            {formatFiatValue(vault.totalStakedUsd, vault.totalStakedIdr, displayCurrency)} · {capPct}% cap
                          </span>
                        </td>
                        <td className="px-4 py-3 relative">
                          <span className={`font-semibold block ${userVaultData && userVaultData.stakedUnits > 0n ? 'text-[#E4EBEF]' : 'text-[#71818B]'}`}>
                            {user ? `${userStakedStr} ${vault.asset}` : '—'}
                          </span>
                          {claimableUnits > 0n && (
                            <span className="text-[10px] text-[#16A879] block">
                              +{formatUnitsReadable(claimableUnits.toString(), vault.decimals)} claimable
                            </span>
                          )}
                          <AnimatePresence>
                            {showRowClaimBurst && claimedBurst && (
                              <motion.span
                                key={claimedBurst.timestamp}
                                initial={{ opacity: 0, y: 6, scale: 0.9 }}
                                animate={{ opacity: 1, y: -4, scale: 1 }}
                                exit={{ opacity: 0, y: -14 }}
                                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                                className="inline-block text-[10px] font-semibold text-[#35B887]"
                              >
                                +{claimedBurst.amountDisplay} {claimedBurst.asset} Credited
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </td>
                        <td className="px-4 py-3 text-right font-sans">
                          <div className="inline-flex items-center gap-1.5">
                            {claimableUnits > 0n && userVaultData?.primaryPosition && onClaimPosition && (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={isClaimingRow}
                                onClick={() => onClaimPosition(userVaultData.primaryPosition!)}
                                icon={
                                  isClaimingRow ? (
                                    <RefreshCw className="w-3 h-3 animate-spin text-[#16A879]" />
                                  ) : undefined
                                }
                              >
                                {isClaimingRow ? 'Claiming...' : 'Claim'}
                              </Button>
                            )}
                            <Button
                              variant="profit"
                              size="sm"
                              onClick={() => onSelectVaultToStake(vault)}
                            >
                              {user ? 'Stake' : 'Sign In'}
                            </Button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Recharts Real Yield / Stake Breakdown */}
        <div className="xl:col-span-4 rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-[#E4EBEF]">
                {hasUserStake ? 'Staked Capital by Asset (USD)' : 'Active Vault APY% & Live TVL'}
              </h3>
              <p className="text-[11px] text-[#71818B]">
                {hasUserStake
                  ? 'Real principal allocation settled in Earn Custody'
                  : 'Compare live APY% across active custody vaults'}
              </p>
            </div>
            <TrendingUp className="w-4 h-4 text-[#16A879] shrink-0" />
          </div>

          <div className="h-56 w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#202B34" vertical={false} />
                  <XAxis
                    dataKey="asset"
                    tick={{ fill: '#71818B', fontSize: 10, fontFamily: 'monospace' }}
                    axisLine={{ stroke: '#202B34' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#71818B', fontSize: 10, fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#111820',
                      borderColor: '#2B3944',
                      borderRadius: '8px',
                      fontSize: '11px',
                      color: '#E4EBEF',
                    }}
                    formatter={(val: any, name: any) =>
                      name === 'apyPct' ? [`${Number(val).toFixed(2)}%`, 'APY'] : [`$${Number(val).toLocaleString('en-US')}`, 'Staked USD']
                    }
                  />
                  <Bar
                    dataKey={hasUserStake ? 'stakedUsd' : 'apyPct'}
                    fill="#16A879"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={42}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-[#71818B] font-mono">
                No active vault metrics available
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-[#202B34] space-y-2 text-xs font-mono tabular-nums">
            <div className="flex justify-between">
              <span className="text-[#71818B]">Next Daily Settlement</span>
              <span className="inline-flex items-center gap-1 text-[#E4EBEF]">
                <CalendarClock className="w-3.5 h-3.5 text-[#8DA5B1]" />
                00:00 UTC Daily
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#71818B]">Custody Verification</span>
              <StatusBadge tone="success">1:1 Ledger Backed</StatusBadge>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
