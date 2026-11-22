// 验证 3：真实机房集成——布局生成、Worker 搜索、CableStore 全流程、性能与碰撞
import { Worker } from 'node:worker_threads';
import * as THREE from 'three';
import { RoomLayout } from '../src/room.js';
import { PathGrid } from '../src/grid.js';
import { CableStore } from '../src/cableStore.js';
import { CABLE, VARIANTS, GRID } from '../src/config.js';

// 无 WebGL 环境下的场景桩
const sceneStub = { add() {}, children: [] };
const room = new RoomLayout(sceneStub);
console.log(`机柜 ${room.cabinets.length} 个，端口 ${room.ports.length} 个，AABB ${room.aabbs.length} 个`);
if (room.cabinets.length !== 20 || room.ports.length !== 640) throw new Error('布局数量不符');

const grid = new PathGrid();
const tOcc = performance.now();
grid.buildOccupancy(room.aabbs);
console.log(`占用栅格: ${grid.nx}x${grid.ny}x${grid.nz}=${grid.count}，构建 ${(performance.now() - tOcc).toFixed(1)} ms`);

const worker = new Worker(new URL('./worker-shim.mjs', import.meta.url));
let seq = 0;
const pending = new Map();
worker.on('message', (m) => { pending.get(m.id)(m.results); pending.delete(m.id); });
function search(a, b) {
  const id = ++seq;
  const variants = VARIANTS.map((v) => {
    if (v.waypointY === null) return { ...v, waypointCells: [] };
    const midZ = (a.position.z + b.position.z) / 2;
    return {
      ...v,
      waypointCells: [
        { x: 0, y: v.waypointY, z: a.position.z },
        { x: 0, y: v.waypointY, z: midZ },
        { x: 0, y: v.waypointY, z: b.position.z },
      ].map((p) => grid.worldToIndex(p)),
    };
  });
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({
      id,
      data: {
        nx: grid.nx, ny: grid.ny, nz: grid.nz, occ: grid.occ,
        start: grid.worldToIndex(a.position), goal: grid.worldToIndex(b.position),
        cell: grid.cell, maxIter: GRID.maxIterations, roomMaxY: 5,
      },
      variants,
    });
  });
}

const store = new CableStore(room.aabbs);
const PAIRS = 60;
const ports = room.ports;
const seen = new Set();
const pairList = [];
let guard = 0;
while (pairList.length < PAIRS && guard < PAIRS * 30) {
  guard++;
  const i = Math.floor(Math.random() * ports.length);
  const j = Math.floor(Math.random() * ports.length);
  if (i === j) continue;
  const key = [i, j].sort((a, b) => a - b).join('-');
  if (seen.has(key)) continue;
  seen.add(key);
  pairList.push([ports[i], ports[j]]);
}

const t0 = performance.now();
let searchMs = 0;
let failed = 0;
for (const [a, b] of pairList) {
  const ts = performance.now();
  const results = await search(a, b);
  searchMs += performance.now() - ts;
  const candidates = results.map((r) => {
    if (r.error || !r.path) return { key: r.key, error: r.error || '失败', waypoints: null };
    const waypoints = r.degenerate
      ? [{ ...a.position }, { ...b.position }]
      : grid.cellPathToWaypoints(r.path);
    return { key: r.key, error: null, waypoints };
  });
  if (!candidates.some((c) => c.waypoints)) { failed++; continue; }
  store.addCable(a, b, candidates);
}
const elapsed = performance.now() - t0;
console.log(`\n建线 ${store.cables.length}/${PAIRS}（失败 ${failed}），总耗时 ${elapsed.toFixed(0)} ms，` +
  `其中 Worker 搜索 ${searchMs.toFixed(0)} ms，均摊 ${(searchMs / PAIRS).toFixed(1)} ms/对（3 方案）`);

// 容量检查
if (store.cables.length > CABLE.maxCount) throw new Error('超出实例容量');
const instances = store.cables.length * CABLE.segments;
console.log(`实例化圆柱段数: ${instances}（容量 ${CABLE.maxCount * CABLE.segments}），单 InstancedMesh 合批`);

// 碰撞统计：栅格已按 inflate=0.15 膨胀，线径 0.035，期望零碰撞
const coll = store.collisionStats();
console.log(`碰撞线缆 ${coll.cableCount} 条，穿透总长 ${coll.hitLength.toFixed(2)} m`);

// 每条线缆的数据完整性
let bad = 0;
for (const c of store.cables) {
  if (c.samplePoints.length !== CABLE.segments + 1) bad++;
  if (!(c.length > 0)) bad++;
  if (c.waypoints.length < 2) bad++;
  if (c.samplePoints.some((p) => !Number.isFinite(p.x))) bad++;
  // 端点必须贴合端口
  const dA = c.samplePoints[0].distanceTo(c.portA.position);
  const dB = c.samplePoints.at(-1).distanceTo(c.portB.position);
  if (dA > grid.cell || dB > grid.cell) bad++;
}
console.log(`数据完整性异常: ${bad} 条`);

// 候选路径切换
const c0 = store.cables[0];
const originalLen = c0.length;
const other = c0.candidates.find((v) => v.key !== c0.variantKey && v.waypoints);
if (other) {
  store.switchVariant(c0.id, other.key);
  console.log(`方案切换: ${c0.variantKey}，长度 ${originalLen.toFixed(2)} m -> ${c0.length.toFixed(2)} m，manual=${c0.manual}`);
}

// 手动拖动控制点 -> 只重算该条
const target = store.cables[1];
const wp = target.waypoints.map((p) => p.clone());
wp[Math.min(1, wp.length - 1)].y += 0.8;
const tRecalc = performance.now();
store.updateWaypoints(target.id, wp);
const recalcMs = performance.now() - tRecalc;
console.log(`单条重算（曲线+碰撞 ${CABLE.segments} 段 x ${room.aabbs.length} 盒）: ${recalcMs.toFixed(2)} ms，manual=${target.manual}`);

// 全局参数联动
store.setGlobalRadius(0.06);
store.setGlobalMode('spline');
const splineOk = store.cables.every((c) => c.samplePoints.length === CABLE.segments + 1 && c.length > 0);
console.log(`全局切换样条模式 + 线径 0.06：${splineOk ? 'OK' : 'FAIL'}，总长 ${store.totalLength().toFixed(2)} m`);
store.setGlobalMode('fillet');

// 制造一条确定穿模的线缆，验证碰撞标红能力
const piercing = store.cables[2];
const inside = room.aabbs[5].getCenter(new THREE.Vector3());
const badWps = [piercing.waypoints[0].clone(), inside.clone(), piercing.waypoints.at(-1).clone()];
store.updateWaypoints(piercing.id, badWps);
console.log(`人造穿模线碰撞段: ${piercing.collision.hitSegments.size}，穿透 ${piercing.collision.hitLength.toFixed(2)} m，` +
  `机柜 ${[...piercing.collision.perBox.keys()].join(',')}`);

const total = store.totalLength();
console.log(`\n长度清单: ${store.cables.length} 条，总长度 ${total.toFixed(2)} m，平均 ${(total / store.cables.length).toFixed(2)} m/条`);

const problems = bad + failed + (splineOk ? 0 : 1) + (piercing.collision.hitSegments.size === 0 ? 1 : 0);
console.log(problems === 0 ? '\n[PASS] 集成验证全部通过' : `\n[FAIL] ${problems} 个问题`);
await worker.terminate();
process.exit(problems ? 1 : 0);
