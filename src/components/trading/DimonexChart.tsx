/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DimonexChart.tsx
 * DIMONEX Professional Chart Terminal powered by Lightweight Charts v5 (Obsidian Iridium).
 * - 7 Chart Types (Candlestick, Hollow Candles, OHLC Bars, Line, Area, Baseline, Heikin Ashi)
 * - 12 Modular Multi-Pane Technical Indicators
 * - 10 Interactive Persistent Drawing Tools
 * - WebSocket-only live updates + Reconnect Delta Resync + Left-Scroll Lazy Pagination (Zero 2.5s polling)
 * - Real Market Overlays (Open Orders, Trade Markers, Avg Entry, Ext Ref, S/R Levels, Price Alerts)
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CandlestickSeries,
  BarSeries,
  LineSeries,
  AreaSeries,
  BaselineSeries,
  HistogramSeries,
  PriceScaleMode,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  SeriesMarker,
  Time,
} from 'lightweight-charts';
import {
  CandlestickChart,
  SlidersHorizontal,
  Layers,
  Pencil,
  Undo2,
  Trash2,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Scan,
  Eye,
  EyeOff,
  X,
  BellPlus,
  Settings2,
} from 'lucide-react';
import { TradingPairItem, TradeItem, CandleItem, OrderItem, UserProfile } from '../../types/index.js';
import { isWebSocketSupported, reportWebSocketSuccess, reportWebSocketFailure } from '../../utils/wsHelper.js';
import { safeBigInt } from '../../lib/formatters.js';
import {
  Timeframe,
  ChartHoverInfo,
  ChartSeriesType,
  IndicatorConfig,
  IndicatorId,
  DrawingToolType,
  ChartDrawing,
  ChartOverlaySettings,
} from './chartTypes.js';
import {
  DEFAULT_INDICATORS,
  mergeIndicators,
  formatIndicatorDisplayLabel,
  computeHeikinAshi,
  computeSMA,
  computeEMA,
  computeVWAP,
  computeBollingerBands,
  computeBollingerBandWidth,
  computeRSI,
  computeMACD,
  computeStochRSI,
  computeATR,
  computeVolumeMA,
  computeOBV,
  computeMFI,
  detectSupportResistanceLevels,
} from './chartIndicators.js';
import { ChartDrawingLayer } from './ChartDrawingLayer.js';

interface DimonexChartProps {
  pair: TradingPairItem;
  recentTrades: TradeItem[];
  timeframe: Timeframe;
  setTimeframe: (tf: Timeframe) => void;
  chartType?: ChartSeriesType;
  onChartTypeChange?: (ct: ChartSeriesType) => void;
  showMAs?: boolean;
  setShowMAs?: (val: boolean | ((prev: boolean) => boolean)) => void;
  showRefBenchmark?: boolean;
  setShowRefBenchmark?: (val: boolean | ((prev: boolean) => boolean)) => void;
  refPriceData?: any;
  openOrders?: OrderItem[];
  user?: UserProfile | null;
  compact?: boolean;
  onHoverInfoChange?: (info: ChartHoverInfo | null) => void;
  indicators?: IndicatorConfig[];
  onIndicatorsChange?: React.Dispatch<React.SetStateAction<IndicatorConfig[]>>;
  onIndicatorValuesChange?: (values: Record<string, string>) => void;
  hideInlineIndicatorLegend?: boolean;
}

export const TF_SECONDS: Record<string, number> = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '6h': 21600,
  '12h': 43200,
  '1d': 86400,
  '1D': 86400,
  '1w': 604800,
  '1W': 604800,
  '1M': 2592000,
};

export const CHART_TYPE_LABELS: Array<{ id: ChartSeriesType; label: string }> = [
  { id: 'CANDLESTICK', label: 'Candles' },
  { id: 'HOLLOW_CANDLES', label: 'Hollow' },
  { id: 'OHLC_BARS', label: 'OHLC Bars' },
  { id: 'LINE', label: 'Line' },
  { id: 'AREA', label: 'Area' },
  { id: 'BASELINE', label: 'Baseline' },
  { id: 'HEIKIN_ASHI', label: 'Heikin Ashi' },
];

const DRAWING_TOOLS: Array<{ id: DrawingToolType; label: string; short: string }> = [
  { id: 'NONE', label: 'Cursor / Pan', short: 'Ptr' },
  { id: 'TREND_LINE', label: 'Trend Line', short: 'Trend' },
  { id: 'HORIZONTAL_LINE', label: 'Horizontal Line', short: 'H-Line' },
  { id: 'VERTICAL_LINE', label: 'Vertical Line', short: 'V-Line' },
  { id: 'RAY', label: 'Ray', short: 'Ray' },
  { id: 'RECTANGLE', label: 'Rectangle', short: 'Rect' },
  { id: 'BRUSH', label: 'Brush', short: 'Brush' },
  { id: 'TEXT', label: 'Text Annotation', short: 'Text' },
  { id: 'FIB_RETRACEMENT', label: 'Fibonacci Retracement', short: 'Fib R' },
  { id: 'FIB_EXTENSION', label: 'Fibonacci Extension', short: 'Fib E' },
  { id: 'PRICE_RANGE', label: 'Price Range Measure', short: 'Range' },
];

const DRAWING_COLORS = ['#8DA5B1', '#D6A85C', '#16A879', '#EA5B65', '#6D9FE8', '#A78BFA'];

const DEFAULT_OVERLAYS: ChartOverlaySettings = {
  showOpenOrders: true,
  showUserTrades: true,
  showAvgEntry: true,
  showPositionPrice: true,
  showRefBenchmark: false,
  showSupportResistance: false,
  showPriceAlerts: true,
};

const SETTINGS_STORAGE_KEY = 'dimonex_pro_chart_settings_v1';

interface SavedChartSettings {
  chartType: ChartSeriesType;
  indicators: IndicatorConfig[];
  overlays: ChartOverlaySettings;
  autoScale: boolean;
  logScale: boolean;
  crosshairMode: 'NORMAL' | 'MAGNET';
  drawingColor: string;
}

function loadSavedSettings(user?: UserProfile | null): SavedChartSettings {
  const userCfg = (user?.preferences as any)?.chartSettings;
  let localCfg: any = null;
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) localCfg = JSON.parse(raw);
  } catch {}
  const src = userCfg && typeof userCfg === 'object' ? userCfg : localCfg || {};
  return {
    chartType: src.chartType || 'CANDLESTICK',
    indicators: mergeIndicators(src.indicators),
    overlays: { ...DEFAULT_OVERLAYS, ...(src.overlays || {}) },
    autoScale: typeof src.autoScale === 'boolean' ? src.autoScale : true,
    logScale: typeof src.logScale === 'boolean' ? src.logScale : false,
    crosshairMode: src.crosshairMode === 'NORMAL' ? 'NORMAL' : 'MAGNET',
    drawingColor: typeof src.drawingColor === 'string' ? src.drawingColor : '#8DA5B1',
  };
}

