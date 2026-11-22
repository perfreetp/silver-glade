import type { FilmDef, FilmFinish } from './types';

/**
 * 膜色库：哑光 / 亮面 / 金属 三类，每类 4 色，共 12 种膜色。
 * id 即方案文件中记录的“膜色编号”。
 */
export const FILM_LIBRARY: FilmDef[] = [
  // 哑光
  { id: 'M-01', name: '哑光曜石黑', finish: 'matte', color: [0.035, 0.038, 0.045] },
  { id: 'M-02', name: '哑光陶瓷白', finish: 'matte', color: [0.9, 0.9, 0.88] },
  { id: 'M-03', name: '哑光战斗灰', finish: 'matte', color: [0.32, 0.34, 0.37] },
  { id: 'M-04', name: '哑光军绿', finish: 'matte', color: [0.24, 0.28, 0.16] },
  // 亮面
  { id: 'G-01', name: '亮面竞速红', finish: 'gloss', color: [0.72, 0.05, 0.06] },
  { id: 'G-02', name: '亮面极光蓝', finish: 'gloss', color: [0.04, 0.2, 0.68] },
  { id: 'G-03', name: '亮面阳光黄', finish: 'gloss', color: [0.96, 0.72, 0.05] },
  { id: 'G-04', name: '亮面翡翠绿', finish: 'gloss', color: [0.02, 0.48, 0.32] },
  // 金属
  { id: 'X-01', name: '金属钛银', finish: 'metallic', color: [0.62, 0.64, 0.67] },
  { id: 'X-02', name: '金属香槟金', finish: 'metallic', color: [0.72, 0.6, 0.38] },
  { id: 'X-03', name: '金属玫瑰铜', finish: 'metallic', color: [0.66, 0.36, 0.3] },
  { id: 'X-04', name: '金属午夜蓝', finish: 'metallic', color: [0.08, 0.12, 0.26] },
];

export const FINISH_LABEL: Record<FilmFinish, string> = {
  matte: '哑光',
  gloss: '亮面',
  metallic: '金属',
};

/** 不同膜面的默认 PBR 参数（粗糙度/金属度仍可在底部整体微调） */
export const FINISH_DEFAULT: Record<FilmFinish, { roughness: number; metallic: number }> = {
  matte: { roughness: 0.85, metallic: 0.05 },
  gloss: { roughness: 0.12, metallic: 0.1 },
  metallic: { roughness: 0.28, metallic: 0.95 },
};

export function getFilm(id: string): FilmDef {
  const f = FILM_LIBRARY.find((x) => x.id === id);
  if (!f) throw new Error(`未知膜色编号: ${id}`);
  return f;
}
