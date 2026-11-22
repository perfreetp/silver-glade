// 避障路径搜索 Worker：6 邻接 A*（轴对齐网格）
// 三种候选方案通过不同的必经航点产生结构性差异：均衡走廊 / 顶部桥架 / 低位走线
// 每个必经点强制开放，分段 A* 后拼接，任一段失败则整条失败

class MinHeap {
  constructor() {
    this.keys = [];
    this.vals = [];
  }
  get size() { return this.keys.length; }
  push(key, val) {
    const ks = this.keys, vs = this.vals;
    ks.push(key); vs.push(val);
    let i = ks.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= ks[i]) break;
      const tk = ks[p]; ks[p] = ks[i]; ks[i] = tk;
      const tv = vs[p]; vs[p] = vs[i]; vs[i] = tv;
      i = p;
    }
  }
  pop() {
    const ks = this.keys, vs = this.vals;
    const retKey = ks[0], retVal = vs[0];
    const lk = ks.pop(), lv = vs.pop();
    if (ks.length > 0) {
      ks[0] = lk; vs[0] = lv;
      let i = 0;
      const n = ks.length;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < n && ks[l] < ks[m]) m = l;
        if (r < n && ks[r] < ks[m]) m = r;
        if (m === i) break;
        const tk = ks[m]; ks[m] = ks[i]; ks[i] = tk;
        const tv = vs[m]; vs[m] = vs[i]; vs[i] = tv;
        i = m;
      }
    }
    return { key: retKey, val: retVal };
  }
}

const NEI = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

function heuristic(x, y, z, gx, gy, gz) {
  return Math.abs(x - gx) + Math.abs(y - gy) + Math.abs(z - gz);
}

function decode(i, nx, ny) {
  const z = Math.floor(i / (nx * ny));
  const t = i - z * nx * ny;
  const y = Math.floor(t / nx);
  const x = t - y * nx;
  return [x, y, z];
}

// 单段 A*：from -> to。forceOpen 中的单元强制可通行（起终点/必经航点）
function astarSegment(data, variant, from, to, forceOpen) {
  const { nx, ny, nz, occ, cell, maxIter } = data;
  const [sx, sy, sz] = decode(from, nx, ny);
  const [gx, gy, gz] = decode(to, nx, ny);

  const total = nx * ny * nz;
  const gScore = new Float32Array(total).fill(Infinity);
  const came = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const heap = new MinHeap();

  gScore[from] = 0;
  heap.push(heuristic(sx, sy, sz, gx, gy, gz), from);
  let iterations = 0;

  while (heap.size) {
    if (++iterations > maxIter) return null;
    const { val: cur } = heap.pop();
    if (cur === to) break;
    if (closed[cur]) continue;
    closed[cur] = 1;

    const [cx, cy, cz] = decode(cur, nx, ny);
    const [px, py, pz] = came[cur] >= 0 ? decode(came[cur], nx, ny) : [cx, cy, cz];

    for (const [dx, dy, dz] of NEI) {
      const nx2 = cx + dx, ny2 = cy + dy, nz2 = cz + dz;
      if (nx2 < 0 || ny2 < 0 || nz2 < 0 || nx2 >= nx || ny2 >= ny || nz2 >= nz) continue;
      const ni = nx2 + nx * (ny2 + ny * nz2);
      if ((occ[ni] && !forceOpen.has(ni)) || closed[ni]) continue;

      let step = 1;
      if (came[cur] >= 0) {
        if (dx !== Math.sign(cx - px) || dy !== Math.sign(cy - py) || dz !== Math.sign(cz - pz)) {
          step += variant.turn;
        }
      }
      // 高度软代价（在硬航点约束基础上进一步塑形）
      if (variant.yMode === 1 && dy < 0) step += 0.15;
      if (variant.yMode === 2 && dy > 0) step += 0.15;

      const tentative = gScore[cur] + step;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        came[ni] = cur;
        heap.push(tentative + heuristic(nx2, ny2, nz2, gx, gy, gz), ni);
      }
    }
  }

  if (came[to] < 0 && to !== from) return null;
  const path = [];
  let n = to;
  while (n !== -1) {
    path.push(n);
    if (n === from) break;
    n = came[n];
  }
  path.reverse();
  return { path, iterations };
}

// 按必经航点分段搜索并拼接（航点单元只出现一次）
function astar(data, variant) {
  // 起终点落在同一网格单元（相邻机柜正对端口）：直接退化为单元内直连
  if (data.start === data.goal) {
    return { path: [data.start], iterations: 1, degenerate: true };
  }
  const waypoints = variant.waypointCells || [];
  const milestones = [data.start, ...waypoints, data.goal];
  const forceOpen = new Set(milestones);
  const merged = [];
  let totalIter = 0;
  for (let k = 0; k < milestones.length - 1; k++) {
    // 相邻航点同单元时跳过该段
    if (milestones[k] === milestones[k + 1]) continue;
    const seg = astarSegment(data, variant, milestones[k], milestones[k + 1], forceOpen);
    if (!seg) return { error: `候选方案 ${variant.key} 在第 ${k + 1} 段无可达通道` };
    totalIter += seg.iterations;
    for (const cellIdx of seg.path) {
      if (merged.length && merged[merged.length - 1] === cellIdx) continue;
      merged.push(cellIdx);
    }
  }
  if (merged.length < 2) return { error: `候选方案 ${variant.key} 路径退化（单元内直连无效）` };
  return { path: merged, iterations: totalIter };
}

self.onmessage = (e) => {
  const { id, data, variants } = e.data;
  const results = [];
  for (const v of variants) {
    // 独立占用栅格副本，避免段间强制开放状态互相污染
    const d = { ...data, occ: data.occ.slice() };
    const r = astar(d, v);
    results.push({ key: v.key, ...r });
  }
  self.postMessage({ id, results });
};
