<script setup lang="ts">
import { computed, ref } from "vue";
import { ui, racks, setError } from "../state/store";
import {
  buildZip,
  exportFilename,
  triggerDownload,
  type ExportInput,
} from "../io/exportBundle";
import { FACE_COLS, FACE_ROWS } from "../model/types";

const props = defineProps<{
  getEngine: () => any;
  capturePreview: () => string | null;
}>();

const includePreview = ref(true);
const exportState = ref<"idle" | "working" | "done">("idle");
const lastSize = ref(0);

const isoVerts = computed(() => ui.stats.isoVerts);
const isoValid = computed(() => isoVerts.value > 0);
const rackCount = computed(() => racks.value.length);

async function doExport(): Promise<void> {
  const engine = props.getEngine();
  if (!engine) {
    setError("渲染引擎尚未就绪。");
    return;
  }
  if (!isoValid.value) {
    setError("当前阈值的等值面为空，先把阈值调低一些再导出。");
    return;
  }
  exportState.value = "working";
  ui.busy = "导出中";
  try {
    const layout = engine.getLayout();
    if (!layout) throw new Error("没有可导出的机房布局");

    const isoData: Float32Array = await engine.readIsoVertices();
    const field = await engine.readField();
    if (isoData.length === 0) throw new Error("等值面顶点读取为空");

    const preview = includePreview.value ? props.capturePreview() : null;
    const cam = engine.getCameraState?.() ?? undefined;
    // 以引擎内实际生效的阈值为准（UI 可能刚调整还未同步）
    const effectiveThreshold = engine.getThreshold?.() ?? ui.prefs.threshold;

    const input: ExportInput = {
      layout,
      grid: engine.getFieldGrid(),
      threshold: effectiveThreshold,
      isoVerts: isoData,
      field,
      palette: ui.prefs.palette,
      preview,
      camera: cam,
    };

    const zipData = await buildZip(input);
    const name = exportFilename();
    triggerDownload(zipData, name);
    lastSize.value = zipData.byteLength;
    ui.exportLog.unshift({ at: Date.now(), file: name, bytes: zipData.byteLength });
    if (ui.exportLog.length > 6) ui.exportLog.pop();
    exportState.value = "done";
    window.setTimeout(() => (exportState.value = "idle"), 2600);
  } catch (e) {
    setError(`导出失败：${(e as Error).message ?? e}`);
    exportState.value = "idle";
  } finally {
    ui.busy = "";
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
</script>

<template>
  <div class="panel">
    <section class="block">
      <div class="block-head"><h2>导出结果</h2></div>
      <p class="hint">
        把等值面网格、三维温度场与机柜几何打包成一个 zip 文件保存到本地。
        全部在浏览器内生成，不上传任何数据。
      </p>

      <dl class="facts">
        <div><dt>机柜</dt><dd class="mono">{{ rackCount }}</dd></div>
        <div><dt>等值面顶点</dt><dd class="mono">{{ isoVerts.toLocaleString() }}</dd></div>
        <div><dt>三角形</dt><dd class="mono">{{ Math.floor(isoVerts / 3).toLocaleString() }}</dd></div>
        <div><dt>阈值</dt><dd class="mono">{{ ui.prefs.threshold.toFixed(1) }}℃</dd></div>
      </dl>

      <label class="check">
        <input v-model="includePreview" type="checkbox" />
        <span class="check__box" />
        <span>包含当前视图截图 preview.png</span>
      </label>

      <button
        class="btn primary export-btn"
        :disabled="!isoValid || exportState === 'working' || !!ui.busy"
        @click="doExport"
      >
        <svg v-if="exportState !== 'working'" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M12 4v12m0 0l-4.5-4.5M12 16l4.5-4.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M4 18v1a2 2 0 002 2h12a2 2 0 002-2v-1" stroke-linecap="round" />
        </svg>
        <span>{{ exportState === "working" ? "打包中…" : exportState === "done" ? "已下载" : "打包并下载 .zip" }}</span>
      </button>

      <div v-if="lastSize > 0" class="done-note">
        最近一次导出 {{ fmtBytes(lastSize) }}
      </div>
      <div v-else-if="!isoValid" class="cap-warn">
        当前阈值下没有等值面可导出。
      </div>
    </section>

    <section class="block">
      <div class="block-head"><h2>包内文件</h2></div>
      <ul class="files">
        <li>
          <span class="files__name mono">isosurface.obj</span>
          <span class="files__desc">等值面网格，顶点温度写在 v 的第 4 分量</span>
        </li>
        <li>
          <span class="files__name mono">isosurface.ply</span>
          <span class="files__desc">二进制 PLY，含 temperature 属性，可拖进 MeshLab</span>
        </li>
        <li>
          <span class="files__name mono">field.bin</span>
          <span class="files__desc">三维温度场 Float32 原始数据</span>
        </li>
        <li>
          <span class="files__name mono">field.json</span>
          <span class="files__desc">标量场的维度、原点、体素尺寸与索引顺序</span>
        </li>
        <li>
          <span class="files__name mono">racks.json</span>
          <span class="files__desc">机柜几何、朝向与每面 {{ FACE_COLS }}×{{ FACE_ROWS }} 采样温度</span>
        </li>
        <li>
          <span class="files__name mono">manifest.json</span>
          <span class="files__desc">元数据、阈值、坐标系与文件清单</span>
        </li>
        <li>
          <span class="files__name mono">preview.png</span>
          <span class="files__desc">当前视角截图（可选）</span>
        </li>
      </ul>
    </section>

    <section v-if="ui.exportLog.length" class="block">
      <div class="block-head"><h2>本次会话导出记录</h2></div>
      <ul class="log">
        <li v-for="rec in ui.exportLog" :key="rec.at">
          <span class="mono">{{ fmtTime(rec.at) }}</span>
          <span class="ellipsis">{{ rec.file }}</span>
          <span class="mono dim">{{ fmtBytes(rec.bytes) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  overflow-y: auto;
  height: 100%;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-1);
}

.hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--fg-2);
}

.facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  margin: 0;
}
.facts > div {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--line-soft);
}
.facts dt {
  font-size: 11.5px;
  color: var(--fg-2);
}
.facts dd {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--fg-1);
  cursor: pointer;
  user-select: none;
}
.check input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.check__box {
  width: 15px;
  height: 15px;
  border-radius: 3px;
  border: 1px solid var(--line);
  background: var(--bg-0);
  position: relative;
}
.check input:checked + .check__box {
  background: var(--accent-dim);
  border-color: var(--accent);
}
.check input:checked + .check__box::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid #eafaff;
  border-width: 0 1.8px 1.8px 0;
  transform: rotate(45deg);
}

.export-btn {
  padding: 11px 16px;
  font-size: 13px;
  font-weight: 600;
}

.done-note {
  font-size: 11px;
  color: var(--ok);
}

.cap-warn {
  padding: 7px 9px;
  border-radius: 4px;
  background: #1f1810;
  border: 1px solid #4a3712;
  color: var(--warn);
  font-size: 11px;
}

.files {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.files li {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--line-soft);
}
.files li:last-child {
  border-bottom: none;
}
.files__name {
  font-size: 11.5px;
  color: var(--accent);
  font-weight: 500;
}
.files__desc {
  font-size: 10.5px;
  color: var(--fg-2);
  line-height: 1.45;
}

.log {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
}
.log li {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  color: var(--fg-1);
  padding: 3px 0;
}
.log .dim {
  color: var(--fg-2);
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
