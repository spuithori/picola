<script lang="ts" generics="T = unknown">
	import Captions from '@lucide/svelte/icons/captions';
	import CaptionsOff from '@lucide/svelte/icons/captions-off';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import X from '@lucide/svelte/icons/x';
	import ZoomIn from '@lucide/svelte/icons/zoom-in';
	import ZoomOut from '@lucide/svelte/icons/zoom-out';
	import { untrack, type Snippet } from 'svelte';
	import {
		createViewer,
		type DismissOptions,
		type OriginRect,
		type Slide,
		type TapAction,
		type Viewer,
		type ZoomOptions
	} from '../core/index.js';
	import type { LightboxContext, LightboxLabels } from './types.js';

	interface Props {
		slides: Slide<T>[];
		open?: boolean;
		index?: number;
		loop?: boolean;
		backdropOpacity?: number;
		slideGap?: number;
		preload?: readonly [number, number];
		zoom?: ZoomOptions;
		dismiss?: DismissOptions;
		tapAction?: TapAction;
		backdropClose?: boolean;
		wheel?: 'zoom' | 'navigate' | 'none';
		keyboard?: boolean;
		history?: boolean;
		transitionMs?: number;
		origin?: (index: number) => OriginRect | HTMLElement | null | undefined;
		container?: HTMLElement;
		labels?: LightboxLabels;
		counter?: boolean;
		zoomButton?: boolean;
		showCaption?: boolean;
		chrome?: boolean;
		viewer?: Viewer<T> | null;
		toolbar?: Snippet<[LightboxContext<T>]>;
		caption?: Snippet<[LightboxContext<T> & { expanded: boolean; toggle(): void }]>;
		onopen?: (detail: { index: number }) => void;
		onclose?: (detail: { index: number }) => void;
		onclosed?: () => void;
		onchange?: (detail: { index: number; slide: Slide<T> }) => void;
		onload?: (detail: { index: number; slide: Slide<T> }) => void;
		onerror?: (detail: { index: number; slide: Slide<T>; error: unknown }) => void;
		onzoomintent?: (detail: { index: number; slide: Slide<T> }) => void;
	}

	let {
		slides,
		open = $bindable(false),
		index = $bindable(0),
		loop = false,
		backdropOpacity = 0.9,
		slideGap = 16,
		preload = [1, 1],
		zoom,
		dismiss,
		tapAction = 'toggle-ui',
		backdropClose = true,
		wheel = 'zoom',
		keyboard = true,
		history = false,
		transitionMs = 260,
		origin,
		container,
		labels,
		counter = true,
		zoomButton = true,
		showCaption = true,
		chrome = true,
		viewer = $bindable(null),
		toolbar,
		caption,
		onopen,
		onclose,
		onclosed,
		onchange,
		onload,
		onerror,
		onzoomintent
	}: Props = $props();

	let visible = $state(false);
	let session = $state(0);
	let liveSlides = $state.raw<Slide<T>[]>([]);
	let loaded = $state<boolean[]>([]);
	let underlay = $state<Record<number, string | undefined>>({});
	let uiVisible = $state(true);
	let closing = $state(false);
	let isZoomed = $state(false);
	let captionShown = $state(true);
	let captionExpanded = $state(false);

	let rootEl = $state<HTMLElement>();
	let viewportEl = $state<HTMLElement>();
	let trackEl = $state<HTMLElement>();
	let backdropEl = $state<HTMLElement>();

	const count = $derived(liveSlides.length);
	const activeSlide = $derived(liveSlides[index]);
	const altText = $derived(activeSlide?.alt ?? '');
	const announcement = $derived(count ? `${index + 1} / ${count}${altText ? `: ${altText}` : ''}` : '');

	let mountedWindow = $state.raw<{ key: number; index: number }[]>([]);

	const context = $derived.by((): LightboxContext<T> | null => {
		const current = viewer;
		if (!current) return null;
		return {
			viewer: current,
			index,
			slide: liveSlides[index],
			count,
			close: () => current.close(),
			next: () => current.next(),
			prev: () => current.prev(),
			goTo: (i: number) => current.goTo(i),
			updateSlide: (i: number, patch: Partial<Slide<T>>) => current.updateSlide(i, patch),
			setKeyboardEnabled: (enabled: boolean) => current.setKeyboardEnabled(enabled)
		};
	});

	let syncedSlides: Slide<T>[] | null = null;
	let subscriptions: (() => void)[] = [];
	let previousOverflow = '';

	$effect(() => {
		const want = open;
		untrack(() => {
			if (want) beginSession();
			else viewer?.close();
		});
	});

	$effect(() => {
		return () => teardown();
	});

	$effect(() => {
		const current = slides;
		const v = viewer;
		if (!v) return;
		untrack(() => {
			if (syncedSlides === current) return;
			syncedSlides = current;
			v.setSlides(current);
		});
	});

	$effect(() => {
		const target = index;
		const v = viewer;
		if (!v) return;
		untrack(() => {
			if (v.status === 'closing' || v.status === 'closed') return;
			if (v.index !== target) v.goTo(target);
		});
	});

	function beginSession(): void {
		if (viewer) {
			if (viewer.status !== 'closing') return;
			teardown();
		}
		const v = createViewer<T>({
			slides: [...slides],
			startIndex: index,
			loop,
			backdropOpacity,
			slideGap,
			preload,
			tapAction,
			backdropClose,
			wheel,
			keyboard,
			history,
			transitionMs,
			...(zoom ? { zoom } : {}),
			...(dismiss ? { dismiss } : {}),
			...(origin ? { origin } : {})
		});

		syncedSlides = slides;
		liveSlides = [...slides];
		loaded = [];
		underlay = {};
		uiVisible = true;
		closing = false;
		isZoomed = false;
		captionExpanded = false;

		const windowCache = new Map<number, { key: number; index: number }>();
		const refreshWindow = () => {
			const next = v.windowSlides().map((w) => {
				const cached = windowCache.get(w.key);
				return cached && cached.index === w.index ? cached : w;
			});
			windowCache.clear();
			for (const w of next) windowCache.set(w.key, w);
			mountedWindow = next;
		};

		subscriptions = [
			v.on('change', (detail) => {
				index = detail.index;
				captionExpanded = false;
				refreshWindow();
				onchange?.(detail);
			}),
			v.on('ui', (detail) => (uiVisible = detail.visible)),
			v.on('zoom', (detail) => (isZoomed = detail.scale > detail.fitScale * 1.001)),
			v.on('load', (detail) => {
				loaded[detail.key] = true;
				underlay[detail.key] = undefined;
				onload?.(detail);
			}),
			v.on('error', (detail) => onerror?.(detail)),
			v.on('zoomintent', (detail) => onzoomintent?.(detail)),
			v.on('slideupdate', (detail) => {
				const previous = liveSlides[detail.index];
				for (const w of mountedWindow) {
					if (w.index !== detail.index) continue;
					if (previous && loaded[w.key] && previous.src !== detail.slide.src) {
						underlay[w.key] = previous.src;
					}
					loaded[w.key] = false;
				}
				liveSlides = liveSlides.map((s, i) => (i === detail.index ? detail.slide : s));
			}),
			v.on('slideschange', (detail) => {
				liveSlides = [...detail.slides];
				index = detail.index;
				refreshWindow();
			}),
			v.on('open', (detail) => onopen?.(detail)),
			v.on('close', (detail) => {
				closing = true;
				open = false;
				onclose?.(detail);
			}),
			v.on('closed', () => {
				teardown();
				onclosed?.();
			})
		];

		viewer = v;
		visible = true;
		session += 1;
		previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		v.open(index);
		refreshWindow();
	}

	function teardown(): void {
		if (!viewer) return;
		for (const unsubscribe of subscriptions) unsubscribe();
		subscriptions = [];
		viewer.destroy();
		viewer = null;
		visible = false;
		closing = false;
		document.body.style.overflow = previousOverflow;
	}

	$effect(() => {
		if (viewer && rootEl && viewportEl && trackEl && backdropEl) {
			return viewer.attach({ root: rootEl, viewport: viewportEl, track: trackEl, backdrop: backdropEl });
		}
	});

	function portal(node: HTMLElement) {
		(container ?? document.body).appendChild(node);
		return () => node.remove();
	}

	function toggleZoom() {
		viewer?.zoomTo(isZoomed ? 0 : Number.POSITIVE_INFINITY);
	}

	function toggleCaption() {
		captionShown = !captionShown;
	}

	export function close(): void {
		viewer?.close();
	}
	export function next(): void {
		viewer?.next();
	}
	export function prev(): void {
		viewer?.prev();
	}
	export function goTo(target: number): void {
		viewer?.goTo(target);
	}
	export function updateSlide(target: number, patch: Partial<Slide<T>>): void {
		viewer?.updateSlide(target, patch);
	}
	export function getViewer(): Viewer<T> | null {
		return viewer;
	}
