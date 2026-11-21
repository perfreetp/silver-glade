import * as THREE from 'three';
import { TERRAIN } from './constants';
import type { WindState } from './types';

/**
 * 坡面基准高度（不含积雪）。
 * CPU 粒子碰撞与 GPU 顶点着色器必须使用同一表达式 ——
 * GLSL 版本见 terrainShaders.ts（由同一份数值常量注入）。
 */
export function terrainHeight(x: number, z: number): number {
  const t = TERRAIN;
  const undulation =
    Math.sin(x * 0.11 + z * 0.035) * 0.6 +
    Math.sin(z * 0.07 - x * 0.05) * 0.45 +
    Math.cos(x * 0.045 + z * 0.09) * 0.6;
  return -t.SLOPE * z + t.NOISE_AMP * undulation;
}

/** 坡面解析法线（有限差分），与 GPU 重建法线思路一致 */
export function terrainNormal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.35;
  const hL = terrainHeight(x - e, z);
  const hR = terrainHeight(x + e, z);
  const hD = terrainHeight(x, z - e);
  const hU = terrainHeight(x, z + e);
  out.set(hL - hR, 2 * e, hD - hU).normalize();
  return out;
}

/** 风向量（世界空间）：0° = +Z 顺坡向下，顺时针角度制 */
export function windVector(wind: WindState, out = new THREE.Vector3()): THREE.Vector3 {
  const rad = (wind.direction * Math.PI) / 180;
  return out.set(Math.sin(rad) * wind.speed, 0, Math.cos(rad) * wind.speed);
}

/** 水平朝向角（度，0 = +Z，顺时针）转方向向量 */
export function yawToVector(yaw: number, out = new THREE.Vector3()): THREE.Vector3 {
  const rad = (yaw * Math.PI) / 180;
  return out.set(Math.sin(rad), 0, Math.cos(rad));
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 确定性伪随机（轨迹预览需要稳定可复算） */
export function seededRandom(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 世界坐标 -> 雪场网格单元索引 */
export function worldToGrid(x: number, z: number): { i: number; j: number } {
  const i = Math.floor((x / TERRAIN.WIDTH + 0.5) * (TERRAIN.SEG_X));
  const j = Math.floor((z / TERRAIN.LENGTH + 0.5) * (TERRAIN.SEG_Z));
  return { i, j };
}
