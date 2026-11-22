/**
 * 温度场的体素网格规划与空间加速结构
 *
 * 目标：
 *  - 体素足够细以分辨 0.6m 宽的机柜（目标单元 ≤ 0.09m）
 *  - 总体素数量控制在约 80 万以内，保证拖动阈值时 MC 仍能维持 30fps
 *  - 为 compute 着色器构建一张均匀空间格，避免每个体素遍历全部机柜
 */

import type { RoomLayout } from "../model/types";

export interface FieldGrid {
  /** 体素维度（X, Y, Z） */
  dim: [number, number, number];
  /** 单元格边长（米，各轴一致） */
  cellSize: number;
  /** 场原点（世界坐标） */
  origin: [number, number, number];
  /** 场的世界范围 */
  max: [number, number, number];
  /** 环境温度（℃）：取全场最低采样值再低几度 */
  ambient: number;
  /** 空间加速格维度 */
  accelDim: [number, number, number];
  accelOrigin: [number, number, number];
  accelCellSize: number;
}

export const MAX_VOXELS = 820_000;
export const TARGET_CELL = 0.085;
export const MIN_CELL = 0.045;
export const MAX_CELL = 0.22;

/** 温度衰减半径：离机柜表面多远处回落到环境温度 */
export const FALLOFF = 0.36;

export function computeAmbient(layout: RoomLayout): number {
  let min = Infinity;
  for (const b of layout.boxes) {
    for (const arr of [b.rack.intake.values, b.rack.exhaust.values]) {
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (Number.isFinite(v) && v < min) min = v;
      }
    }
  }
  if (!Number.isFinite(min)) min = 24;
  return Math.max(5, min - 4);
}

export function planFieldGrid(layout: RoomLayout): FieldGrid {
  const margin = FALLOFF * 2.6;
  const bmin = layout.boundsMin;
  const bmax = layout.boundsMax;

  const lo: [number, number, number] = [bmin[0] - margin, Math.max(-0.05, -margin * 0.4), bmin[2] - margin];
  const hi: [number, number, number] = [bmax[0] + margin, bmax[1] + margin, bmax[2] + margin];

  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const safeExt = ext.map((e) => Math.max(e, 0.5));

  // 以目标单元尺寸起算，若总体素数超标则等比放大单元
  let cell = TARGET_CELL;
  const cellsFor = (c: number) =>
    safeExt.map((e) => Math.max(2, Math.ceil(e / c))) as [number, number, number];

  let dim = cellsFor(cell);
  let total = dim[0] * dim[1] * dim[2];
  while (total > MAX_VOXELS && cell < MAX_CELL) {
    cell = Math.min(MAX_CELL, cell * 1.15);
    dim = cellsFor(cell);
    total = dim[0] * dim[1] * dim[2];
  }
  // 若仍然超标（极端尺寸），继续放大直到满足
  while (total > MAX_VOXELS && cell < 1.0) {
    cell *= 1.2;
    dim = cellsFor(cell);
    total = dim[0] * dim[1] * dim[2];
  }
  cell = Math.max(MIN_CELL, cell);

  // 让场范围恰好覆盖 ext（略微外扩以对齐）
  const max: [number, number, number] = [lo[0] + dim[0] * cell, lo[1] + dim[1] * cell, lo[2] + dim[2] * cell];

  // 空间加速格：单元尺寸取 FALLOFF*5（略大于影响半径），保证不漏机柜
  const accelCell = Math.max(FALLOFF * 5.0, 0.5);
  const accelDim: [number, number, number] = [
    Math.max(1, Math.ceil((max[0] - lo[0]) / accelCell)),
    Math.max(1, Math.ceil((max[1] - lo[1]) / accelCell)),
    Math.max(1, Math.ceil((max[2] - lo[2]) / accelCell)),
  ];

  return {
    dim,
    cellSize: cell,
    origin: lo,
    max,
    ambient: computeAmbient(layout),
    accelDim,
    accelOrigin: lo,
    accelCellSize: accelCell,
  };
}

