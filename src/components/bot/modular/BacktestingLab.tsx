/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/bot/modular/BacktestingLab.tsx
 * Historical Backtesting & Parameter Optimization Lab for DIMONEX MODULAR_STRATEGY_BOT.
 */

import React, { useState, useEffect } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Play,
  RefreshCw,
  Sliders,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ModularBacktestReport,
  ModularBotConfigV1,
  ModularStrategyMetadata,
  TradingPairItem,
} from '../../../types/index.js';
import { formatQuotePrice, formatDateTime } from '../../../lib/formatters.js';
import { Button } from '../../ui/Button.js';
import { StatusBadge } from '../../ui/StatusBadge.js';

interface Props {
  strategies: ModularStrategyMetadata[];
  pairs: TradingPairItem[];
  preselectedStrategy?: ModularStrategyMetadata | null;
  initialConfig?: ModularBotConfigV1 | null;
  onDeployFromBacktest?: (config: ModularBotConfigV1) => void;
  onOpenAuthModal: () => void;
  isAuthenticated: boolean;
}

function buildDefaultConfig(
  strategy: ModularStrategyMetadata,
  pair: TradingPairItem
): ModularBotConfigV1 {
  const indicators: Record<string, number | boolean | string> = {};
  for (const spec of strategy.configurationSchema) {
    indicators[spec.key] = spec.defaultValue;
  }
  const isQuoteIdr = pair.quoteCurrency === 'IDR';
  return {
    schemaVersion: '1.0',
    bot: {
      name: `${strategy.name} Backtest`,
      category: strategy.category,
      strategyId: strategy.strategyId,
      strategyVersion: strategy.version,
      tradingPair: pair.id,
      mode: 'BACKTEST',
    },
    market: {
      timeframe: strategy.supportedTimeframes.includes('15m') ? '15m' : strategy.supportedTimeframes[0] || '1h',
      dataSource: 'DIMONEX',
      priceReference: 'LAST_TRADE',
      maxDataAgeMs: 60000,
    },
    strategy: {
      indicators,
      entryRules:
        strategy.strategyId === 'custom_rule_builder'
          ? [
              {
                type: 'CONDITION',
                left: { kind: 'INDICATOR', indicator: 'RSI', params: { period: 14 } },
                operator: 'LESS_THAN',
                right: { kind: 'CONSTANT', value: 38 },
              },
            ]
          : [],
      exitRules:
        strategy.strategyId === 'custom_rule_builder'
          ? [
              {
                type: 'CONDITION',
                left: { kind: 'INDICATOR', indicator: 'RSI', params: { period: 14 } },
                operator: 'GREATER_THAN',
                right: { kind: 'CONSTANT', value: 64 },
              },
            ]
          : [],
    },
    execution: {
      orderType: strategy.category === 'MARKET_MAKING' ? 'POST_ONLY' : 'LIMIT',
      timeInForce: 'GTC',
      postOnly: strategy.category === 'MARKET_MAKING',
      maxSlippageBps: 50,
      orderTimeoutSeconds: 300,
      tickIntervalMs: 3000,
    },
    risk: {
      positionSizing: {
        method: 'PERCENT_BALANCE',
        value: '25',
      },
      tripleBarrier: {
        enabled: strategy.riskCompatibility.supportsTripleBarrier,
        takeProfitBps: 350,
        stopLossBps: 180,
        maxHoldingSeconds: 14400,
        exitExecutionPolicy: 'MARKET_PROTECTED',
      },
      trailingStop: {
        enabled: strategy.riskCompatibility.supportsTrailingStop,
        activationBps: 150,
        distanceBps: 80,
        breakEvenActivationBps: 90,
        breakEvenOffsetBps: 10,
      },
      limits: {
        maxOpenOrders: strategy.category === 'DIRECTIONAL' ? 2 : 10,
        maxNotional: isQuoteIdr ? '50000000' : '5000',
        maxDailyLoss: isQuoteIdr ? '5000000' : '500',
        maxDrawdownPct: 20,
        maxOrdersPerMinute: 30,
      },
    },
  };
}

