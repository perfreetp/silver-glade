import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { LedConfig, LensConfig } from '../types';
import {
  IOR_AIR,
  LED_BOARD_Z,
  WALL_HEIGHT,
  WALL_TEX_H,
  WALL_TEX_W,
  WALL_WIDTH,
} from './constants';
import { buildLens } from './lensGeometry';
import { DEG2RAD, makeRng, refract, sampleCone } from './math';

/**
 * 逐光线追踪结果（SoA 风格的输出缓冲，避免每帧产生大量小对象）
 */
export interface TraceStats {
  raysTotal: number;
  raysHitLens: number;
  raysWall: number;
  raysTir: number;
  raysMissed: number;
  traceMs: number;
  lensBuildMs: number;
}

export interface TraceResult {
  /** 墙面累积缓冲，长度 WALL_TEX_W*WALL_TEX_H，浮点照度（未归一化） */
  irradiance: Float32Array;
  peak: number;
  stats: TraceStats;
}

/**
 * LED 出光半锥角。
 * 取 ±16°：在 22mm 间距处对应半径 22·tan16° ≈ 6.3mm 的照明圈，
 * 与透镜数值孔径匹配，约 90% 采样光线进入透镜；
 * 更宽的角度会大量打到透镜外或在边缘产生球差光线，属物理上的无效采样。
 */
const LED_HALF_ANGLE = 16 * DEG2RAD;

// 复用临时对象，避免每帧 GC
const tmpRay = new THREE.Ray();
const tmpDir = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpNormal = new THREE.Vector3();
const tmpRefr = new THREE.Vector3();
const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();

export class OpticsEngine {
  private lensCfg: LensConfig | null = null;
  private bvh: MeshBVH | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private effectiveThickness = 0;
  private sag = 0;
  lensBuildMs = 0;

  get lensInfo() {
    return { effectiveThickness: this.effectiveThickness, sag: this.sag };
  }

  /** 透镜参数变化时重建几何与 BVH（SAH 构建，~万级三角面仍为亚毫秒~毫秒级） */
  ensureLens(lens: LensConfig) {
    if (
      this.bvh &&
      this.lensCfg &&
      this.lensCfg.curvature === lens.curvature &&
      this.lensCfg.thickness === lens.thickness &&
      this.lensCfg.ior === lens.ior
    ) {
      return;
    }
    const t0 = performance.now();
    this.geometry?.dispose();
    const built = buildLens(lens);
    this.geometry = built.geometry;
    this.bvh = built.bvh;
    this.effectiveThickness = built.effectiveThickness;
    this.sag = built.sag;
    this.lensCfg = { ...lens };
    this.lensBuildMs = performance.now() - t0;
  }

  get lensGeometry(): THREE.BufferGeometry | null {
    return this.geometry;
  }

