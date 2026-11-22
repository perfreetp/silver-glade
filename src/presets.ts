import type { PaintPreset, PaintParams, PresetCategory } from './types';

/** 四类车漆预设 —— 参数按典型工业配方区间设定 */
export const PRESETS: PaintPreset[] = [
  // ───────────────────────── 金属漆 ─────────────────────────
  {
    id: 'met-silver',
    category: 'metallic',
    name: '星河银',
    description: '细铝片高取向，镜面感强',
    params: {
      electro: { color: '#3a3d42', roughness: 0.55, thickness: 22 },
      mid: { color: '#b8bcc2', roughness: 0.32, thickness: 38, opacity: 0.92 },
      flake: {
        type: 'metallic',
        orientation: 'highGloss',
        flakeColor: '#e8ebee',
        flakeDensity: 0.85,
        roughness: 0.22,
        thickness: 18,
        flakeSize: 1.0,
        sparkle: 0.55,
      },
      clear: { thickness: 45, ior: 1.52, roughness: 0.04, tint: '#ffffff' },
    },
  },
  {
    id: 'met-grey',
    category: 'metallic',
    name: '量子灰',
    description: '中粗铝片低取向，金属颗粒感',
    params: {
      electro: { color: '#26282c', roughness: 0.6, thickness: 20 },
      mid: { color: '#6d7178', roughness: 0.4, thickness: 40, opacity: 0.9 },
      flake: {
        type: 'metallic',
        orientation: 'lowGloss',
        flakeColor: '#c9ccd1',
        flakeDensity: 0.7,
        roughness: 0.34,
        thickness: 22,
        flakeSize: 1.6,
        sparkle: 0.7,
      },
      clear: { thickness: 42, ior: 1.5, roughness: 0.06, tint: '#ffffff' },
    },
  },
  {
    id: 'met-blue',
    category: 'metallic',
    name: '深海蓝',
    description: '蓝色色漆 + 高闪光铝片',
    params: {
      electro: { color: '#101826', roughness: 0.55, thickness: 24 },
      mid: { color: '#16324f', roughness: 0.3, thickness: 44, opacity: 0.95 },
      flake: {
        type: 'metallic',
        orientation: 'highGloss',
        flakeColor: '#9fc2e8',
        flakeDensity: 0.6,
        roughness: 0.2,
        thickness: 16,
        flakeSize: 0.9,
        sparkle: 0.8,
      },
      clear: { thickness: 50, ior: 1.53, roughness: 0.035, tint: '#ffffff' },
    },
  },
  // ───────────────────────── 珠光漆 ─────────────────────────
  {
    id: 'pea-white',
    category: 'pearlescent',
    name: '珠光白',
    description: '云母干涉片，温润珍珠质感',
    params: {
      electro: { color: '#d9d5cc', roughness: 0.5, thickness: 20 },
      mid: { color: '#f4f1ea', roughness: 0.28, thickness: 36, opacity: 0.94 },
      flake: {
        type: 'pearlescent',
        orientation: 'highGloss',
        flakeColor: '#f7f3ff',
        flakeDensity: 0.55,
        roughness: 0.18,
        thickness: 14,
        flakeSize: 1.2,
        sparkle: 0.45,
      },
      clear: { thickness: 55, ior: 1.54, roughness: 0.03, tint: '#ffffff' },
    },
  },
  {
    id: 'pea-red',
    category: 'pearlescent',
    name: '赤霞珠光红',
    description: '红金双色干涉，随角异色',
    params: {
      electro: { color: '#2a0d12', roughness: 0.55, thickness: 22 },
      mid: { color: '#8e1f2b', roughness: 0.3, thickness: 42, opacity: 0.95 },
      flake: {
        type: 'pearlescent',
        orientation: 'highGloss',
        flakeColor: '#ffb08a',
        flakeDensity: 0.5,
        roughness: 0.2,
        thickness: 16,
        flakeSize: 1.3,
        sparkle: 0.65,
      },
      clear: { thickness: 48, ior: 1.53, roughness: 0.04, tint: '#ffffff' },
    },
  },
  {
    id: 'pea-chameleon',
    category: 'pearlescent',
    name: '极光变色龙',
    description: '强干涉珠光，角度变色明显',
    params: {
      electro: { color: '#14121f', roughness: 0.55, thickness: 24 },
      mid: { color: '#2b2350', roughness: 0.32, thickness: 40, opacity: 0.9 },
      flake: {
        type: 'pearlescent',
        orientation: 'lowGloss',
        flakeColor: '#6fe7c8',
        flakeDensity: 0.65,
        roughness: 0.24,
        thickness: 20,
        flakeSize: 1.5,
        sparkle: 0.85,
      },
      clear: { thickness: 52, ior: 1.54, roughness: 0.035, tint: '#ffffff' },
    },
  },
  // ───────────────────────── 素色漆 ─────────────────────────
  {
    id: 'sol-red',
    category: 'solid',
    name: '经典正红',
    description: '纯色漆，无片层，高通透',
    params: {
      electro: { color: '#331014', roughness: 0.6, thickness: 22 },
      mid: { color: '#c8242f', roughness: 0.26, thickness: 46, opacity: 0.98 },
      flake: {
        type: 'metallic',
        orientation: 'highGloss',
        flakeColor: '#ffffff',
        flakeDensity: 0,
        roughness: 0.3,
        thickness: 12,
        flakeSize: 1,
        sparkle: 0,
      },
      clear: { thickness: 46, ior: 1.52, roughness: 0.045, tint: '#ffffff' },
    },
  },
  {
    id: 'sol-yellow',
    category: 'solid',
    name: '向日葵黄',
    description: '高饱和素色，清漆提亮',
    params: {
      electro: { color: '#4a3a10', roughness: 0.6, thickness: 20 },
      mid: { color: '#f2b51c', roughness: 0.27, thickness: 44, opacity: 0.97 },
      flake: {
        type: 'metallic',
        orientation: 'highGloss',
        flakeColor: '#ffffff',
        flakeDensity: 0,
        roughness: 0.3,
        thickness: 12,
        flakeSize: 1,
        sparkle: 0,
      },
      clear: { thickness: 44, ior: 1.51, roughness: 0.05, tint: '#ffffff' },
    },
  },
  // ───────────────────────── 哑光漆 ─────────────────────────
  {
    id: 'mat-black',
    category: 'matte',
    name: '磨砂黑',
    description: '哑面清漆，柔和漫反射',
    params: {
      electro: { color: '#101012', roughness: 0.65, thickness: 22 },
      mid: { color: '#1b1c1f', roughness: 0.55, thickness: 38, opacity: 0.96 },
      flake: {
        type: 'metallic',
        orientation: 'lowGloss',
        flakeColor: '#888a90',
        flakeDensity: 0.1,
        roughness: 0.5,
        thickness: 14,
        flakeSize: 0.8,
        sparkle: 0.06,
      },
      clear: { thickness: 30, ior: 1.48, roughness: 0.42, tint: '#ffffff' },
    },
  },
  {
    id: 'mat-green',
    category: 'matte',
    name: '军哑光绿',
    description: '低反光战术哑光',
    params: {
      electro: { color: '#141a12', roughness: 0.68, thickness: 24 },
      mid: { color: '#4a5a3e', roughness: 0.58, thickness: 40, opacity: 0.95 },
      flake: {
        type: 'metallic',
        orientation: 'lowGloss',
        flakeColor: '#9aa88c',
        flakeDensity: 0.08,
        roughness: 0.52,
        thickness: 14,
        flakeSize: 0.8,
        sparkle: 0.04,
      },
      clear: { thickness: 28, ior: 1.47, roughness: 0.46, tint: '#ffffff' },
    },
  },
];

const DEFAULT_PARAMS: PaintParams = PRESETS[0].params;

export function getDefaultParams(): PaintParams {
  return structuredClone(DEFAULT_PARAMS);
}

export function getPreset(id: string): PaintPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function getCategoryParams(category: PresetCategory): PaintParams {
  const preset = PRESETS.find((p) => p.category === category);
  return structuredClone(preset!.params);
}
