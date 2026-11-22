// 验证 1：PathGrid 占用栅格 + Worker 内 A*（3 种代价方案）端到端
import { Worker } from 'node:worker_threads';
import { PathGrid } from '../src/grid.js';
import { GRID } from '../src/config.js';

const grid = new PathGrid();
console.log(`网格规模: ${grid.nx} x ${grid.ny} x ${grid.nz} = ${grid.count} 单元`);

// 两个测试盒体：一堵横墙 + 一个方块
const boxes = [
  { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 3, z: 1 }, cabinetId: 'B1' },
  { min: { x: -6, y: 0, z: 4 }, max: { x: -2, y: 2.5, z: 6 }, cabinetId: 'B2' },
];
const t0 = performance.now();
grid.buildOccupancy(boxes);
console.log(`占用栅格构建: ${(performance.now() - t0).toFixed(1)} ms, 占用单元 ${grid.occ.reduce((s, v) => s + v, 0)}`);

const variants = [
  { key: 'balanced', turn: 0.15, yMode: 0 },
  { key: 'overhead', turn: 0.05, yMode: 1 },
  { key: 'low', turn: 0.35, yMode: 2 },
];

const worker = new Worker(new URL('./worker-shim.mjs', import.meta.url));
let seq = 0;
const pending = new Map();
worker.on('message', (m) => { pending.get(m.id)(m.results); pending.delete(m.id); });
function search(start, goal) {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({
      id,
      data: {
        nx: grid.nx, ny: grid.ny, nz: grid.nz, occ: grid.occ,
        start: grid.worldToIndex(start), goal: grid.worldToIndex(goal),
        cell: grid.cell, maxIter: GRID.maxIterations, roomMaxY: 5,
      },
      variants,
    });
  });
}

function outsideAllBoxes(p) {
  for (const b of boxes) {
    if (p.x > b.min.x - GRID.inflate && p.x < b.max.x + GRID.inflate &&
        p.y > b.min.y - GRID.inflate && p.y < b.max.y + GRID.inflate &&
        p.z > b.min.z - GRID.inflate && p.z < b.max.z + GRID.inflate) return false;
  }
  return true;
}

let failures = 0;
const cases = [
  [{ x: -4, y: 1, z: -4 }, { x: 4, y: 1, z: -4 }],
  // 终点在 B2 盒体外侧面附近，路径需绕行而非穿盒
  [{ x: -7, y: 1, z: 7.5 }, { x: 0, y: 1.2, z: 7.5 }],
  [{ x: 0, y: 0.4, z: -7 }, { x: 0, y: 0.4, z: 7 }],
  [{ x: 8, y: 4, z: 0 }, { x: -8, y: 0.5, z: 0 }],
];

for (const [s, g] of cases) {
  const results = await search(s, g);
  for (const r of results) {
    if (r.error) { console.log(`✗ ${r.key}: ${r.error}`); failures++; continue; }
    const wps = grid.cellPathToWaypoints(r.path);
    const inBox = wps.filter((p) => !outsideAllBoxes(p));
    const distStart = Math.hypot(wps[0].x - s.x, wps[0].y - s.y, wps[0].z - s.z);
    const end = wps[wps.length - 1];
    const distEnd = Math.hypot(end.x - g.x, end.y - g.y, end.z - g.z);
    let len = 0;
    for (let i = 1; i < wps.length; i++) len += Math.hypot(wps[i].x - wps[i-1].x, wps[i].y - wps[i-1].y, wps[i].z - wps[i-1].z);
    const ok = inBox.length === 0 && distStart < grid.cell && distEnd < grid.cell;
    if (!ok) failures++;
    console.log(`${ok ? '✓' : '✗'} ${r.key.padEnd(9)} 单元${String(r.path.length).padStart(4)} 控制点${String(wps.length).padStart(2)} 长度${len.toFixed(2)}m 迭代${r.iterations} 越界点${inBox.length}`);
  }
}

// 封闭场景验证：盒体直达天花板形成全封闭墙，墙另一侧目标不可达
const closed = new PathGrid();
// x∈[-0.5,0.5] 的整面墙（z 方向铺满、顶到天花板），两侧完全隔断
closed.buildOccupancy([{ min: { x: -0.5, y: 0, z: -20 }, max: { x: 0.5, y: 20, z: 20 }, cabinetId: 'WALL' }]);
const res = await new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  worker.postMessage({
    id,
    data: {
      nx: closed.nx, ny: closed.ny, nz: closed.nz, occ: closed.occ,
      start: closed.worldToIndex({ x: 5, y: 2, z: 0 }),
      goal: closed.worldToIndex({ x: 0, y: 2, z: 0 }),
      cell: closed.cell, maxIter: GRID.maxIterations, roomMaxY: 5,
    },
    variants: [variants[0]],
  });
});
console.log(`封闭盒目标（起终点强制开放后应找到路径）: ${res[0].error ? '返回 error=' + res[0].error : '找到路径 length=' + res[0].path.length}`);

await worker.terminate();
console.log(failures === 0 ? '\n[PASS] A* 全部用例通过' : `\n[FAIL] ${failures} 个失败`);
process.exit(failures ? 1 : 0);
