import { callTool, connectAgent } from "../../../apps/gateway/tests/agent/mcp-client.ts";

const base = "http://127.0.0.1:8831";
const statePath = "C:/Users/Rem/AppData/Local/Temp/opencode/errand-18-state.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const state: unknown = await Bun.file(statePath).json();
if (!isRecord(state) || typeof state.key !== "string" || !isRecord(state.slips)) {
  throw new Error("The setup state is missing; run setup.ts first");
}
const slips = state.slips;
if (typeof slips.search !== "string") throw new Error("No search slip in the setup state");

const agent = await connectAgent(base, state.key);
const status = await callTool(agent, "errand_status", { slip_id: slips.search });
if (!isRecord(status.body) || typeof status.body.capability !== "string") {
  throw new Error(`errand_status returned no capability: ${JSON.stringify(status.body)}`);
}
const capability = status.body.capability;
console.log(`capability cap_… redacted (${capability.length} chars)`);

const allowed = await callTool(agent, "errand_call", {
  slip_id: slips.search,
  tool: "calendar__list_events",
  capability,
  arguments: {},
});
console.log(`list_events: ${JSON.stringify(allowed.body)}`);

const outOfScope = await callTool(agent, "errand_call", {
  slip_id: slips.search,
  tool: "calendar__create_event",
  capability,
  arguments: { title: "Not allowed", start: "2026-12-01T09:00:00Z" },
});
console.log(`create_event (out of scope): ${JSON.stringify(outOfScope.body)}`);

const second = await callTool(agent, "errand_call", {
  slip_id: slips.search,
  tool: "calendar__list_events",
  capability,
  arguments: { from: "2026-12-01", to: "2026-12-02" },
});
console.log(`list_events again: ${JSON.stringify(second.body)}`);
await agent.close();
