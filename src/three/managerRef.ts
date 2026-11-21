import type { SceneManager } from './SceneManager';

/** App 挂载后注入，供面板组件调用场景方法 */
export const managerRef: { current: SceneManager | null } = { current: null };
