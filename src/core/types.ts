/**
 * 共享数据类型：项目状态、栅格、矢量轮廓。
 * 所有几何在“地图坐标”中表达：x 向东，y 向北，单位米。
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 地理参照：地图坐标范围 + 可选的经纬度锚点（用于 GeoJSON 导出） */
export interface Georef {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  crs: 'local' | 'wgs84';
  /** 地图原点对应的经度（crs = wgs84 时有效） */
  lon0: number;
  /** 地图原点对应的纬度（crs = wgs84 时有效） */
  lat0: number;
}

/** 无地理参照的包围盒 */
export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** RGBA 栅格影像 */
export interface RasterImage {
  name: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 高程栅格（米） */
export interface ElevationGrid {
  name: string;
  width: number;
  height: number;
  heights: Float32Array;
  minElev: number;
  maxElev: number;
}

export type RingRole = 'outer' | 'hole';

/** 可编辑边界环：编辑态（authoring）顶点，世界坐标 */
export interface Ring {
  id: string;
  role: RingRole;
  vertices: Vec2[];
}

export interface DetectSettings {
  /** 火场判定阈值 0..1（颜色差异归一化后的过火指数） */
  threshold: number;
  /** 碎片过滤：小于该面积的独立多边形被剔除（平方米） */
  minArea: number;
  /** 轮廓简化容差（米） */
  smoothing: number;
}

/** 4 个阈值把 0..1 的过火指数分成 5 级受损 */
export interface SeveritySettings {
  thresholds: [number, number, number, number];
}

export type ViewMode = 'drape' | 'raised';

export interface ViewSettings {
  mode: ViewMode;
  /** 抬升显示时高于地面的米数 */
  lift: number;
  showImagery: boolean;
  /** 地形垂直夸张系数 */
  exaggeration: number;
}

export interface Project {
  version: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  georef: Georef;
  imagery: RasterImage | null;
  dem: ElevationGrid | null;
  /** 未过火植被参考色，颜色差异以此为基准 */
  referenceColor: Rgb;
  detect: DetectSettings;
  severity: SeveritySettings;
  boundary: Ring[];
  view: ViewSettings;
}

/** 过火指数场（降采样，用于轮廓提取与分级） */
export interface BurnField {
  width: number;
  height: number;
  values: Float32Array;
  georef: Georef;
}

export interface SpotInfo {
  x: number;
  y: number;
  elevation: number;
  slope: number;
  severity: number;
  classIndex: number;
  boundaryDistance: number;
  bearing: number;
}
