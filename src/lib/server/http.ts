import { error } from '@sveltejs/kit';
import type { ZodType, ZodTypeDef } from 'zod';
// Typed on the schema's output alone, so a defaulted field arrives as the value it was given.
export async function body<T>(request: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) error(415, 'Expected application/json');
  const reader = request.body?.getReader();
  if (!reader) error(400, 'Missing body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) { await reader.cancel(); error(413, 'Request is too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let input: unknown;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { error(400, 'Invalid JSON'); }
  const result = schema.safeParse(input);
  if (!result.success) error(400, result.error.issues[0]?.message || 'Invalid request');
  return result.data;
}
