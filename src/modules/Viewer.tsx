import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GroomEngine } from '../three/GroomEngine';
import { useGroomStore } from '../store';
import { resamplePath } from '../three/path';

/**
 * 3D 视图：引擎只实例化一次，store 变化通过订阅推给引擎；
 * 引擎拾取事件回写 store，形成单向数据流。
 */
export function Viewer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GroomEngine | null>(null);
  const measurePoints = useRef<{ a: THREE.Vector3 | null; b: THREE.Vector3 | null }>({ a: null, b: null });

  useEffect(() => {
    const el = mountRef.current!;
    const engine = new GroomEngine(el);
    engineRef.current = engine;
    const s = useGroomStore.getState();

    engine.setCallbacks({
      onFps: (fps) => useGroomStore.getState().setFps(fps),
      onProgress: (percent) => useGroomStore.getState().setGroomedPercent(percent),
      onRefit: () => useGroomStore.getState().notifyBvhRefit(),
    });

    engine.onPickPath = (x, z) => useGroomStore.getState().addControlPoint(x, z);
    engine.onPickMeasure = (a, b, result) => {
      measurePoints.current = { a, b };
      engine.showMeasure(a, b);
      useGroomStore.getState().setMeasure(result);
    };
    engine.onPickAnnotation = (a) => {
      useGroomStore.getState().addAnnotation({ x: a.x, y: a.y, z: a.z, text: `标注${useGroomStore.getState().annotations.length + 1}` });
    };

    // 初始同步一次
    engine.setActiveZones(s.activeZones);
    engine.setBlade(s.blade);
    engine.setSnow(s.snow);
    engine.setSpeed(s.speed);
    engine.setToolMode(s.toolMode);

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__groomEngine = engine;
    }

    const unsub = useGroomStore.subscribe((st, prev) => {
      if (st.activeZones !== prev.activeZones) engine.setActiveZones(st.activeZones);
      if (st.controlPoints !== prev.controlPoints) engine.setPath(st.controlPoints);
      if (st.blade !== prev.blade) engine.setBlade(st.blade);
      if (st.snow !== prev.snow) engine.setSnow(st.snow);
      if (st.speed !== prev.speed) engine.setSpeed(st.speed);
      if (st.toolMode !== prev.toolMode) engine.setToolMode(st.toolMode);
      if (st.showFog !== prev.showFog) engine.setFogVisible(st.showFog);
      if (st.showCorduroy !== prev.showCorduroy) engine.setCorduroyVisible(st.showCorduroy);
      if (st.wireframe !== prev.wireframe) engine.setWireframe(st.wireframe);
      if (st.playing !== prev.playing) {
        if (st.playing) engine.play();
        else engine.pause();
      }
      if (st.annotations !== prev.annotations) engine.showAnnotations(st.annotations);
      if (st.measure !== prev.measure && st.measure === null) {
        measurePoints.current = { a: null, b: null };
        engine.showMeasure(null, null);
      }
    });

    return () => {
      unsub();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // 重置刀纹：由 App 通过 window 事件触发（避免把引擎实例提升到全局 store）
  useEffect(() => {
    const handler = () => engineRef.current?.resetDeformation();
    window.addEventListener('groom:reset', handler);
    return () => window.removeEventListener('groom:reset', handler);
  }, []);

  // 路径长度提示条
  const points = useGroomStore((s) => s.controlPoints);
  const len = resamplePath(points).length ? resamplePath(points).at(-1)!.s : 0;
  const fps = useGroomStore((s) => s.fps);
  const percent = useGroomStore((s) => s.groomedPercent);
  const toolMode = useGroomStore((s) => s.toolMode);
  const hintText =
    toolMode === 'path' ? '左键在雪面添加路径控制点'
    : toolMode === 'measure' ? '左键点选两个点进行测距'
    : toolMode === 'annotate' ? '左键在雪面落点添加标注'
    : '';

  return (
    <div className="viewer-wrap">
      <div ref={mountRef} className="viewer-canvas" />
      <div className="hud">
        <span className={`hud-dot ${fps >= 55 ? 'ok' : 'warn'}`} />
        <span>{fps} FPS</span>
        <span className="hud-sep">|</span>
        <span>路径 {len.toFixed(1)} m</span>
        <span className="hud-sep">|</span>
        <span>已压 {percent.toFixed(1)}%</span>
      </div>
      {hintText && <div className="hud hint">{hintText}</div>}
    </div>
  );
}
