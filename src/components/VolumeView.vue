<template>
  <div class="volume-view">
    <div ref="host" class="canvas-host"></div>

    <div class="panel">
      <h3>体积视图</h3>
      <div class="row">
        <span class="lbl">密度阈值</span>
        <label v-for="(name, i) in ['低 · 通透', '中', '高 · 浓稠']" :key="i" class="radio">
          <input type="radio" :value="i" v-model.number="store.threshold" /> {{ name }}
        </label>
      </div>
      <div class="row">
        <label><input type="checkbox" v-model="store.showTerrain" /> 地形底图</label>
        <label><input type="checkbox" v-model="store.showRoute" /> 航路高亮</label>
      </div>
      <div class="row">
        <label><input type="checkbox" v-model="store.fogEnabled" /> 体积雾(后处理)</label>
        <label><input type="checkbox" v-model="store.colorMapEnabled" /> 色彩映射(后处理)</label>
      </div>
      <div class="info" v-if="store.cloudBase">
        航路云底高度:最低 {{ (store.cloudBase.min * 1000).toFixed(0) }} m · 平均
        {{ (store.cloudBase.mean * 1000).toFixed(0) }} m
      </div>
      <div class="info" v-else>航路上空当前阈值下无云</div>
      <div class="info dim" v-if="store.loading">体数据加载中 {{ Math.round(store.loadProgress * 100) }}%(分块缓存至浏览器存储)</div>
    </div>

    <div class="timeline">
      <button class="play" @click="togglePlay">{{ store.playing ? '⏸ 暂停' : '▶ 播放' }}</button>
      <input type="range" min="0" max="23" step="1" v-model.number="store.frame" />
      <span class="tlabel">T+{{ String(store.frame).padStart(2, '0') }}h({{ store.frame + 1 }}/24)</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue';
import { store } from '../store';
import { SceneManager } from '../three/SceneManager';
import { getFrameData, prefetchFrame } from '../data/frameStore';
import { FRAMES } from '../data/weatherSim';
import { routeCloudBase } from '../analysis/profile';

const host = ref<HTMLElement | null>(null);
let scene: SceneManager | null = null;
let playTimer: number | null = null;
let loadSeq = 0;

async function loadFrame(): Promise<void> {
  const seq = ++loadSeq;
  const frame = store.frame;
  store.loading = true;
  store.loadProgress = 0;
  try {
    const data = await getFrameData(frame, (p) => {
      if (seq === loadSeq) store.loadProgress = p;
    });
    if (seq !== loadSeq) return; // 期间又切了帧
    scene?.setVolumeData(data);
    store.cloudBase = routeCloudBase(data, store.route.points, store.thresholds[store.threshold]);
  } finally {
    if (seq === loadSeq) store.loading = false;
  }
  // 预取下一帧
  prefetchFrame((frame + 1) % FRAMES);
}

function togglePlay(): void {
  store.playing = !store.playing;
}

onMounted(() => {
  scene = new SceneManager(host.value!);
  scene.setThreshold(store.thresholds[store.threshold]);
  scene.updateRoute(store.route.points, store.route.bandMin, store.route.bandMax);

  watch(() => store.frame, () => void loadFrame(), { immediate: true });
  watch(() => store.threshold, (v) => {
    scene?.setThreshold(store.thresholds[v]);
    void loadFrame(); // 阈值变化重新统计云底
  });
  watch(() => store.showTerrain, (v) => scene?.setTerrainVisible(v));
  watch(() => store.showRoute, (v) => scene?.setRouteVisible(v));
  watch(() => store.fogEnabled, (v) => scene?.setFogEnabled(v));
  watch(() => store.colorMapEnabled, (v) => scene?.setColorMapEnabled(v));
  watch(
    () => store.route,
    (r) => {
      scene?.updateRoute(r.points, r.bandMin, r.bandMax);
      void loadFrame();
    },
    { deep: true },
  );
  watch(
    () => store.module,
    async (m) => {
      if (m === 'volume') {
        await nextTick();
        scene?.resize();
      }
    },
  );
  watch(
    () => store.playing,
    (playing) => {
      if (playing) {
        playTimer = window.setInterval(() => {
          store.frame = (store.frame + 1) % FRAMES;
        }, 600);
      } else if (playTimer !== null) {
        clearInterval(playTimer);
        playTimer = null;
      }
    },
  );
});

onBeforeUnmount(() => {
  if (playTimer !== null) clearInterval(playTimer);
  scene?.dispose();
  scene = null;
});
</script>
