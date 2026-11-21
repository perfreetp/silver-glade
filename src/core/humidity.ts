import { GRID_W, GRID_H, ROOM, nozzleDir } from './config';
import type { BoxSpec } from './config';
import type { NozzleSpec, NozzleStats } from './types';

/** 判定“被覆盖”的湿度下限 */
export const COVER_EPS = 0.02;

/**
 * 地面湿度场。
 * - 每个喷头持有独立的贡献栅格，总量 = 各喷头之和；
 * - 单个喷头参数变化时只重算该喷头的栅格并增量合并（total += new - old）；
 * - 遮挡：喷头到地面点的线段与菇架层板 AABB 做 slab 相交测试。
 */
export class HumidityField {
  readonly w = GRID_W;
  readonly h = GRID_H;
  /** 累积湿度（所有喷头之和） */
  readonly total = new Float32Array(GRID_W * GRID_H);
  /** 遮挡掩码：1 = 在某喷头锥内但被菇架挡住 */
  readonly occl = new Uint8Array(GRID_W * GRID_H);
  /** 遮挡检查开关（关闭时菇架不阻挡喷雾） */
  occlusionEnabled = true;

  private contrib = new Map<number, Float32Array>();
  private blocked = new Map<number, Uint8Array>();
  private boxes: BoxSpec[];
  /** 预计算的栅格中心世界坐标（避免内层循环重复计算） */
  private xs = new Float64Array(GRID_W);
  private zs = new Float64Array(GRID_H);

  constructor(boxes: BoxSpec[]) {
    this.boxes = boxes;
    for (let i = 0; i < GRID_W; i++) {
      this.xs[i] = -ROOM.width / 2 + (i + 0.5) * (ROOM.width / GRID_W);
    }
    for (let j = 0; j < GRID_H; j++) {
      this.zs[j] = -ROOM.depth / 2 + (j + 0.5) * (ROOM.depth / GRID_H);
    }
  }

  /** 计算单个喷头的贡献栅格与遮挡栅格（入参先快照为普通值，避开响应式代理） */
  private computeInto(nozzle: NozzleSpec, grid: Float32Array, blk: Uint8Array) {
    grid.fill(0);
    blk.fill(0);
    const on = nozzle.on;
    if (!on) return;
    const nx = nozzle.x, ny = nozzle.y, nz = nozzle.z;
    const intensity = nozzle.intensity;
    const dir = nozzleDir(nozzle);
    const dx = dir.x, dy = dir.y, dz = dir.z;
    const cosHalf = Math.cos((nozzle.spread * Math.PI) / 180);
    const oneMinusCos = Math.max(1e-6, 1 - cosHalf);
    const checkOcc = this.occlusionEnabled;
    const xs = this.xs, zs = this.zs, w = this.w, h = this.h;
    for (let j = 0; j < h; j++) {
      const pz = zs[j];
      const row = j * w;
      const vz = pz - nz;
      for (let i = 0; i < w; i++) {
        const vx = xs[i] - nx;
        const vy = -ny;
        const d2 = vx * vx + vy * vy + vz * vz;
        const d = Math.sqrt(d2);
        if (d < 1e-6) continue;
        const cosA = (vx * dx + vy * dy + vz * dz) / d;
        if (cosA < cosHalf) continue; // 锥外
        const idx = row + i;
        if (checkOcc && this.segmentBlocked(nx, ny, nz, xs[i], 0, pz)) {
          blk[idx] = 1;
          continue;
        }
        // 径向衰减（中心 1 → 边缘 0）× 距离平方衰减
        const radial = (cosA - cosHalf) / oneMinusCos;
        const decay = 1 / (1 + 0.15 * d2);
        const c = intensity * radial * decay;
        if (c > 0.003) grid[idx] = c;
      }
    }
  }

