/** 样式：深色测绘台风格，四模块 + 3D 视口。以 CSS 变量集中管理。 */

export const baseStyles = /* css */ `
:host {
  --bg: #0b0f13;
  --panel: #121820;
  --panel-2: #171f29;
  --panel-3: #1e2833;
  --line: #26333f;
  --line-soft: #1c2731;
  --text: #e6edf3;
  --text-dim: #93a4b3;
  --text-faint: #6b7d8c;
  --accent: #ff7a3d;
  --accent-2: #ffb15c;
  --ember: #ff5a1f;
  --ok: #5fcf8a;
  --warn: #e5b64a;
  --err: #ef6461;
  --info: #58b6e0;
  --radius: 10px;
  --mono: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
  --sans: "Inter", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
  font-family: var(--sans);
  color: var(--text);
  box-sizing: border-box;
}
*, *::before, *::after { box-sizing: inherit; }
[hidden] { display: none !important; }

.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.btn {
  appearance: none;
  border: 1px solid var(--line);
  background: var(--panel-3);
  color: var(--text);
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 12.5px;
  font-family: inherit;
  line-height: 1.2;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background .14s, border-color .14s, transform .06s, color .14s;
  user-select: none;
  white-space: nowrap;
}
.btn:hover { background: #243140; border-color: #33465a; }
.btn:active { transform: translateY(1px); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn[disabled] { opacity: .42; cursor: not-allowed; }
.btn.primary {
  background: linear-gradient(180deg, #ff8b50, #e85f21);
  border-color: #ff9057;
  color: #1a0d05;
  font-weight: 600;
}
.btn.primary:hover { background: linear-gradient(180deg, #ff9c66, #f16a2a); }
.btn.ghost { background: transparent; }
.btn.ghost:hover { background: var(--panel-3); }
.btn.danger { color: #ffc4c2; border-color: #4a2a2a; background: #26191a; }
.btn.danger:hover { background: #33201f; border-color: #66302d; }
.btn.sm { padding: 4px 8px; font-size: 11.5px; border-radius: 6px; }
.btn.block { width: 100%; }
.btn.icon { padding: 6px; width: 30px; height: 30px; }

label.field { display: block; margin-bottom: 10px; }
label.field > .lab {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 11.5px;
  color: var(--text-dim);
  margin-bottom: 5px;
  letter-spacing: .02em;
}
label.field > .lab .val { font-family: var(--mono); color: var(--text); font-size: 11.5px; }

input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 18px;
  background: transparent;
  cursor: pointer;
}
input[type="range"]::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 3px;
  background: linear-gradient(90deg, #3a4b5b, #2a3642);
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 15px; height: 15px; border-radius: 50%;
  background: #ffd9bf; border: 2px solid var(--accent);
  margin-top: -5.5px; box-shadow: 0 1px 5px rgba(0,0,0,.5);
}
input[type="range"]::-moz-range-track { height: 4px; border-radius: 3px; background: #2a3642; }
input[type="range"]::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%; background: #ffd9bf; border: 2px solid var(--accent); }

input[type="text"], input[type="number"], select {
  width: 100%;
  background: var(--panel-2);
  border: 1px solid var(--line);
  color: var(--text);
  border-radius: 7px;
  padding: 6px 9px;
  font-size: 12.5px;
  font-family: inherit;
}
input[type="number"] { font-family: var(--mono); }
input:focus, select:focus { outline: none; border-color: #3d5266; box-shadow: 0 0 0 3px rgba(255,122,61,.10); }

.seg {
  display: inline-flex;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
}
.seg button {
  appearance: none; border: 0; background: transparent; color: var(--text-dim);
  padding: 5px 10px; border-radius: 6px; font-size: 12px; font-family: inherit; cursor: pointer;
  transition: background .13s, color .13s;
}
.seg button[aria-pressed="true"] { background: #2b3a49; color: var(--text); box-shadow: inset 0 0 0 1px #3a4c5e; }
.seg button:hover { color: var(--text); }

.kv { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; padding: 5px 0; border-bottom: 1px dashed var(--line-soft); }
.kv:last-child { border-bottom: 0; }
.kv .k { color: var(--text-dim); }
.kv .v { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: right; }

.muted { color: var(--text-dim); }
.faint { color: var(--text-faint); }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.tiny { font-size: 11px; }
.hint { font-size: 11px; color: var(--text-faint); line-height: 1.55; }

.chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10.5px; padding: 2px 7px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--text-dim); background: var(--panel-2);
  font-family: var(--mono);
}
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }

.stack { display: grid; gap: 10px; }
.row { display: flex; gap: 8px; align-items: center; }
.row.wrap { flex-wrap: wrap; }
.grow { flex: 1; min-width: 0; }

.spin {
  width: 13px; height: 13px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.22); border-top-color: var(--accent);
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #2b3844; border-radius: 6px; border: 2px solid var(--panel); }
::-webkit-scrollbar-thumb:hover { background: #374757; }
`;
