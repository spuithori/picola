import { createEmitter, type Emitter } from './emitter.js';
import { clamp, rubberBand } from './geometry.js';
import { attachGestures } from './gestures.js';
import { bindHistory, type HistoryBinding } from './history.js';
import { decodeImage } from './loader.js';
import { animateElement, cssEaseInOutSine, cssEaseOutCubic, tween } from './motion.js';
import { PanZoom } from './panzoom.js';
import { trapFocus } from './focus.js';
import type {
	OriginRect,
	Point,
	Size,
	Slide,
	SlideView,
	ViewerEvents,
	ViewerOptions,
	ViewerStatus
} from './types.js';

export interface ViewerRefs {
	viewport: HTMLElement;
	track: HTMLElement;
	backdrop: HTMLElement;
	root?: HTMLElement;
}

export interface SlideRefs {
	content: HTMLElement;
}

interface SlideRuntime {
	panzoom: PanZoom;
	content: HTMLElement | null;
	image: HTMLImageElement | null;
	loaded: boolean;
	lastEmittedScale: number;
	decodeToken: number;
	zoomIntentEmitted: boolean;
}

interface ResolvedOptions<T> {
	slides: Slide<T>[];
	startIndex: number;
	loop: boolean;
	backdropOpacity: number;
	preload: readonly [number, number];
	slideGap: number;
	zoom: { max: number; doubleTap: number; wheel: boolean };
	dismiss: { drag: boolean; threshold: number; pinch: boolean };
	tapAction: 'toggle-ui' | 'close' | 'none';
	backdropClose: boolean;
	wheelMode: 'zoom' | 'navigate' | 'none';
	keyboard: boolean;
	history: boolean;
	transitionMs: number;
	origin: ((index: number) => OriginRect | HTMLElement | null | undefined) | null;
}

export interface CreateViewerOptions<T> extends ViewerOptions<T> {
	origin?: (index: number) => OriginRect | HTMLElement | null | undefined;
}

type PanIntent = 'slide' | 'track' | 'dismiss' | 'none';

interface StopHandle {
	stop(): void;
}

interface ViewTriple {
	scale: number;
	x: number;
	y: number;
}

function readMatrix(el: Element): DOMMatrix | null {
	const transform = getComputedStyle(el).transform;
	if (!transform || transform === 'none') return null;
	return new DOMMatrix(transform);
}

export class Viewer<T = unknown> {
	private options: ResolvedOptions<T>;
	private emitter: Emitter<ViewerEvents<T>> = createEmitter();
	private refs: ViewerRefs | null = null;
	private runtimes = new Map<number, SlideRuntime>();
	private viewportSize: Size = { width: 1, height: 1 };
	private viewportRect: DOMRect | null = null;

	private currentIndex = 0;
	private virtualIndex = 0;
	private currentStatus: ViewerStatus = 'closed';
	private uiShown = true;
	private keyboardEnabled = true;

	private trackOffset = 0;
	private trackMotion: StopHandle | null = null;
	private panIntent: PanIntent = 'none';
	private trackDragBase = 0;
	private slideHandoffX = 0;
	private dismissY = 0;
	private dismissMotion: StopHandle | null = null;
	private backdropMotion: StopHandle | null = null;
	private contentMotion: StopHandle | null = null;
	private pendingContentStart: { key: number; begin: () => void } | null = null;
	private viewportMotion: StopHandle | null = null;
	private backdropLevel = 0;

	private layerHintTimer: ReturnType<typeof setTimeout> | null = null;
	private layerIdleDeadline = 0;
	private layersActive = false;
	private wheelAccum = 0;
	private wheelCooldownUntil = 0;

	private pendingLoads: { index: number; slide: Slide<T>; key: number }[] = [];
	private cleanups: (() => void)[] = [];
	private detachRefs: (() => void) | null = null;
	private historyBinding: HistoryBinding | null = null;
	private releaseFocus: (() => void) | null = null;
	private queuedOpen: { index: number } | null = null;
	private destroyed = false;

	constructor(options: CreateViewerOptions<T>) {
		this.options = {
			slides: [...options.slides],
			startIndex: options.startIndex ?? 0,
			loop: options.loop ?? false,
			backdropOpacity: options.backdropOpacity ?? 0.9,
			preload: options.preload ?? [1, 1],
			slideGap: options.slideGap ?? 16,
			zoom: {
				max: options.zoom?.max ?? 2,
				doubleTap: options.zoom?.doubleTap ?? 2,
				wheel: options.zoom?.wheel ?? true
			},
			dismiss: {
				drag: options.dismiss?.drag ?? true,
				threshold: options.dismiss?.threshold ?? 0.22,
				pinch: options.dismiss?.pinch ?? true
			},
			tapAction: options.tapAction ?? 'toggle-ui',
			backdropClose: options.backdropClose ?? true,
			wheelMode: options.wheel ?? (options.zoom?.wheel === false ? 'none' : 'zoom'),
			keyboard: options.keyboard ?? true,
			history: options.history ?? false,
			transitionMs: options.transitionMs ?? 260,
			origin: options.origin ?? null
		};
		this.currentIndex = clamp(this.options.startIndex, 0, Math.max(0, this.options.slides.length - 1));
		this.virtualIndex = this.currentIndex;
	}

	private toReal(virtual: number): number {
		if (this.count === 0) return 0;
		return ((virtual % this.count) + this.count) % this.count;
	}

	private get continuousLoop(): boolean {
		return this.options.loop && this.count >= 3;
	}


	get index(): number {
		return this.currentIndex;
	}

	get status(): ViewerStatus {
		return this.currentStatus;
	}

