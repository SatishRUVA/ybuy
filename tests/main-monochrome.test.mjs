import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from '@playwright/test';

test('main interface stays neutral while photos and celebration confetti retain color', async () => {
  const css = (await readFile(new URL('../src/main-site/ybuy-design.css', import.meta.url), 'utf8'))
    .replace(/^@import .*;$/gm, '');
  const layout = (await readFile(new URL('../src/main-site/index.css', import.meta.url), 'utf8'))
    .replace(/^@tailwind .*;$/gm, '');
  const feedback = await readFile(new URL('../src/main-site/components/success-feedback.tsx', import.meta.url), 'utf8');
  const colors = feedback.match(/'--particle-color': \[([^\]]+)\]/)[1].match(/#[a-fA-F0-9]{6}/g);
  assert.ok(colors.length >= 5);
  const browser = await chromium.launch({ args: ['--disable-lcd-text'] });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html data-theme="main"><body style="margin:0;min-height:1800px">
      <button style="background:var(--accent);color:var(--accent-text)">Action</button>
      <div class="bid-banner"><div class="bid-banner-inner">
        <div class="bid-banner-heading"><h2>Live auctions</h2></div>
        <div class="bid-card"><span class="bid-card-badge-hot">Hot</span></div>
      </div></div>
      <img alt="Colorful fixture" width="100" height="100"
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cpath fill='red' d='M0 0h100v100H0z'/%3E%3C/svg%3E">
      <div data-confetti>${colors.map(color => `<span style="display:inline-block;width:20px;height:20px;background:${color}"></span>`).join('')}</div>
      <div role="dialog" style="position:fixed;bottom:0;right:0;background:var(--bg-card);color:var(--text);padding:20px">Portal dialog</div>
    </body></html>`);
    await page.addStyleTag({ content: css });
    await page.addStyleTag({ content: layout });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(() => window.scrollTo(0, 400));
      const box = await page.getByRole('dialog').boundingBox();
      assert.equal(Math.round(box.y + box.height), 800);
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.locator('html').evaluate(root => getComputedStyle(root).filter), 'none');
      assert.ok(await countColoredPixels(page, await page.screenshot()) > 1000, 'Photo and confetti must retain color');
      assert.ok(await countColoredPixels(page, await page.locator('[data-confetti]').screenshot()) > 500,
        'Celebration particles must retain color');
      for (const selector of ['button', '.bid-banner', '[role="dialog"]']) {
        assert.equal(await countColoredPixels(page, await page.locator(selector).screenshot()), 0,
          `Interface color in ${selector} at ${width}px`);
      }
    }
    await page.locator('html').evaluate(root => { root.dataset.theme = 'preview-one'; });
    assert.equal(await page.locator('html').evaluate(root => getComputedStyle(root).filter), 'none');
    assert.ok(await countColoredPixels(page, await page.screenshot()) > 1000,
      'Preview media and accents must retain color');
  } finally {
    await browser.close();
  }
});

async function countColoredPixels(page, screenshot) {
  return page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let colored = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 1) colored++;
    }
    return colored;
  }, screenshot.toString('base64'));
}
