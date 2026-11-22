import { createSignal, type JSX } from 'solid-js';
import { config, actions } from '../store/configStore';
import { Slider, Toggle } from '../components/Controls';
import { Viewport3D } from '../components/Viewport3D';
import type { LampScene } from '../three/scene3d';
import type { OpticsEngine } from '../optics/tracer';
import {
  LED_CELL_HALF_X,
  LED_CELL_HALF_Y,
  MAX_LEDS,
  WALL_DISTANCE,
} from '../optics/constants';

export function LightSourcePanel(props: { engine: OpticsEngine }): JSX.Element {
  const [selected, setSelected] = createSignal<number>(
    Math.max(0, config.leds.findIndex((l) => l.enabled)),
  );

  const led = () => config.leds[selected()];
  const enabledCount = () => config.leds.filter((l) => l.enabled).length;

  const syncScene = (s: LampScene) => {
    s.syncLeds(config.leds, selected());
    s.syncLens(config.lens);
    const cur = config.leds[selected()];
    s.syncRayPreview(cur && cur.enabled ? cur : null, config.wallDistance || WALL_DISTANCE);
  };

  return (
    <div class="panel split">
      <div class="sidebar">
        <div class="section-title">LED 阵列（最多 {MAX_LEDS} 颗）</div>
        <div class="led-list">
          {config.leds.map((l, i) => (
            <button
              class={`led-chip ${l.enabled ? 'on' : ''} ${selected() === i ? 'selected' : ''}`}
              onClick={() => setSelected(i)}
              title={`LED #${i + 1}`}
            >
              <span class="dot" />
              <span>#{i + 1}</span>
            </button>
          ))}
        </div>

        <div class="note">
          已点亮 {enabledCount()} / {MAX_LEDS} 颗。点击灯珠或左侧编号选择，灯珠可在各自槽位内微调位置。
        </div>

        <Toggle
          label="该槽位点亮"
          checked={led().enabled}
          onChange={(v) => actions.updateLed(selected(), { enabled: v })}
        />

        <div class="section-title">位置（灯板面内，mm）</div>
        <Slider
          label="X 横向位置"
          value={led().x}
          min={-LED_CELL_HALF_X}
          max={LED_CELL_HALF_X}
          step={0.1}
          unit=" mm"
          decimals={1}
          onChange={(v) => actions.updateLed(selected(), { x: v })}
        />
        <Slider
          label="Y 纵向位置"
          value={led().y}
          min={-LED_CELL_HALF_Y}
          max={LED_CELL_HALF_Y}
          step={0.1}
          unit=" mm"
          decimals={1}
          onChange={(v) => actions.updateLed(selected(), { y: v })}
        />

        <div class="section-title">出光角度</div>
        <Slider
          label="俯仰角 tiltX"
          value={led().tiltX}
          min={-30}
          max={30}
          step={0.5}
          unit="°"
          decimals={1}
          onChange={(v) => actions.updateLed(selected(), { tiltX: v })}
        />
        <Slider
          label="偏航角 tiltY"
          value={led().tiltY}
          min={-30}
          max={30}
          step={0.5}
          unit="°"
          decimals={1}
          onChange={(v) => actions.updateLed(selected(), { tiltY: v })}
        />

        <div class="section-title">亮度</div>
        <Slider
          label="亮度权重"
          value={led().brightness}
          min={0}
          max={1}
          step={0.01}
          decimals={2}
          onChange={(v) => actions.updateLed(selected(), { brightness: v })}
        />

        <div class="section-title">批量</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button class="btn" onClick={() => actions.setLedCount(8)}>
            标准 8 颗
          </button>
          <button class="btn" onClick={() => actions.setLedCount(16)}>
            满配 16 颗
          </button>
          <button class="btn" onClick={() => actions.setLedCount(1)}>
            仅 1 颗
          </button>
        </div>
      </div>

      <Viewport3D
        engine={props.engine}
        onPickLed={(i) => setSelected(i)}
        onSceneReady={syncScene}
        sync={syncScene}
      >
        <div class="hud">
          <div>灯腔半透明围壁 → LED 灯板 → 透镜折射体</div>
          <div>橙色折线为选中 LED 的 <b>采样光路</b>（空气→玻璃→空气）</div>
          <div>左键旋转 / 滚轮缩放 / 右键平移，点击灯珠选择</div>
        </div>
      </Viewport3D>
    </div>
  );
}
