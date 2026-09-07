<script lang="ts">
	import { Ellipsis, Folder, Ghost, PanelTop, Pencil, Plus, SlidersHorizontal, SquarePen, Trash2, X } from '@lucide/svelte';
	import Menu, { type MenuEntry } from './Menu.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { groupByDate } from '$lib/format';
	import type { Conversation, Project } from '$lib/types';

	/*
	 * The archive: projects, then every conversation grouped by when it last
	 * moved. One list, two homes — the pinned sidebar and the dock's Chats
	 * panel. Rows are --radius-md, the inner step of whichever plate holds
	 * them; each row's "…" opens the same menu in either.
	 *
	 * A row opens in the active tab; ⌘-click, a middle click or the menu
	 * open it in a tab of its own. On a phone, where the bar has no room for
	 * a strip, the open chats head the list.
	 */

	const groups = $derived(groupByDate(workspace.visibleConversations));

	/** Which row's menu is open, if any. */
	let menuFor = $state<string | null>(null);

	function conversationMenu(c: Conversation): MenuEntry[] {
		return [
			{ id: 'tab', label: 'Open in new tab', icon: PanelTop, onselect: () => { void workspace.openTab(c.id); ui.settle(); } },
			{ id: 'rename', label: 'Rename', icon: Pencil, onselect: () => ui.renameConversation(c) },
			{ id: 'delete', label: 'Delete', icon: Trash2, danger: true, onselect: () => ui.deleteConversation(c) }
		];
	}

	function openRow(event: MouseEvent, c: Conversation) {
		if (event.metaKey || event.ctrlKey) { void workspace.openTab(c.id, { activate: false }); return; }
		void workspace.open(c.id);
		ui.settle();
	}

	function auxRow(event: MouseEvent, c: Conversation) {
		if (event.button === 1) { event.preventDefault(); void workspace.openTab(c.id, { activate: false }); }
	}

	function projectMenu(p: Project): MenuEntry[] {
		return [
			{ id: 'new', label: 'New chat in project', icon: SquarePen, onselect: () => { workspace.newChat(p.id); ui.settle(); } },
			{ id: 'settings', label: 'Project settings', icon: SlidersHorizontal, onselect: () => ui.editProject(p.id) }
		];
	}
</script>

