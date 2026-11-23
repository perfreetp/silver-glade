/** Web Components 基类：每实例独立 shadow root，卸载时清理订阅。 */

import { baseStyles } from './styles.ts';

export abstract class BtElement extends HTMLElement {
  protected readonly root: ShadowRoot;
  protected cleanup: Array<() => void> = [];
  private mounted = false;
  private pendingMount = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    if (this.mounted || this.pendingMount) return;
    // 宿主在同一任务内把依赖（如 store）以属性形式注入，
    // 因此把首次挂载推迟到微任务，确保注入已完成。
    this.pendingMount = true;
    queueMicrotask(() => {
      this.pendingMount = false;
      if (!this.isConnected || this.mounted) return;
      this.mounted = true;
      this.render();
      this.mountedCallback();
    });
  }

  disconnectedCallback(): void {
    if (!this.mounted) return;
    for (const fn of this.cleanup) {
      try {
        fn();
      } catch {
        /* 忽略 */
      }
    }
    this.cleanup = [];
    this.mounted = false;
    this.unmountedCallback();
  }

  protected abstract render(): void;
  protected mountedCallback(): void {}
  protected unmountedCallback(): void {}

  /** 组件样式：基础样式 + 组件自身 */
  protected styles(extra = ''): string {
    return `<style>${baseStyles}\n:host{display:block}\n${extra}</style>`;
  }

  protected q<T extends Element = HTMLElement>(sel: string): T | null {
    return this.root.querySelector<T>(sel);
  }

  protected qa<T extends Element = HTMLElement>(sel: string): T[] {
    return [...this.root.querySelectorAll<T>(sel)];
  }

  protected on<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    type: K,
    handler: (ev: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void;
  protected on(target: EventTarget, type: string, handler: (ev: Event) => void, opts?: AddEventListenerOptions): void;
  protected on(target: EventTarget, type: string, handler: (ev: Event) => void, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, handler as EventListener, opts);
    this.cleanup.push(() => target.removeEventListener(type, handler as EventListener, opts));
  }
}

/** 转义 HTML 文本 */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

let uid = 0;
export function nextUid(prefix = 'bt'): string {
  uid += 1;
  return `${prefix}-${uid}`;
}
