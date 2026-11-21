import { createStore } from 'solid-js/store';
import { DEFAULT_CONFIG } from './constants';
import type {
  ClearanceMap,
  ClearanceResult,
  WheelConfig,
  WheelId,
  WheelStyleId,
} from './types';
import { WHEEL_IDS } from './types';

export interface AppState {
  wheels: Record<WheelId, WheelConfig>;
  selected: WheelId;
  /** 视口是否处于单轮聚焦模式 */
  focused: boolean;
  clearances: ClearanceMap;
  /** 间隙检测是否正在进行（逐帧调度，正常情况下极短） */
  measuring: boolean;
}

function initialClearance(): ClearanceResult {
  return { min: null, status: 'warn', point: null, rayCount: 0, boundaryViolation: false };
}

export const [state, setState] = createStore<AppState>({
  wheels: {
    FL: { ...DEFAULT_CONFIG },
    FR: { ...DEFAULT_CONFIG },
    RL: { ...DEFAULT_CONFIG },
    RR: { ...DEFAULT_CONFIG },
  },
  selected: 'FL',
  focused: false,
  clearances: {
    FL: initialClearance(),
    FR: initialClearance(),
    RL: initialClearance(),
    RR: initialClearance(),
  },
  measuring: false,
});

export function selectWheel(id: WheelId): void {
  setState('selected', id);
}

export function setViewFocus(focused: boolean): void {
  setState('focused', focused);
}

/** 修改当前选中轮位的参数（参数面板、款式列表入口） */
export function updateSelectedConfig(patch: Partial<WheelConfig>): void {
  setState('wheels', state.selected, (prev) => ({ ...prev, ...patch }));
}

export function applyStyle(style: WheelStyleId): void {
  updateSelectedConfig({ style });
}

export function setClearance(id: WheelId, result: ClearanceResult): void {
  setState('clearances', id, result);
}

export function setMeasuring(v: boolean): void {
  setState('measuring', v);
}

export function resetSelectedWheel(): void {
  setState('wheels', state.selected, { ...DEFAULT_CONFIG });
}

export { WHEEL_IDS };
