<script lang="ts" module>
	import type { Component } from 'svelte';

	export type MenuEntry =
		| {
				id: string;
				label: string;
				icon?: Component<{ size?: number | string; strokeWidth?: number | string }>;
				/** A second line under the label — a host, a shortcut, a status. */
				hint?: string;
				/** Rendered at the far end, in mono. */
				kbd?: string;
				danger?: boolean;
				disabled?: boolean;
				/** For listboxes: the current choice. */
				selected?: boolean;
				onselect: () => void;
		  }
		| { id: string; heading: string }
		| { id: string; separator: true };
</script>

<script lang="ts">
	import { Check, Search } from '@lucide/svelte';

	/*
	 * Menu — a small floating plate of rows, anchored to its positioned
	 * parent. `align` picks the edge; `above` opens it upward. The plate is
	 * --radius-lg with --space-1 padding, so its rows sit at --radius-md and
	 * the corners stay concentric.
	 *
	 * Keyboard: focus lands on the first row on open; arrows move, Enter
	 * chooses, Escape and Tab close. Closes on outside click. `role` picks
	 * between a menu of actions and a listbox of choices.
	 */

	type Props = {
		items: MenuEntry[];
		align?: 'start' | 'end';
		above?: boolean;
		role?: 'menu' | 'listbox';
		label?: string;
		/** Wider than the default plate — the model list carries hints. */
		wide?: boolean;
		/** A filter field at the top: for a list long enough to need one. */
		searchable?: boolean;
		searchPlaceholder?: string;
		id?: string;
		onclose: () => void;
	};

	let { items, align = 'end', above = false, role = 'menu', label = 'Menu', wide = false, searchable = false, searchPlaceholder = 'Filter', id, onclose }: Props = $props();

	let query = $state('');
	let field = $state<HTMLInputElement | null>(null);

	/* Headings survive only if something under them matched. */
	const visible = $derived.by<MenuEntry[]>(() => {
		const q = query.trim().toLowerCase();
		if (!q) return items;
		const out: MenuEntry[] = [];
		let heading: MenuEntry | null = null;
		for (const item of items) {
			if ('heading' in item) { heading = item; continue; }
			if ('separator' in item) continue;
			if (item.label.toLowerCase().includes(q) || item.hint?.toLowerCase().includes(q)) {
				if (heading) { out.push(heading); heading = null; }
				out.push(item);
			}
		}
		return out;
	});
	const options = $derived(visible.filter(item => !('heading' in item) && !('separator' in item)));

	let el = $state<HTMLElement | null>(null);
	const itemRole = $derived(role === 'listbox' ? 'option' : 'menuitem');

	/*
	 * Positioned against the viewport, from the anchor's rectangle, so a menu
	 * opened from a row inside a scrolling list is never clipped by the list.
	 * Any scroll or resize closes it rather than trying to follow.
	 */
	let place = $state('');
	function measure() {
		const anchor = el?.parentElement;
		if (!anchor) return;
		const r = anchor.getBoundingClientRect();
		const gap = 4;
		const edge = 8;
		const parts: string[] = [];
		if (above) parts.push(`bottom:${Math.max(edge, window.innerHeight - r.top + gap)}px`);
		else parts.push(`top:${r.bottom + gap}px`);
		if (align === 'end') parts.push(`right:${Math.max(edge, window.innerWidth - r.right)}px`);
		else parts.push(`left:${Math.max(edge, r.left)}px`);
		place = parts.join(';');
	}

	function rows(): HTMLButtonElement[] {
		return el ? [...el.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')] : [];
	}

	function onDocClick(event: MouseEvent) {
		const target = event.target as Node;
		if (!el || el.contains(target)) return;
		// The anchor that toggles the menu is a sibling — let it do its own job.
		if (el.parentElement?.contains(target)) return;
		onclose();
	}

	function onScroll(event: Event) {
		if (el && event.target instanceof Node && el.contains(event.target)) return;
		onclose();
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onclose(); return; }
		const list = rows();
		const inField = field !== null && event.target === field;
		if (inField) {
			// Typing filters; only Enter and the down arrow leave the field.
			if (event.key === 'Enter') { event.preventDefault(); list[0]?.click(); }
			else if (event.key === 'ArrowDown') { event.preventDefault(); list[0]?.focus(); }
			return;
		}
		if (!list.length) return;
		const index = list.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'ArrowDown') { event.preventDefault(); list[(index + 1) % list.length].focus(); }
		else if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (index === 0 && field) field.focus();
			else list[(index - 1 + list.length) % list.length].focus();
		}
		else if (event.key === 'Home') { event.preventDefault(); list[0].focus(); }
		else if (event.key === 'End') { event.preventDefault(); list[list.length - 1].focus(); }
	}

	$effect(() => {
		const opener = document.activeElement as HTMLElement | null;
		measure();
		// Focus the filter if there is one; else the current choice, or the first row.
		const list = rows();
		if (field) field.focus();
		else (list.find(b => b.getAttribute('aria-selected') === 'true') ?? list[0])?.focus();
		// Attach on the next frame, so the click that opened the menu — still
		// bubbling when this mounts — cannot close it again.
		let attached = false;
		const raf = requestAnimationFrame(() => {
			document.addEventListener('click', onDocClick);
			document.addEventListener('scroll', onScroll, { capture: true, passive: true });
			window.addEventListener('resize', onclose);
			attached = true;
		});
		return () => {
			cancelAnimationFrame(raf);
			if (attached) {
				document.removeEventListener('click', onDocClick);
				document.removeEventListener('scroll', onScroll, { capture: true });
				window.removeEventListener('resize', onclose);
			}
			// Hand focus back to whatever opened us, unless it moved on already.
			if (opener && (document.activeElement === document.body || el?.contains(document.activeElement))) opener.focus();
		};
	});
