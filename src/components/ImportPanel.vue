<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { parseThermalData } from "../io/parseThermalData";
import { generateDemoCsv } from "../io/demoData";
import { racks, ui, setError } from "../state/store";
import { deleteImport, listImports, saveImport, type StoredImport } from "../state/persistence";
import { FACE_COLS, FACE_ROWS, MAX_RACKS } from "../model/types";

const dragActive = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const textInput = ref("");
const stored = ref<StoredImport[]>([]);
const lastFormat = ref("");

const emit = defineEmits<{
  (e: "loaded"): void;
}>();

onMounted(refreshStored);

async function refreshStored(): Promise<void> {
  try {
    stored.value = await listImports();
  } catch {
    stored.value = [];
  }
}

function pickFile(): void {
  fileInput.value?.click();
}

function onFileChange(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void ingestFile(file);
  input.value = "";
}

function onDrop(ev: DragEvent): void {
  dragActive.value = false;
  const file = ev.dataTransfer?.files?.[0];
  if (file) void ingestFile(file);
}

async function ingestFile(file: File): Promise<void> {
  if (file.size > 24 * 1024 * 1024) {
    setError("文件超过 24 MB，请拆分后再导入。");
    return;
  }
  const text = await file.text();
  await applyText(text, file.name);
}

async function applyText(text: string, name: string): Promise<void> {
  const result = parseThermalData(text);

  if (result.racks.length === 0) {
    ui.issues = result.issues;
    ui.summary = null;
    setError(result.issues.find((i) => i.severity === "error")?.message ?? "未能解析出机柜数据。");
    return;
  }

  racks.value = result.racks;
  ui.issues = result.issues;
  lastFormat.value = result.format;
  const errors = result.issues.filter((i) => i.severity === "error").length;
  ui.summary = {
    filename: name,
    format: result.format,
    rackCount: result.racks.length,
    sampleCount: result.sampleCount,
    issueCount: result.issues.length,
  };
  if (errors === 0 && result.issues.length > 0) {
    ui.error = "";
  }

  try {
    await saveImport({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      text,
      importedAt: Date.now(),
      rackCount: result.racks.length,
      format: result.format,
    });
    await refreshStored();
  } catch {
    // 存储失败不影响当前会话
  }

  emit("loaded");
}

async function withBusy(label: string, fn: () => Promise<void>): Promise<void> {
  ui.busy = label;
  try {
    await fn();
  } finally {
    ui.busy = "";
  }
}

function loadDemo(): void {
  void withBusy("生成示例数据", async () => {
    const csv = generateDemoCsv({ rows: 3, cols: 8 });
    await applyText(csv, "示例机房（3 排 × 8 列）");
  });
}

function loadText(): void {
  const t = textInput.value.trim();
  if (!t) {
    setError("请先粘贴数据。");
    return;
  }
  void withBusy("解析粘贴内容", async () => {
    await applyText(t, "粘贴的数据");
  });
}

async function restore(rec: StoredImport): Promise<void> {
  await withBusy("恢复历史导入", async () => {
    await applyText(rec.text, rec.name);
  });
}

