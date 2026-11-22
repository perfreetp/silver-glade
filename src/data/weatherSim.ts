// 气象体数据模拟:24 帧时序,3 个移动的雷暴单体 + 层云背景
// 体素布局与 THREE.Data3DTexture 一致:x 最快,然后 y,然后 z
//   index = gx + gy * NX + gz * NX * NY

import { fbm3 } from './noise';

export const NX = 128;
export const NY = 48;
export const NZ = 128;
export const WORLD_X = 60; // km
export const WORLD_Y = 12; // km
export const WORLD_Z = 60; // km
export const FRAMES = 24;

export const CHUNK_X = 32;
export const CHUNK_Y = 16;
export const CHUNK_Z = 32;
export const CHUNKS_X = NX / CHUNK_X; // 4
export const CHUNKS_Y = NY / CHUNK_Y; // 3
export const CHUNKS_Z = NZ / CHUNK_Z; // 4
export const CHUNK_COUNT = CHUNKS_X * CHUNKS_Y * CHUNKS_Z; // 48

interface StormCell {
  x: number; z: number;       // 第 0 帧中心位置 (km)
  vx: number; vz: number;     // 每帧移动速度 (km/frame)
  radius: number;             // 水平半径 (km)
  cloudBase: number;          // 云底高度 (km)
  top: number;                // 云顶高度 (km)
  intensity: number;
  seed: number;
}

const CELLS: StormCell[] = [
  { x: 14, z: 34, vx: 0.75, vz: -0.28, radius: 6.5, cloudBase: 1.1, top: 11.0, intensity: 1.0, seed: 11 },
  { x: 42, z: 14, vx: -0.45, vz: 0.55, radius: 4.5, cloudBase: 1.7, top: 9.0, intensity: 0.85, seed: 23 },
  { x: 26, z: 50, vx: 0.35, vz: -0.50, radius: 5.2, cloudBase: 1.4, top: 10.0, intensity: 0.9, seed: 37 },
];

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function cellDensity(px: number, py: number, pz: number, c: StormCell, frame: number): number {
  const cx = c.x + c.vx * frame;
  const cz = c.z + c.vz * frame;
  const dx = px - cx, dz = pz - cz;
  const r2 = (dx * dx + dz * dz) / (c.radius * c.radius);
  if (r2 > 4) return 0;
  if (py < c.cloudBase - 0.4 || py > c.top) return 0;
  const horiz = Math.exp(-r2 * 2.2);
  const up = smoothstep(c.cloudBase - 0.4, c.cloudBase + 0.9, py);
  const down = 1 - smoothstep(c.top - 2.5, c.top, py);
  // 菜花状扰动,随时间缓慢翻滚
  const n = fbm3(px * 0.35 + c.seed + frame * 0.12, py * 0.35 + c.seed, pz * 0.35, 3);
  return horiz * up * down * (0.5 + 0.75 * n) * c.intensity;
}

/** 世界坐标 (km) 处的云密度 0..1 */
export function densityAt(px: number, py: number, pz: number, frame: number): number {
  let d = 0;
  for (const c of CELLS) d += cellDensity(px, py, pz, c, frame);
  // 层云背景层 2.0~4.0 km
  const amb = smoothstep(2.0, 2.7, py) * (1 - smoothstep(3.3, 4.0, py));
  if (amb > 0) d += amb * (0.08 + 0.14 * fbm3(px * 0.12, py * 0.3 + 5, pz * 0.12, 3));
  return Math.min(1, d);
}

/** 密度(0..1) → 能见度 (km),Koschmieder 公式 V = 3.912 / β */
export function densityToVisibility(d: number): number {
  return Math.min(15, Math.max(0.05, 3.912 / (d * 9 + 1e-3)));
}

export function voxelToWorld(ix: number, iy: number, iz: number): [number, number, number] {
  return [
    ((ix + 0.5) / NX) * WORLD_X,
    ((iy + 0.5) / NY) * WORLD_Y,
    ((iz + 0.5) / NZ) * WORLD_Z,
  ];
}

/** 生成一个分块,局部布局:x 最快,然后 y,然后 z */
export function generateChunk(frame: number, cx: number, cy: number, cz: number): Uint8Array {
  const out = new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z);
  let i = 0;
  for (let ly = 0; ly < CHUNK_Y; ly++) {
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const [wx, wy, wz] = voxelToWorld(cx * CHUNK_X + lx, cy * CHUNK_Y + ly, cz * CHUNK_Z + lz);
        out[i++] = Math.round(densityAt(wx, wy, wz, frame) * 255);
      }
    }
  }
  return out;
}

/** 把 48 个分块拼成整帧(分块顺序:cy → cz → cx) */
export function assembleChunks(chunks: Uint8Array[]): Uint8Array {
  const data = new Uint8Array(NX * NY * NZ);
  let idx = 0;
  for (let cy = 0; cy < CHUNKS_Y; cy++) {
    for (let cz = 0; cz < CHUNKS_Z; cz++) {
      for (let cx = 0; cx < CHUNKS_X; cx++, idx++) {
        const chunk = chunks[idx];
        let i = 0;
        for (let ly = 0; ly < CHUNK_Y; ly++) {
          const gy = cy * CHUNK_Y + ly;
          for (let lz = 0; lz < CHUNK_Z; lz++) {
            const gz = cz * CHUNK_Z + lz;
            const rowBase = gy * NX + gz * NX * NY + cx * CHUNK_X;
            for (let lx = 0; lx < CHUNK_X; lx++) {
              data[rowBase + lx] = chunk[i++];
            }
          }
        }
      }
    }
  }
  return data;
}

/** 分块生成整帧,带进度回调,周期性让出主线程 */
export async function generateFrame(
  frame: number,
  onChunk?: (done: number, total: number) => void,
): Promise<{ data: Uint8Array; chunks: Uint8Array[] }> {
  const chunks: Uint8Array[] = new Array(CHUNK_COUNT);
  let done = 0;
  for (let cy = 0; cy < CHUNKS_Y; cy++) {
    for (let cz = 0; cz < CHUNKS_Z; cz++) {
      for (let cx = 0; cx < CHUNKS_X; cx++) {
        chunks[done] = generateChunk(frame, cx, cy, cz);
        done++;
        onChunk?.(done, CHUNK_COUNT);
        if (done % 6 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    }
  }
  return { data: assembleChunks(chunks), chunks };
}
