import * as THREE from 'three';
import { GRID_FINE, ROOM, type Solution } from '../solver/field';

export interface VelocitySampler {
  /** 采样细网格风速矢量 (m/s); 返回 false 表示落在实体 / 房间外 */
  sample(x: number, y: number, z: number, out: Float32Array): boolean;
  /** 采样速度标量 */
  speedAt(x: number, y: number, z: number): number;
  /** 采样空气龄 (0..1) */
  ageAt(x: number, y: number, z: number): number;
  /** 该点是否在流体域内 */
  isFluid(x: number, y: number, z: number): boolean;
  /** 细网格数据引用 */
  readonly velocity: Float32Array;
  readonly speed: Float32Array;
  readonly age: Float32Array;
  readonly solid: Uint8Array;
  readonly grid: { nx: number; ny: number; nz: number; h: number };
  /** 房间尺寸 */
  readonly room: { lx: number; ly: number; lz: number };
}

const OUT = new Float32Array(3);

export function createSampler(sol: Solution): VelocitySampler {
  const g = sol.fine;
  const vel = sol.velocity;
  const spd = sol.speed;
  const solid = sol.solidFine;
  const nx = g.nx,
    ny = g.ny,
    nz = g.nz,
    h = g.h;

  const sample = (x: number, y: number, z: number, out: Float32Array): boolean => {
    const gx = x / h - 0.5,
      gy = y / h - 0.5,
      gz = z / h - 0.5;
    if (gx < 0 || gy < 0 || gz < 0 || gx > nx - 1.001 || gy > ny - 1.001 || gz > nz - 1.001) return false;
    const ix = Math.floor(gx),
      iy = Math.floor(gy),
      iz = Math.floor(gz);
    const i0 = Math.min(nx - 2, ix),
      j0 = Math.min(ny - 2, iy),
      k0 = Math.min(nz - 2, iz);
    const fx = gx - i0,
      fy = gy - j0,
      fz = gz - k0;
    const c000 = i0 + nx * (k0 + nz * j0);
    const c100 = c000 + 1;
    const c010 = c000 + nx;
    const c110 = c010 + 1;
    const c001 = c000 + nx * nz;
    const c101 = c001 + 1;
    const c011 = c001 + nx;
    const c111 = c011 + 1;
    const s0 = solid[c000],
      s1 = solid[c100],
      s2 = solid[c010],
      s3 = solid[c110],
      s4 = solid[c001],
      s5 = solid[c101],
      s6 = solid[c011],
      s7 = solid[c111];
    // 任一近邻是实体: 用实体本身作为阻挡判定 (粒子进入实体即重生)
    // 用加权边界: 若所有 8 个邻居都是实体则判定为实体
    if (s0 && s1 && s2 && s3 && s4 && s5 && s6 && s7) return false;
    const w000 = (1 - fx) * (1 - fy) * (1 - fz) * (s0 ? 0 : 1);
    const w100 = fx * (1 - fy) * (1 - fz) * (s1 ? 0 : 1);
    const w010 = (1 - fx) * fy * (1 - fz) * (s2 ? 0 : 1);
    const w110 = fx * fy * (1 - fz) * (s3 ? 0 : 1);
    const w001 = (1 - fx) * (1 - fy) * fz * (s4 ? 0 : 1);
    const w101 = fx * (1 - fy) * fz * (s5 ? 0 : 1);
    const w011 = (1 - fx) * fy * fz * (s6 ? 0 : 1);
    const w111 = fx * fy * fz * (s7 ? 0 : 1);
    const ws = w000 + w100 + w010 + w110 + w001 + w101 + w011 + w111;
    if (ws < 1e-5) return false;
    const inv = 1 / ws;
    out[0] =
      (vel[3 * c000] * w000 + vel[3 * c100] * w100 + vel[3 * c010] * w010 + vel[3 * c110] * w110 + vel[3 * c001] * w001 + vel[3 * c101] * w101 + vel[3 * c011] * w011 + vel[3 * c111] * w111) *
      inv;
    out[1] =
      (vel[3 * c000 + 1] * w000 + vel[3 * c100 + 1] * w100 + vel[3 * c010 + 1] * w010 + vel[3 * c110 + 1] * w110 + vel[3 * c001 + 1] * w001 + vel[3 * c101 + 1] * w101 + vel[3 * c011 + 1] * w011 + vel[3 * c111 + 1] * w111) *
      inv;
    out[2] =
      (vel[3 * c000 + 2] * w000 + vel[3 * c100 + 2] * w100 + vel[3 * c010 + 2] * w010 + vel[3 * c110 + 2] * w110 + vel[3 * c001 + 2] * w001 + vel[3 * c101 + 2] * w101 + vel[3 * c011 + 2] * w011 + vel[3 * c111 + 2] * w111) *
      inv;
    return true;
  };

  const speedAt = (x: number, y: number, z: number): number => {
    const gx = x / h - 0.5,
      gy = y / h - 0.5,
      gz = z / h - 0.5;
    if (gx < 0 || gy < 0 || gz < 0 || gx > nx - 1.001 || gy > ny - 1.001 || gz > nz - 1.001) return 0;
    const ix = Math.floor(gx),
      iy = Math.floor(gy),
      iz = Math.floor(gz);
    const i0 = Math.min(nx - 2, ix),
      j0 = Math.min(ny - 2, iy),
      k0 = Math.min(nz - 2, iz);
    const fx = gx - i0,
      fy = gy - j0,
      fz = gz - k0;
    const c000 = i0 + nx * (k0 + nz * j0);
    const c100 = c000 + 1,
      c010 = c000 + nx,
      c110 = c010 + 1,
      c001 = c000 + nx * nz,
      c101 = c001 + 1,
      c011 = c001 + nx,
      c111 = c011 + 1;
    const w000 = (1 - fx) * (1 - fy) * (1 - fz) * (solid[c000] ? 0 : 1);
    const w100 = fx * (1 - fy) * (1 - fz) * (solid[c100] ? 0 : 1);
    const w010 = (1 - fx) * fy * (1 - fz) * (solid[c010] ? 0 : 1);
    const w110 = fx * fy * (1 - fz) * (solid[c110] ? 0 : 1);
    const w001 = (1 - fx) * (1 - fy) * fz * (solid[c001] ? 0 : 1);
    const w101 = fx * (1 - fy) * fz * (solid[c101] ? 0 : 1);
    const w011 = (1 - fx) * fy * fz * (solid[c011] ? 0 : 1);
    const w111 = fx * fy * fz * (solid[c111] ? 0 : 1);
    const ws = w000 + w100 + w010 + w110 + w001 + w101 + w011 + w111;
    if (ws < 1e-5) return 0;
    return (
      (spd[c000] * w000 + spd[c100] * w100 + spd[c010] * w010 + spd[c110] * w110 + spd[c001] * w001 + spd[c101] * w101 + spd[c011] * w011 + spd[c111] * w111) /
      ws
    );
  };

  const isFluid = (x: number, y: number, z: number): boolean => {
    if (x < 0 || y < 0 || z < 0 || x > ROOM.lx || y > ROOM.ly || z > ROOM.lz) return false;
    const i = Math.min(nx - 1, Math.max(0, Math.floor(x / h)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor(y / h)));
    const k = Math.min(nz - 1, Math.max(0, Math.floor(z / h)));
    return solid[i + nx * (k + nz * j)] === 0;
  };

  const ageAt = (x: number, y: number, z: number): number => {
    const gx = x / h - 0.5,
      gy = y / h - 0.5,
      gz = z / h - 0.5;
    if (gx < 0 || gy < 0 || gz < 0 || gx > nx - 1.001 || gy > ny - 1.001 || gz > nz - 1.001) return 1;
    const i0 = Math.min(nx - 2, Math.floor(gx)),
      j0 = Math.min(ny - 2, Math.floor(gy)),
      k0 = Math.min(nz - 2, Math.floor(gz));
    const fx = gx - i0,
      fy = gy - j0,
      fz = gz - k0;
    const c = i0 + nx * (k0 + nz * j0);
    const w000 = (1 - fx) * (1 - fy) * (1 - fz),
      w100 = fx * (1 - fy) * (1 - fz),
      w010 = (1 - fx) * fy * (1 - fz),
      w110 = fx * fy * (1 - fz),
      w001 = (1 - fx) * (1 - fy) * fz,
      w101 = fx * (1 - fy) * fz,
      w011 = (1 - fx) * fy * fz,
      w111 = fx * fy * fz;
    const a = ageRef;
    return (
      a[c] * w000 +
      a[c + 1] * w100 +
      a[c + nx] * w010 +
      a[c + nx + 1] * w110 +
      a[c + nx * nz] * w001 +
      a[c + nx * nz + 1] * w101 +
      a[c + nx * nz + nx] * w011 +
      a[c + nx * nz + nx + 1] * w111
    );
  };

  const ageRef = sol.age;
  return { sample, speedAt, ageAt, isFluid, velocity: vel, speed: spd, age: ageRef, solid, grid: g, room: ROOM };
}
