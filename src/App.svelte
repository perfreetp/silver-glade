<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Viewer from './components/Viewer.svelte';
  import FanPanel from './components/FanPanel.svelte';
  import ViewControls from './components/ViewControls.svelte';
  import SlicePanel from './components/SlicePanel.svelte';
  import ExportDialog from './components/ExportDialog.svelte';
  import StatsBar from './components/StatsBar.svelte';
  import Legend from './components/Legend.svelte';
  import { defaultFans, makeFan, clampFanUV } from './lib/model/fans';
  import type { Fan } from './lib/model/room';
  import type { Solution } from './lib/solver/field';
  import { createSolverClient, type SolverClient } from './lib/solver/client';

  let fans: Fan[] = defaultFans();
  let selectedId: string | null = fans[0]?.id ?? null;
  let solution: Solution | null = null;
  let solving = false;
  let solveMs = 0;
  let ready = false;

  let sliceMode: 'horizontal' | 'vertical-x' | 'vertical-z' = 'horizontal';
  let sliceHeight = 2.0;
  let sliceZ = 4.0;
  let sliceX = 6.4;

  let viewerRef: { setFans: (f: Fan[]) => void; setSolution: (s: Solution, o?: { reseed?: boolean }) => void; setSlice: (m: any, p: number) => void; setSettings: (s: any) => void; resetCamera: () => void; preset: (p: any) => void } | null = null;

  let settings = {
    showParticles: true,
    showSlice: true,
    showArrows: true,
    particleOpacity: 0.92,
    sliceOpacity: 0.9,
    particleBudget: 9000,
    particleSize: 1,
    trailLength: 14,
    colorizeBy: 'speed' as 'speed' | 'age',
  };

  let showExport = false;
  let showHelp = false;
  let lastDragSolve = 0;

  const MAX_PARTICLES = 24000;

  let solver: SolverClient | null = null;
  let solveSeq = 0;

  async function doSolve(quality: 'full' | 'drag') {
    if (!solver) return;
    const mySeq = ++solveSeq;
    solving = true;
    solveMs = 0;
    const t0 = performance.now();
    try {
      const sol = await solver.solve(fans, {
        maxIter: quality === 'drag' ? 30 : 220,
        tol: quality === 'drag' ? 8e-3 : 1e-4,
        skipAge: quality === 'drag',
        skipRelax: quality === 'drag',
      });
      // 已有更新的请求发出, 丢弃这个过期结果
      if (mySeq !== solveSeq) return;
      solution = sol;
      solveMs = performance.now() - t0;
      ready = true;
      viewerRef?.setSolution(sol, { reseed: quality !== 'drag' });
      if (quality === 'drag') viewerRef?.setFans(fans);
    } catch (err) {
      const msg = (err as Error).message;
      // 拖动时被更新的请求取代, 属于正常情况
      if (msg !== 'superseded') console.error('solve failed', err);
    } finally {
      if (mySeq === solveSeq) solving = false;
    }
  }

  function fullSolve() {
    doSolve('full');
  }

  function onFanUpdate(next: Fan) {
    fans = fans.map((f) => (f.id === next.id ? next : f));
    viewerRef?.setFans(fans);
    // 只有影响风场的参数才重算
    scheduleSolve(180);
  }

  let solveTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSolve(delay = 160) {
    if (solveTimer) clearTimeout(solveTimer);
    solveTimer = setTimeout(() => {
      solveTimer = null;
      doSolve('full');
    }, delay);
  }

  function addFan(kind: 'supply' | 'exhaust') {
    const wall = kind === 'supply' ? 'west' : 'east';
    const f = makeFan({
      kind,
      wall,
      name: `${kind === 'supply' ? '进风' : '回风'}机`,
      u: 2 + Math.random() * 4,
      v: 2.6 + Math.random(),
    });
    fans = [...fans, f];
    selectedId = f.id;
    viewerRef?.setFans(fans);
    scheduleSolve(60);
  }

  function removeFan(id: string) {
    fans = fans.filter((f) => f.id !== id);
    if (selectedId === id) selectedId = fans[0]?.id ?? null;
    viewerRef?.setFans(fans);
    scheduleSolve(60);
  }

  function onDragFan(id: string, u: number, v: number) {
    const f = fans.find((x) => x.id === id);
    if (!f) return;
    const cl = clampFanUV(f, u, v);
    if (Math.abs(cl.u - f.u) < 1e-4 && Math.abs(cl.v - f.v) < 1e-4) return;
    fans = fans.map((x) => (x.id === id ? { ...x, u: cl.u, v: cl.v } : x));
    viewerRef?.setFans(fans);
    const now = performance.now();
    if (now - lastDragSolve > 240) {
      lastDragSolve = now;
      doSolve('drag');
    }
  }

  function onDragEnd() {
    scheduleSolve(30);
  }

  function setSliceMode(m: typeof sliceMode) {
    sliceMode = m;
    viewerRef?.setSlice(m, slicePosition());
  }

  function slicePosition() {
    return sliceMode === 'horizontal' ? sliceHeight : sliceMode === 'vertical-x' ? sliceZ : sliceX;
  }

  function onSlicePos(val: number) {
    if (sliceMode === 'horizontal') sliceHeight = val;
    else if (sliceMode === 'vertical-x') sliceZ = val;
    else sliceX = val;
    viewerRef?.setSlice(sliceMode, val);
  }

  function applySettings(patch: Partial<typeof settings>) {
    settings = { ...settings, ...patch };
    viewerRef?.setSettings(settings);
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      solver = await createSolverClient();
      if (cancelled) return;
      await doSolve('full');
    })();
    return () => {
      cancelled = true;
      solver?.dispose();
      solver = null;
    };
  });
