<script lang="ts">
  import { ROOM } from '../lib/model/room';

  let {
    sliceMode,
    sliceHeight,
    sliceZ,
    sliceX,
    onMode,
    onPosition,
  }: {
    sliceMode: 'horizontal' | 'vertical-x' | 'vertical-z';
    sliceHeight: number;
    sliceZ: number;
    sliceX: number;
    onMode: (m: 'horizontal' | 'vertical-x' | 'vertical-z') => void;
    onPosition: (v: number) => void;
  } = $props();

  const value = $derived(sliceMode === 'horizontal' ? sliceHeight : sliceMode === 'vertical-x' ? sliceZ : sliceX);
  const min = $derived(sliceMode === 'horizontal' ? 0.08 : 0.08);
  const max = $derived(sliceMode === 'horizontal' ? ROOM.ly - 0.08 : sliceMode === 'vertical-x' ? ROOM.lz - 0.08 : ROOM.lx - 0.08);
  const unit = $derived(sliceMode === 'horizontal' ? 'Y 高度' : sliceMode === 'vertical-x' ? 'Z 位置' : 'X 位置');

  const modes: { id: typeof sliceMode; label: string; icon: string }[] = [
    { id: 'horizontal', label: '水平', icon: 'M3 12h18' },
    { id: 'vertical-x', label: '纵切', icon: 'M12 3v18' },
    { id: 'vertical-z', label: '横切', icon: 'M5 5l14 14' },
  ];
</script>

<div class="card">
  <div class="tabs">
    {#each modes as m}
      <button class:active={sliceMode === m.id} onclick={() => onMode(m.id)} title={m.label}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5" opacity="0.45" />
          <path d={m.icon} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        <span>{m.label}</span>
      </button>
    {/each}
  </div>
  <div class="slider-row">
    <div class="lbl">
      <span>{unit}</span>
      <span class="mono">{value.toFixed(2)} m</span>
    </div>
    <input type="range" min={min} max={max} step="0.02" value={value} oninput={(e) => onPosition(+(e.currentTarget as HTMLInputElement).value)} />
  </div>
</div>

<style>
  .card {
    width: 258px;
    background: rgba(14, 22, 31, 0.9);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    backdrop-filter: blur(10px);
    padding: 8px 10px 4px;
  }

  .tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  .tabs button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 0 5px;
    font-size: 10.5px;
    background: transparent;
    border-color: transparent;
    color: var(--text-dim);
    border-radius: 5px;
  }

  .tabs button:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text);
  }

  .tabs button.active {
    background: rgba(67, 169, 240, 0.14);
    border-color: rgba(67, 169, 240, 0.35);
    color: var(--accent);
  }

  .slider-row {
    padding: 4px 2px 5px;
  }

  .lbl {
    display: flex;
    justify-content: space-between;
    font-size: 10.5px;
    color: var(--text-dim);
  }

  .lbl .mono {
    font-family: var(--mono);
    color: var(--accent);
  }
</style>
