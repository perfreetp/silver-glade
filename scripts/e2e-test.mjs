// 用真实 Chrome + WebGPU 测试已构建的 dist 页面
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:4173/';

// 启动 vite preview(静态服务 dist)
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'pipe',
  shell: true,
});
await delay(2500);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--window-size=1400,900',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[PAGEERROR] ${err.message}`));
page.on('requestfailed', (req) => logs.push(`[REQFAIL] ${req.url()} ${req.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });

// 等待引擎初始化与首帧计算
await delay(6000);

// 检查 WebGPU 与引擎状态
const status = await page.evaluate(() => {
  return {
    webgpu: !!navigator.gpu,
    fatal: document.querySelector('.overlay-error')?.textContent || null,
    computing: !!document.querySelector('.computing'),
  };
});
console.log('STATUS:', JSON.stringify(status, null, 2));

// 截图:初始帧
await page.screenshot({ path: 'test-shot-initial.png' });

// 拖到时间轴中间帧
await page.evaluate(() => {
  const slider = document.querySelector('.timeline input[type=range]');
  if (slider) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(slider, '24');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await delay(4000);
await page.screenshot({ path: 'test-shot-frame24.png' });

// 切到高步进档位再截一张
await page.evaluate(() => {
  const selects = document.querySelectorAll('.sidebar select');
  // 第二个 select 是步进档位(第一个是分辨率)
  const sel = selects[1];
  if (sel) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, '256');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await delay(3000);
await page.screenshot({ path: 'test-shot-steps256.png' });

// 测试对比视图
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const compareBtn = btns.find((b) => b.textContent.includes('对比视图'));
  if (compareBtn) compareBtn.click();
});
await delay(4000);
await page.screenshot({ path: 'test-shot-compare.png' });

console.log('--- CONSOLE LOGS ---');
for (const l of logs.slice(0, 60)) console.log(l);

await browser.close();
server.kill();
console.log('TEST DONE');
