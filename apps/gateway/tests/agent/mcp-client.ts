import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";

export async function connectAgent(base: string, key: string): Promise<Client> {
  const client = new Client({ name: "proof-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${key}` } },
  });
  await client.connect(transport, { timeout: 5_000 });
  return client;
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ result: CallToolResult; body: unknown }> {
  const result = await client.callTool({ name, arguments: args }, { timeout: 5_000 });
  const block = result.content[0];
  if (block?.type !== "text") throw new Error(`No text content from ${name}`);
  return { result, body: JSON.parse(block.text) };
}
