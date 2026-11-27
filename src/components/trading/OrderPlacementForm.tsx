/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/trading/OrderPlacementForm.tsx
 * Precision Order Placement Form with Limit, Market, and Stop-Limit order types,
 * zero-float BigInt allocation math, and Obsidian Iridium styling.
 */

import React, { useState, useEffect, useRef } from 'react';
import { TradingPairItem, UserProfile, UserBalance } from '../../types/index.js';
import {
  formatCrypto,
  formatQuotePrice,
  safeBigInt,
  parseDecimalToUnits,
  formatUnitsToDecimal,
} from '../../lib/formatters.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { useToast } from '../ui/Toast.js';

interface Props {
  pair: TradingPairItem;
  user: UserProfile | null;
  balances: UserBalance[];
  selectedPriceUnits: string | null;
  layoutMode?: 'STACKED' | 'HORIZONTAL';
  onOrderPlaced: (order?: any) => void;
  onOpenAuthModal: () => void;
}

function clampDecimalString(decStr: string, maxDecimals: number): string {
  if (!decStr.includes('.')) return decStr;
  const [intPart, fracPart] = decStr.split('.');
  const firstNonZero = fracPart.search(/[1-9]/);
  const keepDec =
    firstNonZero >= maxDecimals
      ? Math.min(fracPart.length, firstNonZero + 4)
      : maxDecimals;
  const sliced = fracPart.slice(0, keepDec).replace(/0+$/, '');
  return sliced ? `${intPart}.${sliced}` : intPart;
}

