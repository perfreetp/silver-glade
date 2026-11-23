/** 模块 04：面积统计（分级面积、占比、剖面图、GeoJSON 导出）。 */

import { BtElement, esc } from '../app/base.ts';
import type { AppStore } from '../app/store.ts';
import { formatArea, formatLength } from '../core/util.ts';
import { boundaryToGeoJSON, exportFilename } from '../core/project.ts';
import { SEVERITY_CLASSES } from '../core/theme.ts';

export class BtStatsPanel extends BtElement {
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
      .hero { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .hero .big {
        border: 1px solid var(--line); border-radius: 9px; padding: 11px 12px;
        background: linear-gradient(160deg,#18222c,#121a22);
      }
      .hero .big .k { font-size: 10px; color: var(--text-faint); letter-spacing: .06em; }
      .hero .big .v { font-family: var(--mono); font-size: 17px; margin-top: 4px; letter-spacing: -.01em; white-space: nowrap; }
      .hero .big .s { font-size: 10px; color: var(--text-dim); font-family: var(--mono); margin-top: 2px; }
      .bins { display: grid; gap: 7px; }
      .bin {
        display: grid; grid-template-columns: 10px 1fr auto; gap: 8px; align-items: center;
        padding: 7px 8px; border-radius: 7px; background: var(--panel-2); border: 1px solid var(--line-soft);
      }
      .bin .sw { width: 10px; height: 24px; border-radius: 3px; }
      .bin .nm { font-size: 11.5px; }
      .bin .bar { display: block; height: 4px; border-radius: 3px; background: #22303d; margin-top: 4px; overflow: hidden; }
      .bin .bar i { display: block; height: 100%; border-radius: 3px; }
      .bin .val { font-family: var(--mono); font-size: 11.5px; text-align: right; white-space: nowrap; }
      .bin .val small { display: block; font-size: 9.5px; color: var(--text-faint); }
      .donut-wrap { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .donut-wrap .mins { min-width: 130px; }
      .donut { width: 104px; height: 104px; flex: none; }
      .chart { display: block; border-radius: 7px; background: rgba(13,19,25,.6); border: 1px solid var(--line-soft); }
      .thresh-list { display: grid; gap: 8px; }
      .thresh-row { display: grid; grid-template-columns: 44px 1fr 44px; gap: 8px; align-items: center; font-size: 11px; font-family: var(--mono); color: var(--text-faint); }
      .thresh-row input[type=range] { height: 16px; }
      .exp-grid { display: grid; gap: 7px; }
      .exp-grid label.row { font-size: 11.5px; color: var(--text-dim); }
      .placeh {
        text-align: center; padding: 30px 14px; font-size: 11.5px; line-height: 1.7; color: var(--text-faint);
        border: 1px dashed var(--line); border-radius: 9px;
      }
      .placeh b { color: var(--text-dim); display: block; font-size: 12px; margin-bottom: 4px; }
      .spot-card { border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; background: var(--panel-2); font-size: 11px; }
      .legend-inline { display: flex; flex-wrap: wrap; gap: 5px 10px; font-size: 10px; color: var(--text-faint); }
      .legend-inline span { display: inline-flex; align-items: center; gap: 4px; }
      .legend-inline i { width: 8px; height: 8px; border-radius: 2px; }
      .export-note { font-size: 10.5px; color: var(--text-faint); line-height: 1.6; }
    `)}
    <div class="stack">
      <h3 class="sec">迹地概况</h3>
      <div class="hero">
        <div class="big"><div class="k">迹地面积</div><div class="v area-v">—</div><div class="s area-s"></div></div>
        <div class="big"><div class="k">边界周长</div><div class="v perim-v">—</div><div class="s perim-s"></div></div>
      </div>
      <div class="kv"><span class="k">平均受损等级</span><span class="v mean-cls">—</span></div>
      <div class="kv"><span class="k">平均过火指数</span><span class="v mean-idx">—</span></div>
      <div class="kv"><span class="k">中度及以上占比</span><span class="v mod-frac">—</span></div>
      <div class="kv"><span class="k">环 / 顶点 / 三角面</span><span class="v geom-v">—</span></div>

      <h3 class="sec">分级构成</h3>
      <div class="donut-wrap">
        <canvas class="donut"></canvas>
        <div class="grow mins"></div>
      </div>

      <div class="bins"></div>

      <h3 class="sec">边界剖面</h3>
      <canvas class="chart"></canvas>
      <div class="legend-inline chart-legend">
        <span><i style="background:#5eb0d8"></i>高程</span>
        <span><i style="background:#ff7a3d"></i>过火指数</span>
      </div>
      <div class="hint">沿外边界取 96 个采样点，显示贴地高程与过火指数的变化。</div>

      <h3 class="sec">点击查询</h3>
      <div class="spot-card">
        <div class="row" style="justify-content:space-between"><span class="muted">当前点位</span><span class="spot-pos mono faint">未选择</span></div>
        <div class="spot-grid" style="margin-top:6px"></div>
      </div>

      <h3 class="sec">分级阈值</h3>
      <div class="thresh-list"></div>
      <div class="hint">拖动阈值调整 5 级划分，分级填充会实时更新。</div>

      <h3 class="sec">导出</h3>
      <div class="exp-grid">
        <label class="row"><input type="checkbox" class="exp-sev" checked /><span>包含受损分级属性</span></label>
        <button class="btn primary block" data-act="export">导出 GeoJSON</button>
        <button class="btn block ghost" data-act="copy">复制 GeoJSON 到剪贴板</button>
        <div class="export-note"></div>
      </div>

      <div class="placeh" hidden>
        <b>还没有可统计的边界</b>
        先在「边界提取」中提取火场轮廓。
      </div>
    </div>`;
  }

  protected override mountedCallback(): void {
    this.syncAll();
    for (const ev of ['boundary', 'severity', 'project', 'detect', 'selection'] as const) {
      this.cleanup.push(this.store.on(ev, () => this.syncAll()));
    }
    this.on(this.q('[data-act="export"]')!, 'click', () => this.exportGeoJSON());
    this.on(this.q('[data-act="copy"]')!, 'click', () => void this.copyGeoJSON());
  }

  private exportGeoJSON(): void {
    const p = this.store.project;
    if (p.boundary.length === 0) {
      this.store.setStatus('还没有边界可以导出', 'warn');
      return;
    }
    const includeSev = this.q<HTMLInputElement>('.exp-sev')?.checked ?? true;
    const json = boundaryToGeoJSON(p, this.store.summary, { includeSeverity: includeSev, precision: 3 });
    const blob = new Blob([json], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename(p, 'geojson');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    this.store.setStatus(`已导出 ${exportFilename(p, 'geojson')}（${(blob.size / 1024).toFixed(1)} KB）`, 'ok');
  }

  private async copyGeoJSON(): Promise<void> {
    const p = this.store.project;
    if (p.boundary.length === 0) {
      this.store.setStatus('还没有边界可以复制', 'warn');
      return;
    }
    const json = boundaryToGeoJSON(p, this.store.summary);
    try {
      await navigator.clipboard.writeText(json);
      this.store.setStatus('GeoJSON 已复制到剪贴板', 'ok');
    } catch {
      this.store.setStatus('复制失败：浏览器拒绝剪贴板访问', 'warn');
    }
  }

  private syncAll(): void {
    const p = this.store.project;
    const d = this.store.derived;
    const sum = this.store.summary;
    const has = p.boundary.length > 0;

    const set = (sel: string, text: string) => {
      const el = this.q(sel);
      if (el) el.textContent = text;
    };
    set('.area-v', d ? formatArea(d.area) : '—');
    set('.area-s', d ? `${(d.area / 1e4).toFixed(3)} 公顷` : '');
    set('.perim-v', d ? formatLength(d.perimeter) : '—');
    set('.perim-s', d ? `${d.perimeter.toFixed(0)} m` : '');
    set(
      '.mean-cls',
      sum ? `${sum.meanClass.toFixed(2)} / 4 · ${SEVERITY_CLASSES[Math.min(4, Math.max(0, Math.round(sum.meanClass)))].label}` : '—',
    );
    set('.mean-idx', sum ? sum.meanIndex.toFixed(3) : '—');
    set('.mod-frac', sum ? `${(sum.moderatePlusFraction * 100).toFixed(1)}%` : '—');
    set('.geom-v', d ? `${d.ringCount} / ${d.vertexCount} / ${d.mesh.indices.length / 3}` : '—');

    const bins = this.q('.bins');
    if (bins) {
      const list = sum?.bins ?? SEVERITY_CLASSES.map((c) => ({ ...c, area: 0, fraction: 0, meanIndex: 0 }));
      bins.innerHTML = list
        .map(
          (b) => `<div class="bin">
            <span class="sw" style="background:${b.color}"></span>
            <span>
              <span class="nm">${esc(b.label)}</span>
              <span class="bar"><i style="width:${(b.fraction * 100).toFixed(1)}%;background:${b.color}"></i></span>
            </span>
            <span class="val">${b.area > 0 ? formatArea(b.area) : '—'}<small>${(b.fraction * 100).toFixed(1)}%</small></span>
          </div>`,
        )
        .join('');
    }

    this.drawDonut();
    this.drawProfile();
    this.drawSpot();
    this.drawThresholds();
    this.scheduleChartResize();

    const ph = this.q('.placeh') as HTMLElement | null;
    ph?.toggleAttribute('hidden', has);
    this.qa<HTMLElement>('.hero, .bins, .donut-wrap, .chart, .chart-legend, .thresh-list, .spot-card').forEach((el) =>
      el.toggleAttribute('hidden', !has),
    );
    const note = this.q('.export-note');
    if (note) {
      note.textContent = `CRS：${p.georef.crs === 'wgs84' ? 'WGS84 / CRS84（经纬度）' : '本地平面坐标'}；文件含边界多边形、面积周长与分级统计。`;
    }
  }

  private resizeObserver: ResizeObserver | null = null;
  private chartTimer = 0;

  /** 面板宽度变化后重绘图表（避免被裁切） */
  private scheduleChartResize(): void {
    if (this.resizeObserver) return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.chartTimer) cancelAnimationFrame(this.chartTimer);
      this.chartTimer = requestAnimationFrame(() => {
        this.chartTimer = 0;
        this.drawProfile();
        this.drawDonut();
      });
    });
    this.resizeObserver.observe(this);
    this.cleanup.push(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      if (this.chartTimer) cancelAnimationFrame(this.chartTimer);
    });
  }

