import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 960 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:5191/', { waitUntil: 'load' });
await new Promise(r=>setTimeout(r,2500));

// 找到光源标记球的屏幕位置
const marker = await page.evaluate(() => {
  // 通过遍历 three 场景不可行，改从渲染像素找亮色球；这里先返回 HUD 光源滑块初始值
  const labels = [...document.querySelectorAll('.ctrl-label')].map(e=>e.textContent);
  return { labels };
});
console.log('labels ok:', marker.labels.includes('方位角'));

// 记录拖动前角度（从滑块读）
const before = await page.evaluate(() => {
  const az = [...document.querySelectorAll('.ctrl-value')].map(e=>e.textContent);
  return az.slice(0,2);
});
console.log('before:', JSON.stringify(before));

// 光源球在画面上方约 (840,130)，模拟按下并弧形拖动
const start = { x: 840, y: 130 };
await page.mouse.move(start.x, start.y);
await page.mouse.down();
for (let i=1;i<=10;i++){
  await page.mouse.move(start.x + i*22, start.y + i*8, { steps: 2 });
  await new Promise(r=>setTimeout(r,30));
}
await page.mouse.up();
await new Promise(r=>setTimeout(r,400));

const after = await page.evaluate(() => [...document.querySelectorAll('.ctrl-value')].slice(0,2).map(e=>e.textContent));
console.log('after:', JSON.stringify(after));
console.log('changed:', JSON.stringify(before) !== JSON.stringify(after));
console.log('pageerrors:', errs.length ? errs : 'none');
await browser.close();
