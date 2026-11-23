/**
 * 应用状态与业务编排：项目、检测场、边界、统计、本地存储。
 * 组件通过订阅事件获取更新，所有写操作都经由这里，便于持久化与撤销。
 */

import type { BurnField, Project, Ring, SeveritySettings, Vec2, ViewSettings } from '../core/types.ts';
import type { Kernel } from '../core/kernel.ts';
import { defaultProject, deserializeProject, serializeProject, STORAGE_KEY } from '../core/project.ts';
import { computeBurnField, estimateReferenceColor, extractBoundary, type ExtractResult } from '../core/detect.ts';
import { deriveBoundary, regularizeRings, type DerivedBoundary } from '../core/model.ts';
import { severitySummary, type SeveritySummary } from '../core/severity.ts';
import { debounce, id as newId } from '../core/util.ts';

export type AppEvent =
  | 'project'
  | 'imagery'
  | 'dem'
  | 'detect'
  | 'boundary'
  | 'selection'
  | 'severity'
  | 'view'
  | 'status'
  | 'storage'
  | 'history';

export interface StatusMessage {
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'error';
  detail?: string;
  at: number;
}

/** 视口对外暴露的最小接口，供侧栏面板读取坡度/高程与点位 */
export interface ViewerHandle {
  spot: { x: number; y: number } | null;
  elevationAt(x: number, y: number): number;
  slopeAt(x: number, y: number): number;
  sampleColor(x: number, y: number): string | null;
  spotInfo(x: number, y: number): {
    x: number;
    y: number;
    slope: number;
    elevation: number;
    severity: number;
    classIndex: number;
    distance: number;
  };
  refresh(): void;
  focusAt(x: number, y: number, scale?: number): void;
}

export interface HistoryEntry {
  label: string;
  at: number;
  boundary: Ring[];
}

const HISTORY_LIMIT = 40;

export class AppStore {
  project: Project = defaultProject();
  field: BurnField | null = null;
  extract: ExtractResult | null = null;
  derived: DerivedBoundary | null = null;
  summary: SeveritySummary | null = null;
  kernel: Kernel | null = null;
  /** 三维视口句柄（挂载时注册，卸载时置空） */
  viewer: ViewerHandle | null = null;

  selected: { ring: number; vertex: number } | null = null;
  hoverInfo: { x: number; y: number; elevation: number; slope: number; severity: number; classIndex: number; distance: number } | null = null;
  activeModule: 'import' | 'detect' | 'edit' | 'stats' = 'import';
  /** 修边工具 */
  tool: 'move' | 'add' | 'del' = 'move';
  /** 顶点吸附半径（CSS 像素） */
  snapPx = 12;
  /** 取色探针：下一次点击影像时取该处颜色作为参考色 */
  probing = false;
  busy = false;
  status: StatusMessage = { text: '就绪：请导入迹地影像与高程数据', tone: 'info', at: Date.now() };
  history: HistoryEntry[] = [];
  storageBytes = 0;

  private listeners = new Map<AppEvent, Set<(ev: AppEvent) => void>>();
  private persist = debounce(() => void this.persistNow(), 700);

