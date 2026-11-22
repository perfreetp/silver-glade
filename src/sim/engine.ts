import { buildDomain, type DomainGeometry } from './geometry';
import { seedInoculation, stepDiffusion, type KernelParams } from './kernel';
import { encodeRLE } from './codec';
import {
  CONCENTRATION_MAX,
  environmentFactor,
  type InoculationPoint,
  type SimParams,
  type Snapshot,
} from './types';
import DiffusionWorker from './diffusion-worker.ts?worker';

export interface EngineEvents {
  progress: { step: number; totalSteps: number; frameIndex: number };
  finished: { snapshots: Snapshot[] };
  error: { message: string };
}

type Listener<K extends keyof EngineEvents> = (payload: EngineEvents[K]) => void;

const BASE_DIFFUSIVITY = 0.2;
const GROWTH_RATE = 0.03;
const HOLE_ABSORPTION = 0.28;

/**
 * 菌丝扩散模拟引擎。
 *
 * 格点域较大时（默认 768²，最高 2048²），把水平行带切分给多个 worker 并行推进；
 * 所有 worker 通过 SharedArrayBuffer 共享双缓冲浓度场，零拷贝同步。
 * 浏览器不支持跨源隔离（无 COOP/COEP）时自动降级为主线程单任务模式。
 */
export class SimulationEngine {
  private geo: DomainGeometry | null = null;
  private sab: SharedArrayBuffer | ArrayBuffer | null = null;
  private fields: [Float32Array, Float32Array] | null = null;
  private cellType: Uint8Array | null = null;
  private snapshotBuf: Uint8Array | null = null;
  private workers: Worker[] = [];
  private params: SimParams | null = null;
  private snapshots: Snapshot[] = [];
  private cancelled = false;
  private running = false;
  private kernelParams: KernelParams | null = null;
  private readonly parallel: boolean;
  private readonly workerCount: number;
  private bands: Array<[number, number]> = [];
  private listeners: { [K in keyof EngineEvents]?: Array<Listener<K>> } = {};

