const { defineConfig } = require('@playwright/test');
const crypto = require('node:crypto');
const port = process.env.E2E_PORT || 31774;
process.env.E2E_SCHEMA = 'pos_e2e_' + crypto.randomBytes(8).toString('hex');
module.exports = defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: 'list',
  globalTeardown: require.resolve('./tests/e2e-teardown.cjs'),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--no-sandbox'] }
      : {},
  },
  webServer: {
    command: 'node tests/e2e-server.cjs',
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    timeout: 30000,
  },
});
