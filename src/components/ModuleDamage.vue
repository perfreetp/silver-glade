<script setup lang="ts">
import { store, getService, setStatus } from "../store";

function toggleDraw() {
  const next = !store.drawMode;
  getService().setDrawMode(next);
  if (next) setStatus("绘制模式：在屋面上按住左键勾勒残损区域轮廓，松开即生成面片");
}

function stress(n: number) {
  getService().generateStressPatches(n);
}

function deleteSelected() {
  getService().deleteSelected();
}

function clearAll() {
  if (store.patches.length === 0) return;
  if (confirm(`确认清空全部 ${store.patches.length} 个残损面片？`)) {
    getService().clearAll();
    setStatus("已清空残损面片");
  }
}
</script>

<template>
  <details class="module-card" open>
    <summary><span class="step">2</span>残损面片贴合</summary>
    <div class="card-body">
      <div class="btn-row">
        <button :class="{ active: store.drawMode }" @click="toggleDraw">
          {{ store.drawMode ? "退出绘制" : "进入绘制" }}
        </button>
        <button class="ghost" :disabled="store.selectedPatchId == null" @click="deleteSelected">
          删除选中
        </button>
        <button class="danger" :disabled="store.patches.length === 0" @click="clearAll">
          全部清空
        </button>
      </div>

      <label class="field">
        <span class="field-line">
          <span>新面片默认严重度</span>
          <span>{{ store.defaultSeverity.toFixed(2) }}</span>
        </span>
        <input type="range" min="0.05" max="1" step="0.01" v-model.number="store.defaultSeverity" />
      </label>

      <label class="field">
        <span class="field-line">
          <span>法线抬升量（防共面闪烁，米）</span>
          <span>{{ store.lift.toFixed(3) }}</span>
        </span>
        <input
          type="range"
          min="0"
          max="0.3"
          step="0.005"
          v-model.number="store.lift"
          @change="getService().applyLift()"
        />
      </label>

      <div class="section-title">性能压力测试</div>
      <div class="btn-row">
        <button class="ghost" @click="stress(200)">+200 面片</button>
        <button class="ghost" @click="stress(1000)">+1000 面片</button>
      </div>
      <div class="muted">
        轮廓边按 0.35m 步长细分投影，内部三角形递归中点细分贴合屋面曲率，
        沿平滑法线整体抬升。
      </div>
    </div>
  </details>
</template>
