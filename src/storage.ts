import type { SavedScheme } from './types';

const KEY = 'car-wrap-saved-schemes-v1';
const MAX = 6;

export function loadSaved(): SavedScheme[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as SavedScheme[];
    return Array.isArray(list) ? list.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function persistSaved(list: SavedScheme[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // 缩略图过大导致配额超限时静默降级，不影响导出文件
  }
}

export const MAX_SCHEMES = MAX;
