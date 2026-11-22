import { CellType } from './types';

export interface DomainGeometry {
  /** 格点边长 N */
  size: number;
  /** 单元格类型扁平数组，长度 N² */
  cellType: Uint8Array;
  /** 圆心格点坐标 */
  centerX: number;
  centerY: number;
  /** 菌包外半径（格点单位） */
  outerRadius: number;
  /** 中心气孔半径（格点单位） */
  holeRadius: number;
}

/**
 * 把菌包横截面离散成 N×N 格点，构建环形基质域：
 * 圆外为袋壁外部（零通量反射边界），中心圆孔为气孔（吸收边界）。
 */
export function buildDomain(size: number, holeRatio: number): DomainGeometry {
  const cellType = new Uint8Array(size * size);
  const center = (size - 1) / 2;
  const outerRadius = center - 1;
  const holeRadius = outerRadius * holeRatio;
  const outerR2 = outerRadius * outerRadius;
  const holeR2 = holeRadius * holeRadius;

  for (let y = 0; y < size; y++) {
    const dy = y - center;
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const d2 = dx * dx + dy * dy;
      const idx = y * size + x;
      if (d2 > outerR2) {
        cellType[idx] = CellType.Outside;
      } else if (d2 < holeR2) {
        cellType[idx] = CellType.Hole;
      } else {
        cellType[idx] = CellType.Substrate;
      }
    }
  }

  return {
    size,
    cellType,
    centerX: center,
    centerY: center,
    outerRadius,
    holeRadius,
  };
}

/** 判断格点坐标是否位于可接种的基质区域内 */
export function isSubstrateCell(geo: DomainGeometry, gx: number, gy: number): boolean {
  const x = Math.round(gx);
  const y = Math.round(gy);
  if (x < 0 || y < 0 || x >= geo.size || y >= geo.size) return false;
  return geo.cellType[y * geo.size + x] === CellType.Substrate;
}
