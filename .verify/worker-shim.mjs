// Worker 垫片：pathWorker.js 无 import/export，作为经典脚本在 node worker 中运行
import { parentPort } from 'node:worker_threads';
globalThis.self = globalThis;
await import(new URL('../src/workers/pathWorker.js', import.meta.url));
// Node worker_threads 不自动转发全局 onmessage/postMessage，手动桥接
globalThis.postMessage = (msg) => parentPort.postMessage(msg);
parentPort.on('message', (msg) => globalThis.self.onmessage({ data: msg }));
