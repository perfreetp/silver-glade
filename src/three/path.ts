import { PATH_SAMPLE_STEP } from './constants';
import type { PathControlPoint, PathSample } from '../types';

let idCounter = 0;
export function uid(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

/** Catmull-Rom 折线平滑：经过每个控制点，生成密集作业样本 */
function catmullRom(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], t: number): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1[0] +
      (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
  const z =
    0.5 *
    (2 * p1[1] +
      (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
  return [x, z];
}

/**
 * 路径重采样：控制点 -> 等间距（PATH_SAMPLE_STEP）样本点。
 * 每个样本带弧长 s 与单位行进方向 (hx,hz)，
 * 弧长作为刀纹相位，使拐弯处横向棱纹依然与行进方向垂直且连续。
 */
export function resamplePath(points: PathControlPoint[]): PathSample[] {
  if (points.length < 2) return [];

  const ctrl: [number, number][] = points.map((p) => [p.x, p.z]);
  const dense: [number, number][] = [];
  const n = ctrl.length;

  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(n - 1, i + 2)];
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(segLen / (PATH_SAMPLE_STEP / 2)));
    for (let k = 0; k < steps; k++) {
      dense.push(catmullRom(p0, p1, p2, p3, k / steps));
    }
  }
  dense.push(ctrl[n - 1]);

  // 计算密集折线的累计弧长
  const arc: number[] = [0];
  let total = 0;
  for (let i = 1; i < dense.length; i++) {
    total += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    arc.push(total);
  }

  // 按弧长等间距取点（行走指针，O(N+M)）
  const samples: PathSample[] = [];
  let seg = 0;
  const count = Math.floor(total / PATH_SAMPLE_STEP);
  for (let k = 0; k <= count; k++) {
    const target = k * PATH_SAMPLE_STEP;
    while (seg < dense.length - 2 && arc[seg + 1] < target) seg++;
    const aLen = arc[seg];
    const bLen = arc[seg + 1];
    const t = bLen > aLen ? (target - aLen) / (bLen - aLen) : 0;
    const x = dense[seg][0] + (dense[seg + 1][0] - dense[seg][0]) * t;
    const z = dense[seg][1] + (dense[seg + 1][1] - dense[seg][1]) * t;
    samples.push({ x, z, hx: 1, hz: 0, s: target });
  }
  const last = dense[dense.length - 1];
  samples.push({ x: last[0], z: last[1], hx: 1, hz: 0, s: total });

  // 中心差分求每个样本的单位行进方向（拐弯处平滑旋转）
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    let hx = b.x - a.x;
    let hz = b.z - a.z;
    const hl = Math.hypot(hx, hz);
    if (hl > 1e-6) {
      samples[i].hx = hx / hl;
      samples[i].hz = hz / hl;
    }
  }
  return samples;
}

/** 路径总长度（米） */
export function pathLength(samples: PathSample[]): number {
  return samples.length ? samples[samples.length - 1].s : 0;
}
