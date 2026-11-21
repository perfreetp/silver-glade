import * as THREE from 'three';
import { RACKS, nozzleDir } from '../core/config';
import type { NozzleSpec } from '../core/types';
import { makeConeMaterial } from './coneMaterial';

/** 单位锥：顶点在原点，开口朝 -Y，高 1，底半径 1（用 scale 定向定形） */
const coneGeo = (() => {
  const g = new THREE.ConeGeometry(1, 1, 56, 1, true);
  g.translate(0, -0.5, 0);
  return g;
})();

const DOWN = new THREE.Vector3(0, -1, 0);
const LINE_SEGMENTS = 64;

/**
 * 单个喷头的可视化：本体、雾锥、方向/张角手柄、轴线、
 * 以及雾锥与每层菇架平面的交线（侧视时显示）。
 * 所有子对象都在 group 局部坐标系中（group 位于喷头位置）。
 */
export class NozzleVisual {
  readonly group = new THREE.Group();
  private cone: THREE.Mesh;
  private coneMat: THREE.ShaderMaterial;
  private wireMat: THREE.MeshBasicMaterial;
  private body: THREE.Mesh;
  private pickSphere: THREE.Mesh;
  private dirHandle: THREE.Mesh;
  private spreadHandle: THREE.Mesh;
  private axisLine: THREE.Line;
  private layerLines: THREE.Line[] = [];
  private layerLinesVisible = false;
  private dimmed = false;

  constructor(n: NozzleSpec) {
    this.coneMat = makeConeMaterial(new THREE.Color(n.color));
    this.cone = new THREE.Mesh(coneGeo, this.coneMat);
    this.cone.renderOrder = 5;
    this.wireMat = new THREE.MeshBasicMaterial({
      color: n.color, wireframe: true, transparent: true, opacity: 0.22,
    });

    this.body = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 20, 14),
      new THREE.MeshStandardMaterial({
        color: n.color, emissive: n.color, emissiveIntensity: 0.4, roughness: 0.4,
      }),
    );
    this.body.userData = { drag: 'move', nozzleId: n.id };

    // 更大的隐形拾取球，方便从顶视远处抓取
    this.pickSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 12, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    );
    this.pickSphere.userData = { drag: 'move', nozzleId: n.id };

    const handleGeo = new THREE.SphereGeometry(0.09, 16, 12);
    this.dirHandle = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.dirHandle.userData = { drag: 'dir', nozzleId: n.id };
    this.spreadHandle = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: 0xffe082 }));
    this.spreadHandle.userData = { drag: 'spread', nozzleId: n.id };

    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.axisLine = new THREE.Line(
      axisGeo,
      new THREE.LineBasicMaterial({ color: n.color, transparent: true, opacity: 0.8 }),
    );

    for (let i = 0; i < RACKS.layers.length; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * (LINE_SEGMENTS + 1)), 3));
      const line = new THREE.Line(
        g,
        new THREE.LineBasicMaterial({ color: n.color, transparent: true, opacity: 0.95 }),
      );
      line.visible = false;
      this.layerLines.push(line);
      this.group.add(line);
    }

    this.group.add(this.cone, this.body, this.pickSphere, this.dirHandle, this.spreadHandle, this.axisLine);
    this.sync(n);
  }

  /** 根据喷头参数更新所有可视元素 */
  sync(n: NozzleSpec) {
    this.group.position.set(n.x, n.y, n.z);
    const d = nozzleDir(n);
    const dir = new THREE.Vector3(d.x, d.y, d.z);
    const spread = (n.spread * Math.PI) / 180;

    // 雾锥：长度 = 沿方向到地面的距离（封顶 8m）
    const len = Math.min(8, n.y / Math.max(0.08, -dir.y));
    const r = Math.tan(spread) * len;
    this.cone.quaternion.setFromUnitVectors(DOWN, dir);
    this.cone.scale.set(r, len, r);
    this.cone.visible = n.on;

    // 轴线
    const pos = this.axisLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, 0, 0, 0);
    pos.setXYZ(1, dir.x * len, dir.y * len, dir.z * len);
    pos.needsUpdate = true;

    // 手柄
    const hd = 1.15;
    this.dirHandle.position.copy(dir).multiplyScalar(hd);
    const ref = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const U = new THREE.Vector3().crossVectors(dir, ref).normalize();
    const rimDir = dir.clone().multiplyScalar(Math.cos(spread)).addScaledVector(U, Math.sin(spread));
    this.spreadHandle.position.copy(rimDir).multiplyScalar(hd);

    // 雾锥与各层菇架平面的交线（锥面射线与水平面求交，采样 64 点）
    const V = new THREE.Vector3().crossVectors(dir, U).normalize();
    const cosS = Math.cos(spread), sinS = Math.sin(spread);
    for (let li = 0; li < RACKS.layers.length; li++) {
      const line = this.layerLines[li];
      const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const relH = RACKS.layers[li] - n.y;
      let count = 0;
      for (let k = 0; k <= LINE_SEGMENTS; k++) {
        const phi = (k / LINE_SEGMENTS) * Math.PI * 2;
        const cp = Math.cos(phi), sp = Math.sin(phi);
        const rx = dir.x * cosS + (U.x * cp + V.x * sp) * sinS;
        const ry = dir.y * cosS + (U.y * cp + V.y * sp) * sinS;
        const rz = dir.z * cosS + (U.z * cp + V.z * sp) * sinS;
        if (ry >= -1e-4) continue; // 射线不向下，与该层无交点
        const t = relH / ry;
        if (t <= 0 || !isFinite(t)) continue;
        attr.setXYZ(count++, rx * t, ry * t, rz * t);
      }
      line.geometry.setDrawRange(0, count);
      attr.needsUpdate = true;
      line.visible = this.layerLinesVisible && n.on && count > 8;
    }
  }

  setLayerLinesVisible(v: boolean) {
    this.layerLinesVisible = v;
  }

  /** 选中其他喷头时，本喷头雾锥降为线框 */
  setDimmed(dim: boolean) {
    this.dimmed = dim;
    this.cone.material = dim ? this.wireMat : this.coneMat;
    this.dirHandle.visible = !dim;
    this.spreadHandle.visible = !dim;
    this.axisLine.visible = !dim;
  }

  setSelected(sel: boolean) {
    this.body.scale.setScalar(sel ? 1.35 : 1);
    const hs = sel ? 1.3 : 1;
    this.dirHandle.scale.setScalar(hs);
    this.spreadHandle.scale.setScalar(hs);
  }

  get isDimmed() {
    return this.dimmed;
  }

  pickables(out: THREE.Object3D[]) {
    out.push(this.pickSphere, this.body);
    if (!this.dimmed) out.push(this.dirHandle, this.spreadHandle);
  }

  tick(t: number) {
    this.coneMat.uniforms.uTime.value = t;
  }

  dispose() {
    this.body.geometry.dispose();
    (this.body.material as THREE.Material).dispose();
    this.pickSphere.geometry.dispose();
    (this.pickSphere.material as THREE.Material).dispose();
    this.dirHandle.geometry.dispose();
    (this.dirHandle.material as THREE.Material).dispose();
    this.spreadHandle.geometry.dispose();
    (this.spreadHandle.material as THREE.Material).dispose();
    this.axisLine.geometry.dispose();
    (this.axisLine.material as THREE.Material).dispose();
    this.coneMat.dispose();
    this.wireMat.dispose();
    for (const l of this.layerLines) {
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
  }
}
