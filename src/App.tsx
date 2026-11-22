import { type JSX, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { config } from './store/configStore';
import { RenderCoordinator } from './optics/renderCoordinator';
import { LightSourcePanel } from './panels/LightSourcePanel';
import { LensPanel } from './panels/LensPanel';
import { ProjectionPanel } from './panels/ProjectionPanel';
import { ExportPanel } from './panels/ExportPanel';

type TabId = 'light' | 'lens' | 'projection' | 'export';

const TABS: { id: TabId; label: string }[] = [
  { id: 'light', label: '光源布局' },
  { id: 'lens', label: '透镜编辑' },
  { id: 'projection', label: '光型投射' },
  { id: 'export', label: '配置导出' },
];

export function App(): JSX.Element {
  const [tab, setTab] = createSignal<TabId>('projection');
  // 渲染调度器随应用生命周期存在，内部透镜 BVH 跨模块共享
  const coordinator = new RenderCoordinator({
    leds: config.leds.map((l) => ({ ...l })),
    lens: { ...config.lens },
    projection: { ...config.projection },
    wallDistance: config.wallDistance,
  });
  onCleanup(() => coordinator.dispose());

  const enabledCount = createMemo(() => config.leds.filter((l) => l.enabled).length);

  onMount(() => {
    // 提前构建一次透镜 BVH，保证首次进入投射页即可出图
    coordinator.invalidateOptics();
  });

  return (
    <div class="app">
      <header class="app-header">
        <h1>车灯透镜光型渲染工具</h1>
        <span class="sub">LED → 透镜折射（BVH 求交）→ 墙面等照度光型</span>
        <nav class="tabs">
          {TABS.map((t) => (
            <button class={tab() === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main class="main">
        {tab() === 'light' && <LightSourcePanel engine={coordinator.opticsEngine} />}
        {tab() === 'lens' && <LensPanel engine={coordinator.opticsEngine} />}
        {tab() === 'projection' && <ProjectionPanel coordinator={coordinator} />}
        {tab() === 'export' && <ExportPanel />}
      </main>

      <footer class="statusbar">
        <span>
          状态 <span class="ok">●</span> 就绪
        </span>
        <span>点亮 LED：{enabledCount()}/16</span>
        <span>
          透镜：曲率档 {config.lens.curvature} / {config.lens.thickness}mm / IOR {config.lens.ior}
        </span>
        <span>
          截止线：{config.projection.cutoffY}mm / 过渡带 {config.projection.gradientWidth}mm
        </span>
        <span style={{ 'margin-left': 'auto' }}>SolidJS · three.js · three-mesh-bvh</span>
      </footer>
    </div>
  );
}
