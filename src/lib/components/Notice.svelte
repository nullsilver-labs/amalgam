<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CircleAlert, X } from '@lucide/svelte';

	/*
	 * Notice — an inline line of feedback: an error above the composer, a
	 * failure inside a form. One shape, no status hue: the icon says what it
	 * is, the border holds it apart from the text around it.
	 */

	type Props = {
		role?: 'alert' | 'status';
		ondismiss?: () => void;
		class?: string;
		children: Snippet;
	};

	let { role = 'alert', ondismiss, class: className = '', children }: Props = $props();
</script>

<div class="notice {className}" {role}>
	<span class="notice__icon"><CircleAlert size={15} /></span>
	<span class="notice__text">{@render children()}</span>
	{#if ondismiss}
		<button type="button" class="notice__close" onclick={ondismiss} aria-label="Dismiss"><X size={14} /></button>
	{/if}
</div>

<style>
	.notice {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background-color: var(--color-surface-raised);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-md);
		font-size: var(--text-xs);
		line-height: var(--leading-relaxed);
		color: var(--color-text);
	}

	.notice__icon {
		display: flex;
		flex: none;
		align-self: flex-start;
		margin-top: 0.2em;
		color: var(--color-text-muted);
	}

	.notice__text {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.notice__close {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: var(--space-6);
		height: var(--space-6);
		margin-right: calc(var(--space-1) * -1);
		border-radius: var(--radius-full);
		color: var(--color-text-subtle);
		cursor: pointer;
	}

	.notice__close:hover {
		color: var(--color-text-strong);
	}
</style>
