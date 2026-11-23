/** 主题：受损分级色带、UI 用色。分级固定为 5 级。 */

export interface SeverityClass {
  index: number;
  label: string;
  color: string;
  rgb: [number, number, number];
}

/** 由轻到重 5 级 */
export const SEVERITY_CLASSES: SeverityClass[] = [
  { index: 0, label: '未过火', color: '#6f9e4a', rgb: [111, 158, 74] },
  { index: 1, label: '轻度受损', color: '#d8cc57', rgb: [216, 204, 87] },
  { index: 2, label: '中度受损', color: '#eda233', rgb: [237, 162, 51] },
  { index: 3, label: '重度受损', color: '#f0783a', rgb: [240, 120, 58] },
  { index: 4, label: '极重度', color: '#cf4433', rgb: [207, 68, 51] },
];

export function severityColorFromValue(v: number, thresholds: readonly number[]): string {
  if (!Number.isFinite(v)) return 'rgba(0,0,0,0)';
  for (let i = 0; i < thresholds.length; i++) if (v < thresholds[i]) return SEVERITY_CLASSES[i].color;
  return SEVERITY_CLASSES[thresholds.length].color;
}

export function severityClassFromValue(v: number, thresholds: readonly number[]): number {
  if (!Number.isFinite(v)) return 0;
  for (let i = 0; i < thresholds.length; i++) if (v < thresholds[i]) return i;
  return thresholds.length;
}

/** 过火指数热力图色带（连续） */
export const BURN_RAMP: [number, number, number][] = [
  [24, 40, 30],
  [58, 92, 52],
  [130, 146, 72],
  [214, 168, 58],
  [220, 98, 44],
  [128, 30, 24],
];
