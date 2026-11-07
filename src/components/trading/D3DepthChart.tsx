/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/trading/D3DepthChart.tsx
 * High-performance, interactive Order Book Depth Visualization powered by D3.js.
 * Renders real-time cumulative bid (buy) and ask (sell) step area curves with:
 * - Mid-market spread indicator & reference lines
 * - Dynamic SVG gradients (#00C087 for Bids, #EB3458 for Asks)
 * - Interactive hover crosshairs and floating tooltip
 * - Click-to-select price for immediate order placement
 * - Depth zoom controls (+ / - / Reset)
 * - Live buy/sell pressure volume ratio
 * Strictly zero mock data — direct integration with Matching Engine L2 depth.
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { TradingPairItem } from '../../types/index.js';
import { formatIDR, formatCrypto, safeBigInt } from '../../lib/formatters.js';
import { ZoomIn, ZoomOut, RotateCcw, Crosshair } from 'lucide-react';

interface Props {
  pair: TradingPairItem;
  depth: {
    bids: [string, string, string][]; // [price, qty, cumulativeQty]
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
  compact = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Zoom level state (1.0 = normal, 0.5 = wide macro view, 2.0 = tight near-spread view)
  const [zoomFactor, setZoomFactor] = useState<number>(1.0);
  const [hoveredPoint, setHoveredPoint] = useState<DepthPoint | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const isQuoteUSDT = pair.quoteCurrency === 'USDT';
  const baseScale = 10 ** (pair.baseDecimals || 8);
  const quoteScale = isQuoteUSDT ? 10 ** (pair.quoteDecimals || 6) : 100; // IDR is sen (100)

  // Format price helper based on quote currency
  const formatPrice = (priceUnitsStr: string) => {
    if (isQuoteUSDT) {
      try {
        const u = safeBigInt(priceUnitsStr);
        const dec = pair.quoteDecimals || 6;
        const val = Number(u) / (10 ** dec);
        return `${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDT`;
      } catch {
        return `${priceUnitsStr} USDT`;
      }
    }
    return formatIDR(priceUnitsStr, false);
  };

  // 1. Process Depth Data into Cumulative Step Arrays
  const { bidPoints, askPoints, maxCumVolume, totalBidVol, totalAskVol, midPriceNum } = useMemo(() => {
    const rawBids = depth?.bids || [];
    const rawAsks = depth?.asks || [];

    // Parse Bids (raw bids are sorted highest price first)
    // For D3 X-axis, bids go from min price up to best bid
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

    // Parse Asks (raw asks are sorted lowest price first)
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
    const maxVol = Math.max(maxB, maxA, 0.0001);

    const midNum = Number(safeBigInt(pair.lastPrice || '0')) / quoteScale;

    return {
      bidPoints: bids,
      askPoints: asks,
      maxCumVolume: maxVol,
      totalBidVol: maxB,
      totalAskVol: maxA,
      midPriceNum: midNum
    };
  }, [depth, pair.lastPrice, baseScale, quoteScale]);

  // Aggregate Pressure Ratio
  const totalPressure = totalBidVol + totalAskVol;
  const bidRatio = totalPressure > 0 ? Math.round((totalBidVol / totalPressure) * 100) : 50;
  const askRatio = 100 - bidRatio;

  // 2. D3 Render Pipeline
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

    // Filter points based on zoomFactor
    // When zoom is high, we take closer slice to mid price
    const sliceCount = Math.max(4, Math.floor(50 / zoomFactor));
    const activeBids = bidPoints.slice(Math.max(0, bidPoints.length - sliceCount));
    const activeAsks = askPoints.slice(0, sliceCount);

    if (activeBids.length === 0 && activeAsks.length === 0) {
      // Empty state
      const gEmpty = svg.append('g').attr('transform', `translate(${width / 2}, ${chartHeight / 2})`);
      gEmpty.append('text')
        .attr('text-anchor', 'middle')
        .attr('fill', '#686D7A')
        .attr('font-size', '11px')
        .attr('font-family', 'monospace')
        .text('Menunggu antrean order aktif...');
      return;
    }

    // Min & Max Price on X axis
    const minBidPrice = activeBids.length > 0 ? activeBids[0].priceNum : midPriceNum * 0.95;
    const maxAskPrice = activeAsks.length > 0 ? activeAsks[activeAsks.length - 1].priceNum : midPriceNum * 1.05;
    const xDomainMin = Math.min(minBidPrice, midPriceNum * 0.9);
    const xDomainMax = Math.max(maxAskPrice, midPriceNum * 1.1);

    // X Scale (Price)
    const xScale = d3.scaleLinear()
      .domain([xDomainMin, xDomainMax])
      .range([0, innerWidth]);

    // Y Scale (Cumulative Volume)
    const activeMaxVol = Math.max(
      activeBids.length > 0 ? activeBids[0].volumeNum : 0,
      activeAsks.length > 0 ? activeAsks[activeAsks.length - 1].volumeNum : 0,
      0.001
    ) * 1.1;

    const yScale = d3.scaleLinear()
      .domain([0, activeMaxVol])
      .range([innerHeight, 0])
      .nice();

    // Defs: Gradients & clip paths
    const defs = svg.append('defs');

    // Bid Gradient (Green)
    const bidGrad = defs.append('linearGradient')
      .attr('id', 'd3-bid-grad')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    bidGrad.append('stop').attr('offset', '0%').attr('stop-color', '#00C087').attr('stop-opacity', 0.45);
    bidGrad.append('stop').attr('offset', '90%').attr('stop-color', '#00C087').attr('stop-opacity', 0.04);
    bidGrad.append('stop').attr('offset', '100%').attr('stop-color', '#00C087').attr('stop-opacity', 0.0);

    // Ask Gradient (Crimson Red)
    const askGrad = defs.append('linearGradient')
      .attr('id', 'd3-ask-grad')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    askGrad.append('stop').attr('offset', '0%').attr('stop-color', '#EB3458').attr('stop-opacity', 0.45);
    askGrad.append('stop').attr('offset', '90%').attr('stop-color', '#EB3458').attr('stop-opacity', 0.04);
    askGrad.append('stop').attr('offset', '100%').attr('stop-color', '#EB3458').attr('stop-opacity', 0.0);

    const mainG = svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Subtle horizontal grid lines
    const yGrid = d3.axisRight(yScale)
      .ticks(4)
      .tickSize(innerWidth)
      .tickFormat(() => '');

    mainG.append('g')
      .attr('class', 'grid')
      .call(yGrid)
      .selectAll('line')
      .attr('stroke', '#1E222D')
      .attr('stroke-dasharray', '2,2');

    mainG.select('.grid .domain').remove();

    // D3 Area Generators (Step curve for authentic exchange depth)
    const bidArea = d3.area<DepthPoint>()
      .x(d => xScale(d.priceNum))
      .y0(innerHeight)
      .y1(d => yScale(d.volumeNum))
      .curve(d3.curveStepBefore);

    const bidLine = d3.line<DepthPoint>()
      .x(d => xScale(d.priceNum))
      .y(d => yScale(d.volumeNum))
      .curve(d3.curveStepBefore);

    const askArea = d3.area<DepthPoint>()
      .x(d => xScale(d.priceNum))
      .y0(innerHeight)
      .y1(d => yScale(d.volumeNum))
      .curve(d3.curveStepAfter);

    const askLine = d3.line<DepthPoint>()
      .x(d => xScale(d.priceNum))
      .y(d => yScale(d.volumeNum))
      .curve(d3.curveStepAfter);

    // Draw Bid Area & Stroke
    if (activeBids.length > 0) {
      // Anchor to bottom right for bids (spread edge)
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

      mainG.append('path')
        .datum(bidDataWithAnchor)
        .attr('fill', 'url(#d3-bid-grad)')
        .attr('d', bidArea);

      mainG.append('path')
        .datum(activeBids)
        .attr('fill', 'none')
        .attr('stroke', '#00C087')
        .attr('stroke-width', 2)
        .attr('d', bidLine);
    }

    // Draw Ask Area & Stroke
    if (activeAsks.length > 0) {
      // Anchor to bottom left for asks
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

      mainG.append('path')
        .datum(askDataWithAnchor)
        .attr('fill', 'url(#d3-ask-grad)')
        .attr('d', askArea);

      mainG.append('path')
        .datum(activeAsks)
        .attr('fill', 'none')
        .attr('stroke', '#EB3458')
        .attr('stroke-width', 2)
        .attr('d', askLine);
    }

    // Mid Price Vertical Marker Line
    if (midPriceNum > 0 && midPriceNum >= xDomainMin && midPriceNum <= xDomainMax) {
      const midX = xScale(midPriceNum);
      mainG.append('line')
        .attr('x1', midX)
        .attr('y1', 0)
        .attr('x2', midX)
        .attr('y2', innerHeight)
        .attr('stroke', '#969BA8')
        .attr('stroke-dasharray', '3,3')
        .attr('stroke-width', 1.2)
        .attr('opacity', 0.6);

      mainG.append('text')
        .attr('x', midX)
        .attr('y', 10)
        .attr('text-anchor', 'middle')
        .attr('fill', '#969BA8')
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('font-weight', 'bold')
        .text('MID');
    }

    // X-Axis (Price Ticks)
    const xAxis = d3.axisBottom(xScale)
      .ticks(Math.max(3, Math.floor(innerWidth / 90)))
      .tickFormat(d => {
        const val = Number(d);
        if (isQuoteUSDT) {
          return val >= 1000 ? `$${(val / 1000).toFixed(1)}k` : `$${val.toFixed(2)}`;
        }
        if (val >= 1000000000) return `${(val / 1000000000).toFixed(1)}M`;
        if (val >= 1000000) return `${(val / 1000000).toFixed(0)}jt`;
        if (val >= 1000) return `${(val / 1000).toFixed(0)}k`;
        return `${val}`;
      });

    const gX = mainG.append('g')
      .attr('transform', `translate(0, ${innerHeight})`)
      .call(xAxis);

    gX.select('.domain').attr('stroke', '#292C38');
    gX.selectAll('line').attr('stroke', '#292C38');
    gX.selectAll('text')
      .attr('fill', '#686D7A')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace');

    // Y-Axis (Volume Ticks on Right side)
    const yAxis = d3.axisRight(yScale)
      .ticks(4)
      .tickFormat(d => {
        const val = Number(d);
        if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
        if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
        return val.toFixed(val < 1 ? 2 : 1);
      });

    const gY = mainG.append('g')
      .attr('transform', `translate(${innerWidth}, 0)`)
      .call(yAxis);

    gY.select('.domain').remove();
    gY.selectAll('line').remove();
    gY.selectAll('text')
      .attr('fill', '#686D7A')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace');

    // 3. User Active Order Markers (if any user orders exist)
    if (myOpenOrderPrices && myOpenOrderPrices.size > 0) {
      myOpenOrderPrices.forEach(pStr => {
        try {
          const pVal = Number(safeBigInt(pStr)) / quoteScale;
          if (pVal >= xDomainMin && pVal <= xDomainMax) {
            const pX = xScale(pVal);
            mainG.append('line')
              .attr('x1', pX)
              .attr('y1', 0)
              .attr('x2', pX)
              .attr('y2', innerHeight)
              .attr('stroke', '#5B9DFF')
              .attr('stroke-width', 1.5)
              .attr('stroke-dasharray', '2,2');

            mainG.append('circle')
              .attr('cx', pX)
              .attr('cy', 8)
              .attr('r', 3.5)
              .attr('fill', '#5B9DFF');
          }
        } catch {}
      });
    }

    // 4. Interactive Overlay for Hover & Click
    const allPoints = [...activeBids, ...activeAsks];

    const overlay = mainG.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .attr('cursor', 'crosshair');

    // Crosshair reference elements
    const crosshairV = mainG.append('line')
      .attr('stroke', '#969BA8')
      .attr('stroke-dasharray', '2,2')
      .attr('stroke-width', 1)
      .attr('opacity', 0)
      .attr('pointer-events', 'none');

    const crosshairH = mainG.append('line')
      .attr('stroke', '#969BA8')
      .attr('stroke-dasharray', '2,2')
      .attr('stroke-width', 1)
      .attr('opacity', 0)
      .attr('pointer-events', 'none');

    const highlightCircle = mainG.append('circle')
      .attr('r', 4.5)
      .attr('opacity', 0)
      .attr('pointer-events', 'none');

    overlay.on('mousemove', (event) => {
      const [mx, my] = d3.pointer(event);
      const hoveredPriceNum = xScale.invert(mx);

      // Find nearest point
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

        crosshairV
          .attr('x1', ptX).attr('x2', ptX)
          .attr('y1', 0).attr('y2', innerHeight)
          .attr('opacity', 0.8);

        crosshairH
          .attr('x1', 0).attr('x2', innerWidth)
          .attr('y1', ptY).attr('y2', ptY)
          .attr('opacity', 0.8);

        highlightCircle
          .attr('cx', ptX)
          .attr('cy', ptY)
          .attr('fill', nearest.side === 'BID' ? '#00C087' : '#EB3458')
          .attr('stroke', '#FFFFFF')
          .attr('stroke-width', 1.5)
          .attr('opacity', 1);

        setHoveredPoint(nearest);
        setMousePos({ x: event.clientX, y: event.clientY });
      }
    });

    overlay.on('mouseleave', () => {
      crosshairV.attr('opacity', 0);
      crosshairH.attr('opacity', 0);
      highlightCircle.attr('opacity', 0);
      setHoveredPoint(null);
      setMousePos(null);
    });

    overlay.on('click', (event) => {
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

  }, [bidPoints, askPoints, midPriceNum, zoomFactor, height, isQuoteUSDT, myOpenOrderPrices, onSelectPrice, quoteScale]);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col bg-[#15171F] border border-[#292C38] rounded-xl overflow-hidden w-full select-none shadow-xl"
    >
      {/* Top Header: Spread, Pressure Meter, and Zoom Controls */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0E1016] border-b border-[#292C38] text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#F5F5F7] flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#00C087] animate-pulse" />
            Market Liquidity Depth (D3)
          </span>
          <span className="text-[#686D7A] text-[10px]">·</span>
          <span className="text-[11px] text-[#969BA8]">
            Spread: <strong className="text-[#F5F5F7]">{formatPrice(depth.spread)}</strong>
          </span>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 bg-[#15171F] p-0.5 rounded border border-[#292C38]">
          <button
            type="button"
            title="Zoom In (Kedalaman Lebih Detail)"
            onClick={() => setZoomFactor(prev => Math.min(3.0, prev + 0.3))}
            className="p-1 rounded text-[#969BA8] hover:text-[#F5F5F7] hover:bg-[#292C38] transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Zoom Out (Cakupan Pasar Lebih Lebar)"
            onClick={() => setZoomFactor(prev => Math.max(0.4, prev - 0.3))}
            className="p-1 rounded text-[#969BA8] hover:text-[#F5F5F7] hover:bg-[#292C38] transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Reset Zoom"
            onClick={() => setZoomFactor(1.0)}
            className="p-1 rounded text-[#969BA8] hover:text-[#F5F5F7] hover:bg-[#292C38] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Aggregate Buy / Sell Pressure Bar */}
      <div className="px-3 py-1.5 bg-[#0A0C10] border-b border-[#292C38]/60 space-y-1">
        <div className="flex items-center justify-between text-[10px] font-mono">
          <span className="text-[#00C087] font-bold">
            Bids: {bidRatio}% ({totalBidVol.toFixed(3)} {pair.baseCurrency})
          </span>
          <span className="text-[#686D7A] text-[9px]">L2 Order Book Balance</span>
          <span className="text-[#EB3458] font-bold">
            Asks: {askRatio}% ({totalAskVol.toFixed(3)} {pair.baseCurrency})
          </span>
        </div>
        <div className="h-1.5 w-full bg-[#1A1D27] rounded-full overflow-hidden flex">
          <div
            className="bg-[#00C087] h-full transition-all duration-300 shadow-[0_0_8px_rgba(0,192,135,0.4)]"
            style={{ width: `${bidRatio}%` }}
          />
          <div
            className="bg-[#EB3458] h-full transition-all duration-300 shadow-[0_0_8px_rgba(235,52,88,0.4)]"
            style={{ width: `${askRatio}%` }}
          />
        </div>
      </div>

      {/* D3 Canvas Container */}
      <div className="relative flex-1 w-full" style={{ height: `${height}px` }}>
        <svg
          ref={svgRef}
          width="100%"
          height={height}
          className="overflow-visible block"
        />

        {/* Floating Tooltip */}
        {hoveredPoint && (
          <div
            className="absolute top-3 left-3 bg-[#0E1016]/95 border border-[#292C38] rounded-lg p-2.5 shadow-2xl text-xs font-mono space-y-1 backdrop-blur-md pointer-events-none z-30 transition-opacity animate-in fade-in duration-100"
          >
            <div className="flex items-center justify-between gap-4 pb-1 border-b border-[#292C38]/70 text-[11px]">
              <span className={`font-bold flex items-center gap-1 ${
                hoveredPoint.side === 'BID' ? 'text-[#00C087]' : 'text-[#EB3458]'
              }`}>
                {hoveredPoint.side === 'BID' ? '🟢 Akumulasi Beli (Bid)' : '🔴 Akumulasi Jual (Ask)'}
              </span>
              {myOpenOrderPrices?.has(hoveredPoint.rawPrice) && (
                <span className="px-1.5 py-0.2 rounded bg-[#5B9DFF] text-white text-[9px] font-sans font-extrabold">
                  Order Anda
                </span>
              )}
            </div>

            <div className="flex justify-between gap-6 text-[11px]">
              <span className="text-[#686D7A]">Harga ({pair.quoteCurrency}):</span>
              <span className="font-bold text-[#F5F5F7]">
                {formatPrice(hoveredPoint.rawPrice)}
              </span>
            </div>

            <div className="flex justify-between gap-6 text-[11px]">
              <span className="text-[#686D7A]">Total Kedalaman:</span>
              <span className={hoveredPoint.side === 'BID' ? 'text-[#00C087] font-bold' : 'text-[#EB3458] font-bold'}>
                {hoveredPoint.volumeNum.toFixed(4)} {pair.baseCurrency}
              </span>
            </div>

            <div className="text-[10px] text-[#686D7A] pt-1 text-center italic">
              Klik untuk pasang order di harga ini
            </div>
          </div>
        )}
      </div>

      {/* Footer Legend */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0E1016] border-t border-[#292C38] text-[10px] text-[#686D7A] font-mono">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-[#00C087]" /> Bids ({bidPoints.length})
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-[#EB3458]" /> Asks ({askPoints.length})
          </span>
        </div>
        <span className="text-[#969BA8]">Real-time D3 L2 Matching Depth</span>
      </div>
    </div>
  );
};
