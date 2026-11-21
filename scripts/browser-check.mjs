// 无头浏览器运行时检查：WebGL 渲染、间隙检测 DOM、参数交互更新
// 通过 Chrome DevTools Protocol 驱动，无需第三方依赖（Node 26 内置 WebSocket/fetch）
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const URL = process.argv[2] ?? 'http://127.0.0.1:5192/';
const PORT = 9334;

const profile = await mkdtemp(path.join(tmpdir(), 'wheel-cdp-'));
const chrome = spawn(
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [
    '--headless=new',
    '--disable-gpu',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* 重试 */ }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

const ws = new WebSocket(await getWsUrl());
await new Promise((r) => (ws.onopen = r));

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL });
await sleep(4500); // 等待 Solid 挂载 + 首帧渲染 + 间隙重算

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name} ${extra}`);
  if (!cond) failures++;
};

// 1. WebGL 画布存在且尺寸正常
const canvasInfo = await evalJs(`(() => {
  const c = document.querySelector('.viewport canvas');
  if (!c) return null;
  return { w: c.width, h: c.height };
})()`);
check('视口 WebGL canvas 已创建', Boolean(canvasInfo && canvasInfo.w > 0), JSON.stringify(canvasInfo));

// 2. 画布实际有绘制内容（非全黑背景之外存在车身/车轮像素）
const pixelSample = await evalJs(`(() => {
  const c = document.querySelector('.viewport canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const w = c.width, h = c.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let nonBg = 0;
  for (let i = 0; i < px.length; i += 4) {
    // 背景色约为 (15,20,27)，统计明显不同的像素
    if (Math.abs(px[i]-15) + Math.abs(px[i+1]-20) + Math.abs(px[i+2]-27) > 60) nonBg++;
  }
  return { total: w * h, nonBg };
})()`);
check('画布有场景像素输出', pixelSample.nonBg > 5000, `${pixelSample.nonBg}/${pixelSample.total} 非背景像素`);

// 3. 底部四张间隙卡片均有数值
const cards = await evalJs(`[...document.querySelectorAll('.clearance-card')].map(c => ({
  title: c.querySelector('.cc-title').textContent.trim(),
  value: c.querySelector('.cc-value').textContent.trim(),
  status: c.className.includes('s-ok') ? 'ok' : c.className.includes('s-warn') ? 'warn' : 'collision',
}))`);
check('四轮间隙卡片齐全', cards.length === 4, JSON.stringify(cards.map((c) => c.value)));
check('间隙数值为毫米格式且大于 0', cards.every((c) => /mm/.test(c.value) && parseFloat(c.value) > 0));

// 4. 拖动偏距滑杆 → 数值同步更新（滑杆作用于当前选中轮位，读取对应卡片）
const activeIndex = await evalJs(`[...document.querySelectorAll('.wheel-chip')].findIndex(c => c.className.includes('active'))`);
const before = await evalJs(`document.querySelectorAll('.clearance-card')[${activeIndex}].querySelector('.cc-value').textContent`);
await evalJs(`(() => {
  const sliders = [...document.querySelectorAll('.param-panel input[type=range]')];
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  // 轮辋直径推到最大（改变径向最小间隙），偏距推到最大（触发越界）
  setter.call(sliders[2], sliders[2].max);
  sliders[2].dispatchEvent(new Event('input', { bubbles: true }));
  setter.call(sliders[3], sliders[3].max);
  sliders[3].dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(400);
const after = await evalJs(`(() => {
  const idx = [...document.querySelectorAll('.wheel-chip')].findIndex(c => c.className.includes('active'));
  const card = document.querySelectorAll('.clearance-card')[idx];
  return {
    rimSlider: document.querySelectorAll('.param-panel input[type=range]')[2].value,
    offsetSlider: document.querySelectorAll('.param-panel input[type=range]')[3].value,
    warnVisible: !document.querySelector('.boundary-warn').hidden,
    card: card.querySelector('.cc-value').textContent,
    cardClass: card.className,
  };
})()`);
check('滑杆联动到极值', after.rimSlider === '0.44' && after.offsetSlider === '0.12',
  `rim=${after.rimSlider} offset=${after.offsetSlider}`);
check('越界警示条出现', after.warnVisible === true);
check('对应轮位状态转为 collision', after.cardClass.includes('s-collision'), after.cardClass);
check('间隙检测随参数重算（大轮辋间隙缩小）', after.card !== before && parseFloat(after.card) < parseFloat(before),
  `${before} -> ${after.card}`);

// 5. 款式切换
await evalJs(`[...document.querySelectorAll('.style-card')][5].click()`);
await sleep(300);
const styleActive = await evalJs(`document.querySelector('.style-card.active b').textContent`);
check('款式列表点击替换生效', styleActive.includes('涡轮'), styleActive);

// 6. 轮位切换同步参数面板标题
await evalJs(`[...document.querySelectorAll('.wheel-chip')][2].click()`);
await sleep(150);
const panelSub = await evalJs(`document.querySelector('.param-panel .panel-sub').textContent`);
check('切换轮位后参数面板同步', panelSub.includes('左后'), panelSub);

// 7. 聚焦模式
await evalJs(`[...document.querySelectorAll('.view-switch button')][1].click()`);
await sleep(800);
const overlay = await evalJs(`document.querySelector('.overlay-tag').textContent`);
check('进入单轮聚焦视角', overlay.includes('轮拱截面'), overlay);

check('控制台无错误', consoleErrors.length === 0, consoleErrors.join(' | '));

ws.close();
chrome.kill();
try { await rm(profile, { recursive: true, force: true }); } catch { /* 忽略文件占用 */ }

if (failures) {
  console.error(`\n${failures} 项浏览器检查失败`);
  process.exit(1);
}
console.log('\n全部浏览器运行时检查通过');
process.exit(0);
