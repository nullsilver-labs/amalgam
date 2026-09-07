/*
 * Transient interface state — which dialog is open, what it is about,
 * whether the Chats panel or the phone drawer is out. Nothing here survives
 * a reload, and nothing here is data.
 */

import type { Conversation } from '$lib/types';

export type Modal = 'settings' | 'search' | 'project' | 'rename' | 'delete' | 'context' | 'sources' | null;

const state = $state<{ modal: Modal; drawer: boolean; panel: boolean; projectEditId: string | null; target: Conversation | null }>({
  modal: null, drawer: false, panel: false, projectEditId: null, target: null
});

export const ui = {
  get modal() { return state.modal; },
  /** The sidebar, as a drawer, on a phone. */
  get drawer() { return state.drawer; },
  /** The Chats panel that hangs off the dock. */
  get panel() { return state.panel; },
  get projectEditId() { return state.projectEditId; },
  /** The conversation a rename or delete dialog is about. */
  get target() { return state.target; },

  open(modal: Exclude<Modal, null>) { state.modal = modal; state.drawer = false; state.panel = false; },
  close() { state.modal = null; state.target = null; },
  /** `null` creates a project; an id edits one. */
  editProject(id: string | null) { state.projectEditId = id; this.open('project'); },
  renameConversation(target: Conversation) { state.target = target; this.open('rename'); },
  deleteConversation(target: Conversation) { state.target = target; this.open('delete'); },
  openDrawer() { state.drawer = true; },
  closeDrawer() { state.drawer = false; },
  togglePanel() { state.panel = !state.panel; },
  closePanel() { state.panel = false; },
  /** After choosing something in a list: every navigation surface closes. */
  settle() { state.drawer = false; state.panel = false; }
};
