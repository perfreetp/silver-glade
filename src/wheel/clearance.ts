import * as THREE from 'three';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';
import type { ClearanceResult, WheelId } from '../types';
import { isBoundaryViolation } from '../constants';
import { ARCH_CAP_Z } from './carBuilder';

let bvhInitialized = false;

/** 给 three.js 装配 three-mesh-bvh 加速射线检测（全局只需一次） */
export function initBVH(): void {
  if (bvhInitialized) return;
  const geoProto = THREE.BufferGeometry.prototype as unknown as Record<string, unknown>;
  geoProto.computeBoundsTree = computeBoundsTree;
  geoProto.disposeBoundsTree = disposeBoundsTree;
  (THREE.Mesh.prototype as unknown as { raycast: typeof THREE.Mesh.prototype.raycast }).raycast =
    acceleratedRaycast as typeof THREE.Mesh.prototype.raycast;
  bvhInitialized = true;
}

const raycaster = new THREE.Raycaster();
(raycaster as unknown as { firstHitOnly: boolean }).firstHitOnly = true;
raycaster.far = 0.6;

/** 周向采样步数（覆盖轮拱圆弧 240°） */
const PHI_STEPS = 24;
/** 轴向倾斜角（0 = 纯径向，两侧倾斜用于检测偏距外移后的侧面封盖） */
const TILTS = [-0.6, 0, 0.6];
const PHI_START = -0.35;
const PHI_SPAN = Math.PI + 0.7;

export interface MeasureInput {
  id: WheelId;
  archMesh: THREE.Mesh;
  /** 车轮中心（世界坐标，已含偏距） */
  center: THREE.Vector3;
  tireRadius: number;
}

/**
 * 以轮拱内表面为基准，从轮胎外廓沿径向发射射线，
 * 返回最小间隙值与命中点。四个轮位分别调用本函数完成全量重算。
 */
export function measureWheelClearance(input: MeasureInput): ClearanceResult {
  const { archMesh, center, tireRadius } = input;
  const sideSign = center.z >= 0 ? 1 : -1;
  const boundaryViolation = isBoundaryViolation(center.z);

  let min = Infinity;
  let closest: THREE.Vector3 | null = null;
  let hitCount = 0;
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();

  for (let i = 0; i <= PHI_STEPS; i++) {
    const phi = PHI_START + (PHI_SPAN * i) / PHI_STEPS;
    for (const tilt of TILTS) {
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      const ct = Math.cos(tilt);
      dir.set(cp * ct, sp * ct, Math.sin(tilt) * sideSign).normalize();
      origin.copy(center).addScaledVector(dir, tireRadius);

      // 射线起点已经跑到轮拱封盖之外时，该方向必然无命中，跳过
      if (sideSign * origin.z > ARCH_CAP_Z + 0.002) continue;

      raycaster.set(origin, dir);
      const hits = raycaster.intersectObject(archMesh, false);
      if (hits.length > 0) {
        hitCount++;
        const d = hits[0].distance;
        if (d < min) {
          min = d;
          closest = origin.clone().addScaledVector(dir, d);
        }
      }
    }
  }

  const minGap = Number.isFinite(min) ? min : null;
  let status: ClearanceResult['status'];
  if (boundaryViolation) {
    status = 'collision';
  } else if (minGap === null) {
    status = 'warn';
  } else if (minGap < 0.005) {
    status = 'collision';
  } else if (minGap < 0.025) {
    status = 'warn';
  } else {
    status = 'ok';
  }

  return {
    min: minGap,
    status,
    point: closest ? [closest.x, closest.y, closest.z] : null,
    rayCount: hitCount,
    boundaryViolation,
  };
}
