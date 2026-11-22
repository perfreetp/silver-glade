/** 几何 / 光学常量，全部以 mm 为内部单位 */

/** 透镜有效半径（直径 40mm） */
export const LENS_RADIUS = 20;
/** 透镜边缘厚度 */
export const LENS_EDGE_THICKNESS = 0.6;
/** 三档曲率对应的前表面球面半径 R（mm），R 越小曲率越大 */
export const CURVATURE_RADII = [140, 80, 50] as const;
export const CURVATURE_LABELS = ['低曲率 (R140)', '中曲率 (R80)', '高曲率 (R50)'] as const;

/** 厚度滑块名义范围 */
export const THICKNESS_MIN = 2;
export const THICKNESS_MAX = 8;

/** 折射率 */
export const IOR_AIR = 1.0;
export const IOR_GLASS_DEFAULT = 1.52;

/** LED 灯板：4×4 槽位 */
export const MAX_LEDS = 16;
export const LED_GRID_COLS = 4;
export const LED_GRID_ROWS = 4;
export const LED_SLOT_DX = 7;
export const LED_SLOT_DY = 3.5;
/** 单颗 LED 可在槽位内自由移动的范围 */
export const LED_CELL_HALF_X = 3.2;
export const LED_CELL_HALF_Y = 1.55;
/** 灯板所在 z 平面（透镜背面位于 z=0） */
export const LED_BOARD_Z = -22;

/** 墙面（测试屏）：10m 外，8m × 4m */
export const WALL_DISTANCE = 10_000;
export const WALL_WIDTH = 8_000;
export const WALL_HEIGHT = 4_000;
/** 墙面累积纹理分辨率（2:1 对应墙面宽高比） */
export const WALL_TEX_W = 768;
export const WALL_TEX_H = 384;

/** 透镜网格细分 */
export const LENS_RADIAL_SEGMENTS = 96;
export const LENS_RINGS = 48;

/** 采样光线数可选范围 */
export const RAYS_MIN = 16;
export const RAYS_MAX = 1024;

export const CUTOFF_MIN = -WALL_HEIGHT / 2 + 50;
export const CUTOFF_MAX = WALL_HEIGHT / 2 - 50;
export const GRADIENT_MIN = 20;
export const GRADIENT_MAX = 1200;
