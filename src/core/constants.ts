/** 全局数值常量：地形、雪场网格、物理与粒子池 */
export const TERRAIN = {
  WIDTH: 80,
  LENGTH: 120,
  SEG_X: 160,
  SEG_Z: 240,
  SLOPE: 0.12,
  NOISE_AMP: 1.65,
} as const;

/** 坡面积雪高度场网格（对应 R 通道 DataTexture） */
export const SNOW_GRID = {
  NX: 160,
  NZ: 240,
  /** 积雪最大厚度（米），饱和后不再增长，避免无限累积 */
  MAX_DEPTH: 2.4,
  /** 每秒沉积占剩余容量的比例（渐近饱和） */
  DEPOSIT_RATE: 0.09,
} as const;

export const PARTICLE = {
  MAX_COUNT: 20_000,
  /** 粒子生命周期（秒），到期回收，保证不无限累积 */
  LIFE: 9,
  /** 密度网格（仅统计活跃飘移粒子，用于体积感合成） */
  DENSITY_NX: 36,
  DENSITY_NZ: 54,
} as const;

export const GRAVITY = 9.8;
export const FIXED_DT = 1 / 60;

/** 雪量三档：发射速率（粒/秒）、初速度（米/秒） */
export const SNOW_LEVELS: ReadonlyArray<{ rate: number; speed: number }> = [
  { rate: 220, speed: 13 },
  { rate: 460, speed: 16 },
  { rate: 760, speed: 19 },
];

/** 风向 0° = 顺坡向下（+Z），顺时针角度制；风速单位 m/s */
export const WIND = {
  MIN_DIR: 0,
  MAX_DIR: 360,
  MIN_SPEED: 0,
  MAX_SPEED: 14,
  DEFAULT_DIR: 25,
  DEFAULT_SPEED: 5,
} as const;
