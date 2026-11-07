/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/convert/ConvertView.tsx
 * DOMINEX Instant Crypto Conversion Terminal — Zero Slippage, 0% Fee
 */

import React, { useState, useEffect } from 'react';
import {
  ArrowUpDown,
  RefreshCw,
  Zap,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Sparkles,
  ChevronDown,
  Info,
  X
} from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { useToast } from '../ui/Toast.js';
import { UserProfile, UserBalance, TradingPairItem } from '../../types/index.js';

interface Props {
  user: UserProfile | null;
  balances: UserBalance[];
  pairs: TradingPairItem[];
  onOpenAuthModal: () => void;
  onRefreshBalances: () => void;
  displayCurrency: 'USDT' | 'IDR';
}

interface ConvertHistoryItem {
  id: string;
  fromAsset: string;
  fromAmount: number;
  toAsset: string;
  toAmount: number;
  rate: number;
  timestamp: number;
  status: 'COMPLETED';
}

export const ConvertView: React.FC<Props> = ({
  user,
  balances,
  pairs,
  onOpenAuthModal,
  onRefreshBalances,
  displayCurrency,
}) => {
  const { showToast } = useToast();
  const [fromAsset, setFromAsset] = useState('USDT');
  const [toAsset, setToAsset] = useState('BTC');
  const [fromAmount, setFromAmount] = useState('1000');
  const [quoteSeconds, setQuoteSeconds] = useState(5);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isConverting, setIsConverting] = useState(false);

  // Conversion history
  const [history, setHistory] = useState<ConvertHistoryItem[]>([
    {
      id: 'conv-1',
      fromAsset: 'USDT',
      fromAmount: 2500,
      toAsset: 'ETH',
      toAmount: 0.8845,
      rate: 2826.45,
      timestamp: Date.now() - 3600000 * 2,
      status: 'COMPLETED'
    },
    {
      id: 'conv-2',
      fromAsset: 'BTC',
      fromAmount: 0.05,
      toAsset: 'USDT',
      toAmount: 4572.50,
      rate: 91450.00,
      timestamp: Date.now() - 3600000 * 24,
      status: 'COMPLETED'
    }
  ]);

  const availableCoins = [
    { symbol: 'USDT', name: 'Tether USD', icon: '₮', defaultRateUsd: 1 },
    { symbol: 'BTC', name: 'Bitcoin', icon: '₿', defaultRateUsd: 91850 },
    { symbol: 'ETH', name: 'Ethereum', icon: 'Ξ', defaultRateUsd: 2840 },
    { symbol: 'SOL', name: 'Solana', icon: '◎', defaultRateUsd: 188 },
    { symbol: 'BNB', name: 'BNB Chain', icon: 'BNB', defaultRateUsd: 645 },
    { symbol: 'XRP', name: 'Ripple', icon: '✕', defaultRateUsd: 2.14 },
    { symbol: 'DOGE', name: 'Dogecoin', icon: 'Ð', defaultRateUsd: 0.24 },
    { symbol: 'ADA', name: 'Cardano', icon: '₳', defaultRateUsd: 0.82 },
  ];

  // Derive rate
  const fromCoin = availableCoins.find(c => c.symbol === fromAsset) || availableCoins[0];
  const toCoin = availableCoins.find(c => c.symbol === toAsset) || availableCoins[1];
  const conversionRate = fromCoin.defaultRateUsd / toCoin.defaultRateUsd;
  const calculatedToAmount = (parseFloat(fromAmount) || 0) * conversionRate;

  // Countdown timer for 5-second quote guarantee
  useEffect(() => {
    const timer = setInterval(() => {
      setQuoteSeconds(prev => (prev <= 1 ? 5 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSwapAssets = () => {
    const temp = fromAsset;
    setFromAsset(toAsset);
    setToAsset(temp);
  };

  const handleMaxFromAmount = () => {
    const b = balances.find(b => b.currency === fromAsset);
    if (b) {
      setFromAmount(b.balanceAvailable || '0');
    } else {
      setFromAmount('1000');
    }
  };

  const handleConfirmConvert = async () => {
    if (!user) {
      onOpenAuthModal();
      return;
    }
    const val = parseFloat(fromAmount);
    if (isNaN(val) || val <= 0) {
      showToast('error', 'Invalid Amount', 'Please enter a valid amount to convert.');
      return;
    }

    setIsConverting(true);
    setTimeout(() => {
      setIsConverting(false);
      setIsPreviewOpen(false);

      const newRecord: ConvertHistoryItem = {
        id: `conv-${Date.now()}`,
        fromAsset,
        fromAmount: val,
        toAsset,
        toAmount: Number(calculatedToAmount.toFixed(6)),
        rate: conversionRate,
        timestamp: Date.now(),
        status: 'COMPLETED'
      };

      setHistory(prev => [newRecord, ...prev]);
      showToast(
        'success',
        'Instant Conversion Executed',
        `Successfully converted ${val} ${fromAsset} to ${calculatedToAmount.toFixed(6)} ${toAsset}. Zero fee charged.`
      );
      onRefreshBalances();
    }, 600);
  };

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#08090D] overflow-y-auto space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl obsidian-glass border border-white/10 p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#FF087F]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-2xl relative z-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-white/5 border border-white/10 text-xs font-semibold text-[#FF087F] mb-3">
            <Sparkles className="w-3.5 h-3.5 text-[#FF087F]" />
            DOMINEX Convert
          </div>
          <h1 className="text-2xl lg:text-3xl font-display font-extrabold text-[#F5F5F7] tracking-tight">
            Instant Zero-Slippage Crypto Swap
          </h1>
          <p className="text-xs lg:text-sm text-[#9298A6] mt-2 leading-relaxed">
            Convert any cryptocurrency instantly with zero order book slippage, guaranteed 5-second fixed rates, and 0.00% trading fees.
          </p>
        </div>
      </div>

      {/* Main Convert Card Container */}
      <div className="max-w-xl mx-auto w-full space-y-4">
        <div className="rounded-2xl obsidian-glass border border-white/10 p-6 space-y-4 shadow-xl">
          {/* From Asset Input */}
          <div className="p-4 rounded-xl bg-[#0D1017] border border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs text-[#9298A6]">
              <span>From (Pay)</span>
              <button
                type="button"
                onClick={handleMaxFromAmount}
                className="text-[11px] font-bold text-[#FF087F] hover:text-[#D926FF]"
              >
                Max Balance
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <input
                type="number"
                value={fromAmount}
                onChange={e => setFromAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent text-xl font-mono font-bold text-[#F5F5F7] placeholder-[#686D7A] focus:outline-none"
              />

              <select
                value={fromAsset}
                onChange={e => setFromAsset(e.target.value)}
                className="bg-[#171923] border border-white/10 text-xs font-bold text-white rounded-lg px-3 py-2 focus:outline-none focus:border-[#FF087F]"
              >
                {availableCoins.map(coin => (
                  <option key={coin.symbol} value={coin.symbol} className="bg-[#171923]">
                    {coin.symbol} - {coin.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-[11px] text-[#9298A6] font-mono">
              ≈ ${(parseFloat(fromAmount || '0') * fromCoin.defaultRateUsd).toLocaleString()} USD
            </div>
          </div>

          {/* Swap Direction Button */}
          <div className="flex justify-center -my-2 relative z-10">
            <button
              onClick={handleSwapAssets}
              className="w-10 h-10 rounded-full bg-[#171923] border border-white/10 text-white flex items-center justify-center hover:bg-[#FF087F] transition-all shadow-md active:scale-95"
              title="Reverse direction"
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>
          </div>

          {/* To Asset Output */}
          <div className="p-4 rounded-xl bg-[#0D1017] border border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs text-[#9298A6]">
              <span>To (Receive)</span>
              <span className="text-[11px] text-[#16C784] font-medium">Guaranteed Rate</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <input
                type="text"
                readOnly
                value={calculatedToAmount > 0 ? calculatedToAmount.toFixed(6) : '0.00'}
                className="w-full bg-transparent text-xl font-mono font-bold text-[#16C784] focus:outline-none"
              />

              <select
                value={toAsset}
                onChange={e => setToAsset(e.target.value)}
                className="bg-[#171923] border border-white/10 text-xs font-bold text-white rounded-lg px-3 py-2 focus:outline-none focus:border-[#FF087F]"
              >
                {availableCoins.filter(c => c.symbol !== fromAsset).map(coin => (
                  <option key={coin.symbol} value={coin.symbol} className="bg-[#171923]">
                    {coin.symbol} - {coin.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-[11px] text-[#9298A6] font-mono">
              ≈ ${(calculatedToAmount * toCoin.defaultRateUsd).toLocaleString()} USD
            </div>
          </div>

          {/* Rate & Guarantee Strip */}
          <div className="p-3 rounded-lg bg-[#0D1017]/80 border border-white/5 space-y-2 text-xs">
            <div className="flex items-center justify-between text-[#9298A6]">
              <span>Reference Rate</span>
              <div className="flex items-center gap-1.5 font-mono text-[#F5F5F7]">
                <span>1 {fromAsset} = {conversionRate < 0.01 ? conversionRate.toFixed(8) : conversionRate.toFixed(4)} {toAsset}</span>
                <span className="text-[10px] text-[#FF087F] font-bold">({quoteSeconds}s)</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[#9298A6]">
              <span>Transaction Fee</span>
              <span className="font-mono text-[#16C784] font-bold">0.00% FREE</span>
            </div>
            <div className="flex items-center justify-between text-[#9298A6]">
              <span>Settlement Speed</span>
              <span className="text-[#F5F5F7] font-medium">Instant to Spot Wallet</span>
            </div>
          </div>

          {/* Action CTA */}
          <Button
            variant="gradient"
            size="lg"
            className="w-full"
            onClick={() => {
              if (!user) onOpenAuthModal();
              else setIsPreviewOpen(true);
            }}
          >
            Preview Conversion
          </Button>
        </div>

        {/* Conversion History */}
        <div className="rounded-2xl obsidian-glass border border-white/10 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold text-sm text-[#F5F5F7]">Recent Conversions</h3>
            <span className="text-[11px] text-[#9298A6]">{history.length} Transactions</span>
          </div>

          <div className="space-y-2">
            {history.map(item => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 rounded-xl bg-[#0D1017]/80 border border-white/5 text-xs font-mono"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#F5F5F7]">
                      {item.fromAmount} {item.fromAsset} → {item.toAmount} {item.toAsset}
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-[#16C784]/20 text-[#16C784] font-bold">
                      {item.status}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#9298A6]">
                    Rate: 1 {item.fromAsset} = {item.rate.toFixed(4)} {item.toAsset}
                  </span>
                </div>
                <span className="text-[10px] text-[#9298A6]">
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl obsidian-glass border border-white/10 p-6 space-y-5 shadow-2xl relative">
            <button
              onClick={() => setIsPreviewOpen(false)}
              className="absolute top-4 right-4 text-[#9298A6] hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <h3 className="font-display font-bold text-lg text-[#F5F5F7]">
                Confirm Conversion
              </h3>
              <p className="text-xs text-[#9298A6] mt-1">
                Rate is locked for the next 5 seconds.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#0D1017] border border-white/5 space-y-3 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-[#9298A6]">You Pay</span>
                <span className="font-bold text-[#F5F5F7]">{fromAmount} {fromAsset}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9298A6]">You Receive</span>
                <span className="font-bold text-[#16C784]">{calculatedToAmount.toFixed(6)} {toAsset}</span>
              </div>
              <div className="flex justify-between border-t border-white/5 pt-2">
                <span className="text-[#9298A6]">Conversion Rate</span>
                <span className="text-[#F5F5F7]">1 {fromAsset} = {conversionRate.toFixed(4)} {toAsset}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9298A6]">Trading Fee</span>
                <span className="text-[#16C784] font-bold">$0.00 (0%)</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="md"
                className="flex-1"
                onClick={() => setIsPreviewOpen(false)}
              >
                Back
              </Button>
              <Button
                variant="gradient"
                size="md"
                className="flex-1"
                isLoading={isConverting}
                onClick={handleConfirmConvert}
              >
                Confirm Swap
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
