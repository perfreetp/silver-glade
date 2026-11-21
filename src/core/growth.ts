/**
 * 生长模型
 *
 * 两根环境输入（温度 / 湿度）驱动每根菌棒的生长阶段 stage（0→1），
 * stage 再经分段曲线映射为可见形态（菌丝覆盖、原基、菌柄、菌盖、菌膜）。
 * 全部为纯函数，便于单测与快照还原。
 */
import type { EnvironmentInput, StickMorphology } from '../types';
import { clamp, smoothstep } from './mathUtils';

/** 温度滑杆的 8 个档位（°C） */
export const TEMP_STEPS = [8, 11, 14, 17, 20, 23, 26, 29] as const;

/** 湿度范围（%） */
export const HUMIDITY_MIN = 0;
export const HUMIDITY_MAX = 100;

/**
 * 完整生长周期（小时）。
 * 最适温湿度下，一根菌棒从菌丝萌发到菌盖完全展开需要 30 天。
 */
export const FULL_CYCLE_HOURS = 24 * 30;

/** 菌棒体尺寸（米） */
export const STICK_LENGTH = 0.32;
export const STICK_RADIUS = 0.05;

/** 菌盖 / 菌柄尺寸上限（米） */
export const MAX_CAP_RADIUS = 0.045;
export const MAX_STEM_HEIGHT = 0.06;
export const MIN_CAP_THICKNESS = 0.006;
export const MAX_CAP_THICKNESS = 0.03;

/** 每根菌棒固定 3 个出菇点 */
export const FRUITS_PER_STICK = 3;

/** 菌膜透明度区间（随生长阶段） */
export const MEMBRANE_OPACITY_MIN = 0.2;
export const MEMBRANE_OPACITY_MAX = 0.7;

/** 温度生长因子：高斯响应，最适 18°C，σ = 7°C */
export function temperatureFactor(tempC: number): number {
  const OPTIMAL = 18;
  const SIGMA = 7;
  const x = (tempC - OPTIMAL) / SIGMA;
  return Math.exp(-0.5 * x * x);
}

/**
 * 湿度生长因子：
 * - 85% 为最适点（=1）
 * - 低湿二次曲线惩罚（干燥显著抑制出菇）
 * - 100% 略降到 0.92（过湿通气不良）
 */
export function humidityFactor(humidityPct: number): number {
  const h = clamp(humidityPct / 100, 0, 1);
  if (h >= 0.85) {
    return 1 - ((h - 0.85) / 0.15) * 0.08;
  }
  const t = h / 0.85;
  return 0.05 + 0.95 * t * t;
}

/** 综合生长速率（1/小时）= 温度因子 × 湿度因子 / 完整周期 */
export function growthRate(env: EnvironmentInput): number {
  return (temperatureFactor(env.temperature) * humidityFactor(env.humidity)) / FULL_CYCLE_HOURS;
}

/** 推进一根菌棒的生长阶段 */
export function advanceStage(
  stage: number,
  env: EnvironmentInput,
  dtHours: number,
  rateJitter: number,
): number {
  return clamp(stage + growthRate(env) * rateJitter * dtHours, 0, 1);
}

/**
 * 生长阶段 → 形态参数（分段生长曲线）
 *
 * stage 区间约定：
 *   0.00–0.40  菌丝萌发 / 定植（菌棒白化）
 *   0.40–0.60  原基形成（小纽扣状幼蕾）
 *   0.60–0.85  菌柄伸长
 *   0.85–1.00  菌盖展开
 */
export function computeMorphology(stage: number): StickMorphology {
  const s = clamp(stage, 0, 1);

  // 菌丝覆盖率：萌发期快速爬升，0.45 后基本满布
  const coverage = smoothstep(0.02, 0.45, s);

  // 出菇强度：原基出现到子实体成熟
  const fruiting = smoothstep(0.4, 0.95, s);

  // 菌盖半径：随出菇强度线性放大
  const capRadius = fruiting * MAX_CAP_RADIUS;

  // 菌盖厚度：原基期厚（纽扣状），展开后变薄
  const capThickness = MIN_CAP_THICKNESS + (MAX_CAP_THICKNESS - MIN_CAP_THICKNESS) * (1 - fruiting);

  // 菌柄高度：出菇后快速伸长
  const stemHeight = fruiting * MAX_STEM_HEIGHT;

  // 菌膜透明度：萌发期 0.7（完整栽培袋膜）→ 成熟 0.2（膜老化 / 开孔出菇）
  const membraneOpacity = MEMBRANE_OPACITY_MAX - (MEMBRANE_OPACITY_MAX - MEMBRANE_OPACITY_MIN) * s;

  return {
    stage: s,
    coverage,
    fruiting,
    capRadius,
    capThickness,
    stemHeight,
    membraneOpacity,
  };
}

/** 菌盖穹顶形变属性：1 = 原基纽扣（高穹顶），0 = 成熟平展菌盖 */
export function capMorph(stage: number): number {
  return 1 - smoothstep(0.55, 0.95, clamp(stage, 0, 1));
}
