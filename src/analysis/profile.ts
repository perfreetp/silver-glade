// 沿航路的垂直剖面采样:能见度场、云底高度、最低安全高度(MSA)

import { NX, NY, NZ, WORLD_X, WORLD_Y, WORLD_Z, densityToVisibility } from '../data/weatherSim';
import { terrainHeight } from '../data/noise';
import type { RoutePoint } from '../store';

export const PROFILE_SAMPLES = 220;
export const PROFILE_LEVELS = 60;
export const PROFILE_MAX_ALT_KM = 6;
export const MSA_CLEARANCE_KM = 0.15; // 150m 越障余度

/** 三线性插值采样体数据密度 0..1 */
export function sampleDensity(data: Uint8Array, x: number, y: number, z: number): number {
  const gx = Math.min(Math.max((x / WORLD_X) * NX - 0.5, 0), NX - 1.001);
  const gy = Math.min(Math.max((y / WORLD_Y) * NY - 0.5, 0), NY - 1.001);
  const gz = Math.min(Math.max((z / WORLD_Z) * NZ - 0.5, 0), NZ - 1.001);
  const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz);
  const fx = gx - x0, fy = gy - y0, fz = gz - z0;
  const at = (ix: number, iy: number, iz: number) => data[ix + iy * NX + iz * NX * NY] / 255;
  const c00 = at(x0, y0, z0) + (at(x0 + 1, y0, z0) - at(x0, y0, z0)) * fx;
  const c10 = at(x0, y0 + 1, z0) + (at(x0 + 1, y0 + 1, z0) - at(x0, y0 + 1, z0)) * fx;
  const c01 = at(x0, y0, z0 + 1) + (at(x0 + 1, y0, z0 + 1) - at(x0, y0, z0 + 1)) * fx;
  const c11 = at(x0, y0 + 1, z0 + 1) + (at(x0 + 1, y0 + 1, z0 + 1) - at(x0, y0 + 1, z0 + 1)) * fx;
  const c0 = c00 + (c10 - c00) * fy;
  const c1 = c01 + (c11 - c01) * fy;
  return c0 + (c1 - c0) * fz;
}

export interface ProfileSample {
  d: number;            // 距起点 km
  x: number;
  z: number;
  segment: number;      // 所属航段索引
  terrainKm: number;
  msaKm: number;
  cloudBaseKm: number | null;
  minVisKm: number;     // 高度带内最低能见度
  bandMeanVisKm: number;
}

export interface SegmentStat {
  index: number;
  from: RoutePoint;
  to: RoutePoint;
  lengthKm: number;
  startD: number;
  endD: number;
  minVisKm: number;
  meanVisKm: number;
  msaMaxM: number;
  clearanceM: number; // bandMin - msaMax
}

export interface ProfileResult {
  distances: number[];
  levelsKm: number[];
  /** vis[i * nL + j],地下为 -1 */
  vis: Float32Array;
  samples: ProfileSample[];
  segments: SegmentStat[];
  totalLengthKm: number;
  bandMinM: number;
  bandMaxM: number;
}

/** 航路折线参数化 */
function buildPolyline(points: RoutePoint[]) {
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dz = points[i].z - points[i - 1].z;
    cum.push(cum[i - 1] + Math.hypot(dx, dz));
  }
  return { cum, total: cum[cum.length - 1] };
}

function pointAt(points: RoutePoint[], cum: number[], d: number): { x: number; z: number; seg: number } {
  for (let i = 0; i < cum.length - 1; i++) {
    if (d <= cum[i + 1] || i === cum.length - 2) {
      const t = cum[i + 1] > cum[i] ? (d - cum[i]) / (cum[i + 1] - cum[i]) : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * Math.min(Math.max(t, 0), 1),
        z: points[i].z + (points[i + 1].z - points[i].z) * Math.min(Math.max(t, 0), 1),
        seg: i,
      };
    }
  }
  return { x: points[0].x, z: points[0].z, seg: 0 };
}

