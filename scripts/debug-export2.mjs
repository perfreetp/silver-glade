// 验证序列帧导出:拦截 blob 检查 ZIP 内容
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const server = spawn('npx', ['vite', 'preview', '--port', '4176', '--strictPort'], {
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

await page.goto('http://127.0.0.1:4176/', { waitUntil: 'networkidle0' });
await delay(5000);

// 拦截 createObjectURL 捕获导出 blob
await page.evaluate(() => {
  window.__blobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { window.__blobs.push(b); return orig(b); };
});

// 点击"导出 48 帧 PNG 序列"
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => x.textContent.includes('导出 48 帧'));
  console.log('export btn found:', !!b);
  b?.click();
});

// 等待导出完成(进度条消失,按钮恢复)
let done = false;
for (let i = 0; i < 90; i++) {
  await delay(2000);
  const state = await page.evaluate(() => ({
    blobs: window.__blobs.length,
    progress: document.querySelector('.sidebar')?.textContent?.match(/\d+\/48/)?.[0] || null,
  }));
  if (i % 5 === 0) console.log('poll', i, JSON.stringify(state));
  if (state.blobs > 0) { done = true; break; }
}
console.log('export done:', done);

if (done) {
  const info = await page.evaluate(async () => {
    const blob = window.__blobs[window.__blobs.length - 1];
    const buf = new Uint8Array(await blob.arrayBuffer());
    const sig = String.fromCharCode(buf[0], buf[1]);
    // 用 JSZip 从页面里无法直接拿,数 PNG 数量:简单搜 "frame_" 出现次数
    const text = new TextDecoder('latin1').decode(buf);
    const count = (text.match(/frame_\d\d\d\.png/g) || []).length;
    return { size: blob.size, type: blob.type, sig, pngEntries: count };
  });
  console.log('ZIP INFO:', JSON.stringify(info));
}

await browser.close();
server.kill();
process.exit(0);
