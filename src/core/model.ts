/**
 * 边界模型：可编辑的环集合（外环 + 孔洞），派生统计与编辑操作。
 * 编辑后的多边形统一交给 manifold 做布尔规整（消除自交、合并碎片）并重新三角化。
 */

import { id as newId } from './util.ts';
import { dedupeRing, perimeter, pointInPolygon, signedArea, simplifyRing } from './geom.ts';
import type { Ring, RingRole, Vec2 } from './types.ts';
import type { Kernel, PolyGroup, TriMesh2D } from './kernel.ts';

export interface DerivedBoundary {
  groups: PolyGroup[];
  mesh: TriMesh2D;
  area: number;
  perimeter: number;
  vertexCount: number;
  ringCount: number;
}

export function groupRings(rings: readonly Ring[]): PolyGroup[] {
  const groups: PolyGroup[] = [];
  for (const ring of rings) {
    if (ring.role === 'outer' || groups.length === 0) {
      groups.push({ outer: ring.vertices.map((p) => ({ ...p })), holes: [] });
    } else {
      groups[groups.length - 1].holes.push(ring.vertices.map((p) => ({ ...p })));
    }
  }
  return groups.filter((g) => g.outer.length >= 3);
}

export function ringsFromGroups(groups: readonly PolyGroup[]): Ring[] {
  const out: Ring[] = [];
  for (const g of groups) {
    out.push({ id: newId('ring'), role: 'outer', vertices: g.outer.map((p) => ({ ...p })) });
    for (const h of g.holes) out.push({ id: newId('ring'), role: 'hole', vertices: h.map((p) => ({ ...p })) });
  }
  return out;
}

export function deriveBoundary(kernel: Kernel, rings: readonly Ring[]): DerivedBoundary {
  const groups = groupRings(rings);
  const mesh = kernel.triangulate(groups);
  let area = 0;
  let perim = 0;
  let vertexCount = 0;
  for (const g of groups) {
    area += Math.abs(signedArea(g.outer)) - g.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
    perim += perimeter(g.outer) + g.holes.reduce((s, h) => s + perimeter(h), 0);
    vertexCount += g.outer.length + g.holes.reduce((s, h) => s + h.length, 0);
  }
  return {
    groups,
    mesh,
    area: Math.max(0, area),
    perimeter: perim,
    vertexCount,
    ringCount: rings.length,
  };
}

/** 轻量三角化（拖动时逐帧使用，不重建拓扑，失败时返回空） */
export function quickTriangulate(kernel: Kernel, rings: readonly Ring[]): TriMesh2D {
  return kernel.triangulate(groupRings(rings));
}

export interface RegularizeResult {
  rings: Ring[];
  removedFragments: number;
  resolvedSelfIntersections: boolean;
  droppedArea: number;
}

/**
 * 顺滑 + 规整：把用户编辑后的多边形交给 manifold 做并集（NonZero），
 * 自动消除自交、合并重叠环，并剔除过小碎片。
 */
export function regularizeRings(
  kernel: Kernel,
  rings: readonly Ring[],
  opts: { minArea: number; smoothing: number; keepIds?: boolean },
): RegularizeResult {
  const groups = groupRings(rings);
  const before = groups.reduce(
    (s, g) => s + Math.abs(signedArea(g.outer)) - g.holes.reduce((x, h) => x + Math.abs(signedArea(h)), 0),
    0,
  );
  const inputs = groups.flatMap((g) => [g.outer, ...g.holes]);
  let merged = kernel.union(inputs, 'NonZero');
  if (opts.smoothing > 0) merged = kernel.simplify(merged, opts.smoothing, 'NonZero');
  const decomposed = kernel.decompose(merged, 'NonZero');
  const kept = decomposed.filter((g) => {
    const a = Math.abs(signedArea(g.outer)) - g.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
    return a >= Math.max(0.25, opts.minArea * 0.25);
  });
  const after = kept.reduce(
    (s, g) => s + Math.abs(signedArea(g.outer)) - g.holes.reduce((x, h) => x + Math.abs(signedArea(h)), 0),
    0,
  );
  const out = ringsFromGroups(kept);
  return {
    rings: out,
    removedFragments: Math.max(0, decomposed.length - kept.length),
    resolvedSelfIntersections: Math.abs(kept.length - groups.length) > 0 || Math.abs(before - after) > 1e-6,
    droppedArea: Math.max(0, before - after),
  };
}

export interface VertexHit {
  ringIndex: number;
  vertexIndex: number;
  point: Vec2;
  distance: number;
}

/** 在屏幕容差内查找最近顶点（tolerance 为地图单位） */
export function findVertex(rings: readonly Ring[], p: Vec2, tolerance: number, skipRings: readonly number[] = []): VertexHit | null {
  let best: VertexHit | null = null;
  for (let r = 0; r < rings.length; r++) {
    if (skipRings.includes(r)) continue;
    const verts = rings[r].vertices;
    for (let v = 0; v < verts.length; v++) {
      const d = Math.hypot(verts[v].x - p.x, verts[v].y - p.y);
      if (d <= tolerance && (!best || d < best.distance)) best = { ringIndex: r, vertexIndex: v, point: verts[v], distance: d };
    }
  }
  return best;
}

