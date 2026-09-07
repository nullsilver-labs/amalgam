<script lang="ts">
	import { onMount } from 'svelte';
	import { Folder } from '@lucide/svelte';
	import Composer from './Composer.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { greeting } from '$lib/format';

	/*
	 * The empty state — the composer in the middle of the page with a line
	 * above it, the way a new conversation opens everywhere else. Inside a
	 * project the line is the project's name, and what it carries.
	 */

	let hello = $state('');
	onMount(() => { hello = greeting(); });

	/* The pills are the instance's own — edited in Settings, Chat. */
	const suggestions = $derived(workspace.data.settings.suggestions);

	function suggest(text: string) {
		workspace.draft = text;
		workspace.rememberDraft();
		workspace.focusTick++;
	}
</script>

<section class="welcome">
	<div class="welcome__column">
		<header class="welcome__head">
			{#if workspace.project}
				<p class="welcome__eyebrow"><Folder size={13} strokeWidth={1.75} /> Project</p>
				<h1 class="welcome__title">{workspace.project.name}</h1>
				<p class="welcome__lede">
					{workspace.project.instructions ? 'Its instructions accompany every response here.' : 'No instructions yet — add some to give every chat here a shared starting point.'}
					<button type="button" class="welcome__edit" onclick={() => ui.editProject(workspace.project!.id)}>Edit</button>
				</p>
			{:else}
				<p class="welcome__eyebrow">{hello}</p>
				<h1 class="welcome__title">Where shall we begin?</h1>
			{/if}
		</header>

		<Composer />

		{#if !workspace.project && suggestions.length}
			<div class="welcome__chips" aria-label="Suggestions">
				{#each suggestions as s, i (i)}
					<button type="button" class="chip" onclick={() => suggest(s.text)} disabled={!workspace.ready}>{s.label}</button>
				{/each}
			</div>
		{/if}
	</div>
</section>

<style>
	.welcome {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		overflow-y: auto;
		scrollbar-gutter: stable both-edges;
		padding-block: var(--space-8) var(--space-12);
	}

	.welcome__column {
		display: grid;
		gap: var(--space-6);
		width: min(var(--chat-measure), 100% - var(--space-8));
		margin-inline: auto;
		/* Sits a little above true centre — the eye reads that as centred. */
		margin-bottom: 6vh;
	}

	.welcome__head {
		display: grid;
		gap: var(--space-2);
		justify-items: center;
		text-align: center;
	}

	.welcome__eyebrow {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 1.25rem;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text-subtle);
	}

	.welcome__title {
		font-size: var(--text-display-md);
		font-weight: var(--weight-light);
		letter-spacing: var(--tracking-tighter);
		line-height: var(--leading-snug);
		color: var(--color-text-strong);
	}

	.welcome__lede {
		max-width: 36rem;
		font-size: var(--text-sm);
		line-height: var(--leading-relaxed);
		color: var(--color-text-muted);
	}

	.welcome__edit {
		margin-left: var(--space-1);
		color: var(--color-text);
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}

	.welcome__edit:hover {
		color: var(--color-text-strong);
	}

	.welcome__chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		height: var(--control-h-sm);
		padding-inline: var(--space-4);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.chip:hover:not(:disabled) {
		color: var(--color-text-strong);
		border-color: var(--color-border-lit);
		background-color: var(--color-hover);
	}

	.chip:disabled {
		opacity: 0.5;
		cursor: default;
	}

	@media (max-width: 47.5rem) {
		.welcome {
			justify-content: flex-start;
			padding-top: 10vh;
		}

		.welcome__column {
			width: calc(100% - var(--page-edge) * 2);
			margin-bottom: 0;
		}

		.chip {
			font-size: var(--text-2xs);
		}
	}
</style>
