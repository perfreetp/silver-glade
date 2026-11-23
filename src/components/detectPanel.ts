/** 模块 02：边界提取（阈值、碎片过滤、平滑，提取前后对比）。 */

import { BtElement, esc } from '../app/base.ts';
import type { AppStore } from '../app/store.ts';
import { BURN_RAMP } from '../core/theme.ts';
import { fieldToCanvas, extractBoundary } from '../core/detect.ts';
import { formatArea } from '../core/util.ts';

export class BtDetectPanel extends BtElement {
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
      .preview {
        position: relative; border-radius: 8px; overflow: hidden; border: 1px solid var(--line);
        background: #0d1319; aspect-ratio: 4 / 3;
      }
      .preview canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
      .preview .pv-note {
        position: absolute; left: 6px; bottom: 6px; font-size: 9.5px; color: #cfd9e2;
        background: rgba(8,12,16,.75); padding: 2px 6px; border-radius: 4px; font-family: var(--mono);
      }
      .ramp { height: 8px; border-radius: 4px; margin-top: 7px; }
      .ramp-labels { display: flex; justify-content: space-between; font-size: 9.5px; color: var(--text-faint); font-family: var(--mono); margin-top: 3px; }
      .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
      .stat {
        background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 8px 9px;
      }
      .stat .k { font-size: 9.5px; color: var(--text-faint); letter-spacing: .04em; }
      .stat .v { font-family: var(--mono); font-size: 13px; margin-top: 3px; font-variant-numeric: tabular-nums; }
      .stat .v small { font-size: 9.5px; color: var(--text-faint); margin-left: 2px; }
      ol.pipeline { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
      ol.pipeline li {
        display: flex; gap: 8px; align-items: flex-start; font-size: 11px; color: var(--text-dim); line-height: 1.5;
      }
      ol.pipeline .b {
        flex: none; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center;
        font-size: 9px; font-family: var(--mono); background: #22303d; color: var(--text-dim); margin-top: 1px;
      }
      ol.pipeline li.ok .b { background: rgba(95,207,138,.16); color: var(--ok); }
      ol.pipeline li.run .b { background: rgba(255,122,61,.16); color: var(--accent); }
      .threshold-scale { position: relative; }
      .live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 0 rgba(95,207,138,.6); animation: pulse 1.6s infinite; }
      @keyframes pulse { 70% { box-shadow: 0 0 0 6px rgba(95,207,138,0); } 100% { box-shadow: 0 0 0 0 rgba(95,207,138,0); } }
      .big-btn {
        display: flex; align-items: center; justify-content: center; gap: 9px; padding: 11px;
        font-size: 13px; font-weight: 600;
      }
      .res-warn {
        font-size: 11px; line-height: 1.55; color: #f0c983; background: rgba(229,182,74,.08);
        border: 1px solid rgba(229,182,74,.24); border-radius: 7px; padding: 8px 10px;
      }
    `)}
    <div class="stack">
      <h3 class="sec">过火指数场</h3>
      <div class="preview"><canvas class="field-canvas"></canvas><span class="pv-note">颜色差异 · 红色为高置信过火</span></div>
      <div class="ramp" style="background:linear-gradient(90deg,${BURN_RAMP.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`).join(',')})"></div>
      <div class="ramp-labels"><span>0.0 未过火</span><span>1.0 重度</span></div>

      <h3 class="sec">提取参数</h3>
      <label class="field">
        <span class="lab"><span>颜色差异阈值</span><span class="val threshold-val">0.36</span></span>
        <input type="range" class="threshold-range" min="0.05" max="0.95" step="0.01" />
      </label>
      <label class="field">
        <span class="lab"><span>碎片过滤阈值</span><span class="val minarea-val">120 m²</span></span>
        <input type="range" class="minarea-range" min="0" max="3000" step="10" />
      </label>
      <label class="field">
        <span class="lab"><span>轮廓平滑</span><span class="val smooth-val">1.2 m</span></span>
        <input type="range" class="smooth-range" min="0" max="8" step="0.1" />
      </label>

      <button class="btn primary block big-btn" data-act="extract">
        <span class="spin-out" hidden><span class="spin"></span></span>
        <span class="btn-label">提取火场边界</span>
      </button>
      <div class="row" style="gap:7px">
        <button class="btn sm grow" data-act="auto-tune">自动调参</button>
        <button class="btn sm grow ghost" data-act="clear-b">清空边界</button>
      </div>

      <div class="res-warn" hidden></div>

      <h3 class="sec">处理管线</h3>
      <ol class="pipeline">
        <li data-step="field"><span class="b">1</span><span>颜色差异场：亮度下降 / 绿度损失 / 色相偏移 / 灰烬低饱和</span></li>
        <li data-step="contour"><span class="b">2</span><span>Marching squares 等值线提取，贴边迹地沿影像边缘闭合</span></li>
        <li data-step="bool"><span class="b">3</span><span>manifold-3d 布尔并集与分解：消除自交、合并重叠</span></li>
        <li data-step="frag"><span class="b">4</span><span>按面积剔除碎片，保留主火场</span></li>
      </ol>

      <h3 class="sec">提取结果</h3>
      <div class="stat-grid extract-stats"></div>

      <div class="row" style="margin-top:6px">
        <button class="btn block ghost" data-act="to-edit">进入修边编辑 →</button>
      </div>
    </div>`;
  }

  protected override mountedCallback(): void {
    this.syncForm();
    this.cleanup.push(this.store.on('detect', () => this.syncForm()));
    this.cleanup.push(this.store.on('imagery', () => this.syncForm()));
    this.cleanup.push(this.store.on('boundary', () => this.syncForm()));
    this.cleanup.push(this.store.on('status', () => this.syncForm()));

    const th = this.q<HTMLInputElement>('.threshold-range');
    if (th) {
      this.on(th, 'input', () => {
        this.store.updateDetect({ threshold: Number(th.value) });
      });
    }
    const ma = this.q<HTMLInputElement>('.minarea-range');
    if (ma) this.on(ma, 'input', () => this.store.updateDetect({ minArea: Number(ma.value) }));
    const sm = this.q<HTMLInputElement>('.smooth-range');
    if (sm) this.on(sm, 'input', () => this.store.updateDetect({ smoothing: Number(sm.value) }));

    this.on(this.q('[data-act="extract"]')!, 'click', async () => {
      const ok = await this.ensureKernel();
      if (!ok) return;
      await this.store.runExtraction();
      this.syncForm();
    });
    this.on(this.q('[data-act="clear-b"]')!, 'click', () => {
      this.store.setBoundary([], '清空边界');
      this.store.select(null);
      this.syncForm();
    });
    this.on(this.q('[data-act="auto-tune"]')!, 'click', async () => {
      await this.autoTune();
    });
    this.on(this.q('[data-act="to-edit"]')!, 'click', () => {
      (document.querySelector('fire-app') as HTMLElement & { selectModule?: (m: string) => void })?.selectModule?.('edit');
    });
  }

  private async ensureKernel(): Promise<boolean> {
    if (this.store.kernel) return true;
    const app = document.querySelector('fire-app') as HTMLElement & { waitForKernel?: (t?: number) => Promise<boolean> };
    const ok = (await app?.waitForKernel?.(20000)) ?? false;
    if (!ok) this.store.setStatus('几何内核尚未就绪，请稍候重试', 'warn');
    return ok;
  }

  /** 自动调参：搜一遍阈值，取面积-置信度平衡最好的结果 */
  private async autoTune(): Promise<void> {
    if (!this.store.field) {
      this.store.setStatus('需要先导入影像', 'warn');
      return;
    }
    if (!(await this.ensureKernel())) return;
    const field = this.store.field;
    const kernel = this.store.kernel!;
    const span = this.store.project.georef;
    const fullArea = (span.maxX - span.minX) * (span.maxY - span.minY);
    let best: { t: number; score: number; area: number } | null = null;
    for (let t = 0.22; t <= 0.8; t += 0.04) {
      const res = await extractBoundary(kernel, field, { threshold: t, minArea: this.store.project.detect.minArea, smoothing: this.store.project.detect.smoothing });
      const area = res.stats.keptArea;
      if (area <= 0) continue;
      const frac = area / fullArea;
      // 期望火场占影像 3%..70%，越居中越好
      const center = Math.exp(-Math.pow((Math.log(Math.max(1e-6, frac)) - Math.log(0.14)) / 1.05, 2));
      const fragPenalty = 1 / (1 + res.stats.fragments * 0.12);
      const score = center * fragPenalty;
      if (!best || score > best.score) best = { t, score, area };
    }
    if (best) {
      this.store.updateDetect({ threshold: Number(best.t.toFixed(2)) });
      this.store.setStatus(`自动调参：阈值 ${best.t.toFixed(2)}，预计迹地 ${formatArea(best.area)}`, 'ok');
      this.syncForm();
    } else {
      this.store.setStatus('自动调参失败：影像中未找到明显的火场区域', 'warn');
    }
  }

  private syncForm(): void {
    const d = this.store.project.detect;
    const th = this.q<HTMLInputElement>('.threshold-range');
    if (th && document.activeElement !== th) th.value = String(d.threshold);
    const thv = this.q('.threshold-val');
    if (thv) thv.textContent = d.threshold.toFixed(2);
    const ma = this.q<HTMLInputElement>('.minarea-range');
    if (ma && document.activeElement !== ma) ma.value = String(d.minArea);
    const mav = this.q('.minarea-val');
    if (mav) mav.textContent = `${Math.round(d.minArea)} m²`;
    const sm = this.q<HTMLInputElement>('.smooth-range');
    if (sm && document.activeElement !== sm) sm.value = String(d.smoothing);
    const smv = this.q('.smooth-val');
    if (smv) smv.textContent = `${d.smoothing.toFixed(1)} m`;

    this.drawField();
    this.syncStats();
    this.syncPipeline();

    const btn = this.q<HTMLButtonElement>('[data-act="extract"]');
    if (btn) {
      btn.disabled = this.store.busy || !this.store.project.imagery;
      const label = btn.querySelector('.btn-label');
      if (label) label.textContent = this.store.busy ? '正在提取…' : '提取火场边界';
      const spin = btn.querySelector('.spin-out') as HTMLElement | null;
      if (spin) spin.toggleAttribute('hidden', !this.store.busy);
    }
    const clearBtn = this.q<HTMLButtonElement>('[data-act="clear-b"]');
    if (clearBtn) clearBtn.disabled = this.store.project.boundary.length === 0;

    const warn = this.q('.res-warn') as HTMLElement | null;
    const ex = this.store.extract;
    if (warn && ex) {
      const msgs: string[] = [];
      if (ex.stats.fragments > 0) msgs.push(`剔除 ${ex.stats.fragments} 个低于碎片阈值的区域`);
      if (ex.stats.selfIntersectionsBefore > 0) msgs.push(`原始等值线有 ${ex.stats.selfIntersectionsBefore} 处自交，已由布尔运算消解`);
      if (msgs.length > 0) {
        warn.textContent = msgs.join('；');
        warn.toggleAttribute('hidden', false);
      } else {
        warn.toggleAttribute('hidden', true);
      }
    } else {
      warn?.toggleAttribute('hidden', true);
    }
  }

  private syncStats(): void {
    const el = this.q('.extract-stats');
    if (!el) return;
    const d = this.store.derived;
    const ex = this.store.extract;
    const items = [
      { k: '保留火场数', v: ex ? String(ex.stats.keptGroups) : '—' },
      { k: '剔除碎片', v: ex ? String(ex.stats.fragments) : '—' },
      { k: '原始轮廓面积', v: ex ? formatArea(ex.stats.sourceArea) : '—' },
      { k: '规整后面积', v: d ? formatArea(d.area) : '—' },
      { k: '边界顶点', v: d ? String(d.vertexCount) : '—' },
      { k: '周长', v: d ? `${d.perimeter.toFixed(0)} m` : '—' },
    ];
    el.innerHTML = items
      .map((i) => `<div class="stat"><div class="k">${esc(i.k)}</div><div class="v">${esc(i.v)}</div></div>`)
      .join('');
  }

  private syncPipeline(): void {
    const done = this.store.project.boundary.length > 0;
    const hasField = !!this.store.field;
    const steps = this.qa('ol.pipeline li');
    steps.forEach((li) => {
      li.classList.remove('ok', 'run');
      const step = li.dataset.step;
      if (step === 'field') li.classList.toggle('ok', hasField);
      else if (step === 'contour') li.classList.toggle('ok', !!this.store.extract || done);
      else if (step === 'bool') li.classList.toggle('ok', done);
      else if (step === 'frag') li.classList.toggle('ok', done);
    });
  }

  private drawField(): void {
    const canvas = this.q<HTMLCanvasElement>('.field-canvas');
    if (!canvas) return;
    const field = this.store.field;
    if (!field) {
      const ctx = canvas.getContext('2d');
      canvas.width = 320;
      canvas.height = 240;
      if (ctx) {
        ctx.fillStyle = '#0f151b';
        ctx.fillRect(0, 0, 320, 240);
        ctx.fillStyle = '#4a5a68';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('导入影像后显示过火指数场', 160, 122);
      }
      return;
    }
    const src = fieldToCanvas(field, BURN_RAMP);
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(src, 0, 0);
  }
}

customElements.define('bt-detect-panel', BtDetectPanel);
