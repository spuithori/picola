import type { Point, Size } from './types.js';

/** Scale at which `content` fits entirely inside `viewport` (never upscales). */
export function fitScale(content: Size, viewport: Size): number {
	if (content.width <= 0 || content.height <= 0) return 1;
	const scale = Math.min(viewport.width / content.width, viewport.height / content.height);
	return Math.min(scale, 1) || 1;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * Symmetric pan bounds for content of natural `content` size rendered at
 * `scale` inside `viewport`, using a centre-origin coordinate system
 * (offset 0/0 = perfectly centred).
 */
export function panBounds(scale: number, content: Size, viewport: Size): { x: number; y: number } {
	return {
		x: Math.max(0, (content.width * scale - viewport.width) / 2),
		y: Math.max(0, (content.height * scale - viewport.height) / 2)
	};
}

/**
 * iOS-style rubber-band resistance. Values inside `[-limit, limit]` pass
 * through; the excess is compressed so it asymptotically approaches
 * `dimension` beyond the limit, with `coefficient` controlling stiffness
 * (lower = stiffer).
 */
export function rubberBand(value: number, limit: number, dimension: number, coefficient = 0.15): number {
	const excess = Math.abs(value) - limit;
	if (excess <= 0) return value;
	const sign = Math.sign(value);
	const resisted = (excess * dimension * coefficient) / (dimension + coefficient * excess);
	return sign * (limit + resisted);
}

/** Rubber-band applied to a scale factor overshooting `[min, max]`. */
export function rubberBandScale(scale: number, min: number, max: number): number {
	if (scale > max) return max * Math.pow(scale / max, 0.4);
	if (scale < min) return min * Math.pow(scale / min, 0.4);
	return scale;
}

/**
 * New content offset that keeps the content point currently under `focal`
 * stationary while the scale changes from `fromScale` to `toScale`.
 * `focal` is expressed relative to the viewport centre.
 */
export function zoomAroundPoint(
	offset: Point,
	focal: Point,
	fromScale: number,
	toScale: number
): Point {
	const ratio = toScale / fromScale;
	return {
		x: focal.x - (focal.x - offset.x) * ratio,
		y: focal.y - (focal.y - offset.y) * ratio
	};
}