</script>

<div
	{id}
	class="menu menu--{align}"
	class:menu--above={above}
	class:menu--wide={wide}
	{role}
	aria-label={label}
	bind:this={el}
	style={place}
	onkeydown={onKey}
>
	{#if searchable}
		<div class="menu__field">
			<span class="menu__field-icon"><Search size={14} strokeWidth={1.75} /></span>
			<input bind:this={field} bind:value={query} type="text" placeholder={searchPlaceholder} aria-label={searchPlaceholder} autocomplete="off" />
		</div>
	{/if}
	<div class="menu__list">
	{#each visible as item (item.id)}
		{#if 'separator' in item}
			<hr class="menu__rule" />
		{:else if 'heading' in item}
			<div class="menu__heading" role="presentation">{item.heading}</div>
		{:else}
			<button
				type="button"
				class="menu__item"
				class:is-danger={item.danger}
				class:is-selected={item.selected}
				role={itemRole}
				aria-selected={role === 'listbox' ? item.selected === true : undefined}
				disabled={item.disabled}
				onclick={() => { onclose(); item.onselect(); }}
			>
				{#if item.icon}<span class="menu__icon"><item.icon size={15} strokeWidth={1.75} /></span>{/if}
				<span class="menu__text">
					<span class="menu__label">{item.label}</span>
					{#if item.hint}<span class="menu__hint">{item.hint}</span>{/if}
				</span>
				{#if item.kbd}<kbd class="menu__kbd">{item.kbd}</kbd>{/if}
				{#if role === 'listbox'}<span class="menu__check" aria-hidden="true">{#if item.selected}<Check size={14} />{/if}</span>{/if}
			</button>
		{/if}
	{/each}
	{#if searchable && !options.length}
		<p class="menu__empty">Nothing matches “{query.trim()}”.</p>
	{/if}
	</div>
</div>

<style>
	.menu {
		position: fixed;
		z-index: var(--z-menu);
		min-width: 12rem;
		max-width: min(20rem, calc(100vw - var(--page-edge) * 2));
		max-height: min(24rem, calc(100dvh - var(--space-8)));
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background-color: var(--color-surface-raised);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		animation: menu-in var(--duration-base) var(--ease-out);
	}

	.menu--wide {
		min-width: 16rem;
	}

	.menu__list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: grid;
		align-content: start;
		padding: var(--space-1);
	}

	/* The filter: a bare field on the plate's first row, a hairline under it. */
	.menu__field {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: none;
		height: var(--control-h);
		padding-inline: var(--space-3);
		border-bottom: var(--border-width) solid var(--color-border);
	}

	.menu__field-icon {
		display: flex;
		color: var(--color-text-subtle);
	}

	.menu__field input {
		flex: 1;
		height: 100%;
		padding: 0;
		background: none;
		border: 0;
		border-radius: 0;
		font-size: var(--text-ui);
		color: var(--color-text-strong);
	}

	.menu__field input:focus {
		background: none;
		border: 0;
	}

	.menu__empty {
		padding: var(--space-4) var(--space-3);
		font-size: var(--text-xs);
		color: var(--color-text-subtle);
		text-align: center;
	}

	.menu--above {
		animation-name: menu-in-up;
	}

	.menu__item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: var(--control-h);
		padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
		border-radius: var(--radius-md);
		color: var(--color-text);
		font-size: var(--text-ui);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		white-space: nowrap;
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.menu__item:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.menu__item:hover:not(:disabled),
	.menu__item:focus-visible {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
		outline: none;
	}

	.menu__item.is-selected {
		color: var(--color-text-strong);
	}

	.menu__icon {
		display: flex;
		color: var(--color-text-subtle);
		flex: none;
	}

	.menu__item:hover .menu__icon,
	.menu__item:focus-visible .menu__icon {
		color: var(--color-text);
	}

	.menu__text {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: var(--space-half);
	}

	.menu__label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.menu__hint {
		font-size: var(--text-2xs);
		font-weight: var(--weight-regular);
		letter-spacing: var(--tracking-normal);
		color: var(--color-text-subtle);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.menu__kbd {
		margin-left: var(--space-4);
		color: var(--color-text-faint);
	}

	.menu__check {
		width: 1rem;
		display: flex;
		justify-content: center;
		flex: none;
		color: var(--color-text-strong);
	}

	.menu__heading {
		padding: var(--space-2) var(--space-3) var(--space-1);
		font-size: var(--text-2xs);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-wide);
		color: var(--color-text-subtle);
	}

	.menu__heading:not(:first-child) {
		margin-top: var(--space-1);
	}

	.menu__rule {
		margin: var(--space-1) var(--space-2);
	}

	@keyframes menu-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}

	@keyframes menu-in-up {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
</style>
