import { createEffect, onCleanup, onMount, type JSX } from 'solid-js';
import { LampScene } from '../three/scene3d';
import type { OpticsEngine } from '../optics/tracer';

interface Viewport3DProps {
  engine: OpticsEngine;
  onPickLed?: (index: number) => void;
  onSceneReady?: (scene: LampScene) => void;
  /** 响应式依赖变化时执行的场景同步回调 */
  sync: (scene: LampScene) => void;
  children?: JSX.Element;
}

/** Solid 与命令式 three.js 场景之间的桥接组件 */
export function Viewport3D(props: Viewport3DProps): JSX.Element {
  let host: HTMLDivElement | undefined;
  let scene: LampScene;

  onMount(() => {
    scene = new LampScene(host!, {
      onSelectLed: (idx) => {
        if (idx !== null) props.onPickLed?.(idx);
      },
    });
    scene.setOpticsEngine(props.engine);
    props.onSceneReady?.(scene);
  });

  createEffect(() => {
    if (scene!) props.sync(scene);
  });

  onCleanup(() => scene?.dispose());

  return (
    <div class="viewport" ref={host}>
      {props.children}
    </div>
  );
}
