<script lang="ts">
	import '$lib/styles/app.css';
	import { prefs } from '$lib/state/prefs.svelte';

	let { children } = $props();

	$effect(() => { prefs.hydrate(); });
</script>

{@render children()}