  /**
   * 对所有点亮的 LED 发射采样光线，经透镜两次折射求交，落到墙面累积照度。
   * 每次调用返回全新累积缓冲；调用方负责截止线遮罩与色图映射。
   */
  trace(leds: LedConfig[], raysPerLed: number, wallDistance: number): TraceResult {
    if (!this.bvh) throw new Error('OpticsEngine: 透镜未初始化');
    const bvh = this.bvh;
    const geometry = this.geometry!;
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const index = geometry.getIndex()!;
    const iorGlass = this.lensCfg!.ior;

    const irradiance = new Float32Array(WALL_TEX_W * WALL_TEX_H);
    const stats: TraceStats = {
      raysTotal: 0,
      raysHitLens: 0,
      raysWall: 0,
      raysTir: 0,
      raysMissed: 0,
      traceMs: 0,
      lensBuildMs: this.lensBuildMs,
    };

    const t0 = performance.now();
    const wallZ = wallDistance;

    for (let li = 0; li < leds.length; li++) {
      const led = leds[li];
      if (!led.enabled) continue;

      const origin = new THREE.Vector3(led.x, led.y, LED_BOARD_Z);
      // LED 朝向：先绕 X 俯仰再绕 Y 偏航，基准朝 +z
      tmpEuler.set(led.tiltX * DEG2RAD, led.tiltY * DEG2RAD, 0, 'XYZ');
      tmpQuat.setFromEuler(tmpEuler);
      tmpAxis.set(0, 0, 1).applyQuaternion(tmpQuat);

      // 种子由 LED 槽位决定：拖动截止线等不相关操作下采样图案保持稳定
      const rng = makeRng(0x9e3779b9 ^ (led.id * 2654435761));
      // 每颗 LED 的能量按亮度分配，且按其实际光线数归一化（切换光线密度不改变能量分布形状）
      const energyPerRay = led.brightness / raysPerLed;

      for (let k = 0; k < raysPerLed; k++) {
        stats.raysTotal++;
        sampleCone(rng, tmpAxis, LED_HALF_ANGLE, tmpDir);
        tmpRay.origin.copy(origin);
        tmpRay.direction.copy(tmpDir);

        // ---- 第一次求交：空气 -> 玻璃 ----
        const hit1 = bvh.raycastFirst(tmpRay, THREE.FrontSide, 1e-6, wallZ);
        if (!hit1) {
          stats.raysMissed++;
          continue;
        }
        stats.raysHitLens++;
        this.interpolatedNormal(hit1.faceIndex!, hit1.barycoord!, posAttr, normAttr, index, tmpNormal);

        let dir = refract(tmpRay.direction, tmpNormal, IOR_AIR / iorGlass);
        if (!dir) {
          stats.raysTir++;
          continue;
        }
        tmpRefr.copy(dir);
        tmpRay.origin.copy(hit1.point).addScaledVector(tmpRefr, 1e-5);
        tmpRay.direction.copy(tmpRefr);

        // ---- 第二次求交：玻璃 -> 空气 ----
        const hit2 = bvh.raycastFirst(tmpRay, THREE.FrontSide, 1e-6, wallZ);
        if (!hit2) {
          stats.raysMissed++;
          continue;
        }
        this.interpolatedNormal(hit2.faceIndex!, hit2.barycoord!, posAttr, normAttr, index, tmpNormal);
        dir = refract(tmpRay.direction, tmpNormal, iorGlass / IOR_AIR);
        if (!dir) {
          stats.raysTir++;
          continue;
        }
        tmpRefr.copy(dir);
        tmpRay.origin.copy(hit2.point).addScaledVector(tmpRefr, 1e-5);
        tmpRay.direction.copy(tmpRefr);

        // ---- 与墙面 z = wallZ 求交 ----
        if (tmpRay.direction.z <= 1e-9) {
          stats.raysMissed++;
          continue;
        }
        const tWall = (wallZ - tmpRay.origin.z) / tmpRay.direction.z;
        if (tWall <= 0) {
          stats.raysMissed++;
          continue;
        }
        const wx = tmpRay.origin.x + tmpRay.direction.x * tWall;
        const wy = tmpRay.origin.y + tmpRay.direction.y * tWall;

        // 墙面坐标 -> 纹素（墙面中心对应纹理中心）
        const fx = ((wx + WALL_WIDTH / 2) / WALL_WIDTH) * WALL_TEX_W - 0.5;
        const fy = ((wy + WALL_HEIGHT / 2) / WALL_HEIGHT) * WALL_TEX_H - 0.5;
        if (fx < -1 || fy < -1 || fx >= WALL_TEX_W || fy >= WALL_TEX_H) {
          stats.raysMissed++;
          continue;
        }

        // 高斯 splat（半径 2，5×5 纹素，权重归一化）：模拟单条光线在墙面上的
        // 有限截面，使相邻采样在累积阶段即重叠，从源头消除离散光点与条带；
        // 相比最近邻/2×2，光斑在低采样密度下也保持连续。
        this.gaussianSplat(irradiance, fx, fy, energyPerRay);
        stats.raysWall++;
      }
    }

    let peak = 0;
    for (let i = 0; i < irradiance.length; i++) {
      if (irradiance[i] > peak) peak = irradiance[i];
    }
    stats.traceMs = performance.now() - t0;
    return { irradiance, peak, stats };
  }

  /** 按重心坐标插值顶点法线（平滑着色，避免低面数下的折射折痕） */
  private interpolatedNormal(
    faceIndex: number,
    bary: THREE.Vector3,
    posAttr: THREE.BufferAttribute,
    normAttr: THREE.BufferAttribute,
    index: THREE.BufferAttribute,
    out: THREE.Vector3,
  ) {
    const ia = index.getX(faceIndex * 3);
    const ib = index.getX(faceIndex * 3 + 1);
    const ic = index.getX(faceIndex * 3 + 2);
    out.set(
      normAttr.getX(ia) * bary.x + normAttr.getX(ib) * bary.y + normAttr.getX(ic) * bary.z,
      normAttr.getY(ia) * bary.x + normAttr.getY(ib) * bary.y + normAttr.getY(ic) * bary.z,
      normAttr.getZ(ia) * bary.x + normAttr.getZ(ib) * bary.y + normAttr.getZ(ic) * bary.z,
    ).normalize();
    // 防御：法线属性异常时回退到几何面法线
    if (!Number.isFinite(out.x)) {
      const ax = posAttr.getX(ia), ay = posAttr.getY(ia), az = posAttr.getZ(ia);
      const bx = posAttr.getX(ib), by = posAttr.getY(ib), bz = posAttr.getZ(ib);
      const cx = posAttr.getX(ic), cy = posAttr.getY(ic), cz = posAttr.getZ(ic);
      out
        .set((by - ay) * (cz - az) - (bz - az) * (cy - ay),
             (bz - az) * (cx - ax) - (bx - ax) * (cz - az),
             (bx - ax) * (cy - ay) - (by - ay) * (cx - ax))
        .normalize();
    }
  }

