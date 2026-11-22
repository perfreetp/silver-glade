import { CellType, CONCENTRATION_MAX } from './types';

export interface KernelParams {
  size: number;
  /** 环境倍率（温度+湿度）作用在扩散系数上 */
  envFactor: number;
  /** 基础扩散系数（无量纲，每步） */
  baseDiffusivity: number;
  /** 生长/源注入系数 */
  growthRate: number;
  /** 气孔吸收系数 0~1（Dirichlet 近似） */
  holeAbsorption: number;
  /** 基质饱和浓度（Float32 场的上限） */
  saturation: number;
}

/**
 * 单步扩散更新（行带分区版本）。
 *
 * 域被水平切成多个行带，每个 worker 处理 [rowStart, rowEnd)。
 * 边界处理差异：
 *  - 菌包外缘（Outside 邻格）：零通量反射，跳过该方向通量 → 菌丝在边缘堆积；
 *  - 中心气孔（Hole 邻格）：吸收边界，按比例向气孔流失并在气孔格清零 → 菌丝到此消亡。
 *
 * 标准显式 5 点格式：
 *   c' = c + D·(cUp+cDown+cLeft+cRight - 4c) + G·c·(1 - c/csat)
 * 稳定性要求 D ≤ 0.25（envFactor 放大后仍需满足，见下方裁剪）。
 */
export function stepDiffusion(
  cur: Float32Array,
  nxt: Float32Array,
  cellType: Uint8Array,
  p: KernelParams,
  rowStart: number,
  rowEnd: number,
): void {
  const N = p.size;
  const D = Math.min(0.24, p.baseDiffusivity * p.envFactor);
  const G = p.growthRate * Math.sqrt(p.envFactor);
  const absorb = p.holeAbsorption;
  const csat = p.saturation;

  for (let y = rowStart; y < rowEnd; y++) {
    const rowBase = y * N;
    for (let x = 0; x < N; x++) {
      const i = rowBase + x;
      const t = cellType[i]!;

      if (t === CellType.Outside) {
        nxt[i] = 0;
        continue;
      }
      if (t === CellType.Hole) {
        // 气孔持续清零（吸收边界）
        nxt[i] = 0;
        continue;
      }

      const c = cur[i]!;
      let lap = 0;
      let sink = 0;

      // 上
      if (y > 0) {
        const j = i - N;
        const tj = cellType[j]!;
        if (tj === CellType.Substrate) lap += cur[j]! - c;
        else if (tj === CellType.Hole) sink += absorb * c;
        // Outside：零通量，无贡献
      }
      // 下
      if (y < N - 1) {
        const j = i + N;
        const tj = cellType[j]!;
        if (tj === CellType.Substrate) lap += cur[j]! - c;
        else if (tj === CellType.Hole) sink += absorb * c;
      }
      // 左
      if (x > 0) {
        const j = i - 1;
        const tj = cellType[j]!;
        if (tj === CellType.Substrate) lap += cur[j]! - c;
        else if (tj === CellType.Hole) sink += absorb * c;
      }
      // 右
      if (x < N - 1) {
        const j = i + 1;
        const tj = cellType[j]!;
        if (tj === CellType.Substrate) lap += cur[j]! - c;
        else if (tj === CellType.Hole) sink += absorb * c;
      }

      // 逻辑斯蒂生长项：接种区附近浓度低时自我增殖，饱和后停止
      const growth = G * c * (1 - c / csat);
      let v = c + D * lap + growth - sink;
      if (v < 0) v = 0;
      else if (v > csat) v = csat;
      nxt[i] = v;
    }
  }
}

/**
 * 接种点源注入：在每个接种点周围小圆盘内写入初始浓度。
 * 主线程在初始化时调用一次即可（在共享场上直接写）。
 */
export function seedInoculation(
  field: Float32Array,
  cellType: Uint8Array,
  size: number,
  points: ReadonlyArray<{ x: number; y: number }>,
  radius: number,
  concentration: number,
): void {
  const r2 = radius * radius;
  for (const pt of points) {
    const cx = Math.round(pt.x);
    const cy = Math.round(pt.y);
    for (let dy = -radius; dy <= radius; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= size) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = cx + dx;
        if (x < 0 || x >= size) continue;
        const i = y * size + x;
        if (cellType[i] === CellType.Substrate) {
          field[i] = Math.max(field[i]!, concentration);
        }
      }
    }
  }
}

/** Float32 场 → Uint8 量化（行带版本，worker 回传快照用） */
export function quantizeBand(
  field: Float32Array,
  out: Uint8Array,
  rowStart: number,
  rowEnd: number,
  size: number,
  saturation: number,
): void {
  const scale = 255 / saturation;
  const start = rowStart * size;
  const end = rowEnd * size;
  for (let i = start; i < end; i++) {
    const v = Math.round(field[i]! * scale);
    out[i] = v <= 0 ? 0 : v >= CONCENTRATION_MAX ? CONCENTRATION_MAX : v;
  }
}
