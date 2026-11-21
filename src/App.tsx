import { Viewer } from './modules/Viewer';
import { ZonePanel } from './modules/ZonePanel';
import { PathPanel } from './modules/PathPanel';
import { PreviewPanel } from './modules/PreviewPanel';
import { ExportPanel } from './modules/ExportPanel';

/** 压雪刀纹渲染工作台：四个模块按作业流程纵向排布，左侧 3D 视图 */
export function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">❄</span>
          <div>
            <h1>压雪刀纹渲染工作台</h1>
            <p>Corduroy Groom Planner · three.js + BVH</p>
          </div>
        </div>
        <div className="panel-stack">
          <ZonePanel />
          <PathPanel />
          <PreviewPanel />
          <ExportPanel />
        </div>
      </aside>
      <main className="stage">
        <Viewer />
      </main>
    </div>
  );
}
