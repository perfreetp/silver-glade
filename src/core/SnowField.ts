import * as THREE from 'three';
import { SNOW_GRID, TERRAIN } from './constants';
import { clamp } from './mathUtils';

/**
 * 坡面积雪高度场（模块三的堆积层）。
 *
 * - 一块 NX×NZ 的 R 通道浮点 DataTexture 存厚度（米），CPU 写入、GPU 顶点/片元着色器采样；
 * - 地形顶点着色器按双线性插值抬高顶点实现"高度表现"，片元着色器把厚度映射成色带表现"颜色表现"；
 * - 沉积采用渐近饱和模型 depth += rate*(1-depth/max)，饱和后不再增长 —— 避免无限累积；
 * - 粒子落地后生命结束、转入本高度场，即"动态雪粒 -> 静态积雪"的转换点。
 */
export class SnowField {
  readonly nx = SNOW_GRID.NX;
  readonly nz = SNOW_GRID.NZ;
  readonly texture: THREE.DataTexture;
  private depths: Float32Array;
  private dirty = true;

  constructor() {
    this.depths = new Float32Array(this.nx * this.nz);
    this.texture = new THREE.DataTexture(
      this.depths,
      this.nx,
      this.nz,
      THREE.RedFormat,
      THREE.FloatType,
    );
    // 全部采样在着色器里用 texelFetch 手动双线性，故用 Nearest 避免浮点线性过滤扩展依赖
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /** 世界坐标 -> 纹理 UV（地形平面几何范围 x∈[-W/2,W/2], z∈[-L/2,L/2]） */
  worldToUV(x: number, z: number, out = new THREE.Vector2()): THREE.Vector2 {
    out.set(x / TERRAIN.WIDTH + 0.5, z / TERRAIN.LENGTH + 0.5);
    return out;
  }

  inBounds(x: number, z: number): boolean {
    return Math.abs(x) <= TERRAIN.WIDTH / 2 && Math.abs(z) <= TERRAIN.LENGTH / 2;
  }

  /**
   * 在 (x,z) 处沉积一份雪量，按溅射半径分摊到邻近 4 个网格单元。
   * @param amount 本次沉积的"雪量单位"
   */
  deposit(x: number, z: number, amount: number, spread = 1.1): void {
    if (!this.inBounds(x, z)) return;
    const fx = (x / TERRAIN.WIDTH + 0.5) * this.nx - 0.5;
    const fz = (z / TERRAIN.LENGTH + 0.5) * this.nz - 0.5;
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fz);
    const tx = fx - i0;
    const tz = fz - j0;

    const weights: Array<[number, number, number]> = [
      [i0, j0, (1 - tx) * (1 - tz)],
      [i0 + 1, j0, tx * (1 - tz)],
      [i0, j0 + 1, (1 - tx) * tz],
      [i0 + 1, j0 + 1, tx * tz],
    ];

    for (const [i, j, w] of weights) {
      if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
      const idx = j * this.nx + i;
      const d = this.depths[idx];
      // 距离衰减，模拟落点溅射
      const falloff = 1 - 0.35 * Math.min(1, Math.abs(i - fx) + Math.abs(j - fz)) / spread;
      const next = d + amount * w * falloff * SNOW_GRID.DEPOSIT_RATE * 10;
      this.depths[idx] = clamp(next, 0, SNOW_GRID.MAX_DEPTH);
    }
    this.dirty = true;
  }

  /** 查询某处积雪厚度（双线性），供粒子碰撞高度使用 —— 保证雪粒落在积雪表面而非基岩 */
  sampleDepth(x: number, z: number): number {
    const fx = (x / TERRAIN.WIDTH + 0.5) * this.nx - 0.5;
    const fz = (z / TERRAIN.LENGTH + 0.5) * this.nz - 0.5;
    const i0 = clamp(Math.floor(fx), 0, this.nx - 1);
    const j0 = clamp(Math.floor(fz), 0, this.nz - 1);
    const i1 = Math.min(i0 + 1, this.nx - 1);
    const j1 = Math.min(j0 + 1, this.nz - 1);
    const tx = fx - i0;
    const tz = fz - j0;
    const a = this.depths[j0 * this.nx + i0] * (1 - tx) + this.depths[j0 * this.nx + i1] * tx;
    const b = this.depths[j1 * this.nx + i0] * (1 - tx) + this.depths[j1 * this.nx + i1] * tx;
    return a * (1 - tz) + b * tz;
  }

  /** 每帧把高度场上传 GPU（仅在有变化时） */
  flush(): void {
    if (!this.dirty) return;
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  reset(): void {
    this.depths.fill(0);
    this.dirty = true;
    this.flush();
  }

  /** 统计覆盖率与平均厚度（面板读数） */
  stats(): { coverage: number; avgDepth: number } {
    let covered = 0;
    let sum = 0;
    for (let i = 0; i < this.depths.length; i++) {
      const d = this.depths[i];
      if (d > 0.02) covered++;
      sum += d;
    }
    return {
      coverage: (covered / this.depths.length) * 100,
      avgDepth: sum / this.depths.length,
    };
  }
}
