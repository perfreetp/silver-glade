import type { EventBus } from '../core/EventBus';
import type { MachineManager } from '../core/MachineManager';
import type { SnowLevel } from '../core/types';
import { WIND } from '../core/constants';
import { panelStyles, setSlider, slider } from './panelBase';

const LEVEL_TEXT: Record<SnowLevel, string> = { 1: '小', 2: '中', 3: '大' };

/**
 * 模块二面板：雪量三档 + 风向/风速参数。
 * 风向变化即派发 wind:change，控制器据此联动重算
 * 炮口轨迹、在空飘移粒子、坡面堆积（三处同源）。
 */
export class ParameterPanel extends HTMLElement {
  private bus!: EventBus;
  private manager!: MachineManager;
  private segBtns!: HTMLButtonElement[];
  private dirSlider!: { input: HTMLInputElement; value: HTMLSpanElement };
  private speedSlider!: { input: HTMLInputElement; value: HTMLSpanElement };
  private applyAllBtn!: HTMLButtonElement;

  connect(bus: EventBus, manager: MachineManager): void {
    this.bus = bus;
    this.manager = manager;
    this.render();
    bus.on('machine:select', () => this.refresh());
    bus.on('machine:list-changed', () => this.refresh());
    bus.on('level:change', () => this.refresh());
    bus.on('wind:change', () => this.refresh());
    this.refresh();
  }

  private render(): void {
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = /* html */ `
      <style>${panelStyles}</style>
      <h2>② 雪量与风向参数 <span class="badge">作用于选中机</span></h2>

      <label>雪量档位（发射速率 / 初速）</label>
      <div class="seg" id="seg">
        <button data-level="1">① 小</button>
        <button data-level="2">② 中</button>
        <button data-level="3">③ 大</button>
      </div>

      <label>风向（度，0 = 顺坡向下，顺时针）<span class="val" style="float:right" id="wind-dir-val"></span></label>
      <input type="range" id="wind-dir" />
      <label>风速（m/s）<span class="val" style="float:right" id="wind-speed-val"></span></label>
      <input type="range" id="wind-speed" />

      <div class="row" style="margin-top:10px">
        <button id="apply-all">将当前风向应用到全部造雪机</button>
      </div>
      <p class="muted" style="margin-bottom:0">调整风向时，炮口虚线轨迹、空中飘移粒子与坡面落点会在同一帧联动重算。</p>
    `;

    this.segBtns = [...shadow.querySelectorAll<HTMLButtonElement>('#seg button')];
    this.dirSlider = slider(shadow, 'wind-dir', WIND.MIN_DIR, WIND.MAX_DIR, 1, WIND.DEFAULT_DIR, (v) =>
      this.emitWind({ direction: v }),
    );
    this.speedSlider = slider(shadow, 'wind-speed', WIND.MIN_SPEED, WIND.MAX_SPEED, 0.5, WIND.DEFAULT_SPEED, (v) =>
      this.emitWind({ speed: v }),
    );
    this.applyAllBtn = shadow.getElementById('apply-all') as HTMLButtonElement;

    for (const btn of this.segBtns) {
      btn.addEventListener('click', () => {
        const id = this.manager.selectedId;
        if (id == null) return;
        const level = parseInt(btn.dataset.level!, 10) as SnowLevel;
        this.bus.emit('level:change', { id, level });
      });
    }
    this.applyAllBtn.addEventListener('click', () => {
      const cfg = this.manager.selectedId != null ? this.manager.get(this.manager.selectedId) : undefined;
      if (!cfg) return;
      this.bus.emit('wind:apply-all', { direction: cfg.wind.direction, speed: cfg.wind.speed });
    });
  }

  private emitWind(patch: Partial<{ direction: number; speed: number }>): void {
    const id = this.manager.selectedId;
    if (id == null) return;
    const cfg = this.manager.get(id);
    if (!cfg) return;
    const direction = patch.direction ?? cfg.wind.direction;
    const speed = patch.speed ?? cfg.wind.speed;
    this.bus.emit('wind:change', { id, direction, speed });
  }

  private refresh(): void {
    const cfg = this.manager.selectedId != null ? this.manager.get(this.manager.selectedId) : undefined;
    const disabled = !cfg;
    for (const b of this.segBtns) b.disabled = disabled;
    this.dirSlider.input.disabled = disabled;
    this.speedSlider.input.disabled = disabled;
    this.applyAllBtn.disabled = disabled;
    if (!cfg) return;

    for (const b of this.segBtns) {
      b.classList.toggle('active', parseInt(b.dataset.level!, 10) === cfg.level);
      b.textContent = `${b.dataset.level === '1' ? '①' : b.dataset.level === '2' ? '②' : '③'} ${LEVEL_TEXT[parseInt(b.dataset.level!, 10) as SnowLevel]}`;
    }
    setSlider(this.dirSlider.input, this.dirSlider.value, cfg.wind.direction);
    setSlider(this.speedSlider.input, this.speedSlider.value, cfg.wind.speed);
  }
}