  private prepCanvas(sel: string, cssW: number, cssH: number): CanvasRenderingContext2D | null {
    const canvas = this.q<HTMLCanvasElement>(sel);
    if (!canvas) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    return ctx;
  }

  private drawDonut(): void {
    const width = 104;
    const ctx = this.prepCanvas('.donut', width, width);
    if (!ctx) return;
    const sum = this.store.summary;
    const cx = width / 2;
    const cy = width / 2;
    const r = width / 2 - 9;
    const bins = sum?.bins ?? [];
    const total = bins.reduce((s, b) => s + b.area, 0);
    if (total <= 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#22303d';
      ctx.lineWidth = 13;
      ctx.stroke();
    } else {
      let a0 = -Math.PI / 2;
      for (const b of bins) {
        if (b.area <= 0) continue;
        const a1 = a0 + (b.area / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, Math.min(a1, a0 + Math.PI * 2));
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 13;
        ctx.lineCap = 'butt';
        ctx.stroke();
        a0 = a1;
      }
    }
    ctx.fillStyle = '#e6edf3';
    ctx.textAlign = 'center';
    ctx.font = '600 21px ui-monospace, monospace';
    ctx.fillText(sum ? sum.meanClass.toFixed(1) : '—', cx, cy + 3);
    ctx.fillStyle = '#93a4b3';
    ctx.font = '9.5px sans-serif';
    ctx.fillText('平均等级', cx, cy + 16);

    const mins = this.q('.mins');
    if (mins) {
      mins.innerHTML = `<div class="kv"><span class="k">过火指数均值</span><span class="v">${sum ? sum.meanIndex.toFixed(3) : '—'}</span></div>
        <div class="kv"><span class="k">中度以上</span><span class="v">${sum ? (sum.moderatePlusFraction * 100).toFixed(1) + '%' : '—'}</span></div>
        <div class="kv"><span class="k">覆盖面积</span><span class="v">${sum ? formatArea(sum.totalArea) : '—'}</span></div>`;
    }
  }

