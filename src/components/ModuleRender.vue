<script setup lang="ts">
import { store, getService, gradeDistribution } from "../store";
import { GRADE_META } from "../types";
</script>

<template>
  <details class="module-card" open>
    <summary><span class="step">3</span>分层渲染</summary>
    <div class="card-body">
      <label class="field">
        <span class="field-line">
          <span>残损面片不透明度</span>
          <span>{{ store.opacity.toFixed(2) }}</span>
        </span>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.01"
          v-model.number="store.opacity"
          @input="getService().applyOpacity()"
        />
      </label>

      <label class="check-row">
        <input
          type="checkbox"
          v-model="store.depthPrePass"
          @change="getService().applyDepthPrePass()"
        />
        深度预通道（消除穿插面片半透明排序错误）
      </label>
      <label class="check-row">
        <input
          type="checkbox"
          v-model="store.doubleSided"
          @change="getService().applyDoubleSided()"
        />
        双面渲染（任意视角不被错误遮挡）
      </label>
      <label class="check-row">
        <input
          type="checkbox"
          v-model="store.wireframe"
          @change="getService().applyWireframe()"
        />
        线框模式
      </label>

      <div class="section-title">等级分档着色</div>
      <div
        v-for="g in GRADE_META"
        :key="g.grade"
        class="grade-row"
      >
        <span class="grade-dot" :style="{ background: g.css }"></span>
        <span>{{ g.grade }} 级 · {{ g.name }}</span>
        <span class="grow"></span>
        <span class="num">{{ gradeDistribution[g.grade - 1].count }} 片</span>
      </div>
      <div class="muted">
        所有面片合并为单个 Mesh，顶点色分档，绘制调用恒为 1 次；
        抬升面片对屋面做深度测试，任意视角均不会被瓦面错误遮挡。
      </div>
    </div>
  </details>
</template>
