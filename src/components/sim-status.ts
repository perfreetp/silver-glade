import { BaseComponent, panelCss } from './base';

/** 模拟状态条：后端、并行度、进度、覆盖率、耗时。 */
export class SimStatus extends BaseComponent {
  constructor() {
    super();
    this.setHTML(
      `
      <h2>运行状态</h2>
      <div class="grid">
        <div><span class="k">渲染后端</span><span class="v" id="backend">初始化中…</span></div>
        <div><span class="k">并行模式</span><span class="v" id="parallel">-</span></div>
        <div><span class="k">模拟进度</span><span class="v" id="progress">0%</span></div>
        <div><span class="k">菌丝覆盖</span><span class="v" id="coverage">0%</span></div>
        <div><span class="k">本帧耗时</span><span class="v" id="elapsed">-</span></div>
        <div><span class="k">状态</span><span class="v" id="phase">空闲</span></div>
      </div>
      <div class="bar-track"><div class="bar-fill" id="bar"></div></div>
      `,
      panelCss +
        `
        .grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 12px; }
        .k { display:block; color:#73828f; font-size:11px; }
        .v { display:block; color:#cfe0f0; font-variant-numeric:tabular-nums; font-size:12.5px; }
        .bar-track { margin-top:12px; height:6px; background:#10151a; border-radius:3px; overflow:hidden; }
        .bar-fill { height:100%; width:0%; background:linear-gradient(90deg,#3d83bf,#6ec0a8); transition:width .15s; }
        `,
    );
  }

  setBackend(text: string): void {
    this.$('#backend').textContent = text;
  }

  setParallel(parallel: boolean, workers: number): void {
    this.$('#parallel').textContent = parallel
      ? `${workers} 个 worker 行带并行（SAB）`
      : '单线程降级（无跨源隔离）';
  }

  setProgress(fraction: number, phase: string): void {
    const pct = (fraction * 100).toFixed(1);
    this.$('#progress').textContent = `${pct}%`;
    this.$('#phase').textContent = phase;
    (this.$<HTMLElement>('#bar')).style.width = `${fraction * 100}%`;
  }

  setCoverage(fraction: number): void {
    this.$('#coverage').textContent = `${(fraction * 100).toFixed(2)}%`;
  }

  setFrameElapsed(ms: number): void {
    this.$('#elapsed').textContent = `${ms.toFixed(1)} ms`;
  }
}
