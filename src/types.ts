/** 车漆多层材质领域模型 —— 四层结构：电泳层 / 中涂层 / 金属片或珠光片层 / 清漆层 */

export type PresetCategory = 'metallic' | 'pearlescent' | 'solid' | 'matte';

export type FlakeType = 'metallic' | 'pearlescent';

/** 金属片朝向分布两档光泽度 */
export type FlakeOrientation = 'highGloss' | 'lowGloss';

export interface ElectroLayer {
  /** 电泳衬底层基础色（sRGB hex） */
  color: string;
  roughness: number;
  /** 厚度，微米，5–80 */
  thickness: number;
}

export interface MidLayer {
  /** 中涂层基础色（色漆本色，sRGB hex） */
  color: string;
  roughness: number;
  /** 厚度，微米，5–80 */
  thickness: number;
  /** 颜料遮盖率 0–1，控制对电泳层的透射 */
  opacity: number;
}

export interface FlakeLayer {
  type: FlakeType;
  /** 片体朝向分布：高光泽（取向集中）/ 低光泽（取向散乱） */
  orientation: FlakeOrientation;
  /** 片体颜色（金属：反射本色；珠光：干涉色调） */
  flakeColor: string;
  /** 片层覆盖密度 0–1，0 即无片层（素色漆） */
  flakeDensity: number;
  roughness: number;
  /** 厚度，微米，5–80 */
  thickness: number;
  /** 片体空间尺寸（缩放系数） */
  flakeSize: number;
  /** 闪烁强度 0–1 */
  sparkle: number;
}

export interface ClearLayer {
  /** 清漆厚度，微米，5–80 */
  thickness: number;
  /** 清漆折射率，1.3–2.0 */
  ior: number;
  roughness: number;
  /** 清漆轻微染色（高端定制色） */
  tint: string;
}

export interface PaintParams {
  electro: ElectroLayer;
  mid: MidLayer;
  flake: FlakeLayer;
  clear: ClearLayer;
}

export interface LightState {
  /** 方位角，度，0–360 */
  azimuth: number;
  /** 仰角，度，5–75（上限保证光源标记在视野内） */
  elevation: number;
  intensity: number;
}

export interface PaintPreset {
  id: string;
  category: PresetCategory;
  name: string;
  description: string;
  params: PaintParams;
}

export interface SavedScheme {
  id: string;
  name: string;
  category: PresetCategory;
  params: PaintParams;
  createdAt: number;
}

export type DebugMode = 0 | 1 | 2 | 3 | 4;

export const LAYER_LABELS: Record<keyof PaintParams, string> = {
  electro: '电泳层',
  mid: '中涂层',
  flake: '金属/珠光片层',
  clear: '清漆层',
};

export const CATEGORY_LABELS: Record<PresetCategory, string> = {
  metallic: '金属漆',
  pearlescent: '珠光漆',
  solid: '素色漆',
  matte: '哑光漆',
};

/** 厚度统一约束：5–80 微米，步进 1 */
export const THICKNESS_MIN = 5;
export const THICKNESS_MAX = 80;
export const THICKNESS_STEP = 1;

export const MAX_SCHEMES = 12;
