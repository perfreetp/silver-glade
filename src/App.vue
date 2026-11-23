<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { store, derived, regenerateTerrain } from './store';
import { initScene } from './scene3d';
import { exportProject, importProject } from './file';
import { elevationAt } from './alignment';
import ProfileView from './ProfileView.vue';

const renderCanvas = ref<HTMLCanvasElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const message = ref('');

onMounted(async () => {
  if (renderCanvas.value) {
    await initScene(renderCanvas.value);
  }
});

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function addPlanPoint(): void {
  const pts = store.planPoints;
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const half = store.terrain.size / 2 - 60;
  pts.push({
    x: clamp(b.x + (dx / len) * 250, -half, half),
    z: clamp(b.z + (dz / len) * 250, -half, half),
  });
}

function removePlanPoint(): void {
  if (store.planPoints.length > 2) store.planPoints.pop();
}

function addProfilePoint(): void {
  const pts = store.profilePoints;
  let bi = 0;
  let bl = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = pts[i + 1].s - pts[i].s;
    if (l > bl) {
      bl = l;
      bi = i;
    }
  }
  const s = pts[bi].s + bl / 2;
  pts.splice(bi + 1, 0, { s, elev: elevationAt(pts, s) });
}

function removeProfilePoint(): void {
  if (store.profilePoints.length > 2) store.profilePoints.pop();
}

function showMessage(msg: string): void {
  message.value = msg;
  window.setTimeout(() => (message.value = ''), 3000);
}

async function doImport(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  const err = await importProject(f);
  showMessage(err ?? '导入成功,轨道与挖填方已重新计算');
  input.value = '';
}
</script>

<template>
  <div class="app">
    <header class="toolbar">
      <span class="title">线路地形融合展示</span>
      <label><input type="checkbox" v-model="store.showTerrain" /> 地形</label>
      <label><input type="checkbox" v-model="store.showTrack" /> 轨道</label>
      <label class="slider">
        道床宽
        <input type="range" min="4" max="24" step="0.5" v-model.number="store.bedWidth" />
        {{ store.bedWidth.toFixed(1) }}m
      </label>
      <label>
        里程标距
        <select v-model.number="store.milepostInterval">
          <option :value="250">250m</option>
          <option :value="500">500m</option>
          <option :value="1000">1000m</option>
        </select>
      </label>
      <span class="sep"></span>
      <button @click="addPlanPoint">+平面点</button>
      <button @click="removePlanPoint">-平面点</button>
      <button @click="addProfilePoint">+纵断面点</button>
      <button @click="removeProfilePoint">-纵断面点</button>
      <button @click="regenerateTerrain">随机地形</button>
      <span class="sep"></span>
      <button @click="exportProject">导出</button>
      <button @click="fileInput?.click()">导入</button>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="doImport" />
      <span class="legend"><i class="fill"></i>填方 <i class="cut"></i>挖方</span>
      <span class="badge">{{ derived.engineType }}</span>
      <span v-if="message" class="msg">{{ message }}</span>
    </header>
    <main class="view3d">
      <canvas ref="renderCanvas"></canvas>
      <div class="hint">拖动橙色球改变平面走向 · 在下方纵断面图上拖动白色圆点调整坡度</div>
    </main>
    <footer class="profile">
      <ProfileView />
    </footer>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: #dde3ec;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 14px;
  background: #1d232e;
  border-bottom: 1px solid #2c3542;
  font-size: 13px;
  user-select: none;
}
.title {
  font-weight: 700;
  font-size: 15px;
  margin-right: 6px;
}
.toolbar label {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.toolbar button {
  background: #2b3546;
  color: #dde3ec;
  border: 1px solid #3a4658;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 13px;
  cursor: pointer;
}
.toolbar button:hover {
  background: #364258;
}
.sep {
  width: 1px;
  height: 18px;
  background: #3a4658;
}
.slider input[type='range'] {
  width: 100px;
}
.badge {
  margin-left: auto;
  background: #173a2b;
  color: #6fe3a5;
  border: 1px solid #2a5c44;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
}
.legend {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #aab4c4;
}
.legend i {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  margin-left: 6px;
}
.legend .fill {
  background: #ee8c29;
}
.legend .cut {
  background: #2999f2;
}
.msg {
  color: #ffd54a;
  font-size: 12px;
}
.view3d {
  flex: 1;
  position: relative;
  min-height: 0;
}
.view3d canvas {
  width: 100%;
  height: 100%;
  display: block;
  outline: none;
  touch-action: none;
}
.hint {
  position: absolute;
  left: 12px;
  bottom: 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(0, 0, 0, 0.35);
  padding: 4px 10px;
  border-radius: 4px;
  pointer-events: none;
}
.profile {
  height: 240px;
  border-top: 1px solid #2c3542;
  background: #14181f;
}
</style>
