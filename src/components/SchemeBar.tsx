import { useRef } from 'react';
import type { SavedScheme } from '../types';
import { MAX_SCHEMES } from '../storage';

interface Props {
  saved: SavedScheme[];
  onSave: () => void;
  onApply: (s: SavedScheme) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onLoadModel: (file: File) => void;
  busy: boolean;
}

export function SchemeBar({
  saved,
  onSave,
  onApply,
  onDelete,
  onExport,
  onImport,
  onLoadModel,
  busy,
}: Props) {
  const schemeInput = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);

  return (
    <header className="panel panel-top">
      <div className="brand">
        <span className="brand-mark">CW</span>
        <div>
          <strong>车身分色贴膜工作室</strong>
          <small>WebGPU · TypeScript · Babylon.js</small>
        </div>
      </div>

      <div className="scheme-slots">
        {Array.from({ length: MAX_SCHEMES }).map((_, i) => {
          const s = saved[i];
          return (
            <div key={i} className={`slot ${s ? 'filled' : ''}`}>
              {s ? (
                <>
                  <button className="slot-thumb" title={`应用：${s.name}`} onClick={() => onApply(s)}>
                    <img src={s.thumbnail} alt={s.name} />
                    <span className="slot-name">{s.name}</span>
                  </button>
                  <button className="slot-del" title="删除方案" onClick={() => onDelete(s.id)}>
                    ×
                  </button>
                </>
              ) : (
                <div className="slot-empty">{i + 1}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="top-actions">
        <button className="btn primary" onClick={onSave} disabled={busy}>
          保存当前方案
        </button>
        <button className="btn" onClick={onExport}>导出方案</button>
        <button className="btn" onClick={() => schemeInput.current?.click()}>导入方案</button>
        <button className="btn ghost" onClick={() => modelInput.current?.click()}>
          加载车身模型
        </button>
        <input
          ref={schemeInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = '';
          }}
        />
        <input
          ref={modelInput}
          type="file"
          accept=".glb,.gltf,.obj,.stl"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onLoadModel(f);
            e.target.value = '';
          }}
        />
      </div>
    </header>
  );
}
