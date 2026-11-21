import type { MachineConfig, SnowPlan } from './types';
import { TERRAIN } from './constants';

/**
 * 造雪计划导入导出（模块四）。
 * 导出内容：造雪机位置（x/z/yaw/pitch）、雪量档位、风向（角度+风速）。
 */
export class PlanExporter {
  static export(machines: readonly MachineConfig[]): SnowPlan {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      terrain: { width: TERRAIN.WIDTH, length: TERRAIN.LENGTH },
      machines: machines.map((m) => structuredClone(m)),
    };
  }

  static download(machines: readonly MachineConfig[]): void {
    const plan = this.export(machines);
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `snow-plan-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static async parse(file: File): Promise<SnowPlan> {
    const text = await file.text();
    const data = JSON.parse(text) as SnowPlan;
    return PlanExporter.validate(data);
  }

  static validate(data: unknown): SnowPlan {
    if (typeof data !== 'object' || data === null) throw new Error('计划文件格式错误');
    const plan = data as Partial<SnowPlan>;
    if (plan.version !== 1 || !Array.isArray(plan.machines)) throw new Error('计划版本不支持或缺少 machines 字段');
    for (const m of plan.machines) {
      if (
        typeof m.id !== 'number' ||
        typeof m.x !== 'number' ||
        typeof m.z !== 'number' ||
        typeof m.yaw !== 'number' ||
        typeof m.pitch !== 'number' ||
        ![1, 2, 3].includes(m.level) ||
        typeof m.wind?.direction !== 'number' ||
        typeof m.wind?.speed !== 'number'
      ) {
        throw new Error(`造雪机 #${(m as { id?: number }).id ?? '?'} 字段不完整`);
      }
    }
    return plan as SnowPlan;
  }
}
