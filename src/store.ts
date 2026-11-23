import { reactive, watch } from 'vue';
import type { ProjectData } from './types';
import { generateHeights } from './noise';
import { samplePlan, elevationAt, gradeSegments, type TrackSample, type GradeSeg } from './alignment';
import { heightAt } from './terrain';

const STORAGE_KEY = 'rail-terrain-fusion-v1';
const TERRAIN_SIZE = 2000;
const TERRAIN_RES = 128;
const TERRAIN_AMPLITUDE = 40;

export const store = reactive<ProjectData>(loadInitial());

/** 派生数据:由控制点实时重算的线路几何与坡度信息 */
export const derived = reactive({
  samples: [] as TrackSample[],
  /** 各采样点轨面高程 */
  trackElev: [] as number[],
  /** 各采样点处地形高程 */
  terrainElev: [] as number[],
  totalLength: 0,
  grades: [] as GradeSeg[],
  /** 最大坡度绝对值(%) */
  maxGrade: 0,
  engineType: '',
});

/** 由平面 + 纵断面控制点重算线路派生数据 */
export function recomputeDerived(): void {
  const samples = samplePlan(store.planPoints, 5);
  const total = samples.length ? samples[samples.length - 1].s : 0;
  // 平面长度变化后,把纵断面里程钳制到新范围内并保持有序
  if (total > 0) {
    for (const p of store.profilePoints) {
      p.s = Math.min(Math.max(p.s, 0), total);
    }
    store.profilePoints.sort((a, b) => a.s - b.s);
  }
  derived.samples = samples;
  derived.totalLength = total;
  derived.trackElev = samples.map((sm) => elevationAt(store.profilePoints, sm.s));
  derived.terrainElev = samples.map((sm) => heightAt(store.terrain, sm.x, sm.z));
  derived.grades = gradeSegments(store.profilePoints);
  derived.maxGrade = derived.grades.reduce((m, g) => Math.max(m, Math.abs(g.grade)), 0);
}

function defaultProject(): ProjectData {
  const terrain = {
    size: TERRAIN_SIZE,
    res: TERRAIN_RES,
    heights: generateHeights(TERRAIN_RES, 20261123, TERRAIN_AMPLITUDE),
  };
  const planPoints = [
    { x: -820, z: -680 },
    { x: -450, z: -250 },
    { x: -80, z: -420 },
    { x: 250, z: 50 },
    { x: 520, z: 380 },
    { x: 780, z: 640 },
  ];
  // 初始纵断面:沿线路取地形高程并加正负交替的偏移,保证挖方填方都能见到
  const samples = samplePlan(planPoints, 25);
  const total = samples.length ? samples[samples.length - 1].s : 1000;
  const offsets = [8, -6, 10, -9, 6, -4];
  const profilePoints = offsets.map((off, i) => {
    const s = (total * i) / (offsets.length - 1);
    let best = samples[0];
    let bd = Infinity;
    for (const sm of samples) {
      const d = Math.abs(sm.s - s);
      if (d < bd) {
        bd = d;
        best = sm;
      }
    }
    return { s, elev: heightAt(terrain, best.x, best.z) + off };
  });
  return {
    version: 1,
    terrain,
    planPoints,
    profilePoints,
    bedWidth: 12,
    milepostInterval: 500,
    showTerrain: true,
    showTrack: true,
  };
}

function isValidProject(d: any): d is ProjectData {
  return (
    d &&
    d.version === 1 &&
    d.terrain &&
    Array.isArray(d.terrain.heights) &&
    d.terrain.heights.length === d.terrain.res * d.terrain.res &&
    Array.isArray(d.planPoints) &&
    d.planPoints.length >= 2 &&
    Array.isArray(d.profilePoints) &&
    d.profilePoints.length >= 2
  );
}

function loadInitial(): ProjectData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (isValidProject(d)) {
        return {
          ...d,
          bedWidth: +d.bedWidth || 12,
          milepostInterval: +d.milepostInterval || 500,
          showTerrain: d.showTerrain !== false,
          showTrack: d.showTrack !== false,
        };
      }
    }
  } catch {
    /* 数据损坏则回退默认工程 */
  }
  return defaultProject();
}

/** 导出用的纯数据(去掉响应式代理) */
export function toPlainProject(): ProjectData {
  return {
    version: 1,
    terrain: {
      size: store.terrain.size,
      res: store.terrain.res,
      heights: Array.from(store.terrain.heights),
    },
    planPoints: store.planPoints.map((p) => ({ x: p.x, z: p.z })),
    profilePoints: store.profilePoints.map((p) => ({ s: p.s, elev: p.elev })),
    bedWidth: store.bedWidth,
    milepostInterval: store.milepostInterval,
    showTerrain: store.showTerrain,
    showTrack: store.showTrack,
  };
}

/** 用导入的数据整体替换当前工程 */
export function applyProject(d: ProjectData): void {
  store.terrain = {
    size: +d.terrain.size,
    res: +d.terrain.res,
    heights: d.terrain.heights.map(Number),
  };
  store.planPoints = d.planPoints.map((p) => ({ x: +p.x, z: +p.z }));
  store.profilePoints = d.profilePoints.map((p) => ({ s: +p.s, elev: +p.elev }));
  store.bedWidth = +d.bedWidth || 12;
  store.milepostInterval = +d.milepostInterval || 500;
  store.showTerrain = d.showTerrain !== false;
  store.showTrack = d.showTrack !== false;
  recomputeDerived();
  scheduleSave();
}

/** 重新随机生成地形 */
export function regenerateTerrain(): void {
  store.terrain = {
    size: TERRAIN_SIZE,
    res: TERRAIN_RES,
    heights: generateHeights(TERRAIN_RES, Math.floor(Math.random() * 1e9), TERRAIN_AMPLITUDE),
  };
  recomputeDerived();
  scheduleSave();
}

let saveTimer = 0;
export function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPlainProject()));
    } catch {
      /* 存储满等情况忽略 */
    }
  }, 400);
}

// 控制点变化 -> 重算派生线形
watch(
  () => [store.planPoints, store.profilePoints],
  () => recomputeDerived(),
  { deep: true }
);

// 任何可序列化字段变化 -> 持久化到浏览器
watch(
  () => [
    store.planPoints,
    store.profilePoints,
    store.bedWidth,
    store.milepostInterval,
    store.showTerrain,
    store.showTrack,
  ],
  () => scheduleSave(),
  { deep: true }
);

recomputeDerived();
