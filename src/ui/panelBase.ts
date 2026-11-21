/** Web Components 共享样式与小工具：原生 TS 自定义元素，不依赖任何框架 */
export const panelStyles = /* css */ `
  :host {
    display: block;
    background: rgba(17, 24, 39, 0.82);
    border: 1px solid rgba(102, 217, 255, 0.18);
    border-radius: 12px;
    padding: 14px 14px 12px;
    color: #dbe7f3;
    font-size: 13px;
    backdrop-filter: blur(10px);
  }
  h2 {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 650;
    letter-spacing: .08em;
    color: #66d9ff;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h2 .badge {
    margin-left: auto;
    font-size: 11px;
    font-weight: 400;
    color: #8aa3bd;
    letter-spacing: 0;
  }
  label { display: block; margin: 9px 0 4px; color: #9db4cc; font-size: 12px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row > * { flex: 1; min-width: 0; }
  input[type="range"] { width: 100%; accent-color: #66d9ff; }
  input[type="number"], select {
    width: 100%;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.14);
    color: #e6eef7;
    border-radius: 7px;
    padding: 6px 8px;
    font-size: 12px;
    outline: none;
  }
  input[type="number"]:focus, select:focus { border-color: #66d9ff; }
  button {
    background: linear-gradient(135deg, rgba(102,217,255,.22), rgba(102,217,255,.08));
    border: 1px solid rgba(102,217,255,.4);
    color: #cdefff;
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 12px;
    cursor: pointer;
    transition: background .15s, transform .05s;
  }
  button:hover { background: rgba(102,217,255,.3); }
  button:active { transform: translateY(1px); }
  button.danger { border-color: rgba(255,120,120,.45); color: #ffc4c4; background: rgba(255,90,90,.12); }
  button:disabled { opacity: .4; cursor: not-allowed; }
  .seg { display: flex; gap: 6px; }
  .seg button { flex: 1; }
  .seg button.active {
    background: rgba(102,217,255,.45);
    border-color: #66d9ff;
    color: #04121c;
    font-weight: 700;
  }
  .val { color: #66d9ff; font-variant-numeric: tabular-nums; font-size: 12px; }
  .muted { color: #7f96ad; font-size: 11px; line-height: 1.5; }
  ul.machines { list-style: none; margin: 8px 0 0; padding: 0; max-height: 150px; overflow-y: auto; }
  ul.machines li {
    padding: 6px 8px;
    border-radius: 7px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    gap: 6px;
    border: 1px solid transparent;
  }
  ul.machines li:hover { background: rgba(255,255,255,.05); }
  ul.machines li.selected {
    background: rgba(102,217,255,.14);
    border-color: rgba(102,217,255,.4);
  }
  .chip {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 99px;
    background: rgba(102,217,255,.18);
    color: #9fe4ff;
  }
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 10px;
    margin-top: 8px;
  }
  .stats .k { color: #7f96ad; font-size: 11px; }
  .stats .v { color: #e6eef7; font-weight: 600; font-variant-numeric: tabular-nums; }
  .switch { display:flex; align-items:center; gap:8px; margin: 8px 0; cursor:pointer; }
  .switch input { accent-color: #66d9ff; width: 15px; height: 15px; }
`;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** 滑块 + 数值读数的组合控件 */
export function slider(
  root: ShadowRoot,
  id: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void,
): { input: HTMLInputElement; value: HTMLSpanElement } {
  const input = root.getElementById(id) as HTMLInputElement;
  const valueEl = root.getElementById(`${id}-val`) as HTMLSpanElement;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  valueEl.textContent = String(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    valueEl.textContent = String(v);
    onInput(v);
  });
  return { input, value: valueEl };
}

export function setSlider(input: HTMLInputElement, valueEl: HTMLSpanElement, v: number): void {
  input.value = String(v);
  valueEl.textContent = String(v);
}
