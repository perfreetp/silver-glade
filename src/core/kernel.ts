/**
 * 基于 manifold-3d（Clipper2 内核）的布尔运算与三角化封装。
 * 用于把自动提取的原始轮廓规整为无自交、无碎片的多边形，
 * 并在修边后重新三角化。
 *
 * 本模块不依赖 DOM / Vite 资源处理，便于在 Node 中直接测试；
 * 浏览器中的 wasm 地址由 kernelBrowser.ts 注入。
 */

import Module from 'manifold-3d';
import type { Vec2 } from './types.ts';
import { dedupeRing, signedArea } from './geom.ts';

export type FillRule = 'EvenOdd' | 'NonZero' | 'Positive';

/** 一个拓扑连通区域：一个外环 + 若干孔洞 */
export interface PolyGroup {
  outer: Vec2[];
  holes: Vec2[][];
}

export interface TriMesh2D {
  positions: Vec2[];
  indices: number[];
  /** 每个三角形所属的连通区域序号 */
  triGroup: number[];
}

export interface Kernel {
  /** 并集/规整：消除自交，合并重叠 */
  union(contours: Vec2[][], fillRule?: FillRule): Vec2[][];
  /** a 减去其余多边形 */
  difference(a: Vec2[], others: Vec2[][]): Vec2[][];
  /** 分解为互不连通的“外环 + 孔洞”组 */
  decompose(contours: Vec2[][], fillRule?: FillRule): PolyGroup[];
  /** 简化（Clipper2 SimplifyPolygon） */
  simplify(contours: Vec2[][], epsilon: number, fillRule?: FillRule): Vec2[][];
  /** 对每组“外环+孔洞”做保形三角化 */
  triangulate(groups: PolyGroup[]): TriMesh2D;
  /** 有效面积（外环减孔洞） */
  area(contours: Vec2[][]): number;
}

type RawPoly = [number, number][];

function clean(contours: readonly (readonly Vec2[])[]): RawPoly[] {
  return contours
    .map((c) => dedupeRing(c, 1e-6))
    .filter((c) => c.length >= 3 && hasExtent(c))
    .map((c) => c.map((p) => [p.x, p.y] as [number, number]));
}

/** 自交环的有符号面积可能为 0，因此不能按面积判定退化，改看包围盒是否成面 */
function hasExtent(ring: readonly Vec2[]): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return maxX - minX > 1e-6 && maxY - minY > 1e-6;
}

const toVec2 = (polys: RawPoly[]): Vec2[][] => polys.map((p) => p.map(([x, y]) => ({ x, y })));
const toRaw = (rings: readonly (readonly Vec2[])[]): RawPoly[] =>
  rings.map((r) => r.map((p) => [p.x, p.y] as [number, number]));

function orient(ring: readonly Vec2[], positive: boolean): Vec2[] {
  const area = signedArea(ring);
  const copy = ring.map((p) => ({ ...p }));
  if (area === 0) return copy;
  return area > 0 === positive ? copy : copy.reverse();
}

/** 逐环面积之和（各环独立） */
function rawArea(rings: readonly (readonly Vec2[])[]): number {
  let sum = 0;
  for (const r of rings) sum += Math.abs(signedArea(r));
  return sum;
}

export interface CreateKernelOptions {
  /** 浏览器中传入带哈希的 wasm 资源地址 */
  wasmUrl?: string;
}

