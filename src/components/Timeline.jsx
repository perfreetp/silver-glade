import { FRAME_COUNT } from '../defaults.js';

export function Timeline({ frame, playing, onFrameChange, onTogglePlay }) {
  return (
    <div className="timeline">
      <button className="btn" onClick={onTogglePlay} style={{ width: 64 }}>
        {playing ? '暂停' : '播放'}
      </button>
      <input
        type="range"
        min={0}
        max={FRAME_COUNT - 1}
        step={1}
        value={frame}
        onChange={(e) => onFrameChange(parseInt(e.target.value, 10))}
      />
      <span className="frame-label">帧 {frame + 1} / {FRAME_COUNT}</span>
    </div>
  );
}
