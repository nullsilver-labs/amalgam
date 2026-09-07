<script lang="ts">
	import { Check, Copy, Info } from '@lucide/svelte';
	import Markdown from './Markdown.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { modelName } from '$lib/format';
	import type { Message } from '$lib/types';

	/*
	 * One turn. A person's words sit in a bubble at the trailing edge; the
	 * model's answer runs the full measure as prose, with a quiet row of
	 * actions and the model's name beneath it. The row shows on hover, and
	 * always on the last turn, where the eye already is.
	 */

	let { message, last = false }: { message: Message; last?: boolean } = $props();

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
			<button type="button" class="action" onclick={copy} aria-label="Copy message">
				{#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}
			</button>
		</div>
	{:else}
		{#if message.content}
			<Markdown content={message.content} />
		{:else if message.status === 'streaming'}
			<div class="thinking" role="status"><span></span><span></span><span></span><span class="sr-only">Waiting for the model</span></div>
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
	.turn.is-last .actions {
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

	.action:hover {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
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

	.thinking {
		display: flex;
		align-items: center;
		gap: 5px;
		min-height: calc(var(--text-base) * var(--leading-prose));
	}

	.thinking > span:not(.sr-only) {
		width: 5px;
		height: 5px;
		border-radius: var(--radius-full);
		background-color: var(--color-text-muted);
		animation: pulse 1.4s infinite;
	}

	.thinking > span:nth-child(2) {
		animation-delay: 0.15s;
	}

	.thinking > span:nth-child(3) {
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
