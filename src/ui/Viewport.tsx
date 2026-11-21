import { createEffect, onCleanup, onMount } from 'solid-js';
import { SceneEngine } from '../engine/SceneEngine';
import { state, selectWheel, setViewFocus } from '../store';
import { WHEEL_NAMES } from '../types';

export default function Viewport() {
  let mountRef: HTMLDivElement | undefined;
  let engine: SceneEngine | undefined;

  onMount(() => {
    engine = new SceneEngine(mountRef!);
    engine.onPick((id) => {
      selectWheel(id);
      if (state.focused) setViewFocus(true); // 聚焦态下点击其它车轮直接切换聚焦对象
    });

    // 轮位配置 → 引擎装配（参数变化后重新生成并立即装配）
    createEffect(() => {
      for (const id of ['FL', 'FR', 'RL', 'RR'] as const) {
        engine!.setConfig(id, state.wheels[id]);
      }
    });
    // 选中轮位 → 引擎高亮 / 截面
    createEffect(() => {
      engine!.setSelected(state.selected);
    });
    // 视角模式 → 引擎相机过渡
    createEffect(() => {
      engine!.setFocus(state.focused);
    });
  });

  onCleanup(() => engine?.dispose());

  return (
    <main class="viewport" ref={mountRef}>
      <div class="viewport-overlay">
        <span class="overlay-tag">
          {state.focused
            ? `聚焦：${WHEEL_NAMES[state.selected]}（轮拱截面已显示）`
            : '整车视角 · 四轮实时同步 · 点击车轮可选中'}
        </span>
        <span class="overlay-hint">左键旋转 · 右键平移 · 滚轮缩放</span>
      </div>
    </main>
  );
}
