import { test, expect } from '@playwright/test';
const origin = process.env.TEST_BASE_URL || 'https://localhost:18793';
const password = process.env.TEST_PASSWORD || 'amalgam-isolated-test-password';

test('transaction guards, aborted streams, persisted recovery and project deletion', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Instance password').fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Model' })).toContainText('fixture-text');
  // Raw browser fetch permits testing disconnect without accepting the entire stream.
  const started = await page.evaluate(async () => {
    const projectResponse = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Lifecycle project', instructions: 'Remember this.' }) });
    const project = await projectResponse.json();
    const controller = new AbortController();
    // Retain controller on the test window only, not in application state.
    (window as any).testController = controller;
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'compatible:fixture-text', projectId: project.id, text: '[slow] lifecycle probe' }), signal: controller.signal });
    const reader = response.body!.getReader(); (window as any).testReader = reader;
    let buffer = '';
    while (!buffer.includes('\n\n')) { const { value } = await reader.read(); buffer += new TextDecoder().decode(value); }
    const start = JSON.parse(buffer.split('\n\n')[0].slice(6));
    return { conversation: start.conversation.id, assistant: start.assistant.id, project: project.id };
  });
  const apiRequest = page.request;
  const mutation = { headers: { Origin: origin } };
  const second = await apiRequest.post('/api/chat', { ...mutation, data: { conversationId: started.conversation, model: 'compatible:fixture-text', text: 'concurrent' } });
  expect(second.status()).toBe(409);
  expect((await apiRequest.delete(`/api/conversations/${started.conversation}`, mutation)).status()).toBe(409);
  const oversize = await apiRequest.post('/api/chat', { ...mutation, data: { model: 'compatible:fixture-text', text: 'x'.repeat(16001) } });
  expect(oversize.status()).toBe(400);
  await page.evaluate(() => (window as any).testController.abort());
  await expect.poll(async () => {
    const saved = await (await apiRequest.get(`/api/conversations/${started.conversation}`)).json();
    return saved.messages.find((m: { id: string }) => m.id === started.assistant).status;
  }).toBe('cancelled');
  const saved = await (await apiRequest.get(`/api/conversations/${started.conversation}`)).json();
  expect(saved.messages).toHaveLength(2); // Failed competing start did not create a stray user turn.
  expect(saved.messages[1].context_manifest.instructions).toBe('Remember this.');
  expect((await apiRequest.delete(`/api/projects/${started.project}`, mutation)).ok()).toBeTruthy();
  const after = await (await apiRequest.get(`/api/conversations/${started.conversation}`)).json();
  expect(after.conversation.project_id).toBeNull(); expect(after.messages).toHaveLength(2);
  expect((await apiRequest.delete(`/api/conversations/${started.conversation}`, mutation)).ok()).toBeTruthy();
  expect((await apiRequest.get(`/api/conversations/${started.conversation}`)).status()).toBe(404);
});