export const DimonexChart: React.FC<DimonexChartProps> = ({
  pair,
  recentTrades,
  timeframe,
  showRefBenchmark: externalShowRef,
  setShowRefBenchmark: externalSetShowRef,
  refPriceData,
  chartType: controlledChartType,
  onChartTypeChange,
  openOrders = [],
  user,
  compact = false,
  onHoverInfoChange,
  indicators: controlledIndicators,
  onIndicatorsChange,
  onIndicatorValuesChange,
  hideInlineIndicatorLegend = false,
}) => {
  const initialSettings = useMemo(() => loadSavedSettings(user), []);

  const [internalChartType, setInternalChartType] = useState<ChartSeriesType>(initialSettings.chartType);
  const activeChartType = controlledChartType || internalChartType;
  const setActiveChartType = (next: ChartSeriesType) => {
    setInternalChartType(next);
    onChartTypeChange?.(next);
  };

  const [internalIndicators, setInternalIndicators] = useState<IndicatorConfig[]>(initialSettings.indicators);
  const indicators = controlledIndicators ?? internalIndicators;
  const setIndicators: React.Dispatch<React.SetStateAction<IndicatorConfig[]>> = useCallback(
    updater => {
      if (onIndicatorsChange) {
        onIndicatorsChange(updater);
      } else {
        setInternalIndicators(updater);
      }
    },
    [onIndicatorsChange]
  );
  const [overlays, setOverlays] = useState<ChartOverlaySettings>(() => ({
    ...initialSettings.overlays,
    showRefBenchmark: externalShowRef !== undefined ? externalShowRef : initialSettings.overlays.showRefBenchmark,
  }));

  const [autoScale, setAutoScale] = useState<boolean>(initialSettings.autoScale);
  const [logScale, setLogScale] = useState<boolean>(initialSettings.logScale);
  const [crosshairMode, setCrosshairMode] = useState<'NORMAL' | 'MAGNET'>(initialSettings.crosshairMode);

  // Drawing State
  const [activeTool, setActiveTool] = useState<DrawingToolType>('NONE');
  const [drawingColor, setDrawingColor] = useState<string>(initialSettings.drawingColor);
  const [showDrawingBar, setShowDrawingBar] = useState<boolean>(false);
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [undoStack, setUndoStack] = useState<ChartDrawing[][]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);

  // Popovers & Modals
  const [showIndicatorsModal, setShowIndicatorsModal] = useState(false);
  const [indicatorCatFilter, setIndicatorCatFilter] = useState<'ALL' | 'TREND' | 'MOMENTUM' | 'VOLATILITY' | 'VOLUME'>('ALL');
  const [editingIndicatorId, setEditingIndicatorId] = useState<IndicatorId | null>(null);
  const [showOverlaysMenu, setShowOverlaysMenu] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Alerts & User Fill Overlays
  const [userTradesData, setUserTradesData] = useState<{
    trades: Array<{ id: string; side: 'BUY' | 'SELL'; price: string; quantity: string; createdAt: number }>;
    avgEntryPriceUnits: string;
    netPositionUnits: string;
  } | null>(null);
  const [priceAlerts, setPriceAlerts] = useState<Array<{ id: string; thresholdPrice: string; condition: string; name: string }>>([]);
  const [newAlertPrice, setNewAlertPrice] = useState('');
  const [newAlertCond, setNewAlertCond] = useState<'ABOVE_OR_EQUAL' | 'BELOW_OR_EQUAL'>('ABOVE_OR_EQUAL');
  const [alertFeedback, setAlertFeedback] = useState<string | null>(null);

  // Hover & Legend state
  const [isFetching, setIsFetching] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<ChartHoverInfo | null>(null);
  const [indicatorValues, setIndicatorValues] = useState<Record<string, string>>({});

  // Refs for Chart Engine
  const wrapperRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<any>[]>>(new Map());
  const overlayPriceLinesRef = useRef<any[]>([]);

  const isDisposedRef = useRef<boolean>(false);
  const loadRequestIdRef = useRef<number>(0);
  const candlesRef = useRef<CandleItem[]>([]);
  const [candlesTick, setCandlesTick] = useState(0);
  const lastBarRef = useRef<CandleItem | null>(null);
  const processedTradesRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);
  const hasMoreHistoryRef = useRef(true);
  const isFetchingMoreRef = useRef(false);
  const lastPaginateAttemptRef = useRef(0);
  const hasConnectedOnceRef = useRef(false);

  const isUSDT = (pair.quoteCurrency || '').toUpperCase() === 'USDT';
  const quoteDec = pair.quoteDecimals !== undefined && pair.quoteDecimals !== null ? pair.quoteDecimals : isUSDT ? 6 : 2;
  const baseDec = pair.baseDecimals !== undefined && pair.baseDecimals !== null ? pair.baseDecimals : 8;

  const getPrecisionForPrice = useCallback(
    (refPrice: number) => {
      if (!isUSDT && (pair.quoteCurrency || 'IDR').toUpperCase() === 'IDR') return 2;
      if (refPrice > 0 && refPrice < 0.01) return Math.min(8, Math.max(6, quoteDec));
      if (refPrice > 0 && refPrice < 1) return Math.min(8, Math.max(5, quoteDec));
      if (refPrice > 0 && refPrice < 100) return Math.min(6, Math.max(4, quoteDec));
      if (refPrice >= 1000) return 2;
      return Math.min(4, Math.max(2, quoteDec));
    },
    [isUSDT, pair.quoteCurrency, quoteDec]
  );

  const refFloatPrice = Number(safeBigInt(pair.lastPrice)) / 10 ** Math.max(0, quoteDec);
  const displayPrecision = getPrecisionForPrice(refFloatPrice);

  // Sync external ShowRefBenchmark prop if controlled from header
  useEffect(() => {
    if (externalShowRef !== undefined) {
      setOverlays(prev => (prev.showRefBenchmark === externalShowRef ? prev : { ...prev, showRefBenchmark: externalShowRef }));
    }
  }, [externalShowRef]);

  // Hydrate user chartSettings when user logs in
  const hydratedUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user) {
      hydratedUserIdRef.current = null;
      return;
    }
    if (hydratedUserIdRef.current === user.id) return;
    hydratedUserIdRef.current = user.id;
    const saved = (user.preferences as any)?.chartSettings;
    if (saved && typeof saved === 'object') {
      if (!controlledChartType && saved.chartType) setInternalChartType(saved.chartType);
      if (!controlledIndicators && Array.isArray(saved.indicators)) setIndicators(mergeIndicators(saved.indicators));
      if (saved.overlays) setOverlays(prev => ({ ...prev, ...saved.overlays }));
      if (typeof saved.autoScale === 'boolean') setAutoScale(saved.autoScale);
      if (typeof saved.logScale === 'boolean') setLogScale(saved.logScale);
      if (saved.crosshairMode === 'NORMAL' || saved.crosshairMode === 'MAGNET') setCrosshairMode(saved.crosshairMode);
      if (typeof saved.drawingColor === 'string') setDrawingColor(saved.drawingColor);
    }
  }, [user, controlledChartType, controlledIndicators, setIndicators]);

  // Persist chart settings locally + backend debounced
  const prefSaveTimerRef = useRef<any>(null);
  useEffect(() => {
    const payload: SavedChartSettings = {
      chartType: activeChartType,
      indicators,
      overlays,
      autoScale,
      logScale,
      crosshairMode,
      drawingColor,
    };
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    } catch {}

    if (user) {
      if (prefSaveTimerRef.current) clearTimeout(prefSaveTimerRef.current);
      prefSaveTimerRef.current = setTimeout(() => {
        const token = localStorage.getItem('dimonex_auth_token');
        if (!token) return;
        fetch('/api/auth/preferences', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ chartSettings: payload }),
        }).catch(() => {});
      }, 650);
    }
    return () => {
      if (prefSaveTimerRef.current) clearTimeout(prefSaveTimerRef.current);
    };
  }, [activeChartType, indicators, overlays, autoScale, logScale, crosshairMode, drawingColor, user]);

  // Load & Persist Drawings per User + Pair
  const drawingsSaveTimerRef = useRef<any>(null);
  useEffect(() => {
    let active = true;
    setSelectedDrawingId(null);
    setUndoStack([]);

    let localList: ChartDrawing[] = [];
    try {
      const raw = localStorage.getItem(`dimonex_drawings_${pair.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) localList = parsed;
      }
    } catch {}
    setDrawings(localList);

    const token = localStorage.getItem('dimonex_auth_token');
    if (user && token) {
      fetch(`/api/trading/chart-drawings/${pair.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (!active || !Array.isArray(data)) return;
          if (data.length > 0 || localList.length === 0) {
            setDrawings(data);
            try {
              localStorage.setItem(`dimonex_drawings_${pair.id}`, JSON.stringify(data));
            } catch {}
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [pair.id, user]);

  const handleDrawingsChange = useCallback(
    (next: ChartDrawing[], pushUndo = true) => {
      setDrawings(prev => {
        if (pushUndo) {
          setUndoStack(stack => [...stack.slice(-24), prev]);
        }
        return next;
      });
      try {
        localStorage.setItem(`dimonex_drawings_${pair.id}`, JSON.stringify(next));
      } catch {}

      const token = localStorage.getItem('dimonex_auth_token');
      if (user && token) {
        if (drawingsSaveTimerRef.current) clearTimeout(drawingsSaveTimerRef.current);
        drawingsSaveTimerRef.current = setTimeout(() => {
          fetch(`/api/trading/chart-drawings/${pair.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ drawings: next }),
          }).catch(() => {});
        }, 350);
      }
    },
    [pair.id, user]
  );

  const handleUndoDrawing = useCallback(() => {
    setUndoStack(stack => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1];
      setDrawings(previous);
      try {
        localStorage.setItem(`dimonex_drawings_${pair.id}`, JSON.stringify(previous));
      } catch {}
      const token = localStorage.getItem('dimonex_auth_token');
      if (user && token) {
        fetch(`/api/trading/chart-drawings/${pair.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ drawings: previous }),
        }).catch(() => {});
      }
      return stack.slice(0, -1);
    });
  }, [pair.id, user]);

  const handleDeleteSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) return;
    handleDrawingsChange(drawings.filter(d => d.id !== selectedDrawingId), true);
    setSelectedDrawingId(null);
  }, [selectedDrawingId, drawings, handleDrawingsChange]);

  const handleClearDrawings = useCallback(() => {
    if (drawings.length === 0) return;
    handleDrawingsChange([], true);
    setSelectedDrawingId(null);
  }, [drawings.length, handleDrawingsChange]);

  // Keyboard shortcuts for Delete / Undo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
        e.preventDefault();
        handleDeleteSelectedDrawing();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undoStack.length > 0) {
        e.preventDefault();
        handleUndoDrawing();
      } else if (e.key === 'Escape') {
        setActiveTool('NONE');
        setSelectedDrawingId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedDrawingId, undoStack.length, handleDeleteSelectedDrawing, handleUndoDrawing]);

  // Helper: sync all series & indicators with current candlesRef.current
  const syncMainAndVolumeData = useCallback(
    (bars: CandleItem[]) => {
      if (isDisposedRef.current || !mainSeriesRef.current || !volumeSeriesRef.current || bars.length === 0) return;

      const sampleClose = bars[bars.length - 1]?.close || refFloatPrice;
      const dynPrec = getPrecisionForPrice(sampleClose);
      const dynMinMove = Number((1 / Math.pow(10, dynPrec)).toFixed(dynPrec));
      const dynFormat = { type: 'price' as const, precision: dynPrec, minMove: dynMinMove };

      try {
        mainSeriesRef.current.applyOptions({ priceFormat: dynFormat });
      } catch {}

      const displayBars = activeChartType === 'HEIKIN_ASHI' ? computeHeikinAshi(bars) : bars;

      if (activeChartType === 'LINE' || activeChartType === 'AREA' || activeChartType === 'BASELINE') {
        if (activeChartType === 'BASELINE') {
          try {
            mainSeriesRef.current.applyOptions({
              baseValue: { type: 'price', price: displayBars[0].close },
            });
          } catch {}
        }
        mainSeriesRef.current.setData(
          displayBars.map(c => ({ time: c.time as Time, value: c.close }))
        );
      } else {
        mainSeriesRef.current.setData(
          displayBars.map(c => ({
            time: c.time as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }))
        );
      }

      volumeSeriesRef.current.setData(
        bars.map(c => ({
          time: c.time as Time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(22, 168, 121, 0.42)' : 'rgba(234, 91, 101, 0.42)',
        }))
      );
    },
    [activeChartType, getPrecisionForPrice, refFloatPrice]
  );

  // Sync indicator series data & compute latest legend readouts
  const syncIndicatorsData = useCallback(
    (bars: CandleItem[]) => {
      if (isDisposedRef.current || !chartRef.current || bars.length === 0) return;
      const nextReadouts: Record<string, string> = {};
      const sampleClose = bars[bars.length - 1]?.close || refFloatPrice;
      const dynPrec = getPrecisionForPrice(sampleClose);
      const dynMinMove = Number((1 / Math.pow(10, dynPrec)).toFixed(dynPrec));
      const dynFormat = { type: 'price' as const, precision: dynPrec, minMove: dynMinMove };

      for (const cfg of indicators) {
        if (!cfg.enabled || cfg.visible === false) continue;
        const seriesList = indicatorSeriesRef.current.get(cfg.id);
        if (!seriesList || seriesList.length === 0) continue;

        try {
          switch (cfg.id) {
            case 'SMA': {
              const pts = computeSMA(bars, cfg.params.period ?? 7);
              seriesList[0].applyOptions({ priceFormat: dynFormat });
              seriesList[0].setData(pts.map(p => ({ time: p.time as Time, value: p.value })));
              if (pts.length > 0) nextReadouts[cfg.id] = pts[pts.length - 1].value.toFixed(dynPrec);
              break;
            }
            case 'EMA': {
              const pts = computeEMA(bars, cfg.params.period ?? 25);
              seriesList[0].applyOptions({ priceFormat: dynFormat });
              seriesList[0].setData(pts.map(p => ({ time: p.time as Time, value: p.value })));
              if (pts.length > 0) nextReadouts[cfg.id] = pts[pts.length - 1].value.toFixed(dynPrec);
              break;
            }
            case 'VWAP': {
              const pts = computeVWAP(bars);
              seriesList[0].applyOptions({ priceFormat: dynFormat });
              seriesList[0].setData(pts.map(p => ({ time: p.time as Time, value: p.value })));
              if (pts.length > 0) nextReadouts[cfg.id] = pts[pts.length - 1].value.toFixed(dynPrec);
              break;
            }
            case 'BB': {
              const pts = computeBollingerBands(bars, cfg.params.period ?? 20, cfg.params.stdDev ?? 2);
              seriesList.forEach(s => s.applyOptions({ priceFormat: dynFormat }));
              seriesList[0].setData(pts.map(p => ({ time: p.time as Time, value: p.upper })));
              seriesList[1].setData(pts.map(p => ({ time: p.time as Time, value: p.middle })));
              seriesList[2].setData(pts.map(p => ({ time: p.time as Time, value: p.lower })));
              if (pts.length > 0) {
                const last = pts[pts.length - 1];
                nextReadouts[cfg.id] = `${last.upper.toFixed(dynPrec)} / ${last.lower.toFixed(dynPrec)}`;
              }
              break;
            }
            case 'VOL_MA': {
              const pts = computeVolumeMA(bars, cfg.params.period ?? 20);
              seriesList[0].setData(pts.map(p => ({ time: p.time as Time, value: p.value })));
              if (pts.length > 0) nextReadouts[cfg.id] = pts[pts.length - 1].value.toFixed(2);
              break;
            }
            case 'RSI': {
              const pts = computeRSI(bars, cfg.params.period ?? 14);
              seriesList[0].setData(pts.map(p => ({ time: p.time as Time, value: p.value })));
              if (pts.length > 0) nextReadouts[cfg.id] = pts[pts.length - 1].value.toFixed(2);
              break;
            }
            case 'MACD': {
              const pts = computeMACD(bars, cfg.params.fast ?? 12, cfg.params.slow ?? 26, cfg.params.signal ?? 9);
              seriesList[0].setData(
                pts.map(p => ({
                  time: p.time as Time,
                  value: p.histogram,
                  color: p.histogram >= 0 ? 'rgba(22, 168, 121, 0.55)' : 'rgba(234, 91, 101, 0.55)',
                }))
              );
              seriesList[1].setData(pts.map(p => ({ time: p.time as Time, value: p.macd })));
              seriesList[2].setData(pts.map(p => ({ time: p.time as Time, value: p.signal })));
              if (pts.length > 0) {
                const last = pts[pts.length - 1];
                nextReadouts[cfg.id] = `${last.macd.toFixed(dynPrec)} / ${last.signal.toFixed(dynPrec)}`;
              }
              break;
            }
            case 'STOCH_RSI': {
              const pts = computeStochRSI(
                bars,
                cfg.params.rsiPeriod ?? 14,
                cfg.params.stochPeriod ?? 14,
                cfg.params.kPeriod ?? 3,
                cfg.params.dPeriod ?? 3
              );
              seriesList[0].setData(pts.map(p => ({ time: p.time as Time, value: p.k })));
              seriesList[1].setData(pts.map(p => ({ time: p.time as Time, value: p.d })));
              if (pts.length > 0) {
                const last = pts[pts.length - 1];
                nextReadouts[cfg.id] = `K:${last.k.toFixed(1)} D:${last.d.toFixed(1)}`;
              }
              break;
            }
            case 'ATR': {
              const pts = computeATR(bars, cfg.params.period ?? 14);
              seriesList[0].applyOptions({ priceFormat: dynFormat });
              seriesList[0].setData(pts.map(p => ({ time: p.time as Time, value: p.value })));
              if (pts.length > 0) nextReadouts[cfg.id] = pts[pts.length - 1].value.toFixed(dynPrec);
              break;
            }
            case 'BBW': {
              const pts = computeBollingerBandWidth(bars, cfg.params.period ?? 20, cfg.params.stdDev ?? 2);
              seriesList[0].setData(pts.map(p => ({ time: p.time as Time, value: p.value })));
              if (pts.length > 0) nextReadouts[cfg.id] = `${pts[pts.length - 1].value.toFixed(2)}%`;
              break;
            }
            case 'OBV': {
              const pts = computeOBV(bars);
              seriesList[0].setData(pts.map(p => ({ time: p.time as Time, value: p.value })));
              if (pts.length > 0) nextReadouts[cfg.id] = pts[pts.length - 1].value.toFixed(2);
              break;
            }
            case 'MFI': {
              const pts = computeMFI(bars, cfg.params.period ?? 14);
              seriesList[0].setData(pts.map(p => ({ time: p.time as Time, value: p.value })));
              if (pts.length > 0) nextReadouts[cfg.id] = pts[pts.length - 1].value.toFixed(2);
              break;
            }
          }
        } catch (err: any) {
          if (err?.message?.includes('disposed')) return;
        }
      }
      setIndicatorValues(nextReadouts);
      onIndicatorValuesChange?.(nextReadouts);
    },
    [indicators, getPrecisionForPrice, refFloatPrice, onIndicatorValuesChange]
  );

  // Build / rebuild main series when activeChartType changes without losing bars
  const buildMainSeries = useCallback(
    (chart: IChartApi) => {
      if (markersPluginRef.current) {
        try {
          markersPluginRef.current.detach();
        } catch {}
        markersPluginRef.current = null;
      }
      for (const pl of overlayPriceLinesRef.current) {
        try {
          mainSeriesRef.current?.removePriceLine(pl);
        } catch {}
      }
      overlayPriceLinesRef.current = [];

      if (mainSeriesRef.current) {
        try {
          chart.removeSeries(mainSeriesRef.current);
        } catch {}
        mainSeriesRef.current = null;
      }

      const minMove = Number((1 / Math.pow(10, displayPrecision)).toFixed(displayPrecision));
      const priceFormat = { type: 'price' as const, precision: displayPrecision, minMove };

      let s: ISeriesApi<any>;
      switch (activeChartType) {
        case 'HOLLOW_CANDLES':
          s = chart.addSeries(CandlestickSeries, {
            upColor: 'rgba(9, 13, 18, 0)',
            downColor: '#EA5B65',
            borderVisible: true,
            borderUpColor: '#16A879',
            borderDownColor: '#EA5B65',
            wickUpColor: '#16A879',
            wickDownColor: '#EA5B65',
            priceFormat,
          }, 0);
          break;
        case 'OHLC_BARS':
          s = chart.addSeries(BarSeries, {
            upColor: '#16A879',
            downColor: '#EA5B65',
            thinBars: false,
            priceFormat,
          }, 0);
          break;
        case 'LINE':
          s = chart.addSeries(LineSeries, {
            color: '#8DA5B1',
            lineWidth: 2,
            priceFormat,
          }, 0);
          break;
        case 'AREA':
          s = chart.addSeries(AreaSeries, {
            lineColor: '#6D9FE8',
            topColor: 'rgba(109, 159, 232, 0.28)',
            bottomColor: 'rgba(109, 159, 232, 0.02)',
            lineWidth: 2,
            priceFormat,
          }, 0);
          break;
        case 'BASELINE':
          s = chart.addSeries(BaselineSeries, {
            baseValue: { type: 'price', price: refFloatPrice || 1 },
            topLineColor: '#16A879',
            topFillColor1: 'rgba(22, 168, 121, 0.24)',
            topFillColor2: 'rgba(22, 168, 121, 0.02)',
            bottomLineColor: '#EA5B65',
            bottomFillColor1: 'rgba(234, 91, 101, 0.02)',
            bottomFillColor2: 'rgba(234, 91, 101, 0.24)',
            lineWidth: 2,
            priceFormat,
          }, 0);
          break;
        case 'HEIKIN_ASHI':
        case 'CANDLESTICK':
        default:
          s = chart.addSeries(CandlestickSeries, {
            upColor: '#16A879',
            downColor: '#EA5B65',
            borderVisible: false,
            wickUpColor: '#16A879',
            wickDownColor: '#EA5B65',
            priceFormat,
          }, 0);
          break;
      }

      mainSeriesRef.current = s;
      markersPluginRef.current = createSeriesMarkers(s, []);
      if (candlesRef.current.length > 0) {
        syncMainAndVolumeData(candlesRef.current);
      }
    },
    [activeChartType, displayPrecision, refFloatPrice, syncMainAndVolumeData]
  );

  // Build / rebuild indicator series & sub-panes cleanly
  const rebuildIndicators = useCallback(
    (chart: IChartApi) => {
      // Remove all existing indicator series
      for (const list of indicatorSeriesRef.current.values()) {
        for (const ser of list) {
          try {
            chart.removeSeries(ser);
          } catch {}
        }
      }
      indicatorSeriesRef.current.clear();

      // Remove any leftover sub-panes cleanly
      try {
        while (chart.panes().length > 1) {
          chart.removePane(chart.panes().length - 1);
        }
      } catch {}

      let nextPaneIdx = 1;
      for (const cfg of indicators) {
        if (!cfg.enabled || cfg.visible === false) continue;
        const created: ISeriesApi<any>[] = [];

        if (cfg.overlay) {
          if (cfg.id === 'BB') {
            created.push(
              chart.addSeries(LineSeries, { color: cfg.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 0),
              chart.addSeries(LineSeries, { color: '#94A3B8', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false }, 0),
              chart.addSeries(LineSeries, { color: cfg.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 0)
            );
          } else if (cfg.id === 'VOL_MA') {
            const volMaSer = chart.addSeries(
              LineSeries,
              { color: cfg.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceScaleId: '' },
              0
            );
            volMaSer.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
            created.push(volMaSer);
          } else {
            created.push(
              chart.addSeries(LineSeries, { color: cfg.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, 0)
            );
          }
        } else {
          const paneIdx = nextPaneIdx++;
          if (cfg.id === 'MACD') {
            created.push(
              chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIdx),
              chart.addSeries(LineSeries, { color: cfg.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, paneIdx),
              chart.addSeries(LineSeries, { color: '#F59E0B', lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, paneIdx)
            );
          } else if (cfg.id === 'STOCH_RSI') {
            const kSer = chart.addSeries(LineSeries, { color: cfg.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, paneIdx);
            const dSer = chart.addSeries(LineSeries, { color: '#F59E0B', lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, paneIdx);
            kSer.createPriceLine({ price: 80, color: 'rgba(234, 91, 101, 0.35)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
            kSer.createPriceLine({ price: 20, color: 'rgba(22, 168, 121, 0.35)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
            created.push(kSer, dSer);
          } else if (cfg.id === 'RSI' || cfg.id === 'MFI') {
            const osc = chart.addSeries(LineSeries, { color: cfg.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, paneIdx);
            const topLvl = cfg.id === 'RSI' ? 70 : 80;
            const botLvl = cfg.id === 'RSI' ? 30 : 20;
            osc.createPriceLine({ price: topLvl, color: 'rgba(234, 91, 101, 0.35)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
            osc.createPriceLine({ price: botLvl, color: 'rgba(22, 168, 121, 0.35)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
            created.push(osc);
          } else {
            created.push(
              chart.addSeries(LineSeries, { color: cfg.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, paneIdx)
            );
          }
        }
        indicatorSeriesRef.current.set(cfg.id, created);
      }

      try {
        const panes = chart.panes();
        panes.forEach((p, idx) => {
          if (idx > 0) p.setHeight(compact ? 74 : 94);
        });
      } catch {}

      if (candlesRef.current.length > 0) {
        syncIndicatorsData(candlesRef.current);
      }
    },
    [indicators, compact, syncIndicatorsData]
  );

  // Merge new bars (from historical pagination or reconnect delta) cleanly
  const mergeCandles = useCallback((incoming: CandleItem[]) => {
    const map = new Map<number, CandleItem>();
    for (const c of candlesRef.current) map.set(c.time, c);
    for (const c of incoming) map.set(c.time, c);
    const merged = Array.from(map.values()).sort((a, b) => a.time - b.time);
    candlesRef.current = merged;
    lastBarRef.current = merged[merged.length - 1] || null;
    setCandlesTick(t => t + 1);
    return merged;
  }, []);

  // Process single live trade (deduplicated by trade.id)
  const processSingleTrade = useCallback(
    (trade: TradeItem) => {
      if (!trade || trade.pairId !== pair.id) return;
      if (isDisposedRef.current || !chartRef.current || !mainSeriesRef.current || !volumeSeriesRef.current) return;
      if (processedTradesRef.current.has(trade.id)) return;
      processedTradesRef.current.add(trade.id);
      if (processedTradesRef.current.size > 3000) {
        processedTradesRef.current = new Set(Array.from(processedTradesRef.current).slice(-1500));
      }

      try {
        const divisor = 10n ** BigInt(quoteDec);
        const rawPrice = safeBigInt(trade.price);
        if (rawPrice <= 0n) return;
        const tradePrice = Number(rawPrice) / Number(divisor);
        const tradeQty = Number(safeBigInt(trade.quantity)) / 10 ** baseDec;
        const tradeSec = Math.floor(trade.createdAt / 1000);
        const intervalSec = TF_SECONDS[timeframe] || 900;
        const currentCandleTime = Math.floor(tradeSec / intervalSec) * intervalSec;

        const last = lastBarRef.current;
        if (!last || currentCandleTime > last.time) {
          const newBar: CandleItem = {
            time: currentCandleTime,
            open: last ? last.close : tradePrice,
            high: Math.max(last ? last.close : tradePrice, tradePrice),
            low: Math.min(last ? last.close : tradePrice, tradePrice),
            close: tradePrice,
            volume: tradeQty,
          };
          lastBarRef.current = newBar;
          candlesRef.current.push(newBar);
        } else if (currentCandleTime === last.time) {
          last.high = Math.max(last.high, tradePrice);
          last.low = Math.min(last.low, tradePrice);
          last.close = tradePrice;
          last.volume = Number((last.volume + tradeQty).toFixed(6));
        }

        const activeBars = candlesRef.current;
        const displayBars = activeChartType === 'HEIKIN_ASHI' ? computeHeikinAshi(activeBars) : activeBars;
        const latestDisplay = displayBars[displayBars.length - 1];
        const latestRaw = activeBars[activeBars.length - 1];

        if (latestDisplay && latestRaw) {
          if (activeChartType === 'LINE' || activeChartType === 'AREA' || activeChartType === 'BASELINE') {
            mainSeriesRef.current.update({ time: latestDisplay.time as Time, value: latestDisplay.close });
          } else {
            mainSeriesRef.current.update({
              time: latestDisplay.time as Time,
              open: latestDisplay.open,
              high: latestDisplay.high,
              low: latestDisplay.low,
              close: latestDisplay.close,
            });
          }
          volumeSeriesRef.current.update({
            time: latestRaw.time as Time,
            value: latestRaw.volume,
            color: latestRaw.close >= latestRaw.open ? 'rgba(22, 168, 121, 0.42)' : 'rgba(234, 91, 101, 0.42)',
          });
        }

        syncIndicatorsData(activeBars);
        setCandlesTick(t => t + 1);
      } catch (err: any) {
        if (err?.message?.includes('disposed')) return;
      }
    },
    [pair.id, quoteDec, baseDec, timeframe, activeChartType, syncIndicatorsData]
  );

  // Initial historical REST load (only on mount / pair / timeframe change; NEVER polled!)
  const loadInitialCandles = useCallback(async () => {
    const reqId = ++loadRequestIdRef.current;
    setIsFetching(true);
    hasMoreHistoryRef.current = true;

    try {
      const res = await fetch(`/api/trading/candles/${pair.id}?timeframe=${timeframe}&limit=250`);
      if (!res.ok) return;
      let data: CandleItem[] = await res.json();
      if (isDisposedRef.current || reqId !== loadRequestIdRef.current) return;
      if (!chartRef.current || !mainSeriesRef.current || !volumeSeriesRef.current) return;

      if ((!data || data.length === 0) && pair.lastPrice) {
        const divisor = 10n ** BigInt(quoteDec);
        const pNum = Number(safeBigInt(pair.lastPrice)) / Number(divisor);
        if (pNum > 0) {
          const nowSec = Math.floor(Date.now() / 1000);
          const interval = TF_SECONDS[timeframe] || 900;
          const t = Math.floor(nowSec / interval) * interval;
          data = [{ time: t, open: pNum, high: pNum, low: pNum, close: pNum, volume: 0 }];
        }
      }

      if (Array.isArray(data) && data.length > 0) {
        candlesRef.current = data;
        lastBarRef.current = data[data.length - 1];
        setCandlesTick(t => t + 1);
        syncMainAndVolumeData(data);
        syncIndicatorsData(data);
      }

      if (isFirstLoadRef.current) {
        isFirstLoadRef.current = false;
        try {
          chartRef.current?.timeScale().fitContent();
        } catch {}
      }
    } catch (err: any) {
      if (isDisposedRef.current || reqId !== loadRequestIdRef.current) return;
    } finally {
      if (reqId === loadRequestIdRef.current && !isDisposedRef.current) {
        setIsFetching(false);
      }
    }
  }, [pair.id, pair.lastPrice, quoteDec, timeframe, syncMainAndVolumeData, syncIndicatorsData]);

  // Left-scroll lazy pagination when panning towards oldest visible bar
  const loadOlderCandles = useCallback(async () => {
    if (isDisposedRef.current || isFetchingMoreRef.current || !hasMoreHistoryRef.current) return;
    const oldest = candlesRef.current[0];
    if (!oldest) return;
    const now = Date.now();
    if (now - lastPaginateAttemptRef.current < 450) return;
    lastPaginateAttemptRef.current = now;

    isFetchingMoreRef.current = true;
    setIsFetchingMore(true);
    try {
      const interval = TF_SECONDS[timeframe] || 900;
      const beforeSec = oldest.time - interval;
      const res = await fetch(
        `/api/trading/candles/${pair.id}?timeframe=${timeframe}&before=${beforeSec}&limit=200`
      );
      if (!res.ok || isDisposedRef.current) return;
      const older: CandleItem[] = await res.json();
      if (!Array.isArray(older) || older.length === 0) {
        hasMoreHistoryRef.current = false;
        return;
      }
      const prevLen = candlesRef.current.length;
      const merged = mergeCandles(older);
      if (merged.length === prevLen) {
        hasMoreHistoryRef.current = false;
        return;
      }
      syncMainAndVolumeData(merged);
      syncIndicatorsData(merged);
    } catch {
      // quiet
    } finally {
      isFetchingMoreRef.current = false;
      if (!isDisposedRef.current) setIsFetchingMore(false);
    }
  }, [pair.id, timeframe, mergeCandles, syncMainAndVolumeData, syncIndicatorsData]);

  // Delta resync on WebSocket reconnect
  const resyncReconnectDelta = useCallback(async () => {
    if (isDisposedRef.current || !lastBarRef.current) return;
    try {
      const interval = TF_SECONDS[timeframe] || 900;
      const fromSec = Math.max(0, lastBarRef.current.time - interval * 3);
      const res = await fetch(
        `/api/trading/candles/${pair.id}?timeframe=${timeframe}&from=${fromSec}&limit=200`
      );
      if (!res.ok || isDisposedRef.current) return;
      const delta: CandleItem[] = await res.json();
      if (Array.isArray(delta) && delta.length > 0) {
        const merged = mergeCandles(delta);
        syncMainAndVolumeData(merged);
        syncIndicatorsData(merged);
      }
    } catch {}
  }, [pair.id, timeframe, mergeCandles, syncMainAndVolumeData, syncIndicatorsData]);

  // Reset per-pair tracking
  useEffect(() => {
    processedTradesRef.current.clear();
    isFirstLoadRef.current = true;
    hasMoreHistoryRef.current = true;
    candlesRef.current = [];
    lastBarRef.current = null;
  }, [pair.id]);

  // Apply external recentTrades prop cleanly (no polling needed)
  useEffect(() => {
    if (!recentTrades || recentTrades.length === 0 || isDisposedRef.current) return;
    const sorted = [...recentTrades].sort((a, b) => a.createdAt - b.createdAt);
    for (const trade of sorted) {
      if (trade.pairId === pair.id) processSingleTrade(trade);
    }
  }, [recentTrades, pair.id, processSingleTrade]);

  // Reload candles when timeframe changes
  useEffect(() => {
    isFirstLoadRef.current = true;
    loadInitialCandles();
  }, [timeframe, loadInitialCandles]);

  // Create & manage Lightweight Charts v5 instance on pair change
  useEffect(() => {
    if (!chartContainerRef.current) return;

    isDisposedRef.current = false;
    chartContainerRef.current.innerHTML = '';

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#090D12' },
        textColor: '#A1AFB8',
        fontSize: 11,
        fontFamily: 'IBM Plex Mono, Inter, sans-serif',
        panes: {
          separatorColor: '#202B34',
          separatorHoverColor: '#40515D',
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: '#202B34' },
        horzLines: { color: '#202B34' },
      },
      crosshair: {
        mode: crosshairMode === 'MAGNET' ? CrosshairMode.Magnet : CrosshairMode.Normal,
        vertLine: {
          color: '#40515D',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1D2832',
        },
        horzLine: {
          color: '#40515D',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1D2832',
        },
      },
      timeScale: {
        borderColor: '#202B34',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 9,
        minBarSpacing: 3,
      },
      rightPriceScale: {
        borderColor: '#202B34',
        autoScale,
        mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: {
          top: 0.08,
          bottom: 0.22,
        },
      },
    });

    const volumeSeries = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      },
      0
    );
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    volumeSeriesRef.current = volumeSeries;

    buildMainSeries(chart);
    rebuildIndicators(chart);

    const rangeSub = (logicalRange: any) => {
      if (isDisposedRef.current || !logicalRange) return;
      if (logicalRange.from < 8 && candlesRef.current.length > 0) {
        loadOlderCandles();
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeSub);

    chart.subscribeCrosshairMove(param => {
      if (isDisposedRef.current) return;
      if (
        param.point === undefined ||
        !param.time ||
        !chartContainerRef.current ||
        param.point.x < 0 ||
        param.point.x > chartContainerRef.current.clientWidth ||
        param.point.y < 0 ||
        param.point.y > chartContainerRef.current.clientHeight
      ) {
        setHoverInfo(null);
        onHoverInfoChange?.(null);
      } else if (mainSeriesRef.current) {
        const sData = param.seriesData.get(mainSeriesRef.current) as any;
        const vData = volumeSeriesRef.current ? (param.seriesData.get(volumeSeriesRef.current) as any) : null;
        if (sData) {
          const valFallback = typeof sData.value === 'number' ? sData.value : 0;
          const open = typeof sData.open === 'number' ? sData.open : valFallback;
          const high = typeof sData.high === 'number' ? sData.high : valFallback;
          const low = typeof sData.low === 'number' ? sData.low : valFallback;
          const close = typeof sData.close === 'number' ? sData.close : valFallback;
          const volume = vData ? vData.value || 0 : 0;
          const changePercent = open > 0 ? ((close - open) / open) * 100 : 0;
          const date = new Date(Number(param.time) * 1000);
          const timeStr = date.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });

          const info: ChartHoverInfo = {
            timeStr,
            open,
            high,
            low,
            close,
            changePercent,
            volume,
          };
          setHoverInfo(info);
          onHoverInfoChange?.(info);
        }
      }
    });

    const handleResize = () => {
      if (!isDisposedRef.current && chartContainerRef.current && chartRef.current) {
        try {
          const nextWidth = chartContainerRef.current.clientWidth;
          const nextHeight = chartContainerRef.current.clientHeight;
          if (nextWidth > 0 && nextHeight > 0) {
            chartRef.current.applyOptions({ width: nextWidth, height: nextHeight });
          }
        } catch {}
      }
    };
    window.addEventListener('resize', handleResize);
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && chartContainerRef.current) {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(chartContainerRef.current);
    }

    loadInitialCandles();

    return () => {
      isDisposedRef.current = true;
      loadRequestIdRef.current++;
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeSub);
      } catch {}
      if (markersPluginRef.current) {
        try {
          markersPluginRef.current.detach();
        } catch {}
        markersPluginRef.current = null;
      }
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch {}
        chartRef.current = null;
      }
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
      indicatorSeriesRef.current.clear();
      overlayPriceLinesRef.current = [];
    };
  }, [pair.id]);

  // Rebuild main series dynamically when chartType changes
  useEffect(() => {
    if (!isDisposedRef.current && chartRef.current) {
      buildMainSeries(chartRef.current);
    }
  }, [activeChartType, buildMainSeries]);

  // Rebuild indicators cleanly when config toggles/params change
  useEffect(() => {
    if (!isDisposedRef.current && chartRef.current) {
      rebuildIndicators(chartRef.current);
    }
  }, [indicators, rebuildIndicators]);

  // Apply price scale & crosshair options cleanly
  useEffect(() => {
    if (isDisposedRef.current || !chartRef.current) return;
    try {
      chartRef.current.priceScale('right').applyOptions({
        autoScale,
        mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      });
      chartRef.current.applyOptions({
        crosshair: {
          mode: crosshairMode === 'MAGNET' ? CrosshairMode.Magnet : CrosshairMode.Normal,
        },
      });
    } catch {}
  }, [autoScale, logScale, crosshairMode]);

  // Fetch user's real trade fills & avg entry when authenticated & overlay active
  useEffect(() => {
    const needUserTrades =
      Boolean(user) && (overlays.showUserTrades || overlays.showAvgEntry || overlays.showPositionPrice);
    if (!needUserTrades) {
      setUserTradesData(null);
      return;
    }
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    let active = true;
    fetch(`/api/trading/my-trades/${pair.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (active && data && Array.isArray(data.trades)) {
          setUserTradesData(data);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pair.id, user, overlays.showUserTrades, overlays.showAvgEntry, overlays.showPositionPrice, candlesTick]);

  // Fetch user's real Price Alerts
  const fetchPriceAlerts = useCallback(() => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!user || !token) {
      setPriceAlerts([]);
      return;
    }
    fetch(`/api/trading/price-alerts/${pair.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        if (Array.isArray(data)) setPriceAlerts(data);
      })
      .catch(() => {});
  }, [pair.id, user]);

  useEffect(() => {
    fetchPriceAlerts();
  }, [fetchPriceAlerts]);

  // Render Market Overlays (Open Orders, Trade Markers, Avg Entry, Position, Ext Ref, Support/Resistance, Price Alerts)
  useEffect(() => {
    if (isDisposedRef.current || !mainSeriesRef.current) return;
    const series = mainSeriesRef.current;

    // Clear previous price lines
    for (const pl of overlayPriceLinesRef.current) {
      try {
        series.removePriceLine(pl);
      } catch {}
    }
    overlayPriceLinesRef.current = [];

    const quoteDivisor = 10 ** Math.max(0, quoteDec);
    const intervalSec = TF_SECONDS[timeframe] || 900;

    // 1. User Open Orders
    if (overlays.showOpenOrders && Array.isArray(openOrders)) {
      for (const ord of openOrders) {
        if (ord.pairId !== pair.id) continue;
        if (ord.status !== 'NEW' && ord.status !== 'PARTIALLY_FILLED') continue;
        const pVal = Number(safeBigInt(ord.price)) / quoteDivisor;
        if (!(pVal > 0)) continue;
        try {
          const line = series.createPriceLine({
            price: pVal,
            color: ord.side === 'BUY' ? '#16A879' : '#EA5B65',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `${ord.side} LMT`,
          });
          overlayPriceLinesRef.current.push(line);
        } catch {}
      }
    }

    // 2. Average Entry & Net Position Line (Real Fills)
    if (userTradesData) {
      const avgVal = Number(safeBigInt(userTradesData.avgEntryPriceUnits)) / quoteDivisor;
      const netPos = safeBigInt(userTradesData.netPositionUnits);
      if (overlays.showAvgEntry && avgVal > 0) {
        try {
          overlayPriceLinesRef.current.push(
            series.createPriceLine({
              price: avgVal,
              color: '#D6A85C',
              lineWidth: 1,
              lineStyle: 3,
              axisLabelVisible: true,
              title: 'AVG ENTRY',
            })
          );
        } catch {}
      }
      if (overlays.showPositionPrice && netPos !== 0n && avgVal > 0) {
        const qtyDisplay = (Number(netPos) / 10 ** baseDec).toFixed(Math.min(4, baseDec));
        try {
          overlayPriceLinesRef.current.push(
            series.createPriceLine({
              price: avgVal,
              color: netPos > 0n ? '#38BDF8' : '#F472B6',
              lineWidth: 1,
              lineStyle: 0,
              axisLabelVisible: true,
              title: `POS ${qtyDisplay} ${pair.baseCurrency}`,
            })
          );
        } catch {}
      }
    }

    // 3. External Reference Benchmark
    if (overlays.showRefBenchmark && refPriceData && refPriceData.effectiveIdrPrice > 0) {
      const benchmarkVal = isUSDT ? refPriceData.effectiveUsdtPrice || 0 : refPriceData.effectiveIdrPrice || 0;
      if (benchmarkVal > 0) {
        try {
          overlayPriceLinesRef.current.push(
            series.createPriceLine({
              price: benchmarkVal,
              color: '#8DA5B1',
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
              title: `EXT REF (${refPriceData.activeProvider?.toUpperCase() || 'AGG'})`,
            })
          );
        } catch {}
      }
    }

    // 4. Support & Resistance (Real OHLCV Pivot Levels)
    if (overlays.showSupportResistance && candlesRef.current.length >= 15) {
      const srLevels = detectSupportResistanceLevels(candlesRef.current, 5, 2);
      for (const lvl of srLevels) {
        try {
          overlayPriceLinesRef.current.push(
            series.createPriceLine({
              price: lvl.price,
              color: lvl.kind === 'SUPPORT' ? 'rgba(22, 168, 121, 0.75)' : 'rgba(234, 91, 101, 0.75)',
              lineWidth: 1,
              lineStyle: 1,
              axisLabelVisible: true,
              title: `${lvl.kind === 'SUPPORT' ? 'SUP' : 'RES'} (${lvl.touches})`,
            })
          );
        } catch {}
      }
    }

    // 5. Real Price Alerts
    if (overlays.showPriceAlerts && priceAlerts.length > 0) {
      for (const al of priceAlerts) {
        const pVal = Number(safeBigInt(al.thresholdPrice)) / quoteDivisor;
        if (!(pVal > 0)) continue;
        try {
          overlayPriceLinesRef.current.push(
            series.createPriceLine({
              price: pVal,
              color: '#F59E0B',
              lineWidth: 1,
              lineStyle: 2,
              axisLabelVisible: true,
              title: `ALERT`,
            })
          );
        } catch {}
      }
    }

    // 6. User Trade Execution Markers
    if (markersPluginRef.current) {
      if (overlays.showUserTrades && userTradesData && userTradesData.trades.length > 0) {
        const markers: SeriesMarker<Time>[] = userTradesData.trades
          .map(t => {
            const barSec = Math.floor(Math.floor(t.createdAt / 1000) / intervalSec) * intervalSec;
            return {
              time: barSec as Time,
              position: t.side === 'BUY' ? ('belowBar' as const) : ('aboveBar' as const),
              color: t.side === 'BUY' ? '#16A879' : '#EA5B65',
              shape: t.side === 'BUY' ? ('arrowUp' as const) : ('arrowDown' as const),
              text: t.side === 'BUY' ? 'B' : 'S',
            };
          })
          .sort((a, b) => Number(a.time) - Number(b.time));
        try {
          markersPluginRef.current.setMarkers(markers);
        } catch {}
      } else {
        try {
          markersPluginRef.current.setMarkers([]);
        } catch {}
      }
    }
  }, [
    pair.id,
    pair.baseCurrency,
    quoteDec,
    baseDec,
    isUSDT,
    timeframe,
    activeChartType,
    overlays,
    openOrders,
    userTradesData,
    refPriceData,
    priceAlerts,
    candlesTick,
  ]);

  // WebSocket-only Real-Time Subscription + Reconnect Delta Resync
  useEffect(() => {
    if (!isWebSocketSupported()) return;
    let ws: WebSocket | null = null;
    let isDisposed = false;
    hasConnectedOnceRef.current = false;

    const connectWs = () => {
      if (isDisposed || isDisposedRef.current) return;
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          reportWebSocketSuccess();
          setWsConnected(true);
          ws?.send(JSON.stringify({ action: 'subscribe', channel: `trades:${pair.id}` }));
          ws?.send(JSON.stringify({ action: 'subscribe', channel: `kline:${pair.id}` }));
          if (hasConnectedOnceRef.current) {
            resyncReconnectDelta();
          }
          hasConnectedOnceRef.current = true;
        };

        ws.onerror = () => {
          reportWebSocketFailure();
          if (!isDisposed) setWsConnected(false);
        };

        ws.onmessage = event => {
          if (isDisposed || isDisposedRef.current) return;
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'trade' && payload.data) {
              processSingleTrade(payload.data);
            }
          } catch {}
        };

        ws.onclose = () => {
          if (!isDisposed) setWsConnected(false);
          if (!isDisposed && !isDisposedRef.current && isWebSocketSupported()) {
            setTimeout(connectWs, 3000);
          }
        };
      } catch {}
    };

    connectWs();

    return () => {
      isDisposed = true;
      setWsConnected(false);
      if (ws) ws.close();
    };
  }, [pair.id, processSingleTrade, resyncReconnectDelta]);

  // Usability Controls Handlers
  const handleZoom = (factor: number) => {
    if (!chartRef.current) return;
    const currentSpacing = chartRef.current.timeScale().options().barSpacing || 9;
    const next = Math.max(3, Math.min(48, currentSpacing * factor));
    chartRef.current.timeScale().applyOptions({ barSpacing: next });
  };

  const handleFitContent = () => {
    chartRef.current?.timeScale().fitContent();
  };

  const handleResetChart = () => {
    setAutoScale(true);
    setLogScale(false);
    setCrosshairMode('MAGNET');
    chartRef.current?.priceScale('right').applyOptions({ autoScale: true, mode: PriceScaleMode.Normal });
    chartRef.current?.timeScale().applyOptions({ barSpacing: 9, rightOffset: 6 });
    chartRef.current?.timeScale().fitContent();
  };

  const handleCreatePriceAlert = async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!user || !token) {
      setAlertFeedback('Sign in to set server-monitored price alerts.');
      return;
    }
    const num = Number(newAlertPrice);
    if (!Number.isFinite(num) || num <= 0) {
      setAlertFeedback('Enter a valid positive price.');
      return;
    }
    const rawUnits = BigInt(Math.round(num * 10 ** quoteDec)).toString();
    try {
      const res = await fetch('/api/trading/price-alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pairId: pair.id,
          condition: newAlertCond,
          thresholdPrice: rawUnits,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAlertFeedback(data.error || 'Failed to create alert.');
        return;
      }
      setNewAlertPrice('');
      setAlertFeedback(null);
      fetchPriceAlerts();
    } catch {
      setAlertFeedback('Network error creating price alert.');
    }
  };

  const handleDeletePriceAlert = async (alertId: string) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    try {
      const res = await fetch(`/api/trading/price-alerts/${alertId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) fetchPriceAlerts();
    } catch {}
  };

  const toggleIndicator = (id: IndicatorId) => {
    setIndicators(prev =>
      prev.map(i => (i.id === id ? { ...i, enabled: !i.enabled, visible: !i.enabled ? true : i.visible } : i))
    );
  };

  const toggleIndicatorVisibility = (id: IndicatorId) => {
    setIndicators(prev => prev.map(i => (i.id === id ? { ...i, visible: i.visible === false } : i)));
  };

  const updateIndicatorParam = (id: IndicatorId, paramKey: string, val: number) => {
    if (!Number.isFinite(val) || val < 1) return;
    setIndicators(prev =>
      prev.map(i => (i.id === id ? { ...i, params: { ...i.params, [paramKey]: Math.round(val) } } : i))
    );
  };

  const resetIndicators = () => {
    setIndicators(DEFAULT_INDICATORS.map(d => ({ ...d, params: { ...d.params } })));
    setEditingIndicatorId(null);
  };

  const toggleOverlay = (key: keyof ChartOverlaySettings) => {
    setOverlays(prev => {
      const nextVal = !prev[key];
      if (key === 'showRefBenchmark' && externalSetShowRef) {
        externalSetShowRef(nextVal);
      }
      return { ...prev, [key]: nextVal };
    });
  };

  const activeIndicators = indicators.filter(i => i.enabled);
  const intervalSec = TF_SECONDS[timeframe] || 900;

  return (
    <div
      ref={wrapperRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-[80] flex flex-col bg-[#090D12]'
          : 'relative w-full h-full flex flex-col bg-[#090D12]'
      }
    >
      {(isFetching || isFetchingMore) && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#8DA5B1]/60 animate-pulse pointer-events-none z-30" />
      )}

      {/* Pro Toolbar Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[#111820] border-b border-[#202B34] text-[11px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 7 Chart Series Types */}
          <select
            aria-label="Chart Type"
            value={activeChartType}
            onChange={e => setActiveChartType(e.target.value as ChartSeriesType)}
            className="bg-[#090D12] border border-[#2B3944] text-[#E4EBEF] rounded-[6px] px-2 py-1 text-[11px] font-medium focus:outline-none focus:border-[#8DA5B1] cursor-pointer"
          >
            {CHART_TYPE_LABELS.map(ct => (
              <option key={ct.id} value={ct.id}>
                {ct.label}
              </option>
            ))}
          </select>

          {activeChartType === 'HEIKIN_ASHI' && (
            <span className="px-1.5 py-0.5 rounded-[4px] bg-[#2C2415] border border-[#D6A85C]/40 text-[#D6A85C] text-[10px] font-mono whitespace-nowrap">
              HA Derived
            </span>
          )}

          {/* Indicators Drawer Toggle */}
          <button
            type="button"
            onClick={() => {
              setShowIndicatorsModal(v => !v);
              setShowOverlaysMenu(false);
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded-[6px] border transition-colors whitespace-nowrap cursor-pointer ${
              showIndicatorsModal || activeIndicators.length > 0
                ? 'bg-[#1D2832] text-[#E4EBEF] border-[#2B3944]'
                : 'bg-[#090D12] text-[#71818B] border-[#202B34] hover:text-[#E4EBEF]'
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>Indicators ({activeIndicators.length})</span>
          </button>

          {/* Drawing Toolbar Toggle */}
          <button
            type="button"
            onClick={() => setShowDrawingBar(v => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-[6px] border transition-colors whitespace-nowrap cursor-pointer ${
              showDrawingBar || activeTool !== 'NONE' || drawings.length > 0
                ? 'bg-[#1D2832] text-[#E4EBEF] border-[#2B3944]'
                : 'bg-[#090D12] text-[#71818B] border-[#202B34] hover:text-[#E4EBEF]'
            }`}
          >
            <Pencil className="w-3 h-3" />
            <span>Draw{drawings.length > 0 ? ` (${drawings.length})` : ''}</span>
          </button>

          {/* Overlays & Alerts Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowOverlaysMenu(v => !v);
                setShowIndicatorsModal(false);
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-[6px] border transition-colors whitespace-nowrap cursor-pointer ${
                showOverlaysMenu
                  ? 'bg-[#1D2832] text-[#E4EBEF] border-[#2B3944]'
                  : 'bg-[#090D12] text-[#71818B] border-[#202B34] hover:text-[#E4EBEF]'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>Overlays</span>
            </button>

            {showOverlaysMenu && (
              <div className="absolute left-0 top-full mt-1.5 z-50 w-72 bg-[#141C24] border border-[#2B3944] rounded-[8px] shadow-2xl p-3 space-y-2.5 text-xs">
                <div className="flex items-center justify-between border-b border-[#202B34] pb-1.5">
                  <span className="font-semibold text-[#E4EBEF]">Market Overlays &amp; Alerts</span>
                  <button
                    type="button"
                    onClick={() => setShowOverlaysMenu(false)}
                    className="text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {(
                  [
                    ['showOpenOrders', 'Open Orders'],
                    ['showUserTrades', 'My Trade Markers'],
                    ['showAvgEntry', 'Avg Entry Price'],
                    ['showPositionPrice', 'Net Position Line'],
                    ['showRefBenchmark', 'External Ref Benchmark'],
                    ['showSupportResistance', 'Support & Resistance'],
                    ['showPriceAlerts', 'Price Alerts'],
                  ] as Array<[keyof ChartOverlaySettings, string]>
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between cursor-pointer text-[#A1AFB8] hover:text-[#E4EBEF]">
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={overlays[key]}
                      onChange={() => toggleOverlay(key)}
                      className="accent-[#16A879] cursor-pointer"
                    />
                  </label>
                ))}

                {/* Create Price Alert */}
                <div className="border-t border-[#202B34] pt-2 space-y-1.5">
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-[#D6A85C]">
                    <BellPlus className="w-3.5 h-3.5" />
                    <span>Add Price Alert ({pair.quoteCurrency})</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <select
                      value={newAlertCond}
                      onChange={e => setNewAlertCond(e.target.value as any)}
                      className="bg-[#090D12] border border-[#2B3944] rounded-[5px] px-1.5 py-1 text-[11px] text-[#E4EBEF]"
                    >
                      <option value="ABOVE_OR_EQUAL">&ge;</option>
                      <option value="BELOW_OR_EQUAL">&le;</option>
                    </select>
                    <input
                      type="number"
                      step="any"
                      value={newAlertPrice}
                      onChange={e => setNewAlertPrice(e.target.value)}
                      placeholder="Target price"
                      className="flex-1 min-w-0 bg-[#090D12] border border-[#2B3944] rounded-[5px] px-2 py-1 text-[11px] text-[#E4EBEF] font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleCreatePriceAlert}
                      className="px-2 py-1 bg-[#8DA5B1] text-[#090D12] font-semibold rounded-[5px] text-[11px] cursor-pointer whitespace-nowrap"
                    >
                      Set
                    </button>
                  </div>
                  {alertFeedback && <p className="text-[10px] text-[#EA5B65]">{alertFeedback}</p>}

                  {priceAlerts.length > 0 && (
                    <div className="max-h-24 overflow-y-auto space-y-1 pt-1">
                      {priceAlerts.map(al => {
                        const val = Number(safeBigInt(al.thresholdPrice)) / 10 ** Math.max(0, quoteDec);
                        return (
                          <div
                            key={al.id}
                            className="flex items-center justify-between bg-[#090D12] px-2 py-1 rounded-[4px] border border-[#202B34] text-[10px] font-mono"
                          >
                            <span className="text-[#D6A85C]">
                              {al.condition === 'BELOW_OR_EQUAL' ? '≤' : '≥'} {val.toFixed(displayPrecision)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeletePriceAlert(al.id)}
                              className="text-[#71818B] hover:text-[#EA5B65] cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Scale, Crosshair, Zoom, Fit, Reset, Fullscreen */}
        <div className="flex items-center gap-1 font-mono tabular-nums">
          <button
            type="button"
            onClick={() => setAutoScale(v => !v)}
            title="Toggle Auto Scale"
            className={`px-2 py-1 rounded-[5px] border text-[10px] cursor-pointer ${
              autoScale
                ? 'bg-[#1D2832] text-[#E4EBEF] border-[#2B3944]'
                : 'bg-[#090D12] text-[#71818B] border-[#202B34]'
            }`}
          >
            Auto
          </button>
          <button
            type="button"
            onClick={() => setLogScale(v => !v)}
            title="Toggle Logarithmic Price Scale"
            className={`px-2 py-1 rounded-[5px] border text-[10px] cursor-pointer ${
              logScale
                ? 'bg-[#162436] text-[#6D9FE8] border-[#6D9FE8]/40'
                : 'bg-[#090D12] text-[#71818B] border-[#202B34]'
            }`}
          >
            Log
          </button>
          <button
            type="button"
            onClick={() => setCrosshairMode(m => (m === 'MAGNET' ? 'NORMAL' : 'MAGNET'))}
            title="Toggle Magnet Crosshair"
            className={`px-2 py-1 rounded-[5px] border text-[10px] cursor-pointer ${
              crosshairMode === 'MAGNET'
                ? 'bg-[#1D2832] text-[#D6A85C] border-[#D6A85C]/30'
                : 'bg-[#090D12] text-[#71818B] border-[#202B34]'
            }`}
          >
            {crosshairMode === 'MAGNET' ? 'Magnet' : 'Free'}
          </button>

          {!compact && (
            <>
              <button
                type="button"
                onClick={() => handleZoom(1.25)}
                title="Zoom In"
                className="p-1 rounded-[5px] bg-[#090D12] border border-[#202B34] text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleZoom(0.8)}
                title="Zoom Out"
                className="p-1 rounded-[5px] bg-[#090D12] border border-[#202B34] text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleFitContent}
            title="Fit Content"
            className="p-1 rounded-[5px] bg-[#090D12] border border-[#202B34] text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
          >
            <Scan className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleResetChart}
            title="Reset Chart View"
            className="p-1 rounded-[5px] bg-[#090D12] border border-[#202B34] text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen(v => !v)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Chart'}
            className="p-1 rounded-[5px] bg-[#090D12] border border-[#202B34] text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expandable Drawing Tools Bar */}
      {showDrawingBar && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[#0E141B] border-b border-[#202B34] text-[11px]">
          <div className="flex items-center gap-1 flex-wrap">
            {DRAWING_TOOLS.map(dt => (
              <button
                key={dt.id}
                type="button"
                title={dt.label}
                onClick={() => setActiveTool(dt.id)}
                className={`px-2 py-0.5 rounded-[5px] border transition-colors whitespace-nowrap cursor-pointer ${
                  activeTool === dt.id
                    ? 'bg-[#8DA5B1] text-[#090D12] border-[#8DA5B1] font-semibold'
                    : 'bg-[#141C24] text-[#A1AFB8] border-[#202B34] hover:text-[#E4EBEF]'
                }`}
              >
                {dt.short}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 pr-1 border-r border-[#202B34]">
              {DRAWING_COLORS.map(col => (
                <button
                  key={col}
                  type="button"
                  aria-label={`Drawing color ${col}`}
                  onClick={() => setDrawingColor(col)}
                  className={`w-3.5 h-3.5 rounded-full cursor-pointer ${
                    drawingColor === col ? 'ring-2 ring-[#E4EBEF] ring-offset-1 ring-offset-[#090D12]' : ''
                  }`}
                  style={{ backgroundColor: col }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={handleUndoDrawing}
              disabled={undoStack.length === 0}
              title="Undo Drawing (Ctrl+Z)"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-[#141C24] border border-[#202B34] text-[#A1AFB8] hover:text-[#E4EBEF] disabled:opacity-40 cursor-pointer"
            >
              <Undo2 className="w-3 h-3" />
              <span>Undo</span>
            </button>
            {selectedDrawingId && (
              <button
                type="button"
                onClick={handleDeleteSelectedDrawing}
                title="Delete Selected Drawing"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-[#401F27] border border-[#EA5B65]/40 text-[#EA5B65] cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>Del</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleClearDrawings}
              disabled={drawings.length === 0}
              className="px-1.5 py-0.5 rounded-[5px] bg-[#141C24] border border-[#202B34] text-[#71818B] hover:text-[#EA5B65] disabled:opacity-40 cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Subheader: OHLC Hover Bar & Active Indicator Legends */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[#111820] border-b border-[#202B34] text-[11px] font-mono tabular-nums">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          {hoverInfo ? (
            <div className="flex items-center gap-2.5 text-[#E4EBEF] flex-wrap">
              <span className="text-[#71818B]">{hoverInfo.timeStr}</span>
              <span>
                O:{' '}
                <strong>
                  {hoverInfo.open.toLocaleString(isUSDT ? 'en-US' : 'id-ID', {
                    maximumFractionDigits: getPrecisionForPrice(hoverInfo.open),
                  })}
                </strong>
              </span>
              <span>
                H:{' '}
                <strong className="text-[#16A879]">
                  {hoverInfo.high.toLocaleString(isUSDT ? 'en-US' : 'id-ID', {
                    maximumFractionDigits: getPrecisionForPrice(hoverInfo.high),
                  })}
                </strong>
              </span>
              <span>
                L:{' '}
                <strong className="text-[#EA5B65]">
                  {hoverInfo.low.toLocaleString(isUSDT ? 'en-US' : 'id-ID', {
                    maximumFractionDigits: getPrecisionForPrice(hoverInfo.low),
                  })}
                </strong>
              </span>
              <span>
                C:{' '}
                <strong className={hoverInfo.close >= hoverInfo.open ? 'text-[#16A879]' : 'text-[#EA5B65]'}>
                  {hoverInfo.close.toLocaleString(isUSDT ? 'en-US' : 'id-ID', {
                    maximumFractionDigits: getPrecisionForPrice(hoverInfo.close),
                  })}
                </strong>
              </span>
              <span>
                <strong className={hoverInfo.changePercent >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'}>
                  {hoverInfo.changePercent >= 0 ? '+' : ''}
                  {hoverInfo.changePercent.toFixed(2)}%
                </strong>
              </span>
              <span>
                Vol: <strong className="text-[#A1AFB8]">{hoverInfo.volume.toFixed(4)}</strong>
              </span>
            </div>
          ) : (
            <span className="text-[#71818B] text-[11px] font-sans">
              Hover candles for OHLCV · Drag left edge for older history
            </span>
          )}

          {/* Modular Indicator Legend Chips (shown when DimonexChart is mounted standalone) */}
          {!hideInlineIndicatorLegend && activeIndicators.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeIndicators.map(ind => {
                const isVisible = ind.visible !== false;
                return (
                  <div
                    key={ind.id}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#090D12] border border-[#202B34] text-[10px] ${
                      isVisible ? '' : 'opacity-55'
                    }`}
                  >
                    <span className="font-semibold" style={{ color: ind.color }}>
                      {formatIndicatorDisplayLabel(ind)}
                    </span>
                    {isVisible && indicatorValues[ind.id] && (
                      <span className="text-[#A1AFB8]">{indicatorValues[ind.id]}</span>
                    )}
                    <button
                      type="button"
                      title={isVisible ? 'Hide Indicator' : 'Show Indicator'}
                      onClick={() => toggleIndicatorVisibility(ind.id)}
                      className="text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
                    >
                      {isVisible ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                    </button>
                    <button
                      type="button"
                      title="Configure Indicator"
                      onClick={() => {
                        setEditingIndicatorId(ind.id);
                        setShowIndicatorsModal(true);
                      }}
                      className="text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
                    >
                      <Settings2 className="w-2.5 h-2.5" />
                    </button>
                    <button
                      type="button"
                      title="Remove Indicator"
                      onClick={() => toggleIndicator(ind.id)}
                      className="text-[#71818B] hover:text-[#EA5B65] cursor-pointer"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[#71818B] text-[10px] whitespace-nowrap">
          <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-[#16A879]' : 'bg-[#D6A85C]'}`} />
          <span>{isFetchingMore ? 'Loading history...' : wsConnected ? 'WS Live' : 'Reconnecting'}</span>
        </div>
      </div>

      {/* Modular Indicators Configuration Panel */}
      {showIndicatorsModal && (
        <div className="absolute top-11 left-3 z-50 w-80 max-h-[380px] flex flex-col bg-[#141C24] border border-[#2B3944] rounded-[8px] shadow-2xl overflow-hidden text-xs">
          <div className="flex items-center justify-between px-3 py-2 bg-[#111820] border-b border-[#202B34]">
            <span className="font-semibold text-[#E4EBEF]">Technical Indicators (12)</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetIndicators}
                className="text-[11px] text-[#8DA5B1] hover:text-[#E4EBEF] cursor-pointer"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setShowIndicatorsModal(false)}
                className="text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 px-2 py-1.5 bg-[#0E141B] border-b border-[#202B34] overflow-x-auto">
            {(['ALL', 'TREND', 'MOMENTUM', 'VOLATILITY', 'VOLUME'] as const).map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setIndicatorCatFilter(cat)}
                className={`px-2 py-0.5 rounded-[4px] text-[10px] font-medium cursor-pointer ${
                  indicatorCatFilter === cat
                    ? 'bg-[#8DA5B1] text-[#090D12] font-semibold'
                    : 'text-[#71818B] hover:text-[#E4EBEF]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#202B34]">
            {indicators
              .filter(ind => indicatorCatFilter === 'ALL' || ind.category === indicatorCatFilter)
              .map(ind => (
                <div key={ind.id} className="px-3 py-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ind.color }} />
                      <span className="font-medium text-[#E4EBEF] truncate">{formatIndicatorDisplayLabel(ind)}</span>
                      <span className="text-[10px] text-[#71818B]">{ind.overlay ? 'Overlay' : 'Pane'}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {Object.keys(ind.params).length > 0 && (
                        <button
                          type="button"
                          onClick={() => setEditingIndicatorId(editingIndicatorId === ind.id ? null : ind.id)}
                          className="p-1 text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
                          title="Parameters"
                        >
                          <Settings2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleIndicator(ind.id)}
                        className={`px-2 py-0.5 rounded-[4px] text-[10px] font-semibold border cursor-pointer ${
                          ind.enabled
                            ? 'bg-[#12392F] text-[#16A879] border-[#16A879]/40'
                            : 'bg-[#090D12] text-[#71818B] border-[#202B34]'
                        }`}
                      >
                        {ind.enabled ? <Eye className="w-3 h-3 inline mr-1" /> : <EyeOff className="w-3 h-3 inline mr-1" />}
                        {ind.enabled ? 'On' : 'Off'}
                      </button>
                    </div>
                  </div>

                  {editingIndicatorId === ind.id && Object.keys(ind.params).length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1 pl-4">
                      {Object.entries(ind.params).map(([key, val]) => (
                        <label key={key} className="flex items-center gap-1 text-[10px] text-[#A1AFB8]">
                          <span>{key}:</span>
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={val}
                            onChange={e => updateIndicatorParam(ind.id, key, Number(e.target.value))}
                            className="w-14 bg-[#090D12] border border-[#2B3944] rounded-[4px] px-1.5 py-0.5 text-[#E4EBEF] font-mono"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Main Canvas + Interactive Drawing Layer */}
      <div className={`relative flex-1 w-full ${compact ? 'min-h-[260px]' : 'min-h-[420px]'}`}>
        {!isFetching && candlesRef.current.length === 0 && !pair.lastPrice && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-[#090D12]/95">
            <div className="w-11 h-11 rounded-[10px] bg-[#141C24] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1] mb-3">
              <CandlestickChart className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-semibold text-[#E4EBEF] mb-1">No Executed Trades Yet ({pair.id})</h4>
            <p className="text-xs text-[#71818B] max-w-sm leading-relaxed">
              This chart renders strictly from authoritative matched order executions in DIMONEX.
            </p>
          </div>
        )}

        <div ref={chartContainerRef} className={`w-full h-full ${compact ? 'min-h-[260px]' : 'min-h-[420px]'}`} />

        <ChartDrawingLayer
          chart={chartRef.current}
          mainSeries={mainSeriesRef.current}
          candles={candlesRef.current}
          timeframeSec={intervalSec}
          activeTool={activeTool}
          activeColor={drawingColor}
          drawings={drawings}
          selectedId={selectedDrawingId}
          pricePrecision={displayPrecision}
          onSelectId={setSelectedDrawingId}
          onChangeDrawings={handleDrawingsChange}
          onToolComplete={() => setActiveTool('NONE')}
        />
      </div>
    </div>
  );
};
