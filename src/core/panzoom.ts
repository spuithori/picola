import { clamp, fitScale, panBounds, rubberBand, rubberBandScale, zoomAroundPoint } from './geometry.js';
import { decay, tween, easeOutQuint, type MotionHandle } from './motion.js';
import type { Point, Size, SlideView } from './types.js';

export interface PanZoomConfig {
	maxZoom: number;
	doubleTapZoom: number;
	onChange(view: SlideView): void;
	onSettled?(): void;
}

const ZOOMED_EPSILON = 1.001;

export class PanZoom {
	scale = 1;
	x = 0;
	y = 0;

	private natural: Size | null = null;
	private viewport: Size = { width: 1, height: 1 };
	private motions = new Set<MotionHandle>();
	private lastFocal: Point = { x: 0, y: 0 };
	rawPinchScale = 1;

	constructor(private config: PanZoomConfig) {}

	get fitScale(): number {
		return this.natural ? fitScale(this.natural, this.viewport) : 1;
	}

	get maxScale(): number {
		return this.natural ? Math.max(this.config.maxZoom, this.fitScale) : 1;
	}

	get isZoomed(): boolean {
		return this.scale > this.fitScale * ZOOMED_EPSILON;
	}

	get zoomable(): boolean {
		return this.natural !== null;
	}

	get naturalSize(): Size | null {
		return this.natural;
	}

	get view(): SlideView {
		return { scale: this.scale, fitScale: this.fitScale, x: this.x, y: this.y };
	}

	setViewport(size: Size): void {
		if (size.width <= 0 || size.height <= 0) return;
		const previousFit = this.fitScale;
		const relative = this.scale / previousFit;
		this.viewport = { ...size };
		this.scale = this.fitScale * relative;
		if (this.motions.size > 0) {
			this.notify();
			return;
		}
		if (!this.isZoomed) {
			this.x = 0;
			this.y = 0;
		} else {
			const bounds = panBounds(this.scale, this.natural ?? size, size);
			this.x = clamp(this.x, -bounds.x, bounds.x);
			this.y = clamp(this.y, -bounds.y, bounds.y);
		}
		this.notify();
	}

	setNatural(size: Size): void {
		if (size.width <= 0 || size.height <= 0) return;
		if (this.natural) {
			this.scale *= this.natural.width / size.width;
		} else {
			this.scale = fitScale(size, this.viewport);
		}
		this.natural = { ...size };
		this.notify();
	}

	reset(): void {
		this.stopMotions();
		this.scale = this.fitScale;
		this.x = 0;
		this.y = 0;
		this.notify();
	}

	stopMotions(): void {
		for (const motion of this.motions) motion.stop();
		this.motions.clear();
	}


	beginGesture(): void {
		this.stopMotions();
		this.rawPinchScale = this.scale;
	}

	pan(dx: number, dy: number): { leftoverX: number } {
		if (!this.natural) return { leftoverX: dx };
		const bounds = panBounds(this.scale, this.natural, this.viewport);

		const targetX = this.x + dx;
		const clampedX = clamp(targetX, -bounds.x, bounds.x);
		const leftoverX = targetX - clampedX;
		this.x = clampedX;

		this.y = rubberBand(this.y + dy, bounds.y, this.viewport.height);

		this.notify();
		return { leftoverX };
	}

	pinch(ratio: number, focal: Point, dx: number, dy: number): void {
		if (!this.natural) return;
		this.rawPinchScale *= ratio;
		const target = rubberBandScale(this.rawPinchScale, this.fitScale, this.maxScale);
		const offset = zoomAroundPoint({ x: this.x, y: this.y }, focal, this.scale, target);
		this.scale = target;
		this.x = offset.x + dx;
		this.y = offset.y + dy;
		this.lastFocal = focal;
		this.notify();
	}

	settle(velocity: Point = { x: 0, y: 0 }): void {
		if (!this.natural) return;
		this.stopMotions();

		const targetScale = clamp(this.scale, this.fitScale, this.maxScale);
		if (Math.abs(targetScale - this.scale) > 1e-4) {
			this.animateTo(targetScale, this.lastFocal, 240);
			return;
		}

		const bounds = panBounds(this.scale, this.natural, this.viewport);
		this.settleAxis('x', bounds.x, velocity.x);
		this.settleAxis('y', bounds.y, velocity.y);
	}

	private settleAxis(axis: 'x' | 'y', bound: number, velocity: number): void {
		const value = this[axis];
		const clamped = clamp(value, -bound, bound);
		if (clamped !== value) {
			this.track(
				tween({
					from: value,
					to: clamped,
					durationMs: 280,
					ease: easeOutQuint,
					onUpdate: (v) => {
						this[axis] = v;
						this.notify();
					},
					onComplete: () => this.config.onSettled?.()
				})
			);
		} else if (Math.abs(velocity) > 0.05) {
			this.track(
				decay({
					from: value,
					velocity,
					min: -bound,
					max: bound,
					onUpdate: (v) => {
						this[axis] = v;
						this.notify();
					},
					onComplete: () => this.config.onSettled?.()
				})
			);
		}
	}


	animateTo(scale: number, focal: Point = { x: 0, y: 0 }, durationMs = 300): void {
		if (!this.natural) return;
		this.stopMotions();
		const from = this.view;
		const target = clamp(scale, this.fitScale, this.maxScale);
		const offset = zoomAroundPoint({ x: from.x, y: from.y }, focal, from.scale, target);
		const bounds = panBounds(target, this.natural, this.viewport);
		const to = {
			scale: target,
			x: clamp(offset.x, -bounds.x, bounds.x),
			y: clamp(offset.y, -bounds.y, bounds.y)
		};
		this.track(
			tween({
				from: 0,
				to: 1,
				durationMs,
				ease: easeOutQuint,
				onUpdate: (t) => {
					this.scale = from.scale + (to.scale - from.scale) * t;
					this.x = from.x + (to.x - from.x) * t;
					this.y = from.y + (to.y - from.y) * t;
					this.notify();
				},
				onComplete: () => this.config.onSettled?.()
			})
		);
	}

	toggleZoom(focal: Point = { x: 0, y: 0 }): void {
		if (!this.natural) return;
		if (this.isZoomed) {
			this.animateTo(this.fitScale);
		} else {
			this.animateTo(Math.min(this.config.doubleTapZoom, this.maxZoomAbsolute()), focal);
		}
	}

	wheelZoom(deltaY: number, focal: Point): void {
		if (!this.natural) return;
		this.stopMotions();
		const factor = Math.exp(-deltaY * 0.002);
		const target = clamp(this.scale * factor, this.fitScale, this.maxScale);
		const offset = zoomAroundPoint({ x: this.x, y: this.y }, focal, this.scale, target);
		this.scale = target;
		const bounds = panBounds(target, this.natural, this.viewport);
		this.x = clamp(offset.x, -bounds.x, bounds.x);
		this.y = clamp(offset.y, -bounds.y, bounds.y);
		this.notify();
	}

	private maxZoomAbsolute(): number {
		return this.maxScale;
	}

	private track(motion: MotionHandle): void {
		this.motions.add(motion);
		void motion.finished.then(() => this.motions.delete(motion));
	}

	private notify(): void {
		this.config.onChange(this.view);
	}
}
