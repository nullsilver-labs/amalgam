/**
 * A chat (optionally one forum topic inside it) maps to one named amalgam
 * session, which is one file under ~/.amalgam/sessions/. Same name tomorrow =
 * same conversation tomorrow, which is the point of the whole project.
 */
export function sessionName(chatId: number, threadId?: number): string {
  return threadId === undefined ? `telegram-${chatId}` : `telegram-${chatId}-${threadId}`;
}
