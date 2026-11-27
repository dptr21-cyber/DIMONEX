/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/trading/UserOrdersTable.tsx
 * Pro-tier User Orders Table in Obsidian Iridium matte style.
 */

import React, { useState, useMemo } from 'react';
import { OrderItem, TradingPairItem } from '../../types/index.js';
import { formatCrypto, formatDateTime, safeBigInt, formatQuotePrice } from '../../lib/formatters.js';
import { SearchInput } from '../ui/Controls.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { useToast } from '../ui/Toast.js';

interface Props {
  openOrders: OrderItem[];
  orderHistory: OrderItem[];
  pairs?: TradingPairItem[];
  onCancelOrder: (orderId: string, pairId: string) => Promise<void>;
  isLoading: boolean;
  currentUserEmail?: string;
  userRole?: string;
}

export const UserOrdersTable: React.FC<Props> = ({
  openOrders,
  orderHistory,
  pairs = [],
  onCancelOrder,
  isLoading,
  currentUserEmail,
  userRole,
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'OPEN' | 'HISTORY'>('OPEN');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'BOT_ONLY' | 'MANUAL_ONLY'>('ALL');
  const [pairFilter, setPairFilter] = useState<string>('ALL');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [isCancellingAllBots, setIsCancellingAllBots] = useState(false);

  const handleTabChange = (tab: 'OPEN' | 'HISTORY') => {
    setActiveTab(tab);
    setCurrentPage(1);
  };

  const handleCancel = async (orderId: string, pairId: string) => {
    setCancellingId(orderId);
    try {
      await onCancelOrder(orderId, pairId);
    } finally {
      setCancellingId(null);
    }
  };

  const handleCancelAllBots = async () => {
    setIsCancellingAllBots(true);
    try {
      const token = localStorage.getItem('dimonex_auth_token');
      const res = await fetch('/api/bot/cancel-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      if (res.ok) {
        showToast('success', 'Bot Orders Cancelled', 'All active bot orders were cancelled.');
        window.location.reload();
      } else {
        showToast('error', 'Failed', 'Unable to cancel bot orders.');
      }
    } catch (e) {
      showToast('error', 'Connection Error', 'Failed to contact server.');
    } finally {
      setIsCancellingAllBots(false);
    }
  };

  const uniquePairs = useMemo(() => {
    const set = new Set<string>();
    openOrders.forEach(o => set.add(o.pairId));
    orderHistory.forEach(o => set.add(o.pairId));
    return Array.from(set);
  }, [openOrders, orderHistory]);

  const isBotOrder = (clientOrderId?: string) =>
    Boolean(
      clientOrderId &&
        (clientOrderId.startsWith('bot-') ||
          clientOrderId.includes('-ord-') ||
          clientOrderId.includes('-vol-'))
    );

  const botOrdersCount = openOrders.filter(o => isBotOrder(o.clientOrderId)).length;

  const getSourceBadge = (clientOrderId?: string) => {
    if (!isBotOrder(clientOrderId)) {
      return <StatusBadge tone="neutral">MANUAL</StatusBadge>;
    }
    const label = clientOrderId?.includes('-ord-')
      ? 'MM ORDER'
      : clientOrderId?.includes('-vol-')
      ? 'MM VOLUME'
      : clientOrderId?.includes('grid')
      ? 'BOT GRID'
      : clientOrderId?.includes('layer')
      ? 'BOT LAYER'
      : clientOrderId?.includes('smart') || clientOrderId?.includes('slice')
      ? 'SMART TRADE'
      : 'BOT ENGINE';
    return (
      <div className="flex flex-col gap-0.5">
        <StatusBadge tone="info">{label}</StatusBadge>
        <span className="text-[9px] text-[#71818B] font-mono truncate max-w-[120px]">
          {clientOrderId}
        </span>
      </div>
    );
  };

  const baseList = activeTab === 'OPEN' ? openOrders : orderHistory;
  const filteredList = useMemo(() => {
    return baseList.filter(o => {
      const isBot = isBotOrder(o.clientOrderId);
      if (sourceFilter === 'BOT_ONLY' && !isBot) return false;
      if (sourceFilter === 'MANUAL_ONLY' && isBot) return false;
      if (pairFilter !== 'ALL' && o.pairId !== pairFilter) return false;
      if (sideFilter !== 'ALL' && o.side !== sideFilter) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesId = o.id.toLowerCase().includes(query);
        const matchesClient = o.clientOrderId
          ? o.clientOrderId.toLowerCase().includes(query)
          : false;
        const matchesPair = o.pairId.toLowerCase().includes(query);
        if (!matchesId && !matchesClient && !matchesPair) return false;
      }

      return true;
    });
  }, [baseList, sourceFilter, pairFilter, sideFilter, searchQuery]);

  const totalItems = filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedOrders = filteredList.slice(startIndex, endIndex);

  const pageNumbers = useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safeCurrentPage > 3) pages.push('ellipsis');
      const start = Math.max(2, safeCurrentPage - 1);
      const end = Math.min(totalPages - 1, safeCurrentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (safeCurrentPage < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, safeCurrentPage]);

  return (
    <div className="flex flex-col bg-[#141C24] overflow-hidden">
      {/* Top Info Strip */}
      <div className="px-4 py-2 bg-[#111820] border-b border-[#202B34] flex flex-wrap items-center justify-between text-xs text-[#A1AFB8] gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#8DA5B1]" />
          <span className="text-[#C1D0D6] font-semibold">Order Ownership:</span>
          <span>
            Account <strong className="text-[#E4EBEF] font-mono">{currentUserEmail || 'Guest'}</strong>
          </span>
        </div>
        {botOrdersCount > 0 && activeTab === 'OPEN' && (
          <button
            type="button"
            onClick={handleCancelAllBots}
            disabled={isCancellingAllBots}
            className="px-3 py-1 bg-[#401F27] hover:bg-[#EA5B65]/25 border border-[#EA5B65]/40 text-[#EA5B65] text-xs font-semibold rounded-[6px] transition-colors cursor-pointer"
          >
            {isCancellingAllBots ? 'Cancelling...' : `Cancel ${botOrdersCount} Bot Orders`}
          </button>
        )}
      </div>

      {/* Tabs & Controls Header */}
      <div className="p-3 border-b border-[#202B34] bg-[#141C24] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 bg-[#111820] p-1 rounded-[7px] border border-[#202B34]">
            <button
              type="button"
              onClick={() => handleTabChange('OPEN')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-[5px] transition-colors flex items-center gap-2 cursor-pointer ${
                activeTab === 'OPEN'
                  ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944]'
                  : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
              }`}
            >
              <span>Open Orders</span>
              <span className="px-1.5 py-0.2 rounded-[4px] bg-[#141C24] text-[#A1AFB8] font-mono text-[10px]">
                {openOrders.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('HISTORY')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-[5px] transition-colors flex items-center gap-2 cursor-pointer ${
                activeTab === 'HISTORY'
                  ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944]'
                  : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
              }`}
            >
              <span>Order History</span>
              <span className="px-1.5 py-0.2 rounded-[4px] bg-[#141C24] text-[#A1AFB8] font-mono text-[10px]">
                {orderHistory.length}
              </span>
            </button>
          </div>

          <SearchInput
            value={searchQuery}
            onChange={v => {
              setSearchQuery(v);
              setCurrentPage(1);
            }}
            placeholder="Search Order ID / Client ID..."
            className="flex-1 max-w-xs"
          />
        </div>

        {/* Filter Toolbar Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-[#A1AFB8]">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[#71818B]">Source:</span>
              <div className="flex items-center bg-[#111820] p-0.5 rounded-[6px] border border-[#202B34]">
                {(['ALL', 'BOT_ONLY', 'MANUAL_ONLY'] as const).map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setSourceFilter(f);
                      setCurrentPage(1);
                    }}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-[4px] transition-colors cursor-pointer ${
                      sourceFilter === f
                        ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold'
                        : 'text-[#71818B] hover:text-[#E4EBEF]'
                    }`}
                  >
                    {f === 'ALL' ? 'All' : f === 'BOT_ONLY' ? `Bot (${botOrdersCount})` : 'Manual'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[#71818B]">Pair:</span>
              <select
                value={pairFilter}
                onChange={e => {
                  setPairFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="bg-[#111820] border border-[#2B3944] rounded-[6px] px-2 py-0.5 text-[11px] font-mono text-[#E4EBEF] cursor-pointer focus:outline-none focus:border-[#8DA5B1]"
              >
                <option value="ALL">All Pairs</option>
                {uniquePairs.map(p => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[#71818B]">Side:</span>
              <div className="flex items-center bg-[#111820] p-0.5 rounded-[6px] border border-[#202B34]">
                {(['ALL', 'BUY', 'SELL'] as const).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSideFilter(s);
                      setCurrentPage(1);
                    }}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-[4px] transition-colors cursor-pointer ${
                      sideFilter === s
                        ? s === 'BUY'
                          ? 'bg-[#12392F] text-[#16A879] font-semibold'
                          : s === 'SELL'
                          ? 'bg-[#401F27] text-[#EA5B65] font-semibold'
                          : 'bg-[#1D2832] text-[#E4EBEF] font-semibold'
                        : 'text-[#71818B] hover:text-[#E4EBEF]'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {(sourceFilter !== 'ALL' || pairFilter !== 'ALL' || sideFilter !== 'ALL' || searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setSourceFilter('ALL');
                setPairFilter('ALL');
                setSideFilter('ALL');
                setSearchQuery('');
                setCurrentPage(1);
              }}
              className="text-[11px] text-[#8DA5B1] hover:text-[#C1D0D6] underline cursor-pointer"
            >
              Reset Filter
            </button>
          )}
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto min-h-[220px]">
        <table className="w-full text-left text-xs font-mono tabular-nums">
          <thead className="bg-[#111820] text-[11px] text-[#71818B] font-sans uppercase tracking-wider border-b border-[#202B34]">
            <tr>
              <th className="px-4 py-2.5">Time</th>
              <th className="px-4 py-2.5">Account</th>
              <th className="px-4 py-2.5">Source / Strategy</th>
              <th className="px-4 py-2.5">Pair</th>
              <th className="px-4 py-2.5">Side</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5 text-right">Limit Price</th>
              <th className="px-4 py-2.5 text-right">Quantity</th>
              <th className="px-4 py-2.5 text-right">Filled</th>
              <th className="px-4 py-2.5 text-center">Status</th>
              {activeTab === 'OPEN' && <th className="px-4 py-2.5 text-right">Action</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#202B34]">
            {paginatedOrders.length === 0 ? (
              <tr>
                <td
                  colSpan={activeTab === 'OPEN' ? 11 : 10}
                  className="px-4 py-12 text-center text-[#71818B] font-sans"
                >
                  {isLoading ? (
                    <span>Loading orders...</span>
                  ) : (
                    <span>
                      {filteredList.length === 0 && baseList.length > 0
                        ? 'No orders match the current filters.'
                        : activeTab === 'OPEN'
                        ? 'No active open limit orders.'
                        : 'No order history found.'}
                    </span>
                  )}
                </td>
              </tr>
            ) : (
              paginatedOrders.map(order => {
                const isBuy = order.side === 'BUY';
                const matchedPair = pairs.find(p => p.id === order.pairId);
                const baseDecimals =
                  matchedPair?.baseDecimals ??
                  (order.pairId.startsWith('BTC') ||
                  order.pairId.startsWith('ETH') ||
                  order.pairId.startsWith('SOL') ||
                  order.pairId.startsWith('DOGE')
                    ? 8
                    : 6);
                const quoteCurrency =
                  matchedPair?.quoteCurrency || order.pairId.split('-')[1] || 'IDR';
                const quoteDecimals =
                  matchedPair?.quoteDecimals ?? (quoteCurrency === 'USDT' ? 6 : 2);
                let percentFilled = 0;
                try {
                  const qtyBig = safeBigInt(order.quantity);
                  const filledBig = safeBigInt(order.filledQuantity);
                  if (qtyBig > 0n) {
                    percentFilled = Math.min(100, Math.max(0, Number((filledBig * 100n) / qtyBig)));
                  } else {
                    const qNum = parseFloat(order.quantity);
                    const fNum = parseFloat(order.filledQuantity);
                    if (Number.isFinite(qNum) && qNum > 0) {
                      percentFilled = Math.min(100, Math.max(0, Math.round((fNum / qNum) * 100)));
                    }
                  }
                } catch {
                  percentFilled = 0;
                }

                return (
                  <tr key={order.id} className="hover:bg-[#17212B] transition-colors">
                    <td className="px-4 py-2.5 text-[#71818B] text-[11px] whitespace-nowrap">
                      {formatDateTime(order.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 font-sans whitespace-nowrap">
                      <StatusBadge tone={userRole === 'admin' ? 'warning' : 'brand'}>
                        {userRole === 'admin' ? 'ADMIN' : 'TRADER'}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 font-sans">{getSourceBadge(order.clientOrderId)}</td>
                    <td className="px-4 py-2.5 font-semibold text-[#E4EBEF] whitespace-nowrap">
                      {order.pairId}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <StatusBadge tone={isBuy ? 'buy' : 'sell'}>{order.side}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 text-[#A1AFB8] text-[11px] whitespace-nowrap">
                      {order.orderType} · {order.timeInForce}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#E4EBEF] font-semibold whitespace-nowrap">
                      {order.price === '0'
                        ? 'Market'
                        : formatQuotePrice(order.price, quoteCurrency, quoteDecimals, true)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#A1AFB8] whitespace-nowrap">
                      {formatCrypto(order.quantity, baseDecimals)}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[#E4EBEF]">
                          {formatCrypto(order.filledQuantity, baseDecimals)} ({percentFilled}%)
                        </span>
                        <div className="w-20 bg-[#111820] h-1.5 rounded-full overflow-hidden border border-[#202B34]">
                          <div
                            className={`h-full rounded-full ${
                              percentFilled === 100 ? 'bg-[#16A879]' : 'bg-[#8DA5B1]'
                            }`}
                            style={{ width: `${percentFilled}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center whitespace-nowrap">
                      {order.optimistic ? (
                        <div className="inline-flex items-center gap-1.5">
                          <StatusBadge tone="info">
                            <span className="inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#8DA5B1] animate-pulse" />
                              SYNCING
                            </span>
                          </StatusBadge>
                        </div>
                      ) : (
                        <StatusBadge
                          tone={
                            order.status === 'FILLED'
                              ? 'success'
                              : order.status === 'PARTIALLY_FILLED'
                              ? 'info'
                              : order.status === 'CANCELLED'
                              ? 'neutral'
                              : 'warning'
                          }
                        >
                          {order.status}
                        </StatusBadge>
                      )}
                    </td>
                    {activeTab === 'OPEN' && (
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {order.optimistic ? (
                          <span className="px-2.5 py-1 text-[11px] font-sans font-medium text-[#71818B] bg-[#111820] rounded-[6px] border border-[#202B34] inline-block">
                            Syncing...
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={cancellingId === order.id}
                            onClick={() => handleCancel(order.id, order.pairId)}
                            className="px-2.5 py-1 text-[11px] font-sans font-semibold text-[#EA5B65] hover:bg-[#401F27] rounded-[6px] transition-colors border border-[#EA5B65]/40 cursor-pointer"
                          >
                            {cancellingId === order.id ? 'Cancelling...' : 'Cancel'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-4 py-2.5 bg-[#111820] border-t border-[#202B34] flex flex-wrap items-center justify-between gap-3 text-xs text-[#71818B] font-mono tabular-nums">
        <div className="flex items-center gap-3">
          <span>
            {totalItems === 0
              ? 'Showing 0 orders'
              : `Showing ${startIndex + 1}–${endIndex} of ${totalItems}`}
          </span>

          <div className="flex items-center gap-1.5 border-l border-[#202B34] pl-3">
            <span>Rows:</span>
            <select
              value={pageSize}
              onChange={e => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-[#141C24] border border-[#2B3944] rounded-[5px] px-2 py-0.5 text-xs text-[#E4EBEF] cursor-pointer focus:outline-none focus:border-[#8DA5B1]"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage(1)}
              disabled={safeCurrentPage === 1}
              className="px-2 py-1 rounded-[5px] bg-[#141C24] border border-[#2B3944] hover:bg-[#1D2832] text-[#A1AFB8] disabled:opacity-40 cursor-pointer"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={safeCurrentPage === 1}
              className="px-2 py-1 rounded-[5px] bg-[#141C24] border border-[#2B3944] hover:bg-[#1D2832] text-[#A1AFB8] disabled:opacity-40 cursor-pointer"
            >
              ‹
            </button>
            {pageNumbers.map((p, idx) =>
              p === 'ellipsis' ? (
                <span key={`ellipsis-${idx}`} className="px-1 text-[#53616A]">
                  ...
                </span>
              ) : (
                <button
                  key={`page-${p}`}
                  type="button"
                  onClick={() => setCurrentPage(p)}
                  className={`min-w-[26px] h-7 px-2 rounded-[5px] font-semibold transition-colors cursor-pointer ${
                    p === safeCurrentPage
                      ? 'bg-[#8DA5B1] text-[#090D12]'
                      : 'bg-[#141C24] border border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF]'
                  }`}
                >
                  {p}
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={safeCurrentPage === totalPages}
              className="px-2 py-1 rounded-[5px] bg-[#141C24] border border-[#2B3944] hover:bg-[#1D2832] text-[#A1AFB8] disabled:opacity-40 cursor-pointer"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(totalPages)}
              disabled={safeCurrentPage === totalPages}
              className="px-2 py-1 rounded-[5px] bg-[#141C24] border border-[#2B3944] hover:bg-[#1D2832] text-[#A1AFB8] disabled:opacity-40 cursor-pointer"
            >
              »
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
