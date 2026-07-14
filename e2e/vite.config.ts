import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	root: resolve('./fixture'),
	publicDir: false,
	plugins: [svelte({ configFile: resolve('../svelte.config.js') })],
	resolve: {
		alias: [
			{ find: 'picola/svelte', replacement: resolve('../src/svelte/index.ts') },
			{ find: 'picola/picola.css', replacement: resolve('../src/picola.css') },
			{ find: 'picola', replacement: resolve('../src/core/index.ts') }
		]
	}
});
