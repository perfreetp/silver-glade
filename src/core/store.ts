import { reactive } from 'vue';
import { NOZZLE_HEIGHT } from './config';
import type { NozzleSpec, NozzleStats } from './types';

const PALETTE = [
  0x4fc3f7, 0xffb74d, 0x81c784, 0xba68c8, 0xff8a65, 0x4db6ac,
  0xfff176, 0xf06292, 0x9575cd, 0xaed581, 0x64b5f6, 0xffd54f,
];

/** 12 个预置喷头位（位于菇架间过道上方），前 N 个即 N 喷头布局 */
const SLOTS: [number, number][] = [
  [-7.5, -2.2], [7.5, 2.2], [-1.5, -2.2], [1.5, 2.2],
  [-4.5, 2.2], [4.5, -2.2], [-7.5, 2.2], [7.5, -2.2],
  [-1.5, 2.2], [1.5, -2.2], [-4.5, -2.2], [4.5, 2.2],
];

export const store = reactive({
  nozzles: [] as NozzleSpec[],
  stats: {} as Record<number, NozzleStats>,
  selectedId: -1,
  view: 'top' as 'top' | 'side',
  /** 遮挡检查：开启时被菇架挡住的地面点不计入覆盖并显示为灰色 */
  showOcclusion: true,
  /** 饱和阈值（累积湿度） */
  threshold: 1.0,
  /** 地面覆盖率 0..1 */
  coverage: 0,
  /** 过饱和栅格数 */
  saturated: 0,
});

function makeNozzle(i: number): NozzleSpec {
  const [x, z] = SLOTS[i % SLOTS.length];
  return {
    id: i,
    name: `喷头 ${i + 1}`,
    x,
    y: NOZZLE_HEIGHT,
    z,
    tilt: 0,
    azimuth: 0,
    spread: 26,
    intensity: 1,
    on: true,
    color: PALETTE[i % PALETTE.length],
  };
}

export function setNozzleCount(count: number) {
  const n = Math.max(4, Math.min(12, Math.round(count)));
  while (store.nozzles.length > n) store.nozzles.pop();
  while (store.nozzles.length < n) store.nozzles.push(makeNozzle(store.nozzles.length));
  if (store.selectedId >= n) store.selectedId = -1;
}

setNozzleCount(6);
