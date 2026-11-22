import { BaseComponent, panelCss } from './base';

/**
 * 回放控制条：播放/暂停、步进、滑杆可跳到任意时刻、帧时间显示、循环。
 */
export class PlaybackBar extends BaseComponent {
  private frameCount = 0;
  private frameIndex = 0;
  private playing = false;
  private loop = true;
  private speed = 1;

  constructor() {
    super();
    this.setHTML(
      `
      <div class="bar">
        <button id="first" title="回到首帧">⏮</button>
        <button id="prev" title="上一帧">◀</button>
        <button id="play" class="primary" title="播放/暂停">▶ 播放</button>
        <button id="next" title="下一帧">▶</button>
        <button id="last" title="跳到末帧">⏭</button>
        <input type="range" id="scrub" min="0" max="0" value="0" />
        <span class="readout">
          帧 <span id="frame-idx">0</span>/<span id="frame-max">0</span>
          · <span id="time-label">0.0 h</span>
        </span>
        <label class="speed">速度
          <select id="speed">
            <option value="0.5">0.5×</option>
            <option value="1" selected>1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </select>
        </label>
        <label class="loop"><input type="checkbox" id="loop" checked /> 循环</label>
      </div>
      `,
      panelCss +
        `
        :host { padding: 10px 14px; }
        .bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        #scrub { flex:1; min-width:180px; accent-color:#6ea8d8; }
        .readout { color:#9fb0bf; font-variant-numeric:tabular-nums; white-space:nowrap; }
        .speed, .loop { display:flex; align-items:center; gap:5px; color:#9fb0bf; margin:0; white-space:nowrap; }
        .speed select { width:auto; padding:4px 6px; }
        button { padding:6px 10px; min-width:40px; }
        `,
    );
  }

  connectedCallback(): void {
    this.$('#play').addEventListener('click', () => this.togglePlay());
    this.$('#first').addEventListener('click', () => this.seek(0));
    this.$('#last').addEventListener('click', () => this.seek(Math.max(0, this.frameCount - 1)));
    this.$('#prev').addEventListener('click', () => this.seek(this.frameIndex - 1));
    this.$('#next').addEventListener('click', () => this.seek(this.frameIndex + 1));
    this.$<HTMLInputElement>('#scrub').addEventListener('input', (e) => {
      this.seek(parseInt((e.target as HTMLInputElement).value, 10));
    });
    this.$<HTMLInputElement>('#loop').addEventListener('change', (e) => {
      this.loop = (e.target as HTMLInputElement).checked;
    });
    this.$<HTMLSelectElement>('#speed').addEventListener('change', (e) => {
      this.speed = parseFloat((e.target as HTMLSelectElement).value);
    });
  }

  setFrames(count: number): void {
    this.frameCount = count;
    this.$<HTMLInputElement>('#scrub').max = String(Math.max(0, count - 1));
    this.$('#frame-max').textContent = String(Math.max(0, count - 1));
    this.seek(0);
  }

  seek(index: number): void {
    if (this.frameCount === 0) {
      this.frameIndex = 0;
    } else {
      this.frameIndex = Math.min(this.frameCount - 1, Math.max(0, index));
    }
    this.$<HTMLInputElement>('#scrub').value = String(this.frameIndex);
    this.$('#frame-idx').textContent = String(this.frameIndex);
    this.dispatchEvent(
      new CustomEvent('seek', { detail: this.frameIndex, bubbles: true, composed: true }),
    );
  }

  setTimeLabel(hours: number): void {
    const days = Math.floor(hours / 24);
    const rem = hours % 24;
    this.$('#time-label').textContent =
      days > 0 ? `${days}d ${rem.toFixed(1)}h` : `${hours.toFixed(1)} h`;
  }

  togglePlay(): void {
    if (this.frameCount <= 1) return;
    this.playing = !this.playing;
    this.$('#play').textContent = this.playing ? '⏸ 暂停' : '▶ 播放';
    if (this.playing) this.dispatchEvent(new CustomEvent('play', { bubbles: true, composed: true }));
    else this.dispatchEvent(new CustomEvent('pause', { bubbles: true, composed: true }));
  }

  stopPlay(): void {
    this.playing = false;
    this.$('#play').textContent = '▶ 播放';
  }

  /** 播放定时器回调：推进一帧，到末尾按循环设置处理。 */
  tickPlay(): number {
    let next = this.frameIndex + 1;
    if (next >= this.frameCount) {
      if (this.loop) next = 0;
      else {
        this.stopPlay();
        this.dispatchEvent(new CustomEvent('pause', { bubbles: true, composed: true }));
        return this.frameIndex;
      }
    }
    this.seek(next);
    return next;
  }

  get playSpeed(): number {
    return this.speed;
  }

  get isPlaying(): boolean {
    return this.playing;
  }
}