</script>

<div class="app">
  <header class="topbar">
    <div class="brand">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3c4.5 0 8 3 8 6.2 0 1.2-.9 1.9-2 1.9H6c-1.1 0-2-.7-2-1.9C4 6 7.5 3 12 3Z" fill="#e8503a" opacity="0.85" />
        <path d="M7 11.5v4.2c0 2.4 2.2 4.3 5 4.3s5-1.9 5-4.3v-4.2" stroke="#d7c4a8" stroke-width="1.6" />
      </svg>
      <div>
        <h1>菇房通风气流场</h1>
        <span class="sub">Voxel Airflow Field Visualiser</span>
      </div>
    </div>

    <div class="top-actions">
      <div class="status" class:busy={solving}>
        <span class="dot"></span>
        {#if solving}
          正在求解风场…
        {:else}
          风场就绪 · {solveMs.toFixed(0)} ms
        {/if}
      </div>
      <button class="ghost" onclick={() => (showHelp = !showHelp)} title="帮助">?</button>
      <button class="primary" onclick={() => (showExport = true)} disabled={!solution}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="vertical-align:-2px;margin-right:5px">
          <path d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        导出数据
      </button>
    </div>
  </header>

  <main class="layout">
    <aside class="left">
      <FanPanel
        {fans}
        {selectedId}
        onSelect={(id) => (selectedId = id)}
        onUpdate={onFanUpdate}
        onAdd={addFan}
        onRemove={removeFan}
        onSolve={fullSolve}
        {solving}
      />
    </aside>

    <section class="stage">
      <Viewer
        bind:this={viewerRef}
        {fans}
        onFanDragMove={onDragFan}
        onFanDragEnd={onDragEnd}
      />

      <div class="stage-overlay top-left">
        <SlicePanel
          {sliceMode}
          {sliceHeight}
          {sliceZ}
          {sliceX}
          onMode={setSliceMode}
          onPosition={onSlicePos}
        />
      </div>

      <div class="stage-overlay top-right">
        <ViewControls
          {settings}
          onSettings={applySettings}
          onReset={() => viewerRef?.resetCamera()}
          onPreset={(p) => viewerRef?.preset(p)}
          maxParticles={MAX_PARTICLES}
        />
      </div>

      <div class="stage-overlay bottom-bar">
        <Legend stops={solution?.colorStops ?? []} />
        {#if solution}
          <StatsBar solution={solution} />
        {/if}
      </div>

      {#if !solution}
        <div class="booting">
          <span class="spinner"></span>
          <div>
            <strong>正在求解初始风场</strong>
            <p>1,280,000 体素 · 首次计算约 3 秒</p>
          </div>
        </div>
      {:else if solving}
        <div class="solving-badge">
          <span class="spinner"></span> 求解中
        </div>
      {/if}
    </section>
  </main>
</div>

{#if showExport && solution}
  <ExportDialog
    {solution}
    {fans}
    {sliceMode}
    position={slicePosition()}
    onClose={() => (showExport = false)}
  />
{/if}

{#if showHelp}
  <div class="modal-backdrop" onclick={() => (showHelp = false)} role="presentation">
    <div class="modal help" onclick={(e) => e.stopPropagation()} role="presentation">
      <header>
        <h2>操作说明</h2>
        <button class="ghost" onclick={() => (showHelp = false)}>✕</button>
      </header>
      <div class="help-body">
        <dl>
          <dt>旋转 / 缩放</dt><dd>左键拖动空白处旋转 · 滚轮缩放 · 右键平移</dd>
          <dt>拖动风机</dt><dd>在房间墙面上直接按住风机圆盘拖动, 松手后重算风场; 拖动过程中粒子与剖面实时跟随</dd>
          <dt>风机面板</dt><dd>修改风量、出风偏转角 (tilt) 与仰角 (pitch) 后, 速度场自动重算</dd>
          <dt>切片</dt><dd>水平切面沿高度移动; 纵切面 / 横切面可用滑杆在 Z / X 方向移动</dd>
          <dt>色带</dt><dd>固定 6 档: 剖面填色与箭头、粒子颜色共用同一色阶</dd>
          <dt>导出</dt><dd>ZIP 包内含体素速度场 (JSON + 二进制)、三张剖面 PNG、6 档图例与说明</dd>
        </dl>
        <p class="hint">风机为蓝色 (进风), 橙色 (回风)。拖动时按墙面局部坐标吸附, 松手后自动收敛。</p>
      </div>
    </div>
  </div>
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: radial-gradient(1200px 700px at 55% -10%, #122030 0%, #070b11 60%);
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 54px;
    padding: 0 16px;
    border-bottom: 1px solid var(--line-soft);
    background: rgba(10, 16, 23, 0.85);
    backdrop-filter: blur(12px);
    z-index: 20;
    flex: 0 0 auto;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .brand svg {
    filter: drop-shadow(0 0 8px rgba(232, 80, 58, 0.35));
  }

  h1 {
    font-size: 14.5px;
    margin: 0;
    font-weight: 650;
    letter-spacing: 0.01em;
  }

  .sub {
    font-size: 10px;
    color: var(--text-faint);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .top-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11.5px;
    color: var(--text-dim);
    font-family: var(--mono);
  }

  .status .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent-2);
    box-shadow: 0 0 8px var(--accent-2);
  }

  .status.busy .dot {
    background: var(--warn);
    box-shadow: 0 0 8px var(--warn);
    animation: pulse 0.9s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }

  .layout {
    flex: 1 1 auto;
    display: flex;
    min-height: 0;
  }

  .left {
    width: 320px;
    flex: 0 0 320px;
    border-right: 1px solid var(--line-soft);
    background: var(--panel);
    display: flex;
    flex-direction: column;
    min-height: 0;
    z-index: 10;
  }

  .stage {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
  }

  .stage :global(canvas) {
    display: block;
  }

  .stage-overlay {
    position: absolute;
    z-index: 5;
    pointer-events: none;
  }

  .stage-overlay :global(*) {
    pointer-events: auto;
  }

  @media (max-width: 1180px) {
    .left {
      width: 276px;
      flex: 0 0 276px;
    }
  }

  @media (max-width: 900px) {
    .layout {
      flex-direction: column;
    }

    .left {
      width: 100%;
      flex: 0 0 42vh;
      border-right: none;
      border-bottom: 1px solid var(--line-soft);
      order: 2;
    }

    .stage {
      flex: 1 1 58vh;
      min-height: 320px;
      order: 1;
    }

    .top-actions .status {
      display: none;
    }

    .bottom-bar {
      left: 8px;
      right: 8px;
      bottom: 8px;
      gap: 6px;
    }

    .bottom-bar :global(.legend) {
      display: none;
    }

    .top-left {
      top: 8px;
      left: 8px;
    }

    .top-right {
      top: 8px;
      right: 8px;
    }

    .top-right :global(.card) {
      width: 168px;
    }
  }

  .top-left { top: 12px; left: 12px; }
  .top-right { top: 12px; right: 12px; }
  .bottom-bar {
    bottom: 12px;
    left: 12px;
    right: 12px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .solving-badge {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(20, 30, 42, 0.92);
    border: 1px solid var(--line);
    color: var(--warn);
    font-size: 11.5px;
    padding: 5px 12px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 8;
  }

  .spinner {
    width: 11px;
    height: 11px;
    border: 2px solid rgba(245, 167, 66, 0.3);
    border-top-color: var(--warn);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex: 0 0 auto;
  }

  .booting {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: rgba(6, 10, 15, 0.55);
    backdrop-filter: blur(2px);
    z-index: 9;
  }

  .booting strong {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  .booting p {
    margin: 3px 0 0;
    font-size: 11px;
    color: var(--text-faint);
    font-family: var(--mono);
  }

  .booting .spinner {
    width: 20px;
    height: 20px;
    border-width: 2.5px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(3, 6, 10, 0.72);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
    width: 520px;
    max-width: calc(100vw - 40px);
  }

  .modal header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--line-soft);
  }

  .modal h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 620;
  }

  .help-body {
    padding: 16px 18px 20px;
  }

  dl {
    margin: 0;
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 9px 14px;
  }

  dt {
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
  }

  dd {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.55;
  }

  .hint {
    margin: 16px 0 0;
    padding: 10px 12px;
    background: rgba(67, 169, 240, 0.06);
    border-left: 2px solid var(--accent);
    border-radius: 0 6px 6px 0;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.5;
  }
</style>
