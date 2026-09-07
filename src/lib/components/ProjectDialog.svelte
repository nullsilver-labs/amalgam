<script lang="ts">
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import Notice from './Notice.svelte';
	import { workspace, messageOf } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';

	/*
	 * A project: a name and the instructions every conversation in it starts
	 * from. Creating one opens a fresh chat inside it. Deleting one keeps
	 * its conversations — the dialog says so before it asks.
	 */

	const existing = $derived(workspace.data.projects.find(p => p.id === ui.projectEditId) ?? null);

	let name = $state('');
	let instructions = $state('');
	let saving = $state(false);
	let confirming = $state(false);
	let error = $state('');

	$effect(() => {
		name = existing?.name ?? '';
		instructions = existing?.instructions ?? '';
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true; error = '';
		try {
			const value = await workspace.saveProject(existing?.id ?? null, name.trim(), instructions);
			ui.close();
			if (!existing) workspace.newChat(value.id);
		} catch (err) { error = messageOf(err); }
		finally { saving = false; }
	}

	async function remove() {
		if (!existing) return;
		saving = true; error = '';
		try { await workspace.deleteProject(existing.id); ui.close(); }
		catch (err) { error = messageOf(err); }
		finally { saving = false; }
	}
</script>

<Dialog title={existing ? 'Project settings' : 'New project'} onclose={() => ui.close()}>
	<form class="form" onsubmit={save}>
		{#if error}<Notice ondismiss={() => (error = '')}>{error}</Notice>{/if}
		{#if !existing}<p class="lede">A shared starting point for related conversations. Projects are always optional.</p>{/if}

		<div class="field">
			<label for="project-name">Name</label>
			<input id="project-name" bind:value={name} placeholder="What are you working on?" maxlength="100" required autocomplete="off" />
		</div>

		<div class="field">
			<label for="project-instructions">Instructions <span class="optional">optional</span></label>
			<textarea id="project-instructions" bind:value={instructions} rows="7" maxlength="12000" placeholder="Context, preferences, or guidance to include in every conversation here"></textarea>
			<p class="hint">Sent with each new response in this project. Other conversations are never added to a request.</p>
		</div>

		<div class="actions">
			{#if existing}
				{#if confirming}
					<span class="confirm">Delete this project? Its conversations are kept.</span>
					<Button variant="ghost" size="md" onclick={() => (confirming = false)} disabled={saving}>Cancel</Button>
					<Button variant="outline" size="md" onclick={remove} disabled={saving}>Delete</Button>
				{:else}
					<Button variant="ghost" size="md" onclick={() => (confirming = true)} disabled={saving}>Delete project</Button>
				{/if}
			{/if}
			<span class="spacer"></span>
			<Button type="submit" size="md" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save project'}</Button>
		</div>
	</form>
</Dialog>

<style>
	.form {
		display: grid;
		gap: var(--space-4);
	}

	.lede {
		font-size: var(--text-sm);
		line-height: var(--leading-relaxed);
		color: var(--color-text-muted);
	}

	.field {
		display: grid;
		gap: var(--space-2);
	}

	.field label {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-wide);
		color: var(--color-text-subtle);
	}

	.optional {
		margin-left: var(--space-1);
		font-weight: var(--weight-regular);
		letter-spacing: var(--tracking-normal);
		color: var(--color-text-faint);
	}

	.field textarea {
		font-size: var(--text-sm);
		min-height: 8rem;
	}

	.hint {
		font-size: var(--text-xs);
		line-height: var(--leading-relaxed);
		color: var(--color-text-subtle);
	}

	.actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.spacer {
		flex: 1;
	}

	.confirm {
		font-size: var(--text-xs);
		color: var(--color-text-muted);
	}
</style>
