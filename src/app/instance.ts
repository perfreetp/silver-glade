/** 全局单例：状态存储与 manifold 内核。 */

import { AppStore } from './store.ts';
import { loadKernel } from '../core/kernelBrowser.ts';

export const store = new AppStore();

export async function initKernel(): Promise<void> {
  try {
    store.setStatus('正在初始化几何内核（manifold-3d / WASM）…', 'info');
    store.kernel = await loadKernel();
    store.setStatus('几何内核就绪', 'ok');
  } catch (err) {
    console.error(err);
    store.setStatus('几何内核加载失败：边界布尔运算不可用', 'error', String(err));
  }
}

export const SAMPLES = {
  imagery: './samples/burn-scar.png',
  dem: './samples/burn-scar.asc',
};
