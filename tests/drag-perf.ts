import { solveField } from '../src/lib/solver/field';
import { defaultFans } from '../src/lib/model/fans';

const t = (label: string, fn: () => void) => {
  fn();
  const t0 = performance.now();
  fn();
  console.log(label, (performance.now() - t0).toFixed(0), 'ms');
};

// warm
solveField(defaultFans(), { maxIter: 5 });
t('full (220 iter)', () => solveField(defaultFans(), { maxIter: 220 }));
t('drag (55 iter, skipAge)', () => solveField(defaultFans(), { maxIter: 55, tol: 3e-3, skipAge: true }));
t('drag (35 iter, skipAge)', () => solveField(defaultFans(), { maxIter: 35, tol: 5e-3, skipAge: true }));
t('drag (20 iter, skipAge)', () => solveField(defaultFans(), { maxIter: 20, tol: 8e-3, skipAge: true }));

const sol = solveField(defaultFans(), { maxIter: 55, tol: 3e-3, skipAge: true });
console.log('iters', sol.stats.iters, 'res', sol.stats.residual.toExponential(2), 'div', sol.stats.residualDivergence.toFixed(2));
console.log('timings', Object.fromEntries(Object.entries(sol.stats.timings).map(([k, v]) => [k, Math.round(v as number)])));
