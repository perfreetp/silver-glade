/**
 * 菇架 3D 画布：React 与 RackRenderer 的生命周期边界。
 *
 * 关键约束：RackRenderer 只挂载一次；环境/播放状态走 props effect 更新缓冲，
 * 视角切换只调 renderer.setView（相机补间），快照载入走 bindSimulation，
 * 任何场景下都不重建 InstancedMesh。
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { EnvironmentInput, GrowthSnapshot, RackConfig, ViewMode } from '../types';
import { RackSimulation } from '../core/RackSimulation';
import { RackRenderer } from '../three/RackRenderer';
import { readSnapshotFile } from '../core/snapshotIo';

export interface RackCanvasHandle {
  getSim: () => RackSimulation;
  exportSnapshot: () => GrowthSnapshot;
  loadSnapshotFile: (file: File) => Promise<void>;
  resetSim: () => void;
}

interface RackCanvasProps {
  config: RackConfig;
  environment: EnvironmentInput;
  view: ViewMode;
  playing: boolean;
  /** 播放速度（模拟小时 / 真实秒） */
  speed: number;
  highlightLayer: number;
  seed?: number;
  onStats?: (meanStage: number, elapsedHours: number) => void;
}

const RackCanvas = forwardRef<RackCanvasHandle, RackCanvasProps>(function RackCanvas(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<RackRenderer | null>(null);
  const simRef = useRef<RackSimulation | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // 挂载 / 卸载：渲染器与实例数据只创建一次
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const sim = new RackSimulation(propsRef.current.config, propsRef.current.environment, propsRef.current.seed);
    simRef.current = sim;
    const renderer = new RackRenderer(container, sim);
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 环境实时调节 → 整架重算形态
  useEffect(() => {
    const sim = simRef.current;
    const renderer = rendererRef.current;
    if (!sim || !renderer) return;
    sim.setEnvironment(props.environment);
    renderer.update(sim);
  }, [props.environment]);

  // 视角切换：相机补间，实例数据不动
  useEffect(() => {
    rendererRef.current?.setView(props.view);
  }, [props.view]);

  // 对比高亮层位
  useEffect(() => {
    rendererRef.current?.setHighlightLayer(props.highlightLayer);
  }, [props.highlightLayer]);

  // 时间推进循环（与渲染循环独立，按真实 dt 积分模拟小时数）
  useEffect(() => {
    if (!props.playing) return;
    let raf = 0;
    let last = performance.now();
    let statAccum = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dtReal = Math.min((now - last) / 1000, 0.25);
      last = now;
      const sim = simRef.current;
      const renderer = rendererRef.current;
      if (!sim || !renderer) return;
      const dtHours = dtReal * propsRef.current.speed;
      sim.step(dtHours);
      renderer.update(sim);

      statAccum += dtReal;
      if (statAccum >= 0.25) {
        statAccum = 0;
        propsRef.current.onStats?.(sim.meanStage(), sim.elapsedHours);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [props.playing]);

  useImperativeHandle(ref, () => ({
    getSim: () => simRef.current!,
    exportSnapshot: () => {
      const sim = simRef.current!;
      return sim.exportSnapshot(new Date().toISOString());
    },
    loadSnapshotFile: async (file: File) => {
      const snap = await readSnapshotFile(file);
      const sim = RackSimulation.fromSnapshot(snap);
      simRef.current = sim;
      rendererRef.current?.bindSimulation(sim);
    },
    resetSim: () => {
      const prev = simRef.current!;
      const sim = new RackSimulation(prev.config, propsRef.current.environment, propsRef.current.seed ?? 20260601);
      simRef.current = sim;
      rendererRef.current?.bindSimulation(sim);
    },
  }), []);

  return <div ref={containerRef} className="rack-canvas" />;
});

export default RackCanvas;
