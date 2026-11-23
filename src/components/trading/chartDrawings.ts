/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * chartDrawings.ts
 * Pure geometry, Fibonacci level calculations, Price Range deltas, and hit-testing
 * for DIMONEX Interactive Chart Drawing Tools.
 */

import { ChartDrawing, DrawingToolType } from './chartTypes.js';

export const FIB_RETRACEMENT_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_EXTENSION_RATIOS = [0, 0.618, 1, 1.272, 1.618, 2.618];

export function requiredPointsForTool(tool: DrawingToolType): number {
  switch (tool) {
    case 'HORIZONTAL_LINE':
    case 'VERTICAL_LINE':
    case 'TEXT':
      return 1;
    case 'FIB_EXTENSION':
      return 3;
    case 'BRUSH':
      return 2; // freehand minimum 2, captures stream while pointer down
    case 'NONE':
      return 0;
    default:
      return 2;
  }
}

export function computeFibonacciRetracementLevels(startPrice: number, endPrice: number) {
  const diff = endPrice - startPrice;
  return FIB_RETRACEMENT_RATIOS.map(ratio => ({
    ratio,
    price: endPrice - diff * ratio,
  }));
}

export function computeFibonacciExtensionLevels(p1: number, p2: number, p3: number) {
  const move = p2 - p1;
  return FIB_EXTENSION_RATIOS.map(ratio => ({
    ratio,
    price: p3 + move * ratio,
  }));
}

export function computePriceRangeStats(
  p1: { time: number; price: number },
  p2: { time: number; price: number }
) {
  const deltaPrice = p2.price - p1.price;
  const pct = p1.price !== 0 ? (deltaPrice / p1.price) * 100 : 0;
  const deltaSeconds = Math.abs(p2.time - p1.time);
  return { deltaPrice, pct, deltaSeconds };
}

export function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

export function hitTestDrawing(
  drawing: ChartDrawing,
  px: number,
  py: number,
  toXY: (pt: { time: number; price: number }) => { x: number; y: number } | null,
  canvasWidth: number,
  canvasHeight: number
): { hit: boolean; anchorIndex: number } {
  const coords = drawing.points.map(toXY);
  if (coords.some(c => c === null)) return { hit: false, anchorIndex: -1 };
  const pts = coords as Array<{ x: number; y: number }>;

  // First check anchors
  for (let i = 0; i < pts.length; i++) {
    if (Math.hypot(px - pts[i].x, py - pts[i].y) <= 9) {
      return { hit: true, anchorIndex: i };
    }
  }

  switch (drawing.tool) {
    case 'HORIZONTAL_LINE':
      return Math.abs(py - pts[0].y) <= 7 ? { hit: true, anchorIndex: -1 } : { hit: false, anchorIndex: -1 };
    case 'VERTICAL_LINE':
      return Math.abs(px - pts[0].x) <= 7 ? { hit: true, anchorIndex: -1 } : { hit: false, anchorIndex: -1 };
    case 'TEXT':
      return Math.abs(px - pts[0].x) <= 60 && Math.abs(py - pts[0].y) <= 18
        ? { hit: true, anchorIndex: -1 }
        : { hit: false, anchorIndex: -1 };
    case 'TREND_LINE':
    case 'FIB_RETRACEMENT':
      return pts.length >= 2 && distanceToSegment(px, py, pts[0].x, pts[0].y, pts[1].x, pts[1].y) <= 8
        ? { hit: true, anchorIndex: -1 }
        : { hit: false, anchorIndex: -1 };
    case 'RAY': {
      if (pts.length < 2) return { hit: false, anchorIndex: -1 };
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const scale = Math.max(canvasWidth, canvasHeight) * 2;
      const len = Math.hypot(dx, dy) || 1;
      const ex = pts[0].x + (dx / len) * scale;
      const ey = pts[0].y + (dy / len) * scale;
      return distanceToSegment(px, py, pts[0].x, pts[0].y, ex, ey) <= 8
        ? { hit: true, anchorIndex: -1 }
        : { hit: false, anchorIndex: -1 };
    }
    case 'RECTANGLE':
    case 'PRICE_RANGE': {
      if (pts.length < 2) return { hit: false, anchorIndex: -1 };
      const minX = Math.min(pts[0].x, pts[1].x) - 6;
      const maxX = Math.max(pts[0].x, pts[1].x) + 6;
      const minY = Math.min(pts[0].y, pts[1].y) - 6;
      const maxY = Math.max(pts[0].y, pts[1].y) + 6;
      return px >= minX && px <= maxX && py >= minY && py <= maxY
        ? { hit: true, anchorIndex: -1 }
        : { hit: false, anchorIndex: -1 };
    }
    case 'BRUSH': {
      for (let i = 1; i < pts.length; i++) {
        if (distanceToSegment(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= 8) {
          return { hit: true, anchorIndex: -1 };
        }
      }
      return { hit: false, anchorIndex: -1 };
    }
    case 'FIB_EXTENSION': {
      for (let i = 1; i < pts.length; i++) {
        if (distanceToSegment(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= 8) {
          return { hit: true, anchorIndex: -1 };
        }
      }
      return { hit: false, anchorIndex: -1 };
    }
    default:
      return { hit: false, anchorIndex: -1 };
  }
}
