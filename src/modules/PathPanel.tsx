import { useGroomStore } from '../store';
import { BLADE_ORDER, BLADE_SPECS, SNOW_SPECS } from '../three/constants';
import { resamplePath, pathLength } from '../three/path';
import type { BladeAngle, SnowCondition } from '../types';

/** 模块二：压雪路径绘制与刀头参数 */
export function PathPanel() {
  const controlPoints = useGroomStore((s) => s.controlPoints);
  const removeLastPoint = useGroomStore((s) => s.removeLastPoint);
  const clearPath = useGroomStore((s) => s.clearPath);
  const blade = useGroomStore((s) => s.blade);
  const setBlade = useGroomStore((s) => s.setBlade);
  const snow = useGroomStore((s) => s.snow);
  const setSnow = useGroomStore((s) => s.setSnow);
  const speed = useGroomStore((s) => s.speed);
  const setSpeed = useGroomStore((s) => s.setSpeed);
  const toolMode = useGroomStore((s) => s.toolMode);
  const setToolMode = useGroomStore((s) => s.setToolMode);

  const samples = resamplePath(controlPoints);
  const len = pathLength(samples);

  return (
    <section className="panel">
      <header className="panel-head">
        <span className="step-no">2</span>
        <h2>路径绘制 · 刀头参数</h2>
      </header>

      <div className="row gap">
        <button className={`btn small ${toolMode === 'path' ? 'primary' : ''}`} onClick={() => setToolMode('path')}>
          路径绘制
        </button>
        <button className={`btn small ${toolMode === 'measure' ? 'primary' : ''}`} onClick={() => setToolMode('measure')}>
          拖拽测距
        </button>
        <button className={`btn small ${toolMode === 'annotate' ? 'primary' : ''}`} onClick={() => setToolMode('annotate')}>
          贴地标注
        </button>
      </div>

      <div className="row gap wrap">
        <button className="btn small ghost" disabled={controlPoints.length === 0} onClick={removeLastPoint}>
          撤销末点
        </button>
        <button className="btn small danger" disabled={controlPoints.length === 0} onClick={clearPath}>
          清空路径
        </button>
        <span className="muted">控制点 {controlPoints.length} 个 · 路径长 {len.toFixed(1)} m</span>
      </div>

      <h3 className="subhead">刀头角度（三档）</h3>
      <div className="seg-group">
        {BLADE_ORDER.map((k: BladeAngle) => {
          const spec = BLADE_SPECS[k];
          return (
            <button
              key={k}
              className={`seg ${blade === k ? 'active' : ''}`}
              onClick={() => setBlade(k)}
              title={`刀宽 ${spec.width}m · 沟深 ${(spec.depth * 100).toFixed(0)}cm`}
            >
              <b>{spec.label}</b>
              <small>
                {spec.width}m / {(spec.depth * 100).toFixed(0)}cm
              </small>
            </button>
          );
        })}
      </div>

      <h3 className="subhead">雪质（干湿两档）</h3>
      <div className="seg-group">
        {(Object.keys(SNOW_SPECS) as SnowCondition[]).map((k) => (
          <button key={k} className={`seg ${snow === k ? 'active' : ''}`} onClick={() => setSnow(k)}>
            <b>{SNOW_SPECS[k].label}</b>
            <small>碎雪 ×{SNOW_SPECS[k].crumble.toFixed(2)}</small>
          </button>
        ))}
      </div>

      <h3 className="subhead">作业速度</h3>
      <div className="row gap">
        <input
          type="range"
          min={4}
          max={28}
          step={1}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="flex1"
        />
        <span className="value-tag">{speed} m/s</span>
      </div>
    </section>
  );
}
