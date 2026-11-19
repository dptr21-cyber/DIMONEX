/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/convert/ConvertView.tsx
 * DIMONEX Instant Crypto Conversion Terminal — Obsidian Iridium Matte Mineral Design
 */

import React, { useState, useEffect, useMemo } from 'react';
import { ArrowUpDown, Zap, Clock, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Modal } from '../ui/Modal.js';
import { PageHeader } from '../ui/PanelHeader.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { useToast } from '../ui/Toast.js';
import { UserProfile, UserBalance, TradingPairItem } from '../../types/index.js';
import { safeBigInt } from '../../lib/formatters.js';

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

const REFERENCE_PRICES_USD: Record<string, { name: string; defaultRateUsd: number }> = {
  USDT: { name: 'Tether USD', defaultRateUsd: 1 },
  BTC: { name: 'Bitcoin', defaultRateUsd: 91850 },
  ETH: { name: 'Ethereum', defaultRateUsd: 2840 },
  SOL: { name: 'Solana', defaultRateUsd: 188 },
  BNB: { name: 'BNB Chain', defaultRateUsd: 645 },
  XRP: { name: 'Ripple', defaultRateUsd: 2.14 },
  DOGE: { name: 'Dogecoin', defaultRateUsd: 0.24 },
  ADA: { name: 'Cardano', defaultRateUsd: 0.82 },
};

