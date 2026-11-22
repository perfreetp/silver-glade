<template>
  <div class="route-editor">
    <section class="card">
      <h3>航路点(水平位置,km)</h3>
      <table class="wp-table">
        <thead>
          <tr><th>航路点</th><th>X (km)</th><th>Z (km)</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="(pt, i) in store.route.points" :key="i">
            <td>{{ labelOf(i) }}</td>
            <td><input type="number" min="0" max="60" step="0.5" v-model.number="pt.x" @change="clampPoint(pt)" /></td>
            <td><input type="number" min="0" max="60" step="0.5" v-model.number="pt.z" @change="clampPoint(pt)" /></td>
            <td>
              <button
                v-if="i > 0 && i < store.route.points.length - 1"
                class="danger"
                @click="removePoint(i)"
              >删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="row">
        <button @click="addPoint" :disabled="store.route.points.length >= 6">+ 添加途经点</button>
        <span class="hint">全长 {{ totalLength.toFixed(1) }} km · {{ store.route.points.length - 1 }} 个航段</span>
      </div>
      <div class="row presets">
        <span>预设:</span>
        <button @click="applyPreset(0)">穿云直线</button>
        <button @click="applyPreset(1)">北侧绕飞</button>
        <button @click="applyPreset(2)">风暴走廊</button>
      </div>
    </section>

    <section class="card">
      <h3>高度带(m)</h3>
      <div class="row">
        <label>带底 <input type="number" min="100" max="6000" step="100" v-model.number="store.route.bandMin" @change="validateBand" /></label>
        <label>带顶 <input type="number" min="100" max="6000" step="100" v-model.number="store.route.bandMax" @change="validateBand" /></label>
      </div>
      <div class="row">
        <input type="range" min="100" max="6000" step="100" v-model.number="store.route.bandMin" @input="validateBand" />
        <input type="range" min="100" max="6000" step="100" v-model.number="store.route.bandMax" @input="validateBand" />
      </div>
      <p class="warn" v-if="msaWarning">
        ⚠ 航路最高地形约 {{ maxTerrainM.toFixed(0) }} m,加 150 m 越障余度后 MSA 约 {{ (maxTerrainM + 150).toFixed(0) }} m,当前带底 {{ store.route.bandMin }} m 越障余度不足。
      </p>
      <p class="ok" v-else>✓ 带底高于航路 MSA({{ (maxTerrainM + 150).toFixed(0) }} m),越障余度满足要求。</p>
    </section>

    <section class="card">
      <h3>航段一览</h3>
      <table class="wp-table">
        <thead><tr><th>航段</th><th>起</th><th>讫</th><th>长度 (km)</th><th>磁航向(近似)</th></tr></thead>
        <tbody>
          <tr v-for="(leg, i) in legs" :key="i">
            <td>{{ i + 1 }}</td>
            <td>({{ leg.a.x.toFixed(1) }}, {{ leg.a.z.toFixed(1) }})</td>
            <td>({{ leg.b.x.toFixed(1) }}, {{ leg.b.z.toFixed(1) }})</td>
            <td>{{ leg.len.toFixed(1) }}</td>
            <td>{{ leg.heading.toFixed(0) }}°</td>
          </tr>
        </tbody>
      </table>
      <p class="hint">编辑后切换到「体积视图」查看航路高亮,或到「剖面分析」生成沿航路垂直剖面。</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { store, type RoutePoint } from '../store';
import { terrainHeight } from '../data/noise';

const PRESETS: { points: RoutePoint[]; bandMin: number; bandMax: number }[] = [
  { points: [{ x: 8, z: 10 }, { x: 52, z: 48 }], bandMin: 600, bandMax: 2500 },
  { points: [{ x: 8, z: 10 }, { x: 30, z: 8 }, { x: 52, z: 20 }], bandMin: 800, bandMax: 3000 },
  { points: [{ x: 6, z: 44 }, { x: 28, z: 30 }, { x: 54, z: 14 }], bandMin: 600, bandMax: 2200 },
];

function labelOf(i: number): string {
  if (i === 0) return '起点';
  if (i === store.route.points.length - 1) return '终点';
  return `途经 ${i}`;
}

function clampPoint(pt: RoutePoint): void {
  pt.x = Math.min(60, Math.max(0, Number.isFinite(pt.x) ? pt.x : 0));
  pt.z = Math.min(60, Math.max(0, Number.isFinite(pt.z) ? pt.z : 0));
}

function addPoint(): void {
  const pts = store.route.points;
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  pts.splice(pts.length - 1, 0, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
}

function removePoint(i: number): void {
  if (store.route.points.length > 2) store.route.points.splice(i, 1);
}

function validateBand(): void {
  const r = store.route;
  r.bandMin = Math.min(6000, Math.max(100, r.bandMin || 100));
  r.bandMax = Math.min(6000, Math.max(100, r.bandMax || 100));
  if (r.bandMax <= r.bandMin) r.bandMax = r.bandMin + 100;
}

function applyPreset(i: number): void {
  const p = PRESETS[i];
  store.route.points = p.points.map((pt) => ({ ...pt }));
  store.route.bandMin = p.bandMin;
  store.route.bandMax = p.bandMax;
}

const legs = computed(() => {
  const pts = store.route.points;
  const out: { a: RoutePoint; b: RoutePoint; len: number; heading: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    // 以 +Z 为北、+X 为东的近似航向角
    const heading = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
    out.push({ a, b, len: Math.hypot(dx, dz), heading });
  }
  return out;
});

const totalLength = computed(() => legs.value.reduce((s, l) => s + l.len, 0));

const maxTerrainM = computed(() => {
  let m = 0;
  const pts = store.route.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(2, Math.ceil(len / 0.5));
    for (let k = 0; k <= n; k++) {
      const h = terrainHeight(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n) * 1000;
      if (h > m) m = h;
    }
  }
  return m;
});

const msaWarning = computed(() => store.route.bandMin < maxTerrainM.value + 150);
</script>
