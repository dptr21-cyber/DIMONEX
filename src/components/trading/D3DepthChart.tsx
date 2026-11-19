/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/trading/D3DepthChart.tsx
 * Interactive Order Book Depth Visualization powered by D3.js in Obsidian Iridium matte styling.
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { TradingPairItem } from '../../types/index.js';
import { safeBigInt, formatQuotePrice } from '../../lib/formatters.js';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface Props {
  pair: TradingPairItem;
  depth: {
    bids: [string, string, string][];
    asks: [string, string, string][];
    spread: string;
  };
  myOpenOrderPrices?: Set<string>;
  onSelectPrice: (priceUnits: string) => void;
  height?: number;
  compact?: boolean;
}

interface DepthPoint {
  priceUnits: bigint;
  priceNum: number;
  volumeUnits: bigint;
  volumeNum: number;
  rawPrice: string;
  side: 'BID' | 'ASK';
}

export const D3DepthChart: React.FC<Props> = ({
  pair,
  depth,
  myOpenOrderPrices,
  onSelectPrice,
  height = 320,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [zoomFactor, setZoomFactor] = useState<number>(1.0);
  const [hoveredPoint, setHoveredPoint] = useState<DepthPoint | null>(null);

  const isQuoteIDR = (pair.quoteCurrency || 'IDR').toUpperCase() === 'IDR';
  const quoteDecimals =
    pair.quoteDecimals !== undefined && pair.quoteDecimals !== null
      ? pair.quoteDecimals
      : (isQuoteIDR ? 2 : 6);
  const baseScale = 10 ** (pair.baseDecimals || 8);
  const quoteScale = 10 ** Math.max(0, quoteDecimals);

  const formatPrice = (priceUnitsStr: string) => {
    return formatQuotePrice(priceUnitsStr, pair.quoteCurrency, quoteDecimals, true);
  };

  const { bidPoints, askPoints, totalBidVol, totalAskVol, midPriceNum } = useMemo(() => {
    const rawBids = depth?.bids || [];
    const rawAsks = depth?.asks || [];

    const bids: DepthPoint[] = [];
    for (let i = rawBids.length - 1; i >= 0; i--) {
      const [pStr, , cumStr] = rawBids[i];
      const pUnits = safeBigInt(pStr);
      const cUnits = safeBigInt(cumStr);
      bids.push({
        priceUnits: pUnits,
        priceNum: Number(pUnits) / quoteScale,
        volumeUnits: cUnits,
        volumeNum: Number(cUnits) / baseScale,
        rawPrice: pStr,
        side: 'BID'
      });
    }

    const asks: DepthPoint[] = [];
    for (let i = 0; i < rawAsks.length; i++) {
      const [pStr, , cumStr] = rawAsks[i];
      const pUnits = safeBigInt(pStr);
      const cUnits = safeBigInt(cumStr);
      asks.push({
        priceUnits: pUnits,
        priceNum: Number(pUnits) / quoteScale,
        volumeUnits: cUnits,
        volumeNum: Number(cUnits) / baseScale,
        rawPrice: pStr,
        side: 'ASK'
      });
    }

    const maxB = bids.length > 0 ? bids[0].volumeNum : 0;
    const maxA = asks.length > 0 ? asks[asks.length - 1].volumeNum : 0;
    const midNum = Number(safeBigInt(pair.lastPrice || '0')) / quoteScale;

    return {
      bidPoints: bids,
      askPoints: asks,
      totalBidVol: maxB,
      totalAskVol: maxA,
      midPriceNum: midNum
    };
  }, [depth, pair.lastPrice, baseScale, quoteScale]);

  const totalPressure = totalBidVol + totalAskVol;
  const bidRatio = totalPressure > 0 ? Math.round((totalBidVol / totalPressure) * 100) : 50;
  const askRatio = 100 - bidRatio;

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = containerRef.current.clientWidth || 360;
    const chartHeight = height;
    const margin = { top: 16, right: 48, bottom: 28, left: 12 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = chartHeight - margin.top - margin.bottom;

    if (innerWidth <= 0 || innerHeight <= 0) return;

    const sliceCount = Math.max(4, Math.floor(50 / zoomFactor));
    const activeBids = bidPoints.slice(Math.max(0, bidPoints.length - sliceCount));
    const activeAsks = askPoints.slice(0, sliceCount);

    if (activeBids.length === 0 && activeAsks.length === 0) {
      const gEmpty = svg.append('g').attr('transform', `translate(${width / 2}, ${chartHeight / 2})`);
      gEmpty
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('fill', '#71818B')
        .attr('font-size', '11px')
        .attr('font-family', 'IBM Plex Mono, monospace')
        .text('Waiting for active resting orders...');
      return;
    }

    const minBidPrice = activeBids.length > 0 ? activeBids[0].priceNum : midPriceNum * 0.95;
    const maxAskPrice = activeAsks.length > 0 ? activeAsks[activeAsks.length - 1].priceNum : midPriceNum * 1.05;
    const xDomainMin = Math.min(minBidPrice, midPriceNum * 0.9);
    const xDomainMax = Math.max(maxAskPrice, midPriceNum * 1.1);

    const xScale = d3.scaleLinear().domain([xDomainMin, xDomainMax]).range([0, innerWidth]);

    const activeMaxVol =
      Math.max(
        activeBids.length > 0 ? activeBids[0].volumeNum : 0,
        activeAsks.length > 0 ? activeAsks[activeAsks.length - 1].volumeNum : 0,
        0.001
      ) * 1.1;

    const yScale = d3.scaleLinear().domain([0, activeMaxVol]).range([innerHeight, 0]).nice();

    const defs = svg.append('defs');

    const bidGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-bid-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    bidGrad.append('stop').attr('offset', '0%').attr('stop-color', '#16A879').attr('stop-opacity', 0.38);
    bidGrad.append('stop').attr('offset', '90%').attr('stop-color', '#16A879').attr('stop-opacity', 0.04);
    bidGrad.append('stop').attr('offset', '100%').attr('stop-color', '#16A879').attr('stop-opacity', 0.0);

    const askGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-ask-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    askGrad.append('stop').attr('offset', '0%').attr('stop-color', '#EA5B65').attr('stop-opacity', 0.38);
    askGrad.append('stop').attr('offset', '90%').attr('stop-color', '#EA5B65').attr('stop-opacity', 0.04);
    askGrad.append('stop').attr('offset', '100%').attr('stop-color', '#EA5B65').attr('stop-opacity', 0.0);

    const mainG = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`);

    const yGrid = d3.axisRight(yScale).ticks(4).tickSize(innerWidth).tickFormat(() => '');

    mainG
      .append('g')
      .attr('class', 'grid')
      .call(yGrid)
      .selectAll('line')
      .attr('stroke', '#202B34')
      .attr('stroke-dasharray', '2,2');

    mainG.select('.grid .domain').remove();

    const bidArea = d3
      .area<DepthPoint>()
      .x(d => xScale(d.priceNum))
      .y0(innerHeight)
      .y1(d => yScale(d.volumeNum))
      .curve(d3.curveStepBefore);

    const bidLine = d3
      .line<DepthPoint>()
      .x(d => xScale(d.priceNum))
      .y(d => yScale(d.volumeNum))
      .curve(d3.curveStepBefore);

    const askArea = d3
      .area<DepthPoint>()
      .x(d => xScale(d.priceNum))
      .y0(innerHeight)
      .y1(d => yScale(d.volumeNum))
      .curve(d3.curveStepAfter);

    const askLine = d3
      .line<DepthPoint>()
      .x(d => xScale(d.priceNum))
      .y(d => yScale(d.volumeNum))
      .curve(d3.curveStepAfter);

    if (activeBids.length > 0) {
      const bidDataWithAnchor = [
        ...activeBids,
        {
          priceUnits: activeBids[activeBids.length - 1].priceUnits,
          priceNum: activeBids[activeBids.length - 1].priceNum,
          volumeUnits: 0n,
          volumeNum: 0,
          rawPrice: activeBids[activeBids.length - 1].rawPrice,
          side: 'BID' as const
        }
      ];

      mainG.append('path').datum(bidDataWithAnchor).attr('fill', 'url(#d3-bid-grad)').attr('d', bidArea);
      mainG
        .append('path')
        .datum(activeBids)
        .attr('fill', 'none')
        .attr('stroke', '#16A879')
        .attr('stroke-width', 1.75)
        .attr('d', bidLine);
    }

    if (activeAsks.length > 0) {
      const askDataWithAnchor = [
        {
          priceUnits: activeAsks[0].priceUnits,
          priceNum: activeAsks[0].priceNum,
          volumeUnits: 0n,
          volumeNum: 0,
          rawPrice: activeAsks[0].rawPrice,
          side: 'ASK' as const
        },
        ...activeAsks
      ];

      mainG.append('path').datum(askDataWithAnchor).attr('fill', 'url(#d3-ask-grad)').attr('d', askArea);
      mainG
        .append('path')
        .datum(activeAsks)
        .attr('fill', 'none')
        .attr('stroke', '#EA5B65')
        .attr('stroke-width', 1.75)
        .attr('d', askLine);
    }

    if (midPriceNum > 0 && midPriceNum >= xDomainMin && midPriceNum <= xDomainMax) {
      const midX = xScale(midPriceNum);
      mainG
        .append('line')
        .attr('x1', midX)
        .attr('y1', 0)
        .attr('x2', midX)
        .attr('y2', innerHeight)
        .attr('stroke', '#8DA5B1')
        .attr('stroke-dasharray', '3,3')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7);

      mainG
        .append('text')
        .attr('x', midX)
        .attr('y', 10)
        .attr('text-anchor', 'middle')
        .attr('fill', '#A1AFB8')
        .attr('font-size', '9px')
        .attr('font-family', 'IBM Plex Mono, monospace')
        .attr('font-weight', '600')
        .text('MID');
    }

    const xAxis = d3
      .axisBottom(xScale)
      .ticks(Math.max(3, Math.floor(innerWidth / 90)))
      .tickFormat(d => {
        const val = Number(d);
        if (!isQuoteIDR) {
          if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`;
          if (val >= 1) return `$${val.toFixed(2)}`;
          if (val >= 0.01) return `$${val.toFixed(4)}`;
          if (val > 0) return `$${val.toPrecision(3)}`;
          return '$0';
        }
        if (val >= 1000000000) return `${(val / 1000000000).toFixed(1)}M`;
        if (val >= 1000000) return `${(val / 1000000).toFixed(0)}jt`;
        if (val >= 1000) return `${(val / 1000).toFixed(0)}k`;
        return `${val}`;
      });

    const gX = mainG.append('g').attr('transform', `translate(0, ${innerHeight})`).call(xAxis);
    gX.select('.domain').attr('stroke', '#2B3944');
    gX.selectAll('line').attr('stroke', '#2B3944');
    gX.selectAll('text').attr('fill', '#71818B').attr('font-size', '10px').attr('font-family', 'IBM Plex Mono, monospace');

    const yAxis = d3
      .axisRight(yScale)
      .ticks(4)
      .tickFormat(d => {
        const val = Number(d);
        if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
        if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
        return val.toFixed(val < 1 ? 2 : 1);
      });

    const gY = mainG.append('g').attr('transform', `translate(${innerWidth}, 0)`).call(yAxis);
    gY.select('.domain').remove();
    gY.selectAll('line').remove();
    gY.selectAll('text').attr('fill', '#71818B').attr('font-size', '10px').attr('font-family', 'IBM Plex Mono, monospace');

    if (myOpenOrderPrices && myOpenOrderPrices.size > 0) {
      myOpenOrderPrices.forEach(pStr => {
        try {
          const pVal = Number(safeBigInt(pStr)) / quoteScale;
          if (pVal >= xDomainMin && pVal <= xDomainMax) {
            const pX = xScale(pVal);
            mainG
              .append('line')
              .attr('x1', pX)
              .attr('y1', 0)
              .attr('x2', pX)
              .attr('y2', innerHeight)
              .attr('stroke', '#6D9FE8')
              .attr('stroke-width', 1.25)
              .attr('stroke-dasharray', '2,2');

            mainG.append('circle').attr('cx', pX).attr('cy', 8).attr('r', 3.5).attr('fill', '#6D9FE8');
          }
        } catch {}
      });
    }

    const allPoints = [...activeBids, ...activeAsks];

    const overlay = mainG
      .append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .attr('cursor', 'crosshair');

    const crosshairV = mainG
      .append('line')
      .attr('stroke', '#8DA5B1')
      .attr('stroke-dasharray', '2,2')
      .attr('stroke-width', 1)
      .attr('opacity', 0)
      .attr('pointer-events', 'none');

    const crosshairH = mainG
      .append('line')
      .attr('stroke', '#8DA5B1')
      .attr('stroke-dasharray', '2,2')
      .attr('stroke-width', 1)
      .attr('opacity', 0)
      .attr('pointer-events', 'none');

    const highlightCircle = mainG
      .append('circle')
      .attr('r', 4)
      .attr('opacity', 0)
      .attr('pointer-events', 'none');

    overlay.on('mousemove', event => {
      const [mx] = d3.pointer(event);
      const hoveredPriceNum = xScale.invert(mx);

      let nearest: DepthPoint | null = null;
      let minDiff = Infinity;

      for (const pt of allPoints) {
        const diff = Math.abs(pt.priceNum - hoveredPriceNum);
        if (diff < minDiff) {
          minDiff = diff;
          nearest = pt;
        }
      }

      if (nearest) {
        const ptX = xScale(nearest.priceNum);
        const ptY = yScale(nearest.volumeNum);

        crosshairV.attr('x1', ptX).attr('x2', ptX).attr('y1', 0).attr('y2', innerHeight).attr('opacity', 0.8);
        crosshairH.attr('x1', 0).attr('x2', innerWidth).attr('y1', ptY).attr('y2', ptY).attr('opacity', 0.8);

        highlightCircle
          .attr('cx', ptX)
          .attr('cy', ptY)
          .attr('fill', nearest.side === 'BID' ? '#16A879' : '#EA5B65')
          .attr('stroke', '#E4EBEF')
          .attr('stroke-width', 1.5)
          .attr('opacity', 1);

        setHoveredPoint(nearest);
      }
    });

    overlay.on('mouseleave', () => {
      crosshairV.attr('opacity', 0);
      crosshairH.attr('opacity', 0);
      highlightCircle.attr('opacity', 0);
      setHoveredPoint(null);
    });

    overlay.on('click', event => {
      const [mx] = d3.pointer(event);
      const clickedPriceNum = xScale.invert(mx);
      let nearest: DepthPoint | null = null;
      let minDiff = Infinity;

      for (const pt of allPoints) {
        const diff = Math.abs(pt.priceNum - clickedPriceNum);
        if (diff < minDiff) {
          minDiff = diff;
          nearest = pt;
        }
      }

      if (nearest) {
        onSelectPrice(nearest.rawPrice);
      }
    });
  }, [bidPoints, askPoints, midPriceNum, zoomFactor, height, isQuoteIDR, myOpenOrderPrices, onSelectPrice, quoteScale]);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col bg-[#141C24] border border-[#202B34] rounded-[10px] overflow-hidden w-full select-none"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#111820] border-b border-[#202B34] text-xs font-mono tabular-nums">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#E4EBEF] flex items-center gap-1.5 font-sans">
            <span className="w-1.5 h-1.5 rounded-full bg-[#16A879]" />
            Market Liquidity Depth
          </span>
          <span className="text-[#40515D]">·</span>
          <span className="text-[11px] text-[#A1AFB8]">
            Spread: <strong className="text-[#E4EBEF]">{formatPrice(depth.spread)}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1 bg-[#141C24] p-0.5 rounded-[7px] border border-[#2B3944]">
          <button
            type="button"
            title="Zoom In"
            onClick={() => setZoomFactor(prev => Math.min(3.0, prev + 0.3))}
            className="p-1 rounded-[5px] text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#222F3A] transition-colors cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Zoom Out"
            onClick={() => setZoomFactor(prev => Math.max(0.4, prev - 0.3))}
            className="p-1 rounded-[5px] text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#222F3A] transition-colors cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Reset Zoom"
            onClick={() => setZoomFactor(1.0)}
            className="p-1 rounded-[5px] text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#222F3A] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Aggregate Buy / Sell Pressure Bar */}
      <div className="px-3 py-1.5 bg-[#090D12] border-b border-[#202B34] space-y-1">
        <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
          <span className="text-[#16A879] font-semibold">
            Bids: {bidRatio}% ({totalBidVol.toFixed(3)} {pair.baseCurrency})
          </span>
          <span className="text-[#71818B] text-[9px] font-sans uppercase tracking-wider">L2 Order Book Balance</span>
          <span className="text-[#EA5B65] font-semibold">
            Asks: {askRatio}% ({totalAskVol.toFixed(3)} {pair.baseCurrency})
          </span>
        </div>
        <div className="h-1.5 w-full bg-[#17212B] rounded-full overflow-hidden flex">
          <div className="bg-[#16A879] h-full transition-all duration-300" style={{ width: `${bidRatio}%` }} />
          <div className="bg-[#EA5B65] h-full transition-all duration-300" style={{ width: `${askRatio}%` }} />
        </div>
      </div>

      {/* D3 Canvas Container */}
      <div className="relative flex-1 w-full bg-[#090D12]" style={{ height: `${height}px` }}>
        <svg ref={svgRef} width="100%" height={height} className="overflow-visible block" />

        {hoveredPoint && (
          <div className="absolute top-3 left-3 bg-[#1D2832] border border-[#2B3944] rounded-[7px] p-2.5 shadow-lg text-xs font-mono tabular-nums space-y-1 pointer-events-none z-30">
            <div className="flex items-center justify-between gap-4 pb-1 border-b border-[#202B34] text-[11px]">
              <span className={`font-semibold ${hoveredPoint.side === 'BID' ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                {hoveredPoint.side === 'BID' ? 'Cumulative Bid Depth' : 'Cumulative Ask Depth'}
              </span>
              {myOpenOrderPrices?.has(hoveredPoint.rawPrice) && (
                <span className="px-1.5 py-0.5 rounded-[5px] bg-[#162436] text-[#6D9FE8] border border-[#6D9FE8]/30 text-[9px] font-sans font-semibold">
                  Your Order
                </span>
              )}
            </div>

            <div className="flex justify-between gap-6 text-[11px]">
              <span className="text-[#71818B]">Price ({pair.quoteCurrency}):</span>
              <span className="font-semibold text-[#E4EBEF]">{formatPrice(hoveredPoint.rawPrice)}</span>
            </div>

            <div className="flex justify-between gap-6 text-[11px]">
              <span className="text-[#71818B]">Cumulative Depth:</span>
              <span className={hoveredPoint.side === 'BID' ? 'text-[#16A879] font-semibold' : 'text-[#EA5B65] font-semibold'}>
                {hoveredPoint.volumeNum.toFixed(4)} {pair.baseCurrency}
              </span>
            </div>

            <div className="text-[10px] font-sans text-[#71818B] pt-1 text-center">
              Click to apply price to order form
            </div>
          </div>
        )}
      </div>

      {/* Footer Legend */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#111820] border-t border-[#202B34] text-[10px] text-[#71818B] font-mono tabular-nums">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-[2px] bg-[#16A879]" /> Bids ({bidPoints.length})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-[2px] bg-[#EA5B65]" /> Asks ({askPoints.length})
          </span>
        </div>
        <span className="text-[#A1AFB8]">Real-time L2 Matching Depth</span>
      </div>
    </div>
  );
};
