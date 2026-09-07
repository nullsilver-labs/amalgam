/*
 * Preferences the browser remembers between visits — theme, the chosen
 * model, and whether navigation is the rail or the pinned sidebar. One
 * reactive object,
 * persisted to localStorage under a single key. Read the getters; write
 * with the setters so persistence and the <html data-theme> attribute stay
 * in step.
 *
 * SSR renders with the defaults; the inline script in app.html applies the
 * stored theme before first paint so there is no flash, and `hydrate()`
 * (called once from the root layout) loads the rest on the client.
 */

export type Theme = 'system' | 'dark' | 'light';
/** `dock`: the rail and its Chats panel. `sidebar`: the list, pinned. */
export type Layout = 'dock' | 'sidebar';

const KEY = 'amalgam:prefs';

interface Stored { theme: Theme; model: string; layout: Layout }

const defaults: Stored = { theme: 'system', model: '', layout: 'dock' };

const state = $state<Stored>({ ...defaults });
let hydrated = false;

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage may be disabled */ }
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export const prefs = {
  get theme() { return state.theme; },
  get model() { return state.model; },
  get layout() { return state.layout; },

  setTheme(theme: Theme) { state.theme = theme; applyTheme(theme); persist(); },
  setModel(model: string) { state.model = model; persist(); },
  setLayout(layout: Layout) { state.layout = layout; persist(); },

  /** Load stored preferences on the client. Safe to call more than once. */
  hydrate() {
    if (hydrated || typeof localStorage === 'undefined') return;
    hydrated = true;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        // An earlier build stored the sidebar as open/collapsed.
        if (stored.sidebar && !stored.layout) stored.layout = stored.sidebar === 'open' ? 'sidebar' : 'dock';
        delete stored.sidebar;
        // Another stored the plate's width, which is no longer a choice.
        delete stored.plate;
        Object.assign(state, defaults, stored);
      }
    } catch { /* corrupt storage — keep defaults */ }
    applyTheme(state.theme);
  }
};
