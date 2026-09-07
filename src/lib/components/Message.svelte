<script lang="ts">
	import { Check, ChevronLeft, ChevronRight, Copy, Info, RefreshCw } from '@lucide/svelte';
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
</script>

<article class="turn turn--{message.role}" class:is-last={last}>
	{#if message.role === 'user'}
		<div class="bubble">{message.content}</div>
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
				{#if message.model}<span class="model">{modelName(message.model)}</span>{/if}
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
	.status {
		font-size: var(--text-2xs);
		color: var(--color-text-faint);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
