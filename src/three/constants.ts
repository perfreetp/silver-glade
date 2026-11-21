import type { BladeAngle, BladeSpec, SnowCondition, SnowSpec } from '../types';

/** 雪面世界尺寸（米，正方形） */
export const WORLD_SIZE = 240;

/** 雪面单侧顶点数（总顶点数 = (网格+1)²；0.67m 格网才能解析刀头边缘碎雪脊） */
export const TERRAIN_SEGMENTS = 360;

/** 雪道分区网格（ZONE_GRID × ZONE_GRID 个分区） */
export const ZONE_GRID = 6;

/** 单个分区边长（米） */
export const ZONE_SIZE = WORLD_SIZE / ZONE_GRID;

/** 每帧允许重算的顶点预算（维持 60fps 的核心节流参数） */
export const VERTEX_BUDGET_PER_FRAME = 4200;

/** 压雪机推进速度（米/秒） */
export const DEFAULT_SPEED = 14;

/** 路径重采样间距（米） */
export const PATH_SAMPLE_STEP = 0.5;

/** 刀头角度三档 */
export const BLADE_SPECS: Record<BladeAngle, BladeSpec> = {
  shallow: {
    key: 'shallow',
    label: '浅档 12°',
    width: 5.2,
    depth: 0.1,
    ridgeSpacing: 0.55,
    angleDeg: 12,
  },
  medium: {
    key: 'medium',
    label: '中档 22°',
    width: 4.6,
    depth: 0.2,
    ridgeSpacing: 0.42,
    angleDeg: 22,
  },
  deep: {
    key: 'deep',
    label: '深档 32°',
    width: 4.0,
    depth: 0.34,
    ridgeSpacing: 0.32,
    angleDeg: 32,
  },
};

export const BLADE_ORDER: BladeAngle[] = ['shallow', 'medium', 'deep'];

/** 雪质干湿两档 */
export const SNOW_SPECS: Record<SnowCondition, SnowSpec> = {
  dry: {
    key: 'dry',
    label: '干雪（粉雪）',
    crumble: 0.55,
    ridgeSharpness: 2.6,
    pileRetention: 0.6,
  },
  wet: {
    key: 'wet',
    label: '湿雪（春雪）',
    crumble: 0.95,
    ridgeSharpness: 1.4,
    pileRetention: 1.0,
  },
};

/** 分区显示色板（底图分区配色） */
export const ZONE_COLORS = [
  0x8fc7e8, 0x7fb8dd, 0xa8d3ec, 0x93c3e4, 0x79b0d8, 0x9ccae8,
  0x88c0e2, 0xa4d0ea, 0x82b9dd, 0x98c8e6, 0x8ec2e3, 0xaed8ef,
];
