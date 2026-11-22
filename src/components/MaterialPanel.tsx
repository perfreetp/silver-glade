interface Props {
  roughness: number;
  metallic: number;
  onRoughness: (v: number) => void;
  onMetallic: (v: number) => void;
}

export function MaterialPanel({ roughness, metallic, onRoughness, onMetallic }: Props) {
  return (
    <footer className="panel panel-bottom">
      <h2>膜材参数 · 整车身同步</h2>
      <div className="bottom-controls">
        <label className="ctrl">
          <span className="ctrl-label">
            粗糙度 Roughness <em>{roughness.toFixed(2)}</em>
          </span>
          <input
            type="range"
            min={0.02}
            max={1}
            step={0.01}
            value={roughness}
            onChange={(e) => onRoughness(Number(e.target.value))}
          />
        </label>
        <label className="ctrl">
          <span className="ctrl-label">
            金属度 Metallic <em>{metallic.toFixed(2)}</em>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={metallic}
            onChange={(e) => onMetallic(Number(e.target.value))}
          />
        </label>
      </div>
    </footer>
  );
}
