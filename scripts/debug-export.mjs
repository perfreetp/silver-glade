// 调试序列帧导出
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DL = 'D:/ccfb/runs/1000209/workspace/test-downloads';
fs.mkdirSync(DL, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', '4175', '--strictPort'], {
  cwd: process.cwd(), stdio: 'pipe', shell: true,
});
await delay(2500);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--enable-unsafe-webgpu', '--no-sandbox', '--window-size=1400,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('console', (m) => console.log(`[console.${m.type()}]`, m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message));

const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

await page.goto('http://127.0.0.1:4175/', { waitUntil: 'networkidle0' });
await delay(5000);

// 直接测试 blob 下载机制
await page.evaluate(() => {
  const blob = new Blob(['hello'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'probe.txt';
  document.body.appendChild(a); a.click(); a.remove();
});
await delay(2000);
console.log('probe download:', fs.readdirSync(DL));

// 直接调用导出流程(逐步,带日志)
const result = await page.evaluate(async () => {
  const engine = window.__engine;
  const log = [];
  try {
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm').catch(() => ({ default: null }));
    log.push('jszip dynamic import: ' + (JSZip ? 'ok' : 'failed'));
  } catch (e) {
    log.push('jszip import err: ' + e.message);
  }
  // 逐帧渲染计时
  const t0 = performance.now();
  for (let f = 0; f < 3; f++) {
    await engine.renderFrameToPixels(f, 320, 180);
  }
  log.push('3 frames in ' + Math.round(performance.now() - t0) + 'ms');
  engine.restoreFrame();
  return log;
});
console.log(result);

await browser.close();
server.kill();
process.exit(0);
