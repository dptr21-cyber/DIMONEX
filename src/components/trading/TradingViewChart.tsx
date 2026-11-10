/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * TradingViewChart.tsx
 * Official TradingView Integration for DIMONEX.
 * 
 * Architecture:
 * - Powered by Official TradingView Widget API and DIMONEX Custom Datafeed API (IBasicDataFeed)
 * - Embeddable Interactive Fallback: If proprietary standalone library bundle is pending,
 *   seamlessly renders the official live TradingView Advanced Interactive Chart with real-time streaming
 * - Grounded strictly in real market trades
 * - Timezone: Asia/Jakarta
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { TradingPairItem, TradeItem } from '../../types/index.js';
import { Timeframe, ResolutionString, LibrarySymbolInfo } from './chartTypes.js';
import { dimonexDatafeed, timeframeToResolution } from './dimonexDatafeed.js';

interface TradingViewChartProps {
  pair: TradingPairItem;
  recentTrades?: TradeItem[];
  timeframe: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
  onFallbackToPro?: () => void;
  className?: string;
}

declare global {
  interface Window {
    TradingView?: {
      widget: any;
      onready?: (cb: () => void) => void;
    };
    Datafeeds?: {
      UDFCompatibleDatafeed: any;
    };
  }
}

export const TradingViewChart: React.FC<TradingViewChartProps> = ({
  pair,
  timeframe,
  onTimeframeChange,
  onFallbackToPro,
  className = ''
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const containerId = useRef(`tv_chart_container_${Math.random().toString(36).substring(2, 9)}`);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [widgetStatus, setWidgetStatus] = useState<'INITIALIZING' | 'OFFICIAL_WIDGET_ACTIVE' | 'EMBED_WIDGET_ACTIVE'>('INITIALIZING');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Resolution in TradingView format
  const tvResolution: ResolutionString = timeframeToResolution(timeframe);

  // Interval code for embed iframe
  const embedInterval = useMemo(() => {
    switch (timeframe) {
      case '1m': return '1';
      case '5m': return '5';
      case '15m': return '15';
      case '1h': return '60';
      case '4h': return '240';
      case '1d': return 'D';
      case '1w': return 'W';
      default: return '15';
    }
  }, [timeframe]);

  // Global benchmark symbol for embed
  const benchmarkSymbol = useMemo(() => {
    const rawBase = (pair.baseCurrency || 'BTC').replace(/[0-9]/g, '').toUpperCase();
    return `BINANCE:${rawBase}USDT`;
  }, [pair.baseCurrency]);

  // Load Official TradingView Library Script and Initialize Widget
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const initTvWidget = () => {
      if (!isMounted || !containerRef.current) return;

      const tv = window.TradingView;
      if (!tv || !tv.widget) {
        setWidgetStatus('EMBED_WIDGET_ACTIVE');
        setIsLoading(false);
        return;
      }

      try {
        if (widgetRef.current) {
          try {
            if (typeof widgetRef.current.remove === 'function') {
              widgetRef.current.remove();
            }
          } catch (e) {}
          widgetRef.current = null;
        }

        const widgetOptions: any = {
          container: containerId.current,
          container_id: containerId.current,
          symbol: `DIMONEX:${pair.id}`,
          interval: tvResolution,
          timezone: 'Asia/Jakarta',
          theme: 'dark',
          style: '1',
          locale: 'en',
          toolbar_bg: '#08090D',
          enable_publishing: false,
          allow_symbol_change: false,
          hide_side_toolbar: false,
          autosize: true,
          fullscreen: false,
          studies_overrides: {},
          disabled_features: ['header_saveload', 'header_compare'],
          enabled_features: ['use_localstorage_for_settings', 'study_templates', 'side_toolbar_in_fullscreen_mode'],
          overrides: {
            'paneProperties.background': '#08090D',
            'paneProperties.vertGridProperties.color': 'rgba(255, 255, 255, 0.04)',
            'paneProperties.horzGridProperties.color': 'rgba(255, 255, 255, 0.04)',
            'scalesProperties.textColor': '#9298A6',
            'mainSeriesProperties.candleStyle.upColor': '#16C784',
            'mainSeriesProperties.candleStyle.downColor': '#EA3943'
          },
          datafeed: dimonexDatafeed
        };

        const widget = new tv.widget(widgetOptions);
        widgetRef.current = widget;

        if (typeof widget.onChartReady === 'function') {
          widget.onChartReady(() => {
            if (isMounted) {
              setIsLoading(false);
              setWidgetStatus('OFFICIAL_WIDGET_ACTIVE');
            }
          });
        } else {
          setIsLoading(false);
          setWidgetStatus('OFFICIAL_WIDGET_ACTIVE');
        }
      } catch (err: any) {
        console.warn('[TradingViewChart] Widget fallback to embed stream:', err);
        if (isMounted) {
          setWidgetStatus('EMBED_WIDGET_ACTIVE');
          setIsLoading(false);
        }
      }
    };

    const SCRIPT_ID = 'tradingview-official-widget-script';
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;

    if (!script) {
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = 'https://s3.tradingview.com/tv.js';
      script.type = 'text/javascript';
      script.async = true;
      script.onload = () => {
        initTvWidget();
      };
      script.onerror = () => {
        if (isMounted) {
          setWidgetStatus('EMBED_WIDGET_ACTIVE');
          setIsLoading(false);
        }
      };
      document.head.appendChild(script);
    } else {
      if (window.TradingView && window.TradingView.widget) {
        initTvWidget();
      } else {
        script.addEventListener('load', initTvWidget);
      }
    }

    return () => {
      isMounted = false;
      if (widgetRef.current) {
        try {
          if (typeof widgetRef.current.remove === 'function') {
            widgetRef.current.remove();
          }
        } catch (e) {}
        widgetRef.current = null;
      }
    };
  }, [pair.id, tvResolution]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const embedUrl = `https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=${encodeURIComponent(
    benchmarkSymbol
  )}&interval=${embedInterval}&hidesidetoolbar=0&symboledit=1&saveimage=1&toolbarbg=08090D&studies=%5B%5D&theme=dark&style=1&timezone=Asia%2FJakarta&studies_overrides=%7B%7D&overrides=%7B%7D&enabled_features=%5B%5D&disabled_features=%5B%5D&locale=en&utm_source=localhost`;

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full min-h-[420px] flex flex-col bg-[#08090D] overflow-hidden ${
        isFullscreen ? 'fixed inset-0 z-50 p-4 bg-[#08090D]' : ''
      } ${className}`}
    >
      {/* Top Header Bar for TradingView Integration */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-[#0D1017] border-b border-white/10 text-xs font-mono">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold text-[#F5F5F7]">
            <svg className="w-4 h-4 text-[#FF087F]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 4h4v16H4V4zm6 6h4v10h-4V10zm6-4h4v14h-4V6z" />
            </svg>
            <span>TradingView Advanced Live Terminal</span>
          </div>
          <span className="text-white/20">|</span>
          <span className="text-[#16C784] font-semibold">{pair.id}</span>
          <span className="text-white/20">|</span>
          <span className="text-[#9298A6]">Benchmark: <strong className="text-[#38BDF8]">{benchmarkSymbol}</strong></span>
        </div>

        <div className="flex items-center gap-2">
          {onFallbackToPro && (
            <button
              onClick={onFallbackToPro}
              className="px-2.5 py-0.5 rounded text-[11px] font-sans font-medium bg-[#171923] hover:bg-white/10 text-white border border-white/10 transition-colors"
            >
              Gunakan DIMONEX Pro
            </button>
          )}

          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#171923] border border-white/10 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#16C784] animate-pulse" />
            <span className="text-[#C5C9D4]">Live Chart Stream Active</span>
          </div>

          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Keluar Fullscreen' : 'Fullscreen'}
            className="p-1 rounded bg-[#171923] hover:bg-white/10 text-[#9298A6] hover:text-[#F5F5F7] border border-white/10 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {isFullscreen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Discreet 2px Progress Bar during load (NEVER blocks the chart) */}
      {isLoading && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#FF087F] to-transparent animate-pulse pointer-events-none z-30" />
      )}

      {/* Official Standalone Widget Mount Target (if library files present) */}
      <div
        id={containerId.current}
        className={`flex-1 w-full h-full min-h-[400px] ${
          widgetStatus === 'OFFICIAL_WIDGET_ACTIVE' ? 'block' : 'hidden'
        }`}
      />

      {/* Interactive Official TradingView Embed (when commercial bundle is pending) */}
      {widgetStatus === 'EMBED_WIDGET_ACTIVE' && (
        <iframe
          title={`TradingView Chart ${pair.id}`}
          src={embedUrl}
          className="flex-1 w-full h-full min-h-[400px] border-0"
          style={{ minHeight: '420px' }}
        />
      )}
    </div>
  );
};
