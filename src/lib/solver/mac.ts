/**
 * MAC (交错网格) 压力投影
 *
 * 单元中心存压力, 面上存法向速度。同一面在相邻两个单元的流量是同一个值,
 * 因此投影后的离散散度严格为零, 不会出现棋盘振荡。
 *
 * 域: 房间 nx*ny*nz 个体素; 最外一圈是墙, 内部为空气 (菇架体素为实体)。
 * 进风/回风: 墙面内侧的边界面上给定通量 (prescribed), 其余边界面法向速度为零。
 */

import { fanAirDir, fanFaceSpeed, fanWorldPosition } from '../model/fans';
import { wallFrame, type Fan } from '../model/room';

export interface Grid3 {
  nx: number;
  ny: number;
  nz: number;
  h: number;
}

export const FACE_CLOSED = 0;
export const FACE_OPEN = 1;
export const FACE_FIXED = 2;

export interface MacGrid {
  g: Grid3;
  fluid: Uint8Array;
  ux: Float32Array;
  uy: Float32Array;
  uz: Float32Array;
  fx: Uint8Array;
  fy: Uint8Array;
  fz: Uint8Array;
  /** prescribed 面的固定法向速度 (m/s) */
  wx: Float32Array;
  wy: Float32Array;
  wz: Float32Array;
  nOpen: Uint8Array;
  /** 参与压力求解的单元数 */
  activeCells: number;
}

export const cIdx = (g: Grid3, i: number, j: number, k: number) => i + g.nx * (k + g.nz * j);
export const xIdx = (g: Grid3, i: number, j: number, k: number) => i + (g.nx + 1) * (k + g.nz * j);
export const yIdx = (g: Grid3, i: number, j: number, k: number) => i + g.nx * (k + g.nz * j);
export const zIdx = (g: Grid3, i: number, j: number, k: number) => i + g.nx * (k + (g.nz + 1) * j);

export function createMacGrid(g: Grid3, solid: Uint8Array): MacGrid {
  const N = g.nx * g.ny * g.nz;
  const fluid = new Uint8Array(N);
  for (let i = 0; i < N; i++) fluid[i] = solid[i] ? 0 : 1;
  return {
    g,
    fluid,
    ux: new Float32Array((g.nx + 1) * g.ny * g.nz),
    uy: new Float32Array(g.nx * (g.ny + 1) * g.nz),
    uz: new Float32Array(g.nx * g.ny * (g.nz + 1)),
    fx: new Uint8Array((g.nx + 1) * g.ny * g.nz),
    fy: new Uint8Array(g.nx * (g.ny + 1) * g.nz),
    fz: new Uint8Array(g.nx * g.ny * (g.nz + 1)),
    wx: new Float32Array((g.nx + 1) * g.ny * g.nz),
    wy: new Float32Array(g.nx * (g.ny + 1) * g.nz),
    wz: new Float32Array(g.nx * g.ny * (g.nz + 1)),
    nOpen: new Uint8Array(N),
    activeCells: 0,
  };
}

export interface BoundaryFace {
  axis: 0 | 1 | 2;
  f: number;
  /** 面法向速度 (沿 +轴, m/s) */
  v: number;
  /** 该面对应的单元 (室内一侧) */
  cell: number;
}

/**
 * 建立面连通 + 风机边界。
 * 进风: 面速度指向室内; 回风: 指向墙外。
 * 若进/回风总风量不平衡, 按比例缩放回风侧 (房间视为有压差泄流), 并在 note 中说明。
 */
