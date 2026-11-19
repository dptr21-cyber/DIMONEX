/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/wallet/WalletView.tsx
 * DIMONEX Universal Portfolio & Asset Management — Obsidian Iridium.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Wallet,
  Eye,
  EyeOff,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  Copy,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Clock,
  ArrowRightLeft,
  Activity,
  Calendar
} from 'lucide-react';
import { UserBalance, UserProfile, TradingPairItem } from '../../types/index.js';
import { formatIDR, safeBigInt } from '../../lib/formatters.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Modal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { SegmentedTabs } from '../ui/Tabs.js';
import { SearchInput } from '../ui/Controls.js';
import { AssetPerformance } from './AssetPerformance.js';
import { BalanceDiagnosticModal } from './BalanceDiagnosticModal.js';
import { LivePnLView } from './LivePnLView.js';
import { PnLCalendarView } from './PnLCalendarView.js';
import { connectMetaMaskWallet, formatAddress } from '../../lib/web3.js';

interface Props {
  balances: UserBalance[];
  pairs?: TradingPairItem[];
  user: UserProfile | null;
  onRefreshBalances: () => void;
  onOpenAuthModal: () => void;
  onOpenKycView: () => void;
  onNavigateTrade?: (pairId: string) => void;
  initialAction?: 'NONE' | 'DEPOSIT' | 'WITHDRAW' | 'TRANSACTIONS';
}

interface NetworkOption {
  id: string;
  name: string;
  fee: string;
  minDeposit: string;
  confirmations: number;
}

interface RealTransaction {
  id: string;
  type: string;
  asset: string;
  amount: string;
  status: string;
  time: string;
  txid: string;
  method?: string;
}

interface SupportedAssetItem {
  symbol: string;
  name: string;
  isFiat: boolean;
  decimals: number;
  networks: NetworkOption[];
  presets: { label: string; value: string }[];
  status: string;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
}

