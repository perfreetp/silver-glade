// 线缆渲染层：全部线缆合批到一个 InstancedMesh（圆柱段），逐实例着色标记碰撞段
import * as THREE from 'three';
import { CABLE } from './config.js';

const UNIT = 0.01; // 基础圆柱半径，最终半径通过实例缩放体现
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _color = new THREE.Color();
const _selected = new THREE.Color();

export class CableLayer {
  constructor(scene, store) {
    this.store = store;
    this.segments = CABLE.segments;
    this.capacity = CABLE.maxCount * this.segments;

    const geo = new THREE.CylinderGeometry(UNIT, UNIT, 1, 8, 1, false);
    const mat = new THREE.MeshStandardMaterial({
      metalness: 0.15, roughness: 0.55, vertexColors: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.userData.kind = 'cable';
    // 初始全部缩放到 0（隐藏）
    _scale.set(0, 0, 0);
    _mat4.makeScale(0, 0, 0);
    for (let i = 0; i < this.capacity; i++) this.mesh.setMatrixAt(i, _mat4);
    // 初始颜色
    for (let i = 0; i < this.capacity; i++) this.mesh.setColorAt(i, _color.set(0x000000));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);

    // 实例 -> 线缆 id 映射，供拾取
    this.instanceOwner = new Array(this.capacity).fill(null);
    this.palette = CABLE.palette.map((h) => new THREE.Color(h));
    this.collisionColor = new THREE.Color(CABLE.collisionColor);
  }

  updateAll() {
    let idx = 0;
    this.instanceOwner.fill(null);
    for (const cable of this.store.cables) {
      this._writeCable(cable, idx);
      for (let s = 0; s < this.segments; s++) {
        this.instanceOwner[idx + s] = cable.id;
      }
      idx += this.segments;
    }
    // 剩余实例隐藏
    _mat4.makeScale(0, 0, 0);
    for (; idx < this.capacity; idx++) this.mesh.setMatrixAt(idx, _mat4);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  // 拖动后只重写该条线缆的实例（曲线与碰撞已在 store 内重算）
  updateCable(cable) {
    const slot = this.store.cables.indexOf(cable);
    if (slot < 0) return;
    const base = slot * this.segments;
    this._writeCable(cable, base);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  _writeCable(cable, base) {
    const pts = cable.samplePoints;
    const baseColor = this.palette[cable.colorIndex % this.palette.length];
    const isSelected = this.store.selectedId === cable.id;
    const hit = cable.collision.hitSegments;
    const rScale = cable.radius / UNIT;

    for (let s = 0; s < this.segments; s++) {
      const p1 = pts[s], p2 = pts[s + 1];
      if (!p1 || !p2) {
        _mat4.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(base + s, _mat4);
        continue;
      }
      _dir.subVectors(p2, p1);
      const len = _dir.length();
      if (len < 1e-9) {
        _mat4.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(base + s, _mat4);
        continue;
      }
      _dir.divideScalar(len);
      _mid.addVectors(p1, p2).multiplyScalar(0.5);
      _quat.setFromUnitVectors(_up, _dir);
      _scale.set(rScale, len, rScale);
      _mat4.compose(_mid, _quat, _scale);
      this.mesh.setMatrixAt(base + s, _mat4);

      if (hit.has(s)) {
        this.mesh.setColorAt(base + s, this.collisionColor);
      } else if (isSelected) {
        _selected.copy(baseColor).lerp(new THREE.Color(0xffffff), 0.35);
        this.mesh.setColorAt(base + s, _selected);
      } else {
        this.mesh.setColorAt(base + s, baseColor);
      }
    }
  }

  // 选中高亮变化时仅刷新颜色（无需重建矩阵）
  refreshColors() {
    for (const cable of this.store.cables) {
      const slot = this.store.cables.indexOf(cable);
      const base = slot * this.segments;
      const baseColor = this.palette[cable.colorIndex % this.palette.length];
      const isSelected = this.store.selectedId === cable.id;
      const hit = cable.collision.hitSegments;
      for (let s = 0; s < this.segments; s++) {
        if (hit.has(s)) this.mesh.setColorAt(base + s, this.collisionColor);
        else if (isSelected) {
          _selected.copy(baseColor).lerp(new THREE.Color(0xffffff), 0.35);
          this.mesh.setColorAt(base + s, _selected);
        } else {
          this.mesh.setColorAt(base + s, baseColor);
        }
      }
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  // 实例索引 -> 线缆 id
  ownerOf(instanceId) {
    return this.instanceOwner[instanceId] || null;
  }
}
