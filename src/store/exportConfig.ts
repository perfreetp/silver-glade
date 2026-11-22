import type { WorkspaceConfig } from '../types';

/** 导出用的完整序列化结构（带生成时间与校验和，便于灯具造型评审留档） */
export interface ExportPayload {
  meta: {
    tool: 'headlamp-pattern-studio';
    schemaVersion: 1;
    exportedAt: string;
    checksum: string;
  };
  config: WorkspaceConfig;
}

/** FNV-1a 32 位校验和 */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function serializeConfig(config: WorkspaceConfig): ExportPayload {
  const cleanConfig = JSON.parse(JSON.stringify(config)) as WorkspaceConfig;
  const body = JSON.stringify(cleanConfig);
  return {
    meta: {
      tool: 'headlamp-pattern-studio',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      checksum: fnv1a(body),
    },
    config: cleanConfig,
  };
}

export function downloadConfig(config: WorkspaceConfig, filename = 'headlamp-config.json') {
  const payload = serializeConfig(config);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 给浏览器一点时间发起下载再回收
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 导入校验：失败时抛出带中文说明的错误 */
export function parseImported(text: string): WorkspaceConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法 JSON');
  }
  const payload = parsed as Partial<ExportPayload>;
  const config = (payload.config ?? parsed) as Partial<WorkspaceConfig> | undefined;
  if (!config || config.version !== 1 || !Array.isArray(config.leds) || !config.lens || !config.projection) {
    throw new Error('JSON 结构与当前工具版本不匹配（需要 version=1 的配置）');
  }
  if (config.leds.length === 0 || config.leds.length > 16) {
    throw new Error('LED 数量必须在 1..16 之间');
  }
  return config as WorkspaceConfig;
}
