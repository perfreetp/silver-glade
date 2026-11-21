import { PARAM_RANGES, formatMM } from '../constants';
import { state, updateSelectedConfig, resetSelectedWheel } from '../store';
import { WHEEL_NAMES } from '../types';
import type { WheelConfig } from '../types';

interface SliderProps {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  display: string;
  onChange: (v: number) => void;
  danger?: boolean;
}

function Slider(props: SliderProps) {
  return (
    <div class="param-row" classList={{ danger: props.danger }}>
      <div class="param-head">
        <span>{props.label}</span>
        <span class="param-value">{props.display}</span>
      </div>
      <input
        type="range"
        min={props.range.min}
        max={props.range.max}
        step={props.range.step}
        value={props.value}
        onInput={(e) => props.onChange(parseFloat(e.currentTarget.value))}
      />
    </div>
  );
}

export default function ParamPanel() {
  const cfg = (): WheelConfig => state.wheels[state.selected];

  return (
    <aside class="panel param-panel">
      <div class="panel-title">
        参数调节
        <span class="panel-sub">{WHEEL_NAMES[state.selected]}</span>
      </div>

      <Slider
        label="辐条数量（5–10）"
        value={cfg().spokes}
        range={PARAM_RANGES.spokes}
        display={`${cfg().spokes} 根`}
        onChange={(v) => updateSelectedConfig({ spokes: Math.round(v) })}
      />
      <Slider
        label="盘面深度"
        value={cfg().dishDepth}
        range={PARAM_RANGES.dishDepth}
        display={formatMM(cfg().dishDepth)}
        onChange={(v) => updateSelectedConfig({ dishDepth: v })}
      />
      <Slider
        label="轮辋直径"
        value={cfg().rimDiameter}
        range={PARAM_RANGES.rimDiameter}
        display={formatMM(cfg().rimDiameter)}
        onChange={(v) => updateSelectedConfig({ rimDiameter: v })}
      />
      <Slider
        label="偏距（沿轴向外移）"
        value={cfg().offset}
        range={PARAM_RANGES.offset}
        display={formatMM(cfg().offset)}
        onChange={(v) => updateSelectedConfig({ offset: v })}
        danger={state.clearances[state.selected].boundaryViolation}
      />

      <div
        class="boundary-warn"
        hidden={!state.clearances[state.selected].boundaryViolation}
      >
        ⚠ 轮胎外移已越过轮拱侧面边界，翼子板警示环已标红
      </div>

      <div class="param-readout">
        <div>
          <span>轮胎外径</span>
          <b>{formatMM(cfg().rimDiameter + 0.13)}</b>
        </div>
        <div>
          <span>轮面下沉</span>
          <b>{formatMM(cfg().dishDepth)}</b>
        </div>
      </div>

      <button class="ghost-btn" onClick={() => resetSelectedWheel()}>
        恢复该轮位默认参数
      </button>
    </aside>
  );
}
