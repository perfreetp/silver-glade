import { useState } from 'react';

export function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button className="section-title" onClick={() => setOpen(!open)}>
        <span className={`arrow ${open ? 'open' : ''}`}>▸</span> {title}
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, format }) {
  const shown = format ? format(value) : Number(value).toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="field-value">{shown}</span>
    </label>
  );
}

export function Select({ label, value, options, onChange }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function ColorField({ label, value, onChange }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="field-value">{value}</span>
    </label>
  );
}

export function Toggle({ label, value, onChange }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
