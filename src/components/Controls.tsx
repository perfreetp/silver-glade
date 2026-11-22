import { createMemo, type JSX } from 'solid-js';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  decimals?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}

export function Slider(props: SliderProps): JSX.Element {
  const decimals = createMemo(() => props.decimals ?? (props.step && props.step < 1 ? 2 : 0));
  return (
    <div class="field">
      <label>
        <span>{props.label}</span>
        <span class="val">
          {props.value.toFixed(decimals())}
          {props.unit ?? ''}
        </span>
      </label>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        disabled={props.disabled}
        onInput={(e) => props.onChange(parseFloat(e.currentTarget.value))}
      />
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function Toggle(props: ToggleProps): JSX.Element {
  return (
    <label class="toggle-row">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
    </label>
  );
}
