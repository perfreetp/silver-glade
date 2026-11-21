import { HumidityField } from '../src/core/humidity';
import { rackBoxes } from '../src/core/config';
import { setNozzleCount, store } from '../src/core/store';

const field = new HumidityField(rackBoxes());
setNozzleCount(12);
const reactiveNozzle = store.nozzles[0];
const plainNozzle = { ...reactiveNozzle };

function bench(label: string, fn: () => void) {
  fn(); fn();
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) fn();
  console.log(label, ((performance.now() - t0) / 100).toFixed(2), 'ms');
}

const g = new Float32Array(field.total.length);
const b = new Uint8Array(field.total.length);
bench('computeInto reactive nozzle', () => (field as any).computeInto(reactiveNozzle, g, b));
bench('computeInto plain nozzle', () => (field as any).computeInto(plainNozzle, g, b));

// 关闭遮挡再测
field.occlusionEnabled = false;
bench('computeInto plain, no occlusion', () => (field as any).computeInto(plainNozzle, g, b));
field.occlusionEnabled = true;

// buildStats: 响应式 vs 普通数组
const plainNozzles = store.nozzles.map((n) => ({ ...n }));
field.recomputeAll(store.nozzles);
bench('buildStats reactive list', () => (field as any).buildStats(store.nozzles));
bench('buildStats plain list', () => (field as any).buildStats(plainNozzles));
