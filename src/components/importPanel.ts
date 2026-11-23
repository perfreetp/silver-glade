/** 模块 01：影像导入（影像、高程、地理参照、参考色）。 */

import { BtElement, esc } from '../app/base.ts';
import type { AppStore } from '../app/store.ts';
import { demFromImage, loadRasterImage, parseEsriAscii } from '../core/raster.ts';
import { hexToRgb, rgbToHex, safeFilename } from '../core/util.ts';
import { estimateReferenceColor } from '../core/detect.ts';

export class BtImportPanel extends BtElement {
  private store!: AppStore;

  set store_(s: AppStore) {
    this.store = s;
  }

  protected render(): void {
    this.root.innerHTML = `${this.styles(`
      .drop {
        border: 1.5px dashed #33465a; border-radius: 10px; padding: 18px 12px; text-align: center;
        transition: border-color .15s, background .15s; cursor: pointer; background: rgba(23,31,41,.5);
      }
      .drop:hover, .drop.over { border-color: var(--accent); background: rgba(255,122,61,.06); }
      .drop svg { width: 26px; height: 26px; stroke: var(--text-faint); fill: none; stroke-width: 1.5; margin-bottom: 6px; }
      .drop .t { font-size: 12.5px; }
      .drop .s { font-size: 10.5px; color: var(--text-faint); margin-top: 3px; }
      h3.sec {
        font-size: 10.5px; text-transform: uppercase; letter-spacing: .13em; color: var(--text-faint);
        margin: 18px 0 9px; display: flex; align-items: center; gap: 8px;
      }
      h3.sec::after { content: ""; flex: 1; height: 1px; background: var(--line-soft); }
      .filecard {
        display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px;
        background: var(--panel-2); border: 1px solid var(--line);
      }
      .filecard .ico { width: 30px; height: 30px; border-radius: 6px; flex: none; display: grid; place-items: center; background: #22303d; font-size: 14px; }
      .filecard { min-width: 0; }
      .filecard .badge { flex: none; }
      .filecard > .btn { flex: none; }
      .filecard .meta { min-width: 0; flex: 1; }
      .filecard .nm { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .filecard .sub { font-size: 10px; color: var(--text-faint); font-family: var(--mono); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .thumb { width: 56px; height: 42px; border-radius: 5px; object-fit: cover; border: 1px solid #2c3a47; background: #0f151b; }
      .swatch {
        width: 30px; height: 30px; border-radius: 6px; border: 1px solid #41536a; padding: 0; cursor: pointer;
        background-clip: padding-box; overflow: hidden;
      }
      .swatch::-webkit-color-swatch-wrapper { padding: 0; }
      .swatch::-webkit-color-swatch { border: 0; }
      .geo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .geo-grid label.field { margin-bottom: 0; }
      .note {
        font-size: 11px; line-height: 1.6; color: var(--text-dim); background: rgba(88,182,224,.07);
        border-left: 2px solid rgba(88,182,224,.5); padding: 8px 10px; border-radius: 0 6px 6px 0;
      }
      .badge { font-size: 9.5px; padding: 1px 6px; border-radius: 999px; font-family: var(--mono); }
      .badge.on { background: rgba(95,207,138,.12); color: var(--ok); border: 1px solid rgba(95,207,138,.3); }
      .badge.off { background: rgba(147,164,179,.1); color: var(--text-faint); border: 1px solid var(--line); }
      .hidden-input { display: none; }
    `)}
    <div class="stack">
      <div>
        <h3 class="sec" style="margin-top:4px">影像导入</h3>
        <div class="drop" data-drop="imagery" tabindex="0" role="button">
          <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
          <div class="t">拖入或点击上传迹地正射影像</div>
          <div class="s">PNG / JPG / WEBP · 建议 1000–4000 px</div>
        </div>
        <input type="file" class="hidden-input" data-input="imagery" accept="image/*" />
        <div class="imagery-card" style="margin-top:9px"></div>
      </div>

      <div>
        <h3 class="sec">高程数据（DEM）</h3>
        <div class="drop" data-drop="dem" tabindex="0" role="button">
          <svg viewBox="0 0 24 24"><path d="M3 17l5-6 4 4 3-3 6 5"/><path d="M3 20h18"/><circle cx="8" cy="6" r="1.6"/></svg>
          <div class="t">拖入或点击上传高程</div>
          <div class="s">ESRI ASCII (.asc/.txt) 或灰度图</div>
        </div>
        <input type="file" class="hidden-input" data-input="dem" accept=".asc,.txt,image/*" />
        <div class="dem-card" style="margin-top:9px"></div>
      </div>

      <div>
        <h3 class="sec">地理参照</h3>
        <label class="field">
          <span class="lab"><span>坐标类型</span></span>
          <select class="geo-crs">
            <option value="wgs84">WGS84 经纬度</option>
            <option value="local">本地平面坐标</option>
          </select>
        </label>
        <div class="geo-grid">
          <label class="field"><span class="lab"><span>原点经度</span><span class="unit">°E</span></span><input type="number" class="geo-lon" step="0.000001" /></label>
          <label class="field"><span class="lab"><span>原点纬度</span><span class="unit">°N</span></span><input type="number" class="geo-lat" step="0.000001" /></label>
          <label class="field"><span class="lab"><span>东西跨度</span><span class="unit">m</span></span><input type="number" class="geo-span" step="10" min="10" /></label>
          <label class="field"><span class="lab"><span>影像尺寸</span></span><span class="mono tiny geo-dims">—</span></label>
        </div>
        <div class="note" style="margin-top:4px">跨度决定地面分辨率；导出 GeoJSON 时按经纬度换算到 CRS84。</div>
      </div>

      <div>
        <h3 class="sec">未过火参考色</h3>
        <div class="row">
          <input type="color" class="swatch ref-color" title="未过火植被参考色" />
          <div class="grow">
            <div class="mono tiny ref-hex">#587442</div>
            <div class="hint">颜色差异以此为基准</div>
          </div>
          <button class="btn sm" data-act="auto-ref">自动估计</button>
        </div>
        <label class="field" style="margin-top:10px">
          <span class="lab"><span>取色探针</span><span class="probe-state tiny"></span></span>
          <button class="btn sm block" data-act="probe">在视图中点选未过火植被</button>
        </label>
      </div>

      <div class="row" style="gap:8px;margin-top:4px">
        <button class="btn block" data-act="sample">载入演示数据</button>
        <button class="btn block ghost" data-act="next">下一步：边界提取 →</button>
      </div>
    </div>`;
  }

  protected override mountedCallback(): void {
    this.syncForm();
    this.cleanup.push(this.store.on('imagery', () => this.syncForm()));
    this.cleanup.push(this.store.on('dem', () => this.syncForm()));
    this.cleanup.push(this.store.on('project', () => this.syncForm()));
    this.cleanup.push(this.store.on('detect', () => this.syncForm()));

    const imgInput = this.q<HTMLInputElement>('[data-input="imagery"]');
    const imgDrop = this.q('[data-drop="imagery"]');
    const demInput = this.q<HTMLInputElement>('[data-input="dem"]');
    const demDrop = this.q('[data-drop="dem"]');

    if (imgDrop) this.on(imgDrop, 'click', () => imgInput?.click());
    if (imgInput) this.on(imgInput, 'change', () => {
      const file = imgInput.files?.[0];
      if (file) void this.importImagery(file);
      imgInput.value = '';
    });
    if (demDrop) this.on(demDrop, 'click', () => demInput?.click());
    if (demInput) this.on(demInput, 'change', () => {
      const file = demInput.files?.[0];
      if (file) void this.importDem(file);
      demInput.value = '';
    });

    this.setupDrop(imgDrop, 'imagery');
    this.setupDrop(demDrop, 'dem');

    const crs = this.q<HTMLSelectElement>('.geo-crs');
    if (crs) this.on(crs, 'change', () => this.store.setGeoref({ crs: crs.value as 'local' | 'wgs84' }));
    const lon = this.q<HTMLInputElement>('.geo-lon');
    if (lon) this.on(lon, 'change', () => this.store.setGeoref({ lon0: Number(lon.value) }));
    const lat = this.q<HTMLInputElement>('.geo-lat');
    if (lat) this.on(lat, 'change', () => this.store.setGeoref({ lat0: Number(lat.value) }));
    const span = this.q<HTMLInputElement>('.geo-span');
    if (span) this.on(span, 'change', () => {
      const v = Math.max(10, Number(span.value) || 1200);
      const img = this.store.project.imagery;
      const spanY = img ? (v * img.height) / img.width : 900;
      this.store.setGeoref({ minX: 0, minY: 0, maxX: v, maxY: spanY });
      this.syncForm();
    });

    const color = this.q<HTMLInputElement>('.ref-color');
    if (color) this.on(color, 'change', () => this.store.setReferenceColor(hexToRgb(color.value)));
    this.on(this.q('[data-act="auto-ref"]')!, 'click', () => {
      if (!this.store.project.imagery) {
        this.banner('请先导入影像');
        return;
      }
      this.store.setReferenceColor(estimateReferenceColor(this.store.project.imagery));
      this.banner('已根据影像边缘植被重新估计参考色');
    });
    this.on(this.q('[data-act="probe"]')!, 'click', () => {
      if (!this.store.project.imagery) {
        this.banner('请先导入影像');
        return;
      }
      this.store.startProbe();
      const app = document.querySelector('fire-app') as HTMLElement & { showToast?: (t: string) => void };
      app?.showToast?.('取色探针：请在视图中点击未过火植被');
    });
    this.on(this.q('[data-act="sample"]')!, 'click', async () => {
      const app = document.querySelector('fire-app') as HTMLElement & { loadSample?: () => Promise<void> };
      await app?.loadSample?.();
    });
    this.on(this.q('[data-act="next"]')!, 'click', () => {
      (document.querySelector('fire-app') as HTMLElement & { selectModule?: (m: string) => void })?.selectModule?.('detect');
    });
  }

  private setupDrop(el: Element | null, kind: 'imagery' | 'dem'): void {
    if (!el) return;
    this.on(el, 'dragover', (ev) => {
      ev.preventDefault();
      el.classList.add('over');
    });
    this.on(el, 'dragleave', () => el.classList.remove('over'));
    this.on(el, 'drop', (ev) => {
      ev.preventDefault();
      el.classList.remove('over');
      const file = ev.dataTransfer?.files?.[0];
      if (!file) return;
      if (kind === 'imagery') void this.importImagery(file);
      else void this.importDem(file);
    });
  }

  private async importImagery(file: File): Promise<void> {
    try {
      this.store.setStatus(`正在读取影像 ${file.name}…`, 'info');
      const raster = await loadRasterImage(file);
      await this.store.setImagery(raster.name, raster.data, raster.width, raster.height, { spanX: this.store.project.georef.maxX - this.store.project.georef.minX || 1200 });
      const app = document.querySelector('fire-app') as HTMLElement & { showToast?: (t: string) => void };
      app?.showToast?.(`影像已导入：${file.name}`);
    } catch (err) {
      console.error(err);
      this.store.setStatus('影像读取失败', 'error', String(err));
    }
  }

  private async importDem(file: File): Promise<void> {
    try {
      this.store.setStatus(`正在解析高程 ${file.name}…`, 'info');
      if (/\.(asc|txt)$/i.test(file.name)) {
        const text = await file.text();
        const { grid, georef } = parseEsriAscii(text, file.name);
        this.store.setDem(grid.name, grid, georef as { minX: number; minY: number; maxX: number; maxY: number });
        const app = document.querySelector('fire-app') as HTMLElement & { showToast?: (t: string) => void };
        app?.showToast?.(`高程已导入：${file.name}`);
      } else if (file.type.startsWith('image/')) {
        const grid = await demFromImage(file, 300, 900);
        this.store.setDem(grid.name, grid);
      } else {
        this.store.setStatus('不支持的高程格式', 'warn', '请使用 .asc / .txt 或灰度图');
      }
    } catch (err) {
      console.error(err);
      this.store.setStatus('高程解析失败', 'error', String(err));
    }
  }

  private syncForm(): void {
    const p = this.store.project;
    const img = p.imagery;
    const dem = p.dem;

    const hasImg = !!img;
    const autoBtn = this.q<HTMLButtonElement>('[data-act="auto-ref"]');
    if (autoBtn) autoBtn.disabled = !hasImg;
    const probeBtn = this.q<HTMLButtonElement>('[data-act="probe"]');
    if (probeBtn) probeBtn.disabled = !hasImg;

    const imgCard = this.q('.imagery-card');
    if (imgCard) {
      if (img) {
        const thumbUrl = this.thumbUrl(img.data, img.width, img.height);
        imgCard.innerHTML = `<div class="filecard">
          <img class="thumb" src="${thumbUrl}" alt="" />
          <div class="meta">
            <div class="nm">${esc(img.name)}</div>
            <div class="sub">${img.width}×${img.height} · ${((p.georef.maxX - p.georef.minX) / img.width).toFixed(2)} m/px</div>
          </div>
          <span class="badge on">已载入</span>
          <button class="btn sm ghost" data-act="clear-img" title="移除影像">✕</button>
        </div>`;
        imgCard.querySelector('[data-act="clear-img"]')?.addEventListener('click', () => this.store.clearImagery());
      } else {
        imgCard.innerHTML = `<div class="filecard" style="opacity:.6">
          <div class="ico">🛰</div><div class="meta"><div class="nm">尚未导入影像</div><div class="sub">—</div></div>
          <span class="badge off">空</span>
        </div>`;
      }
    }

    const demCard = this.q('.dem-card');
    if (demCard) {
      if (dem) {
        demCard.innerHTML = `<div class="filecard">
          <div class="ico">⛰</div>
          <div class="meta">
            <div class="nm">${esc(dem.name)}</div>
            <div class="sub">${dem.width}×${dem.height} · ${dem.minElev.toFixed(0)}–${dem.maxElev.toFixed(0)} m</div>
          </div>
          <span class="badge on">已载入</span>
          <button class="btn sm ghost" data-act="clear-dem" title="移除高程">✕</button>
        </div>`;
        demCard.querySelector('[data-act="clear-dem"]')?.addEventListener('click', () => this.store.clearDem());
      } else {
        demCard.innerHTML = `<div class="filecard" style="opacity:.6">
          <div class="ico">⛰</div><div class="meta"><div class="nm">尚未导入高程</div><div class="sub">贴地渲染将使用平面</div></div>
          <span class="badge off">可选</span>
        </div>`;
      }
    }

    const crs = this.q<HTMLSelectElement>('.geo-crs');
    if (crs) crs.value = p.georef.crs;
    const lon = this.q<HTMLInputElement>('.geo-lon');
    if (lon && document.activeElement !== lon) lon.value = p.georef.lon0.toFixed(6);
    const lat = this.q<HTMLInputElement>('.geo-lat');
    if (lat && document.activeElement !== lat) lat.value = p.georef.lat0.toFixed(6);
    const span = this.q<HTMLInputElement>('.geo-span');
    if (span && document.activeElement !== span) span.value = String(Math.round(p.georef.maxX - p.georef.minX));
    const dims = this.q('.geo-dims');
    if (dims) dims.textContent = img ? `${Math.round(p.georef.maxX - p.georef.minX)} × ${Math.round(p.georef.maxY - p.georef.minY)} m` : '—';

    const probeState = this.q('.probe-state');
    if (probeState) probeState.textContent = this.store.probing ? '等待点击…' : '';
    const ref = this.q<HTMLInputElement>('.ref-color');
    if (ref) ref.value = rgbToHex(p.referenceColor.r, p.referenceColor.g, p.referenceColor.b);
    const hex = this.q('.ref-hex');
    if (hex) hex.textContent = rgbToHex(p.referenceColor.r, p.referenceColor.g, p.referenceColor.b);
    void safeFilename;
  }

  private thumbUrl(data: Uint8ClampedArray, w: number, h: number): string {
    const canvas = document.createElement('canvas');
    const s = Math.min(1, 112 / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * s));
    canvas.height = Math.max(1, Math.round(h * s));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const full = document.createElement('canvas');
    full.width = w;
    full.height = h;
    full.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  private banner(text: string): void {
    const el = this.q('.note');
    if (el) el.textContent = text;
    this.store.setStatus(text, 'info');
  }
}

customElements.define('bt-import-panel', BtImportPanel);
