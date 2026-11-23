// CDP 交互测试:调两次高度角生成多个版本 → 勾选两个版本 → 截图对比面板
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PORT = 49334;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const out = 'D:/ccfb/runs/1000205/workspace/smoke-compare.png';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-proxy-server', '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chromeprof-cdp2',
  '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;
const pending = new Map();
const events = [];
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
async function evaljs(ws, expr) {
  const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true });
  return r?.result?.value;
}

try {
  // 等 CDP 起来
  let wsUrl;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(400);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg.result);
      pending.delete(msg.id);
    } else if (msg.method) events.push(msg);
  };
  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send(ws, 'Page.navigate', { url: 'file:///D:/ccfb/runs/1000205/workspace/dist/index.html' });
  await sleep(6000);

  const setElev = (v) => `
    (() => {
      const s = document.querySelectorAll('input[type=range]')[0];
      s.value = '${v}';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return s.value;
    })()`;

  console.log('set 20°:', await evaljs(ws, setElev(20)));
  await sleep(1500);
  console.log('set 65°:', await evaljs(ws, setElev(65)));
  await sleep(1500);

  console.log('versions:', await evaljs(ws, `document.querySelectorAll('.version-row').length`));

  // 勾选第 1 和第 3 个版本(列表是倒序的,最新在最上)
  await evaljs(ws, `document.querySelectorAll('.version-row .version-check input')[2].click()`);
  await sleep(300);
  await evaljs(ws, `document.querySelectorAll('.version-row .version-check input')[0].click()`);
  await sleep(800);

  console.log('compare table rows:', await evaljs(ws, `document.querySelectorAll('.diff-table tr').length`));
  console.log('diff rows:', await evaljs(ws, `document.querySelectorAll('.diff-table tr.diff').length`));
  console.log('shadow bars:', await evaljs(ws, `document.querySelectorAll('.shadow-bar').length`));

  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out);
} finally {
  chrome.kill('SIGKILL');
}
process.exit(0);
