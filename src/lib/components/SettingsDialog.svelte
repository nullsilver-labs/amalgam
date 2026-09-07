<script lang="ts">
	import { Globe, Info, KeyRound, Keyboard, Laptop, Library, LogOut, MessageSquare, Monitor, Moon, Palette, Plus, Plug, RefreshCw, ShieldCheck, Sun, X } from '@lucide/svelte';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import Notice from './Notice.svelte';
	import Switch from './Switch.svelte';
	import { workspace, messageOf } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { prefs, type Theme } from '$lib/state/prefs.svelte';
	import { formatTokens, modifier } from '$lib/format';
	import { describeClipboard, detectCapabilities } from '$lib/capabilities';
	import { APP_NAME } from '$lib/config';
	import type { ChatSettings, CorpusDiagnostic, CorpusState, DeviceSession, IntegrationToken, Scope } from '$lib/types';

	/*
	 * Settings — the instance, in seven panels. Appearance and the keyboard
	 * are the browser's business; Chat is the instance's own, saved to the
	 * server; Access is who may reach it, from this browser and from scripts;
	 * the rest is what the server was configured with, shown and never edited
	 * here. The plate keeps one height whichever panel is open, so switching
	 * never moves the frame; a panel taller than it scrolls.
	 */

	type Section = 'appearance' | 'chat' | 'keyboard' | 'models' | 'access' | 'corpus' | 'about';
	const sections: { id: Section; label: string; icon: typeof Palette }[] = [
		{ id: 'appearance', label: 'Appearance', icon: Palette },
		{ id: 'chat', label: 'Chat', icon: MessageSquare },
		{ id: 'keyboard', label: 'Keyboard', icon: Keyboard },
		{ id: 'models', label: 'Models', icon: Plug },
		{ id: 'access', label: 'Access', icon: ShieldCheck },
		{ id: 'corpus', label: 'corpus', icon: Library },
		{ id: 'about', label: 'About', icon: Info }
	];
	const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
		{ value: 'system', label: 'System', icon: Monitor },
		{ value: 'dark', label: 'Dark', icon: Moon },
		{ value: 'light', label: 'Light', icon: Sun }
	];
	const mod = modifier();
	const keys = [
		{ label: 'New chat', kbd: `${mod} ⇧ O` },
		{ label: 'Search conversations', kbd: `${mod} K` },
		{ label: 'Send', kbd: `${mod} Enter` },
		{ label: 'New line', kbd: 'Enter' },
		{ label: 'Close a menu, panel or dialog', kbd: 'Esc' }
	];

	let section = $state<Section>(workspace.data.models.length ? 'appearance' : 'models');
	let error = $state('');
	let leaving = $state(false);

	const integrations = $derived(workspace.data.integrations);

	/* Chat: edited as a draft, saved as one. */
	const draft = $state<ChatSettings>(structuredClone($state.snapshot(workspace.data.settings)));
	let saving = $state(false);
	let saved = $state(false);
	const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(workspace.data.settings));
	const budgetValid = $derived(Number.isInteger(draft.contextTokens) && draft.contextTokens >= 1000 && draft.contextTokens <= 2_000_000);
	const valid = $derived(budgetValid && draft.suggestions.every(s => s.label.trim()));

	async function save() {
		saving = true; error = ''; saved = false;
		try {
			await workspace.saveSettings({ systemPrompt: draft.systemPrompt, contextTokens: draft.contextTokens, thinking: draft.thinking, suggestions: draft.suggestions.map(s => ({ label: s.label.trim(), text: s.text })) });
			Object.assign(draft, structuredClone($state.snapshot(workspace.data.settings)));
			saved = true;
			setTimeout(() => (saved = false), 2000);
		} catch (err) { error = messageOf(err); }
		finally { saving = false; }
	}

	async function signOut() {
		leaving = true;
		try { await workspace.logout(); }
		catch (err) { error = messageOf(err); leaving = false; }
	}

	/* ------------------------------------------------------------------
	 * Access — this browser, the devices signed in, the tokens handed out
	 * --------------------------------------------------------------- */

	/* Asked of the browser once, when the dialog opens: none of it changes underneath us. */
	const capabilities = detectCapabilities();

	const SCOPE_NOTES: { id: Scope; hint: string }[] = [
		{ id: 'read', hint: 'Read conversations, projects and search' },
		{ id: 'write', hint: 'Create, rename, delete and organise conversations and projects' },
		{ id: 'generate', hint: 'Send messages to a model — this spends money' },
		{ id: 'admin', hint: 'Read and change instance chat settings' }
	];
	const EXPIRIES: { value: number | null; label: string }[] = [
		{ value: 30, label: '30 days' }, { value: 90, label: '90 days' },
		{ value: 365, label: '365 days' }, { value: null, label: 'Never' }
	];

	let devices = $state<DeviceSession[]>([]);
	let tokens = $state<IntegrationToken[]>([]);
	let accessLoaded = $state(false);
	let accessBusy = $state(false);
	let tokenName = $state('');
	let tokenScopes = $state<Scope[]>(['read']);
	let tokenExpiry = $state<number | null>(90);
	let creating = $state(false);
	/* Shown once, held only in this component, gone when the dialog closes. */
	let freshId = $state('');
	let freshSecret = $state('');
	let secretCopied = $state(false);
	/* What the token being made will be allowed to do, in one line. */
	const scopeHint = $derived(tokenScopes.length
		? SCOPE_NOTES.filter(s => tokenScopes.includes(s.id)).map(s => s.hint).join('. ') + '.'
		: 'Choose at least one permission.');

	async function loadAccess() {
		accessBusy = true;
		try {
			[devices, tokens] = await Promise.all([workspace.listSessions(), workspace.listTokens()]);
			accessLoaded = true;
		} catch (err) { error = messageOf(err); }
		finally { accessBusy = false; }
	}

	/* The panel is rarely opened, so nothing is fetched until it is. */
	$effect(() => { if (section === 'access' && !accessLoaded && !accessBusy) void loadAccess(); });

	async function revokeDevice(id: string) {
		try {
			await workspace.revokeSession(id);
			/* Signing this browser out is a sign-out: the cookie is already gone. */
			if (devices.find(d => d.id === id)?.current) { window.location.assign('/login'); return; }
			devices = devices.filter(d => d.id !== id);
		} catch (err) { error = messageOf(err); }
	}

	async function createToken() {
		creating = true; error = ''; freshId = ''; freshSecret = ''; secretCopied = false;
		try {
			const created = await workspace.createToken(tokenName.trim(), tokenScopes, tokenExpiry);
			freshId = created.id;
			freshSecret = created.secret || '';
			/* The list is oldest first, so the new one lands at its end. */
			tokens = [...tokens, { ...created, secret: undefined }];
			tokenName = '';
		} catch (err) { error = messageOf(err); }
		finally { creating = false; }
	}

	async function revokeToken(id: string) {
		try { await workspace.revokeToken(id); tokens = tokens.filter(t => t.id !== id); }
		catch (err) { error = messageOf(err); }
	}

	function toggleScope(scope: Scope) {
		tokenScopes = tokenScopes.includes(scope) ? tokenScopes.filter(s => s !== scope) : [...tokenScopes, scope];
	}

	async function copySecret() {
		secretCopied = await workspace.copy(freshSecret);
	}

	/* The secret arrives at the end of a list that may sit below the fold. */
	function reveal(node: HTMLElement) {
		node.scrollIntoView({ block: 'nearest' });
	}

	const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
	function when(value: string | null) { return value ? dateOnly.format(new Date(value)) : 'never'; }

	/* ------------------------------------------------------------------
	 * corpus — asked of corpus itself, not inferred from configuration
	 * --------------------------------------------------------------- */

	/* Reachable, refused and unauthorised are three different words on purpose. */
	const CORPUS_STATE: Record<CorpusState, string> = {
		ok: 'Connected',
		unreachable: 'Unreachable',
		unauthenticated: 'Token not recognised',
		forbidden: 'Token lacks read',
		wrong_host: 'Host refused',
		rate_limited: 'Rate limited',
		error: 'Unexpected answer'
	};

	let diagnostic = $state<CorpusDiagnostic | null>(null);
	let corpusBusy = $state(false);

	async function loadCorpus(refresh = false) {
		corpusBusy = true;
		try { diagnostic = await workspace.corpusStatus(refresh); }
		catch (err) { error = messageOf(err); }
		finally { corpusBusy = false; }
	}

	/* The panel is rarely opened, so corpus is not disturbed until it is. */
	$effect(() => { if (section === 'corpus' && !diagnostic && !corpusBusy) void loadCorpus(); });

	const clockAndDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	function checkedAt(value: string) { return clockAndDate.format(new Date(value)); }
