<script lang="ts">
	import type { Snippet } from 'svelte';

	/*
	 * Button — every pressable single-row control in the app. Pill-shaped by
	 * rule (see the SHAPE note in tokens.css); the three heights are the app's
	 * three control heights, so a button always lines up with whatever sits
	 * beside it.
	 */

	type Props = {
		/** Renders an <a> when set, a <button> otherwise. */
		href?: string;
		variant?: 'accent' | 'outline' | 'ghost';
		size?: 'sm' | 'md' | 'lg';
		/** Square footprint — an icon-only button. Give it an aria-label. */
		icon?: boolean;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		class?: string;
		children: Snippet;
		[key: string]: unknown;
	};

	let {
		href, variant = 'accent', size = 'md', icon = false, type = 'button', disabled = false,
		class: className = '', children, ...rest
	}: Props = $props();

	const classes = $derived(`btn btn--${variant} btn--${size} ${icon ? 'btn--icon' : ''} ${className}`);
</script>

{#if href}
	<a {href} class={classes} aria-disabled={disabled || undefined} {...rest}>{@render children()}</a>
{:else}
	<button {type} {disabled} class={classes} {...rest}>{@render children()}</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		border: var(--border-width) solid transparent;
		border-radius: var(--radius-full);
		/* 500: light strokes on dark bloom thinner; medium lands at the right
		 * apparent weight for the control step. */
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		line-height: var(--leading-none);
		text-decoration: none;
		white-space: nowrap;
		flex: none;
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out),
			color var(--duration-fast) var(--ease-out);
	}

	.btn--sm {
		height: var(--control-h-sm);
		padding-inline: var(--space-3);
		font-size: var(--text-xs);
	}

	.btn--md {
		height: var(--control-h);
		padding-inline: var(--space-4);
		font-size: var(--text-ui);
	}

	.btn--lg {
		height: var(--control-h-lg);
		padding-inline: var(--space-5);
		font-size: var(--text-sm);
	}

	/* Icon-only: a circle as wide as it is tall. */
	.btn--icon {
		padding-inline: 0;
		aspect-ratio: 1;
	}

	.btn--accent {
		background-color: var(--color-accent);
		color: var(--color-on-accent);
	}

	.btn--accent:hover:not(:disabled) {
		background-color: var(--color-accent-hover);
	}

	.btn--accent:active:not(:disabled) {
		background-color: var(--color-accent-active);
	}

	.btn--outline {
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}

	.btn--outline:hover:not(:disabled) {
		border-color: var(--color-border-lit);
		background-color: var(--color-hover);
		color: var(--color-text-strong);
	}

	.btn--ghost {
		color: var(--color-text-muted);
	}

	.btn--ghost:hover:not(:disabled) {
		background-color: var(--color-hover);
		color: var(--color-text-strong);
	}

	.btn:disabled,
	.btn[aria-disabled='true'] {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
