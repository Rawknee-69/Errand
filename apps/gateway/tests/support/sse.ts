export type SseReader = {
  next: () => Promise<string | null>;
  cancel: () => Promise<void>;
};

export function openSse(response: Response): SseReader {
  const body = response.body;
  if (body === null) throw new Error("The SSE response has no body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  return {
    next: async () => {
      const chunk = await reader.read();
      return chunk.done ? null : decoder.decode(chunk.value, { stream: true });
    },
    cancel: async () => {
      await reader.cancel("test finished");
    },
  };
}

export async function readSseUntil(
  sse: SseReader,
  matches: (text: string) => boolean,
  timeoutMs = 5_000,
): Promise<string> {
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (!matches(text)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out waiting for an SSE frame. Received:\n${text}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const chunk = await Promise.race([
        sse.next(),
        new Promise<null>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Timed out waiting for an SSE frame. Received:\n${text}`)),
            remaining,
          );
        }),
      ]);
      if (chunk === null) break;
      text += chunk;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  return text;
}
