/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/trading/RecentTradesView.tsx
 * Real-time feed of completed market trade executions with tabular numerals.
 */

import React from 'react';
import { TradingPairItem, TradeItem } from '../../types/index.js';
import { formatIDR, formatCrypto, formatTimestamp, formatQuotePrice } from '../../lib/formatters.js';

interface Props {
  pair: TradingPairItem;
  trades: TradeItem[];
  currentUserId?: string;
}

export const RecentTradesView: React.FC<Props> = ({ pair, trades, currentUserId }) => {
  return (
    <div className="flex flex-col bg-[#15171F] border border-[#292C38] rounded-xl overflow-hidden h-full shadow-xl">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#292C38] bg-[#0E1016]">
        <h3 className="text-xs font-bold text-[#F5F5F7]">Recent Market Trades</h3>
        <span className="text-[10px] text-[#00C087] font-mono flex items-center gap-1 font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00C087] animate-pulse" /> Live
        </span>
      </div>

      <div className="grid grid-cols-3 px-3.5 py-1.5 text-[11px] text-[#686D7A] font-medium border-b border-[#292C38]/60 bg-[#0E1016]/50">
        <span className="text-left">Price ({pair.quoteCurrency})</span>
        <span className="text-right">Amount ({pair.baseCurrency})</span>
        <span className="text-right">Time</span>
      </div>

      <div className="flex-1 overflow-y-auto py-1 divide-y divide-[#292C38]/20">
        {trades.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-[#686D7A]">
            No recent trades on this pair
          </div>
        ) : (
          trades.slice(0, 40).map((trade, idx) => {
            const isBuy = trade.takerSide === 'BUY';
            const isMyTrade = currentUserId && (trade.makerUserId === currentUserId || trade.takerUserId === currentUserId);

            return (
              <div
                key={`trade-${trade.id || idx}`}
                className={`grid grid-cols-3 px-3.5 py-1 text-xs font-mono tabular-nums text-right hover:bg-[#1C1F29]/60 transition-colors ${
                  isMyTrade ? 'bg-[#EB3458]/10' : ''
                }`}
              >
                <div className="flex items-center gap-1.5 text-left">
                  <span className={`font-semibold ${isBuy ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                    {formatQuotePrice(trade.price, pair.quoteCurrency, pair.quoteDecimals, false)}
                  </span>
                  {isMyTrade && (
                    <span className="px-1 py-0.2 bg-[#EB3458] text-white text-[9px] font-sans font-bold rounded">
                      You
                    </span>
                  )}
                </div>
                <span className="text-[#F5F5F7]">
                  {formatCrypto(trade.quantity, pair.baseDecimals)}
                </span>
                <span className="text-[#686D7A] text-[11px]">
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
