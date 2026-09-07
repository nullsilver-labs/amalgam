import type { MenuEntry } from '$lib/components/Menu.svelte';
import type { ModelOption } from '$lib/types';
import { formatTokens } from '$lib/format';

/**
 * The model list as a menu: grouped by provider, each row naming the host
 * it is sent to and its declared window, if any. The composer's picker and
 * a response's "answer again" menu show the same list.
 */
export function modelEntries(models: ModelOption[], selected: string, choose: (id: string) => void): MenuEntry[] {
  const out: MenuEntry[] = [];
  let provider = '';
  for (const m of models) {
    if (m.provider !== provider) { provider = m.provider; out.push({ id: `head:${provider}`, heading: provider }); }
    out.push({ id: m.id, label: m.name, hint: m.window ? `${m.destination} · ${formatTokens(m.window)}` : m.destination, selected: m.id === selected, onselect: () => choose(m.id) });
  }
  return out;
}
