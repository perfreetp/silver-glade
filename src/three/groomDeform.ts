import { BLADE_SPECS, SNOW_SPECS, TERRAIN_SEGMENTS, WORLD_SIZE } from './constants';
import type { BladeAngle, PathSample, SnowCondition, ZoneId } from '../types';

/**
 * 刀纹顶点形变器。
 *
 * 设计要点：
 * - 地形为规则网格，世界 (x,z) 可直接换算到 (col,row)，标记压雪区域无需遍历全网格；
 * - 每个被压过的顶点保存作业瞬间的刀头/雪质参数与弧长相位，复压也不会丢失旧道形；
 * - 位移 = 沟底下压 + 横向棱纹（相位取路径弧长，拐弯自动旋转且连续）+ 边缘碎雪隆起；
 * - 高频碎雪细节走法线贴图（见 terrainMaterial），这里只做低频顶点位移。
 */
export class GroomDeform {
  readonly count: number;
  readonly seg = TERRAIN_SEGMENTS;
  readonly cell = WORLD_SIZE / TERRAIN_SEGMENTS;
  readonly min = -WORLD_SIZE / 2;

  /** 原始地形高度 */
  readonly baseY: Float32Array;
  /** 0 未压 / 1 已压 */
  readonly state: Uint8Array;
  /** 弧长相位（米） */
  readonly phase: Float32Array;
  /** 作业行进方向 */
  readonly hx: Float32Array;
  readonly hz: Float32Array;
  /** 横向偏移（米，带符号） */
  readonly lat: Float32Array;
  /** 作业瞬间固化的刀头/雪质参数 */
  readonly vHalfW: Float32Array;
  readonly vDepth: Float32Array;
  readonly vSpacing: Float32Array;
  readonly vSharp: Float32Array;
  readonly vCrumble: Float32Array;

  /** 待重算顶点队列（用 Set 去重） */
  readonly dirty = new Set<number>();
  /** 待 refit 的三角形索引 */
  readonly dirtyTris = new Set<number>();
  /** 已压顶点数（用于进度统计） */
  groomedCount = 0;

  constructor(baseY: Float32Array) {
    this.count = baseY.length;
    this.baseY = baseY;
    const n = this.count;
    this.state = new Uint8Array(n);
    this.phase = new Float32Array(n);
    this.hx = new Float32Array(n);
    this.hz = new Float32Array(n);
    this.lat = new Float32Array(n);
    this.vHalfW = new Float32Array(n);
    this.vDepth = new Float32Array(n);
    this.vSpacing = new Float32Array(n);
    this.vSharp = new Float32Array(n);
    this.vCrumble = new Float32Array(n);
  }

  private vertexIndex(col: number, row: number) {
    return row * (this.seg + 1) + col;
  }

  private zoneOf(col: number, row: number, zoneGrid: number): ZoneId {
    return {
      ix: Math.min(zoneGrid - 1, Math.floor((col / this.seg) * zoneGrid)),
      iz: Math.min(zoneGrid - 1, Math.floor((row / this.seg) * zoneGrid)),
    };
  }

  private static zoneActive(active: Set<ZoneId>, z: ZoneId): boolean {
    for (const q of active) if (q.ix === z.ix && q.iz === z.iz) return true;
    return false;
  }

