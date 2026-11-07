/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/trading/FuturesTerminal.tsx
 * Professional Perpetual Futures Trading Terminal with leverage slider, margin modes, and live position risk tracking.
 */

import React, { useState } from 'react';
import { Zap, ShieldAlert, ArrowUpRight, ArrowDownRight, RefreshCw, X, SlidersHorizontal } from 'lucide-react';
import { TradingPairItem, UserProfile } from '../../types/index.js';
import { formatIDR, formatCrypto, formatQuotePrice } from '../../lib/formatters.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { useToast } from '../ui/Toast.js';

interface FuturesTerminalProps {
  pair: TradingPairItem;
  pairs: TradingPairItem[];
  onSelectPair: (pairId: string) => void;
  user: UserProfile | null;
  displayCurrency: 'USDT' | 'IDR';
}

interface FuturesPosition {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: string;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  liqPrice: number;
  margin: number;
  pnl: number;
  pnlPercent: number;
}

export const FuturesTerminal: React.FC<FuturesTerminalProps> = ({
  pair,
  pairs,
  onSelectPair,
  user,
  displayCurrency,
}) => {
  const { showToast } = useToast();
  const [leverage, setLeverage] = useState<number>(20);
  const [marginMode, setMarginMode] = useState<'CROSS' | 'ISOLATED'>('CROSS');
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('LIMIT');
  const [limitPrice, setLimitPrice] = useState<string>(() => String(parseInt(pair.lastPrice, 10)));
  const [amount, setAmount] = useState<string>('0.05');
  const [allocationPct, setAllocationPct] = useState<number>(25);

  // Simulated live futures positions
  const [positions, setPositions] = useState<FuturesPosition[]>([
    {
      id: 'pos-1',
      symbol: 'BTC/USDT Perp',
      side: 'LONG',
      size: '0.25 BTC',
      leverage: 20,
      entryPrice: 91400,
      markPrice: 92150,
      liqPrice: 87200,
      margin: 1142.50,
      pnl: 187.50,
      pnlPercent: 16.41,
    },
    {
      id: 'pos-2',
      symbol: 'ETH/USDT Perp',
      side: 'SHORT',
      size: '3.50 ETH',
      leverage: 10,
      entryPrice: 2840,
      markPrice: 2795,
      liqPrice: 3105,
      margin: 978.25,
      pnl: 157.50,
      pnlPercent: 16.10,
    }
  ]);

  const lastPriceNum = parseFloat(pair.lastPrice) || 1400000000;
  const nominalVal = (parseFloat(amount) || 0) * (orderType === 'LIMIT' ? (parseFloat(limitPrice) || lastPriceNum) : lastPriceNum);
  const requiredMargin = nominalVal / leverage;

  const handleOpenPosition = () => {
    if (!amount || parseFloat(amount) <= 0) {
      showToast('error', 'Invalid Amount', 'Please specify order contract quantity.');
      return;
    }

    const pairSymbol = pair.symbol || `${pair.baseCurrency}/${pair.quoteCurrency}`;
    const newPos: FuturesPosition = {
      id: `pos-${Date.now()}`,
      symbol: `${pairSymbol} Perp`,
      side,
      size: `${amount} ${pair.baseCurrency}`,
      leverage,
      entryPrice: orderType === 'LIMIT' ? parseFloat(limitPrice) : lastPriceNum,
      markPrice: lastPriceNum,
      liqPrice: side === 'LONG'
        ? lastPriceNum * (1 - (1 / leverage) * 0.9)
        : lastPriceNum * (1 + (1 / leverage) * 0.9),
      margin: requiredMargin,
      pnl: 0,
      pnlPercent: 0,
    };

    setPositions(prev => [newPos, ...prev]);
    showToast(
      'success',
      `${side === 'LONG' ? 'Long' : 'Short'} Position Opened`,
      `Executed ${amount} ${pair.baseCurrency} at ${leverage}x leverage.`
    );
  };

  const handleClosePosition = (id: string) => {
    setPositions(prev => prev.filter(p => p.id !== id));
    showToast('info', 'Position Closed', 'Contract position closed at market price.');
  };

  const pairSymbol = pair.symbol || `${pair.baseCurrency}/${pair.quoteCurrency}`;

  return (
    <div className="flex-1 flex flex-col bg-[#08090D] overflow-y-auto">
      {/* Top Futures Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 bg-[#0D1017] border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-[#F5F5F7] font-mono">{pairSymbol}</span>
            <span className="text-[10px] uppercase font-bold text-[#FF087F] bg-[#FF087F]/15 px-1.5 py-0.5 rounded border border-[#FF087F]/30">
              USDT-M PERPETUAL
            </span>
          </div>

          <div className="h-4 w-px bg-white/10" />

          <div className="flex items-center gap-1.5 text-xs font-mono">
            <span className="text-[#9298A6]">Mark:</span>
            <span className="font-bold text-[#F5F5F7]">{formatQuotePrice(pair.lastPrice, pair.quoteCurrency, pair.quoteDecimals, true)}</span>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-mono">
            <span className="text-[#9298A6]">Funding / 8h:</span>
            <span className="font-bold text-[#16C784]">+0.0100%</span>
            <span className="text-[10px] text-[#9298A6]">03:42:18</span>
          </div>
        </div>

        {/* Leverage & Margin Mode Toggles */}
        <div className="flex items-center gap-2">
          {/* Margin Mode */}
          <div className="flex items-center p-0.5 bg-[#171923] border border-white/10 rounded-lg text-xs">
            <button
              onClick={() => setMarginMode('CROSS')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                marginMode === 'CROSS' ? 'bg-[#202330] text-[#F5F5F7] font-bold' : 'text-[#9298A6]'
              }`}
            >
              Cross
            </button>
            <button
              onClick={() => setMarginMode('ISOLATED')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                marginMode === 'ISOLATED' ? 'bg-[#202330] text-[#F5F5F7] font-bold' : 'text-[#9298A6]'
              }`}
            >
              Isolated
            </button>
          </div>

          {/* Leverage Pill */}
          <div className="flex items-center gap-1 px-3 py-1 rounded-lg bg-[#171923] border border-white/10 text-xs font-mono">
            <span className="text-[#9298A6]">Lev:</span>
            <span className="font-bold text-[#FF087F]">{leverage}x</span>
          </div>
        </div>
      </div>

      {/* Main Terminal Body */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-3 p-3">
        {/* Left Column: Leverage Controls & Futures Order Form */}
        <div className="lg:col-span-1 rounded-xl obsidian-glass border border-white/10 p-4 flex flex-col justify-between shadow-xl">
          <div className="space-y-4">
            {/* Long / Short Segmented Control */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-[#0D1017] border border-white/10 rounded-lg">
              <button
                onClick={() => setSide('LONG')}
                className={`py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1 ${
                  side === 'LONG'
                    ? 'bg-[#16C784] text-white shadow-lg shadow-[#16C784]/25'
                    : 'text-[#9298A6] hover:text-white'
                }`}
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                Open Long
              </button>
              <button
                onClick={() => setSide('SHORT')}
                className={`py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1 ${
                  side === 'SHORT'
                    ? 'bg-[#EA3943] text-white shadow-lg shadow-[#EA3943]/25'
                    : 'text-[#9298A6] hover:text-white'
                }`}
              >
                <ArrowDownRight className="w-3.5 h-3.5" />
                Open Short
              </button>
            </div>

            {/* Order Type */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setOrderType('LIMIT')}
                className={`text-xs pb-1 font-medium border-b-2 transition-colors ${
                  orderType === 'LIMIT' ? 'border-[#FF087F] text-white font-bold' : 'border-transparent text-[#686D7A]'
                }`}
              >
                Limit
              </button>
              <button
                onClick={() => setOrderType('MARKET')}
                className={`text-xs pb-1 font-medium border-b-2 transition-colors ${
                  orderType === 'MARKET' ? 'border-[#FF087F] text-white font-bold' : 'border-transparent text-[#686D7A]'
                }`}
              >
                Market
              </button>
            </div>

            {/* Leverage Slider — Up to 125x */}
            <div>
              <div className="flex justify-between items-center text-xs mb-1">
                <span className="text-[#9298A6]">Leverage Multiplier</span>
                <span className="font-mono font-bold text-[#FF087F]">{leverage}x</span>
              </div>
              <input
                type="range"
                min="1"
                max="125"
                value={leverage}
                onChange={e => setLeverage(parseInt(e.target.value, 10))}
                className="w-full accent-[#FF087F] bg-[#0D1017] h-1.5 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-[#9298A6] font-mono mt-1">
                <span>1x</span>
                <span>25x</span>
                <span>50x</span>
                <span>75x</span>
                <span>100x</span>
                <span>125x</span>
              </div>
            </div>

            {/* Limit Price */}
            {orderType === 'LIMIT' && (
              <Input
                label="Order Price"
                suffixText="IDR"
                value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
              />
            )}

            {/* Contract Quantity */}
            <Input
              label="Contract Amount"
              suffixText={pair.baseCurrency}
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />

            {/* Percentage allocation */}
            <div className="grid grid-cols-4 gap-1.5">
              {[25, 50, 75, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => setAllocationPct(pct)}
                  className={`py-1 text-[11px] font-mono rounded border transition-colors ${
                    allocationPct === pct
                      ? 'bg-[#FF087F]/15 border-[#FF087F] text-[#FF087F] font-bold'
                      : 'bg-[#0D1017] border-white/10 text-[#9298A6] hover:text-white'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>

            {/* Order Preview Calculations */}
            <div className="p-3 rounded-lg bg-[#0D1017] border border-white/10 space-y-1.5 text-xs font-mono">
              <div className="flex justify-between text-[#9298A6]">
                <span>Position Value</span>
                <span className="text-[#F5F5F7] font-semibold">{formatQuotePrice(String(Math.round(nominalVal)), pair.quoteCurrency, pair.quoteDecimals, true)}</span>
              </div>
              <div className="flex justify-between text-[#9298A6]">
                <span>Initial Margin</span>
                <span className="text-[#F5F5F7] font-semibold">{formatQuotePrice(String(Math.round(requiredMargin)), pair.quoteCurrency, pair.quoteDecimals, true)}</span>
              </div>
              <div className="flex justify-between text-[#9298A6]">
                <span>Est. Liq Price</span>
                <span className="text-[#F5B942] font-semibold">
                  {side === 'LONG'
                    ? formatQuotePrice(String(Math.round(lastPriceNum * (1 - (1 / leverage) * 0.9))), pair.quoteCurrency, pair.quoteDecimals, true)
                    : formatQuotePrice(String(Math.round(lastPriceNum * (1 + (1 / leverage) * 0.9))), pair.quoteCurrency, pair.quoteDecimals, true)}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-4">
            <Button
              variant={side === 'LONG' ? 'profit' : 'danger'}
              size="lg"
              className="w-full"
              onClick={handleOpenPosition}
            >
              {side === 'LONG' ? `Open Long ${leverage}x` : `Open Short ${leverage}x`}
            </Button>
          </div>
        </div>

        {/* Right 3 Columns: Active Positions Table & Futures Market Info */}
        <div className="lg:col-span-3 rounded-xl obsidian-glass border border-white/10 p-4 flex flex-col shadow-xl">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-display font-bold text-[#F5F5F7]">
                Positions ({positions.length})
              </h2>
              <span className="text-xs text-[#9298A6]">
                Margin Ratio: <strong className="text-[#16C784]">14.2% (Safe)</strong>
              </span>
            </div>
            <span className="text-xs text-[#9298A6] font-mono">
              Unrealized PnL: <strong className="text-[#16C784]">+$345.00</strong>
            </span>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs">
              <thead className="text-[#9298A6] text-[11px] border-b border-white/10 pb-2">
                <tr>
                  <th className="py-2 px-3">Contract</th>
                  <th className="py-2 px-3">Size</th>
                  <th className="py-2 px-3 text-right">Entry Price</th>
                  <th className="py-2 px-3 text-right">Mark Price</th>
                  <th className="py-2 px-3 text-right">Liq Price</th>
                  <th className="py-2 px-3 text-right">Margin</th>
                  <th className="py-2 px-3 text-right">PnL (ROE %)</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292C38]/40">
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-xs text-[#686D7A]">
                      No open positions. Use the order form to enter long or short contracts.
                    </td>
                  </tr>
                ) : (
                  positions.map(pos => {
                    const isLong = pos.side === 'LONG';
                    const isProfit = pos.pnl >= 0;

                    return (
                      <tr key={pos.id} className="hover:bg-[#1C1F29]/60 font-mono">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5 font-sans">
                            <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${
                              isLong ? 'bg-[#00C087]/20 text-[#00C087]' : 'bg-[#EB3458]/20 text-[#EB3458]'
                            }`}>
                              {pos.side} {pos.leverage}x
                            </span>
                            <span className="font-bold text-[#F5F5F7]">{pos.symbol}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-[#F5F5F7] font-semibold">{pos.size}</td>
                        <td className="py-3 px-3 text-right text-[#969BA8]">${pos.entryPrice.toLocaleString()}</td>
                        <td className="py-3 px-3 text-right text-[#F5F5F7] font-bold">${pos.markPrice.toLocaleString()}</td>
                        <td className="py-3 px-3 text-right text-[#F5B942]">${pos.liqPrice.toLocaleString()}</td>
                        <td className="py-3 px-3 text-right text-[#969BA8]">${pos.margin.toFixed(2)}</td>
                        <td className="py-3 px-3 text-right font-bold">
                          <span className={isProfit ? 'text-[#00C087]' : 'text-[#EB3458]'}>
                            {isProfit ? '+' : ''}${pos.pnl.toFixed(2)} ({isProfit ? '+' : ''}{pos.pnlPercent.toFixed(2)}%)
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => handleClosePosition(pos.id)}
                            className="px-2.5 py-1 text-[11px] rounded bg-[#1C1F29] hover:bg-[#EB3458] text-[#969BA8] hover:text-white border border-[#292C38] transition-colors"
                          >
                            Close
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
