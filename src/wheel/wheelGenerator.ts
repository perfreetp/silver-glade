import * as THREE from 'three';
import {
  FACE_OFFSET,
  HUB_RADIUS,
  TIRE_HALF_WIDTH,
  tireOuterRadius,
} from '../constants';
import type { WheelConfig, WheelStyleId } from '../types';

/**
 * 参数化轮毂生成器。
 * 输出 Group，本地坐标：车轮中心为原点，轮轴为 Z，轮面朝向 +Z。
 * 包含：轮胎、轮辋、中心法兰、按款式参数化生成的辐条/盘面。
 */

interface SpokeSpec {
  /** 极角（弧度，绕 Z 轴） */
  angle: number;
  /** 径向起点/终点（米） */
  r0: number;
  r1: number;
  /** 根部/端部切向半宽（米） */
  w0: number;
  w1: number;
  /** 根部/端部 z（盘面深度通过 z 体现） */
  z0: number;
  z1: number;
  /** 厚度（米） */
  thickness: number;
}

function rimRadii(cfg: WheelConfig) {
  const outer = cfg.rimDiameter / 2;
  return {
    outer,
    lip: outer - 0.012,
    barrel: outer - 0.03,
    inner: outer - 0.045,
  };
}

/** 单根辐条：带厚度的挤出四边形（自定义 BufferGeometry，避免 ExtrudeGeometry 的额外开销） */
function makeSpokeGeometry(s: SpokeSpec): THREE.BufferGeometry {
  const dir = new THREE.Vector2(Math.cos(s.angle), Math.sin(s.angle));
  const tan = new THREE.Vector2(-dir.y, dir.x);
  const p = (r: number, w: number, z: number, sign: number): [number, number, number] => {
    const x = dir.x * r + tan.x * w * sign;
    const y = dir.y * r + tan.y * w * sign;
    return [x, y, z];
  };
  const f0 = s.z0 + s.thickness / 2;
  const f1 = s.z1 + s.thickness / 2;
  const b0 = s.z0 - s.thickness / 2;
  const b1 = s.z1 - s.thickness / 2;

  const v: number[] = [];
  const push = (q: [number, number, number]) => v.push(...q);
  // 前面 4 顶点（0..3），背面 4 顶点（4..7）
  push(p(s.r0, s.w0, f0, 1));
  push(p(s.r1, s.w1, f1, 1));
  push(p(s.r1, s.w1, f1, -1));
  push(p(s.r0, s.w0, f0, -1));
  push(p(s.r0, s.w0, b0, 1));
  push(p(s.r1, s.w1, b1, 1));
  push(p(s.r1, s.w1, b1, -1));
  push(p(s.r0, s.w0, b0, -1));

  const idx = [
    0, 1, 2, 0, 2, 3, // 前
    4, 6, 5, 4, 7, 6, // 后
    0, 4, 5, 0, 5, 1, // 侧 1
    1, 5, 6, 1, 6, 2, // 侧 2
    2, 6, 7, 2, 7, 3, // 侧 3
    3, 7, 4, 3, 4, 0, // 侧 4
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 环形扇区（用于封闭盘面的开窗间筋、涡轮扇叶） */
function makeSectorGeometry(
  angle: number,
  halfWidth: number,
  r0: number,
  r1: number,
  z: number,
  thickness: number,
  twist: number,
): THREE.BufferGeometry {
  const a0i = angle - halfWidth;
  const a0o = angle + halfWidth;
  const a1i = angle - halfWidth + twist;
  const a1o = angle + halfWidth + twist;
  const v: number[] = [];
  const add = (a: number, r: number, zz: number) =>
    v.push(r * Math.cos(a), r * Math.sin(a), zz);
  const zf = z + thickness / 2;
  const zb = z - thickness / 2;
  add(a0i, r0, zf); add(a1o, r1, zf); add(a1i, r1, zf); add(a0o, r0, zf);
  add(a0i, r0, zb); add(a1o, r1, zb); add(a1i, r1, zb); add(a0o, r0, zb);
  const idx = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function buildSpokes(
  style: WheelStyleId,
  cfg: WheelConfig,
  group: THREE.Group,
  matRim: THREE.Material,
): void {
  const n = cfg.spokes;
  const R = rimRadii(cfg);
  const faceZ = FACE_OFFSET - cfg.dishDepth;
  const step = (Math.PI * 2) / n;
  const base = (i: number) => i * step;

  const addMesh = (geo: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(geo, matRim);
    m.userData.part = 'spoke';
    group.add(m);
  };

  switch (style) {
    case 'straight': {
      for (let i = 0; i < n; i++) {
        addMesh(
          makeSpokeGeometry({
            angle: base(i),
            r0: HUB_RADIUS * 0.9,
            r1: R.lip,
            w0: 0.022,
            w1: 0.014,
            z0: faceZ - 0.004,
            z1: faceZ,
            thickness: 0.022,
          }),
        );
      }
      break;
    }
    case 'twin': {
      // 每个辐条角度生成一对细辐
      for (let i = 0; i < n; i++) {
        for (const off of [-0.05, 0.05]) {
          addMesh(
            makeSpokeGeometry({
              angle: base(i) + off,
              r0: HUB_RADIUS * 0.95,
              r1: R.lip,
              w0: 0.011,
              w1: 0.008,
              z0: faceZ - 0.004,
              z1: faceZ,
              thickness: 0.018,
            }),
          );
        }
      }
      break;
    }
    case 'twist': {
      const twist = 0.32;
      for (let i = 0; i < n; i++) {
        const a = base(i);
        addMesh(
          makeSectorGeometry(
            a + twist / 2,
            step * 0.16,
            HUB_RADIUS * 0.9,
            R.lip,
            faceZ,
            0.02,
            twist,
          ),
        );
      }
      break;
    }
    case 'mesh': {
      // 两层交错的斜辐
      for (let i = 0; i < n; i++) {
        addMesh(
          makeSectorGeometry(
            base(i) + 0.18,
            step * 0.1,
            HUB_RADIUS,
            R.lip,
            faceZ + 0.004,
            0.014,
            0.36,
          ),
        );
        addMesh(
          makeSectorGeometry(
            base(i) - 0.18,
            step * 0.1,
            HUB_RADIUS,
            R.lip,
            faceZ - 0.004,
            0.014,
            -0.36,
          ),
        );
      }
      break;
    }
    case 'dish': {
      // 封闭整盘 + 每个辐条间开一个梯形窗（用扇区间筋表达）
      const dishGeo = new THREE.CylinderGeometry(R.lip, R.lip, 0.014, 64);
      dishGeo.rotateX(Math.PI / 2);
      const dish = new THREE.Mesh(dishGeo, matRim);
      dish.position.z = faceZ - 0.005;
      dish.userData.part = 'spoke';
      group.add(dish);
      for (let i = 0; i < n; i++) {
        // 窗：用暗色薄扇片嵌在盘面里模拟开窗（不参与间隙射线的镂空需求，视觉表达）
        const winGeo = makeSectorGeometry(
          base(i) + step / 2,
          step * 0.26,
          HUB_RADIUS * 1.25,
          R.lip * 0.82,
          faceZ + 0.003,
          0.004,
          0,
        );
        const win = new THREE.Mesh(winGeo, MAT_WINDOW);
        win.userData.part = 'window';
        group.add(win);
      }
      break;
    }
    case 'turbine': {
      for (let i = 0; i < n; i++) {
        addMesh(
          makeSectorGeometry(
            base(i) + 0.22,
            step * 0.24,
            HUB_RADIUS * 0.85,
            R.lip * 0.98,
            faceZ,
            0.024,
            0.44,
          ),
        );
      }
      break;
    }
  }
}

const MAT_WINDOW = new THREE.MeshStandardMaterial({
  color: 0x0b0e12,
  roughness: 0.9,
  metalness: 0.1,
});

/** 生成完整车轮（含轮胎）。dispose 时调用返回对象的 dispose()。 */
export function buildWheel(cfg: WheelConfig): {
  group: THREE.Group;
  dispose: () => void;
} {
  const group = new THREE.Group();
  const R = rimRadii(cfg);
  const geos: THREE.BufferGeometry[] = [];
  const matMetal = new THREE.MeshStandardMaterial({
    color: 0xc8ccd2,
    metalness: 0.85,
    roughness: 0.32,
  });
  const matDarkMetal = new THREE.MeshStandardMaterial({
    color: 0x3a3f46,
    metalness: 0.7,
    roughness: 0.45,
  });
  const matRubber = new THREE.MeshStandardMaterial({
    color: 0x141517,
    roughness: 0.92,
    metalness: 0.02,
  });

  const track = (g: THREE.BufferGeometry) => {
    geos.push(g);
    return g;
  };

  // —— 轮胎：回转体截面 ——
  const tireR = tireOuterRadius(cfg.rimDiameter);
  const pts: THREE.Vector2[] = [];
  const seg = 20;
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI;
    const r = R.outer + (tireR - R.outer) * Math.sin(t);
    const z = TIRE_HALF_WIDTH * Math.cos(t);
    pts.push(new THREE.Vector2(r, z));
  }
  const tireGeo = track(new THREE.LatheGeometry(pts, 72));
  tireGeo.rotateX(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, matRubber);
  tire.userData.part = 'tire';
  group.add(tire);

  // —— 轮辋：外唇圆环 + 桶身 + 内缘 ——
  const lipGeo = track(new THREE.TorusGeometry(R.lip, 0.011, 14, 72));
  const lip = new THREE.Mesh(lipGeo, matMetal);
  lip.position.z = FACE_OFFSET;
  lip.userData.part = 'rim';
  group.add(lip);

  const barrelGeo = track(new THREE.CylinderGeometry(R.barrel, R.barrel, TIRE_HALF_WIDTH * 1.7, 64, 1, true));
  barrelGeo.rotateX(Math.PI / 2);
  const barrel = new THREE.Mesh(barrelGeo, matDarkMetal);
  barrel.userData.part = 'rim';
  group.add(barrel);

  const innerLipGeo = track(new THREE.TorusGeometry(R.inner, 0.008, 12, 56));
  const innerLip = new THREE.Mesh(innerLipGeo, matMetal);
  innerLip.position.z = -FACE_OFFSET;
  innerLip.userData.part = 'rim';
  group.add(innerLip);

  // —— 中心法兰/轮毂盖 ——
  const hubGeo = track(new THREE.CylinderGeometry(HUB_RADIUS, HUB_RADIUS * 1.08, 0.05, 40));
  hubGeo.rotateX(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, matMetal);
  hub.position.z = FACE_OFFSET - cfg.dishDepth + 0.006;
  hub.userData.part = 'hub';
  group.add(hub);

  const capGeo = track(new THREE.CylinderGeometry(HUB_RADIUS * 0.42, HUB_RADIUS * 0.42, 0.012, 32));
  capGeo.rotateX(Math.PI / 2);
  const cap = new THREE.Mesh(capGeo, matDarkMetal);
  cap.position.z = FACE_OFFSET - cfg.dishDepth + 0.034;
  cap.userData.part = 'hub';
  group.add(cap);

  // —— 辐条 / 盘面 ——
  buildSpokes(cfg.style, cfg, group, matMetal);
  for (const child of group.children) {
    if ((child as THREE.Mesh).geometry && !geos.includes((child as THREE.Mesh).geometry)) {
      geos.push((child as THREE.Mesh).geometry);
    }
  }

  // 左右两侧各放一份（车轮两面都可见），背面绕 Y 翻转
  const back = group.clone(true);
  back.rotation.y = Math.PI;
  const root = new THREE.Group();
  root.add(group, back);

  const dispose = () => {
    for (const g of geos) g.dispose();
    matMetal.dispose();
    matDarkMetal.dispose();
    matRubber.dispose();
  };
  return { group: root, dispose };
}