  /** 确定性碎雪噪声：同一点位每次结果一致，避免逐帧抖动 */
  private static hash(x: number, z: number): number {
    const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  /**
   * 压雪机推进到一个样本点：标记刀头覆盖带内的顶点并入队。
   * 返回本样本新压到的顶点数。
   */
  markSample(sample: PathSample, blade: BladeAngle, snow: SnowCondition, activeZones: Set<ZoneId>, zoneGrid: number): number {
    const spec = BLADE_SPECS[blade];
    const snowSpec = SNOW_SPECS[snow];
    const hw = spec.width / 2;
    const reach = hw + this.cell;

    const c0 = Math.max(0, Math.floor((sample.x - this.min - reach) / this.cell));
    const c1 = Math.min(this.seg, Math.ceil((sample.x - this.min + reach) / this.cell));
    const r0 = Math.max(0, Math.floor((sample.z - this.min - reach) / this.cell));
    const r1 = Math.min(this.seg, Math.ceil((sample.z - this.min + reach) / this.cell));

    let newly = 0;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (!GroomDeform.zoneActive(activeZones, this.zoneOf(col, row, zoneGrid))) continue;
        const wx = this.min + col * this.cell;
        const wz = this.min + row * this.cell;
        const dx = wx - sample.x;
        const dz = wz - sample.z;
        // 投影到行进坐标系：纵向 lon、横向 lat
        const lon = dx * sample.hx + dz * sample.hz;
        if (Math.abs(lon) > this.cell * 1.5) continue;
        const lat = -dx * sample.hz + dz * sample.hx;
        if (Math.abs(lat) > hw) continue;

        const idx = this.vertexIndex(col, row);
        if (this.state[idx] === 0) {
          this.state[idx] = 1;
          this.groomedCount++;
          newly++;
        }
        this.phase[idx] = sample.s;
        this.hx[idx] = sample.hx;
        this.hz[idx] = sample.hz;
        this.lat[idx] = lat;
        this.vHalfW[idx] = hw;
        this.vDepth[idx] = spec.depth;
        this.vSpacing[idx] = spec.ridgeSpacing;
        this.vSharp[idx] = snowSpec.ridgeSharpness;
        this.vCrumble[idx] = snowSpec.crumble;
        this.dirty.add(idx);
        this.collectTris(col, row);
      }
    }
    return newly;
  }

  /** 网格顶点 (col,row) 相邻三角形入队（规则 PlaneGeometry 索引顺序） */
  private collectTris(col: number, row: number) {
    const seg = this.seg;
    if (row < seg && col < seg) {
      const cellIdx = row * seg + col;
      this.dirtyTris.add(cellIdx * 2);
      this.dirtyTris.add(cellIdx * 2 + 1);
    }
    if (row > 0 && col > 0) {
      const cellIdx = (row - 1) * seg + (col - 1);
      this.dirtyTris.add(cellIdx * 2);
      this.dirtyTris.add(cellIdx * 2 + 1);
    }
  }

  /** 单个已压顶点的位移量（沟底 + 棱纹 + 边缘碎雪） */
  displacement(idx: number): number {
    const depth = this.vDepth[idx];
    const lat = this.lat[idx];
    const spacing = this.vSpacing[idx];
    const sharp = this.vSharp[idx];
    const crumble = this.vCrumble[idx];

    // 刀头有效半宽（标记时按档位固化）
    const bladeHalf = this.vHalfW[idx];
    const band = 1 - smoothstep(bladeHalf * 0.65, bladeHalf, Math.abs(lat));

    // 1) 沟底下压
    let dy = -depth * band;

    // 2) 横向棱纹：弧长相位 -> 拐弯处方向旋转、相位连续
    const r = Math.cos((2 * Math.PI * this.phase[idx]) / spacing);
    const shaped = Math.sign(r) * Math.pow(Math.abs(r), sharp);
    dy += depth * 0.28 * shaped * band;

    // 3) 边缘碎雪隆起（湿雪更厚更结块）：脊心略靠刀头内侧，宽度适配格网分辨率
    const edgeCenter = bladeHalf - 0.35;
    const edge = Math.exp(-((Math.abs(lat) - edgeCenter) ** 2) / (2 * 0.8 * 0.8));
    const grain = 0.6 + 0.4 * GroomDeform.hash(this.phase[idx], lat);
    dy += depth * crumble * 0.9 * edge * grain;

    return dy;
  }

  /**
   * 每帧消费预算内的脏顶点：写回高度、重算法线、产出几何体上传范围。
   * 返回是否还有剩余工作。
   */
  flushBudget(position: Float32Array, normal: Float32Array, budget: number): boolean {
    let processed = 0;
    const stride = this.seg + 1;
    for (const idx of this.dirty) {
      this.writeVertex(idx, position, normal, stride);
      this.dirty.delete(idx);
      processed++;
      if (processed >= budget) break;
    }

    if (this.dirty.size === 0) {
      // 队列清空：边界顶点法线受邻居影响，再补一轮邻域法线
      for (const idx of this.lastBatch) this.recomputeNormal(idx, position, normal, stride);
      this.lastBatch.length = 0;
    }
    return this.dirty.size > 0;
  }

  private lastBatch: number[] = [];

  private writeVertex(idx: number, position: Float32Array, normal: Float32Array, stride: number) {
    const dy = this.state[idx] ? this.displacement(idx) : 0;
    position[idx * 3 + 1] = this.baseY[idx] + dy;
    this.recomputeNormal(idx, position, normal, stride);
    this.lastBatch.push(idx);
    if (this.lastBatch.length > 8000) this.lastBatch.shift();
  }

  /** 用四邻域 displaced 高度重算法线（网格拓扑规则，代价 O(1)） */
  private recomputeNormal(idx: number, position: Float32Array, normal: Float32Array, stride: number) {
    const col = idx % stride;
    const row = (idx / stride) | 0;
    const l = col > 0 ? idx - 1 : idx;
    const r = col < this.seg ? idx + 1 : idx;
    const d = row > 0 ? idx - stride : idx;
    const u = row < this.seg ? idx + stride : idx;
    const hx = position[r * 3 + 1] - position[l * 3 + 1];
    const hz = position[u * 3 + 1] - position[d * 3 + 1];
    let nx = hx / (2 * this.cell);
    let ny = 1;
    let nz = hz / (2 * this.cell);
    const inv = 1 / Math.hypot(nx, ny, nz);
    nx *= inv;
    ny *= inv;
    nz *= inv;
    normal[idx * 3] = nx;
    normal[idx * 3 + 1] = ny;
    normal[idx * 3 + 2] = nz;
  }

  /** 立即重置全部刀纹（任务清空/复压归零） */
  resetAll(position: Float32Array, normal: Float32Array) {
    const stride = this.seg + 1;
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === 0) continue;
      this.state[i] = 0;
      position[i * 3 + 1] = this.baseY[i];
      this.dirty.add(i);
    }
    this.groomedCount = 0;
    // 全量法线恢复，一次做完
    for (let i = 0; i < this.count; i++) this.recomputeNormal(i, position, normal, stride);
    this.dirty.clear();
    this.dirtyTris.clear();
    this.lastBatch.length = 0;
  }

  /** 取走并清空待 refit 三角形集合 */
  takeDirtyTris(): Set<number> {
    const out = new Set(this.dirtyTris);
    this.dirtyTris.clear();
    return out;
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
