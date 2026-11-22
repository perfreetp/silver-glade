import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 960 });
await page.goto('http://127.0.0.1:5191/', { waitUntil: 'load' });
await new Promise(r=>setTimeout(r,3000));

// 找球面上最亮像素的屏幕坐标（在视口中心区域内）
async function brightestSpot() {
  return page.evaluate(() => {
    const c = document.querySelector('.stage canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const w = c.width, h = c.height;
    const buf = new Uint8Array(w*h*4);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    let best = {v:-1, x:0, y:0};
    // 只扫描球体所在的中心上半区域
    for (let y=Math.floor(h*0.25); y<h*0.6; y+=4) {
      for (let x=Math.floor(w*0.35); x<w*0.65; x+=4) {
        const i = ((h-1-y)*w + x)*4;
        const v = buf[i]+buf[i+1]+buf[i+2];
        if (v > best.v) best = {v, x, y};
      }
    }
    return best;
  });
}
const p1 = await brightestSpot();
// 通过滑块把方位角从 42 拉到 200
await page.evaluate(() => {
  const sliders = [...document.querySelectorAll('input[type=range]')];
  const az = sliders[0];
  az.value = '200';
  az.dispatchEvent(new Event('input', {bubbles:true}));
});
await new Promise(r=>setTimeout(r,900));
const p2 = await brightestSpot();
console.log('brightest @az42:', JSON.stringify(p1));
console.log('brightest @az200:', JSON.stringify(p2));
const moved = Math.hypot(p2.x-p1.x, p2.y-p1.y);
console.log('highlight displacement px:', moved.toFixed(1), '-> moved:', moved > 25);
await browser.close();
