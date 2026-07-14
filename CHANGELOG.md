# Changelog

## 0.3.2 (2026-07-14)

### Fixes
- Ghost-click (tap-through) protection: a backdrop tap now starts the close only after the tap's native `click` has been dispatched into the still-interactive overlay (≤10ms typical, 120ms fallback). Controls under the backdrop receive neither the click nor focus on touch devices
- Chrome buttons, arrows and the caption no longer keep accepting pointer events during the closing transition (the closing `pointer-events` reset now wins the specificity tie)
- An opening transition interrupted by a gesture now settles to `'open'` and emits `opened` (previously the status stayed `'opening'` forever)

### Performance
- The placeholder → full-resolution swap is held while the opening transition runs and applied right after it completes, eliminating the mid-animation raster/upload stall (measured 110–130ms max frame gap → 18–19ms under 6× CPU throttle)
- Drag-to-dismiss chrome fading is now driven by the `--pcl-dismiss` custom property written directly by the core (plus a `data-pcl-dismissing` root attribute) — zero per-frame framework work; custom chrome can consume both
- Focus restore to the origin element now happens when the close transition completes instead of at close start

## 0.3.1 (2026-07-14)

### Fixes
- Taps during the closing transition no longer die on the fading overlay: the root gets `pointer-events: none` while closing, so clicks reach the page immediately
- Reopening while the close transition is still running now works: the Svelte adapter tears the closing session down and starts a fresh one; `bind:open` flips to `false` when closing **starts** (was: when it finished)
- `history: true` no longer races an in-flight `history.back()` when reopening immediately; the next entry is pushed only after the rewind settles
- Core: `open()` during `'closing'` can no longer be broken by the previous close's completion; stale `clip-path` is cleared on reopen

### Performance
- Open/close transitions, the clip reveal, backdrop/viewport fades and track snapping now run as compositor-driven WAAPI animations — main-thread work (image decode, GC) no longer drops their frames; gesture-following and zoom/inertia physics stay JS-driven with seamless interruption hand-off
- Full-resolution images stay hidden until fully decoded and swap in exactly once, eliminating progressive re-raster/upload churn during transitions (loading stays parallel)
- `will-change` layer hints are managed with a single deadline timer instead of per-frame timer churn
- Chrome opacity updates during drag-to-dismiss no longer retarget a CSS transition every frame

### API
- Svelte adapter: new `onclosed` callback firing after the close transition completes (use it for cleanup that must not disturb the closing animation)

## 0.3.0 (2026-07-14)

### Features
- Seamless continuous `loop` with a virtualised track (3+ slides; falls back to wrapping below that)
- Crop-aware open/close transitions: `object-fit: cover` thumbnails are detected automatically and revealed with an animated clip (`OriginRect.cropped` to force)
- `wheel` option: `'zoom'` (default, unchanged focal-point wheel zoom) | `'navigate'` | `'none'`; trackpad pinch always zooms
- `zoomintent` event / `onzoomintent` — fired once per slide on first zoom gesture, for deferring full-resolution upgrades to actual zoom use
- Setting the `index` prop while open now navigates (two-way binding)
- `--pcl-backdrop-filter` custom property for backdrop blur effects

### UX / a11y
- `prefers-reduced-motion` support: all transitions become instant
- Chrome (buttons, caption, arrows) now fades out together with the image during close
- Backdrop taps close immediately without the double-tap disambiguation delay; Escape and all controls work during the opening transition
- Desktop cursors: `zoom-in` / `grab` / `grabbing`
- Screen-reader live announcements of slide changes; slides carry `role="group"` + `aria-roledescription="slide"`
- Removed the top gradient; buttons carry a subtle standalone background (`--pcl-button-bg`)

### Performance
- `will-change` is now applied only while gestures/animations run, releasing persistent compositor layers when idle
- Scoped zero-specificity mini-reset ships with picola.css so rendering is identical with or without host CSS resets
- Source-upgrade double buffering keeps the previous full image (not the thumbnail) visible while the new source decodes

### Fixed
- Decoded-image retention after close in crossOriginIsolated environments (images are now released at eviction time, while still connected)
- Escape not closing during the opening transition
- Layout breakage under unlayered global CSS resets (`@layer` removed in 0.2.2; token defaults moved to `:where(.pcl)` in 0.2.3)

## 0.2.x (2026-07-14)
- 0.2.4: source-upgrade double buffering
- 0.2.3: custom-property defaults at zero specificity (`:where`)
- 0.2.2: removed `@layer`; chrome fade on close; instant backdrop close; `@lucide/svelte` moved to peerDependencies; `setSlides()` reactive slide sync; `ToolbarButton`; `caption`/`showCaption` rename; `createGalleryOrigins()`; `bind:viewer`
- 0.2.1: first published release

## 0.1.0 (2026-07-13)
- Initial implementation: framework-agnostic core (gestures, physics, virtualised slides) + Svelte 5 adapter
