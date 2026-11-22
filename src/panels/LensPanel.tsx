import { type JSX, createMemo } from 'solid-js';
import { config, actions } from '../store/configStore';
import { Slider } from '../components/Controls';
import { Viewport3D } from '../components/Viewport3D';
import {
  CURVATURE_LABELS,
  CURVATURE_RADII,
  LENS_RADIUS,
  THICKNESS_MAX,
  THICKNESS_MIN,
} from '../optics/constants';
import { resolveEffectiveThickness } from '../optics/lensGeometry';
import type { OpticsEngine } from '../optics/tracer';

export function LensPanel(props: { engine: OpticsEngine }): JSX.Element {
  const info = createMemo(() => resolveEffectiveThickness(config.lens));

  const syncScene = (s: import('../three/scene3d').LampScene) => {
    s.syncLens(config.lens);
    s.syncLeds(config.leds, null);
  };

  return (
    <div class="panel split">
      <div class="sidebar">
        <div class="section-title">曲率档位（前表面球面半径）</div>
        <div class="curvature-grid">
          {CURVATURE_LABELS.map((label, i) => (
            <button
              class={config.lens.curvature === i ? 'active' : ''}
              onClick={() => actions.setCurvature(i as 0 | 1 | 2)}
            >
              {label.split(' ')[0]}
              <div style={{ 'font-size': '10px', opacity: 0.75 }}>R{CURVATURE_RADII[i]}</div>
            </button>
          ))}
        </div>

        <div class="section-title">中心厚度</div>
        <Slider
          label="厚度设定值"
          value={config.lens.thickness}
          min={THICKNESS_MIN}
          max={THICKNESS_MAX}
          step={0.1}
          unit=" mm"
          decimals={1}
          onChange={actions.setThickness}
        />
        <div class="note">
          物理约束：边缘厚度不低于 0.6mm。当前曲率矢高 {info().sag.toFixed(2)}mm，
          实际生效中心厚度 <b style={{ color: 'var(--accent-2)' }}>{info().thickness.toFixed(2)}mm</b>
          （设定值低于下限时自动抬升）。
        </div>

        <div class="section-title">材料</div>
        <Slider
          label="折射率 IOR"
          value={config.lens.ior}
          min={1.3}
          max={2}
          step={0.01}
          decimals={2}
          onChange={actions.setIor}
        />

        <div class="section-title">实时几何参数</div>
        <div class="metric-row">
          <span>有效口径</span>
          <span>Ø{LENS_RADIUS * 2} mm</span>
          <span>球面半径 R</span>
          <span>{CURVATURE_RADII[config.lens.curvature]} mm</span>
          <span>球冠矢高 sag</span>
          <span>{info().sag.toFixed(2)} mm</span>
          <span>边缘厚度</span>
          <span>0.60 mm</span>
          <span>中心厚度（生效）</span>
          <span>{info().thickness.toFixed(2)} mm</span>
        </div>
      </div>

      <Viewport3D engine={props.engine} sync={syncScene}>
        <div class="hud">
          <div>透镜为水密闭合网格（背面平面 + 球面冠 + 侧壁），BVH 求交与显示共用同一几何</div>
          <div>
            当前档位 <b>{CURVATURE_LABELS[config.lens.curvature]}</b>，透射材质 depthWrite=false，
            灯腔与 LED 透过透镜正确叠加
          </div>
        </div>
      </Viewport3D>
    </div>
  );
}
