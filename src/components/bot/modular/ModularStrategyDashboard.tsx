/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/bot/modular/ModularStrategyDashboard.tsx
 * Layer 4 — Web Dashboard & Control Layer for MODULAR_STRATEGY_BOT.
 * Integrates Overview, Modular Strategy Bots, Execution History, Backtesting Lab,
 * Strategy Library, Account Risk Snapshot, and real-time WebSocket updates.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { runSingleFlight } from '../../../lib/safeFetch.js';
import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  History,
  Layers,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  AccountPortfolioRiskSnapshot,
  ModularBotConfigV1,
  ModularBotExecution,
  ModularBotInstance,
  ModularStrategyMetadata,
  TradingPairItem,
  UserProfile,
} from '../../../types/index.js';
import { formatDateTime, formatIDR, formatQuotePrice, formatUnitsToDecimal } from '../../../lib/formatters.js';
import { isWebSocketSupported, reportWebSocketFailure, reportWebSocketSuccess } from '../../../utils/wsHelper.js';
import { Button } from '../../ui/Button.js';
import { StatusBadge } from '../../ui/StatusBadge.js';
import { SegmentedTabs } from '../../ui/Tabs.js';
import { StrategyLibrary } from './StrategyLibrary.js';
import { BacktestingLab } from './BacktestingLab.js';
import { BotCreationWizardModal } from './BotCreationWizardModal.js';
import { LiveBotMonitor } from './LiveBotMonitor.js';

interface Props {
  user: UserProfile | null;
  pairs: TradingPairItem[];
  onOpenAuthModal: () => void;
  onRefreshBalances?: () => void;
  onRefreshOrders?: () => void;
}

type SubView = 'OVERVIEW' | 'BOTS' | 'EXECUTIONS' | 'BACKTEST' | 'LIBRARY';

