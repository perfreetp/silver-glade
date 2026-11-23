/** 应用外壳：顶栏 + 左侧模块面板 + 3D 视口 + 底部状态条。 */

import { BtElement } from '../app/base.ts';
import { store, initKernel, SAMPLES } from '../app/instance.ts';
import { boundaryToGeoJSON, exportFilename } from '../core/project.ts';
import { loadRasterImage, parseEsriAscii } from '../core/raster.ts';
import { formatArea, formatLength } from '../core/util.ts';


const MODULES = [
  { id: 'import', index: '01', label: '影像导入', icon: 'import' },
  { id: 'detect', index: '02', label: '边界提取', icon: 'scan' },
  { id: 'edit', index: '03', label: '修边编辑', icon: 'pen' },
  { id: 'stats', index: '04', label: '面积统计', icon: 'chart' },
] as const;

const ICONS: Record<string, string> = {
  import: '<path d="M12 3v10m0 0 4-4m-4 4-4-4"/><path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3"/>',
  scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M4 12h16"/>',
  pen: '<path d="M4 20l4-1 10-10-3-3L5 16l-1 4z"/><path d="M14 6l3 3"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="12" width="3" height="5"/><rect x="12" y="8" width="3" height="9"/><rect x="17" y="14" width="3" height="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/>',
  undo: '<path d="M4 10h10a5 5 0 0 1 0 10h-4"/><path d="M4 10l4-4M4 10l4 4"/>',
  geo: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>',
};

export class FireApp extends BtElement {
  private sidebar: HTMLElement | null = null;
  private toastTimer = 0;

