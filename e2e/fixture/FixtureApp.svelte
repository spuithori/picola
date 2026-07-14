<script lang="ts">
	import { Lightbox, ToolbarButton, createGalleryOrigins, type Slide } from 'picola/svelte';
	import 'picola/picola.css';

	const params = new URLSearchParams(location.search);
	const loop = params.get('loop') === '1';
	const wheel = (params.get('wheel') ?? 'zoom') as 'zoom' | 'navigate' | 'none';
	const useHistory = params.get('history') === '1';

	const COUNT = 6;
	const slides: Slide[] = Array.from({ length: COUNT }, (_, i) => ({
		src: `/img/full-${i}.png`,
		placeholder: `/img/thumb-${i}.png`,
		width: 400,
		height: 300,
		alt: `Fixture image ${i + 1}`
	}));

	let open = $state(false);
	let index = $state(0);
	let lb = $state<
		{ updateSlide(i: number, patch: Partial<Slide>): void; getViewer(): unknown } | undefined
	>();
	const gallery = createGalleryOrigins();

	(window as any).__fixture = {
		upgrade(i: number, src: string) {
			lb?.updateSlide(i, { src });
		},
		viewer() {
			return lb?.getViewer() ?? null;
		}
	};
</script>

<main>
	<div class="grid">
		{#each slides as slide, i (slide.src)}
			<button
				type="button"
				data-testid="thumb-{i}"
				onclick={() => {
					index = i;
					open = true;
				}}
			>
				<img {@attach gallery.attach(i)} src={slide.placeholder} alt={slide.alt} width="80" height="60" />
			</button>
		{/each}
	</div>
</main>

<Lightbox bind:this={lb} bind:open bind:index {slides} {loop} {wheel} history={useHistory} origin={gallery.origin}>
	{#snippet toolbar(ctx)}
		<ToolbarButton label="Fixture action" onclick={() => ctx.next()}>A</ToolbarButton>
	{/snippet}
</Lightbox>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(6, 90px);
		gap: 8px;
		padding: 16px;
	}
	button {
		padding: 0;
		border: 0;
		cursor: pointer;
	}
	img {
		display: block;
		width: 100%;
		height: auto;
		object-fit: cover;
	}
</style>
