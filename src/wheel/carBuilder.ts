import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BODY_HALF_WIDTH,
  WHEEL_POSITIONS,
  WHEEL_Z_BASE,
} from '../constants';
import { WHEEL_IDS } from '../types';
import type { WheelId } from '../types';

/** 轮拱内表面（翼子板内衬）半径 */
export const ARCH_LINER_RADIUS = 0.335;
/** 轮拱内衬沿车轴方向的宽度 */
export const ARCH_BAND_WIDTH = 0.5;
/** 轮拱外侧封盖所在的 z 平面（轮拱侧面边界） */
export const ARCH_CAP_Z = WHEEL_Z_BASE + ARCH_BAND_WIDTH / 2;

/** 内衬圆弧覆盖范围（上半圆再向下各延伸 0.35 rad） */
const ARC_EXTRA = 0.35;
/** CylinderGeometry 经 rotateX(PI/2) 后，θ=π/2..3π/2 对应世界坐标上半圆 */
const CYL_THETA_START = Math.PI / 2 - ARC_EXTRA;
const CYL_THETA_LEN = Math.PI + ARC_EXTRA * 2;
/** RingGeometry 原生位于 XY 平面，角度从 +X 逆时针 */
const RING_THETA_START = -ARC_EXTRA;
const RING_THETA_LEN = Math.PI + ARC_EXTRA * 2;

export interface CarBuild {
  group: THREE.Group;
  /** 合并后的轮拱内表面网格（带 BVH，间隙检测基准） */
  archMesh: THREE.Mesh;
  /** 每个轮位的翼子板外框环（越界时变红） */
  fenderRings: Record<WheelId, THREE.Mesh>;
  dispose: () => void;
}

/** 构建固定车身：车体 + 四个轮拱内表面（合并为单一 BVH 网格） */
export function buildCar(): CarBuild {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];

  const matBody = new THREE.MeshStandardMaterial({
    color: 0x2b6cb0,
    metalness: 0.65,
    roughness: 0.35,
  });
  const matGlass = new THREE.MeshStandardMaterial({
    color: 0x101826,
    metalness: 0.2,
    roughness: 0.15,
    transparent: true,
    opacity: 0.85,
  });
  const matLiner = new THREE.MeshStandardMaterial({
    color: 0x1d2024,
    metalness: 0.15,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const matRingNormal = new THREE.MeshStandardMaterial({
    color: 0x20242a,
    metalness: 0.5,
    roughness: 0.5,
    emissive: 0x000000,
  });
  const matLight = new THREE.MeshStandardMaterial({
    color: 0xf2f5ff,
    emissive: 0x9db8ff,
    emissiveIntensity: 0.6,
  });
  const matTail = new THREE.MeshStandardMaterial({
    color: 0xb3141c,
    emissive: 0x7a0d12,
    emissiveIntensity: 0.7,
  });

  const addBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
  ) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.userData.part = 'body';
    group.add(m);
    return m;
  };

  // —— 车身主体（中置舱体，车轮位于舱体两侧） ——
  addBox(4.5, 0.45, 1.5, 0, 0.62, 0, matBody);
  // 车头 / 车尾
  addBox(1.25, 0.3, 1.45, 1.62, 0.55, 0, matBody);
  addBox(1.25, 0.32, 1.45, -1.62, 0.56, 0, matBody);
  // 座舱与玻璃
  addBox(2.0, 0.18, 1.34, -0.15, 0.94, 0, matBody);
  addBox(1.7, 0.34, 1.28, -0.2, 1.12, 0, matGlass);
  addBox(1.9, 0.1, 1.3, -0.18, 1.32, 0, matBody);
  // 侧裙（前后轮之间）
  addBox(0.95, 0.14, 0.12, 0, 0.36, WHEEL_Z_BASE + 0.02, matBody);
  addBox(0.95, 0.14, 0.12, 0, 0.36, -(WHEEL_Z_BASE + 0.02), matBody);
  // 保险杠
  addBox(0.18, 0.22, 1.4, 2.28, 0.5, 0, matBody);
  addBox(0.18, 0.22, 1.4, -2.28, 0.5, 0, matBody);
  // 大灯 / 尾灯
  addBox(0.06, 0.1, 0.34, 2.38, 0.62, 0.48, matLight);
  addBox(0.06, 0.1, 0.34, 2.38, 0.62, -0.48, matLight);
  addBox(0.06, 0.1, 0.34, -2.38, 0.62, 0.48, matTail);
  addBox(0.06, 0.1, 0.34, -2.38, 0.62, -0.48, matTail);

  // —— 四个轮拱内表面：圆柱弧面 + 外侧封盖环，合并为一个网格 ——
  const archGeos: THREE.BufferGeometry[] = [];
  const fenderRings = {} as Record<WheelId, THREE.Mesh>;

  for (const id of WHEEL_IDS) {
    const pos = WHEEL_POSITIONS[id];
    const sideSign = pos.z > 0 ? 1 : -1;

    // 圆柱弧面（翼子板内衬）
    const band = new THREE.CylinderGeometry(
      ARCH_LINER_RADIUS,
      ARCH_LINER_RADIUS,
      ARCH_BAND_WIDTH,
      56,
      1,
      true,
      CYL_THETA_START,
      CYL_THETA_LEN,
    );
    band.rotateX(Math.PI / 2);
    band.translate(pos.x, pos.y, pos.z);
    archGeos.push(band);

    // 外侧封盖环（偏距外移时，倾斜射线会先命中它）
    const cap = new THREE.RingGeometry(
      0.06,
      ARCH_LINER_RADIUS,
      56,
      1,
      RING_THETA_START,
      RING_THETA_LEN,
    );
    if (sideSign > 0) cap.rotateY(Math.PI); // 法向朝向车内
    cap.translate(pos.x, pos.y, sideSign * ARCH_CAP_Z);
    archGeos.push(cap);

    // 翼子板外框环（视觉 + 越界警示环载体）
    const ringGeo = new THREE.TorusGeometry(ARCH_LINER_RADIUS + 0.012, 0.016, 12, 64, Math.PI);
    ringGeo.translate(pos.x, pos.y, sideSign * ARCH_CAP_Z);
    const ring = new THREE.Mesh(ringGeo, matRingNormal);
    ring.userData.part = 'fender';
    ring.userData.wheelId = id;
    group.add(ring);
    fenderRings[id] = ring;
    geos.push(ringGeo);
  }

  const mergedArch = mergeGeometries(archGeos, false)!;
  const archMesh = new THREE.Mesh(mergedArch, matLiner);
  archMesh.userData.part = 'arch';
  group.add(archMesh);

  const dispose = () => {
    for (const g of geos) g.dispose();
    mergedArch.dispose();
    matBody.dispose();
    matGlass.dispose();
    matLiner.dispose();
    matRingNormal.dispose();
    matLight.dispose();
    matTail.dispose();
  };

  return { group, archMesh, fenderRings, dispose };
}

/** 轮拱侧面边界的世界 z（绝对值） */
export function archBoundaryZ(): number {
  return BODY_HALF_WIDTH;
}
