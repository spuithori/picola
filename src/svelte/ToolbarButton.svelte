<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		/** Accessible label, also shown as the tooltip. */
		label: string;
		children: Snippet;
	}

	let { label, children, ...rest }: Props = $props();
</script>

<button type="button" class="pcl__button" aria-label={label} title={label} {...rest}>
	{@render children()}
</button>
