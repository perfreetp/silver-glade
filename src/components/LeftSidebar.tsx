import { useRef, useState } from 'react';
import { PRESETS } from '../presets';
import { extractPalette } from '../utils/colorExtract';
import { usePaintStore } from '../store';
import {
  CATEGORY_LABELS,
  MAX_SCHEMES,
  type PresetCategory,
  type SavedScheme,
} from '../types';

const CATEGORY_ORDER: PresetCategory[] = ['metallic', 'pearlescent', 'solid', 'matte'];

function presetGradient(hex: string): string {
  return `radial-gradient(circle at 32% 30%, #ffffff55 0%, ${hex} 42%, #00000088 100%)`;
}

function PresetLibrary() {
  const activePresetId = usePaintStore((s) => s.activePresetId);
  const loadPreset = usePaintStore((s) => s.loadPreset);

  return (
    <div className="panel">
      <h3>
        <span className="dot" />
        材质库 · 四类预设
      </h3>
      {CATEGORY_ORDER.map((cat) => (
        <div key={cat}>
          <div className="preset-cat">{CATEGORY_LABELS[cat]}</div>
          {PRESETS.filter((p) => p.category === cat).map((p) => (
            <button
              key={p.id}
              className={`preset-card ${activePresetId === p.id ? 'active' : ''}`}
              onClick={() => loadPreset(p.id)}
              type="button"
            >
              <span
                className="preset-swatch"
                style={{ background: presetGradient(p.params.mid.color) }}
              />
              <span className="preset-meta">
                <b>{p.name}</b>
                <span>{p.description}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function PhotoDropzone() {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const setBaseColor = usePaintStore((s) => s.setBaseColor);
  const showToast = usePaintStore((s) => s.showToast);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('请拖入图片文件（JPG / PNG / WebP）');
      return;
    }
    setBusy(true);
    try {
      const result = await extractPalette(file);
      setPalette([result.primary, ...result.swatches]);
      setBaseColor(result.primary);
      showToast(`已提取底色 ${result.primary.toUpperCase()} 并写入中涂层`);
    } catch (err) {
      showToast(`底色提取失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h3>
        <span className="dot" style={{ background: 'var(--accent-2)' }} />
        照片底色提取
      </h3>
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? (
          <b className="spin">◌ 正在分析照片…</b>
        ) : (
          <>
            <b>拖入车漆照片</b>
            或点击选择本地图片，自动提取中涂层底色
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {palette.length > 0 ? (
        <div className="swatch-row">
          {palette.map((hex, i) => (
            <button
              key={`${hex}-${i}`}
              className={`swatch-chip ${i === 0 ? 'primary-chip' : ''}`}
              style={{ background: hex }}
              title={`${hex}（点击套用）`}
              onClick={() => {
                setBaseColor(hex);
                showToast(`已套用候选色 ${hex.toUpperCase()}`);
              }}
              type="button"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SchemeLibrary() {
  const schemes = usePaintStore((s) => s.schemes);
  const compareIds = usePaintStore((s) => s.compareIds);
  const saveScheme = usePaintStore((s) => s.saveScheme);
  const deleteScheme = usePaintStore((s) => s.deleteScheme);
  const applyScheme = usePaintStore((s) => s.applyScheme);
  const toggleCompare = usePaintStore((s) => s.toggleCompare);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (saveScheme(name)) {
      setName('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="panel">
      <h3>
        <span className="dot" style={{ background: 'var(--ok)' }} />
        命名方案库（{schemes.length}/{MAX_SCHEMES}）
      </h3>
      <input
        ref={inputRef}
        className="text-input"
        placeholder="输入方案名称，如 2026款 极光银"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
      />
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button
          className="btn primary"
          onClick={handleSave}
          disabled={schemes.length >= MAX_SCHEMES}
          type="button"
        >
          保存当前材质
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        {schemes.length === 0 ? (
          <div className="compare-empty">尚未保存方案，调好参数后命名保存</div>
        ) : (
          schemes.map((sc: SavedScheme) => (
            <div
              key={sc.id}
              className={`scheme-item ${compareIds.includes(sc.id) ? 'selected' : ''}`}
            >
              <div className="scheme-head">
                <span
                  className="scheme-dot"
                  style={{ background: sc.params.mid.color }}
                />
                <span className="scheme-name" title={sc.name}>
                  {sc.name}
                </span>
                <span className="scheme-actions">
                  <button
                    className="icon-btn"
                    title="加入参数对比"
                    onClick={() => toggleCompare(sc.id)}
                    type="button"
                  >
                    ⇄
                  </button>
                  <button
                    className="icon-btn"
                    title="一键套用到试片"
                    onClick={() => applyScheme(sc.id)}
                    type="button"
                  >
                    ⤓
                  </button>
                  <button
                    className="icon-btn danger"
                    title="删除方案"
                    onClick={() => deleteScheme(sc.id)}
                    type="button"
                  >
                    ✕
                  </button>
                </span>
              </div>
              <div className="scheme-meta">
                {CATEGORY_LABELS[sc.category]} · 清漆 {sc.params.clear.thickness}μm · IOR{' '}
                {sc.params.clear.ior.toFixed(2)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function LeftSidebar() {
  return (
    <aside className="sidebar">
      <div className="app-title">
        <h1>车漆材质调校台</h1>
        <p>四层物理叠层 · 实时 BRDF · 16ms 单帧预算</p>
      </div>
      <PresetLibrary />
      <PhotoDropzone />
      <SchemeLibrary />
    </aside>
  );
}
