import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, FRAME_COUNT, cloneSettings } from './defaults.js';
import { Viewport } from './components/Viewport.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { Timeline } from './components/Timeline.jsx';
import {
  loadProjectFromDB, saveProjectToDB,
  exportProjectFile, readProjectFile,
} from './persistence.js';
import { exportSequence } from './exporter.js';

export default function App() {
  const [initialProject, setInitialProject] = useState(null);
  const [settings, setSettings] = useState(null);
  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState(null);
  const [compare, setCompare] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [computing, setComputing] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [exportProgress, setExportProgress] = useState(null);
  const [saveState, setSaveState] = useState('');
  const [engineError, setEngineError] = useState('');
  const engineRef = useRef(null);
  const fileInputRef = useRef(null);

  const webgpuSupported = typeof navigator !== 'undefined' && !!navigator.gpu;

  // 启动:从 IndexedDB 恢复上次项目
  useEffect(() => {
    (async () => {
      const saved = await loadProjectFromDB();
      const project = saved && saved.settings
        ? saved
        : { settings: cloneSettings(DEFAULT_SETTINGS), strokes: [] };
      setInitialProject(project);
      setSettings(cloneSettings(project.settings));
    })();
  }, []);

  // 引擎就绪后挂事件
  const handleReady = useCallback((engine) => {
    engine.on('computing', setComputing);
    engine.on('strokes', () => setStrokeCount(engine.liveView.strokes.length));
    engine.on('brushDepth', (d) => {
      setSettings((s) => ({ ...s, brush: { ...s.brush, depth: d } }));
    });
    engine.on('error', (msg) => setEngineError(msg));
    setStrokeCount(engine.liveView.strokes.length);
    window.__engine = engine; // 调试/自动化测试句柄
    setReady(true);
  }, []);

  const handleEngineError = useCallback((err) => {
    setFatalError(String((err && err.message) || err));
  }, []);

  // 参数更新:React 状态 + 引擎同步
  const update = useCallback((section, key, value) => {
    const engine = engineRef.current;
    setSettings((s) => {
      if (section === 'resolution') return { ...s, resolution: value };
      return { ...s, [section]: { ...s[section], [key]: value } };
    });
    if (!engine) return;
    if (section === 'resolution') engine.setResolution(value);
    else if (section === 'noise') engine.applyNoise(key, value);
    else if (section === 'brush') engine.applyBrush(key, value);
    else if (section === 'render') engine.applyRender(key, value);
    else if (section === 'light') engine.applyLight(key, value);
  }, []);

  const setFrame = useCallback((f) => {
    setSettings((s) => ({ ...s, frame: f }));
    engineRef.current?.setFrame(f);
  }, []);

  // 播放
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setSettings((s) => {
        const f = (s.frame + 1) % FRAME_COUNT;
        engineRef.current?.setFrame(f);
        return { ...s, frame: f };
      });
    }, 120);
    return () => clearInterval(timer);
  }, [playing]);

  // 对比视图
  const toggleCompare = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (compare) {
      engine.exitCompare();
      setCompare(false);
    } else {
      await engine.enterCompare();
      setCompare(true);
    }
  }, [compare]);

  // 序列帧导出
  const handleExportSequence = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || exportProgress) return;
    setPlaying(false);
    setExportProgress({ done: 0, total: FRAME_COUNT });
    try {
      await exportSequence(engine, {
        onProgress: (done, total) => setExportProgress({ done, total }),
      });
    } catch (err) {
      console.error(err);
      setEngineError('序列帧导出失败: ' + ((err && err.message) || err));
    } finally {
      setExportProgress(null);
    }
  }, [exportProgress]);

  // 项目导入导出
  const handleExportProject = useCallback(() => {
    const engine = engineRef.current;
    if (engine) exportProjectFile(engine.serialize());
  }, []);

  const handleImportFile = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const project = await readProjectFile(file);
      const engine = engineRef.current;
      if (engine) await engine.loadProject(project);
      setSettings(cloneSettings(project.settings));
      setCompare(false);
      setStrokeCount(engine ? engine.liveView.strokes.length : 0);
      setSaveState('项目已导入');
    } catch (err) {
      setEngineError('导入失败: ' + ((err && err.message) || err));
    }
  }, []);

  // 自动保存 (防抖)
  useEffect(() => {
    if (!ready || !settings) return;
    const t = setTimeout(async () => {
      const engine = engineRef.current;
      if (!engine) return;
      try {
        await saveProjectToDB(engine.serialize());
        const now = new Date();
        setSaveState(
          `已自动保存 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
        );
      } catch {
        setSaveState('自动保存失败');
      }
    }, 900);
    return () => clearTimeout(t);
  }, [settings, strokeCount, ready]);

  if (!webgpuSupported) {
    return (
      <div className="overlay-error">
        <div className="box">
          <h2>当前浏览器不支持 WebGPU</h2>
          <p>本工具基于 three.js WebGPURenderer,需要支持 WebGPU 的浏览器(Chrome / Edge 113+)。</p>
        </div>
      </div>
    );
  }
  if (!initialProject || !settings) return null;

  return (
    <div className="app">
      <header className="header">
        <h1>VolSmoke Lab<span className="sub">爆炸烟雾体积渲染 · WebGPU 光线步进</span></h1>
        {computing && <span className="computing">重算中</span>}
        <div className="spacer" />
        <button className={`btn ${compare ? 'active' : ''}`} onClick={toggleCompare}>
          对比视图
        </button>
        {compare && (
          <button className="btn" onClick={async () => {
            await engineRef.current?.resetCompareBaseline();
          }}>将当前设为基准</button>
        )}
      </header>

      <div className="main">
        <Sidebar
          settings={settings}
          update={update}
          strokeCount={strokeCount}
          onUndo={() => engineRef.current?.undoStroke()}
          onClearStrokes={() => engineRef.current?.clearStrokes()}
          onExportSequence={handleExportSequence}
          exportProgress={exportProgress}
          onExportProject={handleExportProject}
          onImportProject={() => fileInputRef.current?.click()}
          saveState={saveState}
        />
        <div className="viewport-wrap">
          <Viewport
            project={initialProject}
            engineRef={engineRef}
            onReady={handleReady}
            onError={handleEngineError}
            compare={compare}
          />
          <Timeline
            frame={settings.frame}
            playing={playing}
            onFrameChange={(f) => { setPlaying(false); setFrame(f); }}
            onTogglePlay={() => setPlaying((p) => !p)}
          />
        </div>
      </div>

      <footer className="statusbar">
        <span>分辨率 {settings.resolution}³</span>
        <span>步进 {settings.render.steps}</span>
        <span>消光 σ={settings.render.extinction.toFixed(1)}</span>
        <span>帧 {settings.frame + 1}/{FRAME_COUNT}</span>
        {compare && <span>对比模式: 左=修改前 右=修改后 (共享相机, 光照各自独立重算)</span>}
        {engineError && <span className="err">{engineError}</span>}
        {fatalError && <span className="err">{fatalError}</span>}
      </footer>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
    </div>
  );
}
