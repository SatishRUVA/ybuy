import { expect, test } from '@playwright/test';

const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" />
<script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => type => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script><script type="module">import '/src/index.css'; import '/src/styles/preview-one.css';</script></head><body></body></html>`;

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 600 }, { width: 320, height: 480 }]) {
 for (const footerMode of ['separate', 'form']) {
  test(`cards and ${footerMode} dialog actions remain consistent at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/__card-dialog-fixture', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    await page.goto('/__card-dialog-fixture');
    await page.waitForFunction(() => window.__vite_plugin_react_preamble_installed__ === true);
    await page.evaluate(async (mode) => {
      const { createElement: h, mountComponent } = await import('/tests/component-mount.tsx');
      const { Modal, Button } = await import('/src/preview-1/ui.tsx');
      const { AuctionCard } = await import('/src/preview-1/bidding.tsx');
      const { ListingCard } = await import('/src/components/listing-card.tsx');
      const { listings } = await import('/src/data.ts');
      const saved = () => { document.body.dataset.saved = 'true'; };
      mountComponent(() => h('div', { className: 'p1' },
        h('div', { className: 'p1-container p1-item-grid' },
          h(ListingCard, { listing: listings[0] }),
          h(AuctionCard, { id: 'test', title: 'Weekend camera rental', category: 'Electronics', price: 35, image: h('img', { alt: '', src: listings[0].images[0] }), countdown: '2h remaining', status: 'Live', owner: 'Test owner' }),
          h('div', { className: 'p1-community-grid' }, h('article', null, h('h2', null, 'Looking for a camera'), h('div', { className: 'p1-request-person' }, h(Button, null, 'List an item'))))),
        h(Modal, { open: true, onClose: () => {}, title: 'Responsive form', description: 'Long content must scroll without hiding the actions.',
          footer: mode === 'separate' ? h(Button, { onClick: saved }, 'Save changes') : undefined },
        h('form', { onSubmit: event => { event.preventDefault(); saved(); } },
          ...Array.from({ length: 20 }, (_, i) => h('label', { key: i }, `Field ${i + 1}`, h('input', { 'aria-label': `Field ${i + 1}` }))),
          mode === 'form' ? h('div', { className: 'p1-dialog-footer' }, h(Button, { type: 'submit' }, 'Save changes')) : null))));
    }, footerMode);
    const dialog = page.getByRole('dialog', { name: 'Responsive form' });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    const body = dialog.locator('.p1-dialog-body');
    expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    const save = dialog.getByRole('button', { name: 'Save changes' });
    await expect(save).toBeInViewport({ ratio: 1 });
    await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.getByRole('heading', { name: 'Responsive form' })).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport({ ratio: 1 });
    await save.click();
    await expect(page.locator('body')).toHaveAttribute('data-saved', 'true');
    const styles = await page.locator('.p1-item, .p1-auction-card, .p1-community-grid > article').evaluateAll(elements =>
      elements.map(element => {
        const style = getComputedStyle(element);
        return { border: style.border, radius: style.borderRadius, background: style.backgroundColor, shadow: style.boxShadow };
      }));
    expect(styles).toHaveLength(3);
    expect(styles[1]).toEqual(styles[0]);
    expect(styles[2]).toEqual(styles[0]);
    await expect(page.locator('.p1-item .p1-card-bottom a')).toHaveCSS('background-color', 'rgb(49, 87, 225)');
    await expect(page.locator('.p1-auction-price a')).toHaveCSS('background-color', 'rgb(49, 87, 225)');
    await expect(save).toHaveCSS('color', 'rgb(255, 255, 255)');
    await page.screenshot({ path: test.info().outputPath('responsive-dialog.png') });
  });
 }
}
