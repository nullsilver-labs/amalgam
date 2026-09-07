<script lang="ts">
	import { Check, Library, LoaderCircle, Search } from '@lucide/svelte';
	import Dialog from './Dialog.svelte';
	import Button from './Button.svelte';
	import Notice from './Notice.svelte';
	import { workspace, messageOf } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import type { CorpusHit, CorpusState } from '$lib/types';

	/*
	 * Choosing what to quote from the owner's own library. A field, a list of
	 * cards, and a tick beside the ones this message will carry — nothing is
	 * fetched, sent or attached until the message itself is sent.
	 *
	 * When the library answers with anything but a clean result the panel says
	 * so in the library's own terms: a token corpus does not know, a token
	 * without the read scope and an address that does not answer are three
	 * different problems and are never shown as one.
	 */

	const LIMIT = 10;

	let query = $state('');
	let hits = $state<CorpusHit[]>([]);
	let outcome = $state<CorpusState>('ok');
	let detail = $state('');
	let semantic = $state(true);
	let searching = $state(false);
	let searched = $state(false);
	let problem = $state('');
	let field = $state<HTMLInputElement | null>(null);
	let version = 0;

	const chosen = $derived(new Set(workspace.sources.map(s => s.id)));
	const full = $derived(workspace.sources.length >= 5);

	$effect(() => { field?.focus(); });

	$effect(() => {
		const q = query.trim();
		const mine = ++version;
		if (!q) { hits = []; searching = false; searched = false; return; }
		searching = true;
		const timer = setTimeout(async () => {
			try {
				const result = await workspace.corpusSearch(q, LIMIT);
				if (mine !== version) return;
				hits = result.hits; outcome = result.state; detail = result.detail; semantic = result.semantic;
				problem = ''; searched = true;
			} catch (err) { if (mine === version) { problem = messageOf(err); hits = []; searched = true; } }
			finally { if (mine === version) searching = false; }
		}, 200);
		return () => clearTimeout(timer);
	});

	function choose(hit: CorpusHit) {
		if (!chosen.has(hit.id) && full) return;
		workspace.toggleSource({ id: hit.id, title: hit.title, card_type: hit.card_type });
	}
</script>

<Dialog title="Sources" onclose={() => ui.close()}>
	<div class="sources">
		<p class="lede">Search your corpus library and pick up to five cards. Their text is quoted ahead of your message, on this server, using a read-only token — nothing is written back.</p>

		{#if problem}<Notice ondismiss={() => (problem = '')}>{problem}</Notice>{/if}

		<div class="field">
			<span class="field__icon"><Search size={16} strokeWidth={1.75} /></span>
			<input
				bind:this={field}
				bind:value={query}
				type="text"
				aria-label="Search your corpus library"
				placeholder="Search your library"
				autocomplete="off"
				maxlength="200"
			/>
			{#if searching}<LoaderCircle size={15} class="spin field__spin" />{/if}
		</div>

		{#if searched && outcome !== 'ok'}
			<p class="diagnosis" role="status"><strong>{outcome.replace('_', ' ')}</strong> — {detail}</p>
		{:else if searched && !semantic}
			<p class="quiet" role="status">Your library answered lexically: its embedding model is unavailable, so these are keyword matches rather than meaning ones.</p>
		{/if}

		<div class="sources-results" role="listbox" aria-label="Library cards" aria-multiselectable="true">
			{#each hits as hit (hit.id)}
				{@const on = chosen.has(hit.id)}
				<button
					type="button"
					class="source-row"
					class:is-chosen={on}
					role="option"
					aria-selected={on}
					disabled={!on && full}
					onclick={() => choose(hit)}
				>
					<span class="source-row__mark">{#if on}<Check size={14} strokeWidth={2.25} />{:else}<Library size={14} strokeWidth={1.75} />{/if}</span>
					<span class="source-row__text">
						<span class="source-row__title">{hit.title}</span>
						{#if hit.snippet || hit.excerpt}<span class="source-row__excerpt">{hit.snippet || hit.excerpt}</span>{/if}
					</span>
					<span class="kind">{hit.card_type}</span>
				</button>
			{/each}
			{#if !hits.length && searched && outcome === 'ok' && !searching}
				<p class="empty">Nothing in your library matches “{query.trim()}”.</p>
			{:else if !hits.length && !searched}
				<p class="empty">Type to search the cards you have saved.</p>
			{/if}
		</div>

		<div class="foot">
			<span class="quiet">{workspace.sources.length} of 5 attached{full ? ' — the most one message carries' : ''}</span>
			<Button size="md" onclick={() => ui.close()}>Done</Button>
		</div>
	</div>
</Dialog>

<style>
	.sources {
		display: grid;
		gap: var(--space-3);
	}

	.lede {
		font-size: var(--text-sm);
		line-height: var(--leading-normal);
		color: var(--color-text-muted);
	}

	.field {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		height: var(--control-h-lg);
		padding-inline: var(--space-3);
		border: var(--border-width) solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.field:focus-within {
		border-color: var(--color-border-lit);
	}

	.field__icon {
		display: flex;
		color: var(--color-text-subtle);
	}

	.field input {
		flex: 1;
		height: 100%;
		padding: 0;
		background: none;
		border: 0;
		border-radius: 0;
		font-size: var(--text-base);
		color: var(--color-text-strong);
	}

	.field input:focus {
		border: 0;
		outline: none;
	}

	.field :global(.field__spin) {
		color: var(--color-text-subtle);
	}

	.diagnosis,
	.quiet {
		font-size: var(--text-xs);
		line-height: var(--leading-relaxed);
		color: var(--color-text-muted);
	}

	.diagnosis strong {
		font-weight: var(--weight-medium);
		color: var(--color-text-strong);
	}

	.quiet {
		color: var(--color-text-subtle);
	}

	.sources-results {
		display: grid;
		gap: var(--space-half);
		max-height: min(46vh, 22rem);
		overflow-y: auto;
		scrollbar-gutter: stable;
	}

	.source-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-3);
		border: var(--border-width) solid transparent;
		border-radius: var(--radius-md);
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.source-row:hover:not(:disabled) {
		background-color: var(--color-hover);
	}

	.source-row.is-chosen {
		border-color: var(--color-border-lit);
		background-color: var(--color-hover);
	}

	.source-row:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.source-row__mark {
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

	.source-row.is-chosen .source-row__mark {
		border-color: var(--color-border-lit);
		color: var(--color-text-strong);
	}

	.source-row__text {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: var(--space-half);
	}

	.source-row__title {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.source-row__excerpt {
		font-size: var(--text-xs);
		line-height: var(--leading-normal);
		color: var(--color-text-subtle);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.kind {
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

	.empty {
		padding: var(--space-6) var(--space-3);
		text-align: center;
		font-size: var(--text-sm);
		color: var(--color-text-subtle);
	}

	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding-top: var(--space-3);
		border-top: var(--border-width) solid var(--color-border);
	}
</style>
