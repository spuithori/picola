import type { Slide, Viewer } from '../core/index.js';

/** Passed to the `toolbar` and `caption` snippets. */
export interface LightboxContext<T = unknown> {
	/** Core viewer instance for advanced control. */
	viewer: Viewer<T>;
	/** Active slide index. */
	index: number;
	/** Active slide. */
	slide: Slide<T> | undefined;
	count: number;
	close(): void;
	next(): void;
	prev(): void;
	goTo(index: number): void;
	/** Patch a slide in place (e.g. swap in a full-resolution source). */
	updateSlide(index: number, patch: Partial<Slide<T>>): void;
	/**
	 * Suspend/resume picola's keyboard handling — call with `false` while
	 * layering your own modal above the viewer so Escape reaches the modal,
	 * and restore with `true` when it closes.
	 */
	setKeyboardEnabled(enabled: boolean): void;
}

/** Accessible labels for the built-in chrome, for i18n. */
export interface LightboxLabels {
	dialog?: string;
	close?: string;
	next?: string;
	prev?: string;
	zoom?: string;
	caption?: string;
}
