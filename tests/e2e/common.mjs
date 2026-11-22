/**
 * e2e 公共工具：启动带 WebGPU 的 Chrome、等待引擎就绪。
 */
import puppeteer from "puppeteer-core";
import path from "node:path";

export const DEFAULT_URL = process.env.APP_URL || "http://127.0.0.1:4173/";
export const CHROME =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

export async function launch({ width = 1440, height = 900, tag = "e2e" } = {}) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    args: [
      "--headless=new",
      "--enable-unsafe-webgpu",
      "--no-sandbox",
      "--disable-gpu-sandbox",
      `--window-size=${width},${height}`,
      `--user-data-dir=${path.join(process.env.TEMP || "/tmp", `${tag}-${process.pid}-${Date.now()}`)}`,
    ],
    defaultViewport: { width, height },
  });
  return browser;
}

/** 打开应用并等待 WebGPU 引擎就绪；返回 { page, logs } */
export async function openApp(browser, url = DEFAULT_URL) {
  const page = await browser.newPage();
  const errors = [];
  const gpuErrors = [];
  page.on("pageerror", (e) => errors.push(String(e.stack || e)));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !t.includes("favicon") && !t.includes("Failed to load resource")) {
      errors.push(t);
    }
    if (t.includes("GPUValidationError") || t.includes("Error while parsing WGSL")) {
      gpuErrors.push(t);
    }
  });

  await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForFunction(() => !document.querySelector(".viewport__boot"), { timeout: 45000 });
  // 等待首帧渲染与等值面回读
  await page.waitForFunction(
    () => {
      const items = Array.from(document.querySelectorAll(".hud-item .hud-value"));
      return items.length > 0 && items[1]?.textContent?.trim() !== "0";
    },
    { timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 1200));
  return { page, errors, gpuErrors };
}

export function assert(cond, message) {
  if (!cond) throw new Error(message);
}

export async function hud(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll(".hud-item")).map((el) => [
        el.querySelector(".hud-label")?.textContent?.trim() ?? "",
        el.querySelector(".hud-value")?.textContent?.trim() ?? "",
      ])
    )
  );
}

export async function clickTab(page, label) {
  await page.evaluate((txt) => {
    const tabs = Array.from(document.querySelectorAll(".tab"));
    const t = tabs.find((el) => el.textContent.includes(txt));
    t?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, label);
  await new Promise((r) => setTimeout(r, 400));
}
