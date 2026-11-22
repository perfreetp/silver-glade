// 验证 4：三种代价方案在受限（跨排）场景下产出不同候选路径
import { Worker } from 'node:worker_threads';
import * as THREE from 'three';
import { RoomLayout } from '../src/room.js';
import { PathGrid } from '../src/grid.js';
import { VARIANTS, GRID } from '../src/config.js';

const room = new RoomLayout({ add() {} });
const grid = new PathGrid();
grid.buildOccupancy(room.aabbs);

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

// 取跨两排且 z 方向错开的端口对（必须绕过整排机柜），多试几对
let distinctTrials = 0;
for (let t = 0; t < 8; t++) {
  const a = room.ports[t * 7];
  const b = room.ports[320 + ((t * 13 + 5) % 320)];
  const results = await search(a, b);
  const lens = results.map((r) => (r.path ? r.path.length : -1));
  const turns = results.map((r) => {
    if (!r.path) return -1;
    let n = 0;
    for (let i = 2; i < r.path.length; i++) {
      if (r.path[i] - r.path[i - 1] !== r.path[i - 1] - r.path[i - 2]) n++;
    }
    return n;
  });
  const uniq = new Set(lens);
  if (uniq.size > 1) distinctTrials++;
  console.log(`试例 ${t + 1}: 单元长度 ${lens.join(' / ')}，转向次数 ${turns.join(' / ')}`);
}
console.log(distinctTrials >= 3
  ? `\n[PASS] ${distinctTrials}/8 个跨排用例产生了差异化候选路径`
  : `\n[FAIL] 仅 ${distinctTrials}/8 差异化，代价方案未生效`);
await worker.terminate();
process.exit(distinctTrials >= 3 ? 0 : 1);
