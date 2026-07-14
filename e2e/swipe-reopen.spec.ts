import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type CDPSession, type Page } from '@playwright/test';

test.use({
	viewport: { width: 375, height: 667 },
	hasTouch: true,
	isMobile: true,
	baseURL: 'http://localhost:5991'
});

const IMG_DIR = fileURLToPath(new URL('./fixture/img', import.meta.url));
const PICSUM_IDS = [1015, 1025, 1039, 1043, 1050];
const SLIDE_COUNT = 5;
const DELAYS = [80, 150, 250, 400, 600];
const SWIPE_X = 187;
const SWIPE_Y = 260;

type TapState = { pcl: boolean; closing: boolean };
type Target = 'same' | 'other';
type Swipe = { distance: number; speed: number };
type ScenarioOptions = {
	delay: number;
	target: Target;
	imageDelayMs?: number;
	cpuThrottle?: number;
	swipe?: Swipe;
	cycles?: number;
};

const FAST_SWIPE: Swipe = { distance: 300, speed: 1500 };

async function instrument(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const log: Record<string, unknown>[] = [];
		(window as any).__evts = log;
		const describe = (node: EventTarget | null): string => {
			if (!(node instanceof Element)) return String(node);
			const cls = node.getAttribute('class');
			return node.tagName.toLowerCase() + (cls ? `.${cls.trim().split(/\s+/).join('.')}` : '');
		};
		for (const type of ['pointerdown', 'pointerup', 'click']) {
			document.addEventListener(
				type,
				(event) => {
					const target = event.target;
					log.push({
						type,
						t: Math.round(performance.now()),
						target: describe(target),
						onThumb: target instanceof Element && !!target.closest('.thumb'),
						pcl: !!document.querySelector('.pcl'),
						closing: !!document.querySelector('.pcl--closing'),
						defaultPrevented: event.defaultPrevented
					});
				},
				true
			);
		}
		const isPcl = (node: Node): node is Element => node instanceof Element && node.classList.contains('pcl');
		new MutationObserver((mutations) => {
			const t = Math.round(performance.now());
			for (const mutation of mutations) {
				if (mutation.type === 'attributes' && isPcl(mutation.target)) {
					log.push({ type: 'pcl-class', t, closing: mutation.target.classList.contains('pcl--closing') });
				}
				const parent = mutation.target instanceof Element ? mutation.target.tagName : '';
				for (const node of mutation.addedNodes) if (isPcl(node)) log.push({ type: 'pcl-added', t, parent });
				for (const node of mutation.removedNodes) if (isPcl(node)) log.push({ type: 'pcl-removed', t, parent });
			}
		}).observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ['class']
		});
	});
}

async function routePicsum(page: Page, delayMs = 0): Promise<void> {
	await page.route('**/picsum.photos/**', async (route) => {
		const segments = new URL(route.request().url()).pathname.split('/');
		const id = Number(segments[2]);
		const width = Number(segments[3]);
		const index = Math.max(0, PICSUM_IDS.indexOf(id));
		const name = width <= 700 ? `thumb-${index}.png` : `full-${index}.png`;
		const body = readFileSync(`${IMG_DIR}/${name}`);
		if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
		await route.fulfill({ status: 200, contentType: 'image/png', body });
	});
}

async function tapAt(page: Page, x: number, y: number): Promise<void> {
	await page.touchscreen.tap(x, y);
}

async function swipeDown(cdp: CDPSession, swipe: Swipe): Promise<void> {
	await cdp.send('Input.synthesizeScrollGesture', {
		x: SWIPE_X,
		y: SWIPE_Y,
		xDistance: 0,
		yDistance: swipe.distance,
		speed: swipe.speed,
		gestureSourceType: 'touch'
	});
}

async function markAndSnapshot(page: Page, label: string, extra: Record<string, unknown>): Promise<TapState> {
	return page.evaluate(
		([lbl, data]) => {
			const state = {
				pcl: !!document.querySelector('.pcl'),
				closing: !!document.querySelector('.pcl--closing')
			};
			(window as any).__evts.push({ type: lbl, t: Math.round(performance.now()), ...(data as object), ...state });
			return state;
		},
		[label, extra] as const
	);
}

async function dismissCount(page: Page): Promise<number> {
	return page.evaluate(() => {
		const log = (window as any).__evts as { type: string; closing?: boolean }[];
		let count = 0;
		let closing = false;
		for (const entry of log) {
			if (entry.type === 'pcl-class') {
				if (entry.closing && !closing) count++;
				closing = !!entry.closing;
			} else if (entry.type === 'pcl-removed') {
				closing = false;
			}
		}
		return count;
	});
}

async function failureDetails(page: Page): Promise<string> {
	const details = await page.evaluate(() => ({
		dom: {
			pcl: !!document.querySelector('.pcl'),
			closing: !!document.querySelector('.pcl--closing'),
			counter: document.querySelector('.pcl__counter')?.textContent ?? null
		},
		events: ((window as any).__evts as unknown[]).slice(-30)
	}));
	return JSON.stringify(details, null, 1);
}

async function setupPage(page: Page, context: BrowserContext, options: ScenarioOptions | null = null) {
	await instrument(page);
	await routePicsum(page, options?.imageDelayMs ?? 0);
	await page.goto('/');
	const cdp = await context.newCDPSession(page);
	await page.locator('.thumb').nth(1).waitFor();
	await page.evaluate(() => {
		const grid = document.querySelector('.grid') as HTMLElement;
		window.scrollTo(0, grid.getBoundingClientRect().top + window.scrollY - 8);
	});
	const centers: { x: number; y: number }[] = [];
	for (const i of [0, 1]) {
		const box = await page.locator('.thumb').nth(i).boundingBox();
		if (!box) throw new Error(`thumb ${i} not visible`);
		centers.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
	}
	if (options?.cpuThrottle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpuThrottle });
	return { cdp, centers };
}

