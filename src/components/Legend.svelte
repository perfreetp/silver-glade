<script lang="ts">
  import { BAND_COLORS, BAND_NAMES } from '../lib/solver/field';

  let { stops = [] }: { stops: number[] } = $props();
</script>

<div class="legend">
  <div class="title">风速 m/s <span class="dim">· 6 档</span></div>
  <div class="bar">
    {#each BAND_COLORS as color, i}
      <div class="cell" style="background:{color}" title="{BAND_NAMES[i]}"></div>
    {/each}
  </div>
  <div class="ticks">
    {#each BAND_COLORS as _, i}
      <span>{stops[i]?.toFixed(2) ?? ''}</span>
    {/each}
    <span>{stops[6]?.toFixed(2) ?? ''}</span>
  </div>
</div>

<style>
  .legend {
    background: rgba(14, 22, 31, 0.88);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 8px 10px 6px;
    backdrop-filter: blur(10px);
    width: 258px;
  }

  .title {
    font-size: 10.5px;
    color: var(--text-dim);
    margin-bottom: 6px;
    letter-spacing: 0.02em;
  }

  .dim {
    color: var(--text-faint);
  }

  .bar {
    display: flex;
    align-items: stretch;
    height: 16px;
    border-radius: 3px;
    overflow: hidden;
  }

  .cell {
    flex: 1;
    height: 100%;
  }

  .ticks {
    display: flex;
    margin-top: 5px;
    padding-bottom: 1px;
  }

  .ticks span {
    flex: 1;
    text-align: left;
    font-family: var(--mono);
    font-size: 8.5px;
    color: #566b81;
    transform: translateX(-1px);
  }

  .ticks span:last-child {
    flex: 0 0 auto;
    text-align: right;
    transform: translateX(2px);
  }
</style>
