<script lang="ts">
	import { APP_NAME } from '$lib/config';
	import { ArrowUp, Folder, Info, Library, Plus, Settings, SlidersHorizontal, Square, X } from '@lucide/svelte';
	import ChatOptions from './ChatOptions.svelte';
	import Menu, { type MenuEntry } from './Menu.svelte';
	import ModelPicker from './ModelPicker.svelte';
	import Notice from './Notice.svelte';
	import { workspace } from '$lib/state/workspace.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { modifier } from '$lib/format';
	import { isLocalDestination } from '$lib/destination';

	/*
	 * The composer — the one plate the whole interface is built around. A
	 * textarea that grows with the draft, and a bottom row: at the left a
	 * "+" for what a message may carry, the chat's options, then the model;
	 * send (or stop) at the right. ⌘Enter (Ctrl+Enter) sends; Enter breaks
	 * the line, as it does everywhere else you write.
	 *
	 * The two marks before the model are bare icons, the bar's vocabulary:
	 * nothing in the row has a field of its own but the send disc. The "+"
	 * opens a short menu — today the library alone; files will join it —
	 * and lights while cards are attached. The options mark opens a small
	 * plate of what this chat does with the model it has.
	 *
	 * When cards from the library are attached, they sit above the plate as
	 * chips — and if the chosen model lives somewhere other than this machine,
	 * a line above them says so in plain words, every single time. Not once,
	 * not in a preference, not behind a tooltip: a person is about to send
	 * private material to a company, and that deserves the same sentence on the
	 * hundredth message as on the first.
	 */

	let textarea = $state<HTMLTextAreaElement | null>(null);

	const placeholder = $derived(workspace.project ? `Message in ${workspace.project.name}` : 'Ask anything');
	const corpus = $derived(workspace.data.integrations.corpus);
	const destination = $derived(workspace.selectedModel?.destination ?? '');
	const disclose = $derived(workspace.sources.length > 0 && !!destination && !isLocalDestination(destination));

	let attachOpen = $state(false);
	let optionsOpen = $state(false);
	const attachments = $derived.by<MenuEntry[]>(() => [
		{ id: 'head', heading: 'Attach' },
		{
			id: 'corpus', label: 'From your corpus library', icon: Library,
			hint: !corpus.configured ? 'Not connected on this instance' : workspace.sources.length ? `${workspace.sources.length} of 5 cards attached` : 'Quote up to five cards',
			disabled: !corpus.configured, onselect: () => ui.open('sources')
		}
	]);

	function resize() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${textarea.scrollHeight}px`;
	}

	function oninput() { workspace.rememberDraft(); resize(); }

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
			event.preventDefault();
			void workspace.send();
		}
	}

	function onsubmit(event: SubmitEvent) { event.preventDefault(); void workspace.send(); }

	// The draft can change under us — a restored draft, a suggestion, a send
	// that clears it — so the height follows the value, not only keystrokes.
	$effect(() => { workspace.draft; resize(); });

	// Take focus when asked, on devices where a keyboard is not a modal event.
	$effect(() => {
		workspace.focusTick;
		if (textarea && matchMedia('(hover: hover)').matches) textarea.focus();
	});
</script>

<div class="composer">
	{#if workspace.problem}
		<Notice class="composer__notice" ondismiss={() => (workspace.problem = '')}>{workspace.problem}</Notice>
	{/if}
	{#if workspace.ready && workspace.modelUnavailable}
		<Notice class="composer__notice" role="status">Selected model “{workspace.model}” is unavailable. Sending is disabled. Choose another model below, or check Settings → Models and reload to retry discovery.</Notice>
	{/if}
	{#if workspace.ready && !workspace.data.models.length}
		<button type="button" class="composer__connect" onclick={() => ui.open('settings')}>
			<Settings size={14} strokeWidth={1.75} />
			<span>Connect a model to start a conversation.</span>
		</button>
	{/if}

	{#if workspace.sources.length}
		<div class="attached" aria-label="Attached sources">
			{#each workspace.sources as source (source.id)}
				<span class="attached__chip">
					<Library size={12} strokeWidth={1.75} />
					<span class="attached__title">{source.title}</span>
					<button type="button" class="attached__remove" aria-label="Remove {source.title}" title="Remove" onclick={() => workspace.removeSource(source.id)}>
						<X size={12} strokeWidth={2} />
					</button>
				</span>
			{/each}
		</div>
	{/if}
	{#if disclose}
		<p class="composer__disclosure">Excerpts from your corpus library will be sent to {destination}.</p>
	{/if}

	<form class="plate" class:is-busy={workspace.busy} {onsubmit}>
		<label class="sr-only" for="message">Message {APP_NAME}</label>
		<textarea
			id="message"
			bind:this={textarea}
			bind:value={workspace.draft}
			{oninput}
			{onkeydown}
			{placeholder}
			rows="1"
			maxlength="16000"
			disabled={!workspace.ready || workspace.loading}
		></textarea>
		<div class="plate__row">
			<div class="plate__lead">
				<div class="plate__marks">
					<div class="plate__anchor">
						<button type="button" class="mark" class:is-on={workspace.sources.length > 0} aria-label="Attach" aria-haspopup="menu" aria-expanded={attachOpen} title="Attach" disabled={workspace.busy || workspace.loading} onclick={() => (attachOpen = !attachOpen)}>
							<Plus size={16} strokeWidth={1.75} />
						</button>
						{#if attachOpen}<Menu items={attachments} label="Attach" align="start" above wide onclose={() => (attachOpen = false)} />{/if}
					</div>
					<div class="plate__anchor">
						<button type="button" class="mark" aria-label="Chat options" aria-haspopup="dialog" aria-expanded={optionsOpen} title="Chat options" onclick={() => (optionsOpen = !optionsOpen)}>
							<SlidersHorizontal size={16} strokeWidth={1.75} />
						</button>
						{#if optionsOpen}<ChatOptions onclose={() => (optionsOpen = false)} />{/if}
					</div>
				</div>
				<ModelPicker />
				{#if workspace.project}
					<span class="plate__chip" title={workspace.project.name}><Folder size={12} strokeWidth={1.75} /><span>{workspace.project.name}</span></span>
				{/if}
			</div>
			{#if workspace.busy}
				<button type="button" class="send send--stop" onclick={() => void workspace.stop()} aria-label="Stop response" title="Stop">
					<Square size={12} fill="currentColor" />
				</button>
			{:else}
				<button type="submit" class="send" disabled={!workspace.canSend} aria-label="Send message" title="Send ({modifier()} Enter)">
					<ArrowUp size={18} strokeWidth={2} />
				</button>
			{/if}
		</div>
	</form>

	<p class="composer__foot">
		<span class="composer__foot-text">
			{#if workspace.selectedModel}Sent to <span class="composer__host">{workspace.selectedModel.destination}</span>{:else}Your conversations live on this instance.{/if}
		</span>
		<button type="button" class="composer__foot-link" onclick={() => ui.open('context')}>
			{workspace.contextInfo?.truncated ? 'Earlier context trimmed' : 'What the model sees'}
			<Info size={11} />
		</button>
	</p>
</div>

<style>
	.composer {
		display: grid;
		gap: var(--space-2);
		width: 100%;
	}

	.composer :global(.composer__notice) {
		margin-bottom: var(--space-1);
	}

	.composer__connect {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.composer__connect:hover {
		color: var(--color-text-strong);
	}

	/* The plate: raised, hairline, lit at the edge while it has focus. */
	.plate {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-3) var(--space-2);
		background-color: var(--color-surface-raised);
		border: var(--border-width) solid var(--color-border);
		border-radius: var(--radius-lg);
		transition:
			border-color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	@media (hover: hover) {
		.plate:hover {
			border-color: var(--color-border-strong);
		}
	}

	.plate:focus-within,
	.plate:focus-within:hover {
		border-color: var(--color-border-lit);
	}

	.plate textarea {
		display: block;
		width: 100%;
		min-height: 1.75rem;
		max-height: 40vh;
		padding: var(--space-1) var(--space-2) 0;
		background: none;
		border: 0;
		border-radius: 0;
		resize: none;
		font-size: var(--text-base);
		line-height: var(--leading-relaxed);
		color: var(--color-text-strong);
		overflow-y: auto;
	}

	.plate textarea::placeholder {
		color: var(--color-text-subtle);
	}

	.plate textarea:focus {
		outline: none;
		border: 0;
	}

	.plate__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.plate__lead {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	/* The two marks, as the bar's trail stacks its own: 32px boxes, no field,
	 * a wash on hover and while open. Their glyphs begin where the text does. */
	.plate__marks {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex: none;
	}

	/* The menu and the options plate position themselves from this box. */
	.plate__anchor {
		position: relative;
		display: inline-flex;
	}

	.mark {
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

	.mark:hover:not(:disabled),
	.mark[aria-expanded='true'] {
		color: var(--color-text-strong);
		background-color: var(--color-hover);
	}

	/* Lit while a message has something attached. */
	.mark.is-on {
		color: var(--color-text-strong);
	}

	.mark:disabled {
		color: var(--color-text-faint);
		cursor: default;
	}

	/* What this message will quote, above the plate, each with a way off. */
	.attached {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding-inline: var(--space-2);
	}

	.attached__chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		max-width: 18rem;
		height: var(--control-h-sm);
		padding-inline: var(--space-3);
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-full);
		font-size: var(--text-2xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
	}

	.attached__title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.attached__remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		margin-right: calc(var(--space-2) * -1);
		width: var(--space-6);
		height: var(--space-6);
		border-radius: var(--radius-full);
		color: var(--color-text-subtle);
		cursor: pointer;
	}

	.attached__remove:hover {
		color: var(--color-text-strong);
	}

	/* Said every time, in the frame's own voice, never dismissible. */
	.composer__disclosure {
		padding-inline: var(--space-2);
		font-size: var(--text-xs);
		line-height: var(--leading-relaxed);
		color: var(--color-text-muted);
	}

	.plate__chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		height: var(--control-h-sm);
		padding-inline: var(--space-2);
		border: var(--border-width) solid var(--color-border);
		border-radius: var(--radius-full);
		font-size: var(--text-2xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-subtle);
		min-width: 0;
	}

	.plate__chip span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Send: the one accent in the frame. A circle, inverted. */
	.send {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h);
		height: var(--control-h);
		flex: none;
		border-radius: var(--radius-full);
		background-color: var(--color-accent);
		color: var(--color-on-accent);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-out),
			color var(--duration-fast) var(--ease-out),
			opacity var(--duration-fast) var(--ease-out);
	}

	.send:hover:not(:disabled) {
		background-color: var(--color-accent-hover);
	}

	.send:disabled {
		background-color: var(--color-surface-overlay);
		color: var(--color-text-faint);
		cursor: default;
	}

	.send--stop {
		background-color: transparent;
		border: var(--border-width) solid var(--color-border-lit);
		color: var(--color-text);
	}

	.send--stop:hover {
		background-color: var(--color-hover);
		border-color: var(--color-border-accent);
		color: var(--color-text-strong);
	}

	.composer__foot {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		min-height: var(--space-5);
		padding-inline: var(--space-2);
		font-size: var(--text-2xs);
		color: var(--color-text-faint);
	}

	/* Read as often as the link beside it, so it takes the link's colour. */
	.composer__foot-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-subtle);
	}

	.composer__host {
		color: var(--color-text-muted);
	}

	.composer__foot-link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		flex: none;
		color: var(--color-text-subtle);
		cursor: pointer;
		white-space: nowrap;
	}

	.composer__foot-link:hover {
		color: var(--color-text-strong);
	}

	@media (max-width: 47.5rem) {
		.plate textarea {
			/* iOS zooms into anything smaller than 16px on focus. */
			font-size: 16px;
		}

		.plate__chip {
			display: none;
		}
	}
</style>
