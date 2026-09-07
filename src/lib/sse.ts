/** Incremental SSE data parser shared by provider adapters and the browser. */
export async function* eventData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let eventSize = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 1_048_576) throw new Error('Stream event exceeds size limit');
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          if (data.length) yield data.join('\n');
          data = []; eventSize = 0;
        } else if (line.startsWith('data:')) {
          const part = line.slice(5).replace(/^ /, '');
          eventSize += part.length;
          if (eventSize > 1_048_576) throw new Error('Stream event exceeds size limit');
          data.push(part);
        }
      }
      if (done) break;
    }
    // SSE requires a blank line to dispatch an event. Ignore an incomplete tail.
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