export interface EdgeHit {
  ringIndex: number;
  edgeIndex: number;
  point: Vec2;
  distance: number;
  t: number;
}

export function findEdge(rings: readonly Ring[], p: Vec2, tolerance: number): EdgeHit | null {
  let best: EdgeHit | null = null;
  for (let r = 0; r < rings.length; r++) {
    const verts = rings[r].vertices;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      const t = len2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
      const q = { x: a.x + abx * t, y: a.y + aby * t };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d <= tolerance && (!best || d < best.distance)) {
        best = { ringIndex: r, edgeIndex: i, point: q, distance: d, t };
      }
    }
  }
  return best;
}

export function moveVertex(rings: readonly Ring[], ringIndex: number, vertexIndex: number, to: Vec2): Ring[] {
  return rings.map((ring, r) => {
    if (r !== ringIndex) return ring;
    const verts = ring.vertices.map((p, i) => (i === vertexIndex ? { x: to.x, y: to.y } : { ...p }));
    return { ...ring, vertices: verts };
  });
}

export function insertVertex(rings: readonly Ring[], ringIndex: number, edgeIndex: number, at: Vec2): Ring[] {
  return rings.map((ring, r) => {
    if (r !== ringIndex) return ring;
    const verts = ring.vertices.map((p) => ({ ...p }));
    verts.splice(edgeIndex + 1, 0, { x: at.x, y: at.y });
    return { ...ring, vertices: verts };
  });
}

export interface RemoveResult {
  rings: Ring[];
  removedRing: boolean;
}

/** 删除顶点；外环少于 3 点则删除该组 */
export function removeVertex(rings: readonly Ring[], ringIndex: number, vertexIndex: number): RemoveResult {
  const ring = rings[ringIndex];
  if (!ring) return { rings: rings.map((r) => ({ ...r, vertices: r.vertices.map((p) => ({ ...p })) })), removedRing: false };
  if (ring.vertices.length <= 3) {
    const without = rings.filter((_, i) => i !== ringIndex);
    // 若删除的是外环，其后的孔洞也一并移除
    const nextOuter = without.findIndex((r, i) => i > Math.max(0, ringIndex - 1) && r.role === 'outer');
    if (ring.role === 'outer') {
      const cut = ringIndex;
      const kept: Ring[] = [];
      let dropping = false;
      for (let i = 0; i < rings.length; i++) {
        if (i === cut) {
          dropping = true;
          continue;
        }
        if (dropping && rings[i].role === 'hole') continue;
        dropping = false;
        kept.push(rings[i]);
      }
      void nextOuter;
      return { rings: kept.map((r) => ({ ...r, vertices: r.vertices.map((p) => ({ ...p })) })), removedRing: true };
    }
    return { rings: without.map((r) => ({ ...r, vertices: r.vertices.map((p) => ({ ...p })) })), removedRing: true };
  }
  return {
    rings: rings.map((r, i) =>
      i === ringIndex ? { ...r, vertices: r.vertices.filter((_, v) => v !== vertexIndex).map((p) => ({ ...p })) } : { ...r, vertices: r.vertices.map((p) => ({ ...p })) },
    ),
    removedRing: false,
  };
}

/** 拆分/清理：去掉过短边与重复点 */
export function cleanRings(rings: readonly Ring[], minEdge: number): Ring[] {
  return rings
    .map((r) => ({ ...r, vertices: dedupeRing(r.vertices, minEdge) }))
    .filter((r) => r.vertices.length >= 3 && Math.abs(signedArea(r.vertices)) > minEdge * minEdge);
}

/** 按容差对全部环做 Visvalingam 简化，保持环角色 */
export function simplifyRings(rings: readonly Ring[], tolerance: number, minPoints = 5): Ring[] {
  return rings.map((r) => ({ ...r, vertices: simplifyRing(r.vertices, tolerance, minPoints) }));
}

/** 判断点是否位于任意外环内且不在孔洞内 */
export function pointInsideRings(rings: readonly Ring[], p: Vec2): { inside: boolean; groupIndex: number } {
  const groups = groupRings(rings);
  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g];
    if (pointInPolygon(p, grp.outer, grp.holes)) return { inside: true, groupIndex: g };
  }
  return { inside: false, groupIndex: -1 };
}

/** 新绘制一个外环 */
export function makeRing(vertices: Vec2[], role: RingRole = 'outer'): Ring {
  return { id: newId('ring'), role, vertices: vertices.map((p) => ({ ...p })) };
}

/** 边界围成的包围盒 */
export function ringsBounds(rings: readonly Ring[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const r of rings) {
    for (const p of r.vertices) {
      any = true;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}
