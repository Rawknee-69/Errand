import type { SSEStreamingApi } from "hono/streaming";
import type { Db } from "../db/client.ts";
import { listFeedEvents } from "./events.ts";

export type FeedStreamOptions = {
  pollMs?: number;
  heartbeatMs?: number;
  retryMs?: number;
};

export const DEFAULT_FEED_OPTIONS = {
  pollMs: 500,
  heartbeatMs: 10_000,
  retryMs: 2_000,
} satisfies Required<FeedStreamOptions>;

// Tails the journal for one connection. The heartbeat comment keeps an idle
// stream open through proxies; EventSource reconnects with Last-Event-ID.
export async function streamFeed(
  db: Db,
  userId: string,
  startSeq: number,
  stream: SSEStreamingApi,
  options: FeedStreamOptions = {},
): Promise<void> {
  const pollMs = options.pollMs ?? DEFAULT_FEED_OPTIONS.pollMs;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_FEED_OPTIONS.heartbeatMs;
  const retryMs = options.retryMs ?? DEFAULT_FEED_OPTIONS.retryMs;
  let cursor = startSeq;
  let lastWrite = Date.now();

  await stream.writeSSE({ event: "ready", data: JSON.stringify({ since: startSeq }), retry: retryMs });

  while (!stream.aborted && !stream.closed) {
    for (const event of listFeedEvents(db, userId, cursor)) {
      await stream.writeSSE({
        event: "feed",
        id: String(event.seq),
        data: JSON.stringify(event),
      });
      cursor = event.seq;
      lastWrite = Date.now();
    }
    if (Date.now() - lastWrite >= heartbeatMs) {
      await stream.write(": keep-alive\n\n");
      lastWrite = Date.now();
    }
    await stream.sleep(pollMs);
  }
}
