<script lang="ts">
	import { tick } from 'svelte';
	import { ArrowDown } from '@lucide/svelte';
	import Message from './Message.svelte';
	import { workspace } from '$lib/state/workspace.svelte';

	/*
	 * The transcript — the scrolling column of turns. It follows a response
	 * as it streams for as long as the reader stays near the bottom, and
	 * offers a way back down the moment they scroll away.
	 */

	let scroller = $state<HTMLDivElement | null>(null);
	let atBottom = $state(true);
	let stick = true;

	function measure() {
		if (!scroller) return;
		const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
		atBottom = gap < 48;
		stick = gap < 120;
	}

	function toBottom(behavior: ScrollBehavior = 'smooth') {
		if (!scroller) return;
		scroller.scrollTo({ top: scroller.scrollHeight, behavior });
		stick = true;
	}

	// A different conversation: start at its end, instantly.
	$effect(() => {
		workspace.current?.id;
		stick = true;
		void tick().then(() => toBottom('instant'));
	});

	// New turns and streamed deltas: follow, while the reader is following.
	$effect(() => {
		const last = workspace.messages[workspace.messages.length - 1];
		last?.content;
		last?.thinking; // an open thinking pane grows as it streams
		last?.status; // the action row appears when a response completes
		workspace.messages.length;
		if (stick) void tick().then(() => { if (scroller) { scroller.scrollTop = scroller.scrollHeight; atBottom = true; } });
	});
</script>

<div class="transcript">
	<div class="transcript__scroll" bind:this={scroller} onscroll={measure}>
		<section class="transcript__column" aria-label="Conversation">
			{#each workspace.messages as message, index (message.id)}
				<Message {message} last={index === workspace.messages.length - 1} startedAt={index === workspace.messages.length - 1 && workspace.busy ? workspace.active.startedAt : 0} />
			{/each}
			{#if workspace.streaming && !workspace.busy}
				<p class="transcript__stale">
					This response could not be followed to its end.
					<button type="button" onclick={() => void workspace.reload()}>Reload</button>
					to read what was saved, or
					<button type="button" onclick={() => void workspace.stop()}>stop it</button>.
				</p>
			{/if}
		</section>
	</div>
	{#if !atBottom}
		<button type="button" class="transcript__down" onclick={() => toBottom()} aria-label="Scroll to bottom">
			<ArrowDown size={16} strokeWidth={2} />
		</button>
	{/if}
</div>

<style>
	.transcript {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.transcript__scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		/* Reserve the scrollbar's gutter on both edges, so the column neither
		 * narrows nor shifts when a conversation grows past the fold. */
		scrollbar-gutter: stable both-edges;
		/* The bottom edge, where the composer's dock begins, dissolves rather
		 * than cuts. The top needs nothing: the plate's ring is the edge. */
		--fade-bottom: var(--space-6);
		mask-image: linear-gradient(to bottom, black calc(100% - var(--fade-bottom)), transparent);
	}

	.transcript__column {
		display: grid;
		gap: var(--space-8);
		width: min(var(--chat-measure), 100% - var(--space-8));
		margin-inline: auto;
		padding-block: var(--space-8);
	}

	.transcript__stale {
		font-size: var(--text-xs);
		line-height: var(--leading-relaxed);
		color: var(--color-text-muted);
	}

	.transcript__stale button {
		color: var(--color-text);
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}

	.transcript__down {
		position: absolute;
		bottom: var(--space-3);
		left: 50%;
		transform: translateX(-50%);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h);
		height: var(--control-h);
		border-radius: var(--radius-full);
		background-color: var(--color-surface-overlay);
		border: var(--border-width) solid var(--color-border-strong);
		color: var(--color-text);
		cursor: pointer;
		animation: rise var(--duration-base) var(--ease-out);
	}

	.transcript__down:hover {
		border-color: var(--color-border-lit);
		color: var(--color-text-strong);
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translate(-50%, 6px);
		}
	}

	@media (max-width: 47.5rem) {
		.transcript__column {
			width: calc(100% - var(--page-edge) * 2);
			gap: var(--space-6);
		}
	}
</style>
