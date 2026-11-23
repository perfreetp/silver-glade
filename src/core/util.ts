/** 通用工具函数：数值、颜色、格式化、下载、防抖。 */

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};

export function id(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function formatArea(m2: number): string {
  if (!Number.isFinite(m2)) return '—';
  if (Math.abs(m2) >= 1e6) return `${(m2 / 1e6).toFixed(3)} km²`;
  if (Math.abs(m2) >= 1e4) return `${(m2 / 1e4).toFixed(2)} 公顷`;
  return `${m2.toFixed(1)} m²`;
}

export function formatLength(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (Math.abs(m) >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(1)} m`;
}

export function formatElev(m: number): string {
  return Number.isFinite(m) ? `${m.toFixed(1)} m` : '—';
}

export function formatDeg(d: number): string {
  return Number.isFinite(d) ? `${d.toFixed(1)}°` : '—';
}

export function debounce<F extends (...args: never[]) => void>(fn: F, ms: number): F & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = ((...args: never[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  }) as F & { cancel(): void };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text: string, filename: string, mime = 'application/json'): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export function safeFilename(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'burntrace';
  return `${base}.${ext}`;
}

/** 十六进制颜色 */
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  if (!m) return { r: 128, g: 128, b: 128 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 简单的可复现随机数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/** 由灰度/高度数组生成热IR色带颜色，用于 DEM 预览 */
export function elevationToColor(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [32, 46, 36],
    [64, 88, 52],
    [128, 130, 70],
    [166, 138, 92],
    [206, 196, 184],
  ];
  const x = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  return [
    lerp(stops[i][0], stops[i + 1][0], f),
    lerp(stops[i][1], stops[i + 1][1], f),
    lerp(stops[i][2], stops[i + 1][2], f),
  ];
}
