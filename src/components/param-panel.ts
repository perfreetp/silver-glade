import { BaseComponent, panelCss } from './base';
import { GRID_SIZE_OPTIONS, type SimParams } from '../sim/types';

/**
 * 培养参数面板：温度、湿度、格点规模、步数等，
 * 改动后派发 `params-change`，由主程序决定是否重算。
 */
export class ParamPanel extends BaseComponent {
  private params: SimParams | null = null;
  private suppress = false;

  constructor() {
    super();
    this.setHTML(
      `
      <h2>培养参数</h2>
      <label>温度 <span class="value" id="temp-val"></span></label>
      <input type="range" id="temp" min="5" max="38" step="0.5" />
      <label>相对湿度 <span class="value" id="hum-val"></span></label>
      <input type="range" id="hum" min="30" max="100" step="1" />
      <label>格点规模（每边 N，总格点 N²）</label>
      <select id="grid">
        ${GRID_SIZE_OPTIONS.map((n) => `<option value="${n}">${n} × ${n}（${(n * n / 1e6).toFixed(2)} 百万格）</option>`).join('')}
      </select>
      <label>中心气孔半径占比 <span class="value" id="hole-val"></span></label>
      <input type="range" id="hole" min="0.06" max="0.35" step="0.01" />
      <div class="row" style="margin-top:10px">
        <div style="flex:1">
          <label style="margin-top:0">总扩散步数</label>
          <input type="number" id="steps" min="50" max="6000" step="50" />
        </div>
        <div style="flex:1">
          <label style="margin-top:0">快照间隔（步）</label>
          <input type="number" id="every" min="1" max="100" step="1" />
        </div>
      </div>
      <label>每步对应时间（小时）<span class="value" id="hps-val"></span></label>
      <input type="range" id="hps" min="0.1" max="2" step="0.1" />
      <div class="hint" id="factor-hint"></div>
      <div style="margin-top:12px">
        <button class="primary" id="apply" style="width:100%">应用参数并重算整段蔓延</button>
      </div>
      `,
      panelCss,
    );
  }

  connectedCallback(): void {
    const ids = ['temp', 'hum', 'grid', 'hole', 'steps', 'every', 'hps'] as const;
    for (const id of ids) {
      this.$(`#${id}`).addEventListener('input', () => this.onInput());
    }
    this.$('#apply').addEventListener('click', () => this.emitApply());
  }

  setParams(p: SimParams): void {
    this.params = { ...p };
    this.suppress = true;
    (this.$<HTMLInputElement>('#temp')).value = String(p.temperature);
    (this.$<HTMLInputElement>('#hum')).value = String(p.humidity);
    (this.$<HTMLSelectElement>('#grid')).value = String(p.gridSize);
    (this.$<HTMLInputElement>('#hole')).value = String(p.holeRatio);
    (this.$<HTMLInputElement>('#steps')).value = String(p.totalSteps);
    (this.$<HTMLInputElement>('#every')).value = String(p.snapshotEvery);
    (this.$<HTMLInputElement>('#hps')).value = String(p.hoursPerStep);
    this.suppress = false;
    this.refreshLabels();
  }

  private readForm(): SimParams {
    return {
      ...this.params!,
      temperature: parseFloat(this.$<HTMLInputElement>('#temp').value),
      humidity: parseFloat(this.$<HTMLInputElement>('#hum').value),
      gridSize: parseInt(this.$<HTMLSelectElement>('#grid').value, 10),
      holeRatio: parseFloat(this.$<HTMLInputElement>('#hole').value),
      totalSteps: parseInt(this.$<HTMLInputElement>('#steps').value, 10),
      snapshotEvery: parseInt(this.$<HTMLInputElement>('#every').value, 10),
      hoursPerStep: parseFloat(this.$<HTMLInputElement>('#hps').value),
    };
  }

  private onInput(): void {
    if (this.suppress) return;
    this.params = this.readForm();
    this.refreshLabels();
    // 温度/湿度这种不改变格点结构的参数，实时派发以便提示，重算仍由按钮触发
    this.dispatchEvent(
      new CustomEvent('params-edit', { detail: this.params, bubbles: true, composed: true }),
    );
  }

  private emitApply(): void {
    this.params = this.readForm();
    this.dispatchEvent(
      new CustomEvent('params-change', { detail: this.params, bubbles: true, composed: true }),
    );
  }

  private refreshLabels(): void {
    const p = this.params!;
    this.$('#temp-val').textContent = `${p.temperature.toFixed(1)} ℃`;
    this.$('#hum-val').textContent = `${p.humidity.toFixed(0)} %`;
    this.$('#hole-val').textContent = p.holeRatio.toFixed(2);
    this.$('#hps-val').textContent = `${p.hoursPerStep.toFixed(1)} h`;
    const totalHours = p.totalSteps * p.hoursPerStep;
    this.$('#factor-hint').textContent =
      `培养周期约 ${totalHours.toFixed(0)} 小时（${(totalHours / 24).toFixed(1)} 天），` +
      `约 ${Math.floor(p.totalSteps / p.snapshotEvery) + 1} 帧快照。`;
  }
}
