/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DimonexChart.tsx
 * DIMONEX Pro Candlestick & Volume Terminal powered by Lightweight Charts v5.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  IChartApi,
  ISeriesApi,
  Time
} from 'lightweight-charts';
import { CandlestickChart } from 'lucide-react';
import { TradingPairItem, TradeItem, CandleItem } from '../../types/index.js';
import { isWebSocketSupported, reportWebSocketSuccess, reportWebSocketFailure } from '../../utils/wsHelper.js';
import { safeBigInt } from '../../lib/formatters.js';
import { Timeframe, ChartHoverInfo } from './chartTypes.js';

interface DimonexChartProps {
  pair: TradingPairItem;
  recentTrades: TradeItem[];
  timeframe: Timeframe;
  setTimeframe: (tf: Timeframe) => void;
  showMAs: boolean;
  setShowMAs: (val: boolean | ((prev: boolean) => boolean)) => void;
  showRefBenchmark: boolean;
  setShowRefBenchmark: (val: boolean | ((prev: boolean) => boolean)) => void;
  refPriceData: any;
  onHoverInfoChange?: (info: ChartHoverInfo | null) => void;
}

const TF_SECONDS: Record<string, number> = {
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
  '1M': 2592000
};

export const DimonexChart: React.FC<DimonexChartProps> = ({
  pair,
  recentTrades,
  timeframe,
  showMAs,
  showRefBenchmark,
  refPriceData,
  onHoverInfoChange
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ma7SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma25SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const refLineRef = useRef<any>(null);

  const isDisposedRef = useRef<boolean>(false);
  const loadRequestIdRef = useRef<number>(0);

  const [isFetching, setIsFetching] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<ChartHoverInfo | null>(null);

  const candlesRef = useRef<CandleItem[]>([]);
  const lastBarRef = useRef<CandleItem | null>(null);
  const processedTradesRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);

  const isUSDT = (pair.quoteCurrency || '').toUpperCase() === 'USDT';
  const quoteDec = pair.quoteDecimals !== undefined && pair.quoteDecimals !== null
    ? pair.quoteDecimals
    : (isUSDT ? 6 : 2);
  const baseDec = pair.baseDecimals !== undefined && pair.baseDecimals !== null
    ? pair.baseDecimals
    : 8;

  const getPrecisionForPrice = useCallback((refPrice: number) => {
    if (!isUSDT && (pair.quoteCurrency || 'IDR').toUpperCase() === 'IDR') {
      return 2;
    }
    if (refPrice > 0 && refPrice < 0.01) return Math.min(8, Math.max(6, quoteDec));
    if (refPrice > 0 && refPrice < 1) return Math.min(8, Math.max(5, quoteDec));
    if (refPrice > 0 && refPrice < 100) return Math.min(6, Math.max(4, quoteDec));
    if (refPrice >= 1000) return 2;
    return Math.min(4, Math.max(2, quoteDec));
  }, [isUSDT, pair.quoteCurrency, quoteDec]);

  const refFloatPrice = Number(safeBigInt(pair.lastPrice)) / (10 ** Math.max(0, quoteDec));
  const displayPrecision = getPrecisionForPrice(refFloatPrice);

  const calculateSMA = useCallback((data: CandleItem[], period: number, prec = displayPrecision) => {
    const result: { time: Time; value: number }[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) continue;
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close;
      }
      result.push({
        time: data[i].time as Time,
        value: Number((sum / period).toFixed(prec))
      });
    }
    return result;
  }, [displayPrecision]);

  const processSingleTrade = useCallback((trade: TradeItem) => {
    if (!trade || trade.pairId !== pair.id) return;
    if (isDisposedRef.current || !chartRef.current || !candleSeriesRef.current) return;

    if (processedTradesRef.current.has(trade.id)) return;
    processedTradesRef.current.add(trade.id);
    if (processedTradesRef.current.size > 2000) {
      const arr = Array.from(processedTradesRef.current);
      processedTradesRef.current = new Set(arr.slice(-1000));
    }

    try {
      const divisor = 10n ** BigInt(quoteDec);
      const rawPrice = safeBigInt(trade.price);
      if (rawPrice <= 0n) return;
      const tradePrice = Number(rawPrice) / Number(divisor);
      const tradeQty = Number(safeBigInt(trade.quantity)) / (10 ** baseDec);
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
          volume: tradeQty
        };
        lastBarRef.current = newBar;
        candlesRef.current.push(newBar);

        if (!isDisposedRef.current && candleSeriesRef.current && volumeSeriesRef.current) {
          candleSeriesRef.current.update({
            time: newBar.time as Time,
            open: newBar.open,
            high: newBar.high,
            low: newBar.low,
            close: newBar.close
          });

          volumeSeriesRef.current.update({
            time: newBar.time as Time,
            value: newBar.volume,
            color: newBar.close >= newBar.open ? 'rgba(22, 168, 121, 0.42)' : 'rgba(234, 91, 101, 0.42)'
          });
        }
      } else if (currentCandleTime === last.time) {
        last.high = Math.max(last.high, tradePrice);
        last.low = Math.min(last.low, tradePrice);
        last.close = tradePrice;
        last.volume = Number((last.volume + tradeQty).toFixed(6));

        if (!isDisposedRef.current && candleSeriesRef.current && volumeSeriesRef.current) {
          candleSeriesRef.current.update({
            time: last.time as Time,
            open: last.open,
            high: last.high,
            low: last.low,
            close: last.close
          });

          volumeSeriesRef.current.update({
            time: last.time as Time,
            value: last.volume,
            color: last.close >= last.open ? 'rgba(22, 168, 121, 0.42)' : 'rgba(234, 91, 101, 0.42)'
          });
        }
      }

      if (!isDisposedRef.current && showMAs) {
        const activePrec = getPrecisionForPrice(tradePrice);
        if (candlesRef.current.length >= 7 && ma7SeriesRef.current) {
          const ma7Val = candlesRef.current.slice(-7).reduce((acc, c) => acc + c.close, 0) / 7;
          ma7SeriesRef.current.update({
            time: (lastBarRef.current?.time || currentCandleTime) as Time,
            value: Number(ma7Val.toFixed(activePrec))
          });
        }
        if (candlesRef.current.length >= 25 && ma25SeriesRef.current) {
          const ma25Val = candlesRef.current.slice(-25).reduce((acc, c) => acc + c.close, 0) / 25;
          ma25SeriesRef.current.update({
            time: (lastBarRef.current?.time || currentCandleTime) as Time,
            value: Number(ma25Val.toFixed(activePrec))
          });
        }
      }
    } catch (err: any) {
      if (err?.message?.includes('disposed')) return;
      console.warn('[DimonexChart] Trade execution process error:', err);
    }
  }, [pair.id, quoteDec, baseDec, timeframe, showMAs, getPrecisionForPrice]);

  const loadCandles = useCallback(async (isInitial = false) => {
    const reqId = ++loadRequestIdRef.current;
    if (isInitial) setIsFetching(true);

    try {
      const res = await fetch(`/api/trading/candles/${pair.id}?timeframe=${timeframe}&limit=200`);
      if (!res.ok) return;
      let data: CandleItem[] = await res.json();

      if (isDisposedRef.current || reqId !== loadRequestIdRef.current) return;
      if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) return;

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

        const candleData = data.map(c => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close
        }));

        const volumeData = data.map(c => ({
          time: c.time as Time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(22, 168, 121, 0.42)' : 'rgba(234, 91, 101, 0.42)'
        }));

        try {
          if (!isDisposedRef.current && candleSeriesRef.current && volumeSeriesRef.current) {
            const sampleClose = data[data.length - 1]?.close || refFloatPrice;
            const dynPrec = getPrecisionForPrice(sampleClose);
            const dynMinMove = Number((1 / Math.pow(10, dynPrec)).toFixed(dynPrec));
            const dynFormat = { type: 'price' as const, precision: dynPrec, minMove: dynMinMove };

            candleSeriesRef.current.applyOptions({ priceFormat: dynFormat });
            ma7SeriesRef.current?.applyOptions({ priceFormat: dynFormat });
            ma25SeriesRef.current?.applyOptions({ priceFormat: dynFormat });

            candleSeriesRef.current.setData(candleData);
            volumeSeriesRef.current.setData(volumeData);

            if (ma7SeriesRef.current) {
              ma7SeriesRef.current.setData(calculateSMA(data, 7, dynPrec));
            }
            if (ma25SeriesRef.current) {
              ma25SeriesRef.current.setData(calculateSMA(data, 25, dynPrec));
            }
          }
        } catch (e: any) {
          if (e?.message?.includes('disposed')) return;
        }
      }

      if (isInitial || isFirstLoadRef.current) {
        isFirstLoadRef.current = false;
        try {
          if (!isDisposedRef.current && chartRef.current) {
            chartRef.current.timeScale().fitContent();
          }
        } catch (e: any) {
          if (e?.message?.includes('disposed')) return;
        }
      }
    } catch (err: any) {
      if (isDisposedRef.current || reqId !== loadRequestIdRef.current) return;
      console.warn('[DimonexChart] Failed to load candles:', err);
    } finally {
      if (reqId === loadRequestIdRef.current && !isDisposedRef.current) {
        if (isInitial) setIsFetching(false);
      }
    }
  }, [pair.id, pair.lastPrice, quoteDec, timeframe, calculateSMA, getPrecisionForPrice, refFloatPrice]);

  useEffect(() => {
    processedTradesRef.current.clear();
    isFirstLoadRef.current = true;
  }, [pair.id]);

  useEffect(() => {
    if (!recentTrades || recentTrades.length === 0 || isDisposedRef.current) return;
    const sorted = [...recentTrades].sort((a, b) => a.createdAt - b.createdAt);
    for (const trade of sorted) {
      if (trade.pairId === pair.id) {
        processSingleTrade(trade);
      }
    }
  }, [recentTrades, pair.id, processSingleTrade]);

  useEffect(() => {
    loadCandles(true);
  }, [timeframe, loadCandles]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isDisposedRef.current) {
        loadCandles(false);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [loadCandles]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    isDisposedRef.current = false;
    chartContainerRef.current.innerHTML = '';

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#090D12' },
        textColor: '#A1AFB8',
        fontSize: 11,
        fontFamily: 'IBM Plex Mono, Inter, sans-serif'
      },
      grid: {
        vertLines: { color: '#202B34' },
        horzLines: { color: '#202B34' }
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#40515D',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1D2832'
        },
        horzLine: {
          color: '#40515D',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1D2832'
        }
      },
      timeScale: {
        borderColor: '#202B34',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 9,
        minBarSpacing: 4
      },
      rightPriceScale: {
        borderColor: '#202B34',
        autoScale: true,
        scaleMargins: {
          top: 0.1,
          bottom: 0.22
        }
      }
    });

    const initMinMove = Number((1 / Math.pow(10, displayPrecision)).toFixed(displayPrecision));
    const initPriceFormat = {
      type: 'price' as const,
      precision: displayPrecision,
      minMove: initMinMove
    };

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#16A879',
      downColor: '#EA5B65',
      borderVisible: false,
      wickUpColor: '#16A879',
      wickDownColor: '#EA5B65',
      priceFormat: initPriceFormat
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: ''
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0
      }
    });

    const ma7Series = chart.addSeries(LineSeries, {
      color: '#D6A85C',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: showMAs,
      priceFormat: initPriceFormat
    });

    const ma25Series = chart.addSeries(LineSeries, {
      color: '#6D9FE8',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: showMAs,
      priceFormat: initPriceFormat
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    ma7SeriesRef.current = ma7Series;
    ma25SeriesRef.current = ma25Series;

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
      } else {
        const cData = param.seriesData.get(candleSeries) as any;
        const vData = param.seriesData.get(volumeSeries) as any;
        if (cData) {
          const open = cData.open || 0;
          const high = cData.high || 0;
          const low = cData.low || 0;
          const close = cData.close || 0;
          const volume = vData ? vData.value || 0 : 0;
          const changePercent = open > 0 ? ((close - open) / open) * 100 : 0;
          const date = new Date(Number(param.time) * 1000);
          const timeStr = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

          const info: ChartHoverInfo = {
            timeStr,
            open,
            high,
            low,
            close,
            changePercent,
            volume
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
            chartRef.current.applyOptions({
              width: nextWidth,
              height: nextHeight
            });
          }
        } catch (e: any) {
          if (e?.message?.includes('disposed')) return;
        }
      }
    };
    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && chartContainerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(chartContainerRef.current);
    }

    loadCandles(true);

    return () => {
      isDisposedRef.current = true;
      loadRequestIdRef.current++;
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }

      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch {}
        chartRef.current = null;
      }
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      ma7SeriesRef.current = null;
      ma25SeriesRef.current = null;
      refLineRef.current = null;
    };
  }, [pair.id]);

  useEffect(() => {
    if (isDisposedRef.current) return;
    try {
      if (ma7SeriesRef.current) {
        ma7SeriesRef.current.applyOptions({ visible: showMAs, lastValueVisible: showMAs });
      }
      if (ma25SeriesRef.current) {
        ma25SeriesRef.current.applyOptions({ visible: showMAs, lastValueVisible: showMAs });
      }
    } catch (e: any) {
      if (e?.message?.includes('disposed')) return;
    }
  }, [showMAs]);

  useEffect(() => {
    if (isDisposedRef.current || !candleSeriesRef.current) return;

    if (refLineRef.current) {
      try {
        candleSeriesRef.current.removePriceLine(refLineRef.current);
      } catch {}
      refLineRef.current = null;
    }

    if (showRefBenchmark && refPriceData && refPriceData.effectiveIdrPrice > 0) {
      try {
        const benchmarkVal = isUSDT ? (refPriceData.effectiveUsdtPrice || 0) : (refPriceData.effectiveIdrPrice || 0);
        if (benchmarkVal > 0 && !isDisposedRef.current && candleSeriesRef.current) {
          refLineRef.current = candleSeriesRef.current.createPriceLine({
            price: benchmarkVal,
            color: '#8DA5B1',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `EXT REF (${refPriceData.activeProvider?.toUpperCase()})`
          });
        }
      } catch (e: any) {
        if (e?.message?.includes('disposed')) return;
        console.error('Failed to create reference price line:', e);
      }
    }
  }, [showRefBenchmark, refPriceData, isUSDT]);

  useEffect(() => {
    if (!isWebSocketSupported()) return;
    let ws: WebSocket | null = null;
    let isDisposed = false;

    const connectWs = () => {
      if (isDisposed || isDisposedRef.current) return;
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          reportWebSocketSuccess();
          ws?.send(JSON.stringify({ action: 'subscribe', channel: `trades:${pair.id}` }));
          ws?.send(JSON.stringify({ action: 'subscribe', channel: `kline:${pair.id}` }));
        };

        ws.onerror = () => {
          reportWebSocketFailure();
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
          if (!isDisposed && !isDisposedRef.current && isWebSocketSupported()) {
            setTimeout(connectWs, 3000);
          }
        };
      } catch {}
    };

    connectWs();

    return () => {
      isDisposed = true;
      if (ws) ws.close();
    };
  }, [pair.id, processSingleTrade]);

  return (
    <div className="relative w-full h-full flex flex-col bg-[#090D12]">
      {isFetching && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#8DA5B1]/60 animate-pulse pointer-events-none z-30" />
      )}

      {/* Subheader: Hover Inspection Bar & Active Indicators */}
      <div className="flex flex-wrap items-center justify-between px-4 py-1.5 bg-[#111820] border-b border-[#202B34] text-[11px] font-mono tabular-nums">
        <div className="flex items-center gap-3 flex-wrap">
          {showMAs && (
            <div className="flex items-center gap-2">
              <span className="text-[#D6A85C] font-medium">MA(7)</span>
              <span className="text-[#40515D]">·</span>
              <span className="text-[#6D9FE8] font-medium">MA(25)</span>
              <span className="text-[#40515D]">·</span>
              <span className="text-[#71818B]">Vol({pair.baseCurrency})</span>
            </div>
          )}

          {hoverInfo ? (
            <div className="flex items-center gap-3 text-[#E4EBEF] flex-wrap">
              <span className="text-[#71818B]">{hoverInfo.timeStr}</span>
              <span>
                O:{' '}
                <strong className="text-[#E4EBEF]">
                  {hoverInfo.open.toLocaleString(isUSDT ? 'en-US' : 'id-ID', {
                    maximumFractionDigits: getPrecisionForPrice(hoverInfo.open)
                  })}
                </strong>
              </span>
              <span>
                H:{' '}
                <strong className="text-[#16A879]">
                  {hoverInfo.high.toLocaleString(isUSDT ? 'en-US' : 'id-ID', {
                    maximumFractionDigits: getPrecisionForPrice(hoverInfo.high)
                  })}
                </strong>
              </span>
              <span>
                L:{' '}
                <strong className="text-[#EA5B65]">
                  {hoverInfo.low.toLocaleString(isUSDT ? 'en-US' : 'id-ID', {
                    maximumFractionDigits: getPrecisionForPrice(hoverInfo.low)
                  })}
                </strong>
              </span>
              <span>
                C:{' '}
                <strong className={hoverInfo.close >= hoverInfo.open ? 'text-[#16A879]' : 'text-[#EA5B65]'}>
                  {hoverInfo.close.toLocaleString(isUSDT ? 'en-US' : 'id-ID', {
                    maximumFractionDigits: getPrecisionForPrice(hoverInfo.close)
                  })}
                </strong>
              </span>
              <span>
                Chg:{' '}
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
              Hover over chart candles to inspect Open, High, Low, Close &amp; Volume.
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[#71818B] text-[10px]">
          <span className={`w-1.5 h-1.5 rounded-full ${isFetching ? 'bg-[#D6A85C]' : 'bg-[#16A879]'}`} />
          <span>{isFetching ? 'Syncing...' : 'DIMONEX Pro Engine'}</span>
        </div>
      </div>

      {/* Main Canvas */}
      <div className="relative flex-1 w-full min-h-[420px]">
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

        <div ref={chartContainerRef} className="w-full h-full min-h-[420px]" />
      </div>
    </div>
  );
};
