import { useCallback, useRef } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** 显示值格式化（如厚度取整） */
  format?: (v: number) => string;
  onChange: (v: number) => void;
  accent?: string;
}

/**
 * 高频滑块：onInput 直接写 store（不经过 React 受控重渲染堆积），
 * 显示值通过 ref 更新 DOM，保证连续拖动不掉帧。
 */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  format,
  onChange,
  accent = '#5fb8ff',
}: SliderProps) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const display = format ? format(value) : value.toFixed(step < 1 ? 2 : 0);

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const v = Number(e.currentTarget.value);
      if (valueRef.current) {
        valueRef.current.textContent = format ? format(v) : v.toFixed(step < 1 ? 2 : 0);
      }
      onChange(v);
    },
    [onChange, format, step],
  );

  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="ctrl">
      <div className="ctrl-head">
        <span className="ctrl-label">{label}</span>
        <span className="ctrl-value" ref={valueRef}>
          {display}
          {unit ? <em>{unit}</em> : null}
        </span>
      </div>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={handleInput}
        style={{ '--fill': `${pct}%`, '--accent': accent } as React.CSSProperties}
      />
    </div>
  );
}

interface ColorInputProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

export function ColorInput({ label, value, onChange }: ColorInputProps) {
  return (
    <label className="ctrl color-ctrl">
      <span className="ctrl-label">{label}</span>
      <span className="color-row">
        <input
          type="color"
          value={value}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
        <code>{value.toUpperCase()}</code>
      </span>
    </label>
  );
}

interface SegmentedProps<T extends string> {
  label?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="ctrl">
      {label ? <span className="ctrl-label">{label}</span> : null}
      <div className="segmented">
        {options.map((o) => (
          <button
            key={o.value}
            className={o.value === value ? 'seg active' : 'seg'}
            onClick={() => onChange(o.value)}
            type="button"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
