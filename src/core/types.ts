/** A single image shown by the viewer. */
export interface Slide<T = unknown> {
	/** Full-quality image URL. */
	src: string;
	/**
	 * Low-resolution stand-in shown instantly while `src` loads.
	 * Typically the thumbnail that is already decoded in the page.
	 */
	placeholder?: string;
	/** Natural width of `src` in pixels, if known ahead of time. */
	width?: number;
	/** Natural height of `src` in pixels, if known ahead of time. */
	height?: number;
	/** Accessible description of the image. */
	alt?: string;
	/** Responsive candidates for `src`. */
	srcset?: string;
	sizes?: string;
	/** Arbitrary consumer data carried alongside the slide. */
	meta?: T;
}

export interface ZoomOptions {
	/**
	 * Maximum zoom as a multiple of the natural image size.
	 * @default 2
	 */
	max?: number;
	/**
	 * Scale a double-tap / double-click zooms to, as a multiple of the
	 * natural image size. Clamped to `max`.
	 * @default 2
	 */
	doubleTap?: number;
	/**
	 * Zoom with trackpad pinch / ctrl+wheel.
	 * @default true
	 */
	wheel?: boolean;
}

export interface DismissOptions {
	/**
	 * Close by dragging the slide vertically while not zoomed.
	 * @default true
	 */
	drag?: boolean;
	/**
	 * Fraction of the viewport height the slide must travel before a
	 * released drag closes the viewer.
	 * @default 0.22
	 */
	threshold?: number;
	/**
	 * Close when a pinch gesture ends well below the fit scale.
	 * @default true
	 */
	pinch?: boolean;
}

/** What a single tap (or plain click) on the slide area does. */
export type TapAction = 'toggle-ui' | 'close' | 'none';

export interface ViewerOptions<T = unknown> {
	slides: readonly Slide<T>[];
	/** @default 0 */
	startIndex?: number;
	/** Wrap from the last slide to the first. @default false */
	loop?: boolean;
	/** Backdrop opacity when fully open, 0–1. @default 0.9 */
	backdropOpacity?: number;
	/** Slides decoded around the active one: `[before, after]`. @default [1, 1] */
	preload?: readonly [number, number];
	/** Gap between adjacent slides in pixels. @default 16 */
	slideGap?: number;
	zoom?: ZoomOptions;
	dismiss?: DismissOptions;
	/** @default 'toggle-ui' */
	tapAction?: TapAction;
	/** Close when the backdrop (outside the image) is clicked. @default true */
	backdropClose?: boolean;
	/**
	 * Wheel behaviour. Trackpad pinch (ctrl/meta + wheel) always zooms with
	 * focal-point precision regardless of this setting.
	 * @default 'zoom'
	 */
	wheel?: 'zoom' | 'navigate' | 'none';
	/** Arrow keys / Escape / +/- handling. @default true */
	keyboard?: boolean;
	/**
	 * Push a history entry while open so the platform back gesture closes
	 * the viewer instead of leaving the page.
	 * @default false
	 */
	history?: boolean;
	/** Duration of the open/close transition in ms. @default 260 */
	transitionMs?: number;
}

export type ViewerStatus = 'closed' | 'opening' | 'open' | 'closing';

/** Current transform of a slide's content. */
export interface SlideView {
	/** Absolute scale: displayed px / natural px. */
	scale: number;
	/** Scale at which the image exactly fits the viewport. */
	fitScale: number;
	/** Screen-px offset of the content centre from the viewport centre. */
	x: number;
	y: number;
}

export interface DismissState {
	/** 0 = resting, 1 = past the release threshold. */
	progress: number;
	offsetY: number;
}

/** Payload map for {@link Viewer.on}. */
export type ViewerEvents<T = unknown> = {
	/** Opening transition started. */
	open: { index: number };
	/** Opening transition finished. */
	opened: { index: number };
	/** Closing transition started. */
	close: { index: number };
	/** Closing transition finished; safe to unmount. */
	closed: undefined;
	/** Active slide changed. */
	change: { index: number; slide: Slide<T> };
	/** Zoom level of the active slide changed. */
	zoom: { index: number; scale: number; fitScale: number };
	/** Vertical drag-to-dismiss progress, for custom chrome fading. */
	dismiss: DismissState;
	/** UI chrome visibility toggled (tap action). */
	ui: { visible: boolean };
	/**
	 * Full-quality image finished decoding. `key` is the mount key used by
	 * the adapter's slide window (differs from `index` only in loop mode).
	 */
	load: { index: number; slide: Slide<T>; key: number };
	/** Full-quality image failed to load. */
	error: { index: number; slide: Slide<T>; error: unknown; key: number };
	/** A slide was patched via `updateSlide`. */
	slideupdate: { index: number; slide: Slide<T> };
	/** The slide set was replaced via `setSlides` (e.g. pagination append). */
	slideschange: { slides: readonly Slide<T>[]; index: number };
	/**
	 * The user first expressed zoom intent on a slide (pinch, double-tap,
	 * wheel zoom-in or `+`). Fired once per slide — ideal for deferring
	 * full-resolution upgrades until they are actually needed.
	 */
	zoomintent: { index: number; slide: Slide<T> };
	/** The viewer was destroyed. */
	destroy: undefined;
};

export interface Size {
	width: number;
	height: number;
}

export interface Point {
	x: number;
	y: number;
}

/** Rect used for the open/close transition origin (usually a thumbnail). */
export interface OriginRect {
	x: number;
	y: number;
	width: number;
	height: number;
	/**
	 * The thumbnail shows a centre crop of the image (`object-fit: cover`).
	 * The transition then animates a clip reveal instead of a plain scale.
	 * Detected automatically when the origin is an `<img>` element.
	 */
	cropped?: boolean;
}
