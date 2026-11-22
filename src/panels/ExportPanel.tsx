import { type JSX, createMemo, createSignal } from 'solid-js';
import { actions, config } from '../store/configStore';
import { downloadConfig, parseImported, serializeConfig } from '../store/exportConfig';

export function ExportPanel(): JSX.Element {
  const [message, setMessage] = createSignal<{ ok: boolean; text: string } | null>(null);
  const json = createMemo(() => JSON.stringify(serializeConfig(config), null, 2));

  const onImport = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const restored = parseImported(text);
      actions.replaceConfig(restored);
      setMessage({ ok: true, text: `已导入 ${file.name}，配置已还原。` });
    } catch (err) {
      setMessage({ ok: false, text: `导入失败：${(err as Error).message}` });
    } finally {
      input.value = '';
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(json());
      setMessage({ ok: true, text: 'JSON 已复制到剪贴板。' });
    } catch {
      setMessage({ ok: false, text: '剪贴板不可用，请手动选择文本复制。' });
    }
  };

  return (
    <div class="panel split">
      <div class="sidebar">
        <div class="section-title">配置导出</div>
        <p style={{ color: 'var(--fg-dim)', margin: '0 0 10px' }}>
          序列化全部 16 个 LED 槽位、透镜曲率/厚度/IOR、截止线与采样参数，
          带 FNV-1a 校验和，可用于造型评审留档与参数回灌。
        </p>
        <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
          <button class="btn primary" onClick={() => downloadConfig(config)}>
            ⬇ 下载 JSON 文件
          </button>
          <button class="btn" onClick={copyJson}>
            复制到剪贴板
          </button>
          <label class="btn" style={{ display: 'inline-flex', 'align-items': 'center' }}>
            ⬆ 导入 JSON
            <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImport} />
          </label>
          <button
            class="btn"
            onClick={() => {
              actions.reset();
              setMessage({ ok: true, text: '已恢复出厂默认配置。' });
            }}
          >
            恢复默认
          </button>
        </div>

        {message() && (
          <div class="note" style={{ 'border-left-color': message()!.ok ? 'var(--accent-2)' : 'var(--danger)' }}>
            {message()!.text}
          </div>
        )}

        <div class="section-title">导出内容清单</div>
        <div class="metric-row">
          <span>LED 槽位</span>
          <span>{config.leds.length}（点亮 {config.leds.filter((l) => l.enabled).length}）</span>
          <span>透镜曲率档</span>
          <span>{config.lens.curvature}</span>
          <span>透镜厚度</span>
          <span>{config.lens.thickness} mm</span>
          <span>折射率</span>
          <span>{config.lens.ior}</span>
          <span>截止线</span>
          <span>{config.projection.cutoffY} mm</span>
          <span>过渡带宽</span>
          <span>{config.projection.gradientWidth} mm</span>
          <span>每 LED 光线</span>
          <span>{config.projection.raysPerLed}</span>
        </div>
      </div>

      <div class="viewport" style={{ padding: '10px' }}>
        <textarea class="json-preview" readonly value={json()} />
      </div>
    </div>
  );
}
