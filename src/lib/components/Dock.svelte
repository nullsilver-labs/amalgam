<script lang="ts">
	import { MessagesSquare, Search, Settings, SquarePen } from '@lucide/svelte';
	import ChatsPanel from './ChatsPanel.svelte';
	import Logo from './Logo.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { APP_NAME } from '$lib/config';

	/*
	 * The rail — the strip down the left edge that the plate keeps clear
	 * of, and what stands in it: the brand tile at the top, the three items
	 * you reach for at the middle of the page, settings at the foot.
	 * Objects on the void with no field behind them, the way the site's
	 * header is a tile and a slab sitting on the page. On a phone the rail
	 * lies down in the top bar.
	 *
	 * The void, as the site's navbar does it: a silver panel carries dark
	 * copies of the primary items, and a clip reveals only the lit item's
	 * portion — a silver disc that travels. The clip is the only thing that
	 * animates.
	 */

	const primary = [
		{ id: 'new', label: 'New chat', icon: SquarePen, run: () => { workspace.newChat(workspace.projectId); ui.settle(); } },
		{ id: 'search', label: 'Search conversations', icon: Search, run: () => ui.open('search') },
		{ id: 'chats', label: 'Chats', icon: MessagesSquare, run: () => ui.togglePanel() }
	];
	const CHATS = 2;

	/* Search waits for the archive. */
	const disabled = $derived(primary.map(item => item.id === 'search' && !workspace.ready));

	let primaryEl = $state<HTMLElement | null>(null);
	let itemEls = $state<(HTMLButtonElement | null)[]>([]);
	let hovered = $state<number | null>(null);

	/* Hover only lights the void where hovering is a thing; keyboard focus
	 * counts, a tap does not. The rail lies down on a phone. */
	let canHover = $state(false);
	let vertical = $state(true);
	$effect(() => {
		const hover = window.matchMedia('(hover: hover)');
		const narrow = window.matchMedia('(max-width: 47.5rem)');
		const update = () => { canHover = hover.matches; vertical = !narrow.matches; };
		update();
		hover.addEventListener('change', update);
		narrow.addEventListener('change', update);
		return () => { hover.removeEventListener('change', update); narrow.removeEventListener('change', update); };
	});

	/* Whether the pointer is over the group at all: a click hands focus to the
	 * composer, and losing focus must not unlight an item the pointer is still on. */
	let pointerOver = false;
	function enter(i: number) { if (canHover && !disabled[i]) hovered = i; }
	function focus(event: FocusEvent, i: number) { if ((event.target as HTMLElement).matches(':focus-visible')) hovered = i; }

	/* An item is current while the surface it opens is out: Chats with its
	 * panel, Search with its palette. A blank page lights nothing — New chat
	 * is a thing to do, not a place to be — and nor does reading a chat,
	 * until the pointer does. */
	const SEARCH = 1;
	const activeIndex = $derived(ui.panel ? CHATS : ui.modal === 'search' ? SEARCH : -1);
	const litIndex = $derived(hovered ?? (activeIndex >= 0 ? activeIndex : null));
	const shown = $derived(litIndex !== null);

	/** The lit item's extent along the rail's axis, and the group's own length. */
	let pill = $state<{ start: number; size: number } | null>(null);
	let length = $state(0);
	let jump = $state(false);

	function measure() {
		if (litIndex === null || !primaryEl) return;
		const el = itemEls[litIndex];
		if (!el) return;
		pill = vertical ? { start: el.offsetTop, size: el.offsetHeight } : { start: el.offsetLeft, size: el.offsetWidth };
		length = vertical ? primaryEl.offsetHeight : primaryEl.offsetWidth;
	}

	let wasLit = false;
	$effect(() => {
		const lit = litIndex !== null;
		jump = lit && !wasLit;
		wasLit = lit;
		vertical;
		measure();
	});

	$effect(() => {
		if (!primaryEl) return;
		const ro = new ResizeObserver(measure);
		ro.observe(primaryEl);
		return () => ro.disconnect();
	});

	const clipPath = $derived.by(() => {
		if (!pill) return vertical ? 'inset(0 0 100% 0 round var(--radius-full))' : 'inset(0 100% 0 0 round var(--radius-full))';
		const far = Math.max(0, length - pill.start - pill.size);
		return vertical
			? `inset(${pill.start}px 0 ${far}px 0 round var(--radius-full))`
			: `inset(0 ${far}px 0 ${pill.start}px round var(--radius-full))`;
	});
</script>

