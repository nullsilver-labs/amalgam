<script lang="ts">
	import { Ghost, Plus, X } from '@lucide/svelte';
	import { workspace } from '$lib/state/workspace.svelte';

	/*
	 * The tab strip — the open chats as a row of labels on the void, with
	 * nothing drawn around them: the bar is bare objects, like the rail. The
	 * current tab is lit the way the archive's current row is, strong text on
	 * a wash, and the wash travels to the pointer's tab and returns. One tab
	 * at least is always there, so the bar never changes shape and the "+" is
	 * always at hand.
	 *
	 * A slab around the tabs was tried three ways — a dark pill, a dark
	 * plate, the site's silver navbar — and each read as a box floating over
	 * the plate. The container was the problem, so there is none.
	 */

	let itemsEl = $state<HTMLElement | null>(null);
	let itemEls = $state<(HTMLButtonElement | null)[]>([]);
	let hovered = $state<number | null>(null);

	let canHover = $state(false);
	$effect(() => {
		const hover = window.matchMedia('(hover: hover)');
		const update = () => { canHover = hover.matches; };
		update();
		hover.addEventListener('change', update);
		return () => hover.removeEventListener('change', update);
	});

	function enter(i: number) { if (canHover) hovered = i; }
	function focus(event: FocusEvent, i: number) { if ((event.target as HTMLElement).matches(':focus-visible')) hovered = i; }

	const litIndex = $derived(hovered ?? workspace.activeIndex);

	/* A lone blank tab has nothing to close: closing it would leave the same
	 * blank tab. Closing the last chat leaves one — and so does closing a lone
	 * ghost tab, which is how a ghost stops being one. */
	const lone = $derived(workspace.sessions.length === 1 && workspace.active.fresh && !workspace.active.ghost);

	/** The lit tab's extent along the row, and the row's own length. */
	let pill = $state<{ start: number; size: number } | null>(null);
	let length = $state(0);
	let jump = $state(false);

	function measure() {
		if (!itemsEl) return;
		const el = itemEls[litIndex];
		if (!el) { pill = null; return; }
		const tab = el.parentElement as HTMLElement;
		pill = { start: tab.offsetLeft, size: tab.offsetWidth };
		length = itemsEl.offsetWidth;
	}

	let wasLit = false;
	$effect(() => {
		const lit = litIndex >= 0;
		jump = lit && !wasLit;
		wasLit = lit;
		workspace.sessions.length;
		for (const s of workspace.sessions) { s.title; s.busy; s.ghost; }
		lone;
		measure();
	});

	$effect(() => {
		if (!itemsEl) return;
		const ro = new ResizeObserver(measure);
		ro.observe(itemsEl);
		return () => ro.disconnect();
	});

	/* The wash is one panel behind the row, clipped to the lit tab; only the
	 * clip animates, so no layout runs while it travels. */
	const clipPath = $derived.by(() => {
		if (!pill) return 'inset(0 100% 0 0 round var(--radius-md))';
		const far = Math.max(0, length - pill.start - pill.size);
		return `inset(0 ${far}px 0 ${pill.start}px round var(--radius-md))`;
	});

	/* Arrows move between tabs; Enter or a click chooses one. */
	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		const i = itemEls.findIndex(el => el === document.activeElement);
		if (i < 0) return;
		event.preventDefault();
		const next = (i + (event.key === 'ArrowRight' ? 1 : -1) + itemEls.length) % itemEls.length;
		itemEls[next]?.focus();
	}

	/* A middle click closes, as it does in a browser. */
	function onauxclick(event: MouseEvent, key: string) {
		if (event.button === 1) { event.preventDefault(); workspace.closeTab(key); }
	}

	/* Keep the active tab in view when the row overflows. */
	$effect(() => {
		const el = itemEls[workspace.activeIndex];
		el?.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	});
</script>

