/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/orders/OrdersView.tsx
 * Full-page Orders & History management with search, filters, pagination, and real Blob CSV export.
 */

import React, { useState, useMemo } from 'react';
import { Download } from 'lucide-react';
import { OrderItem, TradeItem, TradingPairItem } from '../../types/index.js';
import { formatCrypto, formatQuotePrice } from '../../lib/formatters.js';
import { useToast } from '../ui/Toast.js';
import { PageHeader } from '../ui/PanelHeader.js';
import { SegmentedTabs } from '../ui/Tabs.js';
import { SearchInput, Pagination } from '../ui/Controls.js';
import { StatusBadge, BadgeTone } from '../ui/StatusBadge.js';
import { Button } from '../ui/Button.js';
import { EmptyState } from '../ui/StateViews.js';

interface OrdersViewProps {
  openOrders: OrderItem[];
  orderHistory: OrderItem[];
  recentTrades: TradeItem[];
  pairs?: TradingPairItem[];
  onCancelOrder: (orderId: string, pairId?: string) => void;
}

export const OrdersView: React.FC<OrdersViewProps> = ({
  openOrders,
  orderHistory,
  recentTrades,
  pairs = [],
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
    try {
      const headers = ['Timestamp', 'ID', 'Pair', 'Type', 'Side', 'PriceUnits', 'QuantityUnits', 'FilledUnits', 'Status'];
      const lines = currentList.map(item => [
        item.createdAt ? new Date(item.createdAt).toISOString() : '',
        item.id || '',
        item.pairId || '',
        item.orderType || 'LIMIT',
        item.side || '',
        item.price || '0',
        item.quantity || '0',
        item.filledQuantity || '0',
        item.status || (activeTab === 'TRADES' ? 'SETTLED' : 'OPEN'),
      ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','));

      const csvContent = [headers.join(','), ...lines].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `dimonex-${activeTab.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast('success', 'CSV Statement Exported', `Downloaded ${currentList.length} records.`);
    } catch {
      showToast('error', 'Export Failed', 'Unable to generate CSV file.');
    }
  };

  const getStatusTone = (status?: string): BadgeTone => {
    if (status === 'FILLED' || status === 'SETTLED') return 'buy';
    if (status === 'CANCELLED' || status === 'REJECTED') return 'neutral';
    if (status === 'PARTIAL') return 'warning';
    return 'info';
  };

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto space-y-5">
      <PageHeader
        title="Orders & Trade History"
        subtitle="Review active limit orders, historical trade executions, and double-entry settlements."
        actions={
          <Button variant="secondary" size="sm" onClick={handleExportCSV}>
            <Download className="w-3.5 h-3.5 text-[#8DA5B1]" />
            Export Statement (.CSV)
          </Button>
        }
      />

      {/* Tabs & Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <SegmentedTabs
          tabs={[
            { id: 'OPEN', label: 'Open Orders', badge: openOrders.length },
            { id: 'HISTORY', label: 'Order History', badge: orderHistory.length },
            { id: 'TRADES', label: 'Execution Logs', badge: recentTrades.length },
          ]}
          activeTab={activeTab}
          onChange={id => {
            setActiveTab(id);
            setPage(1);
          }}
        />

        <div className="flex items-center gap-2">
          <div className="flex items-center p-0.5 bg-[#111820] border border-[#202B34] rounded-[7px] text-xs">
            {(['ALL', 'BUY', 'SELL'] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSideFilter(s);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded-[5px] text-[11px] font-medium transition-colors cursor-pointer ${
                  sideFilter === s ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold' : 'text-[#71818B] hover:text-[#E4EBEF]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <SearchInput
            placeholder="Filter pair..."
            value={search}
            onChange={val => {
              setSearch(val);
              setPage(1);
            }}
            className="w-48"
          />
        </div>
      </div>

      {/* Orders Table */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
        {paginatedList.length === 0 ? (
          <EmptyState
            title={`No records in ${activeTab.toLowerCase()} view`}
            description="Adjust pair or side filters, or submit an order from the Spot Trade terminal."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead className="bg-[#111820] text-[#71818B] text-[11px] uppercase tracking-wider border-b border-[#202B34]">
                <tr>
                  <th className="py-3 px-4 font-sans font-medium">Date / Time</th>
                  <th className="py-3 px-4 font-sans font-medium">Pair</th>
                  <th className="py-3 px-4 font-sans font-medium">Type</th>
                  <th className="py-3 px-4 font-sans font-medium">Side</th>
                  <th className="py-3 px-4 text-right font-sans font-medium">Price</th>
                  <th className="py-3 px-4 text-right font-sans font-medium">Amount</th>
                  <th className="py-3 px-4 text-right font-sans font-medium">Filled</th>
                  <th className="py-3 px-4 text-center font-sans font-medium">Status</th>
                  {activeTab === 'OPEN' && <th className="py-3 px-4 text-right font-sans font-medium">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34]">
                {paginatedList.map(item => {
                  const isBuy = item.side === 'BUY';
                  const dateStr = item.createdAt
                    ? new Date(item.createdAt).toLocaleString('id-ID', {
                        month: 'short',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    : 'Just now';

                  const matchedPair = pairs.find(p => p.id === item.pairId);
                  const qCurr = matchedPair?.quoteCurrency || (item.pairId || '').split('-')[1] || 'IDR';
                  const qDec = matchedPair?.quoteDecimals ?? (qCurr === 'USDT' ? 6 : 2);
                  const bDec = matchedPair?.baseDecimals ?? 8;
                  const statusLabel = item.status || (activeTab === 'TRADES' ? 'SETTLED' : 'OPEN');

                  return (
                    <tr key={item.id} className="hover:bg-[#17212B] transition-colors">
                      <td className="py-3 px-4 text-[#A1AFB8] font-sans text-[11px]">{dateStr}</td>
                      <td className="py-3 px-4 font-semibold text-[#E4EBEF]">{item.pairId || 'BTC-IDR'}</td>
                      <td className="py-3 px-4 text-[#A1AFB8] font-sans">{item.orderType || 'LIMIT'}</td>
                      <td className="py-3 px-4 font-sans font-semibold">
                        <span className={isBuy ? 'text-[#16A879]' : 'text-[#EA5B65]'}>{item.side}</span>
                      </td>
                      <td className="py-3 px-4 text-right text-[#E4EBEF] font-semibold">
                        {formatQuotePrice(item.price, qCurr, qDec, true)}
                      </td>
                      <td className="py-3 px-4 text-right text-[#E4EBEF]">
                        {formatCrypto(item.quantity, bDec)}
                      </td>
                      <td className="py-3 px-4 text-right text-[#A1AFB8]">
                        {item.filledQuantity ? formatCrypto(item.filledQuantity, bDec) : '0.00'}
                      </td>
                      <td className="py-3 px-4 text-center font-sans">
                        <StatusBadge tone={getStatusTone(statusLabel)}>{statusLabel}</StatusBadge>
                      </td>
                      {activeTab === 'OPEN' && (
                        <td className="py-3 px-4 text-right font-sans">
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => onCancelOrder(item.id, item.pairId)}
                          >
                            Cancel
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
};
