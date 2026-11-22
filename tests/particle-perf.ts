// CPU cost of the particle update (no GPU involved).
import { TrailParticles } from '../src/lib/render/particles';
import { solveField } from '../src/lib/solver/field';
import { createSampler } from '../src/lib/render/sampler';
import { defaultFans } from '../src/lib/model/fans';
import { colorBand } from '../src/lib/solver/field';

const sol = solveField(defaultFans());
const sampler = createSampler(sol);
const seeds: { x: number; y: number; z: number }[] = [];
for (let i = 0; i < 12000; i++) {
  let x = 0, y = 0, z = 0;
  do {
    x = 0.2 + Math.random() * 12.4;
    y = 0.2 + Math.random() * 6;
    z = 0.2 + Math.random() * 7.6;
  } while (!sampler.isFluid(x, y, z));
  seeds.push({ x, y, z });
}

for (const budget of [6000, 9000, 12000]) {
  const ps = new TrailParticles({ maxParticles: budget, trailPoints: 14 });
  ps.setPrefillSampler(sampler.sample);
  ps.setSeeds(seeds.slice(0, budget), 0.05);
  const colorize = (speed: number, _x: number, _y: number, _z: number, out: [number, number, number]) => {
    out[0] = colorBand(speed, sol.colorStops) / 6;
    out[1] = 0.5;
    out[2] = 1;
  };
  // warm
  for (let i = 0; i < 5; i++) ps.update(1 / 60, sampler.sample, colorize, {});
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) ps.update(1 / 60, sampler.sample, colorize, {});
  console.log(`particles=${budget}: ${((performance.now() - t0) / 30).toFixed(2)} ms/frame`);
  ps.dispose();
}
