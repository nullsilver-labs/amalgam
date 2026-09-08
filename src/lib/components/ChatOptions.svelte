<script lang="ts">
	import Switch from './Switch.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { formatTokens } from '$lib/format';

	/*
	 * The chat's options — a small plate above the composer's options mark,
	 * in the menu's vocabulary: what this chat asks of the model it has, and
	 * what is known of that model's limits.
	 *
	 * Thinking is the one option so far. It is honest about what it can do:
	 * the Anthropic API takes the request; an OpenAI-style server takes none,
	 * so for those the switch only keeps room in the reply for the reasoning
	 * a model may send of its own accord. The window line says plainly when
	 * a limit is not known, rather than pretending the instance's budget is
	 * the model's.
	 */

	let { onclose }: { onclose: () => void } = $props();

	const model = $derived(workspace.selectedModel);
	const budget = $derived(workspace.data.settings.contextTokens);
	const thinkingHint = $derived(
		!model ? 'No model is connected.'
		: model.kind === 'anthropic' ? 'Claude is asked to think before answering and to show a summary. Older Claude models refuse the request; turn it off for them.'
		: `${model.provider} takes no thinking setting: the model reasons as it will, and its reasoning is shown when it sends any. On, the reply keeps 16k tokens of room for it.`
	);

	let el = $state<HTMLElement | null>(null);
	let place = $state('');

	function measure() {
		const anchor = el?.parentElement;
		if (!anchor) return;
		const r = anchor.getBoundingClientRect();
		place = `bottom:${Math.max(8, window.innerHeight - r.top + 4)}px;left:${Math.max(8, r.left)}px`;
	}

	function onDocClick(event: MouseEvent) {
		const target = event.target as Node;
		// A click on a row that re-rendered under it reaches here detached from
		// the plate; it was inside all the same.
		if (!el || !target.isConnected || el.contains(target) || el.parentElement?.contains(target)) return;
		onclose();
	}

	/* On the document, not the plate: a row that re-rendered under the focus
	 * leaves it on the body, and Escape should still close. */
	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape') { event.preventDefault(); onclose(); }
	}

	$effect(() => {
		const opener = document.activeElement as HTMLElement | null;
		measure();
		el?.querySelector<HTMLElement>('input, button')?.focus();
		let attached = false;
		const raf = requestAnimationFrame(() => {
			document.addEventListener('click', onDocClick);
			document.addEventListener('keydown', onKey);
			window.addEventListener('resize', onclose);
			attached = true;
		});
		return () => {
			cancelAnimationFrame(raf);
			if (attached) { document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onclose); }
			if (opener && (document.activeElement === document.body || el?.contains(document.activeElement))) opener.focus();
		};
	});
</script>

<div class="options" role="dialog" aria-label="Chat options" tabindex="-1" bind:this={el} style={place}>
	<label class="row">
		<span class="row__text">
			<span class="row__label">Thinking</span>
			<span class="row__hint">{thinkingHint}</span>
		</span>
		<Switch checked={workspace.thinking} label="Thinking" disabled={!model} onchange={value => workspace.setThinking(value)} />
	</label>
	<p class="note">
		{#if workspace.thinkingChosen}
			Set for this chat.
			<button type="button" class="note__link" onclick={() => workspace.setThinking(null)}>Use the instance setting</button>
		{:else}
			The instance setting, from Settings › Chat.
		{/if}
	</p>
	<hr class="rule" />
	<dl class="facts">
		<div class="fact">
			<dt>Model window</dt>
			<dd>{#if !model}Unknown{:else if model.window}{formatTokens(model.window)} tokens, declared{:else}Not declared{/if}</dd>
		</div>
		<div class="fact">
			<dt>Request budget</dt>
			<dd>{formatTokens(budget)} tokens</dd>
		</div>
	</dl>
	{#if model && !model.window}
		<p class="note">This model’s limit is not known here, so the instance budget applies and may exceed it. Declare the window in the model list to have it respected.</p>
	{/if}
</div>

<style>
	.options {
		position: fixed;
		z-index: var(--z-menu);
		width: min(20rem, calc(100vw - var(--page-edge) * 2));
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3);
		background-color: var(--color-surface-raised);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		animation: options-in var(--duration-base) var(--ease-out);
	}

	@keyframes options-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}

		to {
			opacity: 1;
			transform: none;
		}
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		cursor: pointer;
	}

	.row__text {
		display: grid;
		gap: var(--space-half);
		min-width: 0;
	}

	.row__label {
		font-size: var(--text-ui);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text-strong);
	}

	.row__hint,
	.note {
		font-size: var(--text-xs);
		line-height: var(--leading-relaxed);
		color: var(--color-text-muted);
		text-wrap: pretty;
	}

	.note {
		color: var(--color-text-subtle);
	}

	.note__link {
		color: var(--color-text-muted);
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}

	.note__link:hover {
		color: var(--color-text-strong);
	}

	.rule {
		border: 0;
		border-top: var(--border-width) solid var(--color-border);
	}

	.facts {
		display: grid;
		gap: var(--space-1);
	}

	.fact {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: var(--text-xs);
	}

	.fact dt {
		color: var(--color-text-subtle);
	}

	.fact dd {
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
</style>
