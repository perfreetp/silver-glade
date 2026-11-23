import './app/styles.ts';
import './components/viewer.ts';
import './components/importPanel.ts';
import './components/detectPanel.ts';
import './components/editPanel.ts';
import './components/statsPanel.ts';
import './components/fireApp.ts';

// 全局错误提示（避免静默失败）
window.addEventListener('error', (ev) => {
  console.error('[BurnTrace]', ev.error ?? ev.message);
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('[BurnTrace] unhandled', ev.reason);
});
