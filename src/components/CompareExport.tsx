import { usePaintStore } from '../store';
import { buildExportDoc, downloadJson } from '../utils/exportJson';
import { CATEGORY_LABELS } from '../types';
import type { PaintParams, SavedScheme } from '../types';

type RowDef = {
  label: string;
  get: (p: PaintParams) => string;
};

const COMPARE_ROWS: RowDef[] = [
  { label: '类型', get: (p) => CATEGORY_LABELS[p.flake.flakeDensity > 0 ? (p.flake.type === 'pearlescent' ? 'pearlescent' : 'metallic') : p.clear.roughness > 0.35 ? 'matte' : 'solid'] },
  { label: '电泳色', get: (p) => p.electro.color.toUpperCase() },
  { label: '电泳厚度', get: (p) => `${p.electro.thickness}μm` },
  { label: '中涂色', get: (p) => p.mid.color.toUpperCase() },
  { label: '中涂粗糙度', get: (p) => p.mid.roughness.toFixed(2) },
  { label: '中涂厚度', get: (p) => `${p.mid.thickness}μm` },
  { label: '片体类型', get: (p) => (p.flake.type === 'pearlescent' ? '珠光片' : '金属片') },
  { label: '朝向分布', get: (p) => (p.flake.orientation === 'highGloss' ? '高光泽' : '低光泽') },
  { label: '片体色', get: (p) => p.flake.flakeColor.toUpperCase() },
  { label: '片层密度', get: (p) => `${Math.round(p.flake.flakeDensity * 100)}%` },
  { label: '片层粗糙度', get: (p) => p.flake.roughness.toFixed(2) },
  { label: '片层厚度', get: (p) => `${p.flake.thickness}μm` },
  { label: '闪烁强度', get: (p) => `${Math.round(p.flake.sparkle * 100)}%` },
  { label: '清漆厚度', get: (p) => `${p.clear.thickness}μm` },
  { label: '清漆 IOR', get: (p) => p.clear.ior.toFixed(2) },
  { label: '清漆粗糙度', get: (p) => p.clear.roughness.toFixed(2) },
];

function ComparePanel() {
  const schemes = usePaintStore((s) => s.schemes);
  const compareIds = usePaintStore((s) => s.compareIds);
  const applyScheme = usePaintStore((s) => s.applyScheme);
  const a: SavedScheme | undefined = schemes.find((x) => x.id === compareIds[0]);
  const b: SavedScheme | undefined = schemes.find((x) => x.id === compareIds[1]);

  if (!a && !b) {
    return (
      <div className="panel">
        <h3>
          <span className="dot" style={{ background: 'var(--accent-2)' }} />
          方案参数对比
        </h3>
        <div className="compare-empty">
          在左侧方案库点 <b>⇄</b> 选择最多两套方案进行逐项对比
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>
        <span className="dot" style={{ background: 'var(--accent-2)' }} />
        方案参数对比
      </h3>
      <table className="compare-table">
        <thead>
          <tr>
            <th>参数</th>
            <th>{a ? a.name : '—'}</th>
            <th>{b ? b.name : '—'}</th>
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((row) => {
            const va = a ? row.get(a.params) : '—';
            const vb = b ? row.get(b.params) : '—';
            const diff = a && b && va !== vb;
            return (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className={diff ? 'diff' : ''}>{va}</td>
                <td className={diff ? 'diff' : ''}>{vb}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="btn-row" style={{ marginTop: 10 }}>
        {a ? (
          <button className="btn" onClick={() => applyScheme(a.id)} type="button">
            套用「{a.name}」
          </button>
        ) : null}
        {b ? (
          <button className="btn" onClick={() => applyScheme(b.id)} type="button">
            套用「{b.name}」
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ExportPanel() {
  const params = usePaintStore((s) => s.params);
  const activePresetId = usePaintStore((s) => s.activePresetId);
  const schemes = usePaintStore((s) => s.schemes);
  const showToast = usePaintStore((s) => s.showToast);

  const handleExport = () => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const scheme: SavedScheme = {
      id: `export-${stamp}`,
      name: activePresetId
        ? `preset_${activePresetId}_${stamp}`
        : `custom_${stamp}`,
      category: schemes[0]?.category ?? 'metallic',
      params: structuredClone(params),
      createdAt: Date.now(),
    };
    downloadJson(buildExportDoc(scheme));
    showToast('已导出含四层参数的 JSON 文件');
  };

  return (
    <div className="panel">
      <h3>
        <span className="dot" style={{ background: 'var(--ok)' }} />
        下游交付
      </h3>
      <button className="btn primary" style={{ width: '100%' }} onClick={handleExport} type="button">
        导出材质参数 JSON
      </button>
      <div className="light-hint">
        JSON 包含电泳 / 中涂 / 片层 / 清漆全部参数，厚度单位微米（μm），附带格式版本号与导出时间。
      </div>
    </div>
  );
}

export function RightBottomPanels() {
  return (
    <>
      <ComparePanel />
      <ExportPanel />
    </>
  );
}
