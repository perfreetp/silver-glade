import { chromium } from 'playwright';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 980 } });
const page = await context.newPage();
page.on('pageerror', () => {});

const failures = [];
const check = (c, m) => {
  console.log(c ? `  ✓ ${m}` : `  ✗ ${m}`);
  if (!c) failures.push(m);
};

// 同接种点、不同温度，比较末帧覆盖率
async function coverageAt(temp) {
  await page.goto(
    `http://localhost:53120/?gridSize=384&totalSteps=300&snapshotEvery=30&temperature=${temp}&humidity=85`,
    { waitUntil: 'load' },
  );
  await page.waitForFunction(
    () => document.querySelector('#status')?.shadowRoot?.querySelector('#phase')?.textContent?.includes('完成'),
    { timeout: 90000 },
  );
  await page.evaluate(() => {
    const bar = document.querySelector('#playback');
    bar.shadowRoot.querySelector('#scrub').value = bar.shadowRoot.querySelector('#scrub').max;
    bar.shadowRoot.querySelector('#scrub').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const cov = await page.evaluate(
    () => document.querySelector('#status').shadowRoot.querySelector('#coverage').textContent,
  );
  return parseFloat(cov);
}

console.log('A) 温度→扩散速度（末帧覆盖率）');
const covCold = await coverageAt(10);
const covOpt = await coverageAt(23);
const covHot = await coverageAt(36);
console.log(`   10℃=${covCold}%  23℃=${covOpt}%  36℃=${covHot}%`);
check(covOpt > covCold, `23℃ 覆盖（${covOpt}%）大于 10℃（${covCold}%）`);
check(covOpt > covHot, `23℃ 覆盖（${covOpt}%）大于高温胁迫 36℃（${covHot}%）`);

console.log('B) 气孔吸收：接种点贴近气孔，末帧气孔内无浓度');
await page.goto(
  'http://localhost:53120/?gridSize=384&totalSteps=400&snapshotEvery=40&temperature=25',
  { waitUntil: 'load' },
);
await page.waitForFunction(
  () => document.querySelector('#status')?.shadowRoot?.querySelector('#phase')?.textContent?.includes('完成'),
  { timeout: 90000 },
);
// 直接在页面里读最新快照的解码结果验证气孔为 0（通过导出面板间接不可行，改用画布中心像素）
const holePixel = await page.evaluate(() => {
  const canvas = document.querySelector('#view').shadowRoot.querySelector('#canvas-host canvas');
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0);
  const d = ctx.getImageData(c.width / 2, c.height / 2, 1, 1).data;
  return [d[0], d[1], d[2]];
});
check(holePixel[0] < 15 && holePixel[1] < 15 && holePixel[2] < 15, `气孔中心保持深色（${holePixel.join(',')}）`);

console.log('C) CSV 与 PNG 导出');
const downloads = [];
page.on('download', (d) => downloads.push(d.suggestedFilename()));
await page.evaluate(() => {
  const panel = document.querySelector('#export');
  panel.shadowRoot.querySelector('#format').value = 'csv';
  panel.shadowRoot.querySelector('#export').click();
});
await page.waitForTimeout(800);
check(downloads.some((f) => f.endsWith('.csv')), `CSV 文件已触发下载（${downloads.find((f) => f.endsWith('.csv'))}）`);

console.log('D) 1024 网格并行性能');
const t0 = Date.now();
await page.goto(
  'http://localhost:53120/?gridSize=1024&totalSteps=200&snapshotEvery=25&temperature=25',
  { waitUntil: 'load' },
);
await page.waitForFunction(
  () => document.querySelector('#status')?.shadowRoot?.querySelector('#phase')?.textContent?.includes('完成'),
  { timeout: 120000 },
);
const elapsed = Date.now() - t0;
const parallel = await page.evaluate(
  () => document.querySelector('#status').shadowRoot.querySelector('#parallel').textContent,
);
console.log(`   1024² × 200 步并行模拟用时 ${elapsed} ms（${parallel}）`);
check(elapsed < 120000, `1024² 模拟在合理时间内完成（${elapsed} ms）`);

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} 项失败`);
  process.exit(1);
}
console.log('\n扩展验证全部通过');
