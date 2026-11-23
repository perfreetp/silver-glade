/** 浏览器端 kernel 单例：把 Vite 处理后的 wasm 地址注入 core/kernel。 */

import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { createKernel, type Kernel } from './kernel.ts';

let kernelPromise: Promise<Kernel> | null = null;

export function loadKernel(): Promise<Kernel> {
  if (!kernelPromise) {
    kernelPromise = createKernel({ wasmUrl: new URL(wasmUrl, import.meta.url).href }).catch((err) => {
      kernelPromise = null;
      throw err;
    });
  }
  return kernelPromise;
}

export type { Kernel } from './kernel.ts';
