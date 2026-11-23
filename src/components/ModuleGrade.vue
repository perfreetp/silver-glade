<script setup lang="ts">
import { computed, ref } from "vue";
import {
  store,
  getService,
  effectiveGrade,
  gradeDistribution,
  totalArea,
  setStatus,
} from "../store";
import { GRADE_META, type DamageGrade } from "../types";
import { exportLayerJson, exportGradeCsv } from "../exporter";

// ---------- 可拖动的三档界阈值 ----------
const trackEl = ref<HTMLDivElement | null>(null);
const dragging = ref<0 | 1 | null>(null);

function pointerXToValue(clientX: number): number {
  const el = trackEl.value!;
  const rect = el.getBoundingClientRect();
  const v = (clientX - rect.left) / rect.width;
  return Math.min(1, Math.max(0, v));
}

function startDrag(which: 0 | 1, e: PointerEvent) {
  dragging.value = which;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onDrag(e: PointerEvent) {
  if (dragging.value === null) return;
  const v = pointerXToValue(e.clientX);
  const t = store.thresholds;
  const gap = 0.05;
  if (dragging.value === 0) {
    t[0] = Math.min(v, t[1] - gap);
  } else {
    t[1] = Math.max(v, t[0] + gap);
  }
  getService().rebuildLayerColors();
}

function endDrag(e: PointerEvent) {
  if (dragging.value !== null) {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragging.value = null;
  }
}

// ---------- 面片列表与手动定级 ----------
const list = computed(() =>
  [...store.patches]
    .map((p) => ({ patch: p, grade: effectiveGrade(p) }))
    .slice(-80)
    .reverse()
);

function changeGrade(patchId: number, e: Event) {
  const val = (e.target as HTMLSelectElement).value;
  getService().setManualGrade(patchId, val === "auto" ? null : Number(val));
}

// ---------- 导入 / 导出 ----------
function doExportLayer() {
  const name = exportLayerJson(getService());
  setStatus(`已导出图层文件：${name}`);
}

function doExportCsv() {
  const name = exportGradeCsv();
  setStatus(`已导出等级分布清单：${name}`);
}

function onLayerFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  getService()
    .importLayerFile(file)
    .catch((err: Error) => setStatus(`图层导入失败：${err.message}`));
  input.value = "";
}
</script>

<template>
  <details class="module-card" open>
    <summary><span class="step">4</span>等级调整与导出</summary>
    <div class="card-body">
      <div class="section-title">
        三档界阈值（拖动即时重算颜色）：t1={{ store.thresholds[0].toFixed(2) }}，
        t2={{ store.thresholds[1].toFixed(2) }}
      </div>
      <div
        ref="trackEl"
        class="threshold-track"
        @pointermove="onDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
      >
        <div class="th-band band-1"></div>
        <div
          class="th-band band-2"
          :style="{ left: store.thresholds[0] * 100 + '%', right: (1 - store.thresholds[1]) * 100 + '%' }"
        ></div>
        <div
          class="th-band band-3"
          :style="{ left: store.thresholds[1] * 100 + '%', width: (0.85 - store.thresholds[1]) * 100 + '%' }"
        ></div>
        <div
          class="th-band band-4"
          :style="{ left: '85%', right: 0 }"
        ></div>
        <div
          class="th-handle"
          :style="{ left: store.thresholds[0] * 100 + '%' }"
          @pointerdown="startDrag(0, $event)"
        >
          t1
        </div>
        <div
          class="th-handle"
          :style="{ left: store.thresholds[1] * 100 + '%' }"
          @pointerdown="startDrag(1, $event)"
        >
          t2
        </div>
      </div>
      <div class="muted">
        分档规则：s&lt;t1 → 1 级；s&lt;t2 → 2 级；s&lt;0.85 → 3 级；否则 4 级。
      </div>

      <div class="section-title">等级分布</div>
      <div class="kv-list">
        <template v-for="g in GRADE_META" :key="g.grade">
          <span class="k">
            <span class="grade-dot" :style="{ background: g.css, display: 'inline-block', marginRight: 4 }"></span>
            {{ g.name }}
          </span>
          <span class="v">
            {{ gradeDistribution[g.grade - 1].count }} 片 /
            {{ gradeDistribution[g.grade - 1].area.toFixed(2) }} ㎡
          </span>
        </template>
        <span class="k">残损总面积</span>
        <span class="v">{{ totalArea.toFixed(2) }} ㎡</span>
      </div>

      <div class="section-title">面片手动定级（最近 80 个）</div>
      <div class="patch-list">
        <div
          v-for="item in list"
          :key="item.patch.id"
          class="patch-item"
          :class="{ selected: store.selectedPatchId === item.patch.id }"
          @click="store.selectedPatchId = item.patch.id"
        >
          <span
            class="grade-dot"
            :style="{ background: GRADE_META[item.grade - 1].css }"
          ></span>
          <span>{{ item.patch.name }}</span>
          <select
            :value="item.patch.manualGrade ?? 'auto'"
            @click.stop
            @change="changeGrade(item.patch.id, $event)"
          >
            <option value="auto">自动</option>
            <option v-for="g in GRADE_META" :key="g.grade" :value="g.grade">
              {{ g.grade }} 级·{{ g.name }}
            </option>
          </select>
        </div>
        <div v-if="list.length === 0" class="muted" style="padding: 8px">
          暂无面片，请先在模块二中绘制
        </div>
      </div>

      <div class="btn-row">
        <button @click="doExportLayer" :disabled="store.patches.length === 0">
          导出图层 JSON
        </button>
        <button @click="doExportCsv" :disabled="store.patches.length === 0">
          导出清单 CSV
        </button>
      </div>
      <div class="btn-row">
        <label class="file-btn" for="layer-file">回导图层 JSON</label>
        <input
          id="layer-file"
          type="file"
          accept=".json,application/json"
          @change="onLayerFile"
        />
      </div>
    </div>
  </details>
</template>

<style scoped>
.threshold-track {
  position: relative;
  height: 26px;
  border-radius: 5px;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  border: 1px solid var(--border);
}

.th-band {
  position: absolute;
  top: 0;
  bottom: 0;
}

.band-1 {
  left: 0;
  right: 0;
  background: rgba(92, 204, 77, 0.28);
}

.band-2 {
  background: rgba(243, 209, 46, 0.3);
}

.band-3 {
  background: rgba(245, 133, 31, 0.32);
}

.band-4 {
  background: rgba(235, 41, 33, 0.35);
}

.th-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 22px;
  margin-left: -11px;
  background: var(--accent);
  color: #08131f;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ew-resize;
  border-radius: 4px;
  z-index: 2;
}

.th-handle:hover {
  filter: brightness(1.15);
}
</style>