export interface AccelGrid {
  /** 长度 = accelDim 乘积 + 1 的前缀和 */
  start: Uint32Array;
  /** 每格内的机柜索引 */
  items: Uint32Array;
}

/**
 * 为机柜包围盒（外扩 FALLOFF*5）建均匀网格索引。
 * 只把与格子相交的机柜放进去。
 */
export function buildAccelGrid(layout: RoomLayout, grid: FieldGrid): AccelGrid {
  const [nx, ny, nz] = grid.accelDim;
  const cells = nx * ny * nz;
  const [ox, oy, oz] = grid.accelOrigin;
  const cs = grid.accelCellSize;
  const pad = FALLOFF * 5.0;

  // 第一遍：统计每格机柜数
  const counts = new Uint32Array(cells);
  const ranges: { i0: number; i1: number; j0: number; j1: number; k0: number; k1: number; idx: number }[] = [];

  for (let idx = 0; idx < layout.boxes.length; idx++) {
    const b = layout.boxes[idx];
    const x0 = b.min[0] - pad, x1 = b.max[0] + pad;
    const y0 = b.min[1] - pad, y1 = b.max[1] + pad;
    const z0 = b.min[2] - pad, z1 = b.max[2] + pad;

    const i0 = clampInt(Math.floor((x0 - ox) / cs), 0, nx - 1);
    const i1 = clampInt(Math.floor((x1 - ox) / cs), 0, nx - 1);
    const j0 = clampInt(Math.floor((y0 - oy) / cs), 0, ny - 1);
    const j1 = clampInt(Math.floor((y1 - oy) / cs), 0, ny - 1);
    const k0 = clampInt(Math.floor((z0 - oz) / cs), 0, nz - 1);
    const k1 = clampInt(Math.floor((z1 - oz) / cs), 0, nz - 1);

    ranges.push({ i0, i1, j0, j1, k0, k1, idx });
    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          counts[(k * ny + j) * nx + i]++;
        }
      }
    }
  }

  const start = new Uint32Array(cells + 1);
  for (let c = 0; c < cells; c++) start[c + 1] = start[c] + counts[c];
  const items = new Uint32Array(start[cells]);
  const cursor = start.slice(0, cells);

  for (const r of ranges) {
    for (let k = r.k0; k <= r.k1; k++) {
      for (let j = r.j0; j <= r.j1; j++) {
        for (let i = r.i0; i <= r.i1; i++) {
          const c = (k * ny + j) * nx + i;
          items[cursor[c]++] = r.idx;
        }
      }
    }
  }

  return { start, items };
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 打包每个机柜的 16 个 vec4f（256 字节）RackInfo：
 *   ip0..ip3, ep0..ep3, inormal, enormal, bmin, bmax
 */
export function packRackInfos(layout: RoomLayout, faceFrames: FaceFrame[]): Float32Array {
  // 每柜 12 个 vec4f = 48 个 float，与 WGSL 的 RackInfo 结构体严格一致
  const out = new Float32Array(layout.boxes.length * 12 * 4);
  let o = 0;
  for (let i = 0; i < layout.boxes.length; i++) {
    const ff = faceFrames[i];
    for (const p of ff.intakeCorners) {
      out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2]; out[o++] = 0;
    }
    for (const p of ff.exhaustCorners) {
      out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2]; out[o++] = 0;
    }
    out[o++] = ff.intakeNormal[0]; out[o++] = ff.intakeNormal[1]; out[o++] = ff.intakeNormal[2]; out[o++] = 0;
    out[o++] = ff.exhaustNormal[0]; out[o++] = ff.exhaustNormal[1]; out[o++] = ff.exhaustNormal[2]; out[o++] = 0;
    const b = layout.boxes[i];
    out[o++] = b.min[0]; out[o++] = b.min[1]; out[o++] = b.min[2]; out[o++] = 0;
    out[o++] = b.max[0]; out[o++] = b.max[1]; out[o++] = b.max[2]; out[o++] = 0;
  }
  return out;
}

