/** 雪量档位：1 小 / 2 中 / 3 大 */
export type SnowLevel = 1 | 2 | 3;

export interface WindState {
  /** 风向角度（度），0 = 顺坡向下(+Z)，顺时针 */
  direction: number;
  /** 风速 m/s */
  speed: number;
}

export interface MachineConfig {
  id: number;
  /** 坡面世界坐标（y 由地形高度自动对齐） */
  x: number;
  z: number;
  /** 炮口水平朝向（度，0 = +Z 顺坡） */
  yaw: number;
  /** 炮口俯仰角（度，正 = 上扬） */
  pitch: number;
  level: SnowLevel;
  wind: WindState;
}

/** 导出的造雪计划 */
export interface SnowPlan {
  version: 1;
  exportedAt: string;
  terrain: { width: number; length: number };
  machines: MachineConfig[];
}

export interface SimStats {
  fps: number;
  activeParticles: number;
  capacity: number;
  machineCount: number;
  /** 有积雪的网格占比（%） */
  coverage: number;
  /** 全场平均积雪厚度（米） */
  avgDepth: number;
  running: boolean;
  night: boolean;
}
