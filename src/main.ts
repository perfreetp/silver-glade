import './styles.css';
import { SimulationEngine } from './sim/engine';
import { buildDomain, isSubstrateCell } from './sim/geometry';
import { decodeRLE } from './sim/codec';
import {
  DEFAULT_PARAMS,
  CellType,
  type InoculationPoint,
  type SimParams,
  type Snapshot,
} from './sim/types';
import { MyceliumRenderer } from './renderer/MyceliumRenderer';
import { MyceliumView } from './components/mycelium-view';
import { PlaybackBar } from './components/playback-bar';
import { ParamPanel } from './components/param-panel';
import { InoculationEditor } from './components/inoculation-editor';
import { ExportPanel } from './components/export-panel';
import { SimStatus } from './components/sim-status';

customElements.define('mycelium-view', MyceliumView);
customElements.define('playback-bar', PlaybackBar);
customElements.define('param-panel', ParamPanel);
customElements.define('inoculation-editor', InoculationEditor);
customElements.define('export-panel', ExportPanel);
customElements.define('sim-status', SimStatus);

class AppController {
  private readonly view = document.querySelector<MyceliumView>('#view')!;
  private readonly playback = document.querySelector<PlaybackBar>('#playback')!;
  private readonly paramPanel = document.querySelector<ParamPanel>('#params')!;
  private readonly editor = document.querySelector<InoculationEditor>('#inoculation')!;
  private readonly exportPanel = document.querySelector<ExportPanel>('#export')!;
  private readonly status = document.querySelector<SimStatus>('#status')!;
  private readonly isoWarning = document.querySelector<HTMLElement>('#iso-warning')!;

  private renderer: MyceliumRenderer | null = null;
  private engine = new SimulationEngine();
  private params: SimParams = { ...DEFAULT_PARAMS };
  private points: InoculationPoint[] = [];
  private snapshots: Snapshot[] = [];
  private pointIdSeq = 1;
  private playTimer: number | null = null;
  private coverageCache = new Map<number, number>();

  constructor() {
    if (!self.crossOriginIsolated) this.isoWarning.hidden = false;
  }

  async start(): Promise<void> {
    // 支持 URL 查询参数覆盖默认模拟参数（便于分享配置 / 自动化测试），
    // 例如 ?gridSize=512&totalSteps=240&temperature=28
    this.params = paramsFromUrl({ ...DEFAULT_PARAMS });
    // 默认三个接种点（左、右、下，环形基质内）
    this.points = this.defaultPoints(this.params.gridSize, this.params.holeRatio);
    this.paramPanel.setParams(this.params);
    this.editor.setPoints(this.points);

    this.renderer = new MyceliumRenderer(this.view.host);
    this.renderer.onBackendChange((backend) => this.status.setBackend(backend));
    await this.renderer.init();
    // init 内部可能发生 WebGPU→WebGL 回退，回退后再读一次真实后端
    this.status.setBackend(this.renderer.backend);
    this.status.setParallel(this.engine.isParallel, this.engine.workerTotal);
    this.bindEvents();
    this.renderer.onPickInoculation((gx, gy) => this.handlePick(gx, gy));

    await this.runSimulation();
  }

  /** 生成默认接种点：在环内等角度布 3 点，半径取内外缘中部。 */
  private defaultPoints(size: number, holeRatio: number): InoculationPoint[] {
    const geo = buildDomain(size, holeRatio);
    const center = (size - 1) / 2;
    const midR = (geo.outerRadius + geo.holeRadius) / 2;
    const pts: InoculationPoint[] = [];
    const angles = [Math.PI, Math.PI / 3, -Math.PI / 3];
    for (const a of angles) {
      const gx = center + Math.cos(a) * midR;
      const gy = center - Math.sin(a) * midR;
      if (isSubstrateCell(geo, gx, gy)) pts.push({ id: this.pointIdSeq++, x: gx, y: gy });
    }
    return pts;
  }

  private bindEvents(): void {
    this.paramPanel.addEventListener('params-change', ((e: CustomEvent<SimParams>) => {
      this.params = { ...e.detail };
      // 格点规模 / 气孔比例改变会使旧接种点坐标失效，需要重新校验
      this.ensurePointsInDomain();
      this.editor.setPoints(this.points);
      void this.runSimulation();
    }) as EventListener);

    this.editor.addEventListener('points-change', ((e: CustomEvent<InoculationPoint[]>) => {
      this.points = e.detail;
      void this.runSimulation();
    }) as EventListener);

    this.editor.addEventListener('add-random', () => {
      const geo = this.engine.geometry ?? buildDomain(this.params.gridSize, this.params.holeRatio);
      this.editor.addRandomPoint(
        (x, y) => isSubstrateCell(geo, x, y),
        this.params.gridSize,
      );
    });

    this.playback.addEventListener('seek', ((e: CustomEvent<number>) => {
      this.showFrame(e.detail);
    }) as EventListener);
    this.playback.addEventListener('play', () => this.startPlayback());
    this.playback.addEventListener('pause', () => this.stopPlayback());

    this.exportPanel.addEventListener(
      'import-record',
      ((e: CustomEvent<{ snapshots: Snapshot[]; params: SimParams; points: InoculationPoint[] }>) => {
        const { snapshots, params, points } = e.detail;
        this.params = { ...params };
        this.points = points.map((p) => ({ ...p }));
        this.pointIdSeq = this.points.reduce((m, p) => Math.max(m, p.id + 1), 1);
        this.paramPanel.setParams(this.params);
        this.editor.setPoints(this.points);
        this.applyDomainToRenderer();
        this.snapshots = snapshots;
        this.onSnapshotsReady(false);
      }) as EventListener,
    );
  }