	get count(): number {
		return this.options.slides.length;
	}

	get uiVisible(): boolean {
		return this.uiShown;
	}

	get slides(): readonly Slide<T>[] {
		return this.options.slides;
	}

	slideAt(index: number): Slide<T> | undefined {
		return this.options.slides[index];
	}

	viewAt(index: number): SlideView | undefined {
		return this.runtimes.get(index)?.panzoom.view;
	}

	windowIndices(): number[] {
		const seen = new Set<number>();
		const indices: number[] = [];
		for (const { index } of this.windowSlides()) {
			if (!seen.has(index)) {
				seen.add(index);
				indices.push(index);
			}
		}
		return indices;
	}

	windowSlides(): { key: number; index: number }[] {
		if (this.count === 0) return [];
		const [before, after] = this.options.preload;
		const window: { key: number; index: number }[] = [];
		for (let v = this.virtualIndex - before; v <= this.virtualIndex + after; v++) {
			if (!this.continuousLoop && (v < 0 || v >= this.count)) continue;
			window.push({ key: v, index: this.toReal(v) });
		}
		return window;
	}

	on<K extends keyof ViewerEvents<T>>(type: K, listener: (payload: ViewerEvents<T>[K]) => void): () => void {
		return this.emitter.on(type, listener);
	}


	attach(refs: ViewerRefs): () => void {
		this.refs = refs;
		this.measureViewport();
		for (const runtime of this.runtimes.values()) {
			runtime.panzoom.setViewport(this.viewportSize);
		}

		const resizeObserver = new ResizeObserver(() => this.handleResize());
		resizeObserver.observe(refs.viewport);

		const detachGestures = attachGestures(refs.viewport, {
			onDown: () => this.wakeLayers(),
			onPanStart: (axis) => this.handlePanStart(axis),
			onPanMove: (event) => this.handlePanMove(event.dx, event.dy, event.totalX, event.totalY),
			onPanEnd: (event) => this.handlePanEnd(event.velocityX, event.velocityY, event.totalX, event.totalY),
			onPinchStart: (center) => this.handlePinchStart(center),
			onPinchMove: (event) => this.handlePinchMove(event.ratio, event.center, event.dx, event.dy),
			onPinchEnd: () => this.handlePinchEnd(),
			onTap: (point, target) => this.handleTap(point, target),
			onDoubleTap: (point) => this.handleDoubleTap(point),
			shouldDelayTap: (target) => target instanceof Node && this.isWithinContent(target),
			onCancel: () => this.activeRuntime()?.panzoom.settle()
		});

		const onWheel = (event: WheelEvent) => this.handleWheel(event);
		refs.viewport.addEventListener('wheel', onWheel, { passive: false });

		const onKeydown = (event: KeyboardEvent) => this.handleKeydown(event);
		if (this.options.keyboard) window.addEventListener('keydown', onKeydown);

		this.detachRefs = () => {
			resizeObserver.disconnect();
			detachGestures();
			refs.viewport.removeEventListener('wheel', onWheel);
			window.removeEventListener('keydown', onKeydown);
			this.refs = null;
		};

		this.applyTrack(this.restingTrackOffset());

		if (this.queuedOpen) {
			const { index } = this.queuedOpen;
			this.queuedOpen = null;
			this.open(index);
		}
		return this.detachRefs;
	}

	connectSlide(key: number, refs: SlideRefs): () => void {
		const runtime = this.ensureRuntime(key);
		runtime.content = refs.content;
		this.applySlide(key);
		if (this.pendingContentStart?.key === key) {
			const pending = this.pendingContentStart;
			this.pendingContentStart = null;
			pending.begin();
		}
		return () => {
			if (runtime.content === refs.content) runtime.content = null;
		};
	}

	bindImage(key: number, image: HTMLImageElement): () => void {
		const runtime = this.ensureRuntime(key);
		runtime.image = image;
		runtime.loaded = false;
		const token = ++runtime.decodeToken;
		image.decoding = 'async';
		if ('fetchPriority' in image) {
			image.fetchPriority = key === this.virtualIndex ? 'high' : 'low';
		}

		const index = this.toReal(key);
		const slide = this.options.slides[index];
		void decodeImage(image).then(
			(size) => {
				if (this.destroyed || runtime.decodeToken !== token) return;
				runtime.loaded = true;
				this.adoptNaturalSize(key, runtime, size);
				if (!slide) return;
				if (key === this.virtualIndex && this.currentStatus === 'opening') {
					this.pendingLoads.push({ index, slide, key });
				} else {
					this.emitter.emit('load', { index, slide, key });
				}
			},
			(error: unknown) => {
				if (this.destroyed || runtime.decodeToken !== token) return;
				if (slide) this.emitter.emit('error', { index, slide, error, key });
			}
		);
		return () => {
			if (runtime.image === image) runtime.image = null;
			if (!image.isConnected) {
				image.removeAttribute('srcset');
				image.removeAttribute('src');
			}
		};
	}


