/**
 * 机房热力分析 —— 领域模型
 *
 * 一座机房由若干机柜组成。每个机柜有一个编号，在机房的 (行, 列) 网格上占一个或多个位置，
 * 且具有两个热力面：进风面（intake）与出风面（exhaust）。每面最多 36 个温度采样点
 * （6 x 6 栅格），单位 ℃。
 *
 * 坐标约定（世界坐标，单位：米）：
 *   +X 沿机柜排布方向（列方向）
 *   +Y 向上
 *   +Z 指向机柜的进风侧（冷通道）
 * 每个机柜的本体是 axis-aligned box，从 base 起算。
 */

export type FaceKind = "intake" | "exhaust";

/** 机柜在机房平面上的朝向：进风面法线指向哪个方向。 */
export type FacingDir = "+X" | "-X" | "+Z" | "-Z";

export interface RackSampleGrid {
  /** 采样点栅格列数（通常 6） */
  cols: number;
  /** 采样点栅格行数（通常 6） */
  rows: number;
  /** 长度 = cols*rows，单位 ℃；NaN 表示缺失 */
  values: Float32Array;
}

export interface RackPlacement {
  /** 行索引（从 0 开始） */
  row: number;
  /** 列索引（从 0 开始） */
  col: number;
}

export interface Rack {
  id: string;
  row: number;
  col: number;
  facing: FacingDir;
  intake: RackSampleGrid;
  exhaust: RackSampleGrid;
}

export interface RoomConfig {
  /** 机柜宽度（沿 X，米） */
  rackWidth: number;
  /** 机柜深度（沿 Z，米） */
  rackDepth: number;
  /** 机柜高度（米） */
  rackHeight: number;
  /** 行间通道宽度（米）—— 相邻两排机柜之间的距离 */
  aisleWidth: number;
  /** 列间距（米）—— 同一排相邻机柜之间的缝隙 */
  rackGap: number;
}

export const DEFAULT_ROOM: RoomConfig = {
  rackWidth: 0.6,
  rackDepth: 1.2,
  rackHeight: 2.0,
  aisleWidth: 1.2,
  rackGap: 0.02,
};

export const MAX_RACKS = 200;
export const FACE_COLS = 6;
export const FACE_ROWS = 6;
export const MAX_SAMPLES_PER_FACE = FACE_COLS * FACE_ROWS; // 36

export const TEMP_MIN = 25;
export const TEMP_MAX = 60;

/** 单个机柜的世界包围盒。 */
export interface RackBox {
  rack: Rack;
  min: [number, number, number];
  max: [number, number, number];
  /** 该机柜在机房内的显示序号（用于着色区分） */
  index: number;
}

export interface RoomLayout {
  config: RoomConfig;
  boxes: RackBox[];
  /** 所有机柜包围盒的整体范围 */
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}
