import { reactive } from 'vue';

export interface RoutePoint {
  x: number; // km, 0..60
  z: number; // km, 0..60
}

export type ModuleKey = 'route' | 'volume' | 'profile';

export const store = reactive({
  module: 'volume' as ModuleKey,

  // 时间序列
  frame: 0,
  playing: false,

  // 体积渲染
  threshold: 1, // 0/1/2 三档
  thresholds: [0.2, 0.4, 0.6],
  showTerrain: true,
  showRoute: true,
  fogEnabled: true,
  colorMapEnabled: true,

  // 航路
  route: {
    points: [
      { x: 8, z: 10 },
      { x: 30, z: 26 },
      { x: 52, z: 48 },
    ] as RoutePoint[],
    bandMin: 600,  // m
    bandMax: 2500, // m
  },

  // 状态
  loading: false,
  loadProgress: 0,
  cloudBase: null as { min: number; mean: number } | null,
});