<nav class="rail" aria-label="Navigation">
	<!-- The brand: the tile alone, at the head of the rail. The name lives in
	     the browser tab; the tile is a link home, as the site's is. -->
	<a href="/" class="rail__brand" aria-label="{APP_NAME} — home" onclick={(event) => { event.preventDefault(); workspace.newChat(); ui.settle(); }}>
		<Logo label="" />
	</a>

	<div class="rail__primary" role="group" bind:this={primaryEl} onmouseenter={() => (pointerOver = true)} onmouseleave={() => { pointerOver = false; hovered = null; }} onfocusout={() => { if (!pointerOver) hovered = null; }}>
		<div class="rail__items">
			{#each primary as item, i (item.id)}
				<button
					type="button"
					bind:this={itemEls[i]}
					class="rail__item"
					aria-label={item.label}
					title={item.label}
					aria-expanded={item.id === 'chats' ? ui.panel : undefined}
					disabled={disabled[i]}
					onclick={item.run}
					onmouseenter={() => enter(i)}
					onfocus={(e) => focus(e, i)}
				>
					<item.icon size={18} strokeWidth={1.75} />
				</button>
			{/each}
		</div>

		<!-- The void: a silver panel carrying dark copies of the items. -->
		<div class="rail__void" class:is-out={!shown} class:is-jump={jump} style:clip-path={clipPath} style:opacity={shown ? 1 : 0} aria-hidden="true">
			<div class="rail__items rail__items--lit">
				{#each primary as item (item.id)}
					<span class="rail__item"><item.icon size={18} strokeWidth={1.75} /></span>
				{/each}
			</div>
		</div>
	</div>

	<div class="rail__secondary">
		<button type="button" class="rail__item rail__item--plain" aria-label="Settings" title="Settings" onclick={() => ui.open('settings')}>
			<Settings size={18} strokeWidth={1.75} />
		</button>
	</div>

	{#if ui.panel}<ChatsPanel anchor={itemEls[CHATS] ?? null} />{/if}
</nav>

<style>
	/* The rail spans the page's height: the tile at its head in the top
	 * bar's row, the primary items at the exact middle of the page, settings
	 * at its foot with the plate's own inset beneath. Everything centred on
	 * one column. */
	.rail {
		position: fixed;
		inset: 0 auto 0 0;
		z-index: var(--z-menu);
		display: grid;
		grid-template-rows: 1fr auto 1fr;
		justify-items: center;
		width: var(--rail-w);
	}

	.rail__brand {
		display: flex;
		align-items: center;
		align-self: start;
		height: var(--topbar-h);
		line-height: 0;
	}

	.rail__primary {
		position: relative;
		display: flex;
	}

	.rail__items,
	.rail__secondary {
		display: flex;
		flex-direction: column;
		gap: var(--space-half);
	}

	.rail__secondary {
		align-self: end;
		padding-bottom: var(--page-edge);
	}

	/* A standard control, round like every icon button in the app. */
	.rail__item {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h);
		height: var(--control-h);
		border-radius: var(--radius-full);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.rail__item:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.rail__item:focus-visible {
		outline-color: var(--color-focus);
		outline-offset: -2px;
	}

	.rail__void {
		position: absolute;
		inset: 0;
		background-color: var(--color-accent);
		border-radius: var(--radius-full);
		pointer-events: none;
		user-select: none;
		transition: clip-path var(--void-in) var(--ease-out);
	}

	/* Appearing from nothing: no travel, only the fade. */
	.rail__void.is-jump {
		transition: opacity var(--void-in) var(--ease-out);
	}

	/* Leaves more slowly than it arrives. */
	.rail__void.is-out {
		transition:
			clip-path var(--void-in) var(--ease-out),
			opacity var(--void-out) var(--ease-out);
	}

	.rail__items--lit .rail__item {
		color: var(--color-on-accent);
	}

	.rail__item--plain {
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	@media (hover: hover) {
		.rail__item--plain:hover:not(:disabled) {
			color: var(--color-text);
			background-color: var(--color-hover);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rail__void {
			transition: none;
		}
	}

	/* On a phone the rail lies down in the top bar: tile, then the items in
	 * a row. */
	@media (max-width: 47.5rem) {
		.rail {
			position: static;
			display: flex;
			align-items: center;
			gap: var(--space-1);
			width: auto;
			flex: none;
		}

		.rail__brand {
			height: auto;
			margin-right: var(--space-1);
		}

		.rail__items,
		.rail__secondary {
			flex-direction: row;
		}

		.rail__secondary {
			padding-bottom: 0;
		}
	}
</style>
