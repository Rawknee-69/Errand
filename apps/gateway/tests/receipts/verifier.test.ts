import { describe, expect, test } from "bun:test";
import { adapterFor } from "../../src/receipts/verifier.ts";

const link = {
  id: "plink-1",
  name: "Alice",
  cents: 4000,
  url: "https://pay.example/1",
  restaurant: "Trattoria Verde",
};
const created = {
  restaurant: "Trattoria Verde",
  totalCents: 4000,
  links: [link],
};
const text = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  isError: false,
  truncated: false,
  originalBytes: 0,
});

describe("mock pay verifier", () => {
  const adapter = adapterFor("http://127.0.0.1:4001/pay/mcp");
  if (adapter === undefined) throw new Error("the pay adapter is missing");

  test("a split link is matched when it is read back", async () => {
    const result = await adapter.verify({
      tool: "create_payment_links",
      arguments: { cents: 4000 },
      result: text(created),
      toolClass: "spend",
      read: async () => text({ links: [link] }),
    });
    expect(result.verification).toBe("matched");
    expect(result.summary).toContain("1 split payment links");
    expect(result.inverse).toBeUndefined();
  });

  test("a link missing from the re-read is mismatched", async () => {
    const result = await adapter.verify({
      tool: "create_payment_links",
      arguments: { cents: 4000 },
      result: text(created),
      toolClass: "spend",
      read: async () => text({ links: [] }),
    });
    expect(result.verification).toBe("mismatched");
  });

  test("a link read back under another restaurant is mismatched", async () => {
    const result = await adapter.verify({
      tool: "create_payment_links",
      arguments: { cents: 4000 },
      result: text(created),
      toolClass: "spend",
      read: async () => text({ links: [{ ...link, restaurant: "Noodle House" }] }),
    });
    expect(result.verification).toBe("mismatched");
  });

  test("a failed re-read is unverified, never success", async () => {
    const result = await adapter.verify({
      tool: "create_payment_links",
      arguments: { cents: 4000 },
      result: text(created),
      toolClass: "spend",
      read: async () => text({ nope: true }),
    });
    expect(result.verification).toBe("unverified");
  });
});
