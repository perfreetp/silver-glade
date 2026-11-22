<script setup lang="ts">
import { computed } from "vue";
import { samplePalette, type PaletteDef } from "../engine/palette";
import { TEMP_MAX, TEMP_MIN } from "../model/types";

const props = defineProps<{
  palette: PaletteDef;
  min?: number;
  max?: number;
  marker?: number;
}>();

const lo = computed(() => props.min ?? TEMP_MIN);
const hi = computed(() => props.max ?? TEMP_MAX);
const span = computed(() => Math.max(1e-3, hi.value - lo.value));

const gradient = computed(() => {
  const n = 24;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const temp = lo.value + span.value * f;
    const t = (temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
    const [r, g, b] = samplePalette(props.palette, Math.min(1, Math.max(0, t)));
    parts.push(`rgb(${r},${g},${b}) ${(f * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
});

const ticks = computed(() => {
  const out: number[] = [];
  const step = span.value <= 5 ? 1 : 5;
  const start = Math.ceil(lo.value / step) * step;
  for (let t = start; t <= hi.value + 1e-6; t += step) out.push(t);
  return out;
});

function posOf(temp: number): number {
  return ((temp - lo.value) / span.value) * 100;
}

const markerPos = computed(() =>
  props.marker === undefined ? null : Math.min(100, Math.max(0, posOf(props.marker)))
);
</script>

<template>
  <div class="legend">
    <div class="legend__bar" :style="{ background: gradient }">
      <div v-if="markerPos !== null" class="legend__marker" :style="{ left: markerPos + '%' }" />
    </div>
    <div class="legend__ticks">
      <span
        v-for="(t, i) in ticks"
        :key="t"
        class="legend__tick mono"
        :style="{ left: posOf(t) + '%' }"
      >
        {{ t }}{{ i === ticks.length - 1 ? "℃" : "" }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.legend {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.legend__bar {
  position: relative;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--line);
}

.legend__marker {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.65);
  transform: translateX(-1px);
  border-radius: 1px;
}

.legend__ticks {
  position: relative;
  height: 14px;
}

.legend__tick {
  position: absolute;
  transform: translateX(-50%);
  font-size: 9.5px;
  color: var(--fg-2);
  white-space: nowrap;
}
.legend__tick:first-child {
  transform: translateX(-10%);
}
</style>
