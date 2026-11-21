import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useGroomStore } from './store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// 仅开发环境暴露调试句柄，供无头浏览器端到端验证（生产构建会被裁掉）
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__groomStore = useGroomStore;
}
