/**
 * 生长快照文件的下载 / 载入辅助。
 * 快照为纯 JSON（Float32 数组以 base64 打包），可再次载入逐棒还原形态。
 */
import type { GrowthSnapshot } from '../types';

export function downloadSnapshot(snap: GrowthSnapshot, fileName?: string): string {
  const stamp = snap.exportedAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const name = fileName ?? `growth-snapshot_${stamp}.json`;
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
}

export function readSnapshotFile(file: File): Promise<GrowthSnapshot> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as GrowthSnapshot;
        validateSnapshot(data);
        resolve(data);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('快照解析失败'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.readAsText(file);
  });
}

export function validateSnapshot(data: GrowthSnapshot): void {
  if (data.format !== 'mushroom-rack-growth-snapshot') {
    throw new Error('不是合法的菇架生长快照文件（format 不匹配）');
  }
  if (data.version !== 1) throw new Error(`不支持的快照版本：${data.version}`);
  if (!data.rackConfig || !data.environment) throw new Error('快照缺少菇架配置或环境数据');
  for (const key of ['stickParams', 'stages', 'morphology'] as const) {
    if (typeof data[key] !== 'string') throw new Error(`快照字段 ${key} 缺失或损坏`);
  }
}