async function remove(rec: StoredImport): Promise<void> {
  await deleteImport(rec.id);
  await refreshStored();
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const formatLabel = computed(() => {
  const map: Record<string, string> = {
    "long-csv": "长表 CSV",
    "wide-csv": "宽表 CSV",
    json: "JSON",
    unknown: "未知",
  };
  return map[lastFormat.value] ?? "";
});

const errorIssues = computed(() => ui.issues.filter((i) => i.severity === "error"));
const warnIssues = computed(() => ui.issues.filter((i) => i.severity === "warning"));
</script>

<template>
  <div class="panel">
    <section class="block">
      <div class="block-head">
        <h2>温度采样导入</h2>
        <span class="chip">单机房 ≤ {{ MAX_RACKS }} 柜 · 每面 {{ FACE_COLS }}×{{ FACE_ROWS }}</span>
      </div>

      <div
        class="drop"
        :class="{ active: dragActive }"
        @dragover.prevent="dragActive = true"
        @dragleave.prevent="dragActive = false"
        @drop.prevent="onDrop"
        @click="pickFile"
      >
        <svg viewBox="0 0 24 24" class="drop__icon" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke-linecap="round" />
        </svg>
        <div class="drop__title">拖入 CSV / JSON，或点击选择文件</div>
        <div class="drop__hint">数据只在本地解析，不会上传</div>
        <input
          ref="fileInput"
          type="file"
          accept=".csv,.tsv,.txt,.json,text/csv,application/json"
          hidden
          @change="onFileChange"
        />
      </div>

      <div class="row">
        <button class="btn primary" :disabled="!!ui.busy" @click="loadDemo">
          载入示例机房
        </button>
        <span v-if="ui.busy" class="busy">{{ ui.busy }}…</span>
      </div>
    </section>

    <section v-if="ui.summary" class="block">
      <div class="block-head">
        <h2>当前数据集</h2>
        <span class="chip ok">{{ formatLabel }}</span>
      </div>
      <dl class="summary">
        <div><dt>文件</dt><dd class="ellipsis">{{ ui.summary.filename }}</dd></div>
        <div><dt>机柜</dt><dd class="mono">{{ ui.summary.rackCount }}</dd></div>
        <div><dt>采样点</dt><dd class="mono">{{ ui.summary.sampleCount.toLocaleString() }}</dd></div>
        <div><dt>提示</dt><dd class="mono">{{ ui.summary.issueCount }}</dd></div>
      </dl>

      <div v-if="errorIssues.length" class="issues">
        <div class="issues-head err">错误 {{ errorIssues.length }}</div>
        <div v-for="(iss, i) in errorIssues.slice(0, 6)" :key="'e' + i" class="issue err">
          <span v-if="iss.line" class="issue__line mono">行 {{ iss.line }}</span>
          <span>{{ iss.message }}</span>
        </div>
      </div>

      <div v-if="warnIssues.length" class="issues">
        <div class="issues-head warn">警告 {{ warnIssues.length }}</div>
        <div v-for="(iss, i) in warnIssues.slice(0, 5)" :key="'w' + i" class="issue warn">
          <span v-if="iss.line" class="issue__line mono">行 {{ iss.line }}</span>
          <span>{{ iss.message }}</span>
        </div>
        <div v-if="warnIssues.length > 5" class="issue more">
          另有 {{ warnIssues.length - 5 }} 条警告…
        </div>
      </div>
    </section>

    <section class="block">
      <div class="block-head">
        <h2>粘贴数据</h2>
        <button class="btn sm ghost" :disabled="!textInput.trim() || !!ui.busy" @click="loadText">
          解析
        </button>
      </div>
      <textarea
        v-model="textInput"
        class="textarea"
        placeholder="rack_id,row,col,facing,face,x,y,temp&#10;R01,0,0,+Z,intake,0,0,23.4&#10;R01,0,0,+Z,intake,1,0,23.9&#10;…"
        spellcheck="false"
      />
    </section>

    <section v-if="stored.length" class="block">
      <div class="block-head">
        <h2>历史导入</h2>
        <span class="chip">{{ stored.length }}</span>
      </div>
      <ul class="history">
        <li v-for="rec in stored.slice(0, 8)" :key="rec.id" class="history__item">
          <button class="history__main" :disabled="!!ui.busy" @click="restore(rec)">
            <span class="history__name ellipsis">{{ rec.name }}</span>
            <span class="history__meta mono">{{ rec.rackCount }} 柜 · {{ fmtTime(rec.importedAt) }}</span>
          </button>
          <button class="btn sm ghost danger" title="删除" @click="remove(rec)">×</button>
        </li>
      </ul>
    </section>

    <section class="block">
      <details class="format-doc">
        <summary>支持的数据格式</summary>
        <p><b>长表 CSV</b>（每行一个采样点）</p>
        <pre class="code">rack_id,row,col,facing,face,x,y,temp
R01,0,0,+Z,intake,0,0,23.4
R01,0,0,+Z,exhaust,0,0,35.1</pre>
        <p><b>宽表 CSV</b>（每行一个机柜的一个面，后 36 列是读数）</p>
        <pre class="code">rack_id,row,col,facing,face,v0,v1,…,v35
R01,0,0,+Z,intake,23.4,23.9,…</pre>
        <p><b>JSON</b>（数组，或 <code>{{ "{" }} racks: [...] {{ "}" }}</code>）</p>
        <pre class="code">[{ "rack_id": "R01", "row": 0, "col": 0,
   "facing": "+Z",
   "intake":  [[23.4, …], …],
   "exhaust": [[35.1, …], …] }]</pre>
        <p class="muted">
          朝向支持 <code>+X/-X/+Z/-Z</code>（也可写 东/西/南/北）；
          风面支持 <code>intake/exhaust</code>（进风/出风）。
          缺失值留空即可，会自动插值补全。
        </p>
      </details>
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
  gap: 10px;
}

