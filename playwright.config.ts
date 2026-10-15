import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
 testDir:'./tests/e2e',
 fullyParallel:false,
 forbidOnly:Boolean(process.env.CI),
 retries:process.env.CI?1:0,
 workers:1,
 reporter:process.env.CI?'github':'list',
 timeout:30_000,
 use:{baseURL:'http://localhost:4173',trace:'on-first-retry',screenshot:'only-on-failure'},
 webServer:{command:'.\\node_modules\\.bin\\wrangler.cmd dev --config dist/server/wrangler.json --port 4173 --ip 127.0.0.1',url:'http://127.0.0.1:4173',reuseExistingServer:false,timeout:120_000},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
});
