/**
 * 3D 视口组件：托管场景、边界可视化、拾取与拖拽编辑。
 * 交互：
 *  - 拖动顶点（修边模块）实时重建多边形与三角化
 *  - 点击边界任意位置显示该处坡度 / 高程 / 受损等级
 *  - Shift+点击边线插入顶点，Alt+点击顶点删除
 */

import { BtElement, esc } from '../app/base.ts';
import type { AppStore } from '../app/store.ts';
import { SceneEngine } from '../view/scene.ts';
import { BoundaryView } from '../view/boundaryView.ts';
import { SeverityLayer } from '../view/severityLayer.ts';
import { insertVertex, moveVertex, pointInsideRings, removeVertex } from '../core/model.ts';
import { burnAtIndex } from '../core/detect.ts';
import { classOf } from '../core/severity.ts';
import { closestOnBoundary } from '../core/geom.ts';
import { SEVERITY_CLASSES, severityColorFromValue } from '../core/theme.ts';
import { formatArea, formatDeg, formatElev, formatLength, rgbToHex } from '../core/util.ts';
import type { Ring, Vec2 } from '../core/types.ts';

interface DragState {
  ring: number;
  vertex: number;
  startRings: Ring[];
  moved: boolean;
}

export class BtViewer extends BtElement {
  private store!: AppStore;
  private scene: SceneEngine | null = null;
  private view: BoundaryView | null = null;
  layer: SeverityLayer | null = null;
  private raf = 0;
  private canvas: HTMLCanvasElement | null = null;
  private drag: DragState | null = null;
  private pointerDownAt: { x: number; y: number } | null = null;
  private spotPoint: { x: number; y: number; screenX: number; screenY: number } | null = null;
  private suppressClick = false;
  private overlaysDirty = true;
  private rebuildTimer = 0;
  private pendingSeverity = false;
  private pendingPreview = false;
  private liveRebuild = false;

  set store_(s: AppStore) {
    this.store = s;
  }

  get appStore(): AppStore {
    return this.store;
  }

