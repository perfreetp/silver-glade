import * as THREE from 'three';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import type { LensConfig } from '../types';
import {
  CURVATURE_RADII,
  LENS_EDGE_THICKNESS,
  LENS_RADIUS,
  LENS_RINGS,
  LENS_RADIAL_SEGMENTS,
} from './constants';

export interface BuiltLens {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
  /** 实际生效的中心厚度（可能被曲率约束抬升） */
  effectiveThickness: number;
  /** 球面矢高 */
  sag: number;
}

/**
 * 球面矢高：z 相对球冠顶点的下沉量
 * sag(r) = R - sqrt(R² - r²)
 */
export function sphereSag(r: number, R: number): number {
  return R - Math.sqrt(Math.max(0, R * R - r * r));
}

/**
 * 给定曲率与目标厚度，计算物理上允许的实际中心厚度。
 * 约束：边缘厚度 >= LENS_EDGE_THICKNESS，即 D >= sag(R, a) + edge。
 */
export function resolveEffectiveThickness(lens: LensConfig): { thickness: number; sag: number } {
  const R = CURVATURE_RADII[lens.curvature];
  const sag = sphereSag(LENS_RADIUS, R);
  const minD = sag + LENS_EDGE_THICKNESS;
  return { thickness: Math.max(lens.thickness, minD), sag };
}

/**
 * 构造闭合的平凸透镜（车头灯准直取向：凸面朝 LED（-z 侧），平面朝墙（+z 侧））。
 *
 * z 布局（D = 中心厚度）：
 *   凸面顶点 z=0，凸面 r 处 z = sag(r)（向 +z 后退）
 *   平面 z = D
 * 单块 indexed BufferGeometry：凸面 fan + 平面 fan + 侧壁，水密且外向，
 * 绕序满足 three.js FrontSide 约定（沿 +z 传播的光线从外侧击中两面）。
 */
export function buildLens(lens: LensConfig): BuiltLens {
  const R = CURVATURE_RADII[lens.curvature];
  const { thickness: D, sag } = resolveEffectiveThickness(lens);
  const seg = LENS_RADIAL_SEGMENTS;
  const rings = LENS_RINGS;

  const positions: number[] = [];
  const indices: number[] = [];

  // ============ 凸面（入射面，朝 -z）：顶点在 z=0，圈按 r 递增 ============
  const convexCenter = 0;
  positions.push(0, 0, 0);
  const convexRingStart = 1;
  for (let j = 1; j <= rings; j++) {
    const r = (LENS_RADIUS * j) / rings;
    const z = sphereSag(r, R);
    for (let i = 0; i < seg; i++) {
      const theta = (i / seg) * Math.PI * 2;
      positions.push(r * Math.cos(theta), r * Math.sin(theta), z);
    }
  }
  const convexIdx = (j: number, i: number) =>
    convexRingStart + (j - 1) * seg + (i % seg);

  // 凸面朝 -z，+z 传播的光线击中的是背面 → FrontSide 需要从射线方向看为 CCW，
  // 即从 +z 看该面为 CW：(center, i+1, i)
  for (let i = 0; i < seg; i++) {
    indices.push(convexCenter, convexIdx(1, i + 1), convexIdx(1, i));
  }
  for (let j = 1; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = convexIdx(j, i);
      const b = convexIdx(j, i + 1);
      const c = convexIdx(j + 1, i);
      const d = convexIdx(j + 1, i + 1);
      // 从 +z 看保持 CW
      indices.push(a, d, c, a, b, d);
    }
  }

  // ============ 平面（出射面，朝 +z）：圈按 r 递减建立 + 中心 ============
  const flatRingStart = positions.length / 3;
  for (let k = 0; k < rings; k++) {
    const j = rings - k; // r 从 a 递减
    const r = (LENS_RADIUS * j) / rings;
    for (let i = 0; i < seg; i++) {
      const theta = (i / seg) * Math.PI * 2;
      positions.push(r * Math.cos(theta), r * Math.sin(theta), D);
    }
  }
  const flatCenter = positions.length / 3;
  positions.push(0, 0, D);
  const flatIdx = (k: number, i: number) => flatRingStart + k * seg + (i % seg);

  // 平面朝 +z，从射线方向(+z)看须 CCW
  const lastK = rings - 1;
  for (let i = 0; i < seg; i++) {
    indices.push(flatIdx(lastK, i + 1), flatIdx(lastK, i), flatCenter);
  }
  for (let k = 0; k < rings - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = flatIdx(k, i); // 外圈
      const b = flatIdx(k, i + 1);
      const c = flatIdx(k + 1, i); // 内圈
      const d = flatIdx(k + 1, i + 1);
      indices.push(a, c, b, b, c, d);
    }
  }

  // ============ 侧壁：连接凸面边界与平面边界 ============
  const convexEdge = (i: number) => convexIdx(rings, i);
  const flatEdge = (i: number) => flatIdx(0, i);
  for (let i = 0; i < seg; i++) {
    const b0 = convexEdge(i);
    const b1 = convexEdge(i + 1);
    const f0 = flatEdge(i);
    const f1 = flatEdge(i + 1);
    indices.push(b0, b1, f1, b0, f1, f0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const bvh = new MeshBVH(geometry, { strategy: SAH });
  return { geometry, bvh, effectiveThickness: D, sag };
}
