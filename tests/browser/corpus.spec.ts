import { test, expect, type BrowserContext, type Page } from '@playwright/test';
const password = process.env.TEST_PASSWORD || 'amalgam-isolated-test-password';
const origin = process.env.TEST_BASE_URL || 'https://localhost:18793';

/*
 * The corpus connector, against a mock library on the isolated stack.
 *
 * The stack gives the app two model slots answered by the same mock container:
 * `fixture-text` at `mock`, a bare service name, and `cloud-text` at
 * `api.example-cloud.test`, which is a name with dots in it and so, as far as
 * this app is concerned, somewhere else. That is what makes the disclosure
 * assertions real rather than a string comparison against a constant.
 *
 * One browser, signed in once, for all four cases: the instance throttles
 * sign-ins to ten a minute on purpose, and a test suite is not entitled to
 * spend that budget more freely than a person would.
 */

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('Instance password').fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where shall we begin?' })).toBeVisible();
});

test.afterAll(async () => { await context.close(); });

async function attach(query: string, title: string) {
  await page.getByRole('button', { name: 'Sources', exact: false }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Search your corpus library').fill(query);
  await dialog.getByRole('option', { name: title, exact: false }).click();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
}

test('corpus: Settings reports a connected library, endpoint and all', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'corpus', exact: true }).click();
  await expect(dialog.getByText('mock-corpus:8892')).toBeVisible();
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
  await expect(dialog.getByText('this token may read the library')).toBeVisible();
  // Asking again is a request, not a cached shrug.
  await dialog.getByRole('button', { name: 'Check now' }).click();
  await expect(dialog.getByText('Connected', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
});

test('corpus: a source is attached, quoted, attributed, and still there after a reload', async () => {
  const errors: string[] = []; page.on('pageerror', err => errors.push(err.message));

  await attach('kestrel', 'Kestrels of the northbound verge');
  await expect(page.locator('.attached__chip')).toHaveText(/Kestrels of the northbound verge/);

  await page.getByLabel('Message amalgam').fill('What is on the verge?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);

  // The excerpt reached the model: the mock echoes back the prompt it was given.
  await expect(page.getByText('The kestrel hovers above the northbound verge at dusk', { exact: false })).toBeVisible();
  // The message the person typed was stored as they typed it.
  await expect(page.locator('.bubble').first()).toHaveText('What is on the verge?');
  // And the attribution sits under it.
  const attribution = page.locator('.turn__sources').first();
  await expect(attribution).toContainText('From your corpus library:');
  await expect(attribution).toContainText('[1] Kestrels of the northbound verge');
  // Without CORPUS_PUBLIC_URL there is nothing honest to link to.
  await expect(attribution.locator('a')).toHaveCount(0);
  // Sending emptied the composer, sources included.
  await expect(page.locator('.attached__chip')).toHaveCount(0);

  await page.getByRole('button', { name: 'What the model sees' }).click();
  const context = page.getByRole('dialog');
  await expect(context).toContainText('Sources you attached');
  await expect(context).toContainText('Kestrels of the northbound verge');
  await expect(context).toContainText('article');
  await expect(context).toContainText('Library excerpts');
  await context.getByRole('button', { name: 'Close' }).click();

  await page.reload();
  await expect(page.getByText('The kestrel hovers above the northbound verge at dusk', { exact: false })).toBeVisible();
  await expect(page.locator('.turn__sources').first()).toContainText('[1] Kestrels of the northbound verge');

  // Remove this test's chat, keeping repeated local runs deterministic.
  await page.getByRole('button', { name: 'Conversation menu' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where shall we begin?' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('corpus: the composer names a remote destination, and stays quiet about a local one', async () => {
  await attach('Rialto', 'Barley at the Rialto');
  const disclosure = page.locator('.composer__disclosure');

  // The default model is served by a bare service name on this machine.
  await expect(page.getByRole('combobox', { name: 'Model' })).toContainText('fixture-text');
  await expect(disclosure).toHaveCount(0);

  // The same container, reached under a name with dots in it, is somewhere else.
  await page.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'cloud-text', exact: false }).click();
  await expect(page.getByRole('combobox', { name: 'Model' })).toContainText('cloud-text');
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText('Excerpts from your corpus library will be sent to api.example-cloud.test');

  // Taking the source off takes the sentence with it: it is about what is attached.
  await page.getByRole('button', { name: 'Remove Barley at the Rialto' }).click();
  await expect(disclosure).toHaveCount(0);
  // Back to the local model, so nothing after this test inherits a remote choice.
  await page.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'fixture-text', exact: false }).click();
});

test('corpus: reading the library needs the read scope, and only the read scope', async () => {
  const api = page.request;
  const reader = await (await api.post('/api/tokens', { data: { name: 'corpus reader', scopes: ['read'] }, headers: { Origin: origin } })).json();
  const writer = await (await api.post('/api/tokens', { data: { name: 'corpus writer', scopes: ['write'] }, headers: { Origin: origin } })).json();
  try {
    const allowed = await api.post('/api/integrations/corpus/search', {
      headers: { Authorization: `Bearer ${reader.secret}` }, data: { q: 'kestrel', limit: 5 }
    });
    expect(allowed.ok()).toBeTruthy();
    const result = await allowed.json();
    expect(result.state).toBe('ok');
    expect(result.semantic).toBe(true);
    expect(result.hits[0].title).toBe('Kestrels of the northbound verge');
    // Nothing of the token, and nothing of corpus's own answer beyond the fields we copy.
    expect(JSON.stringify(result)).not.toContain('crp_');
    expect(JSON.stringify(result)).not.toContain('provenance');

    const diagnostic = await (await api.get('/api/integrations/corpus', { headers: { Authorization: `Bearer ${reader.secret}` } })).json();
    expect(diagnostic).toMatchObject({ configured: true, endpoint: 'mock-corpus:8892', state: 'ok' });
    expect(JSON.stringify(diagnostic)).not.toContain('crp_');

    const refused = await api.post('/api/integrations/corpus/search', {
      headers: { Authorization: `Bearer ${writer.secret}` }, data: { q: 'kestrel', limit: 5 }
    });
    expect(refused.status()).toBe(403);
    expect((await api.get('/api/integrations/corpus', { headers: { Authorization: `Bearer ${writer.secret}` } })).status()).toBe(403);
  } finally {
    await api.delete(`/api/tokens/${reader.id}`, { headers: { Origin: origin } });
    await api.delete(`/api/tokens/${writer.id}`, { headers: { Origin: origin } });
  }
});
