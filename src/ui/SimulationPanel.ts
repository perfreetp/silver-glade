import type { EventBus } from '../core/EventBus';
import type { SimStats } from '../core/types';
import { panelStyles } from './panelBase';

/**
 * 模块三面板：飘移与堆积仿真的运行控制 + 实时读数。
 * 夜间模式、轨迹/风场叠加开关、时间倍率、清空积雪都在这里。
 */
export class SimulationPanel extends HTMLElement {
  private bus!: EventBus;
  private root!: ShadowRoot;

  connect(bus: EventBus): void {
    this.bus = bus;
    this.render();
    bus.on('stats:update', (stats) => this.updateStats(stats as SimStats));
  }

  private render(): void {
    const shadow = this.attachShadow({ mode: 'open' });
    this.root = shadow;
    shadow.innerHTML = /* html */ `
      <style>${panelStyles}</style>
      <h2>③ 飘移与坡面堆积 <span class="badge">实例化粒子</span></h2>
      <div class="row">
        <button id="pause">⏸ 暂停仿真</button>
        <button id="reset" class="danger">清空积雪与粒子</button>
      </div>

      <label class="switch"><input type="checkbox" id="night" /> 夜间模式（月光 + 炮口辉光 Bloom）</label>
      <label class="switch"><input type="checkbox" id="traj" checked /> 显示炮口轨迹与落点</label>
      <label class="switch"><input type="checkbox" id="forecast" /> 显示风场飘移预测箭头</label>

      <label>时间倍率 <span class="val" style="float:right" id="scale-val">1.0×</span></label>
      <input type="range" id="scale" min="0.25" max="3" step="0.25" value="1" />

      <div class="stats">
        <div><div class="k">帧率 FPS</div><div class="v" id="s-fps">--</div></div>
        <div><div class="k">活跃粒子 / 容量</div><div class="v" id="s-particles">--</div></div>
        <div><div class="k">造雪机数量</div><div class="v" id="s-machines">--</div></div>
        <div><div class="k">积雪覆盖率</div><div class="v" id="s-coverage">--</div></div>
        <div><div class="k">平均积雪厚度</div><div class="v" id="s-depth">--</div></div>
        <div><div class="k">运行状态</div><div class="v" id="s-state">--</div></div>
      </div>
      <p class="muted">雪粒落地即转为静态积雪（高度场），厚度渐近饱和，不会无限累积。</p>
    `;

    const pause = shadow.getElementById('pause') as HTMLButtonElement;
    let running = true;
    pause.addEventListener('click', () => {
      running = !running;
      pause.textContent = running ? '⏸ 暂停仿真' : '▶ 继续仿真';
      this.bus.emit('sim:toggle', { running });
    });

    (shadow.getElementById('reset') as HTMLButtonElement).addEventListener('click', () => {
      this.bus.emit('sim:reset-snow', {});
    });
    (shadow.getElementById('night') as HTMLInputElement).addEventListener('change', (e) => {
      this.bus.emit('sim:night', { night: (e.target as HTMLInputElement).checked });
    });
    (shadow.getElementById('traj') as HTMLInputElement).addEventListener('change', (e) => {
      this.bus.emit('sim:trajectories', { visible: (e.target as HTMLInputElement).checked });
    });
    (shadow.getElementById('forecast') as HTMLInputElement).addEventListener('change', (e) => {
      this.bus.emit('sim:forecast', { visible: (e.target as HTMLInputElement).checked });
    });
    const scale = shadow.getElementById('scale') as HTMLInputElement;
    scale.addEventListener('input', () => {
      (shadow.getElementById('scale-val') as HTMLElement).textContent = `${parseFloat(scale.value).toFixed(2)}×`;
      this.bus.emit('sim:time-scale', { scale: parseFloat(scale.value) });
    });
  }

  private updateStats(s: SimStats): void {
    const q = (id: string) => this.root.getElementById(id) as HTMLElement;
    q('s-fps').textContent = String(s.fps);
    q('s-particles').textContent = `${s.activeParticles} / ${s.capacity}`;
    q('s-machines').textContent = String(s.machineCount);
    q('s-coverage').textContent = `${s.coverage.toFixed(1)}%`;
    q('s-depth').textContent = `${s.avgDepth.toFixed(3)} m`;
    q('s-state').textContent = s.running ? '运行中' : '已暂停';
    q('s-fps').style.color = s.fps >= 55 ? '#7ee787' : s.fps >= 40 ? '#ffd166' : '#ff8b8b';
  }
}
