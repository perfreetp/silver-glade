<script lang="ts">
  import type { Solution } from '../lib/solver/field';
  import { colorBand } from '../lib/solver/field';

  let { solution }: { solution: Solution } = $props();

  const s = $derived(solution.stats);

  // 低于 0.3 m/s 的"通风盲区"占比 —— 菇房通风的关键指标
  const stagnantPct = $derived.by(() => {
    const spd = solution.speed;
    const solid = solution.solidFine;
    let low = 0,
      total = 0;
    for (let i = 0; i < spd.length; i++) {
      if (solid[i]) continue;
      total++;
      if (spd[i] < 0.2) low++;
    }
    return total ? (low / total) * 100 : 0;
  });

  const voxelText = $derived(`${(solution.fine.nx * solution.fine.ny * solution.fine.nz / 1e6).toFixed(2)}M`);
  const elapsed = $derived(s.solveMs >= 1000 ? `${(s.solveMs / 1000).toFixed(1)} s` : `${s.solveMs.toFixed(0)} ms`);
</script>

<div class="stats">
  <div class="item" title="细网格体素总数 (160 × 80 × 100 = 1.28M)">
    <span class="k">体素</span>
    <span class="v mono">{voxelText}</span>
  </div>
  <div class="item" title={`最大风速 ${s.maxSpeed.toFixed(2)} m/s · 平均 ${s.meanSpeed.toFixed(2)} m/s`}>
    <span class="k">最大 / 平均</span>
    <span class="v mono">
      <span class="max">{s.maxSpeed.toFixed(2)}</span>
      <span class="sep">/</span>{s.meanSpeed.toFixed(2)}
    </span>
  </div>
  <div class="item" title="通风盲区: 风速 < 0.2 m/s 的流体体素占比">
    <span class="k">盲区 &lt;0.2</span>
    <span class="v mono" style="color: {stagnantPct > 35 ? '#e8503a' : stagnantPct > 20 ? '#f2c53c' : '#38d39f'}">
      {stagnantPct.toFixed(0)}%
    </span>
  </div>
  <div class="item" title="按送风量计算的名义换气次数">
    <span class="k">换气</span>
    <span class="v mono">{s.airChanges.toFixed(1)}<small>次/h</small></span>
  </div>
  <div class="item" title={`进风 ${Math.round(s.supplyAirflow)} / 回风 ${Math.round(s.exhaustAirflow)} m³/h`}>
    <span class="k">风量</span>
    <span class="v mono">{Math.round(Math.min(s.supplyAirflow, s.exhaustAirflow))}<small>m³/h</small></span>
  </div>
  <div class="item" title={`投影残差 ${s.residual.toExponential(1)} · 迭代 ${s.iters}`}>
    <span class="k">求解</span>
    <span class="v mono">{elapsed}</span>
  </div>
</div>

{#if s.balanceNote}
  <div class="note">{s.balanceNote}</div>
{/if}

<style>
  .stats {
    display: flex;
    gap: 0;
    background: rgba(14, 22, 31, 0.9);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    backdrop-filter: blur(10px);
    overflow: hidden;
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 11px;
    border-right: 1px solid var(--line-soft);
    min-width: 66px;
    cursor: help;
  }

  .item:last-child {
    border-right: none;
  }

  .k {
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 0.03em;
    white-space: nowrap;
  }

  .v {
    font-size: 12.5px;
    color: var(--text);
    font-weight: 550;
    white-space: nowrap;
  }

  .v small {
    font-size: 8.5px;
    color: var(--text-faint);
    margin-left: 2px;
    font-weight: 400;
  }

  .max {
    color: #f2c53c;
  }

  .sep {
    color: var(--text-faint);
    margin: 0 3px;
  }

  .note {
    margin-top: 6px;
    font-size: 10px;
    color: var(--warn);
    background: rgba(245, 167, 66, 0.08);
    border: 1px solid rgba(245, 167, 66, 0.25);
    border-radius: 5px;
    padding: 5px 9px;
    max-width: 320px;
    text-align: right;
    margin-left: auto;
  }
</style>
