<script lang="ts">
	/*
	 * Switch — corpus's: a hairline pill with a knob; on, the pill inverts.
	 * A checkbox underneath, so a wrapping <label> toggles it and forms and
	 * bindings see nothing unusual.
	 */
	type Props = { checked?: boolean; label: string; disabled?: boolean; onchange?: (value: boolean) => void };
	let { checked = $bindable(false), label, disabled = false, onchange }: Props = $props();
</script>

<input type="checkbox" class="switch" role="switch" aria-label={label} {disabled} bind:checked onchange={() => onchange?.(checked)} />

<style>
	.switch {
		appearance: none;
		position: relative;
		width: 36px;
		height: 20px;
		flex: none;
		margin: 0;
		padding: 0;
		border: var(--border-width) solid var(--color-border-strong);
		border-radius: var(--radius-full);
		background-color: var(--color-surface-raised);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out);
	}

	.switch::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		background-color: var(--color-text-muted);
		transition:
			transform var(--duration-base) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out);
	}

	@media (hover: hover) {
		.switch:not(:checked):hover {
			border-color: var(--color-border-lit);
		}
	}

	.switch:checked {
		background-color: var(--color-accent);
		border-color: var(--color-accent);
	}

	.switch:checked::after {
		transform: translateX(16px);
		background-color: var(--color-on-accent);
	}

	.switch:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
