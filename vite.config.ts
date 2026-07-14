import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	root: 'playground',
	plugins: [svelte({ configFile: resolve('./svelte.config.js') })],
	resolve: {
		alias: [
			{ find: 'picola/svelte', replacement: resolve('./src/svelte/index.ts') },
			{ find: 'picola/picola.css', replacement: resolve('./src/picola.css') },
			{ find: 'picola', replacement: resolve('./src/core/index.ts') }
		]
	},
	build: {
		outDir: resolve('./playground-dist'),
		emptyOutDir: true
	},
	test: {
		dir: resolve('./src'),
		environment: 'node'
	}
});
