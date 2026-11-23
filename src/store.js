import { createStore } from 'solid-js/store';
import { createSignal } from 'solid-js';

// ---------------- 参数 ----------------

export const defaultParams = () => ({
  elevation: 45,        // 太阳高度角 10~80°
  azimuth: 180,         // 太阳方位角 0~360°
  mapSize: 1024,        // 阴影贴图分辨率 512~2048
  bias: -0.0002,        // 阴影偏移(治阴影痤疮)
  normalBias: 0.03,     // 法线偏移
  radius: 4,            // 软阴影采样核大小
  groundRoughness: 0.95,// 地面粗糙度
  wallRoughness: 0.6,   // 墙面粗糙度
  lamp1: true,          // 路灯①
  lamp2: true,          // 路灯②
  debugView: 'none',    // none | shadowmap | cascade | depth
  debugCascade: 0,      // 查看哪一级级联的阴影贴图 0近 1中 2远
});

export const [params, setParams] = createStore(defaultParams());

export const PRESETS = {
  noon:    { label: '正午', elevation: 78, azimuth: 180 },
  evening: { label: '傍晚', elevation: 12, azimuth: 262 },
};

// ---------------- 版本快照 ----------------

let nextId = 1;
export const [versions, setVersions] = createSignal([]);
export const [compareIds, setCompareIds] = createSignal([]);

let pendingLabel = null;
export function setSnapshotLabel(l) { pendingLabel = l; }

export function snapshot(label) {
  const paramsJson = JSON.stringify(params);
  const list = versions();
  const last = list[list.length - 1];
  if (last && JSON.stringify(last.params) === paramsJson) return; // 没变化就不存
  const v = {
    id: nextId,
    label: label || `版本 ${nextId}`,
    time: new Date(),
    params: JSON.parse(paramsJson),
  };
  nextId += 1;
  setVersions((vs) => [...vs.slice(-49), v]);
}

let timer = null;
export function scheduleSnapshot(label) {
  const use = pendingLabel || label;
  pendingLabel = null;
  clearTimeout(timer);
  timer = setTimeout(() => snapshot(use), 800);
}

export function restoreVersion(v) {
  setSnapshotLabel(`恢复「${v.label}」`);
  setParams({ ...v.params });
}

export function deleteVersion(id) {
  setVersions((vs) => vs.filter((v) => v.id !== id));
  setCompareIds((ids) => ids.filter((i) => i !== id));
}

export function toggleCompare(id) {
  setCompareIds((ids) =>
    ids.includes(id) ? ids.filter((i) => i !== id) : [...ids.slice(-1), id],
  );
}

// ---------------- 小工具 ----------------

export const PERSON_HEIGHT = 1.4; // 小人的身高(米)

// 影长 = 身高 / tan(高度角)
export function shadowLength(p, h = PERSON_HEIGHT) {
  return h / Math.tan((p.elevation * Math.PI) / 180);
}

const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
export function azLabel(az) {
  return DIRS[Math.round(az / 45) % 8];
}

export const PARAM_LABELS = {
  elevation: '太阳高度角',
  azimuth: '太阳方位角',
  mapSize: '阴影贴图分辨率',
  bias: '阴影偏移',
  normalBias: '法线偏移',
  radius: '柔化核大小',
  groundRoughness: '地面粗糙度',
  wallRoughness: '墙面粗糙度',
  lamp1: '路灯①',
  lamp2: '路灯②',
  debugView: '调试视图',
  debugCascade: '调试级联',
};

export function fmtVal(key, val) {
  if (typeof val === 'boolean') return val ? '开' : '关';
  if (key === 'debugView')
    return { none: '关闭', shadowmap: '阴影贴图', cascade: '级联染色', depth: '深度' }[val];
  if (key === 'debugCascade') return ['近', '中', '远'][val];
  if (key === 'mapSize') return `${val} px`;
  if (key === 'elevation' || key === 'azimuth') return `${val}°`;
  if (key === 'bias') return Number(val).toFixed(4);
  return String(val);
}