export const OrderPlacementForm: React.FC<Props> = ({
  pair,
  user,
  balances,
  selectedPriceUnits,
  layoutMode = 'STACKED',
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
  const prevPairIdRef = useRef<string | null>(null);

  const isQuoteIDR = (pair?.quoteCurrency || 'IDR').toUpperCase() === 'IDR';
  const quoteDecimals =
    pair?.quoteDecimals !== undefined && pair?.quoteDecimals !== null
      ? pair.quoteDecimals
      : isQuoteIDR
      ? 2
      : 6;
  const baseDecimals =
    pair?.baseDecimals !== undefined && pair?.baseDecimals !== null
      ? pair.baseDecimals
      : 8;

  useEffect(() => {
    if (prevPairIdRef.current !== pair?.id) {
      prevPairIdRef.current = pair?.id || null;
      setQuantityInput('');
      setStopPriceInput('');
      setAllocationPct(null);
      setErrorMessage(null);

      if (pair?.lastPrice && safeBigInt(pair.lastPrice) > 0n) {
        setPriceInput(formatUnitsToDecimal(pair.lastPrice, quoteDecimals, true));
      } else {
        setPriceInput('');
      }
    }
  }, [pair?.id, pair?.lastPrice, quoteDecimals]);

  useEffect(() => {
    if (!priceInput && !selectedPriceUnits && pair?.lastPrice && safeBigInt(pair.lastPrice) > 0n) {
      setPriceInput(formatUnitsToDecimal(pair.lastPrice, quoteDecimals, true));
    }
  }, [pair?.lastPrice, quoteDecimals]);

  useEffect(() => {
    if (selectedPriceUnits) {
      const units = safeBigInt(selectedPriceUnits);
      if (units > 0n) {
        setPriceInput(formatUnitsToDecimal(units, quoteDecimals, true));
        setAllocationPct(null);
      }
    }
  }, [selectedPriceUnits, quoteDecimals]);

  const quoteBalance = balances.find(b => b.currency === pair?.quoteCurrency);
  const baseBalance = balances.find(b => b.currency === pair?.baseCurrency);

  const availableQuoteBig = quoteBalance ? safeBigInt(quoteBalance.balanceAvailable) : 0n;
  const availableBaseBig = baseBalance ? safeBigInt(baseBalance.balanceAvailable) : 0n;

  const baseScale = 10n ** BigInt(Math.max(0, baseDecimals));
  const takerFeeBps = safeBigInt(pair?.takerFeeBps, 20n);

  const handlePercentageClick = (percent: number) => {
    setAllocationPct(percent);
    if (!user) {
      onOpenAuthModal();
      return;
    }

    if (side === 'BUY') {
      const effectivePriceUnits =
        orderType === 'LIMIT' || orderType === 'STOP_LIMIT'
          ? parseDecimalToUnits(priceInput, quoteDecimals)
          : safeBigInt(pair?.lastPrice);
      if (effectivePriceUnits <= 0n || availableQuoteBig <= 0n) return;

      const budgetQuote = (availableQuoteBig * BigInt(percent)) / 100n;
      const netQuote = (budgetQuote * 10000n) / (10000n + takerFeeBps + 1n);
      const qtyUnits = (netQuote * baseScale) / effectivePriceUnits;
      if (qtyUnits > 0n) {
        const rawDec = formatUnitsToDecimal(qtyUnits, baseDecimals, true);
        setQuantityInput(clampDecimalString(rawDec, Math.min(baseDecimals, 8)));
      }
    } else {
      if (availableBaseBig <= 0n) return;
      const qtyUnits = (availableBaseBig * BigInt(percent)) / 100n;
      if (qtyUnits > 0n) {
        const rawDec = formatUnitsToDecimal(qtyUnits, baseDecimals, true);
        setQuantityInput(clampDecimalString(rawDec, Math.min(baseDecimals, 8)));
      }
    }
  };

  const priceUnits =
    orderType === 'LIMIT' || orderType === 'STOP_LIMIT'
      ? parseDecimalToUnits(priceInput, quoteDecimals)
      : safeBigInt(pair?.lastPrice);

  const stopPriceUnits =
    orderType === 'STOP_LIMIT' ? parseDecimalToUnits(stopPriceInput, quoteDecimals) : 0n;

  const qtyUnits = parseDecimalToUnits(quantityInput, baseDecimals);

  const quoteVolumeUnits =
    baseScale > 0n && qtyUnits > 0n && priceUnits > 0n
      ? (qtyUnits * priceUnits + baseScale / 2n) / baseScale
      : 0n;
  const estimatedFeeUnits =
    takerFeeBps > 0n && quoteVolumeUnits > 0n
      ? (quoteVolumeUnits * takerFeeBps + 5000n) / 10000n
      : 0n;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!user) {
      onOpenAuthModal();
      return;
    }

    if (qtyUnits <= 0n) {
      setErrorMessage('Please enter a valid order quantity.');
      return;
    }

    if ((orderType === 'LIMIT' || orderType === 'STOP_LIMIT') && priceUnits <= 0n) {
      setErrorMessage('Please enter a valid price.');
      return;
    }

    if (orderType === 'STOP_LIMIT' && stopPriceUnits <= 0n) {
      setErrorMessage('Please enter a valid stop trigger price.');
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
      if (orderType === 'STOP_LIMIT' && stopPriceUnits > 0n) {
        payload.stopPrice = stopPriceUnits.toString();
      }

      const res = await fetch('/api/trading/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
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
        `Placed ${side} ${quantityInput} ${pair.baseCurrency}.`
      );
      setQuantityInput('');
      setAllocationPct(null);
      onOrderPlaced(data?.order);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to place order');
      showToast('error', 'Order Failed', err.message || 'Execution error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const pricePlaceholder = isQuoteIDR ? '0' : '0.0000';

  return (
    <div className="flex flex-col bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden p-4 select-none">
      {/* Buy / Sell Segmented Control */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#111820] border border-[#202B34] rounded-[7px] mb-3.5">
        <button
          type="button"
          onClick={() => {
            setSide('BUY');
            setAllocationPct(null);
          }}
          className={`py-2 text-xs font-semibold rounded-[5px] transition-colors flex items-center justify-center cursor-pointer ${
            side === 'BUY'
              ? 'bg-[#16A879] text-[#090D12]'
              : 'text-[#A1AFB8] hover:text-[#E4EBEF]'
          }`}
        >
          Buy {pair.baseCurrency}
        </button>
        <button
          type="button"
          onClick={() => {
            setSide('SELL');
            setAllocationPct(null);
          }}
          className={`py-2 text-xs font-semibold rounded-[5px] transition-colors flex items-center justify-center cursor-pointer ${
            side === 'SELL'
              ? 'bg-[#EA5B65] text-[#090D12]'
              : 'text-[#A1AFB8] hover:text-[#E4EBEF]'
          }`}
        >
          Sell {pair.baseCurrency}
        </button>
      </div>

      {/* Order Type Tabs */}
      <div className="flex items-center gap-4 text-xs font-semibold pb-2.5 mb-3 border-b border-[#202B34]">
        {(['LIMIT', 'MARKET', 'STOP_LIMIT'] as const).map(type => {
          const active = orderType === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => setOrderType(type)}
              className={`pb-1 transition-colors border-b-2 cursor-pointer ${
                active
                  ? 'text-[#E4EBEF] border-[#8DA5B1]'
                  : 'text-[#71818B] border-transparent hover:text-[#A1AFB8]'
              }`}
            >
              {type === 'LIMIT' ? 'Limit' : type === 'MARKET' ? 'Market' : 'Stop-Limit'}
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Available Balance */}
        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[#A1AFB8] px-0.5">
          <span>Available:</span>
          <span className="font-semibold text-[#E4EBEF]">
            {side === 'BUY'
              ? formatQuotePrice(
                  availableQuoteBig.toString(),
                  pair.quoteCurrency,
                  quoteDecimals,
                  true
                )
              : `${formatCrypto(availableBaseBig.toString(), baseDecimals)} ${pair.baseCurrency}`}
          </span>
        </div>

        <div className={layoutMode === 'HORIZONTAL' ? 'grid grid-cols-1 md:grid-cols-2 gap-3 items-start' : 'space-y-3'}>
          <div className="space-y-3">
            {orderType === 'STOP_LIMIT' && (
              <Input
                label="Stop Trigger Price"
                suffixText={pair.quoteCurrency}
                placeholder={pricePlaceholder}
                value={stopPriceInput}
                onChange={e => setStopPriceInput(e.target.value)}
              />
            )}

            {orderType !== 'MARKET' ? (
              <Input
                label="Price"
                suffixText={pair.quoteCurrency}
                placeholder={pricePlaceholder}
                value={priceInput}
                onChange={e => {
                  setPriceInput(e.target.value);
                  setAllocationPct(null);
                }}
              />
            ) : (
              <div className="p-2.5 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#71818B] text-center font-mono">
                Best Market Price Execution
              </div>
            )}

            <Input
              label="Amount"
              suffixText={pair.baseCurrency}
              placeholder="0.00"
              value={quantityInput}
              onChange={e => {
                setQuantityInput(e.target.value);
                setAllocationPct(null);
              }}
            />
          </div>

          <div className="space-y-3">
            {/* Percentage Allocation Controls */}
            <div className="grid grid-cols-4 gap-1.5">
              {[25, 50, 75, 100].map(pct => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => handlePercentageClick(pct)}
                  className={`py-1.5 text-[11px] font-mono font-medium rounded-[5px] border transition-colors cursor-pointer ${
                    allocationPct === pct
                      ? 'bg-[#1D2832] border-[#8DA5B1] text-[#E4EBEF]'
                      : 'bg-[#111820] border-[#202B34] text-[#71818B] hover:text-[#E4EBEF] hover:border-[#2B3944]'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>

            {/* Order Summary */}
            <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1.5 text-xs font-mono tabular-nums">
              <div className="flex justify-between text-[#71818B]">
                <span>Order Value</span>
                <span className="text-[#E4EBEF] font-semibold">
                  {formatQuotePrice(
                    quoteVolumeUnits.toString(),
                    pair.quoteCurrency,
                    quoteDecimals,
                    true
                  )}
                </span>
              </div>
              <div className="flex justify-between text-[#71818B]">
                <span>Est. Fee ({(Number(takerFeeBps) / 100).toFixed(2)}%)</span>
                <span className="text-[#A1AFB8]">
                  {formatQuotePrice(
                    estimatedFeeUnits.toString(),
                    pair.quoteCurrency,
                    quoteDecimals,
                    true
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {errorMessage && (
          <p className="text-[11px] text-[#EA5B65] font-medium">{errorMessage}</p>
        )}

        {pair.isDelisted ? (
          <div className="p-2.5 rounded-[7px] bg-[#401F27]/70 border border-[#EA5B65]/50 text-[#EA5B65] text-xs font-medium">
            Market ini telah di-delisting{pair.delistReason ? `: ${pair.delistReason}` : ''}. Order baru tidak dapat dipasang.
          </div>
        ) : !pair.isActive && pair.scheduledAt && pair.scheduledAt > Date.now() ? (
          <div className="p-2.5 rounded-[7px] bg-[#2C2415]/70 border border-[#D6A85C]/40 text-[#D6A85C] text-xs font-medium">
            Jadwal Initial Listing: <span className="font-mono">{new Date(pair.scheduledAt).toLocaleString('id-ID')}</span>. Order dibuka otomatis setelah countdown selesai.
          </div>
        ) : pair.isHalted ? (
          <div className="p-2.5 rounded-[7px] bg-[#401F27]/60 border border-[#EA5B65]/40 text-[#EA5B65] text-xs font-medium">
            Perdagangan untuk pasar ini sedang dihentikan sementara (HALTED).
          </div>
        ) : !pair.isActive ? (
          <div className="p-2.5 rounded-[7px] bg-[#2C2415]/60 border border-[#D6A85C]/40 text-[#D6A85C] text-xs font-medium">
            Pasar ini belum aktif diperdagangkan (PREPARING).
          </div>
        ) : pair.delistScheduledAt && pair.delistScheduledAt > Date.now() ? (
          <div className="p-2.5 rounded-[7px] bg-[#401F27]/50 border border-[#EA5B65]/40 text-[#F16D76] text-[11px] font-medium">
            Perhatian: Pair ini dijadwalkan delisting pada <span className="font-mono">{new Date(pair.delistScheduledAt).toLocaleString('id-ID')}</span>.
          </div>
        ) : null}

        <Button
          type="submit"
          variant={side === 'BUY' ? 'profit' : 'danger'}
          size="lg"
          className="w-full font-semibold"
          isLoading={isSubmitting}
          disabled={Boolean(pair.isDelisted) || pair.isHalted || !pair.isActive}
        >
          {pair.isDelisted
            ? 'Market Delisted'
            : !pair.isActive && pair.scheduledAt && pair.scheduledAt > Date.now()
            ? 'Menunggu Jadwal Listing'
            : pair.isHalted
            ? 'Trading Halted'
            : !pair.isActive
            ? 'Market Preparing'
            : side === 'BUY'
            ? `Buy ${pair.baseCurrency}`
            : `Sell ${pair.baseCurrency}`}
        </Button>
      </form>
    </div>
  );
};
