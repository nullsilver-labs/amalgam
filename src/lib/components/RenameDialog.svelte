<script lang="ts">
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import Notice from './Notice.svelte';
	import { workspace, messageOf } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';

	const target = $derived(ui.target ?? workspace.current);
	let title = $state('');
	let saving = $state(false);
	let error = $state('');
	let field = $state<HTMLInputElement | null>(null);

	$effect(() => { title = target?.title ?? ''; });
	$effect(() => { field?.select(); });

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!target) return;
		saving = true; error = '';
		try { await workspace.rename(target.id, title.trim()); ui.close(); }
		catch (err) { error = messageOf(err); }
		finally { saving = false; }
	}
</script>

<Dialog title="Rename conversation" onclose={() => ui.close()}>
	<form class="form" onsubmit={save}>
		{#if error}<Notice ondismiss={() => (error = '')}>{error}</Notice>{/if}
		<label for="conversation-title">Title</label>
		<input id="conversation-title" bind:this={field} bind:value={title} maxlength="120" required autocomplete="off" />
		<div class="actions">
			<Button variant="ghost" size="md" onclick={() => ui.close()} disabled={saving}>Cancel</Button>
			<Button type="submit" size="md" disabled={saving || !title.trim()}>Save title</Button>
		</div>
	</form>
</Dialog>

<style>
	.form {
		display: grid;
		gap: var(--space-2);
	}

	label {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-wide);
		color: var(--color-text-subtle);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}
</style>
