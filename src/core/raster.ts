/** 影像 / 高程数据的读取与采样。 */

import type { ElevationGrid, Georef, RasterImage } from './types.ts';
import { clamp, elevationToColor } from './util.ts';

export const MAX_IMAGE_DIM = 1600;

/** 读取图片文件为栅格；超大影像按比例降采样以控制内存 */
export async function loadRasterImage(file: File): Promise<RasterImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(2, Math.round(bitmap.width * scale));
  const h = Math.max(2, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('浏览器不支持 Canvas 2D');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  bitmap.close?.();
  return { name: file.name, width: w, height: h, data: img.data };
}

/** 读取 ESRI ASCII 网格格式（.asc/.txt） */
export function parseEsriAscii(text: string, name: string): { grid: ElevationGrid; georef?: Partial<Georef> } {
  const lines = text.split(/\r?\n/);
  const header: Record<string, number> = {};
  let idx = 0;
  const keys = ['ncols', 'nrows', 'xllcorner', 'xllcenter', 'yllcorner', 'yllcenter', 'cellsize', 'nodata_value'];
  for (; idx < lines.length; idx++) {
    const parts = lines[idx].trim().split(/[\s,]+/);
    if (parts.length !== 2 || !keys.includes(parts[0].toLowerCase())) break;
    header[parts[0].toLowerCase()] = Number(parts[1]);
  }
  const ncols = header.ncols;
  const nrows = header.nrows;
  if (!ncols || !nrows) throw new Error('无法解析 ASCII 网格头（缺少 ncols/nrows）');
  const cell = header.cellsize ?? 1;
  const nodata = header.nodata_value ?? -9999;
  const heights = new Float32Array(ncols * nrows);
  let minElev = Infinity;
  let maxElev = -Infinity;
  const values: number[] = [];
  for (; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;
    for (const tok of line.split(/[\s,]+/)) {
      const v = Number(tok);
      if (tok === '' || Number.isNaN(v)) continue;
      values.push(v);
    }
  }
  // ASCII 网格第一行为北侧
  for (let i = 0; i < ncols * nrows; i++) {
    let v = values[i];
    if (v === undefined || v === nodata) v = NaN;
    heights[i] = v;
    if (Number.isFinite(v)) {
      if (v < minElev) minElev = v;
      if (v > maxElev) maxElev = v;
    }
  }
  if (!Number.isFinite(minElev)) {
    minElev = 0;
    maxElev = 1;
  }
  // 填补 NODATA 为附近均值
  for (let i = 0; i < heights.length; i++) {
    if (!Number.isFinite(heights[i])) heights[i] = (minElev + maxElev) / 2;
  }
  const x0 = header.xllcorner ?? header.xllcenter ?? 0;
  const y0 = header.yllcorner ?? header.yllcenter ?? 0;
  return {
    grid: { name, width: ncols, height: nrows, heights, minElev, maxElev },
    georef: { minX: x0, minY: y0, maxX: x0 + ncols * cell, maxY: y0 + nrows * cell },
  };
}

/** 由灰度图片构建高程（按用户给定的高程范围） */
export async function demFromImage(file: File, minElev: number, maxElev: number): Promise<ElevationGrid> {
  const raster = await loadRasterImage(file);
  const heights = new Float32Array(raster.width * raster.height);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const o = i * 4;
    const v = 0.299 * raster.data[o] + 0.587 * raster.data[o + 1] + 0.114 * raster.data[o + 2];
    heights[i] = minElev + (v / 255) * (maxElev - minElev);
    if (heights[i] < lo) lo = heights[i];
    if (heights[i] > hi) hi = heights[i];
  }
  return { name: file.name, width: raster.width, height: raster.height, heights, minElev: lo, maxElev: hi };
}

/** 影像像素采样（最近邻），u,v 为 0..1，v=0 对应北侧 */
export function sampleRaster(img: RasterImage, u: number, v: number): [number, number, number] {
  const x = clamp(Math.floor(u * img.width), 0, img.width - 1);
  const y = clamp(Math.floor(v * img.height), 0, img.height - 1);
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
}

