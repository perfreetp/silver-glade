import { applyProject, toPlainProject } from './store';
import type { ProjectData } from './types';

/** 导出工程为 JSON 文件并触发下载 */
export function exportProject(): void {
  const data = toPlainProject();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rail-terrain-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 从 JSON 文件导入工程;成功返回 null,失败返回错误信息 */
export async function importProject(file: File): Promise<string | null> {
  let d: any;
  try {
    d = JSON.parse(await file.text());
  } catch {
    return '文件不是有效的 JSON';
  }
  if (!d || d.version !== 1) return '文件版本不支持';
  const t = d.terrain;
  if (!t || !Array.isArray(t.heights) || t.heights.length !== t.res * t.res) {
    return '地形数据无效';
  }
  if (!Array.isArray(d.planPoints) || d.planPoints.length < 2) return '平面控制点无效';
  if (!Array.isArray(d.profilePoints) || d.profilePoints.length < 2) return '纵断面控制点无效';
  applyProject(d as ProjectData);
  return null;
}
