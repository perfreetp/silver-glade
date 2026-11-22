/**
 * 极简响应式状态容器（框架无关，供各 Web Component 订阅）。
 */
export interface AppState {
  params: import('../sim/types').SimParams;
  points: import('../sim/types').InoculationPoint[];
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  frameIndex: number;
  frameCount: number;
  playing: boolean;
  fps: number;
  parallel: boolean;
  workerCount: number;
  errorMessage: string;
}

type Listener = (state: AppState) => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial: AppState) {
    this.state = { ...initial };
  }

  get snapshot(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }
}
