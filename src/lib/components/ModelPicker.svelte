<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import Menu from './Menu.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { modelEntries } from '$lib/model-entries';

	/*
	 * The model picker — a quiet pill in the composer's bottom row that opens
	 * a listbox of every model the server has approved, grouped by provider,
	 * each with the host it will be sent to and its declared window, if any.
	 */

	let open = $state(false);

	const entries = $derived(modelEntries(workspace.data.models, workspace.model, id => workspace.chooseModel(id)));
</script>

<div class="picker">
	<button
		type="button"
		class="picker__button"
		role="combobox"
		aria-label="Model"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls="model-listbox"
		disabled={workspace.busy || workspace.loading || !workspace.data.models.length}
		onclick={() => (open = !open)}
	>
		<span class="picker__name">{workspace.selectedModel ? workspace.selectedModel.name : workspace.model ? `${workspace.model} (unavailable)` : 'No model connected'}</span>
		<ChevronDown size={13} strokeWidth={2} />
	</button>
	{#if open}
		<Menu id="model-listbox" items={entries} role="listbox" label="Models" align="start" above wide searchable={workspace.data.models.length > 6} searchPlaceholder="Filter models" onclose={() => (open = false)} />
	{/if}
</div>

<style>
	.picker {
		position: relative;
		min-width: 0;
	}

	/* No max-width here: it would cap the button to its wrapper rather than
	 * its own label. The wrapper's min-width: 0 is what lets the row shrink. */
	.picker__button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		height: var(--control-h-sm);
		padding-inline: var(--space-2);
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.picker__button:hover:not(:disabled),
	.picker__button[aria-expanded='true'] {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	.picker__button:disabled {
		cursor: default;
		color: var(--color-text-subtle);
	}

	.picker__name {
		min-width: 0;
		max-width: 14rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
