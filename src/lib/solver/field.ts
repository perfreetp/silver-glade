/**
 * 体素风场求解器
 *
 * 两级网格:
 *   coarse 0.16 m (80×40×50 = 160k) —— 射流构造 + MAC 压力投影 (质量守恒)
 *   fine   0.08 m (160×80×100 = 1.28M) —— 三线性上采样, 即"每个体素的速度和方向"
 *
 * 流程:
 *   1. 体素化房间 + 菇架 (盒体) + 风机开孔
 *   2. 在单元中心构造速度: 风机射流 (高斯断面) + 大尺度环流 + 层间通道加速
 *   3. 映射到 MAC 面, 用 PCG 做压力投影, 保证离散散度为零
 *   4. 面速度 -> 单元中心 -> 细网格三线性上采样 (跳过实体体素)
 *   5. 统计: 最大/平均速度、6 档色带断点、空气龄
 */

import { RACKS, RACK_TOP, ROOM, SHELF_CENTERS, SHELF_THICKNESS, type Fan } from '../model/room';
export { ROOM } from '../model/room';
import { fanAirDir, fanFaceSpeed, fanWorldPosition } from '../model/fans';
import { buildSolidCells, rackBoxes, type Box, type CellGrid } from './geometry';
import {
  buildMac,
  cellToFace,
  faceToCell,
  projectPressure,
  xIdx,
  type Grid3,
  type MacGrid,
} from './mac';

export type { Grid3 } from './mac';

export interface FieldStats {
  fluidVoxels: number;
  solidVoxels: number;
  maxSpeed: number;
  meanSpeed: number;
  p95Speed: number;
  ageMean: number;
  solveMs: number;
  iters: number;
  residual: number;
  residualDivergence: number;
  supplyAirflow: number;
  exhaustAirflow: number;
  airChanges: number;
  balanceNote: string | null;
  timings: { geometry: number; velocity: number; project: number; upsample: number; stats: number };
}

export interface Solution {
  coarse: Grid3;
  fine: Grid3;
  room: typeof ROOM;
  solidFine: Uint8Array;
  /** 细网格速度 m/s, 3*N, 索引 x + nx*(z + nz*y) */
  velocity: Float32Array;
  speed: Float32Array;
  age: Float32Array;
  solidCoarse: Uint8Array;
  velocityCoarse: Float32Array;
  stats: FieldStats;
  boxes: Box[];
  colorStops: number[];
  scaleMax: number;
  maxRawSpeed: number;
}

const COARSE: Grid3 = { nx: 80, ny: 40, nz: 50, h: 0.16 };
const FINE: Grid3 = { nx: 160, ny: 80, nz: 100, h: 0.08 };
export const GRID_COARSE = COARSE;
export const GRID_FINE = FINE;
export const FINE_COUNT = FINE.nx * FINE.ny * FINE.nz;

/** 6 档速度色带 */
export const BAND_COLORS = ['#25439c', '#2f8fd4', '#22b9c4', '#86ce49', '#f2c53c', '#e64f37'];
export const BAND_NAMES = ['1 档', '2 档', '3 档', '4 档', '5 档', '6 档'];

/** 选一个"好看"的速度上限, 让主体流动落在 2~4 档 */
export function chooseScaleMax(p95: number, maxSpeed: number): number {
  // 以 p95 为主, 保证绝大多数空间落在中间档; 极端射流会饱和到第 6 档
  const target = Math.min(maxSpeed * 0.95, Math.max(p95 * 1.18, 0.2));
  const nice = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20];
  for (const v of nice) if (v >= target) return v;
  return Math.ceil(target);
}

export function buildColorStops(scaleMax: number): number[] {
  const stops: number[] = [];
  for (let i = 0; i <= 6; i++) stops.push((scaleMax * i) / 6);
  return stops;
}

export function colorBand(speed: number, stops: number[]): number {
  if (!(speed > stops[1])) return 0;
  for (let b = 1; b < 6; b++) if (speed <= stops[b + 1]) return b;
  return 5;
}

interface Cache {
  m: MacGrid | null;
  cellVel: Float32Array;
  fineVel: Float32Array;
  fineSpeed: Float32Array;
  fineAge: Float32Array;
  fineSolid: Uint8Array;
  boxes: Box[];
  pressure: Float32Array | null;
  pressureKey: string;
}

const cache: Cache = {
  m: null,
  cellVel: new Float32Array(COARSE.nx * COARSE.ny * COARSE.nz * 3),
  fineVel: new Float32Array(FINE_COUNT * 3),
  fineSpeed: new Float32Array(FINE_COUNT),
  fineAge: new Float32Array(FINE_COUNT),
  fineSolid: new Uint8Array(FINE_COUNT),
  boxes: [],
  pressure: null,
  pressureKey: '',
};

