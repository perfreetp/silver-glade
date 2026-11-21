import { STYLE_LIST } from '../constants';
import { state, applyStyle } from '../store';

export default function StylePanel() {
  return (
    <aside class="panel style-panel">
      <div class="panel-title">
        轮毂款式
        <span class="panel-sub">点击替换当前轮位</span>
      </div>
      <div class="style-list">
        {STYLE_LIST.map((s) => (
          <button
            class="style-card"
            classList={{ active: state.wheels[state.selected].style === s.id }}
            onClick={() => applyStyle(s.id)}
          >
            <span class="style-glyph" data-style={s.id} />
            <span class="style-text">
              <b>{s.name}</b>
              <small>{s.desc}</small>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