export function buildMac(
  g: Grid3,
  solid: Uint8Array,
  fans: Fan[],
): { m: MacGrid; prescribed: BoundaryFace[]; note: string | null } {
  const { nx, ny, nz, h } = g;
  const m = createMacGrid(g, solid);
  const prescribed: BoundaryFace[] = [];

  // ---- 面连通 ----
  for (let j = 1; j < ny - 1; j++)
    for (let k = 1; k < nz - 1; k++)
      for (let i = 1; i < nx - 1; i++) {
        if (m.fluid[cIdx(g, i, j, k)] && m.fluid[cIdx(g, i - 1, j, k)]) m.fx[xIdx(g, i, j, k)] = FACE_OPEN;
        if (m.fluid[cIdx(g, i, j, k)] && m.fluid[cIdx(g, i, j - 1, k)]) m.fy[yIdx(g, i, j, k)] = FACE_OPEN;
        if (m.fluid[cIdx(g, i, j, k)] && m.fluid[cIdx(g, i, j, k - 1)]) m.fz[zIdx(g, i, j, k)] = FACE_OPEN;
      }

  // ---- 风机边界 ----
  const actives = fans.filter((f) => f.radius > 0.02);
  const supplies = actives.filter((f) => f.kind === 'supply' && f.airflow > 0);
  const exhausts = actives.filter((f) => f.kind === 'exhaust' && f.airflow > 0);
  const sumSupply = supplies.reduce((s, f) => s + f.airflow, 0);
  const sumExhaust = exhausts.reduce((s, f) => s + f.airflow, 0);
  let note: string | null = null;
  let scaleSupply = 1;
  let scaleExhaust = 1;
  if (sumSupply > 0 && sumExhaust > 0) {
    if (Math.abs(sumSupply - sumExhaust) / Math.max(sumSupply, sumExhaust) > 0.005) {
      // 让两侧相等: 缩放较大的一侧
      if (sumSupply > sumExhaust) scaleSupply = sumExhaust / sumSupply;
      else scaleExhaust = sumSupply / sumExhaust;
      note = `进/回风总风量不平衡 (${Math.round(sumSupply)} / ${Math.round(sumExhaust)} m³/h), 已按 ${Math.round(
        Math.min(sumSupply, sumExhaust),
      )} m³/h 平衡计算。`;
    }
  }

  for (const fan of actives) {
    const scale = fan.kind === 'supply' ? scaleSupply : scaleExhaust;
    const flow = (fan.airflow / 3600) * scale; // m³/s
    if (!(flow > 0)) continue;
    const f = wallFrame(fan.wall);
    const pos = fanWorldPosition(fan);

    // 遍历墙面内侧的单元: 判断该单元与墙之间的面是否落在风机圆盘内
    const cells = wallAdjacentCells(m, g, fan);
    if (!cells.length) continue;
    const per = flow / cells.length;
    for (const { axis, face, cell } of cells) {
      // 面速度方向: 进风指向室内, 回风指向室外
      // 面法向取 +轴; 室内一侧单元的 inward 方向取决于墙
      const inward = inwardSign(g, fan);
      const sign = fan.kind === 'supply' ? inward[axis] : -inward[axis];
      const area = h * h;
      const v = (sign * per) / area;
      if (axis === 0) {
        m.fx[face] = FACE_FIXED;
        m.wx[face] = v;
        m.ux[face] = v;
      } else if (axis === 1) {
        m.fy[face] = FACE_FIXED;
        m.wy[face] = v;
        m.uy[face] = v;
      } else {
        m.fz[face] = FACE_FIXED;
        m.wz[face] = v;
        m.uz[face] = v;
      }
      prescribed.push({ axis, f: face, v, cell });
    }
    void pos;
  }

  // ---- 开放邻居数 (只计 FACE_OPEN; 固定通量面在压力方程中是源项) ----
  let active = 0;
  for (let j = 1; j < ny - 1; j++)
    for (let k = 1; k < nz - 1; k++)
      for (let i = 1; i < nx - 1; i++) {
        const c = cIdx(g, i, j, k);
        if (!m.fluid[c]) continue;
        let n = 0;
        if (m.fx[xIdx(g, i + 1, j, k)] === FACE_OPEN) n++;
        if (m.fx[xIdx(g, i, j, k)] === FACE_OPEN) n++;
        if (m.fy[yIdx(g, i, j + 1, k)] === FACE_OPEN) n++;
        if (m.fy[yIdx(g, i, j, k)] === FACE_OPEN) n++;
        if (m.fz[zIdx(g, i, j, k + 1)] === FACE_OPEN) n++;
        if (m.fz[zIdx(g, i, j, k)] === FACE_OPEN) n++;
        m.nOpen[c] = n;
        if (n) active++;
      }
  m.activeCells = active;
  return { m, prescribed, note };
}

