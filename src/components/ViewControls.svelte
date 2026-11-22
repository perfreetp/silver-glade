<script lang="ts">
  let {
    settings,
    onSettings,
    onReset,
    onPreset,
    maxParticles,
  }: {
    settings: any;
    onSettings: (patch: any) => void;
    onReset: () => void;
    onPreset: (p: 'iso' | 'front' | 'top' | 'side') => void;
    maxParticles: number;
  } = $props();

  let open = $state(false);
</script>

<div class="card">
  <button class="head" onclick={() => (open = !open)}>
    <span>视图</span>
    <span class="chev" class:open>▾</span>
  </button>

  {#if open}
    <div class="body">
      <div class="presets">
        <button onclick={() => onPreset('iso')}>等轴</button>
        <button onclick={() => onPreset('front')}>正面</button>
        <button onclick={() => onPreset('top')}>俯视</button>
        <button onclick={() => onPreset('side')}>侧视</button>
      </div>

      <label class="check"><input type="checkbox" checked={settings.showParticles} onchange={(e) => onSettings({ showParticles: (e.currentTarget as HTMLInputElement).checked })} /> 粒子</label>
      <label class="check"><input type="checkbox" checked={settings.showSlice} onchange={(e) => onSettings({ showSlice: (e.currentTarget as HTMLInputElement).checked })} /> 剖面</label>
      <label class="check"><input type="checkbox" checked={settings.showArrows} onchange={(e) => onSettings({ showArrows: (e.currentTarget as HTMLInputElement).checked })} /> 方向箭头</label>
      <label class="check"><input type="checkbox" checked={settings.showRacks !== false} onchange={(e) => onSettings({ showRacks: (e.currentTarget as HTMLInputElement).checked })} /> 菇架遮挡</label>

      <div class="slider">
        <div class="lbl"><span>粒子数</span><span class="mono">{settings.particleBudget.toLocaleString('en-US')}</span></div>
        <input type="range" min="500" max={maxParticles} step="500" value={settings.particleBudget} oninput={(e) => onSettings({ particleBudget: +(e.currentTarget as HTMLInputElement).value })} />
      </div>
      <div class="seg">
        <span>着色</span>
        <div class="seg-btns">
          <button class:active={settings.colorizeBy === 'speed'} onclick={() => onSettings({ colorizeBy: 'speed' })}>风速</button>
          <button class:active={settings.colorizeBy === 'age'} onclick={() => onSettings({ colorizeBy: 'age' })}>空气龄</button>
        </div>
      </div>
      <div class="slider">
        <div class="lbl"><span>粒子亮度</span><span class="mono">{settings.particleOpacity.toFixed(2)}</span></div>
        <input type="range" min="0.15" max="1" step="0.01" value={settings.particleOpacity} oninput={(e) => onSettings({ particleOpacity: +(e.currentTarget as HTMLInputElement).value })} />
      </div>
      <div class="slider">
        <div class="lbl"><span>粒子尺寸</span><span class="mono">{settings.particleSize.toFixed(2)}</span></div>
        <input type="range" min="0.4" max="2.4" step="0.05" value={settings.particleSize} oninput={(e) => onSettings({ particleSize: +(e.currentTarget as HTMLInputElement).value })} />
      </div>
      <div class="slider">
        <div class="lbl"><span>剖面透明度</span><span class="mono">{settings.sliceOpacity.toFixed(2)}</span></div>
        <input type="range" min="0.2" max="1" step="0.01" value={settings.sliceOpacity} oninput={(e) => onSettings({ sliceOpacity: +(e.currentTarget as HTMLInputElement).value })} />
      </div>

      <button class="reset" onclick={onReset}>重置相机</button>
    </div>
  {/if}
</div>

<style>
  .card {
    width: 196px;
    background: rgba(14, 22, 31, 0.9);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    backdrop-filter: blur(10px);
    overflow: hidden;
  }

  .head {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    background: transparent;
    border: none;
    padding: 8px 11px;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--text-dim);
  }

  .head:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .chev {
    transition: transform 140ms;
    font-size: 10px;
    color: var(--text-faint);
  }

  .chev.open {
    transform: rotate(180deg);
  }

  .body {
    padding: 2px 11px 11px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid var(--line-soft);
    padding-top: 9px;
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }

  .presets button {
    padding: 4px 0;
    font-size: 10.5px;
    border-radius: 4px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11.5px;
    color: var(--text-dim);
    cursor: pointer;
  }

  .slider {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .lbl {
    display: flex;
    justify-content: space-between;
    font-size: 10.5px;
    color: var(--text-dim);
  }

  .lbl .mono {
    color: var(--text-faint);
  }

  .reset {
    font-size: 11px;
    padding: 5px 0;
    margin-top: 2px;
  }

  .seg {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 10.5px;
    color: var(--text-dim);
  }

  .seg-btns {
    display: flex;
    border: 1px solid var(--line);
    border-radius: 5px;
    overflow: hidden;
  }

  .seg-btns button {
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 3px 8px;
    font-size: 10px;
    color: var(--text-faint);
  }

  .seg-btns button.active {
    background: rgba(67, 169, 240, 0.16);
    color: var(--accent);
  }
</style>
