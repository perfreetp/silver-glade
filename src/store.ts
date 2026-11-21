import { create } from 'zustand';
import type {
  Annotation,
  BladeAngle,
  MeasureResult,
  PathControlPoint,
  SnowCondition,
  ToolMode,
  ZoneId,
} from './types';
import { BLADE_SPECS, DEFAULT_SPEED, SNOW_SPECS, ZONE_GRID } from './three/constants';
import { resamplePath } from './three/path';
import { uid } from './three/uid';

export interface GroomState {
  // 模块一：底图与分区
  activeZones: Set<ZoneId>;
  toggleZone: (z: ZoneId) => void;
  setAllZones: (on: boolean) => void;

  // 工具模式
  toolMode: ToolMode;
  setToolMode: (m: ToolMode) => void;

  // 模块二：路径与刀头参数
  controlPoints: PathControlPoint[];
  addControlPoint: (x: number, z: number) => void;
  removeLastPoint: () => void;
  clearPath: () => void;
  loadPath: (pts: PathControlPoint[]) => void;

  blade: BladeAngle;
  setBlade: (b: BladeAngle) => void;
  snow: SnowCondition;
  setSnow: (s: SnowCondition) => void;
  speed: number;
  setSpeed: (v: number) => void;

  // 压雪机作业
  playing: boolean;
  playhead: number; // 已作业样本数
  setPlayhead: (n: number) => void;
  play: () => void;
  pause: () => void;
  resetGroom: () => void;

  // 模块三：预览
  showFog: boolean;
  toggleFog: () => void;
  showCorduroy: boolean;
  toggleCorduroy: () => void;
  wireframe: boolean;
  toggleWireframe: () => void;

  // 测距与标注
  measure: MeasureResult | null;
  setMeasure: (m: MeasureResult | null) => void;
  annotations: Annotation[];
  addAnnotation: (a: Omit<Annotation, 'id'>) => void;
  removeAnnotation: (id: string) => void;
  loadAnnotations: (a: Annotation[]) => void;

  // 状态反馈
  fps: number;
  setFps: (n: number) => void;
  groomedPercent: number;
  setGroomedPercent: (n: number) => void;
  bvhRefitAt: number;
  notifyBvhRefit: () => void;
}

const ALL_ZONES: ZoneId[] = [];
for (let ix = 0; ix < ZONE_GRID; ix++) {
  for (let iz = 0; iz < ZONE_GRID; iz++) ALL_ZONES.push({ ix, iz });
}

const zoneKey = (z: ZoneId) => `${z.ix}:${z.iz}`;

export const useGroomStore = create<GroomState>((set, get) => ({
  activeZones: new Set(ALL_ZONES),
  toggleZone: (z) => {
    const next = new Set(get().activeZones);
    const k = zoneKey(z);
    const has = [...next].some((q) => zoneKey(q) === k);
    if (has) next.delete([...next].find((q) => zoneKey(q) === k)!);
    else next.add(z);
    set({ activeZones: next });
  },
  setAllZones: (on) => set({ activeZones: new Set(on ? ALL_ZONES : []) }),

  toolMode: 'path',
  setToolMode: (m) => set({ toolMode: m }),

  controlPoints: [],
  addControlPoint: (x, z) =>
    set((st) => ({
      controlPoints: [...st.controlPoints, { id: uid('pt'), x, z }],
      playhead: 0,
      playing: false,
    })),
  removeLastPoint: () =>
    set((st) => ({ controlPoints: st.controlPoints.slice(0, -1), playhead: 0, playing: false })),
  clearPath: () => set({ controlPoints: [], playhead: 0, playing: false }),
  loadPath: (pts) => set({ controlPoints: pts, playhead: 0, playing: false }),

  blade: 'medium',
  setBlade: (b) => set({ blade: b }),
  snow: 'dry',
  setSnow: (s) => set({ snow: s }),
  speed: DEFAULT_SPEED,
  setSpeed: (v) => set({ speed: v }),

  playing: false,
  playhead: 0,
  setPlayhead: (n) => set({ playhead: n }),
  play: () => {
    if (resamplePath(get().controlPoints).length === 0) return;
    set({ playing: true });
  },
  pause: () => set({ playing: false }),
  resetGroom: () => set({ playhead: 0, playing: false }),

  showFog: true,
  toggleFog: () => set((st) => ({ showFog: !st.showFog })),
  showCorduroy: true,
  toggleCorduroy: () => set((st) => ({ showCorduroy: !st.showCorduroy })),
  wireframe: false,
  toggleWireframe: () => set((st) => ({ wireframe: !st.wireframe })),

  measure: null,
  setMeasure: (m) => set({ measure: m }),
  annotations: [],
  addAnnotation: (a) => set((st) => ({ annotations: [...st.annotations, { ...a, id: uid('ann') }] })),
  removeAnnotation: (id) => set((st) => ({ annotations: st.annotations.filter((a) => a.id !== id) })),
  loadAnnotations: (a) => set({ annotations: a }),

  fps: 0,
  setFps: (n) => set({ fps: n }),
  groomedPercent: 0,
  setGroomedPercent: (n) => set({ groomedPercent: n }),
  bvhRefitAt: 0,
  notifyBvhRefit: () => set({ bvhRefitAt: Date.now() }),
}));

/** 选择器：当前刀头/雪质规格 */
export const useBladeSpec = () => BLADE_SPECS[useGroomStore((s) => s.blade)];
export const useSnowSpec = () => SNOW_SPECS[useGroomStore((s) => s.snow)];
