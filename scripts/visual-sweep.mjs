// 多帧视觉扫描
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const server = spawn('npx', ['vite', 'preview', '--port', '4177', '--strictPort'], {
  cwd: process.cwd(), stdio: 'pipe', shell: true,
});
await delay(2500);
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--enable-unsafe-webgpu', '--no-sandbox', '--window-size=1400,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message));
await page.goto('http://127.0.0.1:4177/', { waitUntil: 'networkidle0' });
await delay(5000);

for (const f of [0, 12, 24, 36, 47]) {
  await page.evaluate((frame) => window.__engine.setFrame(frame), f);
  await delay(1800);
  await page.screenshot({ path: `test-frame-${String(f).padStart(2, '0')}.png` });
  console.log('shot frame', f);
}
await browser.close();
server.kill();
process.exit(0);
