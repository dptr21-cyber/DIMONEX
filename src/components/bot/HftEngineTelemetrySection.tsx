/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * HftEngineTelemetrySection.tsx
 * Real-Time HFT Matching Engine Telemetry & Fee Generation Monitor.
 * Tracks Orders-Per-Second (OPS), Sub-Millisecond Execution Latency (Avg/P95/P99),
 * and Maker/Taker Fee Generation using interactive D3.js SVG charts.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import { Play, Pause, RefreshCw } from 'lucide-react';
import { safeFetchJson } from '../../lib/safeFetch.js';
import {
  TradingPairItem,
  EngineTelemetrySnapshot,
  EngineTelemetrySeriesPoint
} from '../../types/index.js';

interface Props {
  tradingPairs: TradingPairItem[];
  onSetFeedback: (msg: { type: 'success' | 'error'; text: string } | null) => void;
}

const DEFAULT_SUMMARY: EngineTelemetrySnapshot['summary'] = {
  currentOps: 0,
  avgOps: 0,
  peakOps: 0,
  currentTradesPerSec: 0,
  avgLatencyMs: 0,
  p50LatencyMs: 0,
  p95LatencyMs: 0,
  p99LatencyMs: 0,
  maxLatencyMs: 0,
  totalFeesIdr: 0,
  makerFeesIdr: 0,
  takerFeesIdr: 0,
  windowFeesIdr: 0,
  feeRatePerMinIdr: 0,
  totalOrdersProcessed: 0,
  totalOrdersCancelled: 0,
  totalTradesExecuted: 0,
  openOrdersCount: 0,
  activeBotsCount: 0
};

