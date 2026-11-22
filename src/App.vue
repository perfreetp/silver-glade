<template>
  <div class="app">
    <header>
      <h1>低空航路气象体积渲染</h1>
      <nav>
        <button
          v-for="m in modules"
          :key="m.key"
          :class="{ active: store.module === m.key }"
          @click="store.module = m.key"
        >{{ m.label }}</button>
      </nav>
      <div class="status">
        T+{{ String(store.frame).padStart(2, '0') }}h
        <span v-if="store.loading"> · 体数据加载 {{ Math.round(store.loadProgress * 100) }}%</span>
      </div>
    </header>
    <main>
      <RouteEditor v-show="store.module === 'route'" />
      <VolumeView v-show="store.module === 'volume'" />
      <ProfileAnalysis v-show="store.module === 'profile'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { store, type ModuleKey } from './store';
import RouteEditor from './components/RouteEditor.vue';
import VolumeView from './components/VolumeView.vue';
import ProfileAnalysis from './components/ProfileAnalysis.vue';

const modules: { key: ModuleKey; label: string }[] = [
  { key: 'route', label: '航路编辑' },
  { key: 'volume', label: '体积视图' },
  { key: 'profile', label: '剖面分析' },
];
</script>