</script>

<Dialog title="Settings" size="wide" onclose={() => ui.close()}>
	<div class="settings">
		<nav class="nav" aria-label="Settings sections">
			{#each sections as s (s.id)}
				<button type="button" class="nav__item" class:is-active={section === s.id} aria-current={section === s.id ? 'page' : undefined} onclick={() => (section = s.id)}>
					<s.icon size={15} strokeWidth={1.75} />
					<span>{s.label}</span>
				</button>
			{/each}
		</nav>

		<div class="panel">
			{#if error}<Notice ondismiss={() => (error = '')}>{error}</Notice>{/if}

			{#if section === 'appearance'}
				<h3 class="panel__title">Theme</h3>
				<p class="panel__lede">Near-black and warm silver, or the same two colours the other way round. System follows the device.</p>
				<div class="themes" role="radiogroup" aria-label="Theme">
					{#each themes as t (t.value)}
						<button type="button" class="theme" class:is-active={prefs.theme === t.value} role="radio" aria-checked={prefs.theme === t.value} onclick={() => prefs.setTheme(t.value)}>
							<span class="swatch swatch--{t.value}" aria-hidden="true">
								<span class="swatch__line"></span>
								<span class="swatch__line swatch__line--short"></span>
							</span>
							<span class="theme__label"><t.icon size={13} strokeWidth={1.75} />{t.label}</span>
						</button>
					{/each}
				</div>
			{:else if section === 'chat'}
				<h3 class="panel__title">System prompt</h3>
				<p class="panel__lede">Sent at the start of every conversation, ahead of any project instructions. Empty means {APP_NAME}’s own single line.</p>
				<textarea class="prompt" bind:value={draft.systemPrompt} rows="6" maxlength="12000" aria-label="System prompt" placeholder="Empty — the base instruction is used."></textarea>

				<h3 class="panel__title">Context budget</h3>
				<p class="panel__lede">The most a request may carry, in estimated tokens, before the oldest exchanges drop out. A model with a smaller declared window lowers it further, after the reply’s own room. Estimated from characters, on the safe side.</p>
				<div class="budget">
					<input class="budget__field" type="number" inputmode="numeric" min="1000" max="2000000" step="1000" bind:value={draft.contextTokens} aria-label="Context budget in tokens" aria-invalid={!budgetValid} />
					<span class="budget__unit">tokens{#if budgetValid}, about {formatTokens(draft.contextTokens)}{/if}</span>
				</div>

				<h3 class="panel__title">Thinking</h3>
				<p class="panel__lede">Asks Claude models to think before answering, adaptively, and to show a summary of it; every reply keeps room for up to 16k tokens of thinking on top of its own. Reasoning that other models send is shown either way.</p>
				<div class="rows">
					<label class="row row--switch">
						<span class="row__text">
							<span class="row__label">Ask models to think before answering</span>
							<span class="row__hint">Turn it off for Claude Haiku 4.5 and older Claude models, which reject the request.</span>
						</span>
						<Switch bind:checked={draft.thinking} label="Ask models to think before answering" />
					</label>
				</div>

				<h3 class="panel__title">Suggestions</h3>
				<p class="panel__lede">The pills under the composer on a new chat. Each drops its text into the composer for you to finish.</p>
				<div class="suggestions">
					{#each draft.suggestions as s, i (i)}
						<div class="suggestion">
							<input class="suggestion__label" bind:value={s.label} maxlength="40" placeholder="Label" aria-label="Suggestion label" />
							<textarea class="suggestion__text" bind:value={s.text} rows="2" maxlength="2000" placeholder="What it drops into the composer" aria-label="Suggestion text"></textarea>
							<button type="button" class="suggestion__remove" aria-label="Remove suggestion" title="Remove" onclick={() => draft.suggestions.splice(i, 1)}><X size={14} /></button>
						</div>
					{/each}
					{#if draft.suggestions.length < 8}
						<Button variant="outline" size="sm" onclick={() => draft.suggestions.push({ label: '', text: '' })}><Plus size={13} strokeWidth={2} />Add suggestion</Button>
					{/if}
				</div>
				<div class="panel__actions panel__actions--row">
					<span class="panel__status" role="status">{saved ? 'Saved' : dirty ? 'Unsaved changes' : ''}</span>
					<Button size="md" onclick={save} disabled={saving || !dirty || !valid}>{saving ? 'Saving…' : 'Save'}</Button>
				</div>
			{:else if section === 'keyboard'}
				<h3 class="panel__title">Shortcuts</h3>
				<p class="panel__lede">The mouse is optional. Menus and lists take the arrow keys once they are open.</p>
				<dl class="rows">
					{#each keys as k (k.label)}
						<div class="row"><dt class="row__label">{k.label}</dt><dd class="row__value"><kbd>{k.kbd}</kbd></dd></div>
					{/each}
				</dl>
			{:else if section === 'models'}
				<h3 class="panel__title">Connections</h3>
				<p class="panel__lede">Explicit lists or model IDs discovered from configured servers. Keys stay on the server. Listing a model does not verify chat support or permission to generate; catalogs may also include non-chat models.</p>
				{#each workspace.data.modelConnections as connection (connection.id)}
					<p class="panel__note"><strong>{connection.name} · {connection.destination}</strong><br />{connection.detail}{#if connection.checkedAt}<br />Last discovery attempt: {checkedAt(connection.checkedAt)}{/if}</p>
				{/each}
				<p class="panel__note">Discovery is cached for five minutes, failures for 30 seconds. Reload the page after that to retry. A failed refresh keeps the last successful list; a server restart clears it.</p>
				{#if workspace.data.models.length}
					<ul class="rows" role="list">
						{#each workspace.data.models as m (m.id)}
							<li class="row">
								<span class="row__glyph"><Globe size={16} strokeWidth={1.75} /></span>
								<span class="row__text">
									<span class="row__label">{m.name}</span>
									<span class="row__hint">{m.provider} · {m.destination} · {m.window ? `${formatTokens(m.window)}-token window` : 'window not declared'}</span>
								</span>
								<span class="tag">Listed</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="panel__lede">No models available. Configure a provider on the server, or use a manual list if discovery failed.</p>
				{/if}
				<h3 class="panel__title">Adding one</h3>
				<p class="panel__lede">In the server’s <code>.env</code>, set the API base URL and key (optional for keyless local endpoints), then <code>docker compose up -d</code>. OpenAI-compatible providers with empty or omitted <code>*_MODELS</code> use a server-side <code>GET &lt;base&gt;/models</code>; OpenAI’s base URL defaults to its hosted API. No generation is used for discovery. Anthropic still needs a manual list.</p>
				<p class="panel__lede">A nonempty <code>*_MODELS</code> list overrides discovery entirely and works without a catalog connection. Append <code>:400k</code> or <code>:400000</code> to declare a known context window. Discovered windows are unknown, so the instance budget applies and may exceed a model’s limit. Name further providers in <code>PROVIDERS</code>; each reads its own prefix.</p>
				<pre class="snippet"><code>OPENAI_API_KEY=your-key
# Optional offline override, with a known window:
# OPENAI_MODELS=your-model-id:400k

ANTHROPIC_API_KEY=your-key
ANTHROPIC_MODELS=your-claude-model-id

# Ollama, llama.cpp, or another compatible server
COMPATIBLE_NAME=How the picker should name it
COMPATIBLE_BASE_URL=http://host.docker.internal:11434/v1
# COMPATIBLE_API_KEY=your-key-if-required
# COMPATIBLE_MODELS=your-local-model:8k

# Any number more, each with a prefix of its own
PROVIDERS=openrouter
OPENROUTER_NAME=OpenRouter
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=your-key
# OPENROUTER_MODELS=a-model-id:200k</code></pre>
			{:else if section === 'access'}
				<h3 class="panel__title">This browser</h3>
				<p class="panel__lede">What this page can actually do where it is being served from. Not settings — what the browser reports. A page served over plain http to anything but localhost is not a secure context, whatever network it travels on.</p>
				<dl class="rows">
					<div class="row">
						<dt class="row__label">Secure context</dt>
						<dd class="row__value">{capabilities.secureContext ? 'Yes — https, or localhost' : 'No — plain http beyond localhost'}</dd>
					</div>
					<div class="row">
						<dt class="row__label">Clipboard</dt>
						<dd class="row__value">{describeClipboard(capabilities.clipboard)}</dd>
					</div>
					<div class="row">
						<dt class="row__label">Microphone</dt>
						<dd class="row__value">{capabilities.microphone ? 'Available — nothing records yet' : 'Unavailable here'}</dd>
					</div>
				</dl>

				<h3 class="panel__title">Devices</h3>
				<p class="panel__lede">Every browser signed in to this instance. Signing one out ends its session at once, wherever it is. Changing <code>APP_PASSWORD</code> on the server signs out all of them at the next restart.</p>
				{#if devices.length}
					<ul class="rows devices" role="list">
						{#each devices as d (d.id)}
							<li class="row">
								<span class="row__glyph"><Laptop size={16} strokeWidth={1.75} /></span>
								<span class="row__text">
									<span class="row__label">{d.device}</span>
									<span class="row__hint">Signed in {when(d.created_at)} · last seen {when(d.last_seen_at)} · expires {when(d.expires_at)}</span>
								</span>
								{#if d.current}<span class="tag tag--on">This device</span>{/if}
								<Button variant="ghost" size="sm" onclick={() => revokeDevice(d.id)}>Sign out device</Button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="panel__lede">{accessBusy ? 'Loading…' : 'No signed-in devices.'}</p>
				{/if}
				<div class="panel__actions">
					<Button variant="outline" size="md" onclick={signOut} disabled={leaving}><LogOut size={14} strokeWidth={1.75} />Sign out</Button>
				</div>

				<h3 class="panel__title">Integration tokens</h3>
				<p class="panel__lede">Keys for scripts and other programs, each with only the permissions you give it. Send one as <code>Authorization: Bearer …</code> to the <code>/api</code> routes. A token can never sign in, manage devices, or make another token.</p>
				<div class="mint">
					<label class="mint__field mint__field--name">
						<span class="mint__label">Name</span>
						<input bind:value={tokenName} maxlength="60" placeholder="What it is for" aria-label="Token name" />
					</label>
					<div class="mint__field" role="group" aria-labelledby="mint-permissions">
						<span class="mint__label" id="mint-permissions">Permissions</span>
						<div class="chips">
							{#each SCOPE_NOTES as s (s.id)}
								<button type="button" class="chip" class:is-on={tokenScopes.includes(s.id)} aria-pressed={tokenScopes.includes(s.id)} title={s.hint} onclick={() => toggleScope(s.id)}>{s.id}</button>
							{/each}
						</div>
						<span class="mint__hint">{scopeHint}</span>
					</div>
					<div class="mint__field" role="radiogroup" aria-labelledby="mint-expires">
						<span class="mint__label" id="mint-expires">Expires</span>
						<div class="chips">
							{#each EXPIRIES as e (e.label)}
								<button type="button" class="chip" class:is-on={tokenExpiry === e.value} role="radio" aria-checked={tokenExpiry === e.value} onclick={() => (tokenExpiry = e.value)}>{e.label}</button>
							{/each}
						</div>
					</div>
					<div class="mint__field">
						<span class="mint__label" aria-hidden="true"></span>
						<div>
							<Button size="md" onclick={createToken} disabled={creating || !tokenName.trim() || !tokenScopes.length}>
								<Plus size={13} strokeWidth={2} />{creating ? 'Creating…' : 'Create token'}
							</Button>
						</div>
					</div>
				</div>
				{#if tokens.length}
					<ul class="rows tokens" role="list">
						{#each tokens as t (t.id)}
							<li class="row">
								<span class="row__glyph"><KeyRound size={16} strokeWidth={1.75} /></span>
								<span class="row__text">
									<span class="row__label">{t.name}</span>
									<span class="row__hint">{t.scopes.join(', ')} · last used {t.last_used_at ? when(t.last_used_at) : 'never'} · expires {t.expires_at ? when(t.expires_at) : 'never'}</span>
								</span>
								<Button variant="ghost" size="sm" onclick={() => revokeToken(t.id)}>Revoke token</Button>
								{#if t.id === freshId && freshSecret}
									<!-- The secret, shown once, under the row it belongs to. -->
									<div class="secret" use:reveal>
										<p class="secret__note">Copy it now. It is shown once and is not stored — only a hash of it is. If you lose it, revoke the token and make another.</p>
										<div class="secret__row">
											<input class="secret__field" readonly value={freshSecret} aria-label="New token secret" onfocus={(event) => event.currentTarget.select()} />
											<Button variant="outline" size="md" onclick={copySecret}>{secretCopied ? 'Copied' : 'Copy'}</Button>
										</div>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="panel__note">No tokens yet.</p>
				{/if}
			{:else if section === 'corpus'}
				<h3 class="panel__title">Your library</h3>
				<p class="panel__lede">{APP_NAME} can read the cards in a corpus instance beside it, when you attach them to a message yourself. It asks corpus from this server, using a token you minted there with the <code>read</code> scope and nothing else. Nothing is ever written into your library: no capture, no edits, no new collections — the connector calls three routes, and all three of them only read.</p>
				<dl class="rows">
					<div class="row"><dt class="row__label">Endpoint</dt><dd class="row__value">{diagnostic?.endpoint || 'Not set'}</dd></div>
					<div class="row"><dt class="row__label">State</dt><dd class="row__value">{diagnostic ? CORPUS_STATE[diagnostic.state] : corpusBusy ? 'Checking…' : 'Not checked'}</dd></div>
					<div class="row"><dt class="row__label">Checked</dt><dd class="row__value">{diagnostic ? checkedAt(diagnostic.checked_at) : '—'}</dd></div>
				</dl>
				{#if diagnostic}
					<p class="panel__note">{diagnostic.detail}</p>
				{/if}
				<div class="panel__actions">
					<Button variant="outline" size="md" onclick={() => void loadCorpus(true)} disabled={corpusBusy}>
						<RefreshCw size={14} strokeWidth={1.75} />{corpusBusy ? 'Checking…' : 'Check now'}
					</Button>
				</div>

				<h3 class="panel__title">Addresses</h3>
				<p class="panel__lede">The two optional Docker networks this instance was configured with. Reaching an address is not permission to read it — corpus decides that, by the scopes on the token.</p>
				<ul class="rows" role="list">
					<li class="row">
						<span class="row__glyph"><Library size={16} strokeWidth={1.75} /></span>
						<span class="row__text"><span class="row__label">corpus API</span><span class="row__hint">Read-only, server to server, on request</span></span>
						<span class="tag" class:tag--on={integrations.corpus.configured}>{integrations.corpus.configured ? 'Configured' : 'Not configured'}</span>
					</li>
					<li class="row">
						<span class="row__glyph"><Plug size={16} strokeWidth={1.75} /></span>
						<span class="row__text"><span class="row__label">Embedder</span><span class="row__hint">Shared inference endpoint, not used yet</span></span>
						<span class="tag" class:tag--on={integrations.embeddings}>{integrations.embeddings ? 'Configured' : 'Not configured'}</span>
					</li>
				</ul>
				<p class="panel__note">Starting standalone never needs corpus. When you attach excerpts and the model you picked is not on this machine, the composer says where they are going, before you send.</p>
			{:else}
				<h3 class="panel__title">{APP_NAME} <span class="version">0.1</span></h3>
				<p class="panel__lede">A self-hosted AI interface by Nullsilver. One workspace, your choice of model, conversations that stay on your server.</p>
				<dl class="rows">
					<div class="row"><dt class="row__label">Instance</dt><dd class="row__value">Private, single user</dd></div>
					<div class="row"><dt class="row__label">Storage</dt><dd class="row__value">PostgreSQL on this server</dd></div>
					<div class="row"><dt class="row__label">Telemetry</dt><dd class="row__value">None</dd></div>
					<div class="row"><dt class="row__label">Model requests</dt><dd class="row__value">Generation only when you send; model catalogs read automatically</dd></div>
				</dl>
				<p class="panel__note">Text chat, projects, search, export and reading cards you attach from a corpus library work today. Attachments of your own, web search, images and voice are planned, not hidden. Devices and integration tokens are under Access.</p>
			{/if}
		</div>
	</div>
</Dialog>

<style>
	/* One height for every panel, so the frame never moves between them. */
	.settings {
		display: grid;
		grid-template-columns: 11rem minmax(0, 1fr);
		gap: var(--space-6);
		height: min(33rem, calc(100dvh - 9rem));
	}

	.nav {
		display: grid;
		gap: var(--space-half);
		align-content: start;
	}

	.nav__item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		height: var(--control-h);
		padding-inline: var(--space-3);
		border-radius: var(--radius-md);
		font-size: var(--text-ui);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.nav__item:hover,
	.nav__item.is-active {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	/* The panel scrolls; nothing inside it is ever squeezed to fit. */
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
		scrollbar-gutter: stable;
		padding-right: var(--space-2);
	}

	.panel > :global(*) {
		flex: none;
	}

	.panel__title {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text-strong);
	}

	.panel__title:not(:first-child) {
		margin-top: var(--space-6);
	}

	.version {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-subtle);
	}

	.panel__lede,
	.panel__note {
		font-size: var(--text-sm);
		line-height: var(--leading-normal);
		color: var(--color-text-muted);
		max-width: 44rem;
		margin-bottom: var(--space-2);
	}

	.panel__note {
		font-size: var(--text-xs);
		color: var(--color-text-subtle);
	}

	.panel__lede code {
		font-size: 0.875em;
		color: var(--color-text);
	}

	.panel__actions {
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: var(--border-width) solid var(--color-border);
	}

	.panel__actions--row {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
	}

	.panel__status {
		font-size: var(--text-xs);
		color: var(--color-text-subtle);
	}

	/* ------------------------------------------------------------------
	 * Chat: the prompt and the suggestions
	 * --------------------------------------------------------------- */

	.prompt {
		min-height: 8rem;
		font-size: var(--text-sm);
		line-height: var(--leading-relaxed);
	}

	.budget {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.budget__field {
		width: 9rem;
		font-variant-numeric: tabular-nums;
	}

	.budget__unit {
		font-size: var(--text-sm);
		color: var(--color-text-subtle);
	}

	.suggestions {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}

	/* One suggestion: label, text, and a way out — a row on the raised
	 * surface, the same plate the fields themselves stand on. */
	.suggestion {
		display: grid;
		grid-template-columns: 11rem minmax(0, 1fr) auto;
		gap: var(--space-2);
		align-items: start;
		width: 100%;
	}

	.suggestion__text {
		min-height: var(--control-h);
		font-size: var(--text-sm);
	}

	.suggestion__remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h);
		height: var(--control-h);
		border-radius: var(--radius-full);
		color: var(--color-text-subtle);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.suggestion__remove:hover {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	/* ------------------------------------------------------------------
	 * Access: a token to make, as corpus mints one — a labelled grid, the
	 * choices as chips, the primary action under the controls
	 * --------------------------------------------------------------- */

	.mint {
		display: grid;
		gap: var(--space-3);
		margin-block: var(--space-2) var(--space-3);
	}

	/* Label column, control column. The label's box is the control's height,
	 * so it sits centred on the chips (or the field) whatever comes below. */
	.mint__field {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		column-gap: var(--space-4);
		row-gap: var(--space-2);
		align-items: start;
	}

	.mint__label {
		display: flex;
		align-items: center;
		height: var(--control-h-sm);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-wide);
		color: var(--color-text-subtle);
	}

	.mint__field--name .mint__label {
		height: var(--control-h);
	}

	.mint__hint {
		grid-column: 2;
		font-size: var(--text-xs);
		line-height: var(--leading-normal);
		color: var(--color-text-subtle);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	/* A chip: a small pill; pressed, it inverts, as emphasis does here. */
	.chip {
		height: var(--control-h-sm);
		padding-inline: var(--space-3);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-full);
		font-size: var(--text-ui);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out);
	}

	.chip:hover {
		border-color: var(--color-border-lit);
		color: var(--color-text-strong);
	}

	.chip.is-on {
		background-color: var(--color-accent);
		border-color: var(--color-accent);
		color: var(--color-on-accent);
	}

	/* A token's row may carry its secret beneath it, once. */
	.tokens .row {
		flex-wrap: wrap;
	}

	/* Shown once and never again, so it is lit, given room and a way to copy it. */
	.secret {
		flex-basis: 100%;
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-1);
		margin-left: calc(var(--control-h-sm) + var(--space-3));
		padding: var(--space-3);
		border: var(--border-width) solid var(--color-border-lit);
		border-radius: var(--radius-md);
	}

	.secret__note {
		font-size: var(--text-xs);
		line-height: var(--leading-normal);
		color: var(--color-text-muted);
	}

	.secret__row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.secret__field {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	/* ------------------------------------------------------------------
	 * Theme cards: a miniature of the scheme, then its name
	 * --------------------------------------------------------------- */

	.themes {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-2);
	}

	.theme {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2);
		border: var(--border-width) solid var(--color-border);
		border-radius: var(--radius-lg);
		cursor: pointer;
		transition: border-color var(--duration-fast) var(--ease-out);
	}

	.theme:hover {
		border-color: var(--color-border-strong);
	}

	.theme.is-active {
		border-color: var(--color-border-accent);
	}

	.swatch {
		--swatch-bg: var(--ns-black);
		--swatch-ink: var(--ns-silver-200);
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--space-1);
		aspect-ratio: 16 / 9;
		padding-inline: var(--space-3);
		border-radius: var(--radius-md);
		border: var(--border-width) solid var(--color-border);
		background-color: var(--swatch-bg);
		overflow: hidden;
	}

	.swatch--light {
		--swatch-bg: var(--ns-silver-50);
		--swatch-ink: var(--ns-black);
	}

	.swatch--system::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		right: 0;
		width: 50%;
		background-color: var(--ns-silver-50);
		border-left: var(--border-width) solid var(--color-border);
	}

	.swatch__line {
		height: 3px;
		width: 60%;
		border-radius: var(--radius-full);
		background-color: var(--swatch-ink);
		opacity: 0.8;
	}

	.swatch__line--short {
		width: 40%;
		opacity: 0.45;
	}

	.theme__label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding-inline: var(--space-1);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
	}

	.theme.is-active .theme__label {
		color: var(--color-text-strong);
	}

	/* ------------------------------------------------------------------
	 * Rows, as corpus's settings draw them
	 * --------------------------------------------------------------- */

	.rows {
		display: grid;
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--control-h);
		padding-block: var(--space-2);
		border-top: var(--border-width) solid var(--color-border);
	}

	.row--switch {
		cursor: pointer;
	}

	.row__glyph {
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h-sm);
		height: var(--control-h-sm);
		flex: none;
		border: var(--border-width) solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
	}

	.row__text {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: var(--space-half);
	}

	.row__label {
		flex: 1;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.row__hint {
		font-size: var(--text-xs);
		line-height: var(--leading-normal);
		color: var(--color-text-subtle);
		overflow-wrap: anywhere;
	}

	.row__value {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		text-align: right;
	}

	.tag {
		flex: none;
		height: var(--control-h-sm);
		display: inline-flex;
		align-items: center;
		padding-inline: var(--space-3);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-full);
		font-size: var(--text-2xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-subtle);
	}

	.tag--on {
		color: var(--color-text);
		border-color: var(--color-border-lit);
	}

	/* Always whole, never scrolling: long lines wrap. */
	.snippet {
		padding: var(--space-3) var(--space-4);
		background-color: var(--color-surface-raised);
		border: var(--border-width) solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: var(--text-2xs);
		line-height: var(--leading-relaxed);
		color: var(--color-text-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	@media (max-width: 47.5rem) {
		.mint__field {
			grid-template-columns: 1fr;
			row-gap: var(--space-1);
		}

		.mint__label,
		.mint__field--name .mint__label {
			height: auto;
		}

		.mint__hint {
			grid-column: 1;
		}

		.secret {
			margin-left: 0;
		}

		.settings {
			grid-template-columns: 1fr;
			grid-template-rows: auto minmax(0, 1fr);
			gap: var(--space-4);
			height: min(34rem, calc(100dvh - 8rem));
		}

		.nav {
			grid-auto-flow: column;
			grid-auto-columns: max-content;
			overflow-x: auto;
			gap: var(--space-1);
			margin-inline: calc(var(--space-2) * -1);
			padding-inline: var(--space-2);
		}

		.nav__item {
			height: var(--control-h-sm);
			border: var(--border-width) solid var(--color-border);
			border-radius: var(--radius-full);
			font-size: var(--text-xs);
		}

		.themes {
			gap: var(--space-1);
		}

		.suggestion {
			grid-template-columns: minmax(0, 1fr) auto;
		}

		.suggestion__text {
			grid-column: 1 / -1;
		}

		.tag {
			display: none;
		}
	}
</style>