export const HftEngineTelemetrySection: React.FC<Props> = ({
  tradingPairs,
  onSetFeedback
}) => {
  const [windowSeconds, setWindowSeconds] = useState<30 | 60 | 120>(60);
  const [pairFilter, setPairFilter] = useState<string>('ALL');
  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());

  const [snapshot, setSnapshot] = useState<EngineTelemetrySnapshot>({
    timestamp: Date.now(),
    windowSeconds: 60,
    pairFilter: 'ALL',
    summary: DEFAULT_SUMMARY,
    pairBreakdown: [],
    series: []
  });

  const opsSvgRef = useRef<SVGSVGElement | null>(null);
  const latencySvgRef = useRef<SVGSVGElement | null>(null);
  const feesSvgRef = useRef<SVGSVGElement | null>(null);

  const fetchTelemetry = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsLoading(true);
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const res = await safeFetchJson<EngineTelemetrySnapshot & { error?: string }>(
        `/api/mm/engine/telemetry?windowSec=${windowSeconds}&pairId=${encodeURIComponent(pairFilter)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        }
      );

      if (res.ok && res.data && res.data.summary) {
        setSnapshot(res.data);
        setLastUpdated(Date.now());
      } else if (showSpinner) {
        onSetFeedback({ type: 'error', text: res.data?.error || 'Gagal memuat telemetri matching engine.' });
      }
    } catch (err: any) {
      if (showSpinner) {
        onSetFeedback({ type: 'error', text: err?.message || 'Koneksi telemetri terputus.' });
      }
    } finally {
      setIsLoading(false);
    }
  }, [windowSeconds, pairFilter, onSetFeedback]);

  useEffect(() => {
    fetchTelemetry(true);
  }, [fetchTelemetry]);

  useEffect(() => {
    if (!isStreaming) return;
    const timer = setInterval(() => {
      fetchTelemetry(false);
    }, 1500);
    return () => clearInterval(timer);
  }, [isStreaming, fetchTelemetry]);

  const formatIDR = (val: number): string => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Math.round(val));
  };

  // ============================================================================
  // D3 CHART 1: Orders-Per-Second (OPS) & Matched Trades Throughput
  // ============================================================================
  useEffect(() => {
    const svgEl = opsSvgRef.current;
    const series = snapshot.series;
    if (!svgEl || series.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 920;
    const height = 250;
    const margin = { top: 20, right: 24, bottom: 28, left: 54 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xExtent = d3.extent(series, d => new Date(d.timestamp)) as [Date, Date];
    const xScale = d3.scaleTime().domain(xExtent).range([0, innerW]);

    const maxOps = Math.max(5, d3.max(series, d => d.ordersPerSecond) || 5);
    const yScale = d3.scaleLinear().domain([0, maxOps * 1.2]).nice().range([innerH, 0]);

    // Grid lines
    g.selectAll('.ops-grid')
      .data(yScale.ticks(4))
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#1e293b')
      .attr('stroke-dasharray', '2,2');

    // Moving average (5-sec)
    const rollingAvgData = series.map((pt, idx) => {
      const start = Math.max(0, idx - 4);
      const slice = series.slice(start, idx + 1);
      const avg = slice.reduce((acc, s) => acc + s.ordersPerSecond, 0) / slice.length;
      return { timestamp: pt.timestamp, avgOps: avg };
    });

    // Bar width dynamically sized to window
    const barW = Math.max(3, Math.floor((innerW / series.length) * 0.65));

    // Bars for Orders/sec
    g.selectAll('.ops-bar')
      .data(series)
      .enter()
      .append('rect')
      .attr('x', d => xScale(new Date(d.timestamp)) - barW / 2)
      .attr('y', d => yScale(d.ordersPerSecond))
      .attr('width', barW)
      .attr('height', d => Math.max(0, innerH - yScale(d.ordersPerSecond)))
      .attr('rx', 1.5)
      .attr('fill', d => (d.ordersPerSecond > 0 ? '#0284c7' : '#1e293b'))
      .attr('opacity', d => (d.ordersPerSecond > 0 ? 0.72 : 0.35));

    // Peak OPS reference line
    if (snapshot.summary.peakOps > 0) {
      const peakY = yScale(snapshot.summary.peakOps);
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', peakY)
        .attr('y2', peakY)
        .attr('stroke', '#38bdf8')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
        .attr('opacity', 0.65);

      g.append('text')
        .attr('x', innerW - 4)
        .attr('y', Math.max(10, peakY - 5))
        .attr('text-anchor', 'end')
        .attr('fill', '#38bdf8')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .text(`Peak ${snapshot.summary.peakOps} ord/s`);
    }

    // Moving average line
    const maLine = d3.line<{ timestamp: number; avgOps: number }>()
      .x(d => xScale(new Date(d.timestamp)))
      .y(d => yScale(d.avgOps))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(rollingAvgData)
      .attr('fill', 'none')
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 2)
      .attr('d', maLine);

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(6).tickFormat(d3.timeFormat('%H:%M:%S') as any);
    const yAxis = d3.axisLeft(yScale).ticks(4).tickFormat(d => `${d}`);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call(ax => ax.select('.domain').attr('stroke', '#334155'))
      .call(ax => ax.selectAll('.tick line').attr('stroke', '#334155'))
      .call(ax => ax.selectAll('text').attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace'));

    g.append('g')
      .call(yAxis)
      .call(ax => ax.select('.domain').attr('stroke', '#334155'))
      .call(ax => ax.selectAll('.tick line').attr('stroke', '#334155'))
      .call(ax => ax.selectAll('text').attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace'));

    // Hover crosshair + tooltip
    const focus = g.append('g').style('display', 'none');
    const vLine = focus.append('line').attr('y1', 0).attr('y2', innerH).attr('stroke', '#64748b').attr('stroke-dasharray', '3,3');
    const tip = focus.append('g');
    tip.append('rect').attr('width', 178).attr('height', 56).attr('rx', 6).attr('fill', '#090d16').attr('stroke', '#334155');
    const tTime = tip.append('text').attr('x', 10).attr('y', 16).attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace');
    const tOps = tip.append('text').attr('x', 10).attr('y', 33).attr('fill', '#38bdf8').attr('font-size', '11px').attr('font-weight', 'bold').attr('font-family', 'monospace');
    const tMatches = tip.append('text').attr('x', 10).attr('y', 48).attr('fill', '#cbd5e1').attr('font-size', '10px').attr('font-family', 'monospace');

    const bisect = d3.bisector<EngineTelemetrySeriesPoint, Date>(d => new Date(d.timestamp)).left;

    svg.append('rect')
      .attr('transform', `translate(${margin.left},${margin.top})`)
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('mouseover', () => focus.style('display', null))
      .on('mouseout', () => focus.style('display', 'none'))
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx);
        const idx = bisect(series, x0, 1);
        const d0 = series[idx - 1];
        const d1 = series[idx];
        if (!d0) return;
        const pt = !d1 ? d0 : (x0.getTime() - d0.timestamp > d1.timestamp - x0.getTime() ? d1 : d0);

        const px = xScale(new Date(pt.timestamp));
        const py = yScale(pt.ordersPerSecond);
        vLine.attr('x1', px).attr('x2', px);

        const tipX = px > innerW - 190 ? px - 186 : px + 10;
        const tipY = Math.max(4, Math.min(innerH - 60, py - 24));
        tip.attr('transform', `translate(${tipX},${tipY})`);

        tTime.text(new Date(pt.timestamp).toLocaleTimeString('id-ID'));
        tOps.text(`OPS: ${pt.ordersPerSecond} ord/s`);
        tMatches.text(`Trades: ${pt.tradesPerSecond}/s · Cancel: ${pt.cancellationsPerSecond}/s`);
      });
  }, [snapshot]);

  // ============================================================================
  // D3 CHART 2: Sub-Millisecond Execution Latency (Avg & P95 ms)
  // ============================================================================
  useEffect(() => {
    const svgEl = latencySvgRef.current;
    const series = snapshot.series;
    if (!svgEl || series.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 460;
    const height = 220;
    const margin = { top: 20, right: 20, bottom: 28, left: 52 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xExtent = d3.extent(series, d => new Date(d.timestamp)) as [Date, Date];
    const xScale = d3.scaleTime().domain(xExtent).range([0, innerW]);

    const maxLat = Math.max(1.2, d3.max(series, d => d.p95LatencyMs) || 1.2);
    const yScale = d3.scaleLinear().domain([0, maxLat * 1.25]).nice().range([innerH, 0]);

    // Grid
    g.selectAll('.lat-grid')
      .data(yScale.ticks(4))
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#1e293b')
      .attr('stroke-dasharray', '2,2');

    // 1.0ms HFT Target Threshold
    if (yScale(1.0) >= 0 && yScale(1.0) <= innerH) {
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', yScale(1.0))
        .attr('y2', yScale(1.0))
        .attr('stroke', '#10b981')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,3')
        .attr('opacity', 0.7);

      g.append('text')
        .attr('x', innerW - 4)
        .attr('y', yScale(1.0) - 4)
        .attr('text-anchor', 'end')
        .attr('fill', '#10b981')
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .text('1.0 ms SLA');
    }

    // P95 Area
    const p95Area = d3.area<EngineTelemetrySeriesPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y0(innerH)
      .y1(d => yScale(d.p95LatencyMs))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(series)
      .attr('fill', '#a855f7')
      .attr('opacity', 0.14)
      .attr('d', p95Area);

    // P95 Line
    const p95Line = d3.line<EngineTelemetrySeriesPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y(d => yScale(d.p95LatencyMs))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', '#c084fc')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3,2')
      .attr('d', p95Line);

    // Avg Latency Line
    const avgLine = d3.line<EngineTelemetrySeriesPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y(d => yScale(d.avgLatencyMs))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', '#22d3ee')
      .attr('stroke-width', 2)
      .attr('d', avgLine);

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(4).tickFormat(d3.timeFormat('%H:%M:%S') as any);
    const yAxis = d3.axisLeft(yScale).ticks(4).tickFormat(d => `${Number(d).toFixed(2)}ms`);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call(ax => ax.select('.domain').attr('stroke', '#334155'))
      .call(ax => ax.selectAll('.tick line').attr('stroke', '#334155'))
      .call(ax => ax.selectAll('text').attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace'));

    g.append('g')
      .call(yAxis)
      .call(ax => ax.select('.domain').attr('stroke', '#334155'))
      .call(ax => ax.selectAll('.tick line').attr('stroke', '#334155'))
      .call(ax => ax.selectAll('text').attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace'));

    // Hover
    const focus = g.append('g').style('display', 'none');
    const vLine = focus.append('line').attr('y1', 0).attr('y2', innerH).attr('stroke', '#64748b').attr('stroke-dasharray', '3,3');
    const dot = focus.append('circle').attr('r', 3.5).attr('fill', '#22d3ee').attr('stroke', '#fff');
    const tip = focus.append('g');
    tip.append('rect').attr('width', 200).attr('height', 46).attr('rx', 6).attr('fill', '#090d16').attr('stroke', '#334155');
    const tTime = tip.append('text').attr('x', 8).attr('y', 15).attr('fill', '#94a3b8').attr('font-size', '9px').attr('font-family', 'monospace');
    const tLat = tip.append('text').attr('x', 8).attr('y', 33).attr('fill', '#22d3ee').attr('font-size', '10px').attr('font-weight', 'bold').attr('font-family', 'monospace');

    const bisect = d3.bisector<EngineTelemetrySeriesPoint, Date>(d => new Date(d.timestamp)).left;

    svg.append('rect')
      .attr('transform', `translate(${margin.left},${margin.top})`)
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('mouseover', () => focus.style('display', null))
      .on('mouseout', () => focus.style('display', 'none'))
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx);
        const idx = bisect(series, x0, 1);
        const d0 = series[idx - 1];
        const d1 = series[idx];
        if (!d0) return;
        const pt = !d1 ? d0 : (x0.getTime() - d0.timestamp > d1.timestamp - x0.getTime() ? d1 : d0);

        const px = xScale(new Date(pt.timestamp));
        const py = yScale(pt.avgLatencyMs);
        vLine.attr('x1', px).attr('x2', px);
        dot.attr('cx', px).attr('cy', py);

        const tipX = px > innerW - 210 ? px - 208 : px + 8;
        const tipY = Math.max(4, Math.min(innerH - 50, py - 20));
        tip.attr('transform', `translate(${tipX},${tipY})`);

        tTime.text(new Date(pt.timestamp).toLocaleTimeString('id-ID'));
        tLat.text(`Avg: ${pt.avgLatencyMs.toFixed(2)}ms · P95: ${pt.p95LatencyMs.toFixed(2)}ms`);
      });
  }, [snapshot]);

  // ============================================================================
  // D3 CHART 3: Fee Generation Accrual (IDR) Over Live Window
  // ============================================================================
  useEffect(() => {
    const svgEl = feesSvgRef.current;
    const series = snapshot.series;
    if (!svgEl || series.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 460;
    const height = 220;
    const margin = { top: 20, right: 20, bottom: 28, left: 62 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xExtent = d3.extent(series, d => new Date(d.timestamp)) as [Date, Date];
    const xScale = d3.scaleTime().domain(xExtent).range([0, innerW]);

    const maxFee = Math.max(1000, d3.max(series, d => d.cumulativeFeeIdr) || 1000);
    const yScale = d3.scaleLinear().domain([0, maxFee * 1.18]).nice().range([innerH, 0]);

    // Grid
    g.selectAll('.fee-grid')
      .data(yScale.ticks(4))
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#1e293b')
      .attr('stroke-dasharray', '2,2');

    const defs = svg.append('defs');
    const feeGrad = defs.append('linearGradient')
      .attr('id', 'telemetry-fee-grad')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    feeGrad.append('stop').attr('offset', '0%').attr('stop-color', '#10b981').attr('stop-opacity', 0.35);
    feeGrad.append('stop').attr('offset', '100%').attr('stop-color', '#10b981').attr('stop-opacity', 0.0);

    const feeArea = d3.area<EngineTelemetrySeriesPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y0(innerH)
      .y1(d => yScale(d.cumulativeFeeIdr))
      .curve(d3.curveStepAfter);

    g.append('path')
      .datum(series)
      .attr('fill', 'url(#telemetry-fee-grad)')
      .attr('d', feeArea);

    const feeLine = d3.line<EngineTelemetrySeriesPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y(d => yScale(d.cumulativeFeeIdr))
      .curve(d3.curveStepAfter);

    g.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', '#10b981')
      .attr('stroke-width', 2)
      .attr('d', feeLine);

    // Per-second fee impulse bars along baseline
    const maxSecFee = Math.max(100, d3.max(series, d => d.feeGeneratedIdr) || 100);
    const barScale = d3.scaleLinear().domain([0, maxSecFee]).range([0, innerH * 0.35]);
    const barW = Math.max(2, Math.floor((innerW / series.length) * 0.55));

    g.selectAll('.fee-sec-bar')
      .data(series.filter(d => d.feeGeneratedIdr > 0))
      .enter()
      .append('rect')
      .attr('x', d => xScale(new Date(d.timestamp)) - barW / 2)
      .attr('y', d => innerH - barScale(d.feeGeneratedIdr))
      .attr('width', barW)
      .attr('height', d => barScale(d.feeGeneratedIdr))
      .attr('fill', '#f59e0b')
      .attr('opacity', 0.75);

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(4).tickFormat(d3.timeFormat('%H:%M:%S') as any);
    const yAxis = d3.axisLeft(yScale).ticks(4).tickFormat((d: any) => {
      const v = Number(d);
      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
      if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
      return `${v}`;
    });

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call(ax => ax.select('.domain').attr('stroke', '#334155'))
      .call(ax => ax.selectAll('.tick line').attr('stroke', '#334155'))
      .call(ax => ax.selectAll('text').attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace'));

    g.append('g')
      .call(yAxis)
      .call(ax => ax.select('.domain').attr('stroke', '#334155'))
      .call(ax => ax.selectAll('.tick line').attr('stroke', '#334155'))
      .call(ax => ax.selectAll('text').attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace'));

    // Hover
    const focus = g.append('g').style('display', 'none');
    const vLine = focus.append('line').attr('y1', 0).attr('y2', innerH).attr('stroke', '#64748b').attr('stroke-dasharray', '3,3');
    const dot = focus.append('circle').attr('r', 3.5).attr('fill', '#10b981').attr('stroke', '#fff');
    const tip = focus.append('g');
    tip.append('rect').attr('width', 196).attr('height', 48).attr('rx', 6).attr('fill', '#090d16').attr('stroke', '#334155');
    const tTime = tip.append('text').attr('x', 8).attr('y', 15).attr('fill', '#94a3b8').attr('font-size', '9px').attr('font-family', 'monospace');
    const tFee = tip.append('text').attr('x', 8).attr('y', 33).attr('fill', '#10b981').attr('font-size', '10px').attr('font-weight', 'bold').attr('font-family', 'monospace');

    const bisect = d3.bisector<EngineTelemetrySeriesPoint, Date>(d => new Date(d.timestamp)).left;

    svg.append('rect')
      .attr('transform', `translate(${margin.left},${margin.top})`)
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('mouseover', () => focus.style('display', null))
      .on('mouseout', () => focus.style('display', 'none'))
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx);
        const idx = bisect(series, x0, 1);
        const d0 = series[idx - 1];
        const d1 = series[idx];
        if (!d0) return;
        const pt = !d1 ? d0 : (x0.getTime() - d0.timestamp > d1.timestamp - x0.getTime() ? d1 : d0);

        const px = xScale(new Date(pt.timestamp));
        const py = yScale(pt.cumulativeFeeIdr);
        vLine.attr('x1', px).attr('x2', px);
        dot.attr('cx', px).attr('cy', py);

        const tipX = px > innerW - 205 ? px - 202 : px + 8;
        const tipY = Math.max(4, Math.min(innerH - 52, py - 20));
        tip.attr('transform', `translate(${tipX},${tipY})`);

        tTime.text(new Date(pt.timestamp).toLocaleTimeString('id-ID'));
        tFee.text(`Accrued: ${formatIDR(pt.cumulativeFeeIdr)}`);
      });
  }, [snapshot]);

  const { summary, pairBreakdown } = snapshot;
  const totalFeeDenom = summary.makerFeesIdr + summary.takerFeesIdr;
  const makerPct = totalFeeDenom > 0 ? Math.round((summary.makerFeesIdr / totalFeeDenom) * 1000) / 10 : 0;
  const takerPct = totalFeeDenom > 0 ? Math.round((100 - makerPct) * 10) / 10 : 0;

  return (
    <div className="space-y-6">
      {/* Toolbar Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#0b0f19] p-5 rounded-xl border border-slate-800">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-white">
            HFT Matching Engine Telemetry
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5 text-slate-300">
              <span
                className={`w-1.5 h-1.5 rounded-full ${isStreaming ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}
                aria-hidden="true"
              />
              {isStreaming ? 'Live Stream (1.5s)' : 'Stream Paused'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {summary.activeBotsCount} Active Bots
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {summary.openOrdersCount} Open Orders
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-500">
              Updated {new Date(lastUpdated).toLocaleTimeString('id-ID')}
            </span>
          </div>
        </div>

        {/* Interactive Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Rolling Window Selector */}
          <div className="flex items-center bg-[#131b2e] p-1 rounded-lg border border-slate-800 text-xs" role="group" aria-label="Telemetry window">
            {([30, 60, 120] as const).map(sec => (
              <button
                key={sec}
                type="button"
                onClick={() => setWindowSeconds(sec)}
                className={`px-3 py-1.5 rounded-md font-mono tabular-nums font-semibold transition-colors whitespace-nowrap ${
                  windowSeconds === sec
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>

          {/* Trading Pair Filter */}
          <label htmlFor="telemetry-pair-filter" className="sr-only">Filter Trading Pair</label>
          <select
            id="telemetry-pair-filter"
            aria-label="Filter Trading Pair"
            value={pairFilter}
            onChange={(e) => setPairFilter(e.target.value)}
            className="bg-[#131b2e] text-slate-200 font-medium px-3 py-2 rounded-lg border border-slate-700 text-xs focus:outline-none focus:border-sky-500"
          >
            <option value="ALL">All Trading Pairs</option>
            {tradingPairs.map(p => (
              <option key={p.id} value={p.id}>{p.id}</option>
            ))}
          </select>

          {/* Stream Pause/Resume */}
          <button
            type="button"
            onClick={() => setIsStreaming(prev => !prev)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
              isStreaming
                ? 'bg-[#131b2e] text-slate-200 border-slate-700 hover:bg-slate-800'
                : 'bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-500'
            }`}
          >
            {isStreaming ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isStreaming ? 'Pause Stream' : 'Resume Live'}</span>
          </button>

          {/* Manual Refresh */}
          <button
            type="button"
            onClick={() => fetchTelemetry(true)}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#131b2e] hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400">Orders Per Second</div>
          <div className="text-2xl font-bold text-sky-400 font-mono tabular-nums mt-1">
            {summary.currentOps} <span className="text-xs font-normal text-slate-400">ord/s</span>
          </div>
          <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1.5">
            Avg {summary.avgOps}/s · Peak {summary.peakOps}/s
          </div>
        </div>

        <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400">Avg Execution Latency</div>
          <div className="text-2xl font-bold text-cyan-300 font-mono tabular-nums mt-1">
            {summary.avgLatencyMs.toFixed(3)} <span className="text-xs font-normal text-slate-400">ms</span>
          </div>
          <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1.5">
            P50 {summary.p50LatencyMs.toFixed(2)}ms · P95 {summary.p95LatencyMs.toFixed(2)}ms
          </div>
        </div>

        <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400">Tail Latency (P99 / Max)</div>
          <div className="text-2xl font-bold text-purple-300 font-mono tabular-nums mt-1">
            {summary.p99LatencyMs.toFixed(3)} <span className="text-xs font-normal text-slate-400">ms</span>
          </div>
          <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1.5">
            Max spike {summary.maxLatencyMs.toFixed(2)}ms
          </div>
        </div>

        <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400">Total Fee Generation</div>
          <div className="text-2xl font-bold text-emerald-400 font-mono tabular-nums mt-1">
            {formatIDR(summary.totalFeesIdr)}
          </div>
          <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1.5">
            Maker {makerPct}% · Taker {takerPct}%
          </div>
        </div>

        <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800 col-span-2 md:col-span-1">
          <div className="text-xs text-slate-400">Window Fee Velocity</div>
          <div className="text-2xl font-bold text-amber-300 font-mono tabular-nums mt-1">
            {formatIDR(summary.windowFeesIdr)}
          </div>
          <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-1.5">
            Rate {formatIDR(summary.feeRatePerMinIdr)}/min · {summary.totalTradesExecuted.toLocaleString('id-ID')} trades
          </div>
        </div>
      </div>

      {/* Focal Anchor Chart: Real-Time Orders Per Second */}
      <div className="bg-[#0b0f19] p-5 rounded-xl border border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white">
              Throughput Eksekusi Order (Orders Per Second)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Jumlah order ditempatkan dan dibatalkan per detik pada single-threaded order book beserta rata-rata bergerak 5 detik.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-400">
            <span>Bars: Orders/sec</span>
            <span className="text-amber-400">Line: 5s Moving Avg</span>
          </div>
        </div>

        <div className="w-full bg-[#070b14] rounded-lg border border-slate-800/90 p-2">
          <svg ref={opsSvgRef} className="w-full h-60 block" role="img" aria-label="Orders per second real-time chart" />
        </div>
      </div>

      {/* Secondary Row: Execution Latency & Fee Accrual */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 2: Execution Latency */}
        <div className="bg-[#0b0f19] p-5 rounded-xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white">
                Latensi Eksekusi Matching Engine (ms)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Waktu proses sub-milidetik (Avg & P95) dari validasi saldo hingga pencocokan order.
              </p>
            </div>
            <div className="text-xs font-mono tabular-nums text-cyan-300">
              {summary.avgLatencyMs.toFixed(3)} ms avg
            </div>
          </div>

          <div className="w-full bg-[#070b14] rounded-lg border border-slate-800/90 p-2">
            <svg ref={latencySvgRef} className="w-full h-52 block" role="img" aria-label="Execution latency milliseconds chart" />
          </div>

          <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-400">
            <span className="text-cyan-300">Solid: Avg Latency</span>
            <span className="text-purple-300">Dashed: P95 Envelope</span>
            <span className="text-emerald-400">Target: &lt; 1.0 ms</span>
          </div>
        </div>

        {/* Chart 3: Cumulative Fee Generation */}
        <div className="bg-[#0b0f19] p-5 rounded-xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white">
                Akumulasi Fee Perdagangan ({windowSeconds}s Window)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Pendapatan fee Maker (0.10%) dan Taker (0.20%) kumulatif serta lonjakan fee per detik.
              </p>
            </div>
            <div className="text-xs font-mono tabular-nums text-emerald-400">
              {formatIDR(summary.windowFeesIdr)}
            </div>
          </div>

          <div className="w-full bg-[#070b14] rounded-lg border border-slate-800/90 p-2">
            <svg ref={feesSvgRef} className="w-full h-52 block" role="img" aria-label="Fee generation accrual chart" />
          </div>

          <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-400">
            <span className="text-emerald-400">Area: Cumulative Window Fee</span>
            <span className="text-amber-400">Bars: Per-Second Fee</span>
          </div>
        </div>
      </div>

      {/* Fee Generation Breakdown Table by Trading Pair */}
      <div className="bg-[#0b0f19] p-5 rounded-xl border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white">
              Rincian Total Fee Generation per Pasangan Trading
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Total akumulasi fee dari seluruh trade tereksekusi pada double-entry ledger ({formatIDR(summary.makerFeesIdr)} Maker · {formatIDR(summary.takerFeesIdr)} Taker).
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-300">
            Total: {formatIDR(summary.totalFeesIdr)}
          </div>
        </div>

        {pairBreakdown.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Belum ada transaksi dengan fee yang tercatat pada filter pasangan ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 pr-4 font-medium">Trading Pair</th>
                  <th className="py-2.5 px-4 font-medium text-right">Trades</th>
                  <th className="py-2.5 px-4 font-medium text-right">Maker Fee (Native)</th>
                  <th className="py-2.5 px-4 font-medium text-right">Taker Fee (Native)</th>
                  <th className="py-2.5 px-4 font-medium text-right">Total Volume (IDR)</th>
                  <th className="py-2.5 pl-4 font-medium text-right">Total Fee (IDR Eq.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {pairBreakdown.map(row => (
                  <tr key={row.pairId} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 pr-4 font-semibold text-white">{row.pairId}</td>
                    <td className="py-3 px-4 text-right text-slate-300">
                      {row.tradesCount.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 text-right text-cyan-300">
                      {row.makerFeesNative} {row.quoteCurrency}
                    </td>
                    <td className="py-3 px-4 text-right text-amber-300">
                      {row.takerFeesNative} {row.quoteCurrency}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-300">
                      {formatIDR(row.volumeIdr)}
                    </td>
                    <td className="py-3 pl-4 text-right font-bold text-emerald-400">
                      {formatIDR(row.totalFeesIdr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
