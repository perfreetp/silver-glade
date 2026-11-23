import type { TerrainData } from './types';

/** 双线性插值采样地形高度,超出范围时取边缘值 */
export function heightAt(t: TerrainData, x: number, z: number): number {
  const { size, res, heights } = t;
  const fx = ((x + size / 2) / size) * (res - 1);
  const fz = ((size / 2 - z) / size) * (res - 1);
  const cx = Math.min(res - 2, Math.max(0, Math.floor(fx)));
  const cz = Math.min(res - 2, Math.max(0, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - cx));
  const tz = Math.min(1, Math.max(0, fz - cz));
  const h00 = heights[cz * res + cx];
  const h10 = heights[cz * res + cx + 1];
  const h01 = heights[(cz + 1) * res + cx];
  const h11 = heights[(cz + 1) * res + cx + 1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}
