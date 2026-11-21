/**
 * 轻量类型化事件总线：UI（Web Components）与 3D 场景之间解耦通信。
 * 所有跨模块联动（尤其是风向变化的三处重算）都经由这里派发。
 */
export interface EventMap {
  'machine:add': { x: number; z: number };
  'machine:select': { id: number | null };
  'machine:delete': { id: number };
  'machine:transform': { id: number; x: number; z: number; yaw: number; pitch: number };
  'machine:list-changed': { count: number; selectedId: number | null };
  'level:change': { id: number; level: 1 | 2 | 3 };
  'wind:change': { id: number; direction: number; speed: number };
  'wind:apply-all': { direction: number; speed: number };
  'sim:toggle': { running: boolean };
  'sim:time-scale': { scale: number };
  'sim:night': { night: boolean };
  'sim:trajectories': { visible: boolean };
  'sim:forecast': { visible: boolean };
  'sim:reset-snow': Record<string, never>;
  'stats:update': unknown;
  'plan:export': Record<string, never>;
  'plan:import': { file: File };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof EventMap, Set<Handler<never>>>();

  on<K extends keyof EventMap>(event: K, fn: Handler<EventMap[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as Handler<never>);
    return () => this.off(event, fn);
  }

  off<K extends keyof EventMap>(event: K, fn: Handler<EventMap[K]>): void {
    this.handlers.get(event)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.handlers.get(event)?.forEach((fn) => {
      try {
        (fn as Handler<EventMap[K]>)(payload);
      } catch (err) {
        console.error(`[EventBus] handler error for "${String(event)}"`, err);
      }
    });
  }
}
