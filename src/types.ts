// 全局类型定义与常量

/** 残损等级（由轻到重） */
export type DamageGrade = 1 | 2 | 3 | 4;

export const GRADE_COUNT = 4;

/** 各等级展示元数据（颜色在渲染层用于顶点色） */
export interface GradeMeta {
  grade: DamageGrade;
  name: string;
  /** 线性 sRGB 颜色分量 0..1（直接写入顶点色） */
  color: [number, number, number];
  /** 用于 UI 的 CSS 颜色（十六进制） */
  css: string;
}

export const GRADE_META: GradeMeta[] = [
  { grade: 1, name: "轻微", color: [0.36, 0.80, 0.30], css: "#5ccc4d" },
  { grade: 2, name: "一般", color: [0.95, 0.82, 0.18], css: "#f3d12e" },
  { grade: 3, name: "较重", color: [0.96, 0.52, 0.12], css: "#f5851f" },
  { grade: 4, name: "严重", color: [0.92, 0.16, 0.13], css: "#eb2921" },
];

export function gradeMeta(grade: DamageGrade): GradeMeta {
  return GRADE_META[grade - 1];
}

/** 残损面片数据（持久化结构） */
export interface DamagePatchData {
  id: number;
  name: string;
  /** 用户在屋面上勾勒的轮廓点（世界坐标，贴近屋面），按顺序闭合 */
  outline: [number, number, number][];
  /** 残损程度分 0..1，默认按三档界阈值映射等级，可被手动覆盖 */
  severity: number;
  /** 手动指定的等级；为 null 时按 severity 与阈值自动分档 */
  manualGrade: DamageGrade | null;
  /** 面积（平方米），重建时计算 */
  area: number;
}

/** 图层文件格式（导出 / 回导） */
export interface DamageLayerFile {
  format: "roof-damage-layer";
  version: 1;
  exportedAt: string;
  lift: number;
  opacity: number;
  thresholds: [number, number];
  coordinateSystem: "world";
  patches: DamagePatchData[];
}

/** 屋面网格统计信息 */
export interface RoofStats {
  triangleCount: number;
  vertexCount: number;
  /** 包围盒 min/max（世界坐标） */
  min: [number, number, number];
  max: [number, number, number];
  /** 包围盒尺寸 */
  size: [number, number, number];
  /** 平均坡度（度） */
  avgSlopeDeg: number;
  /** 最大坡度（度） */
  maxSlopeDeg: number;
}

/** 实时性能读数 */
export interface PerfStats {
  patchCount: number;
  layerTriangles: number;
  /** 残损图层重建耗时（毫秒），含细分贴合与上传 */
  rebuildMs: number;
  /** 最近一次投影贴合总耗时（毫秒） */
  projectMs: number;
  /** 滚动平均帧耗时（毫秒） */
  frameMs: number;
  fps: number;
  drawCalls: number;
}

export const DEFAULT_THRESHOLDS: [number, number] = [0.33, 0.66];

/** 由严重度与三档界阈值计算等级：
 *  severity < t1 -> 1；< t2 -> 2；< 0.85 -> 3；否则 4 */
export function severityToGrade(
  severity: number,
  thresholds: [number, number]
): DamageGrade {
  const [t1, t2] = thresholds;
  const s = Math.min(1, Math.max(0, severity));
  if (s < t1) return 1;
  if (s < t2) return 2;
  if (s < 0.85) return 3;
  return 4;
}
