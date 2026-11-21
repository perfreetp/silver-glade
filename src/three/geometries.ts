/**
 * 参数化几何：
 * - 菌盖：LatheGeometry 旋转成型的单位穹顶，厚度/穹顶高度由每实例 aMorph 形变
 * - 菌柄：单位圆柱（基部略粗），实例缩放高度
 * - 菌棒体 / 菌膜：圆柱，轴向旋转到 X
 */
import * as THREE from 'three';
import { STICK_LENGTH, STICK_RADIUS } from '../core/growth';

/**
 * 菌盖参数化穹顶（半径 1、高 1 的单位几何）。
 * 剖面 r = sin(t·π/2), y = cos(t·π/2)，t∈[0,1]：
 * 顶点在 (0,1)，边缘在 (1,0)。最终尺寸/厚度全部由实例矩阵 + aMorph 决定，
 * 几何本身只创建一次，4200+ 根菌棒共享。
 */
export function createCapGeometry(radialSegments = 18, profileSegments = 10): THREE.BufferGeometry {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= profileSegments; i++) {
    const t = i / profileSegments;
    const angle = t * (Math.PI / 2);
    points.push(new THREE.Vector2(Math.sin(angle), Math.cos(angle)));
  }
  const geo = new THREE.LatheGeometry(points, radialSegments);
  // LatheGeometry 自带 normal / uv；厚度方向保持单位化，交给实例缩放
  return geo;
}

/** 菌柄：单位高度圆柱，基部略粗，底部平移到原点（实例从菌棒表面向上长） */
export function createStemGeometry(radialSegments = 8): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.85, 1.15, 1, radialSegments, 1);
  geo.translate(0, 0.5, 0);
  return geo;
}

/** 菌棒体（培养基棒）：轴向沿 X */
export function createStickGeometry(radialSegments = 14): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(STICK_RADIUS, STICK_RADIUS, STICK_LENGTH, radialSegments, 1);
  geo.rotateZ(Math.PI / 2);
  return geo;
}

/** 菌膜（栽培袋）：比菌棒略大一圈的薄壳，轴向沿 X */
export function createMembraneGeometry(radialSegments = 14): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(
    STICK_RADIUS + 0.0025,
    STICK_RADIUS + 0.0025,
    STICK_LENGTH + 0.012,
    radialSegments,
    1,
  );
  geo.rotateZ(Math.PI / 2);
  return geo;
}
