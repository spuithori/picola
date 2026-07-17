import { expect, test, type Page } from '@playwright/test';

const viewer = (page: Page) => page.locator('.pcl');
const pane = (page: Page) => page.getByTestId('inline-pane');

async function paneCenter(page: Page) {
	const box = await pane(page).boundingBox();
	if (!box) throw new Error('inline pane not found');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

test.beforeEach(async ({ page }) => {
	await page.goto('/?inline=1');
	await expect(viewer(page)).toBeVisible();
});

test('renders embedded inside the pane, not portalled to body', async ({ page }) => {
	await expect(viewer(page)).toHaveClass(/pcl--inline/);
	await expect(pane(page).locator('.pcl')).toHaveCount(1);
	const parentTag = await viewer(page).evaluate((el) => el.parentElement?.tagName);
	expect(parentTag).not.toBe('BODY');
	await expect(viewer(page)).toHaveAttribute('role', 'region');
	await expect(viewer(page)).not.toHaveAttribute('aria-modal');
});

test('viewport geometry matches the pane bounds', async ({ page }) => {
	const paneBox = await pane(page).boundingBox();
	const viewportBox = await page.locator('.pcl__viewport').boundingBox();
	expect(viewportBox).not.toBeNull();
	expect(Math.abs(viewportBox!.x - paneBox!.x)).toBeLessThan(2);
	expect(Math.abs(viewportBox!.y - paneBox!.y)).toBeLessThan(2);
	expect(Math.abs(viewportBox!.width - paneBox!.width)).toBeLessThan(2);
	expect(Math.abs(viewportBox!.height - paneBox!.height)).toBeLessThan(2);
});

test('does not lock body scroll and the page stays scrollable', async ({ page }) => {
	const overflow = await page.evaluate(() => document.body.style.overflow);
	expect(overflow).toBe('');
	await page.mouse.move(300, 600);
	await page.mouse.wheel(0, 400);
	await expect
		.poll(() => page.evaluate(() => window.scrollY))
		.toBeGreaterThan(0);
});

test('Escape does not tear the viewer down', async ({ page }) => {
	const { x, y } = await paneCenter(page);
	await page.mouse.click(x, y);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(300);
	await expect(viewer(page)).toBeVisible();
});

test('arrow keys are scoped to the viewer', async ({ page }) => {
	await page.getByTestId('outside').focus();
	await page.keyboard.press('ArrowRight');
	await page.waitForTimeout(200);
	await expect(page.locator('.pcl__counter')).toHaveText(/1 \/ 6/);

	const { x, y } = await paneCenter(page);
	await page.mouse.click(x, y);
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('.pcl__counter')).toHaveText(/2 \/ 6/);
});

test('horizontal drag pages between slides', async ({ page }) => {
	const { x, y } = await paneCenter(page);
	await page.waitForTimeout(400);
	await page.mouse.move(x + 150, y);
	await page.mouse.down();
	for (let dx = 150; dx >= -150; dx -= 30) {
		await page.mouse.move(x + dx, y);
	}
	await page.mouse.up();
	await expect(page.locator('.pcl__counter')).toHaveText(/2 \/ 6/);
});

test('vertical drag does not dismiss', async ({ page }) => {
	const { x, y } = await paneCenter(page);
	await page.waitForTimeout(400);
	await page.mouse.move(x, y - 100);
	await page.mouse.down();
	for (let dy = -100; dy <= 120; dy += 30) {
		await page.mouse.move(x, y + dy);
	}
	await page.mouse.up();
	await page.waitForTimeout(300);
	await expect(viewer(page)).toBeVisible();
	await expect(page.locator('.pcl__counter')).toHaveText(/1 \/ 6/);
});

test('wheel zoom grows the rendered scale inside the pane', async ({ page }) => {
	const { x, y } = await paneCenter(page);
	await page.waitForTimeout(400);
	const scaleOf = () =>
		page
			.locator('.pcl__content')
			.first()
			.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
	const before = await scaleOf();
	await page.mouse.move(x, y);
	await page.mouse.wheel(0, -300);
	await page.waitForTimeout(200);
	const after = await scaleOf();
	expect(after).toBeGreaterThan(before * 1.2);
});

test('double click zooms in and back out', async ({ page }) => {
	const { x, y } = await paneCenter(page);
	await page.waitForTimeout(400);
	const scaleOf = () =>
		page
			.locator('.pcl__content')
			.first()
			.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
	const initial = await scaleOf();
	await page.mouse.dblclick(x, y);
	await page.waitForTimeout(400);
	const zoomed = await scaleOf();
	expect(zoomed).toBeGreaterThan(initial * 1.5);
	await page.mouse.dblclick(x, y);
	await page.waitForTimeout(400);
	const restored = await scaleOf();
	expect(Math.abs(restored - initial)).toBeLessThan(initial * 0.1);
});

test('has no built-in close button', async ({ page }) => {
	await expect(page.locator('.pcl__button[aria-label="Close"]')).toHaveCount(0);
});
