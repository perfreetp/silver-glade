import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './styles/app.css';

// No StrictMode: its double-mount would create and dispose a second WebGPU
// device on every load, which is expensive and leaves a dead canvas behind.
createRoot( document.getElementById( 'root' )! ).render( <App /> );
