<script lang="ts">
	import { APP_NAME } from '$lib/config';
	import { MARK_SIZE, markPath, markViewBox } from '$lib/assets/mark';

	/*
	 * The Nullsilver mark — a four-point star cut *out* of a silver tile, so
	 * whatever sits behind shows through the star. amalgam wears the lab's
	 * mark, as corpus does; the tile is the one the site's header uses.
	 */

	type Props = {
		/** Tile height. */
		height?: string;
		/** Extra tile width on each side, as a fraction of the height. */
		inset?: number;
		/** Accessible name. Set to '' when a nearby label already names it. */
		label?: string;
		class?: string;
	};

	let { height = 'var(--logo-h)', inset = 0.154, label = 'Nullsilver', class: className = '' }: Props = $props();

	const units = $derived(inset * MARK_SIZE);
	const viewBox = $derived(markViewBox(units));
	const d = $derived(markPath(units));
</script>

<svg
	class="logo {className}"
	style:height
	{viewBox}
	role={label ? 'img' : 'presentation'}
	aria-label={label || undefined}
	aria-hidden={label ? undefined : 'true'}
>
	{#if label}<title>{label}</title>{/if}
	<path {d} fill="currentColor" fill-rule="evenodd" />
</svg>

<style>
	.logo {
		width: auto;
		color: var(--color-accent);
		flex: none;
		border-radius: var(--radius-xs);
	}
</style>