  /** 线段 (a→b) 是否与任一菇架层板 AABB 相交（slab 法） */
  private segmentBlocked(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
  ): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    for (const b of this.boxes) {
      let t0 = 0, t1 = 1;
      let ok = true;
      for (let axis = 0; axis < 3; axis++) {
        const a = axis === 0 ? ax : axis === 1 ? ay : az;
        const d = axis === 0 ? dx : axis === 1 ? dy : dz;
        const mn = b.min[axis], mx = b.max[axis];
        if (Math.abs(d) < 1e-9) {
          if (a < mn || a > mx) { ok = false; break; }
        } else {
          let ta = (mn - a) / d;
          let tb = (mx - a) / d;
          if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
          if (ta > t0) t0 = ta;
          if (tb < t1) t1 = tb;
          if (t0 > t1) { ok = false; break; }
        }
      }
      if (ok) return true;
    }
    return false;
  }

  private rebuildOccl() {
    this.occl.fill(0);
    for (const blk of this.blocked.values()) {
      for (let k = 0; k < this.occl.length; k++) {
        if (blk[k]) this.occl[k] = 1;
      }
    }
  }

  /** 全量重算（喷头增删、遮挡开关切换时调用） */
  recomputeAll(nozzles: NozzleSpec[]): Record<number, NozzleStats> {
    this.total.fill(0);
    const alive = new Set(nozzles.map((n) => n.id));
    for (const id of [...this.contrib.keys()]) {
      if (!alive.has(id)) {
        this.contrib.delete(id);
        this.blocked.delete(id);
      }
    }
    for (const n of nozzles) {
      const g = new Float32Array(this.total.length);
      const b = new Uint8Array(this.total.length);
      this.computeInto(n, g, b);
      this.contrib.set(n.id, g);
      this.blocked.set(n.id, b);
      for (let k = 0; k < this.total.length; k++) this.total[k] += g[k];
    }
    this.rebuildOccl();
    return this.buildStats(nozzles);
  }

  /** 增量更新：只重算一个喷头的贡献并合并差值 */
  updateNozzle(n: NozzleSpec, nozzles: NozzleSpec[]): Record<number, NozzleStats> {
    const g = new Float32Array(this.total.length);
    const b = new Uint8Array(this.total.length);
    this.computeInto(n, g, b);
    const old = this.contrib.get(n.id);
    if (old) {
      for (let k = 0; k < this.total.length; k++) this.total[k] += g[k] - old[k];
    } else {
      for (let k = 0; k < this.total.length; k++) this.total[k] += g[k];
    }
    this.contrib.set(n.id, g);
    this.blocked.set(n.id, b);
    this.rebuildOccl();
    return this.buildStats(nozzles);
  }

  /** 由当前各喷头栅格汇总统计（覆盖半径 / 重叠次数）；入参先快照为普通值 */
  private buildStats(nozzles: NozzleSpec[]): Record<number, NozzleStats> {
    const ids: number[] = [];
    const px: number[] = [];
    const pz: number[] = [];
    for (const n of nozzles) {
      ids.push(n.id);
      px.push(n.x);
      pz.push(n.z);
    }
    const count = ids.length;
    const grids = ids.map((id) => this.contrib.get(id));
    const radius = new Float32Array(count);
    const cells = new Int32Array(count);
    const overlapCells = new Int32Array(count);
    const partners: Set<number>[] = ids.map(() => new Set<number>());
    const coverIdx: number[] = [];
    const xs = this.xs, zs = this.zs, w = this.w, h = this.h;

    for (let j = 0; j < h; j++) {
      const cz = zs[j];
      const row = j * w;
      for (let i = 0; i < w; i++) {
        const idx = row + i;
        coverIdx.length = 0;
        for (let s = 0; s < count; s++) {
          const g = grids[s];
          if (g && g[idx] > COVER_EPS) coverIdx.push(s);
        }
        if (coverIdx.length === 0) continue;
        const cx = xs[i];
        for (const s of coverIdx) {
          cells[s]++;
          const ddx = cx - px[s];
          const ddz = cz - pz[s];
          const r = Math.sqrt(ddx * ddx + ddz * ddz);
          if (r > radius[s]) radius[s] = r;
        }
        if (coverIdx.length > 1) {
          for (const s of coverIdx) {
            overlapCells[s]++;
            for (const o of coverIdx) if (o !== s) partners[s].add(ids[o]);
          }
        }
      }
    }

    const stats: Record<number, NozzleStats> = {};
    for (let s = 0; s < ids.length; s++) {
      stats[ids[s]] = {
        radius: radius[s],
        cells: cells[s],
        overlapCells: overlapCells[s],
        overlapCount: partners[s].size,
      };
    }
    return stats;
  }

  /** 全局指标：覆盖率与过饱和栅格数 */
  globalStats(threshold: number) {
    let cover = 0, sat = 0;
    for (let k = 0; k < this.total.length; k++) {
      const v = this.total[k];
      if (v > COVER_EPS) cover++;
      if (v > threshold) sat++;
    }
    return { coverage: cover / this.total.length, saturated: sat };
  }
}
