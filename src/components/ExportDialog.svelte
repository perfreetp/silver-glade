<script lang="ts">
  import { untrack } from 'svelte';
  import { exportFieldZip, exportSlicePNG, exportVoxelData, downloadBlob, sliceToRGBA, encodePNG } from '../lib/export/export';
  import type { Solution } from '../lib/solver/field';
  import type { Fan } from '../lib/model/room';

  let {
    solution,
    fans,
    sliceMode,
    position,
    onClose,
  }: {
    solution: Solution;
    fans: Fan[];
    sliceMode: 'horizontal' | 'vertical-x' | 'vertical-z';
    position: number;
    onClose: () => void;
  } = $props();

  let voxelJson = $state(true);
  let slicePng = $state(true);
  let includeAge = $state(true);
  let downsample = $state(1);
  let busy = $state(false);
  let done = $state<string | null>(null);

  let vue = $state<{ url: string | null; info: { w: number; h: number; fluid: number; total: number } | null }>({
    url: null,
    info: null,
  });
  const previewUrl = $derived(vue.url);
  const previewInfo = $derived(vue.info);

  // 只在剖面参数变化时重建预览 (用 untrack 避免 effect 自读自写)
  $effect(() => {
    const mode = sliceMode;
    const pos = position;
    const s = sliceToRGBA(solution, mode, pos);
    const png = encodePNG(s.width, s.height, s.data);
    let fluid = 0;
    for (let i = 0; i < s.solidMask.length; i++) if (!s.solidMask[i]) fluid++;
    const url = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
    untrack(() => {
      const prev = vue.url;
      vue = { url, info: { w: s.width, h: s.height, fluid, total: s.solidMask.length } };
      if (prev) setTimeout(() => URL.revokeObjectURL(prev), 1000);
    });
  });

  const ds = $derived(Math.max(1, Math.round(downsample)));
  const nx = $derived(solution.fine.nx);
  const ny = $derived(solution.fine.ny);
  const nz = $derived(solution.fine.nz);
  const ex = $derived(Math.floor(nx / ds));
  const ey = $derived(Math.floor(ny / ds));
  const ez = $derived(Math.floor(nz / ds));
  const bytes = $derived(ex * ey * ez * (1 + 2 * 4 + (includeAge ? 2 : 0)));

  function stamp() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  const meta = $derived({
    fans,
    sliceMode,
    slicePosition: position,
    exportedAt: new Date().toISOString(),
  });

  function doZip() {
    busy = true;
    setTimeout(() => {
      try {
        const blob = exportFieldZip(
          solution,
          { ...meta, exportedAt: new Date().toISOString() },
          { voxelJson, slicePng, downsample: ds, includeAge },
        );
        downloadBlob(blob, `mushroom-airflow-${stamp()}.zip`);
        done = `已导出 ${(blob.size / 1024 / 1024).toFixed(2)} MB`;
      } catch (e) {
        done = '导出失败: ' + (e as Error).message;
      } finally {
        busy = false;
      }
    }, 30);
  }

  function doSlice() {
    busy = true;
    setTimeout(() => {
      try {
        const blob = exportSlicePNG(solution, sliceMode, position);
        downloadBlob(blob, `slice-${sliceMode}-${stamp()}.png`);
        done = '剖面图已导出';
      } finally {
        busy = false;
      }
    }, 20);
  }

  function doVoxel() {
    busy = true;
    setTimeout(() => {
      try {
        const blob = exportVoxelData(solution, { ...meta, exportedAt: new Date().toISOString() });
        downloadBlob(blob, `voxel-field-${stamp()}.zip`);
        done = `体素数据已导出 ${(blob.size / 1024 / 1024).toFixed(2)} MB`;
      } finally {
        busy = false;
      }
    }, 20);
  }

  function fmtBytes(b: number) {
    if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
    return `${(b / 1024).toFixed(0)} KB`;
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>
      <div>
        <h2>导出风场数据</h2>
        <p class="sub">体素速度场、剖面图与色带图例打包为 ZIP</p>
      </div>
      <button class="ghost" onclick={onClose} aria-label="关闭">✕</button>
    </header>

    <div class="content">
      <div class="preview">
        <div class="preview-head">
          <span>当前剖面预览</span>
          <span class="mono dim">
            {sliceMode === 'horizontal' ? '水平' : sliceMode === 'vertical-x' ? '纵切' : '横切'} @ {position.toFixed(2)} m
          </span>
        </div>
        {#if previewUrl}
          <img src={previewUrl} alt="剖面预览" />
        {/if}
        {#if previewInfo}
          <div class="preview-foot mono">
            {previewInfo.w} × {previewInfo.h} px · 流体体素 {previewInfo.fluid.toLocaleString('en-US')}
          </div>
        {/if}
      </div>

      <div class="options">
        <div class="opt-head">导出内容</div>
        <label class="opt">
          <input type="checkbox" bind:checked={voxelJson} />
          <div>
            <strong>体素风场数据</strong>
            <span>JSON 元数据 + 二进制速度分量 (mm/s)、流体掩码、空气龄</span>
          </div>
        </label>
        <label class="opt">
          <input type="checkbox" bind:checked={slicePng} />
          <div>
            <strong>剖面图 (PNG)</strong>
            <span>三个剖面的 6 档速度色带图, 另附 legend.png</span>
          </div>
        </label>
        <label class="opt">
          <input type="checkbox" bind:checked={includeAge} disabled={!voxelJson} />
          <div>
            <strong>包含空气龄</strong>
            <span>age.i16, 0..10000 归一化</span>
          </div>
        </label>

        <div class="opt-group">
          <label for="ds">体素降采样</label>
          <select id="ds" bind:value={downsample}>
            <option value={1}>1× (全分辨率 {nx}×{ny}×{nz})</option>
            <option value={2}>2× ({(nx / 2) | 0}×{(ny / 2) | 0}×{(nz / 2) | 0})</option>
            <option value={4}>4× ({(nx / 4) | 0}×{(ny / 4) | 0}×{(nz / 4) | 0})</option>
          </select>
        </div>

        <div class="estimate">
          <span>预计体积</span>
          <span class="mono">{fmtBytes(bytes)}</span>
        </div>
      </div>
    </div>

    <footer>
      {#if done}
        <span class="done">{done}</span>
      {:else}
        <span class="dim">数据基于当前求解结果, 导出后可直接用于分析或归档</span>
      {/if}
      <div class="btns">
        <button onclick={doSlice} disabled={busy}>仅导出剖面 PNG</button>
        <button onclick={doVoxel} disabled={busy || !voxelJson}>仅导出体素数据</button>
        <button class="primary" onclick={doZip} disabled={busy}>
          {busy ? '导出中…' : '全部导出 (ZIP)'}
        </button>
      </div>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(3, 6, 10, 0.72);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .dialog {
    width: 620px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 60px);
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.65);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 16px 18px 13px;
    border-bottom: 1px solid var(--line-soft);
  }

  h2 {
    margin: 0;
    font-size: 14.5px;
    font-weight: 630;
  }

  .sub {
    margin: 3px 0 0;
    font-size: 11px;
    color: var(--text-faint);
  }

  .content {
    display: flex;
    gap: 16px;
    padding: 16px 18px;
    overflow-y: auto;
  }

  .preview {
    flex: 0 0 232px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .preview-head {
    display: flex;
    justify-content: space-between;
    font-size: 10.5px;
    color: var(--text-dim);
  }

  .preview img {
    width: 100%;
    aspect-ratio: 1.45;
    object-fit: contain;
    image-rendering: pixelated;
    background: #0a1017;
    border: 1px solid var(--line);
    border-radius: 6px;
  }

  .preview-foot {
    font-size: 9.5px;
    color: var(--text-faint);
    text-align: center;
  }

  .options {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }

  .opt-head {
    font-size: 10.5px;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .opt {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 9px 11px;
    background: var(--panel-2);
    border: 1px solid var(--line-soft);
    border-radius: 7px;
    cursor: pointer;
  }

  .opt:hover {
    border-color: var(--line);
  }

  .opt input {
    margin-top: 2px;
  }

  .opt strong {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .opt span {
    display: block;
    font-size: 10.5px;
    color: var(--text-faint);
    line-height: 1.5;
    margin-top: 2px;
  }

  .opt-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .estimate {
    display: flex;
    justify-content: space-between;
    padding: 8px 11px;
    background: rgba(67, 169, 240, 0.07);
    border: 1px solid rgba(67, 169, 240, 0.2);
    border-radius: 6px;
    font-size: 11px;
    color: var(--text-dim);
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 13px 18px;
    border-top: 1px solid var(--line-soft);
    flex-wrap: wrap;
  }

  .dim {
    color: var(--text-faint);
    font-size: 10.5px;
  }

  .done {
    color: var(--accent-2);
    font-size: 11px;
  }

  .btns {
    display: flex;
    gap: 7px;
  }

  .btns button {
    font-size: 11.5px;
  }

  .mono {
    font-family: var(--mono);
  }

  @media (max-width: 640px) {
    .content {
      flex-direction: column;
    }

    .preview {
      flex: none;
    }
  }
</style>
