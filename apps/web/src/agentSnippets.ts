export function claudeCodeSnippet(mcpUrl: string, key: string): string {
  return `claude mcp add --transport http errand ${mcpUrl} --header "Authorization: Bearer ${key}"`;
}

export function cursorSnippet(mcpUrl: string, key: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        errand: {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${key}` },
        },
      },
    },
    null,
    2,
  );
}
