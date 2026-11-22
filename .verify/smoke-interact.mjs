// CDP 交互与导出验证：批量建线后测试候选切换、滑块、导出 JSON/CSV
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import http from 'node:http';
import { writeFile } from 'node:fs/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET_URL = 'http://localhost:8123/';
const PORT = 9334;
const getJson = (path) => new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d)));
  }).on('error', reject);
});
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=D:\\ccfb\\runs\\1000211\\workspace\\.verify\\chrome-profile-2',
  'about:blank',
]);
for (let i = 0; i < 40; i++) {
  try { await getJson('/json/version'); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}
const pageTarget = (await getJson('/json')).find((t) => t.type === 'page');
const wsUrl = pageTarget.webSocketDebuggerUrl;
const u = new URL(wsUrl);
const ws = createConnection(+u.port, u.hostname);
ws.once('connect', () => ws.write(handshake(wsUrl)));
const [hello] = await once(ws, 'data');
if (!hello.toString().split('\r\n')[0].includes('101')) throw new Error('WS 握手失败');
let id = 0; const pending = new Map(); const events = [];
const chunks = []; let totalLen = 0;
ws.on('data', (chunk) => {
  chunks.push(chunk); totalLen += chunk.length;
  for (;;) {
    const buf = Buffer.concat(chunks, totalLen);
    const frame = parseOne(buf);
    if (!frame) break;
    chunks.length = 0; chunks.push(frame.rest); totalLen = frame.rest.length;
    const msg = JSON.parse(frame.payload.toString('utf8'));
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  }
});
const send = (method, params = {}) => {
  const mid = ++id;
  ws.write(encodeFrame(JSON.stringify({ id: mid, method, params })));
  return new Promise((res) => pending.set(mid, res));
};
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
function handshake(urlStr) {
  const key = 'dGhlIHNhbXBsZSBub25jZQ=='; const x = new URL(urlStr);
  return `GET ${x.pathname}${x.search} HTTP/1.1\r\nHost: ${x.host}\r\nUpgrade: websocket\r\n` +
    `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
}
function encodeFrame(str) {
  const data = Buffer.from(str); const len = data.length; let header;
  if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
  const mask = Buffer.from([1, 2, 3, 4]);
  return Buffer.concat([header, mask, Buffer.from(data.map((b, i) => b ^ mask[i % 4]))]);
}
function parseOne(raw) {
  if (raw.length < 2) return null;
  const b1 = raw[1]; const len0 = b1 & 0x7f; let len, offset;
  if (len0 < 126) { len = len0; offset = 2; }
  else if (len0 === 126) { if (raw.length < 4) return null; len = raw.readUInt16BE(2); offset = 4; }
  else { if (raw.length < 10) return null; len = Number(raw.readBigUInt64BE(2)); offset = 10; }
  if (raw.length < offset + len) return null;
  return { payload: raw.subarray(offset, offset + len), rest: raw.subarray(offset + len) };
}

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: TARGET_URL });
await new Promise((r) => setTimeout(r, 4000));

// 拦截下载：覆盖 URL.createObjectURL 抓取 Blob 文本与原始字节
await evalJs(`
  window.__blobs = {};
  window.__bom = {};
  const _create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function(blob) {
    const url = _create(blob);
    blob.text().then(t => { window.__blobs[url] = t; });
    blob.arrayBuffer().then(buf => {
      window.__bom[url] = new Uint8Array(buf.slice(0, 3)).join(',');
    });
    return url;
  };
`);

// 批量建 120 条（足够验证，缩短耗时）
await evalJs(`(() => { document.querySelector('#batch-count').value = 120; document.querySelector('#btn-batch').click(); })()`);
await waitFor(evalJs, () => evalJs(`document.querySelector('#batch-progress').hidden`), 60000);
const count = await evalJs(`document.querySelectorAll('#length-table tbody tr').length`);
console.log('批量建线:', count, '条');

// 选中第一条，记录初始长度
await evalJs(`document.querySelector('#length-table tbody tr').click()`);
await new Promise((r) => setTimeout(r, 300));
const lenBefore = await evalJs(`document.querySelector('#cable-info .kv:nth-child(4) b').textContent`);

// 切换到候选 2（顶部桥架）
await evalJs(`[...document.querySelectorAll('.variant-item')].find(e => e.textContent.includes('候选 2'))?.click()`);
await new Promise((r) => setTimeout(r, 300));
const lenAfter = await evalJs(`document.querySelector('#cable-info .kv:nth-child(4) b').textContent`);
const activeVariant = await evalJs(`document.querySelector('.variant-item.active .v-name')?.textContent`);
console.log(`候选切换: ${lenBefore} -> ${lenAfter}，当前激活=${activeVariant}`);

// 切换样条模式
await evalJs(`document.querySelector('#sel-mode').value='spline'; document.querySelector('#sel-mode').dispatchEvent(new Event('change'))`);
await new Promise((r) => setTimeout(r, 200));
const splineLen = await evalJs(`document.querySelector('#cable-info .kv:nth-child(4) b').textContent`);
console.log('样条模式长度:', splineLen);

// 调弯曲半径
await evalJs(`(() => { const el=document.querySelector('#rng-bend'); el.value=0.5; el.dispatchEvent(new Event('input')); })()`);
await new Promise((r) => setTimeout(r, 200));
const bendShown = await evalJs(`document.querySelector('#val-bend').textContent`);
console.log('弯曲半径滑块显示:', bendShown);

// 单条颜色切换
await evalJs(`(() => { const el=document.querySelector('#sel-cable-color'); el.value=3; el.dispatchEvent(new Event('change')); })()`);
const colorIdx = await evalJs(`document.querySelector('#sel-cable-color').value`);
console.log('单条颜色索引:', colorIdx);

// 全局粗细
await evalJs(`(() => { const el=document.querySelector('#rng-radius'); el.value=0.06; el.dispatchEvent(new Event('input')); })()`);
const radiusShown = await evalJs(`document.querySelector('#val-radius').textContent`);
const totalAfterRadius = await evalJs(`document.querySelector('#stat-total').textContent`);
console.log('全局粗细:', radiusShown, '总长:', totalAfterRadius);

// 导出 JSON
await evalJs(`document.querySelector('#btn-export-json').click()`);
// 导出 CSV
await evalJs(`document.querySelector('#btn-export-csv').click()`);
await new Promise((r) => setTimeout(r, 1200)); // 等待 text()/arrayBuffer() 异步落地
const blobUrls = await evalJs(`Object.keys(window.__blobs)`);
const contents = [];
for (const bu of blobUrls) contents.push(await evalJs(`window.__blobs[${JSON.stringify(bu)}]`));
const jsonText = contents.find((t) => t.trimStart().startsWith('{'));
const csvText = contents.find((t) => t.includes('线缆编号'));
let csvUrl = '';
for (let i = 0; i < blobUrls.length; i++) if (contents[i].includes('线缆编号')) { csvUrl = blobUrls[i]; break; }
const csvBomBytes = csvUrl ? await evalJs(`window.__bom[${JSON.stringify(csvUrl)}]`) : '';

let failures = 0;
const check = (name, cond, detail = '') => { console.log(`${cond ? '✓' : '✗'} ${name} ${detail}`); if (!cond) failures++; };

check('导出 JSON 存在', !!jsonText);
if (jsonText) {
  const data = JSON.parse(jsonText);
  check('JSON 元数据完整', data.meta && typeof data.meta.totalLengthMeters === 'number' && data.meta.cableCount === count);
  check('JSON 线缆条目数匹配', data.cables.length === count);
  const c0 = data.cables[0];
  check('JSON 单条含采样点与控制点', Array.isArray(c0.sampledPoints) && c0.sampledPoints.length === 121 && Array.isArray(c0.waypoints));
  check('JSON 含碰撞字段', typeof c0.collision === 'object' &&
    typeof c0.collision.segmentCount === 'number' &&
    Array.isArray(c0.collision.hitSegmentIndices) &&
    Array.isArray(c0.collision.cabinetsHit));
  check('JSON 坐标为三元数组', c0.sampledPoints[0].length === 3 && c0.sampledPoints[0].every(Number.isFinite));
}
check('导出 CSV 存在', !!csvText);
if (csvText) {
  const lines = csvText.replace(/^﻿/, '').split('\r\n');
  check('CSV 表头 11 列', lines[0].split(',').length === 11, lines[0].slice(0, 30));
  check('CSV 数据行数匹配', lines.length - 1 === count, `${lines.length - 1} 行`);
  // BOM 原始字节应为 EF BB BF（Blob.text() 会剥掉 BOM，故检查字节）
  check('CSV 含 BOM(EF BB BF) 与中文表头', csvBomBytes === '239,187,191' && lines[0].includes('线缆编号'), csvBomBytes);
}
check('候选切换产生不同长度', lenBefore !== lenAfter, `${lenBefore} vs ${lenAfter}`);
check('激活项为候选 2', (activeVariant || '').includes('候选 2'), activeVariant);
check('弯曲半径联动显示', bendShown === '0.50', bendShown);

// 控制台异常
const fatal = events.filter((e) => e.method === 'Runtime.exceptionThrown');
check('无运行时异常', fatal.length === 0, fatal.map((e) => e.params.exceptionDetails.text).join(';'));

console.log(failures === 0 ? '\n[PASS] 交互与导出验证通过' : `\n[FAIL] ${failures} 项`);
await writeFile(new URL('./export-sample.json', import.meta.url), jsonText || '');
chrome.kill();
process.exit(failures ? 1 : 0);

async function waitFor(evalFn, condFn, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 500));
    if (await condFn()) return;
  }
  throw new Error('等待条件超时');
}
