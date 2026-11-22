import { usePaintStore } from '../store';
import { ColorInput, Segmented, Slider } from './Controls';
import {
  THICKNESS_MAX,
  THICKNESS_MIN,
  THICKNESS_STEP,
  type FlakeOrientation,
  type PaintParams,
} from '../types';

const thicknessProps = {
  min: THICKNESS_MIN,
  max: THICKNESS_MAX,
  step: THICKNESS_STEP,
  unit: 'μm',
  format: (v: number) => v.toFixed(0),
} as const;

function useLayerUpdater<K extends keyof PaintParams>(layer: K) {
  const updateLayer = usePaintStore((s) => s.updateLayer);
  return <P extends keyof PaintParams[K]>(key: P, value: PaintParams[K][P]) =>
    updateLayer(layer, { [key]: value } as unknown as Partial<PaintParams[K]>);
}

function ElectroPanel() {
  const electro = usePaintStore((s) => s.params.electro);
  const update = useLayerUpdater('electro');
  return (
    <div className="layer-section" style={{ '--layer-accent': '#8b95a3' } as React.CSSProperties}>
      <h4>
        ① 电泳层 <small>衬底 · 漫反射基色</small>
      </h4>
      <ColorInput label="基础色" value={electro.color} onChange={(v) => update('color', v)} />
      <Slider
        label="粗糙度"
        value={electro.roughness}
        min={0.05}
        max={0.9}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(v) => update('roughness', v)}
      />
      <Slider
        label="厚度"
        value={electro.thickness}
        {...thicknessProps}
        onChange={(v) => update('thickness', v)}
      />
    </div>
  );
}

function MidPanel() {
  const mid = usePaintStore((s) => s.params.mid);
  const update = useLayerUpdater('mid');
  return (
    <div className="layer-section" style={{ '--layer-accent': '#5fb8ff' } as React.CSSProperties}>
      <h4>
        ② 中涂层 <small>色漆本色 · Beer-Lambert 吸收</small>
      </h4>
      <ColorInput label="基础色（底色）" value={mid.color} onChange={(v) => update('color', v)} />
      <Slider
        label="粗糙度"
        value={mid.roughness}
        min={0.05}
        max={0.9}
        step={0.01}
        format={(v) => v.toFixed(2)}
        onChange={(v) => update('roughness', v)}
      />
      <Slider
        label="厚度"
        value={mid.thickness}
        {...thicknessProps}
        onChange={(v) => update('thickness', v)}
      />
      <Slider
        label="颜料遮盖率"
        value={mid.opacity}
        min={0.5}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => update('opacity', v)}
      />
    </div>
  );
}

function FlakePanel() {
  const flake = usePaintStore((s) => s.params.flake);
  const update = useLayerUpdater('flake');
  return (
    <div className="layer-section" style={{ '--layer-accent': '#f0b35c' } as React.CSSProperties}>
      <h4>
        ③ 金属/珠光片层 <small>程序化鳞片场</small>
      </h4>
      <Segmented
        label="片体类型"
        value={flake.type}
        options={[
          { value: 'metallic', label: '金属片' },
          { value: 'pearlescent', label: '珠光片' },
        ]}
        onChange={(v) => update('type', v)}
      />
      <Segmented<FlakeOrientation>
        label="金属片朝向分布"
        value={flake.orientation}
        options={[
          { value: 'highGloss', label: '高光泽 · 取向集中' },
          { value: 'lowGloss', label: '低光泽 · 取向散乱' },
        ]}
        onChange={(v) => update('orientation', v)}
      />
      <ColorInput
        label={flake.type === 'pearlescent' ? '干涉色调' : '片体反射色'}
        value={flake.flakeColor}
        onChange={(v) => update('flakeColor', v)}
      />
      <Slider
        label="片层覆盖密度"
        value={flake.flakeDensity}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        accent="#f0b35c"
        onChange={(v) => update('flakeDensity', v)}
      />
      <Slider
        label="片体尺寸"
        value={flake.flakeSize}
        min={0.4}
        max={2.4}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        accent="#f0b35c"
        onChange={(v) => update('flakeSize', v)}
      />
      <Slider
        label="片层粗糙度"
        value={flake.roughness}
        min={0.05}
        max={0.8}
        step={0.01}
        format={(v) => v.toFixed(2)}
        accent="#f0b35c"
        onChange={(v) => update('roughness', v)}
      />
      <Slider
        label="闪烁强度"
        value={flake.sparkle}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        accent="#f0b35c"
        onChange={(v) => update('sparkle', v)}
      />
      <Slider
        label="厚度"
        value={flake.thickness}
        {...thicknessProps}
        accent="#f0b35c"
        onChange={(v) => update('thickness', v)}
      />
      {flake.flakeDensity === 0 ? (
        <div className="light-hint" style={{ color: 'var(--warn)' }}>
          当前密度为 0，片层关闭（素色漆状态）
        </div>
      ) : null}
    </div>
  );
}

function ClearPanel() {
  const clear = usePaintStore((s) => s.params.clear);
  const update = useLayerUpdater('clear');
  return (
    <div className="layer-section" style={{ '--layer-accent': '#7dd3fc' } as React.CSSProperties}>
      <h4>
        ④ 清漆层 <small>IOR 菲涅尔界面 · 高光置顶叠加</small>
      </h4>
      <Slider
        label="清漆厚度"
        value={clear.thickness}
        {...thicknessProps}
        accent="#7dd3fc"
        onChange={(v) => update('thickness', v)}
      />
      <Slider
        label="折射率 IOR"
        value={clear.ior}
        min={1.3}
        max={2.0}
        step={0.01}
        format={(v) => v.toFixed(2)}
        accent="#7dd3fc"
        onChange={(v) => update('ior', v)}
      />
      <Slider
        label="清漆粗糙度"
        value={clear.roughness}
        min={0.02}
        max={0.6}
        step={0.01}
        format={(v) => v.toFixed(2)}
        accent="#7dd3fc"
        onChange={(v) => update('roughness', v)}
      />
      <ColorInput label="清漆染色" value={clear.tint} onChange={(v) => update('tint', v)} />
    </div>
  );
}

export function LayerPanels() {
  return (
    <div className="panel">
      <h3>
        <span className="dot" style={{ background: 'var(--ok)' }} />
        四层参数调校
      </h3>
      <ElectroPanel />
      <MidPanel />
      <FlakePanel />
      <ClearPanel />
    </div>
  );
}
