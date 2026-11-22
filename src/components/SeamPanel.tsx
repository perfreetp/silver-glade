interface Props {
  seamWidth: number;
  brushRadius: number;
  strokeCount: number;
  onSeamWidth: (v: number) => void;
  onBrushRadius: (v: number) => void;
}

export function SeamPanel({
  seamWidth,
  brushRadius,
  strokeCount,
  onSeamWidth,
  onBrushRadius,
}: Props) {
  return (
    <aside className="panel panel-right">
      <h2>接缝面板</h2>

      <label className="ctrl">
        <span className="ctrl-label">
          笔刷半径 <em>{brushRadius.toFixed(3)}</em>
        </span>
        <input
          type="range"
          min={0.01}
          max={0.15}
          step={0.005}
          value={brushRadius}
          onChange={(e) => onBrushRadius(Number(e.target.value))}
        />
      </label>

      <label className="ctrl">
        <span className="ctrl-label">
          接缝宽度 <em>{seamWidth.toFixed(3)}</em>
        </span>
        <input
          type="range"
          min={0.004}
          max={0.08}
          step={0.002}
          value={seamWidth}
          onChange={(e) => onSeamWidth(Number(e.target.value))}
        />
      </label>

      <div className="seam-info">
        <div>
          <span className="seam-num">{strokeCount}</span>
          <span className="seam-caption">条分色边界</span>
        </div>
      </div>

      <ul className="seam-rules">
        <li>边界线沿曲面法线贴合采样，不穿透、不断开</li>
        <li>接缝以固定世界半径生成管体，拉伸不变形</li>
        <li>跨过车门缝 / 翼子板缝时管体连续对齐</li>
      </ul>
    </aside>
  );
}