/**
 * 丢弃缓存。Worker 把数组 transfer 给主线程后会 detach, 下一次求解前必须重建缓冲。
 * 主线程 (非 worker) 求解时也可以调用来释放内存。
 */
export function resetSolveCache() {
  cache.m = null;
  cache.cellVel = new Float32Array(COARSE.nx * COARSE.ny * COARSE.nz * 3);
  cache.fineVel = new Float32Array(FINE_COUNT * 3);
  cache.fineSpeed = new Float32Array(FINE_COUNT);
  cache.fineAge = new Float32Array(FINE_COUNT);
  cache.fineSolid = new Uint8Array(FINE_COUNT);
  cache.boxes = [];
  // 压力场没有被 transfer 出去, 保留下来以便拖动时热启动
  if (cache.pressure && cache.pressure.length !== COARSE.nx * COARSE.ny * COARSE.nz) cache.pressure = null;
  // (pressureKey 保持)
}

export interface SolveOptions {
  /** 粗网格 (默认 0.16 m) */
  grid?: Grid3;
  /** 压力迭代上限 */
  maxIter?: number;
  /** 容差 */
  tol?: number;
  /** SOR 松弛因子 */
  omega?: number;
  /** 上次求解的压力场, 用于拖动时热启动 */
  warmPressure?: Float32Array | null;
  /** 是否计算空气龄 (拖动时可跳过) */
  skipAge?: boolean;
  /** 是否做细网格平滑 (拖动时可跳过) */
  skipRelax?: boolean;
}

export function solveField(fans: Fan[], opts: SolveOptions = {}): Solution {
  const t0 = performance.now();
  const g = opts.grid ?? COARSE;
  const { nx, ny, nz, h } = g;
  const N = nx * ny * nz;

  // ---- 1. 几何 ----
  const boxes = rackBoxes(h * 0.7);
  const { solid } = buildSolidCells(g, fans, boxes);
  cache.boxes = boxes;
  const tGeom = performance.now();

  // ---- 2. 构造速度场 ----
  const { m, prescribed, note } = buildMac(g, solid, fans);
  const cellVel = ensureCellVel(N);
  cellVel.fill(0);

  const uFaces = m; // 面速度已由 buildMac 写了风机边界
  const actives = fans.filter((f) => f.airflow > 0 && f.radius > 0.02);
  for (const fan of actives) injectJetCell(cellVel, m.fluid, g, fan);
  injectCirculation(cellVel, m.fluid, g, actives);
  injectRackShear(cellVel, m.fluid, g);
  projectCellWalls(cellVel, m.fluid, g, solid);

  // 限制尖峰, 避免风机交叠
  const maxFace = Math.max(0.4, ...actives.map((f) => fanFaceSpeed(f)));
  const cap = maxFace * 1.6;
  clampSpeed(cellVel, m.fluid, cap);
  const tVel = performance.now();

  // ---- 3. MAC 压力投影 ----
  cellToFace(m, cellVel);
  const geomKey = `${g.nx}x${g.ny}x${g.nz}`;
  const warm = !opts.skipAge && cache.pressure && cache.pressureKey === geomKey && cache.pressure.length === N
    ? cache.pressure
    : opts.warmPressure ?? null;
  const proj = projectPressure(m, {
    maxIter: opts.maxIter ?? 200,
    tol: opts.tol ?? 1e-4,
    omega: opts.omega ?? 1.9,
    warm: opts.warmPressure ?? warm,
  });
  if (proj.pressure.length === N) {
    cache.pressure = proj.pressure;
    cache.pressureKey = geomKey;
  }
  faceToCell(m, cellVel);
  const tProj = performance.now();

  // ---- 4. 细网格上采样 ----
  upsample(m.fluid, cellVel, g, cache.fineVel, cache.fineSolid, boxes);
  // 细网格盒体之间的缝隙需要"补气": 用一次细网格的局部平滑,
  // 让搁板边缘的体素也有合理速度, 避免粒子在菇架表面卡住
  if (!opts.skipRelax) relaxFine(cache.fineVel, cache.fineSolid);
  const tUp = performance.now();

  // ---- 5. 统计 ----
  const speed = cache.fineSpeed;
  const fineSolid = cache.fineSolid;
  let maxSpeed = 0;
  let sumsq = 0;
  let fluidFine = 0;
  for (let i = 0; i < FINE_COUNT; i++) {
    if (fineSolid[i]) {
      speed[i] = 0;
      continue;
    }
    fluidFine++;
    const vx = cache.fineVel[3 * i],
      vy = cache.fineVel[3 * i + 1],
      vz = cache.fineVel[3 * i + 2];
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    speed[i] = sp;
    sumsq += sp * sp;
    if (sp > maxSpeed) maxSpeed = sp;
  }
  const p95 = percentile(speed, fineSolid, 0.95);
  if (opts.skipAge) {
    // 拖动时保留上一次的空气龄场, 只更新速度
  } else {
    computeAge(cellVel, m.fluid, g, cache.fineVel, fineSolid, cache.fineAge);
  }

  let ageSum = 0,
    ageN = 0;
  for (let i = 0; i < FINE_COUNT; i++) if (!fineSolid[i]) (ageSum += cache.fineAge[i]), ageN++;

  const supplies = actives.filter((f) => f.kind === 'supply');
  const exhausts = actives.filter((f) => f.kind === 'exhaust');
  const supplyAirflow = supplies.reduce((s, f) => s + f.airflow, 0);
  const exhaustAirflow = exhausts.reduce((s, f) => s + f.airflow, 0);
  const roomVol = ROOM.lx * ROOM.ly * ROOM.lz;
  const meanSpeed = fluidFine ? Math.sqrt(sumsq / fluidFine) : 0;

  const scaleMax = chooseScaleMax(p95, maxSpeed);
  const stats: FieldStats = {
    fluidVoxels: fluidFine,
    solidVoxels: FINE_COUNT - fluidFine,
    maxSpeed,
    meanSpeed,
    p95Speed: p95,
    ageMean: ageN ? ageSum / ageN : 0,
    solveMs: performance.now() - t0,
    iters: proj.iters,
    residual: proj.residual,
    residualDivergence: proj.divergence,
    supplyAirflow,
    exhaustAirflow,
    airChanges: (Math.min(supplyAirflow, exhaustAirflow || supplyAirflow) / roomVol) * 1,
    balanceNote: note,
    timings: {
      geometry: tGeom - t0,
      velocity: tVel - tGeom,
      project: tProj - tVel,
      upsample: tUp - tProj,
      stats: performance.now() - tUp,
    },
  };

  return {
    coarse: g,
    fine: FINE,
    room: ROOM,
    solidFine: fineSolid,
    velocity: cache.fineVel,
    speed,
    age: cache.fineAge,
    solidCoarse: solid,
    velocityCoarse: cellVel,
    stats,
    boxes,
    colorStops: buildColorStops(scaleMax),
    scaleMax,
    maxRawSpeed: maxSpeed,
  };
}

