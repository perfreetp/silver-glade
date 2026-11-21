/**
 * 环境调节面板：
 * - 温度 8 档离散滑杆（8/11/14/17/20/23/26/29 °C）
 * - 湿度 0–100% 连续滑杆
 * - 播放 / 倍速 / 重置 / 快照导出 / 快照载入
 * 温湿度改动经 onChange 实时上抛，驱动整架重算形态。
 */
import { useRef } from 'react';
import type { EnvironmentInput } from '../types';
import {
  FULL_CYCLE_HOURS,
  HUMIDITY_MAX,
  HUMIDITY_MIN,
  humidityFactor,
  TEMP_STEPS,
  temperatureFactor,
} from '../core/growth';

interface EnvironmentPanelProps {
  title: string;
  accent?: string;
  env: EnvironmentInput;
  onChange: (env: EnvironmentInput) => void;
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  onReset: () => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
  meanStage: number;
  elapsedHours: number;
  compact?: boolean;
}

const SPEED_OPTIONS = [1, 6, 24, 72];

export default function EnvironmentPanel(props: EnvironmentPanelProps) {
  const { env, onChange } = props;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tempIndex = TEMP_STEPS.findIndex((t) => t === env.temperature);
  const tFactor = temperatureFactor(env.temperature);
  const hFactor = humidityFactor(env.humidity);
  const combined = tFactor * hFactor;

  return (
    <section className="env-panel" style={props.accent ? { borderTopColor: props.accent } : undefined}>
      <header className="env-panel__title">
        <span className="dot" style={props.accent ? { background: props.accent } : undefined} />
        {props.title}
      </header>

      <div className="env-control">
        <div className="env-control__head">
          <label>温度（8 档）</label>
          <output>
            <strong>{env.temperature}</strong> °C
          </output>
        </div>
        <input
          type="range"
          min={0}
          max={TEMP_STEPS.length - 1}
          step={1}
          value={tempIndex < 0 ? 3 : tempIndex}
          onChange={(e) => onChange({ ...env, temperature: TEMP_STEPS[Number(e.target.value)]! })}
        />
        <div className="tick-row">
          {TEMP_STEPS.map((t) => (
            <span key={t} className={t === env.temperature ? 'tick tick--active' : 'tick'}>
              {t}
            </span>
          ))}
        </div>
        <div className="factor-line">
          温度适配因子 <b>{tFactor.toFixed(3)}</b>
        </div>
      </div>

      <div className="env-control">
        <div className="env-control__head">
          <label>相对湿度</label>
          <output>
            <strong>{env.humidity}</strong> %
          </output>
        </div>
        <input
          type="range"
          min={HUMIDITY_MIN}
          max={HUMIDITY_MAX}
          step={1}
          value={env.humidity}
          onChange={(e) => onChange({ ...env, humidity: Number(e.target.value) })}
        />
        <div className="factor-line">
          湿度适配因子 <b>{hFactor.toFixed(3)}</b>
        </div>
      </div>

      <div className="factor-line factor-line--combined">
        综合生长速率 = 完整周期 {FULL_CYCLE_HOURS / 24} 天 × {combined.toFixed(3)}
      </div>

      <div className="env-control">
        <div className="env-control__head">
          <label>生长进度</label>
          <output>
            <strong>{(props.meanStage * 100).toFixed(1)}</strong> %
          </output>
        </div>
        <div className="progress-bar">
          <div className="progress-bar__fill" style={{ width: `${props.meanStage * 100}%` }} />
        </div>
        <div className="factor-line">模拟累计 {props.elapsedHours.toFixed(1)} 小时</div>
      </div>

      <div className="button-row">
        <button className="btn btn--primary" onClick={props.onTogglePlay}>
          {props.playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button className="btn" onClick={props.onReset}>
          ↺ 重置
        </button>
      </div>

      {!props.compact && (
        <>
          <div className="env-control__head speed-row">
            <label>播放倍速（模拟小时/秒）</label>
            <div className="seg">
              {SPEED_OPTIONS.map((s) => (
                <button
                  key={s}
                  className={props.speed === s ? 'seg__btn seg__btn--active' : 'seg__btn'}
                  onClick={() => props.onSpeedChange(s)}
                >
                  {s}h
                </button>
              ))}
            </div>
          </div>

          <div className="button-row">
            <button className="btn" onClick={props.onExport}>
              ⤓ 导出生长快照
            </button>
            <button className="btn" onClick={() => fileInputRef.current?.click()}>
              ⤒ 载入快照
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) props.onImportFile(f);
                e.target.value = '';
              }}
            />
          </div>
        </>
      )}
    </section>
  );
}
