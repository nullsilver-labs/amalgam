<script lang="ts">
	import { Folder, LoaderCircle, MessageSquare, Search } from '@lucide/svelte';
	import Dialog from './Dialog.svelte';
	import { workspace, messageOf } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { groupByDate } from '$lib/format';
	import type { Conversation } from '$lib/types';

	/*
	 * ⌘K — find a conversation. With no query it lists the recent ones by
	 * date; with one it searches every title and message on the server.
	 * Arrows move, Enter opens, Escape closes.
	 */

	let query = $state('');
	let results = $state<Conversation[]>(workspace.data.conversations);
	let searching = $state(false);
	let active = $state(0);
	let error = $state('');
	let field = $state<HTMLInputElement | null>(null);
	let version = 0;

	const groups = $derived(query.trim() ? [{ label: 'Results', items: results }] : groupByDate(results));
	const flat = $derived(groups.flatMap(g => g.items));

	function projectName(c: Conversation) {
		return workspace.data.projects.find(p => p.id === c.project_id)?.name ?? '';
	}

	$effect(() => {
		const q = query.trim();
		const mine = ++version;
		if (!q) { results = workspace.data.conversations; searching = false; active = 0; return; }
		searching = true;
		const timer = setTimeout(async () => {
			try {
				const found = await workspace.search(q);
				if (mine === version) { results = found; active = 0; error = ''; }
			} catch (err) { if (mine === version) error = messageOf(err); }
			finally { if (mine === version) searching = false; }
		}, 150);
		return () => clearTimeout(timer);
	});

	$effect(() => { field?.focus(); });

	function choose(c: Conversation | undefined) {
		if (!c) return;
		ui.close();
		void workspace.open(c.id);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') { event.preventDefault(); active = Math.min(active + 1, flat.length - 1); }
		else if (event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(active - 1, 0); }
		else if (event.key === 'Enter') { event.preventDefault(); choose(flat[active]); }
	}
</script>

<Dialog palette onclose={() => ui.close()}>
	<div class="field">
		<span class="field__icon"><Search size={17} strokeWidth={1.75} /></span>
		<input
			bind:this={field}
			bind:value={query}
			type="text"
			aria-label="Search conversation history"
			placeholder="Search conversations"
			autocomplete="off"
			{onkeydown}
		/>
		{#if searching}<LoaderCircle size={15} class="spin field__spin" />{:else}<kbd class="field__kbd">esc</kbd>{/if}
	</div>

	<div class="search-results" role="listbox" aria-label="Conversations">
		{#if error}<p class="empty">{error}</p>{/if}
		{#each groups as group (group.label)}
			{#if group.items.length}
				<div class="heading" role="presentation">{group.label}</div>
				{#each group.items as c (c.id)}
					{@const index = flat.indexOf(c)}
					<button
						type="button"
						class="result"
						class:is-active={index === active}
						role="option"
						aria-selected={index === active}
						onmouseenter={() => (active = index)}
						onclick={() => choose(c)}
					>
						<span class="result__icon"><MessageSquare size={15} strokeWidth={1.75} /></span>
						<span class="result__title">{c.title}</span>
						{#if projectName(c)}<span class="result__project"><Folder size={11} strokeWidth={1.75} />{projectName(c)}</span>{/if}
					</button>
				{/each}
			{/if}
		{/each}
		{#if !flat.length && !searching && !error}
			<p class="empty">{query.trim() ? `No conversations match “${query.trim()}”.` : 'No conversations yet.'}</p>
		{/if}
	</div>
</Dialog>

<style>
	.field {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		height: var(--control-h-lg);
		padding-inline: var(--space-4);
		border-bottom: var(--border-width) solid var(--color-border);
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
	}

	.field :global(.field__spin) {
		color: var(--color-text-subtle);
	}

	.field__kbd {
		color: var(--color-text-faint);
	}

	.search-results {
		max-height: min(50vh, 26rem);
		overflow-y: auto;
		padding: var(--space-1);
	}

	.heading {
		padding: var(--space-2) var(--space-3) var(--space-1);
		font-size: var(--text-2xs);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-wide);
		color: var(--color-text-subtle);
	}

	.result {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		height: var(--control-h);
		padding-inline: var(--space-3);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		color: var(--color-text);
		cursor: pointer;
	}

	.result.is-active {
		background-color: var(--color-hover);
		color: var(--color-text-strong);
	}

	.result__icon {
		display: flex;
		flex: none;
		color: var(--color-text-subtle);
	}

	.result__title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.result__project {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		flex: none;
		max-width: 10rem;
		font-size: var(--text-2xs);
		color: var(--color-text-subtle);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.empty {
		padding: var(--space-6) var(--space-4);
		text-align: center;
		font-size: var(--text-sm);
		color: var(--color-text-subtle);
	}
</style>