  protected render(): void {
    this.root.innerHTML = `${this.styles(`
      :host { position: relative; display: block; width: 100%; height: 100%; background: #0b1116; overflow: hidden; }
      .stage { position: absolute; inset: 0; }
      canvas { display: block; width: 100%; height: 100%; outline: none; touch-action: none; cursor: grab; }
      canvas.dragging { cursor: grabbing; }
      canvas.editing { cursor: crosshair; }
      .overlay { position: absolute; pointer-events: none; }
      .empty {
        position: absolute; inset: 0; display: grid; place-items: center; text-align: center;
        background: radial-gradient(ellipse at 50% 40%, #16202a 0%, #0b1116 70%);
        pointer-events: none;
      }
      .empty .card { max-width: 380px; padding: 26px 30px; }
      .empty h2 { margin: 12px 0 6px; font-size: 17px; font-weight: 600; letter-spacing: .01em; }
      .empty p { margin: 0; font-size: 12.5px; color: var(--text-dim); line-height: 1.7; }
      .glyph { width: 66px; height: 66px; margin: 0 auto; }
      .topbar {
        position: absolute; top: 12px; left: 14px; right: 14px; display: flex; gap: 8px;
        align-items: center; pointer-events: none;
      }
      .topbar > * { pointer-events: auto; }
      .pill {
        display: inline-flex; align-items: center; gap: 8px; padding: 6px 11px; border-radius: 999px;
        background: rgba(15,22,29,.82); border: 1px solid rgba(60,80,98,.65);
        backdrop-filter: blur(9px); font-size: 11.5px; color: var(--text-dim); white-space: nowrap;
      }
      .pill b { color: var(--text); font-weight: 600; }
      .toolbar {
        position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%);
        display: flex; align-items: center; gap: 6px; padding: 5px;
        background: rgba(15,22,29,.9); border: 1px solid var(--line); border-radius: 11px;
        backdrop-filter: blur(10px); box-shadow: 0 8px 28px rgba(0,0,0,.45);
        max-width: calc(100% - 24px); flex-wrap: nowrap; white-space: nowrap;
      }
      .toolbar .seg button, .toolbar .btn { white-space: nowrap; }
      .toolbar .lift-row { flex: none; }
      @media (max-width: 1180px) {
        .toolbar .lift-range { width: 62px; }
        .toolbar .lift-row .tiny.muted { display: none; }
      }
      @media (max-width: 1000px) {
        .topbar .stat-perim { display: none; }
      }
      .toolbar .divider { width: 1px; height: 20px; background: var(--line); margin: 0 3px; }
      .compass {
        position: absolute; right: 16px; bottom: 74px; width: 54px; height: 54px;
        border-radius: 50%; background: rgba(15,22,29,.8); border: 1px solid var(--line);
        backdrop-filter: blur(8px); display: grid; place-items: center;
      }
      .scalebar {
        position: absolute; left: 16px; bottom: 76px; font-size: 10.5px; color: var(--text-dim);
        font-family: var(--mono); display: flex; flex-direction: column; gap: 3px; align-items: flex-start;
      }
      .scalebar .bar { height: 5px; border: 1px solid rgba(230,237,243,.6); border-top: none; }
      .legend {
        position: absolute; right: 16px; top: 62px; width: 148px; padding: 9px 10px;
        background: rgba(15,22,29,.86); border: 1px solid var(--line); border-radius: 9px;
        backdrop-filter: blur(9px); font-size: 10.5px; color: var(--text-dim);
      }
      .legend .ttl { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--text-faint); margin-bottom: 6px; }
      .legend .item { display: flex; align-items: center; gap: 6px; padding: 2.5px 0; }
      .legend .sw { width: 11px; height: 11px; border-radius: 3px; flex: none; }
      .tooltip {
        position: absolute; min-width: 172px; max-width: 260px; padding: 10px 12px; pointer-events: none;
        background: rgba(12,18,24,.95); border: 1px solid #33465a; border-radius: 9px;
        font-size: 11.5px; box-shadow: 0 10px 30px rgba(0,0,0,.5); z-index: 5;
        backdrop-filter: blur(10px);
      }
      .tooltip .hdr { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; margin-bottom: 7px; }
      .tooltip .grid { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-family: var(--mono); font-size: 11px; }
      .tooltip .grid .k { color: var(--text-faint); }
      .tooltip .grid .v { text-align: right; font-variant-numeric: tabular-nums; }
      .tooltip .clsbar { height: 4px; border-radius: 3px; margin-top: 8px; }
      .badge-live {
        display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--warn);
        padding: 2px 7px; border-radius: 999px; background: rgba(229,182,74,.1); border: 1px solid rgba(229,182,74,.3);
      }
      .busy {
        position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none;
        background: rgba(8,12,16,.35); opacity: 0; transition: opacity .18s;
      }
      .busy.on { opacity: 1; }
      .busy .box {
        display: flex; align-items: center; gap: 10px; padding: 11px 16px; border-radius: 10px;
        background: rgba(15,22,29,.95); border: 1px solid var(--line); font-size: 12px;
      }
      .err {
        position: absolute; left: 50%; top: 58px; transform: translateX(-50%); max-width: 70%;
        padding: 9px 14px; border-radius: 8px; font-size: 12px; background: #2a1717;
        border: 1px solid #5a2b28; color: #ffb9b5; line-height: 1.5;
      }
    `)}
    <div class="stage"><canvas part="canvas"></canvas></div>
    <div class="empty" hidden>
      <div class="card panel">
        <svg class="glyph" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <path d="M32 6c8 10 15 16 15 25a15 15 0 1 1-30 0c0-6 4-11 6-17 2 4 4 6 6 6 0-6 0-10 3-14z" fill="url(#flame)"/>
          <path d="M32 26c4 5 7 8 7 12a7 7 0 1 1-14 0c0-3 2-6 4-8 .4 2 1.4 3 3 3 0-3 0-5 0-7z" fill="#ffd7a8" opacity=".95"/>
          <defs><linearGradient id="flame" x1="32" y1="6" x2="32" y2="46" gradientUnits="userSpaceOnUse">
            <stop stop-color="#ffb15c"/><stop offset="1" stop-color="#e2491c"/></linearGradient></defs>
        </svg>
        <h2>尚未载入迹地影像</h2>
        <p>在左侧「影像导入」中上传无人机正射影像与高程（可选），或直接载入演示数据开始。</p>
      </div>
    </div>
    <div class="topbar">
      <div class="pill"><span class="dot" style="background:#4a5a68"></span><span class="proj-name">未命名</span></div>
      <div class="pill stat-area">面积 <b>—</b></div>
      <div class="pill stat-perim">周长 <b>—</b></div>
      <div class="grow"></div>
      <div class="pill mode-pill" hidden></div>
    </div>
    <div class="legend" hidden>
      <div class="ttl">受损分级</div>
      <div class="legend-items"></div>
    </div>
    <div class="scalebar" hidden><div class="bar"></div><span class="txt"></span></div>
    <div class="compass">
      <svg width="40" height="40" viewBox="0 0 40 40" aria-label="指北">
        <circle cx="20" cy="20" r="17" fill="none" stroke="#33465a" stroke-width="1"/>
        <path d="M20 6l4.2 11.4L20 15.6l-4.2 1.8z" fill="#ff7a3d"/>
        <path d="M20 34l-3.4-9.2 3.4 1.5 3.4-1.5z" fill="#5d6f7d"/>
        <text x="20" y="4.4" font-size="5.5" fill="#93a4b3" text-anchor="middle" font-family="sans-serif">N</text>
      </svg>
    </div>
    <div class="toolbar">
      <div class="seg mode-seg" role="group" aria-label="显示模式">
        <button data-mode="drape" aria-pressed="true">贴地显示</button>
        <button data-mode="raised" aria-pressed="false">抬升显示</button>
      </div>
      <div class="divider"></div>
      <button class="btn sm ghost" data-act="reset-view" title="回到全图视角">全图</button>
      <button class="btn sm ghost" data-act="toggle-ortho" title="切换正射/透视">视角</button>
      <div class="divider"></div>
      <label class="row lift-row" style="gap:7px;padding-right:4px" title="抬升高度">
        <span class="tiny muted">抬升</span>
        <input type="range" class="lift-range" min="10" max="260" step="1" style="width:88px" />
        <span class="mono tiny lift-val">55 m</span>
      </label>
    </div>
    <div class="tooltip" hidden></div>
    <div class="busy"><div class="box"><span class="spin"></span><span class="busy-text">计算中…</span></div></div>
  `;
  }

  protected override mountedCallback(): void {
    const canvas = this.q<HTMLCanvasElement>('canvas');
    if (!canvas) return;
    this.scene = new SceneEngine(canvas);
    this.view = new BoundaryView(this.scene);
    this.layer = new SeverityLayer();

    this.cleanup.push(this.store.on('project', () => this.syncProject()));
    this.cleanup.push(this.store.on('imagery', () => this.syncTerrain()));
    this.cleanup.push(this.store.on('dem', () => this.syncTerrain()));
    this.cleanup.push(this.store.on('boundary', () => this.scheduleRebuild()));
    this.cleanup.push(this.store.on('selection', () => this.scheduleRebuild()));
    this.cleanup.push(this.store.on('severity', () => this.scheduleRebuild(true)));
    this.cleanup.push(this.store.on('view', () => this.syncView()));
    this.cleanup.push(this.store.on('detect', () => this.syncBusy()));
    this.cleanup.push(this.store.on('status', () => this.syncStatus()));

    this.bindPointer(canvas);
    this.bindToolbar();

    if (!this.canvas) this.canvas = canvas;
    const ro = new ResizeObserver(() => {
      const sc = this.scene;
      if (!sc) return;
      sc.resize();
      this.view?.updateResolution(sc.renderer.domElement.clientWidth, sc.renderer.domElement.clientHeight);
    });
    ro.observe(this);
    this.cleanup.push(() => ro.disconnect());

    this.registerHandle();
    this.syncProject();
    this.syncTerrain();
    this.syncView();
    this.syncBusy();
    this.tick();
  }

  private registerHandle(): void {
    const self = this;
    this.store.viewer = {
      get spot() {
        return self.spotPoint ? { x: self.spotPoint.x, y: self.spotPoint.y } : null;
      },
      elevationAt: (x, y) => self.elevationAt(x, y),
      slopeAt: (x, y) => self.slopeAt(x, y),
      sampleColor: (x, y) => self.sampleColor(x, y),
      spotInfo: (x, y) => self.spotInfo(x, y),
      refresh: () => self.refresh(),
      focusAt: (x, y, s) => self.focusAt(x, y, s),
    };
  }

  protected override unmountedCallback(): void {
    if (this.store?.viewer) this.store.viewer = null;
    cancelAnimationFrame(this.raf);
    if (this.rebuildTimer) cancelAnimationFrame(this.rebuildTimer);
    this.scene?.dispose();
    this.scene = null;
    this.view = null;
  }

  private tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    if (!this.scene) return;
    const rendered = this.scene.render();
    // 浮层依赖相机投影，渲染刷新或点位/状态变化时都要重算
    if (rendered || this.overlaysDirty) {
      this.overlaysDirty = false;
      this.updateOverlays();
    }
  };

  /** 标记浮层需要刷新（点位、选中项等发生变化时） */
  private markOverlays(): void {
    this.overlaysDirty = true;
  }

  private syncProject(): void {
    const name = this.q('.proj-name');
    if (name) name.textContent = this.store.project.name || '未命名';
    this.syncTerrain();
  }

  private syncTerrain(): void {
    if (!this.scene) return;
    const p = this.store.project;
    this.scene.setTerrain({ georef: p.georef, imagery: p.imagery, dem: p.dem });
    (this.q('.empty') as HTMLElement | null)?.toggleAttribute('hidden', !!p.imagery);
    const stats = this.q('.scalebar');
    if (stats) stats.toggleAttribute('hidden', !p.imagery);
    this.scheduleRebuild(true);
  }

  private syncView(schedule = true): void {
    const view = this.store.project.view;
    this.qa<HTMLButtonElement>('.mode-seg button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.mode === view.mode));
    });
    const lift = this.q<HTMLInputElement>('.lift-range');
    if (lift) lift.value = String(Math.round(view.lift));
    const liftVal = this.q('.lift-val');
    if (liftVal) liftVal.textContent = `${Math.round(view.lift)} m`;
    const modePill = this.q('.mode-pill') as HTMLElement | null;
    if (modePill) {
      modePill.toggleAttribute('hidden', this.store.project.boundary.length === 0);
      modePill.innerHTML = `<span class="dot" style="background:${view.mode === 'drape' ? '#5fcf8a' : '#58b6e0'}"></span>${
        view.mode === 'drape' ? '贴地显示' : `抬升显示 · ${Math.round(view.lift)} m`
      }`;
    }
    if (this.scene) {
      const exag = this.store.project.view.exaggeration;
      if (Math.abs(this.scene.exaggeration - exag) > 1e-6) {
        this.scene.setExaggeration(exag);
      } else {
        this.scene.setImageryVisible(this.store.project.view.showImagery);
      }
    }
    this.syncLegend();
    if (schedule) this.scheduleRebuild(true);
  }

  private syncLegend(): void {
    const legend = this.q('.legend') as HTMLElement | null;
    const items = this.q('.legend-items');
    if (!legend || !items) return;
    const has = this.store.project.boundary.length > 0;
    legend.toggleAttribute('hidden', !has);
    if (!has) return;
    items.innerHTML = [...SEVERITY_CLASSES]
      .reverse()
      .map((c) => `<div class="item"><span class="sw" style="background:${c.color}"></span>${esc(c.label)}</div>`)
      .join('');
  }

  private syncBusy(): void {
    const busy = this.q('.busy') as HTMLElement | null;
    busy?.classList.toggle('on', this.store.busy);
    const t = this.q('.busy-text');
    if (t) t.textContent = '正在提取边界…';
  }

  private syncStatus(): void {
    const s = this.store.status;
    const old = this.q('.err');
    if (s.tone === 'error' || s.tone === 'warn') {
      if (old) old.remove();
      const el = document.createElement('div');
      el.className = 'err';
      el.textContent = s.detail ? `${s.text}（${s.detail}）` : s.text;
      this.root.appendChild(el);
      setTimeout(() => el.remove(), 6000);
    }
  }

  /* -------------------------------------------------------------- */
  /* 边界重建                                                        */
  /* -------------------------------------------------------------- */

  private scheduleRebuild(withSeverity = false): void {
    // 拖动时每帧至多一次重建；其余场景合并到下一帧，避免重复计算。
    // 预览标记必须随计划一起保存：它在 pointermove 结束时就被清掉了。
    this.pendingSeverity ||= withSeverity;
    if (this.liveRebuild) this.pendingPreview = true;
    if (this.rebuildTimer) return;
    this.rebuildTimer = requestAnimationFrame(() => {
      this.rebuildTimer = 0;
      const withSev = this.pendingSeverity;
      const preview = this.pendingPreview;
      this.pendingSeverity = false;
      this.pendingPreview = false;
      this.rebuild(withSev, preview);
    });
  }

  private rebuild(withSeverity = false, preview = false): void {
    if (!this.scene || !this.view || !this.store.kernel) return;
    const p = this.store.project;
    if (!p.imagery || p.boundary.length === 0) {
      this.view.clear();
      this.syncStats();
      return;
    }
    if (withSeverity && this.layer) this.paintSeverity();
    const summary = this.store.summary;
    const bounds = summary && summary.grid.width > 0 ? summary.gridBounds : null;
    const stats = this.view.build(this.store.kernel, {
      rings: p.boundary,
      view: p.view,
      layer: this.layer,
      gridBounds: bounds,
      selectedRing: this.store.selected?.ring ?? null,
      selectedVertex: this.store.selected,
      editable: this.store.activeModule === 'edit',
      preview,
    });
    void stats;
    this.syncStats();
    this.syncLegend();
    this.syncView(false);
    this.scene?.invalidate();
    this.markOverlays();
  }

  private paintSeverity(): void {
    if (!this.layer) return;
    const summary = this.store.summary;
    if (!summary || summary.grid.width === 0) {
      this.layer.setGrid(2, 2, new Float32Array(4).fill(-1), () => null);
      return;
    }
    const thresholds = this.store.project.severity.thresholds;
    const palette: [number, number, number][] = SEVERITY_CLASSES.map((c) => c.rgb);
    this.layer.setGrid(summary.grid.width, summary.grid.height, summary.grid.samples, (v) => palette[classOf(v, thresholds)]);
  }

  private syncStats(): void {
    const d = this.store.derived;
    const areaEl = this.q('.stat-area b');
    const perimEl = this.q('.stat-perim b');
    if (areaEl) areaEl.textContent = d ? formatArea(d.area) : '—';
    if (perimEl) perimEl.textContent = d ? formatLength(d.perimeter) : '—';
    this.syncScaleBar();
  }

  private syncScaleBar(): void {
    if (!this.scene) return;
    const bar = this.q('.scalebar .bar') as HTMLElement | null;
    const txt = this.q('.scalebar .txt');
    if (!bar || !txt) return;
    const cam = this.scene.camera;
    const h = this.scene.renderer.domElement.clientHeight || 600;
    const center = cam.position.distanceTo(this.scene.controls.target);
    const worldPerPx = (2 * center * Math.tan((cam.fov * Math.PI) / 360)) / h;
    const target = Math.max(1, Math.round(worldPerPx * 110));
    const nice = niceNumber(target);
    bar.style.width = `${nice / worldPerPx}px`;
    txt.textContent = nice >= 1000 ? `${(nice / 1000).toFixed(nice % 1000 === 0 ? 0 : 1)} km` : `${nice} m`;
  }

  private updateOverlays(): void {
    this.syncScaleBar();
    const tip = this.q('.tooltip') as HTMLElement | null;
    if (!tip) return;
    if (!this.spotPoint) {
      tip.toggleAttribute('hidden', true);
      return;
    }
    const s = this.spotPoint;
    const info = this.spotInfo(s.x, s.y);
    tip.toggleAttribute('hidden', false);
    tip.innerHTML = `
      <div class="hdr"><span class="dot" style="background:${severityColorFromValue(info.severity, this.store.project.severity.thresholds)}"></span>${
        esc(SEVERITY_CLASSES[info.classIndex].label)
      }</div>
      <div class="grid">
        <span class="k">坡度</span><span class="v">${formatDeg(info.slope)}</span>
        <span class="k">高程</span><span class="v">${formatElev(info.elevation)}</span>
        <span class="k">过火指数</span><span class="v">${info.severity.toFixed(3)}</span>
        <span class="k">距边界</span><span class="v">${formatLength(info.distance)}</span>
        <span class="k">坐标</span><span class="v">${info.x.toFixed(0)}, ${info.y.toFixed(0)}</span>
      </div>
      <div class="clsbar" style="background:${severityColorFromValue(info.severity, this.store.project.severity.thresholds)}"></div>
    `;
    const rect = this.getBoundingClientRect();
    const left = s.screenX + 16;
    const top = s.screenY + 12;
    tip.style.left = `${Math.min(left, rect.width - 250)}px`;
    tip.style.top = `${Math.min(top, rect.height - 150)}px`;
  }

  spotInfo(x: number, y: number) {
    const p = this.store.project;
    const slope = this.scene?.slopeAt(x, y) ?? 0;
    const elevation = this.scene?.elevationAt(x, y) ?? 0;
    const severity = this.store.field ? burnAtIndex(this.store.field, x, y) : 0;
    const rings = p.boundary;
    const groups = rings;
    const boundaryRings = groups.map((r) => r.vertices);
    const nearest = closestOnBoundary({ x, y }, boundaryRings);
    return {
      x,
      y,
      slope,
      elevation,
      severity,
      classIndex: classOf(severity, p.severity.thresholds),
      distance: nearest.distance,
    };
  }

  /* -------------------------------------------------------------- */
  /* 交互                                                            */
  /* -------------------------------------------------------------- */

  private bindToolbar(): void {
    this.qa<HTMLButtonElement>('.mode-seg button').forEach((btn) => {
      this.on(btn, 'click', () => {
        const mode = btn.dataset.mode as 'drape' | 'raised';
        this.store.setView({ mode });
      });
    });
    this.on(this.q('[data-act="reset-view"]')!, 'click', () => {
      this.scene?.frameTerrain();
    });
    this.on(this.q('[data-act="toggle-ortho"]')!, 'click', () => {
      if (!this.scene) return;
      const cam = this.scene.camera;
      const dist = cam.position.distanceTo(this.scene.controls.target);
      // 在 48° 与 8° 之间切换俯仰：8° 近似正射
      const dir = cam.position.clone().sub(this.scene.controls.target).normalize();
      const currentPitch = Math.acos(Math.min(1, Math.max(-1, dir.y)));
      const targetPitch = currentPitch > 1.05 ? 0.18 : 1.05;
      const horiz = Math.sqrt(Math.max(0, 1 - Math.cos(targetPitch) ** 2));
      const azim = Math.atan2(dir.x, dir.z);
      cam.position.set(
        this.scene.controls.target.x + Math.sin(azim) * horiz * dist,
        this.scene.controls.target.y + Math.cos(targetPitch) * dist,
        this.scene.controls.target.z + Math.cos(azim) * horiz * dist,
      );
      this.scene.controls.update();
    });
    const lift = this.q<HTMLInputElement>('.lift-range');
    if (lift) {
      this.on(lift, 'input', () => {
        const v = Number(lift.value);
        const val = this.q('.lift-val');
        if (val) val.textContent = `${Math.round(v)} m`;
        this.store.setView({ lift: v });
      });
    }
  }

  private screenTolerance(mapUnitsPerPx: number): number {
    return Math.max(3, mapUnitsPerPx * 11);
  }

  /**
   * 屏幕空间拾取：顶点与边线都按像素距离比较，
   * 避免在边界很密时按地图单位取容差导致总是咬住邻近顶点。
   */
  private pickFeatures(clientX: number, clientY: number): {
    vertex: { ring: number; vertex: number; px: number } | null;
    edge: { ring: number; edge: number; point: Vec2; px: number } | null;
  } {
    if (!this.scene) return { vertex: null, edge: null };
    const sc = this.scene;
    const rect = this.getBoundingClientRect();
    const cam = sc.camera;
    const toPx = (x: number, y: number): { x: number; y: number } => {
      const elev = this.store.project.view.mode === 'drape' ? sc.elevationAt(x, y) : 0;
      const p = sc.mapToWorld(x, y, elev, 0).project(cam);
      return { x: rect.left + (p.x * 0.5 + 0.5) * rect.width, y: rect.top + (-p.y * 0.5 + 0.5) * rect.height };
    };
    const rings = this.store.project.boundary;
    let bestV: { ring: number; vertex: number; px: number } | null = null;
    let bestE: { ring: number; edge: number; point: Vec2; px: number } | null = null;
    for (let r = 0; r < rings.length; r++) {
      const verts = rings[r].vertices;
      const screen: { x: number; y: number }[] = new Array(verts.length);
      for (let v = 0; v < verts.length; v++) {
        screen[v] = toPx(verts[v].x, verts[v].y);
        const px = Math.hypot(screen[v].x - clientX, screen[v].y - clientY);
        if (!bestV || px < bestV.px) bestV = { ring: r, vertex: v, px };
      }
      for (let i = 0; i < verts.length; i++) {
        const ae = screen[i];
        const be = screen[(i + 1) % verts.length];
        const abx = be.x - ae.x;
        const aby = be.y - ae.y;
        const len2 = abx * abx + aby * aby;
        const tt = len2 < 1e-6 ? 0 : Math.min(1, Math.max(0, ((clientX - ae.x) * abx + (clientY - ae.y) * aby) / len2));
        const px = Math.hypot(ae.x + abx * tt - clientX, ae.y + aby * tt - clientY);
        if (!bestE || px < bestE.px) {
          const a = verts[i];
          const b = verts[(i + 1) % verts.length];
          bestE = { ring: r, edge: i, point: { x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt }, px };
        }
      }
    }
    return { vertex: bestV, edge: bestE };
  }

  private mapUnitsPerPixel(): number {
    if (!this.scene) return 1;
    const cam = this.scene.camera;
    const h = this.scene.renderer.domElement.clientHeight || 600;
    const dist = cam.position.distanceTo(this.scene.controls.target);
    return (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / h;
  }

  private bindPointer(canvas: HTMLCanvasElement): void {
    this.on(canvas, 'pointerdown', (ev) => {
      if (!this.scene || !this.store.project.imagery) return;
      const map = this.scene.pickMap(ev.clientX, ev.clientY);
      if (!map) return;
      if (this.store.probing) {
        const rgb = this.scene.sampleColor(map.x, map.y);
        if (rgb) this.store.applyProbeColor({ r: rgb[0], g: rgb[1], b: rgb[2] });
        this.store.cancelProbe();
        this.syncProbeCursor();
        return;
      }
      this.pointerDownAt = { x: ev.clientX, y: ev.clientY };
      const editing = this.store.activeModule === 'edit';
      if (editing && ev.button === 0) {
        const snapPx = this.store.snapPx;
        const { vertex: hv, edge: he } = this.pickFeatures(ev.clientX, ev.clientY);
        const tool = this.store.tool;
        const nearVertex = hv && hv.px <= snapPx ? hv : null;
        const nearEdge = he && he.px <= snapPx ? he : null;
        const vertexWins = !!nearVertex && (!nearEdge || nearVertex.px <= nearEdge.px * 0.92 || tool !== 'add');

        // 删除：Alt+点击顶点，或“删除顶点”工具点击顶点
        if (nearVertex && (ev.altKey || tool === 'del')) {
          const res = removeVertex(this.store.project.boundary, nearVertex.ring, nearVertex.vertex);
          this.store.setBoundary(res.rings, res.removedRing ? '删除环' : '删除顶点');
          this.store.select(null);
          this.suppressClick = true;
          return;
        }
        // 插入：Shift+点击边线，或“插入顶点”工具点击边线
        if (nearEdge && (ev.shiftKey || tool === 'add') && (!nearVertex || nearEdge.px < nearVertex.px)) {
          const rings = insertVertex(this.store.project.boundary, nearEdge.ring, nearEdge.edge, nearEdge.point);
          this.store.setBoundary(rings, '插入顶点');
          this.store.select({ ring: nearEdge.ring, vertex: nearEdge.edge + 1 });
          this.suppressClick = true;
          return;
        }
        if (nearVertex && vertexWins) {
          canvas.setPointerCapture(ev.pointerId);
          canvas.classList.add('dragging');
          this.drag = {
            ring: nearVertex.ring,
            vertex: nearVertex.vertex,
            startRings: this.store.project.boundary.map((r) => ({ ...r, vertices: r.vertices.map((p) => ({ ...p })) })),
            moved: false,
          };
          this.store.select({ ring: nearVertex.ring, vertex: nearVertex.vertex });
          ev.preventDefault();
          return;
        }
        // 空白处点击：取消选择
        const inside = pointInsideRings(this.store.project.boundary, map);
        if (!inside.inside) this.store.select(null);
      }
    });

    this.on(canvas, 'pointermove', (ev) => {
      if (!this.scene) return;
      if (this.drag) {
        const map = this.scene.pickMap(ev.clientX, ev.clientY);
        if (!map) return;
        const clamped = this.clampToTerrain(map.x, map.y);
        const rings = moveVertex(this.drag.startRings, this.drag.ring, this.drag.vertex, clamped);
        this.drag.moved = true;
        this.liveRebuild = true;
        this.store.setBoundary(rings, '拖动顶点', { live: true });
        this.liveRebuild = false;
        this.store.select({ ring: this.drag.ring, vertex: this.drag.vertex });
        this.spotPoint = null;
      this.markOverlays();
        return;
      }
      // 悬停：编辑态根据命中类型切换光标
      if (this.store.activeModule === 'edit') {
        const snapPx = this.store.snapPx;
        const { vertex, edge } = this.pickFeatures(ev.clientX, ev.clientY);
        const tool = this.store.tool;
        if (vertex && vertex.px <= snapPx) canvas.style.cursor = tool === 'del' ? 'not-allowed' : 'pointer';
        else if (edge && edge.px <= snapPx) canvas.style.cursor = 'copy';
        else canvas.style.cursor = 'crosshair';
      } else {
        canvas.style.cursor = this.store.probing ? 'copy' : 'grab';
      }
    });

    this.on(canvas, 'pointerup', (ev) => {
      if (this.drag) {
        const wasMoved = this.drag.moved;
        const start = this.drag.startRings;
        this.drag = null;
        canvas.classList.remove('dragging');
        try {
          canvas.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
        if (wasMoved) this.suppressClick = true;
        this.liveRebuild = false;
        if (wasMoved) {
          // 拖动结束：只把“起点快照”推入历史一次，供撤销回到拖动前；
          // 最终几何已在拖动过程中实时构建，这里只做收尾（重建统计）。
          this.store.history.push({ label: '拖动顶点', at: Date.now(), boundary: start });
          if (this.store.history.length > 40) this.store.history.shift();
          this.store.emit('history');
          this.store.setBoundary(this.store.project.boundary, '拖动顶点', { live: true });
          this.store.refreshDerived(true);
          this.scheduleRebuild(false);
          this.store.persistSoon();
        }
      }
    });

    this.on(canvas, 'click', (ev) => {
      if (!this.scene || !this.store.project.imagery) return;
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      if (this.pointerDownAt) {
        const dx = ev.clientX - this.pointerDownAt.x;
        const dy = ev.clientY - this.pointerDownAt.y;
        if (Math.hypot(dx, dy) > 6) return;
      }
      const map = this.scene.pickMap(ev.clientX, ev.clientY);
      if (!map) return;
      const inside = pointInsideRings(this.store.project.boundary, map);
      if (inside.inside) {
        const rect = this.getBoundingClientRect();
        this.spotPoint = { x: map.x, y: map.y, screenX: ev.clientX - rect.left, screenY: ev.clientY - rect.top };
        this.markOverlays();
      } else {
        const nearest = this.spotInfo(map.x, map.y);
        const tol = this.screenTolerance(this.mapUnitsPerPixel()) * 2;
        if (nearest.distance <= tol) {
          const rect = this.getBoundingClientRect();
          this.spotPoint = { x: map.x, y: map.y, screenX: ev.clientX - rect.left, screenY: ev.clientY - rect.top };
          this.markOverlays();
        this.markOverlays();
        } else {
          this.spotPoint = null;
      this.markOverlays();
        }
      }
    });

    this.on(canvas, 'pointerleave', () => {
      if (!this.drag) {
        this.spotPoint = null;
        this.markOverlays();
      }
    });

    this.cleanup.push(this.store.on('detect', () => this.syncProbeCursor()));

    this.on(canvas, 'contextmenu', (ev) => ev.preventDefault());
  }

  /** 拖动时把顶点限制在地形范围内 */
  private clampToTerrain(x: number, y: number): Vec2 {
    const g = this.store.project.georef;
    const m = Math.max(0.5, Math.min(4, (g.maxX - g.minX) * 0.004));
    return {
      x: Math.min(g.maxX - m, Math.max(g.minX + m, x)),
      y: Math.min(g.maxY - m, Math.max(g.minY + m, y)),
    };
  }

  /** 外部（编辑模块）调用：重新构建 */
  refresh(): void {
    this.scheduleRebuild(true);
    this.store.emit('selection');
  }

  /** 取色探针时把光标换成吸管样式 */
  private syncProbeCursor(): void {
    if (!this.scene) return;
    const canvas = this.shadowRoot?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    if (this.store.probing) canvas.style.cursor = 'copy';
  }

  /** 供外部组件读取的地形高程 */
  elevationAt(x: number, y: number): number {
    return this.scene?.elevationAt(x, y) ?? 0;
  }

  slopeAt(x: number, y: number): number {
    return this.scene?.slopeAt(x, y) ?? 0;
  }

  /** 视口当前选中点位（点击查询） */
  get spot(): { x: number; y: number } | null {
    return this.spotPoint;
  }

  /** 把相机移动到某点 */
  focusAt(x: number, y: number, scale = 320): void {
    if (!this.scene) return;
    const w = this.scene.mapToWorld(x, y, this.scene.elevationAt(x, y), 0);
    this.scene.controls.target.copy(w);
    this.scene.camera.position.set(w.x - scale * 0.45, w.y + scale * 0.8, w.z + scale * 0.7);
    this.scene.controls.update();
  }

  /** 影像色值（供侧栏“参考色”取样） */
  sampleColor(x: number, y: number): string | null {
    const c = this.scene?.sampleColor(x, y);
    return c ? rgbToHex(c[0], c[1], c[2]) : null;
  }
}

function niceNumber(v: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, v))));
  const n = v / pow;
  const step = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return step * pow;
}

customElements.define('bt-viewer', BtViewer);
