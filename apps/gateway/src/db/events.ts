import {
  journalPayloads,
  type JournalEventInput,
  type JournalEventType,
} from "@errand/shared";
import type { Db } from "./client.ts";
import { appendJournalEvent, appendJournalEventIn, type JournalEvent, type JournalWriter } from "./journal.ts";

function payloadFor(event: JournalEventInput<JournalEventType>): unknown {
  const parsed = journalPayloads[event.eventType].safeParse(event.payload);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const path = issue?.path.join(".") ?? "payload";
  throw new Error(`Journal ${event.eventType} is missing ${path}: ${issue?.message ?? "invalid"}`);
}

export function recordEvent(db: Db, event: JournalEventInput): JournalEvent {
  return appendJournalEvent(db, {
    userId: event.userId,
    eventType: event.eventType,
    payload: payloadFor(event),
  });
}

export function recordEventIn(writer: JournalWriter, event: JournalEventInput): JournalEvent {
  return appendJournalEventIn(writer, {
    userId: event.userId,
    eventType: event.eventType,
    payload: payloadFor(event),
  });
}
