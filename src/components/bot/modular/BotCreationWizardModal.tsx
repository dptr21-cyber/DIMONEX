/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/bot/modular/BotCreationWizardModal.tsx
 * 8-Step Creation Wizard for DIMONEX MODULAR_STRATEGY_BOT:
 *   1. Category (Directional / Market Making / Hybrid)
 *   2. Strategy Plugin
 *   3. Pair & Market Settings
 *   4. Indicators & Declarative Custom Rule Builder (AST)
 *   5. Risk Settings (Sizing, Triple Barrier, Trailing Stop, Limits)
 *   6. Execution Settings (POST_ONLY, LIMIT, IOC, FOK, MARKET)
 *   7. Operating Mode (PAPER vs LIVE confirmation vs Backtest jump)
 *   8. Review, Backend Validation & Deploy
 */

import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Layers,
  Play,
  Plus,
  Shield,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {
  IndicatorOperand,
  ModularBotCategory,
  ModularBotConfigV1,
  ModularBotMode,
  ModularOrderType,
  ModularStrategyMetadata,
  ModularTimeInForce,
  RuleConditionNode,
  RuleNode,
  SupportedIndicatorId,
  TradingPairItem,
} from '../../../types/index.js';
import { Modal } from '../../ui/Modal.js';
import { Button } from '../../ui/Button.js';
import { StatusBadge } from '../../ui/StatusBadge.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  strategies: ModularStrategyMetadata[];
  pairs: TradingPairItem[];
  preselectedStrategy?: ModularStrategyMetadata | null;
  initialConfig?: ModularBotConfigV1 | null;
  onCreated: () => void;
  onOpenBacktestWithConfig?: (cfg: ModularBotConfigV1) => void;
}

const ALL_INDICATORS: SupportedIndicatorId[] = [
  'SMA',
  'EMA',
  'RSI',
  'MACD',
  'BOLLINGER_BANDS',
  'ATR',
  'ADX',
  'STOCHASTIC',
  'STOCHASTIC_RSI',
  'VWAP',
  'VOLUME_MA',
  'OBV',
  'MFI',
];

const INDICATOR_FIELDS: Record<SupportedIndicatorId, string[]> = {
  SMA: ['value'],
  EMA: ['value'],
  RSI: ['value'],
  MACD: ['macdLine', 'signalLine', 'histogram'],
  BOLLINGER_BANDS: ['upper', 'middle', 'lower', 'bandwidthPct'],
  ATR: ['value', 'pctOfPrice'],
  ADX: ['adx', 'plusDi', 'minusDi'],
  STOCHASTIC: ['k', 'd'],
  STOCHASTIC_RSI: ['k', 'd'],
  VWAP: ['value'],
  VOLUME_MA: ['value', 'ratio'],
  OBV: ['value'],
  MFI: ['value'],
};

const STEPS = [
  'Kategori',
  'Strategi',
  'Market',
  'Indikator',
  'Risiko',
  'Eksekusi',
  'Mode',
  'Review',
];

function createDefaultCondition(indicator: SupportedIndicatorId = 'RSI', val = 35): RuleConditionNode {
  return {
    type: 'CONDITION',
    left: {
      kind: 'INDICATOR',
      indicator,
      field: INDICATOR_FIELDS[indicator][0],
      params: { period: 14 },
    },
    operator: 'LESS_THAN',
    right: { kind: 'CONSTANT', value: val },
  };
}

