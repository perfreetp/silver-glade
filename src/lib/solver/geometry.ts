import {
  RACKS,
  RACK_LEG_SIZE,
  RACK_TOP,
  ROOM,
  SHELF_CENTERS,
  SHELF_THICKNESS,
  wallFrame,
  type Fan,
} from '../model/room';

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  kind: 'shelf' | 'leg';
  rack: number;
}

/** 菇架盒体 (用于渲染 + 体素化)。minThickness 保证薄搁板在粗网格上也占一层。 */
export function rackBoxes(minThickness = 0): Box[] {
  const boxes: Box[] = [];
  const legT = Math.max(RACK_LEG_SIZE, minThickness);
  const shelfT = Math.max(SHELF_THICKNESS, minThickness);
  RACKS.forEach((r, ri) => {
    for (const yc of SHELF_CENTERS) {
      boxes.push({
        x0: r.x0,
        x1: r.x1,
        y0: yc - shelfT / 2,
        y1: yc + shelfT / 2,
        z0: r.z0,
        z1: r.z1,
        kind: 'shelf',
        rack: ri,
      });
    }
    const xs = [r.x0 + legT / 2, (r.x0 + r.x1) / 2, r.x1 - legT / 2];
    const zs = [r.z0 + legT / 2, r.z1 - legT / 2];
    for (const x of xs) {
      for (const z of zs) {
        boxes.push({
          x0: x - legT / 2,
          x1: x + legT / 2,
          y0: 0,
          y1: RACK_TOP,
          z0: z - legT / 2,
          z1: z + legT / 2,
          kind: 'leg',
          rack: ri,
        });
      }
    }
  });
  return boxes;
}

export interface CellGrid {
  nx: number;
  ny: number;
  nz: number;
  h: number;
}

export interface SolidCells {
  solid: Uint8Array;
  /** 风机开孔 (从墙体上打掉的格子) */
  holes: Uint8Array;
}

/** 体素化: 边界墙 + 菇架盒体 + 风机开孔 */
export function buildSolidCells(spec: CellGrid, fans: Fan[], boxes: Box[]): SolidCells {
  const { nx, ny, nz, h } = spec;
  const N = nx * ny * nz;
  const solid = new Uint8Array(N);
  const holes = new Uint8Array(N);
  const I = (x: number, y: number, z: number) => x + nx * (z + nz * y);

  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++)
        if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) solid[I(x, y, z)] = 1;

  const eps = 1e-9;
  for (const b of boxes) {
    const x0 = Math.max(0, Math.ceil(b.x0 / h - 0.5 - eps));
    const x1 = Math.min(nx - 1, Math.floor(b.x1 / h - 0.5 + eps));
    const y0 = Math.max(0, Math.ceil(b.y0 / h - 0.5 - eps));
    const y1 = Math.min(ny - 1, Math.floor(b.y1 / h - 0.5 + eps));
    const z0 = Math.max(0, Math.ceil(b.z0 / h - 0.5 - eps));
    const z1 = Math.min(nz - 1, Math.floor(b.z1 / h - 0.5 + eps));
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        let i = I(x0, y, z);
        for (let x = x0; x <= x1; x++, i++) solid[i] = 1;
      }
  }

  // 风机开孔: 标记墙面一圈被圆盘覆盖的单元 (这些单元保持为实体,
  // 只是给 buildMac 提供"在此处给定通量"的面信息)
  for (const fan of fans) {
    if (!(fan.radius > 0.02)) continue;
    const f = wallFrame(fan.wall);
    for (let y = 0; y < ny; y++) {
      const py = (y + 0.5) * h;
      for (let z = 0; z < nz; z++) {
        const pz = (z + 0.5) * h;
        for (let x = 0; x < nx; x++) {
          const i = I(x, y, z);
          if (!solid[i]) continue;
          const isRing =
            (f.normal.x !== 0 && (x === 0 || x === nx - 1)) ||
            (f.normal.y !== 0 && (y === 0 || y === ny - 1)) ||
            (f.normal.z !== 0 && (z === 0 || z === nz - 1));
          if (!isRing) continue;
          const px = (x + 0.5) * h;
          const rx = px - f.origin.x,
            ry = py - f.origin.y,
            rz = pz - f.origin.z;
          const u = rx * f.side.x + ry * f.side.y + rz * f.side.z;
          const v = rx * f.up.x + ry * f.up.y + rz * f.up.z;
          if ((u - fan.u) ** 2 + (v - fan.v) ** 2 <= fan.radius * fan.radius) holes[i] = 1;
        }
      }
    }
  }

  return { solid, holes };
}

export const ROOM_BOUNDS = { x: ROOM.lx, y: ROOM.ly, z: ROOM.lz };
