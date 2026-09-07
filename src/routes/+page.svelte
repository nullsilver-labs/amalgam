<script lang="ts">
	import { onMount } from 'svelte';
	import { LoaderCircle } from '@lucide/svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Topbar from '$lib/components/Topbar.svelte';
	import Welcome from '$lib/components/Welcome.svelte';
	import Transcript from '$lib/components/Transcript.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import SearchPalette from '$lib/components/SearchPalette.svelte';
	import SettingsDialog from '$lib/components/SettingsDialog.svelte';
	import ProjectDialog from '$lib/components/ProjectDialog.svelte';
	import RenameDialog from '$lib/components/RenameDialog.svelte';
	import DeleteDialog from '$lib/components/DeleteDialog.svelte';
	import ContextDialog from '$lib/components/ContextDialog.svelte';
	import SourcesDialog from '$lib/components/SourcesDialog.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { prefs } from '$lib/state/prefs.svelte';
	import { APP_NAME } from '$lib/config';

	/*
	 * The shell. The top bar sits in the gutter above the page plate — the
	 * one rounded plate that holds the conversation, on the void — with the
	 * rail standing beside it, or the sidebar as a column of text on the
	 * void. An empty conversation puts the composer in the middle of the
	 * plate; a transcript docks it at the bottom. Dialogs mount here so any
	 * of them can open from anywhere.
	 */

	onMount(() => {
		void workspace.boot();
		return () => workspace.dispose();
	});

	// The open tabs, remembered for a reload of this browser tab.
	$effect(() => { workspace.persistTabs(); });

	function shortcuts(event: KeyboardEvent) {
		const meta = event.metaKey || event.ctrlKey;
		if (meta && event.key.toLowerCase() === 'k') { event.preventDefault(); ui.open('search'); }
		else if (meta && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); workspace.newChat(workspace.projectId); }
		else if (event.key === 'Escape' && (ui.drawer || ui.panel)) ui.settle();
	}
</script>

<svelte:head>
	<title>{workspace.current ? `${workspace.current.title} - ` : ''}{APP_NAME}</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>
<svelte:window onkeydown={shortcuts} />

<div class="shell" class:shell--dock={prefs.layout === 'dock'}>
	{#if ui.drawer}
		<button type="button" class="scrim" aria-label="Close navigation" onclick={() => ui.closeDrawer()}></button>
	{/if}
	{#if prefs.layout === 'sidebar'}<Sidebar />{/if}
	<main class="main">
		<Topbar />
		<div class="stage">
			<div class="plate">
				{#key workspace.active.key}
					{#if workspace.loading}
						<div class="loading" role="status"><LoaderCircle size={18} class="spin" /><span class="sr-only">Opening conversation</span></div>
					{:else if !workspace.messages.length}
						<Welcome />
					{:else}
						<Transcript />
						<div class="composer-dock"><Composer /></div>
					{/if}
				{/key}
			</div>
		</div>
	</main>
</div>

{#if ui.modal === 'search'}<SearchPalette />
{:else if ui.modal === 'settings'}<SettingsDialog />
{:else if ui.modal === 'project'}<ProjectDialog />
{:else if ui.modal === 'rename'}<RenameDialog />
{:else if ui.modal === 'delete'}<DeleteDialog />
{:else if ui.modal === 'context'}<ContextDialog />
{:else if ui.modal === 'sources'}<SourcesDialog />{/if}

<style>
	.shell {
		display: grid;
		grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
		height: 100dvh;
		overflow: hidden;
		background-color: var(--color-bg);
		transition: grid-template-columns var(--duration-base) var(--ease-out);
	}

	/* One column; the rail is fixed down the page's edge, and the plate
	 * keeps clear of it. */
	.shell--dock {
		--plate-x: var(--rail-w);
		grid-template-columns: minmax(0, 1fr);
	}

	/* The bar's row, then the plate's. */
	.main {
		display: grid;
		grid-template-rows: var(--topbar-h) minmax(0, 1fr);
		min-width: 0;
		min-height: 0;
	}

	/* The void around the plate: a page-edge at the right and the bottom,
	 * the bar's own row above, and at the left the plate's inset — the rail,
	 * or the air beside the sidebar's rows. */
	.stage {
		display: flex;
		min-width: 0;
		min-height: 0;
		padding: 0 var(--page-edge) var(--page-edge) var(--plate-x);
	}

	/* The plate: the conversation's surface, one step up from the void,
	 * ringed by a hairline. Everything inside it is clipped to its corner. */
	.plate {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 100vw;
		min-width: 0;
		min-height: 0;
		background-color: var(--color-plate);
		border: var(--border-width) solid var(--color-border);
		border-radius: var(--radius-xl);
		overflow: hidden;
	}

	.loading {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-subtle);
	}

	.composer-dock {
		flex: none;
		width: min(var(--chat-measure), 100% - var(--space-8));
		margin-inline: auto;
		padding-bottom: var(--space-3);
	}

	.scrim {
		display: none;
	}

	@media (max-width: 47.5rem) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
		}

		.scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: calc(var(--z-drawer) - 1);
			background-color: var(--color-scrim);
			cursor: default;
		}

		/* Edge to edge on a phone: the plate is the page. */
		.stage {
			padding: 0;
		}

		.plate {
			max-width: none;
			border: 0;
			border-radius: 0;
			background-color: var(--color-bg);
		}

		.composer-dock {
			width: calc(100% - var(--page-edge) * 2);
			padding-bottom: max(var(--space-2), env(safe-area-inset-bottom));
		}
	}
</style>
