<script lang="ts">
	import { Download, Ellipsis, PanelLeftOpen, Pencil, SlidersHorizontal, Trash2 } from '@lucide/svelte';
	import Dock from './Dock.svelte';
	import Menu, { type MenuEntry } from './Menu.svelte';
	import TabStrip from './TabStrip.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { prefs } from '$lib/state/prefs.svelte';

	/*
	 * The top bar — in the gutter above the plate, the way the site's header
	 * sits on the page: no field, just objects in a row. Its row begins where
	 * the plate does (--plate-x), so the open chats — bare labels beside the
	 * tile, always there — line up with the plate's left edge, and the
	 * conversation's "…" at the right with its right edge.
	 *
	 * In the dock layout the rail renders from here — out of the bar's flow
	 * on a desktop, where it stands down the page's left edge, and lying in
	 * the bar on a phone.
	 */

	let menuOpen = $state(false);
	const dock = $derived(prefs.layout === 'dock');

	const items = $derived.by<MenuEntry[]>(() => {
		const out: MenuEntry[] = [];
		if (workspace.current) {
			out.push({ id: 'rename', label: 'Rename', icon: Pencil, onselect: () => ui.renameConversation(workspace.current!) });
			out.push({ id: 'export', label: 'Export as JSON', icon: Download, onselect: () => workspace.exportConversation() });
		}
		if (workspace.project) out.push({ id: 'project', label: 'Project settings', icon: SlidersHorizontal, onselect: () => ui.editProject(workspace.project!.id) });
		if (workspace.current) {
			out.push({ id: 'sep', separator: true });
			out.push({ id: 'delete', label: 'Delete', icon: Trash2, danger: true, disabled: workspace.busy, onselect: () => ui.deleteConversation(workspace.current!) });
		}
		return out;
	});
</script>

<header class="topbar">
	{#if dock}
		<Dock />
	{:else}
		<button type="button" class="icon-button topbar__nav" aria-label="Open navigation" onclick={() => ui.openDrawer()}>
			<PanelLeftOpen size={18} strokeWidth={1.75} />
		</button>
	{/if}

	<div class="topbar__tabs"><TabStrip /></div>

	{#if workspace.current}<h1 class="sr-only">{workspace.current.title}</h1>{/if}

	<div class="topbar__trail">
		{#if workspace.current || workspace.project}
			<div class="topbar__menu">
				<button type="button" class="icon-button" aria-label="Conversation menu" aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
					<Ellipsis size={16} strokeWidth={1.75} />
				</button>
				{#if menuOpen}<Menu {items} label="Conversation menu" onclose={() => (menuOpen = false)} />{/if}
			</div>
		{/if}
	</div>
</header>

<style>
	.topbar {
		position: relative;
		z-index: var(--z-menu);
		display: flex;
		align-items: center;
		gap: var(--space-3);
		height: var(--topbar-h);
		min-width: 0;
		/* The plate's insets, so the row's ends meet the plate's edges. */
		padding-inline: var(--plate-x) var(--page-edge);
	}

	/* The strip takes what is left before the trail. */
	.topbar__tabs {
		display: flex;
		flex: 0 1 auto;
		min-width: 0;
	}

	.topbar__trail {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex: none;
		margin-left: auto;
	}

	.topbar__menu {
		position: relative;
	}

	/* The small control: the bar is the site's header height now, and a
	 * standard control would fill it edge to edge. */
	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h-sm);
		height: var(--control-h-sm);
		flex: none;
		border-radius: var(--radius-full);
		color: var(--color-text-subtle);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.icon-button:hover,
	.icon-button[aria-expanded='true'] {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	/* After .icon-button, which would otherwise win the display rule. */
	.topbar__nav {
		display: none;
	}

	@media (max-width: 47.5rem) {
		.topbar {
			gap: var(--space-2);
			padding-inline: var(--page-edge);
		}

		.topbar__nav {
			display: inline-flex;
			width: var(--control-h);
			height: var(--control-h);
			margin-left: calc(var(--space-1) * -1);
		}

		/* The open chats live in the Chats panel on a phone. */
		.topbar__tabs {
			display: none;
		}
	}
</style>