  on(ev: AppEvent, fn: (ev: AppEvent) => void): () => void {
    let set = this.listeners.get(ev);
    if (!set) {
      set = new Set();
      this.listeners.set(ev, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(...events: AppEvent[]): void {
    for (const ev of events) {
      const set = this.listeners.get(ev);
      if (!set) continue;
      for (const fn of [...set]) fn(ev);
    }
  }

  setStatus(text: string, tone: StatusMessage['tone'] = 'info', detail?: string): void {
    this.status = { text, tone, detail, at: Date.now() };
    this.emit('status');
  }

  /* ---------------------------------------------------------------- */
  /* 项目与导入                                                        */
  /* ---------------------------------------------------------------- */

  newProject(name?: string): void {
    this.project = defaultProject(name);
    this.field = null;
    this.extract = null;
    this.derived = null;
    this.summary = null;
    this.selected = null;
    this.history = [];
    this.activeModule = 'import';
    this.setStatus('已新建项目', 'ok');
    this.emit('project', 'imagery', 'dem', 'detect', 'boundary', 'selection', 'severity', 'view', 'history');
    this.persist();
  }

  async setImagery(name: string, data: Uint8ClampedArray, width: number, height: number, opts?: { spanX?: number; crs?: 'local' | 'wgs84'; lon0?: number; lat0?: number }): Promise<void> {
    const spanX = opts?.spanX ?? 1200;
    const spanY = (spanX * height) / width;
    this.project.imagery = { name, width, height, data };
    this.project.georef = {
      ...this.project.georef,
      minX: 0,
      minY: 0,
      maxX: spanX,
      maxY: spanY,
      crs: opts?.crs ?? this.project.georef.crs,
      lon0: opts?.lon0 ?? this.project.georef.lon0,
      lat0: opts?.lat0 ?? this.project.georef.lat0,
    };
    this.project.referenceColor = estimateReferenceColor(this.project.imagery);
    this.rebuildField();
    this.setStatus(`已导入影像 ${name}（${width}×${height}）`, 'ok');
    this.emit('imagery', 'project', 'detect');
    this.persist();
  }

  setDem(name: string, elev: { width: number; height: number; heights: Float32Array; minElev: number; maxElev: number }, georef?: { minX: number; minY: number; maxX: number; maxY: number }): void {
    this.project.dem = { name, ...elev };
    if (georef) {
      this.project.georef = { ...this.project.georef, ...georef };
    }
    this.setStatus(`已导入高程 ${name}（${elev.width}×${elev.height}，${elev.minElev.toFixed(0)}–${elev.maxElev.toFixed(0)} m）`, 'ok');
    this.emit('dem', 'project');
    this.persist();
  }

  clearImagery(): void {
    this.project.imagery = null;
    this.field = null;
    this.setStatus('已移除影像', 'info');
    this.emit('imagery', 'detect');
    this.persist();
  }

  clearDem(): void {
    this.project.dem = null;
    this.setStatus('已移除高程', 'info');
    this.emit('dem');
    this.persist();
  }

  setGeoref(patch: Partial<Project['georef']>): void {
    this.project.georef = { ...this.project.georef, ...patch };
    this.rebuildField();
    this.emit('project', 'detect');
    this.persist();
  }

  setReferenceColor(rgb: { r: number; g: number; b: number }): void {
    this.project.referenceColor = rgb;
    this.rebuildField();
    this.emit('detect', 'project');
  }

  private rebuildField(): void {
    if (!this.project.imagery) {
      this.field = null;
      return;
    }
    const geo = this.project.georef;
    // 若有 DEM 的地理参照，使用之（可能覆盖影像的默认范围）
    const result = computeBurnField(this.project.imagery, this.project.referenceColor, geo);
    this.field = result.field;
    this.emit('detect');
  }

  /* ---------------------------------------------------------------- */
  /* 边界提取                                                          */
  /* ---------------------------------------------------------------- */

  updateDetect(patch: Partial<Project['detect']>): void {
    this.project.detect = { ...this.project.detect, ...patch };
    this.emit('detect', 'project');
    this.persist();
  }

  async runExtraction(): Promise<ExtractResult | null> {
    if (!this.field || !this.kernel) {
      this.setStatus('需要先导入影像', 'warn');
      return null;
    }
    this.busy = true;
    this.emit('detect');
    try {
      const res = await extractBoundary(this.kernel, this.field, this.project.detect);
      this.extract = res;
      if (res.groups.length === 0) {
        this.setStatus('未找到符合条件的火场边界：请降低阈值或减小最小面积', 'warn');
        return res;
      }
      this.pushHistory('自动提取');
      this.project.boundary = res.groups.flatMap((g) => [
        { id: newId('ring'), role: 'outer' as const, vertices: g.outer },
        ...g.holes.map((h) => ({ id: newId('ring'), role: 'hole' as const, vertices: h })),
      ]);
      this.selected = null;
      this.refreshDerived(true);
      const pct = res.stats.sourceArea > 0 ? (res.stats.keptArea / res.stats.sourceArea) * 100 : 0;
      this.setStatus(
        `提取完成：${res.stats.keptGroups} 个火场，剔除 ${res.stats.fragments} 个碎片，保留面积 ${pct.toFixed(1)}%`,
        'ok',
      );
      this.emit('boundary', 'selection');
      this.persist();
      return res;
    } catch (err) {
      console.error(err);
      this.setStatus('边界提取失败', 'error', String(err));
      return null;
    } finally {
      this.busy = false;
      this.emit('detect');
    }
  }

  /* ---------------------------------------------------------------- */
  /* 边界编辑                                                          */
  /* ---------------------------------------------------------------- */

  setBoundary(rings: Ring[], label = '编辑边界', opts: { live?: boolean } = {}): void {
    if (!opts.live) this.pushHistory(label);
    this.project.boundary = rings;
    this.refreshDerived(!opts.live);
    this.emit('boundary');
    if (!opts.live) this.persist();
  }

  select(sel: { ring: number; vertex: number } | null): void {
    this.selected = sel;
    this.emit('selection');
  }

  refreshDerived(withSeverity = true): void {
    if (!this.kernel) return;
    if (this.project.boundary.length === 0) {
      this.derived = null;
      this.summary = null;
      this.emit('severity');
      return;
    }
    this.derived = deriveBoundary(this.kernel, this.project.boundary);
    if (withSeverity) {
      this.summary = severitySummary(this.kernel, this.field, this.project.boundary, this.project.severity.thresholds);
      this.emit('severity');
    }
  }

  /** 规整：消除自交、合并碎片（用户点“应用”时） */
  regularize(): void {
    if (!this.kernel || this.project.boundary.length === 0) return;
    const res = regularizeRings(this.kernel, this.project.boundary, {
      minArea: this.project.detect.minArea,
      smoothing: this.project.detect.smoothing * 0.5,
    });
    this.pushHistory('规整边界');
    this.project.boundary = res.rings;
    this.selected = null;
    this.refreshDerived(true);
    const bits = [
      res.resolvedSelfIntersections ? '已消除自交' : '拓扑无自交',
      res.removedFragments > 0 ? `剔除 ${res.removedFragments} 个碎片` : '无碎片',
    ];
    this.setStatus(`边界已规整：${bits.join('，')}`, 'ok');
    this.emit('boundary', 'selection');
    this.persist();
  }

  setSeveritySettings(patch: Partial<SeveritySettings>): void {
    this.project.severity = { ...this.project.severity, ...patch };
    if (this.kernel) this.summary = severitySummary(this.kernel, this.field, this.project.boundary, this.project.severity.thresholds);
    this.emit('severity', 'project');
    this.persist();
  }

  /** 开始取色探针（在视图中点击一次即取色并结束） */
  startProbe(): void {
    this.probing = true;
    this.setStatus('取色探针已启用：请在视图中点击未过火植被', 'info');
    this.emit('detect');
  }

  cancelProbe(): void {
    this.probing = false;
    this.emit('detect');
  }

  /** 探针采样完成 */
  applyProbeColor(rgb: { r: number; g: number; b: number }): void {
    this.probing = false;
    this.setReferenceColor(rgb);
    this.setStatus(`参考色已更新为 rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`, 'ok');
    this.emit('detect');
  }

  setTool(tool: 'move' | 'add' | 'del'): void {
    this.tool = tool;
    this.emit('selection');
  }

  setSnap(px: number): void {
    this.snapPx = px;
  }

  setView(patch: Partial<ViewSettings>): void {
    this.project.view = { ...this.project.view, ...patch };
    this.emit('view', 'project');
    this.persist();
  }

  /* ---------------------------------------------------------------- */
  /* 历史                                                              */
  /* ---------------------------------------------------------------- */

  pushHistory(label: string): void {
    this.history.push({ label, at: Date.now(), boundary: this.project.boundary.map((r) => ({ ...r, vertices: r.vertices.map((p) => ({ ...p })) })) });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.emit('history');
  }

  undo(): void {
    const entry = this.history.pop();
    if (!entry) {
      this.setStatus('没有可撤销的操作', 'warn');
      return;
    }
    this.project.boundary = entry.boundary;
    this.selected = null;
    this.refreshDerived(true);
    this.setStatus(`已撤销：${entry.label}`, 'ok');
    this.emit('boundary', 'selection', 'history');
    this.persist();
  }

  /* ---------------------------------------------------------------- */
  /* 持久化                                                            */
  /* ---------------------------------------------------------------- */

  private async persistNow(): Promise<void> {
    try {
      const { json, bytes } = await serializeProject(this.project);
      localStorage.setItem(STORAGE_KEY, json);
      this.storageBytes = bytes;
      this.emit('storage');
    } catch (err) {
      console.warn('本地存储写入失败', err);
      this.emit('storage');
      try {
        // 缩小影像后重试一次
        const { json, bytes } = await serializeProject(this.project, 520);
        localStorage.setItem(STORAGE_KEY, json);
        this.storageBytes = bytes;
        this.emit('storage');
      } catch (err2) {
        console.warn(err2);
        this.setStatus('本地存储空间不足，项目未保存', 'error');
      }
    }
  }

  async loadFromStorage(): Promise<boolean> {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
      this.project = await deserializeProject(raw);
      this.storageBytes = new Blob([raw]).size;
      this.rebuildField();
      this.refreshDerived(true);
      this.setStatus('已从本地存储恢复上次的项目', 'ok');
      this.emit('project', 'imagery', 'dem', 'detect', 'detect', 'boundary', 'severity', 'view', 'storage', 'history');
      return true;
    } catch (err) {
      console.warn('读取本地项目失败', err);
      this.setStatus('本地项目损坏，已新建空白项目', 'warn', String(err));
      return false;
    }
  }

  async clearStorage(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
    this.storageBytes = 0;
    this.emit('storage');
    this.setStatus('已清除本地存储', 'ok');
  }

  /** 允许外部（拖动结束等）请求一次延迟持久化 */
  persistSoon(): void {
    this.persist();
  }

  async saveNow(): Promise<void> {
    await this.persistNow();
    this.setStatus(`已保存到浏览器本地存储（${(this.storageBytes / 1024).toFixed(0)} KB）`, 'ok');
  }

  get boundaryVertices(): Vec2[] {
    return this.project.boundary.flatMap((r) => r.vertices);
  }
}
