#!/usr/bin/env node
/**
 * 200 机柜容量与性能测试
 *
 * 走真实导入路径：生成 200 柜的长表 CSV → 贴进「粘贴数据」→ 解析 → 渲染。
 * 验证：
 *   - 单机房 200 柜上限可用
 *   - 任何阈值下顶点数 ≤ 300,000
 *   - 连续拖动阈值 ≥ 30fps
 */
import fs from "node:fs";
import path from "node:path";
import { launch, openApp, parseArgs, clickTab, hud, DEFAULT_URL } from "./common.mjs";

const args = parseArgs();
const URL = args.url || DEFAULT_URL;
const OUT = args.out || "tests/e2e/shots";
fs.mkdirSync(OUT, { recursive: true });

/** 在浏览器里生成 200 柜 CSV（5 排 × 40 列），并返回文本 */
const CSV_GEN = String.raw`
(() => {
  const FACE_COLS = 6, FACE_ROWS = 6;
  const rows = 5, cols = 40;
  let a = 20261123 >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const load = Array.from({ length: rows * cols }, () => 0.35 + rand() * 0.45);
  const hot = [];
  for (let i = 0; i < 16; i++) {
    hot.push({ r: rand() * (rows - 1), c: rand() * (cols - 1), p: 4 + rand() * 9, rad: 1.2 + rand() * 1.8 });
  }
  const lines = ["rack_id,row,col,facing,face,x,y,temp"];
  for (let r = 0; r < rows; r++) {
    const facing = r % 2 === 0 ? "+Z" : "-Z";
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const id = "R" + String(r + 1).padStart(2, "0") + "-" + String(c + 1).padStart(2, "0");
      for (const face of ["intake", "exhaust"]) {
        let base = (face === "intake" ? 22.5 : 34.5) + load[idx] * (face === "intake" ? 4.5 : 11.0);
        for (const h of hot) {
          const d = Math.hypot(r - h.r, c - h.c);
          base += h.p * Math.exp(-(d * d) / (h.rad * h.rad)) * (face === "exhaust" ? 1.0 : 0.22);
        }
        for (let y = 0; y < FACE_ROWS; y++) {
          for (let x = 0; x < FACE_COLS; x++) {
            let t = base + (y / (FACE_ROWS - 1)) * (face === "exhaust" ? 5.5 : 2.2);
            t += Math.sin((x / (FACE_COLS - 1)) * Math.PI) * 1.1 + (rand() - 0.5) * 1.4;
            lines.push([id, r, c, facing, face, x, y, t.toFixed(2)].join(","));
          }
        }
      }
    }
  }
  return lines.join("\n");
})()
`;

const results = { ok: true, steps: [] };
function step(name, detail = {}) {
  results.steps.push({ name, ...detail });
  console.log(`  ✓ ${name}${detail.note ? " — " + detail.note : ""}`);
}
function fail(m) {
  results.ok = false;
  console.log(`  ✗ ${m}`);
}

const browser = await launch({ tag: "stress" });
try {
  const { page, errors, gpuErrors } = await openApp(browser, URL);

  // 导入 200 柜数据
  await clickTab(page, "温度采样");
  const csvText = await page.evaluate(CSV_GEN);
  console.log("  · 生成 CSV 长度:", csvText.length);
  await page.evaluate((csv) => {
    const ta = document.querySelector(".textarea");
    ta.value = csv;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, csvText);
  // 等 Vue 把按钮从 disabled 里放出来
  await new Promise((r) => setTimeout(r, 400));
  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll(".btn")).find(
      (b) => b.textContent.trim() === "解析"
    );
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  console.log("  · 点击解析:", clicked);
  await page.waitForFunction(
    () => {
      const dd = Array.from(document.querySelectorAll(".summary dd"));
      return dd.length >= 2;
    },
    { timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 4000));

  // 从引擎读取实际装载的机柜数（比 DOM 摘要更可靠）
  await page.waitForFunction(
    () => window.__thermalEngine?.getLayout()?.boxes?.length === 200,
    { timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 2500));
  const summary = await page.evaluate(() => {
    const eng = window.__thermalEngine;
    const layout = eng.getLayout();
    const grid = eng.getFieldGrid();
    return {
      racks: layout?.boxes?.length ?? 0,
      voxels: grid ? grid.dim[0] * grid.dim[1] * grid.dim[2] : 0,
      dim: grid?.dim,
      cellSize: grid?.cellSize,
    };
  });
  step("导入 200 柜", { note: JSON.stringify(summary) });
  if (Number(summary.racks) !== 200) fail(`期望 200 柜，实际 ${summary.racks}`);

  // 等场景重建完成
  await page.waitForFunction(
    () => {
      const v = document.querySelectorAll(".hud-item .hud-value")[1];
      return v && v.textContent.trim() !== "0";
    },
    { timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 1500));

  await clickTab(page, "等值面");
  const setT = (v) =>
    page.evaluate((val) => {
      const s = document.querySelector(".slider");
      s.value = String(val);
      s.dispatchEvent(new Event("input", { bubbles: true }));
    }, v);

  const scan = [];
  for (const t of [26, 30, 35, 40, 45, 50, 55]) {
    await setT(t);
    await new Promise((r) => setTimeout(r, 1000));
    const h = await hud(page);
    const verts = Number((h["等值面顶点"] || "0").replace(/,/g, ""));
    scan.push({ t, verts, fps: h["FPS"] });
    if (verts > 300000) fail(`阈值 ${t} 顶点超限：${verts}`);
  }
  step("200 柜阈值扫描", { note: JSON.stringify(scan) });

  // 连续拖动
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
    return { frames, fps: (frames * 1000) / (performance.now() - t0) };
  });
  step("200 柜连续拖动", { note: `${sweep.fps.toFixed(1)} fps` });
  if (sweep.fps < 30) fail(`拖动帧率 ${sweep.fps.toFixed(1)}fps 低于 30`);

  await page.screenshot({ path: path.join(OUT, "stress-200.png") });

  if (errors.length) fail(`控制台错误：${errors[0]?.slice(0, 200)}`);
  if (gpuErrors.length) fail(`GPU 错误：${gpuErrors[0]?.slice(0, 300)}`);
} catch (e) {
  fail(e.message || String(e));
  results.fatal = String(e.stack || e);
} finally {
  fs.writeFileSync(path.join(OUT, "stress-report.json"), JSON.stringify(results, null, 2));
  await browser.close();
}

console.log(`\n结果：${results.ok ? "PASS" : "FAIL"}`);
process.exit(results.ok ? 0 : 1);
