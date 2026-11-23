// 扩展 e2e:笔刷、逐帧像素、256 分辨率、序列帧导出
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:4174/';
const DL = 'D:/ccfb/runs/1000209/workspace/test-downloads';
fs.mkdirSync(DL, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], {
  cwd: process.cwd(), stdio: 'pipe', shell: true,
});
await delay(2500);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--enable-unsafe-webgpu', '--no-sandbox', '--window-size=1400,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}`));

const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await delay(5000);

// 1. 笔刷笔画测试
const box = await page.evaluate(() => {
  const c = document.querySelector('.viewport canvas');
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log('canvas rect:', JSON.stringify(box));
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 60, cy + 20, { steps: 8 });
await page.mouse.move(cx + 100, cy + 50, { steps: 8 });
await page.mouse.up();
await delay(1500);
const strokeInfo = await page.evaluate(() => ({
  strokes: window.__engine?.liveView?.strokes?.length,
  splats: window.__engine?.liveView?.strokes?.[0]?.splats?.length,
}));
console.log('BRUSH TEST:', JSON.stringify(strokeInfo));
await page.screenshot({ path: 'test-shot-brush.png' });

// 2. 撤销测试
await page.evaluate(() => window.__engine.undoStroke());
await delay(800);
const afterUndo = await page.evaluate(() => window.__engine.liveView.strokes.length);
console.log('UNDO TEST strokes:', afterUndo);

// 3. 逐帧像素渲染(导出路径核心)
const pxLen = await page.evaluate(async () => {
  const px = await window.__engine.renderFrameToPixels(10, 320, 180);
  window.__engine.restoreFrame();
  return px.length;
});
console.log('FRAME PIXELS TEST:', pxLen, pxLen === 320 * 180 * 4 ? 'OK' : 'FAIL');

// 4. 序列帧导出(点击导出按钮,等 ZIP 下载)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => x.textContent.includes('导出 48 帧'));
  if (b) b.click();
});
let zipFile = null;
for (let i = 0; i < 120; i++) {
  await delay(2000);
  const files = fs.readdirSync(DL).filter((f) => f.endsWith('.zip'));
  if (files.length) { zipFile = files[0]; break; }
  if (i % 10 === 0) {
    const prog = await page.evaluate(() => document.querySelector('.sidebar')?.textContent?.match(/\d+\/48/)?.[0] || 'n/a');
    console.log('export progress:', prog);
  }
}
console.log('SEQUENCE EXPORT TEST:', zipFile ? `OK (${zipFile}, ${fs.statSync(DL + '/' + zipFile).size} bytes)` : 'FAIL - no zip');

// 5. 分辨率切到 256
await page.evaluate(() => {
  const sel = document.querySelectorAll('.sidebar select')[0];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, '256');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await delay(12000);
const res256 = await page.evaluate(() => ({
  res: window.__engine.settings.resolution,
  texW: window.__engine.liveView.densityTex.image.width,
}));
console.log('RESOLUTION 256 TEST:', JSON.stringify(res256));
await page.screenshot({ path: 'test-shot-256.png' });

console.log('--- ERRORS/WARNINGS ---');
for (const l of logs.slice(0, 40)) console.log(l);
console.log('TEST DONE');
await browser.close();
server.kill();
process.exit(0);
