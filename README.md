<h1 align="center">
  <img src="static/logo.svg" alt="picola" width="360">
</h1>

<p align="center">
  A fast, type-safe, extensible lightbox / image viewer.<br>
  Framework-agnostic core with a first-class <strong>Svelte 5</strong> adapter.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/picola"><img alt="npm" src="https://img.shields.io/npm/v/picola?color=cb3837&logo=npm"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/npm/l/picola"></a>
</p>

> ⚠️ Early development. APIs may change before 1.0.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Recipes](#recipes)
- [Styling](#styling)
- [API Reference](#api-reference)
- [Framework-agnostic Core](#framework-agnostic-core)
- [Browser Support](#browser-support)
- [Development](#development)
- [License](#license)

## Features

- **Type-safe to the edges** — strict TypeScript everywhere, typed events, and a
  generic `Slide<T>` so your own per-slide data (download names, IDs, …) flows
  through with full inference.
- **Built for Svelte 5** — customise the toolbar and caption with snippets and
  real components. No SVG-string injection, no manual `mount`/`unmount` into
  library-owned DOM.
- **Memory-conscious** — only the active slide ± 1 is mounted; evicted slides
  release their decoded bitmaps.
- **Small** — the `picola/svelte` adapter is ~15.6 KB min+gzip with icons
  included (~14.4 KB when lucide is already in your app), on a dependency-free
  ~11.0 KB core; the stylesheet adds ~1.3 KB.
- **Framework-agnostic core** — the core has zero dependencies and owns gestures,
  physics and transforms. Adapters for other frameworks can be built on top.
- **Modern UX defaults** — pinch / double-tap / wheel zoom with focal-point
  precision, rubber-band overscroll, velocity-based flicks, drag-down (or up) to
  dismiss, pinch-to-close, keyboard navigation and a focus trap.
- **Style without `!important`** — flat single-class selectors tuned via CSS
  custom properties, robust against global resets.

## Installation

```sh
npm i picola
```

The Svelte adapter (`picola/svelte`) uses [`@lucide/svelte`](https://lucide.dev)
for its built-in icons as a peer dependency — npm 7+ installs it automatically,
and if your app already depends on lucide the single shared copy is reused (no
duplicate icons in your bundle).

**Requirements**

- The core (`picola`) is dependency-free and framework-agnostic.
- `picola/svelte` requires **Svelte 5** and `@lucide/svelte` v1 as peers.
- A modern evergreen browser (see [Browser Support](#browser-support)).

## Quick Start

```svelte
<script lang="ts">
	import { Lightbox, type Slide } from 'picola/svelte';
	import 'picola/picola.css';

	const slides: Slide[] = [
		{
			src: '/photos/full/1.jpg',
			placeholder: '/photos/thumb/1.jpg', // shown instantly while src loads
			width: 2400,
			height: 1600,
			alt: 'A river running through a valley at dusk.'
		}
		// ...
	];

	let open = $state(false);
	let index = $state(0);
</script>

<button onclick={() => ((index = 0), (open = true))}>Open gallery</button>

<Lightbox bind:open bind:index {slides} />
```

That is a complete, keyboard- and gesture-driven viewer. Everything below is
optional refinement.

## Recipes

### Fly from the thumbnail

Register thumbnails with an attachment and the open/close transitions animate
from and to them:

```svelte
<script lang="ts">
	import { Lightbox, createGalleryOrigins } from 'picola/svelte';
	const gallery = createGalleryOrigins();
</script>

{#each slides as slide, i}
	<img {@attach gallery.attach(i)} src={slide.placeholder} alt={slide.alt} />
{/each}

<Lightbox bind:open bind:index {slides} origin={gallery.origin} />
```

A plain `origin={(i) => thumbEls[i]}` resolver works too. When the origin is an
`<img>` with `object-fit: cover`, the transition animates a clip reveal instead
of a plain scale.

### Custom toolbar buttons

The `toolbar` snippet receives a fully typed context — the core viewer, the
active slide (including your `meta`), and navigation helpers:

```svelte
<script lang="ts">
	import { Lightbox, ToolbarButton } from 'picola/svelte';
	import Download from '@lucide/svelte/icons/download';
</script>

<Lightbox bind:open bind:index {slides}>
	{#snippet toolbar(ctx)}
		<ToolbarButton label="Download" onclick={() => download(ctx.slide)}>
			<Download />
		</ToolbarButton>
	{/snippet}
</Lightbox>
```

### Custom and interactive captions

If a slide has `alt`, picola renders a clamped caption with expand-on-tap and a
toolbar toggle. Replace it entirely with the `caption` snippet — it receives the
context plus `expanded` and `toggle()` — or disable the feature with
`showCaption={false}`:

```svelte
<Lightbox bind:open {slides}>
	{#snippet caption(ctx)}
		<MyCaption text={ctx.slide?.alt} expanded={ctx.expanded} ontoggle={ctx.toggle} />
	{/snippet}
</Lightbox>
```

Want a tap on the caption to open your own full-text modal instead? Render it
inside the snippet (it lives inside the lightbox root, so stacking and the focus
trap just work) and suspend picola's keyboard handling while it is up so Escape
reaches your modal first:

```svelte
{#snippet caption(ctx)}
	<button onclick={() => { altModal = true; ctx.setKeyboardEnabled(false); }}>
		{ctx.slide?.alt}
	</button>
	{#if altModal}
		<MyAltModal
			text={ctx.slide?.alt}
			onclose={() => { altModal = false; ctx.setKeyboardEnabled(true); }}
		/>
	{/if}
{/snippet}
```

### Defer full resolution until the user zooms

Instead of fetching originals for every viewed slide, defer them to actual zoom
intent — `zoomintent` fires once per slide on the first pinch, double-tap, wheel
zoom or `+`:

```svelte
<Lightbox
	bind:open
	{slides}
	onzoomintent={async ({ index }) => {
		const url = await fetchOriginalUrl(index);
		lightbox.updateSlide(index, { src: url });
	}}
	bind:this={lightbox}
/>
```

While the new source decodes, the previous image stays visible (double
buffering), so the swap is seamless even mid-zoom.

### Upgrade resolution after opening

Open instantly with what you have, then swap in a better source. Zoom and pan
are preserved across the swap:

```svelte
<Lightbox
	bind:open
	{slides}
	onchange={async ({ index }) => {
		const url = await fetchOriginalUrl(index);
		lightbox.updateSlide(index, { src: url });
	}}
	bind:this={lightbox}
/>
```

### Reactive slides and pagination

The `slides` prop is reactive. Replacing the array — appending more images after
pagination, reordering, filtering — syncs into the open viewer, clamping the
active index and preserving zoom state:

```svelte
<script lang="ts">
	let slides = $state<Slide[]>(firstPage);

	async function onchange({ index }: { index: number }) {
		if (index >= slides.length - 2) {
			slides = [...slides, ...(await fetchNextPage())];
		}
	}
</script>

<Lightbox bind:open bind:index {slides} {onchange} />
```

### Headless mode

With `chrome={false}` picola renders only the image surface — gestures, zoom and
transitions — and none of the built-in UI. Drive it entirely from your own
components through `bind:viewer`:

```svelte
<script lang="ts">
	import { Lightbox, type Viewer } from 'picola/svelte';
	let open = $state(false);
	let viewer = $state<Viewer | null>(null);
</script>

<Lightbox bind:open bind:viewer {slides} chrome={false} />

{#if open && viewer}
	<nav class="my-chrome">
		<button onclick={() => viewer.prev()}>Prev</button>
		<button onclick={() => viewer.next()}>Next</button>
		<button onclick={() => viewer.close()}>Close</button>
	</nav>
{/if}
```

## Styling

Tune the appearance through CSS custom properties on the `.pcl` root:

```css
.pcl {
	--pcl-z: 2000;
	--pcl-backdrop: rgba(10, 10, 16, 0.55);
	--pcl-backdrop-filter: blur(16px);
	--pcl-caption-lines: 3;
}
```

`--pcl-backdrop-filter` enables background blur (GPU cost applies — it is `none`
by default). A zero-specificity mini-reset scoped to `.pcl` ships with the
stylesheet, so the chrome renders identically whether or not your app uses a
global CSS reset. Transitions respect `prefers-reduced-motion`.

Every default rule uses a flat single-class selector (`.pcl__button` etc.), so
your stylesheet overrides them with normal cascade order or one extra class of
specificity — no `!important` required. The custom-property defaults are declared
at zero specificity (`:where(.pcl)`), so a plain `.pcl { --pcl-z: … }` in your app
always wins regardless of stylesheet order. Styles deliberately avoid `@layer`:
layered library styles would lose to the unlayered global resets present in most
apps.

### Custom properties

| Property | Default | Description |
| --- | --- | --- |
| `--pcl-z` | `1000` | Root stacking context (`z-index`). |
| `--pcl-backdrop` | `#000` | Backdrop color. |
| `--pcl-backdrop-filter` | `none` | Backdrop filter, e.g. `blur(16px)` (opt-in; GPU cost). |
| `--pcl-chrome-color` | `#fff` | Foreground color of buttons, counter and arrows. |
| `--pcl-chrome-bg` | `rgba(0, 0, 0, 0.35)` | Hover / active background of chrome controls. |
| `--pcl-button-bg` | `rgba(0, 0, 0, 0.2)` | Idle toolbar-button background. |
| `--pcl-button-size` | `44px` | Toolbar-button hit area. |
| `--pcl-arrow-size` | `48px` | Previous / next arrow hit area. |
| `--pcl-caption-bg` | `rgba(0, 0, 0, 0.55)` | Caption background. |
| `--pcl-caption-color` | `#fff` | Caption text color. |
| `--pcl-caption-lines` | `2` | Lines shown before the caption clamps. |
| `--pcl-dismiss` | _(runtime)_ | Drag-to-dismiss progress, `0`–`1`, written by the core. Read it to fade custom chrome. |

## API Reference

### `<Lightbox>` props

`Lightbox` is generic over your per-slide `meta` type: `<Lightbox slides={...} />`
infers `T` from the `slides` you pass.

**Content**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `slides` | `Slide<T>[]` | — | Images to display (required). |
| `open` | `boolean` | `false` | Viewer visibility. Bindable. |
| `index` | `number` | `0` | Active slide index. Bindable — writing it while open navigates. |

**Behavior**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `zoom` | `ZoomOptions` | `{ max: 2, doubleTap: 2, wheel: true }` | Zoom limits, as multiples of natural size. |
| `dismiss` | `DismissOptions` | `{ drag: true, threshold: 0.22, pinch: true }` | Drag-to-dismiss and pinch-to-close. |
| `tapAction` | `'toggle-ui' \| 'close' \| 'none'` | `'toggle-ui'` | What a single tap on the image does. |
| `backdropClose` | `boolean` | `true` | Clicking outside the image closes the viewer. |
| `wheel` | `'zoom' \| 'navigate' \| 'none'` | `'zoom'` | Wheel behavior. Trackpad pinch always zooms. |
| `keyboard` | `boolean` | `true` | Handle Escape / arrows / `+` / `-`. |
| `history` | `boolean` | `false` | Push a history entry so the platform back gesture closes the viewer. |
| `loop` | `boolean` | `false` | Wrap past the ends. Seamless with 3+ slides; wrap-around below that. |
| `preload` | `readonly [number, number]` | `[1, 1]` | Slides kept mounted `[before, after]` the active one. |

**Appearance**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `chrome` | `boolean` | `true` | Render the built-in UI. Set `false` for a headless viewer. |
| `counter` | `boolean` | `true` | Show the `n / total` counter. |
| `zoomButton` | `boolean` | `true` | Show the zoom toggle button. |
| `showCaption` | `boolean` | `true` | Show the alt-text caption. |
| `backdropOpacity` | `number` | `0.9` | Backdrop opacity when fully open (`0`–`1`). |
| `slideGap` | `number` | `16` | Gap between adjacent slides, in px. |
| `transitionMs` | `number` | `260` | Open / close transition duration, in ms. |
| `labels` | `LightboxLabels` | — | Accessible labels for the built-in chrome (i18n). |

**Advanced**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `origin` | `(index: number) => HTMLElement \| OriginRect \| null` | — | Source element/rect for the open/close transition. |
| `container` | `HTMLElement` | `document.body` | Portal target for the viewer root. |
| `viewer` | `Viewer<T> \| null` | `null` | The core viewer instance while open. Bindable (`bind:viewer`). |

### Events

The most common events are exposed as callback props:

| Prop | Payload | Fires when |
| --- | --- | --- |
| `onopen` | `{ index }` | The opening transition starts. |
| `onchange` | `{ index, slide }` | The active slide changes. |
| `onload` | `{ index, slide }` | A slide's full-quality image finishes decoding. |
| `onerror` | `{ index, slide, error }` | A slide's full-quality image fails to load. |
| `onzoomintent` | `{ index, slide }` | The user first zooms a slide (once per slide). |
| `onclose` | `{ index }` | The closing transition starts. |
| `onclosed` | — | The closing transition finishes (safe to clean up). |

For anything more, subscribe on the core viewer with `viewer.on(name, listener)`
(it returns an unsubscribe function). In addition to every event above, the core
emits:

| Event | Payload | Fires when |
| --- | --- | --- |
| `opened` | `{ index }` | The opening transition finishes. |
| `zoom` | `{ index, scale, fitScale }` | The active slide's zoom level changes. |
| `dismiss` | `{ progress, offsetY }` | Drag-to-dismiss progress updates. |
| `ui` | `{ visible }` | Chrome visibility toggles (tap action). |
| `slideupdate` | `{ index, slide }` | A slide was patched via `updateSlide`. |
| `slideschange` | `{ slides, index }` | The slide set was replaced via `setSlides`. |
| `destroy` | — | The viewer was torn down. |

### Snippets

| Snippet | Argument |
| --- | --- |
| `toolbar` | `LightboxContext<T>` |
| `caption` | `LightboxContext<T> & { expanded: boolean; toggle(): void }` |

Both receive a typed context:

| Member | Type | Description |
| --- | --- | --- |
| `viewer` | `Viewer<T>` | Core viewer, for advanced control. |
| `index` | `number` | Active slide index. |
| `slide` | `Slide<T> \| undefined` | Active slide (including your `meta`). |
| `count` | `number` | Total number of slides. |
| `close` | `() => void` | Close the viewer. |
| `next` / `prev` | `() => void` | Step to the adjacent slide. |
| `goTo` | `(index: number) => void` | Jump to a slide. |
| `updateSlide` | `(index, patch) => void` | Patch a slide in place. |
| `setKeyboardEnabled` | `(enabled: boolean) => void` | Suspend / resume key handling while your own modal is up. |

### Imperative control

Most control is declarative — `bind:open`, `bind:index` and a reactive `slides`
array. For the rest, bind the component instance with `bind:this`:

```svelte
<script lang="ts">
	import { Lightbox } from 'picola/svelte';
	let lightbox: Lightbox;
</script>

<Lightbox bind:this={lightbox} bind:open {slides} />
<button onclick={() => lightbox.next()}>Next</button>
```

| Method | Description |
| --- | --- |
| `close()` | Start the close transition. |
| `next()` / `prev()` | Step to the adjacent slide. |
| `goTo(index)` | Navigate to a slide. |
| `updateSlide(index, patch)` | Patch a slide in place. |
| `getViewer()` | The core `Viewer` instance, or `null` when closed. |

For the full core API — `setSlides`, `zoomTo`, `toggleUi`, `on`, `status` and
more — reach the viewer with `bind:viewer` (or `getViewer()`); see
[Framework-agnostic Core](#framework-agnostic-core).

### `Slide` type

| Field | Type | Description |
| --- | --- | --- |
| `src` | `string` | Full-quality image URL (required). |
| `placeholder` | `string` | Low-resolution stand-in shown instantly while `src` loads. |
| `width` / `height` | `number` | Natural pixel dimensions, if known ahead of time. |
| `alt` | `string` | Accessible description; also drives the caption. |
| `srcset` / `sizes` | `string` | Responsive candidates for `src`. |
| `meta` | `T` | Arbitrary per-slide data, fully typed via `Slide<T>`. |

### Exports

**`picola/svelte`**

- Components — `Lightbox`, `ToolbarButton`
- Helpers — `createGalleryOrigins`
- Types — `Slide`, `Viewer`, `SlideView`, `ViewerEvents`, `ViewerStatus`,
  `ZoomOptions`, `DismissOptions`, `TapAction`, `OriginRect`, `LightboxContext`,
  `LightboxLabels`, `GalleryOrigins`

**`picola`** (core) — `createViewer`, `Viewer`, and the low-level primitives the
adapter is built on (`attachGestures`, `PanZoom`, `decodeImage`, `trapFocus`,
`bindHistory`, `fitScale`, `panBounds`, `rubberBand`, `zoomAroundPoint`), plus
the full option and event types.

## Framework-agnostic Core

```ts
import { createViewer } from 'picola';

const viewer = createViewer({ slides, startIndex: 0 });
viewer.attach({ viewport, track, backdrop });
viewer.on('change', ({ index }) => console.log(index));
viewer.open(0);
```

The core owns gesture recognition, zoom/pan physics and transform rendering; an
adapter owns the DOM structure. The `Viewer` instance exposes `open`, `close`,
`goTo`, `next`, `prev`, `updateSlide`, `setSlides`, `zoomTo`, `toggleUi`,
`setKeyboardEnabled`, `on`, `destroy`, and the `status` / `index` / `count` /
`slides` getters. See `src/svelte` for a reference adapter.

## Browser Support

picola targets current evergreen browsers. It relies on the Web Animations API,
`ResizeObserver` and Pointer Events — supported by up-to-date Chrome, Edge,
Firefox and Safari, including their mobile builds. All transitions honor
`prefers-reduced-motion`.

## Development

```sh
npm run dev        # playground
npm test           # unit tests (vitest)
npm run check      # type-check (svelte-check)
npm run e2e        # end-to-end tests (playwright)
npm run package    # build dist/
```

## License

[MIT](./LICENSE) © spuithori
