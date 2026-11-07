/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/trading/OrderPlacementForm.tsx
 * Professional Order Placement Form with Limit, Market, and Stop-Limit order types,
 * percentage allocation controls, and Black & Crimson-Pink styling.
 */

import React, { useState, useEffect } from 'react';
import { TradingPairItem, UserProfile, UserBalance } from '../../types/index.js';
import { formatIDR, formatCrypto, formatQuotePrice, safeBigInt } from '../../lib/formatters.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { useToast } from '../ui/Toast.js';

interface Props {
  pair: TradingPairItem;
  user: UserProfile | null;
  balances: UserBalance[];
  selectedPriceUnits: string | null;
  onOrderPlaced: () => void;
  onOpenAuthModal: () => void;
}

export const OrderPlacementForm: React.FC<Props> = ({
  pair,
  user,
  balances,
  selectedPriceUnits,
  onOrderPlaced,
  onOpenAuthModal,
}) => {
  const { showToast } = useToast();
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET' | 'STOP_LIMIT'>('LIMIT');
  const [stopPriceInput, setStopPriceInput] = useState<string>('');
  const [priceInput, setPriceInput] = useState<string>('');
  const [quantityInput, setQuantityInput] = useState<string>('');
  const [allocationPct, setAllocationPct] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync selected price from order book click
  useEffect(() => {
    if (selectedPriceUnits) {
      try {
        const rupiah = safeBigInt(selectedPriceUnits) / 100n;
        setPriceInput(rupiah.toString());
      } catch {}
    } else if (!priceInput && pair?.lastPrice) {
      try {
        const rupiah = safeBigInt(pair.lastPrice) / 100n;
        setPriceInput(rupiah.toString());
      } catch {}
    }
  }, [selectedPriceUnits, pair?.id]);

  // Find relevant balances
  const quoteBalance = balances.find(b => b.currency === pair?.quoteCurrency);
  const baseBalance = balances.find(b => b.currency === pair?.baseCurrency);

  const availableQuoteBig = quoteBalance ? safeBigInt(quoteBalance.balanceAvailable) : 0n;
  const availableBaseBig = baseBalance ? safeBigInt(baseBalance.balanceAvailable) : 0n;

  // Handle balance percentage fill
  const handlePercentageClick = (percent: number) => {
    setAllocationPct(percent);
    if (!user) {
      onOpenAuthModal();
      return;
    }

    const pairDec = pair?.baseDecimals ?? 8;
    if (side === 'BUY') {
      const priceRupiah = orderType === 'LIMIT'
        ? (parseFloat(priceInput) || 0)
        : Number(safeBigInt(pair?.lastPrice) / 100n);
      if (priceRupiah <= 0 || !Number.isFinite(priceRupiah)) return;

      const availableRupiah = Number(availableQuoteBig / 100n);
      const budgetRupiah = (availableRupiah * percent) / 100;
      const netBudget = budgetRupiah * 0.998; // fee reserve
      const calculatedQty = netBudget / priceRupiah;
      if (Number.isFinite(calculatedQty) && calculatedQty > 0) {
        setQuantityInput(calculatedQty.toFixed(pairDec === 8 ? 6 : 4));
      }
    } else {
      const baseUnits = (availableBaseBig * safeBigInt(percent)) / 100n;
      const scale = 10 ** pairDec;
      const qtyNum = Number(baseUnits) / scale;
      if (Number.isFinite(qtyNum) && qtyNum > 0) {
        setQuantityInput(qtyNum.toFixed(pairDec === 8 ? 6 : 4));
      }
    }
  };

  // Estimate total quote amount & fee safely
  const parsedPrice = parseFloat(priceInput);
  const priceUnits = orderType === 'LIMIT' || orderType === 'STOP_LIMIT'
    ? (Number.isFinite(parsedPrice) && parsedPrice > 0 ? safeBigInt(Math.floor(parsedPrice * 100)) : 0n)
    : safeBigInt(pair?.lastPrice);

  const baseDecimals = pair?.baseDecimals ?? 8;
  const scale = 10n ** safeBigInt(baseDecimals, 8n);
  const parsedQty = parseFloat(quantityInput);
  const qtyUnits = Number.isFinite(parsedQty) && parsedQty > 0
    ? safeBigInt(Math.floor(parsedQty * Number(scale)))
    : 0n;

  const quoteVolumeUnits = scale > 0n ? (qtyUnits * priceUnits) / scale : 0n;
  const takerFeeBps = safeBigInt(pair?.takerFeeBps, 20n);
  const estimatedFeeUnits = (quoteVolumeUnits * takerFeeBps) / 10000n;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!user) {
      onOpenAuthModal();
      return;
    }

    if (!quantityInput || Number(quantityInput) <= 0) {
      setErrorMessage('Please enter order quantity.');
      return;
    }

    if ((orderType === 'LIMIT' || orderType === 'STOP_LIMIT') && (!priceInput || Number(priceInput) <= 0)) {
      setErrorMessage('Please enter a valid price.');
      return;
    }

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const payload: any = {
        pairId: pair.id,
        side,
        orderType: orderType === 'STOP_LIMIT' ? 'LIMIT' : orderType,
        quantity: qtyUnits.toString(),
      };

      if (orderType === 'LIMIT' || orderType === 'STOP_LIMIT') {
        payload.price = priceUnits.toString();
      }

      const res = await fetch('/api/trading/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        data = await res.json();
      }

      if (!res.ok) {
        throw new Error(data.error || `Error HTTP ${res.status}`);
      }

      showToast(
        'success',
        `${side === 'BUY' ? 'Buy' : 'Sell'} Order Submitted`,
        `Successfully placed ${side} ${quantityInput} ${pair.baseCurrency}.`
      );
      setQuantityInput('');
      setAllocationPct(null);
      onOrderPlaced();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to place order');
      showToast('error', 'Order Failed', err.message || 'Execution error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col obsidian-glass border border-white/10 rounded-xl overflow-hidden p-4 shadow-xl select-none">
      {/* Buy / Sell Segmented Control */}
      <div className="grid grid-cols-2 gap-2 p-1 bg-[#0D1017] border border-white/10 rounded-lg mb-4">
        <button
          type="button"
          onClick={() => { setSide('BUY'); setAllocationPct(null); }}
          className={`py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center ${
            side === 'BUY'
              ? 'bg-[#16C784] text-white shadow-lg shadow-[#16C784]/25'
              : 'text-[#9298A6] hover:text-[#F5F5F7]'
          }`}
        >
          Buy {pair.baseCurrency}
        </button>
        <button
          type="button"
          onClick={() => { setSide('SELL'); setAllocationPct(null); }}
          className={`py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center ${
            side === 'SELL'
              ? 'bg-[#EA3943] text-white shadow-lg shadow-[#EA3943]/25'
              : 'text-[#9298A6] hover:text-[#F5F5F7]'
          }`}
        >
          Sell {pair.baseCurrency}
        </button>
      </div>

      {/* Order Type Tabs */}
      <div className="flex items-center gap-4 text-xs font-semibold pb-3 mb-3 border-b border-white/10">
        <button
          type="button"
          onClick={() => setOrderType('LIMIT')}
          className={`pb-1 transition-colors ${
            orderType === 'LIMIT'
              ? 'text-[#F5F5F7] border-b-2 border-[#FF087F] font-bold'
              : 'text-[#686D7A] hover:text-[#9298A6]'
          }`}
        >
          Limit
        </button>
        <button
          type="button"
          onClick={() => setOrderType('MARKET')}
          className={`pb-1 transition-colors ${
            orderType === 'MARKET'
              ? 'text-[#F5F5F7] border-b-2 border-[#FF087F] font-bold'
              : 'text-[#686D7A] hover:text-[#9298A6]'
          }`}
        >
          Market
        </button>
        <button
          type="button"
          onClick={() => setOrderType('STOP_LIMIT')}
          className={`pb-1 transition-colors ${
            orderType === 'STOP_LIMIT'
              ? 'text-[#F5F5F7] border-b-2 border-[#FF087F] font-bold'
              : 'text-[#686D7A] hover:text-[#9298A6]'
          }`}
        >
          Stop-Limit
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        {/* Available Balances */}
        <div className="flex items-center justify-between text-[11px] font-mono text-[#969BA8] px-0.5">
          <span>Available:</span>
          <span className="font-bold text-[#F5F5F7]">
            {side === 'BUY'
              ? formatQuotePrice(availableQuoteBig.toString(), pair.quoteCurrency, pair.quoteDecimals, true)
              : `${formatCrypto(availableBaseBig.toString(), pair.baseDecimals)} ${pair.baseCurrency}`}
          </span>
        </div>

        {/* Stop Price (for Stop-Limit) */}
        {orderType === 'STOP_LIMIT' && (
          <Input
            label="Stop Trigger Price"
            suffixText={pair.quoteCurrency}
            placeholder="0.00"
            value={stopPriceInput}
            onChange={e => setStopPriceInput(e.target.value)}
          />
        )}

        {/* Limit Price Input */}
        {orderType !== 'MARKET' ? (
          <Input
            label="Price"
            suffixText={pair.quoteCurrency}
            placeholder="0.00"
            value={priceInput}
            onChange={e => { setPriceInput(e.target.value); setAllocationPct(null); }}
          />
        ) : (
          <div className="p-2.5 rounded-lg bg-[#0E1016] border border-[#292C38] text-xs text-[#686D7A] text-center font-mono">
            Best Market Price Execution
          </div>
        )}

        {/* Amount Input */}
        <Input
          label="Amount"
          suffixText={pair.baseCurrency}
          placeholder="0.00"
          value={quantityInput}
          onChange={e => { setQuantityInput(e.target.value); setAllocationPct(null); }}
        />

        {/* Percentage Allocation Pills */}
        <div className="grid grid-cols-4 gap-1.5">
          {[25, 50, 75, 100].map(pct => (
            <button
              key={pct}
              type="button"
              onClick={() => handlePercentageClick(pct)}
              className={`py-1 text-[11px] font-mono font-semibold rounded border transition-colors ${
                allocationPct === pct
                  ? 'bg-[#FF087F]/15 border-[#FF087F] text-[#FF087F]'
                  : 'bg-[#0D1017] border-white/10 text-[#9298A6] hover:text-[#F5F5F7]'
              }`}
            >
              {pct}%
            </button>
          ))}
        </div>

        {/* Order Summary */}
        <div className="p-3 rounded-lg bg-[#0D1017] border border-white/10 space-y-1.5 text-xs font-mono">
          <div className="flex justify-between text-[#9298A6]">
            <span>Order Value</span>
            <span className="text-[#F5F5F7] font-semibold">{formatQuotePrice(quoteVolumeUnits.toString(), pair.quoteCurrency, pair.quoteDecimals, true)}</span>
          </div>
          <div className="flex justify-between text-[#9298A6]">
            <span>Est. Fee (0.08%)</span>
            <span className="text-[#9298A6]">{formatQuotePrice(estimatedFeeUnits.toString(), pair.quoteCurrency, pair.quoteDecimals, true)}</span>
          </div>
        </div>

        {errorMessage && (
          <p className="text-[11px] text-[#EA3943] font-medium">{errorMessage}</p>
        )}

        {/* Market Halted or Inactive Notice */}
        {pair.isHalted && (
          <div className="p-2.5 rounded-lg bg-[#EB3458]/10 border border-[#EB3458]/30 text-[#EB3458] text-xs font-medium">
            Perdagangan untuk pasar ini sedang dihentikan sementara (HALTED).
          </div>
        )}
        {!pair.isActive && (
          <div className="p-2.5 rounded-lg bg-[#F5B942]/10 border border-[#F5B942]/30 text-[#F5B942] text-xs font-medium">
            Pasar ini belum aktif diperdagangkan (PREPARING).
          </div>
        )}

        {/* Submit Button */}
        <Button
          type="submit"
          variant={side === 'BUY' ? 'profit' : 'danger'}
          size="lg"
          className="w-full font-bold"
          isLoading={isSubmitting}
          disabled={pair.isHalted || !pair.isActive}
        >
          {pair.isHalted 
            ? 'Trading Halted' 
            : !pair.isActive 
            ? 'Market Preparing' 
            : (side === 'BUY' ? `Buy ${pair.baseCurrency}` : `Sell ${pair.baseCurrency}`)}
        </Button>
      </form>
    </div>
  );
};
