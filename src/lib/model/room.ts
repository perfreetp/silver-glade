/**
 * 菇房几何 / 网格 / 风机模型
 *
 * 坐标系: 右手系, 单位米, Y 轴向上
 *   +X 房间长度 (12.8 m)   +Y 高度 (6.4 m)   +Z 房间进深 (8.0 m)
 * 房间原点位于地面、进风端、侧墙的交点。
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const ROOM = { lx: 12.8, ly: 6.4, lz: 8.0 } as const;

/** 计算网格 (投影求解用) */
export const COARSE_H = 0.16;
export const COARSE_N = { nx: 80, ny: 40, nz: 50 } as const;

/** 体素风场网格 (细, 用于粒子采样 / 切片 / 导出) */
export const FINE_H = 0.08;
export const FINE_N = { nx: 160, ny: 80, nz: 100 } as const;

export const FINE_COUNT = FINE_N.nx * FINE_N.ny * FINE_N.nz; // 1,280,000 体素

/** 菇架: 沿 X 方向布置的两排多层菇架 */
export interface RackDef {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export const RACKS: RackDef[] = [
  { id: 'rack-A', x0: 1.44, x1: 11.36, z0: 1.76, z1: 3.2 },
  { id: 'rack-B', x0: 1.44, x1: 11.36, z0: 4.8, z1: 6.24 },
];

/** 每层菇床搁板的中心高度 */
export const SHELF_CENTERS = [0.56, 1.52, 2.48, 3.44];
export const SHELF_THICKNESS = 0.16;
export const RACK_TOP = SHELF_CENTERS[SHELF_CENTERS.length - 1] + SHELF_THICKNESS / 2;
export const RACK_LEG_SIZE = 0.07;

export type Wall = 'west' | 'east' | 'south' | 'north' | 'ceiling';
export type FanKind = 'supply' | 'exhaust';

export interface WallFrame {
  /** 指向房间内部的法向 */
  normal: Vec3;
  /** 墙面水平切向 (u 轴) */
  side: Vec3;
  /** 墙面竖直切向 (v 轴) */
  up: Vec3;
  /** u=0, v=0 处墙角 */
  origin: Vec3;
  /** 墙面宽度 (沿 side) */
  width: number;
  /** 墙面高度 (沿 up) */
  height: number;
}

/** 每面墙的局部坐标系: u 从左到右, v 从下到上, 法向指向室内 */
export function wallFrame(wall: Wall): WallFrame {
  switch (wall) {
    case 'west':
      return { normal: v3(1, 0, 0), side: v3(0, 0, 1), up: v3(0, 1, 0), origin: v3(0, 0, 0), width: ROOM.lz, height: ROOM.ly };
    case 'east':
      return { normal: v3(-1, 0, 0), side: v3(0, 0, -1), up: v3(0, 1, 0), origin: v3(ROOM.lx, 0, ROOM.lz), width: ROOM.lz, height: ROOM.ly };
    case 'south':
      return { normal: v3(0, 0, 1), side: v3(1, 0, 0), up: v3(0, 1, 0), origin: v3(0, 0, 0), width: ROOM.lx, height: ROOM.ly };
    case 'north':
      return { normal: v3(0, 0, -1), side: v3(-1, 0, 0), up: v3(0, 1, 0), origin: v3(ROOM.lx, 0, ROOM.lz), width: ROOM.lx, height: ROOM.ly };
    case 'ceiling':
      return { normal: v3(0, -1, 0), side: v3(1, 0, 0), up: v3(0, 0, -1), origin: v3(0, ROOM.ly, ROOM.lz), width: ROOM.lx, height: ROOM.lz };
  }
}

export const WALL_LABEL: Record<Wall, string> = {
  west: '西墙 (X=0)',
  east: '东墙 (X=max)',
  south: '南墙 (Z=0)',
  north: '北墙 (Z=max)',
  ceiling: '顶棚',
};

/**
 * 风机 / 风口
 * 位置用 (wall, u, v) 参数化: u 沿墙面宽度, v 沿墙面高度, 均以米计。
 * 拖动时直接改 u/v, 因此风机永远贴在墙面上。
 */
export interface Fan {
  id: string;
  name: string;
  kind: FanKind;
  wall: Wall;
  u: number;
  v: number;
  /** 风口半径 (m) */
  radius: number;
  /** 风量 (m³/h) */
  airflow: number;
  /** 出流方向, 在墙面局部坐标中: tilt = 水平偏转 (向右为正), pitch = 仰角 (向上为正) */
  tilt: number;
  pitch: number;
}
