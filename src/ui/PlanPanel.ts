import type { EventBus } from '../core/EventBus';
import type { MachineManager } from '../core/MachineManager';
import { panelStyles } from './panelBase';

/**
 * 模块四面板：造雪计划导出 / 导入。
 * 导出 JSON 记录每台造雪机的位置、朝向、雪量档位与风向参数。
 */
export class PlanPanel extends HTMLElement {
  private bus!: EventBus;
  private manager!: MachineManager;
  private statusEl!: HTMLElement;

  connect(bus: EventBus, manager: MachineManager): void {
    this.bus = bus;
    this.manager = manager;
    this.render();
  }

  private render(): void {
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = /* html */ `
      <style>${panelStyles}</style>
      <h2>④ 造雪计划导出 <span class="badge">JSON</span></h2>
      <div class="row">
        <button id="export">⬇ 导出计划 (.json)</button>
        <button id="import">⬆ 导入计划</button>
      </div>
      <input type="file" id="file" accept="application/json,.json" hidden />
      <p class="muted">
        导出字段：机器编号、坡面坐标 (x, z)、朝向 (yaw/pitch)、雪量档位 (1/2/3)、风向角度与风速。
      </p>
      <div id="status" class="muted"></div>
    `;

    this.statusEl = shadow.getElementById('status') as HTMLElement;
    const fileInput = shadow.getElementById('file') as HTMLInputElement;

    shadow.getElementById('export')!.addEventListener('click', () => {
      this.bus.emit('plan:export', {});
      this.flash(`已导出 ${this.manager.count} 台造雪机的计划文件`, false);
    });
    shadow.getElementById('import')!.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.bus.emit('plan:import', { file });
      fileInput.value = '';
    });
  }

  flash(message: string, error: boolean): void {
    this.statusEl.textContent = message;
    this.statusEl.style.color = error ? '#ff8b8b' : '#7ee787';
  }
}
