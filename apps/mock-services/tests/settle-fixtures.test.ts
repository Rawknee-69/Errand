import { afterEach, describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { FRIEND_CALENDARS, MOCK_AUTH, MOCK_PATHS, startMockServices } from "../src/server.ts";

let server: ReturnType<typeof startMockServices> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

async function call(
  url: URL,
  headers: Record<string, string>,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const client = new Client({ name: "fixture-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(url, { requestInit: { headers } }),
    { timeout: 5_000 },
  );
  try {
    const result = await client.callTool({ name: tool, arguments: args }, { timeout: 5_000 });
    const block = result.content[0];
    if (block?.type !== "text") throw new Error(`No text from ${tool}`);
    return JSON.parse(block.text);
  } finally {
    await client.close();
  }
}

describe("settle-it fixtures", () => {
  test("each friend token selects that friend's calendar", async () => {
    server = startMockServices({ port: 0 });
    const url = new URL(MOCK_PATHS.calendarSecure, server.url);

    for (const [friend, calendar] of Object.entries(FRIEND_CALENDARS)) {
      const events = z
        .array(z.object({ id: z.string(), title: z.string() }))
        .parse(await call(url, { authorization: `Bearer ${calendar.token}` }, "list_events"));
      expect(events.map((event) => event.title)).toEqual(
        calendar.events.map((event) => event.title),
      );
      expect(events.some((event) => event.title.includes(friend))).toBe(false);
    }

    const rejected = await fetch(url, { headers: { authorization: "Bearer nope" } });
    expect(rejected.status).toBe(401);
  });

  test("seeds events into one friend calendar without touching the others", async () => {
    server = startMockServices({ port: 0 });
    const alice = FRIEND_CALENDARS.Alice.token;
    const response = await fetch(new URL("/mock/calendar/events", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: alice, events: [{ title: "Dinner", start: "2026-12-05T19:00:00Z" }] }),
    });
    expect(response.status).toBe(200);

    const url = new URL(MOCK_PATHS.calendarSecure, server.url);
    const aliceEvents = z
      .array(z.object({ title: z.string() }))
      .parse(await call(url, { authorization: `Bearer ${alice}` }, "list_events"));
    const bobEvents = z
      .array(z.object({ title: z.string() }))
      .parse(
        await call(
          url,
          { authorization: `Bearer ${FRIEND_CALENDARS.Bob.token}` },
          "list_events",
        ),
      );
    expect(aliceEvents.map((event) => event.title)).toContain("Dinner");
    expect(bobEvents.map((event) => event.title)).not.toContain("Dinner");
  });

  test("creates and lists split payment links", async () => {
    server = startMockServices({ port: 0 });
    const url = new URL(MOCK_PATHS.pay, server.url);
    const headers = { [MOCK_AUTH.payHeaderName]: MOCK_AUTH.payHeaderValue };

    const created = z
      .object({
        totalCents: z.number(),
        links: z.array(z.object({ id: z.string(), cents: z.number(), name: z.string() })),
      })
      .parse(
        await call(url, headers, "create_payment_links", {
          cents: 12000,
          people: ["Alice", "Bob", "Cara"],
          restaurant: "Trattoria Verde",
        }),
      );
    expect(created.totalCents).toBe(12000);
    expect(created.links.map((link) => link.cents)).toEqual([4000, 4000, 4000]);

    const listed = z
      .object({ links: z.array(z.object({ id: z.string() })) })
      .parse(await call(url, headers, "list_split_links"));
    expect(listed.links.map((link) => link.id)).toEqual(created.links.map((link) => link.id));
  });

  test("the inbox carries the poisoned instruction", async () => {
    server = startMockServices({ port: 0 });
    const messages = z
      .array(z.object({ subject: z.string(), body: z.string() }))
      .parse(
        await call(
          new URL(MOCK_PATHS.email, server.url),
          { authorization: `Bearer ${MOCK_AUTH.emailBearer}` },
          "list_messages",
        ),
      );
    expect(messages[0]?.body).toContain("export_all_contacts");
  });
});
