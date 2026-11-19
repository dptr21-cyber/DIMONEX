/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TradingViewChart.tsx
 * Official TradingView Integration for DIMONEX Obsidian Iridium.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { BarChart2, Maximize2, X } from 'lucide-react';
import { TradingPairItem, TradeItem } from '../../types/index.js';
import { Timeframe, ResolutionString } from './chartTypes.js';
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
  onFallbackToPro,
  className = ''
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const containerId = useRef(`tv_chart_container_${Math.random().toString(36).substring(2, 9)}`);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [widgetStatus, setWidgetStatus] = useState<'INITIALIZING' | 'OFFICIAL_WIDGET_ACTIVE' | 'EMBED_WIDGET_ACTIVE'>('INITIALIZING');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const tvResolution: ResolutionString = timeframeToResolution(timeframe);

  const embedInterval = useMemo(() => {
    switch (timeframe) {
      case '1m': return '1';
      case '5m': return '5';
      case '15m': return '15';
      case '1h': return '60';
      case '4h': return '240';
      case '1d':
      case '1D': return 'D';
      case '1w':
      case '1W': return 'W';
      default: return '15';
    }
  }, [timeframe]);

  const benchmarkSymbol = useMemo(() => {
    const rawBase = (pair.baseCurrency || 'BTC').replace(/[0-9]/g, '').toUpperCase();
    return `BINANCE:${rawBase}USDT`;
  }, [pair.baseCurrency]);

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
          } catch {}
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
          toolbar_bg: '#111820',
          enable_publishing: false,
          allow_symbol_change: false,
          hide_side_toolbar: false,
          autosize: true,
          fullscreen: false,
          studies_overrides: {},
          disabled_features: ['header_saveload', 'header_compare'],
          enabled_features: ['use_localstorage_for_settings', 'study_templates', 'side_toolbar_in_fullscreen_mode'],
          overrides: {
            'paneProperties.background': '#090D12',
            'paneProperties.vertGridProperties.color': '#202B34',
            'paneProperties.horzGridProperties.color': '#202B34',
            'scalesProperties.textColor': '#A1AFB8',
            'mainSeriesProperties.candleStyle.upColor': '#16A879',
            'mainSeriesProperties.candleStyle.downColor': '#EA5B65'
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
      script.onload = () => initTvWidget();
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
        } catch {}
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
  )}&interval=${embedInterval}&hidesidetoolbar=0&symboledit=1&saveimage=1&toolbarbg=111820&studies=%5B%5D&theme=dark&style=1&timezone=Asia%2FJakarta&studies_overrides=%7B%7D&overrides=%7B%7D&enabled_features=%5B%5D&disabled_features=%5B%5D&locale=en&utm_source=localhost`;

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full min-h-[420px] flex flex-col bg-[#090D12] overflow-hidden ${
        isFullscreen ? 'fixed inset-0 z-50 p-4 bg-[#090D12]' : ''
      } ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-[#111820] border-b border-[#202B34] text-xs font-mono">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-semibold text-[#E4EBEF] font-sans">
            <BarChart2 className="w-4 h-4 text-[#8DA5B1]" />
            <span>TradingView Terminal</span>
          </div>
          <span className="text-[#2B3944]">|</span>
          <span className="text-[#16A879] font-semibold">{pair.id}</span>
          <span className="text-[#2B3944]">|</span>
          <span className="text-[#71818B]">
            Benchmark: <strong className="text-[#6D9FE8]">{benchmarkSymbol}</strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onFallbackToPro && (
            <button
              type="button"
              onClick={onFallbackToPro}
              className="px-2.5 py-1 rounded-[7px] text-[11px] font-sans font-medium bg-[#17212B] hover:bg-[#222F3A] text-[#E4EBEF] border border-[#2B3944] transition-colors cursor-pointer"
            >
              Use DIMONEX Pro
            </button>
          )}

          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-[5px] bg-[#141C24] border border-[#202B34] text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#16A879]" />
            <span className="text-[#A1AFB8]">Live Stream</span>
          </div>

          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            className="p-1.5 rounded-[7px] bg-[#17212B] hover:bg-[#222F3A] text-[#A1AFB8] hover:text-[#E4EBEF] border border-[#2B3944] transition-colors cursor-pointer"
          >
            {isFullscreen ? <X className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#8DA5B1]/60 animate-pulse pointer-events-none z-30" />
      )}

      <div
        id={containerId.current}
        className={`flex-1 w-full h-full min-h-[400px] ${
          widgetStatus === 'OFFICIAL_WIDGET_ACTIVE' ? 'block' : 'hidden'
        }`}
      />

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
