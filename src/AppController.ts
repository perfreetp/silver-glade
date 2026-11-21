import type { EventBus } from './core/EventBus';
import type { MachineManager } from './core/MachineManager';
import type { SnowField } from './core/SnowField';
import type { ParticleSystem } from './core/ParticleSystem';
import type { TrajectoryPreview } from './core/TrajectoryPreview';
import type { SceneManager } from './three/SceneManager';
import type { MachineView } from './three/MachineView';
import type { PlanPanel } from './ui/PlanPanel';
import { PlanExporter } from './core/PlanExporter';

/**
 * 应用控制器：把事件总线、仿真内核与 3D 视图接成单向数据流。
 *
 * 风向联动的关键路径：
 *   ParameterPanel --wind:change--> MachineManager.setWind
 *     -> TrajectoryPreview.rebuildOne（炮口轨迹重算）
 *     -> ParticleSystem 下一固定步长读新风场（飘移粒子重算）
 *     -> 粒子落地按新落点 SnowField.deposit（坡面积雪重算）
 * 三处共享同一份 MachineConfig 数据，保证同源、同帧生效。
 */
export class AppController {
  constructor(
    private bus: EventBus,
    private manager: MachineManager,
    private snowField: SnowField,
    private particles: ParticleSystem,
    private trajectory: TrajectoryPreview,
    private machineView: MachineView,
    private scene: SceneManager,
    private planPanel: PlanPanel,
  ) {
    this.bind();
  }

  private bind(): void {
    const b = this.bus;

    b.on('machine:add', ({ x, z }) => {
      const cfg = this.manager.add(x, z);
      this.syncViews();
      this.trajectory.rebuildOne(cfg);
      this.emitListChanged();
    });

    b.on('machine:delete', ({ id }) => {
      this.manager.remove(id);
      this.syncViews();
      this.trajectory.rebuild(this.manager.list());
      this.emitListChanged();
    });

    b.on('machine:select', () => {
      this.syncViews();
      this.scene.refreshWindField();
    });

    b.on('machine:transform', ({ id }) => {
      const cfg = this.manager.get(id);
      if (!cfg) return;
      this.syncViews();
      this.trajectory.rebuildOne(cfg);
      this.scene.refreshWindField();
    });

    b.on('level:change', ({ id, level }) => {
      this.manager.setLevel(id, level);
      const cfg = this.manager.get(id);
      if (cfg) this.trajectory.rebuildOne(cfg);
      this.syncViews();
      this.emitListChanged();
    });

    b.on('wind:change', ({ id, direction, speed }) => {
      this.manager.setWind(id, { direction, speed });
      const cfg = this.manager.get(id);
      if (!cfg) return;
      // 联动第 1 处：轨迹立即重算；第 2/3 处（粒子飘移、堆积）在下一仿真步自动生效
      this.trajectory.rebuildOne(cfg);
      this.scene.refreshWindField();
    });

    b.on('wind:apply-all', ({ direction, speed }) => {
      this.manager.applyWindToAll({ direction, speed });
      this.trajectory.rebuild(this.manager.list());
      this.scene.refreshWindField();
      this.emitListChanged();
    });

    b.on('sim:toggle', ({ running }) => this.scene.setRunning(running));
    b.on('sim:time-scale', ({ scale }) => this.scene.setTimeScale(scale));
    b.on('sim:night', ({ night }) => {
      this.night = night;
      this.scene.setNight(night);
      this.syncViews();
    });
    b.on('sim:trajectories', ({ visible }) => this.scene.setTrajectoriesVisible(visible));
    b.on('sim:forecast', ({ visible }) => this.scene.setForecastVisible(visible));
    b.on('sim:reset-snow', () => {
      this.snowField.reset();
      this.particles.reset();
      this.trajectory.rebuild(this.manager.list());
    });

    b.on('plan:export', () => PlanExporter.download(this.manager.list()));

    b.on('plan:import', async ({ file }) => {
      try {
        const plan = await PlanExporter.parse(file);
        this.manager.load(plan.machines);
        this.particles.reset();
        this.snowField.reset();
        this.syncViews();
        this.trajectory.rebuild(this.manager.list());
        this.scene.refreshWindField();
        this.emitListChanged();
        this.planPanel.flash(`导入成功：${plan.machines.length} 台造雪机`, false);
      } catch (err) {
        this.planPanel.flash(`导入失败：${(err as Error).message}`, true);
      }
    });
  }

  /** 机器视图与当前选择保持一致（夜间状态一并下发给炮口辉光） */
  private syncViews(): void {
    this.machineView.sync(this.manager.list(), this.manager.selectedId, this.isNight());
  }

  private night = false;
  private isNight(): boolean {
    return this.night;
  }

  private emitListChanged(): void {
    this.bus.emit('machine:list-changed', {
      count: this.manager.count,
      selectedId: this.manager.selectedId,
    });
  }
}