</script>

{#if visible}
	<div
		class="pcl"
		class:pcl--ui-hidden={!uiVisible}
		class:pcl--closing={closing}
		role="dialog"
		aria-modal="true"
		aria-label={labels?.dialog ?? 'Image viewer'}
		tabindex="-1"
		bind:this={rootEl}
		{@attach portal}
	>
		<div class="pcl__backdrop" bind:this={backdropEl} style:opacity="0"></div>
		<div class="pcl__sr" aria-live="polite">{announcement}</div>

		<div class="pcl__viewport" bind:this={viewportEl}>
			<div class="pcl__track" bind:this={trackEl}>
				{#each mountedWindow as w (w.key)}
					{@const slide = liveSlides[w.index]}
					{#if slide}
						<div
							class="pcl__content"
							class:pcl__content--contain={!(slide.width && slide.height) && !loaded[w.key]}
							style:left="calc({w.key} * (100% + {slideGap}px))"
							role="group"
							aria-roledescription="slide"
							aria-label="{w.index + 1} / {count}"
							{@attach (node) => viewer?.connectSlide(w.key, { content: node })}
						>
							{#if underlay[w.key] && !loaded[w.key]}
								<img
									class="pcl__placeholder"
									src={underlay[w.key]}
									alt=""
									aria-hidden="true"
									draggable="false"
									{@attach (node) => () => {
										node.removeAttribute('srcset');
										node.removeAttribute('src');
									}}
								/>
							{:else if slide.placeholder && !loaded[w.key]}
								<img
									class="pcl__placeholder"
									src={slide.placeholder}
									alt=""
									aria-hidden="true"
									draggable="false"
								/>
							{/if}
							{#key `${session}:${slide.src}`}
								<img
									class="pcl__img"
									class:pcl__img--pending={!loaded[w.key]}
									src={slide.src}
									srcset={slide.srcset}
									sizes={slide.sizes}
									alt={slide.alt ?? ''}
									draggable="false"
									{@attach (node) => viewer?.bindImage(w.key, node as HTMLImageElement)}
								/>
							{/key}
						</div>
					{/if}
				{/each}
			</div>
		</div>

		{#if chrome}
			<div class="pcl__chrome">
				<div class="pcl__topbar">
				{#if counter && count > 1}
					<div class="pcl__counter">{index + 1} / {count}</div>
				{/if}
				<div class="pcl__actions">
					{#if toolbar && context}
						{@render toolbar(context)}
					{/if}
					{#if showCaption && altText}
						<button
							type="button"
							class="pcl__button"
							aria-label={labels?.caption ?? 'Toggle caption'}
							aria-pressed={captionShown}
							onclick={toggleCaption}
						>
							{#if captionShown}<Captions />{:else}<CaptionsOff />{/if}
						</button>
					{/if}
					{#if zoomButton}
						<button
							type="button"
							class="pcl__button pcl__button--zoom"
							aria-label={labels?.zoom ?? 'Toggle zoom'}
							onclick={toggleZoom}
						>
							{#if isZoomed}<ZoomOut />{:else}<ZoomIn />{/if}
						</button>
					{/if}
					<button
						type="button"
						class="pcl__button"
						aria-label={labels?.close ?? 'Close'}
						onclick={() => viewer?.close()}
					>
						<X />
					</button>
				</div>
			</div>

			{#if count > 1}
				<button
					type="button"
					class="pcl__arrow pcl__arrow--prev"
					aria-label={labels?.prev ?? 'Previous image'}
					disabled={!loop && index === 0}
					onclick={() => viewer?.prev()}
				>
					<ChevronLeft size={32} />
				</button>
				<button
					type="button"
					class="pcl__arrow pcl__arrow--next"
					aria-label={labels?.next ?? 'Next image'}
					disabled={!loop && index === count - 1}
					onclick={() => viewer?.next()}
				>
					<ChevronRight size={32} />
				</button>
			{/if}

			{#if showCaption && captionShown && altText}
				<div class="pcl__caption" class:pcl__caption--expanded={captionExpanded}>
					{#if caption && context}
						{@render caption({
							...context,
							expanded: captionExpanded,
							toggle: () => (captionExpanded = !captionExpanded)
						})}
					{:else}
						<button
							type="button"
							class="pcl__caption-text"
							aria-expanded={captionExpanded}
							onclick={() => (captionExpanded = !captionExpanded)}
						>
							{altText}
						</button>
					{/if}
				</div>
			{/if}
		</div>
		{/if}
	</div>
{/if}
