<script setup lang="ts">
import { ref } from "vue";
import { store, getService, setStatus } from "../store";

const roofInput = ref<HTMLInputElement | null>(null);

function onRoofFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  getService()
    .importRoof(file)
    .catch((err: Error) => setStatus(`导入失败：${err.message}`));
  input.value = "";
}

function fmt(n: number, digits = 1): string {
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
</script>

<template>
  <details class="module-card" open>
    <summary><span class="step">1</span>屋面网格加载</summary>
    <div class="card-body">
      <div class="btn-row">
        <button @click="getService().loadProceduralRoof()">程序化屋面</button>
        <label class="file-btn" for="roof-file">导入模型</label>
        <input
          id="roof-file"
          ref="roofInput"
          type="file"
          accept=".glb,.gltf,.obj,.stl"
          @change="onRoofFile"
        />
      </div>
      <div class="muted">
        支持 GLB / glTF / OBJ / STL；导入后自动归一化到 20m
        尺度并构建 XZ 投影加速网格。当前屋面：{{ store.roofName }}
      </div>

      <div v-if="store.roofStats" class="kv-list">
        <span class="k">三角面数</span>
        <span class="v">{{ store.roofStats.triangleCount.toLocaleString() }}</span>
        <span class="k">顶点数</span>
        <span class="v">{{ store.roofStats.vertexCount.toLocaleString() }}</span>
        <span class="k">平均坡度</span>
        <span class="v">{{ fmt(store.roofStats.avgSlopeDeg) }}°</span>
        <span class="k">最大坡度</span>
        <span class="v">{{ fmt(store.roofStats.maxSlopeDeg) }}°</span>
      </div>

      <div v-if="store.roofStats" class="section-title">网格包围盒（米）</div>
      <div v-if="store.roofStats" class="kv-list">
        <span class="k">min</span>
        <span class="v">
          {{ fmt(store.roofStats.min[0]) }},
          {{ fmt(store.roofStats.min[1]) }},
          {{ fmt(store.roofStats.min[2]) }}
        </span>
        <span class="k">max</span>
        <span class="v">
          {{ fmt(store.roofStats.max[0]) }},
          {{ fmt(store.roofStats.max[1]) }},
          {{ fmt(store.roofStats.max[2]) }}
        </span>
        <span class="k">尺寸</span>
        <span class="v">
          {{ fmt(store.roofStats.size[0]) }} ×
          {{ fmt(store.roofStats.size[1]) }} ×
          {{ fmt(store.roofStats.size[2]) }}
        </span>
      </div>

      <label class="check-row">
        <input
          type="checkbox"
          v-model="store.refLinesVisible"
          @change="getService().applyRefLines()"
        />
        显示参考线（垄向 / 坡度）
      </label>
    </div>
  </details>
</template>
