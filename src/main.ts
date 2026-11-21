import './styles.css';
import { EventBus } from './core/EventBus';
import { MachineManager } from './core/MachineManager';
import { SnowField } from './core/SnowField';
import { ParticleSystem } from './core/ParticleSystem';
import { TrajectoryPreview } from './core/TrajectoryPreview';
import { MachineView } from './three/MachineView';
import { SceneManager } from './three/SceneManager';
import { AppController } from './AppController';
import { MachinePanel } from './ui/MachinePanel';
import { ParameterPanel } from './ui/ParameterPanel';
import { SimulationPanel } from './ui/SimulationPanel';
import { PlanPanel } from './ui/PlanPanel';

customElements.define('machine-panel', MachinePanel);
customElements.define('parameter-panel', ParameterPanel);
customElements.define('simulation-panel', SimulationPanel);
customElements.define('plan-panel', PlanPanel);

const bus = new EventBus();
const manager = new MachineManager();
const snowField = new SnowField();
const particles = new ParticleSystem(snowField);
const trajectory = new TrajectoryPreview(snowField);
const machineView = new MachineView();

const container = document.getElementById('stage')!;
const scene = new SceneManager(container, bus, manager, snowField, particles, trajectory, machineView);

const machinePanel = document.querySelector<MachinePanel>('machine-panel')!;
const parameterPanel = document.querySelector<ParameterPanel>('parameter-panel')!;
const simulationPanel = document.querySelector<SimulationPanel>('simulation-panel')!;
const planPanel = document.querySelector<PlanPanel>('plan-panel')!;

machinePanel.connect(bus, manager);
parameterPanel.connect(bus, manager);
simulationPanel.connect(bus);
planPanel.connect(bus, manager);

new AppController(bus, manager, snowField, particles, trajectory, machineView, scene, planPanel);

// 初始示例：上/中/下游各摆一台，不同档位与风向，便于直接观察堆积差异
const seeds = [
  { x: -14, z: -34, yaw: 12, pitch: 30, level: 3 as const, wind: { direction: 20, speed: 6 } },
  { x: 8, z: -6, yaw: -8, pitch: 26, level: 2 as const, wind: { direction: 45, speed: 4 } },
  { x: -6, z: 26, yaw: 5, pitch: 24, level: 1 as const, wind: { direction: -15, speed: 8 } },
];
for (const s of seeds) {
  const cfg = manager.add(s.x, s.z);
  cfg.yaw = s.yaw;
  cfg.pitch = s.pitch;
  cfg.level = s.level;
  cfg.wind = { ...s.wind };
}
manager.select(manager.list()[0].id);

machineView.sync(manager.list(), manager.selectedId, false);
trajectory.rebuild(manager.list());
scene.refreshWindField();
bus.emit('machine:list-changed', { count: manager.count, selectedId: manager.selectedId });
bus.emit('machine:select', { id: manager.selectedId });

scene.start();

// 调试 / 自动化验证钩子（CDP 冒烟脚本使用，不影响正常交互）
declare global {
  interface Window {
    __snow: {
      bus: EventBus;
      manager: MachineManager;
      scene: SceneManager;
      particles: ParticleSystem;
      snowField: SnowField;
    };
  }
}
window.__snow = { bus, manager, scene, particles, snowField };
