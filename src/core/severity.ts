/**
 * 受损分级与统计。
 *
 * 做法：在边界包围盒内建立规则采样网格，用三角化结果做“是否在迹地内”的
 * 掩膜判定（精确到孔洞），再逐格从过火指数场取值分级。分级面积按格点计数
 * 估计后，用多边形精确面积归一化，因此面积总和始终与周长/面积模块一致。
 */

import type { BurnField, Ring } from './types.ts';
import type { Kernel } from './kernel.ts';
import { burnAtIndex } from './detect.ts';
import { SEVERITY_CLASSES } from './theme.ts';
import { groupRings } from './model.ts';
import { signedArea } from './geom.ts';
import { clamp } from './util.ts';

export interface SeverityBin {
  index: number;
  label: string;
  color: string;
  area: number;
  /** 占迹地总面积的比例 0..1 */
  fraction: number;
  meanIndex: number;
}

export interface SeveritySummary {
  bins: SeverityBin[];
  totalArea: number;
  meanIndex: number;
  /** 加权平均受损等级 0..4 */
  meanClass: number;
  /** 至少中度的面积占比 */
  moderatePlusFraction: number;
  grid: { width: number; height: number; samples: Float32Array };
  /** 采样网格的地理范围，渲染纹理时使用 */
  gridBounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export function classOf(v: number, thresholds: readonly number[]): number {
  for (let i = 0; i < thresholds.length; i++) if (v < thresholds[i]) return i;
  return thresholds.length;
}

function pointInTriangle(
  px: number,
  py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  det: number,
): boolean {
  const w1 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / det;
  const w2 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / det;
  const w3 = 1 - w1 - w2;
  return w1 >= -1e-9 && w2 >= -1e-9 && w3 >= -1e-9;
}

export function severitySummary(
  kernel: Kernel,
  field: BurnField | null,
  rings: readonly Ring[],
  thresholds: readonly number[],
  sampleTarget = 52000,
): SeveritySummary {
  const groups = groupRings(rings);
  const bins: SeverityBin[] = SEVERITY_CLASSES.map((c) => ({
    index: c.index,
    label: c.label,
    color: c.color,
    area: 0,
    fraction: 0,
    meanIndex: 0,
  }));
  const empty: SeveritySummary = {
    bins,
    totalArea: 0,
    meanIndex: 0,
    meanClass: 0,
    moderatePlusFraction: 0,
    grid: { width: 0, height: 0, samples: new Float32Array(0) },
    gridBounds: null,
  };
  if (groups.length === 0) return empty;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of groups) {
    for (const p of g.outer) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const bw = Math.max(1e-6, maxX - minX);
  const bh = Math.max(1e-6, maxY - minY);
  const cell = Math.max(0.35, Math.max(bw, bh) / Math.sqrt(sampleTarget));
  const gw = clamp(Math.ceil(bw / cell), 2, 640);
  const gh = clamp(Math.ceil(bh / cell), 2, 640);
  const dx = bw / gw;
  const dy = bh / gh;
  const cellArea = dx * dy;

  // 三角化作为掩膜
  const mesh = kernel.triangulate(groups);
  const tris: { ax: number; ay: number; bx: number; by: number; cx: number; cy: number; det: number; minX: number; maxX: number; minY: number; maxY: number }[] = [];
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = mesh.positions[mesh.indices[t]];
    const b = mesh.positions[mesh.indices[t + 1]];
    const c = mesh.positions[mesh.indices[t + 2]];
    if (!a || !b || !c) continue;
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(det) < 1e-9) continue;
    tris.push({
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      cx: c.x,
      cy: c.y,
      det,
      minX: Math.min(a.x, b.x, c.x),
      maxX: Math.max(a.x, b.x, c.x),
      minY: Math.min(a.y, b.y, c.y),
      maxY: Math.max(a.y, b.y, c.y),
    });
  }

  // 掩膜加每格指数
  const samples = new Float32Array(gw * gh);
  samples.fill(-1);
  const mask = new Uint8Array(gw * gh);
  for (const tri of tris) {
    const gx0 = clamp(Math.floor((tri.minX - minX) / dx), 0, gw - 1);
    const gx1 = clamp(Math.ceil((tri.maxX - minX) / dx), 0, gw - 1);
    const gy0 = clamp(Math.floor((tri.minY - minY) / dy), 0, gh - 1);
    const gy1 = clamp(Math.ceil((tri.maxY - minY) / dy), 0, gh - 1);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const idx = gy * gw + gx;
        if (mask[idx]) continue;
        const px = minX + (gx + 0.5) * dx;
        const py = minY + (gy + 0.5) * dy;
        if (pointInTriangle(px, py, { x: tri.ax, y: tri.ay }, { x: tri.bx, y: tri.by }, { x: tri.cx, y: tri.cy }, tri.det)) {
          mask[idx] = 1;
        }
      }
    }
  }

  // 统计只用原始掩膜；纹理用的掩膜向外膨胀 2 格，
  // 使分级色块一直铺到边界线，不露出地形底色。
  const texMask = mask.slice();
  dilateMask(texMask, gw, gh, 2);

  const counts = new Array<number>(SEVERITY_CLASSES.length).fill(0);
  const indexSum = new Array<number>(SEVERITY_CLASSES.length).fill(0);
  let maskCells = 0;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const idx = gy * gw + gx;
      if (!texMask[idx]) continue;
      const px = minX + (gx + 0.5) * dx;
      const py = minY + (gy + 0.5) * dy;
      const v = field ? burnAtIndex(field, px, py) : 0;
      samples[idx] = v;
      if (!mask[idx]) continue;
      maskCells++;
      const cls = classOf(v, thresholds);
      counts[cls]++;
      indexSum[cls] += v;
    }
  }

  const exactArea = groups.reduce(
    (s, g) => s + Math.abs(signedArea(g.outer)) - g.holes.reduce((x, h) => x + Math.abs(signedArea(h)), 0),
    0,
  );
  const sampleArea = maskCells * cellArea;
  const scale = sampleArea > 0 && exactArea > 0 ? exactArea / sampleArea : 1;

  let weighted = 0;
  let idxWeighted = 0;
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i];
    b.area = counts[i] * cellArea * scale;
    b.meanIndex = counts[i] > 0 ? indexSum[i] / counts[i] : 0;
    weighted += b.index * b.area;
    idxWeighted += b.meanIndex * b.area;
  }
  const totalArea = bins.reduce((s, b) => s + b.area, 0) || exactArea;
  for (const b of bins) b.fraction = totalArea > 0 ? b.area / totalArea : 0;
  const moderatePlus = bins.filter((b) => b.index >= 2).reduce((s, b) => s + b.area, 0);

  return {
    bins,
    totalArea,
    meanIndex: totalArea > 0 ? idxWeighted / totalArea : 0,
    meanClass: totalArea > 0 ? weighted / totalArea : 0,
    moderatePlusFraction: totalArea > 0 ? moderatePlus / totalArea : 0,
    grid: { width: gw, height: gh, samples },
    gridBounds: { minX, minY, maxX, maxY },
  };
}

/** 把掩膜向外膨胀若干格（4 邻域） */
function dilateMask(mask: Uint8Array, w: number, h: number, radius: number): void {
  for (let r = 0; r < radius; r++) {
    const add: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (mask[i]) continue;
        if ((x > 0 && mask[i - 1]) || (x + 1 < w && mask[i + 1]) || (y > 0 && mask[i - w]) || (y + 1 < h && mask[i + w])) {
          add.push(i);
        }
      }
    }
    for (const i of add) mask[i] = 2;
    for (const i of add) mask[i] = 1;
  }
}

/** 多边形面积（与受损统计同口径） */
export function boundaryArea(rings: readonly Ring[]): number {
  const groups = groupRings(rings);
  return groups.reduce(
    (s, g) => s + Math.abs(signedArea(g.outer)) - g.holes.reduce((x, h) => x + Math.abs(signedArea(h)), 0),
    0,
  );
}
