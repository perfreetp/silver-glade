/**
 * 贴地三角网细分：在 kernel 的保形三角化结果上按“最长边”递归四分。
 *
 * - 边中点在二维上始终落在线段上，因此边界处细分不会破坏边界形状；
 * - 共享边使用同一份中点缓存，邻居细分结果一致，不会出现裂缝；
 * - 细分后每个顶点再取地形高程，填充面即可贴合起伏的地形；
 * - 达到三角形预算时停止细分并**原样保留**剩余三角形，保证覆盖完整（不留缺口）。
 */

import type { Vec2 } from '../core/types.ts';
import type { TriMesh2D } from '../core/kernel.ts';

export interface RefineOptions {
  /** 细分后允许的最大边长（米） */
  maxEdge: number;
  /** 细分深度上限 */
  maxDepth?: number;
  /** 三角形数量上限，防止极端输入爆内存或掉帧 */
  maxTriangles?: number;
}

export interface RefinedMesh {
  positions: Vec2[];
  indices: number[];
  /** 是否因预算上限提前结束了细分 */
  truncated: boolean;
}

export function refineTriangles(mesh: TriMesh2D, opts: RefineOptions): RefinedMesh {
  const maxDepth = opts.maxDepth ?? 5;
  const maxTris = opts.maxTriangles ?? 220000;
  const limit = Math.max(0.5, opts.maxEdge);
  const positions: Vec2[] = mesh.positions.map((p) => ({ x: p.x, y: p.y }));
  const mids = new Map<number, number>();

  const midpoint = (a: number, b: number): number => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * 1_000_003 + hi;
    const cached = mids.get(key);
    if (cached !== undefined) return cached;
    const pa = positions[lo];
    const pb = positions[hi];
    const idx = positions.length;
    positions.push({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
    mids.set(key, idx);
    return idx;
  };

  let tris: [number, number, number][] = [];
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    tris.push([mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]);
  }

  const len = (a: number, b: number): number => {
    const pa = positions[a];
    const pb = positions[b];
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  };

  let truncated = false;
  for (let depth = 0; depth < maxDepth; depth++) {
    // 剩余三角形按原样拷贝也会计入总预算，因此先预留位置
    let budget = maxTris - tris.length;
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const next: [number, number, number][] = [];
    let changed = false;
    for (const [a, b, c] of tris) {
      const longest = Math.max(len(a, b), len(b, c), len(c, a));
      // 预算用尽：保留未细分三角形（覆盖完整），仅停止继续加密
      const cost = 3; // 细分后由 1 个变 4 个，净增 3
      if (longest <= limit || budget < cost) {
        if (longest > limit) truncated = true;
        next.push([a, b, c]);
        continue;
      }
      budget -= cost;
      changed = true;
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    tris = next;
    if (!changed) break;
  }

  const indices: number[] = [];
  for (const [a, b, c] of tris) indices.push(a, b, c);
  return { positions, indices, truncated };
}