  /** 预归一化的 7×7 高斯核（σ≈1.5），权重和为 1 → 每条光线能量守恒。
   *  配合较高采样密度（默认 512 光线/LED），相邻 splat 在墙面上交叠成连续光场。 */
  private static readonly SPLAT_RADIUS = 3;
  private static readonly SPLAT_KERNEL: Float32Array = (() => {
    const R = OpticsEngine.SPLAT_RADIUS;
    const size = R * 2 + 1;
    const k = new Float32Array(size * size);
    const sigma = 1.5;
    let sum = 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        k[(dy + R) * size + (dx + R)] = w;
        sum += w;
      }
    }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    return k;
  })();

  private gaussianSplat(buf: Float32Array, fx: number, fy: number, energy: number) {
    const R = OpticsEngine.SPLAT_RADIUS;
    const size = R * 2 + 1;
    const cx = Math.round(fx);
    const cy = Math.round(fy);
    const kernel = OpticsEngine.SPLAT_KERNEL;
    for (let dy = -R; dy <= R; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= WALL_TEX_H) continue;
      for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= WALL_TEX_W) continue;
        buf[y * WALL_TEX_W + x] += energy * kernel[(dy + R) * size + (dx + R)];
      }
    }
  }

  /**
   * 对单颗 LED 追踪少量光线，返回折线点组（LED→前表面入射点→出射点→墙面方向延长点），
   * 仅用于 3D 场景的光路可视化，不参与照度累积。
   */
  tracePreviewPaths(led: LedConfig, count: number, wallDistance: number): THREE.Vector3[][] {
    if (!this.bvh) return [];
    const bvh = this.bvh;
    const geometry = this.geometry!;
    const normAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const index = geometry.getIndex()!;
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const iorGlass = this.lensCfg!.ior;

    const origin = new THREE.Vector3(led.x, led.y, LED_BOARD_Z);
    tmpEuler.set(led.tiltX * DEG2RAD, led.tiltY * DEG2RAD, 0, 'XYZ');
    tmpQuat.setFromEuler(tmpEuler);
    tmpAxis.set(0, 0, 1).applyQuaternion(tmpQuat);
    const rng = makeRng(0x1234abcd ^ (led.id * 40503));

    const paths: THREE.Vector3[][] = [];
    for (let k = 0; k < count; k++) {
      sampleCone(rng, tmpAxis, LED_HALF_ANGLE, tmpDir);
      tmpRay.origin.copy(origin);
      tmpRay.direction.copy(tmpDir);
      const hit1 = bvh.raycastFirst(tmpRay, THREE.FrontSide, 1e-6, wallDistance);
      if (!hit1) continue;
      this.interpolatedNormal(hit1.faceIndex!, hit1.barycoord!, posAttr, normAttr, index, tmpNormal);
      const d1 = refract(tmpRay.direction, tmpNormal, IOR_AIR / iorGlass);
      if (!d1) continue;
      tmpRefr.copy(d1);
      tmpRay.origin.copy(hit1.point).addScaledVector(tmpRefr, 1e-5);
      tmpRay.direction.copy(tmpRefr);
      const hit2 = bvh.raycastFirst(tmpRay, THREE.FrontSide, 1e-6, wallDistance);
      if (!hit2) continue;
      this.interpolatedNormal(hit2.faceIndex!, hit2.barycoord!, posAttr, normAttr, index, tmpNormal);
      const d2 = refract(tmpRay.direction, tmpNormal, iorGlass / IOR_AIR);
      if (!d2) continue;
      const end = hit2.point.clone().addScaledVector(d2, 60);
      paths.push([origin.clone(), hit1.point.clone(), hit2.point.clone(), end]);
    }
    return paths;
  }

  dispose() {
    this.geometry?.dispose();
    this.geometry = null;
    this.bvh = null;
    this.lensCfg = null;
  }
}
