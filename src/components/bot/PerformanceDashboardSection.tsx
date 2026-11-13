/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PerformanceDashboardSection.tsx
 * DIMONEX High-Frequency Trading Performance & Analytics Console.
 * Visualizes Profit/Loss (PnL) over time, Inventory Skew Metrics, and Average Execution Latency
 * using interactive D3.js SVG visualizations.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { TradingPairItem, PerformanceMetricPoint } from '../../types/index.js';

interface PerformanceDashboardSectionProps {
  tradingPairs: TradingPairItem[];
  onSetFeedback: (msg: { type: 'success' | 'error'; text: string } | null) => void;
}

export const PerformanceDashboardSection: React.FC<PerformanceDashboardSectionProps> = ({
  tradingPairs,
  onSetFeedback
}) => {
  const [selectedPairId, setSelectedPairId] = useState<string>('BTC-IDR');
  const [selectedTimeframe, setSelectedTimeframe] = useState<'1H' | '6H' | '24H' | '7D' | 'ALL'>('24H');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Metrics Data
  const [summary, setSummary] = useState<any>({
    totalRealizedPnlIdr: 0,
    totalUnrealizedPnlIdr: 0,
    netPnlIdr: 0,
    pnlPercentage: 0,
    winRatePct: 82,
    currentInventorySkewBps: 0,
    currentBaseRatioPct: 50,
    averageLatencyMs: 1.45,
    p95LatencyMs: 2.30,
    totalTradesCount: 0,
    totalVolumeQuoteIdr: 0
  });
  const [seriesData, setSeriesData] = useState<PerformanceMetricPoint[]>([]);

  // Chart SVG References
  const pnlChartRef = useRef<SVGSVGElement | null>(null);
  const skewChartRef = useRef<SVGSVGElement | null>(null);
  const latencyChartRef = useRef<SVGSVGElement | null>(null);

  // Active Pair Object
  const currentPair = useMemo(() => {
    return tradingPairs.find(p => p.id === selectedPairId) || tradingPairs[0] || {
      id: 'BTC-IDR',
      baseCurrency: 'BTC',
      quoteCurrency: 'IDR'
    };
  }, [tradingPairs, selectedPairId]);

  // Load Performance Metrics
  const loadMetrics = async (pairId: string, timeframe: string) => {
    setIsLoading(true);
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const res = await safeFetchJson<any>(`/api/mm/performance/metrics?pairId=${pairId}&timeframe=${timeframe}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok && res.data) {
        setSummary(res.data.summary);
        setSeriesData(res.data.series || []);
      } else {
        onSetFeedback({ type: 'error', text: res.data?.error || 'Gagal memuat metrik kinerja.' });
      }
    } catch (err: any) {
      onSetFeedback({ type: 'error', text: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics(selectedPairId, selectedTimeframe);
    const interval = setInterval(() => {
      loadMetrics(selectedPairId, selectedTimeframe);
    }, 15000);
    return () => clearInterval(interval);
  }, [selectedPairId, selectedTimeframe]);

  // Format IDR Helper
  const formatIDR = (val: number): string => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val);
  };

  // =========================================================================
  // D3 RENDER CHART 1: Cumulative Profit & Loss (PnL) Area & Line Chart
  // =========================================================================
  useEffect(() => {
    const svgEl = pnlChartRef.current;
    if (!svgEl || seriesData.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 800;
    const height = 240;
    const margin = { top: 20, right: 30, bottom: 30, left: 75 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const xExtent = d3.extent(seriesData, d => new Date(d.timestamp)) as [Date, Date];
    const xScale = d3.scaleTime().domain(xExtent).range([0, innerW]);

    const pnlValues = seriesData.map(d => d.cumulativePnl);
    let minY = Math.min(0, ...pnlValues);
    let maxY = Math.max(0, ...pnlValues);
    const padding = (maxY - minY) * 0.15 || 50000;
    const yScale = d3.scaleLinear().domain([minY - padding, maxY + padding]).range([innerH, 0]);

    // Gradient Definitions
    const defs = svg.append('defs');
    const greenGrad = defs.append('linearGradient')
      .attr('id', 'pnl-green-grad')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    greenGrad.append('stop').attr('offset', '0%').attr('stop-color', '#10b981').attr('stop-opacity', 0.45);
    greenGrad.append('stop').attr('offset', '100%').attr('stop-color', '#10b981').attr('stop-opacity', 0.0);

    // Horizontal Grid Lines
    const yTicks = yScale.ticks(5);
    g.selectAll('.grid-line')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#1e293b')
      .attr('stroke-dasharray', '2,2');

    // Zero Baseline
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', yScale(0))
      .attr('y2', yScale(0))
      .attr('stroke', '#475569')
      .attr('stroke-width', 1.2);

    // Area Generator
    const area = d3.area<PerformanceMetricPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y0(yScale(0))
      .y1(d => yScale(d.cumulativePnl))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(seriesData)
      .attr('fill', 'url(#pnl-green-grad)')
      .attr('d', area);

    // Line Generator
    const line = d3.line<PerformanceMetricPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y(d => yScale(d.cumulativePnl))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(seriesData)
      .attr('fill', 'none')
      .attr('stroke', '#10b981')
      .attr('stroke-width', 2.2)
      .attr('d', line);

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat('%H:%M') as any);
    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat((d: any) => {
      const val = Number(d);
      if (Math.abs(val) >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
      if (Math.abs(val) >= 1000) return `${(val / 1000).toFixed(0)}k`;
      return `${val}`;
    });

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call(axis => axis.select('.domain').attr('stroke', '#334155'))
      .call(axis => axis.selectAll('.tick line').attr('stroke', '#334155'))
      .call(axis => axis.selectAll('text').attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace'));

    g.append('g')
      .call(yAxis)
      .call(axis => axis.select('.domain').attr('stroke', '#334155'))
      .call(axis => axis.selectAll('.tick line').attr('stroke', '#334155'))
      .call(axis => axis.selectAll('text').attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace'));

    // Interactive Hover Crosshair & Tooltip
    const focusGroup = g.append('g').style('display', 'none');

    const verticalLine = focusGroup.append('line')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', '#64748b')
      .attr('stroke-dasharray', '3,3');

    const focusCircle = focusGroup.append('circle')
      .attr('r', 4.5)
      .attr('fill', '#10b981')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5);

    const tooltipGroup = focusGroup.append('g');
    const tooltipRect = tooltipGroup.append('rect')
      .attr('fill', '#090d16')
      .attr('stroke', '#334155')
      .attr('rx', 6)
      .attr('ry', 6)
      .attr('width', 140)
      .attr('height', 42);

    const tooltipTextTime = tooltipGroup.append('text')
      .attr('fill', '#94a3b8')
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .attr('x', 8)
      .attr('y', 15);

    const tooltipTextPnl = tooltipGroup.append('text')
      .attr('fill', '#10b981')
      .attr('font-size', '11px')
      .attr('font-weight', 'bold')
      .attr('font-family', 'monospace')
      .attr('x', 8)
      .attr('y', 32);

    const bisectDate = d3.bisector<PerformanceMetricPoint, Date>(d => new Date(d.timestamp)).left;

    svg.append('rect')
      .attr('transform', `translate(${margin.left},${margin.top})`)
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('mouseover', () => focusGroup.style('display', null))
      .on('mouseout', () => focusGroup.style('display', 'none'))
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx);
        const i = bisectDate(seriesData, x0, 1);
        const d0 = seriesData[i - 1];
        const d1 = seriesData[i];
        if (!d0) return;
        const d = !d1 ? d0 : (x0.getTime() - d0.timestamp > d1.timestamp - x0.getTime() ? d1 : d0);

        const xPos = xScale(new Date(d.timestamp));
        const yPos = yScale(d.cumulativePnl);

        verticalLine.attr('x1', xPos).attr('x2', xPos);
        focusCircle.attr('cx', xPos).attr('cy', yPos);

        const tipX = xPos > innerW - 150 ? xPos - 148 : xPos + 10;
        const tipY = Math.max(0, Math.min(innerH - 46, yPos - 20));
        tooltipGroup.attr('transform', `translate(${tipX},${tipY})`);

        tooltipTextTime.text(new Date(d.timestamp).toLocaleTimeString('id-ID'));
        tooltipTextPnl.text(`PnL: Rp ${d.cumulativePnl.toLocaleString('id-ID')}`);
      });

  }, [seriesData]);

  // =========================================================================
  // D3 RENDER CHART 2: Inventory Skew Metrics (Basis Points & Asset Bias)
  // =========================================================================
  useEffect(() => {
    const svgEl = skewChartRef.current;
    if (!svgEl || seriesData.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 800;
    const height = 240;
    const margin = { top: 20, right: 30, bottom: 30, left: 75 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xExtent = d3.extent(seriesData, d => new Date(d.timestamp)) as [Date, Date];
    const xScale = d3.scaleTime().domain(xExtent).range([0, innerW]);

    const skewValues = seriesData.map(d => d.inventorySkewBps);
    const maxAbsSkew = Math.max(100, ...skewValues.map(Math.abs)) * 1.2;
    const yScale = d3.scaleLinear().domain([-maxAbsSkew, maxAbsSkew]).range([innerH, 0]);

    // Background zones
    // Long Base zone (Top)
    g.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerW)
      .attr('height', yScale(0))
      .attr('fill', '#06b6d4')
      .attr('opacity', 0.04);

    // Long Quote zone (Bottom)
    g.append('rect')
      .attr('x', 0)
      .attr('y', yScale(0))
      .attr('width', innerW)
      .attr('height', innerH - yScale(0))
      .attr('fill', '#f59e0b')
      .attr('opacity', 0.04);

    // Zero Equilibrium Line
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', yScale(0))
      .attr('y2', yScale(0))
      .attr('stroke', '#64748b')
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '4,4');

    // Horizontal Ticks
    const yTicks = yScale.ticks(5);
    g.selectAll('.grid-line')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#1e293b')
      .attr('stroke-dasharray', '2,2');

    // Skew Area
    const skewArea = d3.area<PerformanceMetricPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y0(yScale(0))
      .y1(d => yScale(d.inventorySkewBps))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(seriesData)
      .attr('fill', '#06b6d4')
      .attr('fill-opacity', 0.25)
      .attr('d', skewArea);

    // Skew Line
    const skewLine = d3.line<PerformanceMetricPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y(d => yScale(d.inventorySkewBps))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(seriesData)
      .attr('fill', 'none')
      .attr('stroke', '#38bdf8')
      .attr('stroke-width', 2)
      .attr('d', skewLine);

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat('%H:%M') as any);
    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d => `${d} bps`);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call(axis => axis.select('.domain').attr('stroke', '#334155'))
      .call(axis => axis.selectAll('.tick line').attr('stroke', '#334155'))
      .call(axis => axis.selectAll('text').attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace'));

    g.append('g')
      .call(yAxis)
      .call(axis => axis.select('.domain').attr('stroke', '#334155'))
      .call(axis => axis.selectAll('.tick line').attr('stroke', '#334155'))
      .call(axis => axis.selectAll('text').attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace'));

    // Hover interaction
    const focusGroup = g.append('g').style('display', 'none');
    const vLine = focusGroup.append('line').attr('y1', 0).attr('y2', innerH).attr('stroke', '#64748b').attr('stroke-dasharray', '3,3');
    const fCircle = focusGroup.append('circle').attr('r', 4.5).attr('fill', '#38bdf8').attr('stroke', '#fff').attr('stroke-width', 1.5);

    const tipGroup = focusGroup.append('g');
    tipGroup.append('rect').attr('fill', '#090d16').attr('stroke', '#334155').attr('rx', 6).attr('ry', 6).attr('width', 155).attr('height', 44);
    const tTime = tipGroup.append('text').attr('fill', '#94a3b8').attr('font-size', '9px').attr('font-family', 'monospace').attr('x', 8).attr('y', 15);
    const tSkew = tipGroup.append('text').attr('fill', '#38bdf8').attr('font-size', '11px').attr('font-weight', 'bold').attr('font-family', 'monospace').attr('x', 8).attr('y', 33);

    const bisectDate = d3.bisector<PerformanceMetricPoint, Date>(d => new Date(d.timestamp)).left;

    svg.append('rect')
      .attr('transform', `translate(${margin.left},${margin.top})`)
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('mouseover', () => focusGroup.style('display', null))
      .on('mouseout', () => focusGroup.style('display', 'none'))
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx);
        const i = bisectDate(seriesData, x0, 1);
        const d0 = seriesData[i - 1];
        const d1 = seriesData[i];
        if (!d0) return;
        const d = !d1 ? d0 : (x0.getTime() - d0.timestamp > d1.timestamp - x0.getTime() ? d1 : d0);

        const xPos = xScale(new Date(d.timestamp));
        const yPos = yScale(d.inventorySkewBps);

        vLine.attr('x1', xPos).attr('x2', xPos);
        fCircle.attr('cx', xPos).attr('cy', yPos);

        const tipX = xPos > innerW - 165 ? xPos - 160 : xPos + 10;
        const tipY = Math.max(0, Math.min(innerH - 48, yPos - 22));
        tipGroup.attr('transform', `translate(${tipX},${tipY})`);

        tTime.text(new Date(d.timestamp).toLocaleTimeString('id-ID'));
        tSkew.text(`Skew: ${d.inventorySkewBps > 0 ? '+' : ''}${d.inventorySkewBps} bps (${d.inventoryRatioPct}% Base)`);
      });

  }, [seriesData]);

  // =========================================================================
  // D3 RENDER CHART 3: Average Execution Latency (ms) Over Time
  // =========================================================================
  useEffect(() => {
    const svgEl = latencyChartRef.current;
    if (!svgEl || seriesData.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = 800;
    const height = 240;
    const margin = { top: 20, right: 30, bottom: 30, left: 75 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xExtent = d3.extent(seriesData, d => new Date(d.timestamp)) as [Date, Date];
    const xScale = d3.scaleTime().domain(xExtent).range([0, innerW]);

    const latValues = seriesData.map(d => d.latencyMs);
    const maxLat = Math.max(3.0, ...latValues) * 1.25;
    const yScale = d3.scaleLinear().domain([0, maxLat]).range([innerH, 0]);

    // P95 Latency Guide Line
    const p95Val = summary.p95LatencyMs || 2.2;
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', yScale(p95Val))
      .attr('y2', yScale(p95Val))
      .attr('stroke', '#ef4444')
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '4,4');

    g.append('text')
      .attr('x', innerW - 5)
      .attr('y', yScale(p95Val) - 4)
      .attr('text-anchor', 'end')
      .attr('fill', '#ef4444')
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .text(`P95 Limit: ${p95Val} ms`);

    // Target Threshold Line (2.0 ms)
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', yScale(2.0))
      .attr('y2', yScale(2.0))
      .attr('stroke', '#eab308')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,2');

    // Horizontal Ticks
    const yTicks = yScale.ticks(5);
    g.selectAll('.grid-line')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#1e293b')
      .attr('stroke-dasharray', '2,2');

    // Latency Line
    const latLine = d3.line<PerformanceMetricPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y(d => yScale(d.latencyMs))
      .curve(d3.curveMonotoneX);

    // Gradient
    const defs = svg.append('defs');
    const latGrad = defs.append('linearGradient')
      .attr('id', 'lat-grad')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    latGrad.append('stop').attr('offset', '0%').attr('stop-color', '#a855f7').attr('stop-opacity', 0.35);
    latGrad.append('stop').attr('offset', '100%').attr('stop-color', '#a855f7').attr('stop-opacity', 0.0);

    const latArea = d3.area<PerformanceMetricPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y0(innerH)
      .y1(d => yScale(d.latencyMs))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(seriesData)
      .attr('fill', 'url(#lat-grad)')
      .attr('d', latArea);

    g.append('path')
      .datum(seriesData)
      .attr('fill', 'none')
      .attr('stroke', '#c084fc')
      .attr('stroke-width', 1.8)
      .attr('d', latLine);

    // Circles on micro-spikes
    g.selectAll('.spike-circle')
      .data(seriesData.filter(d => d.latencyMs > 2.0))
      .enter()
      .append('circle')
      .attr('cx', d => xScale(new Date(d.timestamp)))
      .attr('cy', d => yScale(d.latencyMs))
      .attr('r', 3)
      .attr('fill', '#f43f5e');

    // Axes
    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat('%H:%M') as any);
    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d => `${d} ms`);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call(axis => axis.select('.domain').attr('stroke', '#334155'))
      .call(axis => axis.selectAll('.tick line').attr('stroke', '#334155'))
      .call(axis => axis.selectAll('text').attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace'));

    g.append('g')
      .call(yAxis)
      .call(axis => axis.select('.domain').attr('stroke', '#334155'))
      .call(axis => axis.selectAll('.tick line').attr('stroke', '#334155'))
      .call(axis => axis.selectAll('text').attr('fill', '#94a3b8').attr('font-size', '10px').attr('font-family', 'monospace'));

    // Hover
    const focusGroup = g.append('g').style('display', 'none');
    const vLine = focusGroup.append('line').attr('y1', 0).attr('y2', innerH).attr('stroke', '#64748b').attr('stroke-dasharray', '3,3');
    const fCircle = focusGroup.append('circle').attr('r', 4.5).attr('fill', '#c084fc').attr('stroke', '#fff').attr('stroke-width', 1.5);

    const tipGroup = focusGroup.append('g');
    tipGroup.append('rect').attr('fill', '#090d16').attr('stroke', '#334155').attr('rx', 6).attr('ry', 6).attr('width', 135).attr('height', 42);
    const tTime = tipGroup.append('text').attr('fill', '#94a3b8').attr('font-size', '9px').attr('font-family', 'monospace').attr('x', 8).attr('y', 15);
    const tLat = tipGroup.append('text').attr('fill', '#c084fc').attr('font-size', '11px').attr('font-weight', 'bold').attr('font-family', 'monospace').attr('x', 8).attr('y', 32);

    const bisectDate = d3.bisector<PerformanceMetricPoint, Date>(d => new Date(d.timestamp)).left;

    svg.append('rect')
      .attr('transform', `translate(${margin.left},${margin.top})`)
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('mouseover', () => focusGroup.style('display', null))
      .on('mouseout', () => focusGroup.style('display', 'none'))
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx);
        const i = bisectDate(seriesData, x0, 1);
        const d0 = seriesData[i - 1];
        const d1 = seriesData[i];
        if (!d0) return;
        const d = !d1 ? d0 : (x0.getTime() - d0.timestamp > d1.timestamp - x0.getTime() ? d1 : d0);

        const xPos = xScale(new Date(d.timestamp));
        const yPos = yScale(d.latencyMs);

        vLine.attr('x1', xPos).attr('x2', xPos);
        fCircle.attr('cx', xPos).attr('cy', yPos);

        const tipX = xPos > innerW - 145 ? xPos - 140 : xPos + 10;
        const tipY = Math.max(0, Math.min(innerH - 46, yPos - 20));
        tipGroup.attr('transform', `translate(${tipX},${tipY})`);

        tTime.text(new Date(d.timestamp).toLocaleTimeString('id-ID'));
        tLat.text(`Latensi: ${d.latencyMs.toFixed(2)} ms`);
      });

  }, [seriesData, summary]);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0b0f19] p-5 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 text-lg">📈</span>
            <div>
              <h2 className="text-lg font-black tracking-wide text-white flex items-center gap-2">
                HFT Bot Performance Dashboard
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  ● D3 Telemetry Engine
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Visualisasi analitik laba/rugi, kemiringan inventaris (inventory skew), dan latensi eksekusi sub-milidetik.
              </p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Timeframe Buttons */}
          <div className="flex items-center bg-[#131b2e] p-1 rounded-xl border border-slate-800 text-xs">
            {(['1H', '6H', '24H', '7D', 'ALL'] as const).map(tf => (
              <button
                key={tf}
                onClick={() => setSelectedTimeframe(tf)}
                className={`px-3 py-1 rounded-lg font-mono font-bold transition ${
                  selectedTimeframe === tf
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Pair Select */}
          <label htmlFor="performance-pair-select" className="sr-only">Pilih Trading Pair</label>
          <select
            id="performance-pair-select"
            aria-label="Pilih Trading Pair"
            value={selectedPairId}
            onChange={(e) => setSelectedPairId(e.target.value)}
            className="bg-[#131b2e] text-purple-300 font-bold px-3 py-1.5 rounded-xl border border-purple-500/30 text-xs focus:outline-none focus:border-purple-400"
          >
            {tradingPairs.map(p => (
              <option key={p.id} value={p.id}>{p.id}</option>
            ))}
          </select>

          <button
            onClick={() => loadMetrics(selectedPairId, selectedTimeframe)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
            title="Refresh Metrics"
          >
            🔄
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Net PnL */}
        <div className="bg-[#0b0f19] p-3.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Net PnL Bot</span>
          <div className={`text-base font-bold mt-1 ${summary.netPnlIdr >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatIDR(summary.netPnlIdr)}
          </div>
          <span className="text-[10px] font-mono text-emerald-400/80">
            {summary.pnlPercentage >= 0 ? `+${summary.pnlPercentage}%` : `${summary.pnlPercentage}%`}
          </span>
        </div>

        {/* Realized PnL */}
        <div className="bg-[#0b0f19] p-3.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Laba Terealisasi</span>
          <div className="text-base font-bold text-slate-200 mt-1">
            {formatIDR(summary.totalRealizedPnlIdr)}
          </div>
          <span className="text-[10px] text-slate-500 font-mono">Fills & Spreads</span>
        </div>

        {/* Win Rate */}
        <div className="bg-[#0b0f19] p-3.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Win Rate Maker</span>
          <div className="text-base font-bold text-cyan-400 mt-1">
            {summary.winRatePct}%
          </div>
          <span className="text-[10px] text-slate-500 font-mono">{summary.totalTradesCount} total trade</span>
        </div>

        {/* Inventory Skew */}
        <div className="bg-[#0b0f19] p-3.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Kemiringan Inventaris</span>
          <div className="text-base font-bold text-amber-400 mt-1">
            {summary.currentInventorySkewBps > 0 ? `+${summary.currentInventorySkewBps}` : summary.currentInventorySkewBps} bps
          </div>
          <span className="text-[10px] text-slate-400 font-mono">
            {summary.currentBaseRatioPct}% {currentPair.baseCurrency}
          </span>
        </div>

        {/* Avg Latency */}
        <div className="bg-[#0b0f19] p-3.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Rerata Latensi</span>
          <div className="text-base font-bold text-purple-400 mt-1">
            {summary.averageLatencyMs} ms
          </div>
          <span className="text-[10px] text-slate-500 font-mono">Internal engine round-trip</span>
        </div>

        {/* P95 Latency */}
        <div className="bg-[#0b0f19] p-3.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">P95 Latensi</span>
          <div className="text-base font-bold text-rose-400 mt-1">
            {summary.p95LatencyMs} ms
          </div>
          <span className="text-[10px] text-slate-500 font-mono">Tail risk threshold</span>
        </div>
      </div>

      {/* D3 Charts Grid */}
      <div className="space-y-6">
        {/* CHART 1: Cumulative PnL Over Time */}
        <div className="bg-[#0b0f19] p-5 rounded-2xl border border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"></span>
                Grafik Laba & Rugi Kumulatif (PnL Over Time)
              </h3>
              <p className="text-[11px] text-slate-400">
                Laba bersih dari spread matching engine dan pergerakan inventaris (D3 Area/Line)
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-slate-400">Net: <span className="text-emerald-400 font-bold">{formatIDR(summary.netPnlIdr)}</span></span>
            </div>
          </div>

          <div className="w-full bg-[#070b14] rounded-xl overflow-hidden border border-slate-800/80 p-2">
            <svg ref={pnlChartRef} className="w-full h-56 block"></svg>
          </div>
        </div>

        {/* Two-Column Grid for Skew & Latency */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* CHART 2: Inventory Skew Metrics */}
          <div className="bg-[#0b0f19] p-5 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block"></span>
                  Metrik Kemiringan Inventaris (Inventory Skew)
                </h3>
                <p className="text-[11px] text-slate-400">
                  Deviasi persentase portofolio terhadap titik ekuilibrium 50/50 (Avellaneda-Stoikov bias)
                </p>
              </div>
              <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
                {summary.currentInventorySkewBps > 0 ? `+${summary.currentInventorySkewBps}` : summary.currentInventorySkewBps} bps
              </span>
            </div>

            <div className="w-full bg-[#070b14] rounded-xl overflow-hidden border border-slate-800/80 p-2">
              <svg ref={skewChartRef} className="w-full h-56 block"></svg>
            </div>

            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span className="text-cyan-400">▲ Zona Bias Long ({currentPair.baseCurrency})</span>
              <span>Garis Putus-Putus: 0 bps Netral</span>
              <span className="text-amber-400">▼ Zona Bias Quote ({currentPair.quoteCurrency})</span>
            </div>
          </div>

          {/* CHART 3: Average Execution Latency */}
          <div className="bg-[#0b0f19] p-5 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block"></span>
                  Rerata Latensi Eksekusi (Execution Latency ms)
                </h3>
                <p className="text-[11px] text-slate-400">
                  Waktu putaran (round-trip) pemrosesan order limit bot di matching engine
                </p>
              </div>
              <span className="text-xs font-mono text-purple-400 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-500/30">
                Rerata: {summary.averageLatencyMs} ms
              </span>
            </div>

            <div className="w-full bg-[#070b14] rounded-xl overflow-hidden border border-slate-800/80 p-2">
              <svg ref={latencyChartRef} className="w-full h-56 block"></svg>
            </div>

            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span className="text-emerald-400">● Latensi Optimal (&lt; 2.0 ms)</span>
              <span className="text-red-400">-- Ambang P95: {summary.p95LatencyMs} ms</span>
              <span className="text-rose-400">● Titik Spike Latensi</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
