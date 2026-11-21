// CDP 冒烟驱动：仅用 Node 26 内置 fetch / WebSocket，无第三方依赖。
// 启动带 SwiftShader 的 headless Chrome，打开冒烟页，读取 title 中的断言摘要并截图。
const { spawn } = await import('node:child_process');
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const TARGET = process.argv[2];
const SHOT = process.argv[3];

const profile = `C:/Users/Administrator/AppData/Local/Temp/cdp-${process.pid}`;
const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  `--user-data-dir=${profile}`,
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1280,800',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      await sleep(200);
    }
  }
  throw new Error('CDP page target not available');
}

const ws = new WebSocket(await getPageWsUrl());
await new Promise((r, rej) => {
  ws.onopen = r;
  ws.onerror = rej;
});

let nextId = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    logs.push('EXCEPTION: ' + (d.exception?.description ?? d.text));
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: TARGET });

// 轮询 title，直到出现 SMOKE_ 前缀（最多 20s）
let title = '';
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  title = r.result.value;
  if (title.startsWith('SMOKE_')) break;
}

// 拉近相机再截图（直接驱动冒烟页暴露的钩子）
await send('Runtime.evaluate', {
  expression: `window.__zoomIn ? window.__zoomIn() : 'no-hook'`,
  returnByValue: true,
});
await sleep(600);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));

// 俯视视角第二张（参数 _top 后缀）
if (SHOT.includes('_top')) {
  await send('Runtime.evaluate', { expression: `window.__topView()`, returnByValue: true });
  await sleep(1200);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(shot2.data, 'base64'));
}

console.log(JSON.stringify({ title, consoleLogs: logs }, null, 2));
ws.close();
chrome.kill();
process.exit(title.startsWith('SMOKE_PASS') ? 0 : 1);
