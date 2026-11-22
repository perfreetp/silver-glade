import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  // 软件 WebGL 渲染较慢，给点击/输入类动作更宽的稳定判定窗口
  actionTimeout: 10_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    // 无头环境无硬件 GPU，强制 SwiftShader 软件渲染并关闭 GPU 沙箱相关限制，
    // 避免 WebGL 持续渲染占满主线程导致 actionability 检查超时
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-gpu-sandbox',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
