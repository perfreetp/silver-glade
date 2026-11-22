/// <reference lib="webworker" />
import { stepDiffusion, type KernelParams } from './kernel';

/**
 * 扩散模拟 worker。
 *
 * 共享内存布局（一个 SharedArrayBuffer）：
 *   [0, 4N²)              Float32 场 A
 *   [4N², 8N²)            Float32 场 B（双缓冲）
 *   [8N², 8N²+N²)         Uint8 单元格类型
 *   [8N²+N², 8N²+2N²)     Uint8 快照量化区
 *
 * 每一步主线程广播 parity，worker 各自处理自己的水平行带，
 * 完成后回 step-done；主线程收齐全部 ack 后翻转 parity。
 */

interface InitMessage {
  type: 'init';
  workerId: number;
  sab: SharedArrayBuffer;
  params: KernelParams;
  rowStart: number;
  rowEnd: number;
  gridSize: number;
}

interface StepMessage {
  type: 'step';
  parity: 0 | 1;
  params: KernelParams;
}

interface QuantizeMessage {
  type: 'quantize';
  parity: 0 | 1;
}

type InMessage = InitMessage | StepMessage | QuantizeMessage;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let fields: [Float32Array, Float32Array] | null = null;
let cellType: Uint8Array | null = null;
let snapshot: Uint8Array | null = null;
let rowStart = 0;
let rowEnd = 0;
let gridSize = 0;
let workerId = -1;
let params: KernelParams | null = null;

ctx.onmessage = (ev: MessageEvent<InMessage>) => {
  const msg = ev.data;

  if (msg.type === 'init') {
    const m = msg as InitMessage;
    const n = m.gridSize;
    const f0 = new Float32Array(m.sab, 0, n * n);
    const f1 = new Float32Array(m.sab, n * n * 4, n * n);
    fields = [f0, f1];
    cellType = new Uint8Array(m.sab, n * n * 8, n * n);
    snapshot = new Uint8Array(m.sab, n * n * 8 + n * n, n * n);
    rowStart = m.rowStart;
    rowEnd = m.rowEnd;
    gridSize = n;
    workerId = m.workerId;
    params = m.params;
    ctx.postMessage({ type: 'init-done', workerId });
    return;
  }

  if (!fields || !cellType || !snapshot || !params) return;

  if (msg.type === 'step') {
    const sm = msg as StepMessage;
    params = sm.params;
    const cur = fields[sm.parity]!;
    const nxt = fields[1 - sm.parity]!;
    stepDiffusion(cur, nxt, cellType, params, rowStart, rowEnd);
    ctx.postMessage({ type: 'step-done', workerId });
    return;
  }

  if (msg.type === 'quantize') {
    const qm = msg as QuantizeMessage;
    const cur = fields[qm.parity]!;
    const scale = 255 / params.saturation;
    const start = rowStart * gridSize;
    const end = rowEnd * gridSize;
    for (let i = start; i < end; i++) {
      const v = Math.round(cur[i]! * scale);
      snapshot[i] = v <= 0 ? 0 : v >= 255 ? 255 : v;
    }
    ctx.postMessage({ type: 'quantize-done', workerId });
  }
};
