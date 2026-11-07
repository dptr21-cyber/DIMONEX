/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/orders/OrdersView.tsx
 * Full-page Orders & History management with search, filters, pagination, and cancel actions.
 */

import React, { useState, useMemo } from 'react';
import { Search, Filter, Download, X, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { OrderItem, TradeItem } from '../../types/index.js';
import { formatIDR, formatCrypto, formatQuotePrice } from '../../lib/formatters.js';
import { useToast } from '../ui/Toast.js';

interface OrdersViewProps {
  openOrders: OrderItem[];
  orderHistory: OrderItem[];
  recentTrades: TradeItem[];
  onCancelOrder: (orderId: string, pairId?: string) => void;
}

export const OrdersView: React.FC<OrdersViewProps> = ({
  openOrders,
  orderHistory,
  recentTrades,
  onCancelOrder,
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'OPEN' | 'HISTORY' | 'TRADES'>('OPEN');
  const [search, setSearch] = useState('');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const currentList = useMemo(() => {
    let list: any[] = [];
    if (activeTab === 'OPEN') list = openOrders;
    else if (activeTab === 'HISTORY') list = orderHistory;
    else list = recentTrades;

    return list.filter(item => {
      const pairMatch = item.pairId ? item.pairId.toLowerCase().includes(search.toLowerCase()) : true;
      const sideMatch = sideFilter === 'ALL' || item.side === sideFilter;
      return pairMatch && sideMatch;
    });
  }, [activeTab, openOrders, orderHistory, recentTrades, search, sideFilter]);

  const totalPages = Math.max(1, Math.ceil(currentList.length / pageSize));
  const paginatedList = currentList.slice((page - 1) * pageSize, page * pageSize);

  const handleExportCSV = () => {
    showToast('info', 'Export Started', 'Generating CSV ledger statements...');
  };

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#08090D] overflow-y-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-[#F5F5F7]">
            Orders & Trade History
          </h1>
          <p className="text-xs text-[#969BA8] mt-1">
            Review active limit orders, historical trade executions, and double-entry settlements.
          </p>
        </div>

        <button
          onClick={handleExportCSV}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#15171F] border border-[#292C38] text-[#F5F5F7] hover:border-[#EB3458]/50 transition-colors w-fit"
        >
          <Download className="w-3.5 h-3.5 text-[#EB3458]" />
          Export Statement (.CSV)
        </button>
      </div>

      {/* Tabs & Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 pb-3 border-b border-[#292C38]">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { setActiveTab('OPEN'); setPage(1); }}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              activeTab === 'OPEN'
                ? 'bg-[#1C1F29] text-[#F5F5F7] font-semibold border border-[#292C38]'
                : 'text-[#969BA8] hover:text-[#F5F5F7]'
            }`}
          >
            Open Orders ({openOrders.length})
          </button>
          <button
            onClick={() => { setActiveTab('HISTORY'); setPage(1); }}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              activeTab === 'HISTORY'
                ? 'bg-[#1C1F29] text-[#F5F5F7] font-semibold border border-[#292C38]'
                : 'text-[#969BA8] hover:text-[#F5F5F7]'
            }`}
          >
            Order History ({orderHistory.length})
          </button>
          <button
            onClick={() => { setActiveTab('TRADES'); setPage(1); }}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              activeTab === 'TRADES'
                ? 'bg-[#1C1F29] text-[#F5F5F7] font-semibold border border-[#292C38]'
                : 'text-[#969BA8] hover:text-[#F5F5F7]'
            }`}
          >
            Execution Logs ({recentTrades.length})
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2">
          {/* Side Filter */}
          <div className="flex items-center p-0.5 bg-[#0E1016] border border-[#292C38] rounded-lg text-xs">
            {(['ALL', 'BUY', 'SELL'] as const).map(s => (
              <button
                key={s}
                onClick={() => { setSideFilter(s); setPage(1); }}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                  sideFilter === s ? 'bg-[#1C1F29] text-[#F5F5F7]' : 'text-[#686D7A]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Pair Search */}
          <div className="relative w-44">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#686D7A]" />
            <input
              placeholder="Filter pair..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-8 pr-3 py-1 text-xs bg-[#0E1016] border border-[#292C38] rounded-lg text-[#F5F5F7] placeholder-[#686D7A] outline-none focus:border-[#EB3458]"
            />
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="rounded-xl bg-[#15171F] border border-[#292C38] overflow-hidden shadow-xl mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#0E1016] text-[#686D7A] text-[11px] border-b border-[#292C38]">
              <tr>
                <th className="py-3 px-4 font-sans">Date / Time</th>
                <th className="py-3 px-4 font-sans">Pair</th>
                <th className="py-3 px-4 font-sans">Type</th>
                <th className="py-3 px-4 font-sans">Side</th>
                <th className="py-3 px-4 text-right">Price</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4 text-right">Filled</th>
                <th className="py-3 px-4 text-center font-sans">Status</th>
                {activeTab === 'OPEN' && <th className="py-3 px-4 text-right font-sans">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#292C38]/40">
              {paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs text-[#686D7A] font-sans">
                    No records found in {activeTab.toLowerCase()} view.
                  </td>
                </tr>
              ) : (
                paginatedList.map(item => {
                  const isBuy = item.side === 'BUY';
                  const dateStr = item.createdAt
                    ? new Date(item.createdAt).toLocaleString('id-ID', {
                        month: 'short',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    : 'Just now';

                  const qCurr = (item.pairId || '').split('-')[1] || 'IDR';
                  const qDec = qCurr === 'USDT' ? 6 : 2;

                  return (
                    <tr key={item.id} className="hover:bg-[#1C1F29]/60 transition-colors">
                      <td className="py-3 px-4 text-[#969BA8] font-sans text-[11px]">{dateStr}</td>
                      <td className="py-3 px-4 font-bold text-[#F5F5F7]">{item.pairId || 'BTC-IDR'}</td>
                      <td className="py-3 px-4 text-[#969BA8] font-sans">{item.orderType || 'LIMIT'}</td>
                      <td className="py-3 px-4 font-sans font-bold">
                        <span className={isBuy ? 'text-[#00C087]' : 'text-[#EB3458]'}>
                          {item.side}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-[#F5F5F7] font-bold font-mono">
                        {formatQuotePrice(item.price, qCurr, qDec, true)}
                      </td>
                      <td className="py-3 px-4 text-right text-[#F5F5F7]">
                        {formatCrypto(item.quantity, 8)}
                      </td>
                      <td className="py-3 px-4 text-right text-[#969BA8]">
                        {item.filledQuantity ? formatCrypto(item.filledQuantity, 8) : '0.00'}
                      </td>
                      <td className="py-3 px-4 text-center font-sans">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          item.status === 'FILLED'
                            ? 'bg-[#00C087]/15 text-[#00C087]'
                            : item.status === 'CANCELLED'
                            ? 'bg-[#686D7A]/20 text-[#969BA8]'
                            : 'bg-[#EB3458]/15 text-[#EB3458]'
                        }`}>
                          {item.status || 'NEW'}
                        </span>
                      </td>
                      {activeTab === 'OPEN' && (
                        <td className="py-3 px-4 text-right font-sans">
                          <button
                            onClick={() => onCancelOrder(item.id, item.pairId)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-[#EB3458] hover:bg-[#EB3458]/15 rounded border border-[#EB3458]/30 transition-colors"
                          >
                            Cancel
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-[#969BA8] px-2 font-mono">
          <span>
            Showing {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, currentList.length)} of {currentList.length} items
          </span>
          <div className="flex items-center gap-1.5">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-2.5 py-1 rounded bg-[#15171F] border border-[#292C38] disabled:opacity-40 hover:text-white"
            >
              Prev
            </button>
            <span className="px-2 font-bold text-[#F5F5F7]">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-2.5 py-1 rounded bg-[#15171F] border border-[#292C38] disabled:opacity-40 hover:text-white"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
