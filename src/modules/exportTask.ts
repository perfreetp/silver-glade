import { WORLD_SIZE, ZONE_GRID, ZONE_SIZE } from '../three/constants';
import { resamplePath, pathLength } from '../three/path';
import { useGroomStore } from '../store';
import type { GroomTaskFile } from '../types';

/** 生成供次日复压的任务文件（路径点 + 刀头/雪质档位 + 标注测距） */
export function buildTaskFile(): GroomTaskFile {
  const s = useGroomStore.getState();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    world: { size: WORLD_SIZE, zoneGrid: ZONE_GRID, zoneSize: ZONE_SIZE },
    snow: s.snow,
    blade: s.blade,
    speed: s.speed,
    controlPoints: s.controlPoints.map(({ id, x, z }) => ({ id, x, z })),
    annotations: s.annotations,
    measure: s.measure,
  };
}

export function downloadTaskFile() {
  const task = buildTaskFile();
  const blob = new Blob([JSON.stringify(task, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `groom-task-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 载入昨日任务文件复压 */
export async function importTaskFile(file: File): Promise<GroomTaskFile> {
  const text = await file.text();
  const task = JSON.parse(text) as GroomTaskFile;
  if (task.version !== 1 || !Array.isArray(task.controlPoints)) {
    throw new Error('任务文件格式不正确');
  }
  const store = useGroomStore.getState();
  store.loadPath(task.controlPoints);
  store.setBlade(task.blade);
  store.setSnow(task.snow);
  store.setSpeed(task.speed);
  if (task.annotations) store.loadAnnotations(task.annotations);
  if (task.measure) store.setMeasure(task.measure);
  return task;
}

/** 摘要信息（界面展示用） */
export function taskSummary(): string {
  const s = useGroomStore.getState();
  const samples = resamplePath(s.controlPoints);
  const len = pathLength(samples);
  return [
    `控制点 ${s.controlPoints.length} 个`,
    `路径 ${len.toFixed(1)} 米`,
    `刀头 ${s.blade} / 雪质 ${s.snow}`,
    `标注 ${s.annotations.length} 条`,
  ].join('　');
}
