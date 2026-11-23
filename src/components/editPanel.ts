/** 模块 03：修边编辑（顶点/边操作、规整、简化、视图显示切换）。 */

import { BtElement, esc } from '../app/base.ts';
import type { AppStore } from '../app/store.ts';
import { cleanRings, ringsBounds, simplifyRings } from '../core/model.ts';
import { formatArea, formatLength } from '../core/util.ts';
import { SEVERITY_CLASSES } from '../core/theme.ts';

export class BtEditPanel extends BtElement {
  private store!: AppStore;

  set store_(s: AppStore) {
    this.store = s;
  }

  protected render(): void {
    this.root.innerHTML = `${this.styles(`
      h3.sec {
        font-size: 10.5px; text-transform: uppercase; letter-spacing: .13em; color: var(--text-faint);
        margin: 16px 0 9px; display: flex; align-items: center; gap: 8px;
      }
      h3.sec:first-child { margin-top: 2px; }
      h3.sec::after { content: ""; flex: 1; height: 1px; background: var(--line-soft); }
      .tools { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .tool {
        display: grid; justify-items: center; gap: 5px; padding: 9px 4px; font-size: 10.5px;
        background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; cursor: pointer;
        color: var(--text-dim); font-family: inherit;
      }
      .tool:hover { background: var(--panel-3); color: var(--text); border-color: #33465a; }
      .tool[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); background: rgba(255,122,61,.08); }
      .tool svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
      .tool.key { position: relative; }
      .tool.key::after {
        content: attr(data-key); position: absolute; top: 3px; right: 5px; font-size: 8px;
        font-family: var(--mono); color: var(--text-faint);
      }
      .ring-list { display: grid; gap: 5px; max-height: 190px; overflow-y: auto; }
      .ring-item {
        display: flex; align-items: center; gap: 7px; padding: 6px 8px; border-radius: 7px;
        border: 1px solid var(--line-soft); background: var(--panel-2); font-size: 11px; cursor: pointer;
      }
      .ring-item:hover { border-color: #33465a; }
      .ring-item.sel { border-color: var(--accent); background: rgba(255,122,61,.08); }
      .ring-item .sw { width: 8px; height: 8px; border-radius: 2px; flex: none; }
      .ring-item .nm { flex: 1; font-family: var(--mono); }
      .ring-item .cnt { color: var(--text-faint); font-family: var(--mono); font-size: 10px; }
      .ring-item .x { color: var(--text-faint); border: 0; background: transparent; cursor: pointer; font-size: 12px; padding: 0 2px; }
      .ring-item .x:hover { color: var(--err); }
      .sel-box {
        border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; background: var(--panel-2);
      }
      .sel-box .hd { font-size: 11px; color: var(--text-dim); display: flex; justify-content: space-between; }
      .sel-box .coords { font-family: var(--mono); font-size: 11.5px; margin-top: 5px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .sel-box input { padding: 4px 6px; font-size: 11px; }
      .quick { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .mode-note {
        font-size: 10.5px; line-height: 1.55; color: var(--text-dim); display: flex; gap: 6px; align-items: flex-start;
        padding: 7px 9px; border-radius: 7px; background: rgba(88,182,224,.06); border: 1px solid rgba(88,182,224,.16);
      }
      .empty-hint {
        text-align: center; padding: 22px 12px; color: var(--text-faint); font-size: 11.5px; line-height: 1.7;
      }
      .empty-hint b { color: var(--text-dim); display: block; margin-bottom: 4px; font-size: 12px; }
    `)}
    <div class="stack">
      <h3 class="sec">边界操作</h3>
      <div class="tools">
        <button class="tool key" data-tool="move" data-key="V" aria-pressed="true" title="拖动顶点 (V)">
          <svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></svg>移动顶点
        </button>
        <button class="tool key" data-tool="add" data-key="A" title="在边上插入顶点 (A)">
          <svg viewBox="0 0 24 24"><path d="M4 20 20 4"/><circle cx="12" cy="12" r="3.2"/><path d="M12 8.4v7.2M8.4 12h7.2"/></svg>插入顶点
        </button>
        <button class="tool key" data-tool="del" data-key="X" title="删除顶点 (X)">
          <svg viewBox="0 0 24 24"><path d="M4 20 20 4"/><circle cx="12" cy="12" r="3.2"/><path d="M10 10l4 4M14 10l-4 4"/></svg>删除顶点
        </button>
      </div>
      <div class="mode-note">
        <span>✎</span>
        <span class="tool-hint"></span>
      </div>

      <label class="field">
        <span class="lab"><span>吸附半径</span><span class="val snap-val">12 px</span></span>
        <input type="range" class="snap-range" min="4" max="30" step="1" />
      </label>

      <h3 class="sec">环列表</h3>
      <div class="ring-list"></div>
      <div class="row" style="gap:6px">
        <button class="btn sm grow" data-act="add-ring">新增外环</button>
        <button class="btn sm grow ghost" data-act="fit">定位选中环</button>
      </div>

      <h3 class="sec">选中的顶点</h3>
      <div class="sel-box">
        <div class="hd"><span>坐标（地图，米）</span><span class="sel-pos mono faint">未选择</span></div>
        <div class="coords">
          <label class="field" style="margin:0"><input type="number" class="vx" step="0.1" placeholder="X" /></label>
          <label class="field" style="margin:0"><input type="number" class="vy" step="0.1" placeholder="Y" /></label>
        </div>
      </div>

      <h3 class="sec">规整与简化</h3>
      <label class="field">
        <span class="lab"><span>简化容差</span><span class="val simp-val">0.5 m</span></span>
        <input type="range" class="simp-range" min="0" max="6" step="0.1" />
      </label>
      <div class="quick">
        <button class="btn sm" data-act="simplify">简化边界</button>
        <button class="btn sm" data-act="clean">清理细碎</button>
      </div>
      <button class="btn block primary" data-act="regularize" style="margin-top:6px">
        布尔规整（消除自交 / 合并碎片）
      </button>

      <h3 class="sec">显示</h3>
      <div class="row">
        <div class="seg mode-seg2" role="group" aria-label="显示模式">
          <button data-mode="drape" aria-pressed="true">贴地</button>
          <button data-mode="raised" aria-pressed="false">抬升</button>
        </div>
        <div class="grow"></div>
        <label class="row" style="gap:6px">
          <input type="checkbox" class="show-img" checked />
          <span class="tiny muted">显示影像</span>
        </label>
      </div>
      <label class="field" style="margin-top:8px">
        <span class="lab"><span>地形垂直夸张</span><span class="val exag-val">1.35×</span></span>
        <input type="range" class="exag-range" min="0.6" max="2.6" step="0.05" />
      </label>

      <h3 class="sec">几何信息</h3>
      <div class="geom-info"></div>

      <div class="empty-hint" hidden>
        <b>还没有可编辑的边界</b>
        先在「边界提取」中提取火场轮廓，<br />或直接在这里新增一个外环。
      </div>
    </div>`;
  }

  protected override mountedCallback(): void {
    this.syncAll();
    for (const ev of ['boundary', 'selection', 'view', 'severity', 'project'] as const) {
      this.cleanup.push(this.store.on(ev, () => this.syncAll()));
    }

    this.qa<HTMLButtonElement>('.tool').forEach((btn) => {
      this.on(btn, 'click', () => {
        this.setTool(btn.dataset.tool as string);
      });
    });

    const snap = this.q<HTMLInputElement>('.snap-range');
    if (snap) this.on(snap, 'input', () => {
      const v = Number(snap.value);
      this.store.setSnap(v);
      const lab = this.q('.snap-val');
      if (lab) lab.textContent = `${v} px`;
    });

    const simp = this.q<HTMLInputElement>('.simp-range');
    if (simp) this.on(simp, 'input', () => {
      const lab = this.q('.simp-val');
      if (lab) lab.textContent = `${Number(simp.value).toFixed(1)} m`;
    });

    const exag = this.q<HTMLInputElement>('.exag-range');
    if (exag) this.on(exag, 'change', () => {
      this.store.setView({ exaggeration: Number(exag.value) });
      this.store.emit('view');
    });

    const showImg = this.q<HTMLInputElement>('.show-img');
    if (showImg) this.on(showImg, 'change', () => {
      this.store.setView({ showImagery: showImg.checked });
      this.store.emit('view');
    });

    this.qa<HTMLButtonElement>('.mode-seg2 button').forEach((b) => {
      this.on(b, 'click', () => this.store.setView({ mode: b.dataset.mode as 'drape' | 'raised' }));
    });

    this.on(this.q('[data-act="regularize"]')!, 'click', () => this.store.regularize());
    this.on(this.q('[data-act="simplify"]')!, 'click', () => {
      const tol = Number(this.q<HTMLInputElement>('.simp-range')?.value ?? 0.5);
      const rings = simplifyRings(this.store.project.boundary, tol);
      this.store.setBoundary(rings, `简化 ${tol.toFixed(1)} m`);
      this.store.select(null);
    });
    this.on(this.q('[data-act="clean"]')!, 'click', () => {
      const minEdge = Math.max(0.05, this.store.project.georef.maxX * 0.0008);
      const rings = cleanRings(this.store.project.boundary, minEdge);
      this.store.setBoundary(rings, '清理细碎');
      this.store.select(null);
    });
    this.on(this.q('[data-act="add-ring"]')!, 'click', () => this.addRing());
    this.on(this.q('[data-act="fit"]')!, 'click', () => this.fitSelected());

    const vx = this.q<HTMLInputElement>('.vx');
    const vy = this.q<HTMLInputElement>('.vy');
    const applyCoord = () => {
      const sel = this.store.selected;
      if (!sel) return;
      const x = Number(vx?.value);
      const y = Number(vy?.value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const rings = this.store.project.boundary.map((r, ri) =>
        ri === sel.ring ? { ...r, vertices: r.vertices.map((p, vi) => (vi === sel.vertex ? { x, y } : { ...p })) } : { ...r, vertices: r.vertices.map((p) => ({ ...p })) },
      );
      this.store.setBoundary(rings, '精确调整顶点');
    };
    if (vx) this.on(vx, 'change', applyCoord);
    if (vy) this.on(vy, 'change', applyCoord);

    // 键盘工具切换
    const keyHandler = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = ev.key.toLowerCase();
      if (k === 'v') this.setTool('move');
      if (k === 'a') this.setTool('add');
      if (k === 'x') this.setTool('del');
    };
    window.addEventListener('keydown', keyHandler);
    this.cleanup.push(() => window.removeEventListener('keydown', keyHandler));
  }

  private setTool(tool: string): void {
    this.store.setTool(tool as 'move' | 'add' | 'del');
    this.syncAll();
  }

  private addRing(): void {
    const g = this.store.project.georef;
    const cx = (g.minX + g.maxX) / 2;
    const cy = (g.minY + g.maxY) / 2;
    const r = Math.min(g.maxX - g.minX, g.maxY - g.minY) * 0.16;
    const verts: { x: number; y: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      verts.push({ x: cx + Math.cos(a) * r * 1.15, y: cy + Math.sin(a) * r });
    }
    const rings = [...this.store.project.boundary, { id: `ring_${Date.now()}`, role: 'outer' as const, vertices: verts }];
    this.store.setBoundary(rings, '新增外环');
    this.store.select({ ring: rings.length - 1, vertex: 0 });
    this.store.viewer?.focusAt(cx, cy);
  }

  private fitSelected(): void {
    const sel = this.store.selected;
    if (!sel) {
      const b = ringsBounds(this.store.project.boundary);
      if (b) {
        this.store.viewer?.focusAt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 1.9);
      }
      return;
    }
    const v = this.store.project.boundary[sel.ring]?.vertices[sel.vertex];
    if (v) this.store.viewer?.focusAt(v.x, v.y, 260);
  }

  private syncAll(): void {
    const p = this.store.project;
    const rings = p.boundary;
    const sel = this.store.selected;

    const list = this.q('.ring-list');
    if (list) {
      if (rings.length === 0) {
        list.innerHTML = `<div class="hint" style="padding:6px 2px">暂无环</div>`;
      } else {
        list.innerHTML = rings
          .map((r, i) => {
            const isSel = sel?.ring === i;
            return `<div class="ring-item ${isSel ? 'sel' : ''}" data-ring="${i}">
              <span class="sw" style="background:${r.role === 'hole' ? '#5ec8e8' : '#ff6b35'}"></span>
              <span class="nm">${r.role === 'hole' ? '孔洞' : '外环'} ${i + 1}</span>
              <span class="cnt">${r.vertices.length} 点</span>
              <button class="x" data-del="${i}" title="删除该环">✕</button>
            </div>`;
          })
          .join('');
        list.querySelectorAll<HTMLElement>('.ring-item').forEach((item) => {
          item.addEventListener('click', (ev) => {
            if ((ev.target as HTMLElement).closest('[data-del]')) return;
            const ri = Number(item.dataset.ring);
            this.store.select({ ring: ri, vertex: 0 });
          });
        });
        list.querySelectorAll<HTMLElement>('[data-del]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const ri = Number(btn.dataset.del);
            const next = rings.filter((_, i) => i !== ri);
            this.store.setBoundary(next, '删除环');
            this.store.select(null);
          });
        });
      }
    }

    const selPos = this.q('.sel-pos');
    const vx = this.q<HTMLInputElement>('.vx');
    const vy = this.q<HTMLInputElement>('.vy');
    if (sel) {
      const v = rings[sel.ring]?.vertices[sel.vertex];
      if (v) {
        if (selPos) selPos.textContent = `#${sel.ring + 1}.${sel.vertex}`;
        if (vx && document.activeElement !== vx) vx.value = v.x.toFixed(1);
        if (vy && document.activeElement !== vy) vy.value = v.y.toFixed(1);
      }
    } else {
      if (selPos) selPos.textContent = '未选择';
      if (vx && document.activeElement !== vx) vx.value = '';
      if (vy && document.activeElement !== vy) vy.value = '';
    }

    this.qa<HTMLButtonElement>('.mode-seg2 button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === p.view.mode)));
    const exag = this.q<HTMLInputElement>('.exag-range');
    if (exag && document.activeElement !== exag) exag.value = String(p.view.exaggeration);
    const exagVal = this.q('.exag-val');
    if (exagVal) exagVal.textContent = `${p.view.exaggeration.toFixed(2)}×`;
    const showImg = this.q<HTMLInputElement>('.show-img');
    if (showImg) showImg.checked = p.view.showImagery;

    const info = this.q('.geom-info');
    const d = this.store.derived;
    if (info) {
      info.innerHTML = `
        <div class="kv"><span class="k">面积</span><span class="v">${d ? formatArea(d.area) : '—'}</span></div>
        <div class="kv"><span class="k">周长</span><span class="v">${d ? formatLength(d.perimeter) : '—'}</span></div>
        <div class="kv"><span class="k">环 / 顶点</span><span class="v">${rings.length} / ${rings.reduce((s, r) => s + r.vertices.length, 0)}</span></div>
        <div class="kv"><span class="k">三角面</span><span class="v">${d ? d.mesh.indices.length / 3 : 0}</span></div>
      `;
    }

    const empty = this.q('.empty-hint') as HTMLElement | null;
    empty?.toggleAttribute('hidden', rings.length > 0);
    const tool = this.store.tool;
    this.qa<HTMLButtonElement>('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    const hint = this.q('.tool-hint');
    if (hint) {
      hint.textContent =
        tool === 'move'
          ? '拖动顶点实时重建多边形并重新三角化；Shift+点击边线插入顶点，Alt+点击顶点删除。'
          : tool === 'add'
            ? '点击边界线以插入顶点；顶点插入后立即可拖动。'
            : '点击顶点以删除；外环少于 3 点时整环移除。';
    }
    void SEVERITY_CLASSES;
    void esc;
  }
}

customElements.define('bt-edit-panel', BtEditPanel);
