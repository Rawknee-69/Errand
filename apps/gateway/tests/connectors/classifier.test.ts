import { describe, expect, test } from "bun:test";
import {
  classifyTool,
  defaultRequestable,
  moreDangerous,
  type ToolClass,
} from "../../src/connectors/classifier.ts";

describe("classifyTool", () => {
  test("lets a read-only annotation win for an unfamiliar name", () => {
    expect(classifyTool({ name: "zeta", annotations: { readOnlyHint: true } })).toBe("read");
  });

  test("treats a destructive annotation as delete even when the name reads harmless", () => {
    expect(classifyTool({ name: "list_events", annotations: { destructiveHint: true } })).toBe(
      "delete",
    );
  });

  test("treats a non-read-only annotation without destructive as write", () => {
    expect(classifyTool({ name: "zeta", annotations: { readOnlyHint: false } })).toBe("write");
  });

  test.each<[string, ToolClass]>([
    ["list_events", "read"],
    ["search_restaurants", "read"],
    ["create_event", "write"],
    ["update_contact", "write"],
    ["send_receipt", "send"],
    ["delete_event", "delete"],
    ["charge_card", "spend"],
  ])("classifies %s by name as %s", (name, expected) => {
    expect(classifyTool({ name })).toBe(expected);
  });

  test("matches camelCase names as words", () => {
    expect(classifyTool({ name: "deleteEvent" })).toBe("delete");
    expect(classifyTool({ name: "sendReceipt" })).toBe("send");
  });

  test("resolves an annotation and a heuristic that disagree to the more dangerous class", () => {
    expect(
      classifyTool({ name: "delete_account", annotations: { readOnlyHint: true } }),
    ).toBe("delete");
    expect(
      classifyTool({ name: "list_events", annotations: { readOnlyHint: false } }),
    ).toBe("write");
  });

  test("classifies a name that matches several verbs as the most dangerous match", () => {
    expect(classifyTool({ name: "send_payment_receipt" })).toBe("spend");
  });

  test("treats no annotation and no heuristic match as unknown", () => {
    expect(classifyTool({ name: "zeta" })).toBe("unknown");
  });

  test("leaves a decoy-shaped export tool unknown and therefore blocked", () => {
    expect(classifyTool({ name: "export_all_contacts" })).toBe("unknown");
  });

  test("never lets an annotation loosen a heuristic past a dangerous verb", () => {
    expect(
      classifyTool({ name: "transfer_funds", annotations: { readOnlyHint: true } }),
    ).toBe("spend");
  });
});

describe("moreDangerous", () => {
  test("orders the classes by danger", () => {
    expect(moreDangerous("read", "write")).toBe("write");
    expect(moreDangerous("send", "delete")).toBe("delete");
    expect(moreDangerous("spend", "delete")).toBe("spend");
  });

  test("treats unknown as blocked rather than ordered", () => {
    expect(moreDangerous("unknown", "read")).toBe("read");
    expect(moreDangerous("delete", "unknown")).toBe("delete");
  });
});

describe("defaultRequestable", () => {
  test("is on for read and write only", () => {
    expect(defaultRequestable("read")).toBe(true);
    expect(defaultRequestable("write")).toBe(true);
    expect(defaultRequestable("send")).toBe(false);
    expect(defaultRequestable("delete")).toBe(false);
    expect(defaultRequestable("spend")).toBe(false);
    expect(defaultRequestable("unknown")).toBe(false);
  });
});
