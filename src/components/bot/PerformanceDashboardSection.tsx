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
import { TrendingUp, RefreshCw } from 'lucide-react';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { TradingPairItem, PerformanceMetricPoint } from '../../types/index.js';
import { SegmentedTabs } from '../ui/Tabs.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { Button } from '../ui/Button.js';

interface PerformanceDashboardSectionProps {
  tradingPairs: TradingPairItem[];
  onSetFeedback: (msg: { type: 'success' | 'error'; text: string } | null) => void;
}

const TIMEFRAME_TABS: { id: '1H' | '6H' | '24H' | '7D' | 'ALL'; label: string }[] = [
  { id: '1H', label: '1H' },
  { id: '6H', label: '6H' },
  { id: '24H', label: '24H' },
  { id: '7D', label: '7D' },
  { id: 'ALL', label: 'ALL' },
];

export const PerformanceDashboardSection: React.FC<PerformanceDashboardSectionProps> = ({
  tradingPairs,
  onSetFeedback,
}) => {
  const [selectedPairId, setSelectedPairId] = useState<string>('BTC-IDR');
  const [selectedTimeframe, setSelectedTimeframe] = useState<'1H' | '6H' | '24H' | '7D' | 'ALL'>('24H');
  const [isLoading, setIsLoading] = useState<boolean>(true);

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
    totalVolumeQuoteIdr: 0,
  });
  const [seriesData, setSeriesData] = useState<PerformanceMetricPoint[]>([]);

  const pnlChartRef = useRef<SVGSVGElement | null>(null);
  const skewChartRef = useRef<SVGSVGElement | null>(null);
  const latencyChartRef = useRef<SVGSVGElement | null>(null);

  const currentPair = useMemo(() => {
    return (
      tradingPairs.find(p => p.id === selectedPairId) ||
      tradingPairs[0] || {
        id: 'BTC-IDR',
        baseCurrency: 'BTC',
        quoteCurrency: 'IDR',
      }
    );
  }, [tradingPairs, selectedPairId]);

  const loadMetrics = async (pairId: string, timeframe: string) => {
    setIsLoading(true);
    const token = localStorage.getItem('dimonex_auth_token');
    try {
      const res = await safeFetchJson<any>(
        `/api/mm/performance/metrics?pairId=${pairId}&timeframe=${timeframe}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

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

  const formatIDR = (val: number): string => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);
  };

  // CHART 1: Cumulative Profit & Loss (PnL)
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

    const xExtent = d3.extent(seriesData, d => new Date(d.timestamp)) as [Date, Date];
    const xScale = d3.scaleTime().domain(xExtent).range([0, innerW]);

    const pnlValues = seriesData.map(d => d.cumulativePnl);
    const minY = Math.min(0, ...pnlValues);
    const maxY = Math.max(0, ...pnlValues);
    const padding = (maxY - minY) * 0.15 || 50000;
    const yScale = d3.scaleLinear().domain([minY - padding, maxY + padding]).range([innerH, 0]);

    const defs = svg.append('defs');
    const greenGrad = defs
      .append('linearGradient')
      .attr('id', 'pnl-green-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    greenGrad.append('stop').attr('offset', '0%').attr('stop-color', '#16A879').attr('stop-opacity', 0.35);
    greenGrad.append('stop').attr('offset', '100%').attr('stop-color', '#16A879').attr('stop-opacity', 0.0);

    const yTicks = yScale.ticks(5);
    g.selectAll('.grid-line')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#202B34')
      .attr('stroke-dasharray', '2,2');

    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', yScale(0))
      .attr('y2', yScale(0))
      .attr('stroke', '#40515D')
      .attr('stroke-width', 1.2);

    const area = d3
      .area<PerformanceMetricPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y0(yScale(0))
      .y1(d => yScale(d.cumulativePnl))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(seriesData).attr('fill', 'url(#pnl-green-grad)').attr('d', area);

    const line = d3
      .line<PerformanceMetricPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y(d => yScale(d.cumulativePnl))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(seriesData)
      .attr('fill', 'none')
      .attr('stroke', '#16A879')
      .attr('stroke-width', 2.2)
      .attr('d', line);

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
      .call(axis => axis.select('.domain').attr('stroke', '#2B3944'))
      .call(axis => axis.selectAll('.tick line').attr('stroke', '#2B3944'))
      .call(axis =>
        axis
          .selectAll('text')
          .attr('fill', '#71818B')
          .attr('font-size', '10px')
          .attr('font-family', 'IBM Plex Mono, monospace')
      );

    g.append('g')
      .call(yAxis)
      .call(axis => axis.select('.domain').attr('stroke', '#2B3944'))
      .call(axis => axis.selectAll('.tick line').attr('stroke', '#2B3944'))
      .call(axis =>
        axis
          .selectAll('text')
          .attr('fill', '#71818B')
          .attr('font-size', '10px')
          .attr('font-family', 'IBM Plex Mono, monospace')
      );

    const focusGroup = g.append('g').style('display', 'none');
    const verticalLine = focusGroup
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', '#536B77')
      .attr('stroke-dasharray', '3,3');

    const focusCircle = focusGroup
      .append('circle')
      .attr('r', 4.5)
      .attr('fill', '#16A879')
      .attr('stroke', '#E4EBEF')
      .attr('stroke-width', 1.5);

    const tooltipGroup = focusGroup.append('g');
    tooltipGroup
      .append('rect')
      .attr('fill', '#141C24')
      .attr('stroke', '#2B3944')
      .attr('rx', 7)
      .attr('ry', 7)
      .attr('width', 152)
      .attr('height', 44);

    const tooltipTextTime = tooltipGroup
      .append('text')
      .attr('fill', '#A1AFB8')
      .attr('font-size', '9px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('x', 8)
      .attr('y', 16);

    const tooltipTextPnl = tooltipGroup
      .append('text')
      .attr('fill', '#16A879')
      .attr('font-size', '11px')
      .attr('font-weight', 'bold')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('x', 8)
      .attr('y', 33);

    const bisectDate = d3.bisector<PerformanceMetricPoint, Date>(d => new Date(d.timestamp)).left;

    svg
      .append('rect')
      .attr('transform', `translate(${margin.left},${margin.top})`)
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('mouseover', () => focusGroup.style('display', null))
      .on('mouseout', () => focusGroup.style('display', 'none'))
      .on('mousemove', event => {
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx);
        const i = bisectDate(seriesData, x0, 1);
        const d0 = seriesData[i - 1];
        const d1 = seriesData[i];
        if (!d0) return;
        const d = !d1 ? d0 : x0.getTime() - d0.timestamp > d1.timestamp - x0.getTime() ? d1 : d0;

        const xPos = xScale(new Date(d.timestamp));
        const yPos = yScale(d.cumulativePnl);

        verticalLine.attr('x1', xPos).attr('x2', xPos);
        focusCircle.attr('cx', xPos).attr('cy', yPos);

        const tipX = xPos > innerW - 160 ? xPos - 158 : xPos + 10;
        const tipY = Math.max(0, Math.min(innerH - 48, yPos - 20));
        tooltipGroup.attr('transform', `translate(${tipX},${tipY})`);

        tooltipTextTime.text(new Date(d.timestamp).toLocaleTimeString('id-ID'));
        tooltipTextPnl.text(`PnL: Rp ${d.cumulativePnl.toLocaleString('id-ID')}`);
      });
  }, [seriesData]);

  // CHART 2: Inventory Skew Metrics
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

    g.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerW)
      .attr('height', yScale(0))
      .attr('fill', '#8DA5B1')
      .attr('opacity', 0.04);

    g.append('rect')
      .attr('x', 0)
      .attr('y', yScale(0))
      .attr('width', innerW)
      .attr('height', innerH - yScale(0))
      .attr('fill', '#D6A85C')
      .attr('opacity', 0.04);

    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', yScale(0))
      .attr('y2', yScale(0))
      .attr('stroke', '#40515D')
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '4,4');

    const yTicks = yScale.ticks(5);
    g.selectAll('.grid-line')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#202B34')
      .attr('stroke-dasharray', '2,2');

    const skewArea = d3
      .area<PerformanceMetricPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y0(yScale(0))
      .y1(d => yScale(d.inventorySkewBps))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(seriesData)
      .attr('fill', '#8DA5B1')
      .attr('fill-opacity', 0.2)
      .attr('d', skewArea);

    const skewLine = d3
      .line<PerformanceMetricPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y(d => yScale(d.inventorySkewBps))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(seriesData)
      .attr('fill', 'none')
      .attr('stroke', '#8DA5B1')
      .attr('stroke-width', 2)
      .attr('d', skewLine);

    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat('%H:%M') as any);
    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d => `${d} bps`);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call(axis => axis.select('.domain').attr('stroke', '#2B3944'))
      .call(axis => axis.selectAll('.tick line').attr('stroke', '#2B3944'))
      .call(axis =>
        axis
          .selectAll('text')
          .attr('fill', '#71818B')
          .attr('font-size', '10px')
          .attr('font-family', 'IBM Plex Mono, monospace')
      );

    g.append('g')
      .call(yAxis)
      .call(axis => axis.select('.domain').attr('stroke', '#2B3944'))
      .call(axis => axis.selectAll('.tick line').attr('stroke', '#2B3944'))
      .call(axis =>
        axis
          .selectAll('text')
          .attr('fill', '#71818B')
          .attr('font-size', '10px')
          .attr('font-family', 'IBM Plex Mono, monospace')
      );

    const focusGroup = g.append('g').style('display', 'none');
    const vLine = focusGroup
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', '#536B77')
      .attr('stroke-dasharray', '3,3');
    const fCircle = focusGroup
      .append('circle')
      .attr('r', 4.5)
      .attr('fill', '#C1D0D6')
      .attr('stroke', '#090D12')
      .attr('stroke-width', 1.5);

    const tipGroup = focusGroup.append('g');
    tipGroup
      .append('rect')
      .attr('fill', '#141C24')
      .attr('stroke', '#2B3944')
      .attr('rx', 7)
      .attr('ry', 7)
      .attr('width', 175)
      .attr('height', 44);
    const tTime = tipGroup
      .append('text')
      .attr('fill', '#A1AFB8')
      .attr('font-size', '9px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('x', 8)
      .attr('y', 16);
    const tSkew = tipGroup
      .append('text')
      .attr('fill', '#C1D0D6')
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('x', 8)
      .attr('y', 33);

    const bisectDate = d3.bisector<PerformanceMetricPoint, Date>(d => new Date(d.timestamp)).left;

    svg
      .append('rect')
      .attr('transform', `translate(${margin.left},${margin.top})`)
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('mouseover', () => focusGroup.style('display', null))
      .on('mouseout', () => focusGroup.style('display', 'none'))
      .on('mousemove', event => {
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx);
        const i = bisectDate(seriesData, x0, 1);
        const d0 = seriesData[i - 1];
        const d1 = seriesData[i];
        if (!d0) return;
        const d = !d1 ? d0 : x0.getTime() - d0.timestamp > d1.timestamp - x0.getTime() ? d1 : d0;

        const xPos = xScale(new Date(d.timestamp));
        const yPos = yScale(d.inventorySkewBps);

        vLine.attr('x1', xPos).attr('x2', xPos);
        fCircle.attr('cx', xPos).attr('cy', yPos);

        const tipX = xPos > innerW - 185 ? xPos - 180 : xPos + 10;
        const tipY = Math.max(0, Math.min(innerH - 48, yPos - 22));
        tipGroup.attr('transform', `translate(${tipX},${tipY})`);

        tTime.text(new Date(d.timestamp).toLocaleTimeString('id-ID'));
        tSkew.text(
          `Skew: ${d.inventorySkewBps > 0 ? '+' : ''}${d.inventorySkewBps} bps (${d.inventoryRatioPct}% Base)`
        );
      });
  }, [seriesData]);

  // CHART 3: Average Execution Latency
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

    const p95Val = summary.p95LatencyMs || 2.2;
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', yScale(p95Val))
      .attr('y2', yScale(p95Val))
      .attr('stroke', '#EA5B65')
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '4,4');

    g.append('text')
      .attr('x', innerW - 5)
      .attr('y', yScale(p95Val) - 4)
      .attr('text-anchor', 'end')
      .attr('fill', '#EA5B65')
      .attr('font-size', '9px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .text(`P95 Limit: ${p95Val} ms`);

    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', yScale(2.0))
      .attr('y2', yScale(2.0))
      .attr('stroke', '#D6A85C')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,2');

    const yTicks = yScale.ticks(5);
    g.selectAll('.grid-line')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', d => yScale(d))
      .attr('y2', d => yScale(d))
      .attr('stroke', '#202B34')
      .attr('stroke-dasharray', '2,2');

    const latLine = d3
      .line<PerformanceMetricPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y(d => yScale(d.latencyMs))
      .curve(d3.curveMonotoneX);

    const defs = svg.append('defs');
    const latGrad = defs
      .append('linearGradient')
      .attr('id', 'lat-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    latGrad.append('stop').attr('offset', '0%').attr('stop-color', '#6D9FE8').attr('stop-opacity', 0.3);
    latGrad.append('stop').attr('offset', '100%').attr('stop-color', '#6D9FE8').attr('stop-opacity', 0.0);

    const latArea = d3
      .area<PerformanceMetricPoint>()
      .x(d => xScale(new Date(d.timestamp)))
      .y0(innerH)
      .y1(d => yScale(d.latencyMs))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(seriesData).attr('fill', 'url(#lat-grad)').attr('d', latArea);

    g.append('path')
      .datum(seriesData)
      .attr('fill', 'none')
      .attr('stroke', '#6D9FE8')
      .attr('stroke-width', 1.8)
      .attr('d', latLine);

    g.selectAll('.spike-circle')
      .data(seriesData.filter(d => d.latencyMs > 2.0))
      .enter()
      .append('circle')
      .attr('cx', d => xScale(new Date(d.timestamp)))
      .attr('cy', d => yScale(d.latencyMs))
      .attr('r', 3)
      .attr('fill', '#EA5B65');

    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat('%H:%M') as any);
    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d => `${d} ms`);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call(axis => axis.select('.domain').attr('stroke', '#2B3944'))
      .call(axis => axis.selectAll('.tick line').attr('stroke', '#2B3944'))
      .call(axis =>
        axis
          .selectAll('text')
          .attr('fill', '#71818B')
          .attr('font-size', '10px')
          .attr('font-family', 'IBM Plex Mono, monospace')
      );

    g.append('g')
      .call(yAxis)
      .call(axis => axis.select('.domain').attr('stroke', '#2B3944'))
      .call(axis => axis.selectAll('.tick line').attr('stroke', '#2B3944'))
      .call(axis =>
        axis
          .selectAll('text')
          .attr('fill', '#71818B')
          .attr('font-size', '10px')
          .attr('font-family', 'IBM Plex Mono, monospace')
      );

    const focusGroup = g.append('g').style('display', 'none');
    const vLine = focusGroup
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', '#536B77')
      .attr('stroke-dasharray', '3,3');
    const fCircle = focusGroup
      .append('circle')
      .attr('r', 4.5)
      .attr('fill', '#6D9FE8')
      .attr('stroke', '#E4EBEF')
      .attr('stroke-width', 1.5);

    const tipGroup = focusGroup.append('g');
    tipGroup
      .append('rect')
      .attr('fill', '#141C24')
      .attr('stroke', '#2B3944')
      .attr('rx', 7)
      .attr('ry', 7)
      .attr('width', 145)
      .attr('height', 42);
    const tTime = tipGroup
      .append('text')
      .attr('fill', '#A1AFB8')
      .attr('font-size', '9px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('x', 8)
      .attr('y', 15);
    const tLat = tipGroup
      .append('text')
      .attr('fill', '#6D9FE8')
      .attr('font-size', '11px')
      .attr('font-weight', 'bold')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('x', 8)
      .attr('y', 32);

    const bisectDate = d3.bisector<PerformanceMetricPoint, Date>(d => new Date(d.timestamp)).left;

    svg
      .append('rect')
      .attr('transform', `translate(${margin.left},${margin.top})`)
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('mouseover', () => focusGroup.style('display', null))
      .on('mouseout', () => focusGroup.style('display', 'none'))
      .on('mousemove', event => {
        const [mx] = d3.pointer(event);
        const x0 = xScale.invert(mx);
        const i = bisectDate(seriesData, x0, 1);
        const d0 = seriesData[i - 1];
        const d1 = seriesData[i];
        if (!d0) return;
        const d = !d1 ? d0 : x0.getTime() - d0.timestamp > d1.timestamp - x0.getTime() ? d1 : d0;

        const xPos = xScale(new Date(d.timestamp));
        const yPos = yScale(d.latencyMs);

        vLine.attr('x1', xPos).attr('x2', xPos);
        fCircle.attr('cx', xPos).attr('cy', yPos);

        const tipX = xPos > innerW - 155 ? xPos - 150 : xPos + 10;
        const tipY = Math.max(0, Math.min(innerH - 46, yPos - 20));
        tipGroup.attr('transform', `translate(${tipX},${tipY})`);

        tTime.text(new Date(d.timestamp).toLocaleTimeString('id-ID'));
        tLat.text(`Latensi: ${d.latencyMs.toFixed(2)} ms`);
      });
  }, [seriesData, summary]);

  return (
    <div className="space-y-5">
      {/* Toolbar Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#141C24] p-5 rounded-[10px] border border-[#202B34]">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-[7px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1] shrink-0">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base font-semibold tracking-tight text-[#E4EBEF]">
                HFT Bot Performance Dashboard
              </h2>
              <StatusBadge tone="brand">Analytics Engine</StatusBadge>
            </div>
            <p className="text-xs text-[#A1AFB8] mt-1">
              Visualisasi laba/rugi kumulatif, kemiringan inventaris (inventory skew), dan latensi eksekusi sub-milidetik.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <SegmentedTabs
            tabs={TIMEFRAME_TABS}
            activeTab={selectedTimeframe}
            onChange={setSelectedTimeframe}
            size="sm"
          />

          <label htmlFor="performance-pair-select" className="sr-only">
            Pilih Trading Pair
          </label>
          <select
            id="performance-pair-select"
            aria-label="Pilih Trading Pair"
            value={selectedPairId}
            onChange={(e) => setSelectedPairId(e.target.value)}
            className="bg-[#111820] text-[#E4EBEF] font-mono text-xs font-medium px-3 py-2 rounded-[7px] border border-[#2B3944] focus:outline-none focus:border-[#8DA5B1]"
          >
            {tradingPairs.map(p => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => loadMetrics(selectedPairId, selectedTimeframe)}
            isLoading={isLoading}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            title="Refresh Metrics"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-[#141C24] p-4 rounded-[10px] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B]">Net PnL Bot</span>
          <div
            className={`text-base font-mono tabular-nums font-semibold mt-1 ${
              summary.netPnlIdr >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'
            }`}
          >
            {formatIDR(summary.netPnlIdr)}
          </div>
          <span className="text-[11px] font-mono tabular-nums text-[#A1AFB8]">
            {summary.pnlPercentage >= 0 ? `+${summary.pnlPercentage}%` : `${summary.pnlPercentage}%`}
          </span>
        </div>

        <div className="bg-[#141C24] p-4 rounded-[10px] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B]">Laba Terealisasi</span>
          <div className="text-base font-mono tabular-nums font-semibold text-[#E4EBEF] mt-1">
            {formatIDR(summary.totalRealizedPnlIdr)}
          </div>
          <span className="text-[11px] text-[#71818B] font-mono">Fills &amp; Spreads</span>
        </div>

        <div className="bg-[#141C24] p-4 rounded-[10px] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B]">Win Rate Maker</span>
          <div className="text-base font-mono tabular-nums font-semibold text-[#8DA5B1] mt-1">
            {summary.winRatePct}%
          </div>
          <span className="text-[11px] text-[#71818B] font-mono tabular-nums">
            {summary.totalTradesCount} total trade
          </span>
        </div>

        <div className="bg-[#141C24] p-4 rounded-[10px] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B]">Inventory Skew</span>
          <div className="text-base font-mono tabular-nums font-semibold text-[#D6A85C] mt-1">
            {summary.currentInventorySkewBps > 0
              ? `+${summary.currentInventorySkewBps}`
              : summary.currentInventorySkewBps}{' '}
            bps
          </div>
          <span className="text-[11px] text-[#A1AFB8] font-mono tabular-nums">
            {summary.currentBaseRatioPct}% {currentPair.baseCurrency}
          </span>
        </div>

        <div className="bg-[#141C24] p-4 rounded-[10px] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B]">Rerata Latensi</span>
          <div className="text-base font-mono tabular-nums font-semibold text-[#6D9FE8] mt-1">
            {summary.averageLatencyMs} ms
          </div>
          <span className="text-[11px] text-[#71818B] font-mono">Internal engine RTT</span>
        </div>

        <div className="bg-[#141C24] p-4 rounded-[10px] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B]">P95 Latensi</span>
          <div className="text-base font-mono tabular-nums font-semibold text-[#EA5B65] mt-1">
            {summary.p95LatencyMs} ms
          </div>
          <span className="text-[11px] text-[#71818B] font-mono">Tail risk threshold</span>
        </div>
      </div>

      {/* Primary Chart: Cumulative PnL */}
      <div className="bg-[#141C24] p-5 rounded-[10px] border border-[#202B34] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[#E4EBEF]">
              Grafik Laba &amp; Rugi Kumulatif (PnL Over Time)
            </h3>
            <p className="text-xs text-[#71818B] mt-0.5">
              Laba bersih dari spread matching engine dan pergerakan inventaris
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-[#A1AFB8]">
            Net:{' '}
            <span className={summary.netPnlIdr >= 0 ? 'text-[#16A879] font-semibold' : 'text-[#EA5B65] font-semibold'}>
              {formatIDR(summary.netPnlIdr)}
            </span>
          </div>
        </div>

        <div className="w-full bg-[#111820] rounded-[7px] overflow-hidden border border-[#202B34] p-2">
          <svg ref={pnlChartRef} className="w-full h-56 block" />
        </div>
      </div>

      {/* Two-Column Grid: Skew & Latency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-[#141C24] p-5 rounded-[10px] border border-[#202B34] space-y-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">
                Metrik Kemiringan Inventaris (Inventory Skew)
              </h3>
              <p className="text-xs text-[#71818B] mt-0.5">
                Deviasi persentase portofolio terhadap ekuilibrium 50/50 (Avellaneda-Stoikov)
              </p>
            </div>
            <StatusBadge tone="brand">
              {summary.currentInventorySkewBps > 0
                ? `+${summary.currentInventorySkewBps}`
                : summary.currentInventorySkewBps}{' '}
              bps
            </StatusBadge>
          </div>

          <div className="w-full bg-[#111820] rounded-[7px] overflow-hidden border border-[#202B34] p-2">
            <svg ref={skewChartRef} className="w-full h-56 block" />
          </div>

          <div className="flex justify-between text-[11px] text-[#71818B] font-mono">
            <span className="text-[#8DA5B1]">Zona Bias Long ({currentPair.baseCurrency})</span>
            <span>0 bps Netral</span>
            <span className="text-[#D6A85C]">Zona Bias Quote ({currentPair.quoteCurrency})</span>
          </div>
        </div>

        <div className="bg-[#141C24] p-5 rounded-[10px] border border-[#202B34] space-y-3">
          <div className="flex justify-between items-start gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#E4EBEF]">
                Rerata Latensi Eksekusi (Execution Latency ms)
              </h3>
              <p className="text-xs text-[#71818B] mt-0.5">
                Waktu putaran (round-trip) pemrosesan order limit bot di matching engine
              </p>
            </div>
            <StatusBadge tone="info">Avg {summary.averageLatencyMs} ms</StatusBadge>
          </div>

          <div className="w-full bg-[#111820] rounded-[7px] overflow-hidden border border-[#202B34] p-2">
            <svg ref={latencyChartRef} className="w-full h-56 block" />
          </div>

          <div className="flex justify-between text-[11px] text-[#71818B] font-mono tabular-nums">
            <span className="text-[#6D9FE8]">Optimal (&lt; 2.0 ms)</span>
            <span className="text-[#D6A85C]">Target 2.0 ms</span>
            <span className="text-[#EA5B65]">P95: {summary.p95LatencyMs} ms</span>
          </div>
        </div>
      </div>
    </div>
  );
};
