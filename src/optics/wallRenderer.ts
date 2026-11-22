import type { ProjectionConfig } from '../types';
import { WALL_HEIGHT, WALL_TEX_H, WALL_TEX_W, WALL_WIDTH } from './constants';

const N = WALL_TEX_W * WALL_TEX_H;

/** 预计算每列/行纹素的世界坐标，热路径零乘除 */
const WORLD_X_LUT = new Float32Array(WALL_TEX_W);
for (let x = 0; x < WALL_TEX_W; x++) {
  WORLD_X_LUT[x] = ((x + 0.5) / WALL_TEX_W) * WALL_WIDTH - WALL_WIDTH / 2;
}
const WORLD_Y_LUT = new Float32Array(WALL_TEX_H);
for (let y = 0; y < WALL_TEX_H; y++) {
  WORLD_Y_LUT[y] = WALL_HEIGHT / 2 - ((y + 0.5) / WALL_TEX_H) * WALL_HEIGHT;
}

/** isolux 伪彩控制点：蓝 -> 青 -> 绿 -> 黄 -> 红 */
const ISOLUX_STOPS: [number, number, number][] = [
  [8, 20, 60],
  [0, 130, 200],
  [40, 200, 120],
  [245, 210, 60],
  [235, 70, 45],
];

/** 256 级预打包 RGBA 查找表（小端 Uint32 ABGR），热路径一查表一写 */
const ISOLUX_LUT = buildPackedLut(false);
const GRAY_LUT = buildPackedLut(true);

/** gamma 提亮查找表：输入归一化照度的 8bit 量化值 → gamma 校正后的量化值，避免逐像素 Math.pow */
const GAMMA_LUT: Uint8Array = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = Math.min(255, Math.round(255 * Math.pow(i / 255, 0.7)));
  return t;
})();

function buildPackedLut(gray: boolean): Uint32Array {
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r: number, g: number, b: number;
    if (gray) {
      r = g = b = i;
    } else {
      const x = (i / 255) * 4;
      const k = Math.min(3, Math.floor(x));
      const f = x - k;
      const c0 = ISOLUX_STOPS[k];
      const c1 = ISOLUX_STOPS[k + 1];
      r = c0[0] + (c1[0] - c0[0]) * f;
      g = c0[1] + (c1[1] - c0[1]) * f;
      b = c0[2] + (c1[2] - c0[2]) * f;
    }
    lut[i] = (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
  }
  return lut;
}

/**
 * 快速色调映射：归一化 log1p 的纯多项式近似。
 * 输入 e 已按 log1p(peak) 归一，实际值远小于 1，
 * 4 项泰勒展开相对误差 < 0.1%，把每帧 30 万次 transcendental 调用降为乘加。
 * 截止线/过渡带的物理判定不经过本函数，精度损失不影响光型结论。
 */
function fastNormalizedLog(e: number): number {
  if (e <= 0.25) return e * (1 - e * (0.5 - e * (0.3333333 - e * 0.25)));
  return Math.log1p(e);
}

/**
 * 截止线遮罩（供测试与外部复用）。
 * elbow 开启时右半屏截止线按 15° 抬升（GB/ECE 近光折线）；
 * 过渡带用 smoothstep 在 ±g/2 内连续解析过渡，任何分辨率下都无条带。
 */
export function cutoffMaskAt(pxX: number, pxY: number, cfg: ProjectionConfig): number {
  const worldX = WORLD_X_LUT[pxX];
  const worldY = WORLD_Y_LUT[pxY];
  let lineY = cfg.cutoffY;
  if (cfg.elbow && worldX > 0) lineY += Math.tan((15 * Math.PI) / 180) * worldX;
  const half = cfg.gradientWidth / 2;
  const d = lineY - worldY;
  if (d >= half) return 1;
  if (d <= -half) return 0;
  const t = (d + half) / (2 * half);
  return t * t * (3 - 2 * t);
}

export interface RenderOptions {
  drawContours?: boolean;
  drawCutoffLine?: boolean;
  /** 对照度场做能量守恒的平滑（默认开），消除低采样下的颗粒噪声 */
  smooth?: boolean;
}

/**
 * 墙面渲染器：持有可复用的 ImageData / 照度 / 模糊缓冲，
 * 拖动截止线期间零大块分配、无 GC 尖峰，稳态合成在个位数毫秒。
 */