export const BotCreationWizardModal: React.FC<Props> = ({
  isOpen,
  onClose,
  strategies,
  pairs,
  preselectedStrategy,
  initialConfig,
  onCreated,
  onOpenBacktestWithConfig,
}) => {
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<ModularBotCategory>('DIRECTIONAL');
  const [strategyId, setStrategyId] = useState<string>('bollinger_rsi');
  const [botName, setBotName] = useState<string>('Alpha Modular Bot');
  const [pairId, setPairId] = useState<string>(pairs[0]?.id || 'BTC-IDR');
  const [timeframe, setTimeframe] = useState<string>('15m');
  const [priceRef, setPriceRef] = useState<'LAST_TRADE' | 'MIDPOINT' | 'BEST_BID' | 'BEST_ASK'>('LAST_TRADE');
  const [maxDataAgeMs, setMaxDataAgeMs] = useState<number>(60000);

  const [indicators, setIndicators] = useState<Record<string, number | boolean | string>>({});
  const [entryRules, setEntryRules] = useState<RuleNode[]>([createDefaultCondition('RSI', 35)]);
  const [exitRules, setExitRules] = useState<RuleNode[]>([
    {
      type: 'CONDITION',
      left: { kind: 'INDICATOR', indicator: 'RSI', field: 'value', params: { period: 14 } },
      operator: 'GREATER_THAN',
      right: { kind: 'CONSTANT', value: 65 },
    },
  ]);

  // Step 5: Risk
  const [sizingMethod, setSizingMethod] = useState<'FIXED_QTY' | 'FIXED_QUOTE' | 'PERCENT_BALANCE' | 'RISK_PER_TRADE'>('PERCENT_BALANCE');
  const [sizingValue, setSizingValue] = useState<string>('20');
  const [tbEnabled, setTbEnabled] = useState<boolean>(true);
  const [tpBps, setTpBps] = useState<number>(350);
  const [slBps, setSlBps] = useState<number>(180);
  const [maxHoldingSec, setMaxHoldingSec] = useState<number>(14400);
  const [tsEnabled, setTsEnabled] = useState<boolean>(true);
  const [tsActivationBps, setTsActivationBps] = useState<number>(150);
  const [tsDistanceBps, setTsDistanceBps] = useState<number>(80);
  const [beActivationBps, setBeActivationBps] = useState<number>(90);
  const [maxOpenOrders, setMaxOpenOrders] = useState<number>(3);
  const [maxNotional, setMaxNotional] = useState<string>('25000000');
  const [maxDailyLoss, setMaxDailyLoss] = useState<string>('2500000');
  const [maxDrawdownPct, setMaxDrawdownPct] = useState<number>(15);

  // Step 6: Execution
  const [orderType, setOrderType] = useState<ModularOrderType>('LIMIT');
  const [timeInForce, setTimeInForce] = useState<ModularTimeInForce>('GTC');
  const [postOnly, setPostOnly] = useState<boolean>(false);
  const [maxSlippageBps, setMaxSlippageBps] = useState<number>(50);
  const [orderTimeoutSeconds, setOrderTimeoutSeconds] = useState<number>(300);
  const [tickIntervalMs, setTickIntervalMs] = useState<number>(3000);

  // Step 7: Mode & Paper settings
  const [mode, setMode] = useState<ModularBotMode>('PAPER');
  const [paperQuote, setPaperQuote] = useState<string>('25000000');
  const [paperBase, setPaperBase] = useState<string>('0');
  const [paperSlippageBps, setPaperSlippageBps] = useState<number>(5);
  const [paperPartialPct, setPaperPartialPct] = useState<number>(10);
  const [confirmLive, setConfirmLive] = useState<boolean>(false);
  const [startOnDeploy, setStartOnDeploy] = useState<boolean>(true);

  const [validationState, setValidationState] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const activeStrategy = strategies.find(s => s.strategyId === strategyId) || strategies[0];
  const activePair = pairs.find(p => p.id === pairId) || pairs[0];

  useEffect(() => {
    if (!isOpen) return;
    setSubmitError(null);
    setValidationState(null);
    if (initialConfig) {
      setCategory(initialConfig.bot.category);
      setStrategyId(initialConfig.bot.strategyId);
      setBotName(initialConfig.bot.name);
      setPairId(initialConfig.bot.tradingPair);
      setTimeframe(initialConfig.market.timeframe);
      setIndicators({ ...initialConfig.strategy.indicators });
      if (initialConfig.strategy.entryRules?.length) setEntryRules(initialConfig.strategy.entryRules);
      if (initialConfig.strategy.exitRules?.length) setExitRules(initialConfig.strategy.exitRules);
      setMode('PAPER');
      setStep(6);
      return;
    }
    if (preselectedStrategy) {
      setCategory(preselectedStrategy.category);
      setStrategyId(preselectedStrategy.strategyId);
      setBotName(`${preselectedStrategy.name} Bot`);
      setStep(2);
    } else {
      setStep(0);
    }
  }, [isOpen, preselectedStrategy, initialConfig]);

  useEffect(() => {
    if (!activeStrategy) return;
    const nextInd: Record<string, number | boolean | string> = {};
    for (const spec of activeStrategy.configurationSchema) {
      nextInd[spec.key] = indicators[spec.key] !== undefined ? indicators[spec.key] : spec.defaultValue;
    }
    setIndicators(nextInd);

    if (!activeStrategy.supportedTimeframes.includes(timeframe)) {
      setTimeframe(
        activeStrategy.supportedTimeframes.includes('15m')
          ? '15m'
          : activeStrategy.supportedTimeframes[0] || '15m'
      );
    }

    if (activeStrategy.category === 'MARKET_MAKING') {
      setOrderType('POST_ONLY');
      setPostOnly(true);
      setTbEnabled(false);
      setTsEnabled(false);
      setMaxOpenOrders(8);
    } else if (activeStrategy.category === 'HYBRID') {
      setOrderType('POST_ONLY');
      setPostOnly(true);
      setTbEnabled(false);
      setTsEnabled(false);
      setMaxOpenOrders(14);
    } else {
      setOrderType('LIMIT');
      setPostOnly(false);
      setTbEnabled(true);
      setTsEnabled(true);
      setMaxOpenOrders(3);
    }
  }, [strategyId]);

  useEffect(() => {
    if (!activePair) return;
    if (activePair.quoteCurrency === 'USDT') {
      if (Number(maxNotional) > 1000000) setMaxNotional('5000');
      if (Number(maxDailyLoss) > 100000) setMaxDailyLoss('500');
      if (Number(paperQuote) > 1000000) setPaperQuote('5000');
    } else {
      if (Number(maxNotional) < 100000) setMaxNotional('50000000');
      if (Number(maxDailyLoss) < 10000) setMaxDailyLoss('5000000');
      if (Number(paperQuote) < 100000) setPaperQuote('25000000');
    }
  }, [pairId]);

  const buildConfigPayload = (): ModularBotConfigV1 => ({
    schemaVersion: '1.0',
    bot: {
      name: botName.trim() || `${activeStrategy?.name || 'Modular'} Bot`,
      category: activeStrategy?.category || category,
      strategyId,
      strategyVersion: activeStrategy?.version || '1.0.0',
      tradingPair: pairId,
      mode: mode === 'BACKTEST' ? 'PAPER' : mode,
    },
    market: {
      timeframe,
      dataSource: 'DIMONEX',
      priceReference: priceRef,
      maxDataAgeMs,
    },
    strategy: {
      indicators,
      entryRules: strategyId === 'custom_rule_builder' ? entryRules : [],
      exitRules: strategyId === 'custom_rule_builder' ? exitRules : [],
    },
    execution: {
      orderType,
      timeInForce: orderType === 'IOC' ? 'IOC' : orderType === 'FOK' ? 'FOK' : timeInForce,
      postOnly,
      maxSlippageBps,
      orderTimeoutSeconds,
      retryCount: 1,
      tickIntervalMs,
    },
    risk: {
      positionSizing: {
        method: sizingMethod,
        value: sizingValue,
        riskPctPerTrade: sizingMethod === 'RISK_PER_TRADE' ? sizingValue : undefined,
      },
      tripleBarrier: {
        enabled: tbEnabled,
        takeProfitBps: tpBps,
        stopLossBps: slBps,
        maxHoldingSeconds: maxHoldingSec,
        exitExecutionPolicy: 'MARKET_PROTECTED',
      },
      trailingStop: {
        enabled: tsEnabled,
        activationBps: tsActivationBps,
        distanceBps: tsDistanceBps,
        breakEvenActivationBps: beActivationBps,
        breakEvenOffsetBps: 10,
      },
      limits: {
        maxOpenOrders,
        maxNotional,
        maxDailyLoss,
        maxDrawdownPct,
        maxOrdersPerMinute: 30,
        emergencyStop: false,
      },
    },
    paperConfig:
      mode === 'PAPER'
        ? {
            initialQuoteBalance: paperQuote,
            initialBaseBalance: paperBase,
            simulatedLatencyMs: 80,
            simulatedSlippageBps: paperSlippageBps,
            partialFillProbabilityPct: paperPartialPct,
          }
        : undefined,
  });

  const runBackendValidation = async () => {
    setIsValidating(true);
    try {
      const res = await fetch('/api/modular-bots/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('dimonex_auth_token') || localStorage.getItem('dimonex_token') || ''}`,
        },
        body: JSON.stringify({ config: buildConfigPayload() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setValidationState({
          valid: false,
          errors: Array.isArray(data.errors) && data.errors.length > 0
            ? data.errors
            : [data.error || `Validasi gagal (HTTP ${res.status}).`],
          warnings: data.warnings || [],
        });
        return;
      }
      setValidationState({
        valid: Boolean(data.valid),
        errors: data.errors || [],
        warnings: data.warnings || [],
      });
    } catch {
      setValidationState({ valid: false, errors: ['Gagal memvalidasi konfigurasi ke server.'], warnings: [] });
    } finally {
      setIsValidating(false);
    }
  };

  useEffect(() => {
    if (isOpen && step === 7) {
      void runBackendValidation();
    }
  }, [step, isOpen]);

  const handleDeploy = async () => {
    const cfg = buildConfigPayload();
    if (mode === 'BACKTEST' && onOpenBacktestWithConfig) {
      onClose();
      onOpenBacktestWithConfig({ ...cfg, bot: { ...cfg.bot, mode: 'BACKTEST' } });
      return;
    }
    if (mode === 'LIVE' && !confirmLive) {
      setSubmitError('Centang konfirmasi risiko Live Trading terlebih dahulu.');
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/modular-bots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('dimonex_auth_token') || localStorage.getItem('dimonex_token') || ''}`,
        },
        body: JSON.stringify({
          config: cfg,
          startImmediately: startOnDeploy,
          confirmLiveDeployment: mode === 'LIVE' ? confirmLive : false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat bot.');
      onCreated();
      onClose();
    } catch (err: any) {
      setSubmitError(err?.message || 'Terjadi kesalahan saat deployment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderConditionEditor = (
    list: RuleNode[],
    setList: React.Dispatch<React.SetStateAction<RuleNode[]>>,
    label: string
  ) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#E4EBEF]">{label}</span>
        <button
          type="button"
          onClick={() => setList(prev => [...prev, createDefaultCondition('RSI', 40)])}
          className="text-xs text-[#8DA5B1] hover:text-[#E4EBEF] flex items-center gap-1 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Tambah Kondisi
        </button>
      </div>
      {list.map((node, idx) => {
        if (node.type !== 'CONDITION') return null;
        const leftInd = (node.left.indicator || 'RSI') as SupportedIndicatorId;
        const rightIsConst = node.right.kind === 'CONSTANT';
        return (
          <div
            key={idx}
            className="grid grid-cols-12 gap-2 items-center bg-[#111820] border border-[#202B34] rounded-[7px] p-2"
          >
            {/* Left Indicator */}
            <select
              value={leftInd}
              onChange={e => {
                const newInd = e.target.value as SupportedIndicatorId;
                const copy = [...list];
                copy[idx] = {
                  ...node,
                  left: {
                    kind: 'INDICATOR',
                    indicator: newInd,
                    field: INDICATOR_FIELDS[newInd][0],
                    params: { period: 14 },
                  },
                };
                setList(copy);
              }}
              className="col-span-4 bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1 text-[11px] font-mono text-[#E4EBEF]"
            >
              {ALL_INDICATORS.map(ind => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>

            {/* Period */}
            <input
              type="number"
              min={2}
              value={node.left.params?.period || 14}
              onChange={e => {
                const copy = [...list];
                copy[idx] = {
                  ...node,
                  left: { ...node.left, params: { ...(node.left.params || {}), period: Number(e.target.value) || 14 } },
                };
                setList(copy);
              }}
              title="Period"
              className="col-span-2 bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1 text-[11px] font-mono text-[#E4EBEF]"
            />

            {/* Operator */}
            <select
              value={node.operator}
              onChange={e => {
                const copy = [...list];
                copy[idx] = { ...node, operator: e.target.value as any };
                setList(copy);
              }}
              className="col-span-3 bg-[#141C24] border border-[#202B34] rounded-[5px] px-1.5 py-1 text-[11px] font-mono text-[#E4EBEF]"
            >
              <option value="GREATER_THAN">&gt;</option>
              <option value="LESS_THAN">&lt;</option>
              <option value="CROSS_ABOVE">CROSS_ABOVE</option>
              <option value="CROSS_BELOW">CROSS_BELOW</option>
              <option value="EQUAL">=</option>
            </select>

            {/* Right Operand */}
            <div className="col-span-2 flex items-center gap-1">
              {rightIsConst ? (
                <input
                  type="number"
                  step="0.1"
                  value={node.right.value ?? 0}
                  onChange={e => {
                    const copy = [...list];
                    copy[idx] = { ...node, right: { kind: 'CONSTANT', value: Number(e.target.value) } };
                    setList(copy);
                  }}
                  className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1 text-[11px] font-mono text-[#E4EBEF]"
                />
              ) : (
                <span className="text-[11px] font-mono text-[#A1AFB8]">Price</span>
              )}
              <button
                type="button"
                title="Toggle Constant vs Close Price"
                onClick={() => {
                  const copy = [...list];
                  const nextRight: IndicatorOperand = rightIsConst
                    ? { kind: 'PRICE', priceField: 'close' }
                    : { kind: 'CONSTANT', value: 50 };
                  copy[idx] = { ...node, right: nextRight };
                  setList(copy);
                }}
                className="text-[10px] px-1 py-0.5 rounded bg-[#1D2832] text-[#8DA5B1] cursor-pointer"
              >
                {rightIsConst ? '#' : 'P'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setList(prev => prev.filter((_, i) => i !== idx))}
              className="col-span-1 text-[#71818B] hover:text-[#EA5B65] justify-self-end cursor-pointer"
              disabled={list.length <= 1}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );

  const strategiesForCategory = strategies.filter(
    s => s.category === category || (category === 'MARKET_MAKING' && s.category === 'HYBRID')
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-3xl"
      title="Modular Strategy Bot Wizard"
      subtitle={`Langkah ${step + 1} dari ${STEPS.length} — ${STEPS[step]}`}
    >
      <div className="space-y-5">
        {/* Stepper Bar */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 pb-3 border-b border-[#202B34]">
          {STEPS.map((label, idx) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(idx)}
              className={`px-2 py-1.5 rounded-[5px] text-[11px] font-medium text-center transition-colors cursor-pointer whitespace-nowrap ${
                idx === step
                  ? 'bg-[#8DA5B1] text-[#090D12] font-semibold'
                  : idx < step
                    ? 'bg-[#17212B] text-[#E4EBEF] border border-[#2B3944]'
                    : 'bg-[#111820] text-[#71818B] border border-[#202B34]'
              }`}
            >
              {idx + 1}. {label}
            </button>
          ))}
        </div>

        {/* STEP 1: CATEGORY */}
        {step === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                id: 'DIRECTIONAL' as ModularBotCategory,
                title: 'Directional Trading',
                desc: 'Mengikuti tren, mean reversion, atau aturan indikator kustom (Bollinger+RSI, EMA+MACD, Supertrend, AST Rules) dengan Triple Barrier.',
                icon: <TrendingUp className="w-5 h-5 text-[#16A879]" />,
              },
              {
                id: 'MARKET_MAKING' as ModularBotCategory,
                title: 'Market Making',
                desc: 'Kuotasi dua arah (Bid & Ask) Post-Only berbasis spread dinamis, inventory skew, dan perlindungan anti-self-trade.',
                icon: <Layers className="w-5 h-5 text-[#8DA5B1]" />,
              },
              {
                id: 'HYBRID' as ModularBotCategory,
                title: 'Dynamic Grid & DCA',
                desc: 'Grid adaptif & DCA berbasis ATR/ADX dengan batas eksposur ketat serta saldo tersedia riil.',
                icon: <Shield className="w-5 h-5 text-[#D6A85C]" />,
              },
            ].map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setCategory(cat.id);
                  const firstMatch = strategies.find(s => s.category === cat.id);
                  if (firstMatch) setStrategyId(firstMatch.strategyId);
                }}
                className={`p-4 rounded-[10px] border text-left space-y-2 transition-colors cursor-pointer ${
                  category === cat.id
                    ? 'bg-[#17212B] border-[#8DA5B1]'
                    : 'bg-[#111820] border-[#202B34] hover:border-[#2B3944]'
                }`}
              >
                <div className="flex items-center justify-between">
                  {cat.icon}
                  {category === cat.id && <StatusBadge tone="brand">DIPILIH</StatusBadge>}
                </div>
                <div className="text-sm font-semibold text-[#E4EBEF]">{cat.title}</div>
                <p className="text-xs text-[#A1AFB8] leading-relaxed">{cat.desc}</p>
              </button>
            ))}
          </div>
        )}

        {/* STEP 2: STRATEGY */}
        {step === 1 && (
          <div className="space-y-3">
            {(strategiesForCategory.length > 0 ? strategiesForCategory : strategies).map(st => (
              <button
                key={st.strategyId}
                type="button"
                onClick={() => {
                  setStrategyId(st.strategyId);
                  setBotName(`${st.name} Bot`);
                }}
                className={`w-full p-3.5 rounded-[10px] border text-left transition-colors cursor-pointer ${
                  strategyId === st.strategyId
                    ? 'bg-[#17212B] border-[#8DA5B1]'
                    : 'bg-[#111820] border-[#202B34] hover:border-[#2B3944]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-[#E4EBEF]">{st.name}</div>
                    <div className="text-[11px] font-mono text-[#71818B] mt-0.5">
                      {st.category} · v{st.version} · {st.requiredIndicators.slice(0, 4).join(' / ')}
                    </div>
                  </div>
                  <StatusBadge tone={strategyId === st.strategyId ? 'success' : 'neutral'}>
                    {strategyId === st.strategyId ? 'TERPILIH' : st.status}
                  </StatusBadge>
                </div>
                <p className="text-xs text-[#A1AFB8] mt-2">{st.description}</p>
              </button>
            ))}
          </div>
        )}

        {/* STEP 3: MARKET & PAIR */}
        {step === 2 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#A1AFB8] mb-1">Nama Instance Bot</label>
              <input
                type="text"
                value={botName}
                onChange={e => setBotName(e.target.value)}
                className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs text-[#E4EBEF]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1AFB8] mb-1">Trading Pair (Spot)</label>
              <select
                value={pairId}
                onChange={e => setPairId(e.target.value)}
                className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs font-mono text-[#E4EBEF]"
              >
                {pairs.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.id} (Fee {p.makerFeeBps}/{p.takerFeeBps} bps)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1AFB8] mb-1">Timeframe Candle</label>
              <select
                value={timeframe}
                onChange={e => setTimeframe(e.target.value)}
                className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs font-mono text-[#E4EBEF]"
              >
                {(activeStrategy?.supportedTimeframes || ['1m', '5m', '15m', '1h', '4h', '1d']).map(tf => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1AFB8] mb-1">Price Reference Source</label>
              <select
                value={priceRef}
                onChange={e => setPriceRef(e.target.value as any)}
                className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs font-mono text-[#E4EBEF]"
              >
                <option value="LAST_TRADE">LAST_TRADE</option>
                <option value="MIDPOINT">MIDPOINT (Order Book Mid)</option>
                <option value="BEST_BID">BEST_BID</option>
                <option value="BEST_ASK">BEST_ASK</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1AFB8] mb-1">Max Stale Data Age (ms)</label>
              <input
                type="number"
                min={2000}
                max={300000}
                value={maxDataAgeMs}
                onChange={e => setMaxDataAgeMs(Number(e.target.value) || 60000)}
                className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs font-mono tabular-nums text-[#E4EBEF]"
              />
            </div>
          </div>
        )}

        {/* STEP 4: INDICATORS & CUSTOM RULES */}
        {step === 3 && (
          <div className="space-y-4">
            {activeStrategy && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {activeStrategy.configurationSchema.map(spec => (
                  <div key={spec.key} className="bg-[#111820] border border-[#202B34] rounded-[7px] p-2.5">
                    <label className="block text-xs font-medium text-[#E4EBEF] mb-1">{spec.label}</label>
                    {spec.type === 'boolean' ? (
                      <button
                        type="button"
                        onClick={() =>
                          setIndicators(prev => ({ ...prev, [spec.key]: !prev[spec.key] }))
                        }
                        className={`px-3 py-1.5 rounded-[5px] text-xs font-mono border cursor-pointer ${
                          indicators[spec.key]
                            ? 'bg-[#12392F] text-[#35B887] border-[#35B887]/40'
                            : 'bg-[#141C24] text-[#71818B] border-[#202B34]'
                        }`}
                      >
                        {indicators[spec.key] ? 'ENABLED' : 'DISABLED'}
                      </button>
                    ) : spec.type === 'select' ? (
                      <select
                        value={String(indicators[spec.key] ?? spec.defaultValue)}
                        onChange={e =>
                          setIndicators(prev => ({ ...prev, [spec.key]: e.target.value }))
                        }
                        className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2.5 py-1.5 text-xs text-[#E4EBEF]"
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
                        min={spec.min}
                        max={spec.max}
                        value={Number(indicators[spec.key] ?? spec.defaultValue)}
                        onChange={e =>
                          setIndicators(prev => ({ ...prev, [spec.key]: Number(e.target.value) }))
                        }
                        className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                      />
                    )}
                    <p className="text-[10px] text-[#71818B] mt-1">{spec.description}</p>
                  </div>
                ))}
              </div>
            )}

            {strategyId === 'custom_rule_builder' && (
              <div className="space-y-4 pt-2 border-t border-[#202B34]">
                {renderConditionEditor(entryRules, setEntryRules, 'Aturan Entry (BUY / LONG)')}
                {renderConditionEditor(exitRules, setExitRules, 'Aturan Exit (SELL / EXIT)')}
              </div>
            )}
          </div>
        )}

        {/* STEP 5: RISK CONFIGURATION */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#A1AFB8] mb-1">Metode Position Sizing</label>
                <select
                  value={sizingMethod}
                  onChange={e => setSizingMethod(e.target.value as any)}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs text-[#E4EBEF]"
                >
                  <option value="FIXED_QTY">FIXED_QTY (Jumlah Base Tetap)</option>
                  <option value="FIXED_QUOTE">FIXED_QUOTE (Nilai Quote Tetap)</option>
                  <option value="PERCENT_BALANCE">PERCENT_BALANCE (% Saldo Tersedia)</option>
                  <option value="RISK_PER_TRADE">RISK_PER_TRADE (% Risiko per Stop Loss)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#A1AFB8] mb-1">
                  Nilai Sizing ({sizingMethod === 'PERCENT_BALANCE' || sizingMethod === 'RISK_PER_TRADE' ? '%' : sizingMethod === 'FIXED_QTY' ? activePair?.baseCurrency : activePair?.quoteCurrency})
                </label>
                <input
                  type="text"
                  value={sizingValue}
                  onChange={e => setSizingValue(e.target.value)}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs font-mono tabular-nums text-[#E4EBEF]"
                />
              </div>
            </div>

            {activeStrategy?.riskCompatibility.supportsTripleBarrier && (
              <div className="bg-[#111820] border border-[#202B34] rounded-[8px] p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#E4EBEF]">Triple Barrier Protection (TP / SL / Time)</span>
                  <input
                    type="checkbox"
                    checked={tbEnabled}
                    onChange={e => setTbEnabled(e.target.checked)}
                    className="accent-[#8DA5B1]"
                  />
                </div>
                {tbEnabled && (
                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[10px] text-[#71818B] mb-1">Take Profit (bps)</label>
                      <input
                        type="number"
                        value={tpBps}
                        onChange={e => setTpBps(Number(e.target.value))}
                        className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#71818B] mb-1">Stop Loss (bps)</label>
                      <input
                        type="number"
                        value={slBps}
                        onChange={e => setSlBps(Number(e.target.value))}
                        className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#71818B] mb-1">Max Hold (detik)</label>
                      <input
                        type="number"
                        value={maxHoldingSec}
                        onChange={e => setMaxHoldingSec(Number(e.target.value))}
                        className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeStrategy?.riskCompatibility.supportsTrailingStop && (
              <div className="bg-[#111820] border border-[#202B34] rounded-[8px] p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#E4EBEF]">Trailing Stop & Break-Even Trigger</span>
                  <input
                    type="checkbox"
                    checked={tsEnabled}
                    onChange={e => setTsEnabled(e.target.checked)}
                    className="accent-[#8DA5B1]"
                  />
                </div>
                {tsEnabled && (
                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[10px] text-[#71818B] mb-1">Aktivasi Trail (bps)</label>
                      <input
                        type="number"
                        value={tsActivationBps}
                        onChange={e => setTsActivationBps(Number(e.target.value))}
                        className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#71818B] mb-1">Jarak Trail (bps)</label>
                      <input
                        type="number"
                        value={tsDistanceBps}
                        onChange={e => setTsDistanceBps(Number(e.target.value))}
                        className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#71818B] mb-1">Break-Even (bps)</label>
                      <input
                        type="number"
                        value={beActivationBps}
                        onChange={e => setBeActivationBps(Number(e.target.value))}
                        className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] text-[#A1AFB8] mb-1">Max Open Orders</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={maxOpenOrders}
                  onChange={e => setMaxOpenOrders(Number(e.target.value))}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#A1AFB8] mb-1">Max Notional ({activePair?.quoteCurrency})</label>
                <input
                  type="text"
                  value={maxNotional}
                  onChange={e => setMaxNotional(e.target.value)}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#A1AFB8] mb-1">Max Daily Loss ({activePair?.quoteCurrency})</label>
                <input
                  type="text"
                  value={maxDailyLoss}
                  onChange={e => setMaxDailyLoss(e.target.value)}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#A1AFB8] mb-1">Max Drawdown (%)</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={maxDrawdownPct}
                  onChange={e => setMaxDrawdownPct(Number(e.target.value))}
                  className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#E4EBEF]"
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 6: EXECUTION */}
        {step === 5 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#A1AFB8] mb-1">Tipe Order</label>
              <select
                value={orderType}
                onChange={e => {
                  const val = e.target.value as ModularOrderType;
                  setOrderType(val);
                  setPostOnly(val === 'POST_ONLY');
                  if (val === 'IOC') setTimeInForce('IOC');
                  else if (val === 'FOK') setTimeInForce('FOK');
                  else setTimeInForce('GTC');
                }}
                className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs font-mono text-[#E4EBEF]"
              >
                <option value="POST_ONLY">POST_ONLY (Maker Only)</option>
                <option value="LIMIT">LIMIT (GTC)</option>
                <option value="IOC">IOC (Immediate or Cancel)</option>
                <option value="FOK">FOK (Fill or Kill)</option>
                <option value="MARKET">MARKET (Slippage Collared)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1AFB8] mb-1">Time In Force</label>
              <select
                value={timeInForce}
                onChange={e => setTimeInForce(e.target.value as ModularTimeInForce)}
                className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs font-mono text-[#E4EBEF]"
              >
                <option value="GTC">GTC (Good Till Cancelled)</option>
                <option value="IOC">IOC (Immediate Or Cancel)</option>
                <option value="FOK">FOK (Fill Or Kill)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1AFB8] mb-1">Max Slippage Protection (bps)</label>
              <input
                type="number"
                min={0}
                max={2000}
                value={maxSlippageBps}
                onChange={e => setMaxSlippageBps(Number(e.target.value))}
                className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs font-mono tabular-nums text-[#E4EBEF]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1AFB8] mb-1">Order Timeout Auto-Cancel (detik)</label>
              <input
                type="number"
                min={1}
                max={86400}
                value={orderTimeoutSeconds}
                onChange={e => setOrderTimeoutSeconds(Number(e.target.value))}
                className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs font-mono tabular-nums text-[#E4EBEF]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1AFB8] mb-1">Interval Evaluasi Worker (ms)</label>
              <input
                type="number"
                min={1500}
                max={60000}
                step={500}
                value={tickIntervalMs}
                onChange={e => setTickIntervalMs(Number(e.target.value))}
                className="w-full bg-[#111820] border border-[#202B34] rounded-[7px] px-3 py-2 text-xs font-mono tabular-nums text-[#E4EBEF]"
              />
            </div>
          </div>
        )}

        {/* STEP 7: OPERATING MODE */}
        {step === 6 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: 'PAPER' as ModularBotMode,
                  title: 'PAPER TRADING',
                  desc: 'Data pasar riil DIMONEX dengan dompet virtual terisolasi tanpa risiko dana nyata.',
                },
                {
                  id: 'LIVE' as ModularBotMode,
                  title: 'LIVE EXCHANGE',
                  desc: 'Order riil dikirim ke MatchingEngine & LedgerService memakai saldo tersedia Anda.',
                },
                {
                  id: 'BACKTEST' as ModularBotMode,
                  title: 'BACKTEST LAB',
                  desc: 'Uji konfigurasi langsung terhadap candle historis sebelum deployment.',
                },
              ].map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`p-3.5 rounded-[10px] border text-left space-y-1.5 cursor-pointer ${
                    mode === m.id
                      ? 'bg-[#17212B] border-[#8DA5B1]'
                      : 'bg-[#111820] border-[#202B34] hover:border-[#2B3944]'
                  }`}
                >
                  <div className="text-xs font-semibold text-[#E4EBEF]">{m.title}</div>
                  <p className="text-[11px] text-[#A1AFB8]">{m.desc}</p>
                </button>
              ))}
            </div>

            {mode === 'PAPER' && (
              <div className="bg-[#111820] border border-[#202B34] rounded-[8px] p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] text-[#71818B] mb-1">Virtual {activePair?.quoteCurrency}</label>
                  <input
                    type="text"
                    value={paperQuote}
                    onChange={e => setPaperQuote(e.target.value)}
                    className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1.5 text-xs font-mono text-[#E4EBEF]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#71818B] mb-1">Virtual {activePair?.baseCurrency}</label>
                  <input
                    type="text"
                    value={paperBase}
                    onChange={e => setPaperBase(e.target.value)}
                    className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1.5 text-xs font-mono text-[#E4EBEF]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#71818B] mb-1">Sim Slippage (bps)</label>
                  <input
                    type="number"
                    value={paperSlippageBps}
                    onChange={e => setPaperSlippageBps(Number(e.target.value))}
                    className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1.5 text-xs font-mono text-[#E4EBEF]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#71818B] mb-1">Partial Fill (%)</label>
                  <input
                    type="number"
                    value={paperPartialPct}
                    onChange={e => setPaperPartialPct(Number(e.target.value))}
                    className="w-full bg-[#141C24] border border-[#202B34] rounded-[5px] px-2 py-1.5 text-xs font-mono text-[#E4EBEF]"
                  />
                </div>
              </div>
            )}

            {mode === 'LIVE' && (
              <div className="bg-[#401F27]/60 border border-[#EA5B65]/40 rounded-[8px] p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#EA5B65]">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Konfirmasi Deployment Live Trading Riil</span>
                </div>
                <p className="text-xs text-[#E4EBEF]">
                  Bot akan mengeksekusi order sesungguhnya di order book DIMONEX menggunakan saldo tersedia pada akun Anda dan menerapkan aturan risiko yang dikonfigurasi.
                </p>
                <label className="flex items-center gap-2 text-xs text-[#E4EBEF] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={confirmLive}
                    onChange={e => setConfirmLive(e.target.checked)}
                    className="accent-[#EA5B65]"
                  />
                  <span>Saya memahami risiko perdagangan riil dan mengonfirmasi deployment LIVE.</span>
                </label>
              </div>
            )}
          </div>
        )}

        {/* STEP 8: REVIEW & VALIDATION */}
        {step === 7 && (
          <div className="space-y-3">
            <div className="bg-[#111820] border border-[#202B34] rounded-[8px] p-3.5 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-[#71818B] text-[10px]">Nama & Mode</div>
                <div className="text-[#E4EBEF] font-semibold mt-0.5">{botName} ({mode})</div>
              </div>
              <div>
                <div className="text-[#71818B] text-[10px]">Strategi & Pair</div>
                <div className="text-[#E4EBEF] font-mono mt-0.5">{strategyId} · {pairId} ({timeframe})</div>
              </div>
              <div>
                <div className="text-[#71818B] text-[10px]">Eksekusi & Sizing</div>
                <div className="text-[#E4EBEF] font-mono mt-0.5">{orderType} / {timeInForce} · {sizingMethod} ({sizingValue})</div>
              </div>
              <div>
                <div className="text-[#71818B] text-[10px]">Max Notional / Daily Loss</div>
                <div className="text-[#E4EBEF] font-mono tabular-nums mt-0.5">{maxNotional} / {maxDailyLoss}</div>
              </div>
              <div>
                <div className="text-[#71818B] text-[10px]">Triple Barrier</div>
                <div className="text-[#E4EBEF] font-mono mt-0.5">
                  {tbEnabled ? `TP ${tpBps} bps / SL ${slBps} bps / ${maxHoldingSec}s` : 'Nonaktif'}
                </div>
              </div>
              <div>
                <div className="text-[#71818B] text-[10px]">Trailing Stop</div>
                <div className="text-[#E4EBEF] font-mono mt-0.5">
                  {tsEnabled ? `Aktif @ +${tsActivationBps} bps (dist ${tsDistanceBps} bps)` : 'Nonaktif'}
                </div>
              </div>
            </div>

            {isValidating ? (
              <div className="text-xs text-[#A1AFB8]">Memvalidasi skema & batasan market di server...</div>
            ) : validationState ? (
              <div
                className={`p-3 rounded-[8px] border text-xs space-y-1 ${
                  validationState.valid
                    ? 'bg-[#12392F]/50 border-[#35B887]/40 text-[#35B887]'
                    : 'bg-[#401F27]/60 border-[#EA5B65]/40 text-[#EA5B65]'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    {validationState.valid
                      ? 'Validasi Skema JSON v1.0 & Market Constraints Lolos'
                      : 'Konfigurasi Memerlukan Perbaikan'}
                  </span>
                </div>
                {validationState.errors.map((e, i) => (
                  <div key={i} className="text-xs text-[#EA5B65]">• {e}</div>
                ))}
                {validationState.warnings.map((w, i) => (
                  <div key={i} className="text-xs text-[#D6A85C]">• Peringatan: {w}</div>
                ))}
              </div>
            ) : null}

            {mode !== 'BACKTEST' && (
              <label className="flex items-center gap-2 text-xs text-[#E4EBEF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={startOnDeploy}
                  onChange={e => setStartOnDeploy(e.target.checked)}
                  className="accent-[#8DA5B1]"
                />
                <span>Langsung jalankan worker bot setelah dibuat</span>
              </label>
            )}

            {submitError && (
              <div className="p-2.5 rounded-[7px] bg-[#401F27] border border-[#EA5B65]/40 text-xs text-[#EA5B65]">
                {submitError}
              </div>
            )}
          </div>
        )}

        {/* Footer Buttons */}
        <div className="flex items-center justify-between pt-3 border-t border-[#202B34]">
          <Button
            size="sm"
            variant="secondary"
            disabled={step === 0}
            icon={<ChevronLeft className="w-3.5 h-3.5" />}
            onClick={() => setStep(s => Math.max(0, s - 1))}
          >
            Sebelumnya
          </Button>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Batal
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}
              >
                <span>Lanjut</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                variant={mode === 'LIVE' ? 'danger' : 'profit'}
                isLoading={isSubmitting}
                disabled={validationState ? !validationState.valid : false}
                icon={<Play className="w-3.5 h-3.5" />}
                onClick={handleDeploy}
              >
                {mode === 'BACKTEST'
                  ? 'Buka di Backtesting Lab'
                  : startOnDeploy
                    ? `Deploy & Jalankan (${mode})`
                    : `Simpan Draft (${mode})`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