export const ModularStrategyDashboard: React.FC<Props> = ({
  user,
  pairs,
  onOpenAuthModal,
  onRefreshBalances,
  onRefreshOrders,
}) => {
  const [subView, setSubView] = useState<SubView>('OVERVIEW');
  const [strategies, setStrategies] = useState<ModularStrategyMetadata[]>([]);
  const [bots, setBots] = useState<ModularBotInstance[]>([]);
  const [portfolioRisk, setPortfolioRisk] = useState<AccountPortfolioRiskSnapshot | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Wizard / Backtest handoff state
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardStrategy, setWizardStrategy] = useState<ModularStrategyMetadata | null>(null);
  const [wizardConfig, setWizardConfig] = useState<ModularBotConfigV1 | null>(null);
  const [backtestStrategy, setBacktestStrategy] = useState<ModularStrategyMetadata | null>(null);
  const [backtestConfig, setBacktestConfig] = useState<ModularBotConfigV1 | null>(null);

  const loadStrategies = useCallback(async () => {
    try {
      const res = await fetch('/api/modular-bots/strategies');
      if (res.ok) {
        const data = await res.json();
        setStrategies(data.strategies || []);
      }
    } catch {}
  }, []);

  const wsConnectedRef = useRef(false);
  const lastPollRef = useRef(0);

  const loadBots = useCallback(async () => {
    if (!user) return;
    return runSingleFlight('modular:bots-list', async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/modular-bots', {
          headers: { Authorization: `Bearer ${localStorage.getItem('dimonex_auth_token') || localStorage.getItem('dimonex_token') || ''}` },
        });
        if (res.ok) {
          const data = await res.json();
          const list: ModularBotInstance[] = data.bots || [];
          setBots(list);
          setPortfolioRisk(data.portfolioRisk || null);
          if (list.length > 0 && (!selectedBotId || !list.some(b => b.id === selectedBotId))) {
            setSelectedBotId(list[0].id);
          }
        }
      } catch {
      } finally {
        setIsLoading(false);
      }
    });
  }, [user, selectedBotId]);

  useEffect(() => {
    loadStrategies();
  }, [loadStrategies]);

  useEffect(() => {
    if (!user) {
      setBots([]);
      setPortfolioRisk(null);
      return;
    }
    loadBots();
    const poll = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      const targetMs = wsConnectedRef.current ? 20000 : 6000;
      if (now - lastPollRef.current < targetMs) return;
      lastPollRef.current = now;
      loadBots();
    }, 3000);
    return () => clearInterval(poll);
  }, [user, loadBots]);

  // Real-time WebSocket stream for modular_bots:<userId>
  useEffect(() => {
    if (!user || !isWebSocketSupported()) {
      wsConnectedRef.current = false;
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        reportWebSocketSuccess();
        wsConnectedRef.current = true;
        ws?.send(
          JSON.stringify({
            action: 'subscribe',
            channel: `modular_bots:${user.id}`,
            userId: user.id,
          })
        );
      };
      ws.onmessage = evt => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'modular_bot_snapshot' && Array.isArray(msg.data)) {
            setBots(msg.data);
          } else if (msg.type === 'modular_bot_updated' && msg.data?.id) {
            setBots(prev => {
              const idx = prev.findIndex(b => b.id === msg.data.id);
              if (idx === -1) return [msg.data, ...prev];
              const next = [...prev];
              next[idx] = msg.data;
              return next;
            });
            if (msg.data.config?.bot?.mode === 'LIVE') {
              onRefreshBalances?.();
              onRefreshOrders?.();
            }
          }
        } catch {}
      };
      ws.onclose = () => {
        wsConnectedRef.current = false;
      };
      ws.onerror = () => {
        wsConnectedRef.current = false;
        reportWebSocketFailure();
      };
    } catch {}

    return () => {
      wsConnectedRef.current = false;
      try {
        ws?.close();
      } catch {}
    };
  }, [user?.id]);

  const selectedBot = bots.find(b => b.id === selectedBotId) || bots[0] || null;
  const runningCount = bots.filter(b => b.status === 'RUNNING').length;
  const paperCount = bots.filter(b => b.config.bot.mode === 'PAPER').length;
  const liveCount = bots.filter(b => b.config.bot.mode === 'LIVE').length;
  const totalTrades = bots.reduce((acc, b) => acc + (b.metrics.totalTrades || 0), 0);

  const allExecutions: Array<ModularBotExecution & { botName: string }> = bots
    .flatMap(b => (b.executions || []).map(ex => ({ ...ex, botName: b.config.bot.name })))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 100);

  const openWizardForNew = (strat?: ModularStrategyMetadata | null, cfg?: ModularBotConfigV1 | null) => {
    if (!user) {
      onOpenAuthModal();
      return;
    }
    setWizardStrategy(strat || null);
    setWizardConfig(cfg || null);
    setIsWizardOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Header + Sub-Navigation */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-[#141C24] border border-[#202B34] rounded-[10px] p-4">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-[#8DA5B1]" />
            <h2 className="text-base font-semibold text-[#E4EBEF]">
              MODULAR_STRATEGY_BOT Workspace
            </h2>
            <StatusBadge tone="brand">4-LAYER ENGINE</StatusBadge>
          </div>
          <p className="text-xs text-[#A1AFB8] mt-1">
            Data Connector · StrategyController Plugins · RiskManager (Triple Barrier / Trailing Stop) · MatchingEngine & Isolated Paper Trading
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}
            onClick={loadBots}
          >
            Sync
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => openWizardForNew(null, null)}
          >
            Buat Modular Bot
          </Button>
        </div>
      </div>

      {/* Sub-Navigation */}
      <div className="overflow-x-auto">
        <SegmentedTabs
          activeTab={subView}
          onChange={setSubView}
          tabs={[
            { id: 'OVERVIEW', label: 'Overview', icon: <Activity className="w-3.5 h-3.5" /> },
            { id: 'BOTS', label: 'Modular Strategy Bots', badge: bots.length, icon: <Bot className="w-3.5 h-3.5" /> },
            { id: 'EXECUTIONS', label: 'Execution History', badge: allExecutions.length, icon: <History className="w-3.5 h-3.5" /> },
            { id: 'BACKTEST', label: 'Backtesting Lab', icon: <BarChart3 className="w-3.5 h-3.5" /> },
            { id: 'LIBRARY', label: 'Strategy Library', badge: strategies.length, icon: <BookOpen className="w-3.5 h-3.5" /> },
          ]}
        />
      </div>

      {/* Top KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-3.5">
          <div className="text-[11px] text-[#71818B]">Bot Aktif / Total</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-[#E4EBEF] mt-1">
            {runningCount} / {bots.length}
          </div>
          <div className="text-[11px] font-mono text-[#A1AFB8] mt-0.5">
            Paper {paperCount} · Live {liveCount}
          </div>
        </div>

        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-3.5">
          <div className="text-[11px] text-[#71818B]">Eksposur Live Akun</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-[#E4EBEF] mt-1">
            {portfolioRisk ? formatIDR(portfolioRisk.totalLiveExposureQuoteUnits) : 'Rp 0'}
          </div>
          <div className="text-[11px] font-mono text-[#A1AFB8] mt-0.5">
            {portfolioRisk?.totalLiveOpenOrders || 0} open order live
          </div>
        </div>

        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-3.5">
          <div className="text-[11px] text-[#71818B]">Total Eksekusi Fill</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-[#E4EBEF] mt-1">
            {totalTrades}
          </div>
          <div className="text-[11px] font-mono text-[#A1AFB8] mt-0.5">
            {strategies.length} plugin terdaftar
          </div>
        </div>

        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-3.5">
          <div className="text-[11px] text-[#71818B]">Status Risk Aggregator</div>
          <div className="mt-1.5 flex items-center gap-2">
            <ShieldCheck className={`w-4 h-4 ${portfolioRisk?.isRiskLocked ? 'text-[#EA5B65]' : 'text-[#16A879]'}`} />
            <span className={`text-sm font-semibold font-mono ${portfolioRisk?.isRiskLocked ? 'text-[#EA5B65]' : 'text-[#16A879]'}`}>
              {portfolioRisk?.isRiskLocked ? 'RISK LOCKED' : 'NOMINAL'}
            </span>
          </div>
          <div className="text-[11px] text-[#71818B] mt-0.5 truncate">
            {portfolioRisk?.lockReason || 'Semua limit portofolio aman'}
          </div>
        </div>
      </div>

      {/* VIEW: OVERVIEW */}
      {subView === 'OVERVIEW' && (
        <div className="space-y-4">
          {!user ? (
            <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-8 text-center space-y-3">
              <Bot className="w-8 h-8 text-[#8DA5B1] mx-auto" />
              <div className="text-sm font-semibold text-[#E4EBEF]">Masuk untuk Mengelola Modular Strategy Bot</div>
              <p className="text-xs text-[#A1AFB8] max-w-md mx-auto">
                Jalankan strategi Directional atau Market Making pada Paper Trading atau Live Order Book DIMONEX.
              </p>
              <Button variant="primary" size="sm" onClick={onOpenAuthModal}>
                Masuk / Daftar
              </Button>
            </div>
          ) : bots.length === 0 ? (
            <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-8 text-center space-y-3">
              <Layers className="w-8 h-8 text-[#8DA5B1] mx-auto" />
              <div className="text-sm font-semibold text-[#E4EBEF]">Belum Ada Modular Strategy Bot</div>
              <p className="text-xs text-[#A1AFB8] max-w-lg mx-auto">
                Mulai dengan memilih strategi di Strategy Library, menguji data historis di Backtesting Lab, atau membuat instance baru lewat 8-Step Wizard.
              </p>
              <div className="flex items-center justify-center gap-2 pt-1">
                <Button variant="secondary" size="sm" onClick={() => setSubView('BACKTEST')}>
                  Buka Backtesting Lab
                </Button>
                <Button variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => openWizardForNew(null, null)}>
                  Buat Bot Pertama
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Bot Selector List */}
              <div className="lg:col-span-4 space-y-2">
                {bots.map(b => {
                  const isSel = selectedBot?.id === b.id;
                  const pair = pairs.find(p => p.id === b.pairId);
                  const qCur = pair?.quoteCurrency || 'IDR';
                  const qDec = pair?.quoteDecimals ?? 2;
                  const pnlBig = BigInt(b.metrics.realizedPnlQuoteUnits || '0');
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedBotId(b.id)}
                      className={`w-full text-left p-3.5 rounded-[10px] border transition-colors cursor-pointer ${
                        isSel
                          ? 'bg-[#17212B] border-[#8DA5B1]'
                          : 'bg-[#141C24] border-[#202B34] hover:border-[#2B3944]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#E4EBEF] truncate">{b.config.bot.name}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <StatusBadge tone={b.config.bot.mode === 'LIVE' ? 'sell' : 'info'}>
                            {b.config.bot.mode}
                          </StatusBadge>
                          <StatusBadge
                            tone={b.status === 'RUNNING' ? 'success' : b.status === 'RISK_HALTED' || b.status === 'ERROR' ? 'danger' : 'neutral'}
                          >
                            {b.status}
                          </StatusBadge>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#71818B] mt-2">
                        <span>{b.pairId} · {b.config.bot.strategyId}</span>
                        <span className={`tabular-nums font-semibold ${pnlBig >= 0n ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                          {formatQuotePrice(b.metrics.realizedPnlQuoteUnits, qCur, qDec)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Active Monitor */}
              <div className="lg:col-span-8">
                {selectedBot && (
                  <LiveBotMonitor bot={selectedBot} pairs={pairs} onRefresh={loadBots} />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW: BOTS LIST / MONITOR */}
      {subView === 'BOTS' && (
        <div className="space-y-4">
          {bots.length === 0 ? (
            <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-8 text-center text-xs text-[#A1AFB8]">
              Belum ada instance bot. Klik "Buat Modular Bot" untuk memulai.
            </div>
          ) : (
            bots.map(b => (
              <LiveBotMonitor key={b.id} bot={b} pairs={pairs} onRefresh={loadBots} />
            ))
          )}
        </div>
      )}

      {/* VIEW: GLOBAL EXECUTION HISTORY */}
      {subView === 'EXECUTIONS' && (
        <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4">
          <h3 className="text-sm font-semibold text-[#E4EBEF] mb-3">
            Riwayat Eksekusi Seluruh Modular Strategy Bot
          </h3>
          {allExecutions.length === 0 ? (
            <p className="text-xs text-[#71818B] py-8 text-center">Belum ada eksekusi tercatat.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[#71818B] border-b border-[#202B34]">
                    <th className="py-2 pr-3">Waktu</th>
                    <th className="py-2 pr-3">Bot / Mode</th>
                    <th className="py-2 pr-3">Pair</th>
                    <th className="py-2 pr-3">Sisi / Tipe</th>
                    <th className="py-2 pr-3 text-right">Harga</th>
                    <th className="py-2 pr-3 text-right">Qty</th>
                    <th className="py-2 text-right">Realized PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34] font-mono tabular-nums">
                  {allExecutions.map(ex => {
                    const p = pairs.find(x => x.id === ex.pairId);
                    const bDec = p?.baseDecimals ?? 8;
                    const qDec = p?.quoteDecimals ?? 2;
                    const qCur = p?.quoteCurrency || 'IDR';
                    const pnl = BigInt(ex.realizedPnlQuoteUnits || '0');
                    return (
                      <tr key={ex.executionId} className="hover:bg-[#17212B]">
                        <td className="py-2 pr-3 text-[#71818B]">{formatDateTime(ex.timestamp)}</td>
                        <td className="py-2 pr-3 text-[#E4EBEF]">
                          {ex.botName} ({ex.mode})
                        </td>
                        <td className="py-2 pr-3 text-[#A1AFB8]">{ex.pairId}</td>
                        <td className={`py-2 pr-3 font-semibold ${ex.side === 'BUY' ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                          {ex.side} · {ex.orderType}
                        </td>
                        <td className="py-2 pr-3 text-right text-[#E4EBEF]">
                          {formatQuotePrice(ex.priceUnits, qCur, qDec)}
                        </td>
                        <td className="py-2 pr-3 text-right text-[#E4EBEF]">
                          {formatUnitsToDecimal(ex.quantityUnits, bDec, true)}
                        </td>
                        <td className={`py-2 text-right ${pnl >= 0n ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                          {formatQuotePrice(ex.realizedPnlQuoteUnits, qCur, qDec)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* VIEW: BACKTEST LAB */}
      {subView === 'BACKTEST' && (
        <BacktestingLab
          strategies={strategies}
          pairs={pairs}
          preselectedStrategy={backtestStrategy}
          initialConfig={backtestConfig}
          isAuthenticated={Boolean(user)}
          onOpenAuthModal={onOpenAuthModal}
          onDeployFromBacktest={cfg => openWizardForNew(null, cfg)}
        />
      )}

      {/* VIEW: STRATEGY LIBRARY */}
      {subView === 'LIBRARY' && (
        <StrategyLibrary
          strategies={strategies}
          onSelectStrategy={st => openWizardForNew(st, null)}
          onBacktestStrategy={st => {
            setBacktestStrategy(st);
            setBacktestConfig(null);
            setSubView('BACKTEST');
          }}
        />
      )}

      {/* 8-STEP WIZARD MODAL */}
      <BotCreationWizardModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        strategies={strategies}
        pairs={pairs}
        preselectedStrategy={wizardStrategy}
        initialConfig={wizardConfig}
        onCreated={() => {
          loadBots();
          setSubView('OVERVIEW');
        }}
        onOpenBacktestWithConfig={cfg => {
          setBacktestConfig(cfg);
          setSubView('BACKTEST');
        }}
      />
    </div>
  );
};
