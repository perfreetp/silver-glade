import * as THREE from 'three';
import { RACKS, RACK_TOP, SHELF_CENTERS, SHELF_THICKNESS } from '../model/room';
import type { Box } from '../solver/geometry';
import { PALETTE } from './scene';

export interface RackMeshes {
  group: THREE.Group;
  /** 参与深度遮挡的实心网格 (粒子会被它们挡住) */
  occluders: THREE.Mesh[];
  dispose: () => void;
}

/**
 * 菇架: 简化盒体 —— 每层一张搁板 + 若干立柱。
 * 使用 MeshStandardMaterial, 写深度, 因此粒子在菇架后方会被正确遮挡。
 */
export function buildRacks(boxes: Box[]): RackMeshes {
  const group = new THREE.Group();
  group.name = 'racks';
  const occluders: THREE.Mesh[] = [];
  const disposes: (() => void)[] = [];

  const shelfMat = new THREE.MeshStandardMaterial({
    color: 0x9a7c52,
    roughness: 0.82,
    metalness: 0.06,
  });
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x6b5236,
    roughness: 0.85,
    metalness: 0.1,
  });
  // 半透明"菇床": 叠在搁板上方, 让盒体更有实体感
  const bedMat = new THREE.MeshStandardMaterial({
    color: 0x6a4b2c,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.55,
  });
  const edgeMat = new THREE.LineBasicMaterial({
    color: PALETTE.rackEdge,
    transparent: true,
    opacity: 0.55,
  });
  disposes.push(() => {
    shelfMat.dispose();
    legMat.dispose();
    bedMat.dispose();
    edgeMat.dispose();
  });

  const unit = new THREE.BoxGeometry(1, 1, 1);
  disposes.push(() => unit.dispose());

  for (const b of boxes) {
    const mat = b.kind === 'shelf' ? shelfMat : legMat;
    const mesh = new THREE.Mesh(unit, mat);
    mesh.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    mesh.scale.set(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.rack = b.rack;
    mesh.userData.kind = b.kind;
    group.add(mesh);
    occluders.push(mesh);

    // 搁板: 上方叠一层半透明"菇床"+ 边缘高亮线
    if (b.kind === 'shelf') {
      const bed = new THREE.Mesh(unit, bedMat);
      bed.position.set(mesh.position.x, mesh.position.y + (b.y1 - b.y0) / 2 + 0.055, mesh.position.z);
      bed.scale.set((b.x1 - b.x0) * 0.985, 0.11, (b.z1 - b.z0) * 0.985);
      group.add(bed);
      occluders.push(bed);

      const eg = new THREE.EdgesGeometry(unit);
      const line = new THREE.LineSegments(eg, edgeMat);
      line.position.copy(mesh.position);
      line.scale.copy(mesh.scale);
      group.add(line);
      disposes.push(() => eg.dispose());
    }
  }

  return { group, occluders, dispose: () => disposes.forEach((d) => d()) };
}

/** 菇架的包围盒, 用于相机取景 */
export function rackBounds() {
  const x0 = Math.min(...RACKS.map((r) => r.x0));
  const x1 = Math.max(...RACKS.map((r) => r.x1));
  const z0 = Math.min(...RACKS.map((r) => r.z0));
  const z1 = Math.max(...RACKS.map((r) => r.z1));
  return new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, RACK_TOP, z1));
}

export { SHELF_CENTERS, SHELF_THICKNESS };
