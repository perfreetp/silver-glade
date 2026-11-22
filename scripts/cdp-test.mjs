/**
 * CDP 无头集成测试：覆盖填色、曲面绘制、接缝、材质参数、保存、导出/导入、撤销全链路。
 * 核心绘制/填色通过引擎公开 API 驱动（与真实鼠标走同一采样提交路径），
 * 另用一次合成 PointerEvent 验证 DOM 事件到引擎的连通性。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CDP_PORT = 9334;
const APP_URL = 'http://localhost:5199/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DIR = `C:/Users/Administrator/AppData/Local/Temp/chrome-cdp-${process.pid}`;

let chromeProc = null;
function startChrome() {
  chromeProc = spawn(CHROME, [
    '--headless=new', `--user-data-dir=${USER_DIR}`,
    '--disable-gpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*',
    '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' });
}
async function waitForCdp(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try { const r = await fetch(`http://localhost:${CDP_PORT}/json/version`); if (r.ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Chrome CDP 未就绪');
}
async function getTarget() {
  const res = await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' });
  return res.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  startChrome();
  await waitForCdp();
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId; pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const ed = r.exceptionDetails;
      throw new Error('JS: ' + (ed.exception?.description ?? ed.text));
    }
    return r.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await evaluate(`!!(window.__engine && document.querySelector('.scene-canvas'))`).catch(() => false)) break;
  }
  await sleep(1200);

  const results = [];
  const check = (name, cond, extra = '') => {
    results.push({ name, pass: !!cond, extra });
    console.log(`${cond ? '✓' : '✗'} ${name} ${extra}`);
  };

  // 1. 引擎与初始拓扑
  const init = await evaluate(`(() => {
    const e = window.__engine;
    return {
      webgpu: e.isWebGPU,
      triCount: e.triCount,
      regionCount: e.regionCount,
      strokeCount: e.strokeCount,
      seamMeshes: e.scene.meshes.filter(m => m.name === 'seam').length,
    };
  })()`);
  console.log('1) 初始状态:', JSON.stringify(init));
  // 演示车由下车身+座舱两个独立几何壳体组成，各自为一个连通分区（真实拓扑）
  check('初始按几何壳体建立分区(>=1)', init.regionCount >= 1, `regions=${init.regionCount}`);
  check('初始无笔画', init.strokeCount === 0);

  // 2. 找锚点并程序化填色
  const anchor = await evaluate(`(() => {
    const e = window.__engine;
    const c = document.querySelector('.scene-canvas');
    const W = c.width, H = c.height;
    for (let r = 0; r < Math.max(W, H) / 2; r += 12) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = Math.round(W / 2 + Math.cos(a) * r);
        const y = Math.round(H / 2 + Math.sin(a) * r);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (e.scene.pick(x, y, (m) => m === e.body)?.hit) return { x, y };
      }
    }
    return null;
  })()`);
  check('找到车身拾取点', !!anchor, JSON.stringify(anchor));

  await evaluate(`window.__engine.setSelectedFilm('G-01')`);
  const filled = await evaluate(`window.__engine.fillRegionAt(${anchor.x}, ${anchor.y}, 'G-01')`);
  check('程序化填色成功', filled === true);
  const filledCount = await evaluate(`window.__engine.filledRegionCount`);
  check('填色分区数=1', filledCount === 1, `filled=${filledCount}`);

  // 3. 曲面绘制一条边界
  const strokePts = [];
  for (let i = 0; i <= 24; i++) {
    strokePts.push({ x: anchor.x - 100 + i * 8, y: anchor.y + Math.sin(i / 3) * 8 });
  }
  const sampled = await evaluate(`window.__engine.drawStrokeAlongSurface(${JSON.stringify(strokePts)})`);
  check('曲面笔画采样点>1', sampled > 1, `points=${sampled}`);
  const afterStroke = await evaluate(`(() => {
    const e = window.__engine;
    return {
      strokes: e.strokeCount,
      regions: e.regionCount,
      seams: e.scene.meshes.filter(m => m.name === 'seam').length,
    };
  })()`);
  console.log('3) 绘制后:', JSON.stringify(afterStroke));
  check('生成1条边界', afterStroke.strokes === 1);
  check('笔画后分区数不减少', afterStroke.regions >= init.regionCount, `regions=${afterStroke.regions}`);
  check('自动生成1条接缝管', afterStroke.seams === 1);

  // 3b. 完整环绕环（沿车长截面闭合一周），验证蒙版屏障能真正分割 BFS 分区
  const split = await evaluate(`(() => {
    const e = window.__engine;
    const before = e.regionCount;
    // 取车身中段 v≈0.5 的截面
    const sampled = e.addFullWrapStroke(0.5);
    return { before, after: e.regionCount, sampled };
  })()`);
  console.log('3b) 环绕环切:', JSON.stringify(split));
  check('完整环绕环采样闭合(>=64点)', split.sampled >= 64, `sampled=${split.sampled}`);
  check('闭合环使分区数增加', split.after > split.before, `${split.before}→${split.after}`);

  // 接缝管数量随笔画数（当前 2 条笔画）
  const seamCountNow = await evaluate(`window.__engine.scene.meshes.filter(m => m.name === 'seam').length`);
  // 4. 接缝宽度联动
  await evaluate(`window.__engine.setSeamWidth(0.05)`);
  const seamW = await evaluate(`window.__engine.seamWidth`);
  const seamStillThere = await evaluate(`window.__engine.scene.meshes.filter(m => m.name === 'seam').length`);
  check('接缝宽度可调且管体保留', Math.abs(seamW - 0.05) < 1e-9 && seamStillThere === seamCountNow && seamCountNow >= 2, `seams=${seamStillThere}`);

  // 5. 材质参数整车同步
  await evaluate(`window.__engine.setMaterialParams(0.31, 0.77)`);
  const mat = await evaluate(`({ r: window.__engine.bodyMat.roughness, m: window.__engine.bodyMat.metallic })`);
  check('粗糙度/金属度同步到材质', Math.abs(mat.r - 0.31) < 1e-9 && Math.abs(mat.m - 0.77) < 1e-9);

  // 6. DOM 事件连通性（一次合成点击应能进入引擎指针观察流）
  const eventLinked = await evaluate(`(async () => {
    const c = document.querySelector('.scene-canvas');
    let received = false;
    const sub = window.__engine.scene.onPointerObservable.add(() => { received = true; });
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, composed: true,
      clientX: r.left + ${anchor.x}, clientY: r.top + ${anchor.y},
      pointerId: 2, pointerType: 'mouse', isPrimary: true, button: -1, buttons: 0,
    }));
    await new Promise((res) => setTimeout(res, 100));
    window.__engine.scene.onPointerObservable.remove(sub);
    return received;
  })()`);
  check('DOM 指针事件连通引擎', eventLinked === true);

  // 7. 导出文件结构
  const exportCheck = await evaluate(`(async () => {
    let captured = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { captured = b; return orig.call(URL, b); };
    [...document.querySelectorAll('.top-actions .btn')].find(b => b.textContent.includes('导出')).click();
    await new Promise(r => setTimeout(r, 300));
    URL.createObjectURL = orig;
    const text = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsText(captured); });
    const d = JSON.parse(text);
    const pt = d.strokes[0]?.points[0] ?? {};
    return {
      version: d.version,
      strokes: d.strokes.length,
      regions: Object.keys(d.regionColors).length,
      seamWidth: d.seamWidth,
      brushRadius: typeof d.brushRadius === 'number',
      mat: d.materialParams,
      pt: { p: Array.isArray(pt.p), n: Array.isArray(pt.n), uv: typeof pt.u === 'number' && typeof pt.v === 'number' },
    };
  })()`);
  console.log('7) 导出:', JSON.stringify(exportCheck));
  check('导出含全部笔画(>=2)', exportCheck.strokes >= 2, `strokes=${exportCheck.strokes}`);
  check('导出含膜色分区编号', exportCheck.regions >= 1);
  check('导出含接缝参数', typeof exportCheck.seamWidth === 'number');
  check('导出含膜材参数', exportCheck.mat && 'roughness' in exportCheck.mat && 'metallic' in exportCheck.mat);
  check('采样点含位置/法线/UV', exportCheck.pt.p && exportCheck.pt.n && exportCheck.pt.uv);

  // 8. 保存方案（缩略图）
  await evaluate(`document.querySelector('.btn.primary').click()`);
  await sleep(1800);
  const slot = await evaluate(`(() => ({
    count: document.querySelectorAll('.slot.filled').length,
    thumb: (document.querySelector('.slot.filled img')?.src || '').startsWith('data:image/png'),
  }))()`);
  check('保存方案并生成缩略图', slot.count >= 1 && slot.thumb, JSON.stringify(slot));

  // 9. 清空 → restore 完整还原
  await evaluate(`window.__engine.clearAll()`);
  const cleared = await evaluate(`window.__engine.strokeCount`);
  check('清空后无笔画', cleared === 0);
  const restore = await evaluate(`(async () => {
    const list = JSON.parse(localStorage.getItem('car-wrap-saved-schemes-v1') || '[]');
    const data = list[list.length - 1].data;
    window.__engine.restore(data);
    await new Promise(r => setTimeout(r, 500));
    const e = window.__engine;
    return {
      strokes: e.strokeCount,
      seams: e.scene.meshes.filter(m => m.name === 'seam').length,
      filled: e.filledRegionCount,
      seamWidth: e.seamWidth,
      roughness: e.bodyMat.roughness,
    };
  })()`);
  console.log('9) 还原:', JSON.stringify(restore));
  check('还原恢复全部笔画(>=2)', restore.strokes >= 2, `strokes=${restore.strokes}`);
  check('还原恢复接缝管(>=2)', restore.seams >= 2, `seams=${restore.seams}`);
  check('还原恢复膜色分区', restore.filled >= 1);
  check('还原恢复接缝/材质参数', Math.abs(restore.seamWidth - 0.05) < 1e-9 && Math.abs(restore.roughness - 0.31) < 1e-9);

  // 10. 撤销（撤销到 0）
  await evaluate(`while (window.__engine.strokeCount > 0) window.__engine.undoStroke()`);
  const afterUndo = await evaluate(`window.__engine.strokeCount`);
  check('撤销移除全部边界', afterUndo === 0);

  // 11. 方案保存上限 6 套：直接验证存储层的硬上限
  const cap = await evaluate(`(async () => {
    const mod = await import('/src/storage.ts');
    const fake = Array.from({ length: 8 }, (_, i) => ({ id: 'x' + i, name: 's' + i, thumbnail: 'data:,', data: {} }));
    mod.persistSaved(fake);
    const stored = JSON.parse(localStorage.getItem('car-wrap-saved-schemes-v1') || '[]');
    return { max: mod.MAX_SCHEMES, storedLen: stored.length };
  })()`);
  check('方案最多保存 6 套', cap.max === 6 && cap.storedLen === 6, JSON.stringify(cap));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('cdp-result.png', Buffer.from(shot.data, 'base64'));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${failed.length === 0 ? '✅' : '❌'} ${results.length - failed.length}/${results.length} 项通过；控制台错误=${consoleErrors.length}`);
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 5));
  ws.close();
  chromeProc?.kill();
  process.exit(failed.length === 0 && consoleErrors.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error('测试异常:', e); chromeProc?.kill(); process.exit(1); });
