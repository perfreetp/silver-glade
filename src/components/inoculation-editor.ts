import { BaseComponent, panelCss } from './base';
import type { InoculationPoint } from '../sim/types';

/**
 * 接种点编辑器：
 *  - 列表显示所有接种点（格点坐标），可逐个删除；
 *  - 视图上左键点击截面可新增（由主程序调用 addAt）；
 *  - 增删后派发 points-change，触发整段重算。
 */
export class InoculationEditor extends BaseComponent {
  private points: InoculationPoint[] = [];
  private nextId = 1;

  constructor() {
    super();
    this.setHTML(
      `
      <h2>接种点编辑</h2>
      <div class="hint" style="margin-top:0">在左侧截面视图上<strong style="color:#c8d6e4">左键点击</strong>基质区域即可新增接种点；右键拖动平移、滚轮缩放。</div>
      <ul id="list" style="list-style:none;margin:10px 0;padding:0;max-height:180px;overflow:auto"></ul>
      <div class="row">
        <button id="add-random" style="flex:1">随机加 1 点</button>
        <button id="clear" class="danger" style="flex:1">全部清除</button>
      </div>
      `,
      panelCss +
        `
        li {
          display:flex; justify-content:space-between; align-items:center;
          padding:5px 8px; margin:4px 0; background:#10151a;
          border:1px solid #26303b; border-radius:6px; font-size:12.5px;
        }
        li .meta { color:#9fb0bf; font-variant-numeric:tabular-nums; }
        li button { padding:2px 8px; font-size:11.5px; }
        .empty { color:#6b7a88; padding:6px 4px; font-size:12px; }
        `,
    );
  }

  connectedCallback(): void {
    this.$('#add-random').addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('add-random', { bubbles: true, composed: true })),
    );
    this.$('#clear').addEventListener('click', () => {
      this.points = [];
      this.render();
      this.emitChange();
    });
  }

  setPoints(points: InoculationPoint[]): void {
    this.points = points.map((p) => ({ ...p }));
    this.nextId = points.reduce((m, p) => Math.max(m, p.id + 1), 1);
    this.render();
  }

  /** 新增一个接种点，返回是否成功（落在非基质区域会被拒绝）。 */
  addAt(gx: number, gy: number, valid: (x: number, y: number) => boolean): boolean {
    if (!valid(gx, gy)) return false;
    this.points.push({ id: this.nextId++, x: gx, y: gy });
    this.render();
    this.emitChange();
    return true;
  }

  addRandomPoint(valid: (x: number, y: number) => boolean, size: number): void {
    for (let attempt = 0; attempt < 400; attempt++) {
      const gx = Math.random() * size;
      const gy = Math.random() * size;
      if (valid(gx, gy)) {
        this.addAt(gx, gy, valid);
        return;
      }
    }
  }

  private removePoint(id: number): void {
    this.points = this.points.filter((p) => p.id !== id);
    this.render();
    this.emitChange();
  }

  private emitChange(): void {
    this.dispatchEvent(
      new CustomEvent('points-change', {
        detail: this.points.map((p) => ({ ...p })),
        bubbles: true,
        composed: true,
      }),
    );
  }

  private render(): void {
    const ul = this.$('#list');
    if (this.points.length === 0) {
      ul.innerHTML = `<li class="empty">暂无接种点，请在截面视图上点击添加</li>`;
      return;
    }
    ul.innerHTML = '';
    for (const p of this.points) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="meta">#${p.id}　格点 (${p.x.toFixed(1)}, ${p.y.toFixed(1)})</span>`;
      const btn = document.createElement('button');
      btn.className = 'danger';
      btn.textContent = '删除';
      btn.addEventListener('click', () => this.removePoint(p.id));
      li.appendChild(btn);
      ul.appendChild(li);
    }
  }
}