/** 墙面内侧的 (面, 单元) 列表, 落在风机圆盘内 */
function wallAdjacentCells(
  m: MacGrid,
  g: Grid3,
  fan: Fan,
): { axis: 0 | 1 | 2; face: number; cell: number }[] {
  const { nx, ny, nz, h } = g;
  const f = wallFrame(fan.wall);
  const out: { axis: 0 | 1 | 2; face: number; cell: number }[] = [];
  const inDisc = (px: number, py: number, pz: number) => {
    const rx = px - f.origin.x,
      ry = py - f.origin.y,
      rz = pz - f.origin.z;
    const u = rx * f.side.x + ry * f.side.y + rz * f.side.z;
    const v = rx * f.up.x + ry * f.up.y + rz * f.up.z;
    return (u - fan.u) ** 2 + (v - fan.v) ** 2 <= fan.radius * fan.radius;
  };

  const axis: 0 | 1 | 2 = Math.abs(f.normal.x) > 0.5 ? 0 : Math.abs(f.normal.y) > 0.5 ? 1 : 2;
  if (axis === 0) {
    const i = f.normal.x > 0 ? 1 : nx - 2;
    for (let j = 1; j < ny - 1; j++)
      for (let k = 1; k < nz - 1; k++) {
        const c = cIdx(g, i, j, k);
        if (!m.fluid[c]) continue;
        // 该单元的迎墙面
        const face = f.normal.x > 0 ? xIdx(g, i, j, k) : xIdx(g, i + 1, j, k);
        // 面中心
        const px = (f.normal.x > 0 ? i : i + 1) * h;
        if (!inDisc(px, (j + 0.5) * h, (k + 0.5) * h)) continue;
        out.push({ axis: 0, face, cell: c });
      }
  } else if (axis === 1) {
    // 顶棚: normal = (0,-1,0) -> 室内单元 j = ny-2
    const j = f.normal.y > 0 ? 1 : ny - 2;
    for (let i = 1; i < nx - 1; i++)
      for (let k = 1; k < nz - 1; k++) {
        const c = cIdx(g, i, j, k);
        if (!m.fluid[c]) continue;
        const face = f.normal.y > 0 ? yIdx(g, i, j, k) : yIdx(g, i, j + 1, k);
        const py = (f.normal.y > 0 ? j : j + 1) * h;
        if (!inDisc((i + 0.5) * h, py, (k + 0.5) * h)) continue;
        out.push({ axis: 1, face, cell: c });
      }
  } else {
    const k = f.normal.z > 0 ? 1 : nz - 2;
    for (let i = 1; i < nx - 1; i++)
      for (let j = 1; j < ny - 1; j++) {
        const c = cIdx(g, i, j, k);
        if (!m.fluid[c]) continue;
        const face = f.normal.z > 0 ? zIdx(g, i, j, k) : zIdx(g, i, j, k + 1);
        const pz = (f.normal.z > 0 ? k : k + 1) * h;
        if (!inDisc((i + 0.5) * h, (j + 0.5) * h, pz)) continue;
        out.push({ axis: 2, face, cell: c });
      }
  }
  return out;
}

/** 室内方向在三个轴上的符号 */
function inwardSign(g: Grid3, fan: Fan): [number, number, number] {
  const f = wallFrame(fan.wall);
  void g;
  return [Math.sign(f.normal.x), Math.sign(f.normal.y), Math.sign(f.normal.z)];
}

