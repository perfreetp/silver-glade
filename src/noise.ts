/** 确定性伪随机数生成器(mulberry32) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * 用分形值噪声生成地形高度网格。
 * @param res 网格分辨率
 * @param seed 随机种子
 * @param amplitude 最大起伏幅度(米)
 */
export function generateHeights(res: number, seed: number, amplitude: number): number[] {
  const rand = mulberry32(seed);
  const octaves = [4, 8, 16, 32];
  const weights = [1, 0.5, 0.25, 0.125];
  const layers = octaves.map((n) => {
    const g = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i < g.length; i++) g[i] = rand();
    return { n, g };
  });
  const out = new Array<number>(res * res);
  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const u = c / (res - 1);
      const v = r / (res - 1);
      let h = 0;
      let wsum = 0;
      for (let o = 0; o < layers.length; o++) {
        const { n, g } = layers[o];
        const x = u * n;
        const y = v * n;
        const x0 = Math.min(n - 1, Math.floor(x));
        const y0 = Math.min(n - 1, Math.floor(y));
        const tx = smooth(x - x0);
        const ty = smooth(y - y0);
        const v00 = g[y0 * (n + 1) + x0];
        const v10 = g[y0 * (n + 1) + x0 + 1];
        const v01 = g[(y0 + 1) * (n + 1) + x0];
        const v11 = g[(y0 + 1) * (n + 1) + x0 + 1];
        const val = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
        h += val * weights[o];
        wsum += weights[o];
      }
      h /= wsum;
      out[r * res + c] = (h - 0.5) * 2 * amplitude;
    }
  }
  return out;
}
