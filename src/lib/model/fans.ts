import {
  add,
  dot,
  cross,
  norm,
  scale,
  ROOM,
  v3,
  wallFrame,
  type Fan,
  type Vec3,
  type Wall,
  type WallFrame,
} from './room';

export type { Fan } from './room';

/** 风机中心的世界坐标 */
export function fanWorldPosition(fan: Fan): Vec3 {
  const f = wallFrame(fan.wall);
  return add(add(f.origin, scale(f.side, fan.u)), scale(f.up, fan.v));
}

/**
 * 气流轴线方向 (指向室内一侧)
 * tilt>0 向墙面 u 轴正方向偏转; pitch>0 向上偏转
 */
export function fanAxisDir(fan: Fan, frame?: WallFrame): Vec3 {
  const f = frame ?? wallFrame(fan.wall);
  const ct = Math.cos(fan.pitch);
  const st = Math.sin(fan.pitch);
  const cs = Math.cos(fan.tilt);
  const ss = Math.sin(fan.tilt);
  return norm(
    add(add(scale(f.normal, ct * cs), scale(f.side, ct * ss)), scale(f.up, st)),
  );
}

/** 房间内的空气实际运动方向: 进风 = 吹入室内, 回风 = 吸入墙内 */
export function fanAirDir(fan: Fan): Vec3 {
  const a = fanAxisDir(fan);
  return fan.kind === 'supply' ? a : scale(a, -1);
}

/** 风机在墙面局部坐标中的矩形 (u/v 范围) */
export function fanRect(fan: Fan): { u0: number; u1: number; v0: number; v1: number } {
  return { u0: fan.u - fan.radius, u1: fan.u + fan.radius, v0: fan.v - fan.radius, v1: fan.v + fan.radius };
}

/** 世界点在指定墙面上的局部坐标 */
export function worldToWall(wall: Wall, p: Vec3): { u: number; v: number } {
  const f = wallFrame(wall);
  const rel = { x: p.x - f.origin.x, y: p.y - f.origin.y, z: p.z - f.origin.z };
  return { u: dot(rel, f.side), v: dot(rel, f.up) };
}

/** 墙面局部坐标 -> 世界坐标 (可给定离墙偏移) */
export function wallToWorld(wall: Wall, u: number, v: number, offset = 0): Vec3 {
  const f = wallFrame(wall);
  return add(add(f.origin, scale(f.side, u)), add(scale(f.up, v), scale(f.normal, offset)));
}

/** 风机面板可移动范围 */
export function clampFanUV(fan: Fan, u: number, v: number) {
  const f = wallFrame(fan.wall);
  const m = fan.radius + 0.06;
  return {
    u: Math.min(f.width - m, Math.max(m, u)),
    v: Math.min(f.height - m, Math.max(m, v)),
  };
}

/** 单个风机的出风口面积 */
export const fanArea = (fan: Fan) => Math.PI * fan.radius * fan.radius;
/** 面风速 m/s */
export const fanFaceSpeed = (fan: Fan) => fan.airflow / 3600 / fanArea(fan);

let seq = 0;
export function makeFan(partial: Partial<Fan> = {}): Fan {
  const kind = partial.kind ?? 'supply';
  const wall = partial.wall ?? (kind === 'supply' ? 'west' : 'east');
  const f = wallFrame(wall);
  seq++;
  return {
    id: partial.id ?? `fan-${Date.now().toString(36)}-${seq}`,
    name: partial.name ?? `${kind === 'supply' ? '进风' : '回风'}机 ${seq}`,
    kind,
    wall,
    u: partial.u ?? f.width / 2,
    v: partial.v ?? Math.min(f.height - 0.8, 3.0),
    radius: partial.radius ?? 0.5,
    airflow: partial.airflow ?? (kind === 'supply' ? 7000 : 7000),
    tilt: partial.tilt ?? 0,
    pitch: partial.pitch ?? 0,
  };
}

/** 默认工况: 两端对吹 + 侧墙回风, 形成绕菇架的循环 */
export function defaultFans(): Fan[] {
  return [
    makeFan({ id: 'sup-w-1', name: '进风 1 (西墙)', kind: 'supply', wall: 'west', u: 4.0, v: 3.3, radius: 0.62, airflow: 9000, tilt: 0, pitch: 0.06 }),
    makeFan({ id: 'sup-w-2', name: '进风 2 (西墙低位)', kind: 'supply', wall: 'west', u: 0.95, v: 0.85, radius: 0.4, airflow: 3200, tilt: 0.25, pitch: 0.18 }),
    makeFan({ id: 'exh-e-1', name: '回风 1 (东墙)', kind: 'exhaust', wall: 'east', u: 1.15, v: 5.0, radius: 0.5, airflow: 6300, tilt: 0, pitch: 0 }),
    makeFan({ id: 'exh-e-2', name: '回风 2 (东墙)', kind: 'exhaust', wall: 'east', u: 6.85, v: 5.0, radius: 0.5, airflow: 5900, tilt: 0, pitch: 0 }),
  ];
}