function ensureCellVel(N: number) {
  if (cache.cellVel.length !== N * 3) cache.cellVel = new Float32Array(N * 3);
  return cache.cellVel;
}

// ---------------------------------------------------------------------------
// 速度场构造 (单元中心)
// ---------------------------------------------------------------------------

function injectJetCell(cell: Float32Array, fluid: Uint8Array, g: Grid3, fan: Fan) {
  const { nx, ny, nz, h } = g;
  const pos = fanWorldPosition(fan);
  const dir = fanAirDir(fan);
  const speed0 = fanFaceSpeed(fan);
  const radius = fan.radius;
  const jetLen = Math.min(
    Math.max(ROOM.lx, ROOM.ly, ROOM.lz) * 1.0,
    Math.max(2.0, radius * 4.5 + Math.sqrt(fan.airflow / 3600) * 2.6),
  );
  const spread = fan.kind === 'supply' ? 0.15 : 0.22;

  const bx0 = Math.max(1, Math.floor((Math.min(pos.x, pos.x + dir.x * jetLen) - jetLen * 0.45) / h));
  const bx1 = Math.min(nx - 2, Math.ceil((Math.max(pos.x, pos.x + dir.x * jetLen) + jetLen * 0.45) / h));
  const by0 = Math.max(1, Math.floor((Math.min(pos.y, pos.y + dir.y * jetLen) - jetLen * 0.45) / h));
  const by1 = Math.min(ny - 2, Math.ceil((Math.max(pos.y, pos.y + dir.y * jetLen) + jetLen * 0.45) / h));
  const bz0 = Math.max(1, Math.floor((Math.min(pos.z, pos.z + dir.z * jetLen) - jetLen * 0.45) / h));
  const bz1 = Math.min(nz - 2, Math.ceil((Math.max(pos.z, pos.z + dir.z * jetLen) + jetLen * 0.45) / h));

  for (let y = by0; y <= by1; y++) {
    const py = (y + 0.5) * h - pos.y;
    for (let z = bz0; z <= bz1; z++) {
      const pz = (z + 0.5) * h - pos.z;
      for (let x = bx0; x <= bx1; x++) {
        const c = x + nx * (z + nz * y);
        if (!fluid[c]) continue;
        const px = (x + 0.5) * h - pos.x;
        const along = px * dir.x + py * dir.y + pz * dir.z;
        if (along < -h || along > jetLen) continue;
        const radial = Math.sqrt(Math.max(0, px * px + py * py + pz * pz - along * along));
        const rEff =
          fan.kind === 'supply' ? radius + Math.max(0, along) * spread : radius * 1.3 + Math.abs(along) * spread * 1.6;
        const sigma = rEff * 0.7 + h * 0.45;
        const gr = Math.exp(-(radial * radial) / (2 * sigma * sigma));
        if (gr < 3e-3) continue;
        const decay =
          fan.kind === 'supply'
            ? Math.exp(-Math.max(0, along) / (jetLen * 1.2))
            : Math.exp(-Math.abs(along) / (radius * 9 + 0.8));
        const mag = speed0 * gr * decay;
        cell[3 * c] += dir.x * mag;
        cell[3 * c + 1] += dir.y * mag;
        cell[3 * c + 2] += dir.z * mag;
      }
    }
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 大尺度环流: 用流函数 / 矢量势构造的解析无散度场, 叠加两侧射流 */
function injectCirculation(cell: Float32Array, fluid: Uint8Array, g: Grid3, actives: Fan[]) {
  const supplies = actives.filter((f) => f.kind === 'supply');
  const exhausts = actives.filter((f) => f.kind === 'exhaust');
  if (!supplies.length || !exhausts.length) return;
  const flow = Math.min(
    supplies.reduce((s, f) => s + f.airflow, 0),
    exhausts.reduce((s, f) => s + f.airflow, 0),
  );
  // 断面平均风速 (进风口总风量 / 横截面积), 乘一个卷吸放大系数
  const bulk = (flow / 3600 / (ROOM.ly * ROOM.lz)) * 4.6;
  if (!(bulk > 0)) return;

  // 主环流的方向: 由进风口高度与回风口高度决定转动的正负
  const csup = centroid(supplies);
  const cexh = centroid(exhausts);
  // 顶部流向回风侧, 底部回流: 当回风口高于进风口时为"正向"滚转
  const dirSign = cexh.y >= csup.y ? 1 : -1;
  // 沿 +X 的纯度: 若回风口与进风口不在同一侧墙, 以 X 环流为主
  const alongX = Math.abs(cexh.x - csup.x) >= Math.abs(cexh.z - csup.z);
  const { nx, ny, nz, h } = g;

  // ψ(x,y) = A sin(πx/Lx) sin(πy/Ly)
  // u =  ψ_y =  A (π/Ly) sin(πx/Lx) cos(πy/Ly)
  // v = -ψ_x = -A (π/Lx) cos(πx/Lx) sin(πy/Ly)
  // 取 A = -dirSign * bulk * Ly/2 / (2/π)  => 断面平均 |u| = bulk
  const A = (-dirSign * bulk * ROOM.ly) / 2;

  // 侧向走廊强化: 菇架与墙之间 / 两排菇架之间流速更高
  const aisleFactor = (pz: number) => {
    let f = 1;
    const wall = Math.min(pz, ROOM.lz - pz);
    f += 0.55 * Math.exp(-Math.pow(wall / 0.75, 2));
    for (const r of RACKS) {
      const d = Math.min(Math.abs(pz - r.z0), Math.abs(pz - r.z1));
      f += 0.45 * Math.exp(-Math.pow(d / 0.45, 2));
    }
    return f;
  };

  // 侧向扩散: 由 (x,z) 平面的第二个矢量势提供, 只在沿 X 环流时启用
  const B = alongX ? bulk * 0.62 : 0;
  const Lz = ROOM.lz;
  const Lx = ROOM.lx;

  for (let y = 1; y < ny - 1; y++) {
    const py = (y + 0.5) * h;
    const sy = Math.sin((Math.PI * py) / ROOM.ly);
    const cy = Math.cos((Math.PI * py) / ROOM.ly);
    for (let z = 1; z < nz - 1; z++) {
      const pz = (z + 0.5) * h;
      const af = aisleFactor(pz);
      for (let x = 1; x < nx - 1; x++) {
        const c = x + nx * (z + nz * y);
        if (!fluid[c]) continue;
        const px = (x + 0.5) * h;
        const sx = Math.sin((Math.PI * px) / Lx);
        const cx = Math.cos((Math.PI * px) / Lx);
        // 两端 (风机附近) 减弱, 避免与射流打架
        const ends = smoothstep(0, 0.9, Math.min(px, Lx - px));
        const uRoll = A * (Math.PI / ROOM.ly) * sx * cy * af * ends;
        const vRoll = -A * (Math.PI / Lx) * cx * sy * af * ends;
        // 侧向 (Z) 扩散项: u = -∂φ/∂z, w = ∂φ/∂x, φ = B sin(πx/Lx) sin(πz/Lz) sy
        let uZ = 0,
          wZ = 0;
        if (B) {
          const sz = Math.sin((Math.PI * pz) / Lz);
          const cz = Math.cos((Math.PI * pz) / Lz);
          uZ = -B * (Math.PI / Lz) * sx * cz * sy * ends;
          wZ = B * (Math.PI / Lx) * cx * sz * sy * ends;
        }
        cell[3 * c] += uRoll + uZ;
        cell[3 * c + 1] += vRoll;
        cell[3 * c + 2] += wZ;
      }
    }
  }
  void cexh;
  void csup;
}

function centroid(fans: Fan[]) {
  const p = { x: 0, y: 0, z: 0 };
  for (const fan of fans) {
    const q = fanWorldPosition(fan);
    p.x += q.x;
    p.y += q.y;
    p.z += q.z;
  }
  const n = Math.max(1, fans.length);
  return { x: p.x / n, y: p.y / n, z: p.z / n };
}

/** 层间通道: 气流被挤过搁板间隙时沿 X 加速 */
function injectRackShear(cell: Float32Array, fluid: Uint8Array, g: Grid3) {
  const { nx, ny, nz, h } = g;
  const gapCenters: number[] = [];
  for (let k = 0; k < SHELF_CENTERS.length; k++) {
    const top = SHELF_CENTERS[k] + SHELF_THICKNESS / 2;
    const next = k + 1 < SHELF_CENTERS.length ? SHELF_CENTERS[k + 1] - SHELF_THICKNESS / 2 : RACK_TOP + 1.3;
    gapCenters.push((top + next) / 2);
  }
  for (let y = 1; y < ny - 1; y++) {
    const py = (y + 0.5) * h;
    let gg = 0;
    for (const gc of gapCenters) gg = Math.max(gg, Math.exp(-Math.pow((py - gc) / 0.2, 2)));
    if (gg < 0.04) continue;
    for (let z = 1; z < nz - 1; z++) {
      const pz = (z + 0.5) * h;
      let inside = false;
      for (const r of RACKS) if (pz > r.z0 - 0.1 && pz < r.z1 + 0.1) inside = true;
      if (!inside) continue;
      for (let x = 1; x < nx - 1; x++) {
        const c = x + nx * (z + nz * y);
        if (fluid[c]) cell[3 * c] += gg * 0.55;
      }
    }
  }
}

/** 把单元速度在实体表面上的法向分量清零 */
function projectCellWalls(cell: Float32Array, fluid: Uint8Array, g: Grid3, solid: Uint8Array) {
  const { nx, ny, nz } = g;
  for (let y = 1; y < ny - 1; y++)
    for (let z = 1; z < nz - 1; z++) {
      let c = xIdx(g, 1, y, z);
      for (let x = 1; x < nx - 1; x++, c++) {
        if (!fluid[c]) {
          cell[3 * c] = cell[3 * c + 1] = cell[3 * c + 2] = 0;
          continue;
        }
        if (solid[c - 1] && cell[3 * c] < 0) cell[3 * c] = 0;
        if (solid[c + 1] && cell[3 * c] > 0) cell[3 * c] = 0;
        if (solid[c - nx] && cell[3 * c + 1] < 0) cell[3 * c + 1] = 0;
        if (solid[c + nx] && cell[3 * c + 1] > 0) cell[3 * c + 1] = 0;
        if (solid[c - nx * nz] && cell[3 * c + 2] < 0) cell[3 * c + 2] = 0;
        if (solid[c + nx * nz] && cell[3 * c + 2] > 0) cell[3 * c + 2] = 0;
      }
    }
}

function clampSpeed(cell: Float32Array, fluid: Uint8Array, cap: number) {
  const c2 = cap * cap;
  for (let c = 0; c < fluid.length; c++) {
    if (!fluid[c]) continue;
    const vx = cell[3 * c],
      vy = cell[3 * c + 1],
      vz = cell[3 * c + 2];
    const s2 = vx * vx + vy * vy + vz * vz;
    if (s2 > c2 && s2 > 0) {
      const k = cap / Math.sqrt(s2);
      cell[3 * c] = vx * k;
      cell[3 * c + 1] = vy * k;
      cell[3 * c + 2] = vz * k;
    }
  }
}

// ---------------------------------------------------------------------------
// 细网格上采样
// ---------------------------------------------------------------------------

interface AxisTable {
  i0: Int32Array;
  i1: Int32Array;
  f: Float32Array;
}
let tables: { x: AxisTable; y: AxisTable; z: AxisTable; key: string } | null = null;

function axisTable(nFine: number, nCoarse: number): AxisTable {
  const i0 = new Int32Array(nFine),
    i1 = new Int32Array(nFine),
    f = new Float32Array(nFine);
  const s = nFine / nCoarse;
  for (let i = 0; i < nFine; i++) {
    const v = Math.max(0.5, Math.min(nCoarse - 1.5, (i + 0.5) / s - 0.5));
    i0[i] = Math.floor(v);
    i1[i] = i0[i] + 1;
    f[i] = v - i0[i];
  }
  return { i0, i1, f };
}

function ensureTables(g: Grid3) {
  const key = `${FINE.nx}/${FINE.ny}/${FINE.nz}x${g.nx}/${g.ny}/${g.nz}`;
  if (!tables || tables.key !== key) {
    tables = {
      x: axisTable(FINE.nx, g.nx),
      y: axisTable(FINE.ny, g.ny),
      z: axisTable(FINE.nz, g.nz),
      key,
    };
  }
  return tables;
}

/**
 * 细网格实体 = 墙体 + 细精度菇架盒体。
 * 细网格速度 = 粗网格三线性插值 (跳过实体体素并归一化权重)。
 */
function upsample(
  cfluid: Uint8Array,
  cellVel: Float32Array,
  g: Grid3,
  out: Float32Array,
  fSolid: Uint8Array,
  boxes: Box[],
) {
  const NX = FINE.nx,
    NY = FINE.ny,
    NZ = FINE.nz;
  const CX = g.nx,
    CY = g.ny,
    CZ = g.nz;

  // 细网格实体
  fSolid.fill(0);
  for (let y = 0; y < NY; y++) {
    for (let z = 0; z < NZ; z++) {
      const row = NX * (z + NZ * y);
      fSolid[row] = 1;
      fSolid[row + NX - 1] = 1;
      if (y === 0 || y === NY - 1) for (let x = 0; x < NX; x++) fSolid[row + x] = 1;
      if (z === 0 || z === NZ - 1) for (let x = 0; x < NX; x++) fSolid[row + x] = 1;
    }
  }
  const fh = FINE.h;
  for (const b of boxes) {
    const x0 = Math.max(1, Math.round(b.x0 / fh));
    const x1 = Math.min(NX - 2, Math.round(b.x1 / fh) - 1);
    const y0 = Math.max(1, Math.round(b.y0 / fh));
    const y1 = Math.min(NY - 2, Math.round(b.y1 / fh) - 1);
    const z0 = Math.max(1, Math.round(b.z0 / fh));
    const z1 = Math.min(NZ - 2, Math.round(b.z1 / fh) - 1);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        let c = x0 + NX * (z + NZ * y);
        for (let x = x0; x <= x1; x++, c++) fSolid[c] = 1;
      }
  }

  const T = ensureTables(g);
  const tx = T.x,
    ty = T.y,
    tz = T.z;
  let o = 0;
  for (let y = 0; y < NY; y++) {
    const y0 = ty.i0[y],
      y1 = ty.i1[y],
      wy = ty.f[y],
      wy0 = 1 - wy,
      wy1 = wy;
    for (let z = 0; z < NZ; z++) {
      const z0 = tz.i0[z],
        z1 = tz.i1[z],
        wz = tz.f[z],
        wz0 = 1 - wz,
        wz1 = wz;
      const c000 = CX * (z0 + CZ * y0),
        c001 = CX * (z1 + CZ * y0),
        c010 = CX * (z0 + CZ * y1),
        c011 = CX * (z1 + CZ * y1);
      for (let x = 0; x < NX; x++, o++) {
        if (fSolid[o]) {
          out[3 * o] = out[3 * o + 1] = out[3 * o + 2] = 0;
          continue;
        }
        const x0 = tx.i0[x],
          x1 = tx.i1[x],
          wx = tx.f[x],
          wx0 = 1 - wx;        const i000 = x0 + c000,
          i100 = x1 + c000,
          i001 = x0 + c001,
          i101 = x1 + c001,
          i010 = x0 + c010,
          i110 = x1 + c010,
          i011 = x0 + c011,
          i111 = x1 + c011;
        const a000 = cfluid[i000] ? 1 : 0,
          a100 = cfluid[i100] ? 1 : 0,
          a001 = cfluid[i001] ? 1 : 0,
          a101 = cfluid[i101] ? 1 : 0,
          a010 = cfluid[i010] ? 1 : 0,
          a110 = cfluid[i110] ? 1 : 0,
          a011 = cfluid[i011] ? 1 : 0,
          a111 = cfluid[i111] ? 1 : 0;
        const w000 = a000 * wx0 * wz0 * wy0,
          w100 = a100 * wx * wz0 * wy0,
          w001 = a001 * wx0 * wz1 * wy0,
          w101 = a101 * wx * wz1 * wy0,
          w010 = a010 * wx0 * wz0 * wy1,
          w110 = a110 * wx * wz0 * wy1,
          w011 = a011 * wx0 * wz1 * wy1,
          w111 = a111 * wx * wz1 * wy1;
        const ws = w000 + w100 + w001 + w101 + w010 + w110 + w011 + w111;
        const bi = 3 * o;
        if (ws < 1e-4) {
          let best = -1,
            bestD = Infinity;
          const idxs = [i000, i100, i001, i101, i010, i110, i011, i111];
          for (let q = 0; q < 8; q++) {
            if (!cfluid[idxs[q]]) continue;
            const dx = q & 1 ? wx : wx0,
              dy = q & 4 ? wy : wy0,
              dz = q & 2 ? wz : wz0;
            const d = dx + dy + dz;
            if (d < bestD) {
              bestD = d;
              best = idxs[q];
            }
          }
          if (best >= 0) {
            out[bi] = cellVel[3 * best];
            out[bi + 1] = cellVel[3 * best + 1];
            out[bi + 2] = cellVel[3 * best + 2];
          } else out[bi] = out[bi + 1] = out[bi + 2] = 0;
          continue;
        }
        const inv = 1 / ws;
        out[bi] =
          (cellVel[3 * i000] * w000 + cellVel[3 * i100] * w100 + cellVel[3 * i001] * w001 + cellVel[3 * i101] * w101 + cellVel[3 * i010] * w010 + cellVel[3 * i110] * w110 + cellVel[3 * i011] * w011 + cellVel[3 * i111] * w111) *
          inv;
        out[bi + 1] =
          (cellVel[3 * i000 + 1] * w000 + cellVel[3 * i100 + 1] * w100 + cellVel[3 * i001 + 1] * w001 + cellVel[3 * i101 + 1] * w101 + cellVel[3 * i010 + 1] * w010 + cellVel[3 * i110 + 1] * w110 + cellVel[3 * i011 + 1] * w011 + cellVel[3 * i111 + 1] * w111) *
          inv;
        out[bi + 2] =
          (cellVel[3 * i000 + 2] * w000 + cellVel[3 * i100 + 2] * w100 + cellVel[3 * i001 + 2] * w001 + cellVel[3 * i101 + 2] * w101 + cellVel[3 * i010 + 2] * w010 + cellVel[3 * i110 + 2] * w110 + cellVel[3 * i011 + 2] * w011 + cellVel[3 * i111 + 2] * w111) *
          inv;
      }
    }
  }
}

/**
 * 细网格局部平滑: 菇架盒体之间的缝隙在粗网格上被平均掉了,
 * 这里用 3x3x3 加权平均 (只平滑速度方向, 不改变整体流量),
 * 让搁板边缘的体素也有连续的流动, 粒子不会在表面卡死。
 */
function relaxFine(vel: Float32Array, solid: Uint8Array) {
  const { nx, ny, nz } = FINE;
  const N = nx * ny * nz;
  const tmp = new Float32Array(N * 3);
  const w = [0.5, 0.12];
  for (let pass = 0; pass < 2; pass++) {
    tmp.set(vel);
    for (let y = 1; y < ny - 1; y++)
      for (let z = 1; z < nz - 1; z++) {
        let c = 1 + nx * (z + nz * y);
        for (let x = 1; x < nx - 1; x++, c++) {
          if (solid[c]) continue;
          let sx = tmp[3 * c] * w[0],
            sy = tmp[3 * c + 1] * w[0],
            sz = tmp[3 * c + 2] * w[0];
          let ws = w[0];
          for (let q = 0; q < 6; q++) {
            const n = q === 0 ? c - 1 : q === 1 ? c + 1 : q === 2 ? c - nx : q === 3 ? c + nx : q === 4 ? c - nx * nz : c + nx * nz;
            if (solid[n]) continue;
            sx += tmp[3 * n] * w[1];
            sy += tmp[3 * n + 1] * w[1];
            sz += tmp[3 * n + 2] * w[1];
            ws += w[1];
          }
          const inv = 1 / ws;
          vel[3 * c] = sx * inv;
          vel[3 * c + 1] = sy * inv;
          vel[3 * c + 2] = sz * inv;
        }
      }
  }
}/**
 * 空气龄: 从进风口出发, 沿逆流方向做 Dijkstra 松弛,
 * 得到"到达每个体素所需的最短时间", 再归一化到 0..1。
 */
function computeAge(
  cellVel: Float32Array,
  cfluid: Uint8Array,
  g: Grid3,
  fineVel: Float32Array,
  fSolid: Uint8Array,
  out: Float32Array,
) {
  const { nx, ny, nz, h } = g;
  const N = nx * ny * nz;
  const BIG = 1e8;
  const age = new Float32Array(N);
  const next = new Float32Array(N);
  for (let i = 0; i < N; i++) age[i] = cfluid[i] ? BIG : -1;

  // 源: 每个空气单元里风速最大的一小部分 (进风射流核心)
  const speeds = new Float32Array(N);
  let maxS = 0;
  for (let i = 0; i < N; i++) {
    if (!cfluid[i]) continue;
    const s = Math.hypot(cellVel[3 * i], cellVel[3 * i + 1], cellVel[3 * i + 2]);
    speeds[i] = s;
    if (s > maxS) maxS = s;
  }
  // 取最靠近进风口的单元作为源: 用"速度大的单元"近似
  const thresh = maxS * 0.75;
  for (let i = 0; i < N; i++) if (cfluid[i] && speeds[i] >= thresh) age[i] = 0;

  const nbr = [0, 0, 0, 0, 0, 0];
  for (let pass = 0; pass < 36; pass++) {
    next.set(age);
    for (let y = 1; y < ny - 1; y++)
      for (let z = 1; z < nz - 1; z++) {
        let c = xIdx(g, 1, y, z);
        for (let x = 1; x < nx - 1; x++, c++) {
          if (!cfluid[c]) continue;
          let a = age[c];
          nbr[0] = c - 1;
          nbr[1] = c + 1;
          nbr[2] = c - nx;
          nbr[3] = c + nx;
          nbr[4] = c - nx * nz;
          nbr[5] = c + nx * nz;
          const sp = Math.max(0.08, speeds[c]);
          for (let q = 0; q < 6; q++) {
            const j = nbr[q];
            if (!cfluid[j] || age[j] >= BIG) continue;
            const cand = age[j] + h / sp;
            if (cand < a) a = cand;
          }
          if (a < next[c]) next[c] = a;
        }
      }
    age.set(next);
  }

  let mx = 0;
  for (let i = 0; i < N; i++) if (cfluid[i] && age[i] < BIG && age[i] > mx) mx = age[i];

  // 上采样到细网格
  const T = ensureTables(g);
  const tx = T.x,
    ty = T.y,
    tz = T.z;
  const NX = FINE.nx,
    NY = FINE.ny,
    NZ = FINE.nz;
  let o = 0;
  for (let y = 0; y < NY; y++) {
    const y0 = ty.i0[y],
      y1 = ty.i1[y],
      wy = ty.f[y];
    for (let z = 0; z < NZ; z++) {
      const z0 = tz.i0[z],
        z1 = tz.i1[z],
        wz = tz.f[z];
      for (let x = 0; x < NX; x++, o++) {
        if (fSolid[o]) {
          out[o] = 0;
          continue;
        }
        const x0 = tx.i0[x],
          x1 = tx.i1[x],
          wx = tx.f[x];
        const v =
          (1 - wy) *
            ((1 - wz) * ((1 - wx) * age[x0 + nx * (z0 + nz * y0)] + wx * age[x1 + nx * (z0 + nz * y0)]) + wz * ((1 - wx) * age[x0 + nx * (z1 + nz * y0)] + wx * age[x1 + nx * (z1 + nz * y0)])) +
          wy * ((1 - wz) * ((1 - wx) * age[x0 + nx * (z0 + nz * y1)] + wx * age[x1 + nx * (z0 + nz * y1)]) + wz * ((1 - wx) * age[x0 + nx * (z1 + nz * y1)] + wx * age[x1 + nx * (z1 + nz * y1)]));
        out[o] = mx > 0 && v < BIG ? Math.max(0, Math.min(1, v / mx)) : 0;
      }
    }
  }
  void fineVel;
}

function percentile(speed: Float32Array, solid: Uint8Array, q: number): number {
  let max = 0;
  for (let i = 0; i < speed.length; i++) if (!solid[i] && speed[i] > max) max = speed[i];
  if (max <= 0) return 0;
  const BINS = 1024;
  const hist = new Uint32Array(BINS);
  let n = 0;
  const k = BINS / max;
  for (let i = 0; i < speed.length; i++) {
    if (solid[i]) continue;
    hist[Math.min(BINS - 1, Math.floor(speed[i] * k))]++;
    n++;
  }
  const target = q * n;
  let acc = 0;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (acc >= target) return ((b + 0.5) * max) / BINS;
  }
  return max;
}
