import { createStore, produce } from 'solid-js/store';
import type { CurvatureLevel, LedConfig, WorkspaceConfig } from '../types';
import { createDefaultConfig } from './defaults';
import {
  CUTOFF_MAX,
  CUTOFF_MIN,
  GRADIENT_MAX,
  GRADIENT_MIN,
  LED_CELL_HALF_X,
  LED_CELL_HALF_Y,
  MAX_LEDS,
  THICKNESS_MAX,
  THICKNESS_MIN,
} from '../optics/constants';
import { clamp } from '../optics/math';

const STORAGE_KEY = 'headlamp-pattern-studio-v1';

function loadInitial(): WorkspaceConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WorkspaceConfig;
      if (parsed.version === 1 && Array.isArray(parsed.leds)) return parsed;
    }
  } catch {
    /* 忽略损坏的本地缓存 */
  }
  return createDefaultConfig();
}

export const [config, setConfig] = createStore<WorkspaceConfig>(loadInitial());

let saveTimer = 0;
function persistSoon() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      /* 存储不可用时静默 */
    }
  }, 250);
}

/** 所有写操作集中走这里，自动做范围钳制与本地持久化 */
export const actions = {
  reset() {
    setConfig(createDefaultConfig());
    persistSoon();
  },

  replaceConfig(next: WorkspaceConfig) {
    setConfig(next);
    persistSoon();
  },

  updateLed(index: number, patch: Partial<LedConfig>) {
    setConfig(
      'leds',
      index,
      produce((led: LedConfig) => {
        if (patch.x !== undefined) led.x = clamp(patch.x, -LED_CELL_HALF_X, LED_CELL_HALF_X);
        if (patch.y !== undefined) led.y = clamp(patch.y, -LED_CELL_HALF_Y, LED_CELL_HALF_Y);
        if (patch.brightness !== undefined)
          led.brightness = clamp(patch.brightness, 0, 1);
        if (patch.tiltX !== undefined) led.tiltX = clamp(patch.tiltX, -30, 30);
        if (patch.tiltY !== undefined) led.tiltY = clamp(patch.tiltY, -30, 30);
        if (patch.enabled !== undefined) led.enabled = patch.enabled;
      }),
    );
    persistSoon();
  },

  setLedCount(count: number) {
    const n = clamp(Math.round(count), 1, MAX_LEDS);
    setConfig(
      produce((c: WorkspaceConfig) => {
        // 按槽位顺序启用前 n 颗
        c.leds.forEach((led, i) => {
          led.enabled = i < n;
        });
      }),
    );
    persistSoon();
  },

  setCurvature(level: CurvatureLevel) {
    setConfig('lens', 'curvature', level);
    persistSoon();
  },

  setThickness(t: number) {
    setConfig('lens', 'thickness', clamp(t, THICKNESS_MIN, THICKNESS_MAX));
    persistSoon();
  },

  setIor(ior: number) {
    setConfig('lens', 'ior', clamp(ior, 1.3, 2.0));
    persistSoon();
  },

  setCutoffY(y: number) {
    setConfig('projection', 'cutoffY', clamp(y, CUTOFF_MIN, CUTOFF_MAX));
    persistSoon();
  },

  setGradientWidth(w: number) {
    setConfig('projection', 'gradientWidth', clamp(w, GRADIENT_MIN, GRADIENT_MAX));
    persistSoon();
  },

  setWallDistance(d: number) {
    setConfig('wallDistance', clamp(d, 1000, 25_000));
    persistSoon();
  },

  patchProjection(patch: Partial<WorkspaceConfig['projection']>) {
    setConfig('projection', patch);
    persistSoon();
  },
};
