import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { isClassLoosening, type IngestSummary } from "@errand/shared";
import type { Db } from "../db/client.ts";
import { appendJournalEvent, canonicalJson } from "../db/journal.ts";
import { scopedGet, scopedList } from "../db/scoped-reads.ts";
import { tools, type ToolClass, type ToolState } from "../db/schema.ts";
import { classifyTool, defaultRequestable, type ToolAnnotations } from "./classifier.ts";
import { ConnectorError } from "./errors.ts";
import { hashToolDefinition, sanitiseAgentName, sanitiseDescription } from "./sanitise.ts";

export type DiscoveredTool = {
  name: string;
  description?: string | undefined;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: ToolAnnotations | undefined;
};

export type IngestOptions = {
  userId: string;
  connectorId: string;
  connectorName: string;
  tools: DiscoveredTool[];
  now?: string;
};

export type { IngestSummary };

export type CatalogTool = typeof tools.$inferSelect;

export function listCatalog(db: Db, userId: string): CatalogTool[] {
  return scopedList(db, tools, tools.userId, userId, tools.agentName);
}

export function getCatalogTool(db: Db, userId: string, id: string): CatalogTool | undefined {
  return scopedGet(db, tools, tools.userId, userId, tools.id, id);
}

function uniqueAgentName(
  db: Db,
  userId: string,
  connectorName: string,
  toolName: string,
  excludeId?: string,
): string {
  const base = sanitiseAgentName(connectorName, toolName);
  let candidate = base;
  for (let suffix = 2; ; suffix++) {
    const taken = db
      .select({ id: tools.id })
      .from(tools)
      .where(and(eq(tools.userId, userId), eq(tools.agentName, candidate)))
      .all()
      .some((row) => row.id !== excludeId);
    if (!taken) return candidate;
    const tail = `_${suffix}`;
    candidate = `${base.slice(0, Math.max(0, 64 - tail.length))}${tail}`;
  }
}

function requestableFor(state: ToolState, toolClass: ToolClass): boolean {
  if (state === "changed" || state === "removed") return false;
  return defaultRequestable(toolClass);
}

function blocked(state: ToolState): boolean {
  return state === "changed" || state === "removed";
}

// Ingestion is where pinning happens: the hash the human first saw becomes
// `definitionHash`, and every later difference blocks the tool until approval.
export function ingestTools(db: Db, options: IngestOptions): IngestSummary {
  const now = options.now ?? new Date().toISOString();
  const existing = db
    .select()
    .from(tools)
    .where(and(eq(tools.userId, options.userId), eq(tools.connectorId, options.connectorId)))
    .all();
  const byName = new Map(existing.map((row) => [row.name, row]));
  const seen = new Set<string>();
  const summary: IngestSummary = { new: 0, changed: 0, removed: 0, unchanged: 0, total: 0 };

  db.transaction((tx) => {
    for (const discovered of options.tools) {
      seen.add(discovered.name);
      const hash = hashToolDefinition(discovered);
      const toolClass = classifyTool(discovered);
      const description = sanitiseDescription(discovered.description ?? "");
      const inputSchema = canonicalJson(discovered.inputSchema ?? {});
      const annotations = canonicalJson(discovered.annotations ?? {});
      const previous = byName.get(discovered.name);

      if (previous === undefined) {
        const state: ToolState = "new";
        tx.insert(tools)
          .values({
            id: randomUUID(),
            userId: options.userId,
            connectorId: options.connectorId,
            name: discovered.name,
            agentName: uniqueAgentName(db, options.userId, options.connectorName, discovered.name),
            description,
            inputSchema,
            annotations,
            class: toolClass,
            definitionHash: hash,
            observedDescription: description,
            observedInputSchema: inputSchema,
            observedAnnotations: annotations,
            observedClass: toolClass,
            observedHash: hash,
            state,
            requestable: requestableFor(state, toolClass),
            createdAt: now,
            updatedAt: now,
          })
          .run();
        summary.new++;
        continue;
      }

      const changed = hash !== previous.definitionHash;
      const state: ToolState = changed ? "changed" : "active";
      if (changed) summary.changed++;
      else summary.unchanged++;

      tx.update(tools)
        .set({
          agentName:
            previous.agentName === ""
              ? uniqueAgentName(
                  db,
                  options.userId,
                  options.connectorName,
                  discovered.name,
                  previous.id,
                )
              : previous.agentName,
          ...(changed
            ? {}
            : {
                description,
                inputSchema,
                annotations,
                class: previous.classOverride ?? toolClass,
              }),
          observedDescription: description,
          observedInputSchema: inputSchema,
          observedAnnotations: annotations,
          observedClass: toolClass,
          observedHash: hash,
          state,
          requestable: changed
            ? false
            : previous.state === "removed"
              ? requestableFor("active", previous.classOverride ?? toolClass)
              : previous.requestable,
          changedAt: changed ? (previous.changedAt ?? now) : null,
          removedAt: null,
          updatedAt: now,
        })
        .where(and(eq(tools.userId, options.userId), eq(tools.id, previous.id)))
        .run();
    }

    for (const previous of existing) {
      if (seen.has(previous.name)) continue;
      if (previous.state === "removed") continue;
      tx.update(tools)
        .set({
          state: "removed",
          requestable: false,
          removedAt: now,
          updatedAt: now,
        })
        .where(and(eq(tools.userId, options.userId), eq(tools.id, previous.id)))
        .run();
      summary.removed++;
    }
  });

  summary.total = options.tools.length;
  return summary;
}

