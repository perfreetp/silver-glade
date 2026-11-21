import * as THREE from 'three';
import { ARCH_LINER_RADIUS } from './carBuilder';

const ARC_START = -0.35;
const ARC_SPAN = Math.PI + 0.7;

/**
 * 聚焦车轮时显示的轮拱截面：
 * 青色 = 轮拱内表面截线，琥珀色 = 当前轮胎外廓截线，灰色 = 端部连线与中心标记。
 * 轮毂参数变化（轮胎半径随之变化）时整组重建。
 */
export function buildSectionGroup(center: THREE.Vector3, tireRadius: number): THREE.Group {
  const group = new THREE.Group();

  const arcPts: THREE.Vector3[] = [];
  const arcSteps = 64;
  for (let i = 0; i <= arcSteps; i++) {
    const phi = ARC_START + (ARC_SPAN * i) / arcSteps;
    arcPts.push(
      new THREE.Vector3(
        center.x + ARCH_LINER_RADIUS * Math.cos(phi),
        center.y + ARCH_LINER_RADIUS * Math.sin(phi),
        center.z,
      ),
    );
  }
  const archLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(arcPts),
    new THREE.LineBasicMaterial({ color: 0x35d0d9, transparent: true, opacity: 0.95 }),
  );
  group.add(archLine);

  // 轮胎外廓圆
  const tirePts: THREE.Vector3[] = [];
  for (let i = 0; i < 72; i++) {
    const phi = (Math.PI * 2 * i) / 72;
    tirePts.push(
      new THREE.Vector3(
        center.x + tireRadius * Math.cos(phi),
        center.y + tireRadius * Math.sin(phi),
        center.z,
      ),
    );
  }
  const tireLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(tirePts),
    new THREE.LineBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.95 }),
  );
  group.add(tireLine);

  // 端部径向连线 + 中心十字
  const endA = arcPts[0];
  const endB = arcPts[arcPts.length - 1];
  const helperPts = [
    endA,
    new THREE.Vector3(center.x, center.y, center.z),
    endB,
    new THREE.Vector3(center.x - 0.05, center.y, center.z),
    new THREE.Vector3(center.x + 0.05, center.y, center.z),
    new THREE.Vector3(center.x, center.y - 0.05, center.z),
    new THREE.Vector3(center.x, center.y + 0.05, center.z),
  ];
  const helper = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(helperPts),
    new THREE.LineBasicMaterial({ color: 0x9aa4b2, transparent: true, opacity: 0.8 }),
  );
  group.add(helper);

  group.userData.part = 'section';
  return group;
}

export function disposeSectionGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Line;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | undefined;
    if (mat) mat.dispose();
  });
}
