import { reactive, computed } from "vue";
import {
  type DamageGrade,
  type DamagePatchData,
  type PerfStats,
  type RoofStats,
  DEFAULT_THRESHOLDS,
  GRADE_META,
  severityToGrade,
} from "./types";
import type { BabylonService } from "./engine/BabylonService";

/** 全局 UI 状态（引擎服务负责写入，Vue 组件负责展示/触发） */
interface AppState {
  ready: boolean;
  engineType: "WebGPU" | "WebGL2" | "";
  roofName: string;
  roofStats: RoofStats | null;
  patches: DamagePatchData[];
  selectedPatchId: number | null;
  thresholds: [number, number];
  lift: number;
  opacity: number;
  depthPrePass: boolean;
  doubleSided: boolean;
  wireframe: boolean;
  refLinesVisible: boolean;
  drawMode: boolean;
  defaultSeverity: number;
  perf: PerfStats;
  busy: boolean;
  statusMessage: string;
}

export const store = reactive<AppState>({
  ready: false,
  engineType: "",
  roofName: "",
  roofStats: null,
  patches: [],
  selectedPatchId: null,
  thresholds: [...DEFAULT_THRESHOLDS],
  lift: 0.06,
  opacity: 0.55,
  depthPrePass: true,
  doubleSided: true,
  wireframe: false,
  refLinesVisible: true,
  drawMode: false,
  defaultSeverity: 0.5,
  perf: {
    patchCount: 0,
    layerTriangles: 0,
    rebuildMs: 0,
    projectMs: 0,
    frameMs: 0,
    fps: 0,
    drawCalls: 0,
  },
  busy: false,
  statusMessage: "初始化中…",
});

/** 引擎服务实例（main.ts 启动后注入） */
let service: BabylonService | null = null;
export function bindService(s: BabylonService) {
  service = s;
}
export function getService(): BabylonService {
  if (!service) throw new Error("BabylonService 尚未初始化");
  return service;
}

/** 单个面片当前生效等级（手动覆盖优先，否则按阈值自动分档） */
export function effectiveGrade(patch: DamagePatchData): DamageGrade {
  return patch.manualGrade ?? severityToGrade(patch.severity, store.thresholds);
}

/** 各等级面片数量与面积统计 */
export const gradeDistribution = computed(() => {
  const rows = GRADE_META.map((m) => ({
    grade: m.grade,
    name: m.name,
    css: m.css,
    count: 0,
    area: 0,
  }));
  for (const p of store.patches) {
    const g = effectiveGrade(p);
    rows[g - 1].count++;
    rows[g - 1].area += p.area;
  }
  return rows;
});

export const totalArea = computed(() =>
  store.patches.reduce((sum, p) => sum + p.area, 0)
);

export function setStatus(msg: string) {
  store.statusMessage = msg;
}