  private drawProfile(): void {
    const host = this.getBoundingClientRect();
    const W = Math.max(240, Math.round(host.width - 24));
    const H = Math.round(Math.min(150, Math.max(104, W * 0.40)));
    const ctx = this.prepCanvas('.chart', W, H);
    if (!ctx) return;
    const rings = this.store.project.boundary;
    const field = this.store.field;
    const outer = rings.filter((r) => r.role === 'outer').flatMap((r) => r.vertices);
    if (outer.length < 2 || !field) {
      ctx.fillStyle = '#4a5a68';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('无数据', W / 2, H / 2);
      return;
    }
    const N = 96;
    const samples: { x: number; y: number }[] = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * outer.length;
      const k = Math.floor(t) % outer.length;
      const f = t - Math.floor(t);
      const a = outer[k];
      const b = outer[(k + 1) % outer.length];
      samples.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    }
    const elevations = samples.map((s) => this.sceneElev(s.x, s.y));
    const indices = samples.map((s) => this.burn(s.x, s.y));
    const padL = 32;
    const padR = 8;
    const padT = 10;
    const padB = 18;
    const iw = W - padL - padR;
    const ih = H - padT - padB;
    const minE = Math.min(...elevations);
    const maxE = Math.max(...elevations);
    const rangeE = Math.max(1, maxE - minE);
    const X = (i: number) => padL + (i / (N - 1)) * iw;

