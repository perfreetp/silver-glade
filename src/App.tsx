import WheelSelector from './ui/WheelSelector';
import StylePanel from './ui/StylePanel';
import Viewport from './ui/Viewport';
import ParamPanel from './ui/ParamPanel';
import ClearancePanel from './ui/ClearancePanel';

export default function App() {
  return (
    <div class="app-shell">
      <WheelSelector />
      <div class="workbench">
        <StylePanel />
        <Viewport />
        <ParamPanel />
      </div>
      <ClearancePanel />
    </div>
  );
}
