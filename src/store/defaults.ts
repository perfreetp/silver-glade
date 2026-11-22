import type { LedConfig, WorkspaceConfig } from '../types';
import {
  LED_BOARD_Z,
  LED_GRID_COLS,
  LED_GRID_ROWS,
  LED_SLOT_DX,
  LED_SLOT_DY,
  MAX_LEDS,
} from '../optics/constants';

let nextLedId = 1;

function makeDefaultLeds(): LedConfig[] {
  const leds: LedConfig[] = [];
  for (let i = 0; i < MAX_LEDS; i++) {
    const col = i % LED_GRID_COLS;
    const row = Math.floor(i / LED_GRID_COLS);
    const x = (col - (LED_GRID_COLS - 1) / 2) * LED_SLOT_DX;
    const y = ((LED_GRID_ROWS - 1) / 2 - row) * LED_SLOT_DY;
    // 默认点亮中间两行，模拟常见近光 LED 阵列
    const enabled = row === 1 || row === 2;
    leds.push({
      id: nextLedId++,
      enabled,
      x,
      y,
      tiltX: 0,
      tiltY: 0,
      brightness: enabled ? 0.85 : 0.6,
    });
  }
  return leds;
}

export function createDefaultConfig(): WorkspaceConfig {
  return {
    version: 1,
    unit: 'mm',
    wallDistance: 10_000,
    leds: makeDefaultLeds(),
    lens: { curvature: 1, thickness: 5, ior: 1.52 },
    projection: {
      cutoffY: 0,
      gradientWidth: 300,
      elbow: true,
      exposure: 1.4,
      colormap: 'isolux',
      contours: false,
      raysPerLed: 512,
    },
  };
}

export { LED_BOARD_Z };
