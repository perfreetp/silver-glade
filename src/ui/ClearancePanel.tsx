import { formatMM } from '../constants';
import { state } from '../store';
import { WHEEL_IDS, WHEEL_NAMES } from '../types';
import type { ClearanceStatus } from '../types';

const STATUS_TEXT: Record<ClearanceStatus, string> = {
  ok: '安全',
  warn: '偏紧',
  collision: '干涉',
};

export default function ClearancePanel() {
  return (
    <footer class="panel clearance-panel">
      <div class="clearance-head">
        <b>间隙检测结果</b>
        <span class="hint">
          以轮拱内表面为基准的 BVH 射线检测 · 参数变化后四个轮位自动全量重算
          {state.measuring ? ' · 重算中…' : ''}
        </span>
      </div>
      <div class="clearance-grid">
        {WHEEL_IDS.map((id) => {
          const r = state.clearances[id];
          return (
            <div
              class="clearance-card"
              classList={{
                active: state.selected === id,
                [`s-${r.status}`]: true,
              }}
            >
              <div class="cc-title">
                <i class="status-dot" />
                {WHEEL_NAMES[id]}
                <span class="cc-status">{STATUS_TEXT[r.status]}</span>
              </div>
              <div class="cc-value">
                {r.min === null ? '—' : formatMM(r.min)}
              </div>
              <div class="cc-meta">
                命中射线 {r.rayCount} 条
                {r.boundaryViolation ? ' · 越界' : ''}
              </div>
            </div>
          );
        })}
      </div>
    </footer>
  );
}