	open(index: number = this.options.startIndex): void {
		if (this.destroyed || this.currentStatus === 'open' || this.currentStatus === 'opening') return;
		const target = clamp(index, 0, this.count - 1);
		if (!this.refs) {
			this.queuedOpen = { index: target };
			return;
		}
		this.currentIndex = target;
		this.virtualIndex = target;
		this.currentStatus = 'opening';
		this.pendingLoads = [];
		this.dismissY = 0;
		const host = this.dismissHost();
		host?.style.removeProperty('--pcl-dismiss');
		host?.removeAttribute('data-pcl-dismissing');
		this.uiShown = true;
		this.keyboardEnabled = true;
		this.measureViewport();
		this.applyTrack(this.restingTrackOffset());
		this.emitter.emit('open', { index: target });
		this.emitChange();

		if (this.options.history) this.historyBinding = bindHistory(() => this.close({ viaHistory: true }));
		const root = this.refs.root ?? this.refs.viewport;
		this.releaseFocus = trapFocus(root);

		this.fadeBackdrop(this.options.backdropOpacity, this.options.transitionMs);

		const runtime = this.ensureRuntime(target);
		runtime.content?.style.removeProperty('clip-path');
		this.updateCursor();
		const origin = this.resolveOrigin(target);
		const finish = () => {
			if (this.destroyed || this.currentStatus !== 'opening') return;
			this.currentStatus = 'open';
			this.emitter.emit('opened', { index: this.currentIndex });
			this.flushPendingLoads();
		};

		this.viewportMotion?.stop();
		this.refs.viewport.style.opacity = '';
		if (origin && runtime.panzoom.zoomable) {
			const transition = this.originTransition(origin, runtime);
			void this.animateContent(
				target,
				transition.view,
				{ scale: runtime.panzoom.fitScale, x: 0, y: 0 },
				transition.clipInset ? { inset: transition.clipInset, direction: 'open' } : null,
				cssEaseOutCubic
			).then(finish);
		} else {
			this.fadeViewport(0, 1, finish);
		}
	}

	private flushPendingLoads(): void {
		if (this.pendingLoads.length === 0) return;
		const pending = this.pendingLoads;
		this.pendingLoads = [];
		for (const payload of pending) this.emitter.emit('load', payload);
	}

	close(options: { viaHistory?: boolean } = {}): void {
		if (this.destroyed || this.currentStatus === 'closed' || this.currentStatus === 'closing') return;
		this.currentStatus = 'closing';
		this.emitter.emit('close', { index: this.currentIndex });

		if (!options.viaHistory) this.historyBinding?.rewind();
		else this.historyBinding = null;

		this.trackMotion?.stop();
		this.dismissMotion?.stop();
		this.contentMotion?.stop();
		this.fadeBackdrop(0, this.options.transitionMs);

		const runtime = this.activeRuntime();
		const origin = this.resolveOrigin(this.currentIndex);
		if (runtime && origin && this.dismissY !== 0) {
			runtime.panzoom.y += this.dismissY;
			this.dismissY = 0;
		}
		const finish = () => {
			if (this.destroyed || this.currentStatus !== 'closing') return;
			this.historyBinding?.dispose();
			this.historyBinding = null;
			this.releaseFocus?.();
			this.releaseFocus = null;
			this.currentStatus = 'closed';
			this.emitter.emit('closed');
		};

		if (runtime && origin && runtime.panzoom.zoomable) {
			const transition = this.originTransition(origin, runtime);
			void this.animateContent(
				this.virtualIndex,
				runtime.panzoom.view,
				transition.view,
				transition.clipInset ? { inset: transition.clipInset, direction: 'close' } : null,
				cssEaseInOutSine
			).then(() => finish());
		} else if (this.refs) {
			const viewport = this.refs.viewport;
			const startY = this.dismissY;
			if (startY === 0) {
				const from = viewport.style.opacity === '' ? 1 : Number(viewport.style.opacity) || 0;
				viewport.style.opacity = '0';
				this.fadeViewport(from, 0, () => finish());
			} else {
				this.viewportMotion?.stop();
				this.viewportMotion = tween({
					from: 1,
					to: 0,
					durationMs: this.options.transitionMs,
					onUpdate: (t) => {
						viewport.style.opacity = String(t);
						this.dismissY = startY + (1 - t) * Math.sign(startY) * this.viewportSize.height * 0.2;
						this.applySlide(this.virtualIndex);
					},
					onComplete: finish
				});
			}
		} else {
			finish();
		}
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.trackMotion?.stop();
		this.dismissMotion?.stop();
		this.backdropMotion?.stop();
		this.contentMotion?.stop();
		this.viewportMotion?.stop();
		if (this.layerHintTimer) clearTimeout(this.layerHintTimer);
		for (const runtime of this.runtimes.values()) {
			runtime.panzoom.stopMotions();
			this.releaseImage(runtime);
		}
		this.runtimes.clear();
		this.historyBinding?.dispose();
		this.releaseFocus?.();
		this.detachRefs?.();
		for (const cleanup of this.cleanups) cleanup();
		this.emitter.emit('destroy');
		this.emitter.clear();
	}


	next(): void {
		this.goTo(this.currentIndex + 1);
	}

	prev(): void {
		this.goTo(this.currentIndex - 1);
	}

	goTo(index: number, options: { animate?: boolean } = {}): void {
		if (this.destroyed || this.count === 0) return;
		let targetVirtual: number;
		if (this.continuousLoop) {
			const real = this.toReal(index);
			let delta = (real - this.currentIndex + this.count) % this.count;
			if (delta > this.count / 2) delta -= this.count;
			targetVirtual = this.virtualIndex + delta;
		} else if (this.options.loop) {
			targetVirtual = this.toReal(index);
		} else {
			targetVirtual = clamp(index, 0, this.count - 1);
		}
		this.goToVirtual(targetVirtual, options);
	}

