/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * chartTypes.ts
 * Type definitions for TradingView Advanced Charts, DIMONEX Datafeed API,
 * and unified chart components.
 */

import { TradingPairItem, TradeItem } from '../../types/index.js';

export type ChartMode = 'DOMINEX' | 'TRADINGVIEW';
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export interface ChartSharedProps {
  pair: TradingPairItem;
  recentTrades?: TradeItem[];
  timeframe: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
  className?: string;
}

export interface Bar {
  time: number; // Unix timestamp in milliseconds or seconds (Datafeed uses ms or seconds based on library config, typically ms for widget or s for UDF)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type ResolutionString = '1' | '5' | '15' | '60' | '240' | '1D' | 'D' | '1W' | 'W' | string;

export interface PeriodParams {
  from: number; // Unix timestamp in seconds
  to: number;   // Unix timestamp in seconds
  countBack: number;
  firstDataRequest: boolean;
}

export interface LibrarySymbolInfo {
  name: string;
  ticker?: string;
  description: string;
  type: string;
  session: string;
  exchange: string;
  listed_exchange: string;
  timezone: string;
  format?: 'price' | 'volume';
  pricescale: number;
  minmov: number;
  minmove2?: number;
  fractional?: boolean;
  has_intraday?: boolean;
  supported_resolutions: ResolutionString[];
  intraday_multipliers?: string[];
  has_seconds?: boolean;
  has_daily?: boolean;
  has_weekly_and_monthly?: boolean;
  has_empty_bars?: boolean;
  has_no_volume?: boolean;
  volume_precision?: number;
  data_status?: 'streaming' | 'endofday' | 'pulsed' | 'delayed_streaming';
  currency_code?: string;
  original_currency_code?: string;
}

export interface DatafeedConfiguration {
  exchanges?: Array<{ value: string; name: string; desc: string }>;
  symbols_types?: Array<{ name: string; value: string }>;
  supported_resolutions: ResolutionString[];
  currency_codes?: string[];
  supports_marks?: boolean;
  supports_timescale_marks?: boolean;
  supports_time?: boolean;
  supports_search?: boolean;
  supports_group_request?: boolean;
}

export interface SearchSymbolResultItem {
  symbol: string;
  full_name: string;
  description: string;
  exchange: string;
  ticker: string;
  type: string;
}

export type OnReadyCallback = (configuration: DatafeedConfiguration) => void;
export type SearchSymbolsCallback = (items: SearchSymbolResultItem[]) => void;
export type ResolveCallback = (symbolInfo: LibrarySymbolInfo) => void;
export type ErrorCallback = (reason: string) => void;
export type HistoryCallback = (bars: Bar[], meta: { noData?: boolean; nextTime?: number }) => void;
export type SubscribeBarsCallback = (bar: Bar) => void;

export interface IBasicDataFeed {
  onReady: (callback: OnReadyCallback) => void;
  searchSymbols: (userInput: string, exchange: string, symbolType: string, onResultReadyCallback: SearchSymbolsCallback) => void;
  resolveSymbol: (symbolName: string, onSymbolResolvedCallback: ResolveCallback, onResolveErrorCallback: ErrorCallback) => void;
  getBars: (symbolInfo: LibrarySymbolInfo, resolution: ResolutionString, periodParams: PeriodParams, onHistoryCallback: HistoryCallback, onErrorCallback: ErrorCallback) => void;
  subscribeBars: (symbolInfo: LibrarySymbolInfo, resolution: ResolutionString, onRealtimeCallback: SubscribeBarsCallback, subscriberUID: string, onResetCacheNeededCallback: () => void) => void;
  unsubscribeBars: (subscriberUID: string) => void;
  getServerTime?: (callback: (serverTime: number) => void) => void;
}

export interface ChartHoverInfo {
  timeStr: string;
  open: number;
  high: number;
  low: number;
  close: number;
  changePercent: number;
  volume: number;
}
