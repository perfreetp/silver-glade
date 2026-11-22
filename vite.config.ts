import { defineConfig } from 'vite';

// SharedArrayBuffer（扩散模拟多 worker 并行所需）要求跨源隔离，
// 因此 dev / preview 服务器都带上 COOP/COEP 响应头。
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: {
    headers: crossOriginIsolationHeaders,
    port: 5180,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
    port: 4180,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
