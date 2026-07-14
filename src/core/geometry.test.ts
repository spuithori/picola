import { describe, expect, it } from 'vitest';
import { fitScale, panBounds, rubberBand, rubberBandScale, zoomAroundPoint } from './geometry.js';

describe('fitScale', () => {
	it('fits landscape content into a smaller viewport', () => {
		expect(fitScale({ width: 2000, height: 1000 }, { width: 1000, height: 1000 })).toBe(0.5);
	});

	it('fits portrait content by the constraining axis', () => {
		expect(fitScale({ width: 1000, height: 4000 }, { width: 1000, height: 1000 })).toBe(0.25);
	});

	it('never upscales past natural size', () => {
		expect(fitScale({ width: 100, height: 100 }, { width: 1000, height: 1000 })).toBe(1);
	});

	it('falls back to 1 for degenerate sizes', () => {
		expect(fitScale({ width: 0, height: 0 }, { width: 1000, height: 1000 })).toBe(1);
	});
});

describe('panBounds', () => {
	it('is zero when content fits inside the viewport', () => {
		const bounds = panBounds(0.5, { width: 1000, height: 1000 }, { width: 800, height: 800 });
		expect(bounds).toEqual({ x: 0, y: 0 });
	});

	it('is half the overflow per axis', () => {
		const bounds = panBounds(2, { width: 1000, height: 500 }, { width: 800, height: 800 });
		expect(bounds.x).toBe((2000 - 800) / 2);
		expect(bounds.y).toBe((1000 - 800) / 2);
	});
});

describe('rubberBand', () => {
	it('passes values inside the limit through unchanged', () => {
		expect(rubberBand(50, 100, 800)).toBe(50);
		expect(rubberBand(-100, 100, 800)).toBe(-100);
	});

	it('resists values past the limit', () => {
		const value = rubberBand(300, 100, 800);
		expect(value).toBeGreaterThan(100);
		expect(value).toBeLessThan(300);
	});

	it('is symmetric', () => {
		expect(rubberBand(-300, 100, 800)).toBe(-rubberBand(300, 100, 800));
	});

	it('is monotonic', () => {
		let previous = 0;
		for (let v = 0; v <= 2000; v += 50) {
			const banded = rubberBand(v, 100, 800);
			expect(banded).toBeGreaterThanOrEqual(previous);
			previous = banded;
		}
	});

	it('never exceeds limit + dimension', () => {
		expect(rubberBand(1e9, 100, 800, 0.15)).toBeLessThan(100 + 800);
	});
});

describe('rubberBandScale', () => {
	it('passes in-range scales through', () => {
		expect(rubberBandScale(1.5, 1, 3)).toBe(1.5);
	});

	it('compresses overshoot above max', () => {
		const scale = rubberBandScale(6, 1, 3);
		expect(scale).toBeGreaterThan(3);
		expect(scale).toBeLessThan(6);
	});

	it('compresses undershoot below min', () => {
		const scale = rubberBandScale(0.25, 1, 3);
		expect(scale).toBeLessThan(1);
		expect(scale).toBeGreaterThan(0.25);
	});
});

describe('zoomAroundPoint', () => {
	it('keeps a centred focal point stationary', () => {
		const next = zoomAroundPoint({ x: 0, y: 0 }, { x: 0, y: 0 }, 1, 2);
		expect(next).toEqual({ x: 0, y: 0 });
	});

	it('keeps the content under an off-centre focal point stationary', () => {
		const offset = { x: 10, y: -20 };
		const focal = { x: 120, y: 80 };
		const from = 0.5;
		const to = 2;
		const contentPoint = { x: (focal.x - offset.x) / from, y: (focal.y - offset.y) / from };
		const next = zoomAroundPoint(offset, focal, from, to);
		expect(next.x + contentPoint.x * to).toBeCloseTo(focal.x, 6);
		expect(next.y + contentPoint.y * to).toBeCloseTo(focal.y, 6);
	});
});