export interface FaceFrame {
  /** 进风面四角，顺序 (0,0) (1,0) (1,1) (0,1)，u 沿宽度、v 沿高度 */
  intakeCorners: [number, number, number][];
  exhaustCorners: [number, number, number][];
  intakeNormal: [number, number, number];
  exhaustNormal: [number, number, number];
}

/**
 * 由机柜包围盒与朝向推导进/出风面的四角与法线。
 *
 * 四角顺序固定为 (u=0,v=0) (1,0) (1,1) (0,1)：u 沿机柜宽度方向、v 沿高度方向。
 * 进风面与出风面使用同一套本地 u 轴，所以两个面上的同名采样点对应同一物理位置
 * （从外面看两侧时左右会自然镜像，这与真实机柜一致）。
 */
export function computeFaceFrames(layout: RoomLayout, inset = 0.004): FaceFrame[] {
  const off = 0.002;
  return layout.boxes.map((box) => {
    const { rack, min, max } = box;
    const y0 = min[1] + inset;
    const y1 = max[1] - inset;

    // 本地坐标轴：uAxis 沿宽度、upAxis 沿高度、nAxis 由进风指向出风
    let uAxis: [number, number, number];
    let nAxis: [number, number, number];
    let center: [number, number, number];
    let halfW: number;
    let halfH: number;

    const cx = (min[0] + max[0]) / 2;
    const cz = (min[2] + max[2]) / 2;
    halfH = 0.5 * (y1 - y0);
    const cy = 0.5 * (y0 + y1);

    switch (rack.facing) {
      case "+Z":
        // 进风面在 +Z 侧，出风面在 -Z 侧
        uAxis = [1, 0, 0];
        nAxis = [0, 0, -1];
        halfW = 0.5 * (max[0] - min[0]);
        center = [cx, cy, cz];
        break;
      case "-Z":
        uAxis = [-1, 0, 0];
        nAxis = [0, 0, 1];
        halfW = 0.5 * (max[0] - min[0]);
        center = [cx, cy, cz];
        break;
      case "+X":
        uAxis = [0, 0, -1];
        nAxis = [-1, 0, 0];
        halfW = 0.5 * (max[2] - min[2]);
        center = [cx, cy, cz];
        break;
      case "-X":
      default:
        uAxis = [0, 0, 1];
        nAxis = [1, 0, 0];
        halfW = 0.5 * (max[2] - min[2]);
        center = [cx, cy, cz];
        break;
    }

    const halfDepth = 0.5 * (rack.facing === "+Z" || rack.facing === "-Z" ? max[2] - min[2] : max[0] - min[0]);

    const cornersAt = (alongN: number): [number, number, number][] => {
      const c: [number, number, number] = [
        center[0] + nAxis[0] * alongN,
        center[1],
        center[2] + nAxis[2] * alongN,
      ];
      return [
        [c[0] - uAxis[0] * halfW, c[1] - halfH, c[2] - uAxis[2] * halfW],
        [c[0] + uAxis[0] * halfW, c[1] - halfH, c[2] + uAxis[2] * halfW],
        [c[0] + uAxis[0] * halfW, c[1] + halfH, c[2] + uAxis[2] * halfW],
        [c[0] - uAxis[0] * halfW, c[1] + halfH, c[2] - uAxis[2] * halfW],
      ];
    };

    // 进风面在 nAxis 的反向端（-halfDepth），外法线 = -nAxis
    // 出风面在 nAxis 的正向端（+halfDepth），外法线 = +nAxis
    const intakeCorners = cornersAt(-halfDepth - off);
    const exhaustCorners = cornersAt(halfDepth + off);

    return {
      intakeCorners,
      exhaustCorners,
      intakeNormal: [-nAxis[0], 0, -nAxis[2]],
      exhaustNormal: [nAxis[0], 0, nAxis[2]],
    };
  });
}
