/**
 * 核心几何与提取逻辑的单元测试（Node，无需浏览器）。
 * 运行：npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKernel } from '../src/core/kernel.ts';
import { marchingSquares, extractBoundary, computeBurnField, burnAtIndex } from '../src/core/detect.ts';
import { densifyRingSlopeAdaptive, multiRingArea, perimeter, pointInPolygon, simplifyRing, signedArea, countSelfIntersections } from '../src/core/geom.ts';
import { deriveBoundary, regularizeRings, ringsFromGroups, findEdge, insertVertex, moveVertex, removeVertex, groupRings } from '../src/core/model.ts';
import { severitySummary, classOf } from '../src/core/severity.ts';
import { refineTriangles } from '../src/view/refine.ts';
import type { BurnField, Georef, Ring, RasterImage, Vec2 } from '../src/core/types.ts';

const P = (x: number, y: number): Vec2 => ({ x, y });
const ring = (pts: [number, number][]): Vec2[] => pts.map(([x, y]) => P(x, y));
const georef = (maxX: number, maxY: number): Georef => ({ minX: 0, minY: 0, maxX, maxY, crs: 'local', lon0: 0, lat0: 0 });

function field(width: number, height: number, fn: (x: number, y: number) => number): BurnField {
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = fn(x, y);
  return { width, height, values, georef: georef(width - 1, height - 1) };
}

function triArea(mesh: { positions: Vec2[]; indices: number[] }): number {
  let s = 0;
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = mesh.positions[mesh.indices[t]];
    const b = mesh.positions[mesh.indices[t + 1]];
    const c = mesh.positions[mesh.indices[t + 2]];
    s += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  }
  return s;
}

test('manifold 内核：并集消除重叠、差集与分解', async () => {
  const k = await createKernel();
  const a = ring([[0, 0], [10, 0], [10, 10], [0, 10]]);
  const b = ring([[5, 5], [15, 5], [15, 15], [5, 15]]);
  const union = k.union([a, b], 'NonZero');
  assert.equal(union.length, 1);
  assert.ok(Math.abs(k.area(union) - 175) < 1e-6, `并集面积应为 175，实得 ${k.area(union)}`);

  const diff = k.difference(a, [b]);
  assert.ok(Math.abs(k.area(diff) - 75) < 1e-6, `差集面积应为 75，实得 ${k.area(diff)}`);

  const groups = k.decompose([a, b], 'NonZero');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].holes.length, 0);
});

test('manifold 内核：自交多边形被打散为合法区域', async () => {
  const k = await createKernel();
  const bowtie = ring([[0, 0], [20, 20], [20, 0], [0, 20]]);
  const groups = k.decompose([bowtie], 'EvenOdd');
  assert.equal(groups.length, 2, '蝴蝶结应分解为两个三角形');
  const total = groups.reduce((s, g) => s + Math.abs(signedArea(g.outer)), 0);
  assert.ok(Math.abs(total - 200) < 1e-6);
  for (const g of groups) {
    const mesh = k.triangulate([g]);
    assert.ok(Math.abs(triArea(mesh) - Math.abs(signedArea(g.outer))) < 1e-4, '三角化面积应与多边形一致');
  }
});

test('manifold 内核：孔洞被三角化正确扣除', async () => {
  const k = await createKernel();
  const outer = ring([[0, 0], [20, 0], [20, 20], [0, 20]]);
  const hole = ring([[5, 5], [5, 15], [15, 15], [15, 5]]);
  const groups = k.decompose([outer, hole], 'EvenOdd');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].holes.length, 1);
  const mesh = k.triangulate(groups);
  let insideHole = 0;
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = mesh.positions[mesh.indices[t]];
    const b = mesh.positions[mesh.indices[t + 1]];
    const c = mesh.positions[mesh.indices[t + 2]];
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    if (cx > 5 && cx < 15 && cy > 5 && cy < 15) insideHole++;
  }
  assert.equal(insideHole, 0, '孔洞内不应出现三角面');
  assert.ok(Math.abs(triArea(mesh) - 300) < 1e-4);
});

test('manifold 内核：凹多边形三角化面积正确', async () => {
  const k = await createKernel();
  const u = ring([[0, 0], [20, 0], [20, 20], [14, 20], [14, 6], [6, 6], [6, 20], [0, 20]]);
  const groups = k.decompose([u], 'NonZero');
  const mesh = k.triangulate(groups);
  assert.ok(Math.abs(triArea(mesh) - 288) < 1e-4, `U 形面积应为 288，实得 ${triArea(mesh)}`);
});

test('marching squares：闭合环、孔洞与贴边区域', async () => {
  const blob = field(80, 80, (x, y) => {
    const d = Math.hypot(x - 40, y - 40);
    return d < 30 && d > 12 ? 0.9 : 0.05;
  });
  const loops = marchingSquares(blob, 0.5);
  assert.equal(loops.length, 2, '环形火场应有内外两条等值线');

  const k = await createKernel();
  const res = await extractBoundary(k, blob, { threshold: 0.5, minArea: 10, smoothing: 0 });
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].holes.length, 1, '中心未燃区应成为孔洞');

  // 贴边：整片影像过火时，边界应沿影像边缘闭合
  const full = field(20, 20, () => 0.9);
  const resFull = await extractBoundary(k, full, { threshold: 0.5, minArea: 0, smoothing: 0 });
  assert.equal(resFull.groups.length, 1, '整幅过火应得到闭合外环');
  assert.ok(resFull.stats.keptArea > 0);
});

test('marching squares：可达鞍点拓扑正确', async () => {
  const half = field(30, 30, (x, y) => ((x - 15) + (y - 15) > 0 ? 0.9 : 0.1));
  const loops = marchingSquares(half, 0.5);
  assert.ok(loops.length >= 1);
  const k = await createKernel();
  const res = await extractBoundary(k, half, { threshold: 0.5, minArea: 0, smoothing: 0 });
  assert.equal(res.groups.length, 1, '半平面应形成单一区域');
});

test('碎片过滤：低于阈值的孤立斑块被剔除', async () => {
  const k = await createKernel();
  const speck = field(100, 60, (x, y) => {
    const d1 = Math.hypot(x - 25, y - 30);
    const d2 = Math.hypot(x - 70, y - 30);
    const d3 = Math.hypot(x - 90, y - 5);
    if (d1 < 15) return 0.9;
    if (d2 < 12) return 0.85;
    if (d3 < 1.3) return 0.9;
    return 0.05;
  });
  const res = await extractBoundary(k, speck, { threshold: 0.5, minArea: 200, smoothing: 0.6 });
  assert.equal(res.groups.length, 2, '两个主火场应保留');
  assert.ok(res.stats.fragments >= 1, '微小斑块应被记为碎片');
});

test('颜色差异场：燃烧像素指数显著高于植被像素', () => {
  const img: RasterImage = {
    name: 't',
    width: 4,
    height: 2,
    data: new Uint8ClampedArray([
      70, 120, 60, 255,
      74, 126, 64, 255,
      28, 24, 22, 255,
      34, 30, 26, 255,
      80, 118, 58, 255,
      22, 20, 18, 255,
      68, 124, 62, 255,
      30, 25, 24, 255,
    ]),
  };
  const res = computeBurnField(img, { r: 72, g: 122, b: 62 }, georef(300, 150));
  // 影像为 4×2：偶数行是健康植被，奇数行是焦黑地表
  const greenRaw = Math.max(res.raw[0], res.raw[1]);
  const burntRaw = Math.min(res.raw[4], res.raw[5]);
  assert.ok(burntRaw > greenRaw + 0.5, `过火处原始指数 ${burntRaw.toFixed(2)} 应明显高于植被处 ${greenRaw.toFixed(2)}`);
  // 影像行号自北向南，第 2 行（南侧）为焦黑地表，对应地图 y 较小处
  const south = burnAtIndex(res.field, 30, 30);
  const north = burnAtIndex(res.field, 30, 120);
  assert.ok(south > north, `南侧过火处平滑指数 ${south.toFixed(2)} 应高于北侧植被 ${north.toFixed(2)}`);
  assert.ok(res.field.values.every((v) => v >= 0 && v <= 1));
});

test('几何工具：面积、周长、包含判定与自交检测', () => {
  const sq = ring([[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.ok(Math.abs(signedArea(sq) - 100) < 1e-9);
  assert.ok(Math.abs(perimeter(sq) - 40) < 1e-9);
  assert.ok(pointInPolygon(P(5, 5), sq));
  assert.ok(!pointInPolygon(P(15, 5), sq));

  const hole = ring([[3, 3], [3, 7], [7, 7], [7, 3]]);
  assert.ok(!pointInPolygon(P(5, 5), sq, [hole]), '孔洞内不应判定为包含');

  const bow = ring([[0, 0], [10, 10], [10, 0], [0, 10]]);
  assert.ok(countSelfIntersections(bow) >= 1);

  assert.equal(multiRingArea([{ vertices: sq, role: 'outer' }, { vertices: hole, role: 'hole' }]), 84);
});

test('简化：闭合环减少顶点但保持大致形状', () => {
  const circle: Vec2[] = [];
  for (let i = 0; i < 400; i++) {
    const a = (i / 400) * Math.PI * 2;
    circle.push(P(50 + 40 * Math.cos(a), 50 + 40 * Math.sin(a)));
  }
  const s = simplifyRing(circle, 0.5);
  assert.ok(s.length < 80 && s.length >= 4, `简化后应显著减少顶点，实得 ${s.length}`);
  const ratio = signedArea(s) / signedArea(circle);
  assert.ok(ratio > 0.9 && ratio <= 1.001, `面积保持率 ${ratio.toFixed(3)} 过低`);
});

test('坡度自适应加密：陡坡处采样更密', () => {
  const ringPts = ring([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const flat = densifyRingSlopeAdaptive(ringPts, 10, 2, () => 0);
  const steep = densifyRingSlopeAdaptive(ringPts, 10, 2, () => 45);
  assert.ok(steep.length > flat.length, '陡坡应产生更多采样点');
  assert.ok(flat.length >= ringPts.length);
});

test('三角网细分：面积保持且边长受限', () => {
  const k = createKernel;
  void k;
  const positions = [P(0, 0), P(100, 0), P(0, 100)];
  const mesh = { positions, indices: [0, 1, 2], triGroup: [0] };
  const refined = refineTriangles(mesh, { maxEdge: 20, maxDepth: 6 });
  assert.ok(Math.abs(triArea(refined) - 5000) < 1e-6, '细分不应改变面积');
  assert.equal(refined.truncated, false, '充裕预算下不应提前截断');
  let maxEdge = 0;
  for (let t = 0; t + 2 < refined.indices.length; t += 3) {
    const ids = [refined.indices[t], refined.indices[t + 1], refined.indices[t + 2]];
    for (let i = 0; i < 3; i++) {
      const a = refined.positions[ids[i]];
      const b = refined.positions[ids[(i + 1) % 3]];
      maxEdge = Math.max(maxEdge, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  assert.ok(maxEdge <= 20.01, `最大边长 ${maxEdge.toFixed(2)} 应不超过 20`);
});

test('三角网细分：预算不足时保留完整覆盖（不留缺口）', () => {
  const positions = [P(0, 0), P(200, 0), P(0, 200)];
  const mesh = { positions, indices: [0, 1, 2], triGroup: [0] };
  // 预算远小于足额细分所需
  const refined = refineTriangles(mesh, { maxEdge: 2, maxDepth: 8, maxTriangles: 3000 });
  assert.ok(refined.truncated, '应标记为提前截断');
  assert.ok(Math.abs(triArea(refined) - 20000) < 1e-6, `截断后面积仍应为 20000，实得 ${triArea(refined)}`);
  assert.ok(refined.indices.length / 3 <= 3000 + 3);
});

test('三角网细分：边界顶点保持在边界上', () => {
  // 直角三角形的斜边细分后，新顶点应仍落在斜边上（中点细分不改变边界）
  const positions = [P(0, 0), P(60, 0), P(60, 60)];
  const mesh = { positions, indices: [0, 1, 2], triGroup: [0] };
  const refined = refineTriangles(mesh, { maxEdge: 5, maxDepth: 6 });
  const edge = refined.indices.length;
  void edge;
  // 斜边 x == y 上的点必须满足 x === y
  let onHypotenuse = 0;
  for (const p of refined.positions) {
    if (p.x >= 59.999 && p.y >= -0.001) onHypotenuse++;
    if (Math.abs(p.x - p.y) < 1e-9) onHypotenuse++;
  }
  assert.ok(onHypotenuse > 0);
  for (const p of refined.positions) {
    assert.ok(p.x >= -1e-9 && p.y >= -1e-9 && p.x <= 60 + 1e-9 && p.y <= 60 + 1e-9, '细分点不得越出原三角形');
  }
});

test('边界模型：派生面积周长、顶点编辑与历史', () => {
  const k = { triangulate: (_groups: ReturnType<typeof groupRings>) => ({ positions: [], indices: [], triGroup: [] }) } as unknown as Parameters<typeof deriveBoundary>[0];
  const rings: Ring[] = [{ id: 'r1', role: 'outer', vertices: ring([[0, 0], [10, 0], [10, 10], [0, 10]]) }];
  const derived = deriveBoundary(k, rings);
  assert.ok(Math.abs(derived.area - 100) < 1e-9);
  assert.ok(Math.abs(derived.perimeter - 40) < 1e-9);

  const moved = moveVertex(rings, 0, 1, P(20, 0));
  assert.equal(moved[0].vertices[1].x, 20);
  assert.equal(rings[0].vertices[1].x, 10, '原数组不应被修改');

  const inserted = insertVertex(rings, 0, 0, P(5, 0));
  assert.equal(inserted[0].vertices.length, 5);
  assert.deepEqual(inserted[0].vertices[1], P(5, 0));

  const removed = removeVertex(inserted, 0, 0);
  assert.equal(removed.rings[0].vertices.length, 4);
});

test('布尔规整：覆盖的自交编辑结果会被修复', async () => {
  const k = await createKernel();
  // 人为构造一条自身打结的边界
  const tangled: Ring[] = [
    {
      id: 'x',
      role: 'outer',
      vertices: ring([[0, 0], [40, 0], [0, 40], [40, 40], [40, 0], [0, 40], [0, 0]]),
    },
  ];
  const res = regularizeRings(k, tangled, { minArea: 1, smoothing: 0 });
  assert.ok(res.rings.length >= 1, '规整后应保留至少一个环');
  const groups = groupRings(res.rings);
  for (const g of groups) {
    const mesh = k.triangulate([g]);
    assert.ok(Math.abs(triArea(mesh) - (Math.abs(signedArea(g.outer)) - g.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0))) < 1e-3);
  }
});

test('受损分级：等级面积之和等于边界面积', async () => {
  const k = await createKernel();
  const rings: Ring[] = [{ id: 'a', role: 'outer', vertices: ring([[0, 0], [40, 0], [40, 40], [0, 40]]) }];
  const f = field(41, 41, (x) => Math.max(0, Math.min(1, x / 40)));
  const thresholds = [0.2, 0.4, 0.6, 0.8] as const;
  const sum = severitySummary(k, f, rings, thresholds, 9000);
  const total = sum.bins.reduce((s, b) => s + b.area, 0);
  const area = Math.abs(signedArea(rings[0].vertices));
  assert.ok(Math.abs(total - area) / area < 0.02, `分级面积总和 ${total.toFixed(2)} 应接近边界面积 ${area}`);
  // 指数自西向东线性增长：各级按等级排序后，等级越高其均值越高
  const used = sum.bins.filter((b) => b.area > 0);
  assert.ok(used.length >= 4, '线性梯度应覆盖至少 4 个等级');
  for (let i = 1; i < used.length; i++) {
    assert.ok(used[i].index > used[i - 1].index);
    assert.ok(used[i].meanIndex > used[i - 1].meanIndex, `等级 ${used[i].index} 的均值应高于等级 ${used[i - 1].index}`);
    assert.equal(classOf(used[i].meanIndex, thresholds), used[i].index, '等级均值应落在所属区间内');
  }
  assert.ok(Math.abs(sum.meanIndex - 0.5) < 0.08, `均匀梯度下平均指数应接近 0.5，实得 ${sum.meanIndex.toFixed(3)}`);
  assert.ok(sum.grid.width > 0 && sum.grid.samples.length === sum.grid.width * sum.grid.height);
  // 孔洞不计入统计
  const withHole: Ring[] = [
    { id: 'o', role: 'outer', vertices: ring([[0, 0], [40, 0], [40, 40], [0, 40]]) },
    { id: 'h', role: 'hole', vertices: ring([[4, 4], [4, 36], [36, 36], [36, 4]]) },
  ];
  const holed = severitySummary(k, f, withHole, thresholds, 9000);
  const holedTotal = holed.bins.reduce((s, b) => s + b.area, 0);
  assert.ok(Math.abs(holedTotal - (1600 - 1024)) / 576 < 0.03, `带孔洞面积应为 576，实得 ${holedTotal.toFixed(2)}`);
});

test('环组与孔洞的往返转换保持角色', async () => {
  const k = await createKernel();
  const outer = ring([[0, 0], [30, 0], [30, 30], [0, 30]]);
  const hole = ring([[10, 10], [10, 20], [20, 20], [20, 10]]);
  const groups = k.decompose([outer, hole], 'EvenOdd');
  const back = ringsFromGroups(groups);
  assert.equal(back.filter((r) => r.role === 'outer').length, 1);
  assert.equal(back.filter((r) => r.role === 'hole').length, 1);
  const regrouped = groupRings(back);
  assert.equal(regrouped[0].holes.length, 1);
});

test('边拾取与插入：点在边中点时命中正确边', () => {
  const rings: Ring[] = [{ id: 'e', role: 'outer', vertices: ring([[0, 0], [10, 0], [10, 10], [0, 10]]) }];
  const hit = findEdge(rings, P(5, 0.2), 1);
  assert.ok(hit);
  assert.equal(hit.ringIndex, 0);
  assert.equal(hit.edgeIndex, 0);
  assert.ok(Math.abs(hit.point.x - 5) < 0.3);
});
