// 确定性三维值噪声 + 分形叠加,用于地形与云体形态调制

function hash3(ix: number, iy: number, iz: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise3(x: number, y: number, z: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = fade(x - x0), fy = fade(y - y0), fz = fade(z - z0);
  const c000 = hash3(x0, y0, z0),     c100 = hash3(x0 + 1, y0, z0);
  const c010 = hash3(x0, y0 + 1, z0), c110 = hash3(x0 + 1, y0 + 1, z0);
  const c001 = hash3(x0, y0, z0 + 1), c101 = hash3(x0 + 1, y0, z0 + 1);
  const c011 = hash3(x0, y0 + 1, z0 + 1), c111 = hash3(x0 + 1, y0 + 1, z0 + 1);
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0v = x00 + (x10 - x00) * fy;
  const y1v = x01 + (x11 - x01) * fy;
  return y0v + (y1v - y0v) * fz;
}

export function fbm3(x: number, y: number, z: number, octaves = 3): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** 地形高度(km),x/z 单位 km,范围 0..60 */
export function terrainHeight(xKm: number, zKm: number): number {
  const base = fbm3(xKm * 0.06, 0.5, zKm * 0.06, 4);
  const ridge = Math.max(0, fbm3(xKm * 0.02 + 10, 3.7, zKm * 0.02, 3) - 0.45) * 2.4;
  return Math.min(1.6, base * 0.85 + ridge);
}
