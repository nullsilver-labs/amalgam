<script lang="ts">
	import { Check, ChevronLeft, ChevronRight, Copy, Info, Pencil, RefreshCw } from '@lucide/svelte';
	import { modifier } from '$lib/format';
	import Markdown from './Markdown.svelte';
	import Menu from './Menu.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { formatDuration, modelName } from '$lib/format';
	import { modelEntries } from '$lib/model-entries';
	import type { Message } from '$lib/types';

	/*
	 * One turn. A person's words sit in a bubble at the trailing edge; the
	 * model's answer runs the full measure as prose, with a quiet row of
	 * actions and the model's name beneath it. The row shows on hover, and
	 * always on the last turn, where the eye already is.
	 *
	 * Above an answer whose model reported thinking, one line in a secondary
	 * colour says how long it worked — "Thinking for 4s" while it does,
	 * "Worked for 18s" after — and opens what it showed of the thinking, when
	 * it showed any. In the row, "answer again" opens the model list; the new
	 * answer is written beside this one, and a ‹ 1 / 2 › between the two.
	 *
	 * A person's message can be sent again with other words: the bubble
	 * becomes a field, and what is sent goes beside the original as a branch
	 * of its own, quoting the same cards. Nothing is overwritten.
	 */

	let { message, last = false, startedAt = 0 }: { message: Message; last?: boolean; startedAt?: number } = $props();

	/*
	 * A message that quoted the library says so beneath itself, for as long as
	 * the message exists. The card ids link back only when the operator has
	 * given amalgam a browser-reachable address for corpus (CORPUS_PUBLIC_URL);
	 * a service name on a Docker network is not one, so the titles stay plain
	 * text rather than becoming links that go nowhere.
	 */
	const library = $derived(workspace.data.integrations.corpus.publicUrl);

	let copied = $state(false);
	async function copy() {
		if (await workspace.copy(message.content)) {
			copied = true;
			setTimeout(() => (copied = false), 1500);
		}
	}

	const status = $derived(message.status === 'complete' ? '' : message.status);

	/* Thinking: the clock runs from the request until the first character of the answer. */
	let thoughtOpen = $state(false);
	let now = $state(Date.now());
	const stillThinking = $derived(message.status === 'streaming' && !message.content && startedAt > 0);
	$effect(() => {
		if (!stillThinking) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});
	const thoughtLabel = $derived(
		stillThinking ? `Thinking for ${formatDuration(now - startedAt)}`
		: message.thinking_ms !== null ? `Worked for ${formatDuration(message.thinking_ms)}`
		: 'Thought about it'
	);

	/* Answer again: the same list the composer's picker shows, this response's model marked. */
	let again = $state(false);
	let againAbove = $state(false);
	let againAnchor = $state<HTMLElement | null>(null);
	const canRegenerate = $derived(workspace.ready && !workspace.busy && !workspace.streaming && !workspace.loading && workspace.data.models.length > 0);
	const models = $derived(modelEntries(workspace.data.models, message.model ?? '', id => void workspace.regenerate(message, id)));
	function openAgain() {
		// Upward from the lower half of the screen, where the last answer sits above the composer.
		if (againAnchor) againAbove = againAnchor.getBoundingClientRect().bottom > window.innerHeight / 2;
		again = !again;
	}

	/* Branches: which of the answers at this point is being read. */
	const branch = $derived(workspace.active.branch(message));
	const canSwitch = $derived(!workspace.busy && !workspace.loading);

	/*
	 * Statistics, when Settings › Chat asks for them: under a person's message
	 * the size of the request that answered it — the whole context sent, not
	 * the message alone — and under the model's, after its name in the same
	 * breath, the reply's speed, its tokens and its time. A tilde marks an
	 * estimate: the provider counted nothing, so the numbers are reckoned from
	 * characters.
	 */
	const stats = $derived(workspace.data.settings.stats);
	const answer = $derived.by(() => {
		if (message.role !== 'user') return null;
		const at = workspace.messages.findIndex(m => m.id === message.id);
		const next = at >= 0 ? workspace.messages[at + 1] : undefined;
		return next?.role === 'assistant' && next.input_tokens != null ? next : null;
	});
	const requestStat = $derived(answer ? `${answer.tokens_estimated ? '~' : ''}${answer.input_tokens!.toLocaleString()} tokens sent` : '');
	const replyStat = $derived.by(() => {
		if (message.role !== 'assistant' || message.output_tokens == null || message.status === 'streaming') return '';
		const tokens = `${message.tokens_estimated ? '~' : ''}${message.output_tokens.toLocaleString()} tokens`;
		const writing = message.duration_ms != null && message.first_token_ms != null ? message.duration_ms - message.first_token_ms : 0;
		const inside = [tokens, ...(message.duration_ms != null ? [formatDuration(message.duration_ms)] : [])].join(', ');
		if (writing > 0 && message.output_tokens > 0) return `${Math.round(message.output_tokens / (writing / 1000)).toLocaleString()} tokens/s (${inside})`;
		return inside;
	});

	/* Editing: the bubble as a field, until it is sent or let go. */
	let editing = $state(false);
	let edited = $state('');
	let field = $state<HTMLTextAreaElement | null>(null);
	const canEdit = $derived(workspace.ready && !workspace.busy && !workspace.streaming && !workspace.loading && workspace.data.models.length > 0);
	function startEdit() { edited = message.content; editing = true; }
	function cancelEdit() { editing = false; }
	async function sendEdit() {
		const text = edited.trim();
		if (!text || !canEdit) return;
		editing = false;
		await workspace.edit(message, text);
	}
	function onEditKey(event: KeyboardEvent) {
		if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); }
		else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) { event.preventDefault(); void sendEdit(); }
	}
	$effect(() => {
		if (!editing || !field) return;
		field.style.height = 'auto';
		field.style.height = `${field.scrollHeight}px`;
	});
	$effect(() => { if (editing && field) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); } });
