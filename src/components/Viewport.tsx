import { useEffect, useRef } from 'react';
import { PaintEngine } from '../three/PaintEngine';
import { usePaintStore } from '../store';
import { useEngineRegistry } from '../engineRegistry';
import type { DebugMode } from '../types';

const DEBUG_OPTIONS: { mode: DebugMode; label: string }[] = [
  { mode: 0, label: '完整合成' },
  { mode: 1, label: '清漆高光' },
  { mode: 2, label: '底层高光' },
  { mode: 3, label: '鳞片法线' },
  { mode: 4, label: '四层分解' },
];

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const debugMode = usePaintStore((s) => s.debugMode);
  const setDebugMode = usePaintStore((s) => s.setDebugMode);
  const setMetrics = usePaintStore((s) => s.setMetrics);
  const setLight = usePaintStore((s) => s.setLight);
  const setEngine = useEngineRegistry((s) => s.setEngine);

  useEffect(() => {
    if (!containerRef.current) return;
    const engine = new PaintEngine(containerRef.current);
    setEngine(engine);

    const state = usePaintStore.getState();
    engine.setParams(state.params);
    engine.setLight(state.light);
    engine.onMetrics((m) => setMetrics(m));
    engine.onLightChange((azimuth, elevation) => setLight({ azimuth, elevation }));

    const unsub = usePaintStore.subscribe((s, prev) => {
      if (s.params !== prev.params) engine.setParams(s.params);
      if (s.light !== prev.light) engine.setLight(s.light);
      if (s.debugMode !== prev.debugMode) engine.setDebugMode(s.debugMode);
    });

    return () => {
      unsub();
      engine.dispose();
      setEngine(null);
    };
  }, [setMetrics, setLight, setEngine]);

  return (
    <main className="stage" ref={containerRef}>
      <div className="stage-hud">
        {DEBUG_OPTIONS.map((o) => (
          <button
            key={o.mode}
            className={`hud-chip ${debugMode === o.mode ? 'active' : ''}`}
            onClick={() => setDebugMode(o.mode)}
            type="button"
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="stage-tip">
        拖拽画面旋转视角 · 滚轮缩放
        <br />
        点击 <b>橙色光源球</b> 拖动可改变光照角度，高光沿曲面实时移动
      </div>
    </main>
  );
}
