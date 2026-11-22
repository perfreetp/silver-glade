import { LeftSidebar } from './components/LeftSidebar';
import { Viewport } from './components/Viewport';
import { LayerPanels } from './components/LayerPanels';
import { PreviewPanel } from './components/PreviewPanel';
import { RightBottomPanels } from './components/CompareExport';
import { usePaintStore } from './store';

function Toast() {
  const toast = usePaintStore((s) => s.toast);
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}

export default function App() {
  return (
    <div className="app">
      <LeftSidebar />
      <Viewport />
      <aside className="sidebar sidebar-right">
        <PreviewPanel />
        <LayerPanels />
        <RightBottomPanels />
      </aside>
      <Toast />
    </div>
  );
}
