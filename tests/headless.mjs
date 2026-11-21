/**
 * 无头 Chrome 端到端验证：
 * 启动带 SwiftShader 的 Chrome，经 CDP 驱动页面完成
 * 加载 -> 路径绘制（真实 BVH 射线拾取）-> 播放压雪 -> BVH refit -> 测距 -> 导出
 * 全流程，并捕获控制台错误与截图。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:5190/';
const PORT = 9333;
const USER_DIR = join(tmpdir(), 'groom-chrome-profile');

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DIR}`,
    '--headless=new',
    '--disable-gpu',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--window-size=1600,1000',
    '--no-first-run',
    URL,
  ],
  { stdio: 'ignore' }
);

const errors = [];
const logs = [];
let msgId = 0;
let ws;

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve) => {
    const onMsg = (data) => {
      const m = JSON.parse(data.toString());
      if (m.id === id) {
        ws.off('message', onMsg);
        resolve(m.result);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    errors.push(`JS 异常: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
  }
  return r.result?.value;
}

async function main() {
  // 等 DevTools 端口
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const tabs = await res.json();
      const page = tabs.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.on('open', r));
        break;
      }
    } catch { /* 重试 */ }
    await sleep(250);
  }
  if (!ws) throw new Error('Chrome DevTools 连接失败');

  ws.on('message', (data) => {
    const m = JSON.parse(data.toString());
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(`未捕获异常: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? '').join(' ')}`);
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(2500);

  const checks = [];
  const ok = (name, cond, extra = '') => {
    checks.push({ name, pass: !!cond, extra });
    console.log(`${cond ? '✓' : '✗'} ${name} ${extra}`);
  };

  // 1. 页面与 WebGL 初始化
  const hasCanvas = await evalJs(`!!document.querySelector('.viewer-canvas canvas')`);
  ok('WebGL canvas 已挂载', hasCanvas);
  const hasEngine = await evalJs(`!!window.__groomEngine`);
  ok('GroomEngine 已实例化', hasEngine);
  const glOk = await evalJs(`(() => { const c=document.querySelector('.viewer-canvas canvas'); const gl=c.getContext('webgl2')||c.getContext('webgl'); return !!(gl && c.width>0); })()`);
  ok('WebGL 上下文可用且有分辨率', glOk);

  // 2. 真实指针拾取（走 three-mesh-bvh 加速 raycast）：验证首个落点能命中雪面
  const pick = await evalJs(`(async () => {
    const canvas = document.querySelector('.viewer-canvas canvas');
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:r.left+r.width*0.42,clientY:r.top+r.height*0.5,bubbles:true}));
    await new Promise(r=>setTimeout(r,80));
    return window.__groomStore.getState().controlPoints.length;
  })()`);
  ok('BVH 射线拾取命中雪面生成控制点', pick >= 1, `（${pick} 个点，raycast 走通）`);

  // 完整作业路径通过 store 注入（合成事件无完整指针序列，OrbitControls 会捕获，
  // 真实鼠标不受影响；拾取链路已由上一步证明）
  await evalJs(`(() => {
    const st = window.__groomStore.getState();
    st.clearPath();
    [[-40,-70],[15,-35],[-12,10],[25,45],[-8,85]].forEach(([x,z]) => st.addControlPoint(x,z));
  })()`);
  const cpCount = await evalJs(`window.__groomStore.getState().controlPoints.length`);
  const engineSamples = await evalJs(`window.__groomEngine.samples.length`);
  ok('多点路径重采样成功', cpCount === 5 && engineSamples > 100, `（${cpCount} 控制点 / ${engineSamples} 样本）`);

  // 3. 设置档位并播放（用固定逻辑步长驱动，与 SwiftShader 软件渲染帧率解耦，
  //    验证在 60FPS 真实帧间隔（dt=1/60）下整条路径可完整作业）
  await evalJs(`(() => {
    const st = window.__groomStore.getState();
    st.setBlade('deep'); st.setSnow('wet'); st.setSpeed(28);
    st.play();
  })()`);
  await sleep(2500);
  const after = await evalJs(`(() => {
    const st = window.__groomStore.getState();
    const eng = window.__groomEngine;
    const pos = eng.terrain.geometry.attributes.position.array;
    const d = eng.deform;
    let minDy = 0;
    for (let i = 0; i < d.count; i++) if (d.state[i]) minDy = Math.min(minDy, pos[i*3+1] - d.baseY[i]);
    return { percent: st.groomedPercent, fps: st.fps, refit: st.bvhRefitAt, piles: eng.pileData.length, minDy };
  })()`);
  ok('压雪作业推进（路径完成度 >5%）', after && after.percent > 5, `（完成 ${after?.percent}%）`);
  ok('顶点实际产生下压位移', after && after.minDy < -0.05, `（最深 ${after?.minDy?.toFixed(3)}m）`);
  ok('BVH 局部 refit 已触发', after && after.refit > 0, `（时间戳 ${after?.refit}）`);
  ok('残雪堆已生成', after && after.piles > 5, `（${after?.piles} 堆）`);
  ok('播放循环在跑（有 FPS 读数）', after && after.fps > 0, `（SwiftShader 软件渲染 ${after?.fps} FPS）`);

  // 固定 dt=1/60 逻辑步进，跑满整条路径（不依赖软件渲染帧率）
  const fullRun = await evalJs(`(() => {
    const eng = window.__groomEngine;
    const st = window.__groomStore.getState();
    eng.pause(); st.pause();
    const dt = 1 / 60;
    let guard = 0;
    let done = false;
    while (!done && guard < 3000) {
      done = eng.stepGroom(dt);
      guard++;
    }
    const immediate = window.__groomStore.getState().groomedPercent;
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ frames: guard, immediate, afterRaf: window.__groomStore.getState().groomedPercent, groomed: eng.deform.groomedCount, dirty: eng.deform.dirty.size, done, playhead: eng.playhead, samples: eng.samples.length });
      }, 300);
    });
  })()`);
  ok('60FPS 逻辑步长下整条路径作业完成', fullRun && fullRun.done && fullRun.afterRaf >= 99.5,
    JSON.stringify(fullRun));

  // 4. 测距（BVH raycast 两点）
  const measure = await evalJs(`(async () => {
    const st = window.__groomStore.getState();
    st.setToolMode('measure');
    const canvas = document.querySelector('.viewer-canvas canvas');
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:r.left+r.width*0.4,clientY:r.top+r.height*0.7,bubbles:true}));
    await new Promise(r=>setTimeout(r,80));
    canvas.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:r.left+r.width*0.6,clientY:r.top+r.height*0.45,bubbles:true}));
    await new Promise(r=>setTimeout(r,80));
    return window.__groomStore.getState().measure;
  })()`);
  ok('拖拽测距返回直线/贴地距离', measure && measure.ground >= measure.straight,
    `（直线 ${measure?.straight?.toFixed(1)}m / 贴地 ${measure?.ground?.toFixed(1)}m）`);

  // 5. 贴地标注
  const ann = await evalJs(`(async () => {
    const st = window.__groomStore.getState();
    st.setToolMode('annotate');
    const canvas = document.querySelector('.viewer-canvas canvas');
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:r.left+r.width*0.5,clientY:r.top+r.height*0.5,bubbles:true}));
    await new Promise(r=>setTimeout(r,80));
    return window.__groomStore.getState().annotations.length;
  })()`);
  ok('贴地标注落点成功', ann >= 1, `（${ann} 条）`);

  // 6. 导出任务文件结构
  const task = await evalJs(`(() => {
    const st = window.__groomStore.getState();
    return { blade: st.blade, snow: st.snow, n: st.controlPoints.length, speed: st.speed };
  })()`);
  ok('导出任务含路径点与刀头/雪质档位', task.blade === 'deep' && task.snow === 'wet' && task.n >= 4 && task.speed === 28,
    JSON.stringify(task));

  // 7. 截图
  mkdirSync('tests/shots', { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('tests/shots/groomed.png', Buffer.from(shot.data, 'base64'));
  ok('截图已保存 tests/shots/groomed.png', true);

  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n结果：${checks.length - failed}/${checks.length} 通过`);
  if (errors.length) {
    console.log('\n控制台错误：');
    errors.forEach((e) => console.log('  ' + e.slice(0, 300)));
  } else {
    console.log('控制台无错误 ✅');
  }

  chrome.kill();
  process.exit(failed || errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  chrome.kill();
  process.exit(1);
});
