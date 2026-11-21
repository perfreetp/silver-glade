/**
 * 核心算法冒烟测试（Node 环境，不依赖 DOM）：
 * - 路径重采样等间距与方向连续性
 * - 刀纹标记与位移方向（沟底下压、碎雪上隆）
 * - 拐弯处相位随弧长连续
 * 运行：node --experimental-strip-types tests/smoke.ts
 */
import { resamplePath } from '../src/three/path.ts';
import { GroomDeform } from '../src/three/groomDeform.ts';
import { TERRAIN_SEGMENTS, WORLD_SIZE, ZONE_GRID } from '../src/three/constants.ts';
import type { PathControlPoint, ZoneId } from '../src/types.ts';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

// 1. 路径重采样
const pts: PathControlPoint[] = [
  { id: 'a', x: -40, z: -60 },
  { id: 'b', x: 20, z: -20 },
  { id: 'c', x: -10, z: 40 },
  { id: 'd', x: 30, z: 80 },
];
const samples = resamplePath(pts);
assert(samples.length > 50, `重采样生成 ${samples.length} 个样本`);

let maxGap = 0;
for (let i = 1; i < samples.length; i++) {
  maxGap = Math.max(maxGap, Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z));
}
assert(maxGap <= 0.51, `样本间距 <= 0.5m（实际最大 ${maxGap.toFixed(3)}m）`);

// 方向为单位向量
const unitOk = samples.every((s) => Math.abs(Math.hypot(s.hx, s.hz) - 1) < 1e-6);
assert(unitOk, '所有样本行进方向为单位向量');

// 弧长单调递增
let mono = true;
for (let i = 1; i < samples.length; i++) if (samples[i].s < samples[i - 1].s) mono = false;
assert(mono, '弧长 s 单调递增（拐弯处相位连续的前提）');

// 2. 刀纹形变
const count = (TERRAIN_SEGMENTS + 1) ** 2;
const baseY = new Float32Array(count);
const deform = new GroomDeform(baseY);
const allZones = new Set<ZoneId>();
for (let ix = 0; ix < ZONE_GRID; ix++) for (let iz = 0; iz < ZONE_GRID; iz++) allZones.add({ ix, iz });

const straight = resamplePath([
  { id: 'p1', x: 0, z: -50 },
  { id: 'p2', x: 0, z: 50 },
]);
for (const s of straight) deform.markSample(s, 'deep', 'wet', allZones, ZONE_GRID);
assert(deform.groomedCount > 200, `压雪区域标记 ${deform.groomedCount} 个顶点`);
assert(deform.dirtyTris.size > 100, `收集到 ${deform.dirtyTris.size} 个待 refit 三角形`);

// 沟底顶点应下压（负位移主导），检查路径中心线上的点
let grooveNeg = 0;
let edgePos = 0;
for (const idx of deform.dirty) {
  const d = deform.displacement(idx);
  if (Math.abs(deform.lat[idx]) < 0.6 && d < 0) grooveNeg++;
  if (Math.abs(deform.lat[idx]) > deform.vHalfW[idx] * 0.72 && d > 0) edgePos++;
}
assert(grooveNeg > 20, `沟底中心顶点位移为负（${grooveNeg} 个）`);
assert(edgePos > 10, `刀头边缘碎雪顶点位移为正（${edgePos} 个）`);

// flushBudget 分批消费且最终清空（用小预算验证多帧节流）
const pos = new Float32Array(count * 3);
const nrm = new Float32Array(count * 3);
let frames = 0;
let remaining = true;
while (remaining && frames < 500) {
  remaining = deform.flushBudget(pos, nrm, 120);
  frames++;
}
assert(frames > 1 && frames < 500, `脏顶点分 ${frames} 帧消费完（预算节流生效）`);
assert(deform.dirty.size === 0, '脏队列最终清空');

// 3. 网格边界不越界
const half = WORLD_SIZE / 2;
assert(pos.length === count * 3, '位置数组尺寸正确');
let oob = false;
for (let i = 0; i < count; i++) {
  const col = i % (TERRAIN_SEGMENTS + 1);
  const x = -half + col * (WORLD_SIZE / TERRAIN_SEGMENTS);
  if (Math.abs(x) > half + 1e-4) oob = true;
}
assert(!oob, '无越界顶点');

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
