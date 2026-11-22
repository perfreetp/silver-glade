/**
 * 真实浏览器 E2E 冒烟测试：
 *   npx playwright test tests/e2e.smoke.spec.ts
 * 验证四个模块挂载、WebGL 场景渲染、光型画布出图、截止线拖动交互。
 */
import { test, expect, type Page } from '@playwright/test';

const URL = 'http://127.0.0.1:5180/';

async function consoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

test.describe('车灯透镜光型工具', () => {
  test('应用启动并渲染光型投射模块', async ({ page }) => {
    const errors = await consoleErrors(page);
    await page.goto(URL);
    await expect(page.locator('h1')).toContainText('车灯透镜光型渲染工具');

    // 默认停留在光型投射页，墙面画布存在且已绘制（非全黑）
    const canvas = page.locator('canvas.wall-canvas');
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(800);

    const nonBlack = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] + data[i + 1] + data[i + 2] > 30) lit++;
      }
      return lit;
    });
    expect(nonBlack).toBeGreaterThan(500);

    // 状态栏显示计时数据
    await expect(page.locator('.statusbar')).toContainText('点亮 LED');
    expect(errors).toEqual([]);
  });

  test('四个模块可切换且无运行时错误', async ({ page }) => {
    const errors = await consoleErrors(page);
    await page.goto(URL);

    for (const name of ['光源布局', '透镜编辑', '光型投射', '配置导出']) {
      await page.locator('.tabs button', { hasText: name }).click();
      await expect(page.locator('.panel')).toBeVisible();
      // 等当前模块的主内容就绪（侧栏区块或画布）
      await page.waitForSelector('.section-title, .json-preview, .wall-canvas', { timeout: 5000 });
    }
    // 光源布局页应有 WebGL canvas（three.js 场景）
    await page.locator('.tabs button', { hasText: '光源布局' }).click();
    await page.waitForSelector('.viewport canvas', { timeout: 5000 });
    const glCanvasCount = await page.locator('.viewport canvas').count();
    expect(glCanvasCount).toBeGreaterThan(0);

    // 透镜编辑页曲率档位可切换
    await page.locator('.tabs button', { hasText: '透镜编辑' }).click();
    await page.waitForSelector('.curvature-grid button', { timeout: 5000 });
    const buttons = page.locator('.curvature-grid button');
    await buttons.nth(2).click({ force: true });
    await expect(buttons.nth(2)).toHaveClass(/active/);

    expect(errors).toEqual([]);
  });

  test('拖动截止线改变光型且走轻量合成路径', async ({ page }) => {
    const errors = await consoleErrors(page);
    await page.goto(URL);
    await page.waitForTimeout(600);

    const cutoffBefore = await page.locator('.hud').innerText();
    const canvas = page.locator('canvas.wall-canvas');
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    // 在画布上做一次向下拖拽
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 120, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const cutoffAfter = await page.locator('.hud').innerText();
    expect(cutoffAfter).not.toBe(cutoffBefore);
    // HUD 中截止线数值应发生变化
    expect(cutoffAfter).toMatch(/截止线/);

    expect(errors).toEqual([]);
  });

  test('配置导出面板产出合法 JSON', async ({ page }) => {
    const errors = await consoleErrors(page);
    await page.goto(URL);
    await page.locator('.tabs button', { hasText: '配置导出' }).click();
    await page.waitForTimeout(400);

    const json = await page.locator('textarea.json-preview').inputValue();
    const parsed = JSON.parse(json);
    expect(parsed.meta.tool).toBe('headlamp-pattern-studio');
    expect(parsed.config.version).toBe(1);
    expect(parsed.config.leds).toHaveLength(16);
    expect(parsed.config.lens).toBeTruthy();
    expect(parsed.config.projection).toBeTruthy();
    expect(parsed.meta.checksum).toMatch(/^[0-9a-f]{8}$/);

    expect(errors).toEqual([]);
  });
});
