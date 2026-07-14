# picola

A fast, type-safe, extensible lightbox / image viewer.
Framework-agnostic core with a first-class **Svelte 5** adapter.

> ⚠️ Early development. APIs may change before 1.0.
>
> `loop` is seamless with 3+ slides and falls back to wrap-around below that.

## Why picola?

- **Type-safe to the edges** — strict TypeScript everywhere, typed events, and a generic `Slide<T>` so your own per-slide data (download names, IDs, …) flows through with full inference.
- **Built for Svelte 5** — customise the toolbar and caption with snippets and real components. No SVG-string injection, no manual `mount`/`unmount` into library-owned DOM.
- **Memory-conscious** — only the active slide ± 1 is mounted; evicted slides release their decoded bitmaps.
- **Framework-agnostic core** — `picola` has zero dependencies and owns gestures, physics and transforms. Adapters for other frameworks can be built on top.
- **Modern UX defaults** — pinch / double-tap / wheel zoom with focal-point precision, rubber-band overscroll, velocity-based flicks, drag-down (or up) to dismiss, pinch-to-close, keyboard navigation and a focus trap.
- **Style without `!important`** — flat single-class selectors tuned via CSS custom properties, robust against global resets.

## Install

```sh
npm i picola
```

`picola/svelte` uses [`@lucide/svelte`](https://lucide.dev) for its built-in
icons as a peer dependency — npm 7+ installs it automatically, and if your app
already depends on lucide the single shared copy is used (no duplicate icons
in your bundle).

## Quick start (Svelte 5)

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

### Fly from the thumbnail

Register thumbnails with an attachment and the open/close transitions animate
from/to them:

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

A plain `origin={(i) => thumbEls[i]}` resolver works too.

### Custom toolbar buttons

The `toolbar` snippet receives a fully typed context — the core viewer, the
active slide (including your `meta`), and navigation helpers:

```svelte
<Lightbox bind:open bind:index {slides}>
	{#snippet toolbar(ctx)}
		<ToolbarButton label="Download" onclick={() => download(ctx.slide)}>
			<Download />
		</ToolbarButton>
	{/snippet}
</Lightbox>
```

### Smart alt-text captions

If a slide has `alt`, picola renders a clamped caption with expand-on-tap and
a toolbar toggle — replace it entirely with the `caption` snippet (or disable
the whole feature with `showCaption={false}`):

```svelte
<Lightbox bind:open {slides}>
	{#snippet caption(ctx)}
		<MyCaption text={ctx.slide?.alt} expanded={ctx.expanded} ontoggle={ctx.toggle} />
	{/snippet}
</Lightbox>
```

Want a tap on the caption to open your own full-text modal instead? Render it
inside the snippet (it lives inside the lightbox root, so stacking and the
focus trap just work) and suspend picola's keyboard handling while it is up so
Escape reaches your modal first:

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

### Load full resolution only when the user zooms

Instead of fetching originals for every viewed slide, defer them to actual
zoom intent — `zoomintent` fires once per slide on the first pinch,
double-tap, wheel zoom or `+`:

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

### Upgrade to full resolution after opening

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

## Options

| Prop | Default | Description |
| --- | --- | --- |
| `slides` | — | `Slide<T>[]` to display |
| `open` / `index` | `false` / `0` | Bindable visibility and active index |
| `zoom` | `{ max: 2, doubleTap: 2, wheel: true }` | Zoom limits as multiples of natural size |
| `dismiss` | `{ drag: true, threshold: 0.22, pinch: true }` | Drag-to-dismiss and pinch-to-close |
| `tapAction` | `'toggle-ui'` | What a single tap on the image does |
| `backdropClose` | `true` | Click outside the image closes |
| `wheel` | `'zoom'` | Focal-point wheel zoom (default) \| `'navigate'` \| `'none'`; trackpad pinch always zooms |
| `keyboard` | `true` | Escape / arrows / `+` / `-` |
| `history` | `false` | Back gesture closes the viewer |
| `preload` | `[1, 1]` | Slides kept mounted around the active one |
| `origin` | — | `(index) => HTMLElement \| OriginRect` for open/close transitions |
| `chrome` | `true` | Set `false` for a fully headless viewer driven by your own UI |
| `viewer` | — | Bindable core `Viewer` instance while open (`bind:viewer`) |
| `loop`, `backdropOpacity`, `slideGap`, `transitionMs`, `counter`, `zoomButton`, `showCaption`, `labels`, `container` | | See type docs |

Slides are reactive while open: replacing the `slides` array (e.g. appending
more images after pagination) syncs into the viewer, clamping the active
index and keeping zoom state.

## Styling

```css
.pcl {
	--pcl-z: 2000;
	--pcl-backdrop: rgba(10, 10, 16, 0.55);
	--pcl-backdrop-filter: blur(16px);
	--pcl-caption-lines: 3;
}
```

`--pcl-backdrop-filter` enables background blur (GPU cost applies — it is
`none` by default). A zero-specificity mini-reset scoped to `.pcl` ships with
the stylesheet, so the chrome renders identically whether or not your app
uses a global CSS reset. Transitions respect `prefers-reduced-motion`.

Every default rule uses a flat single-class selector (`.pcl__button` etc.), so
your stylesheet overrides them with normal cascade order or one extra class of
specificity — no `!important` required. The custom-property defaults are
declared at zero specificity (`:where(.pcl)`), so a plain `.pcl { --pcl-z: … }`
in your app always wins regardless of stylesheet order. Styles deliberately
avoid `@layer`: layered library styles would lose to the unlayered global
resets present in most apps.

## Framework-agnostic core

```ts
import { createViewer } from 'picola';

const viewer = createViewer({ slides, startIndex: 0 });
viewer.attach({ viewport, track, backdrop });
viewer.on('change', ({ index }) => console.log(index));
viewer.open(0);
```

The core owns gesture recognition, zoom/pan physics and transform rendering;
an adapter owns the DOM structure. See `src/svelte` for a reference adapter.

## Development

```sh
npm run dev        # playground
npm test           # unit tests (vitest)
npm run check      # svelte-check
npm run package    # build dist/
```

## License

[MIT](./LICENSE) © spuithori
