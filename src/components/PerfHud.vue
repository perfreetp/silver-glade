<script setup lang="ts">
import { store } from "../store";
</script>

<template>
  <div class="hud">
    <h3>实时读数</h3>
    <div class="hud-row">
      <span>残损面片数</span>
      <span class="v">{{ store.perf.patchCount.toLocaleString() }}</span>
    </div>
    <div class="hud-row">
      <span>图层三角面数</span>
      <span class="v">{{ store.perf.layerTriangles.toLocaleString() }}</span>
    </div>
    <div class="hud-row">
      <span>绘制（重建）耗时</span>
      <span class="v">{{ store.perf.rebuildMs.toFixed(2) }} ms</span>
    </div>
    <div class="hud-row">
      <span>投影贴合耗时</span>
      <span class="v">{{ store.perf.projectMs.toFixed(2) }} ms</span>
    </div>
    <div class="hud-row">
      <span>帧耗时 / FPS</span>
      <span class="v">
        {{ store.perf.frameMs.toFixed(2) }} ms /
        {{ store.perf.fps.toFixed(0) }}
      </span>
    </div>
    <div class="hud-row">
      <span>绘制调用</span>
      <span class="v">{{ store.perf.drawCalls }}</span>
    </div>
  </div>
</template>
