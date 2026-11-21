/**
 * 全局类型定义
 */

/** 环境输入：温度（摄氏度，8 档）与相对湿度（%） */
export interface EnvironmentInput {
  /** 温度，量化为 8 档：8 / 11 / 14 / 17 / 20 / 23 / 26 / 29 °C */
  temperature: number;
  /** 相对湿度 0–100 % */
  humidity: number;
}

/** 菇架几何配置（决定菌棒数量与摆放） */
export interface RackConfig {
  /** 层数 */
  layers: number;
  /** 每层列数（沿菇架长度方向） */
  columns: number;
  /** 每层行数（沿菇架宽度方向） */
  rows: number;
}

/** 视角 */
export type ViewMode = 'top' | 'side';

/** 工作模式：单架 / 双批次对比 */
export type WorkMode = 'single' | 'compare';

/** 单根菌棒在某一时刻的生长形态参数 */
export interface StickMorphology {
  /** 生长阶段 0（菌丝萌发）→ 1（菌盖完全展开） */
  stage: number;
  /** 菌丝覆盖率 0–1（驱动菌棒白化程度） */
  coverage: number;
  /** 出菇强度 0–1（原基 → 子实体成熟） */
  fruiting: number;
  /** 菌盖半径（世界单位，米） */
  capRadius: number;
  /** 菌盖厚度（世界单位，米），随阶段变化 */
  capThickness: number;
  /** 菌柄高度（世界单位，米） */
  stemHeight: number;
  /** 菌膜（塑料栽培袋膜）透明度 0.2–0.7 */
  membraneOpacity: number;
}

/** 单根菌棒的固定个体参数（随机种子差异，决定萌发先后） */
export interface StickParams {
  /** 生长速率抖动系数（0.85–1.15） */
  rateJitter: number;
  /** 初始萌发相位 0–0.04 */
  startOffset: number;
  /** 出菇点随机种子（3 个子实体共用一个 mulberry32 种子） */
  fruitingSeed: number;
}

/** 层位统计 */
export interface LayerStat {
  layer: number;
  /** 该层平均生长阶段 */
  avgStage: number;
  /** 该层平均菌盖半径 */
  avgCapRadius: number;
  /** 该层菌棒数 */
  count: number;
}

/** 快照文件格式（可再次载入还原形态） */
export interface GrowthSnapshot {
  format: 'mushroom-rack-growth-snapshot';
  version: 1;
  exportedAt: string;
  rackConfig: RackConfig;
  environment: EnvironmentInput;
  /** 模拟累计时长（小时） */
  elapsedHours: number;
  /** 每根菌棒的固定参数（base64 打包的 Float32Array） */
  stickParams: string;
  /** 每根菌棒当前生长阶段（base64 打包的 Float32Array） */
  stages: string;
  /** 每根菌棒的当前形态参数（base64 打包，每条记录 8 个 float） */
  morphology: string;
}
