export type Ease = (t: number) => number;

let reducedMotion = false;
if (typeof matchMedia === 'function') {
	const query = matchMedia('(prefers-reduced-motion: reduce)');
	reducedMotion = query.matches;
	query.addEventListener?.('change', (event) => (reducedMotion = event.matches));
}

export function prefersReducedMotion(): boolean {
	return reducedMotion;
}

export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutQuint: Ease = (t) => 1 - Math.pow(1 - t, 5);
export const easeInOutSine: Ease = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

export const cssEaseOutCubic = 'cubic-bezier(0.33, 1, 0.68, 1)';
export const cssEaseInOutSine = 'cubic-bezier(0.37, 0, 0.63, 1)';

export interface ElementMotion {
	anim: Animation | null;
	finished: Promise<boolean>;
}

export function animateElement(
	el: Element,
	keyframes: Keyframe[],
	durationMs: number,
	easing: string
): ElementMotion {
	if (reducedMotion || durationMs <= 0 || typeof el.animate !== 'function') {
		return { anim: null, finished: Promise.resolve(true) };
	}
	const anim = el.animate(keyframes, { duration: durationMs, easing });
	const finished = anim.finished.then(
		() => true,
		() => false
	);
	return { anim, finished };
}

export interface MotionHandle {
	stop(): void;
	readonly finished: Promise<boolean>;
}

interface TweenConfig {
	from: number;
	to: number;
	durationMs: number;
	ease?: Ease;
	onUpdate(value: number): void;
	onComplete?: (() => void) | undefined;
}

const raf: (cb: FrameRequestCallback) => number =
	typeof requestAnimationFrame === 'function'
		? (cb) => requestAnimationFrame(cb)
		: (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;

const caf: (id: number) => void =
	typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

export function tween(config: TweenConfig): MotionHandle {
	if (reducedMotion) {
		config.onUpdate(config.to);
		config.onComplete?.();
		return { stop() {}, finished: Promise.resolve(true) };
	}
	const ease = config.ease ?? easeOutCubic;
	let frame = 0;
	let stopped = false;
	let resolve!: (done: boolean) => void;
	const finished = new Promise<boolean>((r) => (resolve = r));
	const start = performance.now();

	const step = (now: number) => {
		if (stopped) return;
		const t = config.durationMs <= 0 ? 1 : Math.min(1, (now - start) / config.durationMs);
		config.onUpdate(config.from + (config.to - config.from) * ease(t));
		if (t < 1) {
			frame = raf(step);
		} else {
			stopped = true;
			config.onComplete?.();
			resolve(true);
		}
	};
	frame = raf(step);

	return {
		stop() {
			if (stopped) return;
			stopped = true;
			caf(frame);
			resolve(false);
		},
		finished
	};
}

interface DecayConfig {
	from: number;
	velocity: number;
	friction?: number;
	min?: number;
	max?: number;
	onUpdate(value: number): void;
	onComplete?: (() => void) | undefined;
}

export function decay(config: DecayConfig): MotionHandle {
	const friction = config.friction ?? 0.985;
	const min = config.min ?? -Infinity;
	const max = config.max ?? Infinity;
	if (reducedMotion) {
		config.onUpdate(Math.min(Math.max(config.from, min), max));
		config.onComplete?.();
		return { stop() {}, finished: Promise.resolve(true) };
	}
	let value = config.from;
	let velocity = config.velocity;
	let frame = 0;
	let stopped = false;
	let last = performance.now();
	let resolve!: (done: boolean) => void;
	const finished = new Promise<boolean>((r) => (resolve = r));

	const step = (now: number) => {
		if (stopped) return;
		const dt = Math.min(now - last, 64);
		last = now;
		velocity *= Math.pow(friction, dt);
		value += velocity * dt;

		const clamped = Math.min(Math.max(value, min), max);
		const hitEdge = clamped !== value;
		value = clamped;
		config.onUpdate(value);

		if (hitEdge || Math.abs(velocity) < 0.02) {
			stopped = true;
			config.onComplete?.();
			resolve(true);
			return;
		}
		frame = raf(step);
	};
	frame = raf(step);

	return {
		stop() {
			if (stopped) return;
			stopped = true;
			caf(frame);
			resolve(false);
		},
		finished
	};
}
