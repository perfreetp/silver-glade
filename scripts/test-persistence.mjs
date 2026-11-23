// 持久化 + 项目导入导出测试
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const server = spawn('npx', ['vite', 'preview', '--port', '4178', '--strictPort'], {
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

await page.goto('http://127.0.0.1:4178/', { waitUntil: 'networkidle0' });
await delay(5000);

// 1. 修改参数(种子 -> 42, 壳体密度 -> 5),等自动保存
await page.evaluate(() => {
  const setRange = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const ranges = document.querySelectorAll('.sidebar input[type=range]');
  setRange(ranges[0], 42); // 随机种子
});
await delay(2000);
const saved1 = await page.evaluate(() => window.__engine.settings.noise.seed);
console.log('seed after change:', saved1);

// 2. 刷新页面,验证从 IndexedDB 恢复
await page.reload({ waitUntil: 'networkidle0' });
await delay(5000);
const restored = await page.evaluate(() => ({
  seed: window.__engine.settings.noise.seed,
  reactSeed: document.querySelector('.sidebar')?.textContent?.includes('42'),
}));
console.log('PERSISTENCE TEST:', JSON.stringify(restored), restored.seed === 42 ? 'OK' : 'FAIL');

// 3. 导出项目文件(拦截 blob)
await page.evaluate(() => {
  window.__blobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { window.__blobs.push(b); return orig(b); };
  // 展开"项目"折叠面板并点击导出
  const titles = [...document.querySelectorAll('.section-title')];
  titles.find((t) => t.textContent.includes('项目'))?.click();
});
await delay(500);
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  btns.find((b) => b.textContent.includes('导出项目文件'))?.click();
});
await delay(1000);
const projInfo = await page.evaluate(async () => {
  if (!window.__blobs.length) return null;
  const text = await window.__blobs[0].text();
  const obj = JSON.parse(text);
  return { seed: obj.settings?.noise?.seed, version: obj.version, strokes: obj.strokes?.length };
});
console.log('EXPORT PROJECT TEST:', JSON.stringify(projInfo), projInfo?.seed === 42 ? 'OK' : 'FAIL');

// 4. 导入项目:构造修改后的 JSON 通过文件输入上传
const importProj = {
  version: 1,
  settings: {
    resolution: 64, frame: 5,
    noise: { seed: 99, shellRadius: 0.2, expansion: 0.5, shellThickness: 0.12, shellDensity: 2.5, coreDensity: 2, coreFade: 2, turbScale: 3, turbStrength: 1, turbFlow: 0.5 },
    brush: { mode: 'add', radius: 0.1, strength: 0.5, depth: 0.5 },
    render: { steps: 64, extinction: 3, albedo: 0.9, exposure: 1.2, bgColor: '#101018' },
    light: { azimuth: 10, elevation: 60, color: '#ffffff', intensity: 4, ambientColor: '#334455', ambientIntensity: 0.8, aoStrength: 1, phaseG: 0.2, lightSteps: 10 },
  },
  strokes: [{ splats: [[0.5, 0.5, 0.5, 0.2, 1.5]] }],
};
fs.writeFileSync('test-import.json', JSON.stringify(importProj));
const input = await page.$('input[type=file]');
await input.uploadFile('test-import.json');
await delay(4000);
const afterImport = await page.evaluate(() => ({
  seed: window.__engine.settings.noise.seed,
  res: window.__engine.settings.resolution,
  steps: window.__engine.settings.render.steps,
  strokes: window.__engine.liveView.strokes.length,
  frame: window.__engine.settings.frame,
}));
console.log('IMPORT PROJECT TEST:', JSON.stringify(afterImport),
  afterImport.seed === 99 && afterImport.res === 64 && afterImport.strokes === 1 ? 'OK' : 'FAIL');
await page.screenshot({ path: 'test-shot-imported.png' });

await browser.close();
server.kill();
process.exit(0);