/** 单元中心速度 -> 面速度 */
export function cellToFace(m: MacGrid, cell: Float32Array) {
  const { g, fluid } = m;
  const { nx, ny, nz, h } = g;
  const sample = (x: number, y: number, z: number, comp: number) => {
    const i0 = Math.max(0, Math.min(nx - 2, Math.floor(x - 0.5)));
    const j0 = Math.max(0, Math.min(ny - 2, Math.floor(y - 0.5)));
    const k0 = Math.max(0, Math.min(nz - 2, Math.floor(z - 0.5)));
    const tx = Math.min(1, Math.max(0, x - 0.5 - i0));
    const ty = Math.min(1, Math.max(0, y - 0.5 - j0));
    const tz = Math.min(1, Math.max(0, z - 0.5 - k0));
    let sum = 0,
      wsum = 0;
    for (let dk = 0; dk < 2; dk++)
      for (let dj = 0; dj < 2; dj++)
        for (let di = 0; di < 2; di++) {
          const c = cIdx(g, i0 + di, j0 + dj, k0 + dk);
          if (!fluid[c]) continue;
          const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz);
          sum += cell[3 * c + comp] * w;
          wsum += w;
        }
    return wsum > 1e-6 ? sum / wsum : 0;
  };
  void h;
  for (let j = 1; j < ny - 1; j++)
    for (let k = 1; k < nz - 1; k++)
      for (let i = 1; i < nx - 1; i++) {
        if (m.fx[xIdx(g, i, j, k)] === FACE_OPEN) m.ux[xIdx(g, i, j, k)] = sample(i, j + 0.5, k + 0.5, 0);
        if (m.fx[xIdx(g, i + 1, j, k)] === FACE_OPEN) m.ux[xIdx(g, i + 1, j, k)] = sample(i + 1, j + 0.5, k + 0.5, 0);
        if (m.fy[yIdx(g, i, j, k)] === FACE_OPEN) m.uy[yIdx(g, i, j, k)] = sample(i + 0.5, j, k + 0.5, 1);
        if (m.fy[yIdx(g, i, j + 1, k)] === FACE_OPEN) m.uy[yIdx(g, i, j + 1, k)] = sample(i + 0.5, j + 1, k + 0.5, 1);
        if (m.fz[zIdx(g, i, j, k)] === FACE_OPEN) m.uz[zIdx(g, i, j, k)] = sample(i + 0.5, j + 0.5, k, 2);
        if (m.fz[zIdx(g, i, j, k + 1)] === FACE_OPEN) m.uz[zIdx(g, i, j, k + 1)] = sample(i + 0.5, j + 0.5, k + 1, 2);
      }
}

/** 面速度 -> 单元中心速度 */
export function faceToCell(m: MacGrid, out: Float32Array) {
  const { g, fluid } = m;
  const { nx, ny, nz } = g;
  for (let j = 1; j < ny - 1; j++)
    for (let k = 1; k < nz - 1; k++)
      for (let i = 1; i < nx - 1; i++) {
        const c = cIdx(g, i, j, k);
        if (!fluid[c]) {
          out[3 * c] = out[3 * c + 1] = out[3 * c + 2] = 0;
          continue;
        }
        const get = (arr: Float32Array, flags: Uint8Array, idx: number) => (flags[idx] ? arr[idx] : 0);
        const lx = xIdx(g, i, j, k),
          rx = xIdx(g, i + 1, j, k);
        const ly = yIdx(g, i, j, k),
          ry = yIdx(g, i, j + 1, k);
        const lz = zIdx(g, i, j, k),
          rz = zIdx(g, i, j, k + 1);
        const vxl = get(m.ux, m.fx, lx),
          vxr = get(m.ux, m.fx, rx);
        const vyl = get(m.uy, m.fy, ly),
          vyr = get(m.uy, m.fy, ry);
        const vzl = get(m.uz, m.fz, lz),
          vzr = get(m.uz, m.fz, rz);
        out[3 * c] = m.fx[lx] && m.fx[rx] ? 0.5 * (vxl + vxr) : m.fx[lx] ? vxl : m.fx[rx] ? vxr : 0;
        out[3 * c + 1] = m.fy[ly] && m.fy[ry] ? 0.5 * (vyl + vyr) : m.fy[ly] ? vyl : m.fy[ry] ? vyr : 0;
        out[3 * c + 2] = m.fz[lz] && m.fz[rz] ? 0.5 * (vzl + vzr) : m.fz[lz] ? vzl : m.fz[rz] ? vzr : 0;
      }
}

