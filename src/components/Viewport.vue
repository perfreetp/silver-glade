<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ThermalEngine, type RenderStats } from "../engine/thermalEngine";
import { buildRoomLayout } from "../model/layout";
import { ui, racks, setError, setStats, persistPrefs } from "../state/store";
import type { PaletteId } from "../engine/palette";

const canvasEl = ref<HTMLCanvasElement | null>(null);
const initError = ref<string>("");
let engine: ThermalEngine | null = null;

const emit = defineEmits<{
  (e: "ready"): void;
}>();

onMounted(async () => {
  if (!canvasEl.value) return;

  // 先探测 WebGPU：不支持的浏览器直接给出明确提示，而不是卡在启动画面
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) {
    initError.value = "当前浏览器不支持 WebGPU。请使用 Chrome / Edge 113 或更新版本，并确认已开启硬件加速。";
    setError(initError.value);
    return;
  }
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      initError.value = "未找到可用的 GPU 适配器。请检查显卡驱动，或确认浏览器已启用 WebGPU。";
      setError(initError.value);
      return;
    }
  } catch (e) {
    initError.value = `GPU 适配器请求失败：${(e as Error).message ?? e}`;
    setError(initError.value);
    return;
  }

  const eng = new ThermalEngine(canvasEl.value, {
    onStats: (s: RenderStats) => setStats(s),
    onSelect: (idx) => {
      ui.selectedRack = idx;
    },
    onReady: () => {
      ui.engineReady = true;
      // 便于自动化测试与本地调试：把引擎挂到 window
      (window as unknown as { __thermalEngine?: unknown }).__thermalEngine = eng;
      emit("ready");
    },
    onError: (m) => setError(m),
  });

  try {
    await eng.init();
    engine = eng;
    ui.engineReady = true;
    applyPrefs();
    await reloadScene();
  } catch (e) {
    initError.value = `WebGPU 初始化失败：${(e as Error).message ?? e}`;
    setError(initError.value);
  }
});

onBeforeUnmount(() => {
  engine?.dispose();
  engine = null;
});

async function reloadScene(): Promise<void> {
  if (!engine || !engine.isReady) return;
  const layout = buildRoomLayout(racks.value, ui.roomConfig);
  await engine.setLayout(layout);
  applyPrefs();
}

function applyPrefs(): void {
  if (!engine) return;
  engine.setThreshold(ui.prefs.threshold);
  engine.setOpacity(ui.prefs.opacity);
  engine.setPalette(ui.prefs.palette as PaletteId);
  engine.setShowIso(ui.prefs.showIso);
  engine.setShowHeatmap(ui.prefs.showHeatmap);
}

// 机柜数据变化时重建场景
watch(
  () => racks.value,
  () => {
    void reloadScene();
  }
);

watch(
  () => ui.prefs.threshold,
  (v) => {
    engine?.setThreshold(v);
    persistPrefs();
  }
);

watch(
  () => ui.prefs.opacity,
  (v) => {
    engine?.setOpacity(v);
    persistPrefs();
  }
);

watch(
  () => ui.prefs.palette,
  (v) => {
    engine?.setPalette(v as PaletteId);
    persistPrefs();
  }
);

watch(
  () => ui.prefs.showIso,
  (v) => {
    engine?.setShowIso(v);
    persistPrefs();
  }
);

watch(
  () => ui.prefs.showHeatmap,
  (v) => {
    engine?.setShowHeatmap(v);
    persistPrefs();
  }
);

watch(
  () => ui.selectedRack,
  (idx) => {
    if (engine && engine.getSelectedRack() !== idx) {
      engine.setSelectedRack(idx);
    }
  }
);

defineExpose({
  getEngine: () => engine,
  reloadScene,
  resetCamera: () => engine?.resetCamera(),
  cameraPreset: (p: "iso" | "front" | "top") => engine?.setCameraPreset(p),
  capturePreview: () => {
    if (!engine || !canvasEl.value) return null;
    try {
      return canvasEl.value.toDataURL("image/png");
    } catch {
      return null;
    }
  },
});
</script>

<template>
  <div class="viewport">
    <canvas ref="canvasEl" class="viewport__canvas" />

    <div v-if="!ui.engineReady" class="viewport__boot">
      <template v-if="initError">
        <div class="boot-error">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.4">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v6M12 16.5v.5" stroke-linecap="round" />
          </svg>
          <p>{{ initError }}</p>
          <p class="boot-hint">WebGPU 是运行本工具的必要条件；它需要较新的浏览器与可用的独立/集成显卡。</p>
        </div>
      </template>
      <template v-else>
        <div class="boot-spinner" />
        <div class="boot-text">正在初始化 WebGPU…</div>
      </template>
    </div>

    <div class="viewport__hud">
      <div class="hud-item">
        <span class="hud-label">FPS</span>
        <span class="hud-value mono" :class="{ low: ui.stats.fps > 0 && ui.stats.fps < 30 }">
          {{ ui.stats.isoReady ? ui.stats.fps.toFixed(0) : "—" }}
        </span>
      </div>
      <div class="hud-item">
        <span class="hud-label">等值面顶点</span>
        <span class="hud-value mono">{{ ui.stats.isoVerts.toLocaleString() }}</span>
      </div>
      <div class="hud-item">
        <span class="hud-label">重建耗时</span>
        <span class="hud-value mono">{{ ui.stats.lastIsoMs.toFixed(1) }} ms</span>
      </div>
      <div class="hud-item">
        <span class="hud-label">体素</span>
        <span class="hud-value mono">{{ (ui.stats.voxels / 1000).toFixed(0) }}k</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.viewport {
  position: relative;
  width: 100%;
  height: 100%;
  background: #06080b;
  overflow: hidden;
}

.viewport__canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
  touch-action: none;
}

.viewport__boot {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: rgba(6, 8, 11, 0.86);
  pointer-events: none;
}

.boot-spinner {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2.5px solid #1e2a38;
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.boot-text {
  color: var(--fg-2);
  font-size: 12px;
  letter-spacing: 0.05em;
}

.boot-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 440px;
  padding: 0 22px;
  text-align: center;
  color: var(--danger);
}

.boot-error p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
}

.boot-error .boot-hint {
  color: var(--fg-2);
  font-size: 11px;
}

.viewport__hud {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  gap: 2px;
  padding: 7px 4px;
  border-radius: 7px;
  background: rgba(10, 14, 20, 0.78);
  border: 1px solid var(--line-soft);
  backdrop-filter: blur(8px);
  pointer-events: none;
}

.hud-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 11px;
  border-right: 1px solid var(--line-soft);
}
.hud-item:last-child {
  border-right: none;
}

.hud-label {
  font-size: 9.5px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--fg-2);
}

.hud-value {
  font-size: 12.5px;
  color: var(--fg-0);
  font-weight: 600;
}
.hud-value.low {
  color: var(--warn);
}
</style>
