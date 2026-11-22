/**
 * 温度色带（分段线性查找表）
 *
 * 设计目标：
 *  - 冷端（25℃）用深蓝，热端（60℃）用亮红，中间经过青、绿、黄、橙
 *  - 色带在感知上尽量均匀（在 Lab 空间插值近似为分段 LUT）
 *  - 色带以 256 像素宽的 RGBA 纹理上传，GPU 端 textureSampleLevel 采样
 *
 * 提供三套色带，可在 UI 切换：
 *   thermal —— 冷蓝 -> 青 -> 绿 -> 黄 -> 橙 -> 红（默认）
 *   inferno —— 近似 matplotlib inferno
 *   viridis —— 近似 matplotlib viridis
 */

import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Scene } from "@babylonjs/core/scene";

export type PaletteId = "thermal" | "inferno" | "viridis";

export interface PaletteDef {
  id: PaletteId;
  label: string;
  /** 关键色节点，t=0..1 */
  stops: { t: number; rgb: [number, number, number] }[];
}

export const PALETTES: PaletteDef[] = [
  {
    id: "thermal",
    label: "热力（蓝→红）",
    stops: [
      { t: 0.0, rgb: [0.10, 0.22, 0.72] },
      { t: 0.20, rgb: [0.10, 0.62, 0.86] },
      { t: 0.38, rgb: [0.18, 0.82, 0.66] },
      { t: 0.54, rgb: [0.72, 0.88, 0.26] },
      { t: 0.70, rgb: [0.98, 0.78, 0.18] },
      { t: 0.85, rgb: [0.98, 0.48, 0.12] },
      { t: 1.0, rgb: [0.86, 0.10, 0.16] },
    ],
  },
  {
    id: "inferno",
    label: "炽焰（inferno）",
    stops: [
      { t: 0.0, rgb: [0.00, 0.00, 0.02] },
      { t: 0.16, rgb: [0.16, 0.05, 0.32] },
      { t: 0.32, rgb: [0.44, 0.07, 0.42] },
      { t: 0.48, rgb: [0.71, 0.16, 0.30] },
      { t: 0.64, rgb: [0.89, 0.34, 0.11] },
      { t: 0.80, rgb: [0.98, 0.60, 0.08] },
      { t: 0.92, rgb: [0.99, 0.85, 0.30] },
      { t: 1.0, rgb: [0.98, 0.99, 0.75] },
    ],
  },
  {
    id: "viridis",
    label: "类地（viridis）",
    stops: [
      { t: 0.0, rgb: [0.27, 0.00, 0.33] },
      { t: 0.16, rgb: [0.28, 0.14, 0.46] },
      { t: 0.32, rgb: [0.23, 0.32, 0.55] },
      { t: 0.48, rgb: [0.13, 0.48, 0.55] },
      { t: 0.64, rgb: [0.18, 0.63, 0.46] },
      { t: 0.80, rgb: [0.48, 0.76, 0.32] },
      { t: 0.92, rgb: [0.78, 0.86, 0.19] },
      { t: 1.0, rgb: [0.99, 0.91, 0.14] },
    ],
  },
];

export const LUT_WIDTH = 256;

/** 在 0..1 上对关键色节点做线性插值，返回 256x1 的 RGBA 纹理数据。 */
export function buildPaletteData(palette: PaletteDef): Uint8Array {
  const data = new Uint8Array(LUT_WIDTH * 4);
  const stops = palette.stops.slice().sort((a, b) => a.t - b.t);
  for (let i = 0; i < LUT_WIDTH; i++) {
    const t = i / (LUT_WIDTH - 1);
    let lo = stops[0];
    let hi = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s].t && t <= stops[s + 1].t) {
        lo = stops[s];
        hi = stops[s + 1];
        break;
      }
    }
    const span = Math.max(hi.t - lo.t, 1e-6);
    const f = Math.min(1, Math.max(0, (t - lo.t) / span));
    // 在 gamma 空间插值即可，视觉上足够平滑
    const r = lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * f;
    const g = lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * f;
    const b = lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * f;
    data[i * 4 + 0] = Math.round(Math.min(1, Math.max(0, r)) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    data[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}

/** 返回 CSS 渐变字符串（用于 UI 图例）。 */
export function paletteCss(palette: PaletteDef, steps = 12): string {
  const parts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const [r, g, b] = samplePalette(palette, t);
    parts.push(`rgb(${r},${g},${b}) ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

export function samplePalette(palette: PaletteDef, t: number): [number, number, number] {
  const tt = Math.min(1, Math.max(0, t));
  const stops = palette.stops;
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let s = 0; s < stops.length - 1; s++) {
    if (tt >= stops[s].t && tt <= stops[s + 1].t) {
      lo = stops[s];
      hi = stops[s + 1];
      break;
    }
  }
  const span = Math.max(hi.t - lo.t, 1e-6);
  const f = (tt - lo.t) / span;
  const r = lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * f;
  const g = lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * f;
  const b = lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * f;
  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
  ];
}

export function getPalette(id: PaletteId): PaletteDef {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

/** 为某个场景建立/更新 LUT 纹理。 */
export function createLutTexture(scene: Scene, palette: PaletteDef): RawTexture {
  const data = buildPaletteData(palette);
  const tex = RawTexture.CreateRGBATexture(
    data,
    LUT_WIDTH,
    1,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
    Constants.TEXTURETYPE_UNSIGNED_BYTE
  );
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex.name = `lut_${palette.id}`;
  return tex;
}
