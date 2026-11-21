export interface NozzleSpec {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  /** 喷射角：相对竖直向下的偏角（度） */
  tilt: number;
  /** 方位角（度） */
  azimuth: number;
  /** 张角（半锥角，度） */
  spread: number;
  intensity: number;
  on: boolean;
  color: number;
}

export interface NozzleStats {
  /** 覆盖半径（米） */
  radius: number;
  /** 覆盖栅格数 */
  cells: number;
  /** 与其他喷头重叠的栅格数 */
  overlapCells: number;
  /** 重叠次数（与多少个其他喷头存在覆盖重叠） */
  overlapCount: number;
}
