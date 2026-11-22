/**
 * Web Component 基类：封装轻量 shadow-DOM 样式与挂载约定。
 */
export abstract class BaseComponent extends HTMLElement {
  protected root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  protected setHTML(inner: string, css: string): void {
    this.root.innerHTML = `<style>${css}</style>${inner}`;
  }

  protected $<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.root.querySelector(selector);
    if (!el) throw new Error(`元素未找到：${selector}`);
    return el as T;
  }

  protected $$<T extends HTMLElement = HTMLElement>(selector: string): T[] {
    return Array.from(this.root.querySelectorAll(selector)) as T[];
  }
}

export const panelCss = `
  :host {
    display: block;
    background: var(--panel-bg, #171c22);
    border: 1px solid #262e38;
    border-radius: 10px;
    padding: 14px 16px;
    color: #d7dee6;
    font-size: 13px;
  }
  h2 {
    margin: 0 0 10px;
    font-size: 14px;
    font-weight: 600;
    color: #eef2f6;
    letter-spacing: 0.02em;
  }
  label { display: block; margin: 10px 0 4px; color: #9fb0bf; }
  input[type="range"] { width: 100%; accent-color: #6ea8d8; }
  input[type="number"], select {
    width: 100%;
    box-sizing: border-box;
    background: #10151a;
    color: #d7dee6;
    border: 1px solid #2c3642;
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 13px;
  }
  button {
    background: #243244;
    color: #dce6f0;
    border: 1px solid #34475e;
    border-radius: 6px;
    padding: 7px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  button:hover { background: #2d4057; }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  button.primary { background: #2f6da3; border-color: #3d83bf; }
  button.primary:hover { background: #367bb8; }
  button.danger { background: #5a2b2b; border-color: #7a3a3a; }
  .row { display: flex; gap: 8px; align-items: center; }
  .value { color: #8fc1ee; font-variant-numeric: tabular-nums; }
  .hint { color: #73828f; font-size: 11.5px; line-height: 1.5; margin-top: 6px; }
`;
