import type { Point } from './types.js';

export interface PanMoveEvent {
	/** Delta since the previous move, in px. */
	dx: number;
	dy: number;
	/** Total displacement since the pan started. */
	totalX: number;
	totalY: number;
	/** Current pointer position in client coordinates. */
	point: Point;
	/** Dominant axis measured when the pan crossed the start threshold. */
	axis: 'x' | 'y';
}

export interface PanEndEvent {
	/** Release velocity in px/ms. */
	velocityX: number;
	velocityY: number;
	totalX: number;
	totalY: number;
}

export interface PinchMoveEvent {
	/** Midpoint between the two pointers in client coordinates. */
	center: Point;
	/** Scale change since the previous move (multiplicative). */
	ratio: number;
	/** Midpoint movement since the previous move. */
	dx: number;
	dy: number;
	/** Total scale change since the pinch started. */
	totalRatio: number;
}

export interface GestureCallbacks {
	/** First pointer went down (before any gesture is recognised). */
	onDown?(point: Point): void;
	onPanStart?(axis: 'x' | 'y'): void;
	onPanMove?(event: PanMoveEvent): void;
	onPanEnd?(event: PanEndEvent): void;
	onPinchStart?(center: Point): void;
	onPinchMove?(event: PinchMoveEvent): void;
	onPinchEnd?(totalRatio: number): void;
	onTap?(point: Point, target: EventTarget | null): void;
	onDoubleTap?(point: Point): void;
	/**
	 * Whether a tap on `target` must wait for double-tap disambiguation.
	 * Return false where double-taps are meaningless (e.g. the backdrop) so
	 * the tap fires immediately.
	 */
	shouldDelayTap?(target: EventTarget | null): boolean;
	/** The system cancelled the gesture (e.g. browser took over scrolling). */
	onCancel?(): void;
}

const PAN_START_THRESHOLD_PX = 6;
const TAP_MAX_DURATION_MS = 400;
const DOUBLE_TAP_WINDOW_MS = 300;
const DOUBLE_TAP_RADIUS_PX = 32;
const VELOCITY_WINDOW_MS = 100;

interface TrackedPointer {
	x: number;
	y: number;
	startX: number;
	startY: number;
}

/**
 * Unified Pointer Events gesture recogniser: pan (any pointer type),
 * two-finger pinch, tap and double-tap with disambiguation delay.
 * Returns a cleanup function.
 */
