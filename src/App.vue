<template>
  <div class="layout">
    <ControlPanel />
    <div ref="wrap" class="viewport">
      <canvas ref="canvasEl"></canvas>
      <div class="hint">左键拖动旋转 · 滚轮缩放 · 拖动喷头/手柄调整参数</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import ControlPanel from './components/ControlPanel.vue';
import { SceneManager } from './three/SceneManager';
import { managerRef } from './three/managerRef';

const wrap = ref<HTMLDivElement>();
const canvasEl = ref<HTMLCanvasElement>();
let manager: SceneManager | null = null;
let ro: ResizeObserver | null = null;

onMounted(() => {
  manager = new SceneManager(canvasEl.value!);
  managerRef.current = manager;
  const el = wrap.value!;
  manager.setSize(el.clientWidth, el.clientHeight);
  ro = new ResizeObserver(() => {
    manager?.setSize(el.clientWidth, el.clientHeight);
  });
  ro.observe(el);
});

onBeforeUnmount(() => {
  ro?.disconnect();
  manager?.dispose();
  managerRef.current = null;
});
</script>