  protected render(): void {
    this.root.innerHTML = `${this.styles(`
      :host {
        position: fixed; inset: 0; display: grid;
        grid-template-rows: 52px 1fr 30px;
        background: var(--bg);
        overflow: hidden;
      }
      header {
        display: flex; align-items: center; gap: 14px; padding: 0 14px;
        border-bottom: 1px solid var(--line); background: linear-gradient(180deg,#131a22,#0f151b);
        z-index: 3;
      }
      .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .brand svg { width: 26px; height: 26px; flex: none; }
      .brand .txt { display: grid; line-height: 1.15; }
      .brand .name { font-size: 14px; font-weight: 700; letter-spacing: .04em; }
      .brand .sub { font-size: 9.5px; color: var(--text-faint); letter-spacing: .16em; text-transform: uppercase; }
      .proj-title {
        flex: 1; min-width: 120px; max-width: 330px; display: flex; align-items: center; gap: 8px;
      }
      .proj-title input {
        background: transparent; border: 1px solid transparent; font-size: 13px; font-weight: 500;
        padding: 5px 8px; border-radius: 7px;
      }
      .proj-title input:hover { border-color: var(--line); }
      .proj-title input:focus { background: var(--panel-2); border-color: #3d5266; }
      .spacer { flex: 1; }
      .actions { display: flex; align-items: center; gap: 6px; }
      .kbd {
        font-family: var(--mono); font-size: 10px; padding: 1px 4px; border-radius: 4px;
        border: 1px solid var(--line); color: var(--text-faint); background: var(--panel-2);
      }
      .storage { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--text-faint); font-family: var(--mono); }
      @media (max-width: 1240px) { .storage { display: none; } }
      @media (max-width: 1120px) { .brand .txt .sub { display: none; } }
      main { display: grid; grid-template-columns: clamp(280px, 26vw, 348px) minmax(0, 1fr); min-height: 0; }
      .sidebar {
        display: grid; grid-template-rows: auto 1fr; min-height: 0;
        border-right: 1px solid var(--line); background: var(--panel);
      }
      .nav { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; padding: 8px 8px 0; }
      .nav button {
        appearance: none; border: 0; background: transparent; color: var(--text-faint);
        padding: 8px 4px 9px; border-radius: 8px 8px 0 0; cursor: pointer; font-family: inherit;
        display: grid; justify-items: center; gap: 4px; position: relative;
        border-bottom: 2px solid transparent; transition: color .14s, background .14s;
      }
      .nav button:hover { background: var(--panel-2); color: var(--text-dim); }
      .nav button[aria-selected="true"] { color: var(--accent); background: var(--panel-2); border-bottom-color: var(--accent); }
      .nav button svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .nav button .n { font-size: 9px; font-family: var(--mono); opacity: .65; }
      .nav button .t { font-size: 10.5px; letter-spacing: .02em; }
      .panel-body { overflow-y: auto; overflow-x: hidden; padding: 12px 12px 22px; min-height: 0; }
      .viewport { position: relative; min-width: 0; min-height: 0; }
      footer {
        display: flex; align-items: center; gap: 12px; padding: 0 12px; font-size: 11px;
        border-top: 1px solid var(--line); background: #0d1319; color: var(--text-dim);
        font-family: var(--mono); overflow: hidden; white-space: nowrap;
      }
      footer .st { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      footer .st .dot { flex: none; }
      footer .sep { color: var(--line); }
      footer .right { margin-left: auto; display: flex; gap: 12px; align-items: center; }
      .toast {
        position: fixed; left: 50%; bottom: 122px; transform: translateX(-50%);
        background: #16202a; border: 1px solid #33465a; border-radius: 10px;
        padding: 9px 16px; font-size: 12.5px; box-shadow: 0 12px 40px rgba(0,0,0,.5);
        z-index: 50; max-width: 70vw;
      }
      .modal-back {
        position: fixed; inset: 0; background: rgba(4,7,10,.7); z-index: 40;
        display: grid; place-items: center; backdrop-filter: blur(3px);
      }
      .modal {
        width: min(440px, 88vw); background: var(--panel); border: 1px solid var(--line);
        border-radius: 14px; padding: 20px; box-shadow: 0 24px 70px rgba(0,0,0,.6);
      }
      .modal h3 { margin: 0 0 6px; font-size: 15px; }
      .modal p { margin: 0 0 16px; font-size: 12.5px; color: var(--text-dim); line-height: 1.65; }
      .modal .row { justify-content: flex-end; margin-top: 16px; }
      @media (max-width: 900px) {
        main { grid-template-columns: 272px minmax(0, 1fr); }
        header { gap: 8px; padding: 0 8px; }
        .actions .btn { padding: 6px 8px; }
      }
    `)}
    <header>
      <div class="brand">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="#1b120c"/>
          <path d="M16 5c4 5 7 8 7 12a7 7 0 1 1-14 0c0-3 2-5 3-8 1 2 2 3 3 3 0-3 0-5 1-7z" fill="#ff7a3d"/>
          <path d="M16 15c2 2.5 3.5 4 3.5 6a3.5 3.5 0 1 1-7 0c0-1.6 1.2-2.8 2-4 .3 1 .8 1.5 1.5 1.5 0-1.4 0-2.4 0-3.5z" fill="#ffd7a8"/>
        </svg>
        <div class="txt"><span class="name">烬迹 BurnTrace</span><span class="sub">burn scar reconstruction</span></div>
      </div>
      <div class="proj-title"><input class="proj-input" aria-label="项目名称" spellcheck="false" /></div>
      <div class="spacer"></div>
      <div class="actions">
        <button class="btn sm ghost" data-act="undo" title="撤销 (Ctrl+Z)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS.undo}</svg>
          撤销
        </button>
        <button class="btn sm ghost" data-act="save" title="保存到本地存储 (Ctrl+S)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS.save}</svg>
          保存
        </button>
        <button class="btn sm" data-act="export" title="导出 GeoJSON">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS.geo}</svg>
          导出 GeoJSON
        </button>
        <button class="btn sm" data-act="new" title="新建项目">新建</button>
      </div>
      <div class="storage"><span class="store-bytes">本地存储 —</span></div>
    </header>
    <main>
      <aside class="sidebar">
        <nav class="nav" role="tablist">
          ${MODULES.map(
            (m) =>
              `<button role="tab" data-mod="${m.id}" aria-selected="${m.id === 'import'}">
                <span class="n">${m.index}</span>
                <svg viewBox="0 0 24 24">${ICONS[m.icon]}</svg>
                <span class="t">${m.label}</span>
              </button>`,
          ).join('')}
        </nav>
        <div class="panel-body"></div>
      </aside>
      <section class="viewport"><bt-viewer></bt-viewer></section>
    </main>
    <footer>
      <div class="st"><span class="dot" style="background:#58b6e0"></span><span class="status-text">初始化中…</span></div>
      <span class="sep">│</span>
      <span class="geo-text">—</span>
      <div class="right">
        <span class="kernel-text">内核：加载中</span>
        <span class="sep">│</span>
        <span class="area-text">面积 —</span>
        <span class="sep">│</span>
        <span class="perim-text">周长 —</span>
      </div>
    </footer>
  `;
    this.sidebar = this.q('.panel-body');
  }

  protected override mountedCallback(): void {
    const viewer = this.q<HTMLElement & { store_: unknown }>('bt-viewer');
    if (viewer) viewer.store_ = store;

    this.setupNav();
    this.setupHeader();
    this.setupShortcuts();

    this.cleanup.push(store.on('status', () => this.syncStatus()));
    this.cleanup.push(store.on('storage', () => this.syncStorage()));
    this.cleanup.push(store.on('project', () => this.syncProject()));
    this.cleanup.push(store.on('boundary', () => this.syncFooter()));
    this.cleanup.push(store.on('severity', () => this.syncFooter()));
    this.cleanup.push(store.on('detect', () => this.syncFooter()));

    this.syncStatus();
    this.syncProject();
    this.syncFooter();
    this.syncStorage();
    this.renderModule();

    void this.boot();
  }

  private async boot(): Promise<void> {
    await initKernel();
    const restored = await store.loadFromStorage();
    this.syncProject();
    this.syncFooter();
    this.syncStorage();
    if (restored) {
      this.toast('已恢复上次编辑的项目');
      if (store.project.boundary.length === 0 && store.project.imagery) {
        this.selectModule('detect');
      } else if (store.project.boundary.length > 0) {
        this.selectModule('stats');
      }
    }
    this.q('bt-viewer')?.dispatchEvent(new CustomEvent('bt-ready'));
  }

  private setupNav(): void {
    this.qa<HTMLButtonElement>('.nav button').forEach((btn) => {
      this.on(btn, 'click', () => this.selectModule(btn.dataset.mod as typeof store.activeModule));
    });
  }

  selectModule(id: 'import' | 'detect' | 'edit' | 'stats'): void {
    if (store.activeModule === id) return;
    store.activeModule = id;
    this.qa<HTMLButtonElement>('.nav button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mod === id)));
    this.renderModule();
    store.viewer?.refresh();
  }

  private renderModule(): void {
    if (!this.sidebar) return;
    this.sidebar.innerHTML = '';
    const tag = {
      import: 'bt-import-panel',
      detect: 'bt-detect-panel',
      edit: 'bt-edit-panel',
      stats: 'bt-stats-panel',
    }[store.activeModule];
    const panel = document.createElement(tag);
    (panel as HTMLElement & { store_?: unknown }).store_ = store;
    this.sidebar.appendChild(panel);
  }

  private setupHeader(): void {
    const input = this.q<HTMLInputElement>('.proj-input');
    if (input) {
      input.value = store.project.name;
      this.on(input, 'change', () => {
        store.project.name = input.value.trim() || '未命名火烧迹地';
        store.emit('project');
      });
      this.cleanup.push(
        store.on('project', () => {
          if (document.activeElement !== input) input.value = store.project.name;
        }),
      );
    }
    this.on(this.q('[data-act="save"]')!, 'click', () => void store.saveNow());
    this.on(this.q('[data-act="undo"]')!, 'click', () => store.undo());
    this.on(this.q('[data-act="export"]')!, 'click', () => this.exportGeoJSON());
    this.on(this.q('[data-act="new"]')!, 'click', () => this.confirmNew());
  }

  private setupShortcuts(): void {
    const handler = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        void store.saveNow();
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !typing) {
        ev.preventDefault();
        store.undo();
      } else if (ev.key === '1' && !typing) this.selectModule('import');
      else if (ev.key === '2' && !typing) this.selectModule('detect');
      else if (ev.key === '3' && !typing) this.selectModule('edit');
      else if (ev.key === '4' && !typing) this.selectModule('stats');
      else if (ev.key.toLowerCase() === 'm' && !typing) {
        store.setView({ mode: store.project.view.mode === 'drape' ? 'raised' : 'drape' });
      }
    };
    window.addEventListener('keydown', handler);
    this.cleanup.push(() => window.removeEventListener('keydown', handler));
  }

  private confirmNew(): void {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal">
        <h3>新建项目</h3>
        <p>当前项目会从浏览器本地存储中清除。如需保留，请先导出 GeoJSON。</p>
        <label class="field"><span class="lab">项目名称</span><input type="text" class="new-name" value="火烧迹地评估 ${new Date().toLocaleDateString('zh-CN')}" /></label>
        <div class="row">
          <button class="btn ghost" data-cancel>取消</button>
          <button class="btn primary" data-ok>新建</button>
        </div>
      </div>`;
    this.root.appendChild(back);
    const close = () => back.remove();
    back.querySelector('[data-cancel]')?.addEventListener('click', close);
    back.addEventListener('click', (ev) => {
      if (ev.target === back) close();
    });
    back.querySelector('[data-ok]')?.addEventListener('click', async () => {
      const name = (back.querySelector('.new-name') as HTMLInputElement).value.trim() || '未命名火烧迹地';
      await store.clearStorage();
      store.newProject(name);
      this.selectModule('import');
      store.viewer?.refresh();
      close();
    });
  }

  private exportGeoJSON(): void {
    if (store.project.boundary.length === 0) {
      this.toast('还没有边界可以导出');
      return;
    }
    const json = boundaryToGeoJSON(store.project, store.summary);
    const blob = new Blob([json], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = exportFilename(store.project, 'geojson');
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    this.toast(`已导出 ${name}`);
    store.setStatus(`GeoJSON 已导出：${name}`, 'ok');
  }

  private syncStatus(): void {
    const s = store.status;
    const el = this.q('.status-text');
    if (el) el.textContent = s.text;
    const dot = this.q<HTMLElement>('footer .st .dot');
    if (dot) {
      const map = { info: '#58b6e0', ok: '#5fcf8a', warn: '#e5b64a', error: '#ef6461' } as const;
      dot.style.background = map[s.tone];
    }
    const kernel = this.q('.kernel-text');
    if (kernel) kernel.textContent = store.kernel ? `内核：manifold-3d ${store.kernel ? '就绪' : ''}` : '内核：加载中';
  }

  private syncProject(): void {
    const input = this.q<HTMLInputElement>('.proj-input');
    if (input && document.activeElement !== input) input.value = store.project.name;
    this.syncGeo();
    this.syncFooter();
  }

  private syncGeo(): void {
    const g = store.project.georef;
    const el = this.q('.geo-text');
    if (!el) return;
    el.textContent = `${(g.maxX - g.minX).toFixed(0)} m × ${(g.maxY - g.minY).toFixed(0)} m · ${
      g.crs === 'wgs84' ? `WGS84 ${g.lon0.toFixed(4)}°E ${g.lat0.toFixed(4)}°N` : '本地平面坐标'
    }`;
  }

  private syncFooter(): void {
    const d = store.derived;
    const areaEls = [this.q('footer .area-text')];
    areaEls[0]?.replaceChildren(document.createTextNode(`面积 ${d ? formatArea(d.area) : '—'}`));
    const perim = this.q('footer .perim-text');
    perim?.replaceChildren(document.createTextNode(`周长 ${d ? formatLength(d.perimeter) : '—'}`));
  }

  private syncStorage(): void {
    const el = this.q('.store-bytes');
    if (!el) return;
    el.textContent = store.storageBytes > 0 ? `本地存储 ${(store.storageBytes / 1024).toFixed(0)} KB` : '本地存储 —';
  }

  toast(text: string): void {
    const old = this.q('.toast');
    old?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.root.appendChild(el);
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.remove(), 2600);
  }

  /** 载入演示数据（供导入面板调用） */
  async loadSample(): Promise<void> {
    store.setStatus('正在载入演示数据…', 'info');
    const imgRes = await fetch(SAMPLES.imagery);
    const blob = await imgRes.blob();
    const file = new File([blob], 'burn-scar.png', { type: 'image/png' });
    const raster = await loadRasterImage(file);
    await store.setImagery(raster.name, raster.data, raster.width, raster.height, {
      spanX: 1200,
      crs: 'wgs84',
      lon0: 118.9274,
      lat0: 43.6182,
    });
    await this.loadSampleDem();
    store.project.name = '白桦岭 5·12 火烧迹地';
    store.emit('project');
    await store.saveNow();
    this.toast('演示数据已载入');
    this.selectModule('detect');
  }

  async loadSampleDem(): Promise<void> {
    const res = await fetch(SAMPLES.dem);
    const text = await res.text();
    const { grid, georef } = parseEsriAscii(text, 'burn-scar.asc');
    store.setDem(grid.name, grid, georef as { minX: number; minY: number; maxX: number; maxY: number });
  }

  async waitForKernel(timeoutMs = 15000): Promise<boolean> {
    const start = performance.now();
    while (!store.kernel) {
      if (performance.now() - start > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 60));
    }
    return true;
  }

  showToast = (t: string) => this.toast(t);
}

customElements.define('fire-app', FireApp);
