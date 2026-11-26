import { describe, expect, test } from "bun:test";
import {
  hashToolDefinition,
  sanitiseAgentName,
  sanitiseDescription,
} from "../../src/connectors/sanitise.ts";

describe("sanitiseAgentName", () => {
  test("prefixes the connector slug and keeps the tool readable", () => {
    expect(sanitiseAgentName("Calendar", "list_events")).toBe("calendar__list_events");
  });

  test("normalises punctuation, case and accents", () => {
    expect(sanitiseAgentName("Dine Out!", "place.order")).toBe("dine_out__place_order");
    expect(sanitiseAgentName("Café", "créer une réservation")).toBe(
      "cafe__creer_une_reservation",
    );
  });

  test("drops zero-width and bidi formatting characters", () => {
    expect(sanitiseAgentName("pay", "charge\u200b\u202ecard")).toBe("pay__chargecard");
  });

  test("falls back to a service slug and never returns an empty tool name", () => {
    expect(sanitiseAgentName("!!!", "---")).toBe("service__tool");
  });

  test("caps the exposed name at 64 characters", () => {
    const name = sanitiseAgentName("a".repeat(40), "b".repeat(40));
    expect(name.length).toBe(64);
    expect(name.startsWith("a".repeat(40) + "__")).toBe(true);
  });
});

describe("sanitiseDescription", () => {
  test("strips markup and collapses whitespace", () => {
    expect(sanitiseDescription("<b>Book</b> a table.\n\n  Tonight ")).toBe("Book a table. Tonight");
  });

  test("removes control and bidi characters", () => {
    expect(sanitiseDescription("book\u0000 a\u202e table")).toBe("book a table");
  });

  test("truncates long descriptions with an ellipsis", () => {
    const result = sanitiseDescription("x".repeat(900), 20);
    expect(result.length).toBe(20);
    expect(result.endsWith("…")).toBe(true);
  });

  test("returns an empty string for an empty description", () => {
    expect(sanitiseDescription("   ")).toBe("");
  });
});

describe("hashToolDefinition", () => {
  const definition = {
    name: "list_events",
    description: "List events",
    inputSchema: { type: "object", properties: { day: { type: "string" } } },
    annotations: { readOnlyHint: true },
  };

  test("is a stable sha-256 over the definition", () => {
    const hash = hashToolDefinition(definition);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashToolDefinition({ ...definition }));
  });

  test("ignores object key order", () => {
    const reordered = {
      annotations: { readOnlyHint: true },
      inputSchema: { properties: { day: { type: "string" } }, type: "object" },
      description: "List events",
      name: "list_events",
    };
    expect(hashToolDefinition(reordered)).toBe(hashToolDefinition(definition));
  });

  test("changes when the schema or description changes", () => {
    const changedSchema = {
      ...definition,
      inputSchema: { type: "object", properties: { day: { type: "number" } } },
    };
    expect(hashToolDefinition(changedSchema)).not.toBe(hashToolDefinition(definition));
    expect(hashToolDefinition({ ...definition, description: "Changed" })).not.toBe(
      hashToolDefinition(definition),
    );
  });
});
