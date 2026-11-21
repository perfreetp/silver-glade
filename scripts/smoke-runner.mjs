// 用 esbuild 将 TS 冒烟测试打包为 ESM，再以 Node 执行（headless，无 DOM/WebGL 依赖）
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outfile = path.join(root, 'node_modules', '.smoke.mjs');

await build({
  entryPoints: [path.join(root, 'scripts', 'smoke.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'info',
});

await import(pathToFileURL(outfile).href);