export function attachGestures(element: HTMLElement, callbacks: GestureCallbacks): () => void {
	const pointers = new Map<number, TrackedPointer>();
	let mode: 'idle' | 'pending' | 'pan' | 'pinch' = 'idle';
	let panAxis: 'x' | 'y' = 'x';
	let panLast: Point = { x: 0, y: 0 };
	let panTotal: Point = { x: 0, y: 0 };
	let pinchDistance = 0;
	let pinchStartDistance = 0;
	let pinchCenter: Point = { x: 0, y: 0 };
	let downAt = 0;
	let downTarget: EventTarget | null = null;
	let movedBeyondTap = false;
	let lastTapAt = 0;
	let lastTapPoint: Point = { x: 0, y: 0 };
	let pendingTap: ReturnType<typeof setTimeout> | null = null;
	let samples: { t: number; x: number; y: number }[] = [];

	const clearPendingTap = () => {
		if (pendingTap !== null) {
			clearTimeout(pendingTap);
			pendingTap = null;
		}
	};

	const centroid = (): Point => {
		let x = 0;
		let y = 0;
		for (const p of pointers.values()) {
			x += p.x;
			y += p.y;
		}
		const n = pointers.size || 1;
		return { x: x / n, y: y / n };
	};

	const spread = (): number => {
		const points = [...pointers.values()];
		if (points.length < 2) return 0;
		const [a, b] = points as [TrackedPointer, TrackedPointer];
		return Math.hypot(a.x - b.x, a.y - b.y);
	};

	const pushSample = (point: Point, t = performance.now()) => {
		samples.push({ t, x: point.x, y: point.y });
		while (samples.length > 1 && samples[0]!.t < t - VELOCITY_WINDOW_MS) {
			samples.shift();
		}
	};

	const pushMoveSamples = (event: PointerEvent, point: Point) => {
		const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
		if (coalesced.length === 0) {
			pushSample(point);
			return;
		}
		for (const sample of coalesced) {
			pushSample({ x: sample.clientX, y: sample.clientY }, sample.timeStamp);
		}
	};

	const releaseVelocity = (): Point => {
		if (samples.length < 2) return { x: 0, y: 0 };
		const first = samples[0]!;
		const last = samples[samples.length - 1]!;
		const dt = last.t - first.t;
		if (dt <= 0) return { x: 0, y: 0 };
		return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
	};

	const beginPan = (point: Point) => {
		mode = 'pan';
		panLast = point;
		samples = [];
		pushSample(point);
		callbacks.onPanStart?.(panAxis);
	};

	const onPointerDown = (event: PointerEvent) => {
		if (event.button > 0) return;
		element.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, {
			x: event.clientX,
			y: event.clientY,
			startX: event.clientX,
			startY: event.clientY
		});

		if (pointers.size === 1) {
			callbacks.onDown?.({ x: event.clientX, y: event.clientY });
			mode = 'pending';
			downAt = performance.now();
			downTarget = event.target;
			movedBeyondTap = false;
			panTotal = { x: 0, y: 0 };
			panLast = { x: event.clientX, y: event.clientY };
			samples = [];
			pushSample(panLast);
		} else if (pointers.size === 2) {
			if (mode === 'pan') callbacks.onPanEnd?.({ velocityX: 0, velocityY: 0, totalX: panTotal.x, totalY: panTotal.y });
			mode = 'pinch';
			movedBeyondTap = true;
			pinchDistance = spread();
			pinchStartDistance = pinchDistance;
			pinchCenter = centroid();
			callbacks.onPinchStart?.(pinchCenter);
		}
	};

	const onPointerMove = (event: PointerEvent) => {
		const tracked = pointers.get(event.pointerId);
		if (!tracked) return;
		tracked.x = event.clientX;
		tracked.y = event.clientY;

		if (mode === 'pinch') {
			const distance = spread();
			const center = centroid();
			if (pinchDistance > 0 && distance > 0) {
				callbacks.onPinchMove?.({
					center,
					ratio: distance / pinchDistance,
					dx: center.x - pinchCenter.x,
					dy: center.y - pinchCenter.y,
					totalRatio: pinchStartDistance > 0 ? distance / pinchStartDistance : 1
				});
			}
			pinchDistance = distance;
			pinchCenter = center;
			return;
		}

		const point = { x: event.clientX, y: event.clientY };

		if (mode === 'pending') {
			const totalX = point.x - tracked.startX;
			const totalY = point.y - tracked.startY;
			if (Math.hypot(totalX, totalY) < PAN_START_THRESHOLD_PX) return;
			movedBeyondTap = true;
			panAxis = Math.abs(totalX) >= Math.abs(totalY) ? 'x' : 'y';
			beginPan(point);
			return;
		}

		if (mode === 'pan') {
			pushMoveSamples(event, point);
			panTotal = { x: point.x - tracked.startX, y: point.y - tracked.startY };
			callbacks.onPanMove?.({
				dx: point.x - panLast.x,
				dy: point.y - panLast.y,
				totalX: panTotal.x,
				totalY: panTotal.y,
				point,
				axis: panAxis
			});
			panLast = point;
		}
	};

	const finishTap = (point: Point) => {
		const now = performance.now();
		if (now - lastTapAt < DOUBLE_TAP_WINDOW_MS && Math.hypot(point.x - lastTapPoint.x, point.y - lastTapPoint.y) < DOUBLE_TAP_RADIUS_PX) {
			clearPendingTap();
			lastTapAt = 0;
			callbacks.onDoubleTap?.(point);
			return;
		}
		lastTapAt = now;
		lastTapPoint = point;
		const target = downTarget;
		if (callbacks.onDoubleTap && (callbacks.shouldDelayTap?.(target) ?? true)) {
			clearPendingTap();
			pendingTap = setTimeout(() => {
				pendingTap = null;
				callbacks.onTap?.(point, target);
			}, DOUBLE_TAP_WINDOW_MS);
		} else {
			callbacks.onTap?.(point, target);
		}
	};

	const onPointerUp = (event: PointerEvent) => {
		const tracked = pointers.get(event.pointerId);
		if (!tracked) return;
		pointers.delete(event.pointerId);

		if (mode === 'pinch') {
			if (pointers.size < 2) {
				callbacks.onPinchEnd?.(pinchStartDistance > 0 ? pinchDistance / pinchStartDistance : 1);
				if (pointers.size === 1) {
					const remaining = [...pointers.values()][0]!;
					remaining.startX = remaining.x;
					remaining.startY = remaining.y;
					panTotal = { x: 0, y: 0 };
					panAxis = 'x';
					beginPan({ x: remaining.x, y: remaining.y });
				} else {
					mode = 'idle';
				}
			}
			return;
		}

		if (mode === 'pan' && pointers.size === 0) {
			const velocity = releaseVelocity();
			mode = 'idle';
			callbacks.onPanEnd?.({
				velocityX: velocity.x,
				velocityY: velocity.y,
				totalX: panTotal.x,
				totalY: panTotal.y
			});
			return;
		}

		if (mode === 'pending' && pointers.size === 0) {
			mode = 'idle';
			if (!movedBeyondTap && performance.now() - downAt < TAP_MAX_DURATION_MS) {
				finishTap({ x: event.clientX, y: event.clientY });
			}
		}
	};

	const onPointerCancel = (event: PointerEvent) => {
		if (!pointers.has(event.pointerId)) return;
		pointers.clear();
		if (mode === 'pan' || mode === 'pinch') callbacks.onCancel?.();
		mode = 'idle';
	};

	element.addEventListener('pointerdown', onPointerDown);
	element.addEventListener('pointermove', onPointerMove);
	element.addEventListener('pointerup', onPointerUp);
	element.addEventListener('pointercancel', onPointerCancel);

	return () => {
		clearPendingTap();
		element.removeEventListener('pointerdown', onPointerDown);
		element.removeEventListener('pointermove', onPointerMove);
		element.removeEventListener('pointerup', onPointerUp);
		element.removeEventListener('pointercancel', onPointerCancel);
	};
}