  private ensurePointsInDomain(): void {
    const geo = buildDomain(this.params.gridSize, this.params.holeRatio);
    this.points = this.points.filter((p) => isSubstrateCell(geo, p.x, p.y));
    if (this.points.length === 0) this.points = this.defaultPoints(this.params.gridSize, this.params.holeRatio);
  }

  private handlePick(gx: number, gy: number): void {
    const geo = this.engine.geometry ?? buildDomain(this.params.gridSize, this.params.holeRatio);
    const ok = this.editor.addAt(gx, gy, (x, y) => isSubstrateCell(geo, x, y));
    if (!ok) {
      this.view.setBadge('该位置不是培养基质（外缘外或中心气孔内），已忽略');
      setTimeout(() => this.updateDomainBadge(), 1600);
    }
  }

  private applyDomainToRenderer(): void {
    const geo = buildDomain(this.params.gridSize, this.params.holeRatio);
    this.renderer!.setupDomain(geo.size, this.params.holeRatio, geo.cellType);
    this.renderer!.renderMarkers(this.points);
    this.updateDomainBadge();
  }

  private updateDomainBadge(): void {
    const n = this.params.gridSize;
    this.view.setBadge(
      `${n}×${n} 格点 · ${(n * n / 1e6).toFixed(2)}M 单元 · 气孔占比 ${this.params.holeRatio.toFixed(2)}`,
    );
  }

  /** 重新配置引擎并跑完整段蔓延。 */
  private async runSimulation(): Promise<void> {
    this.stopPlayback();
    this.coverageCache.clear();
    if (this.points.length === 0) {
      this.status.setProgress(0, '缺少接种点');
      return;
    }

    this.applyDomainToRenderer();
    this.engine.configure(this.params, this.points);
    this.status.setParallel(this.engine.isParallel, this.engine.workerTotal);
    this.status.setProgress(0, '模拟运行中…');

    const off = this.engine.on('progress', ({ step, totalSteps }) => {
      this.status.setProgress(step / totalSteps, '模拟运行中…');
    });

    const t0 = performance.now();
    try {
      this.snapshots = await this.engine.run();
      const elapsed = performance.now() - t0;
      this.status.setFrameElapsed(elapsed / Math.max(1, this.snapshots.length));
      this.onSnapshotsReady(true);
    } catch (err) {
      this.status.setProgress(0, `错误：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      off();
    }
  }

  private onSnapshotsReady(ranSimulation: boolean): void {
    this.playback.setFrames(this.snapshots.length);
    this.exportPanel.setData(this.snapshots, this.params, this.points);
    this.status.setProgress(1, ranSimulation ? '模拟完成' : '已导入记录');
    this.showFrame(0);
  }

  /** 跳到任意帧：更新半透明层纹理与覆盖率。 */
  private showFrame(index: number): void {
    const snap = this.snapshots[index];
    if (!snap || !this.renderer) return;
    this.renderer.renderSnapshot(snap);
    this.renderer.renderMarkers(this.points);
    this.playback.setTimeLabel(snap.timeHours);
    const coverage = this.computeCoverage(index, snap);
    this.status.setCoverage(coverage);
  }

  /** 计算当前帧基质格中已有菌丝（浓度>0）的比例，带缓存。 */
  private computeCoverage(frameIndex: number, snap: Snapshot): number {
    const cached = this.coverageCache.get(frameIndex);
    if (cached !== undefined) return cached;
    const n = this.params.gridSize;
    const decoded = new Uint8Array(n * n);
    decodeRLE(snap.bytes, decoded);
    let substrate = 0;
    let colonized = 0;
    const geo = this.engine.geometry ?? buildDomain(n, this.params.holeRatio);
    for (let i = 0; i < n * n; i++) {
      if (geo.cellType[i] === CellType.Substrate) {
        substrate++;
        if (decoded[i]! > 0) colonized++;
      }
    }
    const ratio = substrate === 0 ? 0 : colonized / substrate;
    this.coverageCache.set(frameIndex, ratio);
    return ratio;
  }

  private startPlayback(): void {
    this.stopPlayback();
    const tick = () => {
      this.playback.tickPlay();
      const interval = 90 / this.playback.playSpeed;
      this.playTimer = window.setTimeout(tick, interval);
    };
    this.playTimer = window.setTimeout(tick, 90 / this.playback.playSpeed);
  }

  private stopPlayback(): void {
    if (this.playTimer !== null) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }
}

new AppController().start().catch((err) => {
  console.error(err);
  const badge = document.querySelector<HTMLElement>('#iso-warning');
  if (badge) {
    badge.hidden = false;
    badge.textContent = `初始化失败：${err instanceof Error ? err.message : String(err)}`;
  }
});

/** 从 URL 查询参数读取数值型模拟参数覆盖。 */
function paramsFromUrl(base: SimParams): SimParams {
  const q = new URLSearchParams(location.search);
  const numericKeys: Array<keyof SimParams> = [
    'gridSize',
    'holeRatio',
    'temperature',
    'humidity',
    'totalSteps',
    'snapshotEvery',
    'hoursPerStep',
  ];
  const out: SimParams = { ...base };
  for (const key of numericKeys) {
    const raw = q.get(key);
    if (raw === null) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) (out[key] as number) = n;
  }
  return out;
}
