import { onMount, createEffect, For, Show, createMemo } from 'solid-js';
import {
  params, setParams, PRESETS,
  versions, compareIds, toggleCompare,
  snapshot, scheduleSnapshot, restoreVersion, deleteVersion,
  setSnapshotLabel, shadowLength, azLabel,
  PARAM_LABELS, fmtVal, PERSON_HEIGHT,
} from './store';
import { initScene } from './scene';

function Slider(props) {
  return (
    <label class="slider-row">
      <span class="slider-label">{props.icon} {props.label}</span>
      <input
        type="range"
        min={props.min} max={props.max} step={props.step}
        value={props.value}
        onInput={(e) => props.onChange(parseFloat(e.currentTarget.value))}
      />
      <span class="slider-value">{props.format ? props.format(props.value) : props.value}</span>
    </label>
  );
}

function Toggle(props) {
  return (
    <label class="toggle-row">
      <span>{props.icon} {props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
    </label>
  );
}

const DEBUG_VIEWS = [
  ['none', '关闭'],
  ['shadowmap', '阴影贴图本体'],
  ['cascade', '级联分层染色'],
  ['depth', '深度视图'],
];

function VersionPanel() {
  const fmtTime = (d) =>
    d.toLocaleTimeString('zh-CN', { hour12: false });
  return (
    <div class="version-list">
      <For each={[...versions()].reverse()}>
        {(v) => (
          <div class="version-row" classList={{ picked: compareIds().includes(v.id) }}>
            <label class="version-check" title="选两个版本进行对比">
              <input
                type="checkbox"
                checked={compareIds().includes(v.id)}
                onChange={() => toggleCompare(v.id)}
              />
            </label>
            <div class="version-info">
              <div class="version-title">
                #{v.id} {v.label}
                <span class="version-time">{fmtTime(v.time)}</span>
              </div>
              <div class="version-sub">
                高度角 {v.params.elevation}° · 方位角 {v.params.azimuth}° · 影长{' '}
                {shadowLength(v.params).toFixed(1)}m
              </div>
            </div>
            <div class="version-actions">
              <button title="恢复这个版本" onClick={() => restoreVersion(v)}>⏪</button>
              <button title="删除" onClick={() => deleteVersion(v.id)}>🗑</button>
            </div>
          </div>
        )}
      </For>
      <Show when={versions().length === 0}>
        <p class="empty-tip">还没有版本,动动滑块试试~</p>
      </Show>
    </div>
  );
}

function ComparePanel() {
  const pair = createMemo(() => {
    const ids = compareIds();
    if (ids.length !== 2) return null;
    const vs = versions();
    const a = vs.find((v) => v.id === ids[0]);
    const b = vs.find((v) => v.id === ids[1]);
    return a && b ? [a, b] : null;
  });

  return (
    <Show when={pair()} keyed fallback={<p class="empty-tip">勾选两个版本,就能左右对比啦 👆</p>}>
      {([a, b]) => {
        const la = shadowLength(a.params);
        const lb = shadowLength(b.params);
        const lmax = Math.max(la, lb, 0.001);
        const keys = Object.keys(PARAM_LABELS);
        return (
          <div class="compare">
            <div class="compare-head">
              <span>#{a.id} {a.label}</span>
              <span>#{b.id} {b.label}</span>
            </div>

            <div class="shadow-bars">
              <div class="shadow-bar-row">
                <div class="shadow-bar" style={{ width: `${(la / lmax) * 100}%` }} />
                <span>影长 {la.toFixed(2)}m · 影子朝{azLabel((a.params.azimuth + 180) % 360)}</span>
              </div>
              <div class="shadow-bar-row b">
                <div class="shadow-bar" style={{ width: `${(lb / lmax) * 100}%` }} />
                <span>影长 {lb.toFixed(2)}m · 影子朝{azLabel((b.params.azimuth + 180) % 360)}</span>
              </div>
              <p class="compare-note">
                按 {PERSON_HEIGHT}m 高的小人计算,影长相差 {(Math.abs(la - lb)).toFixed(2)}m
                ({(Math.max(la, lb) / Math.min(la, lb)).toFixed(1)} 倍)
              </p>
            </div>

            <table class="diff-table">
              <thead>
                <tr><th>参数</th><th>#{a.id}</th><th>#{b.id}</th></tr>
              </thead>
              <tbody>
                <For each={keys}>
                  {(k) => (
                    <tr classList={{ diff: a.params[k] !== b.params[k] }}>
                      <td>{PARAM_LABELS[k]}</td>
                      <td>{fmtVal(k, a.params[k])}</td>
                      <td>{fmtVal(k, b.params[k])}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        );
      }}
    </Show>
  );
}

export default function App() {
  let canvasRef;
  let api = null;

  onMount(() => {
    // 支持 ?el=高度角&az=方位角&dbg=调试视图 直接定位到某个状态(便于演示/分享)
    const q = new URLSearchParams(location.search);
    const patch = {};
    if (q.has('el')) patch.elevation = Math.min(80, Math.max(10, +q.get('el')));
    if (q.has('az')) patch.azimuth = ((+q.get('az') % 360) + 360) % 360;
    if (q.has('dbg')) patch.debugView = q.get('dbg');
    if (Object.keys(patch).length) setParams(patch);

    api = initScene(canvasRef, {
      onPersonMoved: () => scheduleSnapshot('移动小人'),
    });
    snapshot('初始版本');
  });

  // 任何参数变化 → 应用到场景 + 自动存一个版本
  createEffect(() => {
    const p = { ...params };
    api?.applyParams(p);
    scheduleSnapshot('调整参数');
  });

  const applyPreset = (key) => {
    const p = PRESETS[key];
    setSnapshotLabel(`预设·${p.label}`);
    setParams({ elevation: p.elevation, azimuth: p.azimuth });
  };

  return (
    <div class="app">
      <header>
        <h1>🌞 太阳影子小街区</h1>
        <div class="presets">
          <button class="preset noon" onClick={() => applyPreset('noon')}>☀️ 正午</button>
          <button class="preset evening" onClick={() => applyPreset('evening')}>🌇 傍晚</button>
        </div>
      </header>

      <div class="main">
        <aside class="panel controls">
          <section>
            <h2>🌞 太阳在哪里</h2>
            <Slider icon="📐" label="高度角" min={10} max={80} step={1}
              value={params.elevation}
              format={(v) => `${v}°`}
              onChange={(v) => setParams('elevation', v)} />
            <Slider icon="🧭" label="方位角" min={0} max={360} step={1}
              value={params.azimuth}
              format={(v) => `${v}° (${azLabel(v)})`}
              onChange={(v) => setParams('azimuth', v)} />
            <p class="tip">现在小人的影子约 {shadowLength(params).toFixed(2)} 米长</p>
          </section>

          <section>
            <h2>🎛 阴影质量</h2>
            <Slider icon="🖼" label="贴图分辨率" min={512} max={2048} step={256}
              value={params.mapSize}
              format={(v) => `${v}px`}
              onChange={(v) => setParams('mapSize', v)} />
            <Slider icon="🩹" label="阴影偏移" min={-0.003} max={0.003} step={0.0001}
              value={params.bias}
              format={(v) => v.toFixed(4)}
              onChange={(v) => setParams('bias', v)} />
            <Slider icon="📏" label="法线偏移" min={0} max={0.2} step={0.005}
              value={params.normalBias}
              format={(v) => v.toFixed(3)}
              onChange={(v) => setParams('normalBias', v)} />
            <Slider icon="🌫" label="柔化采样核" min={0} max={16} step={0.5}
              value={params.radius}
              format={(v) => v.toFixed(1)}
              onChange={(v) => setParams('radius', v)} />
          </section>

          <section>
            <h2>💡 路灯</h2>
            <Toggle icon="🏮" label="路灯①(北边)" checked={params.lamp1}
              onChange={(v) => setParams('lamp1', v)} />
            <Toggle icon="🏮" label="路灯②(南边)" checked={params.lamp2}
              onChange={(v) => setParams('lamp2', v)} />
            <p class="tip">关掉一盏灯,它那一片影子就消失啦</p>
          </section>

          <section>
            <h2>🧱 地面和墙面</h2>
            <Slider icon="🌱" label="地面粗糙度" min={0} max={1} step={0.05}
              value={params.groundRoughness}
              format={(v) => v.toFixed(2)}
              onChange={(v) => setParams('groundRoughness', v)} />
            <Slider icon="🏠" label="墙面粗糙度" min={0} max={1} step={0.05}
              value={params.wallRoughness}
              format={(v) => v.toFixed(2)}
              onChange={(v) => setParams('wallRoughness', v)} />
            <p class="tip">越粗糙,影子边缘越散(柔化核会自动放大)</p>
          </section>

          <section>
            <h2>🔍 调试视图</h2>
            <div class="select-row">
              <For each={DEBUG_VIEWS}>
                {([val, label]) => (
                  <button
                    class="chip"
                    classList={{ active: params.debugView === val }}
                    onClick={() => setParams('debugView', val)}
                  >
                    {label}
                  </button>
                )}
              </For>
            </div>
            <Show when={params.debugView === 'shadowmap'}>
              <div class="select-row">
                <For each={[['0', '近'], ['1', '中'], ['2', '远']]}>
                  {([val, label]) => (
                    <button
                      class="chip"
                      classList={{ active: params.debugCascade === Number(val) }}
                      onClick={() => setParams('debugCascade', Number(val))}
                    >
                      {label}级
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </aside>

        <div class="viewport">
          <canvas ref={canvasRef} />
          <div class="hint">🖱️ 拖动小人换位置,看看影子怎么交叠!</div>
          <Show when={params.debugView === 'shadowmap'}>
            <div class="debug-badge">
              左下角:{['近', '中', '远'][params.debugCascade]}级级联的阴影贴图
            </div>
          </Show>
          <Show when={params.debugView === 'cascade'}>
            <div class="debug-badge">
              🔴近处一级 · 🟢中间一级 · 🔵远处一级(精度最低)
            </div>
          </Show>
        </div>

        <aside class="panel versions-panel">
          <section>
            <h2>📚 版本记录</h2>
            <VersionPanel />
          </section>
          <section>
            <h2>⚖️ 版本对比</h2>
            <ComparePanel />
          </section>
        </aside>
      </div>
    </div>
  );
}
