<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { X } from '@lucide/svelte';

	/*
	 * Dialog — a native <dialog>, which gives focus containment, Escape and
	 * return-focus for free. A plate at --radius-lg over a scrim.
	 *
	 *   size     'md' for forms, 'wide' for the two-column settings.
	 *   palette  the ⌘K search: no header, pinned near the top of the viewport.
	 */

	type Props = {
		title?: string;
		size?: 'md' | 'wide';
		palette?: boolean;
		onclose: () => void;
		children: Snippet;
	};

	let { title, size = 'md', palette = false, onclose, children }: Props = $props();
	let element: HTMLDialogElement;

	onMount(() => { element.showModal(); });

	function onbackdrop(event: MouseEvent) {
		if (event.target !== element) return;
		const r = element.getBoundingClientRect();
		if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onclose();
	}
</script>

<dialog
	bind:this={element}
	class="dialog dialog--{size}"
	class:dialog--palette={palette}
	aria-label={title ? undefined : 'Search'}
	oncancel={(event) => { event.preventDefault(); onclose(); }}
	onclick={onbackdrop}
>
	{#if title}
		<header class="dialog__head">
			<h2 class="dialog__title">{title}</h2>
			<button type="button" class="dialog__close" onclick={onclose} aria-label="Close">
				<X size={16} />
			</button>
		</header>
	{/if}
	<div class="dialog__body">{@render children()}</div>
</dialog>

<style>
	.dialog {
		margin: auto;
		width: min(var(--dialog-w), calc(100% - var(--page-edge) * 2));
		max-height: calc(100dvh - var(--space-8));
		padding: 0;
		color: var(--color-text);
		background-color: var(--color-surface);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		animation: dialog-in var(--duration-base) var(--ease-out);
	}

	.dialog--wide {
		width: min(var(--dialog-w-wide), calc(100% - var(--page-edge) * 2));
	}

	.dialog--palette {
		margin-top: 12vh;
		width: min(var(--dialog-w), calc(100% - var(--page-edge) * 2));
		overflow: hidden;
	}

	.dialog::backdrop {
		background-color: var(--color-scrim);
	}

	.dialog__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5) 0;
	}

	.dialog__title {
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		line-height: var(--leading-normal);
	}

	.dialog__close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h);
		height: var(--control-h);
		margin-right: calc(var(--space-2) * -1);
		border-radius: var(--radius-full);
		color: var(--color-text-subtle);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.dialog__close:hover {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	.dialog__body {
		padding: var(--space-4) var(--space-5) var(--space-5);
	}

	.dialog--palette .dialog__body {
		padding: 0;
	}

	@keyframes dialog-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	@media (max-width: 47.5rem) {
		.dialog {
			max-height: calc(100dvh - var(--space-4));
		}

		.dialog--palette {
			margin-top: var(--space-4);
		}
	}
</style>
