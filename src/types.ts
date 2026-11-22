export type ToolMode = 'view' | 'paint' | 'fill';

export type FilmFinish = 'matte' | 'gloss' | 'metallic';

export interface FilmDef {
  id: string;
  name: string;
  finish: FilmFinish;
  /** sRGB 基色 */
  color: [number, number, number];
}

/** 曲面上采样的一个笔画点 */
export interface StrokePoint {
  /** 世界坐标 */
  p: [number, number, number];
  /** 命中时的几何法线（世界空间） */
  n: [number, number, number];
  /** 命中点 UV（用于在车身贴膜纹理上绘制边界） */
  u: number;
  v: number;
  /** 该三角面 世界距离/UV距离 的平均尺度，保证不同 UV 拉伸下笔刷宽度一致 */
  faceScale: number;
}

export interface StrokeDef {
  id: string;
  radius: number;
  points: StrokePoint[];
  /**
   * 实心带标记：闭合环绕笔画在蒙版上以无缝矩形带绘制，
   * 保证在柱面 UV 上形成完整屏障（普通鼠标笔画为线段+圆头）。
   */
  solidBand?: boolean;
}

export interface SeamDef {
  width: number;
  /** 与笔画相同的采样点，用于重建贴合曲面的管线 */
  points: StrokePoint[];
}

/** 可导出/导入的完整配色方案 */
export interface SchemeData {
  version: 1;
  exportedAt: string;
  modelUri: string | null;
  brushRadius: number;
  seamWidth: number;
  /** 整车身膜材参数 */
  materialParams: { roughness: number; metallic: number };
  strokes: StrokeDef[];
  /** 区域索引 -> 膜色编号 */
  regionColors: Record<number, string>;
}

export interface SavedScheme {
  id: string;
  name: string;
  thumbnail: string;
  data: SchemeData;
}
