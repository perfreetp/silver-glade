<script lang="ts">
  import { WALL_LABEL, wallFrame, type Fan, type FanKind, type Wall } from '../lib/model/room';
  import { fanFaceSpeed, fanArea } from '../lib/model/fans';

  let {
    fans,
    selectedId,
    onSelect,
    onUpdate,
    onAdd,
    onRemove,
    onSolve,
    solving,
  }: {
    fans: Fan[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onUpdate: (f: Fan) => void;
    onAdd: (kind: FanKind) => void;
    onRemove: (id: string) => void;
    onSolve: () => void;
    solving: boolean;
  } = $props();

  const selected = $derived(fans.find((f) => f.id === selectedId) ?? null);

  function set<K extends keyof Fan>(key: K, val: Fan[K]) {
    if (!selected) return;
    let next = { ...selected, [key]: val };
    // 换墙时把 u/v 夹到新墙的范围内
    if (key === 'wall') {
      const fr = wallFrame(val as Wall);
      next.u = Math.min(fr.width - next.radius - 0.06, Math.max(next.radius + 0.06, next.u));
      next.v = Math.min(fr.height - next.radius - 0.06, Math.max(next.radius + 0.06, next.v));
    }
    onUpdate(next);
  }

  const walls: Wall[] = ['west', 'east', 'south', 'north'];
  const faceSpeed = $derived(selected ? fanFaceSpeed(selected) : 0);
  const area = $derived(selected ? fanArea(selected) : 0);

  function fmt(v: number, d = 2) {
    return v.toFixed(d);
  }
</script>

<div class="panel">
  <div class="panel-head">
    <h2>风机设置</h2>
    <span class="count">{fans.length} 个</span>
  </div>

  <div class="list">
    {#each fans as fan (fan.id)}
      <button
        class="fan-row"
        class:active={fan.id === selectedId}
        class:supply={fan.kind === 'supply'}
        class:exhaust={fan.kind === 'exhaust'}
        onclick={() => onSelect(fan.id)}
      >
        <span class="kind-dot"></span>
        <span class="fan-name">{fan.name}</span>
        <span class="fan-meta mono">{Math.round(fan.airflow)} m³/h</span>
      </button>
    {/each}
  </div>

  <div class="add-row">
    <button onclick={() => onAdd('supply')}>+ 进风机</button>
    <button onclick={() => onAdd('exhaust')}>+ 回风机</button>
  </div>

  {#if selected}
    {@const sel = selected}
    <div class="editor">
      <div class="field">
        <label for="fan-name">名称</label>
        <input id="fan-name" type="text" value={sel.name} oninput={(e) => set('name', (e.currentTarget as HTMLInputElement).value)} />
      </div>

      <div class="field-row">
        <div class="field">
          <label for="fan-kind">类型</label>
          <select id="fan-kind" value={sel.kind} onchange={(e) => set('kind', (e.currentTarget as HTMLSelectElement).value as FanKind)}>
            <option value="supply">进风 (吹入)</option>
            <option value="exhaust">回风 (吸出)</option>
          </select>
        </div>
        <div class="field">
          <label for="fan-wall">安装墙面</label>
          <select id="fan-wall" value={sel.wall} onchange={(e) => set('wall', (e.currentTarget as HTMLSelectElement).value as Wall)}>
            {#each walls as w}
              <option value={w}>{WALL_LABEL[w]}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="field">
        <div class="field-label">
          <label for="fan-airflow">风量</label>
          <span class="mono">{Math.round(sel.airflow)} m³/h</span>
        </div>
        <input
          id="fan-airflow"
          type="range"
          min="500"
          max="24000"
          step="100"
          value={sel.airflow}
          oninput={(e) => set('airflow', +(e.currentTarget as HTMLInputElement).value)}
        />
        <div class="range-hint mono">
          面风速 {fmt(faceSpeed, 2)} m/s · 风口面积 {fmt(area, 3)} m²
        </div>
      </div>

      <div class="field">
        <div class="field-label">
          <label for="fan-radius">风口半径</label>
          <span class="mono">{fmt(sel.radius, 2)} m</span>
        </div>
        <input
          id="fan-radius"
          type="range"
          min="0.18"
          max="0.95"
          step="0.01"
          value={sel.radius}
          oninput={(e) => set('radius', +(e.currentTarget as HTMLInputElement).value)}
        />
      </div>

      <div class="field">
        <div class="field-label">
          <label for="fan-tilt">水平偏转 (tilt)</label>
          <span class="mono">{fmt((sel.tilt * 180) / Math.PI, 0)}°</span>
        </div>
        <input
          id="fan-tilt"
          type="range"
          min={-Math.PI / 3}
          max={Math.PI / 3}
          step="0.01"
          value={sel.tilt}
          oninput={(e) => set('tilt', +(e.currentTarget as HTMLInputElement).value)}
        />
      </div>

      <div class="field">
        <div class="field-label">
          <label for="fan-pitch">仰角 (pitch)</label>
          <span class="mono">{fmt((sel.pitch * 180) / Math.PI, 0)}°</span>
        </div>
        <input
          id="fan-pitch"
          type="range"
          min={-Math.PI / 3}
          max={Math.PI / 3}
          step="0.01"
          value={sel.pitch}
          oninput={(e) => set('pitch', +(e.currentTarget as HTMLInputElement).value)}
        />
      </div>

      <div class="field-row pos">
        <div class="field">
          <label for="fan-u">位置 u</label>
          <input id="fan-u" type="number" step="0.05" value={fmt(sel.u, 2)} oninput={(e) => set('u', +(e.currentTarget as HTMLInputElement).value)} />
        </div>
        <div class="field">
          <label for="fan-v">位置 v</label>
          <input id="fan-v" type="number" step="0.05" value={fmt(sel.v, 2)} oninput={(e) => set('v', +(e.currentTarget as HTMLInputElement).value)} />
        </div>
      </div>

      <div class="actions">
        <button class="danger" onclick={() => onRemove(sel.id)}>删除</button>
        <button class="primary" onclick={onSolve} disabled={solving}>
          {solving ? '求解中…' : '重算风场'}
        </button>
      </div>

      <p class="tip">也可以直接在 3D 场景中拖动橙色/蓝色圆盘移动风口。</p>
    </div>
  {:else}
    <div class="empty">选择或新建一个风机</div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    overflow-y: auto;
    padding-bottom: 16px;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 13px 14px 9px;
    position: sticky;
    top: 0;
    background: var(--panel);
    z-index: 2;
  }

  h2 {
    margin: 0;
    font-size: 12.5px;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .count {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 8px;
  }

  .fan-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    text-align: left;
    width: 100%;
  }

  .fan-row:hover {
    background: var(--panel-2);
  }

  .fan-row.active {
    background: var(--panel-3);
    border-color: #2b4a66;
  }

  .kind-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: 0 0 auto;
  }

  .supply .kind-dot {
    background: #3fa9f5;
    box-shadow: 0 0 7px #3fa9f5;
  }

  .exhaust .kind-dot {
    background: #f5a742;
    box-shadow: 0 0 7px #f5a742;
  }

  .fan-name {
    font-size: 12px;
    flex: 1 1 auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fan-meta {
    font-size: 10.5px;
    color: var(--text-faint);
  }

  .add-row {
    display: flex;
    gap: 6px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line-soft);
  }

  .add-row button {
    flex: 1;
    font-size: 11.5px;
    padding: 6px 0;
  }

  .editor {
    padding: 12px 14px 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-row {
    display: flex;
    gap: 10px;
  }

  .field-row > .field {
    flex: 1;
    min-width: 0;
  }

  .field-label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .field-label span {
    font-size: 11px;
    color: var(--accent);
  }

  .range-hint {
    font-size: 10px;
    color: var(--text-faint);
  }

  .actions {
    display: flex;
    gap: 8px;
    padding-top: 4px;
  }

  .actions button {
    flex: 1;
  }

  .tip {
    margin: 2px 0 0;
    font-size: 10.5px;
    color: var(--text-faint);
    line-height: 1.5;
  }

  .empty {
    padding: 22px;
    text-align: center;
    color: var(--text-faint);
    font-size: 12px;
  }

  .mono {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
  }
</style>
