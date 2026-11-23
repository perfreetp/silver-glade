import { Section, Slider, Select, ColorField } from './controls.jsx';
import { RESOLUTIONS, STEP_TIERS, FRAME_COUNT } from '../defaults.js';

export function Sidebar({
  settings, update,
  strokeCount, onUndo, onClearStrokes,
  onExportSequence, exportProgress,
  onExportProject, onImportProject, saveState,
}) {
  const { noise, brush, render, light } = settings;
  return (
    <div className="sidebar">
      <Section title="密度场生成 (噪声参数)">
        <Select
          label="分辨率"
          value={String(settings.resolution)}
          options={RESOLUTIONS.map((r) => ({ value: String(r), label: `${r}³` }))}
          onChange={(v) => update('resolution', null, parseInt(v, 10))}
        />
        <Slider label="随机种子" value={noise.seed} min={0} max={100} step={1}
          onChange={(v) => update('noise', 'seed', v)} />
        <Slider label="壳体半径" value={noise.shellRadius} min={0.02} max={0.6} step={0.01}
          onChange={(v) => update('noise', 'shellRadius', v)} />
        <Slider label="膨胀速度" value={noise.expansion} min={0} max={1.2} step={0.01}
          onChange={(v) => update('noise', 'expansion', v)} />
        <Slider label="壳体厚度" value={noise.shellThickness} min={0.03} max={0.5} step={0.01}
          onChange={(v) => update('noise', 'shellThickness', v)} />
        <Slider label="壳体密度" value={noise.shellDensity} min={0} max={6} step={0.05}
          onChange={(v) => update('noise', 'shellDensity', v)} />
        <Slider label="核心密度" value={noise.coreDensity} min={0} max={6} step={0.05}
          onChange={(v) => update('noise', 'coreDensity', v)} />
        <Slider label="核心衰减" value={noise.coreFade} min={0} max={6} step={0.05}
          onChange={(v) => update('noise', 'coreFade', v)} />
        <Slider label="湍流尺度" value={noise.turbScale} min={0.5} max={8} step={0.1}
          onChange={(v) => update('noise', 'turbScale', v)} />
        <Slider label="湍流强度" value={noise.turbStrength} min={0} max={2} step={0.02}
          onChange={(v) => update('noise', 'turbStrength', v)} />
        <Slider label="湍流流动" value={noise.turbFlow} min={0} max={2} step={0.02}
          onChange={(v) => update('noise', 'turbFlow', v)} />
      </Section>

      <Section title="密度场编辑 (球刷)">
        <div className="field">
          <span className="field-label">模式</span>
          <div className="seg">
            <button className={brush.mode === 'add' ? 'active' : ''}
              onClick={() => update('brush', 'mode', 'add')}>增加</button>
            <button className={brush.mode === 'sub' ? 'active' : ''}
              onClick={() => update('brush', 'mode', 'sub')}>删除</button>
          </div>
        </div>
        <Slider label="笔刷半径" value={brush.radius} min={0.02} max={0.4} step={0.005}
          onChange={(v) => update('brush', 'radius', v)} />
        <Slider label="笔刷强度" value={brush.strength} min={0.05} max={2} step={0.05}
          onChange={(v) => update('brush', 'strength', v)} />
        <Slider label="笔刷深度" value={brush.depth} min={0} max={1} step={0.01}
          onChange={(v) => update('brush', 'depth', v)} />
        <div className="field-row">
          <button className="btn" onClick={onUndo} disabled={!strokeCount}>撤销一笔</button>
          <button className="btn danger" onClick={onClearStrokes} disabled={!strokeCount}>清空编辑</button>
        </div>
        <div className="hint">
          在体积上按住左键拖动即可增/删密度;Alt+滚轮调整笔刷沿视线方向的深度。每次编辑后体积纹理与光照会自动重算。当前笔画数: {strokeCount}
        </div>
      </Section>

      <Section title="步进渲染">
        <Select
          label="步进档位"
          value={String(render.steps)}
          options={STEP_TIERS.map((s) => ({ value: String(s), label: `${s} 步` }))}
          onChange={(v) => update('render', 'steps', parseInt(v, 10))}
        />
        <Slider label="消光系数" value={render.extinction} min={0.2} max={10} step={0.1}
          onChange={(v) => update('render', 'extinction', v)} />
        <Slider label="反照率" value={render.albedo} min={0} max={1} step={0.01}
          onChange={(v) => update('render', 'albedo', v)} />
        <Slider label="曝光" value={render.exposure} min={0.1} max={4} step={0.05}
          onChange={(v) => update('render', 'exposure', v)} />
        <ColorField label="背景色" value={render.bgColor}
          onChange={(v) => update('render', 'bgColor', v)} />
      </Section>

      <Section title="光照">
        <Slider label="方位角" value={light.azimuth} min={-180} max={180} step={1}
          onChange={(v) => update('light', 'azimuth', v)} format={(v) => `${v}°`} />
        <Slider label="仰角" value={light.elevation} min={-10} max={90} step={1}
          onChange={(v) => update('light', 'elevation', v)} format={(v) => `${v}°`} />
        <ColorField label="光颜色" value={light.color}
          onChange={(v) => update('light', 'color', v)} />
        <Slider label="光强度" value={light.intensity} min={0} max={10} step={0.1}
          onChange={(v) => update('light', 'intensity', v)} />
        <ColorField label="环境色" value={light.ambientColor}
          onChange={(v) => update('light', 'ambientColor', v)} />
        <Slider label="环境强度" value={light.ambientIntensity} min={0} max={3} step={0.05}
          onChange={(v) => update('light', 'ambientIntensity', v)} />
        <Slider label="AO 强度" value={light.aoStrength} min={0} max={4} step={0.05}
          onChange={(v) => update('light', 'aoStrength', v)} />
        <Slider label="相位 g" value={light.phaseG} min={-0.8} max={0.8} step={0.01}
          onChange={(v) => update('light', 'phaseG', v)} />
        <Slider label="阴影步数" value={light.lightSteps} min={4} max={24} step={1}
          onChange={(v) => update('light', 'lightSteps', v)} />
      </Section>

      <Section title="序列帧导出">
        <div className="hint">
          按当前步进档位 ({render.steps} 步) 将 {FRAME_COUNT} 帧时间轴逐帧渲染为 PNG 序列并打包为 ZIP。
        </div>
        {exportProgress ? (
          <div className="field">
            <div className="progress">
              <div style={{ width: `${(exportProgress.done / exportProgress.total) * 100}%` }} />
            </div>
            <span className="field-value">{exportProgress.done}/{exportProgress.total}</span>
          </div>
        ) : (
          <button className="btn primary" style={{ width: '100%' }} onClick={onExportSequence}>
            导出 {FRAME_COUNT} 帧 PNG 序列
          </button>
        )}
      </Section>

      <Section title="项目" defaultOpen={false}>
        <div className="field-row">
          <button className="btn" onClick={onExportProject}>导出项目文件</button>
          <button className="btn" onClick={onImportProject}>导入项目文件</button>
        </div>
        <div className="hint">{saveState || '项目会自动保存到浏览器 IndexedDB。'}</div>
      </Section>
    </div>
  );
}
