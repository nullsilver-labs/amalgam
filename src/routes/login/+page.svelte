<script lang="ts">
	import { APP_NAME } from '$lib/config';
	import { ArrowRight, LockKeyhole } from '@lucide/svelte';
	import Logo from '$lib/components/Logo.svelte';
	import Button from '$lib/components/Button.svelte';
	import Notice from '$lib/components/Notice.svelte';

	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function login(event: SubmitEvent) {
		event.preventDefault();
		busy = true; error = '';
		try {
			const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || 'Could not sign in.');
			window.location.assign('/');
		} catch (err) { error = err instanceof Error ? err.message : 'Connection failed.'; }
		finally { busy = false; }
	}
</script>

<svelte:head>
	<title>Sign in · {APP_NAME}</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<main class="login">
	<form class="card" onsubmit={login}>
		<div class="brand">
			<Logo height="1.5rem" label="" />
			<span class="brand__name">{APP_NAME}</span>
		</div>
		<h1 class="title">Welcome back.</h1>
		<p class="lede">Enter the password for this instance to continue.</p>

		<div class="field">
			<label for="password"><LockKeyhole size={13} strokeWidth={1.75} />Instance password</label>
			<input id="password" type="password" autocomplete="current-password" bind:value={password} required maxlength="1024" />
		</div>
		{#if error}<Notice ondismiss={() => (error = '')}>{error}</Notice>{/if}
		<Button type="submit" size="md" class="submit" disabled={busy || !password}>
			{busy ? 'Signing in…' : 'Continue'}<ArrowRight size={15} strokeWidth={2} />
		</Button>
		<p class="foot">Set by the owner of this instance as <code>APP_PASSWORD</code>.</p>
	</form>
	<p class="byline">Self-hosted · by Nullsilver</p>
</main>

<style>
	.login {
		min-height: 100dvh;
		display: grid;
		grid-template-rows: 1fr auto;
		justify-items: center;
		padding: var(--space-6) var(--page-edge);
		background-color: var(--color-bg);
	}

	.card {
		display: grid;
		gap: var(--space-3);
		align-self: center;
		width: min(100%, 22rem);
		padding-bottom: 6vh;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	.brand__name {
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		letter-spacing: var(--tracking-tight);
		color: var(--color-text-strong);
		transform: translateY(-1px);
	}

	.title {
		font-size: var(--text-display-md);
	}

	.lede {
		font-size: var(--text-sm);
		line-height: var(--leading-relaxed);
		color: var(--color-text-muted);
		margin-bottom: var(--space-4);
	}

	.field {
		display: grid;
		gap: var(--space-2);
	}

	.field label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
	}

	.card :global(.submit) {
		justify-content: space-between;
		margin-top: var(--space-2);
	}

	.foot {
		font-size: var(--text-xs);
		line-height: var(--leading-relaxed);
		color: var(--color-text-subtle);
	}

	.foot code {
		font-size: 0.9em;
	}

	.byline {
		font-size: var(--text-2xs);
		color: var(--color-text-faint);
	}
</style>
