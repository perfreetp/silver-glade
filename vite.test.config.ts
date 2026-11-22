import { defineConfig } from 'vite';

// 仅用于把内核测试打包成 Node ESM：vite -c vite.test.config.ts build
export default defineConfig({
  configFile: false,
  build: {
    lib: {
      entry: 'src/test/kernel.test.ts',
      formats: ['es'],
      fileName: 'kernel.test',
    },
    outDir: 'dist-test',
    minify: false,
    sourcemap: false,
  },
});
