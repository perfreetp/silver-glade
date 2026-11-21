/**
 * 应用编排：
 * - single 模式：单架 4200 棒，环境面板实时驱动整架重算
 * - compare 模式：两个批次并排渲染，逐层对比并高亮差异最大层位
 * RackCanvas 内部的 InstancedMesh 在两种模式下均只创建一次。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RackCanvas, { type RackCanvasHandle } from './components/RackCanvas';
import EnvironmentPanel from './components/EnvironmentPanel';
import CompareLayerPanel from './components/CompareLayerPanel';
import { downloadSnapshot } from './core/snapshotIo';
import type { EnvironmentInput, LayerStat, RackConfig, ViewMode, WorkMode } from './types';
import { DEFAULT_RACK } from './core/rackLayout';

const RACK_CONFIG: RackConfig = DEFAULT_RACK; // 5 × 30 × 28 = 4200 棒
const SEED_A = 20260601;
const SEED_B = 20260715;

const DEFAULT_ENV_A: EnvironmentInput = { temperature: 20, humidity: 85 };
const DEFAULT_ENV_B: EnvironmentInput = { temperature: 26, humidity: 65 };

interface SimStats {
  meanStage: number;
  elapsedHours: number;
}

export default function App() {
  const [mode, setMode] = useState<WorkMode>('single');
  const [view, setView] = useState<ViewMode>('side');
  const [toast, setToast] = useState<string | null>(null);

  // 批次 A（单架模式即此批次）
  const [envA, setEnvA] = useState<EnvironmentInput>(DEFAULT_ENV_A);
  const [playingA, setPlayingA] = useState(true);
  const [speedA, setSpeedA] = useState(6);
  const [statsA, setStatsA] = useState<SimStats>({ meanStage: 0, elapsedHours: 0 });
  const canvasARef = useRef<RackCanvasHandle>(null);

  // 批次 B（仅对比模式）
  const [envB, setEnvB] = useState<EnvironmentInput>(DEFAULT_ENV_B);
  const [playingB, setPlayingB] = useState(true);
  const [speedB, setSpeedB] = useState(6);
  const [statsB, setStatsB] = useState<SimStats>({ meanStage: 0, elapsedHours: 0 });
  const canvasBRef = useRef<RackCanvasHandle>(null);

  const [diff, setDiff] = useState<{ statsA: LayerStat[]; statsB: LayerStat[]; maxLayer: number }>({
    statsA: [],
    statsB: [],
    maxLayer: -1,
  });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refreshDiff = useCallback(() => {
    const a = canvasARef.current?.getSim();
    const b = canvasBRef.current?.getSim();
    if (!a || !b) return;
    const sa = a.layerStats();
    const sb = b.layerStats();
    let maxLayer = 0;
    let maxAbs = -1;
    sa.forEach((s, i) => {
      const d = Math.abs(s.avgStage - sb[i]!.avgStage);
      if (d > maxAbs) {
        maxAbs = d;
        maxLayer = i;
      }
    });
    setDiff({ statsA: sa, statsB: sb, maxLayer });
  }, []);

  const onStatsA = useCallback(
    (meanStage: number, elapsedHours: number) => {
      setStatsA({ meanStage, elapsedHours });
    },
    [],
  );
  const onStatsB = useCallback(
    (meanStage: number, elapsedHours: number) => {
      setStatsB({ meanStage, elapsedHours });
    },
    [],
  );

  // 对比模式下定时重算层位差异：两个批次持续生长，差异最大层会随时间变化
  useEffect(() => {
    if (mode !== 'compare') return;
    refreshDiff();
    const timer = window.setInterval(refreshDiff, 1500);
    return () => window.clearInterval(timer);
  }, [mode, refreshDiff]);

  const handleExportA = useCallback(() => {
    const snap = canvasARef.current?.exportSnapshot();
    if (!snap) return;
    const name = downloadSnapshot(snap);
    showToast(`已导出快照 ${name}（${snap.rackConfig.layers} 层 × ${snap.rackConfig.columns} 列 × ${snap.rackConfig.rows} 行）`);
  }, [showToast]);

  const handleImportA = useCallback(
    async (file: File) => {
      try {
        await canvasARef.current?.loadSnapshotFile(file);
        showToast(`快照已载入，形态已逐棒还原`);
      } catch (err) {
        showToast(`载入失败：${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    [showToast],
  );

  const handleResetA = useCallback(() => {
    canvasARef.current?.resetSim();
    setStatsA({ meanStage: 0, elapsedHours: 0 });
  }, []);
  const handleResetB = useCallback(() => {
    canvasBRef.current?.resetSim();
    setStatsB({ meanStage: 0, elapsedHours: 0 });
  }, []);

  const totalSticks = useMemo(
    () => RACK_CONFIG.layers * RACK_CONFIG.columns * RACK_CONFIG.rows,
    [],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">🍄</span>
          <div>
            <h1>菇架栽培生长可视化</h1>
            <p>
              {RACK_CONFIG.layers} 层 × {RACK_CONFIG.columns} 列 × {RACK_CONFIG.rows} 行 ={' '}
              <b>{totalSticks}</b> 根菌棒 · 实例化渲染 · 温湿度驱动生长曲线
            </p>
          </div>
        </div>
        <div className="topbar__controls">
          <div className="seg">
            <button
              className={mode === 'single' ? 'seg__btn seg__btn--active' : 'seg__btn'}
              onClick={() => setMode('single')}
            >
              单架视图
            </button>
            <button
              className={mode === 'compare' ? 'seg__btn seg__btn--active' : 'seg__btn'}
              onClick={() => setMode('compare')}
            >
              批次对比
            </button>
          </div>
          <div className="seg">
            <button
              className={view === 'side' ? 'seg__btn seg__btn--active' : 'seg__btn'}
              onClick={() => setView('side')}
            >
              侧视
            </button>
            <button
              className={view === 'top' ? 'seg__btn seg__btn--active' : 'seg__btn'}
              onClick={() => setView('top')}
            >
              俯视
            </button>
          </div>
        </div>
      </header>

      {mode === 'single' ? (
        <main className="layout">
          <div className="layout__stage">
            <RackCanvas
              ref={canvasARef}
              config={RACK_CONFIG}
              environment={envA}
              view={view}
              playing={playingA}
              speed={speedA}
              highlightLayer={-1}
              seed={SEED_A}
              onStats={onStatsA}
            />
            <ViewHint view={view} />
          </div>
          <aside className="layout__sidebar">
            <EnvironmentPanel
              title="环境调节（实时）"
              env={envA}
              onChange={setEnvA}
              playing={playingA}
              onTogglePlay={() => setPlayingA((v) => !v)}
              speed={speedA}
              onSpeedChange={setSpeedA}
              onReset={handleResetA}
              onExport={handleExportA}
              onImportFile={handleImportA}
              meanStage={statsA.meanStage}
              elapsedHours={statsA.elapsedHours}
            />
          </aside>
        </main>
      ) : (
        <main className="layout layout--compare">
          <div className="compare-grid">
            <div className="compare-cell">
              <div className="compare-cell__label" style={{ borderColor: '#4da3ff' }}>
                批次 A · {envA.temperature}°C / {envA.humidity}%
              </div>
              <RackCanvas
                ref={canvasARef}
                config={RACK_CONFIG}
                environment={envA}
                view={view}
                playing={playingA}
                speed={speedA}
                highlightLayer={diff.maxLayer}
                seed={SEED_A}
                onStats={onStatsA}
              />
            </div>
            <div className="compare-cell">
              <div className="compare-cell__label" style={{ borderColor: '#ff9f43' }}>
                批次 B · {envB.temperature}°C / {envB.humidity}%
              </div>
              <RackCanvas
                ref={canvasBRef}
                config={RACK_CONFIG}
                environment={envB}
                view={view}
                playing={playingB}
                speed={speedB}
                highlightLayer={diff.maxLayer}
                seed={SEED_B}
                onStats={onStatsB}
              />
            </div>
          </div>
          <aside className="layout__sidebar layout__sidebar--compare">
            <EnvironmentPanel
              title="批次 A 环境"
              accent="#4da3ff"
              compact
              env={envA}
              onChange={setEnvA}
              playing={playingA}
              onTogglePlay={() => setPlayingA((v) => !v)}
              speed={speedA}
              onSpeedChange={setSpeedA}
              onReset={handleResetA}
              onExport={() => undefined}
              onImportFile={() => undefined}
              meanStage={statsA.meanStage}
              elapsedHours={statsA.elapsedHours}
            />
            <EnvironmentPanel
              title="批次 B 环境"
              accent="#ff9f43"
              compact
              env={envB}
              onChange={setEnvB}
              playing={playingB}
              onTogglePlay={() => setPlayingB((v) => !v)}
              speed={speedB}
              onSpeedChange={setSpeedB}
              onReset={handleResetB}
              onExport={() => undefined}
              onImportFile={() => undefined}
              meanStage={statsB.meanStage}
              elapsedHours={statsB.elapsedHours}
            />
            <button className="btn btn--primary btn--wide" onClick={refreshDiff}>
              ⇄ 重新计算层位差异
            </button>
            <CompareLayerPanel statsA={diff.statsA} statsB={diff.statsB} maxDiffLayer={diff.maxLayer} />
          </aside>
        </main>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function ViewHint({ view }: { view: ViewMode }) {
  return (
    <div className="view-hint">
      {view === 'top' ? '俯视：分层排布总览（拖拽旋转 / 滚轮缩放）' : '侧视：层架立面总览（拖拽旋转 / 滚轮缩放）'}
    </div>
  );
}
