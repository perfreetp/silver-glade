// 路径控制点：用 TransformControls 拖动，支持增删控制点与网格吸附
// 拖动结束只重算所属线缆的曲线与碰撞；拖动过程中实时同步实例球与折线
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GRID } from './config.js';

const HANDLE_COLOR = 0xffd54f;
const HANDLE_SEL = 0xff6f00;
const LINE_COLOR = 0x90caf9;
const MAX_HANDLES = 128;

export class WaypointEditor {
  constructor(camera, domElement, orbit, store, cableLayer) {
    this.store = store;
    this.cableLayer = cableLayer;
    this.orbit = orbit;
    this.group = new THREE.Group();
    this.group.visible = false;

    // 控制点连线（折线预览）
    this.lineGeo = new THREE.BufferGeometry();
    this.line = new THREE.Line(
      this.lineGeo,
      new THREE.LineBasicMaterial({ color: LINE_COLOR, transparent: true, opacity: 0.9 }),
    );
    this.group.add(this.line);

    // 控制点球体
    const sphere = new THREE.SphereGeometry(0.09, 16, 12);
    this.handleMesh = new THREE.InstancedMesh(
      sphere,
      new THREE.MeshStandardMaterial({ color: HANDLE_COLOR, emissive: 0x332200, roughness: 0.4 }),
      MAX_HANDLES,
    );
    this.handleMesh.userData.kind = 'waypoint';
    this.handleMesh.count = 0;
    this.group.add(this.handleMesh);
    this._baseCol = new THREE.Color(HANDLE_COLOR);
    this._selCol = new THREE.Color(HANDLE_SEL);

    // TransformControls（代理对象无需挂场景图，TC 直接读其 position）
    this.tc = new TransformControls(camera, domElement);
    this.tc.setMode('translate');
    this.tc.setSize(0.8);
    this.tc.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      if (e.value) {
        this._dragIndex = this.tc.object.userData.index;
      } else if (this._dragIndex !== null && this._cable) {
        this._commitDrag();
        this._dragIndex = null;
      }
    });
    this.tc.addEventListener('objectChange', () => {
      if (!this._cable) return;
      const idx = this._dragIndex ?? this.tc.object.userData.index;
      const pos = this.tc.object.position;
      if (this.snapEnabled) {
        const c = GRID.cell;
        pos.set(Math.round(pos.x / c) * c, Math.round(pos.y / c) * c, Math.round(pos.z / c) * c);
      }
      this._cable.waypoints[idx].copy(pos);
      this._syncHandleMatrix(idx);
      this._refreshLine();
    });

    this.snapEnabled = true;
    this.handles = [];          // THREE.Object3D[] 代理对象
    this._cable = null;
    this._dragIndex = null;
    this._m = new THREE.Matrix4();
  }

  show(cable) {
    this.clear();
    if (!cable) { this.group.visible = false; return; }
    this._cable = cable;
    this.group.visible = true;
    cable.waypoints.forEach((p, i) => {
      const proxy = new THREE.Object3D();
      proxy.position.copy(p);
      proxy.userData.index = i;
      proxy.updateMatrix();
      this.handles.push(proxy);
      this.handleMesh.setMatrixAt(i, proxy.matrix);
      this.handleMesh.setColorAt(i, this._baseCol);
    });
    this.handleMesh.count = this.handles.length;
    this.handleMesh.instanceMatrix.needsUpdate = true;
    if (this.handleMesh.instanceColor) this.handleMesh.instanceColor.needsUpdate = true;
    this._refreshLine();
  }

  clear() {
    this.tc.detach();
    this.handles = [];
    this.handleMesh.count = 0;
    this._cable = null;
    this._dragIndex = null;
  }

  // 从射线拾取命中的控制点 instanceId 开始拖动
  beginDrag(instanceId) {
    const proxy = this.handles[instanceId];
    if (!proxy) return;
    this.tc.attach(proxy);
    for (let i = 0; i < this.handles.length; i++) {
      this.handleMesh.setColorAt(i, i === instanceId ? this._selCol : this._baseCol);
    }
    this.handleMesh.instanceColor.needsUpdate = true;
  }

  _syncHandleMatrix(idx) {
    const proxy = this.handles[idx];
    if (!proxy) return;
    proxy.updateMatrix();
    this.handleMesh.setMatrixAt(idx, proxy.matrix);
    this.handleMesh.instanceMatrix.needsUpdate = true;
  }

  _commitDrag() {
    if (!this._cable) return;
    const cableId = this._cable.id;
    const wps = this._cable.waypoints.map((p) => p.clone());
    this.store.updateWaypoints(cableId, wps);
    // store 重算后 waypoints 为新数组，重建编辑器代理
    this.show(this.store.selected);
  }

  _refreshLine() {
    if (!this._cable) return;
    const pts = this._cable.waypoints;
    const arr = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.lineGeo.computeBoundingSphere();
  }

  // 在某控制点后插入中点
  insertAfter(instanceId) {
    if (!this._cable || instanceId == null || instanceId >= this.handles.length - 1) return;
    if (this._cable.waypoints.length >= MAX_HANDLES) return;
    const pts = this._cable.waypoints;
    const mid = pts[instanceId].clone().lerp(pts[instanceId + 1], 0.5);
    pts.splice(instanceId + 1, 0, mid);
    this._commitDrag();
  }

  // 删除控制点（至少保留 2 个）
  removeAt(instanceId) {
    if (!this._cable || instanceId == null) return;
    const pts = this._cable.waypoints;
    if (pts.length <= 2) return;
    pts.splice(instanceId, 1);
    this._commitDrag();
  }

  setSnap(v) { this.snapEnabled = v; }

  get object() { return this.tc; }
}