export function computeDivergence(m: MacGrid, out: Float32Array): number {
  const { g, fluid } = m;
  const { nx, ny, nz, h } = g;
  let mx = 0;
  for (let j = 1; j < ny - 1; j++)
    for (let k = 1; k < nz - 1; k++)
      for (let i = 1; i < nx - 1; i++) {
        const c = cIdx(g, i, j, k);
        if (!fluid[c]) {
          out[c] = 0;
          continue;
        }
        const fxr = xIdx(g, i + 1, j, k),
          fxl = xIdx(g, i, j, k);
        const fyr = yIdx(g, i, j + 1, k),
          fyl = yIdx(g, i, j, k);
        const fzr = zIdx(g, i, j, k + 1),
          fzl = zIdx(g, i, j, k);
        const d =
          ((m.fx[fxr] ? m.ux[fxr] : 0) -
            (m.fx[fxl] ? m.ux[fxl] : 0) +
            (m.fy[fyr] ? m.uy[fyr] : 0) -
            (m.fy[fyl] ? m.uy[fyl] : 0) +
            (m.fz[fzr] ? m.uz[fzr] : 0) -
            (m.fz[fzl] ? m.uz[fzl] : 0)) /
          h;
        out[c] = d;
        const a = Math.abs(d);
        if (a > mx) mx = a;
      }
  return mx;
}

/**
 * 压力投影: 红黑 SOR 解 (n p - Σp_neighbor)/h² = div。
 * 红黑排序保证 Gauss-Seidel 可向量化/无数据竞争, ω≈1.9 收敛快且稳定。
 * FACE_FIXED 面通量不变 (风机), 只修正 FACE_OPEN 面。
 */