export class WallRenderer {
  readonly image: ImageData;
  private readonly packed: Uint32Array;
  private readonly field: Float32Array;
  private readonly blurA: Float32Array;
  private readonly blurB: Float32Array;
  /** 模糊结果按源数组身份缓存：截止线拖动期间照度场不变，可完全跳过模糊 */
  private lastBlurSrc: Float32Array | null = null;
  private blurred: Float32Array | null = null;
  /** 直方图缓冲复用，避免每帧分配；参考白同样按照度场身份缓存 */
  private readonly histBuf = new Uint32Array(2048);
  private lastRefSrc: Float32Array | null = null;
  private cachedReference = 0;

  constructor() {
    this.image = new ImageData(WALL_TEX_W, WALL_TEX_H);
    this.packed = new Uint32Array(this.image.data.buffer);
    this.field = new Float32Array(N);
    this.blurA = new Float32Array(N);
    this.blurB = new Float32Array(N);
  }

  /**
   * 渲染一帧。irradiance 为 tracer 输出的原始照度，
   * 流程：可选高斯平滑（保能量）→ 截止线遮罩 → 多项式 tonemap → LUT 写色 → 等值线/截止线叠加。
   */
  render(
    irradiance: Float32Array,
    peak: number,
    cfg: ProjectionConfig,
    opts: RenderOptions = {},
  ): ImageData {
    const smooth = opts.smooth !== false;
    const src = smooth ? this.smoothedIrradiance(irradiance) : irradiance;

    // 以 99.5 百分位照度作为参考白，避免单个蒙特卡洛热点把全场压暗。
    // 参考白只依赖照度场：按源数组身份缓存，拖动截止线时零重算。
    let reference: number;
    if (this.lastRefSrc === src) {
      reference = this.cachedReference;
    } else {
      reference = this.percentile(src, 0.995) || peak;
      this.lastRefSrc = src;
      this.cachedReference = reference;
    }
    const invLogPeak = reference > 0 ? 1 / Math.log1p(reference * cfg.exposure) : 0;
    const slope = Math.tan((15 * Math.PI) / 180);
    const useContours = opts.drawContours !== false && cfg.contours;
    const lut = cfg.colormap === 'gray' ? GRAY_LUT : ISOLUX_LUT;
    const exposure = cfg.exposure;
    const elbow = cfg.elbow;
    const cutoffY = cfg.cutoffY;
    const halfGrad = cfg.gradientWidth / 2;
    const invGrad = 1 / (2 * halfGrad);
    const field = useContours ? this.field : null;

    for (let y = 0; y < WALL_TEX_H; y++) {
      const worldY = WORLD_Y_LUT[y];
      const rowBase = y * WALL_TEX_W;
      for (let x = 0; x < WALL_TEX_W; x++) {
        const idx = rowBase + x;
        const worldX = WORLD_X_LUT[x];
        let lineY = cutoffY;
        if (elbow && worldX > 0) lineY += slope * worldX;

        const d = lineY - worldY;
        let mask: number;
        if (d >= halfGrad) mask = 1;
        else if (d <= -halfGrad) mask = 0;
        else {
          const t = (d + halfGrad) * invGrad;
          mask = t * t * (3 - 2 * t);
        }

        const e = src[idx] * mask * exposure;
        const vLin = peak > 0 ? fastNormalizedLog(e) * invLogPeak : 0;
        // gamma 提亮暗部（显示映射，不改物理照度）：让填充场的中低照度可见，
        // 避免大量有效能量被压成近黑背景、只剩孤立亮点。走 LUT，无逐像素 Math.pow。
        let linQ = (vLin * 255) | 0;
        linQ = linQ < 0 ? 0 : linQ > 255 ? 255 : linQ;
        const q = GAMMA_LUT[linQ];
        const v = q / 255;
        if (field) field[idx] = v;
        this.packed[idx] = lut[q];
      }
    }

    if (field) this.drawIsoluxContours(field);
    if (opts.drawCutoffLine !== false) this.drawCutoffLine(cfg, slope);
    return this.image;
  }

  /** 照度场身份未变时复用上次模糊结果（截止线拖动走这条零模糊路径） */
  private smoothedIrradiance(irradiance: Float32Array): Float32Array {
    if (this.lastBlurSrc === irradiance && this.blurred) return this.blurred;
    const out = this.gaussianBlur(irradiance);
    this.lastBlurSrc = irradiance;
    this.blurred = out;
    return out;
  }