</script>

<article class="turn turn--{message.role}" class:is-last={last}>
	{#if message.role === 'user'}
		{#if editing}
			<div class="bubble bubble--editing">
				<textarea bind:this={field} bind:value={edited} aria-label="Edit your message" rows="1" maxlength="16000" oninput={() => { if (field) { field.style.height = 'auto'; field.style.height = `${field.scrollHeight}px`; } }} onkeydown={onEditKey}></textarea>
				<div class="edit__row">
					<button type="button" class="edit__button" onclick={cancelEdit}>Cancel</button>
					<button type="button" class="edit__button edit__button--send" onclick={() => void sendEdit()} disabled={!edited.trim() || !canEdit} title="Send ({modifier()} Enter)">Send</button>
				</div>
			</div>
		{:else}
			<div class="bubble">{message.content}</div>
		{/if}
		{#if message.sources?.length}
			<p class="turn__sources">
				<span>From your corpus library:</span>
				{#each message.sources as source, i (source.id)}
					{#if library}
						<a class="turn__source" href="{library}/cards/{source.id}" target="_blank" rel="noopener noreferrer">[{i + 1}] {source.title}</a>
					{:else}
						<span class="turn__source">[{i + 1}] {source.title}</span>
					{/if}
				{/each}
			</p>
		{/if}
		<div class="actions actions--user">
			{#if stats && requestStat}<span class="stat">{requestStat}</span>{/if}
			{#if branch.count > 1}
				<span class="branches">
					<button type="button" class="action action--small" onclick={() => void workspace.switchBranch(message, -1)} disabled={!canSwitch || branch.index === 0} aria-label="Previous branch"><ChevronLeft size={13} strokeWidth={2} /></button>
					<span class="branches__count">{branch.index + 1} / {branch.count}</span>
					<button type="button" class="action action--small" onclick={() => void workspace.switchBranch(message, 1)} disabled={!canSwitch || branch.index === branch.count - 1} aria-label="Next branch"><ChevronRight size={13} strokeWidth={2} /></button>
				</span>
			{/if}
			<button type="button" class="action" onclick={copy} aria-label="Copy message">
				{#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}
			</button>
			{#if !editing}
				<button type="button" class="action" onclick={startEdit} disabled={!canEdit} aria-label="Edit message" title="Send again with other words, as a new branch">
					<Pencil size={14} />
				</button>
			{/if}
		</div>
	{:else}
		{#if message.thinking !== null}
			<div class="thought">
				<button type="button" class="thought__toggle" class:is-open={thoughtOpen} aria-expanded={thoughtOpen} disabled={!message.thinking} onclick={() => (thoughtOpen = !thoughtOpen)}>
					<span>{thoughtLabel}</span>
					{#if message.thinking}<ChevronRight size={13} strokeWidth={2} />{/if}
				</button>
				{#if thoughtOpen && message.thinking}
					<div class="thought__body"><Markdown content={message.thinking} /></div>
				{/if}
			</div>
		{/if}
		{#if message.content}
			<Markdown content={message.content} />
		{:else if message.status === 'streaming'}
			{#if message.thinking === null}
				<div class="waiting" role="status"><span></span><span></span><span></span><span class="sr-only">Waiting for the model</span></div>
			{/if}
		{:else}
			<p class="muted small">No response text.</p>
		{/if}
		{#if message.error}
			<p class="turn__notice"><Info size={14} /><span>{message.error}</span></p>
		{/if}
		{#if message.status !== 'streaming'}
			<div class="actions">
				<button type="button" class="action" onclick={copy} aria-label="Copy response">
					{#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}
				</button>
				<div class="again" bind:this={againAnchor}>
					<button type="button" class="action" onclick={openAgain} disabled={!canRegenerate} aria-label="Regenerate" aria-haspopup="listbox" aria-expanded={again} title="Answer again with a model of your choice">
						<RefreshCw size={14} />
					</button>
					{#if again}
						<Menu items={models} role="listbox" label="Answer again with" align="start" above={againAbove} wide searchable={workspace.data.models.length > 6} searchPlaceholder="Filter models" onclose={() => (again = false)} />
					{/if}
				</div>
				{#if branch.count > 1}
					<span class="branches">
						<button type="button" class="action action--small" onclick={() => void workspace.switchBranch(message, -1)} disabled={!canSwitch || branch.index === 0} aria-label="Previous branch"><ChevronLeft size={13} strokeWidth={2} /></button>
						<span class="branches__count">{branch.index + 1} / {branch.count}</span>
						<button type="button" class="action action--small" onclick={() => void workspace.switchBranch(message, 1)} disabled={!canSwitch || branch.index === branch.count - 1} aria-label="Next branch"><ChevronRight size={13} strokeWidth={2} /></button>
					</span>
				{/if}
				{#if message.model}<span class="model">{modelName(message.model)}{#if stats && replyStat}, <span class="stat">{replyStat}</span>{/if}</span>{/if}
				{#if status}<span class="status">{status}</span>{/if}
			</div>
		{/if}
	{/if}
</article>

<style>
	.turn {
		position: relative;
		min-width: 0;
	}

	.turn--user {
		display: grid;
		justify-items: end;
		gap: var(--space-1);
		margin-left: auto;
		max-width: 82%;
	}

	.bubble {
		padding: var(--space-3) var(--space-4);
		background-color: var(--color-surface-raised);
		border: var(--border-width) solid var(--color-border);
		border-radius: var(--radius-lg);
		font-size: var(--text-base);
		line-height: var(--leading-relaxed);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		text-wrap: pretty;
	}

	/* The bubble as a field: the same plate, lit at the edge, the words in a
	 * bare textarea and two quiet words beneath. */
	.bubble--editing {
		display: grid;
		gap: var(--space-2);
		width: 100%;
		border-color: var(--color-border-lit);
		white-space: normal;
	}

	.turn--user:has(.bubble--editing) {
		max-width: 100%;
	}

	.bubble--editing textarea {
		display: block;
		width: 100%;
		min-height: 1.75rem;
		max-height: 40vh;
		padding: 0;
		background: none;
		border: 0;
		border-radius: 0;
		resize: none;
		font-size: var(--text-base);
		line-height: var(--leading-relaxed);
		color: var(--color-text-strong);
		overflow-y: auto;
	}

	.bubble--editing textarea:focus {
		outline: none;
		border: 0;
	}

	.edit__row {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-1);
		margin-right: calc(var(--space-2) * -1);
	}

	.edit__button {
		height: var(--control-h-sm);
		padding-inline: var(--space-2);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.edit__button:hover:not(:disabled) {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	.edit__button--send {
		color: var(--color-text-strong);
	}

	.edit__button:disabled {
		color: var(--color-text-faint);
		cursor: default;
	}

	/* The attribution under a message that quoted the library. */
	.turn__sources {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-1) var(--space-2);
		font-size: var(--text-2xs);
		line-height: var(--leading-normal);
		color: var(--color-text-subtle);
		text-align: right;
	}

	.turn__source {
		max-width: 100%;
		overflow-wrap: anywhere;
		color: var(--color-text-muted);
	}

	a.turn__source {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}

	a.turn__source:hover {
		color: var(--color-text-strong);
	}

	.turn__notice {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin-top: var(--space-3);
		font-size: var(--text-xs);
		line-height: var(--leading-relaxed);
		color: var(--color-text-muted);
	}

	.turn__notice :global(svg) {
		flex: none;
		margin-top: 0.2em;
	}

	/* The thinking line: bare text in a secondary colour, no plate, a chevron
	 * that turns when it opens. What it opens is the reasoning as prose, one
	 * size down and muted, with a hairline down its left. */
	.thought {
		display: grid;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	.thought__toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		justify-self: start;
		min-height: var(--space-6);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text-subtle);
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-out);
	}

	.thought__toggle:disabled {
		cursor: default;
	}

	.thought__toggle:hover:not(:disabled) {
		color: var(--color-text);
	}

	.thought__toggle :global(svg) {
		transition: transform var(--duration-fast) var(--ease-out);
	}

	.thought__toggle.is-open :global(svg) {
		transform: rotate(90deg);
	}

	.thought__body {
		padding-left: var(--space-3);
		border-left: var(--border-width) solid var(--color-border-strong);
		color: var(--color-text-muted);
	}

	.thought__body :global(.prose) {
		font-size: var(--text-sm);
		line-height: var(--leading-relaxed);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
		margin-left: calc(var(--space-2) * -1);
		min-height: var(--control-h-sm);
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease-out);
	}

	.actions--user {
		margin-top: 0;
		margin-left: 0;
		margin-right: calc(var(--space-1) * -1);
	}

	.turn:hover .actions,
	.turn:focus-within .actions,
	.turn.is-last .actions,
	.actions:has([aria-expanded='true']) {
		opacity: 1;
	}

	@media (hover: none) {
		.actions {
			opacity: 1;
		}
	}

	.action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h-sm);
		height: var(--control-h-sm);
		border-radius: var(--radius-full);
		color: var(--color-text-subtle);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.action:hover:not(:disabled),
	.action[aria-expanded='true'] {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	.action:disabled {
		color: var(--color-text-faint);
		cursor: default;
	}

	.action--small {
		width: var(--space-6);
		height: var(--space-6);
	}

	/* The menu positions itself from this box. */
	.again {
		position: relative;
		display: inline-flex;
	}

	.branches {
		display: inline-flex;
		align-items: center;
		gap: var(--space-half);
		font-size: var(--text-2xs);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-subtle);
	}

	.branches__count {
		white-space: nowrap;
	}

	.model,
	.status,
	.stat {
		font-size: var(--text-2xs);
		color: var(--color-text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Numbers line up; a tilde reads as one of them. */
	.stat {
		font-variant-numeric: tabular-nums;
	}

	.actions--user .stat {
		margin-right: var(--space-1);
	}


	.status {
		font-weight: var(--weight-medium);
		color: var(--color-text-subtle);
	}

	.waiting {
		display: flex;
		align-items: center;
		gap: 5px;
		min-height: calc(var(--text-base) * var(--leading-prose));
	}

	.waiting > span:not(.sr-only) {
		width: 5px;
		height: 5px;
		border-radius: var(--radius-full);
		background-color: var(--color-text-muted);
		animation: pulse 1.4s infinite;
	}

	.waiting > span:nth-child(2) {
		animation-delay: 0.15s;
	}

	.waiting > span:nth-child(3) {
		animation-delay: 0.3s;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.3;
		}
		50% {
			opacity: 1;
		}
	}

	@media (max-width: 47.5rem) {
		.turn--user {
			max-width: 92%;
		}

		.bubble {
			font-size: var(--text-sm);
		}
	}
</style>