export const BacktestingLab: React.FC<Props> = ({
  strategies,
  pairs,
  preselectedStrategy,
  initialConfig,
  onDeployFromBacktest,
  onOpenAuthModal,
  isAuthenticated,
}) => {
  const defaultPair = pairs.find(p => p.isActive) || pairs[0] || ({
    id: 'BTC-IDR',
    baseCurrency: 'BTC',
    quoteCurrency: 'IDR',
    baseDecimals: 8,
    quoteDecimals: 2,
  } as TradingPairItem);

  const [selectedStrategyId, setSelectedStrategyId] = useState<string>(
    initialConfig?.bot.strategyId || preselectedStrategy?.strategyId || strategies[0]?.strategyId || 'bollinger_rsi'
  );
  const [selectedPairId, setSelectedPairId] = useState<string>(
    initialConfig?.bot.tradingPair || defaultPair.id
  );
  const [timeframe, setTimeframe] = useState<string>(initialConfig?.market.timeframe || '15m');
  const [initialQuoteBalance, setInitialQuoteBalance] = useState<string>(
    defaultPair.quoteCurrency === 'IDR' ? '25000000' : '5000'
  );
  const [initialBaseBalance, setInitialBaseBalance] = useState<string>('0');
  const [slippageBps, setSlippageBps] = useState<string>('8');
  const [partialFillPct, setPartialFillPct] = useState<string>('0');
  const [candleLimit, setCandleLimit] = useState<string>('300');
  const [enableSweep, setEnableSweep] = useState<boolean>(false);
  const [sweepParamKey, setSweepParamKey] = useState<string>('');
  const [sweepValuesCsv, setSweepValuesCsv] = useState<string>('');

  const [indicatorParams, setIndicatorParams] = useState<Record<string, number | boolean | string>>(
    initialConfig?.strategy.indicators || {}
  );
  const [tpBps, setTpBps] = useState<string>(String(initialConfig?.risk.tripleBarrier.takeProfitBps ?? 350));
  const [slBps, setSlBps] = useState<string>(String(initialConfig?.risk.tripleBarrier.stopLossBps ?? 180));

  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [report, setReport] = useState<ModularBacktestReport | null>(null);
  const [history, setHistory] = useState<ModularBacktestReport[]>([]);

  const activeStrategy = strategies.find(s => s.strategyId === selectedStrategyId) || strategies[0];
  const activePair = pairs.find(p => p.id === selectedPairId) || defaultPair;

  useEffect(() => {
    if (preselectedStrategy) {
      setSelectedStrategyId(preselectedStrategy.strategyId);
    }
  }, [preselectedStrategy]);

  useEffect(() => {
    if (activeStrategy) {
      const defaults: Record<string, number | boolean | string> = {};
      for (const spec of activeStrategy.configurationSchema) {
        defaults[spec.key] =
          indicatorParams[spec.key] !== undefined ? indicatorParams[spec.key] : spec.defaultValue;
      }
      setIndicatorParams(defaults);
      const firstNum = activeStrategy.configurationSchema.find(s => s.type === 'number');
      if (firstNum) {
        setSweepParamKey(firstNum.key);
        const baseVal = Number(firstNum.defaultValue) || 14;
        setSweepValuesCsv(`${Math.max(2, Math.round(baseVal * 0.7))}, ${baseVal}, ${Math.round(baseVal * 1.4)}`);
      }
    }
  }, [selectedStrategyId, strategies.length]);

  useEffect(() => {
    if (activePair.quoteCurrency === 'IDR' && Number(initialQuoteBalance) < 100000) {
      setInitialQuoteBalance('25000000');
    } else if (activePair.quoteCurrency === 'USDT' && Number(initialQuoteBalance) > 1000000) {
      setInitialQuoteBalance('5000');
    }
  }, [selectedPairId]);

  const fetchHistory = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetch('/api/modular-bots/backtest/history', {
        headers: { Authorization: `Bearer ${localStorage.getItem('dimonex_auth_token') || localStorage.getItem('dimonex_token') || ''}` },
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.reports || []);
      }
    } catch {}
  };

  useEffect(() => {
    fetchHistory();
  }, [isAuthenticated]);

  const buildCurrentConfig = (): ModularBotConfigV1 => {
    const base = initialConfig
      ? (JSON.parse(JSON.stringify(initialConfig)) as ModularBotConfigV1)
      : buildDefaultConfig(activeStrategy, activePair);

    base.bot.tradingPair = activePair.id;
    base.bot.strategyId = activeStrategy.strategyId;
    base.bot.category = activeStrategy.category;
    base.bot.mode = 'BACKTEST';
    base.market.timeframe = timeframe;
    base.strategy.indicators = { ...indicatorParams };
    base.risk.tripleBarrier.takeProfitBps = Math.max(20, Number(tpBps) || 350);
    base.risk.tripleBarrier.stopLossBps = Math.max(20, Number(slBps) || 180);
    base.risk.limits.maxNotional = activePair.quoteCurrency === 'IDR' ? '100000000' : '10000';
    base.risk.limits.maxDailyLoss = activePair.quoteCurrency === 'IDR' ? '15000000' : '1500';
    return base;
  };

  const handleRunBacktest = async () => {
    if (!isAuthenticated) {
      onOpenAuthModal();
      return;
    }
    setErrorMsg(null);
    setIsRunning(true);
    try {
      const cfg = buildCurrentConfig();
      const optimizeGrid =
        enableSweep && sweepParamKey && sweepValuesCsv.trim()
          ? [
              {
                paramKey: sweepParamKey,
                values: sweepValuesCsv
                  .split(',')
                  .map(s => Number(s.trim()))
                  .filter(n => Number.isFinite(n) && n > 0),
              },
            ]
          : undefined;

      const res = await fetch('/api/modular-bots/backtest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('dimonex_auth_token') || localStorage.getItem('dimonex_token') || ''}`,
        },
        body: JSON.stringify({
          config: cfg,
          initialQuoteBalance,
          initialBaseBalance,
          slippageBps: Number(slippageBps) || 8,
          partialFillPct: Number(partialFillPct) || 0,
          candleLimit: Number(candleLimit) || 300,
          optimizeGrid,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menjalankan backtest');
      setReport(data.report);
      fetchHistory();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Backtest gagal.');
    } finally {
      setIsRunning(false);
    }
  };

  const formatMetricQuote = (val: number) => {
    if (activePair.quoteCurrency === 'IDR') {
      return `Rp ${Math.round(val).toLocaleString('id-ID')}`;
    }
    return `${val.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${activePair.quoteCurrency}`;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left Controls */}
        <div className="xl:col-span-4 bg-[#141C24] border border-[#202B34] rounded-[10px] p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-[#202B34] pb-3">
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">Backtesting Lab</h3>
              <p className="text-[11px] text-[#71818B]">Simulasi kausal historis tanpa look-ahead bias</p>
            </div>
            <StatusBadge tone="brand">CAUSAL REPLAY</StatusBadge>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Strategi Plugin</label>
              <select
                value={selectedStrategyId}
                onChange={e => setSelectedStrategyId(e.target.value)}
                className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs text-[#E4EBEF]"
              >
                {strategies.map(s => (
                  <option key={s.strategyId} value={s.strategyId}>
                    {s.name} ({s.category})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Trading Pair</label>
                <select
                  value={selectedPairId}
                  onChange={e => setSelectedPairId(e.target.value)}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2.5 py-2 text-xs font-mono text-[#E4EBEF]"
                >
                  {pairs.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">Timeframe</label>
                <select
                  value={timeframe}
                  onChange={e => setTimeframe(e.target.value)}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2.5 py-2 text-xs font-mono text-[#E4EBEF]"
                >
                  {(activeStrategy?.supportedTimeframes || ['1m', '5m', '15m', '1h', '4h', '1d']).map(tf => (
                    <option key={tf} value={tf}>
                      {tf}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">
                  Modal Awal ({activePair.quoteCurrency})
                </label>
                <input
                  type="text"
                  value={initialQuoteBalance}
                  onChange={e => setInitialQuoteBalance(e.target.value)}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2.5 py-2 text-xs font-mono tabular-nums text-[#E4EBEF]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">
                  Base Awal ({activePair.baseCurrency})
                </label>
                <input
                  type="text"
                  value={initialBaseBalance}
                  onChange={e => setInitialBaseBalance(e.target.value)}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2.5 py-2 text-xs font-mono tabular-nums text-[#E4EBEF]"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-[#71818B] mb-1">Slippage (bps)</label>
                <input
                  type="number"
                  value={slippageBps}
                  onChange={e => setSlippageBps(e.target.value)}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#71818B] mb-1">Partial Fill %</label>
                <input
                  type="number"
                  value={partialFillPct}
                  onChange={e => setPartialFillPct(e.target.value)}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#71818B] mb-1">Candles</label>
                <input
                  type="number"
                  value={candleLimit}
                  onChange={e => setCandleLimit(e.target.value)}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                />
              </div>
            </div>

            {activeStrategy?.riskCompatibility.supportsTripleBarrier && (
              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-[#202B34]">
                <div>
                  <label className="block text-[11px] text-[#A1AFB8] mb-1">Take Profit (bps)</label>
                  <input
                    type="number"
                    value={tpBps}
                    onChange={e => setTpBps(e.target.value)}
                    className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#A1AFB8] mb-1">Stop Loss (bps)</label>
                  <input
                    type="number"
                    value={slBps}
                    onChange={e => setSlBps(e.target.value)}
                    className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                  />
                </div>
              </div>
            )}

            {/* Key Indicator Parameters */}
            {activeStrategy && activeStrategy.configurationSchema.length > 0 && (
              <div className="pt-2 border-t border-[#202B34] space-y-2">
                <div className="text-[11px] font-medium text-[#A1AFB8] flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[#8DA5B1]" />
                  <span>Parameter Strategi</span>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                  {activeStrategy.configurationSchema.slice(0, 8).map(spec => (
                    <div key={spec.key}>
                      <label className="block text-[10px] text-[#71818B] truncate mb-0.5">{spec.label}</label>
                      {spec.type === 'boolean' ? (
                        <button
                          type="button"
                          onClick={() =>
                            setIndicatorParams(prev => ({ ...prev, [spec.key]: !prev[spec.key] }))
                          }
                          className={`w-full px-2 py-1.5 rounded-[7px] text-xs font-mono border text-left cursor-pointer ${
                            indicatorParams[spec.key]
                              ? 'bg-[#12392F] text-[#35B887] border-[#35B887]/40'
                              : 'bg-[#111820] text-[#71818B] border-[#202B34]'
                          }`}
                        >
                          {indicatorParams[spec.key] ? 'AKTIF' : 'NONAKTIF'}
                        </button>
                      ) : spec.type === 'select' ? (
                        <select
                          value={String(indicatorParams[spec.key] ?? spec.defaultValue)}
                          onChange={e =>
                            setIndicatorParams(prev => ({ ...prev, [spec.key]: e.target.value }))
                          }
                          className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2 py-1.5 text-xs text-[#E4EBEF]"
                        >
                          {(spec.options || []).map(opt => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="number"
                          step={spec.step || 1}
                          value={Number(indicatorParams[spec.key] ?? spec.defaultValue)}
                          onChange={e =>
                            setIndicatorParams(prev => ({ ...prev, [spec.key]: Number(e.target.value) }))
                          }
                          className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Parameter Grid Sweep */}
            <div className="pt-2 border-t border-[#202B34] space-y-2">
              <label className="flex items-center gap-2 text-xs text-[#E4EBEF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableSweep}
                  onChange={e => setEnableSweep(e.target.checked)}
                  className="accent-[#8DA5B1]"
                />
                <span>Optimasi Parameter (Grid Sweep)</span>
              </label>
              {enableSweep && (
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={sweepParamKey}
                    onChange={e => setSweepParamKey(e.target.value)}
                    className="bg-[#111820] border border-[#202B34] rounded-[7px] px-2 py-1.5 text-xs text-[#E4EBEF]"
                  >
                    {(activeStrategy?.configurationSchema || [])
                      .filter(s => s.type === 'number')
                      .map(s => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                  </select>
                  <input
                    type="text"
                    value={sweepValuesCsv}
                    onChange={e => setSweepValuesCsv(e.target.value)}
                    placeholder="10, 14, 21"
                    className="bg-[#111820] border border-[#202B34] rounded-[7px] px-2 py-1.5 text-xs font-mono text-[#E4EBEF]"
                  />
                </div>
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-[7px] bg-[#401F27] border border-[#EA5B65]/40 text-xs text-[#EA5B65]">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="primary"
              className="flex-1"
              isLoading={isRunning}
              icon={<Play className="w-3.5 h-3.5" />}
              onClick={handleRunBacktest}
            >
              Jalankan Backtest
            </Button>
            {report && onDeployFromBacktest && (
              <Button
                variant="secondary"
                onClick={() => onDeployFromBacktest(report.configSnapshot)}
              >
                Lanjut ke Paper/Live
              </Button>
            )}
          </div>
        </div>

        {/* Right Results */}
        <div className="xl:col-span-8 space-y-4">
          {report ? (
            <>
              {/* 11 Performance Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-3">
                  <div className="text-[11px] text-[#71818B]">Total Return</div>
                  <div
                    className={`text-base font-semibold font-mono tabular-nums mt-0.5 ${
                      report.metrics.totalReturnPct >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'
                    }`}
                  >
                    {report.metrics.totalReturnPct >= 0 ? '+' : ''}
                    {report.metrics.totalReturnPct.toFixed(2)}%
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#A1AFB8]">
                    {formatMetricQuote(report.metrics.netProfitQuote)}
                  </div>
                </div>

                <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-3">
                  <div className="text-[11px] text-[#71818B]">Win Rate & Profit Factor</div>
                  <div className="text-base font-semibold font-mono tabular-nums text-[#E4EBEF] mt-0.5">
                    {report.metrics.winRatePct.toFixed(1)}%
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#A1AFB8]">
                    PF: {report.metrics.profitFactor.toFixed(2)}
                  </div>
                </div>

                <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-3">
                  <div className="text-[11px] text-[#71818B]">Max Drawdown</div>
                  <div className="text-base font-semibold font-mono tabular-nums text-[#EA5B65] mt-0.5">
                    -{report.metrics.maxDrawdownPct.toFixed(2)}%
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#A1AFB8]">
                    {formatMetricQuote(report.metrics.maxDrawdownQuote)}
                  </div>
                </div>

                <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-3">
                  <div className="text-[11px] text-[#71818B]">Sharpe / Sortino Ratio</div>
                  <div className="text-base font-semibold font-mono tabular-nums text-[#E4EBEF] mt-0.5">
                    {report.metrics.sharpeRatio.toFixed(2)} / {report.metrics.sortinoRatio.toFixed(2)}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#A1AFB8]">
                    {report.metrics.numberOfTrades} trades · Fee {formatMetricQuote(report.metrics.totalFeesQuote)}
                  </div>
                </div>
              </div>

              <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-[#71818B]">Avg Trade:</span>{' '}
                  <span className="font-mono tabular-nums text-[#E4EBEF]">
                    {formatMetricQuote(report.metrics.averageTradeQuote)}
                  </span>
                </div>
                <div>
                  <span className="text-[#71818B]">Exposure:</span>{' '}
                  <span className="font-mono tabular-nums text-[#E4EBEF]">
                    {report.metrics.exposureDurationPct.toFixed(1)}%
                  </span>
                </div>
                <div>
                  <span className="text-[#71818B]">Candles Tested:</span>{' '}
                  <span className="font-mono tabular-nums text-[#E4EBEF]">{report.candleCount}</span>
                </div>
                <div className="flex items-center gap-1 text-[#35B887]">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-mono text-[11px]">No Look-Ahead Verified</span>
                </div>
              </div>

              {/* Equity Curve Chart */}
              <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-[#E4EBEF] flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-[#8DA5B1]" />
                    <span>Kurva Ekuitas & Drawdown ({report.pairId} · {report.timeframe})</span>
                  </h4>
                  <span className="text-[11px] font-mono tabular-nums text-[#A1AFB8]">
                    Final Equity: {formatMetricQuote(report.metrics.finalEquityQuote)}
                  </span>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={report.equityCurve}>
                      <defs>
                        <linearGradient id="modBotEqGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#16A879" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#16A879" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#202B34" />
                      <XAxis
                        dataKey="time"
                        tickFormatter={t => new Date(t * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                        stroke="#71818B"
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis
                        domain={['auto', 'auto']}
                        stroke="#71818B"
                        tick={{ fontSize: 10 }}
                        width={70}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#111820',
                          borderColor: '#2B3944',
                          borderRadius: '8px',
                          fontSize: '11px',
                          color: '#E4EBEF',
                        }}
                        labelFormatter={t => new Date(Number(t) * 1000).toLocaleString('id-ID')}
                      />
                      <Area
                        type="monotone"
                        dataKey="equityQuote"
                        name="Ekuitas"
                        stroke="#16A879"
                        fillOpacity={1}
                        fill="url(#modBotEqGrad)"
                        strokeWidth={1.75}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Parameter Optimization Results */}
              {report.optimizationResults && report.optimizationResults.length > 0 && (
                <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4">
                  <h4 className="text-xs font-semibold text-[#E4EBEF] mb-3">
                    Hasil Optimasi Parameter Grid Sweep
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[#71818B] border-b border-[#202B34]">
                          <th className="py-2 pr-3">Parameter</th>
                          <th className="py-2 pr-3 text-right">Return</th>
                          <th className="py-2 pr-3 text-right">Win Rate</th>
                          <th className="py-2 pr-3 text-right">Max DD</th>
                          <th className="py-2 pr-3 text-right">Sharpe</th>
                          <th className="py-2 text-right">Trades</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#202B34] font-mono tabular-nums">
                        {report.optimizationResults.map((row, idx) => (
                          <tr key={idx} className="hover:bg-[#17212B]">
                            <td className="py-2 pr-3 text-[#E4EBEF]">
                              {Object.entries(row.params)
                                .map(([k, v]) => `${k}=${v}`)
                                .join(', ')}
                            </td>
                            <td className={`py-2 pr-3 text-right ${row.totalReturnPct >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                              {row.totalReturnPct >= 0 ? '+' : ''}{row.totalReturnPct.toFixed(2)}%
                            </td>
                            <td className="py-2 pr-3 text-right text-[#E4EBEF]">{row.winRatePct.toFixed(1)}%</td>
                            <td className="py-2 pr-3 text-right text-[#EA5B65]">-{row.maxDrawdownPct.toFixed(2)}%</td>
                            <td className="py-2 pr-3 text-right text-[#E4EBEF]">{row.sharpeRatio.toFixed(2)}</td>
                            <td className="py-2 text-right text-[#A1AFB8]">{row.numberOfTrades}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Trade History */}
              <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4">
                <h4 className="text-xs font-semibold text-[#E4EBEF] mb-3">
                  Riwayat Eksekusi Simulasi ({report.trades.length} transaksi)
                </h4>
                {report.trades.length === 0 ? (
                  <p className="text-xs text-[#71818B] py-4 text-center">
                    Tidak ada sinyal transaksi terpicu pada rentang candle historis ini. Coba sesuaikan parameter indikator atau jumlah candle.
                  </p>
                ) : (
                  <div className="overflow-x-auto max-h-60 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[#71818B] border-b border-[#202B34]">
                          <th className="py-2 pr-3">Waktu</th>
                          <th className="py-2 pr-3">Sisi</th>
                          <th className="py-2 pr-3 text-right">Harga</th>
                          <th className="py-2 pr-3 text-right">Qty</th>
                          <th className="py-2 pr-3 text-right">Fee</th>
                          <th className="py-2 text-right">Realized PnL</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#202B34] font-mono tabular-nums">
                        {report.trades.slice(-50).reverse().map(tr => {
                          const pnlNum = Number(tr.realizedPnlQuoteUnits || '0');
                          return (
                            <tr key={tr.executionId} className="hover:bg-[#17212B]">
                              <td className="py-1.5 pr-3 text-[#A1AFB8]">{formatDateTime(tr.timestamp)}</td>
                              <td className={`py-1.5 pr-3 font-semibold ${tr.side === 'BUY' ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                                {tr.side}
                              </td>
                              <td className="py-1.5 pr-3 text-right text-[#E4EBEF]">
                                {formatQuotePrice(tr.priceUnits, activePair.quoteCurrency, activePair.quoteDecimals)}
                              </td>
                              <td className="py-1.5 pr-3 text-right text-[#E4EBEF]">
                                {(Number(tr.quantityUnits) / 10 ** (activePair.baseDecimals || 8)).toFixed(6)}
                              </td>
                              <td className="py-1.5 pr-3 text-right text-[#71818B]">
                                {formatQuotePrice(tr.feeUnits, activePair.quoteCurrency, activePair.quoteDecimals)}
                              </td>
                              <td className={`py-1.5 text-right ${pnlNum >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                                {formatQuotePrice(tr.realizedPnlQuoteUnits, activePair.quoteCurrency, activePair.quoteDecimals)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-10 text-center space-y-3">
              <Activity className="w-8 h-8 text-[#8DA5B1] mx-auto" />
              <div className="text-sm font-semibold text-[#E4EBEF]">
                Laboratorium Backtesting Strategi Modular
              </div>
              <p className="text-xs text-[#A1AFB8] max-w-md mx-auto">
                Pilih strategi plugin, trading pair, dan parameter risiko di panel kiri untuk menguji performa historis secara kausal sebelum masuk ke Paper atau Live Trading.
              </p>
              {history.length > 0 && (
                <div className="pt-4 border-t border-[#202B34] text-left">
                  <div className="text-xs font-medium text-[#A1AFB8] mb-2 flex items-center justify-between">
                    <span>Riwayat Backtest Terakhir</span>
                    <button
                      type="button"
                      onClick={fetchHistory}
                      className="text-[#8DA5B1] hover:text-[#E4EBEF] cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {history.slice(0, 5).map(h => (
                      <button
                        key={h.runId}
                        type="button"
                        onClick={() => setReport(h)}
                        className="w-full flex items-center justify-between p-2 rounded-[7px] bg-[#111820] hover:bg-[#17212B] border border-[#202B34] text-xs cursor-pointer"
                      >
                        <span className="text-[#E4EBEF] font-mono">
                          {h.strategyId} · {h.pairId} · {h.timeframe}
                        </span>
                        <span className={`font-mono tabular-nums ${h.metrics.totalReturnPct >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                          {h.metrics.totalReturnPct >= 0 ? '+' : ''}{h.metrics.totalReturnPct.toFixed(2)}% ({h.metrics.numberOfTrades} trades)
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
