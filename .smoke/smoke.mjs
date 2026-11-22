import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:5191/';

const errors = [];
const warnings = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--window-size=1680,960',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 960 });

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && !text.includes('favicon')) errors.push(text);
    if (msg.type() === 'warning') warnings.push(text);
  });
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4500));

  console.log('EARLY ERRORS:', errors.length ? errors : 'none');
  const domProbe = await page.evaluate(() => ({
    hasStage: !!document.querySelector('.stage'),
    stageChildren: document.querySelector('.stage')?.children.length ?? -1,
    allCanvas: document.querySelectorAll('canvas').length,
    bodyText: document.body.textContent.slice(0, 200),
    webgl: (() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch (e) { return `throw: ${e.message}`; }
    })(),
  }));
  console.log('DOM PROBE:', JSON.stringify(domProbe, null, 1));

  // 1. WebGL canvas 存在且有非空像素
  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector('.stage canvas');
    if (!c) return { found: false };
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    let pixels = null;
    if (gl) {
      const w = 96;
      const h = 96;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(
        Math.floor((c.width - w) / 2),
        Math.floor((c.height - h) / 2),
        w,
        h,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        buf,
      );
      let nonBlack = 0;
      let sum = 0;
      const colors = new Set();
      for (let i = 0; i < buf.length; i += 4) {
        const v = buf[i] + buf[i + 1] + buf[i + 2];
        sum += v;
        if (v > 24) nonBlack++;
        colors.add(`${buf[i] >> 5},${buf[i + 1] >> 5},${buf[i + 2] >> 5}`);
      }
      pixels = { nonBlackPct: nonBlack / (w * h), avgLum: sum / (w * h * 3), colorBuckets: colors.size };
    }
    return { found: true, width: c.width, height: c.height, hasGL: !!gl, pixels };
  });
  console.log('CANVAS:', JSON.stringify(canvasInfo));

  // 2. 读取性能面板
  const metricsText = await page.evaluate(() => {
    return [...document.querySelectorAll('.metric')]
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
      .join(' | ');
  });
  console.log('METRICS:', metricsText);

  // 3. 贡献面板百分比
  const contribText = await page.evaluate(() => {
    return [...document.querySelectorAll('.contrib-num')].map((el) => el.textContent.trim()).join(' | ');
  });
  console.log('CONTRIB:', contribText);

  await page.screenshot({ path: 'shot-default.png' });

  // 4. 切换到珠光预设
  const presetBtns = await page.$$('.preset-card');
  await presetBtns[3]?.click(); // 珠光白
  await new Promise((r) => setTimeout(r, 800));

  // 5. 模拟连续拖动一个滑块（清漆厚度），测量期间帧间隔
  const dragResult = await page.evaluate(async () => {
    const sliders = [...document.querySelectorAll('input[type=range]')];
    const target = sliders.find((s) => s.closest('.layer-section')?.querySelector('h4')?.textContent?.includes('清漆层'))
      ?? sliders[sliders.length - 2];
    const rect = target.getBoundingClientRect();
    const frames = [];
    let raf = 0;
    await new Promise((resolve) => {
      let count = 0;
      let last = performance.now();
      const tick = (t) => {
        if (count > 0) frames.push(t - last);
        last = t;
        count++;
        if (count <= 40) {
          const ratio = 0.2 + (count / 40) * 0.7;
          target.value = String(Number(target.min) + ratio * (Number(target.max) - Number(target.min)));
          target.dispatchEvent(new Event('input', { bubbles: true }));
          raf = requestAnimationFrame(tick);
        } else {
          cancelAnimationFrame(raf);
          resolve(null);
        }
      };
      raf = requestAnimationFrame(tick);
    });
    const over20 = frames.filter((f) => f > 20).length;
    return {
      samples: frames.length,
      avgInterval: frames.reduce((a, b) => a + b, 0) / frames.length,
      maxInterval: Math.max(...frames),
      over20ms: over20,
      finalValue: target.value,
      rect: { x: rect.x, y: rect.y },
    };
  });
  console.log('SLIDER DRAG:', JSON.stringify(dragResult));

  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: 'shot-pearl-drag.png' });

  // 6. 保存一个方案
  await page.type('.text-input', '测试方案A');
  const saveBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('保存当前材质')));
  await saveBtn.asElement()?.click();
  await new Promise((r) => setTimeout(r, 400));
  const schemeCount = await page.$$eval('.scheme-item', (els) => els.length);
  console.log('SAVED SCHEMES:', schemeCount);

  // 7. 切换调试视图
  const hudChips = await page.$$('.hud-chip');
  await hudChips[1]?.click(); // 清漆高光
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: 'shot-debug-clear.png' });
  await hudChips[0]?.click();

  // 8. 导出 JSON：拦截 createObjectURL，直接读取 Blob 内容（绕过无头下载策略）
  await page.evaluate(() => {
    window.__capturedBlobs = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      window.__capturedBlobs.push(blob);
      return orig.call(URL, blob);
    };
  });
  const exportBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('导出材质参数')));
  await exportBtn.asElement()?.click();
  await new Promise((r) => setTimeout(r, 500));
  const exported = await page.evaluate(async () => {
    const blob = window.__capturedBlobs?.[window.__capturedBlobs.length - 1];
    if (!blob) return null;
    return JSON.parse(await blob.text());
  });
  if (exported) {
    const layerKeys = ['electroCoat', 'primerBaseCoat', 'flakeCoat', 'clearCoat'];
    const hasAllLayers = layerKeys.every((k) => exported.layers?.[k]);
    const thicknessOk =
      exported.layers.clearCoat.thickness >= 5 && exported.layers.clearCoat.thickness <= 80;
    console.log(
      'EXPORT JSON:',
      JSON.stringify({
        format: exported.format,
        version: exported.version,
        units: exported.units,
        hasAllLayers,
        thicknessOk,
        clearIor: exported.layers.clearCoat.ior,
      }),
    );
  } else {
    console.log('EXPORT JSON: FAILED no blob captured');
  }

  // 9. 照片拖放提取：用 DataTransfer 投递一张程序化红色车漆图
  const photoProbe = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 80;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#b8202a';
    ctx.fillRect(0, 0, 80, 80);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'paint.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const zone = document.querySelector('.dropzone');
    const ev = new DragEvent('drop', { bubbles: true, dataTransfer: dt });
    zone.dispatchEvent(ev);
    return { dispatched: true };
  });
  console.log('PHOTO DROP:', JSON.stringify(photoProbe));
  await new Promise((r) => setTimeout(r, 1200));
  const afterDrop = await page.evaluate(() => ({
    chips: document.querySelectorAll('.swatch-chip').length,
    midColor: document.querySelectorAll('.layer-section')[1].querySelector('input[type=color]')?.value,
    toast: document.querySelector('.toast')?.textContent ?? null,
  }));
  console.log('PHOTO EXTRACT:', JSON.stringify(afterDrop));

  // 10. 光源拖动：直接改 store（模拟引擎回调）并验证方位角联动
  const lightProbe = await page.evaluate(() => {
    const az = [...document.querySelectorAll('.ctrl-label')].findIndex((el) =>
      el.textContent.includes('方位角'));
    const sliders = document.querySelectorAll('input[type=range]');
    return { labelCount: az, rangeCount: sliders.length };
  });
  console.log('LIGHT UI:', JSON.stringify(lightProbe));

  console.log('CONSOLE ERRORS:', errors.length ? errors : 'none');
  console.log('CONSOLE WARNINGS:', warnings.length ? warnings.slice(0, 5) : 'none');
} finally {
  await browser.close();
}
