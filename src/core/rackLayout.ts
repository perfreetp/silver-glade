/**
 * 菇架布局：决定多层菇架上每根菌棒的空间位姿。
 * 纯数据计算，与 three.js 解耦（渲染器只消费位姿矩阵）。
 */
import type { RackConfig } from '../types';
import { STICK_LENGTH } from './growth';
import { mulberry32 } from './mathUtils';

export interface StickLayout {
  /** 菌棒索引 = layer * (columns*rows) + col*rows + row */
  index: number;
  layer: number;
  col: number;
  row: number;
  /** 菌棒中心位置（米，菇架局部坐标） */
  x: number;
  y: number;
  z: number;
  /** 绕本地 Y 轴的摆放角（弧度），制造手工摆放的轻微差异 */
  yaw: number;
}

export interface RackLayout {
  config: RackConfig;
  total: number;
  sticks: StickLayout[];
  /** 每层世界高度（米） */
  layerY: number[];
  /** 菇架整体包围尺寸（米） */
  width: number;
  depth: number;
  height: number;
}

/** 层间距（米） */
export const LAYER_SPACING = 0.55;
/** 列间距 / 行间距（米），略大于菌棒长度与直径 */
export const COL_SPACING = 0.36;
export const ROW_SPACING = 0.14;
/** 底层离地高度 */
export const BOTTOM_CLEARANCE = 0.3;

/**
 * 默认菇架：5 层 × 30 列 × 28 行 = 4200 根（≥ 4000 的要求）。
 * 菌棒水平横放，轴向沿 X（菇架长度方向）。
 */
export const DEFAULT_RACK: RackConfig = { layers: 5, columns: 30, rows: 28 };

export function buildRackLayout(config: RackConfig, seed = 20260601): RackLayout {
  const { layers, columns, rows } = config;
  const total = layers * columns * rows;
  const sticks: StickLayout[] = new Array(total);
  const layerY: number[] = [];

  const width = (columns - 1) * COL_SPACING + STICK_LENGTH;
  const depth = (rows - 1) * ROW_SPACING + 0.12;
  const height = BOTTOM_CLEARANCE + (layers - 1) * LAYER_SPACING + 0.25;

  const rng = mulberry32(seed);

  for (let l = 0; l < layers; l++) {
    const y = BOTTOM_CLEARANCE + l * LAYER_SPACING;
    layerY.push(y);
    for (let c = 0; c < columns; c++) {
      for (let r = 0; r < rows; r++) {
        const index = l * columns * rows + c * rows + r;
        // 轻微位置抖动（±6mm）与偏航角（±2°），避免机械网格感
        const jx = (rng() - 0.5) * 0.012;
        const jz = (rng() - 0.5) * 0.01;
        const yaw = (rng() - 0.5) * 0.07;
        sticks[index] = {
          index,
          layer: l,
          col: c,
          row: r,
          x: (c - (columns - 1) / 2) * COL_SPACING + jx,
          y,
          z: (r - (rows - 1) / 2) * ROW_SPACING + jz,
          yaw,
        };
      }
    }
  }

  return { config, total, sticks, layerY, width, depth, height };
}

/** 层位索引 → 该层所有菌棒的索引区间（连续存储，方便分层统计） */
export function layerIndexRange(config: RackConfig, layer: number): [number, number] {
  const perLayer = config.columns * config.rows;
  return [layer * perLayer, (layer + 1) * perLayer];
}
