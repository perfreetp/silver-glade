import { test } from '@playwright/test';
test('capture four modules', async ({ page }) => {
  await page.goto('http://127.0.0.1:5180/');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/shot-projection.png' });
  for (const [name, file] of [['光源布局','light'],['透镜编辑','lens'],['配置导出','export']] as const) {
    await page.locator('.tabs button', { hasText: name }).click();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `tests/shot-${file}.png` });
  }
});
