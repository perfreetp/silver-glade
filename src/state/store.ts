/**
 * 应用级状态（轻量响应式 store，不引第三方状态库）
 */

import { reactive, ref, shallowRef } from "vue";
import type { Rack, RoomConfig } from "../model/types";
import { DEFAULT_ROOM } from "../model/types";
import type { ParseIssue } from "../io/parseThermalData";
import { loadPrefs, savePrefs, type UiPrefs } from "./persistence";
import type { PaletteId } from "../engine/palette";

export interface Stats {
  fps: number;
  frameMs: number;
  isoVerts: number;
  isoReady: boolean;
  lastIsoMs: number;
  voxels: number;
  racks: number;
}

export interface ImportSummary {
  filename: string;
  format: string;
  rackCount: number;
  sampleCount: number;
  issueCount: number;
}

export const ui = reactive({
  activeTab: "import" as "import" | "iso" | "heatmap" | "export",
  prefs: loadPrefs() as UiPrefs & { palette: PaletteId },
  stats: { fps: 0, frameMs: 0, isoVerts: 0, isoReady: false, lastIsoMs: 0, voxels: 0, racks: 0 } as Stats,
  issues: [] as ParseIssue[],
  summary: null as ImportSummary | null,
  error: "" as string,
  busy: "" as string,
  engineReady: false,
  selectedRack: null as number | null,
  roomConfig: { ...DEFAULT_ROOM } as RoomConfig,
  exportLog: [] as { at: number; file: string; bytes: number }[],
});

export const racks = shallowRef<Rack[]>([]);
export const appRefs = {
  engine: null as unknown,
  canvas: ref<HTMLCanvasElement | null>(null),
};

export function persistPrefs(): void {
  savePrefs(ui.prefs);
}

export function setStats(s: Stats): void {
  ui.stats = s;
}

export function setError(msg: string): void {
  ui.error = msg;
  if (msg) {
    window.setTimeout(() => {
      if (ui.error === msg) ui.error = "";
    }, 6000);
  }
}
