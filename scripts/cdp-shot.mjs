// 极简 CDP 截图工具:node scripts/cdp-shot.mjs <url> <out.png> [waitMs]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [url, out, waitMs = '8000'] = process.argv.slice(2);
const PORT = 49333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-proxy-server', '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/chromeprof-cdp',
  '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(400);
  }
  throw new Error('CDP endpoint not ready');
}

let id = 0;
const pending = new Map();
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

try {
  const wsUrl = await getTarget();
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg.result);
      pending.delete(msg.id);
    }
  };
  await send(ws, 'Page.enable');
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send(ws, 'Page.navigate', { url });
  await sleep(parseInt(waitMs));
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out);
} finally {
  chrome.kill('SIGKILL');
}
process.exit(0);
