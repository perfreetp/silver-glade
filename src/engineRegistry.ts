import { create } from 'zustand';
import type { PaintEngine } from './three/PaintEngine';

/** 引擎实例注册：不参与 React 渲染，仅做跨组件命令式桥接 */
interface EngineRegistry {
  engine: PaintEngine | null;
  setEngine: (e: PaintEngine | null) => void;
}

export const useEngineRegistry = create<EngineRegistry>((set) => ({
  engine: null,
  setEngine: (engine) => set({ engine }),
}));
