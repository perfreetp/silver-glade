import { useEffect, useRef } from 'react';
import { usePaintStore } from '../store';
import { useEngineRegistry } from '../engineRegistry';
import { Slider } from './Controls';

function ContributionView() {
  const clearRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const contribution = usePaintStore((s) => s.contribution);
  const engine = useEngineRegistry((s) => s.engine);

  useEffect(() => {
    engine?.setContributionCanvases(clearRef.current, baseRef.current);
  }, [engine]);

  const total = contribution.clearLum + contribution.baseLum;
  const clearPct = total > 0 ? (contribution.clearLum / total) * 100 : 0;
  const basePct = total > 0 ? (contribution.baseLum / total) * 100 : 0;

  return (
    <div className="panel">
      <h3>
        <span className="dot" style={{ background: 'var(--clear)' }} />
        实时高光贡献
      </h3>
      <div className="contrib-grid">
        <div className="contrib-card">
          <canvas ref={clearRef} width={192} height={192} />
          <div className="contrib-title">清漆层高光</div>
          <div className="contrib-bar">
            <i style={{ width: `${clearPct}%`, background: 'var(--clear)' }} />
          </div>
          <div className="contrib-num">{clearPct.toFixed(1)}% 占比</div>
        </div>
        <div className="contrib-card">
          <canvas ref={baseRef} width={192} height={192} />
          <div className="contrib-title">底层高光（片层+粘结剂）</div>
          <div className="contrib-bar">
            <i style={{ width: `${basePct}%`, background: 'var(--base)' }} />
          </div>
          <div className="contrib-num">{basePct.toFixed(1)}% 占比</div>
        </div>
      </div>
      <div className="light-hint">
        清漆高光在片层之后以加法合成，任何参数下都不会被金属/珠光片遮挡。
      </div>
    </div>
  );
}

function LightPanel() {
  const light = usePaintStore((s) => s.light);
  const setLight = usePaintStore((s) => s.setLight);
  return (
    <div className="panel">
      <h3>
        <span className="dot" style={{ background: 'var(--warn)' }} />
        光源角度
      </h3>
      <div className="light-dial">
        <Slider
          label="方位角"
          value={light.azimuth}
          min={0}
          max={360}
          step={1}
          unit="°"
          format={(v) => v.toFixed(0)}
          accent="#ffb454"
          onChange={(v) => setLight({ azimuth: v })}
        />
        <Slider
          label="仰角"
          value={light.elevation}
          min={5}
          max={75}
          step={1}
          unit="°"
          format={(v) => v.toFixed(0)}
          accent="#ffb454"
          onChange={(v) => setLight({ elevation: v })}
        />
      </div>
      <Slider
        label="光照强度"
        value={light.intensity}
        min={0.5}
        max={5}
        step={0.05}
        format={(v) => v.toFixed(2)}
        accent="#ffb454"
        onChange={(v) => setLight({ intensity: v })}
      />
      <div className="light-hint">
        也可直接在视口中拖动橙色光源球；高光位置随方位角沿球面与车身曲面滑移。
      </div>
    </div>
  );
}

function perfClass(ms: number): string {
  if (ms <= 16) return 'good';
  if (ms <= 24) return 'warn';
  return 'bad';
}

function MetricsPanel() {
  const metrics = usePaintStore((s) => s.metrics);
  const avg = metrics?.avgMs ?? 0;
  const withinBudget = avg <= 16;
  return (
    <div className="panel">
      <h3>
        <span className="dot" style={{ background: withinBudget ? 'var(--ok)' : 'var(--danger)' }} />
        单帧性能（16ms 预算）
      </h3>
      <div className="metric-grid">
        <div className={`metric ${perfClass(avg)}`}>
          <label>平均帧耗时</label>
          <b>{avg ? avg.toFixed(2) : '—'} ms</b>
        </div>
        <div className={`metric ${perfClass(metrics?.p95Ms ?? 0)}`}>
          <label>P95 帧耗时</label>
          <b>{metrics ? metrics.p95Ms.toFixed(2) : '—'} ms</b>
        </div>
        <div className={`metric ${perfClass(metrics?.maxMs ?? 0)}`}>
          <label>峰值帧耗时</label>
          <b>{metrics ? metrics.maxMs.toFixed(2) : '—'} ms</b>
        </div>
        <div className="metric good">
          <label>实时帧率</label>
          <b>{metrics ? Math.round(metrics.fps) : '—'} fps</b>
        </div>
      </div>
      <div className="budget-hint">
        <span className="led" style={{ background: withinBudget ? 'var(--ok)' : 'var(--danger)' }} />
        {withinBudget
          ? `预算内运行 · 近 1 秒掉帧 ${metrics?.droppedLastSecond ?? 0} 次（>20ms）`
          : '超出预算，请降低像素比或关闭调试视图'}
      </div>
    </div>
  );
}

export function PreviewPanel() {
  const engine = useEngineRegistry((s) => s.engine);
  const setContribution = usePaintStore((s) => s.setContribution);

  useEffect(() => {
    if (!engine) return;
    engine.onContribution((c) => setContribution(c));
  }, [engine, setContribution]);

  return (
    <>
      <ContributionView />
      <LightPanel />
      <MetricsPanel />
    </>
  );
}
