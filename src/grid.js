// 三维正交网格：索引换算、占用栅格（机柜包围盒膨胀）、坐标互转
import { ROOM, GRID } from './config.js';

export class PathGrid {
  constructor() {
    this.cell = GRID.cell;
    this.nx = Math.ceil((ROOM.maxX - ROOM.minX) / this.cell);
    this.ny = Math.ceil((ROOM.maxY - ROOM.minY) / this.cell);
    this.nz = Math.ceil((ROOM.maxZ - ROOM.minZ) / this.cell);
    this.count = this.nx * this.ny * this.nz;
    // 实际世界尺寸（网格覆盖范围）
    this.sizeX = this.nx * this.cell;
    this.sizeY = this.ny * this.cell;
    this.sizeZ = this.nz * this.cell;
    this.originX = ROOM.minX;
    this.originY = ROOM.minY;
    this.originZ = ROOM.minZ;
    this.occ = new Uint8Array(this.count);
  }

  idx(x, y, z) {
    return x + this.nx * (y + this.ny * z);
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }

  // 世界坐标 -> 网格坐标（夹取到边界内）
  worldToCell(v) {
    const x = Math.min(this.nx - 1, Math.max(0, Math.floor((v.x - this.originX) / this.cell)));
    const y = Math.min(this.ny - 1, Math.max(0, Math.floor((v.y - this.originY) / this.cell)));
    const z = Math.min(this.nz - 1, Math.max(0, Math.floor((v.z - this.originZ) / this.cell)));
    return { x, y, z };
  }

  worldToIndex(v) {
    const c = this.worldToCell(v);
    return this.idx(c.x, c.y, c.z);
  }

  // 网格索引 -> 单元中心世界坐标
  centerOf(i, out) {
    const z = Math.floor(i / (this.nx * this.ny));
    const t = i - z * this.nx * this.ny;
    const y = Math.floor(t / this.nx);
    const x = t - y * this.nx;
    out.set(
      this.originX + (x + 0.5) * this.cell,
      this.originY + (y + 0.5) * this.cell,
      this.originZ + (z + 0.5) * this.cell,
    );
    return out;
  }

  // 根据机柜 AABB 构建占用栅格（包围盒膨胀 inflate）
  buildOccupancy(aabbs) {
    this.occ.fill(0);
    const c = this.cell;
    for (let z = 0; z < this.nz; z++) {
      const wz = this.originZ + (z + 0.5) * c;
      for (let y = 0; y < this.ny; y++) {
        const wy = this.originY + (y + 0.5) * c;
        for (let x = 0; x < this.nx; x++) {
          const wx = this.originX + (x + 0.5) * c;
          for (const b of aabbs) {
            if (
              wx > b.min.x - GRID.inflate && wx < b.max.x + GRID.inflate &&
              wy > b.min.y - GRID.inflate && wy < b.max.y + GRID.inflate &&
              wz > b.min.z - GRID.inflate && wz < b.max.z + GRID.inflate
            ) {
              this.occ[this.idx(x, y, z)] = 1;
              break;
            }
          }
        }
      }
    }
  }

  // 网格路径（索引数组）-> 世界坐标点，并去除共线中点，得到正交折线控制点
  cellPathToWaypoints(indexPath) {
    const raw = indexPath.map((i) => {
      const p = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
      return this.centerOf(i, p);
    });
    return simplifyCollinear(raw);
  }
}

// 去除共线点（6 邻接路径全是轴对齐折线）
export function simplifyCollinear(points) {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  const out = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const d1x = Math.sign(b.x - a.x), d1y = Math.sign(b.y - a.y), d1z = Math.sign(b.z - a.z);
    const d2x = Math.sign(c.x - b.x), d2y = Math.sign(c.y - b.y), d2z = Math.sign(c.z - b.z);
    if (d1x !== d2x || d1y !== d2y || d1z !== d2z) out.push({ ...b });
  }
  out.push({ ...points[points.length - 1] });
  return out;
}
