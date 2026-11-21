export type WheelId = 'FL' | 'FR' | 'RL' | 'RR';

export const WHEEL_IDS: WheelId[] = ['FL', 'FR', 'RL', 'RR'];

export const WHEEL_NAMES: Record<WheelId, string> = {
  FL: '左前轮',
  FR: '右前轮',
  RL: '左后轮',
  RR: '右后轮',
};

/** 六种内置基础轮毂款式 */
export type WheelStyleId =
  | 'straight'
  | 'twin'
  | 'twist'
  | 'mesh'
  | 'dish'
  | 'turbine';

export interface WheelConfig {
  style: WheelStyleId;
  /** 辐条数量 5-10 */
  spokes: number;
  /** 盘面深度（米），控制辐条根部相对轮缘的下沉量 */
  dishDepth: number;
  /** 轮辋直径（米） */
  rimDiameter: number;
  /** 偏距（米），正值车轮沿轴向外移 */
  offset: number;
}

export type ClearanceStatus = 'ok' | 'warn' | 'collision';

export interface ClearanceResult {
  /** 最小间隙（米），null 表示射线未命中轮拱（异常） */
  min: number | null;
  status: ClearanceStatus;
  /** 最小间隙命中点（世界坐标） */
  point: [number, number, number] | null;
  /** 参与检测的射线数量 */
  rayCount: number;
  /** 偏距导致车轮越过轮拱侧面边界 */
  boundaryViolation: boolean;
}

export type ClearanceMap = Record<WheelId, ClearanceResult>;
