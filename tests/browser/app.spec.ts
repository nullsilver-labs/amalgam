import { test, expect, type Page } from '@playwright/test';
const password = process.env.TEST_PASSWORD || 'amalgam-isolated-test-password';
/* The suite runs through the stack's TLS proxy; the app is also published directly. */
const origin = process.env.TEST_BASE_URL || 'https://localhost:18793';
const direct = process.env.TEST_DIRECT_URL || 'http://127.0.0.1:18790';
/* The one Host the app answers to, whichever door the request came through. */
const canonicalHost = new URL(origin).host;

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Instance password').fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where shall we begin?' })).toBeVisible();
}

test('hosting, forwarded headers, credentials and scopes', async ({ request, playwright }) => {
  /*
   * The app is reachable two ways in this stack, and the difference is the
   * point. Through the proxy at 10.89.79.10 — a peer AMALGAM_TRUSTED_PROXIES
   * names — a rewritten Host and an X-Forwarded-Host are believed. Straight to
   * the published port, the peer is not on that list, so the same headers are
   * ignored and only the real Host counts.
   */
  expect((await request.get(`${direct}/api/health`, { headers: { Host: canonicalHost } })).status()).toBe(200);
  expect((await request.get(`${direct}/api/health`, { headers: { Host: 'evil.example', 'X-Forwarded-Host': canonicalHost } })).status()).toBe(403);
  expect((await request.get(`${direct}/api/health`, { headers: { Host: 'evil.example' } })).status()).toBe(403);

  expect((await request.get('/api/bootstrap')).status()).toBe(401);
  expect((await request.post('/api/login', { data: { password }, headers: { Origin: 'https://evil.invalid' } })).status()).toBe(403);

  // No credential is ever printed into the shell a signed-out browser receives.
  const anonymous = await playwright.request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const shell = await (await anonymous.get('/login')).text();
  expect(shell).not.toContain(password);
  expect(shell).not.toContain('amg_');
  expect((await anonymous.get('/')).url()).toContain('/login');
  await anonymous.dispose();

  const login = await request.post('/api/login', { data: { password }, headers: { Origin: origin } });
  expect(login.ok()).toBeTruthy();
  const cookie = login.headers()['set-cookie'];
  expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).toContain('Secure');
  const bootstrap = await request.get('/api/bootstrap'); expect(bootstrap.ok()).toBeTruthy();
  expect(JSON.stringify(await bootstrap.json())).not.toContain(password);
  expect((await request.post('/api/chat', { data: { text: 'hello', model: 'unapproved' }, headers: { Origin: origin } })).status()).toBe(400);

  // An integration token carries exactly the scopes it was made with, and the
  // secret exists only in the response that created it.
  const created = await request.post('/api/tokens', { data: { name: 'Browser test reader', scopes: ['read'] }, headers: { Origin: origin } });
  expect(created.status()).toBe(201);
  const token = await created.json();
  expect(token.secret).toMatch(/^amg_/);
  const bearer = { Authorization: `Bearer ${token.secret}` };
  expect((await request.get('/api/tokens')).ok()).toBeTruthy();
  expect(JSON.stringify(await (await request.get('/api/tokens')).json())).not.toContain(token.secret);

  expect((await request.get('/api/conversations', { headers: bearer })).ok()).toBeTruthy();
  expect((await request.post('/api/chat', { headers: bearer, data: { model: 'compatible:fixture-text', text: 'hello' } })).status()).toBe(403);
  expect((await request.get('/api/settings', { headers: bearer })).status()).toBe(403);
  // Nothing about sessions or tokens is reachable with a token, at any scope.
  expect((await request.post('/api/tokens', { headers: bearer, data: { name: 'Escalation', scopes: ['admin'] } })).status()).toBe(403);
  expect((await request.get('/api/sessions', { headers: bearer })).status()).toBe(403);
  expect((await request.post('/api/logout', { headers: bearer })).status()).toBe(403);
  // A token is not a way in: the only route that mints a session still wants
  // the instance password, and hands back no cookie without it.
  const attempted = await request.post(`${direct}/api/login`, { headers: { ...bearer, Host: canonicalHost, Origin: origin }, data: { password: 'not the password' } });
  expect(attempted.status()).toBe(401);
  expect(attempted.headers()['set-cookie']).toBeUndefined();

  // Revoked is 401: it has stopped being a credential, not merely a limited one.
  expect((await request.delete(`/api/tokens/${token.id}`, { headers: { Origin: origin } })).ok()).toBeTruthy();
  expect((await request.get('/api/conversations', { headers: bearer })).status()).toBe(401);
});

