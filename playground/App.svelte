<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import { Lightbox, ToolbarButton, createGalleryOrigins, type Slide } from 'picola/svelte';
	import 'picola/picola.css';

	type Meta = { downloadName: string };

	const picsum = (id: number, w: number, h: number) => `https://picsum.photos/id/${id}/${w}/${h}`;

	const slides: Slide<Meta>[] = [
		{
			src: picsum(1015, 2400, 1600),
			placeholder: picsum(1015, 600, 400),
			width: 2400,
			height: 1600,
			alt: '渓谷を流れる川と山並み。夕暮れの光が水面に反射している。とても長いALTテキストの折りたたみ表示を確認するために、この説明文は意図的に冗長に書かれています。タップすると全文が展開され、スクロールできることを確かめてください。',
			meta: { downloadName: 'valley.jpg' }
		},
		{
			src: picsum(1025, 2000, 2500),
			placeholder: picsum(1025, 480, 600),
			width: 2000,
			height: 2500,
			alt: 'こちらを見つめるパグ犬のポートレート(縦位置)。',
			meta: { downloadName: 'pug.jpg' }
		},
		{
			src: picsum(1039, 2600, 1460),
			placeholder: picsum(1039, 650, 365),
			width: 2600,
			height: 1460,
			alt: '霧のかかった滝と森。',
			meta: { downloadName: 'falls.jpg' }
		},
		{
			src: picsum(1043, 1800, 2400),
			placeholder: picsum(1043, 450, 600),
			width: 1800,
			height: 2400,
			meta: { downloadName: 'noalt.jpg' }
		},
		{
			src: picsum(1050, 2800, 1580),
			placeholder: picsum(1050, 700, 395),
			width: 2800,
			height: 1580,
			alt: '夜景。長時間露光による光の軌跡。',
			meta: { downloadName: 'night.jpg' }
		}
	];

	let open = $state(false);
	let index = $state(0);
	let loop = $state(false);
	let blur = $state(false);
	const gallery = createGalleryOrigins();

	$effect(() => {
		document.body.classList.toggle('blur-demo', blur);
	});

	function show(i: number) {
		index = i;
		open = true;
	}
</script>

<main>
	<header>
		<h1>picola <span>playground</span></h1>
		<p>
			サムネイルをクリックすると Lightbox が開きます。スワイプ/ドラッグでスライド移動、下ドラッグで閉じる、
			ピンチ・ダブルタップ・ホイールでズーム、タップで UI 表示切替。
		</p>
		<div class="toggles">
			<label><input type="checkbox" bind:checked={loop} /> ループ</label>
			<label><input type="checkbox" bind:checked={blur} /> 背景ぼかし</label>
		</div>
	</header>

	<div class="grid">
		{#each slides as slide, i (slide.src)}
			<button class="thumb" onclick={() => show(i)}>
				<img
					{@attach gallery.attach(i)}
					src={slide.placeholder}
					alt={slide.alt ?? ''}
					width={slide.width}
					height={slide.height}
					loading="lazy"
				/>
				{#if slide.alt}
					<span class="badge">ALT</span>
				{/if}
			</button>
		{/each}
	</div>

	<section class="inline-demo">
		<h2>Inline mode</h2>
		<p>固定サイズのペインに埋め込まれた常設ビューア。スワイプ・ズーム・キャプションはそのまま動作します。</p>
		<div class="inline-pane">
			<Lightbox inline {slides} {loop} />
		</div>
	</section>
</main>

<Lightbox bind:open bind:index {slides} {loop} origin={gallery.origin} history>
	{#snippet toolbar(ctx)}
		<ToolbarButton
			label="Download image"
			onclick={() => {
				const slide = ctx.slide;
				if (slide) window.open(slide.src, '_blank', 'noopener');
			}}
		>
			<Download />
		</ToolbarButton>
	{/snippet}
</Lightbox>

<style>
	:global(body) {
		margin: 0;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		background: #101014;
		color: #e8e8ec;
	}

	main {
		max-width: 960px;
		margin: 0 auto;
		padding: 24px 16px 80px;
	}

	h1 {
		font-size: 28px;
		margin: 0 0 4px;
	}

	h1 span {
		font-weight: 400;
		opacity: 0.5;
		font-size: 18px;
	}

	header p {
		opacity: 0.7;
		font-size: 14px;
		line-height: 1.7;
	}

	.toggles {
		display: flex;
		gap: 16px;
		font-size: 14px;
		margin-top: 8px;
	}

	.toggles label {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
	}

	:global(body.blur-demo .pcl) {
		--pcl-backdrop: rgba(10, 10, 16, 0.55);
		--pcl-backdrop-filter: blur(16px);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 12px;
		margin-top: 24px;
	}

	.thumb {
		position: relative;
		padding: 0;
		border: none;
		border-radius: 10px;
		overflow: hidden;
		cursor: zoom-in;
		background: #1c1c22;
		aspect-ratio: 4 / 3;
	}

	.thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.badge {
		position: absolute;
		left: 8px;
		bottom: 8px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.05em;
		padding: 2px 6px;
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.65);
		color: #fff;
	}

	.inline-demo {
		margin-top: 48px;
	}

	.inline-demo h2 {
		font-size: 20px;
		margin: 0 0 4px;
	}

	.inline-demo p {
		opacity: 0.7;
		font-size: 14px;
		margin: 0 0 16px;
	}

	.inline-pane {
		position: relative;
		height: 420px;
		border-radius: 12px;
		overflow: hidden;
		background: #1c1c22;
	}
</style>
