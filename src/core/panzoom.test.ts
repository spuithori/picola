import { describe, expect, it, vi } from 'vitest';
import { PanZoom } from './panzoom.js';

function createPanZoom() {
	const onChange = vi.fn();
	const panzoom = new PanZoom({ maxZoom: 2, doubleTapZoom: 2, onChange });
	panzoom.setViewport({ width: 1000, height: 800 });
	return { panzoom, onChange };
}

describe('PanZoom', () => {
	it('starts at fit scale once the natural size is known', () => {
		const { panzoom } = createPanZoom();
		panzoom.setNatural({ width: 4000, height: 1600 });
		expect(panzoom.scale).toBe(0.25);
		expect(panzoom.fitScale).toBe(0.25);
		expect(panzoom.isZoomed).toBe(false);
	});

	it('is not zoomable before the natural size is known', () => {
		const { panzoom } = createPanZoom();
		expect(panzoom.zoomable).toBe(false);
		expect(panzoom.pan(10, 10).leftoverX).toBe(10);
	});

	it('preserves the on-screen size when the source is upgraded', () => {
		const { panzoom } = createPanZoom();
		panzoom.setNatural({ width: 1000, height: 400 });
		const displayedWidth = 1000 * panzoom.scale;
		panzoom.setNatural({ width: 4000, height: 1600 });
		expect(4000 * panzoom.scale).toBeCloseTo(displayedWidth, 6);
	});

	it('hands horizontal overflow past the pan bounds to the caller', () => {
		const { panzoom } = createPanZoom();
		panzoom.setNatural({ width: 1000, height: 800 });
		panzoom.beginGesture();
		panzoom.pinch(2, { x: 0, y: 0 }, 0, 0);
		panzoom.x = 0;
		const boundX = (1000 * panzoom.scale - 1000) / 2;
		const { leftoverX } = panzoom.pan(boundX + 120, 0);
		expect(panzoom.x).toBeCloseTo(boundX, 4);
		expect(leftoverX).toBeCloseTo(120, 4);
	});

	it('rubber-bands vertical panning past the bounds', () => {
		const { panzoom } = createPanZoom();
		panzoom.setNatural({ width: 1000, height: 800 });
		panzoom.beginGesture();
		panzoom.pinch(2, { x: 0, y: 0 }, 0, 0);
		panzoom.x = 0;
		panzoom.y = 0;
		const boundY = (800 * panzoom.scale - 800) / 2;
		panzoom.pan(0, boundY + 400);
		expect(panzoom.y).toBeGreaterThan(boundY);
		expect(panzoom.y).toBeLessThan(boundY + 400);
	});

	it('resists pinching past max zoom', () => {
		const { panzoom } = createPanZoom();
		panzoom.setNatural({ width: 1000, height: 800 });
		panzoom.beginGesture();
		panzoom.pinch(10, { x: 0, y: 0 }, 0, 0);
		expect(panzoom.rawPinchScale).toBeCloseTo(panzoom.fitScale * 10, 4);
		expect(panzoom.scale).toBeGreaterThan(2);
		expect(panzoom.scale).toBeLessThan(panzoom.fitScale * 10);
	});

	it('keeps the pinch focal point stationary', () => {
		const { panzoom } = createPanZoom();
		panzoom.setNatural({ width: 2000, height: 1600 });
		panzoom.beginGesture();
		const focal = { x: 200, y: 100 };
		const before = panzoom.view;
		const contentPoint = {
			x: (focal.x - before.x) / before.scale,
			y: (focal.y - before.y) / before.scale
		};
		panzoom.pinch(1.6, focal, 0, 0);
		const after = panzoom.view;
		expect(after.x + contentPoint.x * after.scale).toBeCloseTo(focal.x, 4);
		expect(after.y + contentPoint.y * after.scale).toBeCloseTo(focal.y, 4);
	});

	it('keeps the relative zoom across viewport resizes', () => {
		const { panzoom } = createPanZoom();
		panzoom.setNatural({ width: 4000, height: 3200 });
		panzoom.beginGesture();
		panzoom.pinch(2, { x: 0, y: 0 }, 0, 0);
		const relative = panzoom.scale / panzoom.fitScale;
		panzoom.setViewport({ width: 500, height: 400 });
		expect(panzoom.scale / panzoom.fitScale).toBeCloseTo(relative, 6);
	});

	it('emits a view on every mutation', () => {
		const { panzoom, onChange } = createPanZoom();
		panzoom.setNatural({ width: 1000, height: 800 });
		onChange.mockClear();
		panzoom.beginGesture();
		panzoom.pinch(1.5, { x: 0, y: 0 }, 0, 0);
		panzoom.pan(5, 5);
		expect(onChange.mock.calls.length).toBe(2);
		const view = onChange.mock.calls.at(-1)?.[0];
		expect(view).toHaveProperty('scale');
		expect(view).toHaveProperty('fitScale');
	});
});
