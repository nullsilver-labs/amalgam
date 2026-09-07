<script lang="ts">
	import { APP_NAME } from '$lib/config';
	import { PanelLeftClose, Search, Settings, SquarePen } from '@lucide/svelte';
	import ChatList from './ChatList.svelte';
	import Logo from './Logo.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { prefs } from '$lib/state/prefs.svelte';
	import { modifier } from '$lib/format';

	/*
	 * The pinned sidebar — the archive kept in view, for anyone who wants it
	 * there: a column of text on the void beside the plate, with no field of
	 * its own. Collapsing it hands navigation to the dock. On a phone it is
	 * a drawer over the page, and there it takes a surface.
	 */

	const mod = modifier();
</script>

<aside class="sidebar" class:is-open={ui.drawer} aria-label="Sidebar">
	<div class="sidebar__top">
		<a class="brand" href="/" onclick={(event) => { event.preventDefault(); workspace.newChat(); ui.settle(); }} aria-label={APP_NAME}>
			<span class="brand__tile"><Logo label="" /></span>
			<span class="brand__name">{APP_NAME}</span>
		</a>
		<button type="button" class="icon-button" aria-label="Collapse sidebar" title="Collapse sidebar" onclick={() => { prefs.setLayout('dock'); ui.settle(); }}>
			<PanelLeftClose size={16} strokeWidth={1.75} />
		</button>
	</div>

	<nav class="sidebar__actions" aria-label="Actions">
		<button type="button" class="row row--primary" onclick={() => { workspace.newChat(workspace.projectId); ui.settle(); }} title="New chat">
			<span class="row__icon"><SquarePen size={17} strokeWidth={1.75} /></span>
			<span class="row__label">New chat</span>
			<kbd class="row__kbd">{mod} ⇧ O</kbd>
		</button>
		<button type="button" class="row" onclick={() => ui.open('search')} disabled={!workspace.ready} title="Search conversations">
			<span class="row__icon"><Search size={17} strokeWidth={1.75} /></span>
			<span class="row__label">Search conversations</span>
			<kbd class="row__kbd">{mod} K</kbd>
		</button>
	</nav>

	<div class="sidebar__scroll">
		<ChatList />
	</div>

	<div class="sidebar__bottom">
		<button type="button" class="row" onclick={() => ui.open('settings')} title="Settings">
			<span class="row__icon"><Settings size={17} strokeWidth={1.75} /></span>
			<span class="row__label">Settings</span>
		</button>
	</div>
</aside>

<style>
	.sidebar {
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		overflow: hidden;
	}

	/* The collapse button is a small control at the page edge: the same box
	 * and inset as the Projects "+", so its mark stands on the vertical line
	 * the "+" and the rows' "…" keep. */
	.sidebar__top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		height: var(--topbar-h);
		padding-inline: var(--page-edge);
		flex: none;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: var(--control-h-sm);
		padding-inline: var(--space-1);
		margin-inline: calc(var(--space-1) * -1);
		border-radius: var(--radius-full);
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}

	.brand__tile {
		display: block;
		flex: none;
		line-height: 0;
	}

	.brand__name {
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text-strong);
		/* Optical: the tile's cap sits a hair above the x-height baseline. */
		transform: translateY(-1px);
		white-space: nowrap;
	}

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

	.icon-button:hover {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	.sidebar__actions,
	.sidebar__bottom {
		display: grid;
		gap: var(--space-half);
		padding-inline: var(--space-2);
		flex: none;
	}

	.sidebar__actions {
		padding-bottom: var(--space-4);
	}

	/* Settings at the foot, set apart by air alone — no rule. */
	.sidebar__bottom {
		padding-block: var(--space-2);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-width: 0;
		height: var(--control-h);
		padding-inline: var(--space-2);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		font-size: var(--text-ui);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.row:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.row:hover:not(:disabled) {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	.row--primary {
		color: var(--color-text);
	}

	.row__icon {
		display: flex;
		flex: none;
	}

	.row__label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row__kbd {
		color: var(--color-text-faint);
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease-out);
	}

	.row:hover .row__kbd {
		opacity: 1;
	}

	/* No reserved scrollbar gutter: the rows are left-aligned, so a scrollbar
	 * appearing shifts nothing, whereas a reserved gutter would keep an empty
	 * band down the right and hold the list's rows short of the action rows
	 * above them. */
	.sidebar__scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 var(--space-2) var(--space-4);
	}

	@media (max-width: 47.5rem) {
		.sidebar {
			position: fixed;
			inset: 0 auto 0 0;
			width: min(var(--sidebar-w), 85vw);
			z-index: var(--z-drawer);
			background-color: var(--color-surface);
			border-right: var(--border-width) solid var(--color-border);
			transform: translateX(-100%);
			transition: transform var(--duration-base) var(--ease-out);
			visibility: hidden;
		}

		.sidebar.is-open {
			transform: none;
			visibility: visible;
		}
	}
</style>