export function computeProfile(
  data: Uint8Array,
  points: RoutePoint[],
  bandMinM: number,
  bandMaxM: number,
  nS = PROFILE_SAMPLES,
  nL = PROFILE_LEVELS,
  maxAltKm = PROFILE_MAX_ALT_KM,
): ProfileResult {
  const { cum, total } = buildPolyline(points);
  const distances: number[] = [];
  const levelsKm: number[] = [];
  for (let j = 0; j < nL; j++) levelsKm.push(((j + 0.5) / nL) * maxAltKm);
  const vis = new Float32Array(nS * nL);
  const samples: ProfileSample[] = [];
  const bandLo = bandMinM / 1000;
  const bandHi = bandMaxM / 1000;

  const rawMsa: number[] = [];
  for (let i = 0; i < nS; i++) {
    const d = (i / (nS - 1)) * total;
    const p = pointAt(points, cum, d);
    const terrain = terrainHeight(p.x, p.z);
    rawMsa.push(terrain + MSA_CLEARANCE_KM);
    distances.push(d);

    let minVis = Infinity;
    let bandSum = 0;
    let bandCount = 0;
    let cloudBase: number | null = null;
    for (let j = 0; j < nL; j++) {
      const alt = levelsKm[j];
      if (alt < terrain) {
        vis[i * nL + j] = -1;
        continue;
      }
      const dens = sampleDensity(data, p.x, alt, p.z);
      const v = densityToVisibility(dens);
      vis[i * nL + j] = v;
      if (cloudBase === null && dens >= 0.2) cloudBase = alt;
      if (alt >= bandLo && alt <= bandHi) {
        bandSum += v;
        bandCount++;
        if (v < minVis) minVis = v;
      }
    }
    samples.push({
      d, x: p.x, z: p.z, segment: p.seg,
      terrainKm: terrain,
      msaKm: 0, // 平滑后回填
      cloudBaseKm: cloudBase,
      minVisKm: minVis === Infinity ? 15 : minVis,
      bandMeanVisKm: bandCount > 0 ? bandSum / bandCount : 15,
    });
  }

  // MSA 平滑:±2km 窗口取最大(防止穿越孤立尖峰)
  const win = Math.max(1, Math.round((2 / total) * nS));
  for (let i = 0; i < nS; i++) {
    let m = 0;
    for (let k = Math.max(0, i - win); k <= Math.min(nS - 1, i + win); k++) {
      if (rawMsa[k] > m) m = rawMsa[k];
    }
    samples[i].msaKm = m;
  }

  // 航段统计
  const segments: SegmentStat[] = [];
  for (let s = 0; s < points.length - 1; s++) {
    const inSeg = samples.filter((sm) => sm.segment === s);
    const minVis = Math.min(...inSeg.map((sm) => sm.minVisKm));
    const meanVis = inSeg.reduce((a, sm) => a + sm.bandMeanVisKm, 0) / Math.max(1, inSeg.length);
    const msaMax = Math.max(...inSeg.map((sm) => sm.msaKm));
    segments.push({
      index: s,
      from: points[s],
      to: points[s + 1],
      lengthKm: cum[s + 1] - cum[s],
      startD: cum[s],
      endD: cum[s + 1],
      minVisKm: minVis,
      meanVisKm: meanVis,
      msaMaxM: msaMax * 1000,
      clearanceM: bandMinM - msaMax * 1000,
    });
  }

  return { distances, levelsKm, vis, samples, segments, totalLengthKm: total, bandMinM, bandMaxM };
}

/** 沿航路的云底高度统计(体积视图 HUD 用) */
export function routeCloudBase(
  data: Uint8Array,
  points: RoutePoint[],
  threshold: number,
): { min: number; mean: number } | null {
  const { cum, total } = buildPolyline(points);
  const bases: number[] = [];
  const n = 80;
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * total;
    const p = pointAt(points, cum, d);
    for (let j = 0; j < NY; j++) {
      const alt = ((j + 0.5) / NY) * WORLD_Y;
      if (sampleDensity(data, p.x, alt, p.z) >= threshold) {
        bases.push(alt);
        break;
      }
    }
  }
  if (bases.length === 0) return null;
  return {
    min: Math.min(...bases),
    mean: bases.reduce((a, b) => a + b, 0) / bases.length,
  };
}