  /**
   * 求照度场的 q 分位（q∈(0,1)）。基于最大值归一 + 2048 桶直方图，O(n) 无排序，
   * 用于稳健的参考白估计（抗单点热点）。
   */
  private percentile(src: Float32Array, q: number): number {
    let max = 0;
    for (let i = 0; i < src.length; i++) if (src[i] > max) max = src[i];
    if (max <= 0) return 0;
    const hist = this.histBuf;
    hist.fill(0);
    const BINS = hist.length;
    const scale = (BINS - 1) / max;
    let nonzero = 0;
    for (let i = 0; i < src.length; i++) {
      if (src[i] > 0) {
        hist[Math.min(BINS - 1, (src[i] * scale) | 0)]++;
        nonzero++;
      }
    }
    if (nonzero === 0) return 0;
    const target = nonzero * q;
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      acc += hist[b];
      if (acc >= target) return b / scale;
    }
    return max;
  }

  /**
   * 可分离 5-tap box 平滑（半径 2，权重归一化）。
   * tracer 已用 5×5 高斯 splat 让采样落点重叠，这里再做一轮轻量平滑
   * 消除残余颗粒；总能量严格守恒，且作用于截止线遮罩之前，不削弱截止线锐度。
   */
  private static readonly BLUR_ITERATIONS = 2;
  private static readonly BLUR_RADIUS = 2;

  private gaussianBlur(src: Float32Array): Float32Array {
    const a = this.blurA;
    const b = this.blurB;
    const W = WALL_TEX_W;
    const H = WALL_TEX_H;
    const R = WallRenderer.BLUR_RADIUS;
    const norm = 1 / (2 * R + 1);
    let input = src;
    for (let iter = 0; iter < WallRenderer.BLUR_ITERATIONS; iter++) {
      // 水平 input → a，滑动窗口：每像素 O(1)
      for (let y = 0; y < H; y++) {
        const row = y * W;
        let sum = 0;
        for (let k = 0; k <= R; k++) sum += input[row + k]; // 初始窗 [0, R]（左侧越界按钳制计入 0 号）
        sum += R * input[row];
        for (let x = 0; x < W; x++) {
          a[row + x] = sum * norm;
          const xOut = x - R < 0 ? 0 : x - R;
          const xIn = x + R + 1 >= W ? W - 1 : x + R + 1;
          sum += input[row + xIn] - input[row + xOut];
        }
      }
      // 垂直 a → b，滑动窗口
      for (let x = 0; x < W; x++) {
        let sum = R * a[x];
        for (let k = 0; k <= R; k++) sum += a[k * W + x];
        for (let y = 0; y < H; y++) {
          b[y * W + x] = sum * norm;
          const yOut = y - R < 0 ? 0 : y - R;
          const yIn = y + R + 1 >= H ? H - 1 : y + R + 1;
          sum += a[yIn * W + x] - a[yOut * W + x];
        }
      }
      input = b;
    }
    return b;
  }

  /** 等照度线：归一化照度场上的零交叉检测，逐像素判定，天然抗条带 */
  private drawIsoluxContours(field: Float32Array) {
    const levels = [0.15, 0.3, 0.5, 0.7, 0.88];
    const data = this.image.data;
    for (let y = 1; y < WALL_TEX_H - 1; y++) {
      for (let x = 1; x < WALL_TEX_W - 1; x++) {
        const i = y * WALL_TEX_W + x;
        for (let li = 0; li < levels.length; li++) {
          const L = levels[li];
          const d1 = field[i] - L;
          const d2 = field[i + 1] - L;
          const d3 = field[i + WALL_TEX_W] - L;
          if ((d1 > 0) !== (d2 > 0) || (d1 > 0) !== (d3 > 0)) {
            const o = i * 4;
            data[o] = data[o] * 0.25;
            data[o + 1] = data[o + 1] * 0.25;
            data[o + 2] = Math.min(255, data[o + 2] * 0.25 + 60);
            break;
          }
        }
      }
    }
  }

  /** 截止线叠加：亮青色折线标记（仅可视化，不参与照度统计） */
  private drawCutoffLine(cfg: ProjectionConfig, slope: number) {
    const data = this.image.data;
    const put = (px: number, py: number) => {
      if (px < 1 || py < 1 || px >= WALL_TEX_W - 1 || py >= WALL_TEX_H - 1) return;
      const i = (py * WALL_TEX_W + px) * 4;
      data[i] = 120;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    };
    for (let px = 0; px < WALL_TEX_W; px++) {
      const worldX = WORLD_X_LUT[px];
      let lineY = cfg.cutoffY;
      if (cfg.elbow && worldX > 0) lineY += slope * worldX;
      const py = Math.round((WALL_HEIGHT / 2 - lineY) / WALL_HEIGHT * WALL_TEX_H - 0.5);
      put(px, py);
      put(px, py + 1);
    }
  }
}

export function pixelYToWorldY(py: number): number {
  return WALL_HEIGHT / 2 - (py / WALL_TEX_H) * WALL_HEIGHT;
}
export function worldYToPixelY(worldY: number): number {
  return (WALL_HEIGHT / 2 - worldY) / WALL_HEIGHT * WALL_TEX_H - 0.5;
}
