// 线缆数据层：管理 300+ 条线缆的候选路径、当前方案、曲线重算与碰撞重算
import * as THREE from 'three';
import { CABLE, VARIANTS } from './config.js';
import {
  buildFilletDescriptors, resampleFillet, resampleSpline,
  estimateMinRadius, polylineLength,
} from './cableCurve.js';
import { detectCollisions } from './collision.js';

let nextId = 1;

export class CableStore {
  constructor(aabbs) {
    this.cables = [];
    this.aabbs = aabbs;
    this.globalMode = 'fillet';   // fillet | spline
    this.globalBend = CABLE.defaultBendRadius;
    this.globalRadius = CABLE.defaultRadius;
    this.selectedId = null;
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(evt) { for (const fn of this.listeners) fn(evt); }

  get selected() { return this.cables.find((c) => c.id === this.selectedId) || null; }

  // candidates: [{ key, waypoints: [{x,y,z}...] | null, error? }]
  addCable(portA, portB, candidates) {
    // 同对端口重复创建时替换
    const key = [portA.id, portB.id].sort().join('|');
    const exist = this.cables.find((c) => c.pairKey === key);
    if (exist) {
      exist.candidates = candidates;
      exist.variantKey = candidates.find((c) => c.waypoints)?.key || exist.variantKey;
      this.recompute(exist);
      this.emit({ type: 'cableChanged', cable: exist });
      return exist;
    }
    const first = candidates.find((c) => c.waypoints);
    if (!first) throw new Error('三条候选路径均搜索失败');
    const cable = {
      id: `L${String(nextId++).padStart(4, '0')}`,
      pairKey: key,
      portA, portB,
      candidates,
      variantKey: first.key,
      mode: this.globalMode,
      bendRadius: this.globalBend,
      radius: this.globalRadius,
      colorIndex: (this.cables.length) % CABLE.palette.length,
      waypoints: [],
      samplePoints: [],
      length: 0,
      minRadius: null,
      collision: { hitSegments: new Set(), hitLength: 0, perBox: new Map() },
      manual: false,
    };
    this.cables.push(cable);
    this.recompute(cable);
    this.emit({ type: 'cableAdded', cable });
    return cable;
  }

  remove(id) {
    const i = this.cables.findIndex((c) => c.id === id);
    if (i < 0) return;
    const [cable] = this.cables.splice(i, 1);
    if (this.selectedId === id) this.selectedId = null;
    this.emit({ type: 'cableRemoved', cable });
  }

  clear() {
    const removed = this.cables.splice(0);
    this.selectedId = null;
    this.emit({ type: 'cleared', removed });
  }

  select(id) {
    this.selectedId = id;
    this.emit({ type: 'selectionChanged' });
  }

  // 切换候选路径
  switchVariant(id, variantKey) {
    const cable = this.cables.find((c) => c.id === id);
    if (!cable || !cable.candidates.some((v) => v.key === variantKey && v.waypoints)) return;
    cable.variantKey = variantKey;
    cable.manual = false;
    this.recompute(cable);
    this.emit({ type: 'cableChanged', cable });
  }

  // 控制点拖动 / 增删后调用
  updateWaypoints(id, waypoints) {
    const cable = this.cables.find((c) => c.id === id);
    if (!cable) return;
    cable.waypoints = waypoints.map((p) => p.clone());
    cable.manual = true;
    this.recompute(cable);
    this.emit({ type: 'cableChanged', cable });
  }

  setMode(id, mode) {
    const cable = this.cables.find((c) => c.id === id);
    if (!cable) return;
    cable.mode = mode;
    this.recompute(cable);
    this.emit({ type: 'cableChanged', cable });
  }

  setBendRadius(id, r) {
    const cable = this.cables.find((c) => c.id === id);
    if (!cable) return;
    cable.bendRadius = r;
    this.recompute(cable);
    this.emit({ type: 'cableChanged', cable });
  }

  setCableRadius(id, r) {
    const cable = this.cables.find((c) => c.id === id);
    if (!cable) return;
    cable.radius = r;
    cable.collision = detectCollisions(cable.samplePoints, this.aabbs, r);
    this.emit({ type: 'cableChanged', cable });
  }

  setColorIndex(id, idx) {
    const cable = this.cables.find((c) => c.id === id);
    if (!cable) return;
    cable.colorIndex = idx;
    this.emit({ type: 'cableChanged', cable });
  }

  setGlobalRadius(r) {
    this.globalRadius = r;
    for (const c of this.cables) {
      c.radius = r;
      c.collision = detectCollisions(c.samplePoints, this.aabbs, r);
    }
    this.emit({ type: 'globalChanged' });
  }

  setGlobalMode(mode) {
    this.globalMode = mode;
    for (const c of this.cables) { c.mode = mode; this.recompute(c); }
    this.emit({ type: 'globalChanged' });
  }

  setGlobalBend(r) {
    this.globalBend = r;
    for (const c of this.cables) { c.bendRadius = r; this.recompute(c); }
    this.emit({ type: 'globalChanged' });
  }

  // 仅重算单条线缆的曲线与碰撞（控制点拖动后的局部更新）
  recompute(cable) {
    const src = cable.manual
      ? cable.waypoints
      : cable.candidates.find((v) => v.key === cable.variantKey)?.waypoints;
    if (!src || src.length < 2) {
      // 防御：数据异常时退化为端口直连，保证渲染层永远拿到有效采样
      const wp0 = [
        new THREE.Vector3(cable.portA.position.x, cable.portA.position.y, cable.portA.position.z),
        new THREE.Vector3(cable.portB.position.x, cable.portB.position.y, cable.portB.position.z),
      ];
      cable.samplePoints = wp0;
      cable.waypoints = wp0.map((p) => p.clone());
      cable.length = wp0[0].distanceTo(wp0[1]);
      cable.minRadius = null;
      cable.collision = detectCollisions(wp0, this.aabbs, cable.radius);
      return;
    }
    const wp = src.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    if (!cable.manual) cable.waypoints = wp.map((p) => p.clone());

    let points;
    if (cable.mode === 'spline') {
      points = resampleSpline(wp, cable.bendRadius, CABLE.segments);
    } else {
      const desc = buildFilletDescriptors(wp, cable.bendRadius);
      points = desc.totalLength > 0 ? resampleFillet(desc, CABLE.segments) : [wp[0], wp[wp.length - 1]];
    }
    cable.samplePoints = points;
    cable.length = polylineLength(points);
    cable.minRadius = estimateMinRadius(points);
    cable.collision = detectCollisions(points, this.aabbs, cable.radius);
  }

  recomputeAll() {
    for (const c of this.cables) this.recompute(c);
    this.emit({ type: 'globalChanged' });
  }

  totalLength() {
    return this.cables.reduce((s, c) => s + c.length, 0);
  }

  collisionStats() {
    let count = 0, len = 0;
    for (const c of this.cables) {
      if (c.collision.hitSegments.size) count++;
      len += c.collision.hitLength;
    }
    return { cableCount: count, hitLength: len };
  }

  variantName(key) {
    return VARIANTS.find((v) => v.key === key)?.name || key;
  }
}