/** 双线性高程采样（地图坐标 → 米） */
export function elevationAt(dem: ElevationGrid | null, georef: Georef, x: number, y: number): number {
  if (!dem) return 0;
  const u = (x - georef.minX) / (georef.maxX - georef.minX || 1);
  const v = (georef.maxY - y) / (georef.maxY - georef.minY || 1);
  return bilinear(dem.heights, dem.width, dem.height, clamp(u, 0, 1) * (dem.width - 1), clamp(v, 0, 1) * (dem.height - 1));
}

function bilinear(data: Float32Array, w: number, h: number, fx: number, fy: number): number {
  const x0 = clamp(Math.floor(fx), 0, w - 1);
  const y0 = clamp(Math.floor(fy), 0, h - 1);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const v00 = data[y0 * w + x0];
  const v10 = data[y0 * w + x1];
  const v01 = data[y1 * w + x0];
  const v11 = data[y1 * w + x1];
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

/** 坡度（度），基于高程有限差分，单位为米/米 */
export function slopeAt(dem: ElevationGrid | null, georef: Georef, x: number, y: number): number {
  if (!dem) return 0;
  const dx = (georef.maxX - georef.minX) / Math.max(1, dem.width - 1);
  const dy = (georef.maxY - georef.minY) / Math.max(1, dem.height - 1);
  const step = Math.max(dx, dy);
  const hL = elevationAt(dem, georef, x - step, y);
  const hR = elevationAt(dem, georef, x + step, y);
  const hD = elevationAt(dem, georef, x, y - step);
  const hU = elevationAt(dem, georef, x, y + step);
  const gx = (hR - hL) / (2 * step);
  const gy = (hU - hD) / (2 * step);
  return (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
}

/** 坡向（度，正北为 0，顺时针） */
export function aspectAt(dem: ElevationGrid | null, georef: Georef, x: number, y: number): number {
  if (!dem) return 0;
  const dx = (georef.maxX - georef.minX) / Math.max(1, dem.width - 1);
  const dy = (georef.maxY - georef.minY) / Math.max(1, dem.height - 1);
  const step = Math.max(dx, dy);
  const gx = (elevationAt(dem, georef, x + step, y) - elevationAt(dem, georef, x - step, y)) / (2 * step);
  const gy = (elevationAt(dem, georef, x, y + step) - elevationAt(dem, georef, x, y - step)) / (2 * step);
  const deg = (Math.atan2(-gx, -gy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** 由 DEM 渲染一张着色预览（用于“无影像”时的底图） */
export function demToCanvas(dem: ElevationGrid, maxDim = 512): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(dem.width, dem.height));
  const w = Math.max(2, Math.round(dem.width * scale));
  const h = Math.max(2, Math.round(dem.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(w, h);
  const range = dem.maxElev - dem.minElev || 1;
  const dx = dem.width / w;
  const dy = dem.height / h;
  // 计算法线用于打光
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.floor(x * dx);
      const sy = Math.floor(y * dy);
      const e = dem.heights[sy * dem.width + sx];
      const t = (e - dem.minElev) / range;
      let [r, g, b] = elevationToColor(t);
      const eL = dem.heights[sy * dem.width + Math.max(0, sx - 1)];
      const eR = dem.heights[sy * dem.width + Math.min(dem.width - 1, sx + 1)];
      const eU = dem.heights[Math.max(0, sy - 1) * dem.width + sx];
      const eD = dem.heights[Math.min(dem.height - 1, sy + 1) * dem.width + sx];
      const gx = (eR - eL) / (dem.maxElev - dem.minElev || 1);
      const gy = (eD - eU) / (dem.maxElev - dem.minElev || 1);
      const shade = clamp(0.85 - gx * 2.2 + gy * 1.6, 0.35, 1.45);
      r *= shade;
      g *= shade;
      b *= shade;
      const o = (y * w + x) * 4;
      image.data[o] = clamp(r, 0, 255);
      image.data[o + 1] = clamp(g, 0, 255);
      image.data[o + 2] = clamp(b, 0, 255);
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
