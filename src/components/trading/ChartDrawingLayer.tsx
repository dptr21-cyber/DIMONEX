/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ChartDrawingLayer.tsx
 * Interactive SVG drawing & editing layer for DIMONEX Pro Chart (Lightweight Charts v5).
 * Supports all 10 drawing tools, anchor handle dragging, undo/delete, and coordinate projection.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { CandleItem } from '../../types/index.js';
import { ChartDrawing, ChartDrawingPoint, DrawingToolType } from './chartTypes.js';
import {
  computeFibonacciExtensionLevels,
  computeFibonacciRetracementLevels,
  computePriceRangeStats,
  requiredPointsForTool,
} from './chartDrawings.js';

interface ChartDrawingLayerProps {
  chart: IChartApi | null;
  mainSeries: ISeriesApi<any> | null;
  candles: CandleItem[];
  timeframeSec: number;
  activeTool: DrawingToolType;
  activeColor: string;
  drawings: ChartDrawing[];
  selectedId: string | null;
  pricePrecision: number;
  onSelectId: (id: string | null) => void;
  onChangeDrawings: (next: ChartDrawing[], pushUndo?: boolean) => void;
  onToolComplete: () => void;
}

interface TextDraftState {
  x: number;
  y: number;
  point: ChartDrawingPoint;
  value: string;
}

