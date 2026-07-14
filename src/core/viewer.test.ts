import { describe, expect, it, vi } from 'vitest';
import { createViewer } from './viewer.js';
import type { Slide } from './types.js';

const slide = (i: number): Slide => ({ src: `/img/${i}.png`, width: 100, height: 100 });

describe('Viewer.setSlides', () => {
	it('appends slides and emits slideschange with the current index', () => {
		const viewer = createViewer({ slides: [slide(0), slide(1)] });
		const listener = vi.fn();
		viewer.on('slideschange', listener);
		viewer.setSlides([slide(0), slide(1), slide(2), slide(3)]);
		expect(viewer.count).toBe(4);
		expect(listener).toHaveBeenCalledWith({ slides: viewer.slides, index: 0 });
	});

	it('clamps the active index when the set shrinks and emits change', () => {
		const viewer = createViewer({ slides: [slide(0), slide(1), slide(2)], startIndex: 2 });
		const change = vi.fn();
		viewer.on('change', change);
		viewer.setSlides([slide(0)]);
		expect(viewer.index).toBe(0);
		expect(change).toHaveBeenCalledWith({ index: 0, slide: viewer.slides[0] });
	});

	it('handles an emptied slide set', () => {
		const viewer = createViewer({ slides: [slide(0)] });
		const listener = vi.fn();
		viewer.on('slideschange', listener);
		viewer.setSlides([]);
		expect(viewer.count).toBe(0);
		expect(listener).toHaveBeenCalledWith({ slides: [], index: 0 });
	});

	it('keeps windowIndices within the new bounds', () => {
		const viewer = createViewer({ slides: [slide(0), slide(1), slide(2)], startIndex: 2 });
		viewer.setSlides([slide(0), slide(1)]);
		expect(viewer.windowIndices().every((i) => i < viewer.count)).toBe(true);
	});
});

describe('Viewer loop windowing', () => {
	const four = [slide(0), slide(1), slide(2), slide(3)];

	it('mirrors keys and indices when loop is off', () => {
		const viewer = createViewer({ slides: four, startIndex: 0 });
		expect(viewer.windowSlides()).toEqual([
			{ key: 0, index: 0 },
			{ key: 1, index: 1 }
		]);
	});

	it('wraps the window across the ends in loop mode', () => {
		const viewer = createViewer({ slides: four, startIndex: 0, loop: true });
		expect(viewer.windowSlides()).toEqual([
			{ key: -1, index: 3 },
			{ key: 0, index: 0 },
			{ key: 1, index: 1 }
		]);
		expect(viewer.windowIndices()).toEqual([3, 0, 1]);
	});

	it('navigates backwards across the seam via prev()', () => {
		const viewer = createViewer({ slides: four, startIndex: 0, loop: true });
		viewer.prev();
		expect(viewer.index).toBe(3);
		expect(viewer.windowSlides().map((w) => w.key)).toEqual([-2, -1, 0]);
	});

	it('takes the shortest path in goTo', () => {
		const viewer = createViewer({ slides: four, startIndex: 0, loop: true });
		const change = vi.fn();
		viewer.on('change', change);
		viewer.goTo(3);
		expect(viewer.index).toBe(3);
		expect(viewer.windowSlides().some((w) => w.key === -1 && w.index === 3)).toBe(true);
		expect(change).toHaveBeenCalledTimes(1);
	});

	it('falls back to wrapping below 3 slides', () => {
		const viewer = createViewer({ slides: [slide(0), slide(1)], startIndex: 0, loop: true });
		viewer.next();
		expect(viewer.index).toBe(1);
		viewer.next();
		expect(viewer.index).toBe(0);
		expect(viewer.windowSlides().every((w) => w.key >= 0 && w.key < 2)).toBe(true);
	});
});
