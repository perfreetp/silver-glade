/**
 * 共享类型与常量定义
 */

/** 接种点（格点坐标，浮点，位于菌包截面环形基质内） */
export interface InoculationPoint {
  id: number;
  /** 格点列坐标（0 ~ gridSize-1） */
  x: number;
  /** 格点行坐标（0 ~ gridSize-1） */
  y: number;
}

/** 培养 / 模拟参数 */
export interface SimParams {
  /** 正方形格点边长（格点总数 = gridSize²） */
  gridSize: number;
  /** 中心气孔半径 / 菌包外半径 */
  holeRatio: number;
  /** 温度 ℃ */
  temperature: number;
  /** 相对湿度 % */
  humidity: number;
  /** 总扩散步数 */
  totalSteps: number;
  /** 每隔多少步存一帧快照 */
  snapshotEvery: number;
  /** 每步对应物理时间（小时） */
  hoursPerStep: number;
}

/** 一帧压缩快照 */
export interface Snapshot {
  /** 扩散步数 */
  step: number;
  /** 对应培养时间（小时） */
  timeHours: number;
  /** RLE 压缩后的浓度字节（0~255） */
  bytes: Uint8Array;
}

/** 单元格类型 */
export const CellType = {
  /** 菌包外部（袋壁之外） */
  Outside: 0,
  /** 培养基质（菌丝可生长区域） */
  Substrate: 1,
  /** 中心气孔（吸收边界，菌丝到此消亡） */
  Hole: 2,
} as const;

/** 浓度量化上限（Uint8） */
export const CONCENTRATION_MAX = 255;

/**
 * 5 级浓度分级边界（含下界，不含上界；最后一级含上界）。
 * 级数 1~5，0 表示无菌丝。
 */
export const LEVEL_THRESHOLDS: ReadonlyArray<readonly [number, number]> = [
  [1, 51],
  [51, 111],
  [111, 181],
  [181, 231],
  [231, 256],
];

/** 每级菌丝层的显示色（由稀到密，逐步接近白色） */
export const LEVEL_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [214, 201, 178],
  [228, 219, 200],
  [240, 235, 222],
  [249, 247, 239],
  [255, 255, 250],
];

/** 每级菌丝层的不透明度 */
export const LEVEL_ALPHAS = [0.42, 0.55, 0.68, 0.82, 0.96] as const;

/** 可选格点规模 */
export const GRID_SIZE_OPTIONS = [512, 768, 1024, 1536, 2048] as const;

/** 默认模拟参数 */
export const DEFAULT_PARAMS: SimParams = {
  gridSize: 768,
  holeRatio: 0.16,
  temperature: 23,
  humidity: 85,
  totalSteps: 1200,
  snapshotEvery: 10,
  hoursPerStep: 0.5,
};

/**
 * 温度 / 湿度 → 扩散与生长倍率。
 * 温度遵循 Q10 系数（最适 23℃），湿度在低湿时抑制生长。
 */
export function environmentFactor(temperature: number, humidity: number): number {
  const q10 = 2.2;
  let fT = Math.pow(q10, (temperature - 23) / 10);
  // 高温胁迫：超过 30℃ 后快速抑制
  if (temperature > 30) {
    fT *= Math.max(0.05, 1 - (temperature - 30) * 0.35);
  }
  fT = Math.min(3, Math.max(0.08, fT));
  const fH = 0.4 + 0.6 * Math.pow(humidity / 100, 1.5);
  return fT * fH;
}

/** 由浓度值（0~255）得到分级编号 0~5 */
export function levelOf(concentration: number): number {
  if (concentration <= 0) return 0;
  for (let k = 0; k < LEVEL_THRESHOLDS.length; k++) {
    const [lo, hi] = LEVEL_THRESHOLDS[k]!;
    if (concentration >= lo && concentration < hi) return k + 1;
  }
  return 5;
}
