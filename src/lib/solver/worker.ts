/// <reference lib="webworker" />
/**
 * 风场求解 Web Worker
 *
 * 主线程把风机参数发过来, 这里跑 solveField, 再把体素数组转移回去。
 * 因为转移后 buffer 会被 detach, 下一次求解会自动重建缓冲, 不会残留旧数据。
 */

import { solveField, resetSolveCache, type Solution, type SolveOptions } from './field';
import type { Fan } from '../model/room';

export interface SolveRequest {
  id: number;
  fans: Fan[];
  options: SolveOptions;
}

export interface SolveResponse {
  id: number;
  solution: Solution | null;
  error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<SolveRequest>) => {
  const { id, fans, options } = ev.data;
  try {
    // 上一轮把数组 transfer 出去了, 缓存里的 buffer 已 detach, 必须先重建
    resetSolveCache();
    const solution = solveField(fans, options);
    const transfer: Transferable[] = [
      solution.solidFine.buffer,
      solution.velocity.buffer,
      solution.speed.buffer,
      solution.age.buffer,
      solution.solidCoarse.buffer,
      solution.velocityCoarse.buffer,
    ];
    const res: SolveResponse = { id, solution };
    ctx.postMessage(res, transfer);
  } catch (err) {
    ctx.postMessage({ id, solution: null, error: (err as Error).message } satisfies SolveResponse);
  }
};
