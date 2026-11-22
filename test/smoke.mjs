/**
 * 浏览器端冒烟测试（Playwright）。
 * 前置：vite dev server 已在 5180 端口运行并带 COOP/COEP 头。
 * 运行：node test/smoke.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:5180';
const QUERY = '?gridSize=384&totalSteps=120&snapshotEvery=10&temperature=26&humidity=90';

const failures = [];
const logs = [];

function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures.push(msg);
    console.error(`  ✗ ${msg}`);
  }
}

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 980 } });
const page = await context.newPage();
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => {
  // 无头 Chromium 的 WebGPU 实现有缺陷时会触发自动回退；
  // 回退过程中的预期报错不算失败，真正的失败看功能断言。
  if (/WebGPU|GPUDevice|createBuffer|popErrorScope|unregisterToken/.test(e.message)) {
    logs.push(`[webgpu-fallback] ${e.message}`);
    return;
  }
  failures.push(`页面异常: ${e.message}`);
  console.error(`  ✗ 页面异常: ${e.message}`);
});

console.log('1) 跨源隔离与页面加载');
await page.goto(BASE + QUERY, { waitUntil: 'domcontentloaded' });
const isolated = await page.evaluate(() => self.crossOriginIsolated);
check(isolated === true, '页面处于跨源隔离状态（SharedArrayBuffer 可用）');

console.log('2) 等待模拟完成');
await page.waitForFunction(
  () => document.querySelector('#status')?.shadowRoot?.querySelector('#phase')?.textContent?.includes('完成'),
  { timeout: 90000 },
);
const backend = await page.evaluate(
  () => document.querySelector('#status').shadowRoot.querySelector('#backend').textContent,
);
const parallel = await page.evaluate(
  () => document.querySelector('#status').shadowRoot.querySelector('#parallel').textContent,
);
console.log(`     后端：${backend} / 并行：${parallel}`);
check(/WebGPU|WebGL/.test(backend), '渲染器已初始化（WebGPU 或 WebGL 回退）');
check(/worker/.test(parallel), '扩散模拟运行在多 worker 并行模式');

console.log('3) 快照帧数与回放滑杆');
const frameMax = await page.evaluate(
  () => document.querySelector('#playback').shadowRoot.querySelector('#frame-max').textContent,
);
check(parseInt(frameMax, 10) >= 11, `生成多帧快照（帧号上限=${frameMax}，预期 ≥11）`);

// 跳到末帧
await page.evaluate(() => {
  const bar = document.querySelector('#playback');
  const max = parseInt(bar.shadowRoot.querySelector('#scrub').max, 10);
  bar.shadowRoot.querySelector('#scrub').value = String(max);
  bar.shadowRoot.querySelector('#scrub').dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
const timeLabel = await page.evaluate(
  () => document.querySelector('#playback').shadowRoot.querySelector('#time-label').textContent,
);
check(/h|d/.test(timeLabel), `末帧时间标签正常：${timeLabel}`);
const coverage = await page.evaluate(
  () => document.querySelector('#status').shadowRoot.querySelector('#coverage').textContent,
);
check(parseFloat(coverage) > 0, `末帧菌丝覆盖率非零：${coverage}`);

console.log('4) 画布实际像素（半透明层已绘制）');
const pixelStats = await page.evaluate(() => {
  const canvas = document.querySelector('#view').shadowRoot.querySelector('#canvas-host canvas');
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let bright = 0;
  let maxLum = 0;
  const colors = new Set();
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (lum > maxLum) maxLum = lum;
    // 菌丝层为高亮暖白
    if (data[i] > 120 && data[i + 1] > 110 && data[i + 2] > 90) bright++;
    colors.add(`${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`);
  }
  return { bright, maxLum, distinctColors: colors.size };
});
check(pixelStats.maxLum > 150, `画布存在高亮菌丝像素（最大亮度 ${pixelStats.maxLum.toFixed(1)}）`);
check(pixelStats.bright > 50, `亮色菌丝像素数量充足（${pixelStats.bright} 个）`);
check(pixelStats.distinctColors > 3, `画面含多个色阶（${pixelStats.distinctColors} 种）`);

console.log('5) 接种点新增触发整段重算');
const listBefore = await page.evaluate(
  () => document.querySelector('#inoculation').shadowRoot.querySelectorAll('li').length,
);
const box = await page.evaluate(() => {
  const canvas = document.querySelector('#view').shadowRoot.querySelector('#canvas-host canvas');
  const r = canvas.getBoundingClientRect();
  // 接种点落在圆心右下方环内基质（约 0.55 半径处）
  return { x: r.left + r.width * 0.62, y: r.top + r.height * 0.56 };
});
await page.mouse.click(box.x, box.y);
await page.waitForFunction(
  () => document.querySelector('#status')?.shadowRoot?.querySelector('#phase')?.textContent?.includes('完成'),
  { timeout: 90000 },
);
const listAfter = await page.evaluate(
  () => document.querySelector('#inoculation').shadowRoot.querySelectorAll('li').length,
);
check(listAfter === listBefore + 1, `接种点 ${listBefore} → ${listAfter}，并自动重算整段蔓延`);

console.log('6) 接种点删除并重算');
await page.evaluate(() => {
  const items = document.querySelector('#inoculation').shadowRoot.querySelectorAll('li');
  items[items.length - 1].querySelector('button').click();
});
await page.waitForFunction(
  () => document.querySelector('#status')?.shadowRoot?.querySelector('#phase')?.textContent?.includes('完成'),
  { timeout: 90000 },
);
const listDeleted = await page.evaluate(
  () => document.querySelector('#inoculation').shadowRoot.querySelectorAll('li').length,
);
check(listDeleted === listBefore, '删除接种点后列表恢复且重算完成');

console.log('7) JSON 导出文件下载');
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.evaluate(() => {
    const panel = document.querySelector('#export');
    panel.shadowRoot.querySelector('#export').click();
  }),
]);
const dlPath = await download.path();
const fs = await import('node:fs');
const content = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
check(content.format === 'mycelium-spread/1', '导出 JSON 格式标识正确');
check(Array.isArray(content.frames) && content.frames.length > 10, `导出含 ${content.frames?.length} 帧记录`);
check(!!content.frames[0].bytesBase64, '帧数据为 base64 RLE 浓度分布');

console.log('8) 无严重控制台错误（WebGPU 回退告警除外）');
const severe = logs.filter(
  (l) => l.startsWith('[error]') && !l.includes('favicon') && !l.startsWith('[webgpu-fallback]'),
);
check(severe.length === 0, severe.length ? `错误日志：${severe.slice(0, 3).join(' | ')}` : '控制台无 error 级日志');

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} 项冒烟测试失败`);
  process.exit(1);
}
console.log('\n全部浏览器冒烟测试通过');
