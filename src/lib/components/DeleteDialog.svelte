<script lang="ts">
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import Notice from './Notice.svelte';
	import { workspace, messageOf } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';

	const target = $derived(ui.target ?? workspace.current);
	const ghost = $derived(!!workspace.holder(target?.id)?.ghost);
	let deleting = $state(false);
	let error = $state('');

	async function remove() {
		if (!target) return;
		deleting = true; error = '';
		try { await workspace.remove(target.id); ui.close(); }
		catch (err) { error = messageOf(err); }
		finally { deleting = false; }
	}
</script>

<Dialog title="Delete conversation?" onclose={() => ui.close()}>
	<div class="body">
		{#if error}<Notice ondismiss={() => (error = '')}>{error}</Notice>{/if}
		{#if ghost}
			<p class="text">“{target?.title}” is a ghost chat: it was never saved. Deleting it forgets it now, as closing its tab would.</p>
		{:else}
			<p class="text">“{target?.title}” and every message in it will be permanently removed from this instance.</p>
		{/if}
		<div class="actions">
			<Button variant="ghost" size="md" onclick={() => ui.close()} disabled={deleting}>Keep conversation</Button>
			<Button size="md" onclick={remove} disabled={deleting || !!workspace.holder(target?.id)?.busy}>Delete conversation</Button>
		</div>
	</div>
</Dialog>

<style>
	.body {
		display: grid;
		gap: var(--space-4);
	}

	.text {
		font-size: var(--text-sm);
		line-height: var(--leading-relaxed);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
</style>
