// 全局共享类型定义

/** 刀头角度档位：浅 / 中 / 深 */
export type BladeAngle = 'shallow' | 'medium' | 'deep';

/** 雪质档位：干雪 / 湿雪 */
export type SnowCondition = 'dry' | 'wet';

/** 作业工具模式 */
export type ToolMode = 'none' | 'path' | 'measure' | 'annotate';

/** 雪道分区索引（ZONE_GRID × ZONE_GRID） */
export interface ZoneId {
  ix: number;
  iz: number;
}

/** 压雪路径控制点（在雪面顶部拾取，y 由地形函数给出） */
export interface PathControlPoint {
  id: string;
  x: number;
  z: number;
}

/** 路径重采样后的密集作业样本点，带弧长与行进方向 */
export interface PathSample {
  x: number;
  z: number;
  /** 行进方向（XZ 平面单位向量） */
  hx: number;
  hz: number;
  /** 累计弧长（米），作为刀纹相位，保证拐弯处刀纹连续 */
  s: number;
}

/** 刀头档位参数 */
export interface BladeSpec {
  key: BladeAngle;
  label: string;
  /** 压雪刀宽度（米） */
  width: number;
  /** 沟纹深度（米） */
  depth: number;
  /** 横向棱纹间距（米，沿行进方向） */
  ridgeSpacing: number;
  /** 刀头倾角（度，仅展示用） */
  angleDeg: number;
}

/** 雪质参数 */
export interface SnowSpec {
  key: SnowCondition;
  label: string;
  /** 边缘碎雪隆起幅度系数（乘到刀深上） */
  crumble: number;
  /** 棱纹锐度：越大越锐利（湿雪塌缩、棱纹钝） */
  ridgeSharpness: number;
  /** 残雪堆积保持率（湿雪更容易结块堆积） */
  pileRetention: number;
}

/** 贴地标注 */
export interface Annotation {
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
}

/** 测距结果 */
export interface MeasureResult {
  /** 直线距离（米） */
  straight: number;
  /** 贴地距离（米，沿地表采样） */
  ground: number;
  /** 起止点高差（米） */
  drop: number;
}

/** 任务导出文件结构（供次日复压） */
export interface GroomTaskFile {
  version: 1;
  exportedAt: string;
  world: { size: number; zoneGrid: number; zoneSize: number };
  snow: SnowCondition;
  blade: BladeAngle;
  speed: number;
  controlPoints: PathControlPoint[];
  annotations: Annotation[];
  measure: MeasureResult | null;
}