	private goToVirtual(target: number, options: { animate?: boolean } = {}): void {
		if (this.destroyed || this.count === 0) return;
		if (!this.continuousLoop) target = clamp(target, 0, this.count - 1);
		if (target === this.virtualIndex) {
			this.animateTrackTo(this.restingTrackOffset());
			return;
		}
		const previous = this.virtualIndex;
		const adjacent = Math.abs(target - previous) === 1;
		this.virtualIndex = target;
		this.currentIndex = this.toReal(target);
		this.releaseEvictedImages(previous, target);
		this.emitChange();
		this.flushPendingLoads();

		if ((options.animate ?? true) && adjacent) {
			this.animateTrackTo(this.restingTrackOffset(), () => {
				this.runtimes.get(previous)?.panzoom.reset();
			});
		} else {
			this.trackMotion?.stop();
			this.runtimes.get(previous)?.panzoom.reset();
			this.applyTrack(this.restingTrackOffset());
		}
	}


	setSlides(slides: readonly Slide<T>[]): void {
		if (this.destroyed) return;
		const previous = this.options.slides;
		this.options.slides = [...slides];

		if (this.count === 0) {
			if (this.currentStatus === 'open' || this.currentStatus === 'opening') this.close();
			this.emitter.emit('slideschange', { slides: this.options.slides, index: 0 });
			return;
		}

		const changedSrc = new Set<number>();
		for (const [key, runtime] of [...this.runtimes]) {
			const real = this.toReal(key);
			const next = this.options.slides[real];
			if (!next || (!this.continuousLoop && (key < 0 || key > this.count - 1))) {
				this.releaseImage(runtime);
				runtime.panzoom.stopMotions();
				this.runtimes.delete(key);
				continue;
			}
			if (previous[real] && next.src !== previous[real].src) changedSrc.add(real);
		}

		const maxIndex = this.count - 1;
		const clampedIndex = Math.min(this.currentIndex, maxIndex);
		const rebase = clampedIndex !== this.currentIndex || this.toReal(this.virtualIndex) !== clampedIndex;
		if (rebase) {
			this.currentIndex = clampedIndex;
			this.virtualIndex = clampedIndex;
			this.trackMotion?.stop();
			this.applyTrack(this.restingTrackOffset());
			this.emitChange();
		}

		this.emitter.emit('slideschange', { slides: this.options.slides, index: this.currentIndex });
		for (const i of changedSrc) {
			const slide = this.options.slides[i];
			if (slide) this.emitter.emit('slideupdate', { index: i, slide });
		}
	}

	updateSlide(index: number, patch: Partial<Slide<T>>): void {
		const slide = this.options.slides[index];
		if (!slide) return;
		const updated = { ...slide, ...patch };
		this.options.slides[index] = updated;
		this.emitter.emit('slideupdate', { index, slide: updated });
	}

	setUiVisible(visible: boolean): void {
		if (this.uiShown === visible) return;
		this.uiShown = visible;
		this.emitter.emit('ui', { visible });
	}

	toggleUi(): void {
		this.setUiVisible(!this.uiShown);
	}

	setKeyboardEnabled(enabled: boolean): void {
		this.keyboardEnabled = enabled;
	}

	zoomTo(scale: number, options: { animate?: boolean } = {}): void {
		const runtime = this.activeRuntime();
		if (!runtime) return;
		this.contentMotion?.stop();
		if (options.animate ?? true) runtime.panzoom.animateTo(scale);
		else {
			runtime.panzoom.stopMotions();
			runtime.panzoom.scale = scale;
			runtime.panzoom.settle();
		}
	}


	private releaseImage(runtime: SlideRuntime | undefined): void {
		const image = runtime?.image;
		if (!image) return;
		image.removeAttribute('srcset');
		image.removeAttribute('src');
	}

	private releaseEvictedImages(previousVirtual: number, targetVirtual: number): void {
		const [before, after] = this.options.preload;
		for (let i = previousVirtual - before; i <= previousVirtual + after; i++) {
			if (i < targetVirtual - before || i > targetVirtual + after) {
				this.releaseImage(this.runtimes.get(i));
			}
		}
	}

	private ensureRuntime(key: number): SlideRuntime {
		let runtime = this.runtimes.get(key);
		if (runtime) return runtime;
		const panzoom = new PanZoom({
			maxZoom: this.options.zoom.max,
			doubleTapZoom: this.options.zoom.doubleTap,
			onChange: () => {
				this.applySlide(key);
				this.emitZoomIfChanged(key);
			}
		});
		panzoom.setViewport(this.viewportSize);
		const slide = this.options.slides[this.toReal(key)];
		if (slide?.width && slide.height) {
			panzoom.setNatural({ width: slide.width, height: slide.height });
		}
		runtime = {
			panzoom,
			content: null,
			image: null,
			loaded: false,
			lastEmittedScale: panzoom.scale,
			decodeToken: 0,
			zoomIntentEmitted: false
		};
		this.runtimes.set(key, runtime);
		return runtime;
	}

	private activeRuntime(): SlideRuntime | undefined {
		return this.runtimes.get(this.virtualIndex);
	}

	private adoptNaturalSize(key: number, runtime: SlideRuntime, size: Size): void {
		const natural = runtime.panzoom.naturalSize;
		if (!natural || natural.width !== size.width || natural.height !== size.height) {
			runtime.panzoom.setNatural(size);
		}
		const slide = this.options.slides[this.toReal(key)];
		if (slide && (!slide.width || !slide.height)) {
			slide.width = size.width;
			slide.height = size.height;
		}
		this.applySlide(key);
		if (key === this.virtualIndex) this.updateCursor();
	}

	private emitZoomIfChanged(key: number): void {
		if (key !== this.virtualIndex) return;
		const runtime = this.runtimes.get(key);
		if (!runtime) return;
		const { scale, fitScale } = runtime.panzoom.view;
		if (Math.abs(scale - runtime.lastEmittedScale) < 1e-4) return;
		runtime.lastEmittedScale = scale;
		this.updateCursor();
		this.emitter.emit('zoom', { index: this.currentIndex, scale, fitScale });
	}

