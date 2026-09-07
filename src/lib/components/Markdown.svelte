<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';
	import { copyText } from '$lib/clipboard';

	/*
	 * Rendered Markdown. The HTML is sanitised in $lib/markdown; this adds the
	 * one thing sanitised HTML cannot carry — a copy button on each code block,
	 * put back after every render.
	 */

	let { content }: { content: string } = $props();
	const html = $derived(renderMarkdown(content));
	let root = $state<HTMLDivElement | null>(null);

	const IDLE = '<svg class="is-idle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 17.5zM15 8V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15H8"/></svg><span class="is-idle">Copy</span>';
	const DONE = '<svg class="is-done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg><span class="is-done">Copied</span>';

	$effect(() => {
		html;
		if (!root) return;
		for (const pre of root.querySelectorAll('pre')) {
			if (pre.querySelector('.code-copy')) continue;
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'code-copy';
			button.setAttribute('aria-label', 'Copy code');
			button.innerHTML = IDLE + DONE;
			pre.append(button);
		}
	});

	async function onclick(event: MouseEvent) {
		const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.code-copy');
		if (!button) return;
		const code = button.parentElement?.querySelector('code')?.textContent ?? '';
		if (await copyText(code.replace(/\n$/, ''))) {
			button.classList.add('is-copied');
			setTimeout(() => button.classList.remove('is-copied'), 1500);
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="prose" bind:this={root} {onclick}>{@html html}</div>
