import type { LedConfig, LensConfig, ProjectionConfig } from '../types';
import { OpticsEngine, type TraceResult } from './tracer';
import { WallRenderer } from './wallRenderer';

export interface FrameTiming {
  traceMs: number;
  renderMs: number;
  lensBuildMs: number;
  raysTotal: number;
  raysWall: number;
}

export type FrameListener = (timing: FrameTiming) => void;

/**
 * 渲染调度：
 * - 光源/透镜/光线密度变化 → 标记 opticalDirty，下一帧做完整 BVH 追踪
 * - 仅截止线/过渡带/色图变化 → 复用累积缓冲，只重走 ImageData 合成（亚毫秒~几毫秒）
 * 截止线拖动属于轻量路径，单次合成远低于一帧预算，满足两帧内出图。
 */
export class RenderCoordinator {
  private engine = new OpticsEngine();
  private wallRenderer = new WallRenderer();
  private opticalDirty = true;
  private frameQueued = false;
  private trace: TraceResult | null = null;
  private listeners = new Set<FrameListener>();

  private lens: LensConfig;
  private leds: LedConfig[];
  private projection: ProjectionConfig;
  private wallDistance: number;

  constructor(init: { leds: LedConfig[]; lens: LensConfig; projection: ProjectionConfig; wallDistance: number }) {
    this.leds = init.leds;
    this.lens = init.lens;
    this.projection = init.projection;
    this.wallDistance = init.wallDistance;
  }

  get opticsEngine(): OpticsEngine {
    return this.engine;
  }

  get cachedImage(): ImageData | null {
    return this.trace ? this.wallRenderer.image : null;
  }

  get cachedTrace(): TraceResult | null {
    return this.trace;
  }

  onChange(next: { leds?: LedConfig[]; lens?: LensConfig; projection?: ProjectionConfig; wallDistance?: number }) {
    if (next.lens) {
      const prev = this.lens;
      this.lens = next.lens;
      if (
        prev.curvature !== next.lens.curvature ||
        prev.thickness !== next.lens.thickness ||
        prev.ior !== next.lens.ior
      ) {
        this.opticalDirty = true;
      }
    }
    if (next.leds) {
      this.leds = next.leds;
      this.opticalDirty = true;
    }
    if (next.wallDistance !== undefined && next.wallDistance !== this.wallDistance) {
      this.wallDistance = next.wallDistance;
      this.opticalDirty = true;
    }
    if (next.projection) {
      const raysChanged = next.projection.raysPerLed !== this.projection.raysPerLed;
      this.projection = next.projection;
      if (raysChanged) this.opticalDirty = true;
    }
    this.scheduleFrame();
  }

  /** 强制下一次做完整光学追踪 */
  invalidateOptics() {
    this.opticalDirty = true;
    this.scheduleFrame();
  }

  onFrame(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scheduleFrame() {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => {
      this.frameQueued = false;
      this.runFrame();
    });
  }

  /** 同步执行一帧（测试用），返回计时 */
  runFrame(): FrameTiming {
    if (this.opticalDirty || !this.trace) {
      this.engine.ensureLens(this.lens);
      this.trace = this.engine.trace(this.leds, this.projection.raysPerLed, this.wallDistance);
      this.opticalDirty = false;
    }
    const tRender = performance.now();
    this.wallRenderer.render(this.trace.irradiance, this.trace.peak, this.projection, {
      drawContours: true,
      drawCutoffLine: true,
    });
    const renderMs = performance.now() - tRender;

    const timing: FrameTiming = {
      traceMs: this.trace.stats.traceMs,
      renderMs,
      lensBuildMs: this.trace.stats.lensBuildMs,
      raysTotal: this.trace.stats.raysTotal,
      raysWall: this.trace.stats.raysWall,
    };
    this.listeners.forEach((fn) => fn(timing));
    return timing;
  }

  dispose() {
    this.engine.dispose();
    this.listeners.clear();
  }
}