export function pinToolDefinition(
  db: Db,
  userId: string,
  row: CatalogTool,
  now = new Date().toISOString(),
): CatalogTool {
  const pinnedClass = row.classOverride ?? row.observedClass;
  db.update(tools)
    .set({
      description: row.observedDescription,
      inputSchema: row.observedInputSchema,
      annotations: row.observedAnnotations,
      class: pinnedClass,
      definitionHash: row.observedHash,
      state: "active",
      requestable: defaultRequestable(pinnedClass),
      changedAt: null,
      updatedAt: now,
    })
    .where(and(eq(tools.userId, userId), eq(tools.id, row.id)))
    .run();
  return getCatalogTool(db, userId, row.id)!;
}

export function approveTool(db: Db, userId: string, toolId: string, now = new Date().toISOString()): CatalogTool {
  const row = getCatalogTool(db, userId, toolId);
  if (row === undefined) throw new Error(`Tool ${toolId} not found`);
  if (row.state === "removed") throw new Error(`Cannot approve a removed tool: ${row.name}`);
  return pinToolDefinition(db, userId, row, now);
}

export type ToolClassChange = {
  tool: CatalogTool;
  loosened: boolean;
};

// A human may tighten freely. Loosening needs an explicit confirmation, and
// every class change is journaled with both the old and the new class.
export function setToolClass(
  db: Db,
  userId: string,
  toolId: string,
  nextClass: ToolClass,
  confirmed: boolean,
  now = new Date().toISOString(),
): ToolClassChange {
  const row = getCatalogTool(db, userId, toolId);
  if (row === undefined) throw new ConnectorError("not_found", `Tool ${toolId} not found`);
  if (row.state === "removed") {
    throw new ConnectorError("not_found", `Tool ${row.name} was removed`);
  }
  const loosened = isClassLoosening(row.class, nextClass);
  if (loosened && !confirmed) {
    throw new ConnectorError(
      "confirmation_required",
      `Changing ${row.name} from ${row.class} to ${nextClass} widens its access; confirm first`,
    );
  }
  if (row.class === nextClass) return { tool: row, loosened };

  const requestable =
    blocked(row.state) || !defaultRequestable(nextClass) ? false : row.requestable;
  db.update(tools)
    .set({
      class: nextClass,
      classOverride: nextClass,
      requestable,
      updatedAt: now,
    })
    .where(and(eq(tools.userId, userId), eq(tools.id, row.id)))
    .run();
  appendJournalEvent(db, {
    userId,
    eventType: "catalog.class_changed",
    payload: {
      toolId: row.id,
      connectorId: row.connectorId,
      name: row.name,
      from: row.class,
      to: nextClass,
      loosened,
      confirmed: loosened && confirmed,
    },
  });
  return { tool: getCatalogTool(db, userId, row.id)!, loosened };
}

export function setToolRequestable(
  db: Db,
  userId: string,
  toolId: string,
  requestable: boolean,
  now = new Date().toISOString(),
): CatalogTool {
  const row = getCatalogTool(db, userId, toolId);
  if (row === undefined) throw new ConnectorError("not_found", `Tool ${toolId} not found`);
  if (row.state === "removed") {
    throw new ConnectorError("not_found", `Tool ${row.name} was removed`);
  }
  if (row.requestable === requestable) return row;
  if (requestable && blocked(row.state)) {
    throw new ConnectorError(
      "blocked",
      `${row.name} changed upstream; re-approve the definition before exposing it`,
    );
  }
  if (requestable && row.class === "unknown") {
    throw new ConnectorError("blocked", `${row.name} has no safe class; set one before exposing it`);
  }
  db.update(tools)
    .set({ requestable, updatedAt: now })
    .where(and(eq(tools.userId, userId), eq(tools.id, row.id)))
    .run();
  appendJournalEvent(db, {
    userId,
    eventType: "catalog.requestable_changed",
    payload: {
      toolId: row.id,
      connectorId: row.connectorId,
      name: row.name,
      requestable,
    },
  });
  return getCatalogTool(db, userId, row.id)!;
}