export function projectPressure(
  m: MacGrid,
  opts: { maxIter?: number; tol?: number; omega?: number; warm?: Float32Array | null } = {},
): { iters: number; residual: number; divergence: number; pressure: Float32Array } {
  const { g, fluid } = m;
  const { nx, ny, nz, h } = g;
  const N = nx * ny * nz;
  const maxIter = opts.maxIter ?? 160;
  const omega = opts.omega ?? 1.9;
  const hh = h * h;

  const div = new Float32Array(N);
  computeDivergence(m, div);

  const p = new Float32Array(N);
  if (opts.warm && opts.warm.length === N) p.set(opts.warm);
  // b = div; Neumann 问题需去掉均值
  let sum = 0,
    cnt = 0;
  for (let c = 0; c < N; c++) {
    if (!fluid[c] || !m.nOpen[c]) continue;
    sum += div[c];
    cnt++;
  }
  const mean = cnt ? sum / cnt : 0;
  for (let c = 0; c < N; c++) if (fluid[c] && m.nOpen[c]) div[c] -= mean;

  const n = m.nOpen;
  let iters = 0;
  let res = 1;
  for (let s = 0; s < maxIter; s++) {
    iters = s + 1;
    // red: (i+j+k) even ; black: odd
    for (let color = 0; color < 2; color++) {
      for (let j = 1; j < ny - 1; j++)
        for (let k = 1; k < nz - 1; k++) {
          let c = cIdx(g, 1, j, k);
          for (let i = 1; i < nx - 1; i++, c++) {
            if (((i + j + k) & 1) !== color) continue;
            if (!fluid[c] || !n[c]) continue;
            let nb = 0;
            if (m.fx[xIdx(g, i + 1, j, k)] === FACE_OPEN) nb += p[cIdx(g, i + 1, j, k)];
            if (m.fx[xIdx(g, i, j, k)] === FACE_OPEN) nb += p[cIdx(g, i - 1, j, k)];
            if (m.fy[yIdx(g, i, j + 1, k)] === FACE_OPEN) nb += p[cIdx(g, i, j + 1, k)];
            if (m.fy[yIdx(g, i, j, k)] === FACE_OPEN) nb += p[cIdx(g, i, j - 1, k)];
            if (m.fz[zIdx(g, i, j, k + 1)] === FACE_OPEN) nb += p[cIdx(g, i, j, k + 1)];
            if (m.fz[zIdx(g, i, j, k)] === FACE_OPEN) nb += p[cIdx(g, i, j, k - 1)];
            // 投影后应满足 lap(p) = div, 其中 lap = (Σnb - n·p)/h²
            //  =>  n·p = Σnb - div·h²  =>  p = (nb - div·h²)/n
            const target = (nb - div[c] * hh) / n[c];
            p[c] += omega * (target - p[c]);
          }
        }
    }
    if (s % 16 === 15 || s === maxIter - 1) {
      res = residualNorm(m, p, div, h);
      if (res < 1e-4) break;
    }
  }

  // 修正开放面: 每个面只修正一次 (取 +x/+y/+z 侧单元)
  const { nx: gx, ny: gy, nz: gz } = g;
  for (let j = 1; j < gy - 1; j++)
    for (let k = 1; k < gz - 1; k++)
      for (let i = 1; i <= gx - 2; i++) {
        const f = xIdx(g, i + 1, j, k);
        if (m.fx[f] === FACE_OPEN) m.ux[f] -= (p[cIdx(g, i + 1, j, k)] - p[cIdx(g, i, j, k)]) / h;
      }
  for (let j = 1; j <= gy - 2; j++)
    for (let k = 1; k < gz - 1; k++)
      for (let i = 1; i < gx - 1; i++) {
        const f = yIdx(g, i, j + 1, k);
        if (m.fy[f] === FACE_OPEN) m.uy[f] -= (p[cIdx(g, i, j + 1, k)] - p[cIdx(g, i, j, k)]) / h;
      }
  for (let j = 1; j < gy - 1; j++)
    for (let k = 1; k <= gz - 2; k++)
      for (let i = 1; i < gx - 1; i++) {
        const f = zIdx(g, i, j, k + 1);
        if (m.fz[f] === FACE_OPEN) m.uz[f] -= (p[cIdx(g, i, j, k + 1)] - p[cIdx(g, i, j, k)]) / h;
      }

  const divergence = computeDivergence(m, div);
  return { iters, residual: res, divergence, pressure: p };
}

/** 压力方程残差的 RMS 值 (1/s), 做归一化 */
function residualNorm(m: MacGrid, p: Float32Array, div: Float32Array, h: number) {
  const { g, fluid } = m;
  const { nx, ny, nz } = g;
  const hh = h * h;
  let sum = 0,
    cnt = 0;
  for (let j = 1; j < ny - 1; j++)
    for (let k = 1; k < nz - 1; k++) {
      let c = cIdx(g, 1, j, k);
      for (let i = 1; i < nx - 1; i++, c++) {
        if (!fluid[c] || !m.nOpen[c]) continue;
        let nb = 0;
        if (m.fx[xIdx(g, i + 1, j, k)] === FACE_OPEN) nb += p[cIdx(g, i + 1, j, k)];
        if (m.fx[xIdx(g, i, j, k)] === FACE_OPEN) nb += p[cIdx(g, i - 1, j, k)];
        if (m.fy[yIdx(g, i, j + 1, k)] === FACE_OPEN) nb += p[cIdx(g, i, j + 1, k)];
        if (m.fy[yIdx(g, i, j, k)] === FACE_OPEN) nb += p[cIdx(g, i, j - 1, k)];
        if (m.fz[zIdx(g, i, j, k + 1)] === FACE_OPEN) nb += p[cIdx(g, i, j, k + 1)];
        if (m.fz[zIdx(g, i, j, k)] === FACE_OPEN) nb += p[cIdx(g, i, j, k - 1)];
        // 残差 = lap(p) - div, 其中 lap = (nb - n·p)/h²
        const r = (nb - m.nOpen[c] * p[c]) / hh - div[c];
        sum += r * r;
        cnt++;
      }
    }
  return Math.sqrt(sum / Math.max(1, cnt));
}