export const ConvertView: React.FC<Props> = ({
  user,
  balances,
  pairs,
  onOpenAuthModal,
  onRefreshBalances,
}) => {
  const { showToast } = useToast();
  const [fromAsset, setFromAsset] = useState('USDT');
  const [toAsset, setToAsset] = useState('BTC');
  const [fromAmount, setFromAmount] = useState('1000');
  const [quoteSeconds, setQuoteSeconds] = useState(5);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isConverting, setIsConverting] = useState(false);

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

  const availableCoins = useMemo(() => {
    const usdtIdrPair = pairs.find(p => p.baseCurrency === 'USDT' && p.quoteCurrency === 'IDR');
    const usdtIdrRate =
      usdtIdrPair && usdtIdrPair.lastPrice
        ? Number(safeBigInt(usdtIdrPair.lastPrice)) / (10 ** (usdtIdrPair.quoteDecimals ?? 2))
        : 16350;

    return Object.entries(REFERENCE_PRICES_USD).map(([symbol, meta]) => {
      let liveUsd = meta.defaultRateUsd;
      const usdtPair = pairs.find(p => p.baseCurrency === symbol && p.quoteCurrency === 'USDT');
      if (usdtPair && usdtPair.lastPrice) {
        const px = Number(safeBigInt(usdtPair.lastPrice)) / (10 ** (usdtPair.quoteDecimals ?? 6));
        if (px > 0) liveUsd = px;
      } else if (symbol !== 'USDT') {
        const idrPair = pairs.find(p => p.baseCurrency === symbol && p.quoteCurrency === 'IDR');
        if (idrPair && idrPair.lastPrice && usdtIdrRate > 0) {
          const pxIdr = Number(safeBigInt(idrPair.lastPrice)) / (10 ** (idrPair.quoteDecimals ?? 2));
          if (pxIdr > 0) liveUsd = pxIdr / usdtIdrRate;
        }
      }
      return { symbol, name: meta.name, rateUsd: liveUsd };
    });
  }, [pairs]);

  const fromCoin = availableCoins.find(c => c.symbol === fromAsset) || availableCoins[0];
  const toCoin = availableCoins.find(c => c.symbol === toAsset) || availableCoins[1];
  const conversionRate = toCoin.rateUsd > 0 ? fromCoin.rateUsd / toCoin.rateUsd : 0;
  const calculatedToAmount = (parseFloat(fromAmount) || 0) * conversionRate;

  const fromBalanceFormatted = useMemo(() => {
    const b = balances.find(item => item.currency === fromAsset);
    if (!b) return '0';
    const dec = fromAsset === 'IDR' ? 2 : fromAsset === 'USDT' ? 6 : 8;
    const val =
      parseFloat(b.displayAvailable) ||
      parseFloat(b.available as string) ||
      parseFloat(b.balanceAvailable) / (10 ** dec) ||
      0;
    return val > 0 ? val.toString() : '0';
  }, [balances, fromAsset]);

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
    setFromAmount(fromBalanceFormatted);
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
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto space-y-6">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        <PageHeader
          title="Instant Zero-Slippage Convert"
          subtitle="Convert digital assets with locked 5-second institutional reference rates and 0.00% trading fees."
          badge={<StatusBadge tone="brand" dot>DIMONEX Convert</StatusBadge>}
          actions={
            <div className="flex items-center gap-2 text-xs font-mono text-[#A1AFB8] bg-[#141C24] border border-[#202B34] rounded-[7px] px-3 py-1.5">
              <Clock className="w-3.5 h-3.5 text-[#8DA5B1]" />
              <span>Rate Lock: <strong className="text-[#E4EBEF] tabular-nums">{quoteSeconds}s</strong></span>
            </div>
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Main Convert Ticket */}
          <div className="lg:col-span-7 rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 space-y-4">
            {/* From Asset Input */}
            <div className="p-4 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-2.5">
              <div className="flex items-center justify-between text-xs text-[#A1AFB8]">
                <span>From (Pay)</span>
                <div className="flex items-center gap-2 font-mono tabular-nums">
                  <span className="text-[#71818B]">Avail: {fromBalanceFormatted} {fromAsset}</span>
                  <button
                    type="button"
                    onClick={handleMaxFromAmount}
                    className="text-[11px] font-semibold text-[#8DA5B1] hover:text-[#C1D0D6] cursor-pointer"
                  >
                    MAX
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <input
                  type="number"
                  value={fromAmount}
                  onChange={e => setFromAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-transparent text-2xl font-mono tabular-nums font-semibold text-[#E4EBEF] placeholder-[#53616A] focus:outline-none"
                />

                <div className="flex items-center gap-2 shrink-0">
                  <AssetIcon symbol={fromAsset} size="sm" />
                  <select
                    value={fromAsset}
                    onChange={e => {
                      const next = e.target.value;
                      if (next === toAsset) setToAsset(fromAsset);
                      setFromAsset(next);
                    }}
                    className="bg-[#17212B] border border-[#2B3944] text-xs font-semibold text-[#E4EBEF] rounded-[7px] px-3 py-2 focus:outline-none focus:border-[#8DA5B1]"
                  >
                    {availableCoins.map(coin => (
                      <option key={coin.symbol} value={coin.symbol} className="bg-[#141C24]">
                        {coin.symbol} — {coin.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="text-[11px] text-[#71818B] font-mono tabular-nums">
                ≈ ${(parseFloat(fromAmount || '0') * fromCoin.rateUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD
              </div>
            </div>

            {/* Swap Direction Button */}
            <div className="flex justify-center -my-2 relative z-10">
              <button
                type="button"
                onClick={handleSwapAssets}
                className="w-9 h-9 rounded-[7px] bg-[#17212B] border border-[#2B3944] text-[#8DA5B1] hover:text-[#E4EBEF] hover:border-[#40515D] hover:bg-[#222F3A] flex items-center justify-center transition-colors cursor-pointer"
                title="Reverse direction"
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>
            </div>

            {/* To Asset Output */}
            <div className="p-4 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-2.5">
              <div className="flex items-center justify-between text-xs text-[#A1AFB8]">
                <span>To (Receive)</span>
                <StatusBadge tone="buy">Guaranteed Quote</StatusBadge>
              </div>

              <div className="flex items-center justify-between gap-3">
                <input
                  type="text"
                  readOnly
                  value={calculatedToAmount > 0 ? calculatedToAmount.toFixed(6) : '0.00'}
                  className="w-full bg-transparent text-2xl font-mono tabular-nums font-semibold text-[#16A879] focus:outline-none"
                />

                <div className="flex items-center gap-2 shrink-0">
                  <AssetIcon symbol={toAsset} size="sm" />
                  <select
                    value={toAsset}
                    onChange={e => setToAsset(e.target.value)}
                    className="bg-[#17212B] border border-[#2B3944] text-xs font-semibold text-[#E4EBEF] rounded-[7px] px-3 py-2 focus:outline-none focus:border-[#8DA5B1]"
                  >
                    {availableCoins
                      .filter(c => c.symbol !== fromAsset)
                      .map(coin => (
                        <option key={coin.symbol} value={coin.symbol} className="bg-[#141C24]">
                          {coin.symbol} — {coin.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="text-[11px] text-[#71818B] font-mono tabular-nums">
                ≈ ${(calculatedToAmount * toCoin.rateUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD
              </div>
            </div>

            {/* Rate & Guarantee Strip */}
            <div className="p-3.5 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-2 text-xs">
              <div className="flex items-center justify-between text-[#A1AFB8]">
                <span>Reference Rate</span>
                <div className="flex items-center gap-1.5 font-mono tabular-nums text-[#E4EBEF]">
                  <span>
                    1 {fromAsset} = {conversionRate < 0.01 ? conversionRate.toFixed(8) : conversionRate.toFixed(4)} {toAsset}
                  </span>
                  <span className="text-[10px] text-[#8DA5B1] font-semibold">({quoteSeconds}s)</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-[#A1AFB8]">
                <span>Transaction Fee</span>
                <span className="font-mono text-[#16A879] font-semibold">0.00% FREE</span>
              </div>
              <div className="flex items-center justify-between text-[#A1AFB8]">
                <span>Settlement Speed</span>
                <span className="text-[#E4EBEF] font-medium">Instant to Spot Wallet</span>
              </div>
            </div>

            <Button
              variant="primary"
              size="lg"
              className="w-full"
              icon={<Zap className="w-4 h-4" />}
              onClick={() => {
                if (!user) onOpenAuthModal();
                else setIsPreviewOpen(true);
              }}
            >
              {user ? 'Preview Conversion' : 'Sign In to Convert'}
            </Button>
          </div>

          {/* Right Column: Recent Conversions & Execution Guarantees */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#E4EBEF]">Recent Conversions</h3>
                <span className="text-[11px] font-mono tabular-nums text-[#71818B]">{history.length} records</span>
              </div>

              <div className="space-y-2">
                {history.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 rounded-[7px] bg-[#111820] border border-[#202B34] text-xs font-mono tabular-nums"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#E4EBEF]">
                          {item.fromAmount} {item.fromAsset} → {item.toAmount} {item.toAsset}
                        </span>
                        <StatusBadge tone="success">{item.status}</StatusBadge>
                      </div>
                      <span className="text-[10px] text-[#71818B] mt-0.5 block">
                        Rate: 1 {item.fromAsset} = {item.rate.toFixed(4)} {item.toAsset}
                      </span>
                    </div>
                    <span className="text-[10px] text-[#71818B]">
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 flex items-start gap-3 text-xs text-[#A1AFB8]">
              <ShieldCheck className="w-4 h-4 text-[#8DA5B1] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold text-[#E4EBEF] block">Zero-Slippage RFQ Settlement</span>
                <p className="text-[11px] text-[#71818B] leading-relaxed">
                  Quotes lock for 5 seconds against live DIMONEX reference feeds and settle directly into your spot balance without taker fees.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      <Modal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title="Confirm Conversion"
        subtitle="Reference rate is locked for the next 5 seconds."
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div className="p-4 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-3 font-mono tabular-nums text-xs">
            <div className="flex justify-between">
              <span className="text-[#A1AFB8]">You Pay</span>
              <span className="font-semibold text-[#E4EBEF]">{fromAmount} {fromAsset}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#A1AFB8]">You Receive</span>
              <span className="font-semibold text-[#16A879]">{calculatedToAmount.toFixed(6)} {toAsset}</span>
            </div>
            <div className="flex justify-between border-t border-[#202B34] pt-2">
              <span className="text-[#A1AFB8]">Conversion Rate</span>
              <span className="text-[#E4EBEF]">1 {fromAsset} = {conversionRate.toFixed(4)} {toAsset}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#A1AFB8]">Trading Fee</span>
              <span className="text-[#16A879] font-semibold">$0.00 (0%)</span>
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
              variant="primary"
              size="md"
              className="flex-1"
              isLoading={isConverting}
              onClick={handleConfirmConvert}
            >
              Confirm Swap
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
