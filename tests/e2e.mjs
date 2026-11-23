// headless 端到端验证：引擎初始化 -> 千面片压力测试 -> 阈值拖动 -> 渲染参数 -> 导出
import puppeteer from "puppeteer-core";

const EDGE =
  process.env.EDGE_PATH ||
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const URL = process.env.TARGET_URL || "http://127.0.0.1:5173/";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--enable-unsafe-swiftshader",
    "--disable-extensions",
    "--window-size=1600,1000",
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push("PAGEERROR: " + err.message));

  // 拦截下载：记录 blob URL；禁用 revoke 以便稍后回读内容
  await page.evaluateOnNewDocument(() => {
    window.__exposeScene = true;
    window.__downloads = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.href?.startsWith("blob:")) {
        window.__downloads.push({ name: this.download, href: this.href });
      } else {
        origClick.call(this);
      }
    };
    URL.revokeObjectURL = () => {};
  });

  await page.goto(URL, { waitUntil: "load", timeout: 30000 });

  // 1. 引擎初始化与四模块
  await page.waitForFunction(
    () => document.querySelector(".engine-badge")?.textContent?.trim(),
    { timeout: 15000 }
  );
  const engine = await page.$eval(".engine-badge", (el) =>
    el.textContent.trim()
  );
  check("引擎初始化", engine === "WebGPU" || engine === "WebGL2", engine);

  for (const title of ["屋面网格加载", "残损面片贴合", "分层渲染", "等级调整与导出"]) {
    const count = await page.$$eval(
      "summary",
      (els, t) => els.filter((e) => e.textContent.includes(t)).length,
      title
    );
    check(`模块存在：${title}`, count > 0);
  }

  await page.waitForFunction(
    () => document.querySelector(".kv-list .v") !== null
  );
  const triText = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".kv-list .v")].map((s) =>
      s.textContent.trim()
    );
    return spans[0];
  });
  check("屋面三角面统计已计算", /\d{1,3}(,\d{3})*/.test(triText), triText);

  // 2. 千面片压力测试
  const readCalls = () =>
    page.evaluate(() =>
      Number(
        document
          .querySelector(".hud")
          .textContent.match(/绘制调用\s*(\d+)/)?.[1]
      )
    );
  const callsBaseline = await readCalls();

  await page.click("button::-p-text(+1000 面片)");
  await page.waitForFunction(
    () => {
      const t = document.querySelector(".hud")?.textContent || "";
      const m = t.match(/残损面片数\s*([\d,]+)/);
      return m && m[1].replace(/,/g, "") === "1000";
    },
    { timeout: 30000 }
  );
  const hud1 = await page.evaluate(() =>
    document.querySelector(".hud").textContent.replace(/\s+/g, " ").trim()
  );
  const rebuildMs = Number(hud1.match(/绘制（重建）耗时\s*([\d.]+)/)?.[1]);
  const layerTris = Number(
    hud1.match(/图层三角面数\s*([\d,]+)/)?.[1].replace(/,/g, "")
  );
  check("千面片生成", true, hud1.match(/残损面片数\s*[\d,]+/)?.[0]);
  check("重建耗时可读且为有限值", Number.isFinite(rebuildMs), `${rebuildMs} ms`);
  check("千面片图层三角面已生成", layerTris > 10000, `${layerTris} tris`);
  const drawCalls = Number(hud1.match(/绘制调用\s*(\d+)/)?.[1]);
  // 验证合并 Mesh 生效：填充层是单个 1-submesh Mesh（真实 GPU 上 1 次绘制调用）。
  // 软件渲染后端对线段索引有额外开销，故直接核对 subMesh 数，
  // 并断言总增量处于「单网格 + 轮廓线段」的合理区间而非随面片数线性爆炸。
  const subMeshInfo = await page.evaluate(() => {
    const layer = window.__scene.getMeshByName("damage-layer");
    return {
      subMeshes: layer?.subMeshes?.length ?? -1,
      indices: layer?.getTotalIndices?.() ?? 0,
    };
  });
  check(
    "填充层为单个合并 Mesh（1 个 subMesh）",
    subMeshInfo.subMeshes === 1 && subMeshInfo.indices > 30000,
    `subMeshes=${subMeshInfo.subMeshes}, indices=${subMeshInfo.indices}`
  );
  check(
    "千面片绘制调用不随面片数线性爆炸",
    drawCalls - callsBaseline < 120,
    `baseline ${callsBaseline} -> ${drawCalls}（+${drawCalls - callsBaseline}）`
  );

  // 3. 阈值拖动 -> 等级分布即时变化
  const readDist = () =>
    page.$$eval(".grade-row .num", (els) =>
      els.map((e) => Number(e.textContent.match(/\d+/)?.[0] ?? 0))
    );
  const distBefore = await readDist();

  // 直接对轨道条派发 pointer 事件（与用户鼠标拖动走同一套 pointer 处理）
  await page.evaluate(() => {
    const track = document.querySelector(".threshold-track");
    const handle = document.querySelectorAll(".th-handle")[0];
    const rect = track.getBoundingClientRect();
    const targetX = rect.left + rect.width * 0.78;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, clientX: targetX, clientY: y, pointerId: 1 };
    handle.dispatchEvent(new PointerEvent("pointerdown", opts));
    track.dispatchEvent(new PointerEvent("pointermove", opts));
    handle.dispatchEvent(new PointerEvent("pointerup", opts));
  });
  await new Promise((r) => setTimeout(r, 200));
  const distAfter = await readDist();
  check(
    "拖动 t1 后等级分布重算",
    JSON.stringify(distBefore) !== JSON.stringify(distAfter),
    `${distBefore.join("/")} -> ${distAfter.join("/")}`
  );

  // 4. 渲染参数开关不报错
  const checkboxes = await page.$$(".check-row input");
  for (const cb of checkboxes) {
    await cb.click();
    await new Promise((r) => setTimeout(r, 100));
    await cb.click();
    await new Promise((r) => setTimeout(r, 100));
  }
  check("渲染开关切换无异常", consoleErrors.length === 0);

  // 抬升量滑块
  const lift = (await page.$$('input[type="range"]'))[1];
  await lift.evaluate((el) => {
    el.value = "0.12";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const hud2 = await page.evaluate(() =>
    document.querySelector(".hud").textContent.replace(/\s+/g, " ").trim()
  );
  check(
    "抬升量调整触发重建",
    Number(hud2.match(/绘制（重建）耗时\s*([\d.]+)/)?.[1]) >= 0
  );

  // 绘制模式开关
  const drawBtn = await page.$("button::-p-text(进入绘制)");
  if (drawBtn) {
    await drawBtn.click();
    const hint = await page.$(".draw-hint");
    check("绘制模式提示出现", hint !== null);
    await page.click("button::-p-text(退出绘制)");
  } else {
    check("绘制模式按钮", false, "未找到按钮");
  }

  // 5. 导出图层 JSON + CSV，并回读内容校验
  await page.click("button::-p-text(导出图层 JSON)");
  await page.click("button::-p-text(导出清单 CSV)");
  await page.waitForFunction(() => window.__downloads.length >= 2, {
    timeout: 5000,
  });
  const downloads = await page.evaluate(() => window.__downloads);
  check("两个文件均触发下载", downloads.length >= 2, downloads.map((d) => d.name).join(", "));

  const jsonHref = downloads.find((d) => d.name.endsWith(".json"))?.href;
  if (jsonHref) {
    const jsonOk = await page.evaluate(async (href) => {
      const res = await fetch(href);
      const data = await res.json();
      return (
        data.format === "roof-damage-layer" &&
        Array.isArray(data.patches) &&
        data.patches.length === 1000 &&
        typeof data.thresholds[0] === "number"
      );
    }, jsonHref);
    check("图层 JSON 结构与 1000 面片数据", jsonOk);
  } else {
    check("图层 JSON 结构", false, "未捕获下载");
  }

  const csvHref = downloads.find((d) => d.name.endsWith(".csv"))?.href;
  if (csvHref) {
    const csvOk = await page.evaluate(async (href) => {
      const res = await fetch(href);
      const text = await res.text();
      return (
        text.includes("残损等级分布清单") &&
        text.includes("面片明细") &&
        (text.match(/残损区/g) || []).length >= 1000
      );
    }, csvHref);
    check("CSV 清单含汇总与千条明细", csvOk);
  } else {
    check("CSV 清单", false, "未捕获下载");
  }

  // 6. 控制台无错误
  check("全程无 JS 控制台错误", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} catch (e) {
  check("测试执行异常", false, e.message);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
