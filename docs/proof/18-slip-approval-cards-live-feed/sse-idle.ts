const base = "http://127.0.0.1:8831";
const statePath = "C:/Users/Rem/AppData/Local/Temp/opencode/errand-18-state.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const state: unknown = await Bun.file(statePath).json();
if (!isRecord(state) || typeof state.cookie !== "string") {
  throw new Error("The setup state is missing; run setup.ts first");
}

const response = await fetch(`${base}/api/events`, {
  headers: { cookie: state.cookie, accept: "text/event-stream" },
});
console.log(`status ${response.status} ${response.headers.get("content-type") ?? ""}`);
if (response.body === null) throw new Error("The SSE response has no body");

const started = Date.now();
const decoder = new TextDecoder();
let keepAlives = 0;
for await (const chunk of response.body) {
  const text = decoder.decode(chunk, { stream: true });
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(": keep-alive")) {
      keepAlives++;
      console.log(`+${Date.now() - started}ms ${line}`);
    } else if (line.startsWith("event:") || line.startsWith("id:")) {
      console.log(`+${Date.now() - started}ms ${line}`);
    }
  }
  if (Date.now() - started >= 36_000) break;
}
console.log(`idle stream closed after ${Date.now() - started}ms with ${keepAlives} heartbeats`);