<div class="tabs" role="tablist" aria-label="Open chats">
	<div class="tabs__row" role="presentation" onmouseleave={() => (hovered = null)} onfocusout={() => (hovered = null)}>
		<div class="tabs__items" bind:this={itemsEl}>
			<div class="tabs__wash" class:is-out={litIndex < 0} class:is-jump={jump} style:clip-path={clipPath} style:opacity={litIndex >= 0 ? 1 : 0} aria-hidden="true"></div>
			{#each workspace.sessions as s, i (s.key)}
				<div class="tab" class:is-hot={litIndex === i}>
					<button
						type="button"
						role="tab"
						bind:this={itemEls[i]}
						class="tab__button"
						aria-selected={s.key === workspace.activeKey}
						tabindex={s.key === workspace.activeKey ? 0 : -1}
						title={s.title}
						onclick={() => void workspace.activate(s.key)}
						onauxclick={(e) => onauxclick(e, s.key)}
						{onkeydown}
						onmouseenter={() => enter(i)}
						onfocus={(e) => focus(e, i)}
					>
						{#if s.busy}<span class="tab__dot" aria-hidden="true"></span>{/if}
						{#if s.ghost}<span class="tab__ghost" title="Ghost chat"><Ghost size={12} strokeWidth={1.75} /><span class="sr-only">Ghost chat</span></span>{/if}
						<span class="tab__label">{s.title}</span>
					</button>
					{#if !lone}
						<button type="button" class="tab__close" aria-label="Close {s.title}" title="Close" tabindex="-1" onclick={() => workspace.closeTab(s.key)} onmouseenter={() => enter(i)}>
							<X size={12} strokeWidth={2} />
						</button>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<button type="button" class="tabs__new" aria-label="New tab" title="New tab" onclick={() => void workspace.newTab()}>
		<Plus size={16} strokeWidth={1.75} />
	</button>
</div>

<style>
	/* Small controls in a row, nothing around them. */
	.tabs {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		height: var(--control-h-sm);
		min-width: 0;
	}

	/* The row scrolls when the tabs outgrow it, with no bar to show for it. */
	.tabs__row {
		min-width: 0;
		height: 100%;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
	}

	.tabs__row::-webkit-scrollbar {
		display: none;
	}

	/* As wide as its tabs: past the row's width they scroll, not shrink. */
	.tabs__items {
		position: relative;
		display: flex;
		gap: var(--space-1);
		width: max-content;
		height: 100%;
	}

	.tab {
		position: relative;
		display: flex;
		align-items: stretch;
		flex: none;
		max-width: 12rem;
	}

	/* A row's label, at the archive's size. Room at the end for the close
	 * mark, always, so a title never shifts. */
	.tab__button {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-width: 0;
		padding-inline: var(--space-3) var(--space-8);
		border-radius: var(--radius-md);
		color: var(--color-text-muted);
		font-size: var(--text-ui);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		white-space: nowrap;
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-out);
	}

	.tab.is-hot .tab__button {
		color: var(--color-text-strong);
	}

	.tab__button:focus-visible {
		outline-color: var(--color-focus);
		outline-offset: -2px;
	}

	.tab__label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* A ghost chat: its mark before the title, in the label's colour. */
	.tab__ghost {
		display: inline-flex;
		flex: none;
	}

	/* A response being written: a quiet pulse before the title. */
	.tab__dot {
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

	/* The close mark, in the room the label reserved; shown on the lit tab. */
	.tab__close {
		position: absolute;
		top: 0;
		bottom: 0;
		right: var(--space-1);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--space-6);
		height: var(--space-6);
		margin-block: auto;
		border-radius: var(--radius-sm);
		color: var(--color-text-subtle);
		opacity: 0;
		cursor: pointer;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.tab.is-hot .tab__close {
		opacity: 1;
	}

	.tab__close:hover {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	/* The wash behind the lit tab: the archive's lit row, travelling. */
	.tabs__wash {
		position: absolute;
		inset: 0;
		background-color: var(--color-hover);
		border-radius: var(--radius-md);
		pointer-events: none;
		transition: clip-path var(--void-in) var(--ease-out);
	}

	.tabs__wash.is-jump {
		transition: opacity var(--void-in) var(--ease-out);
	}

	.tabs__wash.is-out {
		transition:
			clip-path var(--void-in) var(--ease-out),
			opacity var(--void-out) var(--ease-out);
	}

	/* New tab: a plain small control at the end of the row. */
	.tabs__new {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: var(--control-h-sm);
		height: var(--control-h-sm);
		border-radius: var(--radius-md);
		color: var(--color-text-subtle);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	@media (hover: hover) {
		.tabs__new:hover {
			color: var(--color-text-strong);
			background-color: var(--color-hover);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tabs__wash {
			transition: none;
		}

		.tab__dot {
			animation: none;
			opacity: 0.7;
		}
	}
</style>
