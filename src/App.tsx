import { useCallback, useEffect, useRef, useState } from 'react';
import { CarWrapEngine } from './CarWrapEngine';
import { FilmPanel } from './components/FilmPanel';
import { SeamPanel } from './components/SeamPanel';
import { MaterialPanel } from './components/MaterialPanel';
import { SchemeBar } from './components/SchemeBar';
import { ViewportToolbar } from './components/ViewportToolbar';
import { loadSaved, persistSaved, MAX_SCHEMES } from './storage';
import type { SavedScheme, SchemeData, ToolMode } from './types';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CarWrapEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [ready, setReady] = useState(false);
  const [isWebGPU, setIsWebGPU] = useState(false);
  const [mode, setMode] = useState<ToolMode>('view');
  const [filmId, setFilmId] = useState<string | null>(null);
  const [brushRadius, setBrushRadius] = useState(0.05);
  const [seamWidth, setSeamWidth] = useState(0.02);
  const [roughness, setRoughness] = useState(0.85);
  const [metallic, setMetallic] = useState(0.05);
  const [strokeCount, setStrokeCount] = useState(0);
  const [saved, setSaved] = useState<SavedScheme[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  // ---- 引擎初始化 ----
  useEffect(() => {
    let disposed = false;
    let engine: CarWrapEngine | null = null;
    setSaved(loadSaved());
    CarWrapEngine.Create(canvasRef.current!)
      .then((e) => {
        if (disposed) {
          e.dispose();
          return;
        }
        engine = e;
        engineRef.current = e;
        // 暴露引擎实例，供自动化测试与外部脚本集成（非 UI 依赖）
        (window as unknown as { __engine?: CarWrapEngine }).__engine = e;
        setIsWebGPU(e.isWebGPU);
        setReady(true);
      })
      .catch((err) => {
        console.error('引擎初始化失败:', err);
      });
    return () => {
      disposed = true;
      engine?.dispose();
    };
  }, []);

  // 轻量轮询刷新笔画计数（笔画在引擎内的指针事件中产生）
  useEffect(() => {
    const id = window.setInterval(() => {
      const e = engineRef.current;
      if (e) setStrokeCount(e.strokeCount);
    }, 400);
    return () => window.clearInterval(id);
  }, []);

  const handleMode = useCallback((m: ToolMode) => {
    setMode(m);
    engineRef.current?.setMode(m);
  }, []);

  const handleFilm = useCallback((id: string) => {
    setFilmId(id);
    engineRef.current?.setSelectedFilm(id);
    // 选色后自动进入填色模式，点击即上色
    setMode('fill');
    engineRef.current?.setMode('fill');
  }, []);

  const handleBrush = useCallback((v: number) => {
    setBrushRadius(v);
    engineRef.current?.setBrushRadius(v);
  }, []);

  const handleSeam = useCallback((v: number) => {
    setSeamWidth(v);
    engineRef.current?.setSeamWidth(v);
  }, []);

  const handleRoughness = useCallback((v: number) => {
    setRoughness(v);
    engineRef.current?.setMaterialParams(v, metallic);
  }, [metallic]);

  const handleMetallic = useCallback((v: number) => {
    setMetallic(v);
    engineRef.current?.setMaterialParams(roughness, v);
  }, [roughness]);

  const handleUndo = useCallback(() => {
    engineRef.current?.undoStroke();
    setStrokeCount(engineRef.current?.strokeCount ?? 0);
  }, []);

  const handleClear = useCallback(() => {
    engineRef.current?.clearAll();
    setStrokeCount(0);
    showToast('已清空全部分色边界与填色');
  }, [showToast]);

  // ---- 方案保存（最多 6 套，带缩略图） ----
  const handleSave = useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    if (saved.length >= MAX_SCHEMES) {
      showToast(`最多保存 ${MAX_SCHEMES} 套方案，请先删除一套`);
      return;
    }
    setBusy(true);
    try {
      const thumbnail = await e.captureThumbnail();
      const data = e.getSchemeData();
      const scheme: SavedScheme = {
        id: `scheme_${Date.now()}`,
        name: `方案 ${saved.length + 1}`,
        thumbnail,
        data,
      };
      const next = [...saved, scheme].slice(0, MAX_SCHEMES);
      setSaved(next);
      persistSaved(next);
      showToast('分色方案已保存');
    } finally {
      setBusy(false);
    }
  }, [saved, showToast]);

  const handleApply = useCallback((s: SavedScheme) => {
    const e = engineRef.current;
    if (!e) return;
    e.restore(s.data);
    setBrushRadius(s.data.brushRadius);
    setSeamWidth(s.data.seamWidth);
    setRoughness(s.data.materialParams.roughness);
    setMetallic(s.data.materialParams.metallic);
    setStrokeCount(e.strokeCount);
    showToast(`已还原「${s.name}」`);
  }, [showToast]);

  const handleDelete = useCallback((id: string) => {
    setSaved((prev) => {
      const next = prev.filter((s) => s.id !== id);
      persistSaved(next);
      return next;
    });
  }, []);

  // ---- 导出：含每个色块膜色编号 + 接缝参数 ----
  const handleExport = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const data = e.getSchemeData();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `car-wrap-scheme-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('配色方案已导出为文件');
  }, [showToast]);

  const handleImport = useCallback(async (file: File) => {
    const e = engineRef.current;
    if (!e) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as SchemeData;
      if (data.version !== 1 || !Array.isArray(data.strokes)) {
        throw new Error('文件格式不正确');
      }
      e.restore(data);
      setBrushRadius(data.brushRadius);
      setSeamWidth(data.seamWidth);
      setRoughness(data.materialParams.roughness);
      setMetallic(data.materialParams.metallic);
      setStrokeCount(e.strokeCount);
      showToast(`已导入并完整还原（${data.strokes.length} 条边界）`);
    } catch (err) {
      showToast(`导入失败：${(err as Error).message}`);
    }
  }, [showToast]);

  const handleLoadModel = useCallback(async (file: File) => {
    const e = engineRef.current;
    if (!e) return;
    setBusy(true);
    try {
      await e.loadModel(file);
      setStrokeCount(0);
      showToast(`模型「${file.name}」加载成功`);
    } catch (err) {
      showToast(`模型加载失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  return (
    <div className="app-shell">
      <SchemeBar
        saved={saved}
        onSave={handleSave}
        onApply={handleApply}
        onDelete={handleDelete}
        onExport={handleExport}
        onImport={handleImport}
        onLoadModel={handleLoadModel}
        busy={busy}
      />

      <div className="workspace">
        <FilmPanel selectedId={filmId} onSelect={handleFilm} />

        <main className="viewport">
          <canvas ref={canvasRef} className="scene-canvas" />
          {!ready && <div className="loading">正在初始化引擎…</div>}
          <ViewportToolbar
            mode={mode}
            onMode={handleMode}
            onUndo={handleUndo}
            onClear={handleClear}
            canUndo={strokeCount > 0}
            isWebGPU={isWebGPU}
            strokeCount={strokeCount}
          />
          <div className="viewport-hint">
            {mode === 'paint' && '按住左键沿车身曲面拖动绘制分色边界，半径在右侧调节'}
            {mode === 'fill' && (filmId ? `当前膜色 ${filmId}，点击车身色块填充` : '请先在左侧膜色库选择一种膜色')}
            {mode === 'view' && '左键拖动旋转 · 滚轮缩放'}
          </div>
        </main>

        <SeamPanel
          seamWidth={seamWidth}
          brushRadius={brushRadius}
          strokeCount={strokeCount}
          onSeamWidth={handleSeam}
          onBrushRadius={handleBrush}
        />
      </div>

      <MaterialPanel
        roughness={roughness}
        metallic={metallic}
        onRoughness={handleRoughness}
        onMetallic={handleMetallic}
      />

      {toast && <div className="toast">{toast}</div>}
      <input ref={fileInputRef} type="file" hidden />
    </div>
  );
}