async function settleOpen(page: Page, index: number): Promise<void> {
	await expect(page.locator('.pcl')).toBeVisible({ timeout: 2000 });
	await expect(page.locator(`.pcl__img[src*="/id/${PICSUM_IDS[index]}/"]`)).toBeVisible({ timeout: 3000 });
	await page.waitForTimeout(350);
}

async function expectReopened(page: Page, index: number, label: string, tapState: TapState): Promise<void> {
	try {
		await expect(page.locator('.pcl:not(.pcl--closing)')).toBeVisible({ timeout: 1000 });
		await expect(page.locator('.pcl__counter')).toHaveText(`${index + 1} / ${SLIDE_COUNT}`, { timeout: 1500 });
		await expect(page.locator(`.pcl__img[src*="/id/${PICSUM_IDS[index]}/"]`)).toBeVisible({ timeout: 2500 });
	} catch (error) {
		throw new Error(
			`reopen failed [${label}] tapState=${JSON.stringify(tapState)}\n${await failureDetails(page)}`,
			{ cause: error }
		);
	}
}

async function runScenario(page: Page, context: BrowserContext, options: ScenarioOptions): Promise<void> {
	const swipe = options.swipe ?? FAST_SWIPE;
	const cycles = options.cycles ?? 3;
	const { cdp, centers } = await setupPage(page, context, options);
	let current = 0;
	await tapAt(page, centers[0]!.x, centers[0]!.y);
	await settleOpen(page, current);

	const tapStates: (TapState & { cycle: number })[] = [];
	for (let cycle = 1; cycle <= cycles; cycle++) {
		const reopenIndex = options.target === 'same' ? current : 1 - current;
		const label = `delay=${options.delay}ms cycle=${cycle} target=${options.target}(thumb-${reopenIndex})`;

		await swipeDown(cdp, swipe);
		const releasedAt = Date.now();
		await markAndSnapshot(page, 'swipe-released', { cycle });
		if (options.delay >= 40) {
			try {
				await page.waitForFunction(
					() => !!document.querySelector('.pcl--closing') || !document.querySelector('.pcl'),
					undefined,
					{ timeout: 1000 }
				);
			} catch {
				throw new Error(`swipe did not dismiss [${label}]\n${await failureDetails(page)}`);
			}
			const remaining = options.delay - (Date.now() - releasedAt);
			if (remaining > 0) await page.waitForTimeout(remaining);
		}

		const tapState = await markAndSnapshot(page, 'tap-attempt', { cycle, delay: options.delay });
		tapStates.push({ cycle, ...tapState });
		await tapAt(page, centers[reopenIndex]!.x, centers[reopenIndex]!.y);
		await expectReopened(page, reopenIndex, label, tapState);

		const dismissals = await dismissCount(page);
		if (dismissals !== cycle) {
			throw new Error(
				`dismiss count mismatch [${label}] expected=${cycle} got=${dismissals}\n${await failureDetails(page)}`
			);
		}

		current = reopenIndex;
		await page.waitForTimeout(350);
	}
	console.log(
		`[swipe-reopen] delay=${options.delay}ms target=${options.target} img+${options.imageDelayMs ?? 0}ms ` +
			`cpu×${options.cpuThrottle ?? 1} swipe=${swipe.distance}px@${swipe.speed} tapStates=${JSON.stringify(tapStates)}`
	);
}

test('touch gestures: tap opens and swipe down closes', async ({ page, context }) => {
	const { cdp, centers } = await setupPage(page, context);
	await tapAt(page, centers[0]!.x, centers[0]!.y);
	await settleOpen(page, 0);
	await swipeDown(cdp, FAST_SWIPE);
	await expect(page.locator('.pcl--closing')).toBeVisible({ timeout: 700 });
	await expect(page.locator('.pcl')).toHaveCount(0, { timeout: 2000 });
	const events = await page.evaluate(() => (window as any).__evts as { type: string; onThumb: boolean }[]);
	expect(events.filter((e) => e.type === 'click' && e.onThumb)).toHaveLength(1);
});

for (const delay of [0, 30, ...DELAYS]) {
	test(`reopen same thumb ${delay}ms after swipe dismiss`, async ({ page, context }) => {
		await runScenario(page, context, { delay, target: 'same' });
	});
}

for (const delay of DELAYS) {
	test(`reopen different thumb ${delay}ms after swipe dismiss`, async ({ page, context }) => {
		await runScenario(page, context, { delay, target: 'other' });
	});
}

for (const delay of DELAYS) {
	test(`reopen same thumb ${delay}ms after swipe dismiss with slow images`, async ({ page, context }) => {
		await runScenario(page, context, { delay, target: 'same', imageDelayMs: 400 });
	});
}

for (const delay of [80, 150, 250]) {
	test(`reopen same thumb ${delay}ms after swipe dismiss with 6x cpu throttle`, async ({ page, context }) => {
		await runScenario(page, context, { delay, target: 'same', cpuThrottle: 6 });
	});
}

for (const delay of [80, 250]) {
	test(`reopen same thumb ${delay}ms after slow swipe dismiss`, async ({ page, context }) => {
		await runScenario(page, context, { delay, target: 'same', swipe: { distance: 200, speed: 450 } });
	});
}

test('reopen same thumb 150ms after swipe dismiss across 6 cycles', async ({ page, context }) => {
	await runScenario(page, context, { delay: 150, target: 'same', cycles: 6 });
});