export const WalletView: React.FC<Props> = ({
  balances,
  pairs = [],
  user,
  onRefreshBalances,
  onOpenAuthModal,
  onNavigateTrade,
  initialAction = 'NONE',
}) => {
  const { showToast } = useToast();
  const [hideBalance, setHideBalance] = useState(false);
  const [activeTab, setActiveTab] = useState<'ASSETS' | 'LIVE_PNL' | 'CALENDAR_PNL' | 'TRANSACTIONS'>(
    initialAction === 'TRANSACTIONS' ? 'TRANSACTIONS' : 'ASSETS'
  );
  const [search, setSearch] = useState('');
  const [activeModal, setActiveModal] = useState<'NONE' | 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER'>(
    initialAction === 'DEPOSIT' ? 'DEPOSIT' : initialAction === 'WITHDRAW' ? 'WITHDRAW' : 'NONE'
  );
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);

  const [supportedAssets, setSupportedAssets] = useState<SupportedAssetItem[]>([]);
  const [, setIsLoadingAssets] = useState(false);

  const [selectedAsset, setSelectedAsset] = useState<string>('IDR');
  const [selectedNetwork, setSelectedNetwork] = useState<string>('VA_BCA');
  const [modalAssetSearch, setModalAssetSearch] = useState('');

  const [depositAmount, setDepositAmount] = useState<string>('10000000');
  const [isCopied, setIsCopied] = useState(false);
  const [isSimulatingDeposit, setIsSimulatingDeposit] = useState(false);

  const [wdAddress, setWdAddress] = useState('');
  const [wdAmount, setWdAmount] = useState('');
  const [isSubmittingWd, setIsSubmittingWd] = useState(false);

  const [transactions, setTransactions] = useState<RealTransaction[]>([]);
  const [isLoadingTxs, setIsLoadingTxs] = useState(false);

  const [dynamicAddress, setDynamicAddress] = useState<string>('');

  const [connectedWeb3Address, setConnectedWeb3Address] = useState<string | null>(null);
  const [isConnectingWeb3, setIsConnectingWeb3] = useState(false);

  const handleConnectMetaMask = async () => {
    setIsConnectingWeb3(true);
    try {
      const res = await connectMetaMaskWallet();
      if (res.success && res.account) {
        setConnectedWeb3Address(res.account);
        showToast('success', 'MetaMask Terhubung', `Dompet Web3: ${formatAddress(res.account)}`);
      } else {
        showToast('info', 'Status Web3', res.error || 'MetaMask tidak dapat terhubung.');
      }
    } catch (e: any) {
      showToast('info', 'Status Web3', e?.message || 'MetaMask dibatasi di browser ini.');
    } finally {
      setIsConnectingWeb3(false);
    }
  };

  const fetchSupportedAssets = useCallback(async () => {
    try {
      setIsLoadingAssets(true);
      const res = await fetch('/api/wallet/supported-assets');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setSupportedAssets(data);
        }
      }
    } catch (e) {
      console.warn('Failed to load supported assets, using dynamic fallback:', e);
    } finally {
      setIsLoadingAssets(false);
    }
  }, []);

  useEffect(() => {
    fetchSupportedAssets();
  }, [fetchSupportedAssets]);

  const allAvailableTokens = useMemo(() => {
    const tokenMap = new Map<string, { symbol: string; name: string; isFiat: boolean; decimals: number }>();

    const defaults = [
      { symbol: 'IDR', name: 'Indonesian Rupiah', isFiat: true, decimals: 2 },
      { symbol: 'USDT', name: 'Tether USD', isFiat: false, decimals: 6 },
      { symbol: 'BTC', name: 'Bitcoin', isFiat: false, decimals: 8 },
      { symbol: 'ETH', name: 'Ethereum', isFiat: false, decimals: 8 },
      { symbol: 'SOL', name: 'Solana', isFiat: false, decimals: 8 },
      { symbol: 'TON', name: 'The Open Network', isFiat: false, decimals: 8 },
      { symbol: 'DOGE', name: 'Dogecoin', isFiat: false, decimals: 8 }
    ];
    defaults.forEach(d => tokenMap.set(d.symbol, d));

    supportedAssets.forEach(a => {
      tokenMap.set(a.symbol, {
        symbol: a.symbol,
        name: a.name,
        isFiat: a.isFiat,
        decimals: a.decimals
      });
    });

    pairs.forEach(p => {
      if (p.baseCurrency && !tokenMap.has(p.baseCurrency)) {
        tokenMap.set(p.baseCurrency, {
          symbol: p.baseCurrency,
          name: p.baseCurrency,
          isFiat: false,
          decimals: p.baseDecimals || 8
        });
      }
      if (p.quoteCurrency && !tokenMap.has(p.quoteCurrency)) {
        tokenMap.set(p.quoteCurrency, {
          symbol: p.quoteCurrency,
          name: p.quoteCurrency === 'IDR' ? 'Indonesian Rupiah' : p.quoteCurrency,
          isFiat: p.quoteCurrency === 'IDR',
          decimals: p.quoteDecimals || 2
        });
      }
    });

    balances.forEach(b => {
      if (b.currency && !tokenMap.has(b.currency)) {
        tokenMap.set(b.currency, {
          symbol: b.currency,
          name: b.currency,
          isFiat: b.currency === 'IDR',
          decimals: b.currency === 'IDR' ? 2 : (b.currency === 'USDT' ? 6 : 8)
        });
      }
    });

    return Array.from(tokenMap.values());
  }, [supportedAssets, pairs, balances]);

  const getNetworksForAsset = useCallback((assetSymbol: string): NetworkOption[] => {
    const clean = assetSymbol.toUpperCase();
    const found = supportedAssets.find(a => a.symbol === clean);
    if (found && found.networks && found.networks.length > 0) {
      return found.networks;
    }

    if (clean === 'IDR') {
      return [
        { id: 'VA_BCA', name: 'BCA Virtual Account', fee: 'Rp 0', minDeposit: 'Rp 50.000', confirmations: 1 },
        { id: 'VA_MANDIRI', name: 'Mandiri Virtual Account', fee: 'Rp 0', minDeposit: 'Rp 50.000', confirmations: 1 },
        { id: 'VA_BRI', name: 'BRI Virtual Account', fee: 'Rp 0', minDeposit: 'Rp 50.000', confirmations: 1 },
      ];
    }
    if (clean === 'USDT') {
      return [
        { id: 'TRC20', name: 'Tron (TRC20)', fee: '1.00 USDT', minDeposit: '10.00 USDT', confirmations: 1 },
        { id: 'ERC20', name: 'Ethereum (ERC20)', fee: '3.50 USDT', minDeposit: '20.00 USDT', confirmations: 12 },
        { id: 'ARBITRUM', name: 'Arbitrum One (L2)', fee: '0.20 USDT', minDeposit: '5.00 USDT', confirmations: 20 },
        { id: 'SOLANA', name: 'Solana (SPL)', fee: '0.50 USDT', minDeposit: '5.00 USDT', confirmations: 32 },
      ];
    }
    if (clean === 'BTC') {
      return [
        { id: 'BITCOIN', name: 'Bitcoin (Native SegWit)', fee: '0.0001 BTC', minDeposit: '0.0005 BTC', confirmations: 2 },
        { id: 'LIGHTNING', name: 'Lightning Network', fee: '0.00001 BTC', minDeposit: '0.0001 BTC', confirmations: 1 },
        { id: 'BEP20', name: 'BNB Smart Chain (BEP20)', fee: '0.00005 BTC', minDeposit: '0.0002 BTC', confirmations: 15 },
      ];
    }
    if (clean === 'ETH') {
      return [
        { id: 'ERC20', name: 'Ethereum (ERC20)', fee: '0.0015 ETH', minDeposit: '0.005 ETH', confirmations: 12 },
        { id: 'ARBITRUM', name: 'Arbitrum One (L2)', fee: '0.0001 ETH', minDeposit: '0.001 ETH', confirmations: 20 },
        { id: 'OPTIMISM', name: 'OP Mainnet', fee: '0.0001 ETH', minDeposit: '0.001 ETH', confirmations: 20 },
      ];
    }
    if (clean === 'SOL') {
      return [
        { id: 'SOLANA', name: 'Solana (SPL)', fee: '0.005 SOL', minDeposit: '0.01 SOL', confirmations: 32 },
      ];
    }
    if (clean === 'TON') {
      return [
        { id: 'TON', name: 'The Open Network (TON)', fee: '0.05 TON', minDeposit: '0.1 TON', confirmations: 12 },
      ];
    }
    if (clean === 'DOGE') {
      return [
        { id: 'DOGECOIN', name: 'Dogecoin Network', fee: '2.0 DOGE', minDeposit: '5.0 DOGE', confirmations: 10 },
      ];
    }

    return [
      { id: `${clean}_MAINNET`, name: `${clean} Native Network`, fee: `0.01 ${clean}`, minDeposit: `0.1 ${clean}`, confirmations: 12 },
      { id: 'ERC20', name: 'Ethereum (ERC20)', fee: `0.05 ${clean}`, minDeposit: `0.5 ${clean}`, confirmations: 12 }
    ];
  }, [supportedAssets]);

  const getPresetsForAsset = useCallback((assetSymbol: string): { label: string; value: string }[] => {
    const clean = assetSymbol.toUpperCase();
    const found = supportedAssets.find(a => a.symbol === clean);
    if (found && found.presets && found.presets.length > 0) {
      return found.presets;
    }

    if (clean === 'IDR') {
      return [
        { label: 'Rp 5 Juta', value: '5000000' },
        { label: 'Rp 10 Juta', value: '10000000' },
        { label: 'Rp 50 Juta', value: '50000000' },
        { label: 'Rp 100 Juta', value: '100000000' },
      ];
    }
    if (clean === 'USDT') {
      return [
        { label: '100 USDT', value: '100' },
        { label: '500 USDT', value: '500' },
        { label: '1,000 USDT', value: '1000' },
        { label: '5,000 USDT', value: '5000' },
      ];
    }
    if (clean === 'BTC') {
      return [
        { label: '0.01 BTC', value: '0.01' },
        { label: '0.05 BTC', value: '0.05' },
        { label: '0.1 BTC', value: '0.1' },
        { label: '0.5 BTC', value: '0.5' },
      ];
    }
    if (clean === 'ETH') {
      return [
        { label: '0.2 ETH', value: '0.2' },
        { label: '0.5 ETH', value: '0.5' },
        { label: '1.0 ETH', value: '1.0' },
        { label: '2.0 ETH', value: '2.0' },
      ];
    }
    if (clean === 'SOL') {
      return [
        { label: '2 SOL', value: '2' },
        { label: '5 SOL', value: '5' },
        { label: '10 SOL', value: '10' },
        { label: '25 SOL', value: '25' },
      ];
    }
    if (clean === 'TON') {
      return [
        { label: '10 TON', value: '10' },
        { label: '50 TON', value: '50' },
        { label: '100 TON', value: '100' },
        { label: '500 TON', value: '500' },
      ];
    }
    if (clean === 'DOGE') {
      return [
        { label: '500 DOGE', value: '500' },
        { label: '1,000 DOGE', value: '1000' },
        { label: '5,000 DOGE', value: '5000' },
        { label: '10,000 DOGE', value: '10000' },
      ];
    }

    return [
      { label: `1 ${clean}`, value: '1' },
      { label: `5 ${clean}`, value: '5' },
      { label: `10 ${clean}`, value: '10' },
      { label: `50 ${clean}`, value: '50' }
    ];
  }, [supportedAssets]);

  useEffect(() => {
    if (selectedAsset === 'IDR') {
      setDynamicAddress('880017777777777 (BCA VA)');
      return;
    }

    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      if (selectedAsset === 'BTC') setDynamicAddress('bc1q9x3v4y5z8w2a7c6d4f5g6h7j8k9m0n1p2q3r4s');
      else if (selectedAsset === 'ETH' || (selectedAsset === 'USDT' && selectedNetwork === 'ERC20')) setDynamicAddress('0x71C94829FAb31F74d15654C4F4E4a89f92911b3B');
      else if (selectedAsset === 'USDT' && selectedNetwork === 'TRC20') setDynamicAddress('TJk4Z8QpW5u8m9b3xY2v7N1c6D4f5G6h7J');
      else if (selectedAsset === 'SOL') setDynamicAddress('4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R');
      else if (selectedAsset === 'TON') setDynamicAddress('EQD7Z8QpW5u8m9b3xY2v7N1c6D4f5G6h7J9k0m1n2p3q4r5s');
      else if (selectedAsset === 'DOGE') setDynamicAddress('D8v4Z8QpW5u8m9b3xY2v7N1c6D4f5G6h7J');
      else setDynamicAddress('0x71C94829FAb31F74d15654C4F4E4a89f92911b3B');
      return;
    }

    fetch(`/api/wallet/crypto/deposit-address/${selectedAsset}?network=${selectedNetwork}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data.address) setDynamicAddress(data.address);
      })
      .catch(() => {
        setDynamicAddress('0x71C94829FAb31F74d15654C4F4E4a89f92911b3B');
      });
  }, [selectedAsset, selectedNetwork]);

  const getAssetPriceIDR = useCallback((symbol: string): number => {
    if (symbol === 'IDR') return 1;

    const pair = pairs.find(p => p.baseCurrency === symbol && p.quoteCurrency === 'IDR');
    if (pair && pair.lastPrice) {
      const dec = pair.quoteDecimals ?? 2;
      const priceNum = Number(safeBigInt(pair.lastPrice)) / (10 ** dec);
      if (priceNum > 0) return priceNum;
    }

    const benchmarks: Record<string, number> = {
      BTC: 1450000000,
      ETH: 48500000,
      SOL: 2850000,
      USDT: 16350,
      TON: 85000,
      DOGE: 5500
    };
    return benchmarks[symbol] || 50000;
  }, [pairs]);

  const { totalEstimatedIDR, assetHoldings, allocationData } = useMemo(() => {
    let totalIDR = 0;

    const holdings = allAvailableTokens.map(tok => {
      const curr = tok.symbol;
      const b = balances.find(item => item.currency === curr);
      let avail = 0;
      let locked = 0;

      if (b) {
        const decimals = curr === 'IDR' ? 2 : (curr === 'USDT' ? 6 : 8);
        const divisor = 10 ** decimals;
        avail = parseFloat(b.displayAvailable) || parseFloat(b.available as string) || (parseFloat(b.balanceAvailable) / divisor) || 0;
        locked = parseFloat(b.displayLocked) || parseFloat(b.locked as string) || (parseFloat(b.balanceLocked) / divisor) || 0;
      }

      const total = avail + locked;
      const price = getAssetPriceIDR(curr);
      const valIDR = total * price;
      totalIDR += valIDR;

      return {
        currency: curr,
        name: tok.name,
        available: avail,
        locked,
        total,
        valIDR,
        priceIDR: price
      };
    });

    const allocation = holdings
      .filter(h => h.valIDR > 0)
      .map(h => {
        const pct = totalIDR > 0 ? (h.valIDR / totalIDR) * 100 : 0;
        const colors: Record<string, string> = {
          BTC: '#D6A85C',
          ETH: '#8DA5B1',
          USDT: '#16A879',
          SOL: '#6D9FE8',
          TON: '#A5BAC4',
          DOGE: '#D6A85C',
          IDR: '#536B77'
        };
        return {
          currency: h.currency,
          pct: Number(pct.toFixed(1)),
          color: colors[h.currency] || '#71818B'
        };
      });

    return { totalEstimatedIDR: totalIDR, assetHoldings: holdings, allocationData: allocation };
  }, [allAvailableTokens, balances, getAssetPriceIDR]);

  const fetchTransactions = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    try {
      setIsLoadingTxs(true);
      const res = await fetch('/api/wallet/transactions', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setTransactions(data);
        }
      }
    } catch (e) {
      console.warn('Failed to load wallet transactions:', e);
    } finally {
      setIsLoadingTxs(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleCopy = () => {
    navigator.clipboard.writeText(dynamicAddress);
    setIsCopied(true);
    showToast('success', 'Address Copied', 'Alamat setoran berhasil disalin ke clipboard.');
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleSimulateDeposit = async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      onOpenAuthModal();
      return;
    }

    const amtNum = parseFloat(depositAmount);
    if (!amtNum || amtNum <= 0) {
      showToast('error', 'Validasi Gagal', 'Masukkan nominal deposit yang valid');
      return;
    }

    setIsSimulatingDeposit(true);
    try {
      if (selectedAsset === 'IDR') {
        const bank = selectedNetwork.replace('VA_', '') || 'BCA';
        const res = await fetch('/api/wallet/idr/simulate-deposit-payment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            bankCode: bank,
            amount: depositAmount
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Deposit gagal diproses');

        showToast('success', 'Deposit Berhasil!', data.message || `Saldo IDR bertambah ${formatIDR(depositAmount)}`);
      } else {
        const res = await fetch('/api/wallet/crypto/simulate-deposit-block', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            currency: selectedAsset,
            amount: depositAmount,
            network: selectedNetwork
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Deposit blockchain gagal');

        showToast('success', 'Deposit Terkonfirmasi!', data.message || `Deposit ${depositAmount} ${selectedAsset} masuk ke ledger.`);
      }

      onRefreshBalances();
      fetchTransactions();
      setActiveModal('NONE');
    } catch (err: any) {
      console.error('Deposit simulation error:', err);
      showToast('error', 'Deposit Gagal', err.message || 'Terjadi kesalahan sistem');
    } finally {
      setIsSimulatingDeposit(false);
    }
  };

  const handleConfirmWithdraw = async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) {
      onOpenAuthModal();
      return;
    }

    if (!wdAddress || !wdAmount || parseFloat(wdAmount) <= 0) {
      showToast('error', 'Validation Error', 'Masukkan alamat/nomor rekening dan nominal penarikan.');
      return;
    }

    setIsSubmittingWd(true);
    try {
      if (selectedAsset === 'IDR') {
        const res = await fetch('/api/wallet/idr/withdraw', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            bankName: 'BCA',
            accountNumber: wdAddress,
            accountHolderName: user?.fullName || 'User Akun',
            amount: wdAmount
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Penarikan IDR gagal');

        showToast('success', 'Penarikan Diproses', data.message);
      } else {
        const res = await fetch('/api/wallet/crypto/withdraw', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            currency: selectedAsset,
            address: wdAddress,
            amount: wdAmount,
            network: selectedNetwork
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Penarikan kripto gagal');

        showToast('success', 'Penarikan Masuk Antrean', data.message);
      }

      onRefreshBalances();
      fetchTransactions();
      setActiveModal('NONE');
      setWdAddress('');
      setWdAmount('');
    } catch (err: any) {
      showToast('error', 'Penarikan Gagal', err.message || 'Terjadi kesalahan');
    } finally {
      setIsSubmittingWd(false);
    }
  };

  const handleSelectAssetForModal = (assetSymbol: string) => {
    setSelectedAsset(assetSymbol);
    const presets = getPresetsForAsset(assetSymbol);
    if (presets.length > 0) {
      setDepositAmount(presets[0].value);
    } else {
      setDepositAmount(assetSymbol === 'IDR' ? '10000000' : '1');
    }
    const nets = getNetworksForAsset(assetSymbol);
    if (nets.length > 0) {
      setSelectedNetwork(nets[0].id);
    }
  };

  const filteredHoldings = assetHoldings.filter(h => {
    const q = search.toLowerCase();
    return h.currency.toLowerCase().includes(q) || h.name.toLowerCase().includes(q);
  });

  const filteredModalTokens = allAvailableTokens.filter(t => {
    const q = modalAssetSearch.toLowerCase();
    return t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
  });

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto space-y-5">
      {/* Portfolio Header Card */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 lg:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-[#A1AFB8]">Estimated Portfolio Value</span>
              <button
                type="button"
                onClick={() => setHideBalance(!hideBalance)}
                className="text-[#71818B] hover:text-[#E4EBEF] transition-colors p-1 cursor-pointer"
                title={hideBalance ? 'Show balance' : 'Hide balance'}
              >
                {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex items-baseline gap-3 font-mono tabular-nums">
              <h2 className="text-2xl lg:text-3xl font-semibold text-[#E4EBEF] tracking-tight">
                {hideBalance ? 'Rp ••••••••••' : formatIDR(String(Math.round(totalEstimatedIDR * 100)))}
              </h2>
              <span className="text-xs text-[#71818B]">
                {hideBalance
                  ? '≈ $••••'
                  : `≈ $${(totalEstimatedIDR / 16350).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT`}
              </span>
            </div>

            <div className="mt-2 flex items-center gap-2 text-xs font-mono">
              <span className="inline-flex items-center gap-1 font-medium text-[#16A879]">
                <TrendingUp className="w-3.5 h-3.5" />
                Atomic Double-Entry Ledger
              </span>
              <span className="text-[#40515D]">·</span>
              <span className="text-[#A1AFB8] tabular-nums">{allAvailableTokens.length} Koin Terdaftar</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="primary"
              size="md"
              icon={<ArrowDownLeft className="w-4 h-4" />}
              onClick={() => {
                handleSelectAssetForModal('IDR');
                setActiveModal('DEPOSIT');
              }}
            >
              Deposit
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<ArrowUpRight className="w-4 h-4" />}
              onClick={() => {
                handleSelectAssetForModal('IDR');
                setActiveModal('WITHDRAW');
              }}
            >
              Tarik Dana
            </Button>
            <Button
              variant="ghost"
              size="md"
              icon={<Activity className="w-4 h-4" />}
              onClick={() => setIsDiagnosticOpen(true)}
              title="Diagnostik Sinkronisasi Saldo Ledger"
            >
              Diagnostik
            </Button>
          </div>
        </div>

        {allocationData.length > 0 && (
          <div className="mt-6 pt-5 border-t border-[#202B34] space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#A1AFB8] font-medium">Alokasi Aset Portofolio</span>
              <StatusBadge tone="success">100% Terverifikasi Ledger</StatusBadge>
            </div>
            <div className="w-full h-2 rounded-full bg-[#111820] overflow-hidden flex">
              {allocationData.map(a => (
                <div
                  key={a.currency}
                  style={{ width: `${a.pct}%`, backgroundColor: a.color }}
                  className="h-full transition-all duration-300"
                  title={`${a.currency}: ${a.pct}%`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-4 pt-1">
              {allocationData.map(a => (
                <div key={a.currency} className="flex items-center gap-1.5 text-xs font-mono tabular-nums">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: a.color }} />
                  <span className="text-[#71818B]">{a.currency}</span>
                  <span className="font-semibold text-[#E4EBEF]">{a.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Wallet Domain Tab Navigation */}
      <div className="overflow-x-auto scrollbar-none">
        <SegmentedTabs
          tabs={[
            { id: 'ASSETS', label: 'Portofolio & Saldo', icon: <Wallet className="w-3.5 h-3.5" /> },
            { id: 'LIVE_PNL', label: 'Live PnL Real-Time', icon: <TrendingUp className="w-3.5 h-3.5" /> },
            { id: 'CALENDAR_PNL', label: 'Kalender PnL Harian', icon: <Calendar className="w-3.5 h-3.5" /> },
            { id: 'TRANSACTIONS', label: 'Riwayat Transaksi Ledger', icon: <Clock className="w-3.5 h-3.5" /> },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {/* TAB 1: ASSETS */}
      {activeTab === 'ASSETS' && (
        <div className="space-y-5">
          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
            <div className="p-4 lg:p-5 border-b border-[#202B34] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#E4EBEF]">
                  Daftar Saldo &amp; Aset Terdaftar ({allAvailableTokens.length} Koin)
                </h3>
                <p className="text-[11px] text-[#71818B]">
                  Seluruh token dari pasar aktif, listing token baru, dan dompet Anda
                </p>
              </div>
              <SearchInput
                placeholder="Cari koin atau nama..."
                value={search}
                onChange={setSearch}
                className="w-full sm:w-64"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="bg-[#111820] text-[#71818B] text-[11px] uppercase tracking-wider border-b border-[#202B34]">
                  <tr>
                    <th className="py-3 px-4 font-sans font-medium">Aset / Koin</th>
                    <th className="py-3 px-4 text-right font-sans font-medium">Saldo Tersedia</th>
                    <th className="py-3 px-4 text-right font-sans font-medium">Terkunci Order</th>
                    <th className="py-3 px-4 text-right font-sans font-medium">Total Saldo</th>
                    <th className="py-3 px-4 text-right font-sans font-medium">Estimasi Nilai (IDR)</th>
                    <th className="py-3 px-4 text-right font-sans font-medium">Aksi Cepat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34]">
                  {filteredHoldings.map(h => (
                    <tr key={h.currency} className="hover:bg-[#17212B] transition-colors">
                      <td className="py-3 px-4 font-sans">
                        <div className="flex items-center gap-2.5">
                          <AssetIcon symbol={h.currency} size="sm" />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-[#E4EBEF]">{h.currency}</span>
                              {(h.currency === 'SOL' || h.currency === 'TON' || h.currency === 'DOGE') && (
                                <StatusBadge tone="brand">LISTED</StatusBadge>
                              )}
                            </div>
                            <span className="text-[10px] text-[#71818B]">{h.name}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-[#E4EBEF]">
                        {hideBalance
                          ? '••••'
                          : h.currency === 'IDR'
                          ? formatIDR(String(Math.round(h.available * 100)))
                          : `${h.available.toLocaleString()} ${h.currency}`}
                      </td>
                      <td className="py-3 px-4 text-right text-[#D6A85C]">
                        {hideBalance
                          ? '••••'
                          : h.currency === 'IDR'
                          ? formatIDR(String(Math.round(h.locked * 100)))
                          : `${h.locked.toLocaleString()} ${h.currency}`}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-[#E4EBEF]">
                        {hideBalance
                          ? '••••'
                          : h.currency === 'IDR'
                          ? formatIDR(String(Math.round(h.total * 100)))
                          : `${h.total.toLocaleString()} ${h.currency}`}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-[#E4EBEF]">
                        {hideBalance ? '••••' : formatIDR(String(Math.round(h.valIDR * 100)))}
                      </td>
                      <td className="py-3 px-4 text-right font-sans">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              handleSelectAssetForModal(h.currency);
                              setActiveModal('DEPOSIT');
                            }}
                            className="text-xs text-[#8DA5B1] hover:text-[#C1D0D6] font-medium cursor-pointer"
                          >
                            Deposit
                          </button>
                          <span className="text-[#2B3944]">|</span>
                          <button
                            type="button"
                            onClick={() => {
                              handleSelectAssetForModal(h.currency);
                              setActiveModal('WITHDRAW');
                            }}
                            className="text-xs text-[#A1AFB8] hover:text-[#E4EBEF] font-medium cursor-pointer"
                          >
                            Tarik
                          </button>
                          {onNavigateTrade && h.currency !== 'IDR' && (
                            <>
                              <span className="text-[#2B3944]">|</span>
                              <button
                                type="button"
                                onClick={() => onNavigateTrade(`${h.currency}-IDR`)}
                                className="text-xs text-[#16A879] hover:text-[#20BC8B] font-medium cursor-pointer"
                              >
                                Trade
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <AssetPerformance balances={balances} onNavigateTrade={onNavigateTrade} hideBalance={hideBalance} />
        </div>
      )}

      {/* TAB 2: LIVE PNL */}
      {activeTab === 'LIVE_PNL' && (
        <LivePnLView onNavigateTrade={onNavigateTrade} hideBalance={hideBalance} />
      )}

      {/* TAB 3: CALENDAR PNL */}
      {activeTab === 'CALENDAR_PNL' && (
        <PnLCalendarView onNavigateTrade={onNavigateTrade} hideBalance={hideBalance} />
      )}

      {/* TAB 4: TRANSACTIONS */}
      {activeTab === 'TRANSACTIONS' && (
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 lg:p-5">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#202B34]">
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">Riwayat Transaksi Ledger</h3>
              <p className="text-[11px] text-[#71818B]">Catatan riil mutasi setoran dan penarikan akun Anda</p>
            </div>
            <Button variant="secondary" size="sm" onClick={fetchTransactions}>
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTxs ? 'animate-spin' : ''}`} />
              Segarkan
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead className="bg-[#111820] text-[#71818B] text-[11px] uppercase tracking-wider border-b border-[#202B34]">
                <tr>
                  <th className="py-2.5 px-3 font-sans font-medium">Type</th>
                  <th className="py-2.5 px-3 font-sans font-medium">Asset</th>
                  <th className="py-2.5 px-3 text-right font-sans font-medium">Amount</th>
                  <th className="py-2.5 px-3 text-center font-sans font-medium">Status</th>
                  <th className="py-2.5 px-3 font-sans font-medium">Date / Time</th>
                  <th className="py-2.5 px-3 text-right font-sans font-medium">Reference / TXID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34]">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-[#71818B] font-sans">
                      <p className="font-semibold text-xs text-[#E4EBEF] mb-1">Belum Ada Riwayat Transaksi</p>
                      <p className="text-[11px]">Lakukan deposit untuk menambahkan dana ke saldo akun.</p>
                    </td>
                  </tr>
                ) : (
                  transactions.map(tx => (
                    <tr key={tx.id} className="hover:bg-[#17212B] transition-colors">
                      <td className="py-3 px-3 font-sans font-semibold">
                        <span className={tx.type === 'DEPOSIT' ? 'text-[#16A879]' : 'text-[#EA5B65]'}>
                          {tx.type}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-semibold text-[#E4EBEF]">{tx.asset}</td>
                      <td className="py-3 px-3 text-right font-semibold text-[#E4EBEF]">{tx.amount}</td>
                      <td className="py-3 px-3 text-center font-sans">
                        <StatusBadge tone="buy">{tx.status}</StatusBadge>
                      </td>
                      <td className="py-3 px-3 text-[#A1AFB8]">{tx.time}</td>
                      <td className="py-3 px-3 text-right text-[#71818B]">{tx.txid}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DEPOSIT MODAL */}
      <Modal
        isOpen={activeModal === 'DEPOSIT'}
        onClose={() => setActiveModal('NONE')}
        title={`Deposit ${selectedAsset}`}
        subtitle="Saldo otomatis dicatat ke ledger double-entry DIMONEX."
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-[#A1AFB8]">
                Pilih Aset / Koin ({allAvailableTokens.length} Koin)
              </label>
              <span className="text-[10px] text-[#C1D0D6] font-mono">Aktif: {selectedAsset}</span>
            </div>

            <SearchInput
              placeholder="Cari koin (BTC, ETH, SOL, TON, DOGE...)"
              value={modalAssetSearch}
              onChange={setModalAssetSearch}
              className="mb-2"
            />

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-h-24 flex-wrap scrollbar-none">
              {filteredModalTokens.map(tok => {
                const isCur = selectedAsset === tok.symbol;
                return (
                  <button
                    key={tok.symbol}
                    type="button"
                    onClick={() => handleSelectAssetForModal(tok.symbol)}
                    className={`px-3 py-1 text-xs font-medium rounded-[7px] border transition-colors cursor-pointer ${
                      isCur
                        ? 'bg-[#8DA5B1] text-[#090D12] border-[#8DA5B1] font-semibold'
                        : 'bg-[#111820] border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#17212B]'
                    }`}
                  >
                    {tok.symbol}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#A1AFB8] block mb-1">Jaringan Transfer / Bank</label>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {getNetworksForAsset(selectedAsset).map(net => (
                <button
                  key={net.id}
                  type="button"
                  onClick={() => setSelectedNetwork(net.id)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-[7px] border text-left transition-colors cursor-pointer ${
                    selectedNetwork === net.id
                      ? 'bg-[#1D2832] border-[#8DA5B1] text-[#E4EBEF]'
                      : 'bg-[#111820] border-[#202B34] text-[#A1AFB8] hover:text-[#E4EBEF]'
                  }`}
                >
                  <div>
                    <span className="text-xs font-semibold block text-[#E4EBEF]">{net.name}</span>
                    <span className="text-[10px] text-[#71818B] font-mono">
                      Min: {net.minDeposit} · {net.confirmations} Konfirmasi
                    </span>
                  </div>
                  <span className="text-xs font-mono font-medium text-[#16A879]">Biaya: {net.fee}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Input
              label="Nominal Setoran / Deposit"
              value={depositAmount}
              onChange={e => setDepositAmount(e.target.value)}
              placeholder={`Masukkan nominal ${selectedAsset}`}
              suffixText={selectedAsset}
            />
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-[10px] text-[#71818B] font-mono">Preset:</span>
              {getPresetsForAsset(selectedAsset).map(preset => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setDepositAmount(preset.value)}
                  className="px-2 py-0.5 rounded-[5px] text-[10px] font-mono bg-[#17212B] border border-[#2B3944] hover:border-[#8DA5B1] text-[#A1AFB8] hover:text-[#E4EBEF] transition-colors cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3.5 rounded-[10px] bg-[#111820] border border-[#202B34] flex flex-col items-center text-center">
            <span className="text-[11px] text-[#A1AFB8] mb-1.5">Alamat Setoran Akun Anda</span>
            <div className="w-full flex items-center justify-between p-2 rounded-[7px] bg-[#141C24] border border-[#2B3944] font-mono text-xs text-[#E4EBEF] mb-2">
              <span className="truncate pr-2">{dynamicAddress}</span>
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 text-[#8DA5B1] hover:text-[#C1D0D6] p-1 transition-colors cursor-pointer"
                title="Copy Address"
              >
                {isCopied ? <CheckCircle2 className="w-4 h-4 text-[#16A879]" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex items-start gap-2 p-2 rounded-[7px] bg-[#2C2415] border border-[#D6A85C]/30 text-left w-full">
              <AlertTriangle className="w-3.5 h-3.5 text-[#D6A85C] shrink-0 mt-0.5" />
              <p className="text-[10px] text-[#E4EBEF] leading-tight">
                Kirimkan hanya <strong>{selectedAsset}</strong> via jaringan yang sesuai. Transaksi diverifikasi langsung oleh ledger server.
              </p>
            </div>
          </div>

          {selectedAsset !== 'IDR' && (
            <div className="p-3 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8DA5B1]" />
                  <span className="text-[11px] font-semibold text-[#E4EBEF]">Koneksi Dompet Web3 / MetaMask</span>
                </div>
                {connectedWeb3Address ? (
                  <StatusBadge tone="buy">Terhubung</StatusBadge>
                ) : (
                  <span className="text-[10px] text-[#71818B] font-mono">Opsional</span>
                )}
              </div>

              {connectedWeb3Address ? (
                <div className="flex items-center justify-between p-2 rounded-[7px] bg-[#141C24] border border-[#16A879]/30">
                  <div className="text-left font-mono">
                    <span className="text-[10px] text-[#A1AFB8] block">Akun EVM Terdeteksi:</span>
                    <span className="text-xs text-[#16A879] font-semibold">{formatAddress(connectedWeb3Address)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConnectedWeb3Address(null)}
                    className="text-[10px] text-[#A1AFB8] hover:text-[#EA5B65] transition-colors cursor-pointer"
                  >
                    Putuskan
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-[#71818B] leading-tight text-left">
                    Hubungkan MetaMask untuk integrasi transfer on-chain langsung ke bursa.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={isConnectingWeb3}
                    onClick={handleConnectMetaMask}
                  >
                    Hubungkan MetaMask
                  </Button>
                </div>
              )}
            </div>
          )}

          <Button
            variant="profit"
            size="md"
            className="w-full"
            isLoading={isSimulatingDeposit}
            onClick={handleSimulateDeposit}
          >
            Depositkan {depositAmount} {selectedAsset} ke Ledger
          </Button>
        </div>
      </Modal>

      {/* WITHDRAW MODAL */}
      <Modal
        isOpen={activeModal === 'WITHDRAW'}
        onClose={() => setActiveModal('NONE')}
        title={`Withdraw ${selectedAsset}`}
        subtitle="Transfer dana ke dompet eksternal atau rekening bank terdaftar Anda."
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-medium text-[#A1AFB8]">
                Pilih Asset ({allAvailableTokens.length} Koin)
              </label>
              <span className="text-[10px] text-[#C1D0D6] font-mono">Dipilih: {selectedAsset}</span>
            </div>

            <SearchInput
              placeholder="Cari koin penarikan..."
              value={modalAssetSearch}
              onChange={setModalAssetSearch}
              className="mb-2"
            />

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-h-24 flex-wrap scrollbar-none">
              {filteredModalTokens.map(tok => {
                const isCur = selectedAsset === tok.symbol;
                return (
                  <button
                    key={tok.symbol}
                    type="button"
                    onClick={() => handleSelectAssetForModal(tok.symbol)}
                    className={`px-3 py-1 text-xs font-medium rounded-[7px] border transition-colors cursor-pointer ${
                      isCur
                        ? 'bg-[#8DA5B1] text-[#090D12] border-[#8DA5B1] font-semibold'
                        : 'bg-[#111820] border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#17212B]'
                    }`}
                  >
                    {tok.symbol}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedAsset !== 'IDR' && (
            <div>
              <label className="text-[11px] font-medium text-[#A1AFB8] block mb-1">Pilih Jaringan Penarikan</label>
              <div className="space-y-1">
                {getNetworksForAsset(selectedAsset).map(net => (
                  <button
                    key={net.id}
                    type="button"
                    onClick={() => setSelectedNetwork(net.id)}
                    className={`w-full flex items-center justify-between p-2 rounded-[7px] border text-left text-xs cursor-pointer ${
                      selectedNetwork === net.id
                        ? 'bg-[#1D2832] border-[#8DA5B1] text-[#E4EBEF]'
                        : 'bg-[#111820] border-[#202B34] text-[#A1AFB8]'
                    }`}
                  >
                    <span>{net.name}</span>
                    <span className="font-mono text-[#16A879]">Biaya: {net.fee}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <Input
            label="Alamat Tujuan / Nomor Rekening"
            placeholder={selectedAsset === 'IDR' ? 'Nomor Rekening Bank BCA/Mandiri/BRI' : `Alamat dompet ${selectedAsset} Anda`}
            value={wdAddress}
            onChange={e => setWdAddress(e.target.value)}
          />

          <Input
            label="Jumlah Penarikan"
            suffixText={selectedAsset}
            actionText="MAX"
            onActionClick={() => {
              const h = assetHoldings.find(x => x.currency === selectedAsset);
              if (h) setWdAmount(String(h.available));
            }}
            value={wdAmount}
            onChange={e => setWdAmount(e.target.value)}
            placeholder="0.00"
          />

          <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1.5 text-xs font-mono tabular-nums">
            <div className="flex justify-between text-[#A1AFB8]">
              <span className="font-sans">Biaya Penarikan (Fee)</span>
              <span className="text-[#E4EBEF] font-medium">
                {selectedAsset === 'BTC'
                  ? '0.0001 BTC'
                  : selectedAsset === 'USDT'
                  ? '1.00 USDT'
                  : selectedAsset === 'SOL'
                  ? '0.005 SOL'
                  : selectedAsset === 'ETH'
                  ? '0.001 ETH'
                  : selectedAsset === 'TON'
                  ? '0.05 TON'
                  : selectedAsset === 'DOGE'
                  ? '2.0 DOGE'
                  : selectedAsset === 'IDR'
                  ? 'Rp 4.500'
                  : `0.01 ${selectedAsset}`}
              </span>
            </div>
            <div className="flex justify-between text-[#A1AFB8]">
              <span className="font-sans">Jumlah Diterima Bersih</span>
              <span className="text-[#16A879] font-semibold text-sm">
                {wdAmount && parseFloat(wdAmount) > 0 ? `${wdAmount} ${selectedAsset}` : `0.00 ${selectedAsset}`}
              </span>
            </div>
          </div>

          <Button
            variant="danger"
            size="lg"
            className="w-full"
            isLoading={isSubmittingWd}
            onClick={handleConfirmWithdraw}
          >
            Konfirmasi Penarikan
          </Button>
        </div>
      </Modal>

      {/* TRANSFER MODAL */}
      <Modal
        isOpen={activeModal === 'TRANSFER'}
        onClose={() => setActiveModal('NONE')}
        title="Internal Account Transfer"
        subtitle="Instant zero-fee transfer between Spot, Futures, and Earn accounts."
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] flex items-center justify-between text-xs font-mono">
            <div>
              <span className="text-[#71818B] block text-[10px]">From</span>
              <strong className="text-[#E4EBEF]">Spot Wallet</strong>
            </div>
            <ArrowRightLeft className="w-4 h-4 text-[#8DA5B1]" />
            <div className="text-right">
              <span className="text-[#71818B] block text-[10px]">To</span>
              <strong className="text-[#E4EBEF]">Futures Contract</strong>
            </div>
          </div>

          <Input
            label="Transfer Amount"
            suffixText="USDT"
            actionText="MAX"
            onActionClick={() => showToast('info', 'Max Selected', 'Max balance set to transfer.')}
            placeholder="0.00"
          />

          <Button
            variant="primary"
            size="md"
            className="w-full"
            onClick={() => {
              showToast('success', 'Transfer Complete', 'Transferred funds from Spot to Futures wallet.');
              setActiveModal('NONE');
            }}
          >
            Execute Transfer
          </Button>
        </div>
      </Modal>

      <BalanceDiagnosticModal
        isOpen={isDiagnosticOpen}
        onClose={() => setIsDiagnosticOpen(false)}
        onBalancesUpdated={() => {
          onRefreshBalances();
          fetchTransactions();
        }}
      />
    </div>
  );
};
