import type { MachineConfig, SnowLevel, WindState } from './types';
import { WIND } from './constants';
import { terrainHeight } from './mathUtils';

/**
 * 造雪机数据中心（模块一/二的状态层）。
 * 3D 视图与 Web Components 面板都从这里读写，避免双向状态分叉。
 */
export class MachineManager {
  private machines = new Map<number, MachineConfig>();
  private nextId = 1;
  selectedId: number | null = null;

  add(x: number, z: number): MachineConfig {
    const id = this.nextId++;
    const cfg: MachineConfig = {
      id,
      x,
      z,
      yaw: 0,
      pitch: 28,
      level: 2,
      wind: { direction: WIND.DEFAULT_DIR, speed: WIND.DEFAULT_SPEED },
    };
    this.machines.set(id, cfg);
    this.selectedId = id;
    return cfg;
  }

  remove(id: number): void {
    this.machines.delete(id);
    if (this.selectedId === id) this.selectedId = this.machines.size ? Math.max(...this.machines.keys()) : null;
  }

  get(id: number): MachineConfig | undefined {
    return this.machines.get(id);
  }

  list(): readonly MachineConfig[] {
    return [...this.machines.values()].sort((a, b) => a.id - b.id);
  }

  get count(): number {
    return this.machines.size;
  }

  select(id: number | null): void {
    this.selectedId = id;
  }

  updateTransform(id: number, patch: Partial<Pick<MachineConfig, 'x' | 'z' | 'yaw' | 'pitch'>>): MachineConfig | undefined {
    const m = this.machines.get(id);
    if (!m) return undefined;
    Object.assign(m, patch);
    return m;
  }

  setLevel(id: number, level: SnowLevel): void {
    const m = this.machines.get(id);
    if (m) m.level = level;
  }

  setWind(id: number, patch: Partial<WindState>): void {
    const m = this.machines.get(id);
    if (!m) return;
    m.wind = { ...m.wind, ...patch };
  }

  applyWindToAll(wind: WindState): void {
    for (const m of this.machines.values()) m.wind = { ...wind };
  }

  /** 造雪机贴地高度（底座放置点） */
  groundY(cfg: MachineConfig): number {
    return terrainHeight(cfg.x, cfg.z);
  }

  serialize(): MachineConfig[] {
    return this.list().map((m) => structuredClone(m));
  }

  load(configs: MachineConfig[]): void {
    this.machines.clear();
    let maxId = 0;
    for (const c of configs) {
      this.machines.set(c.id, structuredClone(c));
      maxId = Math.max(maxId, c.id);
    }
    this.nextId = maxId + 1;
    this.selectedId = this.machines.size ? Math.min(...this.machines.keys()) : null;
  }
}
