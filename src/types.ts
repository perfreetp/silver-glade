/** 平面控制点(平面走向) */
export interface PlanPoint {
  x: number;
  z: number;
}

/** 纵断面控制点(里程 s,高程 elev) */
export interface ProfilePoint {
  s: number;
  elev: number;
}

/** 地形高度网格 */
export interface TerrainData {
  /** 地形边长(米),正方形 */
  size: number;
  /** 网格分辨率(res x res 个顶点) */
  res: number;
  /** 高度数组,长度 res*res,行主序;行 0 对应 z=+size/2,列 0 对应 x=-size/2 */
  heights: number[];
}

export interface ProjectData {
  version: 1;
  terrain: TerrainData;
  planPoints: PlanPoint[];
  profilePoints: ProfilePoint[];
  /** 道床断面宽度(米) */
  bedWidth: number;
  /** 里程标间距(米) */
  milepostInterval: number;
  showTerrain: boolean;
  showTrack: boolean;
}