	private emitChange(): void {
		this.updateCursor();
		const slide = this.options.slides[this.currentIndex];
		if (slide) this.emitter.emit('change', { index: this.currentIndex, slide });
	}


	private measureViewport(): void {
		if (!this.refs) return;
		const rect = this.refs.viewport.getBoundingClientRect();
		this.viewportRect = rect;
		if (rect.width > 0 && rect.height > 0) {
			this.viewportSize = { width: rect.width, height: rect.height };
		}
	}

	private handleResize(): void {
		const previous = this.viewportSize;
		this.measureViewport();
		if (
			Math.abs(this.viewportSize.width - previous.width) < 1 &&
			Math.abs(this.viewportSize.height - previous.height) < 1
		) {
			return;
		}
		for (const runtime of this.runtimes.values()) {
			runtime.panzoom.setViewport(this.viewportSize);
		}
		this.trackMotion?.stop();
		this.applyTrack(this.restingTrackOffset());
	}

	private slideStride(): number {
		return this.viewportSize.width + this.options.slideGap;
	}

	private restingTrackOffset(virtual: number = this.virtualIndex): number {
		return virtual * this.slideStride();
	}

	private applyTrack(offset: number): void {
		this.trackOffset = offset;
		if (this.refs) {
			this.wakeLayers();
			this.refs.track.style.transform = `translate3d(${-offset}px, 0, 0)`;
		}
	}

	private wakeLayers(): void {
		if (!this.refs) return;
		if (!this.layersActive) {
			this.layersActive = true;
			this.refs.track.style.willChange = 'transform';
			const content = this.activeRuntime()?.content;
			if (content) content.style.willChange = 'transform';
		}
		this.layerIdleDeadline = performance.now() + 400;
		if (this.layerHintTimer === null) this.armLayerRelease(400);
	}

	private armLayerRelease(delayMs: number): void {
		this.layerHintTimer = setTimeout(() => {
			const remaining = this.layerIdleDeadline - performance.now();
			if (remaining > 25) {
				this.armLayerRelease(remaining);
			} else {
				this.layerHintTimer = null;
				this.releaseLayers();
			}
		}, delayMs);
	}

	private releaseLayers(): void {
		this.layersActive = false;
		if (!this.refs) return;
		this.refs.track.style.willChange = '';
		for (const runtime of this.runtimes.values()) {
			if (runtime.content) runtime.content.style.willChange = '';
		}
	}

	private updateCursor(): void {
		const viewport = this.refs?.viewport;
		if (!viewport) return;
		const runtime = this.activeRuntime();
		if (!runtime?.panzoom.zoomable) {
			delete viewport.dataset['pclCursor'];
			return;
		}
		if (this.panIntent === 'slide') viewport.dataset['pclCursor'] = 'grabbing';
		else if (runtime.panzoom.isZoomed) viewport.dataset['pclCursor'] = 'grab';
		else viewport.dataset['pclCursor'] = 'zoom-in';
	}

	private emitZoomIntent(): void {
		const runtime = this.activeRuntime();
		if (!runtime || runtime.zoomIntentEmitted || !runtime.panzoom.zoomable) return;
		runtime.zoomIntentEmitted = true;
		const slide = this.options.slides[this.currentIndex];
		if (slide) this.emitter.emit('zoomintent', { index: this.currentIndex, slide });
	}

	private contentTransform(runtime: SlideRuntime, view: ViewTriple, dismiss: number): string {
		const natural = runtime.panzoom.naturalSize;
		if (!natural) return dismiss === 0 ? '' : `translate3d(0, ${dismiss}px, 0)`;
		const tx = this.viewportSize.width / 2 + view.x - (natural.width * view.scale) / 2;
		const ty = this.viewportSize.height / 2 + view.y + dismiss - (natural.height * view.scale) / 2;
		return `translate3d(${tx}px, ${ty}px, 0) scale(${view.scale})`;
	}

	private applySlide(key: number): void {
		const runtime = this.runtimes.get(key);
		const content = runtime?.content;
		if (!runtime || !content) return;

		const dismiss = key === this.virtualIndex ? this.dismissY : 0;
		if (key === this.virtualIndex) this.wakeLayers();

		const natural = runtime.panzoom.naturalSize;
		if (natural && content.dataset['pclW'] !== String(natural.width)) {
			content.style.width = `${natural.width}px`;
			content.style.height = `${natural.height}px`;
			content.dataset['pclW'] = String(natural.width);
		}
		content.style.transform = this.contentTransform(runtime, runtime.panzoom.view, dismiss);
	}

	private animateContent(
		key: number,
		from: ViewTriple,
		to: ViewTriple,
		clip: { inset: Point; direction: 'open' | 'close' } | null,
		easing: string
	): Promise<boolean> {
		this.contentMotion?.stop();
		const runtime = this.runtimes.get(key);
		if (!runtime) return Promise.resolve(true);
		const panzoom = runtime.panzoom;
		panzoom.stopMotions();
		panzoom.scale = to.scale;
		panzoom.x = to.x;
		panzoom.y = to.y;
		this.applySlide(key);
		this.emitZoomIfChanged(key);
		if (!panzoom.naturalSize) return Promise.resolve(true);

		if (runtime.content) return this.runContentAnimation(runtime, key, from, to, clip, easing);

		let resolve!: (done: boolean) => void;
		const result = new Promise<boolean>((r) => (resolve = r));
		const handle = {
			stop: () => {
				if (this.contentMotion !== handle) return;
				this.contentMotion = null;
				this.pendingContentStart = null;
				resolve(false);
			}
		};
		this.contentMotion = handle;
		this.pendingContentStart = {
			key,
			begin: () => {
				if (this.contentMotion === handle) this.contentMotion = null;
				void this.runContentAnimation(runtime, key, from, to, clip, easing).then(resolve);
			}
		};
		return result;
	}

