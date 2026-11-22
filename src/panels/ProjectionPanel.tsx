import {
  type JSX,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { config, actions } from '../store/configStore';
import { Slider, Toggle } from '../components/Controls';
import type { RenderCoordinator, FrameTiming } from '../optics/renderCoordinator';
import { pixelYToWorldY } from '../optics/wallRenderer';
import {
  CUTOFF_MAX,
  CUTOFF_MIN,
  GRADIENT_MAX,
  GRADIENT_MIN,
  RAYS_MAX,
  RAYS_MIN,
  WALL_HEIGHT,
  WALL_TEX_H,
  WALL_TEX_W,
  WALL_WIDTH,
} from '../optics/constants';

export function ProjectionPanel(props: { coordinator: RenderCoordinator }): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | undefined;
  const [timing, setTiming] = createSignal<FrameTiming | null>(null);
  const [dragging, setDragging] = createSignal(false);

  // canvas 后备缓冲固定为照度纹理分辨率，CSS 负责等比放大
  onMount(() => {
    ctx = canvas!.getContext('2d')!;
    canvas!.width = WALL_TEX_W;
    canvas!.height = WALL_TEX_H;
    // 先同步出一帧
    const t = props.coordinator.runFrame();
    setTiming(t);
    blit();
    const off = props.coordinator.onFrame((tm) => {
      setTiming(tm);
      blit();
    });
    onCleanup(off);
  });

  // 任意配置变化 → 通知调度器（截止线变化只会走轻量合成路径）
  createEffect(() => {
    props.coordinator.onChange({
      leds: config.leds.map((l) => ({ ...l })),
      lens: { ...config.lens },
      projection: { ...config.projection },
      wallDistance: config.wallDistance,
    });
  });

  const blit = () => {
    const img = props.coordinator.cachedImage;
    if (img && ctx) ctx.putImageData(img, 0, 0);
  };

  // ---- 截止线拖动：屏幕坐标换算回墙面世界坐标 ----
  const eventToWorldY = (e: PointerEvent): number => {
    const rect = canvas!.getBoundingClientRect();
    const py = ((e.clientY - rect.top) / rect.height) * WALL_TEX_H - 0.5;
    return pixelYToWorldY(py + 0.5);
  };

  const onPointerDown = (e: PointerEvent & { currentTarget: HTMLCanvasElement }) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    actions.setCutoffY(eventToWorldY(e));
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging()) return;
    actions.setCutoffY(eventToWorldY(e));
  };
  const onPointerUp = (e: PointerEvent & { currentTarget: HTMLCanvasElement }) => {
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 已释放时忽略 */
    }
  };

  const fps = createMemo(() => {
    const t = timing();
    if (!t) return 0;
    return Math.round(1000 / Math.max(1, t.traceMs + t.renderMs));
  });

  const lightPathLabel = createMemo(() => {
    const t = timing();
    if (!t) return '-';
    return `${t.raysWall}/${t.raysTotal}`;
  });

  return (
    <div class="panel split">
      <div class="sidebar">
        <div class="section-title">截止线（可直接在光型图上拖动）</div>
        <Slider
          label="截止线高度 cutoffY"
          value={config.projection.cutoffY}
          min={CUTOFF_MIN}
          max={CUTOFF_MAX}
          step={5}
          unit=" mm"
          onChange={actions.setCutoffY}
        />
        <Toggle
          label="15° 折线（近光标准）"
          checked={config.projection.elbow}
          onChange={(v) => actions.patchProjection({ elbow: v })}
        />

        <div class="section-title">明暗过渡带</div>
        <Slider
          label="过渡带宽度"
          value={config.projection.gradientWidth}
          min={GRADIENT_MIN}
          max={GRADIENT_MAX}
          step={10}
          unit=" mm"
          onChange={actions.setGradientWidth}
        />
        <div class="note">
          过渡带按 smoothstep 解析求值，宽度 {config.projection.gradientWidth}mm
          （墙面处），上下各半。配合 2×2 双线性 splat 累积，明暗梯度连续无条带。
        </div>

        <div class="section-title">采样与显示</div>
        <Slider
          label="测试墙距离"
          value={config.wallDistance}
          min={3000}
          max={25000}
          step={100}
          unit=" mm"
          onChange={actions.setWallDistance}
        />
        <Slider
          label="每颗 LED 光线数"
          value={config.projection.raysPerLed}
          min={RAYS_MIN}
          max={RAYS_MAX}
          step={16}
          onChange={(v) => actions.patchProjection({ raysPerLed: v })}
        />
        <Slider
          label="曝光增益"
          value={config.projection.exposure}
          min={0.2}
          max={4}
          step={0.05}
          decimals={2}
          onChange={(v) => actions.patchProjection({ exposure: v })}
        />
        <div class="field">
          <label>
            <span>色图</span>
          </label>
          <select
            value={config.projection.colormap}
            onChange={(e) =>
              actions.patchProjection({ colormap: e.currentTarget.value as 'gray' | 'isolux' })
            }
          >
            <option value="isolux">伪彩等照度（isolux）</option>
            <option value="gray">灰度照度</option>
          </select>
        </div>
        <Toggle
          label="等照度线"
          checked={config.projection.contours}
          onChange={(v) => actions.patchProjection({ contours: v })}
        />

        <div class="section-title">本帧计时</div>
        <div class="metric-row">
          <span>BVH 追踪</span>
          <span>{timing() ? timing()!.traceMs.toFixed(2) : '-'} ms</span>
          <span>图像合成</span>
          <span>{timing() ? timing()!.renderMs.toFixed(2) : '-'} ms</span>
          <span>透镜/BVH 构建</span>
          <span>{timing() ? timing()!.lensBuildMs.toFixed(2) : '-'} ms</span>
          <span>落墙光线</span>
          <span>{lightPathLabel()}</span>
          <span>理论吞吐</span>
          <span>~{fps()} fps</span>
        </div>
        <div class="note">
          拖动截止线/过渡带时复用照度累积缓冲，仅重跑图像合成，单帧预算内完成（两帧出图）；
          调整光源、透镜或光线密度才触发完整 BVH 重追踪。
        </div>
      </div>

      <div class="viewport">
        <div class="wall-wrap">
          <canvas
            ref={canvas}
            class="wall-canvas"
            style={{ 'aspect-ratio': `${WALL_TEX_W} / ${WALL_TEX_H}`, width: 'min(100%, 92%)' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
        <div class="hud interactive">
          <div>
            测试墙 <b>{(config.wallDistance / 1000).toFixed(1)}m</b>，视场 {WALL_WIDTH / 1000}m ×{' '}
            {WALL_HEIGHT / 1000}m，纹理 {WALL_TEX_W}×{WALL_TEX_H}
          </div>
          <div>
            截止线 <b>{config.projection.cutoffY} mm</b> / 过渡带{' '}
            <b>{config.projection.gradientWidth} mm</b>
          </div>
        </div>
        <div class="drag-hint">在光型图上按住上下拖动 → 移动截止线（青色折线）</div>
      </div>
    </div>
  );
}
