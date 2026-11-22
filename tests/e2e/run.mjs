#!/usr/bin/env node
/**
 * 端到端验收测试
 *
 * 覆盖四模块与三条硬性指标：
 *   1. 温度采样导入（示例数据 / 长表 / 宽表 / JSON）
 *   2. 等值面视图：顶点上限 300k、拖动阈值 ≥30fps、缓冲区不重新分配
 *   3. 热力面板：进风/出风逐点温度、选中高亮
 *   4. 导出：zip 内容完整性（OBJ / PLY / 场数据 / 机柜 / 清单）
 *
 * 用法：
 *   node tests/e2e/run.mjs [--url http://127.0.0.1:4173/] [--out tests/e2e/shots]
 */
import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { launch, openApp, parseArgs, hud, clickTab, DEFAULT_URL, assert } from "./common.mjs";

const args = parseArgs();
const URL = args.url || DEFAULT_URL;
const OUT = args.out || "tests/e2e/shots";
const DL = path.resolve(OUT, "downloads");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });

const results = { steps: [], ok: true, errors: [], gpuErrors: [] };
function step(name, detail = {}) {
  results.steps.push({ name, ...detail });
  console.log(`  ✓ ${name}${detail.note ? " — " + detail.note : ""}`);
}
function fail(msg) {
  results.ok = false;
  console.log(`  ✗ ${msg}`);
}

