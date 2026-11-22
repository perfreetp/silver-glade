import { solveField } from '../src/lib/solver/field';
import { createSampler } from '../src/lib/render/sampler';
import { ROOM } from '../src/lib/model/room';
import { defaultFans } from '../src/lib/model/fans';

const sol = solveField(defaultFans());
const s = createSampler(sol);
const out = new Float32Array(3);
let leaks = 0,
  total = 0,
  stuck = 0;
let minY = 9,
  maxY = -9;
const xs: number[] = [],
  ys: number[] = [];
for (let i = 0; i < 4000; i++) {
  let x = 0.3 + Math.random() * (ROOM.lx - 0.6);
  let y = 0.3 + Math.random() * (ROOM.ly - 0.6);
  let z = 0.3 + Math.random() * (ROOM.lz - 0.6);
  if (!s.isFluid(x, y, z)) continue;
  let alive = true;
  for (let step = 0; step < 600; step++) {
    if (!s.sample(x, y, z, out)) { alive = false; break; }
    const sp = Math.hypot(out[0], out[1], out[2]);
    const dt = 0.016;
    let t = dt;
    if (sp * t > 0.055) t = 0.055 / sp;
    x += out[0] * t;
    y += out[1] * t;
    z += out[2] * t;
    if (x < -0.001 || y < -0.001 || z < -0.001 || x > ROOM.lx + 0.001 || y > ROOM.ly + 0.001 || z > ROOM.lz + 0.001) {
      leaks++;
      break;
    }
  }
  total++;
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
  if (Math.random() < 0.05) { xs.push(x); ys.push(y); }
}
console.log('total', total, 'leaks', leaks, 'minY', minY.toFixed(2), 'maxY', maxY.toFixed(2));
console.log('sample final y', ys.slice(0, 10).map((v) => v.toFixed(2)).join(' '));
console.log('sample final x', xs.slice(0, 10).map((v) => v.toFixed(2)).join(' '));

// 静止粒子比例
let still = 0;
for (let i = 0; i < 4000; i++) {
  const x = 0.3 + Math.random() * (ROOM.lx - 0.6);
  const y = 0.3 + Math.random() * (ROOM.ly - 0.6);
  const z = 0.3 + Math.random() * (ROOM.lz - 0.6);
  if (!s.isFluid(x, y, z)) continue;
  if (s.sample(x, y, z, out) && Math.hypot(out[0], out[1], out[2]) < 0.02) still++;
}
console.log('still fraction', (still / total).toFixed(3));
