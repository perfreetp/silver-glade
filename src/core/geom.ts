/** 二维几何基础：面积、周长、包含判定、距离、线段相交、加密。 */

import type { Vec2 } from './types.ts';

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const normalize = (a: Vec2): Vec2 => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};

/** 有符号面积：逆时针为正 */
export function signedArea(ring: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function perimeter(ring: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return s;
}

/** 多环面积（外环减孔洞），按环绕向判定角色 */
export function multiRingArea(rings: readonly { vertices: readonly Vec2[]; role: 'outer' | 'hole' }[]): number {
  let s = 0;
  for (const r of rings) s += r.role === 'outer' ? Math.abs(signedArea(r.vertices)) : -Math.abs(signedArea(r.vertices));
  return Math.max(0, s);
}

export function ringCentroid(ring: readonly Vec2[]): Vec2 {
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const c = a.x * b.y - b.x * a.y;
    a2 += c;
    cx += (a.x + b.x) * c;
    cy += (a.y + b.y) * c;
  }
  if (Math.abs(a2) < 1e-9) {
    const n = ring.length || 1;
    let x = 0;
    let y = 0;
    for (const p of ring) {
      x += p.x;
      y += p.y;
    }
    return { x: x / n, y: y / n };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

/** 射线法判断点是否在环内（支持任意绕向） */
export function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** 带孔洞的多边形包含判定 */
export function pointInPolygon(
  p: Vec2,
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[] = [],
): boolean {
  if (!pointInRing(p, outer)) return false;
  for (const h of holes) if (pointInRing(p, h)) return false;
  return true;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; distance: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  const point = { x: a.x + abx * t, y: a.y + aby * t };
  return { point, t, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

/** 点到多边形边界（含孔洞）的最近距离，同时返回最近位置 */
export function closestOnBoundary(
  p: Vec2,
  rings: readonly (readonly Vec2[])[],
): { distance: number; point: Vec2 } {
  let best = { distance: Infinity, point: p };
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const c = closestPointOnSegment(p, a, b);
      if (c.distance < best.distance) best = { distance: c.distance, point: c.point };
    }
  }
  return best;
}

export function bboxOfRings(rings: readonly (readonly Vec2[])[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function polygonCentroid(rings: readonly (readonly Vec2[])[]): Vec2 {
  let a = 0;
  let x = 0;
  let y = 0;
  for (const ring of rings) {
    const area = signedArea(ring);
    const c = ringCentroid(ring);
    a += area;
    x += c.x * area;
    y += c.y * area;
  }
  if (Math.abs(a) < 1e-9) {
    const bb = bboxOfRings(rings);
    return bb ? { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 } : { x: 0, y: 0 };
  }
  return { x: x / a, y: y / a };
}

/**
 * 线段规范相交（不包含仅端点相接），用于自交检测。
 * 返回交点或 null。
 */
export function segmentIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;
  const eps = 1e-9;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

/** 统计环的自交数（隔邻边除外）；点数过多时抽样以控制开销 */
export function countSelfIntersections(ring: readonly Vec2[], maxSegments = 900): number {
  const n = ring.length;
  if (n < 4) return 0;
  const step = Math.max(1, Math.ceil(n / maxSegments / 2));
  let count = 0;
  for (let i = 0; i < n; i += step) {
    const a1 = ring[i];
    const a2 = ring[(i + 1) % n];
    for (let j = i + 2; j < n; j += step) {
      // 只有 j = n-1 的边与 i = 0 的边相邻（共享起始顶点）
      if (i === 0 && j === n - 1) continue;
      const adjacent = Math.abs(i - j) <= 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      const b1 = ring[j];
      const b2 = ring[(j + 1) % n];
      if (
        Math.max(a1.x, a2.x) < Math.min(b1.x, b2.x) ||
        Math.max(b1.x, b2.x) < Math.min(a1.x, a2.x) ||
        Math.max(a1.y, a2.y) < Math.min(b1.y, b2.y) ||
        Math.max(b1.y, b2.y) < Math.min(a1.y, a2.y)
      )
        continue;
      if (segmentIntersection(a1, a2, b1, b2)) count++;
    }
  }
  return count;
}

/** Visvalingam–Whyatt 简化（闭合环），保留至少 minPoints 个顶点 */
export function simplifyRing(ring: readonly Vec2[], tolerance: number, minPoints = 4): Vec2[] {
  if (ring.length <= minPoints) return ring.map((p) => ({ ...p }));
  if (tolerance <= 0) return ring.map((p) => ({ ...p }));
  const pts = ring.map((p) => ({ ...p }));
  const areaOf = (prev: Vec2, cur: Vec2, next: Vec2) => Math.abs(cross(sub(cur, prev), sub(next, prev))) / 2;

  const n = pts.length;
  const prev: number[] = new Array(n);
  const next: number[] = new Array(n);
  const alive: boolean[] = new Array(n).fill(true);
  for (let i = 0; i < n; i++) {
    prev[i] = (i - 1 + n) % n;
    next[i] = (i + 1) % n;
  }
  const area: number[] = new Array(n);
  for (let i = 0; i < n; i++) area[i] = areaOf(pts[prev[i]], pts[i], pts[next[i]]);

  let aliveCount = n;
  while (aliveCount > minPoints) {
    let minIdx = -1;
    let minVal = Infinity;
    for (let i = 0; i < n; i++) {
      if (alive[i] && area[i] < minVal) {
        minVal = area[i];
        minIdx = i;
      }
    }
    if (minIdx < 0 || minVal >= tolerance) break;
    alive[minIdx] = false;
    aliveCount--;
    const p = prev[minIdx];
    const q = next[minIdx];
    next[p] = q;
    prev[q] = p;
    area[p] = areaOf(pts[prev[p]], pts[p], pts[next[p]]);
    area[q] = areaOf(pts[prev[q]], pts[q], pts[next[q]]);
  }
  const out: Vec2[] = [];
  let start = 0;
  while (!alive[start]) start++;
  let idx = start;
  do {
    out.push(pts[idx]);
    idx = next[idx];
  } while (idx !== start && out.length <= n);
  return out;
}

/** 删除重复/过近顶点 */
export function dedupeRing(ring: readonly Vec2[], minDist = 1e-4): Vec2[] {
  const out: Vec2[] = [];
  for (const p of ring) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (out.length === 0 || dist(out[out.length - 1], p) > minDist) out.push({ x: p.x, y: p.y });
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) <= minDist) out.pop();
  return out;
}

/**
 * 按坡度自适应加密闭合环：坡度越大采样越密。
 * step = clamp(baseStep / (1 + slopeGain * tan(slope)), minStep, baseStep)
 */
export function densifyRingSlopeAdaptive(
  ring: readonly Vec2[],
  baseStep: number,
  minStep: number,
  slopeAt: (x: number, y: number) => number,
  slopeGain = 2.5,
  maxSamples = 4000,
): Vec2[] {
  const n = ring.length;
  if (n < 2) return ring.map((p) => ({ ...p }));
  const out: Vec2[] = [];
  let budget = maxSamples;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    out.push({ x: a.x, y: a.y });
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const tanSlope = Math.tan((slopeAt(mx, my) * Math.PI) / 180);
    const step = Math.max(minStep, Math.min(baseStep, baseStep / (1 + slopeGain * Math.max(0, tanSlope))));
    let div = Math.ceil(len / step);
    const remaining = Math.max(0, budget - out.length);
    div = Math.max(1, Math.min(div, remaining));
    for (let k = 1; k < div; k++) {
      out.push({ x: a.x + (b.x - a.x) * (k / div), y: a.y + (b.y - a.y) * (k / div) });
    }
    budget -= div - 1;
    if (budget <= 0) {
      // 预算耗尽：后续直接使用原始顶点
      for (let k = i + 1; k < n; k++) out.push({ x: ring[k].x, y: ring[k].y });
      return dedupeRing(out);
    }
  }
  return dedupeRing(out);
}

/** 环的局部平均宽度（用于格式化显示） */
export function ringSpacing(ring: readonly Vec2[]): number {
  if (ring.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i++) total += dist(ring[i], ring[(i + 1) % ring.length]);
  return total / ring.length;
}

/** 生成内外偏移环（用于边界带），处理尖角时按比例限幅 */
export function offsetRing(ring: readonly Vec2[], offset: number): Vec2[] {
  const n = ring.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i - 1 + n) % n];
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    const d1 = normalize(sub(p1, p0));
    const d2 = normalize(sub(p2, p1));
    const n1 = { x: -d1.y, y: d1.x };
    const n2 = { x: -d2.y, y: d2.x };
    let m = normalize(add(n1, n2));
    const cosHalf = Math.max(0.35, dot(m, n1));
    const lenScale = Math.min(3, 1 / cosHalf);
    out.push({ x: p1.x + m.x * offset * lenScale, y: p1.y + m.y * offset * lenScale });
  }
  return out;
}