	private runContentAnimation(
		runtime: SlideRuntime,
		key: number,
		from: ViewTriple,
		to: ViewTriple,
		clip: { inset: Point; direction: 'open' | 'close' } | null,
		easing: string
	): Promise<boolean> {
		const content = runtime.content;
		const natural = runtime.panzoom.naturalSize;
		if (!content || !natural) return Promise.resolve(true);
		const panzoom = runtime.panzoom;

		const clipAt = clip ? (t: number) => `inset(${clip.inset.y * t}px ${clip.inset.x * t}px)` : null;
		if (clipAt) {
			if (clip!.direction === 'open') content.style.removeProperty('clip-path');
			else content.style.setProperty('clip-path', clipAt(1));
		}

		const dismiss = key === this.virtualIndex ? this.dismissY : 0;
		const duration = this.options.transitionMs;
		const transformMotion = animateElement(
			content,
			[
				{ transform: this.contentTransform(runtime, from, dismiss) },
				{ transform: this.contentTransform(runtime, to, dismiss) }
			],
			duration,
			easing
		);
		const clipMotion =
			clipAt && transformMotion.anim
				? animateElement(
						content,
						clip!.direction === 'open'
							? [{ clipPath: clipAt(1) }, { clipPath: clipAt(0) }]
							: [{ clipPath: clipAt(0) }, { clipPath: clipAt(1) }],
						duration,
						easing
					)
				: null;

		const anim = transformMotion.anim;
		if (!anim) return Promise.resolve(true);

		const handle = {
			stop: () => {
				if (this.contentMotion !== handle) return;
				this.contentMotion = null;
				const matrix = readMatrix(content);
				anim.cancel();
				clipMotion?.anim?.cancel();
				if (matrix) {
					const scale = matrix.a || panzoom.scale;
					const d = key === this.virtualIndex ? this.dismissY : 0;
					panzoom.scale = scale;
					panzoom.x = matrix.m41 - this.viewportSize.width / 2 + (natural.width * scale) / 2;
					panzoom.y = matrix.m42 - this.viewportSize.height / 2 - d + (natural.height * scale) / 2;
				}
				this.applySlide(key);
				this.emitZoomIfChanged(key);
			}
		};
		this.contentMotion = handle;
		return transformMotion.finished.then((done) => {
			if (this.contentMotion === handle) this.contentMotion = null;
			return done;
		});
	}

	private fadeViewport(from: number, to: number, onDone: (done: boolean) => void): void {
		const viewport = this.refs?.viewport;
		if (!viewport) {
			onDone(true);
			return;
		}
		this.viewportMotion?.stop();
		viewport.style.opacity = to === 1 ? '' : String(to);
		const motion = animateElement(
			viewport,
			[{ opacity: String(from) }, { opacity: String(to) }],
			this.options.transitionMs,
			cssEaseOutCubic
		);
		if (!motion.anim) {
			onDone(true);
			return;
		}
		const anim = motion.anim;
		const handle = {
			stop: () => {
				if (this.viewportMotion !== handle) return;
				this.viewportMotion = null;
				const value = getComputedStyle(viewport).opacity;
				anim.cancel();
				viewport.style.opacity = value;
			}
		};
		this.viewportMotion = handle;
		void motion.finished.then((done) => {
			if (this.viewportMotion === handle) this.viewportMotion = null;
			onDone(done);
		});
	}

	private fadeBackdrop(to: number, durationMs: number): void {
		this.backdropMotion?.stop();
		const backdrop = this.refs?.backdrop;
		const from = this.backdropLevel;
		this.setBackdrop(to);
		if (!backdrop || from === to) return;
		const motion = animateElement(
			backdrop,
			[{ opacity: String(from) }, { opacity: String(to) }],
			durationMs,
			cssEaseOutCubic
		);
		if (!motion.anim) return;
		const anim = motion.anim;
		const handle = {
			stop: () => {
				if (this.backdropMotion !== handle) return;
				this.backdropMotion = null;
				const value = Number(getComputedStyle(backdrop).opacity);
				anim.cancel();
				this.setBackdrop(Number.isNaN(value) ? to : value);
			}
		};
		this.backdropMotion = handle;
		void motion.finished.then(() => {
			if (this.backdropMotion === handle) this.backdropMotion = null;
		});
	}

	private setBackdrop(value: number): void {
		this.backdropLevel = value;
		if (this.refs) this.refs.backdrop.style.opacity = String(value);
	}

