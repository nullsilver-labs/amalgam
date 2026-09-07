<script lang="ts">
	import { PanelLeftOpen, X } from '@lucide/svelte';
	import ChatList from './ChatList.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { prefs } from '$lib/state/prefs.svelte';

	/*
	 * The Chats panel — the archive, hanging off the dock as a plate. The
	 * same plate as a menu or the search palette, at --radius-lg with the
	 * list's rows at --radius-md inside it; not a sidebar sliding in. It
	 * opens on the plate's left edge, beside the rail's items and centred on
	 * the page as they are.
	 *
	 * Non-modal: Escape (handled by the page's shortcuts), an outside click,
	 * or choosing a row closes it, and focus goes back to the dock. Pinning
	 * it turns it into the sidebar.
	 */

	let { anchor }: { anchor: HTMLElement | null } = $props();
	let el = $state<HTMLElement | null>(null);

	function onDocClick(event: MouseEvent) {
		const target = event.target as Node;
		if (el?.contains(target) || anchor?.contains(target)) return;
		// A native dialog in the top layer is its own world.
		if ((target as Element).closest?.('dialog')) return;
		ui.closePanel();
	}

	$effect(() => {
		const opener = document.activeElement as HTMLElement | null;
		el?.querySelector<HTMLElement>('button, [href]')?.focus();
		let attached = false;
		const raf = requestAnimationFrame(() => {
			document.addEventListener('click', onDocClick);
			attached = true;
		});
		return () => {
			cancelAnimationFrame(raf);
			if (attached) document.removeEventListener('click', onDocClick);
			if (opener && (document.activeElement === document.body || el?.contains(document.activeElement))) opener.focus();
		};
	});
</script>

<div class="panel" role="region" aria-label="Chats" bind:this={el}>
	<header class="panel__head">
		<span class="panel__name">Chats</span>
		<span class="panel__tools">
			<button type="button" class="panel__tool" aria-label="Pin sidebar" title="Pin as a sidebar" onclick={() => { prefs.setLayout('sidebar'); ui.closePanel(); }}>
				<PanelLeftOpen size={16} strokeWidth={1.75} />
			</button>
			<button type="button" class="panel__tool" aria-label="Close" title="Close" onclick={() => ui.closePanel()}>
				<X size={16} strokeWidth={1.75} />
			</button>
		</span>
	</header>
	<div class="panel__scroll">
		<ChatList />
	</div>
</div>

<style>
	.panel {
		position: fixed;
		top: 0;
		bottom: 0;
		left: var(--plate-x);
		z-index: var(--z-drawer);
		display: flex;
		flex-direction: column;
		width: min(var(--sidebar-w), calc(100vw - var(--page-edge) * 2));
		height: fit-content;
		max-height: calc(100dvh - var(--page-edge) * 2);
		margin-block: auto;
		background-color: var(--color-surface-raised);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		animation: panel-in var(--duration-base) var(--ease-out);
	}

	.panel__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		flex: none;
		height: var(--control-h-lg);
		padding-inline: var(--space-4) var(--space-2);
		border-bottom: var(--border-width) solid var(--color-border);
	}

	.panel__name {
		font-size: var(--text-ui);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text-strong);
	}

	.panel__tools {
		display: flex;
		align-items: center;
		gap: var(--space-half);
	}

	.panel__tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h-sm);
		height: var(--control-h-sm);
		border-radius: var(--radius-full);
		color: var(--color-text-subtle);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	.panel__tool:hover {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	/* The list, on the plate's inner step: --space-1 in on every side, so a
	 * row's 8px corner sits concentric with the plate's 12px; a step more
	 * under the header's rule. No reserved scrollbar gutter: the list is
	 * left-aligned, so a scrollbar appearing shifts nothing, whereas a
	 * reserved gutter is an empty band down the right the whole time. */
	.panel__scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-2) var(--space-1) var(--space-1);
	}

	@keyframes panel-in {
		from {
			opacity: 0;
			transform: translateX(-4px);
		}
	}

	/* Under the bar on a phone, where the rail lies in the top bar. */
	@media (max-width: 47.5rem) {
		.panel {
			top: var(--topbar-h);
			bottom: auto;
			left: var(--page-edge);
			margin-block: 0;
			max-height: calc(100dvh - var(--topbar-h) - var(--page-edge));
		}

		@keyframes panel-in {
			from {
				opacity: 0;
				transform: translateY(-4px);
			}
		}
	}
</style>
