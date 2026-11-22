import type { ToolMode } from '../types';

interface Props {
  mode: ToolMode;
  onMode: (m: ToolMode) => void;
  onUndo: () => void;
  onClear: () => void;
  canUndo: boolean;
  isWebGPU: boolean;
  strokeCount: number;
}

const MODES: { id: ToolMode; label: string; hint: string }[] = [
  { id: 'view', label: '旋转/缩放', hint: '左键旋转 · 滚轮缩放' },
  { id: 'paint', label: '绘制边界', hint: '在车身上按住拖动绘制分色边界' },
  { id: 'fill', label: '填色', hint: '先在左侧选膜色，再点击车身色块' },
];

export function ViewportToolbar({
  mode,
  onMode,
  onUndo,
  onClear,
  canUndo,
  isWebGPU,
  strokeCount,
}: Props) {
  return (
    <div className="viewport-toolbar">
      <div className="mode-group">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`mode-btn ${mode === m.id ? 'active' : ''}`}
            onClick={() => onMode(m.id)}
            title={m.hint}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="toolbar-actions">
        <button className="btn small" onClick={onUndo} disabled={!canUndo}>
          撤销边界
        </button>
        <button className="btn small danger" onClick={onClear} disabled={strokeCount === 0}>
          清空
        </button>
        <span className={`engine-badge ${isWebGPU ? 'gpu' : 'fallback'}`}>
          {isWebGPU ? 'WebGPU' : 'WebGL 回退'}
        </span>
      </div>
    </div>
  );
}
