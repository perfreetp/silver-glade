import type { EventBus } from '../core/EventBus';
import type { MachineManager } from '../core/MachineManager';
import type { MachineConfig } from '../core/types';
import { TERRAIN } from '../core/constants';
import { panelStyles, setSlider, slider } from './panelBase';

/**
 * 模块一面板：造雪机摆放与朝向。
 * 双击坡面可快速摆放；本面板负责列表、选中、删除以及位置/朝向数值微调。
 */
export class MachinePanel extends HTMLElement {
  private bus!: EventBus;
  private manager!: MachineManager;
  private listEl!: HTMLUListElement;
  private sliders!: Record<'x' | 'z' | 'yaw' | 'pitch', { input: HTMLInputElement; value: HTMLSpanElement }>;
  private deleteBtn!: HTMLButtonElement;
  private addBtn!: HTMLButtonElement;

  connect(bus: EventBus, manager: MachineManager): void {
    this.bus = bus;
    this.manager = manager;
    this.render();
    bus.on('machine:list-changed', () => this.refresh());
    bus.on('machine:select', () => this.refresh());
    bus.on('machine:transform', (p) => {
      const sel = this.manager.selectedId;
      if (sel === p.id) this.syncSliders();
    });
    this.refresh();
  }

  private render(): void {
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = /* html */ `
      <style>${panelStyles}</style>
      <h2>① 造雪机摆放与朝向 <span class="badge" id="count"></span></h2>
      <div class="row">
        <button id="add">＋ 坡面随机摆放</button>
        <button id="delete" class="danger">删除选中</button>
      </div>
      <p class="muted" style="margin:8px 0 0">双击坡面空白处也可就地摆放；拖动机器移动位置；Q/E 转朝向，R/F 调俯仰。</p>
      <ul class="machines" id="list"></ul>

      <label>位置 X（横向，米）<span class="val" style="float:right" id="x-val"></span></label>
      <input type="range" id="x" />
      <label>位置 Z（顺坡，米）<span class="val" style="float:right" id="z-val"></span></label>
      <input type="range" id="z" />
      <label>水平朝向 Yaw（度，0 = 顺坡向下）<span class="val" style="float:right" id="yaw-val"></span></label>
      <input type="range" id="yaw" />
      <label>炮口俯仰 Pitch（度）<span class="val" style="float:right" id="pitch-val"></span></label>
      <input type="range" id="pitch" />
    `;

    this.listEl = shadow.getElementById('list') as HTMLUListElement;
    this.addBtn = shadow.getElementById('add') as HTMLButtonElement;
    this.deleteBtn = shadow.getElementById('delete') as HTMLButtonElement;

    this.sliders = {
      x: slider(shadow, 'x', -TERRAIN.WIDTH / 2, TERRAIN.WIDTH / 2, 0.5, 0, (v) => this.patch({ x: v })),
      z: slider(shadow, 'z', -TERRAIN.LENGTH / 2, TERRAIN.LENGTH / 2, 0.5, 0, (v) => this.patch({ z: v })),
      yaw: slider(shadow, 'yaw', 0, 360, 1, 0, (v) => this.patch({ yaw: v })),
      pitch: slider(shadow, 'pitch', 5, 60, 1, 28, (v) => this.patch({ pitch: v })),
    };

    this.addBtn.addEventListener('click', () => {
      const x = (Math.random() - 0.5) * (TERRAIN.WIDTH - 12);
      const z = (Math.random() - 0.5) * (TERRAIN.LENGTH - 20);
      this.bus.emit('machine:add', { x, z });
    });
    this.deleteBtn.addEventListener('click', () => {
      if (this.manager.selectedId != null) this.bus.emit('machine:delete', { id: this.manager.selectedId });
    });
  }

  private patch(p: Partial<Pick<MachineConfig, 'x' | 'z' | 'yaw' | 'pitch'>>): void {
    const id = this.manager.selectedId;
    if (id == null) return;
    const cfg = this.manager.updateTransform(id, p);
    if (!cfg) return;
    this.bus.emit('machine:transform', { id, x: cfg.x, z: cfg.z, yaw: cfg.yaw, pitch: cfg.pitch });
  }

  private syncSliders(): void {
    const cfg = this.manager.selectedId != null ? this.manager.get(this.manager.selectedId) : undefined;
    const disabled = !cfg;
    for (const key of ['x', 'z', 'yaw', 'pitch'] as const) {
      this.sliders[key].input.disabled = disabled;
    }
    this.deleteBtn.disabled = disabled;
    if (!cfg) return;
    setSlider(this.sliders.x.input, this.sliders.x.value, Math.round(cfg.x * 10) / 10);
    setSlider(this.sliders.z.input, this.sliders.z.value, Math.round(cfg.z * 10) / 10);
    setSlider(this.sliders.yaw.input, this.sliders.yaw.value, Math.round(cfg.yaw));
    setSlider(this.sliders.pitch.input, this.sliders.pitch.value, Math.round(cfg.pitch));
  }

  private refresh(): void {
    const machines = this.manager.list();
    (this.shadowRoot!.getElementById('count') as HTMLElement).textContent = `${machines.length} 台`;
    this.listEl.innerHTML = '';
    for (const m of machines) {
      const li = document.createElement('li');
      li.className = m.id === this.manager.selectedId ? 'selected' : '';
      li.innerHTML = `<span>#${m.id} 造雪机</span><span class="chip">${m.level} 档 · 风${Math.round(m.wind.direction)}°</span>`;
      li.addEventListener('click', () => {
        this.manager.select(m.id);
        this.bus.emit('machine:select', { id: m.id });
      });
      this.listEl.appendChild(li);
    }
    this.syncSliders();
  }
}