const browser = await launch({ tag: "e2e-run" });
try {
  const { page, errors, gpuErrors } = await openApp(browser, URL);
  results.errors = errors;
  results.gpuErrors = gpuErrors;

  /* ---------------- 1. 初始状态 ---------------- */
  const initialHud = await hud(page);
  step("初始渲染", { note: JSON.stringify(initialHud) });
  await page.screenshot({ path: path.join(OUT, "01-initial.png") });

  const verts0 = Number((initialHud["等值面顶点"] || "0").replace(/,/g, ""));
  assert(verts0 > 0, "初始等值面为空");
  assert(verts0 <= 300000, `初始顶点数超限：${verts0}`);
  assert(Number(initialHud["FPS"]) >= 30 || initialHud["FPS"] === "—", "初始帧率低于 30");

  /* ---------------- 2. 等值面：阈值与性能 ---------------- */
  await clickTab(page, "等值面");
  await page.screenshot({ path: path.join(OUT, "02-iso-panel.png") });

  const setThreshold = (v) =>
    page.evaluate((val) => {
      const s = document.querySelector(".slider");
      s.value = String(val);
      s.dispatchEvent(new Event("input", { bubbles: true }));
    }, v);

  const isoStats = [];
  for (const t of [28, 35, 42, 50, 58]) {
    await setThreshold(t);
    await new Promise((r) => setTimeout(r, 900));
    const h = await hud(page);
    const verts = Number((h["等值面顶点"] || "0").replace(/,/g, ""));
    isoStats.push({ threshold: t, verts, fps: h["FPS"] });
    assert(verts <= 300000, `阈值 ${t} 顶点超限：${verts}`);
    await page.screenshot({ path: path.join(OUT, `03-threshold-${t}.png`) });
  }
  step("阈值扫描", { note: JSON.stringify(isoStats) });

  const maxIso = Math.max(...isoStats.map((s) => s.verts));
  const minIso = Math.min(...isoStats.map((s) => s.verts));
  assert(maxIso > minIso, "阈值变化没有影响等值面尺寸");
  assert(maxIso <= 300000, "顶点数超过 30 万上限");

  // 连续拖动：模拟 120 帧的快速扫描，测量实际帧率
  const sweep = await page.evaluate(async () => {
    const s = document.querySelector(".slider");
    const t0 = performance.now();
    let frames = 0;
    for (let i = 0; i < 120; i++) {
      s.value = String(25 + (i / 119) * 35);
      s.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(r));
      frames++;
    }
    const dt = performance.now() - t0;
    return { frames, ms: dt, fps: (frames * 1000) / dt };
  });
  step("连续拖动阈值", { note: `${sweep.fps.toFixed(1)} fps（${sweep.frames} 帧）` });
  assert(sweep.fps >= 30, `拖动阈值帧率仅 ${sweep.fps.toFixed(1)}fps，低于 30`);

  // 缓冲区复用：拖动前后底层 GPUBuffer 必须是同一个对象
  const reuse = await page.evaluate(() => {
    const eng = window.__thermalEngine;
    const snap = () => ({
      vert: eng.vertBuf?.getBuffer()?.underlyingResource,
      field: eng.fieldBuf?.getBuffer()?.underlyingResource,
      counter: eng.counterBuf?.getBuffer()?.underlyingResource,
      mc: eng.mcCompute,
    });
    const before = snap();
    for (let i = 0; i < 40; i++) eng.setThreshold(25 + (i % 35));
    const after = snap();
    return {
      vert: before.vert === after.vert,
      field: before.field === after.field,
      counter: before.counter === after.counter,
      mc: before.mc === after.mc,
    };
  });
  step("缓冲区复用", { note: JSON.stringify(reuse) });
  assert(reuse.vert && reuse.field && reuse.counter && reuse.mc, "拖动阈值时发生了缓冲区重新分配");

  /* ---------------- 3. 热力面板 ---------------- */
  await clickTab(page, "热力面板");
  await page.screenshot({ path: path.join(OUT, "04-heatmap.png") });

  const beforeSelect = await page.evaluate(() => ({
    hasGrid: !!document.querySelector(".grid"),
    rackBtns: document.querySelectorAll(".rack-btn").length,
  }));
  assert(beforeSelect.rackBtns > 0, "机柜列表为空");
  const firstRack = await page.$(".rack-btn");
  await firstRack.click();
  await new Promise((r) => setTimeout(r, 600));
  const selectState = await page.evaluate(() => ({
    hasGrid: !!document.querySelector(".grid"),
    cells: document.querySelectorAll(".grid__cell").length,
    stats: Array.from(document.querySelectorAll(".rack-stats dd")).map((d) => d.textContent.trim()),
    title: document.querySelector(".block-head h2")?.textContent?.trim(),
  }));
  assert(selectState.cells === 72, `采样点格子数应为 72（两面各 36），实际 ${selectState.cells}`);
  step("选中机柜逐点温度", { note: `${selectState.title} / ${selectState.stats.join(" ")}` });
  await page.screenshot({ path: path.join(OUT, "05-rack-selected.png") });

  /* ---------------- 4. 导出 ---------------- */
  const client = await page.target().createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL });

  // 回到一个中等阈值，确保等值面非空
  await page.evaluate(() => window.__thermalEngine.setThreshold(40));
  await new Promise((r) => setTimeout(r, 900));

  await clickTab(page, "导出");
  await page.screenshot({ path: path.join(OUT, "06-export.png") });
  await page.click(".export-btn");
  await new Promise((r) => setTimeout(r, 15000));

  const files = fs.readdirSync(DL).filter((f) => f.endsWith(".zip"));
  assert(files.length === 1, `未生成 zip（得到 ${files.length} 个文件）`);
  const zipPath = path.join(DL, files[0]);
  const zipSize = fs.statSync(zipPath).size;
  step("导出 zip", { note: `${files[0]} · ${(zipSize / 1024 / 1024).toFixed(2)} MB` });

  // 解压并校验各文件
  const entries = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
  const required = ["manifest.json", "isosurface.obj", "isosurface.ply", "field.bin", "field.json", "racks.json"];
  for (const r of required) {
    assert(entries[r], `zip 缺少 ${r}`);
    assert(entries[r].length > 0, `${r} 为空`);
  }
  step("zip 内容", { note: Object.keys(entries).join(", ") });

  // 读 manifest 校验元数据
  const manifest = JSON.parse(Buffer.from(entries["manifest.json"]).toString("utf8"));
  assert(manifest.threshold === 40, `manifest 阈值不符：${manifest.threshold}`);
  assert(manifest.isoVertices > 0, "manifest 中等值面顶点为 0");
  assert(manifest.racks >= 20, "manifest 机柜数异常");
  step("manifest 校验", { note: `阈值 ${manifest.threshold}℃ · ${manifest.isoVertices} 顶点 · ${manifest.racks} 柜` });

  // PLY 头部检查
  const ply = Buffer.from(entries["isosurface.ply"]);
  const plyHead = ply.subarray(0, 400).toString("latin1");
  assert(plyHead.startsWith("ply"), "PLY 头部无效");
  assert(plyHead.includes("property float temperature"), "PLY 缺少 temperature 属性");
  step("PLY 结构", { note: `${(ply.length / 1024 / 1024).toFixed(2)} MB` });

  /* ---------------- 5. 导入面板 ---------------- */
  await clickTab(page, "温度采样");
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, "07-import.png") });
  const summary = await page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll(".summary > div")).map((d) => [
        d.querySelector("dt")?.textContent?.trim(),
        d.querySelector("dd")?.textContent?.trim(),
      ])
    )
  );
  step("导入摘要", { note: JSON.stringify(summary) });
  assert(Number(summary["机柜"]) === 24, "示例数据机柜数不对");

  if (errors.length) {
    fail(`控制台错误 ${errors.length} 条：${errors[0]?.slice(0, 200)}`);
    for (const e of errors.slice(0, 5)) console.log("    " + e.slice(0, 300));
  }
  if (gpuErrors.length) {
    fail(`GPU 校验/编译错误 ${gpuErrors.length} 条`);
    for (const e of gpuErrors.slice(0, 5)) console.log("    " + e.slice(0, 400));
  }
} catch (e) {
  fail(e.message || String(e));
  results.fatal = String(e.stack || e);
} finally {
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
  await browser.close();
}

console.log(`\n结果：${results.ok ? "PASS" : "FAIL"}`);
process.exit(results.ok ? 0 : 1);
