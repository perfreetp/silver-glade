import type { Fan } from '../model/room';
import type { Solution, SolveOptions } from './field';
import type { SolveRequest, SolveResponse } from './worker';

export interface SolverClient {
  solve(fans: Fan[], opts: SolveOptions): Promise<Solution>;
  dispose(): void;
  /** Worker 是否可用 (不可用时退回主线程) */
  readonly usingWorker: boolean;
}

/**
 * 把风场求解放到 Web Worker 里跑, 拖动时主线程仍可保持 60 fps 的渲染与交互。
 * Worker 不可用 (如某些受限环境) 时自动退回主线程同步求解。
 */
export async function createSolverClient(): Promise<SolverClient> {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (!worker) {
    const { solveField } = await import('./field');
    return {
      usingWorker: false,
      async solve(fans, opts) {
        // 让出一帧再算, 避免一次卡死整屏
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        return solveField(fans, opts);
      },
      dispose() {},
    };
  }

  let seq = 0;
  let inFlight: number | null = null;
  const queue: { id: number; fans: Fan[]; opts: SolveOptions; resolve: (s: Solution) => void; reject: (e: Error) => void }[] = [];
  const pending = new Map<number, { resolve: (s: Solution) => void; reject: (e: Error) => void }>();

  function settleNext() {
    if (inFlight !== null || !queue.length) return;
    const last = queue[queue.length - 1];
    // 丢弃所有更早的请求 (已过期)
    for (let i = 0; i < queue.length - 1; i++) queue[i].reject(new Error('superseded'));
    queue.length = 0;
    inFlight = last.id;
    pending.set(last.id, { resolve: last.resolve, reject: last.reject });
    const req: SolveRequest = { id: last.id, fans: last.fans, options: last.opts };
    worker!.postMessage(req);
  }

  worker.onmessage = (ev: MessageEvent<SolveResponse>) => {
    const { id, solution, error } = ev.data;
    const p = pending.get(id);
    pending.delete(id);
    if (inFlight === id) inFlight = null;
    if (p) {
      if (error || !solution) p.reject(new Error(error ?? 'solve failed'));
      else p.resolve(solution);
    }
    settleNext();
  };

  worker.onerror = (e) => {
    for (const [, p] of pending) p.reject(new Error(e.message || 'worker error'));
    pending.clear();
    for (const q of queue) q.reject(new Error('worker error'));
    queue.length = 0;
    inFlight = null;
  };

  return {
    usingWorker: true,
    solve(fans, opts) {
      const id = ++seq;
      return new Promise<Solution>((resolve, reject) => {
        queue.push({ id, fans, opts, resolve, reject });
        settleNext();
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      queue.length = 0;
      pending.clear();
    },
  };
}
