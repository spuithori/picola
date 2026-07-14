import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	retries: process.env['CI'] ? 2 : 0,
	reporter: process.env['CI'] ? 'github' : 'list',
	use: {
		baseURL: 'http://localhost:5990',
		viewport: { width: 1000, height: 700 }
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: [
		{
			command: 'npx vite dev -c e2e/vite.config.ts --port 5990 --strictPort',
			url: 'http://localhost:5990',
			reuseExistingServer: !process.env['CI']
		},
		{
			command: 'npx vite dev --port 5991 --strictPort',
			url: 'http://localhost:5991',
			reuseExistingServer: !process.env['CI']
		}
	]
});
