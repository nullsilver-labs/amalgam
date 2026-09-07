<script lang="ts">
	import Dialog from './Dialog.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { APP_NAME } from '$lib/config';

	/* What a request contains, in plain words, with the last request's numbers. */
	const info = $derived(workspace.contextInfo);
	/* The last thing sent from this tab, and the library cards it quoted. */
	const sent = $derived([...workspace.messages].reverse().find(m => m.role === 'user'));
	const sources = $derived(sent?.sources ?? []);
	const destination = $derived(workspace.selectedModel?.destination ?? '');
</script>

<Dialog title="What the model sees" onclose={() => ui.close()}>
	<div class="context">
		<p>Your system prompt — or {APP_NAME}’s own single line when none is set — then this project’s instructions if it has any, then the recent exchanges in this conversation. No other conversation is added, and nothing from your corpus library unless you attached it yourself.</p>
		{#if info}
			<dl class="facts">
				<div><dt>System prompt</dt><dd>{info.system ? 'Yours' : 'The base line'}</dd></div>
				<div><dt>History sent</dt><dd>{info.messages} {info.messages === 1 ? 'message' : 'messages'}</dd></div>
				<div><dt>Project instructions</dt><dd>{info.project ? 'Included' : 'None'}</dd></div>
				<div><dt>Estimated size</dt><dd>{info.tokens.toLocaleString()} of {info.budget.toLocaleString()} tokens</dd></div>
				<div><dt>Model window</dt><dd>{info.window ? `${info.window.toLocaleString()} tokens, declared` : 'Not declared'}</dd></div>
				<div><dt>Budget</dt><dd>{info.truncated ? 'Oldest exchanges omitted' : 'Everything fit'}</dd></div>
				{#if info.sources}
					<div><dt>Library excerpts</dt><dd>{info.sources.count === 0 ? 'None' : `${info.sources.count} source${info.sources.count === 1 ? '' : 's'}, about ${info.sources.tokens.toLocaleString()} tokens${info.sources.truncated ? ', trimmed to fit' : ''}`}</dd></div>
				{/if}
			</dl>
		{/if}
		{#if sources.length}
			<h3>Sources you attached</h3>
			<p>Quoted ahead of your message, framed as reference material rather than instructions. Your message itself was stored as you typed it.</p>
			<ul class="context__sources" role="list">
				{#each sources as source, i (source.id)}
					<li><span class="context__index">[{i + 1}]</span> {source.title} <span class="context__meta">— {source.card_type}, {source.chars.toLocaleString()} characters sent</span></li>
				{/each}
			</ul>
			<p class="note">They went where the rest of the request went: {destination || 'the connection you picked'}.</p>
		{/if}
		<h3>Limits</h3>
		<p>Context is capped by the token budget in Settings and, when a model declares its window, by that window less room for the reply. Tokens are estimated from characters, on the safe side, not counted by the model’s own tokenizer. Older exchanges drop out first, whole. Partial and failed responses are never reused as answers.</p>
		<h3>Your data</h3>
		{#if workspace.ghost}
			<p>This is a ghost chat: nothing in it is stored on this server or in this browser. Each message sends the whole chat from this tab, since the server keeps none of it, and the chat is gone when the tab closes or the page reloads. The provider you pick still receives the assembled context — self-hosting the interface does not make a cloud model local, and what a provider keeps is its own affair. There is no automatic fallback to another provider.</p>
		{:else}
			<p>Conversations are stored on this server. The provider you pick receives the assembled context — self-hosting the interface does not make a cloud model local. There is no automatic fallback to another provider.</p>
		{/if}
		<p class="note">Text only for now: no web search, attachments or tools. Responses can be wrong; verify anything that matters.</p>
	</div>
</Dialog>

<style>
	.context {
		display: grid;
		gap: var(--space-3);
	}

	.context p {
		font-size: var(--text-sm);
		line-height: var(--leading-relaxed);
		color: var(--color-text-muted);
	}

	.context h3 {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text-strong);
	}

	.note {
		font-size: var(--text-xs);
		color: var(--color-text-subtle);
	}

	.context__sources {
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-sm);
		line-height: var(--leading-relaxed);
		color: var(--color-text);
	}

	.context__index {
		color: var(--color-text-subtle);
		font-variant-numeric: tabular-nums;
	}

	.context__meta {
		color: var(--color-text-subtle);
	}

	.facts {
		display: grid;
		gap: var(--space-1);
		margin-block: var(--space-1);
	}

	.facts > div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		padding-block: var(--space-2);
		border-bottom: var(--border-width) solid var(--color-border);
		font-size: var(--text-sm);
	}

	.facts dt {
		color: var(--color-text-muted);
	}

	.facts dd {
		color: var(--color-text);
		text-align: right;
	}
</style>
