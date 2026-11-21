import { HumidityField, COVER_EPS } from '../src/core/humidity';
import { rackBoxes } from '../src/core/config';
import { setNozzleCount, store } from '../src/core/store';

const field = new HumidityField(rackBoxes());

// 12 喷头全量重算
setNozzleCount(12);
const nozzles = store.nozzles;
let stats = field.recomputeAll(nozzles);
const totalBefore = Float32Array.from(field.total);

// 校验 1：总量非负且有覆盖
let covered = 0;
for (const v of field.total) if (v > COVER_EPS) covered++;
console.log('covered cells:', covered, '/', field.total.length);
console.log('nozzle 0 stats:', JSON.stringify(stats[0]));

// 校验 2：增量更新与全量重算结果一致
nozzles[3].tilt = 30;
nozzles[3].azimuth = 45;
nozzles[3].spread = 35;
field.updateNozzle(nozzles[3], nozzles);
const incTotal = Float32Array.from(field.total);
field.recomputeAll(nozzles);
let maxDiff = 0;
for (let k = 0; k < field.total.length; k++) {
  maxDiff = Math.max(maxDiff, Math.abs(field.total[k] - incTotal[k]));
}
console.log('incremental vs full max diff:', maxDiff);

// 校验 3：遮挡 —— 架体正下方点应被挡住
// 喷头放在 (0, 3.15, 2.2)，地面点 (0, 0, 0.2) 在架体 z=0 下方附近
const n = { ...nozzles[0], id: 99, x: 0, y: 3.15, z: 2.2, tilt: 25, azimuth: 180, spread: 40, on: true, intensity: 1 };
nozzles.push(n as any);
field.recomputeAll(nozzles);
// 检查遮挡掩码存在非零
let occ = 0;
for (const v of field.occl) if (v) occ++;
console.log('occluded cells:', occ);

// 校验 4：关闭遮挡检查后遮挡掩码应为空且湿度增大
field.occlusionEnabled = false;
field.recomputeAll(nozzles);
let occ2 = 0;
for (const v of field.occl) if (v) occ2++;
console.log('occluded cells (check off):', occ2);

// 校验 5：性能 —— 单喷头增量更新耗时
field.occlusionEnabled = true;
field.recomputeAll(nozzles);
const t0 = performance.now();
for (let i = 0; i < 100; i++) {
  nozzles[0].tilt = (i % 60);
  field.updateNozzle(nozzles[0], nozzles);
}
const t1 = performance.now();
console.log('avg incremental update ms:', ((t1 - t0) / 100).toFixed(2));

const t2 = performance.now();
field.recomputeAll(nozzles);
const t3 = performance.now();
console.log('full recompute (12 nozzles) ms:', (t3 - t2).toFixed(2));

console.log('total changed after edits:', totalBefore.some((v, i) => v !== field.total[i]));
