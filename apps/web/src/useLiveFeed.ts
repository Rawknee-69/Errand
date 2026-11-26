import { useEffect, useRef, useState } from "react";
import type { FeedEvent } from "@errand/shared";
import { EVENTS_PATH } from "./api.ts";
import { mergeFeedEvents, parseFeedFrame } from "./feed.ts";

export type FeedStatus = "connecting" | "live" | "reconnecting";

export function useLiveFeed(onEvent?: (event: FeedEvent) => void) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const callback = useRef(onEvent);

  useEffect(() => {
    callback.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const source = new EventSource(EVENTS_PATH);
    source.onopen = () => setStatus("live");
    source.onerror = () => setStatus("reconnecting");
    const onFeed = (message: Event) => {
      if (!(message instanceof MessageEvent)) return;
      const event = parseFeedFrame(String(message.data));
      if (event === undefined) return;
      setEvents((current) => mergeFeedEvents(current, event));
      callback.current?.(event);
    };
    source.addEventListener("feed", onFeed);
    return () => {
      source.removeEventListener("feed", onFeed);
      source.close();
    };
  }, []);

  return { events, status };
}
