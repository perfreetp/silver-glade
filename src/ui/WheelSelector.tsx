import { STYLE_LIST } from '../constants';
import { state, selectWheel, setViewFocus } from '../store';
import { WHEEL_IDS, WHEEL_NAMES } from '../types';

const STATUS_DOT: Record<string, string> = {
  ok: '#22c55e',
  warn: '#f59e0b',
  collision: '#ef4444',
};

export default function WheelSelector() {
  return (
    <header class="top-bar">
      <div class="brand">轮毂造型替换 · 间隙检查工作台</div>
      <div class="wheel-selector">
        {WHEEL_IDS.map((id) => {
          const r = state.clearances[id];
          return (
            <button
              class="wheel-chip"
              classList={{ active: state.selected === id }}
              onClick={() => selectWheel(id)}
              title={WHEEL_NAMES[id]}
            >
              <i class="status-dot" style={{ background: STATUS_DOT[r.status] }} />
              {WHEEL_NAMES[id]}
              <small>{STYLE_LIST.find((s) => s.id === state.wheels[id].style)?.name}</small>
            </button>
          );
        })}
      </div>
      <div class="view-switch">
        <button
          classList={{ active: !state.focused }}
          onClick={() => setViewFocus(false)}
        >
          整车视角
        </button>
        <button
          classList={{ active: state.focused }}
          onClick={() => setViewFocus(true)}
        >
          聚焦 {WHEEL_NAMES[state.selected]}
        </button>
      </div>
    </header>
  );
}
