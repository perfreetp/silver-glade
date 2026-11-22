import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 960 });
await page.goto('http://127.0.0.1:5191/', { waitUntil: 'load' });
await new Promise(r=>setTimeout(r,2500));
// 珠光白
const btns = await page.$$('.preset-card'); await btns[3].click();
await new Promise(r=>setTimeout(r,800));
const chips = await page.$$('.hud-chip');
// 鳞片法线
await chips[3].click(); await new Promise(r=>setTimeout(r,500));
await page.screenshot({path:'probe-normal.png'});
// 四层分解
await chips[4].click(); await new Promise(r=>setTimeout(r,500));
await page.screenshot({path:'probe-layers.png'});
await browser.close();
console.log('probes done');
