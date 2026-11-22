import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getPreset, PRESETS } from './presets';
import type {
  DebugMode,
  LightState,
  PaintParams,
  PresetCategory,
  SavedScheme,
} from './types';
import { MAX_SCHEMES } from './types';

export interface FrameMetricsState {
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  fps: number;
  droppedLastSecond: number;
}

export interface ContributionState {
  clearLum: number;
  baseLum: number;
}

interface PaintStore {
  activePresetId: string;
  activeCategory: PresetCategory;
  params: PaintParams;
  light: LightState;
  debugMode: DebugMode;
  schemes: SavedScheme[];
  /** 参数对比面板选中的两个方案 id */
  compareIds: [string | null, string | null];
  metrics: FrameMetricsState | null;
  contribution: ContributionState;
  toast: string | null;

  loadPreset: (id: string) => void;
  setCategory: (c: PresetCategory) => void;
  updateLayer: <K extends keyof PaintParams>(layer: K, patch: Partial<PaintParams[K]>) => void;
  setBaseColor: (hex: string) => void;
  setLight: (patch: Partial<LightState>) => void;
  setDebugMode: (m: DebugMode) => void;
  setMetrics: (m: FrameMetricsState) => void;
  setContribution: (c: ContributionState) => void;
  saveScheme: (name: string) => boolean;
  deleteScheme: (id: string) => void;
  applyScheme: (id: string) => void;
  toggleCompare: (id: string) => void;
  showToast: (msg: string) => void;
  clearToast: () => void;
}

const initialPreset = PRESETS[0];

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const usePaintStore = create<PaintStore>()(
  persist(
    (set, get) => ({
      activePresetId: initialPreset.id,
      activeCategory: initialPreset.category,
      params: structuredClone(initialPreset.params),
      light: { azimuth: 42, elevation: 52, intensity: 2.2 },
      debugMode: 0,
      schemes: [],
      compareIds: [null, null],
      metrics: null,
      contribution: { clearLum: 0, baseLum: 0 },
      toast: null,

      loadPreset: (id) => {
        const preset = getPreset(id);
        if (!preset) return;
        set({
          activePresetId: id,
          activeCategory: preset.category,
          params: structuredClone(preset.params),
        });
      },

      setCategory: (c) => set({ activeCategory: c }),

      updateLayer: (layer, patch) =>
        set((s) => ({
          params: {
            ...s.params,
            [layer]: { ...s.params[layer], ...patch },
          } as PaintParams,
        })),

      setBaseColor: (hex) =>
        set((s) => ({
          params: {
            ...s.params,
            mid: { ...s.params.mid, color: hex },
          },
        })),

      setLight: (patch) => set((s) => ({ light: { ...s.light, ...patch } })),
      setDebugMode: (m) => set({ debugMode: m }),

      setMetrics: (m) => set({ metrics: m }),
      setContribution: (c) => set({ contribution: c }),

      saveScheme: (name) => {
        const trimmed = name.trim();
        if (!trimmed) {
          get().showToast('请先填写方案名称');
          return false;
        }
        const { schemes, params, activeCategory } = get();
        if (schemes.length >= MAX_SCHEMES) {
          get().showToast(`最多保存 ${MAX_SCHEMES} 套方案，请先删除旧方案`);
          return false;
        }
        const scheme: SavedScheme = {
          id: `scheme-${Date.now()}-${Math.round(performance.now())}`,
          name: trimmed,
          category: activeCategory,
          params: structuredClone(params),
          createdAt: Date.now(),
        };
        set({ schemes: [...schemes, scheme] });
        get().showToast(`方案「${trimmed}」已保存（${schemes.length + 1}/${MAX_SCHEMES}）`);
        return true;
      },

      deleteScheme: (id) =>
        set((s) => ({
          schemes: s.schemes.filter((x) => x.id !== id),
          compareIds: [
            s.compareIds[0] === id ? null : s.compareIds[0],
            s.compareIds[1] === id ? null : s.compareIds[1],
          ],
        })),

      applyScheme: (id) => {
        const scheme = get().schemes.find((x) => x.id === id);
        if (!scheme) return;
        set({
          params: structuredClone(scheme.params),
          activeCategory: scheme.category,
          activePresetId: '',
        });
        get().showToast(`已套用方案「${scheme.name}」到试片`);
      },

      toggleCompare: (id) =>
        set((s) => {
          const [a, b] = s.compareIds;
          if (a === id) return { compareIds: [null, b] };
          if (b === id) return { compareIds: [a, null] };
          if (!a) return { compareIds: [id, b] };
          if (!b) return { compareIds: [a, id] };
          // 两个槽都占满时，替换第二个
          return { compareIds: [a, id] };
        }),

      showToast: (msg) => {
        if (toastTimer) clearTimeout(toastTimer);
        set({ toast: msg });
        toastTimer = setTimeout(() => set({ toast: null }), 2600);
      },

      clearToast: () => set({ toast: null }),
    }),
    {
      name: 'car-paint-studio-schemes',
      partialize: (s) => ({ schemes: s.schemes }) as PaintStore,
    },
  ),
);
