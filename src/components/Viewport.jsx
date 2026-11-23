import { useEffect, useRef } from 'react';
import { VolumeEngine } from '../engine/VolumeEngine.js';

export function Viewport({ project, engineRef, onReady, onError, compare }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const engine = new VolumeEngine(canvasRef.current, project);
    engineRef.current = engine;
    let cancelled = false;
    engine
      .init()
      .then(() => {
        if (!cancelled) onReady(engine);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) onError(err);
      });
    return () => {
      cancelled = true;
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="viewport">
      <canvas ref={canvasRef} />
      {compare && (
        <>
          <div className="compare-divider" />
          <div className="view-tag left">修改前 (基准)</div>
          <div className="view-tag right">修改后 (当前)</div>
        </>
      )}
      <div className="viewport-hint">
        左键拖动: 球刷编辑 · Alt+滚轮: 笔刷深度 · 拖动空白/右键: 旋转视角 · 滚轮: 缩放
      </div>
    </div>
  );
}
