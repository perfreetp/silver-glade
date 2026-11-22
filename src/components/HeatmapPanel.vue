<script setup lang="ts">
import { computed } from "vue";
import { ui, persistPrefs } from "../state/store";
import { getPalette } from "../engine/palette";
import { TEMP_MAX, TEMP_MIN } from "../model/types";
import ColorLegend from "./ColorLegend.vue";

const props = defineProps<{
  getEngine: () => any;
}>();

const activePalette = computed(() => getPalette(ui.prefs.palette as never));

const selected = computed(() => {
  const idx = ui.selectedRack;
  if (idx === null) return null;
  const engine = props.getEngine();
  if (!engine) return null;
  const layout = engine.getLayout?.();
  const box = layout?.boxes?.[idx];
  const stats = engine.getRackStats?.(idx);
  if (!box) return null;
  return { box, stats };
});

function setShowHeatmap(v: boolean): void {
  ui.prefs.showHeatmap = v;
  persistPrefs();
}

const gridCells = computed(() => {
  const s = selected.value;
  if (!s) return null;
  const intake = s.box.rack.intake;
  const exhaust = s.box.rack.exhaust;
  const rows: { kind: "intake" | "exhaust"; y: number; cells: { x: number; v: number }[] }[] = [];
  for (let y = 0; y < intake.rows; y++) {
    const cells: { x: number; v: number }[] = [];
    for (let x = 0; x < intake.cols; x++) cells.push({ x, v: intake.values[y * intake.cols + x] });
    rows.push({ kind: "intake", y, cells });
  }
  const exRows: typeof rows = [];
  for (let y = 0; y < exhaust.rows; y++) {
    const cells: { x: number; v: number }[] = [];
    for (let x = 0; x < exhaust.cols; x++) cells.push({ x, v: exhaust.values[y * exhaust.cols + x] });
    exRows.push({ kind: "exhaust", y, cells });
  }
  return { intake: rows, exhaust: exRows };
});

function cellColor(v: number): string {
  const p = activePalette.value;
  const t = Math.min(1, Math.max(0, (v - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)));
  const [r, g, b] = [0, 1, 2].map((i) => {
    const stops = p.stops;
    let lo = stops[0];
    let hi = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s].t && t <= stops[s + 1].t) {
        lo = stops[s];
        hi = stops[s + 1];
        break;
      }
    }
    const span = Math.max(1e-6, hi.t - lo.t);
    const f = (t - lo.t) / span;
    return Math.round((lo.rgb[i] + (hi.rgb[i] - lo.rgb[i]) * f) * 255);
  });
  return `rgb(${r},${g},${b})`;
}

const rackList = computed(() => {
  const engine = props.getEngine();
  const layout = engine?.getLayout?.();
  return (layout?.boxes ?? []).map((b: any, i: number) => ({ id: b.rack.id, index: i, row: b.rack.row, col: b.rack.col }));
});

function selectRack(i: number): void {
  ui.selectedRack = ui.selectedRack === i ? null : i;
}
</script>

