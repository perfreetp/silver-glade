import { useGroomStore } from '../store';
import { resamplePath } from '../three/path';

/** 模块三：刀纹实时预览与残雪堆积 */
export function PreviewPanel() {
  const playing = useGroomStore((s) => s.playing);
  const play = useGroomStore((s) => s.play);
  const pause = useGroomStore((s) => s.pause);
  const resetGroom = useGroomStore((s) => s.resetGroom);
  const showFog = useGroomStore((s) => s.showFog);
  const toggleFog = useGroomStore((s) => s.toggleFog);
  const showCorduroy = useGroomStore((s) => s.showCorduroy);
  const toggleCorduroy = useGroomStore((s) => s.toggleCorduroy);
  const wireframe = useGroomStore((s) => s.wireframe);
  const toggleWireframe = useGroomStore((s) => s.toggleWireframe);
  const percent = useGroomStore((s) => s.groomedPercent);
  const fps = useGroomStore((s) => s.fps);
  const controlPoints = useGroomStore((s) => s.controlPoints);
  const measure = useGroomStore((s) => s.measure);
  const setMeasure = useGroomStore((s) => s.setMeasure);
  const annotations = useGroomStore((s) => s.annotations);
  const removeAnnotation = useGroomStore((s) => s.removeAnnotation);
  const bvhRefitAt = useGroomStore((s) => s.bvhRefitAt);

  const canPlay = resamplePath(controlPoints).length > 1;

  return (
    <section className="panel">
      <header className="panel-head">
        <span className="step-no">3</span>
        <h2>刀纹预览 · 残雪堆积</h2>
      </header>

      <div className="row gap">
        <button className="btn primary" disabled={!canPlay || playing} onClick={play}>
          ▶ 开始压雪
        </button>
        <button className="btn" disabled={!playing} onClick={pause}>
          ⏸ 暂停
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            resetGroom();
            window.dispatchEvent(new Event('groom:reset'));
          }}
        >
          ↺ 复位雪面
        </button>
      </div>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
        <span className="progress-label">压雪覆盖 {percent.toFixed(1)}%</span>
      </div>

      <h3 className="subhead">图层</h3>
      <label className="check-row">
        <input type="checkbox" checked={showCorduroy} onChange={toggleCorduroy} />
        刀纹层（法线贴图 + 顶点位移）
      </label>
      <label className="check-row">
        <input type="checkbox" checked={showFog} onChange={toggleFog} />
        半透明雾层（深度遮挡）
      </label>
      <label className="check-row">
        <input type="checkbox" checked={wireframe} onChange={toggleWireframe} />
        网格线框（查看顶点密度）
      </label>

      <h3 className="subhead">测距结果</h3>
      {measure ? (
        <div className="card">
          <div className="kv"><span>直线距离</span><b>{measure.straight.toFixed(2)} m</b></div>
          <div className="kv"><span>贴地距离</span><b>{measure.ground.toFixed(2)} m</b></div>
          <div className="kv"><span>高差</span><b>{measure.drop.toFixed(2)} m</b></div>
          <button className="btn small ghost" onClick={() => setMeasure(null)}>清除测距</button>
        </div>
      ) : (
        <p className="muted">切换到「拖拽测距」后在雪面点选两个点</p>
      )}

      <h3 className="subhead">贴地标注（{annotations.length}）</h3>
      {annotations.length === 0 && <p className="muted">切换到「贴地标注」后在雪面落点</p>}
      <ul className="ann-list">
        {annotations.map((a) => (
          <li key={a.id}>
            <span>{a.text}</span>
            <button className="link-danger" onClick={() => removeAnnotation(a.id)}>删除</button>
          </li>
        ))}
      </ul>

      <div className="perf-row">
        <span className={fps >= 55 ? 'perf-ok' : 'perf-warn'}>{fps} FPS</span>
        <span className="muted">
          BVH 局部 refit：{bvhRefitAt ? new Date(bvhRefitAt).toLocaleTimeString() : '尚未触发'}
        </span>
      </div>
    </section>
  );
}