    ctx.strokeStyle = '#1f2b36';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = padT + (ih * g) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + iw, y);
      ctx.stroke();
    }
    // 高程面积
    ctx.beginPath();
    elevations.forEach((e, i) => {
      const y = padT + ih * (1 - (e - minE) / rangeE);
      if (i === 0) ctx.moveTo(X(i), y);
      else ctx.lineTo(X(i), y);
    });
    ctx.lineTo(X(N - 1), padT + ih);
    ctx.lineTo(X(0), padT + ih);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, 'rgba(94,176,216,.30)');
    grad.addColorStop(1, 'rgba(94,176,216,.02)');
    ctx.fillStyle = grad;
    ctx.fill();
    // 高程线
    ctx.beginPath();
    elevations.forEach((e, i) => {
      const y = padT + ih * (1 - (e - minE) / rangeE);
      if (i === 0) ctx.moveTo(X(i), y);
      else ctx.lineTo(X(i), y);
    });
    ctx.strokeStyle = '#5eb0d8';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // 过火指数
    ctx.beginPath();
    indices.forEach((v, i) => {
      const y = padT + ih * (1 - Math.min(1, Math.max(0, v)));
      if (i === 0) ctx.moveTo(X(i), y);
      else ctx.lineTo(X(i), y);
    });
    ctx.strokeStyle = '#ff7a3d';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = '#6b7d8c';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${maxE.toFixed(0)}`, padL - 4, padT + 7);
    ctx.fillText(`${minE.toFixed(0)}`, padL - 4, padT + ih);
    ctx.textAlign = 'center';
    ctx.fillText('起点', X(0), H - 4);
    ctx.fillText('沿外边界一周', W / 2, H - 4);
    ctx.fillText('回到起点', X(N - 1), H - 4);
  }

  private sceneElev(x: number, y: number): number {
    try {
      return this.store.viewer?.elevationAt(x, y) ?? 0;
    } catch {
      return 0;
    }
  }

  private burn(x: number, y: number): number {
    const field = this.store.field;
    if (!field) return 0;
    const g = field.georef;
    const u = ((x - g.minX) / (g.maxX - g.minX || 1)) * (field.width - 1);
    const v = ((g.maxY - y) / (g.maxY - g.minY || 1)) * (field.height - 1);
    const x0 = Math.min(field.width - 1, Math.max(0, Math.floor(u)));
    const y0 = Math.min(field.height - 1, Math.max(0, Math.floor(v)));
    return field.values[y0 * field.width + x0];
  }

  private drawSpot(): void {
    const el = this.q('.spot-grid');
    if (!el) return;
    const viewer = this.store.viewer;
    const s = viewer?.spot;
    if (!s || !viewer) {
      el.innerHTML = `<span class="hint">在三维视图内点击迹地范围，即可在此显示坡度、高程与受损等级。</span>`;
      const pos = this.q('.spot-pos');
      pos?.replaceChildren(document.createTextNode('未选择'));
      return;
    }
    const info = viewer.spotInfo(s.x, s.y);
    const cls = SEVERITY_CLASSES[info.classIndex] ?? SEVERITY_CLASSES[0];
    this.q('.spot-pos')?.replaceChildren(document.createTextNode(`${info.x.toFixed(1)}, ${info.y.toFixed(1)} m`));
    el.innerHTML = `
      <div class="kv"><span class="k">坡度</span><span class="v">${info.slope.toFixed(1)}°</span></div>
      <div class="kv"><span class="k">高程</span><span class="v">${info.elevation.toFixed(1)} m</span></div>
      <div class="kv"><span class="k">过火指数</span><span class="v">${info.severity.toFixed(3)}</span></div>
      <div class="kv"><span class="k">受损等级</span><span class="v" style="color:${cls.color}">${esc(cls.label)}</span></div>
      <div class="kv"><span class="k">距边界</span><span class="v">${formatLength(info.distance)}</span></div>`;
  }

  private drawThresholds(): void {
    const el = this.q('.thresh-list');
    if (!el) return;
    const th = this.store.project.severity.thresholds;
    el.innerHTML = th
      .map(
        (t, i) => `<label class="thresh-row">
          <span>第 ${i + 1} 级</span>
          <input type="range" min="0.05" max="0.95" step="0.01" value="${t}" data-th="${i}" />
          <span style="text-align:right">${t.toFixed(2)}</span>
        </label>`,
      )
      .join('');
    el.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
      input.addEventListener('input', () => {
        const idx = Number(input.dataset.th);
        const next = [...this.store.project.severity.thresholds] as [number, number, number, number];
        next[idx] = Number(input.value);
        next.sort((a, b) => a - b);
        this.store.setSeveritySettings({ thresholds: next });
      });
    });
  }
}

customElements.define('bt-stats-panel', BtStatsPanel);
