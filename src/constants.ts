import type { WheelConfig, WheelId, WheelStyleId } from './types';

/** 轮胎半宽（米） */
export const TIRE_HALF_WIDTH = 0.16;
/** 胎侧厚度（米）：轮胎外半径 = 轮辋半径 + 胎侧厚度 */
export const SIDEWALL = 0.065;
/** 轮毂盖（中心法兰）半径 */
export const HUB_RADIUS = 0.075;
/** 轮辐外侧基准面（轮缘外侧 z） */
export const FACE_OFFSET = 0.105;

/** 轮位中心到车身纵向对称面的基础距离（米） */
export const WHEEL_Z_BASE = 0.84;
/** 车身半宽（米），轮拱侧面边界 */
export const BODY_HALF_WIDTH = 1.06;

export interface ParamRange {
  min: number;
  max: number;
  step: number;
}

export const PARAM_RANGES = {
  spokes: { min: 5, max: 10, step: 1 },
  dishDepth: { min: 0, max: 0.06, step: 0.002 },
  rimDiameter: { min: 0.34, max: 0.44, step: 0.005 },
  offset: { min: -0.04, max: 0.12, step: 0.005 },
} satisfies Record<keyof Omit<WheelConfig, 'style'>, ParamRange>;

export interface StyleInfo {
  id: WheelStyleId;
  name: string;
  desc: string;
}

export const STYLE_LIST: StyleInfo[] = [
  { id: 'straight', name: '经典直辐', desc: '等宽直辐条，运动基础款' },
  { id: 'twin', name: '双五辐', desc: '成对细辐，轻量化视觉' },
  { id: 'twist', name: '旋风扭转', desc: '辐条扭转，动感造型' },
  { id: 'mesh', name: '网状交错', desc: '双层交错辐条，复古网格' },
  { id: 'dish', name: '封闭盘面', desc: '整盘冲压开窗，低风阻' },
  { id: 'turbine', name: '涡轮扇叶', desc: '曲面扇叶，机械感强' },
];

export const DEFAULT_CONFIG: WheelConfig = {
  style: 'straight',
  spokes: 6,
  dishDepth: 0.02,
  rimDiameter: 0.39,
  offset: 0.06,
};

/** 四个轮位的世界坐标（x: 纵向, y: 高度, z: 横向） */
export const WHEEL_POSITIONS: Record<WheelId, { x: number; y: number; z: number }> = {
  FL: { x: 1.35, y: 0.475, z: WHEEL_Z_BASE },
  FR: { x: 1.35, y: 0.475, z: -WHEEL_Z_BASE },
  RL: { x: -1.35, y: 0.475, z: WHEEL_Z_BASE },
  RR: { x: -1.35, y: 0.475, z: -WHEEL_Z_BASE },
};

export function tireOuterRadius(rimDiameter: number): number {
  return rimDiameter / 2 + SIDEWALL;
}

/** 偏距外移后轮胎最外侧是否越过轮拱侧面边界 */
export function isBoundaryViolation(centerZ: number): boolean {
  return Math.abs(centerZ) + TIRE_HALF_WIDTH > BODY_HALF_WIDTH + 0.002;
}

export function formatMM(meters: number): string {
  return `${(meters * 1000).toFixed(1)} mm`;
}
