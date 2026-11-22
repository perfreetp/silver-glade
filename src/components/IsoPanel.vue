<script setup lang="ts">
import { computed } from "vue";
import { ui, persistPrefs } from "../state/store";
import { PALETTES, getPalette } from "../engine/palette";
import { TEMP_MAX, TEMP_MIN } from "../model/types";
import ColorLegend from "./ColorLegend.vue";

const climb = computed(() => ui.stats.isoReady && ui.stats.fps > 0 && ui.stats.fps < 30);
const thresholdPct = computed(
  () => ((ui.prefs.threshold - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 100
);
const activePalette = computed(() => getPalette(ui.prefs.palette as never));

function onSlider(ev: Event): void {
  const v = Number((ev.target as HTMLInputElement).value);
  ui.prefs.threshold = v;
  persistPrefs();
}

function nudge(delta: number): void {
  ui.prefs.threshold = Math.min(TEMP_MAX, Math.max(TEMP_MIN, Math.round((ui.prefs.threshold + delta) * 10) / 10));
  persistPrefs();
}

function preset(v: number): void {
  ui.prefs.threshold = v;
  persistPrefs();
}
</script>

<template>
  <div class="panel">
    <section class="block">
      <div class="block-head">
        <h2>等值面阈值</h2>
        <span class="chip" :class="climb ? 'warn' : 'ok'">
          {{ ui.stats.isoReady ? (ui.stats.fps.toFixed(0) + " fps") : "待机" }}
        </span>
      </div>

      <div class="threshold-row">
        <button class="btn sm ghost" :disabled="ui.prefs.threshold <= TEMP_MIN" @click="nudge(-0.5)">−</button>
        <div class="threshold-value mono">
          {{ ui.prefs.threshold.toFixed(1) }}<span class="unit">℃</span>
        </div>
        <button class="btn sm ghost" :disabled="ui.prefs.threshold >= TEMP_MAX" @click="nudge(0.5)">+</button>
      </div>

      <input
        class="slider"
        type="range"
        :min="TEMP_MIN"
        :max="TEMP_MAX"
        step="0.1"
        :value="ui.prefs.threshold"
        :style="{ '--pct': thresholdPct + '%' }"
        @input="onSlider"
      />

      <div class="range-labels mono">
        <span>{{ TEMP_MIN }}℃</span>
        <span>{{ TEMP_MAX }}℃</span>
      </div>

      <div class="presets">
        <button class="btn sm" @click="preset(30)">30</button>
        <button class="btn sm" @click="preset(35)">35</button>
        <button class="btn sm" @click="preset(40)">40</button>
        <button class="btn sm" @click="preset(45)">45</button>
        <button class="btn sm" @click="preset(50)">50</button>
      </div>

      <p class="hint">
        阈值越高，包裹体收缩到只保留热点；阈值越低，热区扩张并连成一片。
        拖动时只重跑移动立方体，GPU 缓冲区全程复用。
      </p>
    </section>

    <section class="block">
      <div class="block-head"><h2>外观</h2></div>

      <div class="field">
        <label>色带</label>
        <select
          class="select"
          :value="ui.prefs.palette"
          @change="ui.prefs.palette = ($event.target as HTMLSelectElement).value as never; persistPrefs()"
        >
          <option v-for="p in PALETTES" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </div>

      <ColorLegend :palette="activePalette" :marker="ui.prefs.threshold" />

      <div class="field">
        <label>等值面不透明度 · {{ (ui.prefs.opacity * 100).toFixed(0) }}%</label>
        <input
          class="slider"
          type="range"
          min="0.05"
          max="0.9"
          step="0.01"
          :value="ui.prefs.opacity"
          :style="{ '--pct': ((ui.prefs.opacity - 0.05) / 0.85) * 100 + '%' }"
          @input="ui.prefs.opacity = Number(($event.target as HTMLInputElement).value); persistPrefs()"
        />
      </div>

      <div class="toggles">
        <label class="toggle">
          <input type="checkbox" :checked="ui.prefs.showIso" @change="ui.prefs.showIso = ($event.target as HTMLInputElement).checked; persistPrefs()" />
          <span class="toggle__box" />
          <span>显示等值面</span>
        </label>
        <label class="toggle">
          <input type="checkbox" :checked="ui.prefs.showHeatmap" @change="ui.prefs.showHeatmap = ($event.target as HTMLInputElement).checked; persistPrefs()" />
          <span class="toggle__box" />
          <span>显示风面热力图</span>
        </label>
      </div>
    </section>

    <section class="block">
      <div class="block-head"><h2>重建统计</h2></div>
      <dl class="stats">
        <div><dt>顶点数</dt><dd class="mono">{{ ui.stats.isoVerts.toLocaleString() }}</dd></div>
        <div><dt>三角形</dt><dd class="mono">{{ Math.floor(ui.stats.isoVerts / 3).toLocaleString() }}</dd></div>
        <div><dt>重建耗时</dt><dd class="mono">{{ ui.stats.lastIsoMs.toFixed(1) }} ms</dd></div>
        <div><dt>体素网格</dt><dd class="mono">{{ (ui.stats.voxels / 1000).toFixed(1) }}k</dd></div>
        <div><dt>帧时间</dt><dd class="mono">{{ ui.stats.frameMs.toFixed(1) }} ms</dd></div>
      </dl>
      <div v-if="ui.stats.isoVerts >= 299000" class="cap-warn">
        顶点数接近 30 万上限，超出部分已截断。可提高阈值以收紧热区。
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
}

h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-1);
}

.threshold-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.threshold-value {
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.02em;
  min-width: 108px;
  text-align: center;
  color: var(--fg-0);
  font-variant-numeric: tabular-nums;
}

.unit {
  font-size: 15px;
  color: var(--fg-2);
  margin-left: 3px;
}

.slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 5px;
  border-radius: 3px;
  background: linear-gradient(
    90deg,
    var(--accent) 0%,
    var(--accent) var(--pct, 50%),
    #1b2530 var(--pct, 50%),
    #1b2530 100%
  );
  outline: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #e8eef6;
  border: 2px solid #0a0e13;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.55);
  cursor: grab;
}
.slider::-webkit-slider-thumb:active {
  cursor: grabbing;
  background: #fff;
}

.range-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--fg-2);
  margin-top: -4px;
}

.presets {
  display: flex;
  gap: 5px;
}
.presets .btn {
  flex: 1;
  padding: 4px 0;
  font-family: var(--mono);
}

.hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--fg-2);
}

.toggles {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  font-size: 12px;
  color: var(--fg-1);
  user-select: none;
}
.toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.toggle__box {
  width: 30px;
  height: 17px;
  border-radius: 9px;
  background: #1b2530;
  border: 1px solid var(--line);
  position: relative;
  transition: background 0.16s, border-color 0.16s;
  flex-shrink: 0;
}

.toggle__box::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--fg-2);
  transition: transform 0.16s, background 0.16s;
}

.toggle input:checked + .toggle__box {
  background: #0b4a63;
  border-color: var(--accent-dim);
}
.toggle input:checked + .toggle__box::after {
  transform: translateX(13px);
  background: var(--accent);
}

.stats {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
}
.stats > div {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid var(--line-soft);
}
.stats dt {
  color: var(--fg-2);
  font-size: 11.5px;
}
.stats dd {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.cap-warn {
  padding: 7px 9px;
  border-radius: 4px;
  background: #1f1810;
  border: 1px solid #4a3712;
  color: var(--warn);
  font-size: 11px;
  line-height: 1.5;
}
</style>
