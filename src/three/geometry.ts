import * as THREE from 'three';

/**
 * 试片几何：中央球 + 两块车身级曲率面板
 * - 引擎盖面板：横向单曲率（机盖拱面）
 * - 侧围面板：纵横向双曲率（翼子板特征）
 */

export interface PanelGeometryResult {
  geometry: THREE.BufferGeometry;
}

/** 横向单曲率引擎盖试片 */
export function createHoodGeometry(
  width = 2.6,
  depth = 1.7,
  segX = 64,
  segZ = 40,
): PanelGeometryResult {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // y(x,v) = crown*(1-(2x/w)^2) - 0.12v；解析法线 n = (-dy/dx, 1, -dy/dz)
  const halfW = width * 0.5;
  for (let iz = 0; iz <= segZ; iz++) {
    const v = iz / segZ; // 0 前 → 1 后
    const z = (v - 0.5) * depth;
    for (let ix = 0; ix <= segX; ix++) {
      const u = ix / segX;
      const x = (u - 0.5) * width;
      const crown = 0.34 * (1.0 - Math.pow(Math.abs(x) / halfW, 2));
      const slope = -0.12 * v;
      const y = crown + slope;
      positions.push(x, y, z);
      // dy/dx = 0.34 * (-2x / halfW²)
      const dydx = -0.68 * x / (halfW * halfW);
      const n = new THREE.Vector3(-dydx, 1, 0).normalize();
      normals.push(n.x, n.y, n.z);
      uvs.push(u, v);
    }
  }

  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iz * (segX + 1) + ix;
      const b = a + 1;
      const c = a + (segX + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return { geometry };
}

/** 双曲率侧围/翼子板试片 */
export function createDoorGeometry(
  width = 1.7,
  height = 1.9,
  segX = 48,
  segY = 52,
): PanelGeometryResult {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= segY; iy++) {
    const v = iy / segY;
    const y = (v - 0.5) * height;
    for (let ix = 0; ix <= segX; ix++) {
      const u = ix / segX;
      const x = (u - 0.5) * width;
      // 双曲率：横向鼓包 + 纵向腰线隆起
      const curveX = 0.3 * Math.sin(u * Math.PI);
      const belt = 0.16 * Math.exp(-Math.pow((v - 0.62) * 3.2, 2));
      const z = curveX + belt;
      positions.push(x, y, z);
      // 解析法线 n = normalize(-dz/dx, -dz/dy, 1)
      const dzdx = (0.3 * Math.PI * Math.cos(u * Math.PI)) / width;
      const dzdv = belt * (-2 * (v - 0.62) * 3.2 * 3.2);
      const dzdy = dzdv / height;
      const n = new THREE.Vector3(-dzdx, -dzdy, 1).normalize();
      normals.push(n.x, n.y, n.z);
      uvs.push(u, v);
    }
  }

  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iy * (segX + 1) + ix;
      const b = a + 1;
      const c = a + (segX + 1);
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return { geometry };
}

export interface SceneMeshes {
  sphere: THREE.Mesh;
  hood: THREE.Mesh;
  door: THREE.Mesh;
}

/** 搭建三件试片，共享同一车漆材质实例 */
export function createPaintMeshes(material: THREE.Material): SceneMeshes {
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.05, 96, 64), material);
  sphere.position.set(-0.15, 1.35, -1.15);
  sphere.name = 'paint-sphere';

  const { geometry: hoodGeo } = createHoodGeometry(1.9, 1.35, 64, 40);
  const hood = new THREE.Mesh(hoodGeo, material);
  hood.position.set(-2.15, -0.28, 1.4);
  hood.rotation.y = 0.45;
  hood.name = 'paint-hood';

  const { geometry: doorGeo } = createDoorGeometry(1.4, 1.65, 48, 52);
  const door = new THREE.Mesh(doorGeo, material);
  door.position.set(2.7, 0.8, 1.15);
  door.rotation.y = -0.55;
  door.name = 'paint-door';

  [sphere, hood, door].forEach((m) => {
    m.renderOrder = 1;
  });

  return { sphere, hood, door };
}
