// 零依赖 CDP 冒烟测试：启动 headless Chrome，加载页面，采集 console/异常/网络错误
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET_URL = process.env.TARGET || 'http://localhost:8123/';
const PORT = 9333;

const getJson = (path) => new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => resolve(JSON.parse(d)));
  }).on('error', reject);
});

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=D:\\ccfb\\runs\\1000211\\workspace\\.verify\\chrome-profile',
  'about:blank',
]);

// 等待 DevTools 端口就绪
for (let i = 0; i < 40; i++) {
  try { await getJson('/json/version'); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}

const tabs = await getJson('/json');
const pageTarget = tabs.find((t) => t.type === 'page');
const wsUrl = pageTarget.webSocketDebuggerUrl;

// 极简 WebSocket 客户端（CDP 文本帧即可）
const ws = createConnection(+new URL(wsUrl).port, new URL(wsUrl).hostname);
ws.once('connect', () => ws.write(handshake(wsUrl)));
const [hello] = await once(ws, 'data');
const statusLine = hello.toString().split('\r\n')[0];
if (!statusLine.includes('101')) throw new Error('WS 握手失败: ' + statusLine);

let id = 0;
const pending = new Map();
const events = [];
const chunks = [];
let totalLen = 0;
ws.on('data', (chunk) => {
  chunks.push(chunk);
  totalLen += chunk.length;
  for (;;) {
    const buf = Buffer.concat(chunks, totalLen);
    const frame = parseOne(buf);
    if (!frame) break;
    chunks.length = 0;
    chunks.push(frame.rest);
    totalLen = frame.rest.length;
    const msg = JSON.parse(frame.payload.toString('utf8'));
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  }
});
function send(method, params = {}) {
  const mid = ++id;
  const payload = JSON.stringify({ id: mid, method, params });
  ws.write(encodeFrame(payload));
  return new Promise((res) => pending.set(mid, res));
}
function handshake(urlStr) {
  const key = 'dGhlIHNhbXBsZSBub25jZQ==';
  const u = new URL(urlStr);
  return `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\n` +
    `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
}
function encodeFrame(str) {
  const data = Buffer.from(str);
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
  else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(data.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([header, mask, masked]);
}
function parseOne(raw) {
  if (raw.length < 2) return null;
  const b1 = raw[1];
  const masked = (b1 & 0x80) !== 0;
  const len0 = b1 & 0x7f;
  let len, offset;
  if (len0 < 126) { len = len0; offset = 2; }
  else if (len0 === 126) {
    if (raw.length < 4) return null;
    len = raw.readUInt16BE(2); offset = 4;
  } else {
    if (raw.length < 10) return null;
    len = Number(raw.readBigUInt64BE(2)); offset = 10;
  }
  if (masked) offset += 4;
  if (raw.length < offset + len) return null;
  const payload = raw.subarray(offset, offset + len);
  const rest = raw.subarray(offset + len);
  return { payload, rest };
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
const navigate = await send('Page.navigate', { url: TARGET_URL });
if (navigate.result?.errorText) throw new Error('导航失败: ' + navigate.result.errorText);

// 等待页面脚本初始化（含 CDN 加载、three.js 实例化）
await new Promise((r) => setTimeout(r, 5000));

// 在页面内执行状态探针
const probe = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    hasCanvas: !!document.querySelector('#viewport'),
    cableCount: document.querySelector('#view-count')?.textContent,
    statCount: document.querySelector('#stat-count')?.textContent,
    panels: document.querySelectorAll('.panel').length,
    colorOptions: document.querySelectorAll('#sel-color option').length,
  })`,
  returnByValue: true,
});
const state = JSON.parse(probe.result.result.value);

// 采集到的错误分级
const errors = events
  .filter((e) => e.method === 'Runtime.exceptionThrown' ||
    (e.method === 'Log.entryAdded' && ['error', 'warning'].includes(e.params.entry.level)) ||
    (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params.type)))
  .map((e) => {
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params.exceptionDetails;
      const exc = d.exception;
      return `EXCEPTION: ${d.text} | ${exc?.className || ''}: ${exc?.description || ''} @ ${d.url}:${d.lineNumber}`;
    }
    if (e.method === 'Log.entryAdded') return `${e.params.entry.level.toUpperCase()}: ${e.params.entry.text} @ ${e.params.entry.url || ''}`;
    return `CONSOLE.${e.params.type}: ` + (e.params.args || []).map((a) => a.value || a.description || '').join(' ');
  })
  .filter((s) => s && !s.includes('favicon'));

// 模拟批量建线（点击按钮，轮询直到数量稳定，上限 60s）
await send('Runtime.evaluate', { expression: `document.querySelector('#btn-batch').click()` });
const deadline = Date.now() + 60000;
let batchState;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  const r = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      view: document.querySelector('#view-count')?.textContent,
      total: document.querySelector('#stat-total')?.textContent,
      collision: document.querySelector('#stat-collision')?.textContent,
      rows: document.querySelectorAll('#length-table tbody tr').length,
      progressHidden: document.querySelector('#batch-progress').hidden,
      barWidth: document.querySelector('#batch-bar')?.style.width,
    })`,
    returnByValue: true,
  });
  batchState = JSON.parse(r.result.result.value);
  if (batchState.progressHidden && Number(batchState.rows) > 0) break;
}

// 选中第一条线缆并检查控制点
await send('Runtime.evaluate', { expression: `document.querySelector('#length-table tbody tr')?.click()` });
await new Promise((r) => setTimeout(r, 500));
const selState = JSON.parse((await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    info: document.querySelector('#cable-info')?.textContent?.slice(0, 60),
    variants: document.querySelectorAll('.variant-item').length,
  })`,
  returnByValue: true,
})).result.result.value);

// 截图留档
const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(new URL('./smoke.png', import.meta.url), Buffer.from(shot.result.data, 'base64'));

console.log('页面初始状态:', state);
console.log('批量建线后:', batchState);
console.log('选中线缆:', selState);
console.log(`\n控制台错误/警告 (${errors.length}):`);
errors.forEach((e) => console.log('  ' + e));

const fatal = errors.filter((e) => e.startsWith('EXCEPTION') || e.startsWith('ERROR'));
const ok = state.panels === 3 && Number(batchState.rows) >= 300 && fatal.length === 0;
console.log(ok ? `\n[PASS] 浏览器冒烟测试通过（${batchState.rows} 条规模）` : `\n[FAIL] 冒烟测试未达标（rows=${batchState.rows}）`);
chrome.kill();
process.exit(ok ? 0 : 1);
