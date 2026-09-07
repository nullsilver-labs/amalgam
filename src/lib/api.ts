export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (response.status === 401) { window.location.assign('/login'); throw new Error('Please sign in again.'); }
  if (!response.ok) {
    let message = 'Something went wrong. Please try again.';
    try { const data = await response.json(); message = data.error || data.message || message; } catch { /* Do not expose proxy HTML. */ }
    throw new Error(message);
  }
  return response.json();
}
