import { Curve3, Vector3 } from '@babylonjs/core';
import type { PlanPoint, ProfilePoint } from './types';

/** 沿线路径的采样点 */
export interface TrackSample {
  x: number;
  z: number;
  /** 里程(米) */
  s: number;
  /** 平面内单位法向(左侧) */
  nx: number;
  nz: number;
}

/**
 * 平面线形:过平面控制点的 Catmull-Rom 曲线,按弧长等距重采样。
 * @param step 采样间距(米)
 */
export function samplePlan(points: PlanPoint[], step = 5): TrackSample[] {
  if (points.length < 2) return [];
  const vps = points.map((p) => new Vector3(p.x, 0, p.z));
  const curve = Curve3.CreateCatmullRomSpline(vps, 16, false);
  const raw = curve.getPoints();
  if (raw.length < 2) return [];

  const cum: number[] = [0];
  for (let i = 1; i < raw.length; i++) {
    cum.push(cum[i - 1] + Vector3.Distance(raw[i - 1], raw[i]));
  }
  const total = cum[cum.length - 1];
  if (total < 1e-3) return [];

  const count = Math.max(2, Math.ceil(total / step));
  const out: TrackSample[] = [];
  let seg = 1;
  for (let i = 0; i <= count; i++) {
    const s = Math.min(total, (i * total) / count);
    while (seg < cum.length - 1 && cum[seg] < s) seg++;
    const a = raw[seg - 1];
    const b = raw[seg];
    const s0 = cum[seg - 1];
    const s1 = cum[seg];
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    out.push({ x, z, s, nx: -tz / len, nz: tx / len });
  }
  return out;
}

/** 纵断面高程:控制点间分段线性插值,两端外延为平坡 */
export function elevationAt(profile: ProfilePoint[], s: number): number {
  if (profile.length === 0) return 0;
  if (s <= profile[0].s) return profile[0].elev;
  const last = profile[profile.length - 1];
  if (s >= last.s) return last.elev;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    if (s <= b.s) {
      const t = (s - a.s) / Math.max(1e-6, b.s - a.s);
      return a.elev + (b.elev - a.elev) * t;
    }
  }
  return last.elev;
}

export interface GradeSeg {
  s0: number;
  s1: number;
  /** 坡度(%) */
  grade: number;
}

/** 各坡段坡度(%) */
export function gradeSegments(profile: ProfilePoint[]): GradeSeg[] {
  const out: GradeSeg[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    const ds = b.s - a.s;
    if (ds < 1e-6) continue;
    out.push({ s0: a.s, s1: b.s, grade: ((b.elev - a.elev) / ds) * 100 });
  }
  return out;
}

/** 里程格式化:K12+500 */
export function formatChainage(s: number): string {
  const km = Math.floor(s / 1000);
  const m = Math.round(s - km * 1000);
  return `K${km}+${String(m).padStart(3, '0')}`;
}
