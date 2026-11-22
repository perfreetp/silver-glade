import * as THREE from 'three';

export const PALETTE = {
  bg: 0x0a0e15,
  roomShell: 0x26313f,
  roomWire: 0x3d5369,
  rack: 0x8a6a44,
  rackEdge: 0xc79a5f,
  fanSupply: 0x3fa9f5,
  fanExhaust: 0xf5a742,
  grid: 0x2a3a4c,
};

/**
 * 房间外壳: 半透明地板/天花 + 线框, 室内可见。
 * 深度写入关闭, 以便粒子透过外壳可见; 但外壳本身仍然会被菇架遮挡。
 */
export function buildRoomShell(): { group: THREE.Group; floor: THREE.Mesh; dispose: () => void } {
  const group = new THREE.Group();
  group.name = 'room-shell';
  const disposes: (() => void)[] = [];
  const { lx, ly, lz } = { lx: 12.8, ly: 6.4, lz: 8.0 };

  // 地台
  const floorGeo = new THREE.BoxGeometry(lx, 0.06, lz);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x1b2530,
    roughness: 0.92,
    metalness: 0.05,
    transparent: true,
    opacity: 0.95,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.set(lx / 2, -0.03, lz / 2);
  floor.receiveShadow = true;
  group.add(floor);
  disposes.push(() => {
    floorGeo.dispose();
    floorMat.dispose();
  });

  // 地板网格
  const grid = new THREE.GridHelper(lz, Math.round(lz / 0.4), PALETTE.grid, PALETTE.grid);
  grid.rotation.x = Math.PI / 2;
  grid.rotation.z = Math.PI / 2;
  grid.scale.set(lx / lz, 1, 1);
  grid.position.set(lx / 2, 0.005, lz / 2);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.45;
  group.add(grid);
  disposes.push(() => {
    grid.geometry.dispose();
    (grid.material as THREE.Material).dispose();
  });

  // 房间线框
  const boxGeo = new THREE.BoxGeometry(lx, ly, lz);
  const edges = new THREE.EdgesGeometry(boxGeo);
  const lineMat = new THREE.LineBasicMaterial({ color: PALETTE.roomWire, transparent: true, opacity: 0.85 });
  const wire = new THREE.LineSegments(edges, lineMat);
  wire.position.set(lx / 2, ly / 2, lz / 2);
  group.add(wire);
  disposes.push(() => {
    boxGeo.dispose();
    edges.dispose();
    lineMat.dispose();
  });

  // 四面墙: 极淡的半透明面, 提供空间感, 不写深度
  const wallMat = new THREE.MeshBasicMaterial({
    color: PALETTE.roomShell,
    transparent: true,
    opacity: 0.06,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(lx, ly), wallMat);
  back.position.set(lx / 2, ly / 2, lz);
  group.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(lz, ly), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(0, ly / 2, lz / 2);
  group.add(left);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(lz, ly), wallMat);
  right.rotation.y = Math.PI / 2;
  right.position.set(lx, ly / 2, lz / 2);
  group.add(right);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(lx, lz), wallMat);
  roof.rotation.x = Math.PI / 2;
  roof.position.set(lx / 2, ly, lz / 2);
  group.add(roof);
  disposes.push(() => {
    back.geometry.dispose();
    left.geometry.dispose();
    right.geometry.dispose();
    roof.geometry.dispose();
    wallMat.dispose();
  });

  return {
    group,
    floor,
    dispose: () => disposes.forEach((d) => d()),
  };
}
