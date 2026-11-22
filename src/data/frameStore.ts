// 帧数据存取:内存 LRU → IndexedDB 分块缓存 → 现算并回写分块

import { assembleChunks, generateFrame, CHUNK_COUNT } from './weatherSim';
import { idbGetChunk, idbPutChunk } from './volumeCache';

const memCache = new Map<number, Uint8Array>();
const pending = new Map<number, Promise<Uint8Array>>();
const MAX_MEM_FRAMES = 6;

const chunkKey = (frame: number, i: number) => `f${frame}:c${i}`;

function remember(frame: number, data: Uint8Array): void {
  memCache.delete(frame);
  memCache.set(frame, data);
  while (memCache.size > MAX_MEM_FRAMES) {
    const oldest = memCache.keys().next().value;
    if (oldest === undefined) break;
    memCache.delete(oldest);
  }
}

async function loadFrame(frame: number, onProgress?: (p: number) => void): Promise<Uint8Array> {
  // 1) 尝试从 IndexedDB 分块缓存拼装
  try {
    const chunks = await Promise.all(
      Array.from({ length: CHUNK_COUNT }, (_, i) => idbGetChunk(chunkKey(frame, i))),
    );
    if (chunks.every((c): c is Uint8Array => c !== null)) {
      const data = assembleChunks(chunks);
      remember(frame, data);
      onProgress?.(1);
      return data;
    }
  } catch {
    // IndexedDB 不可用(隐私模式等)时直接现算
  }
  // 2) 现算并分块回写浏览器存储
  const { data, chunks } = await generateFrame(frame, (d, t) => onProgress?.(d / t));
  remember(frame, data);
  Promise.all(chunks.map((c, i) => idbPutChunk(chunkKey(frame, i), c))).catch(() => {});
  return data;
}

export function getFrameData(frame: number, onProgress?: (p: number) => void): Promise<Uint8Array> {
  const hit = memCache.get(frame);
  if (hit) {
    onProgress?.(1);
    return Promise.resolve(hit);
  }
  let p = pending.get(frame);
  if (!p) {
    p = loadFrame(frame, onProgress);
    pending.set(frame, p);
    p.finally(() => pending.delete(frame));
  }
  return p;
}

/** 预取(不等待),用于播放时提前加载下一帧 */
export function prefetchFrame(frame: number): void {
  void getFrameData(frame).catch(() => {});
}
