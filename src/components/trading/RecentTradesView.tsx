/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/trading/RecentTradesView.tsx
 * Real-time feed of completed market trade executions with tabular numerals.
 */

import React from 'react';
import { TradingPairItem, TradeItem } from '../../types/index.js';
import { formatCrypto, formatTimestamp, formatQuotePrice } from '../../lib/formatters.js';

interface Props {
  pair: TradingPairItem;
  trades: TradeItem[];
  currentUserId?: string;
}

export const RecentTradesView: React.FC<Props> = ({ pair, trades, currentUserId }) => {
  return (
    <div className="flex flex-col bg-[#141C24] border border-[#202B34] rounded-[8px] overflow-hidden h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#202B34] bg-[#111820]">
        <h3 className="text-xs font-semibold text-[#E4EBEF]">Recent Market Trades</h3>
        <span className="text-[10px] text-[#16A879] font-mono flex items-center gap-1.5 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-[#16A879] animate-pulse" /> Live
        </span>
      </div>

      <div className="grid grid-cols-3 px-3 py-1.5 text-[11px] text-[#71818B] font-medium border-b border-[#202B34] bg-[#111820]/60">
        <span className="text-left">Price ({pair.quoteCurrency})</span>
        <span className="text-right">Amount ({pair.baseCurrency})</span>
        <span className="text-right">Time</span>
      </div>

      <div className="flex-1 overflow-y-auto max-h-[460px] py-1 divide-y divide-[#202B34]/60">
        {trades.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-xs text-[#71818B] font-mono">
            No recent trades on this pair
          </div>
        ) : (
          trades.slice(0, 40).map((trade, idx) => {
            const isBuy = trade.takerSide === 'BUY';
            const isMyTrade =
              currentUserId &&
              (trade.makerUserId === currentUserId || trade.takerUserId === currentUserId);

            return (
              <div
                key={`trade-${trade.id || idx}`}
                className={`grid grid-cols-3 px-3 py-1 text-xs font-mono tabular-nums text-right hover:bg-[#17212B] transition-colors ${
                  isMyTrade ? 'bg-[#1D2832] border-l-2 border-[#8DA5B1]' : ''
                }`}
              >
                <div className="flex items-center gap-1.5 text-left">
                  <span className={`font-semibold ${isBuy ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                    {formatQuotePrice(trade.price, pair.quoteCurrency, pair.quoteDecimals, false)}
                  </span>
                  {isMyTrade && (
                    <span className="px-1 bg-[#8DA5B1] text-[#090D12] text-[9px] font-sans font-bold rounded-[3px]">
                      You
                    </span>
                  )}
                </div>
                <span className="text-[#E4EBEF]">
                  {formatCrypto(trade.quantity, pair.baseDecimals)}
                </span>
                <span className="text-[#71818B] text-[11px]">
                  {formatTimestamp(trade.createdAt)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
