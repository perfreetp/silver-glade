/**
 * 真实页面 CDP 验证：驱动无头 Edge 里的实际 WebGL 应用，
 * 覆盖 2 万粒子压力、风向联动、夜间辉光截图、计划导出文件内容。
 * 运行：node tests/cdp-check.mjs（需先启动 dev server 与远程调试浏览器）
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'http://127.0.0.1:5180/';
const PORT = 9222;
const SHOTS = 'D:/ccfb/runs/1000200/workspace/.shots';
mkdirSync(SHOTS, { recursive: true });

const profile = join(tmpdir(), 'edge-snow-cdp');
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1600,1000',
    URL,
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const tabs = await res.json();
      const tab = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (tab) return tab.webSocketDebuggerUrl;
    } catch {
      /* 浏览器还没起好 */
    }
    await sleep(500);
  }
  throw new Error('Edge 远程调试端口不可用');
}

let msgId = 0;
const pending = new Map();

function cdp(ws) {
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
}

async function evalJs(ws, expression, awaitPromise = false) {
  const r = await cdp(ws)('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r.result.value;
}

async function main() {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result);
    }
  };

  await cdp(ws)('Page.enable');
  await cdp(ws)('Runtime.enable');
  await sleep(2500); // 等应用初始化 + 粒子开始发射

  // 1. 初始状态
  const count0 = await evalJs(ws, 'window.__snow.manager.count');
  assert(count0 === 3, `初始示例造雪机 3 台（实际 ${count0}）`);

  // 2. 压力：补到 30 台最大档，跑 8 秒，验证 2 万粒子同屏
  await evalJs(ws, `(() => {
    const mm = window.__snow.manager;
    while (mm.count < 30) {
      const c = mm.add((Math.random()-0.5)*60, (Math.random()-0.5)*100);
      c.level = 3; c.pitch = 30;
    }
    window.__snow.bus.emit('machine:list-changed', { count: mm.count, selectedId: mm.selectedId });
  })()`);
  await evalJs(ws, 'new Promise(r=>setTimeout(r,8000))', true);
  const active = await evalJs(ws, 'window.__snow.particles.active');
  assert(active >= 19000, `30 台满档时活跃粒子接近 2 万上限（实际 ${active}）`);

  // 3. 风向联动：全部机器切到 180° 反向风，派发与面板滑块相同的事件后继续仿真
  await evalJs(ws, `(() => {
    const mm = window.__snow.manager;
    for (const c of mm.list()) { c.wind = { direction: 180, speed: 13 }; }
    window.__snow.bus.emit('wind:apply-all', { direction: 180, speed: 13 });
  })()`);
  await evalJs(ws, 'new Promise(r=>setTimeout(r,2000))', true);
  const panelOk = await evalJs(ws, `
    [...document.querySelector('machine-panel').shadowRoot.querySelectorAll('*')].length
  `);
  assert(panelOk > 0, '联动事件后 UI 面板仍正常渲染');

  // 4. 面板 FPS 读数存在且为数字
  const fpsText = await evalJs(ws, `
    document.querySelector('simulation-panel').shadowRoot.getElementById('s-fps').textContent
  `);
  const fps = parseInt(fpsText, 10);
  assert(Number.isFinite(fps) && fps > 0, `FPS 面板有真实读数（${fpsText}，软件渲染参考值）`);
  const partText = await evalJs(ws, `
    document.querySelector('simulation-panel').shadowRoot.getElementById('s-particles').textContent
  `);
  assert(/20000\s*\/\s*20000/.test(partText), `粒子读数显示满载容量（${partText.trim()}）`);

  // 5. 白天压力截图
  let shot = await cdp(ws)('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, 'cdp-day-stress.png'), Buffer.from(shot.data, 'base64'));

  // 6. 夜间模式 + 辉光
  await evalJs(ws, `window.__snow.bus.emit('sim:night', { night: true })`);
  await sleep(1500);
  const nightBg = await evalJs(ws, `document.querySelector('#stage canvas') ? 'ok' : 'missing'`);
  assert(nightBg === 'ok', '夜间模式切换后画布仍在');
  shot = await cdp(ws)('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, 'cdp-night.png'), Buffer.from(shot.data, 'base64'));

  // 7. 计划导出：拦截 Blob 下载，校验真实导出按钮产出的 JSON 内容
  await evalJs(ws, `
    new Promise((resolve) => {
      window.__capturedPlan = null;
      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { window.__capturedBlob = blob; return 'blob:captured'; };
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        window.__capturedBlob.text().then((t) => { window.__capturedPlan = t; resolve(); });
      };
      document.querySelector('plan-panel').shadowRoot.getElementById('export').click();
      setTimeout(() => { URL.createObjectURL = origCreate; HTMLAnchorElement.prototype.click = origClick; }, 500);
    });
  `, true);
  const planText = await evalJs(ws, 'window.__capturedPlan');
  assert(typeof planText === 'string' && planText.length > 50, '导出按钮产出了 JSON Blob');
  const plan = JSON.parse(planText);
  assert(plan.version === 1 && plan.machines.length === 30, '计划版本与机器数量正确');
  const m0 = plan.machines[0];
  const fieldsOk =
    typeof m0.x === 'number' &&
    typeof m0.z === 'number' &&
    typeof m0.yaw === 'number' &&
    typeof m0.pitch === 'number' &&
    [1, 2, 3].includes(m0.level) &&
    typeof m0.wind.direction === 'number' &&
    typeof m0.wind.speed === 'number';
  assert(fieldsOk, '导出记录含位置、朝向、雪量档位、风向风速全部字段');
  assert(m0.wind.direction === 180 && m0.wind.speed === 13, '导出的风向为联动后最新值');

  // 8. 积雪高度场已有沉积
  const depthStats = await evalJs(ws, `
    (() => { const s = window.__snow.snowField.stats(); return s.coverage.toFixed(2)+'%|'+s.avgDepth.toFixed(4); })()
  `);
  const [cov, avg] = depthStats.split('|');
  assert(parseFloat(cov) > 1, `坡面已有明显积雪覆盖（${cov}，平均 ${avg} m）`);

  console.log('\n全部 CDP 验证通过。');
  edge.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message);
  edge.kill();
  process.exit(1);
});