<template>
  <div class="panel">
    <section class="block">
      <div class="block-head">
        <h2>风面热力映射</h2>
        <label class="mini-toggle">
          <input type="checkbox" :checked="ui.prefs.showHeatmap" @change="setShowHeatmap(($event.target as HTMLInputElement).checked)" />
          <span class="mini-box" />
          <span>显示</span>
        </label>
      </div>
      <p class="hint">
        进风面与出风面分别按分段查找表贴温度色带。色带与等值面共享同一色标，
        半透明包裹体叠加在风面上方，按深度正确遮挡。
      </p>
      <ColorLegend :palette="activePalette" :marker="ui.prefs.threshold" />
    </section>

    <section v-if="selected && gridCells" class="block">
      <div class="block-head">
        <h2>机柜 {{ selected.box.rack.id }}</h2>
        <span class="chip">行 {{ selected.box.rack.row }} · 列 {{ selected.box.rack.col }} · {{ selected.box.rack.facing }}</span>
      </div>

      <dl class="rack-stats">
        <div>
          <dt>进风</dt>
          <dd class="mono">{{ selected.stats.intakeAvg.toFixed(1) }}℃</dd>
          <dd class="sub mono">{{ selected.stats.intakeMin.toFixed(1) }}–{{ selected.stats.intakeMax.toFixed(1) }}</dd>
        </div>
        <div>
          <dt>出风</dt>
          <dd class="mono">{{ selected.stats.exhaustAvg.toFixed(1) }}℃</dd>
          <dd class="sub mono">{{ selected.stats.exhaustMin.toFixed(1) }}–{{ selected.stats.exhaustMax.toFixed(1) }}</dd>
        </div>
        <div>
          <dt>ΔT</dt>
          <dd class="mono" :class="{ hot: selected.stats.deltaT > 12 }">+{{ selected.stats.deltaT.toFixed(1) }}℃</dd>
        </div>
      </dl>

      <div class="grids">
        <div class="grid-block">
          <div class="grid-title">进风面 <span class="mono">36 点</span></div>
          <div class="grid">
            <div v-for="row in gridCells.intake" :key="'i' + row.y" class="grid__row">
              <span
                v-for="cell in row.cells"
                :key="cell.x"
                class="grid__cell"
                :style="{ background: cellColor(cell.v) }"
                :title="cell.v.toFixed(1) + '℃'"
              />
            </div>
          </div>
        </div>
        <div class="grid-block">
          <div class="grid-title">出风面 <span class="mono">36 点</span></div>
          <div class="grid">
            <div v-for="row in gridCells.exhaust" :key="'e' + row.y" class="grid__row">
              <span
                v-for="cell in row.cells"
                :key="cell.x"
                class="grid__cell"
                :style="{ background: cellColor(cell.v) }"
                :title="cell.v.toFixed(1) + '℃'"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <section v-else class="block">
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" width="26" height="26">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M4 12h16M12 4v16" />
        </svg>
        <p>点击视口中的机柜查看逐点温度</p>
      </div>
    </section>

    <section v-if="rackList.length" class="block">
      <div class="block-head"><h2>机柜列表</h2><span class="chip">{{ rackList.length }}</span></div>
      <div class="rack-grid">
        <button
          v-for="r in rackList"
          :key="r.index"
          class="rack-btn mono"
          :class="{ active: ui.selectedRack === r.index }"
          :title="'行 ' + r.row + ' 列 ' + r.col"
          @click="selectRack(r.index)"
        >
          {{ r.id }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  overflow-y: auto;
  height: 100%;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-1);
}

.hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--fg-2);
}

.mini-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--fg-1);
  cursor: pointer;
  user-select: none;
}
.mini-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.mini-box {
  width: 26px;
  height: 15px;
  border-radius: 8px;
  background: #1b2530;
  border: 1px solid var(--line);
  position: relative;
  transition: background 0.16s;
}
.mini-box::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--fg-2);
  transition: transform 0.16s, background 0.16s;
}
.mini-toggle input:checked + .mini-box {
  background: #0b4a63;
  border-color: var(--accent-dim);
}
.mini-toggle input:checked + .mini-box::after {
  transform: translateX(11px);
  background: var(--accent);
}

.rack-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 0;
}
.rack-stats > div {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px 9px;
  border-radius: var(--radius-sm);
  background: var(--bg-2);
  border: 1px solid var(--line-soft);
}
.rack-stats dt {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fg-2);
}
.rack-stats dd {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.rack-stats .sub {
  font-size: 10.5px;
  font-weight: 400;
  color: var(--fg-2);
}
.rack-stats .hot {
  color: var(--warn);
}

.grids {
  display: flex;
  gap: 14px;
}

.grid-block {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.grid-title {
  font-size: 11px;
  color: var(--fg-1);
  display: flex;
  justify-content: space-between;
}
.grid-title .mono {
  color: var(--fg-2);
  font-size: 10px;
}

.grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
  aspect-ratio: 6 / 5;
  padding: 3px;
  background: var(--bg-0);
  border: 1px solid var(--line-soft);
  border-radius: 4px;
}

.grid__row {
  flex: 1;
  display: flex;
  gap: 2px;
}

.grid__cell {
  flex: 1;
  border-radius: 1.5px;
  cursor: crosshair;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 26px 12px;
  border-radius: var(--radius);
  border: 1px dashed var(--line);
  color: var(--fg-2);
}
.empty p {
  margin: 0;
  font-size: 11.5px;
}

.rack-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.rack-btn {
  padding: 3px 6px;
  border-radius: 3px;
  background: var(--bg-2);
  border: 1px solid var(--line-soft);
  font-size: 10px;
  color: var(--fg-1);
  transition: background 0.13s, border-color 0.13s, color 0.13s;
}
.rack-btn:hover {
  background: var(--bg-3);
  color: var(--fg-0);
}
.rack-btn.active {
  background: #0b4a63;
  border-color: var(--accent-dim);
  color: #dff6ff;
}
</style>