h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-1);
}

.drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 26px 18px;
  border-radius: var(--radius);
  border: 1.5px dashed #26374a;
  background: var(--bg-1);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.16s, background 0.16s;
}
.drop:hover,
.drop.active {
  border-color: var(--accent-dim);
  background: #0c161e;
}

.drop__icon {
  width: 26px;
  height: 26px;
  color: var(--fg-2);
}

.drop__title {
  font-size: 13px;
  color: var(--fg-0);
  font-weight: 500;
}

.drop__hint {
  font-size: 11px;
  color: var(--fg-2);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.busy {
  font-size: 11.5px;
  color: var(--fg-2);
}

.summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 14px;
  margin: 0;
}
.summary > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid var(--line-soft);
}
.summary dt {
  color: var(--fg-2);
  font-size: 11.5px;
}
.summary dd {
  margin: 0;
  font-weight: 600;
  font-size: 12px;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.issues {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.issues-head {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-top: 4px;
}
.issues-head.err {
  color: var(--danger);
}
.issues-head.warn {
  color: var(--warn);
}

.issue {
  display: flex;
  gap: 8px;
  font-size: 11.5px;
  line-height: 1.45;
  padding: 5px 8px;
  border-radius: 4px;
  background: var(--bg-2);
  color: var(--fg-1);
}
.issue.err {
  border-left: 2px solid var(--danger);
}
.issue.warn {
  border-left: 2px solid var(--warn);
}
.issue.more {
  color: var(--fg-2);
  font-style: italic;
}

.issue__line {
  color: var(--fg-2);
  flex-shrink: 0;
}

.textarea {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-0);
  border: 1px solid var(--line);
  color: var(--fg-0);
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.5;
  outline: none;
}
.textarea:focus {
  border-color: var(--accent-dim);
}

.history {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.history__item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.history__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: flex-start;
  padding: 6px 8px;
  border-radius: 4px;
  text-align: left;
  transition: background 0.13s;
}
.history__main:hover:not(:disabled) {
  background: var(--bg-2);
}

.history__name {
  font-size: 12px;
  color: var(--fg-0);
  max-width: 100%;
}

.history__meta {
  font-size: 10.5px;
  color: var(--fg-2);
}

.format-doc summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--fg-1);
  font-weight: 600;
  padding: 2px 0;
}

.format-doc p {
  margin: 10px 0 5px;
  font-size: 11.5px;
  color: var(--fg-1);
}

.format-doc .muted {
  color: var(--fg-2);
  line-height: 1.6;
}

.format-doc code {
  font-family: var(--mono);
  background: var(--bg-2);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.code {
  margin: 0;
  padding: 8px 10px;
  background: var(--bg-0);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  font-family: var(--mono);
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--fg-1);
  overflow-x: auto;
  white-space: pre;
}
</style>