export const ChartDrawingLayer: React.FC<ChartDrawingLayerProps> = ({
  chart,
  mainSeries,
  candles,
  timeframeSec,
  activeTool,
  activeColor,
  drawings,
  selectedId,
  pricePrecision,
  onSelectId,
  onChangeDrawings,
  onToolComplete,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [, setRenderTick] = useState(0);
  const [paneSize, setPaneSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [draftPoints, setDraftPoints] = useState<ChartDrawingPoint[]>([]);
  const [hoverPoint, setHoverPoint] = useState<ChartDrawingPoint | null>(null);
  const [isBrushing, setIsBrushing] = useState(false);
  const [textDraft, setTextDraft] = useState<TextDraftState | null>(null);

  const dragStateRef = useRef<{
    drawingId: string;
    anchorIndex: number; // -1 = move entire drawing
    startPoint: ChartDrawingPoint;
    originalPoints: ChartDrawingPoint[];
  } | null>(null);

  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  const triggerRepaint = useCallback(() => {
    if (chart) {
      try {
        const size = chart.paneSize(0);
        setPaneSize(prev =>
          prev.width === size.width && prev.height === size.height ? prev : { width: size.width, height: size.height }
        );
      } catch {}
    }
    if (drawingsRef.current.length > 0 || activeToolRef.current !== 'NONE') {
      setRenderTick(t => t + 1);
    }
  }, [chart]);

  useEffect(() => {
    setDraftPoints([]);
    setHoverPoint(null);
    setIsBrushing(false);
    setTextDraft(null);
  }, [activeTool]);

  useEffect(() => {
    if (!chart) return;
    triggerRepaint();
    const ts = chart.timeScale();
    const onRangeChange = () => triggerRepaint();
    ts.subscribeVisibleLogicalRangeChange(onRangeChange);
    ts.subscribeSizeChange(onRangeChange);
    return () => {
      try {
        ts.unsubscribeVisibleLogicalRangeChange(onRangeChange);
        ts.unsubscribeSizeChange(onRangeChange);
      } catch {}
    };
  }, [chart, triggerRepaint]);

  useEffect(() => {
    if (drawings.length > 0 || activeTool !== 'NONE' || selectedId !== null) {
      triggerRepaint();
    }
  }, [candles, drawings, selectedId, activeTool, triggerRepaint]);

  const toXY = useCallback(
    (pt: ChartDrawingPoint): { x: number; y: number } | null => {
      if (!chart || !mainSeries) return null;
      try {
        const ts = chart.timeScale();
        let x: number | null = ts.timeToCoordinate(pt.time as Time) as number | null;
        if (x === null || !Number.isFinite(x)) {
          if (candles.length > 0) {
            const lastBar = candles[candles.length - 1];
            const firstBar = candles[0];
            const spacing = ts.options().barSpacing || 9;
            const lastX = ts.timeToCoordinate(lastBar.time as Time) as number | null;
            const firstX = ts.timeToCoordinate(firstBar.time as Time) as number | null;
            if (lastX !== null && Number.isFinite(lastX)) {
              x = lastX + ((pt.time - lastBar.time) / Math.max(1, timeframeSec)) * spacing;
            } else if (firstX !== null && Number.isFinite(firstX)) {
              x = firstX + ((pt.time - firstBar.time) / Math.max(1, timeframeSec)) * spacing;
            }
          }
        }
        const y = mainSeries.priceToCoordinate(pt.price);
        if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
      } catch {
        return null;
      }
    },
    [chart, mainSeries, candles, timeframeSec]
  );

  const xyToPoint = useCallback(
    (x: number, y: number): ChartDrawingPoint | null => {
      if (!chart || !mainSeries) return null;
      try {
        const ts = chart.timeScale();
        const price = mainSeries.coordinateToPrice(y);
        if (price === null || !Number.isFinite(price)) return null;

        let t = ts.coordinateToTime(x) as number | null;
        if (t === null || !Number.isFinite(t)) {
          if (candles.length > 0) {
            const lastBar = candles[candles.length - 1];
            const lastX = ts.timeToCoordinate(lastBar.time as Time) as number | null;
            const spacing = ts.options().barSpacing || 9;
            if (lastX !== null && Number.isFinite(lastX)) {
              t = Math.round(lastBar.time + ((x - lastX) / spacing) * timeframeSec);
            } else {
              const firstBar = candles[0];
              const firstX = ts.timeToCoordinate(firstBar.time as Time) as number | null;
              if (firstX !== null && Number.isFinite(firstX)) {
                t = Math.round(firstBar.time + ((x - firstX) / spacing) * timeframeSec);
              }
            }
          }
        }
        if (t === null || !Number.isFinite(t)) {
          t = Math.floor(Date.now() / 1000);
        }
        return { time: Math.round(t), price: Number(price) };
      } catch {
        return null;
      }
    },
    [chart, mainSeries, candles, timeframeSec]
  );

  const getLocalCoords = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, clientY - rect.top)),
    };
  };

  const commitNewDrawing = (
    tool: Exclude<DrawingToolType, 'NONE'>,
    points: ChartDrawingPoint[],
    text?: string
  ) => {
    const now = Date.now();
    const newItem: ChartDrawing = {
      id: `drw-${now}-${Math.random().toString(36).slice(2, 6)}`,
      tool,
      points,
      color: activeColor,
      lineWidth: 2,
      text,
      createdAt: now,
      updatedAt: now,
    };
    onChangeDrawings([...drawingsRef.current, newItem], true);
    onSelectId(newItem.id);
    setDraftPoints([]);
    setHoverPoint(null);
    if (tool !== 'BRUSH') {
      onToolComplete();
    }
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (activeTool === 'NONE' || e.button !== 0) return;
    const local = getLocalCoords(e.clientX, e.clientY);
    if (!local) return;
    const pt = xyToPoint(local.x, local.y);
    if (!pt) return;

    if (activeTool === 'TEXT') {
      setTextDraft({ x: local.x, y: local.y, point: pt, value: '' });
      return;
    }

    if (activeTool === 'BRUSH') {
      setIsBrushing(true);
      setDraftPoints([pt]);
      return;
    }

    const req = requiredPointsForTool(activeTool);
    const nextDraft = [...draftPoints, pt];
    if (nextDraft.length >= req) {
      commitNewDrawing(activeTool, nextDraft);
    } else {
      setDraftPoints(nextDraft);
      setHoverPoint(pt);
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (activeTool === 'NONE') return;
    const local = getLocalCoords(e.clientX, e.clientY);
    if (!local) return;
    const pt = xyToPoint(local.x, local.y);
    if (!pt) return;

    if (activeTool === 'BRUSH' && isBrushing) {
      setDraftPoints(prev => {
        const last = prev[prev.length - 1];
        if (!last) return [pt];
        const prevXY = toXY(last);
        if (prevXY && Math.hypot(local.x - prevXY.x, local.y - prevXY.y) < 4) return prev;
        return [...prev, pt];
      });
      return;
    }

    if (draftPoints.length > 0) {
      setHoverPoint(pt);
    }
  };

  const handleSvgPointerUp = () => {
    if (activeTool === 'BRUSH' && isBrushing) {
      setIsBrushing(false);
      if (draftPoints.length >= 2) {
        commitNewDrawing('BRUSH', draftPoints);
      } else {
        setDraftPoints([]);
      }
    }
  };

  const startDrag = (
    e: React.PointerEvent,
    drawing: ChartDrawing,
    anchorIndex: number
  ) => {
    if (activeTool !== 'NONE' || e.button !== 0) return;
    e.stopPropagation();
    const local = getLocalCoords(e.clientX, e.clientY);
    if (!local) return;
    const startPoint = xyToPoint(local.x, local.y);
    if (!startPoint) return;

    onSelectId(drawing.id);
    dragStateRef.current = {
      drawingId: drawing.id,
      anchorIndex,
      startPoint,
      originalPoints: drawing.points.map(p => ({ ...p })),
    };

    const onWinMove = (moveEvt: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const moveLocal = getLocalCoords(moveEvt.clientX, moveEvt.clientY);
      if (!moveLocal) return;
      const curPt = xyToPoint(moveLocal.x, moveLocal.y);
      if (!curPt) return;

      const dTime = curPt.time - drag.startPoint.time;
      const dPrice = curPt.price - drag.startPoint.price;

      const updated = drawingsRef.current.map(d => {
        if (d.id !== drag.drawingId) return d;
        const nextPts =
          drag.anchorIndex >= 0
            ? drag.originalPoints.map((p, idx) => (idx === drag.anchorIndex ? curPt : p))
            : drag.originalPoints.map(p => ({
                time: p.time + dTime,
                price: p.price + dPrice,
              }));
        return { ...d, points: nextPts, updatedAt: Date.now() };
      });
      onChangeDrawings(updated, false);
    };

    const onWinUp = () => {
      if (dragStateRef.current) {
        dragStateRef.current = null;
        onChangeDrawings(drawingsRef.current, true);
      }
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
    };

    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', onWinUp);
  };

  const formatP = (p: number) =>
    p.toLocaleString('en-US', {
      minimumFractionDigits: Math.min(2, pricePrecision),
      maximumFractionDigits: pricePrecision,
    });

  const renderShape = (d: ChartDrawing, isPreview = false) => {
    const coords = d.points.map(toXY);
    if (coords.some(c => c === null)) return null;
    const pts = coords as Array<{ x: number; y: number }>;
    const isSel = !isPreview && d.id === selectedId;
    const W = Math.max(paneSize.width || 800, 200);
    const H = Math.max(paneSize.height || 400, 150);
    const strokeDash = isPreview ? '5 4' : undefined;

    let body: React.ReactNode = null;

    switch (d.tool) {
      case 'HORIZONTAL_LINE': {
        const y = pts[0].y;
        body = (
          <g>
            <line x1={0} y1={y} x2={W} y2={y} stroke="transparent" strokeWidth={12} />
            <line x1={0} y1={y} x2={W} y2={y} stroke={d.color} strokeWidth={d.lineWidth} strokeDasharray={strokeDash} />
            <rect x={Math.max(4, W - 92)} y={y - 10} width={88} height={20} rx={3} fill={d.color} />
            <text
              x={Math.max(48, W - 48)}
              y={y + 3.5}
              textAnchor="middle"
              fill="#090D12"
              fontSize={10}
              fontFamily="IBM Plex Mono, monospace"
              fontWeight={600}
            >
              {formatP(d.points[0].price)}
            </text>
          </g>
        );
        break;
      }
      case 'VERTICAL_LINE': {
        const x = pts[0].x;
        body = (
          <g>
            <line x1={x} y1={0} x2={x} y2={H} stroke="transparent" strokeWidth={12} />
            <line x1={x} y1={0} x2={x} y2={H} stroke={d.color} strokeWidth={d.lineWidth} strokeDasharray={strokeDash || '4 3'} />
          </g>
        );
        break;
      }
      case 'TREND_LINE': {
        if (pts.length < 2) break;
        body = (
          <g>
            <line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke="transparent" strokeWidth={12} />
            <line
              x1={pts[0].x}
              y1={pts[0].y}
              x2={pts[1].x}
              y2={pts[1].y}
              stroke={d.color}
              strokeWidth={d.lineWidth}
              strokeDasharray={strokeDash}
            />
          </g>
        );
        break;
      }
      case 'RAY': {
        if (pts.length < 2) break;
        const dx = pts[1].x - pts[0].x;
        const dy = pts[1].y - pts[0].y;
        const len = Math.hypot(dx, dy) || 1;
        const scale = Math.max(W, H) * 2.5;
        const ex = pts[0].x + (dx / len) * scale;
        const ey = pts[0].y + (dy / len) * scale;
        body = (
          <g>
            <line x1={pts[0].x} y1={pts[0].y} x2={ex} y2={ey} stroke="transparent" strokeWidth={12} />
            <line x1={pts[0].x} y1={pts[0].y} x2={ex} y2={ey} stroke={d.color} strokeWidth={d.lineWidth} strokeDasharray={strokeDash} />
          </g>
        );
        break;
      }
      case 'RECTANGLE': {
        if (pts.length < 2) break;
        const x = Math.min(pts[0].x, pts[1].x);
        const y = Math.min(pts[0].y, pts[1].y);
        const w = Math.max(2, Math.abs(pts[1].x - pts[0].x));
        const h = Math.max(2, Math.abs(pts[1].y - pts[0].y));
        body = (
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill={d.color}
            fillOpacity={0.14}
            stroke={d.color}
            strokeWidth={d.lineWidth}
            strokeDasharray={strokeDash}
          />
        );
        break;
      }
      case 'BRUSH': {
        if (pts.length < 2) break;
        const pointsStr = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        body = (
          <g>
            <polyline points={pointsStr} fill="none" stroke="transparent" strokeWidth={12} />
            <polyline
              points={pointsStr}
              fill="none"
              stroke={d.color}
              strokeWidth={d.lineWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={strokeDash}
            />
          </g>
        );
        break;
      }
      case 'TEXT': {
        const label = d.text || 'Note';
        body = (
          <g>
            <rect
              x={pts[0].x - 6}
              y={pts[0].y - 16}
              width={Math.max(44, label.length * 7.2 + 12)}
              height={22}
              rx={4}
              fill="#111820"
              fillOpacity={0.92}
              stroke={d.color}
              strokeWidth={1}
            />
            <text
              x={pts[0].x}
              y={pts[0].y - 1}
              fill={d.color}
              fontSize={11}
              fontFamily="IBM Plex Mono, monospace"
              fontWeight={600}
            >
              {label}
            </text>
          </g>
        );
        break;
      }
      case 'FIB_RETRACEMENT': {
        if (pts.length < 2) break;
        const levels = computeFibonacciRetracementLevels(d.points[0].price, d.points[1].price);
        const minX = Math.min(pts[0].x, pts[1].x);
        const maxX = Math.max(pts[0].x, pts[1].x, minX + 180);
        body = (
          <g>
            <line
              x1={pts[0].x}
              y1={pts[0].y}
              x2={pts[1].x}
              y2={pts[1].y}
              stroke={d.color}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            {levels.map(lvl => {
              const lvlPt = toXY({ time: d.points[0].time, price: lvl.price });
              if (!lvlPt) return null;
              const isGolden = lvl.ratio === 0.618 || lvl.ratio === 0.5;
              return (
                <g key={lvl.ratio}>
                  <line
                    x1={minX}
                    y1={lvlPt.y}
                    x2={maxX}
                    y2={lvlPt.y}
                    stroke={isGolden ? '#D6A85C' : d.color}
                    strokeWidth={isGolden ? 1.5 : 1}
                    strokeOpacity={0.85}
                  />
                  <text
                    x={minX + 4}
                    y={lvlPt.y - 3}
                    fill={isGolden ? '#D6A85C' : '#A1AFB8'}
                    fontSize={10}
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {(lvl.ratio * 100).toFixed(1)}% ({formatP(lvl.price)})
                  </text>
                </g>
              );
            })}
          </g>
        );
        break;
      }
      case 'FIB_EXTENSION': {
        if (pts.length < 2) break;
        const p3 = d.points[2] || d.points[1];
        const levels = computeFibonacciExtensionLevels(d.points[0].price, d.points[1].price, p3.price);
        const p3XY = pts[2] || pts[1];
        const minX = Math.min(...pts.map(p => p.x));
        const maxX = Math.max(...pts.map(p => p.x), minX + 200);
        body = (
          <g>
            <polyline
              points={pts.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={d.color}
              strokeWidth={1.25}
              strokeDasharray="4 3"
            />
            {levels.map(lvl => {
              const lvlPt = toXY({ time: p3.time, price: lvl.price });
              if (!lvlPt) return null;
              return (
                <g key={lvl.ratio}>
                  <line
                    x1={p3XY.x}
                    y1={lvlPt.y}
                    x2={maxX}
                    y2={lvlPt.y}
                    stroke={lvl.ratio === 1.618 ? '#D6A85C' : d.color}
                    strokeWidth={lvl.ratio === 1.618 ? 1.5 : 1}
                    strokeOpacity={0.85}
                  />
                  <text
                    x={p3XY.x + 6}
                    y={lvlPt.y - 3}
                    fill={lvl.ratio === 1.618 ? '#D6A85C' : '#A1AFB8'}
                    fontSize={10}
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {lvl.ratio.toFixed(3)} ({formatP(lvl.price)})
                  </text>
                </g>
              );
            })}
          </g>
        );
        break;
      }
      case 'PRICE_RANGE': {
        if (pts.length < 2) break;
        const x = Math.min(pts[0].x, pts[1].x);
        const y = Math.min(pts[0].y, pts[1].y);
        const w = Math.max(2, Math.abs(pts[1].x - pts[0].x));
        const h = Math.max(2, Math.abs(pts[1].y - pts[0].y));
        const stats = computePriceRangeStats(d.points[0], d.points[1]);
        const positive = stats.deltaPrice >= 0;
        const tone = positive ? '#16A879' : '#EA5B65';
        const barsCount = Math.max(0, Math.round(stats.deltaSeconds / Math.max(1, timeframeSec)));
        const sign = positive ? '+' : '';
        const boxLabel = `${sign}${formatP(stats.deltaPrice)} (${sign}${stats.pct.toFixed(2)}%) · ${barsCount} bars`;
        body = (
          <g>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={tone}
              fillOpacity={0.14}
              stroke={tone}
              strokeWidth={1.5}
            />
            <line
              x1={x + w / 2}
              y1={pts[0].y}
              x2={x + w / 2}
              y2={pts[1].y}
              stroke={tone}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <rect
              x={Math.max(4, x + w / 2 - 110)}
              y={positive ? Math.max(4, y - 24) : Math.min(H - 22, y + h + 4)}
              width={220}
              height={20}
              rx={4}
              fill="#111820"
              stroke={tone}
              strokeWidth={1}
            />
            <text
              x={Math.max(114, x + w / 2)}
              y={(positive ? Math.max(4, y - 24) : Math.min(H - 22, y + h + 4)) + 13.5}
              textAnchor="middle"
              fill={tone}
              fontSize={10}
              fontFamily="IBM Plex Mono, monospace"
              fontWeight={600}
            >
              {boxLabel}
            </text>
          </g>
        );
        break;
      }
      default:
        break;
    }

    if (!body) return null;

    return (
      <g
        key={d.id}
        className={!isPreview && activeTool === 'NONE' ? 'pointer-events-auto cursor-move' : undefined}
        onPointerDown={e => {
          if (!isPreview && activeTool === 'NONE') {
            startDrag(e, d, -1);
          }
        }}
      >
        {body}
        {!isPreview &&
          isSel &&
          d.tool !== 'BRUSH' &&
          pts.map((p, idx) => (
            <circle
              key={idx}
              cx={p.x}
              cy={p.y}
              r={5.5}
              fill="#090D12"
              stroke="#E4EBEF"
              strokeWidth={2}
              className="pointer-events-auto cursor-grab"
              onPointerDown={e => startDrag(e, d, idx)}
            />
          ))}
      </g>
    );
  };

  const previewDrawing: ChartDrawing | null =
    activeTool !== 'NONE' && draftPoints.length > 0
      ? {
          id: '__preview__',
          tool: activeTool,
          points: hoverPoint && activeTool !== 'BRUSH' ? [...draftPoints, hoverPoint] : draftPoints,
          color: activeColor,
          lineWidth: 2,
          createdAt: 0,
          updatedAt: 0,
        }
      : null;

  return (
    <div
      className="absolute top-0 left-0 z-20 overflow-hidden"
      style={{
        width: paneSize.width > 0 ? `${paneSize.width}px` : '100%',
        height: paneSize.height > 0 ? `${paneSize.height}px` : '100%',
        pointerEvents: 'none',
      }}
    >
      <svg
        ref={svgRef}
        className={`w-full h-full ${activeTool !== 'NONE' ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'}`}
        onPointerDown={handleSvgPointerDown}
        onPointerMove={handleSvgPointerMove}
        onPointerUp={handleSvgPointerUp}
      >
        {drawings.map(d => renderShape(d, false))}
        {previewDrawing && renderShape(previewDrawing, true)}
      </svg>

      {textDraft && (
        <div
          className="pointer-events-auto absolute z-30 bg-[#141C24] border border-[#2B3944] rounded-[6px] p-2 shadow-xl flex items-center gap-1.5"
          style={{
            left: `${Math.min(Math.max(8, textDraft.x), Math.max(8, (paneSize.width || 400) - 230))}px`,
            top: `${Math.min(Math.max(8, textDraft.y), Math.max(8, (paneSize.height || 300) - 48))}px`,
          }}
        >
          <input
            type="text"
            autoFocus
            value={textDraft.value}
            onChange={e => setTextDraft({ ...textDraft, value: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter' && textDraft.value.trim()) {
                commitNewDrawing('TEXT', [textDraft.point], textDraft.value.trim());
                setTextDraft(null);
              } else if (e.key === 'Escape') {
                setTextDraft(null);
                onToolComplete();
              }
            }}
            placeholder="Annotation text..."
            className="bg-[#090D12] border border-[#2B3944] rounded-[4px] px-2 py-1 text-xs text-[#E4EBEF] font-mono w-36 focus:outline-none focus:border-[#8DA5B1]"
          />
          <button
            type="button"
            onClick={() => {
              if (textDraft.value.trim()) {
                commitNewDrawing('TEXT', [textDraft.point], textDraft.value.trim());
              }
              setTextDraft(null);
            }}
            className="px-2 py-1 text-[11px] font-semibold bg-[#8DA5B1] text-[#090D12] rounded-[4px] cursor-pointer"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setTextDraft(null);
              onToolComplete();
            }}
            className="px-1.5 py-1 text-[11px] text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