test('chat, project instructions, persistence, search, stop, errors and mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', err => errors.push(err.message));
  await page.goto('/'); await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Instance password').fill(password); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where shall we begin?' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Model' })).toContainText('fixture-text');
  await page.screenshot({ path: 'test-results/amalgam-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Browser test project');
  await page.getByLabel('Instructions', { exact: false }).fill('Respond in Italian when possible.');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser test project' })).toBeVisible();
  await page.getByLabel('Message amalgam').fill('An opening thought');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Ciao! Project instructions arrived.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await expect(page.locator('.prose h2')).toHaveText('A little clarity');
  const chatUrl = page.url();
  await page.reload(); await expect(page.locator('.prose h2')).toHaveText('A little clarity');
  await page.getByRole('button', { name: 'Conversation menu' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByLabel('Title', { exact: true }).fill('A durable conversation'); await page.getByRole('button', { name: 'Save title' }).click();
  await expect(page).toHaveTitle(/A durable conversation/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Conversation menu' }).click();
  await page.getByRole('menuitem', { name: 'Export as JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^amalgam-.*\.json$/);
  const content = await download.createReadStream();
  let exported = ''; for await (const chunk of content!) exported += chunk;
  expect(JSON.parse(exported).messages).toHaveLength(2);
  await page.getByLabel('Message amalgam').fill('[slow] take your time'); await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop response' }).click();
  await expect(page.getByText('Response stopped. Any partial text was saved.')).toBeVisible();
  await page.getByLabel('Message amalgam').fill('[http-error]'); await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('The provider reached its rate or usage limit. Try again later.')).toBeVisible();
  await page.getByLabel('Message amalgam').fill('[disconnect]'); await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('The provider disconnected before completing its response.')).toBeVisible();
  await page.getByLabel('Message amalgam').fill('[xss]'); await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.prose strong').filter({ hasText: 'Safe text' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  expect(await page.locator('.prose img, .prose script, .prose a[href^="javascript:"]').count()).toBe(0);
  await page.getByRole('button', { name: 'Search conversations' }).click();
  await page.getByLabel('Search conversation history').fill('opening thought');
  await expect(page.locator('.search-results button').first()).toContainText('A durable conversation');
  await page.locator('.search-results button').first().click(); await expect(page).toHaveURL(chatUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Chats', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/amalgam-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Conversation menu' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete conversation', exact: true }).click();
  // Deleting a chat inside a project lands on that project's empty state.
  await expect(page.getByRole('heading', { name: 'Browser test project' })).toBeVisible();
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.getByRole('button', { name: 'All chats' }).click();
  await expect(page.getByRole('heading', { name: 'Where shall we begin?' })).toBeVisible();
  // Remove this test's project too, keeping repeated local runs deterministic.
  const bootstrap = await (await page.request.get('/api/bootstrap')).json();
  for (const p of bootstrap.projects.filter((p: { name: string }) => p.name === 'Browser test project')) {
    await page.request.delete(`/api/projects/${p.id}`, { headers: { Origin: origin } });
  }
  expect(errors).toEqual([]);
});

test('context budget: set in Settings, bounded by a declared window, reported per request', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Instance password').fill(password); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where shall we begin?' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Chat', exact: true }).click();
  const budget = dialog.getByLabel('Context budget in tokens');
  await expect(budget).toHaveValue('32000');
  // Below what the fixture's 32k window leaves after the reply's room — 8k
  // with thinking on — so the ceiling is the number that comes back.
  await budget.fill('20000');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved');
  // The fixture model is declared with a 32k window in compose.test.yaml.
  await dialog.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(dialog.getByText('32k-token window')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByLabel('Message amalgam').fill('How much do you see?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await expect(page.locator('.prose h2')).toHaveText('A little clarity');
  await page.getByRole('button', { name: 'What the model sees' }).click();
  await expect(page.getByRole('dialog')).toContainText('of 20,000 tokens');
  await expect(page.getByRole('dialog')).toContainText('32,000 tokens, declared');
  await expect(page.getByRole('dialog')).toContainText('Everything fit');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  // Put the budget back and remove this test's chat, keeping repeated local runs deterministic.
  const settings = await (await page.request.get('/api/settings')).json();
  expect((await page.request.put('/api/settings', { data: { ...settings, contextTokens: 32000 }, headers: { Origin: origin } })).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Conversation menu' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where shall we begin?' })).toBeVisible();
});

test('tabs: the strip is always there, a new chat opens beside the one you are in, and it lines up with the plate', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', err => errors.push(err.message));
  await page.goto('/');
  await page.getByLabel('Instance password').fill(password); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where shall we begin?' })).toBeVisible();
  // One blank tab from the start, with nothing to close.
  const tabs = page.getByRole('tablist', { name: 'Open chats' });
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(tabs.getByRole('tab', { name: 'New chat' })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('button', { name: 'Close New chat' })).toHaveCount(0);
  // The strip begins where the plate does.
  const plate = page.locator('.stage > .plate');
  expect((await tabs.boundingBox())!.x).toBeCloseTo((await plate.boundingBox())!.x, 0);
  await page.getByLabel('Message amalgam').fill('First tab conversation'); await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.prose h2')).toHaveText('A little clarity');
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await expect(tabs.getByRole('tab', { name: 'First tab conversation' })).toHaveAttribute('aria-selected', 'true');
  const first = new URL(page.url()).searchParams.get('c');
  // New chat, from inside a chat, opens a tab of its own; the chat keeps its place.
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where shall we begin?' })).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(tabs.getByRole('tab', { name: 'New chat' })).toHaveAttribute('aria-selected', 'true');
  // From a blank tab, New chat opens nothing more.
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await page.getByLabel('Message amalgam').fill('Second tab conversation'); await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.prose h2')).toHaveText('A little clarity');
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await expect(tabs.getByRole('tab', { name: 'Second tab conversation' })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: 'First tab conversation' }).click();
  await expect(page).toHaveURL(new RegExp(`c=${first}`));
  await expect(page.locator('.bubble').first()).toHaveText('First tab conversation');
  // Both tabs survive a reload of the browser tab.
  await page.reload();
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.bubble').first()).toHaveText('First tab conversation');
  // Closing one leaves the other.
  await tabs.getByRole('tab', { name: 'First tab conversation' }).hover();
  await page.getByRole('button', { name: 'Close First tab conversation' }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(page.locator('.bubble').first()).toHaveText('Second tab conversation');
  // A row's menu opens a chat in a tab of its own, beside the active one.
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  const row = page.locator('.rowwrap').filter({ hasText: 'First tab conversation' }).filter({ visible: true });
  await row.hover(); await row.getByRole('button', { name: 'Conversation options' }).click();
  await page.getByRole('menuitem', { name: 'Open in new tab' }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await expect(tabs.getByRole('tab', { name: 'First tab conversation' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.bubble').first()).toHaveText('First tab conversation');
  // Closing the last chat leaves a blank tab, which has nothing to close.
  await page.getByRole('button', { name: 'Close First tab conversation' }).click();
  await tabs.getByRole('tab', { name: 'Second tab conversation' }).hover();
  await page.getByRole('button', { name: 'Close Second tab conversation' }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await expect(tabs.getByRole('tab', { name: 'New chat' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Where shall we begin?' })).toBeVisible();
  await expect(tabs.getByRole('button', { name: 'Close New chat' })).toHaveCount(0);
  // Remove this test's chats, keeping repeated local runs deterministic.
  const bootstrap = await (await page.request.get('/api/bootstrap')).json();
  for (const c of bootstrap.conversations.filter((c: { title: string }) => /tab conversation$/.test(c.title))) {
    await page.request.delete(`/api/conversations/${c.id}`, { headers: { Origin: origin } });
  }
  expect(errors).toEqual([]);
});

test('thinking is shown above an answer, and an answer generated again becomes a branch', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', err => errors.push(err.message));
  await signIn(page);
  // A model that reasons first: one bare line above the answer says how long it worked, and opens what it showed.
  await page.getByLabel('Message amalgam').fill('[think] Show your work'); await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  const worked = page.getByRole('button', { name: /^Worked for \d+s$/ });
  await expect(worked).toBeVisible();
  await expect(page.getByText('Considering the question.', { exact: false })).toHaveCount(0);
  await worked.click();
  await expect(page.getByText('Considering the question.', { exact: false })).toBeVisible();
  await expect(page.locator('.prose h2').last()).toHaveText('A little clarity');
  // The same line survives a reload, from the row.
  await page.reload();
  await expect(page.getByRole('button', { name: /^Worked for \d+s$/ })).toBeVisible();
  // Reasoning left inside the text between <think> tags is told apart from the answer.
  await page.getByLabel('Message amalgam').fill('[think-tags] and again'); await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Worked for \d+s$/ })).toHaveCount(2);
  await expect(page.locator('.prose', { hasText: '<think>' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Worked for \d+s$/ }).last().click();
  await expect(page.getByText('Tagged reasoning, split across chunks.')).toBeVisible();
  // Answer again, with another model: the new answer sits beside the first, and the composer follows the model.
  await expect(page.locator('.bubble')).toHaveCount(2);
  await page.getByRole('button', { name: 'Regenerate' }).last().click();
  await page.getByRole('option', { name: /alpha-small/ }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await expect(page.getByText('2 / 2')).toBeVisible();
  await expect(page.locator('.model').last()).toHaveText('alpha-small');
  await expect(page.getByRole('combobox', { name: 'Model' })).toContainText('alpha-small');
  await page.getByRole('button', { name: 'Previous branch' }).click();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page.locator('.model').last()).toHaveText('fixture-text');
  // The branch being read is remembered on the server: a reload opens the same one.
  await page.reload();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page.locator('.model').last()).toHaveText('fixture-text');
  // A new message continues the branch being read; the other branch keeps its own end.
  await page.getByLabel('Message amalgam').fill('Continue the first branch'); await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await expect(page.locator('.bubble')).toHaveCount(3);
  await page.getByRole('button', { name: 'Next branch' }).click();
  await expect(page.getByText('2 / 2')).toBeVisible();
  await expect(page.locator('.bubble')).toHaveCount(2);
  // Every branch is exported, with its parent links.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Conversation menu' }).click();
  await page.getByRole('menuitem', { name: 'Export as JSON' }).click();
  let exported = ''; for await (const chunk of (await (await downloadPromise).createReadStream())!) exported += chunk;
  const tree = JSON.parse(exported);
  expect(tree.messages).toHaveLength(7);
  expect(tree.messages.filter((m: { parent_id: string | null }) => m.parent_id === null)).toHaveLength(1);
  // Remove this test's chat, keeping repeated local runs deterministic.
  await page.getByRole('button', { name: 'Conversation menu' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where shall we begin?' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('access: this browser, the devices signed in, and a token shown once', async ({ browser }) => {
  /*
   * Two real browser contexts, because the claim under test is about other
   * devices: revoking one from here has to end it over there, not merely tidy
   * a list. Playwright's browser.newContext does not inherit the config's use
   * block, so the proxy's certificate is accepted explicitly.
   */
  const options = { baseURL: origin, ignoreHTTPSErrors: true };
  const here = await browser.newContext(options);
  const elsewhere = await browser.newContext(options);
  const pageHere = await here.newPage();
  const pageElsewhere = await elsewhere.newPage();
  try {
    await signIn(pageHere);
    // Earlier tests left sessions of their own behind; start from a known list.
    for (const s of await (await pageHere.request.get('/api/sessions')).json()) {
      if (!s.current) await pageHere.request.delete(`/api/sessions/${s.id}`, { headers: { Origin: origin } });
    }
    await signIn(pageElsewhere);

    await pageHere.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = pageHere.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Access', exact: true }).click();
    // What this browser can do is reported, not assumed: through TLS it is secure.
    await expect(dialog.getByText('Yes — https, or localhost')).toBeVisible();
    const devices = dialog.locator('.devices li');
    await expect(devices).toHaveCount(2);
    await expect(dialog.getByText('This device')).toHaveCount(1);

    // A token, created and revoked from the panel; its secret appears once.
    await dialog.getByLabel('Token name').fill('Panel test token');
    await dialog.getByRole('button', { name: 'Create token' }).click();
    const secret = dialog.getByLabel('New token secret');
    await expect(secret).toBeVisible();
    expect(await secret.inputValue()).toMatch(/^amg_/);
    await expect(dialog.locator('.tokens li').filter({ hasText: 'Panel test token' })).toContainText('read');
    await dialog.locator('.tokens li').filter({ hasText: 'Panel test token' }).getByRole('button', { name: 'Revoke token' }).click();
    await expect(dialog.locator('.tokens li').filter({ hasText: 'Panel test token' })).toHaveCount(0);

    // Signing out the other device ends it there, on its next request.
    await devices.filter({ hasNotText: 'This device' }).getByRole('button', { name: 'Sign out device' }).click();
    await expect(devices).toHaveCount(1);
    await pageElsewhere.reload();
    await expect(pageElsewhere).toHaveURL(/\/login/);
    // This browser is untouched.
    await expect(dialog.getByText('This device')).toBeVisible();
  } finally {
    await here.close();
    await elsewhere.close();
  }
});
