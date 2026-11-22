import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// 注意：不使用 React.StrictMode —— 其开发态双挂载会创建/销毁 Babylon 引擎，
// 而 WebGL 上下文与场景资源释放后无法在同一 canvas 上重建。
createRoot(document.getElementById('root')!).render(<App />);
