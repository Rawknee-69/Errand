import { describe, expect, test } from "bun:test";
import { claudeCodeSnippet, cursorSnippet } from "../src/agentSnippets.ts";

const KEY = "errand_exampleKey";
const MCP_URL = "http://localhost:5173/mcp";

describe("agent snippets", () => {
  test("writes the Claude Code one-liner with a bearer header", () => {
    expect(claudeCodeSnippet(MCP_URL, KEY)).toBe(
      'claude mcp add --transport http errand http://localhost:5173/mcp --header "Authorization: Bearer errand_exampleKey"',
    );
  });

  test("writes an importable Cursor config", () => {
    expect(JSON.parse(cursorSnippet(MCP_URL, KEY))).toEqual({
      mcpServers: {
        errand: {
          url: MCP_URL,
          headers: { Authorization: `Bearer ${KEY}` },
        },
      },
    });
  });
});
