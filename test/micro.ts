// 微基准：纯算术内层循环 vs 类方法调用
const W = 176, H = 112, SIZE = W * H;
const grid = new Float32Array(SIZE);

function bench(label: string, fn: () => void) {
  fn(); fn();
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) fn();
  console.log(label, ((performance.now() - t0) / 100).toFixed(2), 'ms');
}

// 1. 纯算术（内联坐标计算）
bench('inline arithmetic', () => {
  grid.fill(0);
  const nx = -7.5, ny = 3.15, nz = -2.2;
  const dx = 0, dy = -1, dz = 0;
  const cosHalf = Math.cos(26 * Math.PI / 180);
  for (let j = 0; j < H; j++) {
    const pz = -7 + (j + 0.5) * (14 / H);
    const row = j * W;
    for (let i = 0; i < W; i++) {
      const px = -11 + (i + 0.5) * (22 / W);
      const vx = px - nx, vy = -ny, vz = pz - nz;
      const d2 = vx * vx + vy * vy + vz * vz;
      const d = Math.sqrt(d2);
      if (d < 1e-6) continue;
      const cosA = (vx * dx + vy * dy + vz * dz) / d;
      if (cosA < cosHalf) continue;
      const radial = (cosA - cosHalf) / (1 - cosHalf);
      const decay = 1 / (1 + 0.15 * d2);
      const c = radial * decay;
      if (c > 0.003) grid[row + i] = c;
    }
  }
});

class K {
  w = W; h = H;
  cx(i: number) { return -11 + (i + 0.5) * (22 / this.w); }
  run() {
    grid.fill(0);
    for (let j = 0; j < H; j++) {
      const row = j * W;
      for (let i = 0; i < W; i++) {
        const px = this.cx(i);
        grid[row + i] = px * 2;
      }
    }
  }
}
const k = new K();
bench('method call per cell', () => k.run());
