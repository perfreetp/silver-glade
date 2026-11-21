<template>
  <aside class="panel">
    <h1>喷雾覆盖监控</h1>

    <section>
      <label class="row-between">
        <span>喷头数量</span><b>{{ store.nozzles.length }}</b>
      </label>
      <input
        type="range" min="4" max="12" step="1"
        :value="store.nozzles.length"
        @input="onCount"
      />
    </section>

    <section class="btn-row">
      <button :class="{ on: store.view === 'top' }" @click="store.view = 'top'">顶视</button>
      <button :class="{ on: store.view === 'side' }" @click="store.view = 'side'">侧视</button>
    </section>

    <section>
      <label class="check">
        <input type="checkbox" v-model="store.showOcclusion" />
        遮挡检查（被菇架挡住的区域变灰）
      </label>
    </section>

    <section>
      <label class="row-between">
        <span>饱和阈值</span><b>{{ store.threshold.toFixed(2) }}</b>
      </label>
      <input type="range" min="0.4" max="3" step="0.05" v-model.number="store.threshold" />
    </section>

    <section class="global-stats">
      <div>地面覆盖率 <b>{{ (store.coverage * 100).toFixed(1) }}%</b></div>
      <div>过饱和栅格 <b>{{ store.saturated }}</b></div>
    </section>

    <section class="list">
      <div
        v-for="n in store.nozzles"
        :key="n.id"
        class="nozzle"
        :class="{ sel: store.selectedId === n.id }"
        @click="select(n.id)"
      >
        <span class="dot" :style="{ background: colorHex(n.color) }"></span>
        <span class="name">{{ n.name }}</span>
        <span class="meta">R {{ (store.stats[n.id]?.radius ?? 0).toFixed(1) }}m</span>
        <span class="meta">重叠 {{ store.stats[n.id]?.overlapCount ?? 0 }}</span>
        <input
          class="toggle"
          type="checkbox"
          :checked="n.on"
          title="启用/停用"
          @click.stop
          @change="toggle(n)"
        />
      </div>
    </section>

    <button class="export" @click="doExport">导出参数与湿度栅格</button>

    <p class="tip">
      拖动喷头本体移动位置；白色手柄改喷射方向；黄色手柄改张角。
      点选列表或喷头可聚焦（其余降为线框）；侧视可见雾锥与各层菇架的交线。
    </p>
  </aside>
</template>

<script setup lang="ts">
import { store, setNozzleCount } from '../core/store';
import type { NozzleSpec } from '../core/types';
import { managerRef } from '../three/managerRef';

function onCount(e: Event) {
  setNozzleCount(Number((e.target as HTMLInputElement).value));
}

function select(id: number) {
  store.selectedId = store.selectedId === id ? -1 : id;
}

function toggle(n: NozzleSpec) {
  n.on = !n.on;
  managerRef.current?.updateNozzle(n.id);
}

function colorHex(c: number) {
  return '#' + c.toString(16).padStart(6, '0');
}

function doExport() {
  managerRef.current?.exportJSON();
}
</script>
