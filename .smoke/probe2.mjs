import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 960 });
await page.goto('http://127.0.0.1:5191/', { waitUntil: 'load' });
await new Promise(r=>setTimeout(r,2500));
const btns = await page.$$('.preset-card'); await btns[3].click();
await new Promise(r=>setTimeout(r,900));
await page.screenshot({path:'probe-composite-pearl.png'});
// 哑光黑
await btns[8].click(); await new Promise(r=>setTimeout(r,700));
await page.screenshot({path:'probe-composite-matte.png'});
// 变色龙
await btns[5].click(); await new Promise(r=>setTimeout(r,700));
await page.screenshot({path:'probe-composite-chameleon.png'});
await browser.close();
console.log('composite probes done');
