import { useSyncExternalStore } from "react";
import { agentKeyCreatedSchema, type AgentKeyCreated } from "@errand/shared";

// Demo-only convenience: keep the issued key for this browser session so a
// screen change does not lose it. The gateway still stores only its hash.
const STORAGE_KEY = "errand.demo.agent-keys";
const MAX_KEYS = 5;
const storedSchema = agentKeyCreatedSchema.array();

function load(): AgentKeyCreated[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const parsed = storedSchema.safeParse(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

let keys: AgentKeyCreated[] = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(next: AgentKeyCreated[]): void {
  keys = next;
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Session storage can be full or blocked; the in-memory copy still works.
    }
  }
  emit();
}

export function rememberAgentKey(issued: AgentKeyCreated): void {
  persist([issued, ...keys.filter((entry) => entry.agentKey.id !== issued.agentKey.id)].slice(0, MAX_KEYS));
}

export function forgetAgentKey(id: string): void {
  persist(keys.filter((entry) => entry.agentKey.id !== id));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): AgentKeyCreated[] {
  return keys;
}

export function useAgentKeys(): AgentKeyCreated[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
