/**
 * 端到端冒烟测试（Playwright + Chromium）。
 *
 * 前置：先构建并启动预览服务器
 *   npm run build
 *   npm run preview
 * 然后：
 *   npm run test:e2e
 *
 * 可用 BASE_URL 指定地址（默认 http://127.0.0.1:4173/）。
 */

import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const HEADLESS = process.env.HEADED !== '1';
const shot = (name) => `.scratch/e2e-${name}.png`;

async function main() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const step = (name) => console.log(`\n▶ ${name}`);
  const app = () => page.evaluateHandle(() => document.querySelector('fire-app'));
  const evaluateApp = (fn, arg) => page.evaluate(fn, arg);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  step('初始化内核');
  const kernelReady = await evaluateApp(async () => {
    const a = document.querySelector('fire-app');
    return a.waitForKernel(20000);
  });
  assert.ok(kernelReady, 'manifold-3d 内核应加载成功');

  step('载入演示影像与高程');
  await evaluateApp(async () => {
    await document.querySelector('fire-app').loadSample();
  });
  await page.waitForTimeout(1500);
  const loaded = await evaluateApp(() => {
    const v = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer');
    const st = v.appStore;
    return { imagery: !!st.project.imagery, dem: !!st.project.dem, field: !!st.field, w: st.project.imagery?.width };
  });
  assert.ok(loaded.imagery && loaded.dem, '影像与高程应已载入');
  assert.ok(loaded.field, '应生成过火指数场');
  await page.screenshot({ path: shot('01-import') });

  step('自动提取火场边界');
  await page.waitForTimeout(400);
  await evaluateApp(() => {
    const app = document.querySelector('fire-app');
    app.selectModule('detect');
    app.shadowRoot.querySelector('bt-detect-panel').shadowRoot.querySelector('[data-act="extract"]').click();
  });
  await page.waitForTimeout(3000);
  const extracted = await evaluateApp(() => {
    const v = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer');
    const st = v.appStore;
    return {
      rings: st.project.boundary.length,
      area: st.derived?.area ?? 0,
      perimeter: st.derived?.perimeter ?? 0,
      tris: st.derived?.mesh.indices.length / 3 ?? 0,
      selfIntersections: st.extract?.stats.selfIntersectionsBefore ?? 0,
      build: v.view.stats,
    };
  });
  console.log('   提取结果', extracted);
  assert.ok(extracted.rings >= 1, '应得到至少一个边界环');
  assert.ok(extracted.area > 1000, '迹地面积应大于 1000 m²');
  assert.ok(extracted.perimeter > 100, '周长应大于 100 m');
  assert.ok(extracted.tris > 4, '应完成三角化');
  assert.ok(extracted.build.drapeVertexCount > extracted.tris, '贴地加密后顶点数应显著增加');
  await page.screenshot({ path: shot('02-detect') });

  step('受损分级填充与统计');
  const stats = await evaluateApp(() => {
    const st = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer').appStore;
    return {
      bins: st.summary.bins.map((b) => ({ label: b.label, area: b.area, fraction: b.fraction })),
      total: st.summary.bins.reduce((s, b) => s + b.area, 0),
      meanClass: st.summary.meanClass,
    };
  });
  console.log('   分级', stats.bins.map((b) => `${b.label} ${(b.fraction * 100).toFixed(1)}%`).join(' / '));
  const sumFrac = stats.bins.reduce((s, b) => s + b.fraction, 0);
  assert.ok(Math.abs(sumFrac - 1) < 0.02, '分级占比之和应为 1');
  assert.ok(Math.abs(stats.total - extracted.area) / extracted.area < 0.03, '分级面积总和应与边界面积一致');

  step('切换抬升显示 / 贴地显示');
  await evaluateApp(() => {
    const v = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer');
    v.shadowRoot.querySelector('[data-mode="raised"]').click();
  });
  await page.waitForTimeout(800);
  const raised = await evaluateApp(() => {
    const v = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer');
    const fill = v.view.group.children.find((c) => c.type === 'Mesh' && c.geometry.type !== 'SphereGeometry');
    const ys = new Set();
    const a = fill.geometry.attributes.position.array;
    for (let i = 1; i < a.length; i += 3) ys.add(Math.round(a[i] * 10) / 10);
    return { mode: v.appStore.project.view.mode, distinctY: ys.size };
  });
  assert.equal(raised.mode, 'raised');
  assert.ok(raised.distinctY <= 2, '抬升模式下填充面应位于同一高度');
  await page.screenshot({ path: shot('03-raised') });

  await evaluateApp(() => {
    const v = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer');
    v.shadowRoot.querySelector('[data-mode="drape"]').click();
  });
  await page.waitForTimeout(800);
  const draped = await evaluateApp(() => {
    const v = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer');
    const fill = v.view.group.children.find((c) => c.type === 'Mesh' && c.geometry.type !== 'SphereGeometry');
    const ys = new Set();
    const a = fill.geometry.attributes.position.array;
    for (let i = 1; i < a.length; i += 3) ys.add(Math.round(a[i] * 10) / 10);
    return { mode: v.appStore.project.view.mode, distinctY: ys.size };
  });
  assert.equal(draped.mode, 'drape');
  assert.ok(draped.distinctY > 10, '贴地模式下填充面应随地形起伏（多个高度）');
  await page.screenshot({ path: shot('04-drape') });

  step('点击边界内显示坡度与受损等级');
  await evaluateApp(() => {
    const v = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer');
    v.focusAt(560, 500, 760);
  });
  await page.waitForTimeout(600);
  const target = await evaluateApp(() => {
    const v = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer');
    const st = v.appStore;
    const outer = st.project.boundary[0].vertices;
    // 取一个边界内部点：外环质心与某个顶点的中点
    let cx = 0;
    let cy = 0;
    for (const p of outer) {
      cx += p.x;
      cy += p.y;
    }
    cx /= outer.length;
    cy /= outer.length;
    const w = v.scene.mapToWorld(cx, cy, v.elevationAt(cx, cy), 0);
    const proj = w.clone().project(v.scene.camera);
    const rect = v.getBoundingClientRect();
    return { x: rect.left + (proj.x * 0.5 + 0.5) * rect.width, y: rect.top + (-proj.y * 0.5 + 0.5) * rect.height };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(500);
  const spot = await evaluateApp(() => {
    const v = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer');
    const tip = v.shadowRoot.querySelector('.tooltip');
    return { hidden: tip.hasAttribute('hidden'), text: tip.textContent.replace(/\s+/g, ' ') };
  });
  console.log('   点位信息:', spot.text);
  assert.ok(!spot.hidden, '点击迹地内应显示信息卡');
  assert.match(spot.text, /坡度/);
  assert.match(spot.text, /(未过火|轻度受损|中度受损|重度受损|极重度)/);
  await page.screenshot({ path: shot('05-spot') });

  step('修边：拖动顶点实时重建');
  await evaluateApp(() => document.querySelector('fire-app').selectModule('edit'));
  await page.waitForTimeout(700);
  const before = await evaluateApp(() => {
    const st = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer').appStore;
    return { area: st.derived.area, v: { ...st.project.boundary[0].vertices[5] } };
  });
  const handle = await evaluateApp(() => {
    const v = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer');
    const p = v.appStore.project.boundary[0].vertices[5];
    const w = v.scene.mapToWorld(p.x, p.y, v.elevationAt(p.x, p.y), 0);
    const proj = w.clone().project(v.scene.camera);
    const rect = v.getBoundingClientRect();
    return { x: rect.left + (proj.x * 0.5 + 0.5) * rect.width, y: rect.top + (-proj.y * 0.5 + 0.5) * rect.height };
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(handle.x + i * 6, handle.y + i * 4);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
  const after = await evaluateApp(() => {
    const st = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer').appStore;
    return {
      area: st.derived.area,
      v: { ...st.project.boundary[0].vertices[5] },
      history: st.history.length,
      tris: st.derived.mesh.indices.length / 3,
    };
  });
  console.log('   拖动前', before.v, '→', after.v, '面积', before.area.toFixed(0), '→', after.area.toFixed(0));
  assert.notDeepEqual(after.v, before.v, '顶点应被移动');
  assert.ok(Math.abs(after.area - before.area) > 1, '面积应随拖动更新');
  assert.ok(after.tris > 0, '应重新三角化');
  assert.ok(after.history >= 1, '拖动应记入历史');
  await page.screenshot({ path: shot('06-drag') });

  step('撤销');
  await evaluateApp(() => document.querySelector('fire-app').shadowRoot.querySelector('[data-act="undo"]').click());
  await page.waitForTimeout(500);
  const undone = await evaluateApp(() => {
    const st = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer').appStore;
    return { area: st.derived.area, v: { ...st.project.boundary[0].vertices[5] } };
  });
  assert.ok(Math.abs(undone.area - before.area) < 0.5, '撤销后面积应恢复');
  assert.deepEqual(undone.v, before.v, '撤销后顶点应恢复');

  step('Shift+点击边线插入顶点');
  const edgePos = await evaluateApp(() => {
    const v = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer');
    const st = v.appStore;
    const verts = st.project.boundary[0].vertices;
    const a = verts[10];
    const b = verts[11];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const w = v.scene.mapToWorld(mx, my, v.elevationAt(mx, my), 0);
    const proj = w.clone().project(v.scene.camera);
    const rect = v.getBoundingClientRect();
    return { x: rect.left + (proj.x * 0.5 + 0.5) * rect.width, y: rect.top + (-proj.y * 0.5 + 0.5) * rect.height, n: verts.length };
  });
  await page.keyboard.down('Shift');
  await page.mouse.click(edgePos.x, edgePos.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(600);
  const inserted = await evaluateApp(() => {
    const st = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer').appStore;
    return { n: st.project.boundary[0].vertices.length, status: st.status.text };
  });
  console.log('   顶点数', edgePos.n, '→', inserted.n);
  assert.equal(inserted.n, edgePos.n + 1, 'Shift+点击应插入一个顶点');

  step('布尔规整');
  await evaluateApp(() => {
    document.querySelector('fire-app').shadowRoot.querySelector('bt-edit-panel').shadowRoot.querySelector('[data-act="regularize"]').click();
  });
  await page.waitForTimeout(900);
  const regularized = await evaluateApp(() => {
    const st = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer').appStore;
    return { area: st.derived.area, rings: st.project.boundary.length, status: st.status.text };
  });
  assert.ok(regularized.rings >= 1, '规整后应保留边界');
  assert.ok(regularized.area > 1000, '规整后面积应正常');
  await page.screenshot({ path: shot('07-regularized') });

  step('面积统计模块与 GeoJSON 导出');
  await evaluateApp(() => document.querySelector('fire-app').selectModule('stats'));
  await page.waitForTimeout(700);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    evaluateApp(() => document.querySelector('fire-app').shadowRoot.querySelector('bt-stats-panel').shadowRoot.querySelector('[data-act="export"]').click()),
  ]);
  const file = await download.path();
  const { readFileSync } = await import('node:fs');
  const gj = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(gj.type, 'FeatureCollection');
  assert.equal(gj.features.length, 1);
  const geom = gj.features[0].geometry;
  assert.ok(geom.type === 'Polygon' || geom.type === 'MultiPolygon');
  const ringsArr = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates[0];
  assert.ok(ringsArr.length >= 1);
  assert.ok(ringsArr[0].length >= 4);
  const first = ringsArr[0][0];
  const last = ringsArr[0][ringsArr[0].length - 1];
  assert.deepEqual(first, last, 'GeoJSON 环应闭合');
  assert.ok(Math.abs(first[0] - 118.9) < 0.2 && Math.abs(first[1] - 43.6) < 0.2, '坐标应换算为经纬度');
  const props = gj.features[0].properties;
  assert.ok(props.area_m2 > 0 && props.perimeter_m > 0);
  assert.ok(Array.isArray(props.severity.classes) && props.severity.classes.length === 5);
  console.log('   导出属性', { area_m2: props.area_m2, perimeter_m: props.perimeter_m, vertices: props.vertex_count });
  await page.screenshot({ path: shot('08-stats') });

  step('刷新后从本地存储恢复');
  await evaluateApp(() => document.querySelector('fire-app').shadowRoot.querySelector('[data-act="save"]').click());
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  const restored = await evaluateApp(() => {
    const app = document.querySelector('fire-app');
    const st = app.shadowRoot.querySelector('bt-viewer').appStore;
    return {
      imagery: !!st.project.imagery,
      dem: !!st.project.dem,
      rings: st.project.boundary.length,
      area: st.derived?.area ?? 0,
      name: st.project.name,
      status: st.status.text,
    };
  });
  console.log('   恢复', restored);
  assert.ok(restored.imagery && restored.dem, '影像与高程应恢复');
  assert.ok(restored.rings >= 1, '边界应恢复');
  assert.ok(Math.abs(restored.area - regularized.area) / regularized.area < 0.02, '恢复后面积应一致');
  await page.screenshot({ path: shot('09-restored') });

  step('新建项目清空');
  await evaluateApp(() => {
    const app = document.querySelector('fire-app');
    app.shadowRoot.querySelector('[data-act="new"]').click();
    const back = app.shadowRoot.querySelector('.modal-back');
    back.querySelector('[data-ok]').click();
  });
  await page.waitForTimeout(900);
  const cleared = await evaluateApp(() => {
    const st = document.querySelector('fire-app').shadowRoot.querySelector('bt-viewer').appStore;
    return { rings: st.project.boundary.length, imagery: !!st.project.imagery };
  });
  assert.equal(cleared.rings, 0);
  assert.ok(!cleared.imagery);

  const fatal = errors.filter((e) => !/GL Driver Message|ReadPixels|WebGL/.test(e));
  assert.deepEqual(fatal, [], `不应有运行时报错：\n${fatal.join('\n')}`);
  console.log('\n✅ 端到端检查全部通过');
  await browser.close();
}

main().catch(async (err) => {
  console.error('\n❌ 端到端测试失败:', err);
  process.exitCode = 1;
});
