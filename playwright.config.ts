import { defineConfig, devices } from '@playwright/test';
/*
 * The browser suite runs through the isolated stack's TLS proxy, so every test
 * exercises the path a real deployment takes — HTTPS, a rewritten Host, a
 * Secure cookie and streaming through an intermediary. The certificate is the
 * proxy's own local CA, hence ignoreHTTPSErrors.
 */
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.TEST_BASE_URL || 'https://localhost:18793',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome']
  },
  reporter: 'list'
});