<div class="list">
	{#if workspace.sessions.length > 1}
		<section class="group group--open" aria-label="Open chats">
			<header class="group__head"><span>Open</span></header>
			{#each workspace.sessions as s (s.key)}
				<div class="rowwrap">
					<button type="button" class="row" class:is-active={s.key === workspace.activeKey} onclick={() => { void workspace.activate(s.key); ui.settle(); }}>
						{#if s.busy}<span class="row__dot" aria-hidden="true"></span>{/if}
						{#if s.ghost}<span class="row__icon" title="Ghost chat"><Ghost size={16} strokeWidth={1.75} /><span class="sr-only">Ghost chat</span></span>{/if}
						<span class="row__label">{s.title}</span>
					</button>
					<button type="button" class="row__more" aria-label="Close {s.title}" title="Close" onclick={() => workspace.closeTab(s.key)}>
						<X size={15} />
					</button>
				</div>
			{/each}
		</section>
	{/if}

	<section class="group">
		<header class="group__head">
			<span>Projects</span>
			<button type="button" class="group__add" aria-label="New project" title="New project" onclick={() => ui.editProject(null)} disabled={!workspace.ready}>
				<Plus size={14} strokeWidth={2} />
			</button>
		</header>
		{#each workspace.data.projects as p (p.id)}
			<div class="rowwrap" class:is-menu-open={menuFor === p.id}>
				<button type="button" class="row" class:is-active={workspace.projectId === p.id} onclick={() => { workspace.newChat(p.id); ui.settle(); }}>
					<span class="row__icon"><Folder size={16} strokeWidth={1.75} /></span>
					<span class="row__label">{p.name}</span>
				</button>
				<button type="button" class="row__more" aria-label="Project options" aria-haspopup="menu" aria-expanded={menuFor === p.id} onclick={() => (menuFor = menuFor === p.id ? null : p.id)}>
					<Ellipsis size={15} />
				</button>
				{#if menuFor === p.id}<Menu items={projectMenu(p)} label="Project options" onclose={() => (menuFor = null)} />{/if}
			</div>
		{:else}
			<button type="button" class="row row--quiet" onclick={() => ui.editProject(null)} disabled={!workspace.ready}>
				<span class="row__icon"><Plus size={16} strokeWidth={1.75} /></span>
				<span class="row__label">Start a project</span>
			</button>
		{/each}
	</section>

	{#if workspace.project}
		<header class="group__head group__head--scope">
			<span class="group__scope">{workspace.project.name}</span>
			<button type="button" class="group__link" onclick={() => workspace.newChat()}>All chats</button>
		</header>
	{/if}
	{#each groups as group (group.label)}
		<section class="group">
			{#if !workspace.project}<header class="group__head"><span>{group.label}</span></header>{/if}
			{#each group.items as c (c.id)}
				<div class="rowwrap" class:is-menu-open={menuFor === c.id}>
					<button type="button" class="row" class:is-active={workspace.current?.id === c.id} class:is-open={workspace.openIds.has(c.id)} onclick={(e) => openRow(e, c)} onauxclick={(e) => auxRow(e, c)}>
						<span class="row__label">{c.title}</span>
					</button>
					<button type="button" class="row__more" aria-label="Conversation options" aria-haspopup="menu" aria-expanded={menuFor === c.id} onclick={() => (menuFor = menuFor === c.id ? null : c.id)}>
						<Ellipsis size={15} />
					</button>
					{#if menuFor === c.id}<Menu items={conversationMenu(c)} label="Conversation options" onclose={() => (menuFor = null)} />{/if}
				</div>
			{/each}
		</section>
	{/each}
	{#if !workspace.visibleConversations.length}
		<p class="empty">{workspace.ready ? (workspace.project ? 'No chats in this project yet.' : 'Your conversations will appear here.') : 'Opening your workspace…'}</p>
	{/if}
</div>

<style>
	.list {
		display: grid;
		/* minmax(0, …), not auto: a long title must shrink to the column and
		 * ellipsise, not widen it. */
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		gap: var(--space-4);
	}

	.group__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		height: var(--control-h-sm);
		padding-inline: var(--space-2);
		font-size: var(--text-2xs);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-wide);
		color: var(--color-text-subtle);
	}

	.group__head--scope {
		margin-bottom: calc(var(--space-4) * -1 + var(--space-half));
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}

	.group__scope {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.group__link {
		flex: none;
		font-size: var(--text-2xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-subtle);
		cursor: pointer;
	}

	.group__link:hover {
		color: var(--color-text-strong);
	}

	/* The same box as a row's "…", pulled out of the head's text inset so the
	 * two stack on one vertical line. */
	.group__add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h-sm);
		height: var(--control-h-sm);
		margin-inline-end: calc(var(--space-1) * -1);
		border-radius: var(--radius-sm);
		color: var(--color-text-subtle);
		cursor: pointer;
	}

	.group__add:hover {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	.rowwrap {
		position: relative;
		display: flex;
		align-items: center;
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

	.row:hover:not(:disabled),
	.rowwrap.is-menu-open .row,
	.row.is-active {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	/* Open in another tab: a step up from the rest, short of the lit row. */
	.row.is-open:not(.is-active) {
		color: var(--color-text);
	}

	.row--quiet {
		color: var(--color-text-subtle);
		font-weight: var(--weight-regular);
	}

	/* A response being written in that tab. */
	.row__dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		background-color: currentColor;
		animation: pulse 1.6s var(--ease-out) infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.35;
		}

		50% {
			opacity: 1;
		}
	}

	/* The open chats only head the list where the bar has no strip. */
	.group--open {
		display: none;
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
		/* Room for the "…" is always reserved, so a title never shifts on hover. */
		padding-right: var(--space-5);
	}

	/* The row's "…": hidden until the pointer is on the row, always there
	 * where there is no pointer to hover with. */
	.row__more {
		position: absolute;
		right: var(--space-1);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h-sm);
		height: var(--control-h-sm);
		border-radius: var(--radius-sm);
		color: var(--color-text-subtle);
		opacity: 0;
		cursor: pointer;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.rowwrap:hover .row__more,
	.rowwrap:focus-within .row__more,
	.rowwrap.is-menu-open .row__more {
		opacity: 1;
	}

	.row__more:hover {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	@media (hover: none) {
		.row__more {
			opacity: 1;
		}
	}

	@media (max-width: 47.5rem) {
		.group--open {
			display: block;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.row__dot {
			animation: none;
			opacity: 0.7;
		}
	}

	.empty {
		padding-inline: var(--space-2);
		font-size: var(--text-xs);
		line-height: var(--leading-relaxed);
		color: var(--color-text-subtle);
	}
</style>
