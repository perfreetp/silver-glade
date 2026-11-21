import { HumidityField } from '../src/core/humidity';
import { rackBoxes } from '../src/core/config';
import { setNozzleCount, store } from '../src/core/store';

const field = new HumidityField(rackBoxes());
setNozzleCount(12);
const nozzles = store.nozzles;
field.recomputeAll(nozzles);

// 分项计时
let t0 = performance.now();
for (let i = 0; i < 50; i++) (field as any).computeInto(nozzles[0], new Float32Array(field.total.length), new Uint8Array(field.total.length));
console.log('computeInto x1 avg ms:', ((performance.now() - t0) / 50).toFixed(2));

t0 = performance.now();
for (let i = 0; i < 50; i++) (field as any).rebuildOccl();
console.log('rebuildOccl avg ms:', ((performance.now() - t0) / 50).toFixed(2));

t0 = performance.now();
for (let i = 0; i < 50; i++) (field as any).buildStats(nozzles);
console.log('buildStats avg ms:', ((performance.now() - t0) / 50).toFixed(2));

t0 = performance.now();
for (let i = 0; i < 50; i++) field.globalStats(1.0);
console.log('globalStats avg ms:', ((performance.now() - t0) / 50).toFixed(2));
