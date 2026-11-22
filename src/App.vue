<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Viewport from "./components/Viewport.vue";
import ImportPanel from "./components/ImportPanel.vue";
import IsoPanel from "./components/IsoPanel.vue";
import HeatmapPanel from "./components/HeatmapPanel.vue";
import ExportPanel from "./components/ExportPanel.vue";
import { ui, racks } from "./state/store";
import { generateDemoCsv } from "./io/demoData";
import { parseThermalData } from "./io/parseThermalData";
import { buildRoomLayout } from "./model/layout";

const viewport = ref<InstanceType<typeof Viewport> | null>(null);

const tabs = [
  { id: "import", label: "温度采样导入", hint: "①" },
  { id: "iso", label: "等值面视图", hint: "②" },
  { id: "heatmap", label: "热力面板", hint: "③" },
  { id: "export", label: "导出", hint: "④" },
] as const;

const getEngine = () => viewport.value?.getEngine() ?? null;

const hasData = computed(() => racks.value.length > 0);

onMounted(async () => {
  // 首次进入若还没有数据，自动载入示例，避免空场景
  if (racks.value.length === 0) {
    const csv = generateDemoCsv({ rows: 3, cols: 8 });
    const parsed = parseThermalData(csv);
    if (parsed.racks.length > 0) {
      racks.value = parsed.racks;
      ui.summary = {
        filename: "示例机房（3 排 × 8 列）",
        format: parsed.format,
        rackCount: parsed.racks.length,
        sampleCount: parsed.sampleCount,
        issueCount: parsed.issues.length,
      };
      ui.issues = parsed.issues;
    }
  }
});

function switchTab(id: (typeof tabs)[number]["id"]): void {
  ui.activeTab = id;
}

function onLoaded(): void {
  ui.activeTab = "iso";
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <div class="brand__mark">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="3" y="3" width="18" height="18" rx="2.5" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" opacity="0.45" />
          </svg>
        </div>
        <div class="brand__text">
          <span class="brand__title">机柜热力分析</span>
          <span class="brand__sub">WebGPU · 等值面重建</span>
        </div>
      </div>

      <nav class="tabs">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="tab"
          :class="{ active: ui.activeTab === t.id }"
          @click="switchTab(t.id)"
        >
          <span class="tab__hint">{{ t.hint }}</span>
          {{ t.label }}
        </button>
      </nav>

      <div class="topbar__right">
        <span v-if="hasData" class="chip ok">{{ racks.length }} 柜</span>
        <span class="chip" :class="ui.stats.fps < 30 && ui.stats.isoReady ? 'warn' : ''">
          <span class="dot" :class="{ live: ui.engineReady }" />
          {{ ui.engineReady ? (ui.stats.isoReady ? ui.stats.fps.toFixed(0) + ' fps' : '就绪') : '初始化' }}
        </span>
        <button class="btn sm ghost" title="重置视角" @click="viewport?.resetCamera()">重置视角</button>
      </div>
    </header>

    <main class="main">
      <aside class="sidebar">
        <Transition name="fade" mode="out-in">
          <ImportPanel v-if="ui.activeTab === 'import'" key="import" @loaded="onLoaded" />
          <IsoPanel v-else-if="ui.activeTab === 'iso'" key="iso" />
          <HeatmapPanel v-else-if="ui.activeTab === 'heatmap'" key="heatmap" :get-engine="getEngine" />
          <ExportPanel
            v-else
            key="export"
            :get-engine="getEngine"
            :capture-preview="() => viewport?.capturePreview() ?? null"
          />
        </Transition>
      </aside>

      <section class="stage">
        <Viewport ref="viewport" @ready="() => {}" />
        <div class="stage__tools">
          <button class="tool" title="等轴视角" @click="viewport?.cameraPreset('iso')">等轴</button>
          <button class="tool" title="正视角" @click="viewport?.cameraPreset('front')">正视</button>
          <button class="tool" title="俯视角" @click="viewport?.cameraPreset('top')">俯视</button>
        </div>
      </section>
    </main>

    <Transition name="toast">
      <div v-if="ui.error" class="toast">{{ ui.error }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-0);
}

.topbar {
  display: flex;
  align-items: center;
  gap: 18px;
  height: 50px;
  padding: 0 14px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 172px;
}

.brand__mark {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: linear-gradient(150deg, #0e7490, #075985);
  color: #d8f4ff;
  flex-shrink: 0;
}

.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.brand__title {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.brand__sub {
  font-size: 9.5px;
  color: var(--fg-2);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.tabs {
  display: flex;
  gap: 2px;
  flex: 1;
}

.tab {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 13px;
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--fg-1);
  white-space: nowrap;
  transition: background 0.14s, color 0.14s;
}
.tab:hover {
  background: var(--bg-2);
  color: var(--fg-0);
}
.tab.active {
  background: var(--bg-3);
  color: var(--fg-0);
  font-weight: 550;
}

.tab__hint {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--bg-0);
  font-size: 9.5px;
  color: var(--fg-2);
  font-weight: 600;
}
.tab.active .tab__hint {
  background: #0b4a63;
  color: #9fe6ff;
}

.topbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fg-2);
  flex-shrink: 0;
}
.dot.live {
  background: var(--ok);
  box-shadow: 0 0 6px rgba(52, 211, 153, 0.6);
}

.main {
  display: flex;
  flex: 1;
  min-height: 0;
}

.sidebar {
  width: 336px;
  flex-shrink: 0;
  background: var(--bg-1);
  border-right: 1px solid var(--line);
  min-height: 0;
}

.stage {
  position: relative;
  flex: 1;
  min-width: 0;
}

.stage__tools {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 7px;
  background: rgba(10, 14, 20, 0.8);
  border: 1px solid var(--line-soft);
  backdrop-filter: blur(8px);
}

.tool {
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 11.5px;
  color: var(--fg-1);
  transition: background 0.13s, color 0.13s;
}
.tool:hover {
  background: var(--bg-3);
  color: var(--fg-0);
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  max-width: min(560px, 86vw);
  padding: 10px 16px;
  border-radius: 7px;
  background: #2a1616;
  border: 1px solid #5d2b2b;
  color: #fecaca;
  font-size: 12px;
  line-height: 1.5;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.5);
  z-index: 50;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.13s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (max-width: 900px) {
  .main {
    flex-direction: column;
  }
  .sidebar {
    width: 100%;
    height: 45%;
    border-right: none;
    border-top: 1px solid var(--line);
    order: 2;
  }
  .stage {
    order: 1;
  }
}
</style>
