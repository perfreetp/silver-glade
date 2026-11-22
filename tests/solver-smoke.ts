import { solveField, colorBand } from '../src/lib/solver/field';
import { defaultFans } from '../src/lib/model/fans';
import { ROOM } from '../src/lib/model/room';

const fans = defaultFans();
const t0 = performance.now();
const sol = solveField(fans);
console.log('total ms', (performance.now() - t0).toFixed(1));
console.log('stats', {
  ...sol.stats,
  solveMs: +sol.stats.solveMs.toFixed(1),
  timings: Object.fromEntries(Object.entries(sol.stats.timings).map(([k, v]) => [k, +v.toFixed(1)])),
  residualDivergence: +sol.stats.residualDivergence.toFixed(3),
  maxSpeed: +sol.stats.maxSpeed.toFixed(3),
  meanSpeed: +sol.stats.meanSpeed.toFixed(3),
  p95Speed: +sol.stats.p95Speed.toFixed(3),
  ageMean: +sol.stats.ageMean.toFixed(3),
});
console.log('scaleMax', sol.scaleMax.toFixed(2), 'stops', sol.colorStops.map((s) => s.toFixed(2)).join(', '));

const at = (x: number, y: number, z: number) => {
  const { nx, ny, nz, h } = sol.fine;
  const ix = Math.min(nx - 1, Math.floor(x / h));
  const iy = Math.min(ny - 1, Math.floor(y / h));
  const iz = Math.min(nz - 1, Math.floor(z / h));
  const i = ix + nx * (iz + nz * iy);
  if (sol.solidFine[i]) return 'SOLID';
  const vx = sol.velocity[3 * i],
    vy = sol.velocity[3 * i + 1],
    vz = sol.velocity[3 * i + 2];
  const sp = sol.speed[i];
  return `v=(${vx.toFixed(2)},${vy.toFixed(2)},${vz.toFixed(2)}) |v|=${sp.toFixed(2)} band=${colorBand(sp, sol.colorStops)} age=${sol.age[i] === undefined ? '-' : ''}`;
};
console.log('near west supply (1.0, 3.3, 4.0):', at(1.0, 3.3, 4.0));
console.log('supply core     (2.0, 3.3, 4.0):', at(2.0, 3.3, 4.0));
console.log('mid room        (6.4, 2.0, 4.0):', at(6.4, 2.0, 4.0));
console.log('east return     (11.5, 5.0, 1.15):', at(11.5, 5.0, 1.15));
console.log('side aisle      (6.4, 1.0, 0.5):', at(6.4, 1.0, 0.5));
console.log('inside rack     (6.4, 0.56, 2.5):', at(6.4, 0.56, 2.5));
console.log('between tiers   (6.4, 1.04, 2.5):', at(6.4, 1.04, 2.5));
console.log('near ceiling    (6.4, 6.0, 4.0):', at(6.4, 6.0, 4.0));
console.log('below rack      (6.4, 0.25, 2.5):', at(6.4, 0.25, 2.5));
console.log('far corner      (12.3, 0.3, 7.6):', at(12.3, 0.3, 7.6));

// 细网格散度 (不应太大)
const { nx, ny, nz, h } = sol.fine;
let maxDiv = 0;
for (let y = 2; y < ny - 2; y++)
  for (let z = 2; z < nz - 2; z++)
    for (let x = 2; x < nx - 2; x++) {
      const i = x + nx * (z + nz * y);
      if (sol.solidFine[i]) continue;
      const d =
        (sol.velocity[3 * (i + 1)] - sol.velocity[3 * (i - 1)] + sol.velocity[3 * (i + nx)] - sol.velocity[3 * (i - nx)] + sol.velocity[3 * (i + nx * nz)] - sol.velocity[3 * (i - nx * nz)]) /
        (2 * h);
      if (Math.abs(d) > maxDiv) maxDiv = Math.abs(d);
    }
console.log('max fine divergence', maxDiv.toFixed(2));

// 速度直方图
const bins = new Array(6).fill(0);
let fluid = 0;
for (let i = 0; i < sol.speed.length; i++) {
  if (sol.solidFine[i]) continue;
  fluid++;
  bins[colorBand(sol.speed[i], sol.colorStops)]++;
}
console.log('band distribution %', bins.map((b) => ((b / fluid) * 100).toFixed(1)).join('  '));
console.log('zero-speed voxels %', ((sol.speed.reduce((a, s, i) => a + (!sol.solidFine[i] && s === 0 ? 1 : 0), 0) / fluid) * 100).toFixed(2));

// 质量守恒: 每个风口的通量
console.log('supply m3/h', sol.stats.supplyAirflow, 'exhaust m3/h', sol.stats.exhaustAirflow);
