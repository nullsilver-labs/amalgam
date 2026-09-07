<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import Menu, { type MenuEntry } from './Menu.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { formatTokens } from '$lib/format';

	/*
	 * The model picker — a quiet pill in the composer's bottom row that opens
	 * a listbox of every model the server has approved, grouped by provider,
	 * each with the host it will be sent to and its declared window, if any.
	 */

	let open = $state(false);

	const entries = $derived.by<MenuEntry[]>(() => {
		const out: MenuEntry[] = [];
		let provider = '';
		for (const m of workspace.data.models) {
			if (m.provider !== provider) { provider = m.provider; out.push({ id: `head:${provider}`, heading: provider }); }
			out.push({ id: m.id, label: m.name, hint: m.window ? `${m.destination} · ${formatTokens(m.window)}` : m.destination, selected: m.id === workspace.model, onselect: () => workspace.chooseModel(m.id) });
		}
		return out;
	});
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
		disabled={workspace.busy || !workspace.data.models.length}
		onclick={() => (open = !open)}
	>
		<span class="picker__name">{workspace.selectedModel ? workspace.selectedModel.name : 'No model connected'}</span>
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

	/* No max-width here: with the negative margin below it would cap the
	 * button to a wrapper 4px narrower than its own label. The wrapper's
	 * min-width: 0 is what lets the row shrink. */
	.picker__button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		height: var(--control-h-sm);
		padding-inline: var(--space-2);
		margin-left: calc(var(--space-1) * -1);
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