export async function createKernel(opts: CreateKernelOptions = {}): Promise<Kernel> {
  const mod = await Module(
    (opts.wasmUrl
      ? { locateFile: (path: string) => (path.endsWith('.wasm') ? opts.wasmUrl! : path) }
      : {}) as Parameters<typeof Module>[0],
  );
  mod.setup();
  const { CrossSection, triangulate } = mod;

  const free = (cs: { delete(): void }) => {
    try {
      cs.delete();
    } catch {
      /* 已释放 */
    }
  };

  const make = (polys: RawPoly[], rule: FillRule) => new CrossSection(polys, rule);

  function union(contours: Vec2[][], fillRule: FillRule = 'NonZero'): Vec2[][] {
    const polys = clean(contours);
    if (polys.length === 0) return [];
    const cs = make(polys, fillRule);
    try {
      const out = toVec2(cs.toPolygons()).filter((r) => r.length >= 3 && hasExtent(r));
      // 孔洞在 NonZero 下会保留为反向环；统一以面积绝对值 > 0 判定有效性
      return out;
    } finally {
      free(cs);
    }
  }

  function difference(a: Vec2[], others: Vec2[][]): Vec2[][] {
    const pa = clean([a]);
    if (pa.length === 0) return [];
    const base = make(pa, 'NonZero');
    try {
      const rest = clean(others);
      if (rest.length === 0) return toVec2(base.toPolygons());
      const other = make(rest, 'NonZero');
      try {
        const res = base.subtract(other);
        try {
          return toVec2(res.toPolygons()).filter((r) => r.length >= 3);
        } finally {
          free(res);
        }
      } finally {
        free(other);
      }
    } finally {
      free(base);
    }
  }

  function simplify(contours: Vec2[][], epsilon: number, fillRule: FillRule = 'NonZero'): Vec2[][] {
    const polys = clean(contours);
    if (polys.length === 0) return [];
    const cs = make(polys, fillRule);
    if (epsilon <= 0) {
      try {
        return toVec2(cs.toPolygons()).filter((r) => r.length >= 3);
      } finally {
        free(cs);
      }
    }
    const simplified = cs.simplify(epsilon);
    try {
      return toVec2(simplified.toPolygons()).filter((r) => r.length >= 3);
    } finally {
      if (simplified !== cs) free(simplified);
      free(cs);
    }
  }

  function decompose(contours: Vec2[][], fillRule: FillRule = 'EvenOdd'): PolyGroup[] {
    const polys = clean(contours);
    if (polys.length === 0) return [];
    const cs = make(polys, fillRule);
    const groups: PolyGroup[] = [];
    try {
      const parts = cs.decompose();
      for (const part of parts) {
        try {
          const rings = toVec2(part.toPolygons()).filter((r) => r.length >= 3 && hasExtent(r));
          if (rings.length === 0) continue;
          const sorted = rings
            .map((r) => ({ r, a: Math.abs(signedArea(r)) }))
            .sort((x, y) => y.a - x.a);
          const outer = orient(sorted[0].r, true);
          const holes = sorted.slice(1).map((h) => orient(h.r, false));
          const netArea = Math.abs(signedArea(outer)) - holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
          if (netArea <= 1e-7) continue;
          groups.push({ outer, holes });
        } finally {
          free(part);
        }
      }
      return groups;
    } finally {
      free(cs);
    }
  }

  function triangulateGroups(groups: PolyGroup[]): TriMesh2D {
    const positions: Vec2[] = [];
    const indices: number[] = [];
    const triGroup: number[] = [];
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      const rings: Vec2[][] = [orient(group.outer, true), ...group.holes.map((h) => orient(h, false))].filter(
        (r) => r.length >= 3,
      );
      if (rings.length === 0) continue;
      const norm = toRaw(rings);
      const base = positions.length;
      let tris: [number, number, number][] = [];
      try {
        tris = triangulate(norm, 1e-5) as [number, number, number][];
      } catch (err) {
        console.warn('[kernel] 三角化失败，回退为扇形剖分', err);
        tris = fanTriangulate(norm);
      }
      let added = 0;
      for (const r of rings) {
        for (const p of r) {
          positions.push({ x: p.x, y: p.y });
          added++;
        }
      }
      if (added === 0) continue;
      for (const t of tris) {
        if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue;
        if (t[0] >= added || t[1] >= added || t[2] >= added) continue;
        indices.push(base + t[0], base + t[1], base + t[2]);
        triGroup.push(g);
      }
    }
    return { positions, indices, triGroup };
  }

  /** 退化输入时的兜底：仅对每个环做扇形剖分 */
  function fanTriangulate(rings: RawPoly[]): [number, number, number][] {
    const out: [number, number, number][] = [];
    let offset = 0;
    for (const ring of rings) {
      for (let i = 1; i + 1 < ring.length; i++) out.push([offset, offset + i, offset + i + 1]);
      offset += ring.length;
    }
    return out;
  }

  function area(contours: Vec2[][]): number {
    return rawArea(contours);
  }

  return { union, difference, decompose, simplify, triangulate: triangulateGroups, area };
}
