import { chromium } from 'playwright';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on('pageerror', () => {});
await page.goto(
  'http://localhost:53120/?gridSize=512&totalSteps=400&snapshotEvery=20&temperature=25&humidity=90',
  { waitUntil: 'load' },
);
await page.waitForFunction(
  () => document.querySelector('#status')?.shadowRoot?.querySelector('#phase')?.textContent?.includes('完成'),
  { timeout: 90000 },
);
// 跳到中段帧观察蔓延
await page.evaluate(() => {
  const bar = document.querySelector('#playback');
  const max = parseInt(bar.shadowRoot.querySelector('#scrub').max, 10);
  bar.shadowRoot.querySelector('#scrub').value = String(Math.floor(max * 0.6));
  bar.shadowRoot.querySelector('#scrub').dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(1000);
await page.screenshot({ path: 'test/screenshot-mid.png' });
// 末帧
await page.evaluate(() => {
  const bar = document.querySelector('#playback');
  bar.shadowRoot.querySelector('#scrub').value = bar.shadowRoot.querySelector('#scrub').max;
  bar.shadowRoot.querySelector('#scrub').dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(1000);
await page.screenshot({ path: 'test/screenshot-end.png' });
console.log('screenshots saved');
await browser.close();