	private resolveOrigin(index: number): OriginRect | null {
		const source = this.options.origin?.(index);
		if (!source) return null;
		if (source instanceof HTMLElement) {
			const rect = source.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) return null;
			const cropped =
				source instanceof HTMLImageElement && getComputedStyle(source).objectFit === 'cover';
			return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, cropped };
		}
		return source;
	}

	private originTransition(
		origin: OriginRect,
		runtime: SlideRuntime
	): { view: ViewTriple; clipInset: Point | null } {
		const natural = runtime.panzoom.naturalSize ?? { width: 1, height: 1 };
		const viewportRect = this.viewportRect ?? { x: 0, y: 0 };
		const x = origin.x - viewportRect.x + origin.width / 2 - this.viewportSize.width / 2;
		const y = origin.y - viewportRect.y + origin.height / 2 - this.viewportSize.height / 2;

		const containScale = origin.width / natural.width;
		const coverScale = Math.max(origin.width / natural.width, origin.height / natural.height);
		const aspectMismatch = coverScale / containScale > 1.001;

		if (!origin.cropped || !aspectMismatch) {
			return { view: { scale: containScale, x, y }, clipInset: null };
		}
		return {
			view: { scale: coverScale, x, y },
			clipInset: {
				x: Math.max(0, (natural.width - origin.width / coverScale) / 2),
				y: Math.max(0, (natural.height - origin.height / coverScale) / 2)
			}
		};
	}


	private get interactive(): boolean {
		return this.currentStatus === 'open' || this.currentStatus === 'opening';
	}

	private handlePanStart(axis: 'x' | 'y'): void {
		if (!this.interactive) return;
		this.contentMotion?.stop();
		const runtime = this.activeRuntime();
		this.trackMotion?.stop();
		this.dismissMotion?.stop();

		if (runtime?.panzoom.isZoomed) {
			this.panIntent = 'slide';
			runtime.panzoom.beginGesture();
		} else if (axis === 'y' && this.options.dismiss.drag) {
			this.panIntent = 'dismiss';
			this.backdropMotion?.stop();
			this.dismissHost()?.setAttribute('data-pcl-dismissing', '');
		} else {
			this.panIntent = 'track';
		}
		this.trackDragBase = this.trackOffset;
		this.slideHandoffX = 0;
		this.updateCursor();
	}

	private handlePanMove(dx: number, dy: number, totalX: number, _totalY: number): void {
		switch (this.panIntent) {
			case 'slide': {
				const runtime = this.activeRuntime();
				if (!runtime) return;
				const { leftoverX } = runtime.panzoom.pan(dx, dy);
				this.slideHandoffX += leftoverX;
				this.applyTrack(this.boundedTrackOffset(this.trackDragBase - this.slideHandoffX));
				break;
			}
			case 'track': {
				this.applyTrack(this.boundedTrackOffset(this.restingTrackOffset() - totalX));
				break;
			}
			case 'dismiss': {
				this.dismissY += dy;
				this.applySlide(this.virtualIndex);
				this.updateDismissBackdrop();
				break;
			}
			case 'none':
				break;
		}
	}

	private handlePanEnd(velocityX: number, velocityY: number, totalX: number, _totalY: number): void {
		const intent = this.panIntent;
		this.panIntent = 'none';
		this.updateCursor();
		switch (intent) {
			case 'slide': {
				const runtime = this.activeRuntime();
				const width = this.viewportSize.width;
				if (Math.abs(this.slideHandoffX) > width * 0.2 || (Math.abs(this.slideHandoffX) > 32 && Math.abs(velocityX) > 0.5)) {
					runtime?.panzoom.settle();
					this.goToVirtual(this.virtualIndex + (this.slideHandoffX > 0 ? 1 : -1));
				} else {
					runtime?.panzoom.settle({ x: velocityX, y: velocityY });
					this.animateTrackTo(this.restingTrackOffset());
				}
				break;
			}
			case 'track': {
				const width = this.viewportSize.width;
				let target = this.virtualIndex;
				if (Math.abs(totalX) > width * 0.25 || Math.abs(velocityX) > 0.5) {
					target += totalX < 0 ? 1 : -1;
				}
				this.goToVirtual(target);
				break;
			}
			case 'dismiss': {
				const height = this.viewportSize.height;
				const shouldClose =
					Math.abs(this.dismissY) > height * this.options.dismiss.threshold || Math.abs(velocityY) > 0.7;
				if (shouldClose) {
					this.close();
				} else {
					this.animateDismissTo(0);
				}
				break;
			}
			case 'none':
				break;
		}
	}

	private handlePinchStart(_center: Point): void {
		if (!this.interactive) return;
		const runtime = this.activeRuntime();
		if (!runtime?.panzoom.zoomable) return;
		this.contentMotion?.stop();
		this.emitZoomIntent();
		this.animateTrackTo(this.restingTrackOffset());
		runtime.panzoom.beginGesture();
	}

	private handlePinchMove(ratio: number, center: Point, dx: number, dy: number): void {
		const runtime = this.activeRuntime();
		if (!runtime?.panzoom.zoomable) return;
		runtime.panzoom.pinch(ratio, this.toViewportPoint(center), dx, dy);
	}

	private handlePinchEnd(): void {
		const runtime = this.activeRuntime();
		if (!runtime?.panzoom.zoomable) return;
		if (this.options.dismiss.pinch && runtime.panzoom.rawPinchScale < runtime.panzoom.fitScale * 0.7) {
			this.close();
			return;
		}
		runtime.panzoom.settle();
	}

	private handleTap(_point: Point, target: EventTarget | null): void {
		if (!this.interactive) return;
		const onContent = target instanceof Node && this.isWithinContent(target);
		if (!onContent && this.options.backdropClose) {
			this.closeAfterClick();
			return;
		}
		switch (this.options.tapAction) {
			case 'toggle-ui':
				this.toggleUi();
				break;
			case 'close':
				this.close();
				break;
			case 'none':
				break;
		}
	}

	private closeAfterClick(): void {
		const viewport = this.refs?.viewport;
		if (!viewport) {
			this.close();
			return;
		}
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			viewport.removeEventListener('click', finish);
			this.close();
		};
		viewport.addEventListener('click', finish);
		const timer = setTimeout(finish, 120);
	}

	private handleDoubleTap(point: Point): void {
		if (!this.interactive) return;
		const runtime = this.activeRuntime();
		if (!runtime) return;
		this.contentMotion?.stop();
		if (!runtime.panzoom.isZoomed) this.emitZoomIntent();
		runtime.panzoom.toggleZoom(this.toViewportPoint(point));
	}

	private handleWheel(event: WheelEvent): void {
		if (!this.interactive) return;
		const pinch = event.ctrlKey || event.metaKey;
		const mode = this.options.wheelMode;
		if (!pinch && mode === 'none') return;
		event.preventDefault();

		if (pinch || mode === 'zoom') {
			const runtime = this.activeRuntime();
			if (!runtime?.panzoom.zoomable) return;
			if (event.deltaY < 0) this.emitZoomIntent();
			this.contentMotion?.stop();
			const delta = pinch ? event.deltaY * 4 : event.deltaY;
			runtime.panzoom.wheelZoom(delta, this.toViewportPoint({ x: event.clientX, y: event.clientY }));
			this.updateCursor();
			return;
		}

		const now = performance.now();
		if (now < this.wheelCooldownUntil) return;
		this.wheelAccum += event.deltaY;
		if (Math.abs(this.wheelAccum) >= 80) {
			const direction = this.wheelAccum > 0 ? 1 : -1;
			this.wheelAccum = 0;
			this.wheelCooldownUntil = now + 250;
			this.goTo(this.currentIndex + direction);
		}
	}

	private handleKeydown(event: KeyboardEvent): void {
		if (!this.keyboardEnabled) return;
		if (event.key === 'Escape') {
			if (this.currentStatus === 'open' || this.currentStatus === 'opening') {
				event.preventDefault();
				this.close();
			}
			return;
		}
		if (!this.interactive) return;
		switch (event.key) {
			case 'ArrowRight':
				event.preventDefault();
				this.next();
				break;
			case 'ArrowLeft':
				event.preventDefault();
				this.prev();
				break;
			case '+':
			case '=':
				this.contentMotion?.stop();
				this.emitZoomIntent();
				this.activeRuntime()?.panzoom.toggleZoom();
				break;
			case '-': {
				const runtime = this.activeRuntime();
				this.contentMotion?.stop();
				runtime?.panzoom.animateTo(runtime.panzoom.fitScale);
				break;
			}
		}
	}

	private isWithinContent(node: Node): boolean {
		for (const runtime of this.runtimes.values()) {
			if (runtime.content?.contains(node)) return true;
		}
		return false;
	}

	private toViewportPoint(client: Point): Point {
		const rect = this.viewportRect;
		return {
			x: client.x - (rect?.x ?? 0) - this.viewportSize.width / 2,
			y: client.y - (rect?.y ?? 0) - this.viewportSize.height / 2
		};
	}

	private boundedTrackOffset(raw: number): number {
		if (this.continuousLoop || this.options.loop) return raw;
		const min = 0;
		const max = this.restingTrackOffset(this.count - 1);
		if (raw < min) return min - rubberBand(min - raw, 0, this.viewportSize.width * 0.4);
		if (raw > max) return max + rubberBand(raw - max, 0, this.viewportSize.width * 0.4);
		return raw;
	}

	private animateTrackTo(target: number, onComplete?: () => void): void {
		this.trackMotion?.stop();
		const track = this.refs?.track;
		if (!track || Math.abs(target - this.trackOffset) < 0.5) {
			this.applyTrack(target);
			onComplete?.();
			return;
		}
		const from = this.trackOffset;
		this.applyTrack(target);
		const motion = animateElement(
			track,
			[{ transform: `translate3d(${-from}px, 0, 0)` }, { transform: `translate3d(${-target}px, 0, 0)` }],
			320,
			cssEaseOutCubic
		);
		if (!motion.anim) {
			onComplete?.();
			return;
		}
		const anim = motion.anim;
		const handle = {
			stop: () => {
				if (this.trackMotion !== handle) return;
				this.trackMotion = null;
				const matrix = readMatrix(track);
				anim.cancel();
				if (matrix) this.applyTrack(-matrix.m41);
			}
		};
		this.trackMotion = handle;
		void motion.finished.then((done) => {
			if (this.trackMotion === handle) this.trackMotion = null;
			if (done) onComplete?.();
		});
	}

	private animateDismissTo(target: number): void {
		this.dismissMotion?.stop();
		this.dismissMotion = tween({
			from: this.dismissY,
			to: target,
			durationMs: 280,
			onUpdate: (value) => {
				this.dismissY = value;
				this.applySlide(this.virtualIndex);
				this.updateDismissBackdrop();
			},
			onComplete: () => this.dismissHost()?.removeAttribute('data-pcl-dismissing')
		});
	}

	private dismissHost(): HTMLElement | null {
		return this.refs ? (this.refs.root ?? this.refs.viewport) : null;
	}

	private updateDismissBackdrop(): void {
		const height = this.viewportSize.height;
		const fade = Math.min(1, Math.abs(this.dismissY) / (height * 0.5));
		this.setBackdrop(this.options.backdropOpacity * (1 - fade * 0.85));
		const progress = Math.min(1, Math.abs(this.dismissY) / (height * this.options.dismiss.threshold));
		this.dismissHost()?.style.setProperty('--pcl-dismiss', String(progress));
		this.emitter.emit('dismiss', { progress, offsetY: this.dismissY });
	}
}

export function createViewer<T = unknown>(options: CreateViewerOptions<T>): Viewer<T> {
	return new Viewer(options);
}
