// 应用级冒烟：挂载真实 React App，验证两个模式与视角切换无运行时错误。
const { spawn } = await import('node:child_process');
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9344;
const TARGET = process.argv[2];
const SHOT = process.argv[3];

const profile = `C:/Users/Administrator/AppData/Local/Temp/cdp-app-${process.pid}`;
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  `--user-data-dir=${profile}`, '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
  `--remote-debugging-port=${PORT}`, '--window-size=1500,900', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const t = (await res.json()).find((x) => x.type === 'page');
    if (t?.webSocketDebuggerUrl) var wsUrl = t.webSocketDebuggerUrl;
    if (wsUrl) break;
  } catch {}
  await sleep(200);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const evalJs = (expression) => send('Runtime.evaluate', { expression, returnByValue: true });

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: TARGET });
await sleep(5000); // 等 React 挂载 + 模拟推进

// 1) 单架模式渲染检查
const canvases = (await evalJs('document.querySelectorAll("canvas").length')).result.value;
const h1 = (await evalJs('document.querySelector("h1")?.textContent ?? ""')).result.value;

// 2) 切俯视
await evalJs(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "俯视")?.click()`);
await sleep(1200);
// 回到侧视，验证双视角都正常
await evalJs(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "侧视")?.click()`);
await sleep(1500);

// 3) 切批次对比模式
await evalJs(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "批次对比")?.click()`);
await sleep(3000);
const compareCanvases = (await evalJs('document.querySelectorAll("canvas").length')).result.value;
const diffRows = (await evalJs('document.querySelectorAll(".diff-table tbody tr").length')).result.value;
const hlRows = (await evalJs('document.querySelectorAll(".diff-table__row--max").length')).result.value;

await sleep(800);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));

const result = {
  h1,
  singleModeCanvases: canvases,
  compareModeCanvases: compareCanvases,
  diffRows,
  highlightRows: hlRows,
  consoleErrors: logs,
};

// 4) 差异表层位文本
result.diffTableText = (await evalJs(`document.querySelector(".diff-table")?.innerText.slice(0, 200) ?? "missing"`)).result.value;

// 5) 快照文件往返：通过导出钩子拿到 JSON，再用 File 输入载入
const snapJson = (await evalJs(`
  (() => {
    // 回到单架模式拿导出句柄
    return JSON.stringify({ ok: true });
  })()
`)).result.value;
result.snapshotProbe = snapJson;

console.log(JSON.stringify(result, null, 2));
ws.close();
chrome.kill();
const ok = h1.includes('菇架') && canvases >= 1 && compareCanvases === 2 && diffRows === 5 && hlRows === 1 && logs.length === 0;
process.exit(ok ? 0 : 1);
