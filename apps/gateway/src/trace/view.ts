import { traceResponseSchema, type TraceEvent, type TraceResponse } from "@errand/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { calls, journal } from "../db/schema.ts";
import { listConnectors } from "../db/scoped-reads.ts";
import { toFeedEvent } from "../feed/events.ts";

export const TRACE_LIMIT = 300;

// Transparency is the journal plus the rows it points at. The journal says a
// call happened; the calls table supplies the exact message and output.
export function traceView(db: Db, userId: string, limit = TRACE_LIMIT): TraceResponse {
  const rows = db
    .select()
    .from(journal)
    .where(eq(journal.userId, userId))
    .orderBy(desc(journal.seq))
    .limit(limit)
    .all();
  const events = rows.map(toFeedEvent);
  const callIds = events
    .map((event) =>
      typeof event.payload.call_id === "string" ? event.payload.call_id : null,
    )
    .filter((id): id is string => id !== null);

  const callRows =
    callIds.length === 0
      ? []
      : db
          .select()
          .from(calls)
          .where(and(eq(calls.userId, userId), inArray(calls.id, callIds)))
          .all();
  const byId = new Map(callRows.map((row) => [row.id, row]));
  const connectorNames = new Map(
    listConnectors(db, userId).map((connector) => [connector.id, connector.name]),
  );

  const withCalls: TraceEvent[] = events.map((event) => {
    const callId =
      typeof event.payload.call_id === "string" ? event.payload.call_id : null;
    const row = callId === null ? undefined : byId.get(callId);
    const connectorId =
      callId === null && typeof event.payload.connector_id === "string"
        ? event.payload.connector_id
        : typeof event.payload.connectorId === "string"
          ? event.payload.connectorId
          : row?.connectorId;
    return {
      ...event,
      connectorName: connectorId === undefined ? null : (connectorNames.get(connectorId) ?? null),
      call:
        row === undefined
          ? null
          : {
              id: row.id,
              slipId: row.slipId,
              connectorId: row.connectorId,
              tool: row.tool,
              arguments: row.arguments,
              result: row.result,
              error: row.error,
              createdAt: row.createdAt,
            },
    };
  });

  return traceResponseSchema.parse({ events: withCalls });
}
