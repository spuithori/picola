import { expect, test, type Page } from '@playwright/test';

const viewer = (page: Page) => page.locator('.pcl');
const activeImg = (page: Page, name: string) => page.locator(`.pcl__img[src*="${name}"]`);

async function openAt(page: Page, index: number) {
	await page.getByTestId(`thumb-${index}`).click();
	await expect(viewer(page)).toBeVisible();
	await expect(activeImg(page, `full-${index}`)).toBeVisible();
}

test('opens from a thumbnail and closes with Escape', async ({ page }) => {
	await page.goto('/');
	await openAt(page, 0);
	await page.keyboard.press('Escape');
	await expect(viewer(page)).toHaveCount(0);
});

test('backdrop click closes without the double-tap delay', async ({ page }) => {
	await page.goto('/');
	await openAt(page, 0);
	await page.waitForTimeout(400);
	const started = Date.now();
	await page.mouse.click(150, 120);
	await expect(viewer(page)).toHaveCount(0);
	expect(Date.now() - started).toBeLessThan(600);
});

test('reopens from a thumbnail immediately after closing', async ({ page }) => {
	await page.goto('/');
	await openAt(page, 0);
	await page.keyboard.press('Escape');
	await page.getByTestId('thumb-1').click();
	await expect(viewer(page)).toBeVisible();
	await expect(activeImg(page, 'full-1')).toBeVisible();
});

test('clicks pass through the closing overlay and reopen', async ({ page }) => {
	await page.goto('/');
	await openAt(page, 0);
	await page.waitForTimeout(400);
	await page.mouse.click(150, 120);
	await page.getByTestId('thumb-2').click();
	await expect(viewer(page)).toBeVisible();
	await expect(activeImg(page, 'full-2')).toBeVisible();
});

test('reopens immediately after a drag dismiss', async ({ page }) => {
	await page.goto('/');
	await openAt(page, 0);
	await page.waitForTimeout(500);
	await page.mouse.move(500, 300);
	await page.mouse.down();
	for (let y = 300; y <= 620; y += 40) {
		await page.mouse.move(500, y);
	}
	await page.mouse.up();
	await page.getByTestId('thumb-1').click();
	await expect(viewer(page)).toBeVisible();
	await expect(activeImg(page, 'full-1')).toBeVisible();
});

test('history mode survives an immediate reopen and back still closes', async ({ page }) => {
	await page.goto('/?history=1');
	await openAt(page, 0);
	await page.keyboard.press('Escape');
	await page.getByTestId('thumb-1').click();
	await expect(activeImg(page, 'full-1')).toBeVisible();
	await page.waitForTimeout(500);
	await expect(viewer(page)).toBeVisible();
	await page.goBack();
	await expect(viewer(page)).toHaveCount(0);
});

test('arrow keys navigate and update the counter', async ({ page }) => {
	await page.goto('/');
	await openAt(page, 0);
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('.pcl__counter')).toHaveText(/2 \/ 6/);
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('.pcl__counter')).toHaveText(/1 \/ 6/);
});

test('wheel zooms by default and grows the rendered scale', async ({ page }) => {
	await page.goto('/');
	await openAt(page, 0);
	const scaleOf = async () => {
		const transform = await page.locator('.pcl__content').first().evaluate((el) => getComputedStyle(el).transform);
		return new DOMMatrix(transform).a;
	};
	await page.waitForTimeout(500);
	const before = await page.locator('.pcl__content').first().evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
	await page.mouse.move(500, 350);
	await page.mouse.wheel(0, -300);
	await page.waitForTimeout(200);
	const after = await page.locator('.pcl__content').first().evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
	expect(after).toBeGreaterThan(before * 1.2);
	void scaleOf;
});

test('wheel=navigate moves between slides instead of zooming', async ({ page }) => {
	await page.goto('/?wheel=navigate');
	await openAt(page, 0);
	await page.mouse.move(500, 350);
	await page.mouse.wheel(0, 240);
	await expect(page.locator('.pcl__counter')).toHaveText(/2 \/ 6/);
});

test('double click zooms in and out', async ({ page }) => {
	await page.goto('/');
	await openAt(page, 0);
	await page.waitForTimeout(500);
	const scale = () =>
		page.locator('.pcl__content').first().evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
	const fit = await scale();
	await page.mouse.dblclick(500, 350);
	await expect.poll(scale).toBeGreaterThan(fit * 1.5);
	await page.mouse.dblclick(500, 350);
	await expect.poll(scale).toBeLessThan(fit * 1.2);
});

test('dragging down dismisses the viewer', async ({ page }) => {
	await page.goto('/');
	await openAt(page, 0);
	await page.waitForTimeout(500);
	await page.mouse.move(500, 300);
	await page.mouse.down();
	for (let y = 300; y <= 620; y += 40) {
		await page.mouse.move(500, y);
	}
	await page.mouse.up();
	await expect(viewer(page)).toHaveCount(0);
});

test('source upgrades keep the previous image as underlay', async ({ page }) => {
	await page.goto('/');
	await openAt(page, 0);
	await page.waitForTimeout(400);
	await page.evaluate(() => (window as any).__fixture.upgrade(0, '/img/full-5.png'));
	await expect(page.locator('.pcl__placeholder[src*="full-0"]')).toBeVisible();
	await expect(activeImg(page, 'full-5')).toBeVisible();
	await expect(page.locator('.pcl__placeholder')).toHaveCount(0);
});

test('source upgrade keeps the same <img> element (Firefox flash guard)', async ({ page }) => {
	await page.goto('/');
	await openAt(page, 0);
	await page.waitForTimeout(400);
	await page.evaluate(() => {
		const img = document.querySelector('.pcl__content[aria-label^="1 /"] img.pcl__img') as HTMLElement;
		img.dataset.mark = 'orig';
	});
	await page.evaluate(() => (window as any).__fixture.upgrade(0, '/img/full-5.png'));
	await expect(page.locator('.pcl__img[src*="full-5"]:not(.pcl__img--pending)')).toBeVisible();
	const mark = await page.evaluate(
		() => (document.querySelector('.pcl__content[aria-label^="1 /"] img.pcl__img') as HTMLElement)?.dataset.mark
	);
	expect(mark).toBe('orig');
});

test('loop mode crosses the seam backwards', async ({ page }) => {
	await page.goto('/?loop=1');
	await openAt(page, 0);
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('.pcl__counter')).toHaveText(/6 \/ 6/);
	await expect(activeImg(page, 'full-5')).toBeVisible();
});

test('reduced motion opens without a transition delay', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');
	await page.getByTestId('thumb-0').click();
	await expect(viewer(page)).toBeVisible();
	await expect(page.locator('.pcl__backdrop')).toHaveCSS('opacity', '0.9', { timeout: 500 });
});

test('focus stays trapped inside the dialog', async ({ page }) => {
	await page.goto('/');
	await openAt(page, 0);
	await page.waitForTimeout(400);
	for (let i = 0; i < 12; i++) {
		await page.keyboard.press('Tab');
		const inside = await page.evaluate(() => document.querySelector('.pcl')?.contains(document.activeElement) ?? false);
		expect(inside).toBe(true);
	}
});