  constructor() {
    this.parallel = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true;
    this.workerCount = this.parallel
      ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))
      : 1;
  }

  get isParallel(): boolean {
    return this.parallel;
  }

  get workerTotal(): number {
    return this.workerCount;
  }

  on<K extends keyof EngineEvents>(event: K, fn: Listener<K>): () => void {
    const list = (this.listeners[event] ??= [] as Array<Listener<keyof EngineEvents>>) as Array<Listener<K>>;
    list.push(fn);
    return () => {
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  private emit<K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]): void {
    for (const fn of this.listeners[event] ?? []) (fn as Listener<K>)(payload);
  }

  /** 初始化 / 重建格点域与共享内存，并按接种点重新布源。 */
  configure(params: SimParams, points: InoculationPoint[]): void {
    this.disposeWorkers();
    this.params = params;
    this.snapshots = [];
    this.cancelled = false;

    this.geo = buildDomain(params.gridSize, params.holeRatio);
    const n = params.gridSize;
    const fieldBytes = n * n * 4;
    const totalBytes = fieldBytes * 2 + n * n * 2;

    if (this.parallel) {
      this.sab = new SharedArrayBuffer(totalBytes);
    } else {
      this.sab = new ArrayBuffer(totalBytes);
    }
    const f0 = new Float32Array(this.sab, 0, n * n);
    const f1 = new Float32Array(this.sab, fieldBytes, n * n);
    this.fields = [f0, f1];
    this.cellType = new Uint8Array(this.sab, fieldBytes * 2, n * n);
    this.cellType.set(this.geo.cellType);
    this.snapshotBuf = new Uint8Array(this.sab, fieldBytes * 2 + n * n, n * n);

    this.kernelParams = this.buildKernelParams(params);

    // 接种点源注入（写入场 A）
    const seedRadius = Math.max(3, Math.round(n / 180));
    seedInoculation(f0, this.cellType, n, points, seedRadius, CONCENTRATION_MAX * 0.85);

    // 行带切分
    this.bands = [];
    const per = Math.ceil(n / this.workerCount);
    for (let w = 0; w < this.workerCount; w++) {
      const r0 = Math.min(n, w * per);
      const r1 = Math.min(n, (w + 1) * per);
      if (r0 < r1) this.bands.push([r0, r1]);
    }

    if (this.parallel) this.spawnWorkers();
  }

  private buildKernelParams(params: SimParams): KernelParams {
    return {
      size: params.gridSize,
      envFactor: environmentFactor(params.temperature, params.humidity),
      baseDiffusivity: BASE_DIFFUSIVITY,
      growthRate: GROWTH_RATE,
      holeAbsorption: HOLE_ABSORPTION,
      saturation: CONCENTRATION_MAX,
    };
  }

  private spawnWorkers(): void {
    if (!this.sab || !this.kernelParams) return;
    const n = this.params!.gridSize;
    this.workers = this.bands.map(([r0, r1], id) => {
      const worker = new DiffusionWorker();
      worker.postMessage({
        type: 'init',
        workerId: id,
        sab: this.sab,
        params: this.kernelParams,
        rowStart: r0,
        rowEnd: r1,
        gridSize: n,
      });
      return worker;
    });
  }

  /** 等待全部 worker 回传指定 ack。 */
  private waitWorkers(ack: string): Promise<void> {
    const total = this.workers.length;
    if (total === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let got = 0;
      const handlers: Array<{ worker: Worker; fn: (ev: MessageEvent) => void }> = [];
      const cleanup = () => {
        handlers.forEach(({ worker, fn }) => worker.removeEventListener('message', fn));
        this.workers.forEach((w) => w.removeEventListener('error', onError));
      };
      const onError = (ev: ErrorEvent) => {
        cleanup();
        reject(new Error(ev.message || 'worker 执行失败'));
      };
      this.workers.forEach((worker, idx) => {
        const fn = (ev: MessageEvent) => {
          if (ev.data?.type === ack && ev.data.workerId === idx) {
            got++;
            if (got === total) {
              cleanup();
              resolve();
            }
          }
        };
        worker.addEventListener('message', fn);
        handlers.push({ worker, fn });
      });
      this.workers.forEach((w) => w.addEventListener('error', onError));
    });
  }

  private async parallelStep(parity: 0 | 1): Promise<void> {
    this.workers.forEach((w) =>
      w.postMessage({ type: 'step', parity, params: this.kernelParams }),
    );
    await this.waitWorkers('step-done');
  }

  private async parallelQuantize(parity: 0 | 1): Promise<void> {
    this.workers.forEach((w) => w.postMessage({ type: 'quantize', parity }));
    await this.waitWorkers('quantize-done');
  }

  private localStep(parity: 0 | 1): void {
    const [f0, f1] = this.fields!;
    const cur = parity === 0 ? f0 : f1;
    const nxt = parity === 0 ? f1 : f0;
    stepDiffusion(cur, nxt, this.cellType!, this.kernelParams!, 0, this.params!.gridSize);
  }

  private localQuantize(parity: 0 | 1): void {
    const field = this.fields![parity]!;
    const scale = 255 / this.kernelParams!.saturation;
    const buf = this.snapshotBuf!;
    for (let i = 0; i < field.length; i++) {
      const v = Math.round(field[i]! * scale);
      buf[i] = v <= 0 ? 0 : v >= 255 ? 255 : v;
    }
  }

  /** 推进整段蔓延模拟，逐帧存快照。可通过 cancel() 中止。 */
  async run(): Promise<Snapshot[]> {
    if (!this.params || !this.fields) throw new Error('引擎尚未 configure');
    if (this.running) throw new Error('模拟已在运行中');
    this.running = true;
    this.cancelled = false;
    this.snapshots = [];

    try {
      const p = this.params;
      // 初始帧（场 A，parity=0）
      await this.takeSnapshotAsync(0, 0);
      this.emit('progress', { step: 0, totalSteps: p.totalSteps, frameIndex: 0 });

      let parity: 0 | 1 = 0;
      for (let step = 1; step <= p.totalSteps; step++) {
        if (this.cancelled) break;

        if (this.parallel) await this.parallelStep(parity);
        else this.localStep(parity);
        parity = (1 - parity) as 0 | 1;

        if (step % p.snapshotEvery === 0 || step === p.totalSteps) {
          await this.takeSnapshotAsync(step, parity);
          this.emit('progress', {
            step,
            totalSteps: p.totalSteps,
            frameIndex: this.snapshots.length - 1,
          });
        }

        // 周期性让出事件循环，保持取消与 UI 响应
        if (step % 4 === 0) await new Promise((r) => setTimeout(r, 0));
      }

      this.emit('finished', { snapshots: this.snapshots });
      return this.snapshots;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('error', { message });
      throw err;
    } finally {
      this.running = false;
    }
  }

  /** 量化当前场并 RLE 压缩为一帧快照。 */
  private async takeSnapshotAsync(step: number, parity: 0 | 1): Promise<void> {
    if (this.parallel) await this.parallelQuantize(parity);
    else this.localQuantize(parity);
    // 复制后再压缩，避免 snapshotBuf 被下一帧覆盖
    const bytes = encodeRLE(this.snapshotBuf!);
    this.snapshots.push({
      step,
      timeHours: step * this.params!.hoursPerStep,
      bytes,
    });
  }

  cancel(): void {
    this.cancelled = true;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentSnapshots(): Snapshot[] {
    return this.snapshots;
  }

  get geometry(): DomainGeometry | null {
    return this.geo;
  }

  private disposeWorkers(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }

  dispose(): void {
    this.cancel();
    this.disposeWorkers();
    this.sab = null;
    this.fields = null;
    this.cellType = null;
    this.snapshotBuf = null;
    this.geo = null;
  }
}
