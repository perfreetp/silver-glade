<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { BabylonService } from "./engine/BabylonService";
import { bindService, store } from "./store";
import ModuleRoof from "./components/ModuleRoof.vue";
import ModuleDamage from "./components/ModuleDamage.vue";
import ModuleRender from "./components/ModuleRender.vue";
import ModuleGrade from "./components/ModuleGrade.vue";
import PerfHud from "./components/PerfHud.vue";

const canvas = ref<HTMLCanvasElement | null>(null);
let service: BabylonService | null = null;

onMounted(async () => {
  service = new BabylonService(canvas.value!);
  bindService(service);
  try {
    await service.init();
  } catch (e) {
    store.statusMessage = `引擎初始化失败：${(e as Error).message}`;
  }
});

onBeforeUnmount(() => {
  service?.dispose();
});
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <h1>古建屋面残损分布可视化工具</h1>
      <span
        class="engine-badge"
        :class="{ webgl: store.engineType === 'WebGL2' }"
      >
        {{ store.engineType || "引擎启动中" }}
      </span>
    </header>

    <div class="app-main">
      <aside class="sidebar">
        <ModuleRoof />
        <ModuleDamage />
        <ModuleRender />
        <ModuleGrade />
      </aside>

      <main class="viewport">
        <canvas ref="canvas"></canvas>
        <PerfHud />
        <div v-if="store.drawMode" class="draw-hint">
          按住左键在瓦面上勾勒残损轮廓，松开自动贴合生成面片
        </div>
      </main>
    </div>

    <footer class="status-bar">
      <span>{{ store.statusMessage }}</span>
    </footer>
  </div>
</template>
